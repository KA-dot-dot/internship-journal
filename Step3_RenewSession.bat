\xef\xbb\xbf@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   産學班實習月記系統 - 重新登入 (Session 過期)
echo ================================================
echo.
echo 測試突然全部失敗時請執行此檔案
echo.

cd /d "%~dp0test-suite"

echo >> 瀏覽器開啟後用老師 Google 帳號登入
echo >> 看到老師端主畫面後回到這裡按 Enter
echo.
call node save-session.js
echo.

echo Session 更新完成！現在可以執行 Step2_RunTests.bat
pause
