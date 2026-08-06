// notify-service/overdue-logic.js
//
// 2026-07 新增：逾期未繳月記 → 通知學生本人。
//
// 這支檔案存在的理由跟 notify-logic.js 完全一樣——send-push-notifications.js 本體一旦
// 被 require()，就會立刻執行 admin.initializeApp(JSON.parse(process.env.FIREBASE_SERVICE_
// ACCOUNT_JSON))，沒辦法安全地被測試檔引用。checkOverdue() 的核心邏輯（撈學期/月份、撈
// deadlines、撈名冊、撈月記、判斷是否逾期、送通知、寫回已通知旗標）比 checkComments()／
// checkReplies()／checkNewJournals() 多了更多層查詢跟分支，如果直接寫在 send-push-
// notifications.js 裡，Layer 2（Firebase Emulator + 合成假資料）測試會完全無法覆蓋到。
//
// 解法：checkOverdueCore() 把「要用哪個 db」「怎麼送通知」「現在幾點」全部改成參數注入
// （dependency injection），這支檔案本身完全不 require('firebase-admin')、不建立任何
// Firestore/FCM 連線。正式執行時，send-push-notifications.js 的 checkOverdue() 只是薄薄
// 一層 wrapper，把真正的 db／sendToTokenDocs／new Date() 傳進來；Layer 2 測試則另外
// 建立一個接到 Firebase Emulator 的 db，搭配一個只負責記錄「被呼叫了幾次、傳了什麼參數」
// 的假 sendToTokenDocs（FCM 本身無法被 Emulator 模擬，Layer 2 的重點是驗證 Firestore
// 查詢／寫入邏輯本身，不是真的送出推播——那是 Layer 3 正式環境才驗證的事）。
//
// ⚠️ 跟 notify-logic.js 開頭同一則聲明：學期字串、deadlines／students 文件欄位名稱是
// 依文件記載推導、非逐行核對 teacher.html 原始碼得出，部署前請對照實際原始碼確認一次。

const {
  getCurrentSemesterInfo,
  getSemesterMonths,
  computeOverdueMonths,
  isStudentOverdueForMonth,
  buildOverdueNotificationBody,
} = require('./notify-logic');

/**
 * @param {object} opts
 * @param {FirebaseFirestore.Firestore} opts.db - 真實或指向 Emulator 的 Firestore 實例
 * @param {(tokenDocs: FirebaseFirestore.QueryDocumentSnapshot[], data: object) => Promise<void>} opts.sendToTokenDocs
 *   - 真實環境傳入 send-push-notifications.js 既有的 sendToTokenDocs()；
 *     Layer 2 測試傳入一個只記錄呼叫內容的假函式（不會真的打 FCM）。
 * @param {Date} [opts.now] - 用來判斷「現在幾點」，預設 new Date()；測試時可傳入固定時間，
 *   讓「截止日是否已過」這類跟時間相關的判斷可以重現、不受實際執行時間影響。
 * @param {string[]} [opts.seatWhitelist] - 開發期安全閥：非空陣列時，只處理座號在其中的
 *   學生，其餘座號完全跳過（見 send-push-notifications.js 的 OVERDUE_TEST_SEAT_WHITELIST
 *   說明）。留空或不傳＝正式模式，處理全部在籍學生。
 * @param {string} opts.siteBaseUrl - 通知點擊後導向的網址前綴（跟其餘三個檢查共用同一個
 *   SITE_BASE_URL 常數，這裡當參數傳入避免這支檔案自己也要維護一份）。
 */
