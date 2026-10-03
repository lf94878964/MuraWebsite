@echo off

echo 正在拉取遠端最新內容...
echo.
git pull

echo.
echo 拉取完成！視窗將在 10 秒後自動關閉...
timeout /t 10 /nobreak >nul
