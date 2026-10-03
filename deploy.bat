@echo off
echo [1/2] 正在產生目錄文件...
node generate-manifest.js

echo [2/2] 正在部署到 Cloudflare Pages...
npx wrangler pages deploy . --project-name=murabot
pause