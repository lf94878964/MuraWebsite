// 訪客計數器：每個瀏覽分頁工作階段只送一次 POST /hit（伺服器端再依 IP 每日去重），
// 其餘情況只讀取目前數字。失敗時回傳 null，頁尾顯示「—」，不影響網站運作。
import { VISITS_API } from '../config.js';

let pending = null;

async function call(path, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(VISITS_API + path, { method, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Number.isFinite(data.count) ? data.count : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 取得（必要時順便登記）訪客數。同一頁面多次呼叫只會發一次請求。 */
export function loadVisits() {
  if (pending) return pending;
  let counted = false;
  try {
    counted = sessionStorage.getItem('visit_hit') === '1';
  } catch {}
  pending = call(counted ? '/visits' : '/hit', counted ? 'GET' : 'POST').then((n) => {
    if (n != null && !counted) {
      try {
        sessionStorage.setItem('visit_hit', '1');
      } catch {}
    }
    return n;
  });
  return pending;
}

export const formatVisits = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
