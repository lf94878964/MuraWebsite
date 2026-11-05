# 第三方程式庫（已放入本機，不經 CDN）

| 檔案 | 來源 | 版本 | 授權 |
| --- | --- | --- | --- |
| `qrcode.mjs`、`qrcode_UTF8.mjs` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（Kazuhiko Arase） | 2.0.4 | MIT（授權聲明保留在檔案開頭） |
| `jsQR.js` | [jsQR](https://github.com/cozmo/jsQR)（Cosmo Wolfe） | 1.4.0 | Apache-2.0（見 `jsQR.LICENSE.txt`） |
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib)（Andrew Dillon） | 1.17.1 | MIT（`pdf-lib.LICENSE.txt`） |
| `pdf.min.js`、`pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js)（Mozilla） | 3.11.174 | Apache-2.0（`pdfjs.LICENSE.txt`） |
| `ffmpeg.js`、`814.ffmpeg.js` | [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.10 | MIT |

轉檔引擎核心 `@ffmpeg/core@0.12.6`（約 32 MB，FFmpeg 的 WebAssembly 建置，內含 x264 等，以 GPL 授權散布）**不放在本專案內**，
使用「檔案轉換器」轉影音時才從 jsDelivr 載入（網址在 `js/tools/vendor-loader.js` 的 `FFMPEG_CORE_BASE`），之後由瀏覽器快取。

「QR Code」是 DENSO WAVE INCORPORATED 的註冊商標。
