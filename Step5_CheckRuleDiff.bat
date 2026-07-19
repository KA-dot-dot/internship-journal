@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   產學班實習月記系統 - rule.txt 高風險變更檢查
echo ================================================
echo.

cd /d "%~dp0"

node -v > nul 2>&1
if %errorlevel% neq 0 goto no_node

echo 比對目前 rule.txt 與上次 commit 的版本，找出高風險區塊變更...
echo.
node test-suite\check-rule-diff.js
set RESULT=%errorlevel%

echo.
if %RESULT% equ 0 goto pass
goto warn

:pass
echo [通過] 可以繼續部署。
goto end

:warn
echo [請注意] 無法完成比對，或偵測到高風險變更。請檢查上面的訊息：如果是「找不到 git 專案」，代表這台電腦沒有設定 git，跟規則安全無關；如果是「反向掃描」開頭的項目，代表 test-rules.js 跟 rule.txt 之間有欄位沒對齊（一邊測了/驗證了、另一邊沒有），請對照列出的欄位名稱，到 rule.txt 補規則或到 test-suite\rules-tests\test-rules.js 補測試，也可以評估後在 check-rule-diff.js 加註排除；如果是列出實際的規則內容差異，才代表真的需要去跑 test-suite\rules-tests\RunRulesTest.bat 確認規則無誤。
goto end

:no_node
echo [錯誤] 找不到 Node.js
echo 請先到 https://nodejs.org 下載 LTS 版本安裝
pause
exit /b 1

:end
echo.
pause
