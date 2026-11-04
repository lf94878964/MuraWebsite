// UUID 產生與解析（RFC 9562，取代 RFC 4122）。純函式，無 DOM；方便單獨測試。
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export function format(b16) {
  const h = hex(b16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function setVV(b, ver) { b[6] = (b[6] & 0x0f) | (ver << 4); b[8] = (b[8] & 0x3f) | 0x80; return b; }

export const v4 = () => format(setVV(rnd(16), 4));

/* v7：48 位 Unix 毫秒 + 12 位計數 + 62 位隨機。同一毫秒內遞增計數，確保批次產生時依序排列。 */
let last7 = { ms: -1, seq: 0 };
export function v7(now = Date.now()) {
  let ms = Math.max(now, last7.ms);
  let seq;
  if (ms === last7.ms) {
    seq = last7.seq + 1;
    if (seq > 0xfff) { ms += 1; seq = crypto.getRandomValues(new Uint16Array(1))[0] & 0x1ff; }
  } else seq = crypto.getRandomValues(new Uint16Array(1))[0] & 0x1ff; // 起始值留空間給遞增
  last7 = { ms, seq };
  const b = rnd(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80;
  return format(b);
}

/* v1 / v6：60 位時間戳（1582-10-15 起算，單位 100ns）+ 14 位 clock seq + 48 位節點（隨機，並設 multicast 位） */
const GREG_OFFSET_MS = 12219292800000n;
let last1 = 0n;
const clockSeq = crypto.getRandomValues(new Uint16Array(1))[0] & 0x3fff;
const node = (() => { const n = rnd(6); n[0] |= 1; return n; })();
function ts100ns(now = Date.now()) {
  let t = (BigInt(now) + GREG_OFFSET_MS) * 10000n;
  if (t <= last1) t = last1 + 1n;
  last1 = t;
  return t;
}
function tail(b) { b[8] = 0x80 | (clockSeq >> 8); b[9] = clockSeq & 0xff; b.set(node, 10); }
export function v1(now) {
  const t = ts100ns(now);
  const b = new Uint8Array(16);
  const low = t & 0xffffffffn, mid = (t >> 32n) & 0xffffn, high = (t >> 48n) & 0x0fffn;
  for (let i = 0; i < 4; i++) b[i] = Number((low >> BigInt(8 * (3 - i))) & 0xffn);
  b[4] = Number(mid >> 8n); b[5] = Number(mid & 0xffn);
  b[6] = 0x10 | Number(high >> 8n); b[7] = Number(high & 0xffn);
  tail(b);
  return format(b);
}
export function v6(now) {
  const t = ts100ns(now);
  const b = new Uint8Array(16);
  const hi = (t >> 28n) & 0xffffffffn, mid = (t >> 12n) & 0xffffn, lo = t & 0x0fffn;
  for (let i = 0; i < 4; i++) b[i] = Number((hi >> BigInt(8 * (3 - i))) & 0xffn);
  b[4] = Number(mid >> 8n); b[5] = Number(mid & 0xffn);
  b[6] = 0x60 | Number(lo >> 8n); b[7] = Number(lo & 0xffn);
  tail(b);
  return format(b);
}

export const NIL = '00000000-0000-0000-0000-000000000000';
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/* v3 / v5：命名空間 + 名稱的雜湊 */
export const NAMESPACES = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};
export function toBytes(u) {
  const h = String(u).trim().replace(/^urn:uuid:/i, '').replace(/[{}\-\s]/g, '');
  if (!/^[0-9a-f]{32}$/i.test(h)) return null;
  return Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
}
export async function v5(ns, name) {
  const nb = toBytes(ns);
  if (!nb) throw new Error('命名空間不是有效的 UUID。');
  const nm = new TextEncoder().encode(name);
  const buf = new Uint8Array(16 + nm.length);
  buf.set(nb); buf.set(nm, 16);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return format(setVV(d.slice(0, 16), 5));
}
export function v3(ns, name) {
  const nb = toBytes(ns);
  if (!nb) throw new Error('命名空間不是有效的 UUID。');
  const nm = new TextEncoder().encode(name);
  const buf = new Uint8Array(16 + nm.length);
  buf.set(nb); buf.set(nm, 16);
  return format(setVV(md5(buf), 3));
}

/* MD5（RFC 1321），v3 專用 */
export function md5(data) {
  const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = data.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(total);
  m.set(data); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, (len << 3) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 536870912), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((x, i) => ov.setUint32(i * 4, x, true));
  return out;
}

/* 解析：回傳版本、變體、時間（若有） */
const VARIANTS = ['NCS 保留（舊式）', 'RFC 9562 / 4122 標準變體', 'Microsoft 保留（舊式）', '未來保留'];
export function parse(u) {
  const b = toBytes(u);
  if (!b) return null;
  const s = hex(b);
  let variant;
  if (s === NIL.replace(/-/g, '')) variant = 'Nil UUID';
  else if (s === MAX.replace(/-/g, '')) variant = 'Max UUID';
  else {
    const t = b[8] >> 4;
    variant = t < 8 ? VARIANTS[0] : t < 12 ? VARIANTS[1] : t < 14 ? VARIANTS[2] : VARIANTS[3];
  }
  const special = variant === 'Nil UUID' || variant === 'Max UUID';
  const version = special ? null : b[6] >> 4;
  let time = null;
  if (!special && variant === VARIANTS[1]) {
    if (version === 7) {
      let ms = 0n;
      for (let i = 0; i < 6; i++) ms = (ms << 8n) | BigInt(b[i]);
      time = new Date(Number(ms));
    } else if (version === 1 || version === 6) {
      const x = BigInt('0x' + s);
      let t;
      if (version === 1) {
        const low = (x >> 96n) & 0xffffffffn, mid = (x >> 80n) & 0xffffn, high = (x >> 64n) & 0x0fffn;
        t = (high << 48n) | (mid << 32n) | low;
      } else {
        const hi = (x >> 96n) & 0xffffffffn, mid = (x >> 80n) & 0xffffn, lo = (x >> 64n) & 0x0fffn;
        t = (hi << 28n) | (mid << 12n) | lo;
      }
      time = new Date(Number(t / 10000n - GREG_OFFSET_MS));
    }
  }
  return { bytes: b, hex: s, version, variant, special, time, canonical: format(b) };
}
export const VERSION_NAMES = { 1: '時間 + 節點', 2: 'DCE 安全', 3: '命名空間 + MD5', 4: '隨機', 5: '命名空間 + SHA-1', 6: '重排序的時間', 7: 'Unix 毫秒時間 + 隨機', 8: '自訂' };
