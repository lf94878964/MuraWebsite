// 計算機的 Web Worker：在背景執行緒載入 Pyodide（瀏覽器版 Python）+ SymPy，
// 再把機器人的原版引擎（/py/calc_engine.py）與轉接層（/py/calc_web.py）放進去執行。
//
// 為什麼要放在 Worker：
//   1. 計算與載入都很吃 CPU，不能卡住頁面。
//   2. 機器人原本用「子行程 + 6 秒逾時」防止算式卡死；網頁沒有子行程，
//      改成由主執行緒計時，逾時直接 terminate() 整個 Worker 再重開（見 js/pages/calculator.js）。
//
// 訊息（主 → Worker）：{type:'init', origin, v} / {type:'run', id, payload}
// 訊息（Worker → 主）：{type:'status', text} / {type:'ready', limits} / {type:'fatal', error}
//                      / {type:'result', id, out}（out 是 calc_web.run() 回傳的 JSON 字串）

const PYODIDE_VERSION = '0.27.7'; // 內含 SymPy 1.13.3；升級時請一併重新跑 scripts/check-calculator.py
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let web = null;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} (HTTP ${res.status})`);
  return res.text();
}

async function boot({ origin, v }) {
  self.postMessage({ type: 'status', text: '下載 Python 執行環境…（首次約需數秒，之後會用快取）' });
  importScripts(PYODIDE_BASE + 'pyodide.js');
  const py = await self.loadPyodide({ indexURL: PYODIDE_BASE });

  self.postMessage({ type: 'status', text: '載入 SymPy 數學函式庫…' });
  await py.loadPackage('sympy');
  // loadPackage 失敗時只會在 console 警告、不會丟錯，所以自己確認一次
  try { py.pyimport('sympy'); } catch { throw new Error('無法下載 SymPy（網路中斷，或 cdn.jsdelivr.net 被擋）'); }

  self.postMessage({ type: 'status', text: '載入計算引擎…' });
  const q = v ? `?v=${encodeURIComponent(v)}` : '';
  const [engine, adapter] = await Promise.all([
    fetchText(`${origin}/py/calc_engine.py${q}`),
    fetchText(`${origin}/py/calc_web.py${q}`),
  ]);
  py.FS.writeFile('/home/pyodide/calc_engine.py', engine);
  py.FS.writeFile('/home/pyodide/calc_web.py', adapter);
  py.runPython('import sys\nif "/home/pyodide" not in sys.path: sys.path.insert(0, "/home/pyodide")');
  web = py.pyimport('calc_web');

  // 暖機：先跑幾個算式，讓 SymPy 把常用模組載入完，使用者第一次按下計算才不會卡一下
  self.postMessage({ type: 'status', text: '初始化…' });
  for (const raw of ['sin(1)+1/3', '∫(0 to 1) x^2 dx', '[[1,2],[3,4]]*[[1,0],[0,1]]']) {
    try { web.run(JSON.stringify({ raw, angle: 'radian' })); } catch { /* 暖機失敗不影響使用 */ }
  }
  self.postMessage({ type: 'ready', limits: JSON.parse(web.limits()) });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      await boot(m);
    } catch (err) {
      self.postMessage({ type: 'fatal', error: String((err && err.message) || err) });
    }
  } else if (m.type === 'run') {
    if (!web) return self.postMessage({ type: 'result', id: m.id, out: JSON.stringify({ ok: false, error: '計算引擎尚未就緒。' }) });
    let out;
    try {
      out = web.run(JSON.stringify(m.payload));
    } catch (err) {
      out = JSON.stringify({ ok: false, error: `計算過程發生未預期的錯誤：${(err && err.message) || err}` });
    }
    self.postMessage({ type: 'result', id: m.id, out });
  }
};
