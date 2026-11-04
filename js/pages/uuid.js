// UUID 產生器：版本與邏輯在 js/tools/uuid-lib.js（已用 RFC 範例向量驗證）。
import { copyText, toast, escapeHtml } from '../core/ui.js';
import * as U from '../tools/uuid-lib.js';

const VERS = [
  ['v4', 'v4 隨機', '122 位密碼學安全隨機。最通用、最常見的 UUID。'],
  ['v7', 'v7 時間排序', '前 48 位為 Unix 毫秒時間，之後隨機；同一毫秒內會遞增，批次產生時一定由小到大排序。'],
  ['v1', 'v1 時間', '依 RFC 9562：60 位時間戳（100 ns）+ clock seq + 節點。節點為隨機值（設 multicast 位），不會洩漏 MAC。'],
  ['v6', 'v6 重排時間', '與 v1 相同資訊，但時間欄位由高到低排列，字典序即時間序。'],
  ['v5', 'v5 命名空間（SHA-1）', '命名空間 + 名稱經 SHA-1 得出，結果固定可重現。'],
  ['v3', 'v3 命名空間（MD5）', '同 v5 但使用 MD5，只建議用於與舊系統相容。'],
  ['nil', 'Nil', '全 0：00000000-0000-0000-0000-000000000000。'],
  ['max', 'Max', '全 f：ffffffff-ffff-ffff-ffff-ffffffffffff。'],
];

const b64url = (u) => {
  const b = U.toBytes(u);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
function fmt(u, f, upper) {
  let s = u;
  if (f === 'nodash') s = u.replace(/-/g, '');
  else if (f === 'braces') s = `{${u}}`;
  else if (f === 'urn') s = `urn:uuid:${u}`;
  else if (f === 'b64') return b64url(u); // Base64 區分大小寫，不套用大寫
  return upper ? s.toUpperCase() : s;
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const st = { ver: 'v4', list: [] };

  $('#uu-ver').innerHTML = VERS.map(([k, n]) => `<button class="tk-chip${k === 'v4' ? ' on' : ''}" type="button" role="radio" aria-checked="${k === 'v4'}" data-v="${k}">${n}</button>`).join('');

  const named = () => st.ver === 'v3' || st.ver === 'v5';
  function selectVer(k) {
    st.ver = k;
    root.querySelectorAll('[data-v]').forEach((b) => {
      const on = b.dataset.v === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#uu-vdesc').textContent = VERS.find((v) => v[0] === k)[2];
    $('#uu-named').hidden = !named();
    $('#uu-count').disabled = k === 'nil' || k === 'max' || named();
    gen();
  }

  async function gen() {
    const err = $('#uu-err');
    err.textContent = '';
    let n = Math.floor(Number($('#uu-count').value));
    if (!(n >= 1)) n = 1;
    if (n > 1000) { n = 1000; $('#uu-count').value = 1000; }
    try {
      let raw = [];
      const k = st.ver;
      if (k === 'nil') raw = [U.NIL];
      else if (k === 'max') raw = [U.MAX];
      else if (named()) {
        const nsSel = $('#uu-ns').value;
        const ns = nsSel === 'custom' ? $('#uu-ns-custom').value.trim() : U.NAMESPACES[nsSel];
        if (!U.toBytes(ns)) throw new Error('自訂命名空間不是有效的 UUID。');
        const name = $('#uu-name').value;
        raw = [k === 'v5' ? await U.v5(ns, name) : U.v3(ns, name)];
      } else {
        const f = { v4: U.v4, v7: U.v7, v1: U.v1, v6: U.v6 }[k];
        raw = Array.from({ length: n }, () => f());
      }
      st.list = raw;
      paint();
    } catch (e) { err.textContent = e.message; st.list = []; paint(); }
  }

  const shown = () => st.list.map((u) => fmt(u, $('#uu-fmt').value, $('#uu-upper').checked));
  function paint() {
    $('#uu-upper').disabled = $('#uu-fmt').value === 'b64';
    $('#uu-out').innerHTML = shown().map((s) => `<button class="uu-row" type="button" title="點一下複製">${escapeHtml(s)}</button>`).join('');
  }

  const flash = (el) => { el.classList.add('done'); setTimeout(() => el.classList.remove('done'), 700); };
  async function copyAll() {
    const t = shown().join('\n');
    if (!t) return;
    toast((await copyText(t)) ? `已複製 ${st.list.length} 筆` : '複製失敗');
  }

  root.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-v]');
    if (v) return selectVer(v.dataset.v);
    const r = e.target.closest('.uu-row');
    if (r) { flash(r); toast((await copyText(r.textContent)) ? '已複製' : '複製失敗'); }
  });
  $('#uu-gen').addEventListener('click', gen);
  $('#uu-copyall').addEventListener('click', copyAll);
  $('#uu-dl').addEventListener('click', () => {
    const t = shown().join('\n');
    if (!t) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = `uuid-${st.ver}-${st.list.length}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#uu-fmt').addEventListener('change', paint);
  $('#uu-upper').addEventListener('change', paint);
  $('#uu-count').addEventListener('change', gen);
  $('#uu-ns').addEventListener('change', () => { $('#uu-ns-custom-wrap').hidden = $('#uu-ns').value !== 'custom'; gen(); });
  $('#uu-name').addEventListener('input', gen);
  $('#uu-ns-custom').addEventListener('input', gen);

  /* 解析 */
  $('#uu-in').addEventListener('input', () => {
    const v = $('#uu-in').value.trim();
    const info = $('#uu-info');
    const err = $('#uu-in-err');
    if (!v) { info.hidden = true; err.textContent = ''; return; }
    const p = U.parse(v);
    if (!p) { info.hidden = true; err.textContent = '不是有效的 UUID（需要 32 位十六進位）。'; return; }
    err.textContent = '';
    const rows = [['標準格式', p.canonical], ['版本', p.special ? p.variant : p.version === null ? '—' : `v${p.version}（${U.VERSION_NAMES[p.version] || '未知'}）`], ['變體', p.variant]];
    if (p.time) rows.push(['內含時間', `${p.time.toISOString()}（本機 ${p.time.toLocaleString('zh-TW', { hour12: false })}）`]);
    else if (!p.special) rows.push(['內含時間', '此版本不含時間資訊']);
    rows.push(['32 位十六進位', p.hex], ['Base64（URL 安全）', b64url(p.canonical)]);
    info.hidden = false;
    info.innerHTML = rows.map(([k, x]) => `<div class="tk-item"><span>${k}</span><code>${escapeHtml(x)}</code><button class="tk-copy" type="button" data-cp="${escapeHtml(x)}">複製</button></div>`).join('');
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cp]');
    if (!b) return;
    const ok = await copyText(b.dataset.cp);
    toast(ok ? '已複製' : '複製失敗');
  });

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'g') gen();
    else if (k === 'c') copyAll();
  };
  document.addEventListener('keydown', onKey);

  selectVer('v4');
  return () => document.removeEventListener('keydown', onKey);
}
