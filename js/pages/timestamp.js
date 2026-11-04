// Unix 時間戳：即時時間、時間戳 ⇄ 日期雙向轉換、任意時區、Discord 格式。純前端。
import { copyText, toast, escapeHtml } from '../core/ui.js';

const MIN_MS = -62135596800000; // 0001-01-01
const MAX_MS = 253402300799999; // 9999-12-31 23:59:59.999
const COMMON_TZ = [
  ['local', '本機時區'], ['UTC', 'UTC'],
  ['Asia/Taipei', '台北'], ['Asia/Tokyo', '東京'], ['Asia/Seoul', '首爾'], ['Asia/Shanghai', '上海'], ['Asia/Hong_Kong', '香港'],
  ['Asia/Singapore', '新加坡'], ['Asia/Bangkok', '曼谷'], ['Asia/Kolkata', '印度'], ['Asia/Dubai', '杜拜'],
  ['Europe/London', '倫敦'], ['Europe/Paris', '巴黎'], ['Europe/Moscow', '莫斯科'],
  ['America/New_York', '紐約'], ['America/Chicago', '芝加哥'], ['America/Denver', '丹佛'], ['America/Los_Angeles', '洛杉磯'],
  ['Australia/Sydney', '雪梨'], ['Pacific/Auckland', '奧克蘭'],
];
const DISCORD = [
  ['t', '短時間', { hour: 'numeric', minute: '2-digit' }],
  ['T', '長時間', { hour: 'numeric', minute: '2-digit', second: '2-digit' }],
  ['d', '短日期', { year: 'numeric', month: '2-digit', day: '2-digit' }],
  ['D', '長日期', { dateStyle: 'long' }],
  ['f', '短日期時間', { dateStyle: 'long', timeStyle: 'short' }],
  ['F', '長日期時間', { dateStyle: 'full', timeStyle: 'short' }],
  ['R', '相對時間', null],
];

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');

/* ───────── 時區運算（只靠 Intl，不需要函式庫） ───────── */
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    dtfCache.set(tz, f);
  }
  return f;
}
const validTz = (tz) => { try { dtf(tz); return true; } catch { return false; } };

