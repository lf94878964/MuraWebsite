// 小工具總覽：即時搜尋（名稱、說明、關鍵字；多個詞以空白分隔、需全部符合）。
export function mount(root) {
  const q = root.querySelector('#tool-q');
  const cards = [...root.querySelectorAll('.tool-card')];
  const count = root.querySelector('#tool-count');
  const empty = root.querySelector('#tool-empty');
  const text = new Map(cards.map((c) => [c, (c.textContent + ' ' + (c.dataset.kw || '')).toLowerCase().replace(/\s+/g, ' ')]));

  function filter() {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const c of cards) {
      const ok = terms.every((t) => text.get(c).includes(t));
      c.hidden = !ok;
      if (ok) n++;
    }
    empty.hidden = n > 0;
    count.textContent = terms.length ? `${n} / ${cards.length}` : '';
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = cards.find((c) => !c.hidden); if (first) first.click(); }
    else if (e.key === 'Escape' && q.value) { q.value = ''; filter(); }
  });
  const onKey = (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); q.focus(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
