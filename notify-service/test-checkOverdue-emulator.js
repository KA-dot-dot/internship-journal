// notify-service/test-checkOverdue-emulator.js
//
// Layer 2（Firebase Emulator + 合成假資料）測試：checkOverdueCore() 本身的查詢/寫入邏輯
// （撈目前學期全部月份的 deadlines、篩出已逾期的月份、逐位在籍學生逐月比對月記篇數、
// 通知、寫回 overdueNotifiedMonths 旗標）。Layer 1（test-notify-logic.js）只測到
// checkOverdueCore() 依賴的五個純函式，測不到「真的對 Firestore 下查詢/寫入」這件事本身
// 對不對——這支測試檔補這一塊，完全不碰 FCM（用一個只負責記錄呼叫內容的假
// sendToTokenDocs 取代），也完全不碰正式 Firestore（連的是本機 Firestore Emulator）。
//
// ⚠️ 執行前置需求（跟 test-suite/rules-tests/RunRulesTest.bat 是同一類需求）：
//   1) 本機已安裝 firebase-tools，且能啟動 Firestore Emulator（跟 Layer 1 的
//      test-rules.js 用的是同一顆 Emulator，這裡沒有另外引入新的依賴或版本要求）。
//   2) 啟動 Emulator：於任一已設定好 firebase.json 的資料夾執行
//      `firebase emulators:start --only firestore`（預設監聽 localhost:8080，可用
//      FIRESTORE_EMULATOR_HOST 環境變數覆蓋，例如 Emulator 啟動時印出的埠號不是 8080）。
//   3) 另開一個終端機，在本檔案所在目錄執行 `node test-checkOverdue-emulator.js`。
//   4) **這支測試檔在本次任務的沙盒環境中尚未實際執行過**——沙盒沒有網路權限下載/啟動
//      Firestore Emulator（跟 Firebase 相關網域不在允許清單內）。已完成的是：①逐行核對
//      checkOverdueCore() 實際程式碼、②`node --check` 語法驗證通過、③下方每個情境的
//      預期結果都對照 Layer 1 已實測通過的純函式邏輯手動推演過。**請在本機實際執行一次
//      確認全部通過**，再視為這個功能正式完工（比照這個專案一貫的驗證標準：讀程式碼
//      不等於實際執行過，兩者要分開標注，見 AI_推播系統說明.md 第九節既有提醒）。
//
// 測試資料採用「每個情境用完全獨立的座號/學期字串」隔離，不共用種子資料、不需要在測試
// 之間清空整個 Emulator——跟 test-rules.js 用不同 existing-01/02 種子資料分流的精神一致，
// 避免情境之間互相污染又不用寫複雜的 afterEach 清理邏輯。

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-overdue-test';

const assert = require('assert');
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

let pass = 0;
let fail = 0;
const failedNames = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ✅ ' + name);
  } catch (e) {
    fail++;
    failedNames.push(name);
    console.log('  ❌ ' + name);
    console.log('     原因：' + String(e.message || e).split('\n')[0]);
  }
}

// 建一個只記錄呼叫內容、不會真的打 FCM 的假 sendToTokenDocs——checkOverdueCore() 對它的
// 使用方式跟真正的 sendToTokenDocs(tokenDocs, data) 完全一樣（見 send-push-notifications.js），
// 這裡只是把「送出」換成「記錄」，好讓測試可以斷言「有沒有被呼叫、呼叫了幾次、傳了什麼」。
function makeFakeSender() {
  const calls = [];
  const fn = async (tokenDocs, data) => {
    calls.push({ tokenIds: tokenDocs.map((d) => d.id), data });
  };
  fn.calls = calls;
  return fn;
}

