// 字數計算機：純前端，文字不會離開瀏覽器。
import { copyText, toast, escapeHtml } from '../core/ui.js';

const re = (src, flags = 'gu') => new RegExp(src, flags);
const RX = {
  han: re('\\p{Script=Han}'),
  kana: re('[\\p{Script=Hiragana}\\p{Script=Katakana}]'),
  hangul: re('\\p{Script=Hangul}'),
  word: /[A-Za-zÀ-ɏ]+(?:['’-][A-Za-zÀ-ɏ]+)*/g,
  letter: /[A-Za-z]/g,
  digit: re('\\p{Nd}'),
  number: re('\\p{Nd}+(?:[.,]\\p{Nd}+)*'),
  punct: re('\\p{P}'),
  symbol: re('\\p{S}'),
  space: /[  　]/g,
  tab: /\t/g,
  nonSpace: /\S/gu,
};
const count = (s, rx) => (s.match(rx) || []).length;
const hasSeg = typeof Intl !== 'undefined' && 'Segmenter' in Intl;
const seg = hasSeg ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const PICT = re('\\p{Extended_Pictographic}', 'u');
const fmt = (n) => n.toLocaleString('en-US');

function analyze(text) {
  const t = text.replace(/\r\n?/g, '\n');
  const han = count(t, RX.han);
  const kana = count(t, RX.kana);
  const hangul = count(t, RX.hangul);
  const words = count(t, RX.word);
  const numbers = count(t, RX.number);
  const lines = t === '' ? [] : t.split('\n');
  const chars = [...t].length;

  let graphemes = chars;
  let emoji = 0;
  if (seg) {
    graphemes = 0;
    for (const { segment } of seg.segment(t)) {
      graphemes++;
      if (PICT.test(segment)) emoji++;
    }
  } else {
    emoji = count(t, re('\\p{Extended_Pictographic}'));
  }

  const sentences = t.trim() === '' ? 0 : t.split(/(?<=[。！？!?…]+|\.(?=\s|$))\s*/u).filter((x) => x.trim()).length;
  const readSec = Math.round(((han + kana + hangul) / 400 + words / 230) * 60);

  const freq = new Map();
  for (const ch of t) {
    if (/\s/u.test(ch)) continue;
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);

  return {
    total: han + kana + hangul + words + numbers,
    chars,
    charsNoSpace: count(t, RX.nonSpace),
    graphemes,
    han, kana, hangul, words,
    letters: count(t, RX.letter),
    digits: count(t, RX.digit),
    numbers,
    punct: count(t, RX.punct),
    symbols: count(t, RX.symbol),
    emoji,
    spaces: count(t, RX.space),
    tabs: count(t, RX.tab),
    newlines: count(t, /\n/g),
    lines: lines.length,
    nonEmptyLines: lines.filter((l) => l.trim()).length,
    paragraphs: t.split(/\n\s*\n/).filter((p) => p.trim()).length,
    sentences,
    bytes: new TextEncoder().encode(t).length,
    readSec,
    top,
    distinct: freq.size,
  };
}

function readTime(sec) {
  if (sec < 5) return '不到 5 秒';
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

const FIX = {
  spaces: (t) => t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t 　]{2,}/g, ' ').replace(/^[ \t 　]+|[ \t 　]+$/g, '')).join('\n'),
  'blank-merge': (t) => t.replace(/\r\n?/g, '\n').replace(/[ \t　]+$/gm, '').replace(/\n{3,}/g, '\n\n'),
  'blank-all': (t) => t.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '').join('\n'),
  trim: (t) => t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^[ \t 　]+|[ \t 　]+$/g, '')).join('\n'),
};

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const ta = $('#wc-text');
  const undoBtn = $('#wc-undo');
  const history = [];
  let raf = 0;

  const scopeText = () => {
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    return a !== b ? { text: ta.value.slice(a, b), sel: true } : { text: ta.value, sel: false };
  };

  const cell = (label, v) => `<div class="wc-cell"><span>${label}</span><b>${v}</b></div>`;
  const group = (title, cells) => `<div class="wc-group"><h3>${title}</h3><div class="wc-cells">${cells.join('')}</div></div>`;

  function paint() {
    raf = 0;
    const { text, sel } = scopeText();
    const s = analyze(text);
    $('#wc-scope').textContent = sel ? `統計範圍：選取的 ${fmt([...text].length)} 個字元` : '';
    $('#wc-hero').innerHTML = [
      ['總字數', s.total], ['字元數（含空格）', s.chars], ['字元數（不含空格）', s.charsNoSpace], ['中文字數（漢字）', s.han],
    ].map(([l, v]) => `<div class="wc-big"><b>${fmt(v)}</b><span>${l}</span></div>`).join('');

    $('#wc-detail').innerHTML =
      group('文字', [
        cell('漢字（CJK）', fmt(s.han)), cell('日文假名', fmt(s.kana)), cell('韓文字', fmt(s.hangul)),
        cell('英文單字', fmt(s.words)), cell('英文字母', fmt(s.letters)),
      ]) +
      group('數字、標點與符號', [
        cell('數字個數', fmt(s.digits)), cell('數字串', fmt(s.numbers)), cell('標點符號', fmt(s.punct)),
        cell('其他符號', fmt(s.symbols)), cell('Emoji', fmt(s.emoji)),
      ]) +
      group('空白與結構', [
        cell('空格', fmt(s.spaces)), cell('Tab', fmt(s.tabs)), cell('換行符', fmt(s.newlines)),
        cell('行數', fmt(s.lines)), cell('非空行', fmt(s.nonEmptyLines)), cell('段落數', fmt(s.paragraphs)), cell('句數', fmt(s.sentences)),
      ]) +
      group('其他', [
        cell('字形數', fmt(s.graphemes)), cell('不重複字元', fmt(s.distinct)),
        cell('UTF-8 位元組', fmt(s.bytes)), cell('預估閱讀時間', readTime(s.readSec)),
      ]);

    const max = s.top[0]?.[1] || 1;
    $('#wc-freq').innerHTML = s.top.length
      ? s.top.map(([ch, n]) =>
          `<div class="wc-bar"><span>${escapeHtml(ch)}</span><div class="wc-track"><i style="width:${Math.max(2, (n / max) * 100)}%"></i></div><b>${fmt(n)}</b></div>`).join('')
      : '<p class="wc-empty">還沒有內容。</p>';
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  const setText = (v, { record = true } = {}) => {
    if (record && v !== ta.value) {
      history.push(ta.value);
      if (history.length > 30) history.shift();
    }
    ta.value = v;
    undoBtn.disabled = history.length === 0;
    paint();
  };

  ta.addEventListener('input', schedule);
  for (const ev of ['select', 'keyup', 'mouseup', 'touchend']) ta.addEventListener(ev, schedule);

  $('#wc-copy').addEventListener('click', async () => {
    const { text, sel } = scopeText();
    if (!text) return toast('沒有可複製的內容');
    toast((await copyText(text)) ? (sel ? '已複製選取的文字' : '已複製純文字') : '複製失敗');
  });
  $('#wc-paste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return toast('剪貼簿是空的');
      const a = ta.selectionStart;
      const b = ta.selectionEnd;
      setText(ta.value.slice(0, a) + t + ta.value.slice(b));
      ta.setSelectionRange(a + t.length, a + t.length);
      ta.focus();
    } catch {
      toast('瀏覽器不允許讀取剪貼簿，請直接在文字框按 Ctrl/⌘ + V');
      ta.focus();
    }
  });
  $('#wc-clear').addEventListener('click', () => {
    if (!ta.value) return;
    setText('');
    toast('已清空，可按「復原」找回');
    ta.focus();
  });
  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    setText(history.pop(), { record: false });
    ta.focus();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fix]');
    if (!b) return;
    const before = ta.value;
    setText(FIX[b.dataset.fix](before));
    toast(ta.value === before ? '沒有需要整理的地方' : '已整理，可按「復原」還原');
  });

  paint();
  return () => { if (raf) cancelAnimationFrame(raf); };
}
