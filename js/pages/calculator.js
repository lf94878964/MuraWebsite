// 計算機頁面：UI 層。
// 計算由機器人原版引擎負責（py/calc_engine.py，經 Pyodide 在 Web Worker 內執行，見 js/tools/calculator-worker.js），
// 結果以 LaTeX 傳回，這裡用 KaTeX 排版；右側的「可用函數」清單來自 data/calculator-functions.json。
import { escapeHtml, copyText, toast } from '../core/ui.js';

// 改了 py/ 底下的檔案（例如同步機器人的新版引擎）後把這個數字加一，讓瀏覽器重新抓取
const ASSET_V = '1';
const WORKER_URL = `/js/tools/calculator-worker.js?v=${ASSET_V}`;
const KATEX_VER = '0.16.11';
const KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.css`;
const KATEX_JS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.js`;
const TIMEOUT_MS = 6000; // 與機器人的 COMPUTE_TIMEOUT 一致
const IDLE_KILL_MS = 120000; // 離開頁面兩分鐘後釋放引擎（約佔數百 MB 記憶體）
const TIMEOUT_MSG = '計算時間過長（可能是數字過大或運算過於複雜），請簡化算式後再試一次。';

const MODE_LABEL = { scalar: '純量', vector: '向量', matrix: '矩陣', determinant: '行列式', permanent: '積和式', diagonal: '對角線' };
const ANGLE_LABEL = { degree: '角度', radian: '弧度' };

// 手機鍵盤很難打的符號：text 是要插入的字，back 是插入後游標往回退幾格（停在括號中間）
const KEYS = [
  { l: 'π', t: 'π' }, { l: '√', t: '√(', back: 1 }, { l: 'xʸ', t: '^' }, { l: '( )', t: '()', back: 1 }, { l: '[ ]', t: '[]', back: 1 },
  { l: '|x|', t: '||', back: 1 }, { l: '!', t: '!' }, { l: ',', t: ',' }, { l: '∞', t: '∞' }, { l: '→', t: '→' },
  { l: 'lim', t: 'lim (x→0) ' }, { l: '∫', t: '∫(0 to 1) x dx', sel: [6, 7] }, { l: 'Σ', t: 'Σ(n=1 to 10) n' }, { l: '∏', t: '∏(n=1 to 6) n' },
];

/* ───────────── 計算引擎（Worker）管理 ───────────── */

class TimeoutError extends Error {}

function createEngine() {
  const subs = new Set();
  const e = { state: 'loading', status: '準備中…', limits: null, worker: null };
  const pending = new Map();
  let seq = 0;
  const notify = () => subs.forEach((f) => f());

  let readyRes;
  let readyRej;
  const ready = new Promise((res, rej) => { readyRes = res; readyRej = rej; });
  ready.catch(() => {}); // 避免「未處理的拒絕」警告；實際錯誤由 run() / 狀態列顯示

  const fail = (msg) => {
    if (e.state === 'dead') return;
    e.state = 'failed';
    e.status = msg;
    readyRej(new Error(msg));
    pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error(msg)); });
    pending.clear();
    notify();
  };

  let worker;
  try {
    worker = new Worker(WORKER_URL);
  } catch (err) {
    fail(`無法啟動背景執行緒：${err.message}`);
    return Object.assign(e, { subscribe: () => () => {}, run: () => Promise.reject(new Error(e.status)), kill() {} });
  }
  e.worker = worker;

  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'status') {
      e.status = m.text;
      notify();
    } else if (m.type === 'ready') {
      e.state = 'ready';
      e.limits = m.limits;
      e.status = '計算引擎已就緒';
      readyRes(m.limits);
      notify();
    } else if (m.type === 'fatal') {
      fail(`計算引擎載入失敗：${m.error}`);
    } else if (m.type === 'result') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      try { p.resolve(JSON.parse(m.out)); } catch { p.reject(new Error('引擎回傳格式錯誤')); }
    }
  };
  worker.onerror = (ev) => fail(`計算引擎載入失敗：${ev.message || '背景執行緒發生錯誤'}（請檢查網路連線後重試）`);
  worker.postMessage({ type: 'init', origin: location.origin, v: ASSET_V });

  e.subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

  e.run = (payload, timeoutMs) =>
    ready.then(() => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        e.kill();
        reject(new TimeoutError(TIMEOUT_MSG));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: 'run', id, payload });
    }));

  e.kill = () => {
    e.state = 'dead';
    worker.terminate();
    pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('引擎已停止')); });
    pending.clear();
    subs.clear();
  };
  return e;
}