// 依序建立：/students/{semester}_{seatNo}、/studentBindings/{emailKey}（含 uid）、
// /deadlines/{semester}-{month}、/users/{uid}/journals/{seatNo}-{semester}-{month}（可省略）、
// /users/{uid}/fcmTokens/{token}（可省略，省略時模擬「該生從未授權推播」）。
// 用一個物件描述一位學生的完整情境，避免每個測試各自手刻六七次 Firestore 呼叫。
async function seedStudent({ semester, seatNo, uid, email, deadlines, entriesCount, hasToken, overdueNotifiedMonths }) {
  await db.doc(`students/${semester}_${seatNo}`).set({
    seatNo,
    name: `測試生${seatNo}`,
    company: '測試公司',
    semester,
    updatedAt: new Date().toISOString(),
    ...(overdueNotifiedMonths ? { overdueNotifiedMonths } : {}),
  });
  await db.doc(`studentBindings/${email.replace(/[@.]/g, '_')}`).set({
    email,
    seatNo,
    studentName: `測試生${seatNo}`,
    uid,
  });
  for (const [month, dd] of Object.entries(deadlines || {})) {
    await db.doc(`deadlines/${semester}-${month}`).set({ semester, month: Number(month), ...dd });
  }
  if (entriesCount !== undefined) {
    for (const [month, count] of Object.entries(entriesCount)) {
      const journalId = `${seatNo}-${semester}-${month}`;
      await db.doc(`users/${uid}/journals/${journalId}`).set({
        seatNo,
        semester,
        month: Number(month),
        entries: Array.from({ length: count }, (_, i) => ({ type: '職場實習', content: `測試內容${i}` })),
      });
    }
  }
  if (hasToken) {
    await db.doc(`users/${uid}/fcmTokens/fake-token-${seatNo}`).set({
      createdAt: new Date().toISOString(),
      userAgent: 'test-agent',
    });
  }
}

async function cleanup(prefix) {
  // 只清掉這次任務用到的合成資料，用固定前綴（測試學期字串）隔離，不影響 Emulator 裡
  // 其他測試（例如 Layer 1 的 test-rules.js）可能留下的資料。
  const collections = ['students', 'deadlines'];
  for (const col of collections) {
    const snap = await db.collection(col).get();
    const toDelete = snap.docs.filter((d) => d.id.includes(prefix));
    await Promise.all(toDelete.map((d) => d.ref.delete()));
  }
  // studentBindings 的 doc ID 是 emailKey（不含學期字串），沒辦法用同一招按 prefix 篩，
  // 改成用這支測試檔固定使用的 email 樣式（ovNN@tcivs.tc.edu.tw）辨認並清掉。
  const bindSnap = await db.collection('studentBindings').get();
  const toDeleteBindings = bindSnap.docs.filter((d) => /^ov\d+_tcivs_tc_edu_tw$/.test(d.id));
  await Promise.all(toDeleteBindings.map((d) => d.ref.delete()));
}

// checkOverdueCore() 用 refNow 判斷「現在幾點」，這裡固定成一個測試用的絕對時間點，
// 讓「截止日是否已過」這類跟時間相關的判斷可重現，不受實際執行時間影響。
// checkOverdueCore() 內部用 getCurrentSemesterInfo(refNow) 自己算出目前學期字串，不接受
// 呼叫端注入 semester——這裡故意不手刻一個看起來像測試資料的學期字串（例如 "T2-1"），
// 而是直接呼叫同一個函式反推，保證測試資料的 semester 欄位永遠跟 checkOverdueCore() 實際
// 查詢時用的字串一致，不會因為手刻字串跟真正的學期計算邏輯不同步而讓全部測試看似通過
// 查詢卻其實查到空集合（這正是這支測試檔第一版草稿踩到、後來核對 overdue-logic.js
// 原始碼才發現的問題：checkOverdueCore() 沒有「注入 semester」這個參數）。
const { getCurrentSemesterInfo } = require('./notify-logic');
const FIXED_NOW = new Date('2026-09-15T04:00:00Z'); // 台灣時間 2026-09-15 12:00
const SEM = getCurrentSemesterInfo(FIXED_NOW).semester; // 這個固定時間點換算出來的真實學期字串（例如 "115-1"）

