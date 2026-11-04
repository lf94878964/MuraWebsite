// 密碼產生器：crypto.getRandomValues + 拒絕取樣（無模偏差）。純前端，不儲存任何密碼。
import { copyText, toast, escapeHtml } from '../core/ui.js';

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789',
  sym: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIG = new Set('0Oo1lI|`\'"'.split(''));

/** 0 ≤ n < max 的安全隨機整數（拒絕取樣） */
function randInt(max) {
  const lim = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % max;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildPools(o) {
  const clean = (s) => [...new Set(s.split(''))].filter((c) => !(o.ambig && AMBIG.has(c)));
  const pools = [];
  if (o.upper) pools.push(clean(SETS.upper));
  if (o.lower) pools.push(clean(SETS.lower));
  if (o.digit) pools.push(clean(SETS.digit));
  if (o.sym) pools.push(clean(o.symset || SETS.sym));
  return pools.filter((p) => p.length);
}
function generate(o, pools = buildPools(o)) {
  const all = pools.flat();
  const out = [];
  if (o.each) for (const p of pools) out.push(p[randInt(p.length)]);
  while (out.length < o.len) out.push(all[randInt(all.length)]);
  return shuffle(out).slice(0, o.len).join('');
}

/** 強度：以字元池大小估算熵；並對重複／連續模式扣分 */
function strength(pw, poolSize) {
  if (!pw) return { bits: 0, level: 0 };
  let bits = pw.length * Math.log2(Math.max(2, poolSize));
  const uniq = new Set(pw).size;
  if (uniq < pw.length * 0.6) bits *= 0.85;
  if (/(.)\1{2,}/.test(pw)) bits -= 6;
  if (/(?:abc|bcd|cde|def|123|234|345|456|567|678|789|qwe|asd|zxc)/i.test(pw)) bits -= 6;
  bits = Math.max(0, bits);
  const level = bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 110 ? 3 : 4;
  return { bits, level };
}
const LEVELS = [
  ['非常弱', '#e5484d', 12],
  ['偏弱', '#f08a24', 32],
  ['普通', '#e5b800', 55],
  ['強', '#46a758', 78],
  ['非常強', '#18a058', 100],
];
function crackTime(bits) {
  // 假設攻擊者每秒 10^10 次猜測（離線、快速雜湊），平均需猜一半
  const sec = Math.pow(2, bits - 1) / 1e10;
  if (sec < 1) return '不到 1 秒';
  const u = [['年', 31557600], ['天', 86400], ['小時', 3600], ['分鐘', 60], ['秒', 1]];
  if (sec >= 31557600 * 1e9) return '遠超過數十億年';
  for (const [n, s] of u) if (sec >= s) {
    const v = sec / s;
    return `約 ${v >= 1e6 ? v.toExponential(1).replace('e+', '×10^') : Math.round(v).toLocaleString('zh-TW')} ${n}`;
  }
  return '—';
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const st = { pw: '', hidden: false };
  const range = $('#pw-range');
  const num = $('#pw-num');
  const errEl = $('#pw-err');
  const opt = () => ({
    len: Math.min(64, Math.max(8, Number(num.value) || 20)),
    upper: $('#pw-upper').checked,
    lower: $('#pw-lower').checked,
    digit: $('#pw-digit').checked,
    sym: $('#pw-sym').checked,
    ambig: $('#pw-ambig').checked,
    each: $('#pw-each').checked,
    symset: [...new Set($('#pw-symset').value.replace(/\s/g, ''))].join(''),
  });

  function colorize(pw) {
    return [...pw].map((c) => {
      const e = escapeHtml(c);
      if (/\d/.test(c)) return `<span class="d">${e}</span>`;
      if (/[^A-Za-z0-9]/.test(c)) return `<span class="s">${e}</span>`;
      return e;
    }).join('');
  }

  function paint() {
    const out = $('#pw-out');
    if (!st.pw) { out.textContent = ''; return; }
    if (st.hidden) out.textContent = '•'.repeat(st.pw.length);
    else out.innerHTML = colorize(st.pw);
    $('#pw-show').textContent = st.hidden ? '顯示' : '隱藏';
    $('#pw-show').setAttribute('aria-pressed', String(!st.hidden));
  }

  function paintMeter(o, pools) {
    const fill = $('#pw-fill');
    const bar = fill.parentElement;
    const size = new Set(pools.flat()).size;
    const { bits, level } = strength(st.pw, size);
    const [name, color, pct] = LEVELS[level];
    root.querySelector('.pw-meter').style.setProperty('--pw-c', color);
    fill.style.width = st.pw ? `${pct}%` : '0';
    bar.setAttribute('aria-valuenow', st.pw ? String(pct) : '0');
    $('#pw-level').textContent = st.pw ? name : '—';
    $('#pw-detail').textContent = st.pw ? `熵約 ${Math.round(bits)} bits　·　字元池 ${size}　·　暴力破解（每秒 100 億次）${crackTime(bits)}` : '';
  }

  function paintBatch(o, pools) {
    const rows = pools.length ? Array.from({ length: 5 }, () => generate(o, pools)) : [];
    $('#pw-batch').innerHTML = rows
      .map((p) => `<div class="tk-item"><span></span><code class="pw-code">${escapeHtml(p)}</code><button class="tk-copy" type="button" data-cp="${escapeHtml(p)}">複製</button></div>`)
      .join('');
  }

  function regen(batch = true) {
    const o = opt();
    const pools = buildPools(o);
    if (!pools.length) {
      errEl.textContent = '請至少勾選一種字元類型。';
      st.pw = '';
      paint();
      paintMeter(o, []);
      $('#pw-batch').innerHTML = '';
      return;
    }
    errEl.textContent = o.each && pools.length > o.len ? '長度小於類型數量。' : '';
    st.pw = generate(o, pools);
    paint();
    paintMeter(o, pools);
    if (batch) paintBatch(o, pools);
  }

  const flash = (btn) => {
    const old = btn.textContent;
    btn.textContent = '已複製';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1100);
  };
  async function copy(text, btn) {
    const ok = await copyText(text);
    if (btn?.classList.contains('tk-copy')) flash(btn);
    toast(ok ? '已複製密碼' : '複製失敗');
  }

  $('#pw-copy').addEventListener('click', () => st.pw && copy(st.pw));
  $('#pw-regen').addEventListener('click', () => regen(false));
  $('#pw-batch-regen').addEventListener('click', () => { const o = opt(); paintBatch(o, buildPools(o)); });
  $('#pw-show').addEventListener('click', () => { st.hidden = !st.hidden; paint(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cp]');
    if (b) copy(b.dataset.cp, b);
    const l = e.target.closest('[data-len]');
    if (l) { range.value = num.value = l.dataset.len; regen(); }
  });
  range.addEventListener('input', () => { num.value = range.value; regen(); });
  num.addEventListener('input', () => {
    const v = Number(num.value);
    if (v >= 8 && v <= 64) { range.value = v; regen(); }
  });
  num.addEventListener('change', () => {
    num.value = Math.min(64, Math.max(8, Number(num.value) || 20));
    range.value = num.value;
    regen();
  });
  root.querySelectorAll('.pw-opts input, .pw-adv input').forEach((el) => el.addEventListener('change', () => regen()));
  $('#pw-symset').addEventListener('input', () => regen());

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable], summary')) return;
    const k = e.key.toLowerCase();
    if (k === 'g') regen(false);
    else if (k === 'c' && st.pw) copy(st.pw);
  };
  document.addEventListener('keydown', onKey);

  regen();
  return () => document.removeEventListener('keydown', onKey);
}
