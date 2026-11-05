// 延遲載入重量級函式庫：只有用到的頁面才會下載。
// pdf-lib / pdf.js / ffmpeg 的包裝程式放在 /js/vendor/（本機）；ffmpeg 的核心（約 32 MB）從 CDN 載入。
const V = '1';
const scripts = new Map();

export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error('無法載入元件，請檢查網路後重試。')); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

export async function loadPdfLib() {
  if (!window.PDFLib) await loadScript(`/js/vendor/pdf-lib.min.js?v=${V}`);
  return window.PDFLib;
}

export async function loadPdfJs() {
  if (!window.pdfjsLib) await loadScript(`/js/vendor/pdf.min.js?v=${V}`);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `/js/vendor/pdf.worker.min.js?v=${V}`;
  return window.pdfjsLib;
}

/* ───── FFmpeg（wasm）───── */
export const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
let ffmpegPromise = null;
let ffmpegInst = null;

async function fetchBlobURL(url, type, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載轉檔引擎失敗（${res.status}）`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got / total);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

/** 取得已載入的 FFmpeg 實例（第一次會下載約 32 MB 的引擎，之後由瀏覽器快取）。 */
export function getFFmpeg(onProgress) {
  if (ffmpegInst) return Promise.resolve(ffmpegInst);
  ffmpegPromise ||= (async () => {
    await loadScript(`/js/vendor/ffmpeg.js?v=${V}`);
    const ff = new window.FFmpegWASM.FFmpeg();
    const coreURL = await fetchBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await fetchBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm', onProgress);
    await ff.load({ coreURL, wasmURL });
    ffmpegInst = ff;
    return ff;
  })().catch((e) => { ffmpegPromise = null; throw e; });
  return ffmpegPromise;
}
export function resetFFmpeg() {
  try { ffmpegInst?.terminate(); } catch { /* 已結束 */ }
  ffmpegInst = null; ffmpegPromise = null;
}