let engine = null;
let idleTimer = 0;

function getEngine() {
  if (!engine || engine.state === 'dead' || engine.state === 'failed') engine = createEngine();
  return engine;
}

/* ───────────── KaTeX（載入失敗時退回純文字） ───────────── */

let katexPromise = null;
function loadKatex() {
  katexPromise ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = KATEX_CSS;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = KATEX_JS;
    s.onload = () => (window.katex ? resolve(window.katex) : reject(new Error('KaTeX 不可用')));
    s.onerror = () => { katexPromise = null; css.remove(); reject(new Error('KaTeX 載入失敗')); };
    document.head.appendChild(s);
  });
  return katexPromise;
}

/* ───────────── 函數清單資料 ───────────── */

let refPromise = null;
function loadRef() {
  refPromise ??= fetch('/data/calculator-functions.json')
    .then((r) => {
      if (!r.ok) throw new Error(`calculator-functions.json (HTTP ${r.status})`);
      return r.json();
    })
    .then((d) => {
      d.groups.forEach((g) => g.items.forEach((it) => {
        it._hay = [it.name, ...(it.alias || []), it.desc, it.ex, g.title].join(' ').toLowerCase();
      }));
      return d;
    })
    .catch((err) => { refPromise = null; throw err; });
  return refPromise;
}