function utcMs(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, ms);
  return dt.getTime();
}
function parts(ms, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}
function offsetMs(ms, tz) {
  const p = parts(ms, tz);
  return utcMs(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
function zonedToEpoch(f, tz) {
  const guess = utcMs(f.y, f.mo, f.d, f.h, f.mi, f.s, f.ms || 0);
  const o1 = offsetMs(guess, tz);
  let t = guess - o1;
  const o2 = offsetMs(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}
function offsetLabel(ms, tz, colon = true) {
  const o = offsetMs(ms, tz) / 60000;
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  return `${sign}${pad(Math.floor(a / 60))}${colon ? ':' : ''}${pad(a % 60)}`;
}
function fmtDate(ms, tz, withMs = false) {
  const p = parts(ms, tz);
  const frac = withMs ? `.${pad(((ms % 1000) + 1000) % 1000, 3)}` : '';
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${frac}`;
}

/* ───────── 解析 ───────── */
const UNIT_DIV = { s: 1, ms: 1000, us: 1000000, ns: 1000000000 };
const UNIT_LABEL = { s: '秒', ms: '毫秒', us: '微秒', ns: '奈秒' };

function detectUnit(digits) {
  const n = digits.length;
  return n <= 11 ? 's' : n <= 14 ? 'ms' : n <= 17 ? 'us' : 'ns';
}

/** 回傳 {ms, unit}；格式錯誤丟 Error（訊息給使用者看） */
function parseStamp(raw, unitSel) {
  const t = raw.trim().replace(/[,_\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error('時間戳只能是數字（可含小數點）。');
  const neg = t.startsWith('-');
  const [intPart, frac = ''] = t.replace('-', '').split('.');
  const unit = unitSel === 'auto' ? detectUnit(intPart.replace(/^0+(?=\d)/, '')) : unitSel;
  let ms;
  if (!frac) {
    const big = BigInt(intPart) * (neg ? -1n : 1n);
    const div = { s: 1n / 1n, ms: 1n, us: 1000n, ns: 1000000n }[unit];
    ms = unit === 's' ? Number(big) * 1000 : Number(big / div) + (unit === 'ms' ? 0 : 0);
    if (unit !== 's' && unit !== 'ms') ms = Number(big / div);
  } else {
    ms = Math.round(Number(t) * 1000 / UNIT_DIV[unit]);
  }
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) throw new Error('超出可顯示的範圍（0001 ~ 9999 年）。');
  return { ms, unit };
}

const DATE_RE = /^\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s]+(\d{1,2})[:：時](\d{1,2})(?:[:：分](\d{1,2})(?:[.,](\d{1,3}))?)?秒?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?\s*$/i;
function parseDate(raw, tz) {
  const m = DATE_RE.exec(raw);
  if (!m) throw new Error('日期格式不符，請用 2026-11-04 06:06:00（可加 Z 或 +08:00）。');
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1, 7).map((x) => (x === undefined ? 0 : Number(x)));
  const msv = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) throw new Error('日期或時間超出範圍。');
  const chk = new Date(utcMs(y, mo, d));
  if (chk.getUTCMonth() !== mo - 1) throw new Error(`${y} 年 ${mo} 月沒有 ${d} 日。`);
  let ms;
  if (m[8]) {
    const z = m[8].toUpperCase();
    let off = 0;
    if (z !== 'Z') {
      const mm = /([+-])(\d{2}):?(\d{2})?/.exec(z);
      off = (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3] || 0)) * 60000;
    }
    ms = utcMs(y, mo, d, h, mi, s, msv) - off;
  } else {
    ms = zonedToEpoch({ y, mo, d, h, mi, s, ms: msv }, tz);
  }
  if (ms < MIN_MS || ms > MAX_MS) throw new Error('超出可顯示的範圍（0001 ~ 9999 年）。');
  return ms;
}

/* ───────── 顯示用 ───────── */
function relative(ms, now = Date.now()) {
  const diff = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
  const a = Math.abs(diff);
  if (a < 5) return '現在';
  const units = [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  for (const [u, sec] of units) if (a >= sec) return rtf.format(Math.trunc(diff / sec), u);
  return '現在';
}
function isoWeek(ms, tz) {
  const p = parts(ms, tz);
  const d = new Date(utcMs(p.y, p.mo, p.d));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((d - y0) / 86400000 + 1) / 7), year: d.getUTCFullYear() };
}
function dayOfYear(ms, tz) {
  const p = parts(ms, tz);
  return Math.round((utcMs(p.y, p.mo, p.d) - utcMs(p.y, 1, 1)) / 86400000) + 1;
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const inEl = $('#ts-in');
  const unitEl = $('#ts-unit');
  const dateEl = $('#ts-date');
  const pickEl = $('#ts-pick');
  const tzEl = $('#ts-tz');
  const tzCustom = $('#ts-tz-custom');
  const errEl = $('#ts-err');

  const st = { ms: Math.floor(Date.now() / 1000) * 1000, paused: false, frozen: 0 };
  const nowMs = () => (st.paused ? st.frozen : Date.now());

  /* ── 時區選單 ── */
  tzEl.innerHTML =
    COMMON_TZ.map(([v, n]) => `<option value="${v}">${v === 'local' ? `${n}（${escapeHtml(localTz())}）` : v === 'UTC' ? 'UTC' : `${n}（${v}）`}</option>`).join('') +
    '<option value="__custom">其他時區…</option>';
  tzEl.value = 'local';
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      $('#ts-tz-list').innerHTML = Intl.supportedValuesOf('timeZone').map((z) => `<option value="${z}"></option>`).join('');
    }
  } catch { /* datalist 只是輔助 */ }

  const tz = () => {
    if (tzEl.value === 'local') return localTz();
    if (tzEl.value === '__custom') return validTz(tzCustom.value.trim()) ? tzCustom.value.trim() : null;
    return tzEl.value;
  };

  /* ── 複製 ── */
  const flash = (btn) => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = '已複製';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1100);
  };
  const doCopy = async (text, btn, label) => {
    const ok = await copyText(String(text));
    if (btn && btn.classList.contains('tk-copy')) flash(btn);
    toast(ok ? `已複製${label ? `：${label}` : ''}` : '複製失敗');
  };

  /* ── 即時時間 ── */
  const sEl = $('#ts-now-s');
  const msEl = $('#ts-now-ms');
  const textEl = $('#ts-now-text');
  let lastSec = -1;
  function tickNow() {
    const n = nowMs();
    msEl.textContent = String(n);
    const sec = Math.floor(n / 1000);
    sEl.textContent = String(sec);
    if (sec !== lastSec) {
      lastSec = sec;
      const z = tz();
      if (z) {
        textEl.textContent = `${fmtDate(n, z)}　UTC${offsetLabel(n, z)}　${z}`;
        $('#ts-now-tz').textContent = '';
      } else {
        textEl.textContent = '';
      }
      paintRelative();
    }
  }
  const timer = setInterval(tickNow, 50);

  const discordCode = (ms, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
  const nowCopy = (kind, btn) => {
    const n = nowMs();
    if (kind === 's') doCopy(Math.floor(n / 1000), btn, '秒');
    else if (kind === 'ms') doCopy(n, btn, '毫秒');
    else doCopy(discordCode(n), btn, 'Discord 格式');
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy-now]');
    if (b) nowCopy(b.dataset.copyNow, b);
  });
  $('#ts-pause').addEventListener('click', togglePause);
  function togglePause() {
    st.paused = !st.paused;
    st.frozen = Date.now();
    $('#ts-pause').textContent = st.paused ? '繼續' : '暫停';
    $('#ts-pause').classList.toggle('on', st.paused);
    lastSec = -1;
    tickNow();
  }
  $('#ts-load').addEventListener('click', () => setFromMs(nowMs(), 'now'));

  /* ── 轉換器 ── */
  function outUnit() {
    return unitEl.value === 'auto' ? 's' : unitEl.value;
  }
  function stampText(ms) {
    const u = outUnit();
    if (u === 's') return String(Math.floor(ms / 1000));
    if (u === 'ms') return String(ms);
    return (BigInt(ms) * (u === 'us' ? 1000n : 1000000n)).toString();
  }
  function setError(msg) { errEl.textContent = msg || ''; }

  function render(skip) {
    const z = tz();
    if (!z) { setError('找不到這個時區，請輸入 IANA 名稱，例如 Asia/Taipei。'); return; }
    if (skip !== 'stamp') inEl.value = stampText(st.ms);
    if (skip !== 'date') {
      dateEl.value = fmtDate(st.ms, z, st.ms % 1000 !== 0);
      pickEl.value = fmtDate(st.ms, z).replace(' ', 'T');
    }
    paintFormats(z);
    paintDiscord();
  }

  function setFromMs(ms, from) {
    st.ms = Math.min(MAX_MS, Math.max(MIN_MS, ms));
    setError('');
    $('#ts-detect').textContent = '';
    render(from === 'stamp' ? 'stamp' : from === 'date' ? 'date' : null);
  }

  inEl.addEventListener('input', () => {
    if (!inEl.value.trim()) { setError(''); $('#ts-detect').textContent = ''; return; }
    try {
      const { ms, unit } = parseStamp(inEl.value, unitEl.value);
      setFromMs(ms, 'stamp');
      $('#ts-detect').textContent = unitEl.value === 'auto' ? `判斷為${UNIT_LABEL[unit]}` : '';
    } catch (err) { setError(err.message); }
  });
  unitEl.addEventListener('change', () => {
    // 換單位 = 以目前時間重新輸出；若使用者剛手動輸入了數字，改成以新單位重新解讀
    if (inEl.value.trim() && unitEl.value !== 'auto') {
      try { setFromMs(parseStamp(inEl.value, unitEl.value).ms, null); return; } catch { /* 退回重繪 */ }
    }
    setFromMs(st.ms, null);
  });
  dateEl.addEventListener('input', () => {
    const z = tz();
    if (!z) return setError('找不到這個時區，請輸入 IANA 名稱，例如 Asia/Taipei。');
    if (!dateEl.value.trim()) return setError('');
    try { setFromMs(parseDate(dateEl.value, z), 'date'); } catch (err) { setError(err.message); }
  });
  pickEl.addEventListener('change', () => {
    const z = tz();
    if (!pickEl.value || !z) return;
    try { setFromMs(parseDate(pickEl.value.replace('T', ' '), z), null); } catch (err) { setError(err.message); }
  });
  const onTz = () => {
    $('#ts-tz-custom-wrap').hidden = tzEl.value !== '__custom';
    lastSec = -1;
    tickNow();
    if (tz()) { setError(''); render(null); } else if (tzEl.value === '__custom' && tzCustom.value.trim()) setError('找不到這個時區，請輸入 IANA 名稱，例如 Asia/Taipei。');
  };
  tzEl.addEventListener('change', onTz);
  tzCustom.addEventListener('input', onTz);

  /* ── 快速設定 / 加減 ── */
  const PRESETS = {
    now: () => Date.now(),
    today: (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ ...p, h: 0, mi: 0, s: 0 }, z); },
    'today-end': (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ ...p, h: 23, mi: 59, s: 59 }, z); },
    yesterday: (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ y: p.y, mo: p.mo, d: p.d - 1, h: 0, mi: 0, s: 0 }, z); },
    tomorrow: (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ y: p.y, mo: p.mo, d: p.d + 1, h: 0, mi: 0, s: 0 }, z); },
    week: (z) => {
      const p = parts(Date.now(), z);
      const dow = new Date(utcMs(p.y, p.mo, p.d)).getUTCDay() || 7;
      return zonedToEpoch({ y: p.y, mo: p.mo, d: p.d - (dow - 1), h: 0, mi: 0, s: 0 }, z);
    },
    month: (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ y: p.y, mo: p.mo, d: 1, h: 0, mi: 0, s: 0 }, z); },
    year: (z) => { const p = parts(Date.now(), z); return zonedToEpoch({ y: p.y, mo: 1, d: 1, h: 0, mi: 0, s: 0 }, z); },
    epoch: () => 0,
    y2038: () => 2147483647000,
  };
  $('#ts-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const z = tz();
    if (!z) return setError('找不到這個時區，請先選擇有效的時區。');
    setFromMs(PRESETS[b.dataset.p](z), null);
  });
  $('#ts-adjust').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) setFromMs(st.ms + Number(b.dataset.a) * 1000, null);
  });

  /* ── 各種格式 ── */
  function paintFormats(z) {
    const ms = st.ms;
    const d = new Date(ms);
    const local = new Intl.DateTimeFormat('zh-TW', { timeZone: z, dateStyle: 'full', timeStyle: 'medium', hourCycle: 'h23' }).format(d);
    const wk = isoWeek(ms, z);
    const rows = [
      ['秒', Math.floor(ms / 1000)],
      ['毫秒', ms],
      ['日期時間（所選時區）', `${fmtDate(ms, z, ms % 1000 !== 0)}`],
      ['ISO 8601（含時區）', `${fmtDate(ms, z).replace(' ', 'T')}${ms % 1000 ? `.${pad(((ms % 1000) + 1000) % 1000, 3)}` : ''}${offsetLabel(ms, z)}`],
      ['ISO 8601（UTC）', d.toISOString().replace('.000Z', 'Z')],
      ['RFC 2822 / HTTP', d.toUTCString()],
      ['完整中文格式', local],
      ['UTC 日期時間', fmtDate(ms, 'UTC', ms % 1000 !== 0)],
      ['年內第幾天 / ISO 週', `第 ${dayOfYear(ms, z)} 天 / ${wk.year} 年第 ${wk.week} 週`],
      ['相對現在', `<span id="ts-rel">${relative(ms)}</span>`, true],
    ];
    $('#ts-formats').innerHTML = rows
      .map(([k, v, raw]) => {
        const plain = raw ? relative(ms) : String(v);
        return `<div class="tk-item"><span>${k}</span><code>${raw ? v : escapeHtml(String(v))}</code><button class="tk-copy" type="button" data-cp="${escapeHtml(plain)}">複製</button></div>`;
      })
      .join('');
  }
  function paintRelative() {
    const el = root.querySelector('#ts-rel');
    if (el) {
      el.textContent = relative(st.ms);
      el.closest('.tk-item').querySelector('[data-cp]').dataset.cp = el.textContent;
    }
    root.querySelectorAll('[data-dc-r]').forEach((x) => { x.textContent = relative(st.ms); });
  }

  /* ── Discord ── */
  function paintDiscord() {
    const d = new Date(st.ms);
    $('#ts-discord').innerHTML = DISCORD.map(([style, name, opt]) => {
      const code = discordCode(st.ms, style);
      let pv;
      if (opt === null) pv = `<span data-dc-r>${relative(st.ms)}</span>`;
      else pv = escapeHtml(new Intl.DateTimeFormat('zh-TW', opt).format(d));
      return `<div class="tk-item"><span>${name}（${style}）</span><span><code>${escapeHtml(code)}</code><span class="tk-pv">${pv}</span></span><button class="tk-copy" type="button" data-cp="${escapeHtml(code)}">複製</button></div>`;
    }).join('');
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cp]');
    if (b) doCopy(b.dataset.cp, b);
  });

  /* ── 快捷鍵 ── */
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.closest?.('input, textarea, select, [contenteditable]') || t.tagName === 'BUTTON' && e.key === ' ')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { setFromMs(nowMs(), 'now'); toast('已帶入現在'); }
    else if (k === 'c') nowCopy('s');
    else if (k === 'm') nowCopy('ms');
    else if (k === 'd') nowCopy('dc');
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
  };
  document.addEventListener('keydown', onKey);

  tickNow();
  render(null);

  return () => {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
  };
}
