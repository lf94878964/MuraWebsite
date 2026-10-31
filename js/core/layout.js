// 共用外殼：導覽列 + 頁尾。index.html 與 docs.html 都由這裡渲染，確保兩邊一致。
import { NAV, LOGO_URL, SITE_NAME, SUPPORT_URL, LEGAL, BORN_UTC } from '../config.js';
import { DISCORD_ICON, inviteButton, isModifiedClick } from './ui.js';
import { getTheme, toggleTheme } from './theme.js';

const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/></svg>';

function linkHTML(item, active, spa) {
  const isActive = item.key === active;
  return (
    `<a class="nav-link${isActive ? ' active' : ''}" href="${item.href || item.path}" data-key="${item.key}"` +
    `${spa && item.spa ? ' data-spa' : ''}${isActive ? ' aria-current="page"' : ''}>${item.label}</a>`
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function bornText() {
  const total = Math.max(0, Math.floor((Date.now() - BORN_UTC) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return `${d} 天 ${pad(h)} 時 ${pad(m)} 分 ${pad(s)} 秒`;
}

function footerHTML() {
  const startYear = 2025;
  const currentYear = new Date().getFullYear();
  const yearText = currentYear > startYear ? `${startYear}-${currentYear}` : `${startYear}`;
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-left">
        <a class="btn btn-glass btn-sm" href="${SUPPORT_URL}" target="_blank" rel="noopener">${DISCORD_ICON}前往 Discord 支援群</a>
        <div class="footer-born">
          <span class="mono-label">機器人已誕生</span>
          <span class="born-counter">${bornText()}</span>
        </div>
      </div>
      <div class="footer-center">
        <p class="footer-copy">©${yearText} 頑固苗獨分子</p>
      </div>
      <div class="footer-right">
        <p class="mono-label">法律條款</p>
        ${LEGAL.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`).join('')}
      </div>
    </div>
  </footer>`;
}

/**
 * @param {object} opts
 * @param {string|null} opts.active    目前所在頁面的 key
 * @param {boolean} [opts.footer=true] 是否渲染頁尾
 * @param {boolean} [opts.spa=false]   是否在目前頁面內攔截 SPA 路由連結
 * @param {(key:string)=>void} [opts.onNavigate] SPA 切頁回呼
 */
export function mountChrome({ active = null, footer = true, spa = false, onNavigate } = {}) {
  const navHost = document.getElementById('site-nav');
  const footHost = document.getElementById('site-footer');

  navHost.innerHTML = `
    <nav class="navbar" aria-label="主要導覽">
      <a class="nav-brand" href="${spa ? '/home' : '/'}" ${spa ? 'data-key="home" data-spa' : ''}>
        <img class="nav-logo" src="${LOGO_URL}" alt="" width="30" height="30" />
        <span>${SITE_NAME}</span>
      </a>
      <div class="nav-right">
        <div class="nav-links glass" role="list">${NAV.map((n) => linkHTML(n, active, spa)).join('')}</div>
        ${inviteButton('')}
        <button class="icon-btn glass" id="themeToggle" type="button" aria-label="切換深淺色主題"></button>
        <button class="icon-btn glass nav-burger" id="navBurger" type="button" aria-label="開啟選單" aria-expanded="false" aria-controls="mobileMenu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
    <div class="mobile-menu" id="mobileMenu">
      ${NAV.map((n) => linkHTML(n, active, spa)).join('')}
      ${inviteButton('lg')}
    </div>`;

  if (footHost) footHost.innerHTML = footer ? footerHTML() : '';

  // ---- 主題按鈕 ----
  const themeBtn = document.getElementById('themeToggle');
  const paintTheme = () => {
    themeBtn.innerHTML = getTheme() === 'dark' ? ICON_SUN : ICON_MOON;
  };
  paintTheme();
  themeBtn.addEventListener('click', toggleTheme);
  window.addEventListener('themechange', paintTheme);

  // ---- 手機選單 ----
  const burger = document.getElementById('navBurger');
  const menu = document.getElementById('mobileMenu');
  const setMenu = (open) => {
    menu.classList.toggle('open', open);
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);
  };
  burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !menu.contains(e.target) && !burger.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) setMenu(false);
  });

  // ---- SPA 連結 ----
  navHost.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.hasAttribute('data-spa') && onNavigate && !isModifiedClick(e)) {
      e.preventDefault();
      onNavigate(a.dataset.key);
    }
    if (a.classList.contains('nav-link') || a.classList.contains('nav-brand')) setMenu(false);
  });

  // ---- 頁尾計時器 ----
  if (footer && footHost) {
    setInterval(() => {
      const t = bornText();
      footHost.querySelectorAll('.born-counter').forEach((el) => (el.textContent = t));
    }, 1000);
  }

  return {
    setActive(key) {
      document.querySelectorAll('.nav-link').forEach((el) => {
        const on = el.dataset.key === key;
        el.classList.toggle('active', on);
        if (on) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      });
    },
  };
}
