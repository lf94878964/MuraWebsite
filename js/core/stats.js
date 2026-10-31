// 機器人即時數據：單一資料源 + 訂閱制。只有在有頁面訂閱時才會輪詢。
import { FIREBASE_URL } from '../config.js';

const POLL_MS = 60_000;
const subs = new Set();
let latest = null;
let lastError = null;
let timer = 0;

function emit() {
  subs.forEach((fn) => fn(latest, lastError));
}

export async function refresh() {
  try {
    const res = await fetch(`${FIREBASE_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = await res.json();
    lastError = null;
  } catch (err) {
    console.error('bot_stats fetch failed:', err);
    lastError = err;
  }
  emit();
  return { data: latest, error: lastError };
}

/** 訂閱數據更新；回傳取消訂閱函式。 */
export function subscribe(fn) {
  subs.add(fn);
  if (latest || lastError) fn(latest, lastError);
  if (!timer) {
    refresh();
    timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
  } else if (!latest && !lastError) {
    // 已有請求進行中，等它回來
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
}
