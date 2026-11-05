// 站點細節：滑鼠微光、捲動進度、區塊淡入、回到頂端、Ctrl+K 快速跳轉。
// 全部是「有就更好、沒有也完全可用」的漸進增強；偏好減少動態時，動畫類效果自動停用。
import { NAV, INVITE_URL, SUPPORT_URL } from '../config.js';
import { toggleTheme } from './theme.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

function loadCss() {
  if (document.querySelector('link[data-fx]')) return Promise.resolve();
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/css/fx.css?v=1'; l.dataset.fx = '';
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

/* 快速跳轉用的關鍵字（讓 pdf、qr、mp4 這類詞也找得到工具） */
const KEYWORDS = {
  home: '首頁 home 機器人 功能',
  rules: '使用規範 規則 rule',
  docs: '文檔 說明 指令 文件 docs help',
  status: '狀態 status 統計 伺服器',
  tools: '小工具 工具 tools',
  calculator: '數學 計算機 calculator 矩陣 積分 微分 極限',
  military: '兵役 體位 役男 bmi',
  wordcount: '字數 字元 統計 word count',
  convert: '檔案 轉換 轉檔 png jpg webp mp3 mp4 pdf 圖片 影片 音訊 合併',
  pdf: 'pdf 合併 拆分 旋轉 壓縮 編輯',
  timestamp: 'unix 時間戳 timestamp epoch discord 時間',
  qrcode: 'qr 二維碼 qrcode 產生 條碼',
  qrscan: 'qr 掃描 相機 二維碼 條碼 scan',
  password: '密碼 password 產生 隨機',
  uuid: 'uuid guid 產生',
  cooperate: '合作 夥伴 cooperate',
  contact: '聯絡 contact 客服',
};

function buildItems() {
  const items = [];
  for (const n of NAV) {
    items.push({ key: n.key, label: n.label, hint: n.children ? '頁面' : '頁面', path: n.path, spa: !!n.spa, kw: KEYWORDS[n.key] || '' });
    for (const c of n.children || []) items.push({ key: c.key, label: c.label, hint: '小工具', path: c.path, spa: !!c.spa, kw: KEYWORDS[c.key] || '', sub: true });
  }
  items.push({ label: '切換深色／淺色', hint: '動作', run: toggleTheme, kw: '主題 theme dark light 深色 淺色 夜間' });
  items.push({ label: '邀請機器人到我的伺服器', hint: '外部連結', href: INVITE_URL, kw: '邀請 invite 加入 機器人' });
  items.push({ label: '前往 Discord 支援群', hint: '外部連結', href: SUPPORT_URL, kw: '支援 discord support 客服 群' });
  return items;
}

export function initFx({ go } = {}) {
  let ready = loadCss();
  let io = null;
  let glowRaf = 0;

  /* ── 捲動進度 + 導覽列狀態 + 回到頂端 ── */
  const bar = document.createElement('div');
  bar.className = 'fx-progress'; bar.setAttribute('aria-hidden', 'true');
  const top = document.createElement('button');
  top.className = 'fx-top'; top.type = 'button'; top.setAttribute('aria-label', '回到頁面頂端');
  top.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' }));
  document.body.append(bar, top);

  let tick = 0;
  const onScroll = () => {
    if (tick) return;
    tick = requestAnimationFrame(() => {
      tick = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 120 ? Math.min(1, y / max) : 0})`;
      bar.classList.toggle('on', max > 120 && y > 12);
      top.classList.toggle('on', y > 900);
      document.querySelector('.navbar')?.classList.toggle('is-scrolled', y > 8);
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ── 卡片微光：跟著游標的一點光 ── */
  let spot = 0, spotEv = null;
  document.addEventListener('pointermove', (e) => {
    if (!finePointer.matches || e.pointerType !== 'mouse') return;
    spotEv = e;
    if (spot) return;
    spot = requestAnimationFrame(() => {
      spot = 0;
      const el = spotEv.target.closest?.('.tool-card, .fd-card, .live-panel');
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${spotEv.clientX - r.left}px`);
        el.style.setProperty('--my', `${spotEv.clientY - r.top}px`);
      }
      glow(spotEv);
    });
  }, { passive: true });

  /* ── 首頁光源：游標移動時輕微偏移（緩動追隨） ── */
  const g = { x: 0, y: 0, tx: 0, ty: 0 };
  function glow(e) {
    const page = document.querySelector('.page-home.fx-glow');
    if (!page || reduced.matches) return;
    g.tx = (e.clientX / innerWidth - 0.5) * 2;
    g.ty = (e.clientY / innerHeight - 0.5) * 2;
    if (glowRaf) return;
    const step = () => {
      g.x += (g.tx - g.x) * 0.08; g.y += (g.ty - g.y) * 0.08;
      page.style.setProperty('--gx', g.x.toFixed(3)); page.style.setProperty('--gy', g.y.toFixed(3));
      glowRaf = Math.abs(g.tx - g.x) + Math.abs(g.ty - g.y) > 0.003 ? requestAnimationFrame(step) : 0;
    };
    glowRaf = requestAnimationFrame(step);
  }

  /* ── 區塊淡入：只處理一開始在畫面外的卡片，首屏不重複播動畫 ── */
  function reveal(root) {
    io?.disconnect();
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        el.classList.add('in');
        setTimeout(() => { el.classList.remove('rv', 'in'); el.style.removeProperty('--rv-d'); }, 1000);
      }
    }, { threshold: 0.06, rootMargin: '0px 0px -4% 0px' });
    root.querySelectorAll('.fd-card, .tool-card, .tk-card, .review-card').forEach((el) => {
      if (el.closest('.reviews-track') || el.getBoundingClientRect().top < innerHeight * 0.92) return;
      const i = [...el.parentElement.children].indexOf(el);
      el.style.setProperty('--rv-d', `${(i % 6) * 55}ms`);
      el.classList.add('rv');
      io.observe(el);
    });
  }

  /* ── 快速跳轉（Ctrl/⌘ + K） ── */
  let pal = null;
  function openPalette() {
    if (pal) return;
    const items = buildItems();
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'pal';
    wrap.innerHTML = `
      <div class="pal-box" role="dialog" aria-modal="true" aria-label="快速跳轉">
        <input class="pal-in" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" placeholder="跳轉到頁面或小工具…（例如 pdf、qr、密碼）" autocomplete="off" spellcheck="false" />
        <ul class="pal-list" id="pal-list" role="listbox"></ul>
        <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 選擇</span><span><kbd>Enter</kbd> 前往</span><span><kbd>Esc</kbd> 關閉</span></div>
      </div>`;
    document.body.appendChild(wrap);
    document.documentElement.classList.add('pal-open');
    const input = wrap.querySelector('input');
    const list = wrap.querySelector('ul');
    let shown = [], idx = 0;

    const score = (it, terms) => {
      const hay = `${it.label} ${it.kw}`.toLowerCase();
      let s = 0;
      for (const t of terms) {
        const p = hay.indexOf(t);
        if (p < 0) return -1;
        s += p === 0 ? 3 : it.label.toLowerCase().includes(t) ? 2 : 1;
      }
      return s;
    };
    const render = () => {
      const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      shown = terms.length
        ? items.map((it) => [score(it, terms), it]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).map(([, it]) => it)
        : items;
      shown = shown.slice(0, 9);
      idx = Math.min(idx, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length
        ? shown.map((it, i) => `<li role="option" id="pal-o${i}" data-i="${i}" aria-selected="${i === idx}" class="${i === idx ? 'on' : ''}"><span>${it.label.replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c]))}</span><small>${it.hint}</small></li>`).join('')
        : '<li class="pal-none" role="presentation">沒有符合的項目</li>';
      input.setAttribute('aria-activedescendant', shown.length ? `pal-o${idx}` : '');
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    const close = () => {
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 120);
      pal = null;
      document.documentElement.classList.remove('pal-open');
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.({ preventScroll: true });
    };
    const choose = (it) => {
      if (!it) return;
      close();
      if (it.run) return it.run();
      if (it.href) return window.open(it.href, '_blank', 'noopener');
      if (it.spa && go) go(it.key); else location.href = it.path;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(1, shown.length); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + shown.length) % Math.max(1, shown.length); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(shown[idx]); }
      else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', () => { idx = 0; render(); });
    list.addEventListener('pointermove', (e) => { const li = e.target.closest('li[data-i]'); if (li && Number(li.dataset.i) !== idx) { idx = Number(li.dataset.i); render(); } });
    list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(shown[Number(li.dataset.i)]); });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    pal = { close };
    render();
    input.focus();
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      ready.then(() => (pal ? pal.close() : openPalette()));
    }
  });

  return {
    /** 每次切換頁面後呼叫 */
    refresh() {
      ready.then(() => {
        const view = document.getElementById('view');
        view.querySelector('.page-home')?.classList.add('fx-glow');
        reveal(view);
        onScroll();
      });
    },
  };
}
