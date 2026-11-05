// SEO / 分享預覽的共用資料。
// 兩個地方會用到：
//   1. scripts/build-seo.mjs（Node）：為每個頁面產生靜態的 <head>（OG、JSON-LD、Discord 嵌入）、sitemap.xml
//   2. js/core/router.js（瀏覽器）：SPA 切頁時同步更新 title / description / canonical
// 改文案只改這一個檔案，重新執行 `node scripts/build-seo.mjs` 即可。
import { SITE_NAME, SITE_URL, INVITE_URL, SUPPORT_URL, LOGO_URL } from './config.js';

export const SEO_SUFFIX = ` — ${SITE_NAME}`;

/**
 * key = ROUTES 的 key（docs 另算）。
 * path：對外的正式網址（canonical）。image：圖片檔名主體，對應 image/<名稱>.(png|jpg|webp)，找不到就退回 image/og.*。
 * embed：Discord 嵌入卡片的內文（Discord markdown）。
 */
export const PAGES = {
  home: {
    path: '/',
    title: `${SITE_NAME}｜Discord 語錄、賭博、抽象與實用工具機器人`,
    desc: '千恋＊万花機器人提供數數系統、計算機、兵役計算機、嘎拉給木語錄、虛擬賭博、婚姻與成就系統等功能，免費邀請到你的 Discord 伺服器。',
    image: 'home',
    embed: '語錄、賭博、抽象、應有盡有。\n數數系統、計算機、兵役計算機、虛擬賭博、婚姻與成就系統，一個機器人全部搞定。',
  },
  rules: {
    path: '/rule',
    title: `使用規範${SEO_SUFFIX}`,
    desc: '使用千恋＊万花機器人前請先了解的規則與注意事項。',
    image: 'rule',
    embed: '使用機器人前，請先了解這些規則與注意事項。',
  },
  docs: {
    path: '/docs',
    title: `文檔說明${SEO_SUFFIX}`,
    desc: '千恋＊万花機器人的完整文檔：指令說明、功能教學、計算機與數數系統的使用方式，以及服務條款與隱私權政策。',
    image: 'docs',
    embed: '指令說明、功能教學與各項條款，都整理在文檔裡。',
  },
  tools: {
    path: '/tools',
    title: `小工具${SEO_SUFFIX}`,
    desc: '千恋＊万花機器人的網頁小工具：從 Discord 機器人移植的實用計算工具，全程在瀏覽器內運算。',
    image: 'tools',
    embed: '從機器人移植到網頁的實用工具，全程在瀏覽器內運算。',
  },
  military: {
    path: '/tools/military',
    title: `兵役計算機${SEO_SUFFIX}`,
    desc: '輸入身高體重並勾選疾病，依國防部《體位區分標準》修正草案（10/31 施行新制）判定常備役、替代役或免役；計算在瀏覽器完成，結果僅供參考。',
    image: 'military',
    embed: '輸入身高體重並勾選疾病，依國防部《體位區分標準》修正草案（10/31 施行新制）判定常備役、替代役或免役。\n-# 僅供參考，實際體位以徵兵檢查醫師及體位審查結果為準。',
  },
  calculator: {
    path: '/tools/calculator',
    title: `數學計算機${SEO_SUFFIX}`,
    desc: '網頁版數學計算機，與 Discord 機器人使用同一個 SymPy 引擎：支援純量、向量、矩陣、極限、積分、級數、數論與統計函數，並附詳細計算步驟；計算在瀏覽器內完成。',
    image: 'calculator',
    embed: '支援純量、向量、矩陣、微積分、數論與統計函數，並附詳細計算步驟。\n-# 計算在瀏覽器內完成，與機器人 /計算機 使用同一個引擎。',
  },
  wordcount: {
    path: '/tools/wordcount',
    title: `字數計算機${SEO_SUFFIX}`,
    desc: '免費線上字數計算機：即時統計總字數、字元數（含／不含空格）、中文字數、英文單字、數字、標點、段落與行數，並可一鍵複製純文字、清空與清除多餘空格空行；全程在瀏覽器內完成。',
    image: 'tools',
    embed: '即時統計字數、字元、中文字、英文單字、段落與行數，並可一鍵清除多餘空格與空行。',
  },
  timestamp: {
    path: '/tools/timestamp',
    title: `Unix時間戳${SEO_SUFFIX}`,
    desc: '線上 Unix 時間戳轉換工具：即時顯示目前時間戳，支援秒、毫秒、微秒、奈秒與任意時區的雙向轉換，並可一鍵複製 Discord 時間戳格式。',
    image: 'tools',
    embed: '即時 Unix 時間戳、日期雙向轉換，並可一鍵複製 Discord 時間戳格式。',
  },
  password: {
    path: '/tools/password',
    title: `密碼產生器${SEO_SUFFIX}`,
    desc: '線上隨機密碼產生器：可自訂 8～256 字元長度與大小寫、數字、特殊符號，使用瀏覽器密碼學安全亂數，並即時評估密碼強度；密碼不會上傳。',
    image: 'tools',
    embed: '自訂長度與字元種類，用安全亂數產生密碼並即時評估強度。',
  },
  uuid: {
    path: '/tools/uuid',
    title: `UUID產生器${SEO_SUFFIX}`,
    desc: '線上 UUID 產生器：依 RFC 9562 產生 v4 隨機、v7 時間排序、v1／v6、v3／v5 命名空間 UUID 與 Nil／Max，可批次產生、轉換格式，並能解析 UUID 的版本與時間；全程在瀏覽器內完成。',
    image: 'tools',
    embed: '產生 v4／v7／v1／v5 等標準 UUID，可批次產生並解析版本與時間。',
  },
  qrcode: {
    path: '/tools/qrcode',
    title: `QR Code產生器${SEO_SUFFIX}`,
    desc: '免費線上 QR Code 產生器：支援文字、網址與 Wi-Fi，可自訂顏色、背景浮水印（含透明度）與中央小圖，自動驗證可掃描性並下載 PNG；全程在瀏覽器內完成。',
    image: 'tools',
    embed: '自訂顏色、背景浮水印與中央小圖的 QR Code 產生器，可下載 PNG。',
  },
  qrscan: {
    path: '/tools/qrscan',
    title: `QR Code掃描器${SEO_SUFFIX}`,
    desc: '線上 QR Code 掃描器：用相機即時掃描，或上傳、拖放、貼上圖片取出內容與連結；影像只在瀏覽器內處理，不會上傳。',
    image: 'tools',
    embed: '用相機或上傳圖片掃描 QR Code，取出連結與內容。',
  },
  convert: {
    path: '/tools/convert',
    title: `檔案轉換器${SEO_SUFFIX}`,
    desc: '免費線上檔案轉換器：在瀏覽器內轉換 PNG、JPG、WebP、PDF、MP3、MP4 等格式，並能把多個 PDF 或多張圖片合併成一個 PDF；檔案不會上傳。',
    image: 'tools',
    embed: '轉換圖片、PDF、音訊與影片，並可合併多個 PDF 或圖片；檔案不會上傳。',
  },
  pdf: {
    path: '/tools/pdf',
    title: `PDF編輯器${SEO_SUFFIX}`,
    desc: '免費線上 PDF 編輯器：合併、拆分、旋轉、刪除與重新排序頁面，並能把 PDF 極致壓縮；所有處理都在瀏覽器內完成，檔案不會上傳。',
    image: 'tools',
    embed: '合併、拆分、旋轉、排序與極致壓縮 PDF；檔案不會上傳。',
  },
  status: {
    path: '/status',
    title: `當前狀態${SEO_SUFFIX}`,
    desc: '查看千恋＊万花機器人目前的運作狀態與使用統計。',
    image: 'status',
    embed: '查看機器人目前的運作狀態與使用統計。',
  },
  cooperate: {
    path: '/cooperate',
    title: `合作夥伴${SEO_SUFFIX}`,
    desc: '認識與千恋＊万花機器人合作的夥伴與社群。',
    image: 'cooperate',
    embed: '認識與機器人合作的夥伴與社群。',
  },
  contact: {
    path: '/contact',
    title: `聯絡我們${SEO_SUFFIX}`,
    desc: '有問題、建議或申訴？加入千恋＊万花機器人的 Discord 支援群，我們會盡快為你服務。',
    image: 'contact',
    embed: '有問題、建議或申訴？加入支援群，我們會盡快為你服務。',
  },
};