async function main() {
  console.log('══════════════════════════════════════');
  console.log('checkOverdueCore() Layer 2 測試（Firebase Emulator + 合成假資料）');
  console.log('══════════════════════════════════════\n');

  const { checkOverdueCore } = require('./overdue-logic');
  console.log(`（本次測試使用的合成學期字串：${SEM}，由 FIXED_NOW 透過 getCurrentSemesterInfo() 反推得出）\n`);

  await test('已逾期、篇數不足、有 token → 通知一次，且寫回 overdueNotifiedMonths 旗標', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '01',
      uid: 'uid-01',
      email: 'ov01@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 2 } }, // 已過期（FIXED_NOW 是 9/15）
      entriesCount: { 9: 1 }, // 只交1篇，未達標
      hasToken: true,
    });
    const sender = makeFakeSender();
    const result = await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });

    assert.strictEqual(sender.calls.length, 1, '應該呼叫一次 sendToTokenDocs');
    assert.deepStrictEqual(sender.calls[0].tokenIds, ['fake-token-01']);
    assert.ok(result.notified.some((n) => n.seatNo === '01' && n.month === 9));
    // 2026-08 新增：驗證 checkOverdueCore() 真的把 entriesCount／minEntries 傳給
    // buildOverdueNotificationBody()（見 notify-logic.js）、文案含「已交幾篇、尚差幾篇」——
    // Layer 1（test-notify-logic.js）測的是這個函式本身算得對不對，這裡驗證的是
    // checkOverdueCore() 有沒有正確把查到的 entriesCount 傳進去（這一筆是「規定2篇、
    // 只交1篇」，尚差應為 1）。
    assert.ok(sender.calls[0].data.body.includes('已交 1 篇'), '通知內文應含已交篇數');
    assert.ok(sender.calls[0].data.body.includes('尚差 1 篇'), '通知內文應含尚差篇數');

    const rosterSnap = await db.doc(`students/${SEM}_01`).get();
    assert.strictEqual(rosterSnap.data().overdueNotifiedMonths?.[`${SEM}-9`], true, '旗標應已寫回名冊文件');
  });

  await test('篇數已達標 → 不通知（不論是否曾遲交）', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '02',
      uid: 'uid-02',
      email: 'ov02@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 2 } },
      entriesCount: { 9: 2 }, // 剛好達標
      hasToken: true,
    });
    const sender = makeFakeSender();
    await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 0);
  });

  await test('截止日尚未到 → 不通知', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '03',
      uid: 'uid-03',
      email: 'ov03@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-30', minEntries: 1 } }, // 還沒過期
      entriesCount: { 9: 0 },
      hasToken: true,
    });
    const sender = makeFakeSender();
    await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 0);
  });

  await test('已經通知過（旗標已是 true）→ 不重複通知', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '04',
      uid: 'uid-04',
      email: 'ov04@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 1 } },
      entriesCount: { 9: 0 },
      hasToken: true,
      overdueNotifiedMonths: { [`${SEM}-9`]: true },
    });
    const sender = makeFakeSender();
    await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 0);
  });

  await test('沒有 fcmTokens（從未授權推播）→ 不通知，且**不寫入旗標**（下一輪還要能重試）', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '05',
      uid: 'uid-05',
      email: 'ov05@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 1 } },
      entriesCount: { 9: 0 },
      hasToken: false,
    });
    const sender = makeFakeSender();
    const result = await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 0);
    const rosterSnap = await db.doc(`students/${SEM}_05`).get();
    assert.strictEqual(rosterSnap.data().overdueNotifiedMonths, undefined, '沒有 token 時不該寫入旗標，避免這位學生永遠錯過這則通知');
    assert.ok(result.skipped.some((s) => s.seatNo === '05' && s.reason === 'no_fcm_token'));
  });

  await test('studentBindings 沒有 uid（該生從未登入過）→ 安全跳過，不拋例外', async () => {
    await cleanup(SEM);
    // 刻意不寫 uid，模擬「老師建好名冊、學生本人尚未第一次登入」的空窗期
    await db.doc(`students/${SEM}_06`).set({ seatNo: '06', name: '測試生06', semester: SEM, updatedAt: new Date().toISOString() });
    await db.doc(`studentBindings/ov06_tcivs_tc_edu_tw`).set({ email: 'ov06@tcivs.tc.edu.tw', seatNo: '06', studentName: '測試生06' });
    await db.doc(`deadlines/${SEM}-9`).set({ semester: SEM, month: 9, closeDate: '2026-09-01', minEntries: 1 });

    const sender = makeFakeSender();
    const result = await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 0);
    assert.ok(result.skipped.some((s) => s.seatNo === '06' && s.reason === 'no_uid_binding'));
  });

  await test('seatWhitelist 限定座號 → 只處理名單內座號，其餘座號完全跳過（開發期安全閥）', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '07',
      uid: 'uid-07',
      email: 'ov07@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 1 } },
      entriesCount: { 9: 0 },
      hasToken: true,
    });
    await seedStudent({
      semester: SEM,
      seatNo: '08',
      uid: 'uid-08',
      email: 'ov08@tcivs.tc.edu.tw',
      deadlines: { 9: { closeDate: '2026-09-01', minEntries: 1 } },
      entriesCount: { 9: 0 },
      hasToken: true,
    });
    const sender = makeFakeSender();
    const result = await checkOverdueCore({
      db,
      sendToTokenDocs: sender,
      now: FIXED_NOW,
      siteBaseUrl: 'https://example.test',
      seatWhitelist: ['07'],
    });
    assert.strictEqual(sender.calls.length, 1, '只有座號07該被通知');
    assert.ok(result.notified.some((n) => n.seatNo === '07'));
    assert.ok(!result.notified.some((n) => n.seatNo === '08'));
    assert.ok(result.skipped.some((s) => s.seatNo === '08' && s.reason === 'not_in_whitelist'));
  });

  await test('同一位學生跨兩個已逾期月份都篇數不足 → 各自獨立通知兩次，各自寫入對應月份的旗標', async () => {
    await cleanup(SEM);
    await seedStudent({
      semester: SEM,
      seatNo: '09',
      uid: 'uid-09',
      email: 'ov09@tcivs.tc.edu.tw',
      deadlines: {
        7: { closeDate: '2026-07-31', minEntries: 1 },
        8: { closeDate: '2026-08-31', minEntries: 1 },
      },
      entriesCount: { 7: 0, 8: 0 },
      hasToken: true,
    });
    const sender = makeFakeSender();
    await checkOverdueCore({ db, sendToTokenDocs: sender, now: FIXED_NOW, siteBaseUrl: 'https://example.test' });
    assert.strictEqual(sender.calls.length, 2, '7月和8月應各自觸發一次通知');
    const rosterSnap = await db.doc(`students/${SEM}_09`).get();
    assert.strictEqual(rosterSnap.data().overdueNotifiedMonths?.[`${SEM}-7`], true);
    assert.strictEqual(rosterSnap.data().overdueNotifiedMonths?.[`${SEM}-8`], true);
  });

  await cleanup(SEM);

  console.log('\n──────────────────────────────────────');
  console.log(`checkOverdueCore() Layer 2 測試結果：${pass}/${pass + fail} 通過，${fail} 失敗`);
  if (fail > 0) {
    console.log('失敗項目：');
    failedNames.forEach((n) => console.log('  ✗ ' + n));
  }
  console.log('──────────────────────────────────────');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ 測試執行過程發生未預期錯誤（若訊息提到 ECONNREFUSED，代表 Firestore Emulator 沒有在跑，見檔案開頭的執行前置需求）：', e);
  process.exit(1);
});
