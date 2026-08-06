// notify-service/notify-logic.js
//
// 2026-07（稽核修正）：從 send-push-notifications.js 抽出來的純邏輯函式，抽出的理由是
// send-push-notifications.js 本體在被 require() 的當下就會立刻執行
// admin.initializeApp(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
// 以及檔案最底部的排程主流程 IIFE——這代表原本完全沒有辦法安全地把它 require() 進測試檔
// 裡（沒設環境變數會直接噴錯，設了則會真的打正式 Firestore/FCM）。這支檔案本身完全不
// require('firebase-admin')、不碰任何網路或環境變數，純粹是字串/日期計算，可以被
// send-push-notifications.js（正式執行）與 test-notify-logic.js（測試）同時安全 require()。
//
// 這三個函式正是這個子系統過去兩次真實 bug（2026-07-07 缺 ContentAt 導致無限重推、
// 2026-07-08 稽核發現 ContentAt 缺格式驗證可被灌入未來時間）的核心邏輯所在，也是
// AI_推播系統說明.md 第六節 #5 點名「唯一沒有任何自動化測試覆蓋的核心程式檔」
// 的主要對象，優先把這三個函式的邏輯覆蓋起來，投資報酬率最高。
// （2026-07-10 更正：先前這裡誤寫成「AI_CONTEXT.md『推播通知』章節第 4 節⑤」，
// AI_CONTEXT.md 從未有過「推播通知」這個章節，本子系統文件依設計獨立成
// AI_推播系統說明.md，詳見該檔第六節 #13。）

