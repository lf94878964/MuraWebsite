// ===== THEME TOGGLE =====
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const mobileMenu = document.getElementById('mobileMenu');

if (themeToggle) {
  const themeIcon = themeToggle.querySelector('.theme-icon');

  const savedTheme = localStorage.getItem('theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  });

  function updateThemeIcon(theme) {
    themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
}


// ===== URL ROUTING =====
// Map page keys to URL paths
const PAGE_PATHS = {
  home:      '/home',
  rules:     '/rule',
  cooperate: '/cooperate',
  status:    '/status',
  contact:   '/contact',
};
// Reverse map: path → page key
const PATH_PAGES = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([k, v]) => [v, k])
);

function getPageFromPath() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return PATH_PAGES[path] || 'home';
}

// ===== PAGE NAVIGATION =====
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

function navigateTo(target, pushState = true) {
  // Update nav buttons (both desktop and mobile)
  navBtns.forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-page') === target);
  });

  // Update pages
  pages.forEach(page => page.classList.remove('active'));
  const targetPage = document.getElementById('page-' + target);
  if (targetPage) {
    targetPage.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update URL
  if (pushState) {
    const newPath = PAGE_PATHS[target] || '/home';
    history.pushState({ page: target }, '', newPath);
  }

  // Load cooperate page on first visit
  if (target === 'cooperate') {
    loadCooperateCommunities();
  }

  // Load status page on first visit
  if (target === 'status') {
    fetchBotStats();
  }

  // Close mobile menu
  closeMobileMenu();
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-page');
    navigateTo(target, true);
  });
});

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page) ? e.state.page : getPageFromPath();
  navigateTo(page, false);
});





function openMobileMenu() {
  hamburgerBtn.classList.add('open');
  mobileMenu.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  hamburgerBtn.classList.remove('open');
  mobileMenu.classList.remove('open');
  document.body.style.overflow = '';
}

hamburgerBtn.addEventListener('click', () => {
  if (mobileMenu.classList.contains('open')) {
    closeMobileMenu();
  } else {
    openMobileMenu();
  }
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (
    mobileMenu.classList.contains('open') &&
    !mobileMenu.contains(e.target) &&
    !hamburgerBtn.contains(e.target)
  ) {
    closeMobileMenu();
  }
});

// ===== SCROLL TO FEATURES =====
function scrollToFeatures() {
  const detail = document.getElementById('features-detail');
  if (detail) {
    detail.scrollIntoView({ behavior: 'smooth' });
  }
}

// Feature cards scroll to detail
document.querySelectorAll('.feature-card').forEach(card => {
  card.addEventListener('click', () => {
    const detail = document.getElementById('features-detail');
    if (detail) {
      detail.scrollIntoView({ behavior: 'smooth' });
    }
  });
  card.style.cursor = 'pointer';
});

// ===== BORN COUNTER =====
// Bot birth time: 2025-06-02 09:50:13 UTC+8 → UTC (2025-06-02 01:50:13 UTC)
// Using Date.UTC() to avoid Safari ISO string parsing issues
const BORN_UTC = Date.UTC(2025, 5, 2, 1, 50, 13); // month is 0-indexed: 5 = June

function formatBornTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const sec  = totalSec % 60;
  const min  = Math.floor(totalSec / 60) % 60;
  const hr   = Math.floor(totalSec / 3600) % 24;
  const days = Math.floor(totalSec / 86400);

  const pad = n => String(n).padStart(2, '0');
  return `${days} 天 ${pad(hr)} 時 ${pad(min)} 分 ${pad(sec)} 秒`;
}


function updateBornCounters() {
  const elapsed = Date.now() - BORN_UTC;
  const text = formatBornTime(elapsed);
  document.querySelectorAll('[id^="bornCounter"]').forEach(el => {
    el.textContent = text;
  });
}

updateBornCounters();
setInterval(updateBornCounters, 1000);



let coopLoaded = false;

