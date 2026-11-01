# scripts/build-seo.mjs

產生 SEO、分享預覽（Open Graph / Twitter / Discord Component V2）、sitemap.xml、robots.txt、_redirects，並為每個頁面與每篇文檔輸出靜態 HTML。

```bash
node generate-manifest.js        # 文檔有新增或改名時先做
node scripts/build-seo.mjs       # 然後做這個，再 commit / push
```

- 文案改 `js/seo.js`；網址、邀請連結改 `js/config.js`。
- 分享圖片放 `image/`：`og.png`（預設）、`logo.png`（Discord 卡片右上縮圖），也可為單頁指定 `home / rule / docs / tools / military / status / cooperate / contact`（副檔名 png、jpg、jpeg、webp）。建議 1200x630。
- 建議本機執行後把產生的檔案一起提交（已附上目前的產生結果）。
