// 文檔頁中控：目錄(manifest)、路由、側欄、章節目錄、錨點跳轉
import { mountChrome } from '../core/layout.js';
import { SITE_NAME } from '../config.js';
import { toast, escapeHtml, copyText } from '../core/ui.js';
import { renderMarkdown } from './markdown.js';

const $ = (s, r = document) => r.querySelector(s);
const content = $('#docContent');
const navEl = $('#docsNav');
const tocList = $('#docsTocList');
const sidebar = $('#docsSidebar');
const scrim = $('#docsScrim');
const fab = $('#docsFab');
const search = $('#docsSearch');
const progress = $('#docsProgress');

const NAV_OFFSET = 64 + 24; // 導覽列高度 + 呼吸空間，要與 CSS 的 scroll-margin-top 一致

let sections = [];
let flat = [];
let currentId = null;
let headings = []; // [{id, text, level, el}]
let activeHeading = null;
let query = '';
let navToken = 0;
const collapsed = new Set();

/* ───────────── URL ───────────── */

const encPath = (id) => id.split('/').map(encodeURIComponent).join('/');
const docUrl = (id) => (id === 'home' ? '/docs' : `/docs/${encPath(id)}`);
const hashPart = (h) => (h ? `#${encodeURIComponent(h)}` : '');

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 從網址（或 404.html 暫存的路徑）解析出 {id, hash} */
function parseLocation(raw) {
  const u = new URL(raw || location.href, location.origin);
  const rest = u.pathname.replace(/^\/docs(?:\.html)?\/?/, '').replace(/\/+$/, '');
  const dec = rest.split('/').map(safeDecode).join('/');
  const id = dec && flat.some((d) => d.id === dec) ? dec : 'home';
  return { id, hash: safeDecode(u.hash.replace(/^#/, '')) };
}

/* ───────────── 側欄 ───────────── */

const pad2 = (n) => String(n + 1).padStart(2, '0');

function hl(title, q) {
  if (!q) return escapeHtml(title);
  const i = title.toLowerCase().indexOf(q);
  if (i < 0) return escapeHtml(title);
  return (
    escapeHtml(title.slice(0, i)) +
    `<mark>${escapeHtml(title.slice(i, i + q.length))}</mark>` +
    escapeHtml(title.slice(i + q.length))
  );
}

function buildNav() {
  const q = query.trim().toLowerCase();
  let html = '';
  sections.forEach((sec, si) => {
    const secHit = q && sec.title.toLowerCase().includes(q);
    const items = (sec.children || []).filter((c) => !q || secHit || c.title.toLowerCase().includes(q));
    if (!items.length) return;
    const isCollapsed = !q && collapsed.has(si);
    html += `
      <div class="nav-group${isCollapsed ? ' collapsed' : ''}">
        <button class="nav-group-head" type="button" data-toggle="${si}" aria-expanded="${!isCollapsed}">
          <span class="nav-idx">${pad2(si)}</span>
          <span class="nav-group-title">${escapeHtml(sec.title)}</span>
          <span class="nav-count">${items.length}</span>
          <i class="chev" aria-hidden="true"></i>
        </button>
        <div class="nav-group-items"><div>
          ${items
            .map(
              (c) =>
                `<a class="nav-item${c.id === currentId ? ' active' : ''}" href="${docUrl(c.id)}" data-doc="${escapeHtml(c.id)}"${
                  c.id === currentId ? ' aria-current="page"' : ''
                }>${hl(c.title, secHit ? '' : q)}</a>`
            )
            .join('')}
        </div></div>
      </div>`;
  });
  navEl.innerHTML =
    `<a class="nav-home${currentId === 'home' ? ' active' : ''}" href="/docs" data-doc="home">文檔首頁</a>` +
    (html || '<p class="nav-empty">沒有符合的文檔</p>');
}

function revealActiveInNav() {
  const el = $('.nav-item.active', navEl);
  if (!el) return;
  const top = el.offsetTop - navEl.clientHeight / 2 + el.clientHeight / 2;
  navEl.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

function setDrawer(open) {
  sidebar.classList.toggle('open', open);
  scrim.classList.toggle('show', open);
  fab.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open);
}

/* ───────────── 章節目錄 / 捲動偵測 ───────────── */

function setToc(list) {
  headings = list;
  activeHeading = null;
  const panel = $('#docsToc');
  if (!list.length) {
    tocList.innerHTML = '';
    panel.classList.add('empty');
    return;
  }
  panel.classList.remove('empty');
  tocList.innerHTML = list
    .map(
      (h) =>
        `<li class="lv${h.level}"><a href="#${encodeURIComponent(h.id)}" data-toc="${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`
    )
    .join('');
  const inline = $('.toc-inline-list');
  if (inline) inline.innerHTML = tocList.innerHTML;
}

function setActiveHeading(id) {
  if (id === activeHeading) return;
  activeHeading = id;
  document.querySelectorAll('[data-toc]').forEach((a) => {
    const on = a.dataset.toc === id;
    a.classList.toggle('active', on);
    if (on && a.closest('#docsToc')) {
      const box = $('#docsToc');
      const r = a.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.top < b.top + 40 || r.bottom > b.bottom - 40) box.scrollTop += r.top - b.top - b.height / 2;
    }
  });
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;

    if (!headings.length) return;
    let active = null;
    for (const h of headings) {
      if (h.el.getBoundingClientRect().top <= NAV_OFFSET + 4) active = h.id;
      else break;
    }
    if (max > 0 && window.scrollY >= max - 4) active = headings[headings.length - 1].id;
    setActiveHeading(active);
  });
}

