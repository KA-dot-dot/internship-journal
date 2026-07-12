\xef\xbb\xbf@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   産學班實習月記系統 - 執行自動化測試
echo ================================================
echo.

cd /d "%~dp0test-suite"

if not exist "session.json" (
    echo [錯誤] 找不到登入 Session
    echo 請先執行 Step1_Install.bat 或 Step3_RenewSession.bat
    echo.
    pause
    exit /b 1
)

echo 開始測試，瀏覽器會自動操作，約 3-5 分鐘...
echo.
call node run-tests.js

echo.
echo 測試完成！
echo 報告已儲存至 test-report.txt
echo.
if exist "..\screenshots" (
    echo 失敗截圖已儲存至 screenshots 資料夾
    echo.
)
pause
