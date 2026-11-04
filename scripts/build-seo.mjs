#!/usr/bin/env node
// SEO 產生器：在專案根目錄執行  node scripts/build-seo.mjs
//
// 它會（可重複執行，結果一致）：
//   1. 為每個頁面產生可直接被爬蟲讀到的靜態 HTML：<title>、description、canonical、Open Graph、
//      Twitter Card、JSON-LD，以及 Discord 的 Component V2 連結預覽（discord:component-embed）。
//      首頁、使用規範、小工具…等頁面也會把內容預先渲染進 <main>，沒執行 JS 的爬蟲也看得到文字。
//   2. 依 doc-manifest.json 為每一篇文檔產生獨立的預覽頁（docs/<id>.html → 網址 /docs/<id>）。
//   3. 產生 sitemap.xml、robots.txt、_redirects（/ciallo 轉址）。
//
// 只用 Node 內建模組，不需要 npm install。Node 18 以上。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { SITE_URL, SITE_NAME, LOGO_URL, INVITE_URL, SUPPORT_URL, ROUTES } = await imp('js/config.js');
const { PAGES, discordEmbed } = await imp('js/seo.js');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p), s);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const abs = (p) => (/^https?:/.test(p) ? p : SITE_URL + p);
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/* ───────────── 圖片：image/ 資料夾 ───────────── */

const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const imgDir = path.join(ROOT, 'image');
const imgFiles = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((f) => IMG_EXT.includes(f.split('.').pop().toLowerCase())).sort() : [];
const notes = [];

function findImage(name) {
  const hit = imgFiles.find((f) => f.replace(/\.[^.]+$/, '').toLowerCase() === String(name).toLowerCase());
  return hit ? `/image/${encodeURIComponent(hit)}` : null;
}

/** 解析 png / jpg 尺寸（og:image:width/height 讓 Discord、Facebook 更快、更穩定地顯示大圖） */
function imageSize(urlPath) {
  try {
    const buf = fs.readFileSync(path.join(ROOT, decodeURIComponent(urlPath)));
    if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch { /* 讀不到就不寫尺寸 */ }
  return null;
}

function pageImage(key) {
  const own = findImage(PAGES[key]?.image ?? key);
  const fallback = findImage('og') || findImage('home') || (imgFiles[0] ? `/image/${encodeURIComponent(imgFiles[0])}` : null);
  const pick = own || fallback;
  if (pick) notes.push(`  ${key.padEnd(10)} -> ${decodeURIComponent(pick)}${own ? '' : '（預設圖）'}`);
  else notes.push(`  ${key.padEnd(10)} -> 找不到 image/ 內的圖片，改用機器人頭像`);
  return pick;
}
const thumb = findImage('logo') || findImage('avatar');

/* ───────────── <head> 區塊 ───────────── */

const START = '<!-- seo:start -->';
const END = '<!-- seo:end -->';

function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(url) })),
  };
}

function headBlock({ title, desc, urlPath, image, schema, embedBody, ogType = 'website', noindex = false }) {
  const url = abs(urlPath);
  const img = image ? abs(image) : null;
  const size = image ? imageSize(image) : null;
  const embed = discordEmbed({ title: title.split(' — ')[0].split('｜')[0], body: embedBody, url, imageUrl: img, thumbUrl: thumb ? abs(thumb) : LOGO_URL });
  const lines = [
    START,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:locale" content="zh_TW" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(img || LOGO_URL)}" />`,
    ...(size ? [`<meta property="og:image:width" content="${size.w}" />`, `<meta property="og:image:height" content="${size.h}" />`] : []),
    `<meta property="og:image:alt" content="${esc(SITE_NAME)}" />`,
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${esc(img || LOGO_URL)}" />`,
    `<script id="discord:component-embed" type="application/vnd.discord.component-embed+json">${embed.text}</script>`,
    ...schema.map((s) => `<script type="application/ld+json">${jsonLd(s)}</script>`),
    END,
  ];
  return { text: lines.join('\n  '), embed };
}

const SITE_SCHEMA = [
  { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/', inLanguage: 'zh-TW' },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Discord',
    url: SITE_URL + '/',
    image: LOGO_URL,
    description: PAGES.home.desc,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
  },
];

/* ───────────── 套進外殼 ───────────── */

function seoBlockRegex() {
  return new RegExp(`${START}[\\s\\S]*?${END}`);
}

/** 讀入外殼（index.html / docs.html）。第一次會把 <title> 換成標記，之後直接替換標記區塊。 */
function loadShell(file) {
  let html = read(file);
  if (!html.includes(START)) html = html.replace(/<title>[\s\S]*?<\/title>/, `${START}\n  ${END}`);
  return html;
}

function applyShell(shell, head, mainHtml, key, css = null) {
  let html = shell.replace(seoBlockRegex(), () => head).replace(/\n\s*<!-- page-css -->\n?\s*<link[^>]*>/g, '');
  // 頁面專屬 CSS 要放在 base.css 之後，優先順序才會和 SPA 動態載入時一致
  if (css) html = html.replace('</head>', () => `  <!-- page-css -->\n  <link rel="stylesheet" href="${css}" />\n</head>`);
  if (mainHtml != null) {
    html = html.replace(/<main id="view"[^>]*>[\s\S]*?<\/main>/, () => `<main id="view" aria-live="polite" data-pre="${key}">${mainHtml}</main>`);
  }
  return html;
}

