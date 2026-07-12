@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   産學班實習月記系統 - 學生帳號 Session
echo ================================================
echo.
echo 請選擇模式：
echo.
echo   [1] 自動模式（推薦）：.env 設定帳號密碼，完全不需學生在場
echo   [2] 手動模式：請學生在瀏覽器登入一次
echo.
set /p choice=請輸入 1 或 2（預設 1）: 

if "%choice%"=="2" goto manual

:auto
echo.
echo >> 自動模式：用 Firebase 測試帳號自動登入
echo.

cd /d "%~dp0test-suite"

if not exist ".env" (
    echo [提示] 找不到 .env 檔案
    echo.
    echo 請依照以下步驟設定：
    echo.
    echo 步驟一：複製 .env.example 為 .env
    echo   copy .env.example .env
    echo.
    echo 步驟二：用記事本開啟 .env，填入：
    echo   TEST_STUDENT_PASSWORD=（你設定的密碼）
    echo.
    echo 步驟三：Firebase Console 確認：
    echo   - Authentication ^> Sign-in method ^> Email/Password 已啟用
    echo   - Authentication ^> Users 已新增 test-student@tcivs.tc.edu.tw
    echo   - Firestore studentBindings 已新增此帳號（seatNo: "00"）
    echo.
    pause
    exit /b 1
)

call node save-session.js --auto
echo.
if %errorlevel% equ 0 (
    echo 學生 Session 自動產生完成！
    echo 現在重新執行 Step2_RunTests.bat 即可完整測試
) else (
    echo 自動產生失敗，請確認 .env 設定或改用手動模式
)
pause
exit /b

:manual
echo.
echo >> 手動模式：請學生在瀏覽器登入
echo >> 瀏覽器開啟後用學生 Google 帳號登入
echo >> 看到學生端主畫面後回到這裡按 Enter
echo.

cd /d "%~dp0test-suite"

call node save-session.js --student
echo.

echo 學生帳號 Session 儲存完成！
echo 現在重新執行 Step2_RunTests.bat 即可完整測試
pause
