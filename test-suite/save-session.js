/**
 * save-session.js
 * 啟動瀏覽器讓使用者手動登入，完成後儲存 session 供測試使用
 *
 * 使用方式：
 *   node save-session.js                → 儲存老師帳號 session（session.json，手動）
 *   node save-session.js --student      → 儲存學生帳號 session（手動，session-student.json）
 *   node save-session.js --auto         → 自動產生學生 session（需 .env，不需學生在場）
 *   node save-session.js --auto-teacher → 自動產生老師 session（需 .env，不需老師在場）
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const isStudent     = process.argv.includes('--student');
const isAuto        = process.argv.includes('--auto');
const isAutoTeacher = process.argv.includes('--auto-teacher');

// ── 老師自動模式 ───────────────────────────────────────
if (isAutoTeacher) {
  const { autoCreateTeacherSession, loadEnv } = require('./auto-teacher-session');

  (async () => {
    console.log('═'.repeat(50));
    console.log('產學班實習月記系統 — 自動產生老師帳號 Session');
    console.log('═'.repeat(50));

    const env = loadEnv();
    const apiKey   = env.FIREBASE_API_KEY      || process.env.FIREBASE_API_KEY;
    const email    = env.TEST_TEACHER_EMAIL    || process.env.TEST_TEACHER_EMAIL;
    const password = env.TEST_TEACHER_PASSWORD || process.env.TEST_TEACHER_PASSWORD;

    if (!apiKey || !email || !password) {
      console.log('\n❌ 找不到老師帳號 .env 設定');
      console.log('   請在 test-suite/.env 填入：');
      console.log('   FIREBASE_API_KEY / TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD');
      process.exit(1);
    }

    console.log(`\n帳號：${email}`);

    const SESSION_FILE = path.join(__dirname, 'session-teacher.json');
    const browser = await chromium.launch({ headless: true });
    const ok = await autoCreateTeacherSession(browser, SESSION_FILE, console.log);
    await browser.close();

    if (ok) {
      console.log('\n✅ 完成！現在執行 Step2_RunTests.bat 即可完整測試');
      process.exit(0);
    } else {
      process.exit(1);
    }
  })();

  return;
}

// ── 學生自動模式 ───────────────────────────────────────
if (isAuto) {
  const { autoCreateStudentSession, loadEnv } = require('./auto-student-session');

  (async () => {
    console.log('═'.repeat(50));
    console.log('產學班實習月記系統 — 自動產生學生帳號 Session');
    console.log('═'.repeat(50));

    const env = loadEnv();
    const apiKey   = env.FIREBASE_API_KEY    || process.env.FIREBASE_API_KEY;
    const email    = env.TEST_STUDENT_EMAIL  || process.env.TEST_STUDENT_EMAIL;
    const password = env.TEST_STUDENT_PASSWORD || process.env.TEST_STUDENT_PASSWORD;

    if (!apiKey || !email || !password) {
      console.log('\n❌ 找不到 .env 設定');
      console.log('   請複製 .env.example 為 .env 並填入：');
      console.log('   FIREBASE_API_KEY / TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD');
      process.exit(1);
    }

    console.log(`\n帳號：${email}`);

    const SESSION_FILE = path.join(__dirname, 'session-student.json');
    const browser = await chromium.launch({ headless: true });
    const ok = await autoCreateStudentSession(browser, SESSION_FILE, console.log);
    await browser.close();

    if (ok) {
      console.log('\n✅ 完成！現在執行 Step2_RunTests.bat 即可完整測試');
      process.exit(0);
    } else {
      process.exit(1);
    }
  })();

  return;
}

// ── 手動模式（老師 or 學生）──────────────────────────
const SESSION_FILE = path.join(
  __dirname,
  isStudent ? 'session-student.json' : 'session.json'
);

const LOGIN_URL    = isStudent
  ? 'https://ka-dot-dot.github.io/internship-journal/student.html'
  : 'https://ka-dot-dot.github.io/internship-journal/teacher.html';
const ROLE_LABEL   = isStudent ? '學生帳號' : '老師帳號';
const TARGET_LABEL = isStudent ? '學生端主畫面' : '老師端主頁';

(async () => {
  console.log('═'.repeat(50));
  console.log(`產學班實習月記系統 — ${ROLE_LABEL} Session 儲存工具`);
  console.log('═'.repeat(50));
  console.log('\n步驟：');
  console.log(`  1. 瀏覽器將自動開啟${isStudent ? '學生' : '老師'}端登入頁`);
  console.log(`  2. 請使用學校 ${ROLE_LABEL} Google 帳號完成登入`);
  console.log(`  3. 確認${TARGET_LABEL}載入後，回到這個視窗按 Enter`);

  if (isStudent) {
    console.log('\n💡 提示：建立 test-suite/.env 可改為全自動模式，不需學生在場');
    console.log('   參考 .env.example 說明');
  } else {
    console.log('\n💡 提示：在 .env 填入老師帳號設定可改為全自動模式，不需手動登入');
    console.log('   參考 .env.example 說明（TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD）');
  }
  console.log();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  });

  const page = await context.newPage();
  await page.goto(LOGIN_URL);

  console.log(`瀏覽器已開啟，請完成 ${ROLE_LABEL} 登入...`);
  console.log('登入完成後請回到此視窗按 Enter 繼續');

  await new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    });
  });

  await context.storageState({ path: SESSION_FILE });
  console.log(`\n✅ ${ROLE_LABEL} Session 已儲存：${SESSION_FILE}`);

  if (isStudent) {
    console.log('   現在重新執行 Step2_RunTests.bat 即可完整測試\n');
  } else {
    console.log('   現在可以執行 Step2_RunTests.bat 開始測試\n');
  }

  await browser.close();
  process.exit(0);
})();