/* ───────────── 頁面 ───────────── */

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const input = $('#calc-in');
  const modeSel = $('#calc-mode');
  const angleSel = $('#calc-angle');
  const varsInput = $('#calc-vars');
  const varsWrap = $('#calc-vars-wrap');
  const goBtn = $('#calc-go');
  const engineEl = $('#calc-engine');
  const card = $('#calc-result-card');
  const out = $('#calc-result');
  const refList = $('#calc-ref-list');
  const refQ = $('#calc-ref-q');

  let alive = true;
  let busy = false;
  let seq = 0;
  let unsub = null;
  let ref = null;
  const st = { last: null, tab: 'result', dec: false, openGroups: null };

  clearTimeout(idleTimer);

  /* ── 引擎狀態列 ── */
  function paintEngine() {
    const e = engine;
    if (!e) return;
    if (e.state === 'ready') {
      engineEl.innerHTML = '<span class="status-dot online" aria-hidden="true"></span>計算引擎已就緒';
    } else if (e.state === 'failed') {
      engineEl.innerHTML = `<span class="calc-bad">${escapeHtml(e.status)}</span> <button type="button" class="calc-link" id="calc-retry">重試</button>`;
    } else {
      engineEl.innerHTML = `<span class="spinner calc-spin" aria-hidden="true"></span>${escapeHtml(e.status)}`;
    }
    if (!busy) goBtn.textContent = '計算';
    else if (e.state === 'ready') goBtn.textContent = '計算中…';
  }

  function bindEngine() {
    unsub?.();
    const e = getEngine();
    unsub = e.subscribe(() => alive && paintEngine());
    paintEngine();
  }

  /* ── 符號列 ── */
  $('#calc-keys').innerHTML = KEYS.map((k, i) => `<button type="button" class="calc-key" data-k="${i}">${escapeHtml(k.l)}</button>`).join('');

  function insertText(text, back = 0, sel = null) {
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? s;
    input.setRangeText(text, s, e, 'end');
    if (sel) input.setSelectionRange(s + sel[0], s + sel[0] + sel[1]);
    else if (back) input.setSelectionRange(input.selectionStart - back, input.selectionStart - back);
    input.focus();
    syncVars();
  }

  function syncVars() {
    varsWrap.hidden = !/[?？]/.test(input.value);
  }

  /* ── 計算 ── */
  function setBusy(on, text = '計算中…') {
    busy = on;
    goBtn.disabled = on;
    goBtn.textContent = on ? text : '計算';
  }

  async function compute({ fromRef = false } = {}) {
    const raw = input.value.trim();
    if (!raw) { input.focus(); return; }
    if (busy) return;
    const payload = {
      raw,
      mode: modeSel.value || null,
      angle: angleSel.value,
      variables: varsInput.value.trim() || null,
    };
    const my = ++seq;
    setBusy(true, engine && engine.state === 'ready' ? '計算中…' : '等待引擎載入…');
    bindEngine();

    let res;
    try {
      res = await getEngine().run(payload, TIMEOUT_MS);
    } catch (err) {
      if (err instanceof TimeoutError) {
        res = { ok: false, error: TIMEOUT_MSG };
        engine = null; // 引擎已被強制停止；馬上重開一個，下一次計算才不用等
        if (alive) bindEngine();
      } else {
        res = { ok: false, error: err.message || String(err) };
      }
    }
    if (!alive || my !== seq) return;
    setBusy(false);
    st.last = { payload, res };
    st.tab = 'result';
    st.dec = false;
    await paintResult();
    if (fromRef && window.innerWidth <= 960) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── 結果 ── */
  const texEl = (jobs, tex) => {
    jobs.push(tex);
    return `<div class="calc-eq" data-tex="${jobs.length - 1}"><span class="calc-eq-wait">…</span></div>`;
  };

  async function paintResult() {
    const L = st.last;
    if (!L) return;
    card.hidden = false;

    if (!L.res.ok) {
      out.innerHTML =
        `<div class="calc-err" role="alert"><strong>無法計算</strong><p>${escapeHtml(L.res.error)}</p></div>` +
        `<div class="calc-io"><span class="calc-lab">輸入</span><pre class="calc-pre">${escapeHtml(L.payload.raw)}</pre></div>`;
      return;
    }

    const { res, payload } = L;
    const jobs = [];
    const hasDec = !!res.decimal;
    const showDec = hasDec && st.dec && st.tab === 'result';
    const cur = showDec ? res.decimal : res.result;
    const outLabel = showDec ? '輸出（小數，最多顯示到小數第 12 位，超過以 ... 表示）' : '輸出';

    const tabBtn = (id, label) =>
      `<button type="button" class="calc-tab${st.tab === id ? ' on' : ''}" data-tab="${id}" role="tab" aria-selected="${st.tab === id}">${label}</button>`;

    let body;
    if (st.tab === 'result') {
      body =
        (hasDec
          ? `<div class="calc-toggle"><button type="button" class="btn btn-glass btn-sm" data-dec>${st.dec ? '顯示精確值' : '顯示小數'}</button></div>`
          : '') + texEl(jobs, cur.tex);
    } else {
      body = `<ol class="calc-steps">${res.steps
        .map((s, i) => `<li><p class="calc-step-t"><b>步驟 ${i + 1}</b>${escapeHtml(s.title)}</p>${texEl(jobs, s.tex)}</li>`)
        .join('')}</ol>`;
    }

    out.innerHTML =
      `<p class="calc-meta"><span><b>模式</b>${escapeHtml(MODE_LABEL[res.mode] || res.mode)}</span><span><b>角度單位</b>${escapeHtml(ANGLE_LABEL[payload.angle] || payload.angle)}</span></p>` +
      `<div class="calc-io"><span class="calc-lab">輸入</span><pre class="calc-pre">${escapeHtml(payload.raw)}</pre></div>` +
      `<div class="calc-io"><span class="calc-lab">${outLabel}<button type="button" class="calc-link" data-copy>複製</button></span><pre class="calc-pre">${escapeHtml(cur.text)}</pre></div>` +
      `<div class="calc-tabs" role="tablist">${tabBtn('result', '計算結果')}${tabBtn('steps', `詳細步驟（${res.steps.length}）`)}</div>` +
      `<div class="calc-body">${body}</div>`;

    out.querySelector('[data-copy]').dataset.copy = cur.text;

    // 排版（KaTeX 載入失敗時，上面的純文字輸出仍然可用）
    let katex = null;
    try { katex = await loadKatex(); } catch { /* 退回純文字 */ }
    if (!alive || st.last !== L) return;
    out.querySelectorAll('[data-tex]').forEach((el) => {
      const tex = jobs[Number(el.dataset.tex)];
      if (!katex) { el.innerHTML = `<pre class="calc-pre">${escapeHtml(tex)}</pre>`; return; }
      try {
        katex.render(tex, el, { displayMode: true, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 2000 });
      } catch {
        el.innerHTML = `<pre class="calc-pre">${escapeHtml(tex)}</pre>`;
      }
    });
  }

  /* ── 函數清單 ── */
  const wide = window.matchMedia('(min-width: 961px)').matches;

  const insertName = (name) => {
    const m = /^([^\W\d]\w*)\(/u.exec(name);
    return m ? `${m[1]}(` : null;
  };

  function paintRef() {
    if (!ref) return;
    const q = refQ.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    st.openGroups ??= new Set(wide ? ref.groups.map((g) => g.id) : []);
    let shown = 0;
    refList.innerHTML = ref.groups
      .map((g, gi) => {
        const items = g.items.map((it, ii) => [it, ii]).filter(([it]) => !q.length || q.every((t) => it._hay.includes(t)));
        if (!items.length) return '';
        shown += items.length;
        const open = q.length ? true : st.openGroups.has(g.id);
        return (
          `<details class="ref-g" data-g="${escapeHtml(g.id)}"${open ? ' open' : ''}><summary><span>${escapeHtml(g.title)}</span><em>${items.length}</em></summary>` +
          (g.note ? `<p class="ref-note">${escapeHtml(g.note)}</p>` : '') +
          items
            .map(([it, ii]) => {
              const ins = insertName(it.name);
              return (
                `<div class="fn"><button type="button" class="fn-main" data-pick="${gi}.${ii}" title="帶入範例並計算">` +
                `<span class="fn-top"><span class="fn-name">${escapeHtml(it.name)}</span>` +
                (it.alias || []).map((a) => `<span class="fn-alias">${escapeHtml(a)}</span>`).join('') + '</span>' +
                `<span class="fn-desc">${escapeHtml(it.desc)}</span>` +
                `<span class="fn-ex"><span>${escapeHtml(it.ex)}</span>${it.out ? `<i>→</i><b>${escapeHtml(it.out)}</b>` : ''}</span></button>` +
                (ins ? `<button type="button" class="fn-ins" data-ins="${escapeHtml(ins)}" title="插入 ${escapeHtml(ins)}" aria-label="插入 ${escapeHtml(ins)}">＋</button>` : '') +
                '</div>'
              );
            })
            .join('') +
          '</details>'
        );
      })
      .join('');
    if (!shown) refList.innerHTML = '<p class="ref-empty">找不到符合的函數，請換個關鍵字。</p>';
    const total = ref.groups.reduce((n, g) => n + g.items.length, 0);
    $('#calc-ref-count').textContent = q.length ? `${shown} / ${total} 項` : `共 ${total} 項`;
  }

  /* ── 事件 ── */
  $('#calc-form').addEventListener('submit', (e) => { e.preventDefault(); compute(); });
  input.addEventListener('input', syncVars);

  $('#calc-clear').addEventListener('click', () => {
    input.value = varsInput.value = '';
    modeSel.value = '';
    angleSel.value = 'radian';
    syncVars();
    card.hidden = true;
    out.innerHTML = '';
    st.last = null;
    input.focus();
  });

  $('#calc-keys').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = KEYS[Number(b.dataset.k)];
    insertText(k.t, k.back || 0, k.sel || null);
  });

  engineEl.addEventListener('click', (e) => {
    if (e.target.id === 'calc-retry') { engine = null; bindEngine(); }
  });

  out.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; paintResult(); return; }
    if (e.target.closest('[data-dec]')) { st.dec = !st.dec; paintResult(); return; }
    const c = e.target.closest('[data-copy]');
    if (c) copyText(c.dataset.copy).then((ok) => toast(ok ? '已複製' : '複製失敗'));
  });

  refQ.addEventListener('input', paintRef);
  refList.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-g]');
    if (!d || refQ.value.trim()) return;
    d.open ? st.openGroups.add(d.dataset.g) : st.openGroups.delete(d.dataset.g);
  }, true);
  refList.addEventListener('click', (e) => {
    const ins = e.target.closest('[data-ins]');
    if (ins) { insertText(ins.dataset.ins); return; }
    const pick = e.target.closest('[data-pick]');
    if (!pick || !ref) return;
    const [gi, ii] = pick.dataset.pick.split('.').map(Number);
    const it = ref.groups[gi].items[ii];
    input.value = it.ex;
    modeSel.value = it.mode || '';
    angleSel.value = it.angle || 'radian';
    varsInput.value = it.vars || '';
    syncVars();
    compute({ fromRef: true });
  });

  /* ── 啟動 ── */
  bindEngine();
  loadKatex().catch(() => {}); // 先預載，第一次出結果時不用再等
  refList.innerHTML = '<p class="ref-empty">載入函數清單…</p>';
  loadRef()
    .then((d) => { if (alive) { ref = d; paintRef(); } })
    .catch((err) => { if (alive) refList.innerHTML = `<p class="ref-empty calc-bad">函數清單載入失敗：${escapeHtml(err.message)}</p>`; });

  return () => {
    alive = false;
    unsub?.();
    seq++;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { engine?.kill(); engine = null; }, IDLE_KILL_MS);
  };
}
