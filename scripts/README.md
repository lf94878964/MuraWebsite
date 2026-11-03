# scripts/build-seo.mjs

產生 SEO、分享預覽（Open Graph / Twitter / Discord Component V2）、sitemap.xml、robots.txt、_redirects，並為每個頁面與每篇文檔輸出靜態 HTML。

```bash
node generate-manifest.js        # 文檔有新增或改名時先做
node scripts/build-seo.mjs       # 然後做這個，再 commit / push
```

- 文案改 `js/seo.js`；網址、邀請連結改 `js/config.js`。
- 分享圖片放 `image/`：`og.png`（預設）、`logo.png`（Discord 卡片右上縮圖），也可為單頁指定 `home / rule / docs / tools / military / status / cooperate / contact`（副檔名 png、jpg、jpeg、webp）。建議 1200x630。
- 建議本機執行後把產生的檔案一起提交（已附上目前的產生結果）。

## 網頁版計算機（/tools/calculator）

- 計算由機器人原版引擎 `py/calc_engine.py`（即 `_engine.py`，未修改）在瀏覽器內以 Pyodide 執行，`py/calc_web.py` 是轉接層。
- 機器人更新引擎時：覆蓋 `py/calc_engine.py`，把 `js/pages/calculator.js` 的 `ASSET_V` 加一，再執行 `python3 scripts/check-calculator.py`（需要 `pip install sympy`）檢查 `data/calculator-functions.json` 有沒有漏列新函數、範例結果是否仍一致。
- 新增頁面後仍照常執行 `node scripts/build-seo.mjs`。
