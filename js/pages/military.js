// 兵役計算機頁面：UI 層。判定邏輯全在 js/tools/military-engine.js（與機器人 Python 引擎對拍過）。
import { escapeHtml } from '../core/ui.js';
import * as M from '../tools/military-engine.js';

const TIERS = [M.NORMAL, M.ALT_A, M.ALT_B, M.EXEMPT, M.PENDING];
const md = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const pill = (tier) => `<span class="tier t-${tier}"><i aria-hidden="true"></i>${M.TIER_LABEL[tier]}</span>`;

let dataPromise = null;
function loadEngine() {
  dataPromise ??= fetch('/data/military.json')
    .then((r) => {
      if (!r.ok) throw new Error(`military.json (HTTP ${r.status})`);
      return r.json();
    })
    .then((d) => M.createEngine(d));
  return dataPromise;
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const out = $('#mil-out');
  let alive = true;

  out.innerHTML = '<p class="mil-loading">載入資料中…</p>';
  loadEngine()
    .then((E) => alive && init(E))
    .catch((err) => {
      out.innerHTML = `<p class="mil-error">資料載入失敗：${escapeHtml(err.message)}</p>`;
    });

  function init(E) {
    const st = { h: '', w: '', q: '', cat: '', selected: [], forms: {}, open: new Set() };
    const order = Object.fromEntries(E.ALL.map((d, i) => [d.key, i]));

    const form = (k) => (st.forms[k] ??= { picked: new Set(), t: {}, flags: new Set() });

    /* ───── 01 身高體重 ───── */
    function bodyState() {
      if (!st.h.trim() && !st.w.trim()) return { empty: true };
      try {
        return { body: M.parseBodyInput(st.h, st.w) };
      } catch (e) {
        if (e instanceof M.ServiceError) return { error: e.message };
        throw e;
      }
    }

    function paintBody() {
      const s = bodyState();
      const el = $('#mil-body-out');
      if (s.empty) el.innerHTML = '請輸入身高與體重。身高輸入 1.7 這類公尺數會自動換成公分。';
      else if (s.error) el.innerHTML = `<span class="mil-bad">${escapeHtml(s.error)}</span>`;
      else {
        el.innerHTML = s.body.lines.map((l) => `<div>${md(l)}</div>`).join('') +
          `<div class="mil-strong">身高體重初步判定：${pill(s.body.tier)}</div>`;
      }
      return s;
    }

    /* ───── 02 疾病清單 ───── */
    $('#mil-cat').innerHTML =
      '<option value="">全部分類</option>' + E.CATEGORIES.map((c) => `<option>${escapeHtml(c)}</option>`).join('');

    function paintList() {
      const items = E.searchDiseases(st.q, st.cat || null);
      $('#mil-count').textContent = `共 ${items.length} 項，已選 ${st.selected.length} 項`;
      $('#mil-list').innerHTML = items.length
        ? items
            .map(
              (d) =>
                `<label class="dz-item"><input type="checkbox" value="${escapeHtml(d.key)}"${st.selected.includes(d.key) ? ' checked' : ''} />` +
                `<span class="dz-no">${escapeHtml(d.key.replace('130-', '130 '))}</span><span class="dz-name">${escapeHtml(d.name)}</span>` +
                `<span class="dz-cat">${escapeHtml(d.category)}</span></label>`
            )
            .join('')
        : '<p class="mil-empty">找不到符合的疾病，請換個關鍵字或分類。</p>';
    }

    function paintChosen() {
      $('#mil-chosen').innerHTML = st.selected.length
        ? st.selected
            .map((k) => `<button type="button" class="chip" data-del="${escapeHtml(k)}" title="取消選擇">${escapeHtml(E.BY_KEY[k].title)}<i aria-hidden="true">×</i></button>`)
            .join('')
        : '';
    }

    /* ───── 03 狀況表單 ───── */
    const numInput = (k, f, label, ph, unit = '') => {
      const v = form(k).t[f] ?? '';
      return `<label class="fld"><span>${escapeHtml(label)}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}</span>` +
        `<input type="text" inputmode="decimal" autocomplete="off" data-k="${escapeHtml(k)}" data-f="${escapeHtml(f)}" placeholder="${escapeHtml(ph)}" value="${escapeHtml(v)}" /></label>`;
    };

    const checkRow = (k, i, text, tier, checked) =>
      `<label class="ck"><input type="checkbox" data-k="${escapeHtml(k)}" data-i="${i}"${checked ? ' checked' : ''} />` +
      `<span class="ck-box" aria-hidden="true"></span><span class="ck-txt">${tier ? `<b class="tier-tag t-${tier}">${M.TIER_LABEL[tier]}</b>` : ''}${escapeHtml(text)}</span></label>`;

    const stmtList = (d, indices, title) => {
      const f = form(d.key);
      return `<div class="ck-group"><p class="ck-title">${escapeHtml(title)}<small>符合的狀況皆可勾選（可複選）；都不符合請留空</small></p>` +
        indices.map((i) => checkRow(d.key, i, d.stmts[i][1], d.stmts[i][0], f.picked.has(i))).join('') + '</div>';
    };

    function cardBody(d) {
      const k = d.key;
      if (d.handler === 'joint') {
        const f = form(k);
        const fields = d.joint.measures
          .map((m) => numInput(k, m.label, m.label, m.optional ? '有臀肌纖維化才填' : '不確定或無法測量請留空', m.unit))
          .join('');
        const flags = [];
        if (d.joint.ankylosis) flags.push(['ankylosis', '非功能性強直或強屈']);
        flags.push(['pending', '因傷(病)治療未滿一年']);
        return `<div class="fc-fields">${fields}</div>` +
          `<div class="ck-group"><p class="ck-title">特殊狀況<small>沒有請留空</small></p>` +
          flags.map(([v, t]) => `<label class="ck"><input type="checkbox" data-k="${escapeHtml(k)}" data-flag="${v}"${f.flags.has(v) ? ' checked' : ''} /><span class="ck-box" aria-hidden="true"></span><span class="ck-txt">${t}</span></label>`).join('') +
          `</div><p class="fc-hint">${escapeHtml(d.note)}</p>`;
      }
      const extra = E.extraIndices(d);
      let top = '';
      if (d.handler === 'hearing') {
        top = `<div class="fc-fields">${numInput(k, 'left', '左耳平均聽閾', '例如 25', 'dB')}${numInput(k, 'right', '右耳平均聽閾', '例如 20', 'dB')}</div>` +
          '<p class="fc-hint">平均聽閾 = (500Hz + 1000Hz + 2000Hz 的聽閾) ÷ 3。</p>';
      } else if (d.handler === 'vision') {
        const eye = (side, p) =>
          `<div class="fc-eye"><p class="ck-title">${side}</p><div class="fc-fields three">` +
          numInput(k, p + 'va', '矯正視力', '例如 0.8') + numInput(k, p + 'sph', '球面度數', '例如 -6.5', 'D') + numInput(k, p + 'cyl', '散光度數', '例如 -1.5', 'D') +
          '</div></div>';
        top = eye('左眼', 'l') + eye('右眼', 'r') + '<p class="fc-hint">度數以散瞳後驗光為準；球面度數可留空（只依視力判定）。</p>';
      } else if (d.handler === 'lung') {
        top = `<div class="fc-fields three">${numInput(k, 'ratio', 'FEV1/FVC', '例如 72', '%')}${numInput(k, 'fev1', 'FEV1 占預測值', '例如 65', '%')}${numInput(k, 'tlc', 'TLC 占預測值', '例如 70', '%')}</div>` +
          '<p class="fc-hint">附表三：FEV1/FVC 小於 75% 才判阻塞型；TLC 為限制型判讀。沒做可留空。</p>';
      }
      if (d.handler) return top + (extra.length ? stmtList(d, extra, '其他狀況') : '');
      return stmtList(d, d.stmts.map((_, i) => i), '符合哪些狀況？');
    }

    function paintForms() {
      const need = st.selected.map((k) => E.BY_KEY[k]).filter((d) => E.needsInput(d));
      $('#mil-forms-card').hidden = !need.length;
      $('#mil-forms').innerHTML = need
        .map(
          (d) =>
            `<article class="fc" data-card="${escapeHtml(d.key)}"><header class="fc-head"><h3>${escapeHtml(d.title)}</h3>` +
            `<span class="fc-status" data-status="${escapeHtml(d.key)}"></span></header>${cardBody(d)}</article>`
        )
        .join('');
    }

    /* ───── 判定 ───── */
    function evaluate(d) {
      const f = form(d.key);
      try {
        if (!E.needsInput(d)) return { r: E.evalDirect(d) };
        const picked = [...f.picked].sort((a, b) => a - b);
        const t = (x) => f.t[x] ?? '';
        if (d.handler === 'joint') {
          const values = {};
          for (const m of d.joint.measures) values[m.label] = M.parseNumber(t(m.label), `${d.name}－${m.label}`, -90, 400, false);
          if (Object.values(values).every((v) => v == null) && !f.flags.size) return { wait: '請至少輸入一項測量值' };
          return { r: E.evalJoint(d, values, [...f.flags]) };
        }
        const extra = picked.filter((i) => E.extraIndices(d).includes(i));
        if (d.handler === 'hearing') {
          if (!t('left').trim() || !t('right').trim()) return { wait: '請填寫左右耳聽閾' };
          return { r: E.evalHearing(d, M.parseNumber(t('left'), '左耳聽閾', 0, 130), M.parseNumber(t('right'), '右耳聽閾', 0, 130), extra) };
        }
        if (d.handler === 'vision') {
          if (!t('lva').trim() || !t('rva').trim()) return { wait: '請填寫左右眼矯正視力' };
          const eye = (p) => {
            const sph = t(p + 'sph').trim();
            const cyl = t(p + 'cyl').trim();
            return [t(p + 'va').trim(), sph, sph ? cyl : ''].filter((x, i) => i === 0 || x !== '').join(',');
          };
          return { r: E.evalVision(d, eye('l'), eye('r'), extra) };
        }
        if (d.handler === 'lung') {
          const ratio = M.parseNumber(t('ratio'), 'FEV1/FVC', 0, 200, false);
          const fev1 = M.parseNumber(t('fev1'), 'FEV1', 0, 300, false);
          const tlc = M.parseNumber(t('tlc'), 'TLC', 0, 300, false);
          return { r: E.evalLung(d, ratio, fev1, tlc, extra) };
        }
        return { r: E.evalStatements(d, picked) };
      } catch (e) {
        if (e instanceof M.ServiceError) return { err: e.message };
        throw e;
      }
    }

    function paintResult() {
      const b = bodyState();
      const rows = st.selected.map((k) => E.BY_KEY[k]).sort((x, y) => order[x.key] - order[y.key]).map((d) => ({ d, ...evaluate(d) }));

      // 各卡片右上角狀態
      for (const { d, r, wait, err } of rows) {
        const el = root.querySelector(`[data-status="${CSS.escape(d.key)}"]`);
        if (!el) continue;
        el.innerHTML = r ? pill(r.tier) : err ? `<span class="mil-bad">${escapeHtml(err)}</span>` : `<span class="fc-wait">${escapeHtml(wait)}</span>`;
      }

      if (!b.body) {
        out.innerHTML = `<div class="res-final t-none"><p class="mono-label">RESULT</p><p class="res-big">尚未判定</p><p class="res-note">${b.error ? escapeHtml(b.error) : '請先在左側輸入身高與體重。'}</p></div>`;
        return;
      }
      const done = rows.filter((x) => x.r).map((x) => x.r);
      const pending = rows.length - done.length;
      const dec = E.decide(b.body, done);

      const list = done.length
        ? done
            .map(
              (r) =>
                `<li><details data-d="${escapeHtml(r.key)}"${st.open.has(r.key) ? ' open' : ''}><summary><span class="res-title">${escapeHtml(r.title)}</span>${pill(r.tier)}</summary>` +
                (r.tier === M.PENDING && r.provisional ? `<p class="res-prov">其餘暫定：${M.TIER_LABEL[r.provisional]}</p>` : '') +
                `<ul class="res-reasons">${r.reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` +
                r.hints.map((h) => `<p class="res-hint">${escapeHtml(h)}</p>`).join('') +
                '</details></li>'
            )
            .join('')
        : '';

      out.innerHTML =
        `<div class="res-final t-${dec.tier}"><p class="mono-label">最終判定</p><p class="res-big">${dec.label}</p>` +
        (dec.note ? `<p class="res-note">${escapeHtml(dec.note)}</p>` : '') +
        (pending ? `<p class="res-note">另有 ${pending} 項尚未填完，未計入判定。</p>` : '') + '</div>' +
        `<div class="res-body"><p class="res-sub">身高體重</p>${pill(b.body.tier)}<span class="res-bmi">BMI ${M.fmtF(b.body.bmi, 1)}</span></div>` +
        (list ? `<p class="res-sub">疾病判定（${done.length} 項）</p><ul class="res-list">${list}</ul>` : '<p class="res-sub">未選擇疾病，僅依身高體重判定。</p>');
    }

    /* ───── 事件 ───── */
    const refresh = () => paintResult();

    $('#mil-h').addEventListener('input', (e) => { st.h = e.target.value; paintBody(); refresh(); });
    $('#mil-w').addEventListener('input', (e) => { st.w = e.target.value; paintBody(); refresh(); });
    $('#mil-q').addEventListener('input', (e) => { st.q = e.target.value; paintList(); });
    $('#mil-cat').addEventListener('change', (e) => { st.cat = e.target.value; paintList(); });

    const select = (k, on) => {
      const has = st.selected.includes(k);
      if (on && !has) st.selected.push(k);
      if (!on && has) st.selected = st.selected.filter((x) => x !== k);
      st.selected.sort((a, b) => order[a] - order[b]);
      paintChosen();
      paintForms();
      paintResult();
      $('#mil-count').textContent = $('#mil-count').textContent.replace(/已選 \d+ 項/, `已選 ${st.selected.length} 項`);
    };

    $('#mil-list').addEventListener('change', (e) => {
      if (e.target.matches('input[type=checkbox]')) select(e.target.value, e.target.checked);
    });
    $('#mil-chosen').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      select(b.dataset.del, false);
      const cb = [...root.querySelectorAll('#mil-list input')].find((x) => x.value === b.dataset.del);
      if (cb) cb.checked = false;
    });

    const forms = $('#mil-forms');
    forms.addEventListener('input', (e) => {
      const el = e.target;
      if (el.matches('input[type=text]')) {
        form(el.dataset.k).t[el.dataset.f] = el.value;
        paintResult();
      }
    });
    forms.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.matches('input[type=checkbox]')) return;
      const f = form(el.dataset.k);
      if (el.dataset.flag) el.checked ? f.flags.add(el.dataset.flag) : f.flags.delete(el.dataset.flag);
      else {
        const i = Number(el.dataset.i);
        el.checked ? f.picked.add(i) : f.picked.delete(i);
      }
      paintResult();
    });

    out.addEventListener('toggle', (e) => {
      const d = e.target.closest?.('details[data-d]');
      if (!d) return;
      d.open ? st.open.add(d.dataset.d) : st.open.delete(d.dataset.d);
    }, true);

    $('#mil-reset').addEventListener('click', () => {
      Object.assign(st, { h: '', w: '', q: '', cat: '', selected: [], forms: {}, open: new Set() });
      $('#mil-h').value = $('#mil-w').value = $('#mil-q').value = '';
      $('#mil-cat').value = '';
      paintBody(); paintList(); paintChosen(); paintForms(); paintResult();
    });

    paintBody(); paintList(); paintChosen(); paintForms(); paintResult();
  }

  return () => { alive = false; };
}
