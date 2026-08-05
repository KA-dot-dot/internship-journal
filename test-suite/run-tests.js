/**
 * run-tests.js
 * 產學班實習月記系統自動化測試主程式 v5
 *
 * session 說明：
 *   session.json         → 老師帳號（舊式手動登入，向下相容）
 *   session-teacher.json → 老師帳號（自動產生，優先使用）
 *   session-student.json → 學生帳號（自動產生，不需學生在場）
 *
 * 老師 session 取得優先順序：
 *   1. 自動模式（.env 有 TEST_TEACHER_EMAIL/PASSWORD）→ 每次自動重新登入產生 session-teacher.json
 *   2. 舊式手動 session（session.json 存在）→ 沿用（向下相容，不破壞現有流程）
 *   3. 都沒有 → 老師端測試失敗退出
 *
 * 學生 session 取得優先順序：
 *   1. 自動模式（.env 設定存在）→ 每次測試前自動用 Firebase SDK 重新登入
 *   2. 手動模式（.env 不存在但 session-student.json 存在）→ 沿用舊 session
 *   3. 無 session → S-07 以後的學生功能測試自動跳過
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const { runStudentTests } = require('./tests/student.test');
const { runTeacherTests } = require('./tests/teacher.test');
const { autoCreateStudentSession, loadEnv } = require('./auto-student-session');
const { autoCreateTeacherSession }          = require('./auto-teacher-session');

const SESSION_FILE         = path.join(__dirname, 'session.json');          // 舊式老師手動 session
const TEACHER_SESSION_FILE = path.join(__dirname, 'session-teacher.json'); // 新式老師自動 session
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
  // ⚠️ 這行是純手動同步的字串，不會自動反映 tests/*.test.js 的實際版本。
  //    每次 student.test.js 或 teacher.test.js 版本號變動（v 數字或測試數變動）時，
  //    要一併把下面日期改成 AI_CONTEXT.md 最新確認的日期，否則報告開頭會顯示過期版本。
  //    （這是同一個問題第七次過期：2026-06-24／2026-07-03／2026-07-11／2026-07-15／
  //    2026-07-17／2026-07-23 已發生過六次。第三次修正時試過「把當下最新版本號寫進這段
  //    註解」的做法，結果那組版本號本身也在幾天內過期，等於多製造一個要同步的地方——
   //    這次（第八次，2026-08-05，對應「薪資單多張上傳」補上自動化測試：
   //    student.test.js v26→v27 新增 S-SEC-42、teacher.test.js v26→v27 新增
   //    T-SEC-48）刻意不再重複這個做法，只更新日期本身。真要根治，仍建議改成執行時動態
  //    讀取 tests/*.test.js 開頭的版本注解，而不是任何形式的手動記憶，詳見
  //    AI_測試架構說明.md 第四節陷阱17。）
  log(`對應 AI_CONTEXT.md 版本：2026-08-05`);
  log('═'.repeat(50));

  // ── .env 讀取（一次，後面共用）────────────────────────
  const env = loadEnv();

  const hasTeacherEnvConfig = !!(
    (env.FIREBASE_API_KEY      || process.env.FIREBASE_API_KEY) &&
    (env.TEST_TEACHER_EMAIL    || process.env.TEST_TEACHER_EMAIL) &&
    (env.TEST_TEACHER_PASSWORD || process.env.TEST_TEACHER_PASSWORD)
  );

  const hasStudentEnvConfig = !!(
    (env.FIREBASE_API_KEY      || process.env.FIREBASE_API_KEY) &&
    (env.TEST_STUDENT_EMAIL    || process.env.TEST_STUDENT_EMAIL) &&
    (env.TEST_STUDENT_PASSWORD || process.env.TEST_STUDENT_PASSWORD)
  );

  // ── 啟動瀏覽器（session 尚未決定，先不設 storageState）──
  let browser;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
  } catch (err) {
    log(`\n❌ 無法啟動瀏覽器：${err.message}`);
    process.exit(1);
  }

  // ── 老師 session 處理（自動優先，向下相容舊 session.json）──
  let teacherSessionFile = null;

  if (runTeacher) {
    if (hasTeacherEnvConfig) {
      log('\n🤖 偵測到老師帳號 .env 設定，自動產生老師 session...');
      const ok = await autoCreateTeacherSession(browser, TEACHER_SESSION_FILE, log);
      if (ok) {
        teacherSessionFile = TEACHER_SESSION_FILE;
        log('   老師端測試將完整執行\n');
      } else {
        log('   ⚠️  老師自動登入失敗，嘗試沿用舊 session.json...');
        if (fs.existsSync(SESSION_FILE)) {
          teacherSessionFile = SESSION_FILE;
          log('   ✅ 沿用舊 session.json\n');
        } else {
          log('\n❌ 老師 session 取得失敗，且找不到舊的 session.json。');
          log('   請執行 Step3_RenewSession.bat 手動登入一次，或確認 .env 老師帳號設定正確。');
          await browser.close();
          process.exit(1);
        }
      }
    } else if (fs.existsSync(SESSION_FILE)) {
      // 向下相容：沒有老師 .env 設定但有舊 session.json，直接沿用
      teacherSessionFile = SESSION_FILE;
      log('\n✅ 使用舊式老師 session（session.json）');
      log('   提示：在 test-suite/.env 填入 TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD 可改為自動模式\n');
    } else {
      log('\n❌ 找不到老師 session，請先執行 Step3_RenewSession.bat 重新登入。');
      log('   或在 test-suite/.env 填入老師帳號設定以啟用自動模式。');
      await browser.close();
      process.exit(1);
    }
  }

  // ── 建立 browser context（老師 session 已決定）────────
  let context;
  try {
    const contextOptions = {
      viewport:   { width: 1280, height: 800 },
      locale:     'zh-TW',
      timezoneId: 'Asia/Taipei',
    };
    if (runTeacher && teacherSessionFile) {
      contextOptions.storageState = teacherSessionFile;
    }
    context = await browser.newContext(contextOptions);
  } catch (err) {
    log(`\n❌ 無法建立瀏覽器 context：${err.message}`);
    await browser.close();
    process.exit(1);
  }

  // ── 學生 session 處理（自動優先）────────────────────────
  let hasStudentSession = false;

  if (hasStudentEnvConfig) {
    log('\n🤖 偵測到學生帳號 .env 設定，自動產生學生 session...');
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
