import { DISCORD_ICON, escapeHtml, stripEmoji } from '../core/ui.js';

// 載入失敗時的備援範例（來自 1.txt）
const DEMO = `SERVER_ID：1409823952250998796
REPRESENT：852006773854306304
LINK：https://discord.gg/VDnT3Dyb5A
ICON：https://images-ext-1.discordapp.net/external/nkkDyfRAKOLe_Ir2A10Vjrcw1IfpV7dEVG5CHm_XcY8/%3Fsize%3D1024/https/cdn.discordapp.com/icons/1409823952250998796/e8b9bce131be2f7d977cf5417781ca9a.png?format=webp&quality=lossless&width=960&height=960

# DCTW
## 平台特色
- **穩定運行，不會再有長時間的下線**
  - 不會再有長時間的下線且無人維護，旨在維護您的使用體驗！

- **介面美觀，唯一支持深淺色背景主題切換**
  - 網站不僅介面美觀，還支持 深色 / 淺色 顏色主題切換！

- **教學完善，擁有最完整與完善的教學文檔**
  - 我們擁有最完善的教學文檔，讓您不必耗費極大的心力在研究使用方式上！

- **網站連結：https://dctw.xyz/**
### 官方群組：https://discord.gg/VDnT3Dyb5A`;

let cachedTexts = null;

async function loadTexts() {
  if (cachedTexts) return cachedTexts;
  const idx = await fetch('/cooperate/index.json');
  if (!idx.ok) throw new Error(`index.json (HTTP ${idx.status})`);
  const nums = await idx.json();
  cachedTexts = await Promise.all(
    nums.map(async (n) => {
      const r = await fetch(`/cooperate/${n}.txt`);
      if (!r.ok) throw new Error(`${n}.txt (HTTP ${r.status})`);
      return r.text();
    })
  );
  return cachedTexts;
}

function safeUrl(u) {
  return /^https?:\/\//i.test(u) ? u : '';
}

function inline(raw) {
  let t = escapeHtml(raw.trim());
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (m, pre, url) => {
    if (/href="$/.test(pre)) return m;
    return `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
  });
  return t;
}

function renderBody(lines) {
  let html = '';
  let inList = false;
  const close = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    if (line.startsWith('# ')) continue; // 標題另外處理
    if (line.startsWith('### ')) { close(); html += `<p class="coop-h3">${inline(line.slice(4))}</p>`; }
    else if (line.startsWith('## ')) { close(); html += `<h3 class="coop-h2">${inline(line.slice(3))}</h3>`; }
    else if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
    } else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

function parseCard(rawText) {
  const text = stripEmoji(rawText).replace(/\r/g, '');
  const lines = text.split('\n');
  const meta = {};
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') { start = i + 1; break; }
    const m = line.match(/^([A-Z_]+)[：:](.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  const body = lines.slice(start);
  const titleLine = body.find((l) => l.trim().startsWith('# '));
  const title = titleLine ? titleLine.replace(/^#+\s*/, '').trim() : '';
  const link = safeUrl(meta.LINK || '');
  const icon = safeUrl(meta.ICON || '');
  const initial = escapeHtml((title || '?').slice(0, 1).toUpperCase());

  const card = document.createElement('article');
  card.className = 'coop-card';
  card.innerHTML = `
    ${icon
      ? `<img class="coop-avatar" src="${icon}" alt="" loading="lazy" width="64" height="64" />`
      : `<div class="coop-avatar coop-avatar-fallback">${initial}</div>`}
    <div class="coop-body">
      ${title ? `<h2 class="coop-name">${escapeHtml(title)}</h2>` : ''}
      <div class="coop-desc">${renderBody(body)}</div>
      ${link ? `<a class="btn btn-glass btn-sm" href="${link}" target="_blank" rel="noopener">${DISCORD_ICON}加入伺服器</a>` : ''}
    </div>`;
  const img = card.querySelector('img.coop-avatar');
  if (img) {
    img.addEventListener('error', () => {
      const fb = document.createElement('div');
      fb.className = 'coop-avatar coop-avatar-fallback';
      fb.textContent = (title || '?').slice(0, 1).toUpperCase();
      img.replaceWith(fb);
    });
  }
  return card;
}

export function mount(root) {
  const grid = root.querySelector('#coop-grid');
  let alive = true;

  loadTexts()
    .then((texts) => {
      if (!alive) return;
      grid.innerHTML = '';
      texts.forEach((t) => grid.appendChild(parseCard(t)));
    })
    .catch((err) => {
      console.error('cooperate load failed:', err);
      if (!alive) return;
      grid.innerHTML = '';
      grid.appendChild(parseCard(DEMO));
      const note = document.createElement('p');
      note.className = 'coop-note';
      note.textContent = '載入失敗，目前顯示範例資料';
      grid.appendChild(note);
    });

  return () => {
    alive = false;
  };
}
