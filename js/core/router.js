// 中控：負責 index.html 內所有頁面的載入、切換、網址與生命週期。
//
// 一個頁面 = pages/<name>.html（片段） + css/<name>.css + js/pages/<name>.js（選用）
// 頁面模組可匯出 mount(root, ctx)，並回傳清理函式（離開頁面時自動呼叫）。
import { ROUTES, SITE_NAME } from '../config.js';
import { inviteButton, isModifiedClick, escapeHtml } from './ui.js';

const textCache = new Map();
const cssLoaded = new Map();
let token = 0;
let cleanup = null;
let currentKey = null;
let onRouteChange = () => {};

const viewEl = () => document.getElementById('view');

export function keyFromLocation() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index.html') return 'home';
  return Object.keys(ROUTES).find((k) => ROUTES[k].path === p) || null;
}

async function fetchText(url) {
  if (textCache.has(url)) return textCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} (HTTP ${res.status})`);
  const text = await res.text();
  textCache.set(url, text);
  return text;
}

function loadCSS(href) {
  if (!href) return Promise.resolve();
  if (cssLoaded.has(href)) return cssLoaded.get(href);
  const p = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // 樣式失敗不應擋住頁面
    document.head.appendChild(link);
  });
  cssLoaded.set(href, p);
  return p;
}

function hydrate(root) {
  root.querySelectorAll('[data-invite]').forEach((el) => {
    el.outerHTML = inviteButton(el.dataset.invite || '');
  });
}

function setTitle(route) {
  document.title = route.title ? `${route.title} — ${SITE_NAME}` : SITE_NAME;
}

function renderError(root, err, key) {
  root.innerHTML = `
    <section class="page page-error">
      <div class="error-card">
        <p class="mono-label">LOAD ERROR</p>
        <h1>頁面載入失敗</h1>
        <p>${escapeHtml(err.message || String(err))}</p>
        <a class="btn btn-glass" href="${ROUTES[key].path}" data-route="${key}">重新載入</a>
      </div>
    </section>`;
}

/**
 * 切換頁面。
 * @param {string} key
 * @param {{push?: boolean, replace?: boolean, scroll?: boolean}} opts
 */
export async function go(key, { push = true, replace = false, scroll = true } = {}) {
  if (!ROUTES[key]) key = 'home';
  const route = ROUTES[key];
  const my = ++token;
  const root = viewEl();

  let html;
  let mod = null;
  let failure = null;
  try {
    [html, mod] = await Promise.all([
      fetchText(route.fragment),
      route.module ? import(route.module) : Promise.resolve(null),
      loadCSS(route.css),
    ]);
  } catch (err) {
    failure = err;
  }
  if (my !== token) return; // 已被更新的切換取代

  if (cleanup) {
    try { cleanup(); } catch (e) { console.error(e); }
    cleanup = null;
  }

  if (failure) {
    console.error(failure);
    renderError(root, failure, key);
  } else {
    root.innerHTML = html;
    hydrate(root);
    if (mod && typeof mod.mount === 'function') {
      const out = mod.mount(root, { go });
      if (typeof out === 'function') cleanup = out;
    }
  }

  currentKey = key;
  setTitle(route);
  if (push && key !== keyFromLocation()) history.pushState({ page: key }, '', route.path);
  else if (replace || push) history.replaceState({ page: key }, '', route.path);
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  onRouteChange(key);
}

export function start({ onRoute } = {}) {
  if (onRoute) onRouteChange = onRoute;
  const view = viewEl();

  // 頁面片段內的 [data-route] / [data-scroll] 由中控統一處理
  view.addEventListener('click', (e) => {
    const r = e.target.closest('[data-route]');
    if (r && !isModifiedClick(e)) {
      e.preventDefault();
      go(r.dataset.route);
      return;
    }
    const s = e.target.closest('[data-scroll]');
    if (s) {
      e.preventDefault();
      const target = view.querySelector(s.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  window.addEventListener('popstate', () => {
    go(keyFromLocation() || 'home', { push: false, scroll: false });
  });

  const initial = keyFromLocation();
  return go(initial || 'home', { push: false, replace: true, scroll: false });
}

export function current() {
  return currentKey;
}
