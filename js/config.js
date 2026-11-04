// 站點全域設定：所有頁面共用的常數都集中在這裡，改一處即可全站生效。

export const SITE_NAME = '千恋＊万花機器人';

export const LOGO_URL =
  'https://images-ext-1.discordapp.net/external/qedYzKKm-vM-qF5sOOs411o40ZRV7iJqPh6niCeSyFo/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/1379034361579438161/415a24c2ad4b19048f120dd9089e55f4.png?format=webp&quality=lossless';

export const INVITE_URL =
  'https://discord.com/oauth2/authorize?client_id=1379034361579438161&permissions=1127517969186039&integration_type=0&scope=bot+applications.commands';

export const SUPPORT_URL = 'https://discord.gg/nNn8GsF5bA';

export const FIREBASE_URL = 'https://murasame-5c56a-default-rtdb.firebaseio.com/bot_stats.json';

// 評論資料 API（Cloudflare Worker，見 dcapi-worker/）
export const REVIEWS_API = 'https://dcapi.murasamebot.com/reviews.json';

// 訪客計數器 API（同一個 Worker，見 dcapi-worker/）
export const VISITS_API = 'https://dcapi.murasamebot.com';

// 網站網址與預設分享圖（圖片放在 /image/）。SEO 產生器與 Discord 嵌入也讀這裡。
export const SITE_URL = 'https://murasamebot.com';

// 機器人誕生時間：2025-06-02 09:50:13 (UTC+8)。用 Date.UTC 避免 Safari 的 ISO 字串解析問題。
export const BORN_UTC = Date.UTC(2025, 5, 2, 1, 50, 13);

const LEGAL_BASE = 'https://murasamebot.com/docs/999-%E6%B3%95%E5%BE%8B%E6%A2%9D%E6%AC%BE/';
export const LEGAL = [
  { label: '服務條款', href: LEGAL_BASE + '1-%E6%9C%8D%E5%8B%99%E6%A2%9D%E6%AC%BE' },
  { label: '隱私權政策', href: LEGAL_BASE + '2-%E9%9A%B1%E7%A7%81%E6%AC%8A%E6%94%BF%E7%AD%96' },
  { label: '使用許可', href: LEGAL_BASE + '4-%E4%BD%BF%E7%94%A8%E8%A8%B1%E5%8F%AF' },
  { label: '語錄提交政策', href: LEGAL_BASE + '5-%E8%AA%9E%E9%8C%84%E6%8F%90%E4%BA%A4%E7%94%B3%E8%AB%8B%E6%94%BF%E7%AD%96' },
];

// 導覽列。spa:true 代表在 index.html 內由中控切換；其餘為整頁跳轉。
export const NAV = [
  { key: 'home',      label: '主頁',     path: '/home',      spa: true },
  { key: 'rules',     label: '使用規範', path: '/rule',      spa: true },
  { key: 'docs',      label: '文檔說明', path: '/docs' },
  { key: 'status',    label: '當前狀態', path: '/status',    spa: true },
  { key: 'tools',     label: '小工具',   path: '/tools',     spa: true,
    children: [
      { key: 'calculator', label: '數學計算機', desc: '純量、向量、矩陣與微積分', path: '/tools/calculator', spa: true },
      { key: 'military',   label: '兵役計算機', desc: '身高體重與疾病判定體位', path: '/tools/military', spa: true },
      { key: 'wordcount',  label: '字數計算機', desc: '字數、字元、段落與一鍵整理', path: '/tools/wordcount', spa: true },
      { key: 'timestamp',  label: 'Unix時間戳', desc: '即時時間戳與日期雙向轉換', path: '/tools/timestamp', spa: true },
      { key: 'password',   label: '密碼產生器', desc: '最長 256 位，可指定允許的符號', path: '/tools/password', spa: true },
      { key: 'uuid',       label: 'UUID產生器', desc: 'v4／v7／v1／v5 等標準 UUID', path: '/tools/uuid', spa: true },
      { key: 'qrcode',     label: 'QR Code產生器', desc: '自訂顏色、浮水印與中央小圖', path: '/tools/qrcode', spa: true },
      { key: 'qrscan',     label: 'QR Code掃描器', desc: '相機掃描或上傳圖片取出連結', path: '/tools/qrscan', spa: true },
    ] },
  { key: 'cooperate', label: '合作夥伴', path: '/cooperate', spa: true },
  { key: 'contact',   label: '聯絡我們', path: '/contact',   spa: true },
];

// 路由表（中控）：每個頁面 = 一份 HTML 片段 + 一份 CSS + 一個可選的 JS 模組。
// 新增頁面只要在 pages/、css/、js/pages/ 各放一個檔案，再來這裡登記即可。
export const ROUTES = {
  home:      { path: '/home',      title: '',         fragment: '/pages/home.html',      css: '/css/home.css',      module: '/js/pages/home.js' },
  rules:     { path: '/rule',      title: '使用規範', fragment: '/pages/rules.html',     css: '/css/rules.css',     module: null },
  status:    { path: '/status',    title: '當前狀態', fragment: '/pages/status.html',    css: '/css/status.css',    module: '/js/pages/status.js' },
  cooperate: { path: '/cooperate', title: '合作夥伴', fragment: '/pages/cooperate.html', css: '/css/cooperate.css', module: '/js/pages/cooperate.js' },
  tools:     { path: '/tools',     title: '小工具',   fragment: '/pages/tools.html',     css: '/css/tools.css',     module: null },
  calculator: { path: '/tools/calculator', title: '數學計算機', nav: 'tools', fragment: '/pages/calculator.html', css: '/css/calculator.css', module: '/js/pages/calculator.js' },
  military:  { path: '/tools/military', title: '兵役計算機', nav: 'tools', fragment: '/pages/military.html', css: '/css/military.css', module: '/js/pages/military.js' },
  wordcount: { path: '/tools/wordcount', title: '字數計算機', nav: 'tools', fragment: '/pages/wordcount.html', css: '/css/wordcount.css', module: '/js/pages/wordcount.js' },
  timestamp: { path: '/tools/timestamp', title: 'Unix時間戳', nav: 'tools', fragment: '/pages/timestamp.html', css: '/css/timestamp.css', module: '/js/pages/timestamp.js' },
  password:  { path: '/tools/password', title: '密碼產生器', nav: 'tools', fragment: '/pages/password.html', css: '/css/password.css', module: '/js/pages/password.js' },
  uuid:      { path: '/tools/uuid', title: 'UUID產生器', nav: 'tools', fragment: '/pages/uuid.html', css: '/css/uuid.css', module: '/js/pages/uuid.js' },
  qrcode:    { path: '/tools/qrcode', title: 'QR Code產生器', nav: 'tools', fragment: '/pages/qrcode.html', css: '/css/qrcode.css', module: '/js/pages/qrcode.js' },
  qrscan:    { path: '/tools/qrscan', title: 'QR Code掃描器', nav: 'tools', fragment: '/pages/qrscan.html', css: '/css/qrscan.css', module: '/js/pages/qrscan.js' },
  contact:   { path: '/contact',   title: '聯絡我們', fragment: '/pages/contact.html',   css: '/css/contact.css',   module: null },
};
