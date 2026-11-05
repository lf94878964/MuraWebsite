// 檔案轉換器：圖片（canvas）、PDF（pdf.js / pdf-lib）、音訊與影片（ffmpeg.wasm）。全部在瀏覽器內完成。
import { toast, escapeHtml } from '../core/ui.js';
import { loadPdfLib, loadPdfJs, getFFmpeg, resetFFmpeg } from '../tools/vendor-loader.js';
import { makeZip } from '../tools/zip.js';

const EXT = {
  image: 'png jpg jpeg jfif webp gif bmp avif svg ico apng'.split(' '),
  pdf: ['pdf'],
  audio: 'mp3 wav ogg oga m4a aac flac opus weba wma amr aiff aif'.split(' '),
  video: 'mp4 m4v mov webm mkv avi flv wmv 3gp mpg mpeg ogv ts'.split(' '),
};
const TARGETS = {
  image: [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['bmp', 'BMP'], ['pdf', 'PDF']],
  pdf: [['png', 'PNG（每頁一張）'], ['jpg', 'JPG（每頁一張）'], ['webp', 'WebP（每頁一張）'], ['txt', '純文字 TXT']],
  audio: [['mp3', 'MP3'], ['wav', 'WAV'], ['m4a', 'M4A（AAC）'], ['ogg', 'OGG'], ['flac', 'FLAC']],
  video: [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF 動圖'], ['mp3', '只取音訊 MP3'], ['m4a', '只取音訊 M4A'], ['wav', '只取音訊 WAV']],
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' };
const KIND_LABEL = { image: '圖片', pdf: 'PDF', audio: '音訊', video: '影片' };
const MAX_PIXELS = 48e6;

const extOf = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
const baseOf = (n) => (n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n);
function kindOf(f) {
  const e = extOf(f.name);
  for (const k of Object.keys(EXT)) if (EXT[k].includes(e)) return k;
  if (f.type.startsWith('image/')) return 'image';
  if (f.type === 'application/pdf') return 'pdf';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('video/')) return 'video';
  return null;
}
function defaultTarget(kind, f) {
  const e = extOf(f.name);
  if (kind === 'image') return e === 'png' ? 'jpg' : e === 'jpg' || e === 'jpeg' ? 'png' : 'png';
  if (kind === 'pdf') return 'jpg';
  if (kind === 'audio') return e === 'mp3' ? 'wav' : 'mp3';
  return e === 'mp4' ? 'webm' : 'mp4';
}
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);