const indexShell = loadShell('index.html');
const docsShell = loadShell('docs.html');
const outputs = [];

// 先把 index.html 還原成「沒有預渲染」的樣子當作範本，避免預渲染內容被層層複製
const cleanIndex = indexShell.replace(/<main id="view"[^>]*>[\s\S]*?<\/main>/, '<main id="view" aria-live="polite"></main>').replace(/\n\s*<!-- page-css -->\n?\s*<link[^>]*>/g, '');

const routeFiles = {
  home: 'index.html',
  rules: 'rule.html',
  tools: 'tools.html',
  military: 'tools/military.html',
  calculator: 'tools/calculator.html',
  wordcount: 'tools/wordcount.html',
  timestamp: 'tools/timestamp.html',
  password: 'tools/password.html',
  status: 'status.html',
  cooperate: 'cooperate.html',
  contact: 'contact.html',
};

for (const [key, file] of Object.entries(routeFiles)) {
  const p = PAGES[key];
  const route = ROUTES[key];
  const image = pageImage(key);
  const schema = key === 'home' ? SITE_SCHEMA : [breadcrumb([['首頁', '/'], [route.title, p.path]])];
  if (route.nav === 'tools') {
    schema.unshift({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: route.title,
      url: abs(p.path),
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      inLanguage: 'zh-TW',
      description: p.desc,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
    });
  }
  const head = headBlock({ title: p.title, desc: p.desc, urlPath: p.path, image, schema, embedBody: p.embed, });
  const fragment = read(route.fragment.slice(1));
  const shell = cleanIndex.replace(seoBlockRegex(), () => START + '\n  ' + END);
  outputs.push([file, applyShell(shell, head.text, fragment, key, route.css), p.path, head.embed]);
  // /home 也是首頁的舊網址：給一份同內容的頁面，canonical 指回 /
  if (key === 'home') {
    const copy = applyShell(shell, head.text, fragment, key, route.css);
    outputs.push(['home.html', copy, '/home', head.embed]);
  }
}

// docs.html（文檔首頁）
{
  const p = PAGES.docs;
  const head = headBlock({ title: p.title, desc: p.desc, urlPath: p.path, image: pageImage('docs'), schema: [breadcrumb([['首頁', '/'], ['文檔說明', '/docs']])], embedBody: p.embed });
  outputs.push(['docs.html', applyShell(docsShell, head.text, null, 'docs'), p.path, head.embed]);
}

/* ───────────── 文檔（doc-manifest.json） ───────────── */

function mdSummary(md) {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|>|[-*+]\s|\d+\.\s|\||!\[|<)/.test(b));
  if (!text) return '';
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 110 ? plain.slice(0, 109) + '…' : plain;
}

const docUrls = [];
if (exists('doc-manifest.json')) {
  const manifest = JSON.parse(read('doc-manifest.json'));
  const docImage = pageImage('docs');
  for (const sec of manifest.sections || []) {
    for (const d of sec.children || []) {
      let desc = '';
      try { desc = mdSummary(read(d.file.replace(/^\/+/, ''))); } catch { /* 找不到 md 就用預設描述 */ }
      desc ||= `${d.title}：千恋＊万花機器人文檔「${sec.title}」章節。`;
      const urlPath = `/docs/${encPath(d.id)}`;
      const title = `${d.title} — 文檔說明${' — ' + SITE_NAME}`;
      const head = headBlock({
        title, desc, urlPath, image: docImage, ogType: 'article',
        schema: [
          { '@context': 'https://schema.org', '@type': 'TechArticle', headline: d.title, description: desc, inLanguage: 'zh-TW', url: abs(urlPath), isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/' } },
          breadcrumb([['首頁', '/'], ['文檔說明', '/docs'], [d.title, urlPath]]),
        ],
        embedBody: `${sec.title}\n${desc}`,
      });
      outputs.push([`docs/${d.id}.html`, applyShell(docsShell, head.text, null, 'docs'), urlPath, head.embed]);
      docUrls.push(urlPath);
    }
  }
} else {
  notes.push('  找不到 doc-manifest.json：未產生各篇文檔的預覽頁（先執行 node generate-manifest.js）');
}

/* ───────────── 寫檔 ───────────── */

for (const [file, html] of outputs) write(file, html);

const today = new Date().toISOString().slice(0, 10);
const sitemapPaths = [...new Set([...Object.values(PAGES).map((p) => p.path), ...docUrls])];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sitemapPaths.map((u) => `  <url><loc>${esc(abs(u === '/' ? '/' : u))}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`
);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
write(
  '_redirects',
  `# Cloudflare Pages 轉址（第一個符合的規則生效）\n/ciallo https://www.youtube.com/watch?v=QDia3e12czc 302\n/ciallo/ https://www.youtube.com/watch?v=QDia3e12czc 302\n`
);

console.log(`已產生 ${outputs.length} 個頁面、sitemap.xml（${sitemapPaths.length} 個網址）、robots.txt、_redirects`);
console.log('分享圖片使用情況（image/ 資料夾）：\n' + notes.join('\n'));
const sizes = outputs.map((o) => o[3]).filter(Boolean);
console.log(`Discord 嵌入最大 ${Math.max(...sizes.map((s) => s.bytes))} bytes（上限 3000）、最多 ${Math.max(...sizes.map((s) => s.componentCount))} 個元件（上限 40）`);