function scrollToHeading(id, { smooth = true } = {}) {
  const el = content.querySelector(`.doc-body [id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });
  return true;
}

/** 點擊章節連結 / 目錄：平滑捲動 + 更新網址 hash（不新增歷史紀錄）+ 可選複製連結 */
async function jumpToHeading(id, { copy = false } = {}) {
  if (!scrollToHeading(id)) return;
  history.replaceState({ docId: currentId }, '', docUrl(currentId) + hashPart(id));
  setActiveHeading(id);
  if (copy) {
    const ok = await copyText(location.origin + docUrl(currentId) + hashPart(id));
    toast(ok ? '已複製章節連結' : '無法複製，請手動複製網址');
  }
}

/* ───────────── 渲染 ───────────── */

function renderHome() {
  currentId = 'home';
  document.title = `文檔說明 — ${SITE_NAME}`;
  content.innerHTML = `
    <header class="docs-hero">
      <p class="mono-label">DOCUMENTATION</p>
      <h1>文檔說明</h1>
      <p>指令、功能與規則的完整說明。從左側選擇分類，或直接搜尋。</p>
      <button class="docs-hero-search glass" type="button" data-focus-search>
        <span>搜尋文檔</span><kbd>/</kbd>
      </button>
    </header>
    <div class="docs-cards">
      ${sections
        .map(
          (sec, si) => `
        <section class="docs-card">
          <header><span class="nav-idx">${pad2(si)}</span><h2>${escapeHtml(sec.title)}</h2><span class="nav-count">${(sec.children || []).length} 篇</span></header>
          <ul>${(sec.children || [])
            .map((c) => `<li><a href="${docUrl(c.id)}" data-doc="${escapeHtml(c.id)}">${escapeHtml(c.title)}</a></li>`)
            .join('')}</ul>
        </section>`
        )
        .join('')}
    </div>`;
  setToc([]);
}

function loadingState() {
  content.innerHTML = '<div class="doc-state"><div class="spinner"></div><p>載入中…</p></div>';
}

function errorState(doc, err) {
  content.innerHTML = `
    <div class="doc-state error">
      <p class="mono-label">NOT FOUND</p>
      <h2>找不到這份文檔</h2>
      <p>無法讀取 <code>${escapeHtml(doc.file)}</code>（${escapeHtml(err.message)}）</p>
      <a class="btn btn-glass btn-sm" href="/docs" data-doc="home">回到文檔首頁</a>
    </div>`;
  setToc([]);
}

const chevL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const chevR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

async function renderDoc(id) {
  const doc = flat.find((d) => d.id === id);
  if (!doc) return renderHome();
  const my = ++navToken;
  currentId = id;
  loadingState();

  let md;
  try {
    const path = '/' + doc.file.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    md = await res.text();
  } catch (err) {
    if (my !== navToken) return;
    errorState(doc, err);
    return;
  }
  if (my !== navToken) return;

  let html;
  try {
    html = renderMarkdown(md);
  } catch (err) {
    errorState(doc, err);
    return;
  }

  const i = flat.findIndex((d) => d.id === id);
  const prev = flat[i - 1];
  const next = flat[i + 1];
  const link = (d) => `href="${docUrl(d.id)}" data-doc="${escapeHtml(d.id)}"`;

  content.innerHTML = `
    <div class="doc-meta">
      <nav class="doc-crumb" aria-label="目前位置">
        <a href="/docs" data-doc="home">文檔</a><span>/</span>
        <span>${escapeHtml(doc.section)}</span><span>/</span><b>${escapeHtml(doc.title)}</b>
      </nav>
      <div class="doc-steps">
        ${prev ? `<a class="icon-btn glass" ${link(prev)} aria-label="上一篇：${escapeHtml(prev.title)}" title="${escapeHtml(prev.title)}">${chevL}</a>` : ''}
        ${next ? `<a class="icon-btn glass" ${link(next)} aria-label="下一篇：${escapeHtml(next.title)}" title="${escapeHtml(next.title)}">${chevR}</a>` : ''}
      </div>
    </div>
    <details class="toc-inline"><summary>本頁目錄</summary><ul class="toc-inline-list"></ul></details>
    <article class="doc-body">${html}</article>
    <nav class="doc-pager" aria-label="上一篇與下一篇">
      ${prev ? `<a class="pager-card" ${link(prev)}><span class="mono-label">上一篇</span><b>${escapeHtml(prev.title)}</b></a>` : '<span></span>'}
      ${next ? `<a class="pager-card next" ${link(next)}><span class="mono-label">下一篇</span><b>${escapeHtml(next.title)}</b></a>` : '<span></span>'}
    </nav>`;

  document.title = `${doc.title} — 文檔說明 — ${SITE_NAME}`;
  content.querySelectorAll('.doc-body img').forEach((img) => (img.loading = 'lazy'));

  const list = [...content.querySelectorAll('.doc-body h2, .doc-body h3, .doc-body h4')].map((el) => ({
    id: el.id,
    level: Number(el.tagName[1]),
    text: el.textContent.trim(),
    el,
  }));
  setToc(list);
  if (!list.length) $('.toc-inline')?.remove();
}

/** 導覽到某份文檔。mode: push | replace | none（popstate 時不動歷史） */
async function navigate(id, { hash = '', mode = 'push' } = {}) {
  if (mode !== 'none') {
    const url = docUrl(id) + hashPart(hash);
    history[mode === 'replace' ? 'replaceState' : 'pushState']({ docId: id }, '', url);
  }
  setDrawer(false);
  if (id === 'home') renderHome();
  else await renderDoc(id);
  buildNav();
  revealActiveInNav();

  if (hash && scrollToHeading(hash, { smooth: false })) setActiveHeading(hash);
  else window.scrollTo({ top: 0, behavior: 'instant' });
  onScroll();
}

/* ───────────── 事件 ───────────── */

const isModified = (e) => e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

document.addEventListener('click', async (e) => {
  if (isModified(e)) return;
  const t = e.target;

  const copyBtn = t.closest('.codeblock-copy');
  if (copyBtn) {
    const code = copyBtn.closest('.codeblock').querySelector('pre').textContent;
    const ok = await copyText(code);
    copyBtn.textContent = ok ? '已複製' : '失敗';
    copyBtn.classList.toggle('done', ok);
    setTimeout(() => {
      copyBtn.textContent = '複製';
      copyBtn.classList.remove('done');
    }, 1500);
    return;
  }

  const toggle = t.closest('[data-toggle]');
  if (toggle) {
    const si = Number(toggle.dataset.toggle);
    if (collapsed.has(si)) collapsed.delete(si);
    else collapsed.add(si);
    const group = toggle.closest('.nav-group');
    group.classList.toggle('collapsed', collapsed.has(si));
    toggle.setAttribute('aria-expanded', String(!collapsed.has(si)));
    return;
  }

  const docLink = t.closest('a[data-doc]');
  if (docLink) {
    e.preventDefault();
    const id = docLink.dataset.doc;
    if (id === currentId) {
      setDrawer(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else navigate(id);
    return;
  }

  // 文檔內指向其他文檔的站內連結（/docs/...）
  const internal = t.closest('.doc-body a[href^="/docs"]');
  if (internal) {
    const { id, hash } = parseLocation(internal.getAttribute('href'));
    if (id !== 'home' || internal.getAttribute('href').replace(/\/+$/, '') === '/docs') {
      e.preventDefault();
      navigate(id, { hash });
      return;
    }
  }

  // 章節錨點 / 目錄 / 文內 #連結：永遠不離開目前文檔
  const anchor = t.closest('.doc-body a[href^="#"], #docsToc a[href^="#"], .toc-inline a[href^="#"]');
  if (anchor) {
    e.preventDefault();
    const id = safeDecode(anchor.getAttribute('href').slice(1));
    await jumpToHeading(id, { copy: anchor.classList.contains('hanchor') });
    if (anchor.closest('.toc-inline')) anchor.closest('details').open = false;
    return;
  }

  if (t.closest('[data-focus-search]')) {
    e.preventDefault();
    if (window.innerWidth <= 820) setDrawer(true);
    search.focus();
  }
});

// 瀏覽器上一頁 / 下一頁（含手動修改網址 hash）：一律以網址為準，不依賴 history.state
window.addEventListener('popstate', () => {
  const { id, hash } = parseLocation();
  if (id === currentId) {
    if (hash) scrollToHeading(hash, { smooth: false });
  } else navigate(id, { hash, mode: 'none' });
});

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);

search.addEventListener('input', () => {
  query = search.value;
  buildNav();
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    search.value = '';
    query = '';
    buildNav();
    search.blur();
  } else if (e.key === 'Enter') {
    const first = $('.nav-item', navEl);
    if (first) first.click();
  }
});
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    if (window.innerWidth <= 820) setDrawer(true);
    search.focus();
    search.select();
  } else if (e.key === 'Escape' && sidebar.classList.contains('open')) setDrawer(false);
});

fab.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
scrim.addEventListener('click', () => setDrawer(false));

/* ───────────── 啟動 ───────────── */

async function main() {
  mountChrome({ active: 'docs', footer: false });
  navEl.innerHTML = '<p class="nav-empty">載入中…</p>';
  loadingState();

  try {
    const res = await fetch('/doc-manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    sections = manifest.sections || [];
  } catch {
    navEl.innerHTML = '<p class="nav-empty">找不到 doc-manifest.json</p>';
    content.innerHTML = `
      <div class="doc-state error">
        <p class="mono-label">NO MANIFEST</p>
        <h2>尚未產生文檔目錄</h2>
        <p>請在根目錄執行：</p>
        <pre class="inline-pre"><code>node generate-manifest.js</code></pre>
      </div>`;
    return;
  }

  flat = sections.flatMap((sec) =>
    (sec.children || []).map((c) => ({ ...c, section: sec.title }))
  );

  // 404.html 會把原始路徑（含 hash）暫存起來
  let redirect = null;
  try {
    redirect = sessionStorage.getItem('__docs_redirect__');
    sessionStorage.removeItem('__docs_redirect__');
  } catch { /* ignore */ }

  const { id, hash } = parseLocation(redirect || location.href);
  await navigate(id, { hash, mode: 'replace' });
}

main();
