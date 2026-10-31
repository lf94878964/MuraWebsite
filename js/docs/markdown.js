// 文檔 Markdown 渲染：marked + highlight.js（由 docs.html 以全域 script 載入）
// 擴充語法：==螢光==、^上標^、~下標~、++底線++、> [!NOTE] 提示框、:::info / :::spoiler 色塊

import { escapeHtml } from '../core/ui.js';

/** 章節 ID：保留中日韓文字與英數，其餘轉成連字號 */
export function slugify(raw) {
  const s = String(raw)
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

const ALERT_LABELS = { NOTE: '備註', TIP: '小提醒', IMPORTANT: '重要', WARNING: '警告', CAUTION: '危險' };

/** 把 fenced code 與行內 code 暫時換成佔位符，避免擴充語法誤傷程式碼 */
function protectCode(md) {
  const stash = [];
  const put = (m) => `\u0000${stash.push(m) - 1}\u0000`;
  md = md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, put);
  md = md.replace(/`[^`\n]+`/g, put);
  return { md, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]) };
}

function parseColorBlocks(md, colons) {
  const c = ':'.repeat(colons);
  const re = new RegExp(`^${c}(success|info|warning|danger|spoiler)(?:[ \\t]+([^\\n]+))?\\n([\\s\\S]*?)\\n${c}[ \\t]*$`, 'gim');
  return md.replace(re, (_, type, label, body) => {
    type = type.toLowerCase();
    const inner = body.trim();
    if (type === 'spoiler') {
      const lbl = escapeHtml(label ? label.trim() : '詳細資料');
      return `<details class="cb-spoiler"><summary>${lbl}</summary><div class="cb-spoiler-body">\n\n${inner}\n\n</div></details>\n`;
    }
    return `<div class="cb-block cb-${type}">\n\n${inner}\n\n</div>\n`;
  });
}

function preprocess(src) {
  const { md: guarded, restore } = protectCode(src.replace(/\r\n?/g, '\n'));
  let md = guarded;

  md = md.replace(/==(?=\S)(.+?)(?<=\S)==/g, '<mark>$1</mark>');
  md = md.replace(/\^([^\^\s][^\^\n]*?)\^/g, '<sup>$1</sup>');
  md = md.replace(/(?<!~)~(?!~)([^~\s][^~\n]*?)(?<!~)~(?!~)/g, '<sub>$1</sub>');
  md = md.replace(/\+\+(?=\S)([^+\n]+?)(?<=\S)\+\+/g, '<ins>$1</ins>');

  // > [!NOTE] 自訂標題（可省略）
  md = md.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)((?:\n>[ \t]?[^\n]*)*)/gim,
    (_, type, custom, rest) => {
      type = type.toUpperCase();
      const title = escapeHtml(custom.trim() || ALERT_LABELS[type]);
      const body = rest.replace(/^\n>[ \t]?/gm, '\n').trim();
      return `<div class="gh-alert ${type.toLowerCase()}"><div class="gh-alert-title">${title}</div><div class="gh-alert-body">\n\n${body}\n\n</div></div>\n`;
    }
  );

  md = parseColorBlocks(md, 4);
  md = parseColorBlocks(md, 3);
  return restore(md);
}

function highlight(code, lang) {
  const hljs = window.hljs;
  if (hljs && lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

export function renderMarkdown(src) {
  const marked = window.marked;
  if (!marked) throw new Error('Markdown 解析器 (marked) 載入失敗');

  const used = new Map();
  const renderer = new marked.Renderer();

  // 章節標題：穩定且不重複的 id，並附上「複製連結」錨點（獨立於標題文字，避免整段文字變成連結）
  renderer.heading = (text, level, raw) => {
    let id = slugify(raw);
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    return `<h${level} id="${id}">${text}<a class="hanchor" href="#${encodeURIComponent(id)}" aria-label="複製此章節連結"></a></h${level}>\n`;
  };

  renderer.code = (code, infostring) => {
    const lang = (infostring || '').match(/\S*/)[0];
    const label = lang ? escapeHtml(lang) : 'text';
    return (
      `<div class="codeblock"><div class="codeblock-bar"><span class="codeblock-lang">${label}</span>` +
      `<button class="codeblock-copy" type="button">複製</button></div>` +
      `<pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ''}">${highlight(code, lang)}</code></pre></div>\n`
    );
  };

  const baseTable = marked.Renderer.prototype.table;
  renderer.table = function (header, body) {
    return `<div class="table-wrap">${baseTable.call(this, header, body)}</div>`;
  };

  renderer.link = (href, title, text) => {
    const external = /^https?:\/\//i.test(href || '') && !href.startsWith(location.origin);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${href}"${t}${attrs}>${text}</a>`;
  };

  return marked.parse(preprocess(src), { renderer, gfm: true, breaks: true, async: false });
}