async function loadCooperateCommunities() {
  if (coopLoaded) return;

  const grid = document.getElementById('coop-grid');
  if (!grid) return;

  try {
    // 從 index.json 取得檔案編號清單
    const indexRes = await fetch('/cooperate/index.json');
    if (!indexRes.ok) throw new Error(`index.json error: ${indexRes.status}`);
    const fileNums = await indexRes.json();

    // 依順序載入每個 .txt
    const contents = await Promise.all(
      fileNums.map(async n => {
        const r = await fetch(`/cooperate/${n}.txt`);
        if (!r.ok) throw new Error(`${n}.txt error: ${r.status}`);
        return r.text();
      })
    );

    grid.innerHTML = '';
    contents.forEach(text => {
      const card = parseCoopFile(text);
      if (card) grid.appendChild(card);
    });

    coopLoaded = true;

  } catch (err) {
    console.error('Failed to load cooperate communities:', err);
    grid.innerHTML = '';
    const demoCard = parseCoopFile(DEMO_COOP_DATA);
    if (demoCard) grid.appendChild(demoCard);
    const note = document.createElement('p');
    note.style.cssText = 'text-align:center;color:var(--text-muted);font-size:0.82rem;margin-top:1rem;';
    note.textContent = '（載入失敗，顯示範例資料）';
    grid.appendChild(note);
    coopLoaded = true;
  }
}

// ===== DEMO DATA (from 1.txt) — used as fallback =====
const DEMO_COOP_DATA = `SERVER_ID：1409823952250998796
REPRESENT：852006773854306304
LINK：https://discord.gg/VDnT3Dyb5A
ICON：https://images-ext-1.discordapp.net/external/nkkDyfRAKOLe_Ir2A10Vjrcw1IfpV7dEVG5CHm_XcY8/%3Fsize%3D1024/https/cdn.discordapp.com/icons/1409823952250998796/e8b9bce131be2f7d977cf5417781ca9a.png?format=webp&quality=lossless&width=960&height=960

# DCTW
## 🏔️ 平台特色
- 🛠️ **穩定運行，不會再有長時間的下線**
  - 不會再有長時間的下線且無人維護，旨在維護您的使用體驗！

- 🌁 **介面美觀，唯一支持深淺色背景主題切換**
  - 網站不僅介面美觀，還支持 ⚫ 深色 / ⚪ 淺色 顏色主題切換！

- 🏕️ **教學完善，擁有最完整與完善的教學文檔**
  - 我們擁有最完善的教學文檔，讓您不必耗費極大的心力在研究使用方式上！

- 🔗 **網站連結：https://dctw.xyz/**
### 🔗 官方群組：https://discord.gg/VDnT3Dyb5A`;

/**
 * Parse a cooperate .txt file and return a DOM card element.
 */
function parseCoopFile(text) {
  const lines = text.split('\n');
  const meta = {};
  let contentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      contentStart = i + 1;
      break;
    }
    const m = line.match(/^([A-Z_]+)[：:](.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }

  const link = meta['LINK'] || '#';
  const icon = meta['ICON'] || '';
  const contentLines = lines.slice(contentStart);

  let title = '';
  const titleLine = contentLines.find(l => l.trim().startsWith('# '));
  if (titleLine) title = titleLine.replace(/^#+\s*/, '').trim();

  const bodyHtml = renderMarkdownLite(contentLines);

  const card = document.createElement('div');
  card.className = 'coop-card';

  if (icon) {
    const img = document.createElement('img');
    img.className = 'coop-avatar';
    img.alt = title || 'Server icon';
    img.loading = 'lazy';
    img.src = icon;
    img.onerror = () => {
      const fb = document.createElement('div');
      fb.className = 'coop-avatar-fallback';
      fb.textContent = '🏠';
      img.replaceWith(fb);
    };
    card.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.className = 'coop-avatar-fallback';
    fb.textContent = '🏠';
    card.appendChild(fb);
  }

  const body = document.createElement('div');
  body.className = 'coop-body';

  if (title) {
    const nameEl = document.createElement('div');
    nameEl.className = 'coop-name';
    nameEl.textContent = title;
    body.appendChild(nameEl);
  }

  const descEl = document.createElement('div');
  descEl.className = 'coop-desc';
  descEl.innerHTML = bodyHtml;
  body.appendChild(descEl);

  const actions = document.createElement('div');
  actions.className = 'coop-actions';

  const inviteBtn = document.createElement('a');
  inviteBtn.className = 'coop-invite-btn';
  inviteBtn.href = link;
  inviteBtn.target = '_blank';
  inviteBtn.rel = 'noopener';
  inviteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg> 加入伺服器`;
  actions.appendChild(inviteBtn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

/**
 * Very lightweight Markdown-to-HTML renderer for the coop content.
 */
function renderMarkdownLite(lines) {
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === '') {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
      continue;
    }

    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p><strong>${inline(line.slice(4))}</strong></p>`;
    } else if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p><strong style="font-size:0.95em;color:var(--text-primary)">${inline(line.slice(3))}</strong></p>`;
    } else if (line.startsWith('# ')) {
      // Skip — already used as title
    } else if (line.startsWith('- ')) {
      if (!inList) { html += '<ul style="padding-left:1.2rem;list-style:disc">'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(line)}</p>`;
    }
  }

  if (inList) html += '</ul>';
  return html;
}

