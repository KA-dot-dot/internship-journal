// notify-service/test-notify-logic.js
//
// 2026-07（稽核修正）：send-push-notifications.js 先前是整個 notify-service 資料夾裡
// 唯一沒有任何自動化測試覆蓋的核心程式檔（見 AI_推播系統說明.md 第六節 #5；
// 2026-07-10 更正：先前這裡誤寫成「AI_CONTEXT.md『推播通知』章節第 4 節⑤」，
// AI_CONTEXT.md 從未有過「推播通知」這個章節）。
// parseAsInstant()／alreadyNotified()／emailToDocId() 這三個函式已抽到 notify-logic.js
// （不依賴 firebase-admin、不碰網路，純粹是字串/日期計算），這支測試檔直接 require()
// 該檔案來測，不需要 Firestore Emulator、不需要 Service Account、也不需要任何網路連線，
// 執行方式跟本檔案風格比照 test-suite/rules-tests/test-rules.js：一個簡單的 test(name, fn)
// 包 try/catch 計數，最後印出 X/Y 通過並用 process.exit(fail>0?1:0) 讓 CI 能判斷成敗。
//
// 範圍說明：checkComments()／checkReplies()／collectAdminTokenDocs()／sendToTokenDocs()
// 這幾個會實際呼叫 Firestore／FCM 的函式，本次不納入測試範圍——要測那幾個需要完整的
// Firebase Admin SDK 模擬環境（例如另外接 Firestore Emulator 並用 Admin SDK 連線），
// 是更大的基礎建設工程；這裡優先覆蓋 parseAsInstant/alreadyNotified 這兩個函式，因為
// 過去兩次真實 bug（2026-07-07 缺 ContentAt 導致無限重推、2026-07-08 稽核發現的
// ContentAt DoS 疑慮）都是這兩個函式的時間比較邏輯，投資報酬率最高。
//
// 新增（逾期未繳月記通知）：getCurrentSemesterInfo()／getSemesterMonths()／
// resolveMinEntries()／computeOverdueMonths()／isStudentOverdueForMonth() 這五個函式是
// checkOverdue() 的核心決策邏輯（見 overdue-logic.js），同樣不碰 Firestore/網路，這裡是
// Layer 1（純邏輯）。真正的查詢/寫入邏輯（checkOverdueCore() 本身，含撈名冊、撈月記、
// 逐位學生逐月判斷、寫回 overdueNotifiedMonths 旗標）需要 Layer 2（Firebase Emulator +
// 合成假資料 + 假 sendToTokenDocs）才能測到，這支測試檔不涵蓋。

const assert = require('assert');
const {
  parseAsInstant,
  alreadyNotified,
  emailToDocId,
  getCurrentSemesterInfo,
  getSemesterMonths,
  resolveMinEntries,
  computeOverdueMonths,
  isStudentOverdueForMonth,
  buildOverdueNotificationBody,
} = require('./notify-logic');

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

