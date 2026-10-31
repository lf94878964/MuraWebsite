// 使用者評論輪轉。資料來自 Cloudflare Worker（Token 只存在 Worker，網站端看不到）。
// 名稱與頭像屬於外部輸入，一律用 textContent / DOM 方法建立，不使用 innerHTML。
import { REVIEWS_API } from '../config.js';

const MAX_CHARS = 50;
const MIN_ITEMS_PER_SET = 10;     // 每組至少幾張卡，確保寬螢幕也不會露出空白
const SECONDS_PER_CARD = 6;       // 控制輪轉速度
const AVATAR_OK = /^https:\/\/cdn\.discordapp\.com\//;

const clamp = (s) => Array.from(String(s ?? '').trim()).slice(0, MAX_CHARS).join('');

function buildCard(r) {
  const card = document.createElement('article');
  card.className = 'review-card';

  const initial = Array.from(r.name || '?')[0].toUpperCase();
  const avatar = AVATAR_OK.test(r.avatar || '') ? document.createElement('img') : document.createElement('div');
  if (avatar.tagName === 'IMG') {
    avatar.className = 'review-avatar';
    avatar.src = r.avatar;
    avatar.alt = '';
    avatar.width = 44;
    avatar.height = 44;
    avatar.loading = 'lazy';
    avatar.referrerPolicy = 'no-referrer';
    avatar.addEventListener('error', () => {
      const fb = document.createElement('div');
      fb.className = 'review-avatar review-avatar-fallback';
      fb.textContent = initial;
      avatar.replaceWith(fb);
    });
  } else {
    avatar.className = 'review-avatar review-avatar-fallback';
    avatar.textContent = initial;
  }

  const body = document.createElement('div');
  body.className = 'review-body';
  const name = document.createElement('p');
  name.className = 'review-name';
  name.textContent = r.name || '使用者';
  const text = document.createElement('p');
  text.className = 'review-text';
  text.textContent = clamp(r.comment);
  body.append(name, text);

  card.append(avatar, body);
  return card;
}

function buildSet(items, hidden) {
  const set = document.createElement('div');
  set.className = 'reviews-set';
  if (hidden) { set.setAttribute('aria-hidden', 'true'); set.dataset.clone = ''; }
  const count = Math.max(MIN_ITEMS_PER_SET, items.length);
  for (let i = 0; i < count; i++) set.appendChild(buildCard(items[i % items.length]));
  return set;
}

export function mountReviews(root) {
  const section = root.querySelector('#reviews');
  const track = root.querySelector('#reviews-track');
  if (!section || !track) return () => {};

  const ctrl = new AbortController();
  fetch(REVIEWS_API, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then((data) => {
      const items = (Array.isArray(data?.reviews) ? data.reviews : []).filter((r) => r && clamp(r.comment));
      if (!items.length) return; // 沒有評論就維持隱藏，不顯示空區塊
      const real = buildSet(items, false);
      track.replaceChildren(real, buildSet(items, true));
      track.style.setProperty('--dur', `${real.children.length * SECONDS_PER_CARD}s`);
      section.hidden = false;
    })
    .catch((err) => { if (err.name !== 'AbortError') console.warn('reviews unavailable:', err.message); });

  return () => ctrl.abort();
}