/* ───── 圖片工具 ───── */
async function decodeImage(file) {
  const e = extOf(file.name);
  if (e !== 'svg') {
    try { const b = await createImageBitmap(file); return { src: b, w: b.width, h: b.height, close: () => b.close?.() }; } catch { /* 改用 <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('這個圖片格式瀏覽器無法讀取')); img.src = url; });
  const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
  return { src: img, w, h, close: () => URL.revokeObjectURL(url) };
}
function fitSize(w, h, maxSide) {
  let s = maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  if (w * h * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (w * h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
function drawToCanvas(dec, maxSide, bg) {
  const [w, h] = fitSize(dec.w, dec.h, maxSide);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.imageSmoothingQuality = 'high';
  x.drawImage(dec.src, 0, 0, w, h);
  return c;
}
const toBlob = (c, mime, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('此瀏覽器無法輸出這種格式'))), mime, q));
function bmpBlob(c) {
  const w = c.width, h = c.height;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = new ArrayBuffer(54 + row * h);
  const v = new DataView(buf);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, buf.byteLength, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  const u = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; u[o++] = d[i + 2]; u[o++] = d[i + 1]; u[o++] = d[i]; }
  }
  return new Blob([buf], { type: 'image/bmp' });
}
async function canvasToFormat(c, fmt, quality) {
  if (fmt === 'bmp') return bmpBlob(c);
  const b = await toBlob(c, MIME[fmt], fmt === 'png' ? undefined : quality);
  if (b.type !== MIME[fmt]) throw new Error(`這個瀏覽器不支援輸出 ${fmt.toUpperCase()}`);
  return b;
}

const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
const hex2rgb = (h, PDFLib) => PDFLib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/* items: [{file, kind}]；回傳 PDF Blob */
async function buildPdf(items, o, onItem) {
  const P = await loadPdfLib();
  const doc = await P.PDFDocument.create();
  let n = 0;
  for (const it of items) {
    onItem?.(n++, it);
    if (it.kind === 'pdf') {
      const src = await P.PDFDocument.load(await it.file.arrayBuffer(), { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      continue;
    }
    const e = extOf(it.file.name);
    const dec = await decodeImage(it.file);
    let emb;
    try {
      const noResize = !o.maxSide || Math.max(dec.w, dec.h) <= o.maxSide;
      if (noResize && (e === 'jpg' || e === 'jpeg' || it.file.type === 'image/jpeg')) emb = await doc.embedJpg(new Uint8Array(await it.file.arrayBuffer()));
      else if (noResize && e === 'png' && it.file.type === 'image/png') emb = await doc.embedPng(new Uint8Array(await it.file.arrayBuffer()));
      else {
        const c = drawToCanvas(dec, o.maxSide, o.bg);
        emb = await doc.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', o.q)).arrayBuffer()));
      }
    } finally { dec.close(); }
    let [pw, ph] = [emb.width, emb.height];
    const m = o.margin;
    if (o.psize !== 'fit') {
      [pw, ph] = PAGE[o.psize];
      if (emb.width > emb.height) [pw, ph] = [ph, pw];
    } else { pw += m * 2; ph += m * 2; }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - m * 2) / emb.width, (ph - m * 2) / emb.height);
    const w = emb.width * s, h = emb.height * s;
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  doc.setProducer('Mura 檔案轉換器'); doc.setCreator('Mura 檔案轉換器');
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  task.onPassword = (cb, reason) => {
    const pw = window.prompt(reason === 2 ? '密碼錯誤，請重新輸入：' : `「${file.name}」需要密碼：`);
    if (pw === null) task.destroy(); else cb(pw);
  };
  return task.promise;
}
async function pdfToOutputs(file, fmt, o, onPage) {
  const pdf = await openPdf(file);
  const out = [];
  const base = baseOf(file.name);
  const pad = String(pdf.numPages).length;
  if (fmt === 'txt') {
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      onPage?.(i, pdf.numPages);
      const tc = await (await pdf.getPage(i)).getTextContent();
      text += tc.items.map((t) => t.str + (t.hasEOL ? '\n' : '')).join('') + '\n\n';
    }
    out.push({ name: `${base}.txt`, blob: new Blob([text.trim() ? text : '（這份 PDF 沒有可擷取的文字，可能是掃描檔）'], { type: MIME.txt }) });
  } else {
    for (let i = 1; i <= pdf.numPages; i++) {
      onPage?.(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const base1 = page.getViewport({ scale: 1 });
      let scale = o.dpi / 72;
      if (base1.width * base1.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base1.width * base1.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const x = c.getContext('2d');
      x.fillStyle = fmt === 'png' || fmt === 'webp' ? '#fff' : '#fff';
      x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      out.push({ name: `${base}${pdf.numPages > 1 ? `-p${String(i).padStart(pad, '0')}` : ''}.${fmt}`, blob: await canvasToFormat(c, fmt, o.q / 100) });
      c.width = c.height = 0;
      page.cleanup();
    }
  }
  pdf.destroy();
  return out;
}

/* ───── ffmpeg ───── */
function ffArgs(kind, target, o) {
  const vf = [];
  if (kind === 'video' && o.vh) vf.push(`scale=-2:'min(${o.vh},ih)'`);
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  switch (target) {
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-b:a', `${o.ab}k`];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'm4a': return ['-vn', '-c:a', 'aac', '-b:a', `${o.ab}k`];
    case 'ogg': return ['-vn', '-c:a', 'libvorbis', '-b:a', `${o.ab}k`];
    case 'flac': return ['-vn', '-c:a', 'flac'];
    case 'mp4': return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf), '-pix_fmt', 'yuv420p', '-vf', [...vf, even].join(','), '-c:a', 'aac', '-b:a', `${o.ab}k`, '-movflags', '+faststart'];
    case 'webm': return ['-c:v', 'libvpx', '-b:v', '0', '-crf', String(Math.min(40, Math.round(o.crf * 0.9))), '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', ...(vf.length ? ['-vf', vf.join(',')] : []), '-c:a', 'libvorbis', '-b:a', `${o.ab}k`];
    case 'gif': return ['-t', String(o.gt), '-an', '-vf', `fps=${o.gf},scale=${o.gw}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-loop', '0'];
    default: throw new Error('不支援的輸出格式');
  }
}
async function ffConvert(file, kind, target, o, cb) {
  const ff = await getFFmpeg((p) => cb.load?.(p));
  const id = Math.random().toString(36).slice(2, 8);
  const inName = `in_${id}.${extOf(file.name) || 'bin'}`;
  const outName = `out_${id}.${target}`;
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) cb.prog?.(progress); };
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 40) logs.shift(); };
  ff.on('progress', onProg); ff.on('log', onLog);
  try {
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    const code = await ff.exec(['-hide_banner', '-i', inName, ...ffArgs(kind, target, o), '-y', outName]);
    if (code !== 0) {
      const hint = logs.filter((l) => /error|invalid|unsupported|not found|does not contain/i.test(l)).slice(-2).join(' ');
      throw new Error(`轉換失敗${hint ? `：${hint}` : '（這個檔案的編碼可能不支援）'}`);
    }
    const data = await ff.readFile(outName);
    return new Blob([data], { type: MIME[target] });
  } finally {
    ff.off('progress', onProg); ff.off('log', onLog);
    try { await ff.deleteFile(inName); } catch { /* 可能已結束 */ }
    try { await ff.deleteFile(outName); } catch { /* 可能未產生 */ }
  }
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const st = { files: [], seq: 0, running: false, cancel: false, results: [], urls: [] };

  const opts = () => ({
    q: Number($('#cv-q').value), maxSide: Number($('#cv-max').value), bg: $('#cv-bg').value,
    dpi: Number($('#cv-dpi').value), psize: $('#cv-psize').value, margin: Number($('#cv-pmargin').value),
    crf: Number($('#cv-vq').value), vh: Number($('#cv-vh').value), ab: Number($('#cv-ab').value),
    gw: Number($('#cv-gw').value), gf: Number($('#cv-gf').value), gt: Math.min(60, Math.max(1, Number($('#cv-gt').value) || 10)),
  });
  const mergeOn = () => !$('#cv-merge-wrap').hidden && $('#cv-merge').checked;
  const err = (m) => { $('#cv-err').textContent = m || ''; };
  const url = (blob) => { const u = URL.createObjectURL(blob); st.urls.push(u); return u; };

  /* ── 檔案清單 ── */
  function addFiles(list) {
    err('');
    let skipped = 0;
    for (const f of list) {
      const kind = kindOf(f);
      if (!kind) { skipped++; continue; }
      st.files.push({ id: ++st.seq, file: f, kind, target: defaultTarget(kind, f), status: '', state: '' });
    }
    if (skipped) err(`有 ${skipped} 個檔案格式不支援，已略過。`);
    renderList(); renderOpts();
  }
  function renderList() {
    $('#cv-count').textContent = st.files.length ? `${st.files.length} 個檔案` : '';
    $('#cv-clear').disabled = !st.files.length || st.running;
    const merge = mergeOn();
    $('#cv-list').innerHTML = st.files.map((f, i) => `
      <div class="cv-row" data-id="${f.id}">
        <span class="cv-badge">${KIND_LABEL[f.kind]}</span>
        <span class="cv-name"><b title="${escapeHtml(f.file.name)}">${escapeHtml(f.file.name)}</b><small class="${f.state}">${fmtSize(f.file.size)}${f.status ? `　·　${escapeHtml(f.status)}` : ''}</small></span>
        ${merge ? '<span></span>' : `<select data-act="target" aria-label="轉成">${TARGETS[f.kind].map(([v, n]) => `<option value="${v}"${v === f.target ? ' selected' : ''}>${n}</option>`).join('')}</select>`}
        <span class="cv-ctl"><button type="button" data-act="up" ${i === 0 || st.running ? 'disabled' : ''} aria-label="上移">↑</button><button type="button" data-act="down" ${i === st.files.length - 1 || st.running ? 'disabled' : ''} aria-label="下移">↓</button><button type="button" data-act="del" ${st.running ? 'disabled' : ''} aria-label="移除">✕</button></span>
      </div>`).join('');
    const mergeable = st.files.length > 0 && st.files.every((f) => f.kind === 'image' || f.kind === 'pdf');
    $('#cv-merge-wrap').hidden = !(mergeable && st.files.length >= 2);
    if ($('#cv-merge-wrap').hidden) $('#cv-merge').checked = false;
    $('#cv-run').disabled = !st.files.length || st.running;
  }
  function renderOpts() {
    const merge = mergeOn();
    const kinds = new Set(st.files.map((f) => f.kind));
    const tg = (k, t) => st.files.some((f) => f.kind === k && (Array.isArray(t) ? t.includes(f.target) : f.target === t));
    $('#cv-o-img').hidden = !(kinds.has('image') && (merge || tg('image', ['jpg', 'webp', 'png', 'bmp', 'pdf'])));
    $('#cv-o-pdfimg').hidden = !(kinds.has('pdf') && !merge && tg('pdf', ['png', 'jpg', 'webp']));
    $('#cv-o-pdf').hidden = !(merge || tg('image', 'pdf'));
    $('#cv-o-av').hidden = !(kinds.has('audio') || kinds.has('video'));
    // 全部轉成
    const avail = new Map();
    for (const k of kinds) for (const [v, n] of TARGETS[k]) if (!avail.has(v)) avail.set(v, v.toUpperCase());
    $('#cv-all-wrap').hidden = merge || !st.files.length;
    $('#cv-all').innerHTML = [...avail].map(([v, n]) => `<button class="tk-chip" type="button" data-all="${v}">${n}</button>`).join('');
    $('#cv-q-v').textContent = `${$('#cv-q').value}`;
    $('#cv-dpi-v').textContent = `${$('#cv-dpi').value} dpi`;
    $('#cv-pmargin-v').textContent = `${$('#cv-pmargin').value} pt`;
  }
  root.addEventListener('click', (e) => {
    const all = e.target.closest('[data-all]');
    if (all) { const t = all.dataset.all; st.files.forEach((f) => { if (TARGETS[f.kind].some(([v]) => v === t)) f.target = t; }); renderList(); renderOpts(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const row = b.closest('.cv-row'); const i = st.files.findIndex((f) => f.id === Number(row.dataset.id));
    if (b.dataset.act === 'del') st.files.splice(i, 1);
    else if (b.dataset.act === 'up' && i > 0) [st.files[i - 1], st.files[i]] = [st.files[i], st.files[i - 1]];
    else if (b.dataset.act === 'down' && i < st.files.length - 1) [st.files[i + 1], st.files[i]] = [st.files[i], st.files[i + 1]];
    renderList(); renderOpts();
  });
  root.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-act=target]');
    if (s) { const f = st.files.find((x) => x.id === Number(s.closest('.cv-row').dataset.id)); f.target = s.value; renderOpts(); }
  });
  root.addEventListener('input', (e) => { if (e.target.closest('.cv-opts')) renderOpts(); });
  $('#cv-merge').addEventListener('change', () => { renderList(); renderOpts(); });
  $('#cv-clear').addEventListener('click', () => { st.files = []; clearResults(); renderList(); renderOpts(); err(''); });

  const fileIn = $('#cv-file');
  fileIn.addEventListener('change', () => { addFiles(fileIn.files); fileIn.value = ''; });
  const drop = $('#cv-drop');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  const onPaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
  document.addEventListener('paste', onPaste);

  /* ── 結果 ── */
  function clearResults() { st.results = []; $('#cv-out').innerHTML = ''; $('#cv-zip').hidden = true; $('#cv-status').textContent = ''; $('#cv-prog').hidden = true; }
  function renderResults() {
    $('#cv-zip').hidden = st.results.length < 2;
    $('#cv-out').innerHTML = st.results.map((r, i) => {
      const u = r.url ||= url(r.blob);
      const ext = extOf(r.name);
      const prev = ['png', 'jpg', 'webp', 'bmp', 'gif'].includes(ext) ? `<img src="${u}" alt="" />` : `<span class="ph">${escapeHtml(ext)}</span>`;
      const media = ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext) ? `<audio controls preload="none" src="${u}"></audio>` : ['mp4', 'webm'].includes(ext) ? `<video controls preload="metadata" playsinline src="${u}"></video>` : '';
      return `<div class="cv-res">${prev}<span class="cv-name"><b title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</b><small>${fmtSize(r.blob.size)}${r.from ? `　·　原檔 ${fmtSize(r.from)}` : ''}</small></span><a class="tk-copy" href="${u}" download="${escapeHtml(r.name)}">下載</a>${media}</div>`;
    }).join('');
  }
  $('#cv-zip').addEventListener('click', async () => {
    const z = await makeZip(st.results.map((r) => ({ name: r.name, blob: r.blob })));
    const a = document.createElement('a'); a.href = url(z); a.download = 'converted.zip'; a.click();
  });

  /* ── 執行 ── */
  const setBar = (p) => { $('#cv-prog').hidden = false; $('#cv-bar').style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`; };
  function mark(f, status, state = '') { f.status = status; f.state = state; const row = root.querySelector(`.cv-row[data-id="${f.id}"] small`); if (row) { row.className = state; row.textContent = `${fmtSize(f.file.size)}${status ? `　·　${status}` : ''}`; } }

  async function run() {
    err(''); clearResults();
    st.running = true; st.cancel = false;
    $('#cv-run').disabled = true; $('#cv-stop').hidden = false; $('#cv-clear').disabled = true;
    root.querySelectorAll('.cv-ctl button').forEach((b) => { b.disabled = true; });
    const o = opts();
    const total = st.files.length;
    try {
      if (mergeOn()) {
        $('#cv-status').textContent = '合併中…';
        const blob = await buildPdf(st.files, o, (n, it) => { setBar(n / total); $('#cv-status').textContent = `合併中（${n + 1}/${total}）：${it.file.name}`; });
        st.files.forEach((f) => mark(f, '已合併', 'ok'));
        st.results.push({ name: 'merged.pdf', blob, from: st.files.reduce((a, f) => a + f.file.size, 0) });
        setBar(1);
      } else {
        let done = 0;
        for (const f of st.files) {
          if (st.cancel) break;
          mark(f, '轉換中…');
          $('#cv-status').textContent = `（${done + 1}/${total}）${f.file.name} → ${f.target.toUpperCase()}`;
          setBar(done / total);
          try {
            const outs = await convertOne(f, o, (p) => setBar((done + p) / total));
            outs.forEach((x) => st.results.push({ ...x, from: f.file.size }));
            mark(f, `完成（${outs.length > 1 ? `${outs.length} 個檔案` : fmtSize(outs[0].blob.size)}）`, 'ok');
          } catch (e) { if (st.cancel) break; mark(f, e.message || '轉換失敗', 'err'); }
          done++;
          renderResults();
        }
        setBar(st.cancel ? done / total : 1);
      }
      $('#cv-status').textContent = st.cancel ? '已停止。' : `完成：共 ${st.results.length} 個輸出檔。`;
      renderResults();
      if (!st.results.length && !st.cancel) err('沒有成功轉換的檔案。');
    } catch (e) { err(e.message || '轉換失敗'); $('#cv-status').textContent = ''; }
    finally {
      st.running = false; $('#cv-stop').hidden = true; renderList();
    }
  }

  async function convertOne(f, o, onP) {
    const base = baseOf(f.file.name);
    if (f.kind === 'image') {
      if (f.target === 'pdf') return [{ name: `${base}.pdf`, blob: await buildPdf([f], o) }];
      const dec = await decodeImage(f.file);
      try {
        const c = drawToCanvas(dec, o.maxSide, f.target === 'jpg' || f.target === 'bmp' ? o.bg : null);
        return [{ name: `${base}.${f.target}`, blob: await canvasToFormat(c, f.target, o.q / 100) }];
      } finally { dec.close(); }
    }
    if (f.kind === 'pdf') return pdfToOutputs(f.file, f.target, o, (i, n) => { mark(f, `第 ${i}/${n} 頁…`); onP(i / n); });
    // 音訊／影片
    if (f.kind === 'video' && f.target === 'gif' && o.gt > 20) toast('GIF 太長會非常大，建議 10 秒內');
    let loaded = false;
    const blob = await ffConvert(f.file, f.kind, f.target, o, {
      load: (p) => { if (!loaded) { mark(f, `下載轉檔引擎 ${Math.round(p * 100)}%`); setBar(p); } },
      prog: (p) => { loaded = true; mark(f, `轉換中 ${Math.round(p * 100)}%`); onP(p); },
    });
    return [{ name: `${base}.${f.target}`, blob }];
  }

  $('#cv-run').addEventListener('click', run);
  $('#cv-stop').addEventListener('click', () => { st.cancel = true; resetFFmpeg(); $('#cv-status').textContent = '正在停止…'; });

  renderList(); renderOpts();
  return () => {
    st.cancel = true;
    if (st.running) resetFFmpeg();
    st.urls.forEach((u) => URL.revokeObjectURL(u));
    document.removeEventListener('paste', onPaste);
  };
}