async function main() {
  console.log('══════════════════════════════════════');
  console.log('notify-service 純邏輯單元測試（parseAsInstant／alreadyNotified／emailToDocId）');
  console.log('══════════════════════════════════════\n');

  // ════════════════════════════════════════════════════════════
  // parseAsInstant()
  // ════════════════════════════════════════════════════════════

  await test('parseAsInstant()：null／undefined／空字串 → null（不拋例外）', () => {
    assert.strictEqual(parseAsInstant(null), null);
    assert.strictEqual(parseAsInstant(undefined), null);
    assert.strictEqual(parseAsInstant(''), null);
  });

  await test('parseAsInstant()：非字串型別（數字/物件/陣列）→ null，不當成合法輸入誤剖析', () => {
    assert.strictEqual(parseAsInstant(1720000000000), null);
    assert.strictEqual(parseAsInstant({}), null);
    assert.strictEqual(parseAsInstant([]), null);
  });

  await test('parseAsInstant()：明顯不是日期的字串 → null', () => {
    assert.strictEqual(parseAsInstant('這不是時間字串'), null);
    assert.strictEqual(parseAsInstant('abcdefg'), null);
  });

  await test('parseAsInstant()：localISOStr() 格式（無時區資訊）→ 視為台灣時間（+08:00）剖析', () => {
    const d = parseAsInstant('2026-07-08T12:00:00');
    assert.ok(d instanceof Date);
    // 2026-07-08T12:00:00+08:00 換算 UTC 應為 2026-07-08T04:00:00.000Z
    assert.strictEqual(d.toISOString(), '2026-07-08T04:00:00.000Z');
  });

  await test('parseAsInstant()：帶 Z 尾碼的標準 UTC 字串（notifiedAt 自己寫入的格式）→ 直接剖析，不再疊加時區', () => {
    const d = parseAsInstant('2026-07-08T04:00:00.000Z');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.toISOString(), '2026-07-08T04:00:00.000Z');
  });

  await test('parseAsInstant()：帶明確時區偏移（+08:00／-05:00）的字串 → 直接剖析，不再疊加時區', () => {
    const d1 = parseAsInstant('2026-07-08T12:00:00+08:00');
    assert.strictEqual(d1.toISOString(), '2026-07-08T04:00:00.000Z');
    const d2 = parseAsInstant('2026-07-08T00:00:00-05:00');
    assert.strictEqual(d2.toISOString(), '2026-07-08T05:00:00.000Z');
  });

  await test('parseAsInstant()：無時區字串與帶 Z 字串，對同一個真實時刻換算結果一致（迴歸：避免時區bug重現）', () => {
    // 台灣時間 2026-07-08 12:00:00，換算 UTC 應為 04:00:00Z——這正是 AI_CONTEXT.md
    // 記錄過的時區bug類型：若誤把 localISOStr() 字串直接當 UTC 解析，會相差 8 小時，
    // 這條測試直接鎖死換算結果，未來如果 parseAsInstant() 被改壞會立刻測出來。
    const local = parseAsInstant('2026-07-08T12:00:00');
    const utc = parseAsInstant('2026-07-08T04:00:00Z');
    assert.strictEqual(local.getTime(), utc.getTime());
  });

  // ════════════════════════════════════════════════════════════
  // alreadyNotified()
  // ════════════════════════════════════════════════════════════

  await test('alreadyNotified()：兩個參數都缺（新資料，從未通知過）→ false（保守起見，寧可多通知不要漏掉）', () => {
    assert.strictEqual(alreadyNotified(null, null), false);
    assert.strictEqual(alreadyNotified(undefined, undefined), false);
  });

  await test('alreadyNotified()：只有 contentAt 缺（2026-07-07 那次舊資料遷移情境）→ false', () => {
    assert.strictEqual(alreadyNotified('2026-07-08T04:00:00Z', null), false);
  });

  await test('alreadyNotified()：只有 notifiedAt 缺 → false', () => {
    assert.strictEqual(alreadyNotified(null, '2026-07-08T12:00:00'), false);
  });

  await test('alreadyNotified()：notifiedAt 明顯晚於 contentAt → true（已通知過，不再重推）', () => {
    // notifiedAt 是腳本自己寫入的 UTC 字串，contentAt 是使用者裝置的台灣時間字串，
    // 這裡刻意跨兩種格式驗證比較邏輯正確（不是單純比字串，而是換算成同一個時間戳比較）。
    assert.strictEqual(
      alreadyNotified('2026-07-08T05:00:00.000Z', '2026-07-08T12:00:00'),
      true
    );
  });

  await test('alreadyNotified()：notifiedAt 明顯早於 contentAt（內容在通知之後又改過）→ false（要再通知一次）', () => {
    assert.strictEqual(
      alreadyNotified('2026-07-08T03:00:00.000Z', '2026-07-08T12:00:00'),
      false
    );
  });

  await test('alreadyNotified()：notifiedAt 與 contentAt 換算成同一時刻（邊界值）→ true（>= 是含等於的）', () => {
    assert.strictEqual(
      alreadyNotified('2026-07-08T04:00:00.000Z', '2026-07-08T12:00:00'),
      true
    );
  });

  await test('alreadyNotified()：contentAt 是格式無法解析的垃圾字串 → false（迴歸：對應稽核發現的 DoS 疑慮，垃圾字串一律視為未通知，會持續重推，非本函式能單獨防禦，需搭配 rule.txt 格式驗證，見 AI_推播系統說明.md 第六節 #2；2026-07-10 更正原「AI_CONTEXT.md 待修正②」的錯誤引用）', () => {
    assert.strictEqual(alreadyNotified('2026-07-08T05:00:00.000Z', '不是時間字串'), false);
  });

  await test('alreadyNotified()：contentAt 被灌入遙遠未來時間（格式合法，模擬稽核發現的攻擊手法）→ false（會持續重推，這是 rule.txt 需要另外擋下的原因，本函式本身行為正確、如實反映「尚未通知過這個時間點」）', () => {
    assert.strictEqual(
      alreadyNotified('2026-07-08T05:00:00.000Z', '2099-12-31T23:59:59'),
      false
    );
  });

  // ════════════════════════════════════════════════════════════
  // emailToDocId()
  // ════════════════════════════════════════════════════════════

  await test('emailToDocId()：一般學校信箱 → @ 與 . 皆替換成底線', () => {
    assert.strictEqual(emailToDocId('teacher@tcivs.tc.edu.tw'), 'teacher_tcivs_tc_edu_tw');
  });

  await test('emailToDocId()：大小寫與前後空白正規化（跟 teacher.html 同名函式行為一致）', () => {
    assert.strictEqual(emailToDocId('  Teacher@TCIVS.TC.EDU.TW  '), 'teacher_tcivs_tc_edu_tw');
  });

  await test('emailToDocId()：null／undefined／空字串 → 空字串（不拋例外，呼叫端可安全比對）', () => {
    assert.strictEqual(emailToDocId(null), '');
    assert.strictEqual(emailToDocId(undefined), '');
    assert.strictEqual(emailToDocId(''), '');
  });

  // ════════════════════════════════════════════════════════════
  // getCurrentSemesterInfo()（逾期未繳月記通知新增）
  // ════════════════════════════════════════════════════════════

  await test('getCurrentSemesterInfo()：7月（第1學期起點）→ semesterNum=1，twYear不變', () => {
    // 2026-07-15 台灣時間中午 = 2026-07-15T04:00:00Z
    const r = getCurrentSemesterInfo(new Date('2026-07-15T04:00:00Z'));
    assert.strictEqual(r.semester, '115-1');
    assert.strictEqual(r.semesterNum, 1);
  });

  await test('getCurrentSemesterInfo()：1月（第1學期尾端，跨西元年）→ ROC年減1，semesterNum=1', () => {
    // 2026-01-15 台灣時間中午 = 2026-01-15T04:00:00Z
    const r = getCurrentSemesterInfo(new Date('2026-01-15T04:00:00Z'));
    assert.strictEqual(r.semester, '114-1');
    assert.strictEqual(r.semesterNum, 1);
  });

  await test('getCurrentSemesterInfo()：2月（第2學期起點）→ semesterNum=2', () => {
    const r = getCurrentSemesterInfo(new Date('2026-02-15T04:00:00Z'));
    assert.strictEqual(r.semester, '114-2');
    assert.strictEqual(r.semesterNum, 2);
  });

  await test('getCurrentSemesterInfo()：6月（第2學期尾端）→ semesterNum=2', () => {
    const r = getCurrentSemesterInfo(new Date('2026-06-15T04:00:00Z'));
    assert.strictEqual(r.semester, '114-2');
    assert.strictEqual(r.semesterNum, 2);
  });

  await test('getCurrentSemesterInfo()：UTC 傍晚跨進台灣隔天（迴歸：日期邊界時區換算）→ 用台灣當地日期判斷，不是 UTC 日期', () => {
    // UTC 2026-06-30T16:30:00Z = 台灣時間 2026-07-01T00:30:00+08:00——如果誤用
    // refDate.getUTCMonth() 不加時區偏移，會誤判成還在6月（114-2），但台灣當地已經是
    // 7月1日，應該算115-1。這條測試直接鎖死換算方向正確，避免退化成只看 UTC 日期。
    const r = getCurrentSemesterInfo(new Date('2026-06-30T16:30:00Z'));
    assert.strictEqual(r.semester, '115-1');
    assert.strictEqual(r.semesterNum, 1);
  });

  await test('getCurrentSemesterInfo()：未傳入參數或傳入非 Date → fallback 為目前時間，不拋例外', () => {
    assert.doesNotThrow(() => getCurrentSemesterInfo());
    assert.doesNotThrow(() => getCurrentSemesterInfo('not a date'));
    assert.doesNotThrow(() => getCurrentSemesterInfo(new Date('invalid')));
  });

  // ════════════════════════════════════════════════════════════
  // getSemesterMonths()
  // ════════════════════════════════════════════════════════════

  await test('getSemesterMonths(1)：第1學期為 7~12月＋隔年1月，共7個月，順序不變', () => {
    assert.deepStrictEqual(getSemesterMonths(1), [7, 8, 9, 10, 11, 12, 1]);
  });

  await test('getSemesterMonths(2)：第2學期為 2~6月，共5個月', () => {
    assert.deepStrictEqual(getSemesterMonths(2), [2, 3, 4, 5, 6]);
  });

  // ════════════════════════════════════════════════════════════
  // resolveMinEntries()（與 teacher.html 同名函式行為一致）
  // ════════════════════════════════════════════════════════════

  await test('resolveMinEntries()：deadlineDoc 為 undefined（該月從未設定期限）→ fallback 1', () => {
    assert.strictEqual(resolveMinEntries(undefined), 1);
  });

  await test('resolveMinEntries()：minEntries 欄位不存在 → fallback 1', () => {
    assert.strictEqual(resolveMinEntries({ closeDate: '2026-07-31' }), 1);
  });

  await test('resolveMinEntries()：minEntries 為合法 >=1 整數 → 直接採用', () => {
    assert.strictEqual(resolveMinEntries({ minEntries: 3 }), 3);
  });

  await test('resolveMinEntries()：minEntries 為 0 或負數（不合法）→ fallback 1', () => {
    assert.strictEqual(resolveMinEntries({ minEntries: 0 }), 1);
    assert.strictEqual(resolveMinEntries({ minEntries: -2 }), 1);
  });

  await test('resolveMinEntries()：minEntries 為非整數（含字串型數字）→ fallback 1', () => {
    assert.strictEqual(resolveMinEntries({ minEntries: 2.5 }), 1);
    assert.strictEqual(resolveMinEntries({ minEntries: '3' }), 1);
  });

  // ════════════════════════════════════════════════════════════
  // computeOverdueMonths()
  // ════════════════════════════════════════════════════════════

  await test('computeOverdueMonths()：該月沒有 deadlines 文件 → 不列入逾期範圍（不是「不逾期」，是「沒有答案」）', () => {
    const result = computeOverdueMonths([9], {}, new Date('2026-09-15T04:00:00Z'));
    assert.deepStrictEqual(result, []);
  });

  await test('computeOverdueMonths()：deadlines 文件存在但截止日尚未到 → 不列入', () => {
    const dd = { 9: { closeDate: '2026-09-30' } };
    const result = computeOverdueMonths([9], dd, new Date('2026-09-15T04:00:00Z'));
    assert.deepStrictEqual(result, []);
  });

  await test('computeOverdueMonths()：截止日已過 → 列入，且帶上 resolveMinEntries() 算好的 minEntries', () => {
    const dd = { 7: { closeDate: '2026-07-31', minEntries: 2 }, 8: { closeDate: '2026-08-31' } };
    const result = computeOverdueMonths([7, 8], dd, new Date('2026-09-15T04:00:00Z'));
    assert.deepStrictEqual(result, [
      { month: 7, minEntries: 2 },
      { month: 8, minEntries: 1 },
    ]);
  });

  await test('computeOverdueMonths()：邊界值——現在剛好是截止日 23:59:59 台灣時間 → 尚未逾期（跟 isOverdueIncomplete 的 <= 語意一致，不提早算逾期）', () => {
    const dd = { 7: { closeDate: '2026-07-31' } };
    const result = computeOverdueMonths([7], dd, new Date('2026-07-31T15:59:59Z')); // = 台灣 23:59:59
    assert.deepStrictEqual(result, []);
  });

  await test('computeOverdueMonths()：邊界值——截止日過後 1 秒 → 判定逾期', () => {
    const dd = { 7: { closeDate: '2026-07-31' } };
    const result = computeOverdueMonths([7], dd, new Date('2026-07-31T16:00:00Z')); // = 台灣 8/1 00:00:00
    assert.deepStrictEqual(result, [{ month: 7, minEntries: 1 }]);
  });

  await test('computeOverdueMonths()：closeDate 格式不合法的垃圾字串 → 保守跳過，不拋例外、不誤判為逾期', () => {
    const dd = { 7: { closeDate: '不是日期字串' } };
    assert.doesNotThrow(() => {
      const result = computeOverdueMonths([7], dd, new Date('2026-09-15T04:00:00Z'));
      assert.deepStrictEqual(result, []);
    });
  });

  await test('computeOverdueMonths()：months 為空陣列或 undefined → 回傳空陣列，不拋例外', () => {
    assert.deepStrictEqual(computeOverdueMonths([], {}, new Date()), []);
    assert.deepStrictEqual(computeOverdueMonths(undefined, {}, new Date()), []);
  });

  // ════════════════════════════════════════════════════════════
  // isStudentOverdueForMonth()
  // ════════════════════════════════════════════════════════════

  await test('isStudentOverdueForMonth()：篇數少於門檻 → true（需要提醒）', () => {
    assert.strictEqual(isStudentOverdueForMonth(1, 2), true);
    assert.strictEqual(isStudentOverdueForMonth(0, 1), true);
  });

  await test('isStudentOverdueForMonth()：篇數達到或超過門檻 → false（不論是否曾經遲交，都不需要提醒）', () => {
    assert.strictEqual(isStudentOverdueForMonth(2, 2), false);
    assert.strictEqual(isStudentOverdueForMonth(5, 2), false);
  });

  await test('isStudentOverdueForMonth()：entriesCount 為 0／null／undefined 皆視為 0 篇，不拋例外', () => {
    assert.strictEqual(isStudentOverdueForMonth(0, 1), true);
    assert.strictEqual(isStudentOverdueForMonth(null, 1), true);
    assert.strictEqual(isStudentOverdueForMonth(undefined, 1), true);
  });

  await test('isStudentOverdueForMonth()：minEntries 不合法（0／負數／非整數）→ fallback 為 1 再比較', () => {
    assert.strictEqual(isStudentOverdueForMonth(1, 0), false); // fallback=1，1篇已達標
    assert.strictEqual(isStudentOverdueForMonth(0, 0), true); // fallback=1，0篇未達標
  });

  // ════════════════════════════════════════════════════════════
  // buildOverdueNotificationBody()（2026-08 新增：補上「已交幾篇、尚差幾篇」文案）
  // ════════════════════════════════════════════════════════════

  await test('buildOverdueNotificationBody()：目標情境——7月規定2篇，只交1篇 → 文字含月份/需求篇數/已交篇數/尚差篇數', () => {
    const body = buildOverdueNotificationBody(7, 1, 2);
    assert.strictEqual(
      body,
      '7月的實習月記目前還沒達到最低篇數（需 2 篇，已交 1 篇，尚差 1 篇），記得儘快補上，避免影響審閱進度。'
    );
  });

  await test('buildOverdueNotificationBody()：完全沒交（0篇）→ 尚差等於需求篇數本身', () => {
    const body = buildOverdueNotificationBody(9, 0, 3);
    assert.ok(body.includes('已交 0 篇'));
    assert.ok(body.includes('尚差 3 篇'));
  });

  await test('buildOverdueNotificationBody()：minEntries 不合法（0／負數／非整數）→ fallback 為 1 再計算尚差，與 isStudentOverdueForMonth() 的 fallback 規則一致', () => {
    assert.ok(buildOverdueNotificationBody(5, 0, 0).includes('需 1 篇'));
    assert.ok(buildOverdueNotificationBody(5, 0, -2).includes('需 1 篇'));
    assert.ok(buildOverdueNotificationBody(5, 0, 2.5).includes('需 1 篇'));
  });

  await test('buildOverdueNotificationBody()：entriesCount 不合法（null/undefined/負數/非整數）→ 視為 0 篇計算，不印出 NaN 或負的尚差篇數', () => {
    assert.ok(buildOverdueNotificationBody(5, null, 2).includes('已交 0 篇'));
    assert.ok(buildOverdueNotificationBody(5, undefined, 2).includes('已交 0 篇'));
    assert.ok(buildOverdueNotificationBody(5, -1, 2).includes('已交 0 篇'));
    assert.ok(buildOverdueNotificationBody(5, 1.5, 2).includes('已交 0 篇'));
  });

  await test('buildOverdueNotificationBody()：防禦性情境——entriesCount 意外 >= minEntries（正常呼叫路徑不會發生，因為呼叫前已經過 isStudentOverdueForMonth() 篩選）→ 尚差篇數不會變成負數', () => {
    const body = buildOverdueNotificationBody(5, 5, 2);
    assert.ok(body.includes('尚差 0 篇'), '尚差篇數應以 0 為下限，不應出現負數');
  });

  // ════════════════════════════════════════════════════════════
  // 結果輸出
  // ════════════════════════════════════════════════════════════
  console.log('\n──────────────────────────────────────');
  console.log(`notify-service 邏輯單元測試結果：${pass}/${pass + fail} 通過，${fail} 失敗`);
  if (fail > 0) {
    console.log('失敗項目：');
    failedNames.forEach((n) => console.log('  ✗ ' + n));
  }
  console.log('──────────────────────────────────────');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ 測試執行過程發生未預期錯誤：', e);
  process.exit(1);
});
