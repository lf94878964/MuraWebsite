// 讓 qrcode-generator 以 UTF-8 編碼（中文、emoji 才能被掃描器正確讀出）。
import qrcode from './qrcode.mjs';
import { stringToBytes } from './qrcode_UTF8.mjs';
qrcode.stringToBytes = stringToBytes;
export default qrcode;
export { stringToBytes };
