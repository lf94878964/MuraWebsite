@echo off

:: 第一步：輸入 commit 標題
set /p title=請輸入提交標題 (若直接按 Enter 則使用預設時間):

if "%title%"=="" (
    set "commit_title=Auto update %date% %time%"
) else (
    set "commit_title=%title%"
)

:: 第二步：輸入 commit 說明（可留空）
set /p desc=請輸入提交說明 (可直接按 Enter 留空):

git add .

if "%desc%"=="" (
    git commit -m "%commit_title%"
) else (
    git commit -m "%commit_title%" -m "%desc%"
)

git push

echo.
echo 推送完成！視窗將在 10 秒後自動關閉...
timeout /t 10 /nobreak >nul
