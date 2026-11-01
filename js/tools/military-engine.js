// 兵役計算機判定引擎（JS 版）。
// 逐項移植自機器人的 _engine.py（國防部《體位區分標準》修正草案，10/31 施行新制），
// 不依賴 DOM，方便用 Node 與 Python 版對拍測試。
// 資料來源：/data/military.json（由 _data.py 匯出，條文原文不改）。

export const NORMAL = 'n';
export const ALT_A = 'a';
export const ALT_B = 'b';
export const EXEMPT = 'x';
export const PENDING = 'p';

export const TIER_LABEL = {
  [NORMAL]: '常備役',
  [ALT_A]: '替代役（A級）',
  [ALT_B]: '替代役（B級）',
  [EXEMPT]: '免役',
  [PENDING]: '體位未定',
};

const RANK = { [NORMAL]: 0, [ALT_A]: 1, [ALT_B]: 2, [EXEMPT]: 3 };
const ORDER = [NORMAL, ALT_A, ALT_B, EXEMPT];

export class ServiceError extends Error {}

/* ───────────── 與 Python 對齊的格式化工具 ───────────── */

/** Python 的 format(x, 'g')（預設 6 位有效數字） */
export function fmtG(x) {
  if (x === 0) return '0';
  if (!Number.isFinite(x)) return String(x);
  const P = 6;
  const exp = Number(x.toExponential(P - 1).split('e')[1]);
  const strip = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp < -4 || exp >= P) {
    const [m, e] = x.toExponential(P - 1).split('e');
    const n = Number(e);
    return `${strip(m)}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  return strip(x.toFixed(Math.max(0, P - 1 - exp)));
}

/** 是否「剛好」落在第 d 位小數的中間值（用雙精度的精確十進位展開判斷，不靠乘法） */
function isExactTie(a, d) {
  const tail = a.toFixed(Math.min(100, d + 30)).split('.')[1].slice(d);
  return /^50*$/.test(tail);
}

/** Python 的 format(x, '.{d}f')：正好落在中間值時四捨六入（銀行家捨入），其餘與 toFixed 相同 */
export function fmtF(x, d, plus = false) {
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s;
  if (isExactTie(a, d)) {
    const down = Number(a.toFixed(d + 1).slice(0, -1) + '0'); // 截斷到 d 位
    const last = Math.round(down * 10 ** d) % 2; // 截斷結果的最後一位奇偶
    s = (last === 0 ? down : down + 10 ** -d).toFixed(d);
  } else {
    s = a.toFixed(d);
  }
  return (neg ? '-' : plus ? '+' : '') + s;
}

/** Python 的 round(x, 1)（對 exact tie 取偶數） */
function round1(x) {
  const a = Math.abs(x);
  let r;
  if (isExactTie(a, 1)) {
    const down = Number(a.toFixed(2).slice(0, -1) + '0');
    r = Math.round(down * 10) % 2 === 0 ? down : down + 0.1;
  } else {
    r = Number(a.toFixed(1));
  }
  return x < 0 ? -r : r;
}

const FULLWIDTH = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', '．': '.', '－': '-', '＋': '+', '，': ',', '％': '%' };
const toHalf = (s) => String(s ?? '').replace(/[０-９．－＋，％]/g, (c) => FULLWIDTH[c]);
const NUM_RE = /[-+]?[0-9]+(?:\.[0-9]+)?/;

export function parseNumber(text, label, lo = -1e9, hi = 1e9, required = true) {
  const raw = toHalf(text).trim();
  if (!raw) {
    if (required) throw new ServiceError(`請輸入「${label}」。`);
    return null;
  }
  const m = raw.match(NUM_RE);
  if (!m) throw new ServiceError(`「${label}」請輸入數字（收到：${[...raw].slice(0, 20).join('')}）。`);
  const val = Number(m[0]);
  if (!(lo <= val && val <= hi)) throw new ServiceError(`「${label}」需介於 ${fmtG(lo)} ～ ${fmtG(hi)}（收到：${fmtG(val)}）。`);
  return val;
}

export function combine(tiers) {
  const firm = tiers.filter((t) => t in RANK);
  let worst = NORMAL;
  for (const t of firm) if (RANK[t] > RANK[worst]) worst = t;
  if (!firm.length) worst = NORMAL;
  if (worst === EXEMPT) return [EXEMPT, null];
  if (tiers.includes(PENDING)) return [PENDING, worst];
  return [worst, null];
}

/* ───────────── 身高體重（項次 1、2／附表一） ───────────── */

/** 十進位字串 → [整數, 小數位數]，供精確的 BMI 四捨五入 */
function toScaled(num) {
  let s = String(num);
  if (/e/i.test(s)) s = num.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const [i, f = ''] = s.split('.');
  return [BigInt(i + f), f.length];
}

/** BMI = 體重 ÷ 身高(m)²，四捨五入到 0.1（ROUND_HALF_UP，用整數運算避免浮點誤差） */
function bmiRounded(h, w) {
  const [H, a] = toScaled(h);
  const [W, b] = toScaled(w);
  // bmi*10 = W * 10^5 * 10^(2a) / (10^b * H^2)
  const num = W * 10n ** 5n * 10n ** BigInt(2 * a);
  const den = 10n ** BigInt(b) * H * H;
  const q = (2n * num + den) / (2n * den);
  return Number(q) / 10;
}

export function calcBody(heightCm, weightKg) {
  const bmi = bmiRounded(heightCm, weightKg);
  let bt, rng;
  if (bmi < 14) [bt, rng] = [EXEMPT, 'BMI＜14'];
  else if (bmi < 15) [bt, rng] = [ALT_B, '14≦BMI＜15'];
  else if (bmi < 16.5) [bt, rng] = [ALT_A, '15≦BMI＜16.5'];
  else if (bmi <= 32) [bt, rng] = [NORMAL, '16.5≦BMI≦32'];
  else if (bmi <= 37.5) [bt, rng] = [ALT_A, '32＜BMI≦37.5'];
  else if (bmi <= 45) [bt, rng] = [ALT_B, '37.5＜BMI≦45'];
  else [bt, rng] = [EXEMPT, 'BMI＞45'];

  const hi = Math.floor(heightCm);
  let ht, hrng;
  if (hi >= 150) [ht, hrng] = [NORMAL, '身高≧150 公分'];
  else if (hi >= 145) [ht, hrng] = [ALT_A, '身高 145～149 公分'];
  else [ht, hrng] = [EXEMPT, '身高≦144 公分'];

  const [tier] = combine([bt, ht]);
  return {
    height: heightCm,
    weight: weightKg,
    bmi,
    bmiTier: bt,
    heightTier: ht,
    tier,
    lines: [
      `BMI **${fmtF(bmi, 1)}**（${rng}）→ ${TIER_LABEL[bt]}`,
      `身高 **${fmtG(heightCm)}** 公分（${hrng}）→ ${TIER_LABEL[ht]}`,
    ],
  };
}

/** 與 _modals.py 相同的身高體重輸入處理（身高 < 3 視為公尺） */
export function parseBodyInput(heightText, weightText) {
  let h = parseNumber(heightText, '身高', 0.5, 250);
  if (h < 3) h = round1(h * 100);
  if (!(h >= 100 && h <= 250)) throw new ServiceError(`「身高」需介於 100 ～ 250 公分（收到：${fmtG(h)}）。`);
  const w = parseNumber(weightText, '體重', 20, 300);
  return calcBody(h, w);
}

/* ───────────── 資料與搜尋 ───────────── */

export function createEngine(data) {
  const ALL = data.diseases.map((d) => ({
    ...d,
    title: `${d.no}. ${d.name}`,
    searchText: `${d.no} ${d.name} ${d.category} ${d.stmts.map((s) => s[1]).join(' ')} ${d.note}`.toLowerCase(),
  }));
  const BY_KEY = Object.fromEntries(ALL.map((d) => [d.key, d]));
  const ALIASES = data.aliases;

  function searchDiseases(keyword = '', category = null) {
    const pool = ALL.filter((d) => category == null || d.category === category);
    const tokens = String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return pool;
    const scored = [];
    for (const d of pool) {
      let score = 0;
      let ok = true;
      const name = `${d.no}${d.name}`.toLowerCase();
      for (const t of tokens) {
        if (name.includes(t)) score += 3;
        else if ((Object.hasOwn(ALIASES, t) ? ALIASES[t] : []).includes(d.key)) score += 2;
        else if (d.searchText.includes(t)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok) scored.push([score, d]);
    }
    scored.sort((x, y) => y[0] - x[0] || x[1].no - y[1].no || (x[1].key < y[1].key ? -1 : x[1].key > y[1].key ? 1 : 0));
    return scored.map((x) => x[1]);
  }

  function hints(d) {
    const out = [];
    for (const n of d.refs) {
      const ref = BY_KEY[String(n)];
      if (ref && ref.key !== d.key) out.push(`另請依第 ${n} 項「${ref.name}」判定體位。`);
    }
    if (d.note.includes('附表二') && d.handler !== 'joint') out.push('影響運動功能時，請另選「重要關節（附表二）」輸入關節角度判定。');
    if (d.note.includes('附表三') && d.handler !== 'lung') out.push('肺功能依附表三「役男肺功能檢查判讀標準」辦理。');
    return out;
  }

  const res = (d, tier, reasons, provisional = null) => ({ key: d.key, title: d.title, tier, reasons, hints: hints(d), provisional });

  function extraIndices(d) {
    const out = [];
    d.stmts.forEach(([tier, text], i) => {
      if (d.handler === 'lung') {
        if (!text.includes('肺功能障礙')) out.push(i);
      } else if (d.handler === 'hearing') {
        if (tier === PENDING) out.push(i);
      } else if (d.handler === 'vision') {
        if (tier === PENDING || (tier === EXEMPT && (text.includes('視野') || text.includes('MD') || text.includes('證明')))) out.push(i);
      }
    });
    return out;
  }

  const needsInput = (d) => Boolean(d.handler) || d.stmts.length > 1;

  function evalDirect(d) {
    const [tier, text] = d.stmts[0];
    return res(d, tier, [text]);
  }

  function evalStatements(d, picked) {
    if (!picked.length) return res(d, NORMAL, ['未勾選任何符合的狀況，視為不影響體位。']);
    const [tier, prov] = combine(picked.map((i) => d.stmts[i][0]));
    return res(d, tier, picked.map((i) => d.stmts[i][1]), prov);
  }

  const pickedExtra = (d, picked) => [picked.map((i) => d.stmts[i][0]), picked.map((i) => d.stmts[i][1])];

  function evalHearing(d, left, right, extra = []) {
    const better = Math.min(left, right);
    const worse = Math.max(left, right);
    let tier;
    if (better > 60 || (better > 20 && worse > 70) || worse >= 90) tier = EXEMPT;
    else if ((better <= 20 && worse > 70) || (better >= 45 && better <= 60)) tier = ALT_A;
    else tier = NORMAL;
    const reasons = [`較佳耳 ${fmtG(better)} dB、較差耳 ${fmtG(worse)} dB → ${TIER_LABEL[tier]}`];
    const [xt, xr] = pickedExtra(d, extra);
    const [final, prov] = combine([tier, ...xt]);
    return res(d, final, [...reasons, ...xr], prov);
  }

  function parseEye(text, side) {
    const raw = toHalf(text).trim();
    if (!raw) throw new ServiceError(`請輸入${side}資料（格式：矯正視力,球面度數,散光度數）。`);
    const nums = (raw.match(/[-+]?[0-9]+(?:\.[0-9]+)?/g) || []).map(Number).slice(0, 3);
    if (!nums.length) throw new ServiceError(`${side}格式錯誤，請用「矯正視力,球面度數,散光度數」，例如 0.8,-6.5,-1.5。`);
    const va = nums[0];
    if (!(va >= 0 && va <= 2.5)) throw new ServiceError(`${side}矯正視力需介於 0～2.5（例如 0.8）。`);
    const sph = nums.length > 1 ? nums[1] : null;
    const cyl = nums.length > 2 ? nums[2] : 0;
    return [va, sph, cyl];
  }

  const copysign = (mag, sign) => (sign < 0 || Object.is(sign, -0) ? -Math.abs(mag) : Math.abs(mag));

  function signedRefraction(sph, cyl) {
    if (sph == null) return null;
    cyl = cyl || 0;
    const half = Math.abs(cyl) / 2;
    if (sph === 0) return cyl ? copysign(half, cyl) : 0;
    const same = cyl === 0 || sph > 0 === cyl > 0;
    return sph + copysign(half, sph) * (same ? 1 : -1);
  }

  function evalVision(d, left, right, extra = []) {
    const [vaL, sL, cL] = parseEye(left, '左眼');
    const [vaR, sR, cR] = parseEye(right, '右眼');
    const rL = signedRefraction(sL, cL);
    const rR = signedRefraction(sR, cR);
    const mags = [rL, rR].filter((x) => x != null).map(Math.abs);
    const maxMag = mags.length ? Math.max(...mags) : 0;
    const aniso = rL != null && rR != null ? Math.abs(rL - rR) : 0;

    const reasons = [
      `左眼：矯正視力 ${fmtG(vaL)}` + (rL != null ? `、屈光度 ${fmtF(rL, 2, true)} D` : ''),
      `右眼：矯正視力 ${fmtG(vaR)}` + (rR != null ? `、屈光度 ${fmtF(rR, 2, true)} D` : ''),
    ];
    let tier;
    const minVa = Math.min(vaL, vaR);
    if (minVa <= 0.1) {
      tier = EXEMPT;
      reasons.push('一眼最佳矯正視力在 0.1 以下 → 免役');
    } else if (maxMag > 12 || aniso > 5) {
      tier = ALT_B;
      reasons.push(`驗光度數最大 ${fmtF(maxMag, 2)} D／兩眼相差 ${fmtF(aniso, 2)} D，逾替代役 A 級 → 替代役 B 級`);
    } else if (minVa < 0.6 || maxMag > 11 || aniso > 4) {
      tier = ALT_A;
      reasons.push(`矯正視力未達 0.6 或屈光度逾 11 D／不等視逾 4 D → 替代役 A 級（最大 ${fmtF(maxMag, 2)} D，相差 ${fmtF(aniso, 2)} D）`);
    } else {
      tier = NORMAL;
      reasons.push('矯正視力與屈光度均符合常備役標準');
    }
    const [xt, xr] = pickedExtra(d, extra);
    const [final, prov] = combine([tier, ...xt]);
    return res(d, final, [...reasons, ...xr], prov);
  }

  function lungSeverity(ratio, fev1, tlc) {
    let sev = 0;
    const notes = [];
    if (fev1 != null) {
      if (ratio == null) throw new ServiceError('填了 FEV1 占預測值，請一併填寫 FEV1/FVC 比值（%）。');
      if (ratio < 75) {
        const s = fev1 < 40 ? 3 : fev1 < 60 ? 2 : fev1 < 80 ? 1 : 0;
        if (s) notes.push(`阻塞型：FEV1/FVC ${fmtG(ratio)}%、FEV1 ${fmtG(fev1)}%`);
        sev = Math.max(sev, s);
      } else if (fev1 < 80) {
        notes.push(`FEV1/FVC ${fmtG(ratio)}%（≧75%）不判為阻塞型`);
      }
    }
    if (tlc != null) {
      const s = tlc < 50 ? 3 : tlc < 65 ? 2 : tlc < 80 ? 1 : 0;
      if (s) notes.push(`限制型：TLC ${fmtG(tlc)}%`);
      sev = Math.max(sev, s);
    }
    return [sev, notes.join('、') || '未達輕度肺功能障礙'];
  }

  function evalLung(d, ratio, fev1, tlc, extra = []) {
    const [sev, note] = lungSeverity(ratio, fev1, tlc);
    const label = ['未達輕度', '輕度', '中度', '重度'][sev];
    const graded = new Set(d.stmts.filter(([, text]) => text.includes('肺功能障礙')).map(([t]) => t));
    const want = ORDER[sev];
    let tier;
    if (sev === 0) tier = NORMAL;
    else tier = ORDER.slice(ORDER.indexOf(want)).find((t) => graded.has(t)) ?? want;
    const reasons = [`肺功能：${label}肺功能障礙（${note}）→ ${TIER_LABEL[tier]}`];
    if (ratio == null && fev1 == null && tlc == null) reasons[0] = '未填寫肺功能數值，視為未達輕度肺功能障礙。';
    const [xt, xr] = pickedExtra(d, extra);
    const [final, prov] = combine([tier, ...xt]);
    return res(d, final, [...reasons, ...xr], prov);
  }

  function measureTier(m, v) {
    if (m.kind === 'hi') {
      for (const [tier, bound] of m.cuts) if (v >= bound) return tier;
    } else {
      for (const [tier, bound] of m.cuts) if (v < bound) return tier;
    }
    return m.fallback;
  }

  function evalJoint(d, values, flags = []) {
    const spec = d.joint;
    const tiers = [];
    const reasons = [];
    for (const m of spec.measures) {
      const v = values[m.label];
      if (v == null) continue;
      const t = measureTier(m, v);
      tiers.push(t);
      reasons.push(`${m.label} ${fmtG(v)}${m.unit} → ${TIER_LABEL[t]}`);
    }
    if (!tiers.length && !flags.length) throw new ServiceError(`${spec.title}：請至少輸入一項測量值。`);
    if (flags.includes('ankylosis')) {
      tiers.push(EXEMPT);
      reasons.push('非功能性強直或強屈 → 免役');
    }
    if (flags.includes('pending')) {
      tiers.push(PENDING);
      reasons.push('因傷(病)治療未滿一年 → 體位未定');
    }
    const [final, prov] = combine(tiers);
    return res(d, final, reasons, prov);
  }

  function decide(body, results) {
    const tiers = [body.tier];
    for (const r of results) {
      tiers.push(r.tier);
      if (r.provisional) tiers.push(r.provisional);
    }
    const [tier, prov] = combine(tiers);
    if (tier === PENDING) {
      return {
        tier: PENDING,
        provisional: prov,
        label: TIER_LABEL[PENDING],
        note: `治療觀察期滿一年後複檢再定體位；其餘項目目前暫定為「${TIER_LABEL[prov || NORMAL]}」。`,
      };
    }
    return { tier, provisional: null, label: TIER_LABEL[tier], note: '' };
  }

  return {
    ALL, BY_KEY, CATEGORIES: data.categories,
    searchDiseases, extraIndices, needsInput,
    evalDirect, evalStatements, evalHearing, evalVision, evalLung, evalJoint, decide,
  };
}
