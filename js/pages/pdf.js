// PDF 編輯器：頁面縮圖（pdf.js）+ 編輯輸出（pdf-lib）。壓縮採「逐頁轉 JPEG 再重組」或無損優化。
import { toast, escapeHtml } from '../core/ui.js';
import { loadPdfLib, loadPdfJs } from '../tools/vendor-loader.js';
import { makeZip } from '../tools/zip.js';

const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const PRESETS = {
  extreme: { dpi: 72, q: 35, gray: true },
  strong: { dpi: 96, q: 45, gray: false },
  balanced: { dpi: 130, q: 60, gray: false },
  high: { dpi: 200, q: 80, gray: false },
};
const MAX_PIXELS = 36e6;
const baseName = (n) => n.replace(/\.pdf$/i, '');
const blobPdf = (u8) => new Blob([u8], { type: 'application/pdf' });

/** 解析 "1-3, 5, 8-" → [[0,1,2],[4],[7..n-1]]（以目前排列的 0 起算索引） */
function parseRanges(text, n) {
  const out = [];
  for (const part of text.split(/[,，;；\s]+/).filter(Boolean)) {
    const m = /^(\d*)-(\d*)$/.exec(part) || /^(\d+)$/.exec(part);
    if (!m) throw new Error(`看不懂「${part}」，請用像 1-3, 5, 8- 的格式。`);
    let a, b;
    if (m.length === 2) a = b = Number(m[1]);
    else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : n; }
    if (a < 1 || b < a || b > n) throw new Error(`範圍「${part}」超出頁數（共 ${n} 頁）。`);
    out.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  if (!out.length) throw new Error('請輸入至少一個範圍。');
  return out;
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const st = { docs: new Map(), pages: [], seq: 0, uid: 0, history: [], busy: false, thumbs: new Map(), q: [], qRunning: false, last: null, urls: [] };
  let io = null;
  let tab = 'save';
  let preset = 'strong';

  const err = (m) => { $('#pe-err').textContent = m || ''; };
  const status = (m) => { $('#pe-status').textContent = m || ''; };
  const bar = (p) => { $('#pe-prog').hidden = p == null; if (p != null) $('#pe-bar').style.width = `${Math.round(Math.min(1, p) * 100)}%`; };

  /* ───── 載入 ───── */
  async function addFiles(list) {
    err('');
    const files = [...list].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (files.length !== list.length) err('只接受 PDF 檔，其他檔案已略過。');
    const pdfjs = await loadPdfJs();
    const P = await loadPdfLib();
    for (const f of files) {
      status(`讀取「${f.name}」…`);
      try {
        const buf = await f.arrayBuffer();
        let encrypted = false;
        try { await P.PDFDocument.load(buf.slice(0), { updateMetadata: false }); } catch (e) { if (/encrypt/i.test(e?.message || e?.constructor?.name || '')) encrypted = true; else throw e; }
        const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
        task.onPassword = (cb, reason) => {
          const pw = window.prompt(reason === 2 ? '密碼錯誤，請重新輸入：' : `「${f.name}」需要密碼：`);
          if (pw === null) task.destroy(); else cb(pw);
        };
        const pdf = await task.promise;
        const id = ++st.seq;
        st.docs.set(id, { id, name: f.name, size: f.size, buf, pdf, n: pdf.numPages, encrypted });
        for (let i = 1; i <= pdf.numPages; i++) st.pages.push({ uid: ++st.uid, doc: id, i, rot: 0, sel: false });
      } catch (e) { err(`無法讀取「${f.name}」：${e?.message?.includes('Invalid PDF') ? '不是有效的 PDF' : e?.message || e}`); }
    }
    status(''); st.history = []; renderAll();
  }
  const fileIn = $('#pe-file');
  fileIn.addEventListener('change', () => { addFiles(fileIn.files); fileIn.value = ''; });
  const drop = $('#pe-drop');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  /* ───── 清單／縮圖 ───── */
  function renderDocs() {
    $('#pe-docs').innerHTML = [...st.docs.values()].map((d) => `<div class="pe-doc"><b title="${escapeHtml(d.name)}">${escapeHtml(d.name)}${d.encrypted ? ' 🔒' : ''}</b><small>${d.n} 頁　·　${fmtSize(d.size)}</small><button type="button" data-rmdoc="${d.id}" aria-label="移除這份 PDF">✕</button></div>`).join('');
    const tot = [...st.docs.values()].reduce((a, d) => a + d.size, 0);
    $('#pe-info').textContent = st.docs.size ? `${st.docs.size} 份　·　${fmtSize(tot)}` : '';
  }
  function renderAll() {
    renderDocs();
    const g = $('#pe-grid');
    io?.disconnect();
    g.innerHTML = st.pages.map((p, k) => {
      const d = st.docs.get(p.doc);
      return `<div class="pg${p.sel ? ' sel' : ''}" draggable="true" data-uid="${p.uid}">
        <span class="pg-no">${k + 1}</span><span class="pg-chk">✓</span>
        <div class="pg-th"><span class="ld">載入中…</span></div>
        <div class="pg-src" title="${escapeHtml(d.name)} 第 ${p.i} 頁">${escapeHtml(baseName(d.name))} · ${p.i}</div>
        <div class="pg-act"><button type="button" data-pa="left" title="往前移">◀</button><button type="button" data-pa="rotl" title="左轉">↺</button><button type="button" data-pa="rotr" title="右轉">↻</button><button type="button" data-pa="del" title="刪除">🗑</button><button type="button" data-pa="right" title="往後移">▶</button></div></div>`;
    }).join('');
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); enqueue(e.target); } }), { rootMargin: '300px' });
    g.querySelectorAll('.pg').forEach((el) => io.observe(el));
    updateUI();
  }
  function updateUI() {
    const sel = st.pages.filter((p) => p.sel).length;
    $('#pe-sel').textContent = st.pages.length ? `共 ${st.pages.length} 頁${sel ? `，已選 ${sel} 頁` : ''}` : '';
    $('#pe-undo').disabled = !st.history.length;
    const none = !st.pages.length || st.busy;
    ['pe-save', 'pe-split', 'pe-shrink'].forEach((id) => { $(`#${id}`).disabled = none; });
    root.querySelectorAll('.pg').forEach((el, k) => { el.querySelector('.pg-no').textContent = k + 1; });
    st.pages.forEach((p) => applyRot(p));
  }
  function enqueue(el) { st.q.push(el); pump(); }
  async function pump() {
    if (st.qRunning) return;
    st.qRunning = true;
    while (st.q.length) {
      const el = st.q.shift();
      if (!el.isConnected) continue;
      const p = st.pages.find((x) => x.uid === Number(el.dataset.uid));
      if (!p) continue;
      try {
        const key = `${p.doc}:${p.i}`;
        let t = st.thumbs.get(key);
        if (!t) {
          const page = await st.docs.get(p.doc).pdf.getPage(p.i);
          const vp1 = page.getViewport({ scale: 1 });
          const s = 260 / Math.max(vp1.width, vp1.height);
          const vp = page.getViewport({ scale: s });
          const c = document.createElement('canvas');
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: x, viewport: vp }).promise;
          t = { url: c.toDataURL('image/jpeg', 0.7), w: c.width, h: c.height };
          st.thumbs.set(key, t);
          page.cleanup();
        }
        const th = el.querySelector('.pg-th');
        if (th) { th.innerHTML = `<img alt="" src="${t.url}" width="${t.w / 2}" height="${t.h / 2}" data-w="${t.w / 2}" data-h="${t.h / 2}" />`; applyRot(p); }
      } catch { const th = el.querySelector('.pg-th'); if (th) th.innerHTML = '<span class="ld">無法預覽</span>'; }
    }
    st.qRunning = false;
  }
  function applyRot(p) {
    const el = root.querySelector(`.pg[data-uid="${p.uid}"] img`);
    if (!el) return;
    const w = Number(el.dataset.w), h = Number(el.dataset.h);
    const r = ((p.rot % 360) + 360) % 360;
    const box = 160;
    const sw = r % 180 ? h : w, sh = r % 180 ? w : h; // 旋轉後佔用的寬高
    const k = Math.min(1, box / Math.max(sw, sh) * 1.0, 165 / sh);
    el.style.transform = `rotate(${r}deg) scale(${r % 180 ? Math.min(1, 150 / h, 165 / w) : 1})`;
    void k;
  }

  /* ───── 編輯動作 ───── */
  const snap = () => { st.history.push(st.pages.map((p) => ({ ...p }))); if (st.history.length > 50) st.history.shift(); };
  function act(fn) { snap(); fn(); renderAll(); }
  const sel = () => st.pages.filter((p) => p.sel);
  const targetPages = () => (sel().length ? sel() : st.pages);
  const move = (uid, delta) => {
    const i = st.pages.findIndex((p) => p.uid === uid), j = i + delta;
    if (j < 0 || j >= st.pages.length) return;
    act(() => { [st.pages[i], st.pages[j]] = [st.pages[j], st.pages[i]]; });
  };

  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rmdoc]');
    if (rm) { const id = Number(rm.dataset.rmdoc); snap(); st.docs.get(id)?.pdf.destroy(); st.docs.delete(id); st.pages = st.pages.filter((p) => p.doc !== id); renderAll(); return; }
    const pa = e.target.closest('[data-pa]');
    if (pa) {
      const uid = Number(pa.closest('.pg').dataset.uid);
      const p = st.pages.find((x) => x.uid === uid);
      const a = pa.dataset.pa;
      if (a === 'left') move(uid, -1); else if (a === 'right') move(uid, 1);
      else if (a === 'rotl') act(() => { p.rot -= 90; }); else if (a === 'rotr') act(() => { p.rot += 90; });
      else if (a === 'del') act(() => { st.pages = st.pages.filter((x) => x.uid !== uid); });
      return;
    }
    const card = e.target.closest('.pg');
    if (card) { const p = st.pages.find((x) => x.uid === Number(card.dataset.uid)); p.sel = !p.sel; card.classList.toggle('sel', p.sel); updateUI(); return; }
    const t = e.target.closest('[data-t]');
    if (t) toolbar(t.dataset.t);
    const tb = e.target.closest('[data-tab]');
    if (tb) switchTab(tb.dataset.tab);
    const pr = e.target.closest('[data-pre]');
    if (pr) setPreset(pr.dataset.pre);
  });
  function toolbar(a) {
    if (a === 'undo') { const h = st.history.pop(); if (h) { st.pages = h; renderAll(); } return; }
    if (!st.pages.length) return;
    if (a === 'all' || a === 'none' || a === 'inv' || a === 'odd' || a === 'even') {
      st.pages.forEach((p, k) => { p.sel = a === 'all' ? true : a === 'none' ? false : a === 'inv' ? !p.sel : a === 'odd' ? k % 2 === 0 : k % 2 === 1; });
      root.querySelectorAll('.pg').forEach((el, k) => el.classList.toggle('sel', st.pages[k].sel));
      return updateUI();
    }
    if (a === 'rotl') act(() => targetPages().forEach((p) => { p.rot -= 90; }));
    else if (a === 'rotr') act(() => targetPages().forEach((p) => { p.rot += 90; }));
    else if (a === 'rot180') act(() => targetPages().forEach((p) => { p.rot += 180; }));
    else if (a === 'rev') act(() => st.pages.reverse());
    else if (a === 'del') {
      if (!sel().length) return toast('請先選取要刪除的頁面');
      act(() => { st.pages = st.pages.filter((p) => !p.sel); });
    }
  }

  // 拖曳排序
  let dragUid = null;
  const grid = $('#pe-grid');
  grid.addEventListener('dragstart', (e) => { const c = e.target.closest('.pg'); if (!c) return; dragUid = Number(c.dataset.uid); c.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragUid)); });
  grid.addEventListener('dragend', () => { dragUid = null; grid.querySelectorAll('.drag,.over').forEach((x) => x.classList.remove('drag', 'over')); });
  grid.addEventListener('dragover', (e) => { if (dragUid == null) return; e.preventDefault(); const c = e.target.closest('.pg'); grid.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); c?.classList.add('over'); });
  grid.addEventListener('drop', (e) => {
    if (dragUid == null) return;
    e.preventDefault(); e.stopPropagation();
    const c = e.target.closest('.pg'); if (!c) return;
    const to = st.pages.findIndex((p) => p.uid === Number(c.dataset.uid));
    const from = st.pages.findIndex((p) => p.uid === dragUid);
    if (from < 0 || to < 0 || from === to) return;
    act(() => { const [m] = st.pages.splice(from, 1); st.pages.splice(to, 0, m); });
  });

  /* ───── 輸出 ───── */
  function switchTab(t) {
    tab = t;
    root.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    ['save', 'split', 'shrink'].forEach((k) => { $(`#pe-t-${k}`).hidden = k !== t; });
    $('#pe-result').hidden = true;
  }
  function setPreset(k) {
    preset = k;
    root.querySelectorAll('[data-pre]').forEach((b) => b.classList.toggle('on', b.dataset.pre === k));
    if (PRESETS[k]) { const p = PRESETS[k]; $('#pe-dpi').value = p.dpi; $('#pe-jq').value = p.q; $('#pe-gray').checked = p.gray; }
    syncShrink();
  }
  function syncShrink() {
    $('#pe-dpi-v').textContent = `${$('#pe-dpi').value} dpi`;
    $('#pe-jq-v').textContent = `${$('#pe-jq').value}`;
    const lossless = preset === 'lossless';
    $('#pe-custom').hidden = lossless;
    $('#pe-shrink-note').textContent = lossless
      ? '只整理 PDF 內部結構（物件串流、移除中繼資料），文字、向量與連結完全保留，但縮小幅度通常有限。已經很精簡或以掃描圖片為主的 PDF 幾乎不會變小。'
      : '會把每一頁畫成圖片再重新組成 PDF：檔案可大幅縮小，但文字將無法選取或搜尋、連結與書籤會消失。越低的解析度與品質越小，掃描檔、投影片效果最明顯。';
  }
  root.addEventListener('input', (e) => {
    if (e.target.closest('#pe-custom')) { preset = 'custom'; root.querySelectorAll('[data-pre]').forEach((b) => b.classList.remove('on')); syncShrink(); }
    if (e.target.id === 'pe-smode') { const m = e.target.value; $('#pe-sn-wrap').hidden = m !== 'n'; $('#pe-sr-wrap').hidden = m !== 'ranges'; }
  });

  const download = (blob, name) => { const u = URL.createObjectURL(blob); st.urls.push(u); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); };
  function showResult(html) { const r = $('#pe-result'); r.hidden = false; r.innerHTML = html; }
  async function guard(fn) {
    if (st.busy) return;
    err(''); st.busy = true; updateUI(); $('#pe-result').hidden = true;
    try { await fn(); } catch (e) { err(e?.message || String(e)); status(''); }
    finally { st.busy = false; bar(null); updateUI(); }
  }
  const encryptedUsed = (pages) => [...new Set(pages.map((p) => p.doc))].map((id) => st.docs.get(id)).find((d) => d.encrypted);

  /** 依排列組出新 PDF（pdf-lib）。 */
  async function buildDoc(pages, onP) {
    const bad = encryptedUsed(pages);
    if (bad) throw new Error(`「${bad.name}」有密碼保護，無法直接編輯。請改用「壓縮」分頁的影像化輸出（會移除密碼保護）。`);
    const P = await loadPdfLib();
    const out = await P.PDFDocument.create();
    const cache = new Map();
    let n = 0;
    for (const p of pages) {
      let src = cache.get(p.doc);
      if (!src) { src = await P.PDFDocument.load(st.docs.get(p.doc).buf.slice(0), { ignoreEncryption: true, updateMetadata: false }); cache.set(p.doc, src); }
      const [cp] = await out.copyPages(src, [p.i - 1]);
      if (p.rot) cp.setRotation(P.degrees((((cp.getRotation().angle + p.rot) % 360) + 360) % 360));
      out.addPage(cp);
      onP?.(++n / pages.length);
      if (n % 20 === 0) await new Promise((r) => setTimeout(r)); // 讓出主執行緒
    }
    out.setProducer('Mura PDF編輯器'); out.setCreator('Mura PDF編輯器');
    return out;
  }

  $('#pe-save').addEventListener('click', () => guard(async () => {
    const pages = $('#pe-onlysel').checked && sel().length ? sel() : st.pages;
    status('組合頁面…');
    const doc = await buildDoc(pages, bar);
    const bytes = await doc.save({ useObjectStreams: true });
    const name = ($('#pe-name').value.trim() || 'edited.pdf').replace(/(\.pdf)?$/i, '.pdf');
    download(blobPdf(bytes), name);
    showResult(`<b>已輸出 ${pages.length} 頁</b><span>${escapeHtml(name)}　·　${fmtSize(bytes.length)}</span>`);
    status('');
  }));

  $('#pe-split').addEventListener('click', () => guard(async () => {
    const mode = $('#pe-smode').value;
    const n = st.pages.length;
    let groups;
    if (mode === 'each') groups = st.pages.map((_, i) => [i]);
    else if (mode === 'n') {
      const k = Math.max(1, Math.floor(Number($('#pe-sn').value) || 1));
      groups = []; for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
    } else if (mode === 'ranges') groups = parseRanges($('#pe-sr').value, n);
    else { groups = [st.pages.map((p, i) => (p.sel ? i : -1)).filter((i) => i >= 0)]; if (!groups[0].length) throw new Error('請先在上方選取要抽出的頁面。'); }
    const base = baseName(st.docs.size === 1 ? [...st.docs.values()][0].name : 'split');
    const files = [];
    for (let g = 0; g < groups.length; g++) {
      status(`建立第 ${g + 1}/${groups.length} 個檔案…`); bar(g / groups.length);
      const doc = await buildDoc(groups[g].map((i) => st.pages[i]));
      const first = groups[g][0] + 1, last = groups[g][groups[g].length - 1] + 1;
      const label = mode === 'sel' ? 'extract' : first === last ? `p${first}` : `p${first}-${last}`;
      files.push({ name: `${base}_${label}.pdf`, data: await doc.save({ useObjectStreams: true }) });
      await new Promise((r) => setTimeout(r));
    }
    if (files.length === 1) download(blobPdf(files[0].data), files[0].name);
    else download(await makeZip(files), `${base}_split.zip`);
    showResult(`<b>已拆成 ${files.length} 個檔案</b><span>${files.length > 1 ? 'ZIP 內含：' + escapeHtml(files.slice(0, 4).map((f) => f.name).join('、')) + (files.length > 4 ? '…' : '') : escapeHtml(files[0].name)}</span>`);
    status('');
  }));

  /** 影像化壓縮 */
  async function rasterize(pages, o, onP) {
    const P = await loadPdfLib();
    const out = await P.PDFDocument.create();
    for (let k = 0; k < pages.length; k++) {
      const p = pages[k];
      const page = await st.docs.get(p.doc).pdf.getPage(p.i);
      const rotation = (((page.rotate + p.rot) % 360) + 360) % 360;
      const v1 = page.getViewport({ scale: 1, rotation });
      let scale = o.dpi / 72;
      if (v1.width * v1.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (v1.width * v1.height));
      const vp = page.getViewport({ scale, rotation });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
      const x = c.getContext('2d', { willReadFrequently: o.gray });
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      if (o.gray) {
        const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
        for (let i = 0; i < a.length; i += 4) { const g = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000; a[i] = a[i + 1] = a[i + 2] = g; }
        x.putImageData(d, 0, 0);
      }
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', o.q / 100));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pg = out.addPage([v1.width, v1.height]);
      pg.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
      c.width = c.height = 0; page.cleanup();
      onP?.((k + 1) / pages.length);
    }
    out.setProducer('Mura PDF編輯器');
    return out;
  }

  $('#pe-shrink').addEventListener('click', () => guard(async () => {
    const pages = st.pages;
    const origin = [...new Set(pages.map((p) => p.doc))].reduce((a, id) => a + st.docs.get(id).size, 0);
    let bytes;
    const t0 = performance.now();
    if (preset === 'lossless') {
      status('整理結構…');
      const doc = await buildDoc(pages, bar);
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
      bytes = await doc.save({ useObjectStreams: true });
    } else {
      const o = { dpi: Number($('#pe-dpi').value), q: Number($('#pe-jq').value), gray: $('#pe-gray').checked };
      status('逐頁壓縮中…（大檔案需要一些時間）');
      const doc = await rasterize(pages, o, (p) => { bar(p); status(`逐頁壓縮中… ${Math.round(p * pages.length)}/${pages.length} 頁`); });
      bytes = await doc.save({ useObjectStreams: true });
    }
    const name = `${st.docs.size === 1 ? baseName([...st.docs.values()][0].name) : 'merged'}_compressed.pdf`;
    const saved = 1 - bytes.length / origin;
    const usedTotal = [...new Set(pages.map((p) => p.doc))].reduce((a, id) => a + st.docs.get(id).n, 0);
    const dropNote = pages.length < usedTotal ? `（原檔含已刪除的 ${usedTotal - pages.length} 頁）` : '';
    status('');
    if (bytes.length >= origin) showResult(`<b class="warn">結果沒有比原檔小</b><span>原檔 ${fmtSize(origin)}${dropNote} → 結果 ${fmtSize(bytes.length)}。建議保留原檔，或換成更低的解析度／品質。已仍然下載供你比較。</span>`);
    else showResult(`<b>縮小 ${(saved * 100).toFixed(1)}%</b><span>${fmtSize(origin)}${dropNote} → ${fmtSize(bytes.length)}（${pages.length} 頁，耗時 ${((performance.now() - t0) / 1000).toFixed(1)} 秒）</span>`);
    download(blobPdf(bytes), name);
  }));

  root.querySelector('[data-pre="strong"]').click();
  renderAll();
  return () => {
    io?.disconnect(); st.q.length = 0;
    st.docs.forEach((d) => d.pdf.destroy());
    st.urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
