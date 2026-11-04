// QR Code 產生器：矩陣由 qrcode-generator 產生，外觀（顏色、浮水印、中央小圖）全部畫在 canvas 上。
import { copyText, toast } from '../core/ui.js';
import { makeMatrix, loadJsQR } from '../tools/qr-lib.js';

const MAX_FILE = 10 * 1024 * 1024;
const wifiEsc = (s) => s.replace(/([\\;,:"])/g, '\\$1');

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('請選擇圖片檔。'));
    if (file.size > MAX_FILE) return reject(new Error('圖片超過 10 MB。'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片。')); };
    img.src = url;
  });
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const canvas = $('#qr-canvas');
  const st = { kind: 'text', center: 'none', bgImg: null, logo: null };
  let verifyTimer = 0, verifySeq = 0, rafTimer = 0;

  const val = () => {
    if (st.kind === 'wifi') {
      const ssid = $('#qr-ssid').value;
      if (!ssid) return '';
      const sec = $('#qr-wsec').value;
      return `WIFI:T:${sec};S:${wifiEsc(ssid)};${sec === 'nopass' ? '' : `P:${wifiEsc($('#qr-wpass').value)};`}${$('#qr-whidden').checked ? 'H:true;' : ''};`;
    }
    return $('#qr-text').value;
  };

  function centerActive() {
    if (st.center === 'image') return !!st.logo;
    if (st.center === 'text') return $('#qr-ctext').value.trim().length > 0;
    return false;
  }

  function opts() {
    return {
      fg: $('#qr-fg').value, bg: $('#qr-bg').value, transparent: $('#qr-transp').checked,
      shape: $('#qr-shape').value, size: Number($('#qr-size').value), margin: Number($('#qr-margin').value),
      bgOp: Number($('#qr-bgop').value) / 100, csize: Number($('#qr-csize').value) / 100,
      plate: $('#qr-cplate').checked, circle: $('#qr-ccircle').checked,
    };
  }

  function sync() {
    $('#qr-fg-v').textContent = $('#qr-fg').value;
    $('#qr-bg-v').textContent = $('#qr-bg').value;
    $('#qr-size-v').textContent = `${$('#qr-size').value} px`;
    $('#qr-margin-v').textContent = `${$('#qr-margin').value}`;
    $('#qr-bgop-v').textContent = `${$('#qr-bgop').value}%`;
    $('#qr-csize-v').textContent = `${$('#qr-csize').value}%`;
    $('#qr-bgop').disabled = !st.bgImg;
    $('#qr-bgimg-clear').disabled = !st.bgImg;
    $('#qr-c-image').hidden = st.center !== 'image';
    $('#qr-c-text').hidden = st.center !== 'text';
    $('#qr-c-opts').hidden = st.center === 'none';
    const forced = centerActive();
    $('#qr-ecc').disabled = forced;
    $('#qr-ecc-note').textContent = forced ? '已加入中央小圖：容錯等級自動使用 H（約 30%），以免遮住的部分讓掃描失敗。' : '';
    const t = $('#qr-text').value;
    $('#qr-bytes').textContent = t ? `${new TextEncoder().encode(t).length} bytes` : '';
  }

  function draw() {
    sync();
    const err = $('#qr-err');
    err.textContent = '';
    const text = val();
    const o = opts();
    const empty = $('#qr-empty');
    if (!text) {
      canvas.hidden = true; empty.hidden = false;
      $('#qr-dl').disabled = $('#qr-copy').disabled = true;
      $('#qr-verify').textContent = ''; $('#qr-verify').className = 'qr-verify'; $('#qr-info').textContent = '';
      return;
    }
    let m;
    const ecc = centerActive() ? 'H' : $('#qr-ecc').value;
    try { m = makeMatrix(text, ecc); } catch (e) {
      err.textContent = e.message;
      canvas.hidden = true; empty.hidden = false;
      $('#qr-dl').disabled = $('#qr-copy').disabled = true;
      $('#qr-verify').textContent = '';
      return;
    }
    canvas.hidden = false; empty.hidden = true;
    const n = m.count + o.margin * 2;
    const cell = Math.max(1, Math.floor(o.size / n));
    const px = cell * n;
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, px, px);
    if (!o.transparent) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, px, px); }
    if (st.bgImg) {
      const { img } = st.bgImg;
      const s = Math.max(px / img.width, px / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.save(); ctx.globalAlpha = o.bgOp; ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h); ctx.restore();
    }
    // 模組
    ctx.fillStyle = o.fg;
    const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= m.count - 7) || (r >= m.count - 7 && c < 7);
    for (let r = 0; r < m.count; r++) for (let c = 0; c < m.count; c++) {
      if (!m.dark(r, c)) continue;
      const x = (c + o.margin) * cell, y = (r + o.margin) * cell;
      if (o.shape === 'square' || isFinder(r, c)) ctx.fillRect(x, y, cell, cell);
      else if (o.shape === 'dot') { ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.5, 0, Math.PI * 2); ctx.fill(); }
      else { rr(ctx, x, y, cell, cell, cell * 0.28); ctx.fill(); }
    }
    // 中央小圖
    if (centerActive()) {
      const box = px * o.csize;
      const x = (px - box) / 2, y = (px - box) / 2;
      const pad = box * 0.12;
      if (o.plate) {
        ctx.fillStyle = o.transparent ? '#ffffff' : o.bg;
        if (o.circle) { ctx.beginPath(); ctx.arc(px / 2, px / 2, box / 2 + pad, 0, Math.PI * 2); ctx.fill(); }
        else { rr(ctx, x - pad, y - pad, box + pad * 2, box + pad * 2, box * 0.14); ctx.fill(); }
      }
      ctx.save();
      if (o.circle) { ctx.beginPath(); ctx.arc(px / 2, px / 2, box / 2, 0, Math.PI * 2); ctx.clip(); }
      else if (st.center === 'image') { rr(ctx, x, y, box, box, box * 0.1); ctx.clip(); }
      if (st.center === 'image') {
        const { img } = st.logo;
        const s = Math.min(box / img.width, box / img.height);
        const w = img.width * s, h = img.height * s;
        ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
      } else {
        const t = $('#qr-ctext').value.trim();
        let fs = box * 0.8;
        ctx.font = `700 ${fs}px system-ui, "Noto Sans TC", sans-serif`;
        const w = ctx.measureText(t).width;
        if (w > box) { fs *= box / w; ctx.font = `700 ${fs}px system-ui, "Noto Sans TC", sans-serif`; }
        ctx.fillStyle = o.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t, px / 2, px / 2 + fs * 0.04);
      }
      ctx.restore();
    }
    $('#qr-dl').disabled = $('#qr-copy').disabled = false;
    $('#qr-info').textContent = `${px}×${px} px　·　QR 版本 ${(m.count - 17) / 4}（${m.count}×${m.count} 模組）　·　容錯 ${ecc}`;
    scheduleVerify(text, o);
  }

  function scheduleVerify(text, o) {
    clearTimeout(verifyTimer);
    const v = $('#qr-verify');
    v.className = 'qr-verify';
    const c = contrast(o.fg, o.bg);
    const warns = [];
    if (!o.transparent && lum(o.fg) > lum(o.bg)) warns.push('QR 顏色比背景亮（反色），部分舊式掃描器讀不出來');
    if (!o.transparent && c < 3) warns.push(`顏色對比偏低（${c.toFixed(1)}:1）`);
    v.textContent = '掃描驗證中…';
    const seq = ++verifySeq;
    verifyTimer = setTimeout(async () => {
      try {
        const jsQR = await loadJsQR();
        if (seq !== verifySeq) return;
        // 驗證用：縮到 ≤700px，背景透明時墊白底
        const sc = Math.min(1, 700 / canvas.width);
        const t = document.createElement('canvas');
        t.width = t.height = Math.max(1, Math.round(canvas.width * sc));
        const x = t.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height);
        x.drawImage(canvas, 0, 0, t.width, t.height);
        const d = x.getImageData(0, 0, t.width, t.height);
        let got = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })?.data;
        if (got !== text && 'BarcodeDetector' in window) { // 第二意見：瀏覽器內建（接近手機相機的解碼器）
          try { got = (await new BarcodeDetector({ formats: ['qr_code'] }).detect(t))[0]?.rawValue; } catch { /* 不支援就算了 */ }
        }
        if (seq !== verifySeq) return;
        const ok = got === text;
        if (!ok && o.shape !== 'square') warns.push('圓角／圓點樣式較難被部分掃描器辨識，建議改回方形或實際用手機測試');
        v.className = `qr-verify ${ok && !warns.length ? 'ok' : 'warn'}`;
        v.textContent = ok ? `✓ 掃描驗證通過${warns.length ? `（但${warns.join('；')}）` : ''}` : `⚠ 驗證時無法讀出，實際掃描器可能也讀不到。${warns.join('；')}建議降低浮水印不透明度、加深顏色對比或縮小中央小圖。`;
      } catch { if (seq === verifySeq) v.textContent = ''; }
    }, 350);
  }
  const redraw = () => { cancelAnimationFrame(rafTimer); rafTimer = requestAnimationFrame(draw); };

  /* 事件 */
  root.addEventListener('input', (e) => { if (e.target.closest('input:not([type=file]), textarea, select')) redraw(); });
  root.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox]')) redraw(); });
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      st.kind = k.dataset.kind;
      root.querySelectorAll('[data-kind]').forEach((b) => { const on = b === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      $('#qr-kind-text').hidden = st.kind !== 'text';
      $('#qr-kind-wifi').hidden = st.kind !== 'wifi';
      redraw();
    }
    const c = e.target.closest('[data-center]');
    if (c) {
      st.center = c.dataset.center;
      root.querySelectorAll('[data-center]').forEach((b) => { const on = b === c; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      redraw();
    }
  });
  $('#qr-swap').addEventListener('click', () => { const a = $('#qr-fg').value; $('#qr-fg').value = $('#qr-bg').value; $('#qr-bg').value = a; redraw(); });
  $('#qr-reset-color').addEventListener('click', () => { $('#qr-fg').value = '#000000'; $('#qr-bg').value = '#ffffff'; $('#qr-transp').checked = false; redraw(); });

  async function pickImage(input, slot, nameEl) {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const r = await loadImage(f);
      if (st[slot]) URL.revokeObjectURL(st[slot].url);
      st[slot] = r;
      $(nameEl).textContent = f.name;
      $('#qr-err').textContent = '';
    } catch (e) { $('#qr-err').textContent = e.message; }
    input.value = '';
    draw();
  }
  $('#qr-bgimg').addEventListener('change', (e) => pickImage(e.target, 'bgImg', '#qr-bgimg-name'));
  $('#qr-logo').addEventListener('change', (e) => pickImage(e.target, 'logo', '#qr-logo-name'));
  $('#qr-bgimg-clear').addEventListener('click', () => {
    if (st.bgImg) URL.revokeObjectURL(st.bgImg.url);
    st.bgImg = null; $('#qr-bgimg-name').textContent = '預設：純白背景'; draw();
  });

  function blob() { return new Promise((res) => canvas.toBlob(res, 'image/png')); }
  $('#qr-dl').addEventListener('click', async () => {
    const b = await blob();
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'qrcode.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#qr-copy').addEventListener('click', async () => {
    try {
      const b = await blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      toast('已複製圖片');
    } catch { toast('此瀏覽器不支援複製圖片，請改用下載'); }
  });

  draw();
  return () => {
    clearTimeout(verifyTimer); cancelAnimationFrame(rafTimer); verifySeq++;
    for (const k of ['bgImg', 'logo']) if (st[k]) URL.revokeObjectURL(st[k].url);
  };
}
