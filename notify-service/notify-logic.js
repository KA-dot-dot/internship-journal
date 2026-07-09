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
// AI_CONTEXT.md「推播通知」章節第 4 節⑤點名「唯一沒有任何自動化測試覆蓋的核心程式檔」
// 的主要對象，優先把這三個函式的邏輯覆蓋起來，投資報酬率最高。

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

module.exports = { parseAsInstant, alreadyNotified, emailToDocId };
