// QR Code 共用：產生用的矩陣（qrcode-generator，UTF-8）與解碼用的 jsQR（延遲載入）。
import qrcode from '../vendor/qrcode_UTF8_bridge.js';

export const ECC = { L: 'L', M: 'M', Q: 'Q', H: 'H' };

/** 回傳 { count, dark(r,c) }；內容過長會丟 Error。 */
export function makeMatrix(text, ecc = 'M') {
  const qr = qrcode(0, ecc);
  qr.addData(text, 'Byte');
  try { qr.make(); } catch (e) { throw new Error('內容太長，這個容錯等級放不下；請縮短內容或降低容錯等級。'); }
  const count = qr.getModuleCount();
  return { count, dark: (r, c) => qr.isDark(r, c) };
}

let jsqrPromise;
/** 延遲載入 jsQR（約 250 KB），只有真的要解碼時才下載。 */
export function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/jsQR.js?v=1';
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR 載入失敗')));
    s.onerror = () => { jsqrPromise = null; reject(new Error('無法載入掃描元件，請檢查網路後重試。')); };
    document.head.appendChild(s);
  });
  return jsqrPromise;
}

/** 解碼 ImageData；成功回傳字串，否則 null。 */
export async function decodeImageData(img) {
  const jsQR = await loadJsQR();
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}
