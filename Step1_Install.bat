\xef\xbb\xbf@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   産學班實習月記系統 - 安裝與設定
echo ================================================
echo.

node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Node.js
    echo 請先到 https://nodejs.org 下載 LTS 版本安裝
    echo 安裝完後重新執行此檔案
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js 已安裝：
node -v
echo.

cd /d "%~dp0test-suite"

echo [1/3] 安裝測試套件 (npm install)...
call npm install
echo.

echo [2/3] 下載測試瀏覽器 Chromium (約 200MB)...
call npx playwright install chromium
echo.

echo [3/3] 儲存登入 Session
echo.
echo >> 瀏覽器開啟後用老師 Google 帳號登入
echo >> 看到老師端主畫面後回到這裡按 Enter
echo.
call node save-session.js
echo.

echo ================================================
echo   安裝完成！之後請執行 Step2_RunTests.bat
echo ================================================
pause
