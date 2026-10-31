const root = document.documentElement;

export function getTheme() {
  return root.getAttribute('data-theme') || 'dark';
}

export function setTheme(theme) {
  root.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch { /* 隱私模式 */ }
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