// ---------------------------------------------------------------------------
// teacherCommentContentAt / studentReplyContentAt 都是 student.html／teacher.html 共用的
// localISOStr() 產生的字串，格式為 'YYYY-MM-DDTHH:mm:ss'——刻意不帶任何時區資訊，但語意上
// 一律是「使用者裝置的本地時間」（本專案使用者全部在台灣，等同台灣時間 +08:00）。這支腳本
// 自己寫入的 teacherCommentNotifiedAt／studentReplyNotifiedAt 則用 new Date().toISOString()，
// 是標準 UTC 字串（帶 'Z' 結尾）。
//
// 這兩種字串「絕對不能直接用字串大小比較」：GitHub Actions runner 預設時區是 UTC，
// 兩種字串的時區偏移量相差 8 小時、字尾格式也不同（一個沒有時區資訊、一個有 'Z'），
// 對同一個真實時刻，UTC 字串的時／日數字幾乎總是比台灣本地字串的數字「看起來更小」，
// 用字串比較會讓「這則評語/回覆已經通知過」的判斷幾乎永遠失敗，導致每次排程都重複推播
// （這是 AI_CONTEXT.md 已經記錄過兩次的「隱式當本地/UTC解析 vs 明確台灣時區」時區bug
// 同一類問題，這裡刻意避開，改用 Date 物件的實際時間戳〔getTime()〕比較）。
function parseAsInstant(isoLike) {
  if (!isoLike || typeof isoLike !== 'string') return null;
  // 字串結尾若已經有時區資訊（'Z' 或 +HH:mm / -HH:mm），代表是這支腳本自己寫入的
  // notifiedAt，直接剖析；否則視為 localISOStr() 產生的「無時區資訊、語意上為台灣時間」
  // 字串，補上 +08:00 再剖析，才能正確換算成同一套實際時間戳來比較。
  const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(isoLike.trim());
  const d = new Date(hasOffset ? isoLike : isoLike + '+08:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 「這則評語/回覆」（用 contentAtStr 代表最後一次真正改變內容的時間）是否已經通知過。 */
function alreadyNotified(notifiedAtStr, contentAtStr) {
  const notifiedAt = parseAsInstant(notifiedAtStr);
  const contentAt = parseAsInstant(contentAtStr);
  if (!notifiedAt || !contentAt) return false; // 缺資料時保守起見視為「尚未通知」，寧可多通知也不要漏掉
  return notifiedAt.getTime() >= contentAt.getTime();
}

// 跟 teacher.html 的 emailToDocId() 完全一致（見該檔 ~1533 行），這裡不 import
// 整個前端檔案，單純複製這個一行函式，避免這支獨立的 Node 腳本平白多一份跨檔依賴。
function emailToDocId(email) {
  return (email || '').trim().toLowerCase().replace(/[@.]/g, '_');
}

// ---------------------------------------------------------------------------
// 逾期未繳月記 → 通知學生本人（新增）
// ---------------------------------------------------------------------------
// 以下五個函式是 checkOverdue()／overdue-logic.js 的核心決策邏輯，逐一複刻
// teacher.html 對應函式的行為（而非重新發明一套判斷標準），理由：老師主頁「本月未繳」
// 統計卡跟這裡的推播判斷必須是同一套標準，否則會出現「老師主頁顯示已繳，學生卻收到
// 逾期推播」這種自相矛盾的使用者體驗。這些函式全部不碰 Firestore/網路，純粹是日期與
// 數字計算，可以被 test-notify-logic.js 直接測試邊界情況。

/**
 * 複刻 teacher.html 的 getCurrentSemester()/getCurrentSemMonth()（~1626 行），但這支腳本
 * 跑在 GitHub Actions runner 上（預設 UTC 時區，不是台灣時間），不能直接用
 * refDate.getFullYear()/getMonth() 讀值——那會拿到 UTC 的年月，跟前端「使用者裝置本地
 * 時間＝台灣時間」的假設不一致，尤其在台灣午夜前後 8 小時的窗口內，UTC 日期會跟台灣
 * 日期相差一天，讓學期/月份算錯（這正是 alreadyNotified() 那組時區教訓的同一類問題，
 * 這裡從一開始就用同樣的「先加 8 小時再用 getUTC*() 讀值」手法避開，不使用
 * refDate.getMonth() 這種依賴執行環境時區設定的寫法）。
 *
 * 回傳的 semesterNum（1 或 2）是「半」，供 getSemesterMonths() 直接使用，不需要呼叫端
 * 再次切割 semester 字串（teacher.html getSemesterMonths(semKey) 是切割完整字串，這裡
 * 刻意拆成兩步，讓 getCurrentSemesterInfo() 一次算好、getSemesterMonths() 保持單純）。
 */
function getCurrentSemesterInfo(refDate) {
  const base = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
  const taipei = new Date(base.getTime() + 8 * 60 * 60 * 1000);
  const y = taipei.getUTCFullYear();
  const month = taipei.getUTCMonth() + 1;
  const twYear = y - 1911;
  let semester;
  let semesterNum;
  if (month >= 7) {
    semester = `${twYear}-1`;
    semesterNum = 1;
  } else if (month === 1) {
    semester = `${twYear - 1}-1`;
    semesterNum = 1;
  } else {
    semester = `${twYear - 1}-2`;
    semesterNum = 2;
  }
  return { semester, semesterNum };
}

/**
 * 跟 teacher.html 的 getDeadlineSemMonths(half)（~3561 行）完全一致——第1學期
 * 7~12月＋隔年1月，第2學期2~6月。teacher.html 另有一個簽名不同的 getSemesterMonths(semKey)
 * （接完整 "115-1" 字串），這裡刻意採用 getDeadlineSemMonths() 的簽名（接 1/2 的半），
 * 因為呼叫端（getCurrentSemesterInfo()）已經算好 semesterNum，不需要重新切割字串。
 */
function getSemesterMonths(half) {
  return half === 1 ? [7, 8, 9, 10, 11, 12, 1] : [2, 3, 4, 5, 6];
}

/**
 * 跟 teacher.html 的 resolveMinEntries()（~2630 行）完全一致：deadlineDoc 可能是
 * undefined（該月從未設定過期限），或 minEntries 欄位不存在/不是 >=1 整數（舊資料、
 * 或老師沒特別調整過），一律 fallback 為 1。
 */
function resolveMinEntries(deadlineDoc) {
  const v = deadlineDoc && deadlineDoc.minEntries;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * 從「目前學期全部月份」篩出「已經逾期」的月份清單（deadlines 文件存在、closeDate 是合法
 * 日期字串、且已早於 refNow）。deadlineDataByMonth 是 { 月份數字: deadlines文件資料 } 的
 * map，由呼叫端（overdue-logic.js）平行查詢目前學期全部月份的 /deadlines/{semester}-{m}
 * 文件後組出。截止日比較沿用 checkMonthDeadline() 等既有函式的寫法：
 * new Date(closeDate + 'T23:59:59+08:00')，明確帶台灣時區，不依賴執行環境的預設時區。
 *
 * 回傳陣列裡每個元素帶上該月的 minEntries（已呼叫 resolveMinEntries() 算好 fallback），
 * 呼叫端不需要再重新查一次 deadlineDataByMonth。
 */
function computeOverdueMonths(months, deadlineDataByMonth, refNow) {
  const base = refNow instanceof Date && !Number.isNaN(refNow.getTime()) ? refNow : new Date();
  const nowMs = base.getTime();
  const result = [];
  for (const m of months || []) {
    const dd = deadlineDataByMonth && deadlineDataByMonth[m];
    if (!dd || typeof dd.closeDate !== 'string' || !dd.closeDate) continue; // 該月從未設定截止日，不列入逾期範圍判斷
    const deadlineMs = new Date(`${dd.closeDate}T23:59:59+08:00`).getTime();
    if (Number.isNaN(deadlineMs)) continue; // closeDate 格式不合法，保守跳過而非誤判
    if (nowMs <= deadlineMs) continue; // 還沒過期
    result.push({ month: m, minEntries: resolveMinEntries(dd) });
  }
  return result;
}

/**
 * 「這位學生、這個月」是否篇數不足需要提醒——跟 teacher.html 的 isJournalComplete()／
 * statusSymbolForJournal()（~3969 行）判斷「✗ 未繳」與「△ 篇數不足」這兩種狀態的標準
 * 完全一致（entriesCount < minEntries）。刻意不理會「▲ 遲繳」與「✓ 已達標」——這兩種
 * 狀態代表學生已經交齊篇數，不論是否遲交，都不需要自動推播提醒。
 */
function isStudentOverdueForMonth(entriesCount, minEntries) {
  const required = Number.isInteger(minEntries) && minEntries >= 1 ? minEntries : 1;
  return (entriesCount || 0) < required;
}

/**
 * 組出「逾期未繳月記」推播的通知內文。純字串/數字組裝，不碰 Firestore/網路，抽成獨立
 * 函式的理由跟這支檔案其餘函式一致——讓 Layer 1（test-notify-logic.js）能直接測文案
 * 本身組得對不對，不用只靠 Layer 2/3 肉眼核對。
 *
 * 2026-08 補強：原本的文案（見 AI_推播系統說明.md 3.7 節）固定只講「需要幾篇」，
 * 刻意不算「已交幾篇、還差幾篇」，文件當時明白記載這是先做的最小版本、非遺漏，
 * 這裡補上這個原本列為候補的細節，用詞比照 teacher.html labelNoName 既有的
 * 「已交X篇，尚差Y篇」風格，不另外發明一套新的措辭。
 *
 * entriesCount／minEntries 皆做防禦性正規化（沿用 isStudentOverdueForMonth() 對
 * minEntries 的 fallback 規則，entriesCount 非合法非負整數時視為 0），避免呼叫端萬一
 * 傳入不乾淨的值時算出負的「尚差」篇數或印出 NaN——正常呼叫路徑（overdue-logic.js）
 * 傳入的 entriesCount 一定 < minEntries（呼叫前已經過 isStudentOverdueForMonth() 篩選），
 * 這裡的防禦純粹是額外一層保險，不是預期會被觸發的分支。
 */
function buildOverdueNotificationBody(month, entriesCount, minEntries) {
  const required = Number.isInteger(minEntries) && minEntries >= 1 ? minEntries : 1;
  const current = Number.isInteger(entriesCount) && entriesCount >= 0 ? entriesCount : 0;
  const missing = Math.max(required - current, 0);
  return `${month}月的實習月記目前還沒達到最低篇數（需 ${required} 篇，已交 ${current} 篇，尚差 ${missing} 篇），記得儘快補上，避免影響審閱進度。`;
}

module.exports = {
  parseAsInstant,
  alreadyNotified,
  emailToDocId,
  getCurrentSemesterInfo,
  getSemesterMonths,
  resolveMinEntries,
  computeOverdueMonths,
  isStudentOverdueForMonth,
  buildOverdueNotificationBody,
};
