#!/usr/bin/env node
/**
 * generate-manifest.js
 * 
 * 掃描 ./document 資料夾，自動產生 doc-manifest.json
 * 
 * 使用方式：
 *   node generate-manifest.js
 * 
 * 資料夾命名規則：
 *   document/
 *   ├── index.md                        ← 文件首頁（可選）
 *   ├── 1-大考倒數通知/                 ← N-段落名稱
 *   │   ├── 1-如何設定大考倒數通知.md   ← N-文章名稱.md
 *   │   └── 2-支援的考試類型.md
 *   └── 2-語錄系統/
 *       └── 1-發送語錄.md
 */

const fs   = require('fs');
const path = require('path');

const DOCUMENT_DIR = path.join(__dirname, 'document');
const OUTPUT_FILE  = path.join(__dirname, 'doc-manifest.json');

// ===== SECTION ICONS（依段落名稱自動對應，可自行增減）=====
const ICON_MAP = {
  '倒數': '📅',
  '語錄': '💬',
  '賭博': '🎰',
  '婚姻': '💍',
  '成就': '🏆',
  '指數': '🌈',
  '男娘': '🎀',
  '指令': '⚡',
  '設定': '⚙️',
  '系統': '🖥️',
  '說明': '📖',
  '入門': '🚀',
  '口（禁）球（言）': '🤐',
  '槍斃': '🔫',
  '邀請': '❓',
  '法律': '📜',
  '公告': '📢',
  '計算機': '🧮',
};

function getIcon(name) {
  for (const [keyword, icon] of Object.entries(ICON_MAP)) {
    if (name.includes(keyword)) return icon;
  }
  return '📄';
}

// ===== 解析 N-名稱 格式，回傳 { order, name } =====
function parseName(raw) {
  const match = raw.match(/^(\d+)-(.+)$/);
  if (match) return { order: parseInt(match[1]), name: match[2] };
  return { order: 999, name: raw };
}

// ===== 掃描主函式 =====
function scan() {
  if (!fs.existsSync(DOCUMENT_DIR)) {
    console.error(`❌ 找不到 document 資料夾：${DOCUMENT_DIR}`);
    process.exit(1);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sections: [],
  };

  // 讀取所有子資料夾，依編號排序
  const entries = fs.readdirSync(DOCUMENT_DIR, { withFileTypes: true });

  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => ({ ...parseName(e.name), raw: e.name }))
    .sort((a, b) => a.order - b.order);

  for (const dir of dirs) {
    const sectionPath = path.join(DOCUMENT_DIR, dir.raw);
    const sectionId   = dir.raw; // e.g. "1-大考倒數通知"

    // 讀取該段落下的所有 .md 檔，依編號排序
    const files = fs.readdirSync(sectionPath)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ ...parseName(f.replace(/\.md$/, '')), raw: f }))
      .sort((a, b) => a.order - b.order);

    if (files.length === 0) continue;

    const children = files.map(f => ({
      id:    `${sectionId}/${f.raw.replace(/\.md$/, '')}`,
      title: f.name,
      file:  `document/${sectionId}/${f.raw}`,
    }));

    manifest.sections.push({
      id:       sectionId,
      title:    dir.name,
      icon:     getIcon(dir.name),
      children,
    });
  }

  // 寫出 JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2), 'utf8');

  // 統計
  const totalDocs = manifest.sections.reduce((s, sec) => s + sec.children.length, 0);
  console.log(`✅ doc-manifest.json 已產生`);
  console.log(`   📂 段落數：${manifest.sections.length}`);
  console.log(`   📄 文件數：${totalDocs}`);
  manifest.sections.forEach(sec => {
    console.log(`   ${sec.icon} ${sec.title}（${sec.children.length} 篇）`);
    sec.children.forEach(c => console.log(`      - ${c.title}`));
  });
}

scan();