async function checkOverdueCore({ db, sendToTokenDocs, now, seatWhitelist, siteBaseUrl }) {
  const refNow = now || new Date();
  const whitelist = Array.isArray(seatWhitelist) ? seatWhitelist.map(String) : [];

  const { semester, semesterNum } = getCurrentSemesterInfo(refNow);
  const months = getSemesterMonths(semesterNum);

  // 一次撈完目前學期全部月份的 deadlines 文件（一學期最多 7 筆，成本很低），
  // 用括號配對..不，這裡單純是 Promise.all 平行查詢，不需要逐月序列等待。
  const deadlineSnaps = await Promise.all(
    months.map((m) => db.collection('deadlines').doc(`${semester}-${m}`).get())
  );
  const deadlineDataByMonth = {};
  months.forEach((m, idx) => {
    const snap = deadlineSnaps[idx];
    if (snap && snap.exists) deadlineDataByMonth[m] = snap.data();
  });

  // 只留下「已經設定截止日、且截止日已過」的月份；沒設定或還沒截止的月份不需要
  // 往下查任何學生資料（省掉不必要的 Firestore 讀取，也避免對「還沒到期」的月份
  // 做出任何判斷）。
  const overdueMonths = computeOverdueMonths(months, deadlineDataByMonth, refNow);

  const result = { semester, overdueMonths: overdueMonths.map((m) => m.month), notified: [], skipped: [] };

  if (!overdueMonths.length) {
    console.log(`checkOverdue: 目前學期 ${semester} 沒有任何月份已逾期（或尚未設定截止日），本輪略過`);
    return result;
  }

  // 只認新格式 {semester}_{seatNo}（用 where('semester','==',semester) 篩選），
  // 跟 teacher.html loadRootRoster()／loadExportStudents() 既有的「找不到新格式不
  // fallback 舊格式」慣例一致——舊格式文件沒有 semester 欄位（或值不吻合），
  // 天然被這個查詢排除，不需要額外解析 doc id。
  const rosterSnap = await db.collection('students').where('semester', '==', semester).get();

  // studentBindings 是「目前 active 學期」唯一有效的 seatNo→uid 對照表——AI_CONTEXT.md
  // 「deleteStudent() 跨學期邊界案例修正」章節記載：每次啟用新學期名單都會把 studentBindings
  // 整批清空、只依新 active 學期名單重建，過去學期完全沒有保留任何 binding。這代表本來
  // 就只能、也只需要處理「目前 active 學期」的學生，這跟上面用日曆算出目前學期、再用
  // 這個學期去查 studentBindings 是同一件事的兩個面向，沒有額外風險。
  const bindingSnap = await db.collection('studentBindings').get();
  const seatToBinding = new Map();
  bindingSnap.docs.forEach((d) => {
    const data = d.data();
    if (data && data.seatNo != null && data.uid) {
      seatToBinding.set(String(data.seatNo), { uid: data.uid, docId: d.id });
    }
  });

  for (const rosterDoc of rosterSnap.docs) {
    // 跟 checkComments()/checkReplies()/checkNewJournals() 同一套逐筆 try/catch：
    // 單一學生處理失敗只記 log、continue 到下一位，不讓一筆壞資料拖住同一輪其餘學生。
    try {
      const rosterData = rosterDoc.data() || {};
      const seatNo = rosterData.seatNo;
      if (seatNo == null) continue;
      const seatNoStr = String(seatNo);

      if (whitelist.length && !whitelist.includes(seatNoStr)) {
        result.skipped.push({ seatNo: seatNoStr, reason: 'not_in_whitelist' });
        continue;
      }

      const binding = seatToBinding.get(seatNoStr);
      if (!binding) {
        // 該座號的學生從未登入過（studentBindings 尚未寫入 uid，見 rule.txt
        // 「老師開學匯入名單、學生尚未第一次登入」的空窗期情境），沒有 uid 就查不到
        // 任何月記或 fcmTokens，無從通知，也沒有「篇數不足」這件事可以判斷（他還沒
        // 有任何帳號可以寫月記），安全跳過。
        result.skipped.push({ seatNo: seatNoStr, reason: 'no_uid_binding' });
        continue;
      }

      const alreadyMap = rosterData.overdueNotifiedMonths || {};

      for (const { month, minEntries } of overdueMonths) {
        const flagKey = `${semester}-${month}`;
        if (alreadyMap[flagKey]) continue; // 這位學生這個月已經通知過，不重複通知

        const journalId = `${seatNo}-${semester}-${month}`;
        const journalSnap = await db.collection(`users/${binding.uid}/journals`).doc(journalId).get();
        const entriesCount =
          journalSnap.exists && Array.isArray(journalSnap.data().entries) ? journalSnap.data().entries.length : 0;

        if (!isStudentOverdueForMonth(entriesCount, minEntries)) continue; // 篇數已達標，不算逾期

        const tokensSnap = await db.collection(`users/${binding.uid}/fcmTokens`).get();
        if (tokensSnap.empty) {
          // 該生尚未授權推播（或裝置端 token 已被清除）。**刻意不寫入 overdueNotifiedMonths
          // 旗標**——跟其餘三個檢查遇到「沒有 token 就安靜跳過」不同的地方在於：那三個
          // 是「這次沒通知到，反正下次事件觸發會再判斷一次」，但逾期通知的觸發條件
          // （篇數不足＋截止日已過）本身不會消失，若在這裡就標記為已通知，這位學生會
          // 永遠錯過這則通知（哪天真的授權推播了也不會補收到）。代價是：只要這位學生
          // 一直沒有 token 又一直逾期，這裡就會一直重複查詢，直到他授權推播或補交為止；
          // 已用 alreadyMap 旗標把「有 token、已通知過」的學生排除在外，讀取量隨著逾期
          // 未授權推播的學生數與月數線性增加，量體不大（單班規模）時可接受。
          result.skipped.push({ seatNo: seatNoStr, month, reason: 'no_fcm_token' });
          continue;
        }

        const tag = `overdue:${binding.uid}:${flagKey}`;
        await sendToTokenDocs(tokensSnap.docs, {
          title: '⏰ 月記逾期未達標',
          body: buildOverdueNotificationBody(month, entriesCount, minEntries),
          tag,
          link: `${siteBaseUrl}/student.html`,
        });

        await rosterDoc.ref.update({ [`overdueNotifiedMonths.${flagKey}`]: true });
        result.notified.push({ seatNo: seatNoStr, month, uid: binding.uid });
      }
    } catch (e) {
      console.error(`checkOverdue: 處理座號 ${rosterDoc.id} 時發生例外，已跳過，本輪其餘學生繼續處理：`, e);
      continue;
    }
  }

  console.log(
    `checkOverdue: 學期 ${semester}，已逾期月份 [${result.overdueMonths.join(',')}]，本輪通知 ${result.notified.length} 筆`
  );
  return result;
}

module.exports = { checkOverdueCore };
