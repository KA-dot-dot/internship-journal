@echo off
chcp 65001 > nul
echo.
echo ================================================
echo   產學班實習月記系統 - Rules 單元測試（Layer 1）
echo ================================================
echo.

cd /d "%~dp0"

node -v > nul 2>&1
if %errorlevel% neq 0 goto no_node

java -version > nul 2>&1
if %errorlevel% neq 0 goto no_java

if exist "node_modules" goto run_test

echo [1/1] 第一次執行，安裝測試套件...
call npm install
echo.

:run_test
echo 開始執行 Rules 單元測試（第一次執行需下載 Firestore Emulator，請確保網路暢通）...
echo.
echo 檢查 8080 port 是否有殘留的 Firestore Emulator 行程未釋放...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":8080 " ^| findstr "LISTENING"') do echo   發現殘留行程 PID %%P，強制結束... & taskkill /F /PID %%P > nul 2>&1
echo.
call npm test
goto end

:no_node
echo [錯誤] 找不到 Node.js
echo 請先到 https://nodejs.org 下載 LTS 版本安裝
pause
exit /b 1

:no_java
echo [錯誤] 找不到 Java
echo Firestore Emulator 需要 Java 才能執行
echo 請先到 https://adoptium.net/zh-TW/temurin/releases/ 下載 JDK 17 安裝
echo 安裝完後請重新開一個命令提示字元再執行本檔案
pause
exit /b 1

:end
echo.
pause