function inline(text) {
  // Convert **bold**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Convert [text](url)
  text = text.replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
  // Convert bare https:// URLs
  text = text.replace(/(^|[\s])((https?:\/\/[^\s]+))/g, '$1<a href="$3" target="_blank" rel="noopener" style="color:var(--accent)">$3</a>');
  return text;
}






// ===== FIREBASE BOT STATS =====
const FIREBASE_URL = 'https://murasame-5c56a-default-rtdb.firebaseio.com/bot_stats.json';

// ---- Number formatting ----
// Thresholds: 京(1e16), 兆(1e12), 億(1e8), 萬(1e4)
// Abbreviate only when >= 10000; keep 1 decimal when it's meaningful
const CN_UNITS = [
  { value: 1e16, label: '京' },
  { value: 1e12, label: '兆' },
  { value: 1e8,  label: '億' },
  { value: 1e4,  label: '萬' },
];

function fmtCN(n) {
  if (n === undefined || n === null) return '—';
  n = Number(n);
  if (isNaN(n)) return '—';
  for (const { value, label } of CN_UNITS) {
    if (n >= value) {
      const divided = n / value;
      // Show 1 decimal place if it's not a whole number after dividing
      const formatted = Number.isInteger(divided) ? divided.toString() : divided.toFixed(1).replace(/\.0$/, '');
      return formatted + label;
    }
  }
  // Under 10000: plain number with locale formatting
  return n.toLocaleString('zh-TW');
}

function fmt(n) {
  if (n === undefined || n === null) return '—';
  return Number(n).toLocaleString('zh-TW');
}

// ---- Count-up animation ----
// IDs that should NOT be animated or abbreviated (system info rows + guilds)
const NO_ANIM_IDS = new Set([
  'sd-shard',
  'sd-restart',
  'sd-backup',
  'sd-backup-ver',
  'sd-ver',
]);

// IDs that should NOT use CN abbreviation (small numbers / non-numeric)
const NO_ABBR_IDS = new Set([
  'sd-guilds',
  'sd-command-count',
  'sd-shard',
  'sd-restart',
  'sd-backup',
  'sd-backup-ver',
  'sd-ver',
]);

// Active animation timers per element id
const _animTimers = {};

function animateCount(el, targetNum, useCN, duration = 1400) {
  if (!el) return;
  // Cancel any running animation on this element
  if (_animTimers[el.id]) {
    cancelAnimationFrame(_animTimers[el.id]);
    delete _animTimers[el.id];
  }

  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // easeOutCubic: fast → slow
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(targetNum * eased);

    el.textContent = useCN ? fmtCN(current) : current.toLocaleString('zh-TW');

    if (progress < 1) {
      _animTimers[el.id] = requestAnimationFrame(tick);
    } else {
      // Ensure final value is exact
      el.textContent = useCN ? fmtCN(targetNum) : targetNum.toLocaleString('zh-TW');
      delete _animTimers[el.id];
    }
  }

  _animTimers[el.id] = requestAnimationFrame(tick);
}

function setStatValue(id, rawValue, isNumeric) {
  const el = document.getElementById(id);
  if (!el) return;

  if (isNumeric && !NO_ANIM_IDS.has(id)) {
    const n = Number(rawValue);
    if (!isNaN(n)) {
      const useCN = !NO_ABBR_IDS.has(id);
      animateCount(el, n, useCN);
      return;
    }
  }
  // Non-numeric or excluded: just set directly
  el.textContent = rawValue;
}

