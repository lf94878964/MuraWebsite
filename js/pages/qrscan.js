// QR Code 掃描器：相機（getUserMedia）與圖片（上傳／拖放／貼上）。解碼用 jsQR，全部在本機。
import { copyText, toast, escapeHtml } from '../core/ui.js';
import { loadJsQR } from '../tools/qr-lib.js';

const MAX_FILE = 20 * 1024 * 1024;

function parseWifi(t) {
  if (!/^WIFI:/i.test(t)) return null;
  const body = t.slice(5);
  const out = {};
  let key = '', val = '', inVal = false, esc = false;
  const flush = () => { if (key) out[key.toUpperCase()] = val; key = ''; val = ''; inVal = false; };
  for (const ch of body) {
    if (esc) { (inVal ? (val += ch) : (key += ch)); esc = false; }
    else if (ch === '\\') esc = true;
    else if (ch === ':' && !inVal) inVal = true;
    else if (ch === ';') flush();
    else (inVal ? (val += ch) : (key += ch));
  }
  flush();
  return out.S !== undefined ? out : null;
}

function classify(text) {
  const w = parseWifi(text);
  if (w) return { type: 'Wi-Fi', wifi: w };
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const warns = [];
      if (u.protocol === 'http:') warns.push('這是未加密的 http 連線。');
      if (/(^|\.)xn--/i.test(u.hostname)) warns.push('網域含 xn-- 國際化編碼，可能是外觀相似的假網站。');
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) warns.push('網址直接使用 IP，而不是網域名稱。');
      if (u.username || u.password) warns.push('網址內含帳號或密碼資訊，可能用來偽裝網域。');
      return { type: '網址', url: u, warns };
    } catch { /* 當成文字 */ }
  }
  if (/^mailto:/i.test(text)) return { type: '電子郵件' };
  if (/^tel:/i.test(text)) return { type: '電話' };
  if (/^smsto?:/i.test(text)) return { type: '簡訊' };
  if (/^geo:/i.test(text)) return { type: '座標' };
  if (/^BEGIN:VCARD/i.test(text)) return { type: '聯絡人 vCard' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return { type: '其他連結（不提供直接開啟）' };
  return { type: '文字' };
}

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const st = { stream: null, loop: 0, busy: false, last: '', lastAt: 0, jsQR: null, results: [] };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const errEl = $('#qs-err');
  const setErr = (m) => { errEl.textContent = m || ''; };

  /* ── 結果 ── */
  function addResult(text, source, thumb) {
    const c = classify(text);
    st.results.unshift({ text, source, c, thumb, at: new Date() });
    renderResults();
  }
  function renderResults() {
    const box = $('#qs-results');
    $('#qs-clear').disabled = !st.results.length;
    $('#qs-count').textContent = st.results.length ? `共 ${st.results.length} 筆` : '';
    if (!st.results.length) { box.innerHTML = '<p class="tk-hint" id="qs-none">還沒有結果。開啟相機或上傳圖片後會顯示在這裡。</p>'; return; }
    box.innerHTML = st.results.map((r, i) => {
      const { c } = r;
      let body;
      if (c.wifi) {
        body = `<div class="qs-kv"><span>網路名稱</span><span>${escapeHtml(c.wifi.S || '')}</span><span>密碼</span><span>${escapeHtml(c.wifi.P || '（無）')}</span><span>加密</span><span>${escapeHtml(c.wifi.T || '—')}</span>${c.wifi.H ? '<span>隱藏網路</span><span>是</span>' : ''}</div>`;
      } else if (c.url) {
        body = `<div class="qs-host">${escapeHtml(c.url.hostname)}</div><div class="qs-text">${escapeHtml(r.text)}</div>${c.warns.map((w) => `<div class="qs-warn">⚠ ${escapeHtml(w)}</div>`).join('')}`;
      } else body = `<div class="qs-text">${escapeHtml(r.text)}</div>`;
      const actions = [`<button class="tk-copy" type="button" data-copy="${i}">複製內容</button>`];
      if (c.wifi?.P) actions.push(`<button class="tk-copy" type="button" data-copypw="${i}">複製密碼</button>`);
      if (c.url) actions.push(`<a class="tk-chip" href="${escapeHtml(c.url.href)}" target="_blank" rel="noopener noreferrer nofollow">前往連結 ↗</a>`);
      return `<div class="qs-item"><div class="qs-top"><span class="qs-badge">${escapeHtml(c.type)}</span><span>${escapeHtml(r.source)}　${r.at.toLocaleTimeString('zh-TW', { hour12: false })}</span></div>${r.thumb ? `<img class="qs-thumb" src="${r.thumb}" alt="" />` : ''}${body}<div class="tk-row">${actions.join('')}</div></div>`;
    }).join('');
  }
  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) return toast((await copyText(st.results[c.dataset.copy].text)) ? '已複製' : '複製失敗');
    const p = e.target.closest('[data-copypw]');
    if (p) return toast((await copyText(st.results[p.dataset.copypw].c.wifi.P)) ? '已複製密碼' : '複製失敗');
  });
  $('#qs-clear').addEventListener('click', () => { st.results = []; renderResults(); });

  /* ── 相機 ── */
  function camError(e) {
    if (!window.isSecureContext) return '相機只能在 https 網址（或 localhost）使用。';
    switch (e?.name) {
      case 'NotAllowedError': case 'SecurityError': return '相機權限被拒絕。請點網址列左側的鎖頭／相機圖示，把相機改成「允許」後重新整理，再按一次開啟。';
      case 'NotFoundError': case 'OverconstrainedError': return '找不到可用的相機。你仍可使用下方的「上傳圖片」。';
      case 'NotReadableError': case 'AbortError': return '相機正被其他程式使用，無法開啟。請關閉其他使用相機的程式後再試。';
      default: return `無法開啟相機：${e?.message || e}`;
    }
  }
  async function listDevices(currentId) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const sel = $('#qs-dev');
      sel.hidden = devs.length < 2;
      sel.innerHTML = devs.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `相機 ${i + 1}`)}</option>`).join('');
      if (currentId) sel.value = currentId;
    } catch { /* 沒有也沒關係 */ }
  }
  async function start(deviceId) {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr(window.isSecureContext ? '這個瀏覽器不支援相機存取。' : '相機只能在 https 網址（或 localhost）使用。'); return; }
    stop(true);
    try {
      st.jsQR = await loadJsQR();
      const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
      if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = { ideal: 'environment' };
      st.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) { setErr(e.message?.includes('掃描元件') ? e.message : camError(e)); return; }
    const v = $('#qs-video');
    v.srcObject = st.stream;
    await v.play().catch(() => {});
    $('#qs-cam').dataset.state = 'on';
    $('#qs-start').disabled = true; $('#qs-stop').disabled = false;
    const id = st.stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    await listDevices(id);
    st.last = ''; st.lastAt = 0;
    st.loop = setInterval(tick, 140);
  }
  function stop(silent) {
    clearInterval(st.loop); st.loop = 0;
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    const v = $('#qs-video');
    if (v) v.srcObject = null;
    $('#qs-cam').dataset.state = 'off';
    $('#qs-start').disabled = false; $('#qs-stop').disabled = true;
    if (!silent) setErr('');
  }
  function tick() {
    const v = $('#qs-video');
    if (st.busy || !v || v.readyState < 2 || !v.videoWidth) return;
    st.busy = true;
    try {
      const sc = Math.min(1, 720 / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * sc); canvas.height = Math.round(v.videoHeight * sc);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = st.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' }) || st.jsQR(d.data, d.width, d.height, { inversionAttempts: 'onlyInvert' });
      if (r?.data) {
        const now = Date.now();
        if (r.data !== st.last || now - st.lastAt > 4000) { // 同一個碼 4 秒內不重複記錄
          st.last = r.data; st.lastAt = now;
          addResult(r.data, '相機');
          navigator.vibrate?.(60);
          const cam = $('#qs-cam'); cam.classList.add('hit'); setTimeout(() => cam.classList.remove('hit'), 500);
        } else st.lastAt = now;
        if (!$('#qs-cont').checked) stop(true);
      }
    } finally { st.busy = false; }
  }
  $('#qs-start').addEventListener('click', () => start());
  $('#qs-stop').addEventListener('click', () => stop());
  $('#qs-dev').addEventListener('change', (e) => start(e.target.value));

  /* ── 圖片 ── */
  async function decodeBitmap(bmp) {
    const jsQR = await loadJsQR();
    const W = bmp.width, H = bmp.height;
    const scales = [1, 0.5, 0.25];
    if (Math.max(W, H) < 500) scales.unshift(2, 3);
    for (const s0 of scales) {
      let s = s0;
      if (s <= 1) s = Math.min(s, 1600 / Math.max(W, H)); // 太大的圖先縮
      const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
      if (w < 40 || h < 40) continue;
      canvas.width = w; canvas.height = h;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // 透明 PNG 墊白底
      ctx.imageSmoothingEnabled = s < 1;
      ctx.drawImage(bmp, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h);
      const r = jsQR(d.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
    return null;
  }
  async function handleFiles(files) {
    setErr('');
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) { setErr('請選擇圖片檔（PNG、JPG、WebP 等）。'); return; }
    let miss = 0;
    for (const f of list) {
      if (f.size > MAX_FILE) { setErr(`「${f.name}」超過 20 MB，已略過。`); continue; }
      try {
        const bmp = await createImageBitmap(f);
        const text = await decodeBitmap(bmp);
        let thumb = null;
        if (text) {
          const t = document.createElement('canvas'); const k = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
          t.width = Math.round(bmp.width * k); t.height = Math.round(bmp.height * k);
          t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
          thumb = t.toDataURL('image/jpeg', 0.7);
          addResult(text, f.name, thumb);
        } else miss++;
        bmp.close?.();
      } catch (e) { setErr(e.message?.includes('掃描元件') ? e.message : `無法讀取「${f.name}」。`); }
    }
    if (miss) setErr(`有 ${miss} 張圖片找不到 QR Code。請確認圖片清晰、QR Code 完整（四周要有留白），或裁切後再試。`);
  }
  const fileIn = $('#qs-file');
  fileIn.addEventListener('change', () => { handleFiles(fileIn.files); fileIn.value = ''; });
  const drop = $('#qs-drop');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  const onPaste = (e) => {
    const fs = [...(e.clipboardData?.files || [])];
    if (fs.length) { e.preventDefault(); handleFiles(fs); }
  };
  document.addEventListener('paste', onPaste);
  const onVis = () => { if (document.hidden && st.stream) stop(); };
  document.addEventListener('visibilitychange', onVis);

  renderResults();
  return () => {
    stop(true);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('visibilitychange', onVis);
  };
}
