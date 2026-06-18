/**
 * run-tests.js
 * 產學班實習月記系統自動化測試主程式 v4
 *
 * session 說明：
 *   session.json         → 老師帳號（必須，手動登入一次）
 *   session-student.json → 學生帳號（自動產生，不需學生在場）
 *
 * 學生 session 取得優先順序：
 *   1. 自動模式（.env 設定存在）→ 每次測試前自動用 Firebase REST API 重新登入
 *   2. 手動模式（.env 不存在但 session-student.json 存在）→ 沿用舊 session
 *   3. 無 session → S-07 以後的學生功能測試自動跳過
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const { runStudentTests } = require('./tests/student.test');
const { runTeacherTests } = require('./tests/teacher.test');
const { autoCreateStudentSession, loadEnv } = require('./auto-student-session');

const SESSION_FILE         = path.join(__dirname, 'session.json');
const STUDENT_SESSION_FILE = path.join(__dirname, 'session-student.json');
const SCREENSHOT_DIR       = path.join(__dirname, '..', 'screenshots');
const REPORT_FILE          = path.join(__dirname, '..', 'test-report.txt');
const HEADLESS = process.env.HEADLESS !== 'false';

const runStudent = !process.argv.includes('--teacher');
const runTeacher = !process.argv.includes('--student');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(REPORT_FILE, msg + '\n');
}

function formatDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(label, results) {
  const pass    = results.filter(r => r.pass).length;
  const skipped = results.filter(r => r.skipped).length;
  const fail    = results.filter(r => !r.pass).length;
  const total   = results.length;
  log(`\n${'─'.repeat(50)}`);
  log(`${label} 測試結果：${pass}/${total} 通過，${fail} 失敗${skipped ? `，${skipped} 跳過` : ''}`);
  if (fail > 0) {
    log('失敗項目：');
    results.filter(r => !r.pass).forEach(r => {
      log(`  ✗ ${r.name}`);
      log(`    ${r.error}`);
    });
  }
  log('─'.repeat(50));
  return { pass, fail, total, skipped };
}

(async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, '');

  const startTime = Date.now();
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  log('═'.repeat(50));
  log('產學班實習月記系統 自動化測試');
  log(`執行時間：${now}`);
  log(`對應 AI_CONTEXT.md 版本：2026-06-17`);
  log('═'.repeat(50));

  // 2026-06-XX 新增：session.json（老師 Google 帳號登入）只在「會跑老師端測試」時才需要。
  // --student 模式（例如 CI 的自動健康檢查）沒有人能手動互動登入老師端，
  // 所以這個檢查改成只在 runTeacher 為 true 時才擋下來。
  if (runTeacher && !fs.existsSync(SESSION_FILE)) {
    log('\n❌ 找不到 session.json，請先執行 Step3_RenewSession.bat 重新登入。');
    process.exit(1);
  }

  let browser, context;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
    };
    if (runTeacher) contextOptions.storageState = SESSION_FILE;
    context = await browser.newContext(contextOptions);
  } catch (err) {
    log(`\n❌ 無法啟動瀏覽器：${err.message}`);
    process.exit(1);
  }

  // ── 學生 session 處理（自動優先）────────────────────────────
  const env = loadEnv();
  const hasEnvConfig = !!(
    (env.FIREBASE_API_KEY    || process.env.FIREBASE_API_KEY) &&
    (env.TEST_STUDENT_EMAIL  || process.env.TEST_STUDENT_EMAIL) &&
    (env.TEST_STUDENT_PASSWORD || process.env.TEST_STUDENT_PASSWORD)
  );

  let hasStudentSession = false;

  if (hasEnvConfig) {
    log('\n🤖 偵測到 .env 設定，自動產生學生帳號 session...');
    hasStudentSession = await autoCreateStudentSession(browser, STUDENT_SESSION_FILE, log);
    if (hasStudentSession) {
      log('   S-07 以後的學生功能測試將完整執行\n');
    } else {
      log('   ⚠️  自動登入失敗，學生功能測試將跳過\n');
    }
  } else if (fs.existsSync(STUDENT_SESSION_FILE)) {
    log('\n✅ 學生帳號 session 存在（手動模式），S-07 以後功能測試將完整執行');
    log('   提示：建立 test-suite/.env 可改為自動模式，不再需要學生在場\n');
    hasStudentSession = true;
  } else {
    log('\n⚠️  找不到學生帳號 session');
    log('   學生端功能測試（S-07 以後）將自動跳過');
    log('   方法一（推薦）：建立 test-suite/.env → 往後全自動，不需學生在場');
    log('   方法二：執行 Step4_StudentSession.bat → 學生手動登入一次\n');
  }

  let allPassed = true;
  const summary = [];

  // ── 學生端測試 ────────────────────────────────────────
  if (runStudent) {
    log('\n' + '═'.repeat(50));
    log('學生端測試（student.html）');
    log('═'.repeat(50));

    const sPage = await context.newPage();
    sPage._testErrors = [];
    sPage.on('pageerror', err => sPage._testErrors.push(err.message));

    try {
      const t0 = Date.now();
      const results = await runStudentTests(sPage, context, log);
      const dur = formatDuration(Date.now() - t0);
      const stat = printSummary('學生端', results);
      log(`耗時：${dur}`);
      summary.push({ label: '學生端', ...stat, dur });
      if (stat.fail > 0) allPassed = false;
    } catch (err) {
      log(`\n❌ 學生端測試發生未預期錯誤：${err.message}`);
      allPassed = false;
    } finally {
      await sPage.close();
    }
  }

  // ── 老師端測試 ────────────────────────────────────────
  if (runTeacher) {
    log('\n' + '═'.repeat(50));
    log('老師端測試（teacher.html）');
    log('═'.repeat(50));

    const tPage = await context.newPage();
    tPage._testErrors = [];
    tPage.on('pageerror', err => tPage._testErrors.push(err.message));

    try {
      const t0 = Date.now();
      const results = await runTeacherTests(tPage, log);
      const dur = formatDuration(Date.now() - t0);
      const stat = printSummary('老師端', results);
      log(`耗時：${dur}`);
      summary.push({ label: '老師端', ...stat, dur });
      if (stat.fail > 0) allPassed = false;
    } catch (err) {
      log(`\n❌ 老師端測試發生未預期錯誤：${err.message}`);
      allPassed = false;
    } finally {
      await tPage.close();
    }
  }

  await context.close();
  await browser.close();

  // ── 總結 ─────────────────────────────────────────────
  const totalDur = formatDuration(Date.now() - startTime);
  log('\n' + '═'.repeat(50));
  log('整體測試結果');
  log('═'.repeat(50));
  summary.forEach(s => {
    const icon = s.fail === 0 ? '✅' : '❌';
    const skipNote = s.skipped ? `（${s.skipped} 跳過）` : '';
    log(`${icon} ${s.label}：${s.pass}/${s.total} 通過${skipNote}（${s.dur}）`);
  });
  const totalPass    = summary.reduce((a, s) => a + s.pass, 0);
  const totalFail    = summary.reduce((a, s) => a + s.fail, 0);
  const totalAll     = summary.reduce((a, s) => a + s.total, 0);
  const totalSkipped = summary.reduce((a, s) => a + (s.skipped || 0), 0);
  log(`\n合計：${totalPass}/${totalAll} 通過，${totalFail} 失敗${totalSkipped ? `，${totalSkipped} 跳過` : ''}`);
  log(`總耗時：${totalDur}`);
  log('═'.repeat(50));
  log('\n報告已儲存至：test-report.txt');

  process.exit(allPassed ? 0 : 1);
})();