/** 瀏覽器端：SPA 切頁後同步 <head>（Google 會執行 JS，會讀到最終結果） */
export function applyHead(key) {
  const p = PAGES[key];
  if (!p || typeof document === 'undefined') return;
  document.title = p.title;
  const set = (sel, make, attr, value) => {
    let el = document.head.querySelector(sel);
    if (!el) {
      el = make();
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  };
  const meta = (name) => () => Object.assign(document.createElement('meta'), { name });
  set('meta[name="description"]', meta('description'), 'content', p.desc);
  set('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', SITE_URL + p.path);
  document.head.querySelector('meta[property="og:title"]')?.setAttribute('content', p.title);
  document.head.querySelector('meta[property="og:description"]')?.setAttribute('content', p.desc);
  document.head.querySelector('meta[property="og:url"]')?.setAttribute('content', SITE_URL + p.path);
}

/* ───────────── 以下只在 Node 端（產生器）使用 ───────────── */

const ACCENT = 0xff7ca2;

/**
 * Discord Component V2 連結預覽（https://docs.discord.com/developers/link-previews/component-embeds）
 * 規則：頂層只能有 1 個 Container(17)；按鈕只能 link 樣式(style 5)；總大小 ≤ 3000 bytes；元件 ≤ 40。
 */
export function discordEmbed({ title, body, url, imageUrl, thumbUrl }) {
  const head = { type: 10, content: `## ${title}\n${body}` };
  const components = [
    thumbUrl
      ? { type: 9, components: [head], accessory: { type: 11, media: { url: thumbUrl } } }
      : head,
  ];
  if (imageUrl) components.push({ type: 12, items: [{ media: { url: imageUrl } }] });
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({
    type: 1,
    components: [
      { type: 2, style: 5, label: '邀請機器人', url: INVITE_URL },
      { type: 2, style: 5, label: '加入支援群', url: SUPPORT_URL },
      ...(url ? [{ type: 2, style: 5, label: '開啟網頁', url }] : []),
    ],
  });
  const payload = { component: { type: 17, accent_color: ACCENT, components } };
  // 放進 <script> 內：避免 "</script>" 與 "<!--" 提前結束標籤；escape 也算在 3000 bytes 內
  const text = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 3000) throw new Error(`Discord 嵌入超過 3000 bytes（${bytes}）：${title}`);
  return { text, bytes, componentCount: 1 + countComponents(components) };
}

function countComponents(list) {
  let n = 0;
  for (const c of list) {
    n += 1;
    if (c.components) n += countComponents(c.components);
    if (c.accessory) n += 1;
    if (c.items) n += 0; // 圖庫項目不算獨立元件
  }
  return n;
}

export const BRAND = { SITE_NAME, SITE_URL, LOGO_URL };
