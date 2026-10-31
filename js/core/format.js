// 數字格式化與計數動畫

const CN_UNITS = [
  [1e16, '京'],
  [1e12, '兆'],
  [1e8, '億'],
  [1e4, '萬'],
];

/** >= 1 萬時使用中文單位縮寫，並保留有意義的一位小數 */
export function fmtCN(n) {
  if (n === undefined || n === null) return '—';
  n = Number(n);
  if (Number.isNaN(n)) return '—';
  for (const [value, label] of CN_UNITS) {
    if (n >= value) {
      const d = n / value;
      return (Number.isInteger(d) ? String(d) : d.toFixed(1).replace(/\.0$/, '')) + label;
    }
  }
  return n.toLocaleString('zh-TW');
}

export function fmt(n) {
  if (n === undefined || n === null) return '—';
  return Number(n).toLocaleString('zh-TW');
}

const frames = new WeakMap();
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 從元素目前顯示的值動畫到 target（重新整理資料時不會每次都從 0 開始跳）。
 * @param {{cn?: boolean, duration?: number}} opts cn: 是否使用中文單位縮寫
 */
export function animateTo(el, target, { cn = true, duration = 1200 } = {}) {
  if (!el) return;
  const to = Number(target);
  if (Number.isNaN(to)) { el.textContent = String(target); return; }

  const write = (v) => {
    el.dataset.v = String(v);
    el.textContent = cn ? fmtCN(v) : v.toLocaleString('zh-TW');
  };

  if (frames.has(el)) cancelAnimationFrame(frames.get(el));
  const from = Number(el.dataset.v || 0);
  if (from === to || reduceMotion()) { write(to); return; }

  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    write(p < 1 ? Math.round(from + (to - from) * eased) : to);
    if (p < 1) frames.set(el, requestAnimationFrame(tick));
    else frames.delete(el);
  };
  frames.set(el, requestAnimationFrame(tick));
}
