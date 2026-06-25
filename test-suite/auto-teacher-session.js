/**
 * auto-teacher-session.js  v1
 * 自動用 Firebase Email/Password 登入，產生老師端 session-teacher.json
 *
 * 設計上完全對稱 auto-student-session.js v6，差別只在：
 *   - 讀取 TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD
 *   - 目標 URL 為 teacher.html
 *   - 輸出 session-teacher.json
 *
 * 前置條件：
 *   1. Firebase Console > Authentication 已建立 test-teacher@tcivs.tc.edu.tw（Email/Password）
 *   2. Firestore /admins/{uid} 已新增 email 欄位（Console 手動建立，不受規則限制）
 *   3. test-suite/.env 填入 TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD
 *
 * teacher.html 登入流程：
 *   signInWithEmailAndPassword()
 *     → onAuthStateChanged 觸發
 *       → handleLoginUser() → isAdmin() 查詢 /admins/
 *         → currentUser 設定 → enterApp() → #app display:block
 */

const path = require('path');
const fs   = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

async function autoCreateTeacherSession(browser, sessionFile, log) {
  const env = loadEnv();
  const apiKey   = env.FIREBASE_API_KEY       || process.env.FIREBASE_API_KEY;
  const email    = env.TEST_TEACHER_EMAIL     || process.env.TEST_TEACHER_EMAIL;
  const password = env.TEST_TEACHER_PASSWORD  || process.env.TEST_TEACHER_PASSWORD;

  if (!apiKey || !email || !password) {
    log('⚠️  找不到老師帳號 .env 設定，老師 session 無法自動產生。');
    log('   請在 test-suite/.env 填入 FIREBASE_API_KEY / TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD');
    return false;
  }

  log(`\n🔑 自動登入測試老師帳號：${email}`);

  const BASE_URL = 'https://ka-dot-dot.github.io/internship-journal/teacher.html';

  const context = await browser.newContext({
    viewport:       { width: 1280, height: 800 },
    locale:         'zh-TW',
    timezoneId:     'Asia/Taipei',
    serviceWorkers: 'block',   // 封鎖 SW，確保拿到最新版 teacher.html
  });

  const page = await context.newPage();
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[console.${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[pageerror] ${err.message}`));

  // 攔截 Google OAuth，避免彈窗干擾
  await page.route('**/accounts.google.com/**', route => route.abort());

  try {
    // Step 1：導覽到 teacher.html 建立正確 origin
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Step 2：等待頁面原生 Firebase SDK 初始化完成（window._auth 由 teacher.html 自己建立）
    const authReady = await page.waitForFunction(() => {
      return window._auth && window._auth.auth;
    }, { timeout: 15000 }).then(() => true).catch(() => false);

    if (!authReady) {
      log('   ❌ Firebase SDK 初始化逾時（window._auth 未就緒）');
      await page.close();
      await context.close();
      return false;
    }

    // Step 3：使用頁面原生的 window._auth.auth instance 登入
    // 確保 token 寫入位置與 onAuthStateChanged 監聽的是同一個 auth instance
    const loginResult = await page.evaluate(async ({ email, password }) => {
      try {
        if (!window._auth || !window._auth.auth) {
          return { ok: false, error: 'window._auth 尚未初始化' };
        }
        const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        const auth = window._auth.auth;
        await authMod.setPersistence(auth, window._auth.browserLocalPersistence);
        const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
        return { ok: true, uid: cred.user.uid, email: cred.user.email };
      } catch (e) {
        return { ok: false, error: e.message, code: e.code };
      }
    }, { email, password });

    if (!loginResult.ok) {
      log(`   ❌ 自動登入失敗：${loginResult.error || loginResult.code}`);
      log('   請確認：');
      log('   1. Firebase Console 已啟用 Email/Password 登入');
      log('   2. 測試老師帳號已建立且密碼正確');
      log('   3. /admins/{uid} 文件已在 Firestore Console 手動建立');
      await page.close();
      await context.close();
      return false;
    }

    log(`   ✅ Firebase SDK 登入成功（uid: ${loginResult.uid}）`);

    // Step 4：等待 app 顯示（handleLoginUser + isAdmin 查詢完整跑完的標誌）
    // 老師端登入比學生端多一步 /admins/ 查詢，給足 30 秒
    // 超時改為硬性失敗，不產生不完整的 session
    const appShown = await page.waitForFunction(() => {
      const app = document.getElementById('app');
      return !!(app && app.style.display === 'block');
    }, { timeout: 30000 }).then(() => true).catch(() => false);

    const diag = await page.evaluate(() => {
      const app = document.getElementById('app');
      let authUid = 'N/A';
      try {
        if (window._auth && window._auth.auth && window._auth.auth.currentUser) {
          authUid = window._auth.auth.currentUser.uid;
        }
      } catch (_) {}
      return {
        appDisplay:     app ? app.style.display : 'NO_APP_ELEMENT',
        hasCurrentUser: typeof currentUser !== 'undefined' && !!currentUser,
        authUid,
        bodyTextSnippet: document.body.textContent.slice(0, 150),
      };
    }).catch(e => ({ error: e.message }));

    log(`   🔍 登入後狀態：${JSON.stringify(diag)}`);
    if (consoleLogs.length > 0) {
      log(`   🔍 Console（最後 8 筆）：`);
      consoleLogs.slice(-8).forEach(l => log(`      ${l}`));
    }

    // 硬性失敗：app 未顯示則不產生 session
    if (!appShown || diag.appDisplay !== 'block') {
      log('   ❌ app 未在 30 秒內顯示，session 產生中止');
      log('   可能原因：');
      log('   1. /admins/{uid} 文件不存在（isAdmin() 回傳 false）');
      log('   2. 帳號的 uid 與 /admins/ 文件 ID 不符');
      log('   3. Firestore 查詢失敗（網路問題）');
      await page.close();
      await context.close();
      return false;
    }

    // currentUser 確認
    if (!diag.hasCurrentUser) {
      log('   ❌ app 已顯示但 currentUser 未設定（handleLoginUser() 可能提早 return）');
      await page.close();
      await context.close();
      return false;
    }

    log('   ✅ 登入流程成功，app 已顯示');

    // Step 5：額外等待確保 handleLoginUser() 所有非同步操作完成
    await page.waitForTimeout(2000);

    // Step 6：儲存 storageState
    await context.storageState({ path: sessionFile });
    await page.close();
    await context.close();

    log(`   ✅ session-teacher.json 已產生（SDK 原生登入模式 v1）`);
    return true;

  } catch (err) {
    log(`   ❌ 自動登入失敗：${err.message}`);
    try { await page.close(); await context.close(); } catch (_) {}
    return false;
  }
}

module.exports = { autoCreateTeacherSession, loadEnv };