function renderBotStats(data) {
  // === Home page mini stats (small cards, use CN abbreviation + animation) ===
  const gEl = document.getElementById('stat-guilds');
  const uEl = document.getElementById('stat-users');
  const cEl = document.getElementById('stat-commands');
  if (gEl) gEl.textContent = fmt(data.guilds);  // guilds: no abbr
  if (uEl && data.user_total != null) animateCount(uEl, Number(data.user_total), true);
  if (cEl && data.command    != null) animateCount(cEl, Number(data.command),    true);

  // === Status page ===
  const statusOnline = (data.status || '').toLowerCase() === 'online';
  const dot = document.getElementById('status-dot');
  const badge = document.getElementById('status-badge-text');
  if (dot) dot.className = 'status-dot ' + (statusOnline ? 'online' : 'offline');
  if (badge) badge.textContent = statusOnline ? '運行中' : (data.status || '未知');

  const lastUpEl = document.getElementById('status-last-update');
  if (lastUpEl && data.last_update) {
    const d = new Date(data.last_update * 1000);
    lastUpEl.textContent = '最後更新：' + d.toLocaleString('zh-TW', { hour12: false });
  }
  const verEl = document.getElementById('status-version');
  if (verEl) verEl.textContent = '版本：' + (data.version || '—');

  // Avatar & name
  const av = document.getElementById('sd-avatar');
  if (av) { av.src = data.bot_avatar || ''; av.style.display = data.bot_avatar ? '' : 'none'; }
  const nm = document.getElementById('sd-name');
  if (nm) nm.textContent = data.bot_name || '—';
  const idEl = document.getElementById('sd-id');
  if (idEl) idEl.textContent = data.bot_id ? String(data.bot_id) : '—';

  // Tiles & rows — numeric fields use animation + CN abbr where applicable
  const numericFields = {
    'sd-guilds':        data.guilds,
    'sd-user-total':    data.user_total,
    'sd-user-guild':    data.user_guild,
    'sd-user-install':  data.user_install,
    'sd-command':       data.command,
    'sd-command-count': data.command_count,
    'sd-restart':       data.restart,
    'sd-ban-users':     data.ban_users,
    'sd-ban-servers':   data.ban_servers,
    'sd-total-quotes':  data.total_quotes,
    'sd-yuzu-i':        data.yuzu_issued,
    'sd-yuzu-b':        data.yuzu_burned,
    'sd-yuzu-c':        data.yuzu_circulation,
    'sd-silly-i':       data.silly_issued,
    'sd-silly-b':       data.silly_burned,
    'sd-silly-c':       data.silly_circulation,
  };
  for (const [id, val] of Object.entries(numericFields)) {
    if (val != null) setStatValue(id, val, true);
    else { const el = document.getElementById(id); if (el) el.textContent = '—'; }
  }

  // Non-numeric / system info fields — set directly, no animation
  const plainFields = {
    'sd-backup':     data.backup     !== undefined ? fmt(data.backup) : '—',
    'sd-shard':      data.shard_info !== undefined ? String(data.shard_info) : '—',
    'sd-backup-ver': data.backup_version || '—',
    'sd-ver':        data.version || '—',
  };
  for (const [id, val] of Object.entries(plainFields)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  const loadEl = document.getElementById('status-loading');
  const errEl  = document.getElementById('status-error');
  const grid   = document.getElementById('status-grid');
  if (loadEl) loadEl.style.display = 'none';
  if (errEl)  errEl.style.display  = 'none';
  if (grid)   grid.style.display   = '';
}

async function fetchBotStats(manual = false) {
  try {
    const res = await fetch(FIREBASE_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderBotStats(data);
    if (manual) {
      const btn = document.getElementById('status-refresh-btn');
      if (btn) { btn.textContent = '✅ 已更新'; setTimeout(() => { btn.textContent = '🔄 手動更新'; }, 2000); }
    }
  } catch (err) {
    console.error('Firebase fetch failed:', err);
    const loadEl = document.getElementById('status-loading');
    const errEl  = document.getElementById('status-error');
    const msgEl  = document.getElementById('status-error-msg');
    if (loadEl) loadEl.style.display = 'none';
    if (errEl)  errEl.style.display  = 'flex';
    if (msgEl)  msgEl.textContent    = '無法取得資料：' + err.message;
  }
}

// Fetch on page load (populates home mini stats immediately)
fetchBotStats();
// Auto-refresh every 60s
setInterval(() => fetchBotStats(), 60000);

// On first load: navigate to the correct page based on URL path
(function initRoute() {
  const initPage = getPageFromPath();
  navigateTo(initPage, false);
  // Replace current history state so back button works correctly
  history.replaceState({ page: initPage }, '', PAGE_PATHS[initPage] || '/home');
})();