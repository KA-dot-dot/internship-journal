// notify-service/send-push-notifications.js
//
// 不需要 Cloud Functions、不需要 Blaze 方案。這支腳本由 GitHub Actions 排程執行
// （見 .github/workflows/push-notify.yml），用 Firebase Admin SDK 直接對 Firestore
// 做輪詢查詢＋呼叫 FCM 送出通知——FCM 本身在任何方案（含免費 Spark）都完全免費，
// 需要付費/信用卡的只有「Cloud Functions 這個執行環境本身」，不是 FCM，也不是這裡
// 用到的 Firestore 讀寫（用量遠低於 Spark 方案每日免費額度：50K 讀取／20K 寫入）。
// 代價：不是即時的，是每次排程執行時的輪詢延遲（預設 5 分鐘一次）。
//
// 需要的環境變數：
//   FIREBASE_SERVICE_ACCOUNT_JSON — Firebase Console > 專案設定 > 服務帳戶 >
//     產生新的私密金鑰 下載的 JSON 檔「整個檔案內容」，原封不動存成 GitHub Secret
//     （不要額外做 base64 等轉換，GitHub Secrets 本身會完整保留多行字串內容）。
//
// 一次性前置作業（跟 /admins/{uid} 要手動在 Console 建立是同一類「無法自動化」的步驟）：
//   1) 上述服務帳戶 JSON。
//   2) 第一次執行時，collectionGroup('journals') 的兩個 where 查詢（teacherCommentUnread
//      跟 studentReplyUnread 各自獨立）都很可能會各自噴出一次「需要建立索引」的錯誤，
//      錯誤訊息裡會附一個直接建立該索引的連結。這支腳本刻意把兩個檢查各自包在自己的
//      try/catch 裡（見下方 main()），就算其中一個因為缺索引而失敗，另一個仍會照常執行，
//      所以「兩個索引都還沒建」的第一次執行，理論上會在同一次的 log 裡就看到兩條建立索引
//      的連結，不需要為了看到第二條連結而特地再跑第二次。點過兩個連結各自建好索引
//      （通常一兩分鐘生效）後，之後每次排程執行都不會再遇到這個錯誤。

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const messaging = admin.messaging();

// 2026-07 修正：這個站是 GitHub Pages 的 project page，網址帶 /internship-journal/ 子路徑
// （不是 repo 本身叫 xxx.github.io 的 user/org page）。點通知後要開啟的頁面一定要是完整網址，
// 不能只寫 '/student.html' 這種開頭帶斜線的絕對路徑——那會被瀏覽器解析成網域最上層
// （https://ka-dot-dot.github.io/student.html，該路徑並不存在），而不是子路徑底下的實際頁面。
const SITE_BASE_URL = 'https://ka-dot-dot.github.io/internship-journal';

// FCM sendEachForMulticast 單次呼叫上限 500 個 token；本專案規模（一班+老師）幾乎不可能碰到，
// 但還是切塊處理，避免未來師生人數變多、或同一人多裝置登入導致 token 數量增加時整批失敗。
const MULTICAST_CHUNK_SIZE = 500;

/**
 * 對一批「token 文件」（Firestore QueryDocumentSnapshot，文件 ID 本身就是 FCM token 字串）
 * 送出同一則通知，並清掉 FCM 回報「已失效」的 token（使用者解除授權、清瀏覽器資料、換裝置等）。
 * 直接傳入文件快照（而非集合路徑字串），刪除失效 token 時用 docSnap.ref.delete() 即可，
 * 不需要重新組合路徑字串，也不用假設呼叫端已經知道 token 文件實際掛在哪個路徑下。
 *
 * 2026-07-06 第二次修正：找到「畫面上固定收到兩則、加了 tag 也沒用」的真正根因——
 * 原本這裡同時送出頂層 notification 欄位跟 data 欄位。Firebase JS SDK 在 Web 平台上，
 * 只要偵測到訊息帶 notification 欄位，背景時會「自己」額外呼叫一次 showNotification()
 * 自動顯示，這條路徑完全在 Firebase 內部函式庫執行、不會經過 fcm-sw.js 的
 * onBackgroundMessage，所以那邊加的 tag 防重複機制對它完全無效；與此同時，因為訊息
 * 也帶了 data，onBackgroundMessage 一樣會被觸發、再手動顯示一次——一則訊息兩條互不
 * 知道對方存在的顯示路徑，不管 tag 加得多正確，永遠固定兩則。這是 Firebase JS SDK
 * 本身已知的行為（notification+data 同時存在時的重複顯示），不是這支專案獨有的 bug。
 * 修法：改成「只送 data，不送 notification 頂層欄位」——Firebase SDK 內部就沒有
 * notification 可以自動顯示，只剩 fcm-sw.js 的 onBackgroundMessage 會執行，從根本上
 * 只會顯示一次。相應地，不再接受獨立的 notification/link 參數，呼叫端把 title/body/
 * tag/link 全部收斂進單一 data 物件傳進來（data 訊息的所有值依 FCM 規定必須是字串，
 * 呼叫端傳的本來就都是字串，不需要額外轉型）。
 */
async function sendToTokenDocs(tokenDocs, data) {
  if (!tokenDocs.length) return;

  for (let i = 0; i < tokenDocs.length; i += MULTICAST_CHUNK_SIZE) {
    const chunk = tokenDocs.slice(i, i + MULTICAST_CHUNK_SIZE);
    const tokens = chunk.map((d) => d.id);

    const resp = await messaging.sendEachForMulticast({
      tokens,
      data,
    });

    await Promise.all(
      resp.responses.map((r, idx) => {
        if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
          return chunk[idx].ref.delete().catch(() => {});
        }
        return null;
      })
    );

    console.log(`sendToTokenDocs(${data.link}): ${resp.successCount} 成功 / ${resp.failureCount} 失敗`);
  }
}

// ---------------------------------------------------------------------------
// 時區安全的時間比較
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

// ---------------------------------------------------------------------------
// 老師留評語／更新評語 → 通知學生本人
// ---------------------------------------------------------------------------
async function checkComments() {
  const snap = await db.collectionGroup('journals').where('teacherCommentUnread', '==', true).get();
  let sent = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.teacherComment) continue;
    if (alreadyNotified(data.teacherCommentNotifiedAt, data.teacherCommentContentAt)) continue;

    // 保險起見排除理論上不會有資料、但 rule.txt 裡確實存在的頂層 /journals/{journalId}
    // 集合（跟 /users/{uid}/journals/{journalId} 是不同路徑，若真的意外命中，
    // parent.parent 會是 null，直接 .id 會丟例外，這裡先擋掉避免整支腳本中斷）。
    const userDocRef = docSnap.ref.parent.parent;
    if (!userDocRef || userDocRef.parent.id !== 'users') continue;
    const userId = userDocRef.id;

    const tokensSnap = await db.collection(`users/${userId}/fcmTokens`).get();
    if (tokensSnap.empty) continue; // 該生從未授權推播，或裝置端 token 已被清除，安靜跳過

    const body = data.teacherComment.length > 40 ? data.teacherComment.slice(0, 40) + '…' : data.teacherComment;
    // 2026-07-06 新增：自組 tag，不依賴 FCM 自動賦予的 messageId——重複投遞時兩次送出
    // 是否共用同一個 messageId 並沒有保證，一旦不同，fcm-sw.js 原本用 messageId 當 tag
    // 的防重複機制就會形同虛設（這正是這次追查到的實際案例）。改用「這份月記文件的完整
    // 路徑 + 這次評語內容真正改變的時間（teacherCommentContentAt，不是這支腳本送出的時間，
    // 也不是每次存檔都會動的 reviewedAt）」組合：只要是同一則評語內容，不論被推播幾次、
    // 背後 messageId 是否一致、老師是否只是打開 Modal 沒改內容就存檔，這裡算出來的 tag
    // 永遠相同，瀏覽器就能正確收斂成一則；老師之後若真的修改了評語，teacherCommentContentAt
    // 會跟著改變，tag 也會跟著變，仍會正確顯示成新的一則，不會被誤判成同一則而蓋掉。
    const tag = `${docSnap.ref.path}:${data.teacherCommentContentAt || ''}`;
    await sendToTokenDocs(tokensSnap.docs, {
      title: '📩 老師留了新評語',
      body,
      tag,
      link: `${SITE_BASE_URL}/student.html`,
    });
    await docSnap.ref.update({ teacherCommentNotifiedAt: new Date().toISOString() });
    sent++;
  }
  console.log(`checkComments: 本輪通知 ${sent} 筆`);
}

// ---------------------------------------------------------------------------
// 學生回覆評語 → 通知全體老師/管理員
// ---------------------------------------------------------------------------
// 老師端 fcmTokens 存在 /admins/{adminId}/fcmTokens/ 底下，但 admins 這個集合本身
// 有兩種可能的 docId（uid 或 emailKey，見 rule.txt isAdmin() 與 teacher.html
// ensureAdminUidDocument() 的歷史遷移設計）。若直接 db.collection('admins').get()
// 列舉「目前存在的 admins 文件」、再逐一查其 fcmTokens 子集合，會漏掉「admins/{uid}
// 這份文件本身還沒建立、但 fcmTokens 子集合已經因為 isAdmin() 檢查通過而寫入成功」
// 這種情境（例如 ensureAdminUidDocument() 那次網路呼叫剛好失敗，這個情況已有 catch、
// 不會擋登入，所以使用者完全不會發現，但會讓通知永遠找不到這位老師的 token）。
// 改用 collectionGroup('fcmTokens') 直接掃描所有 token 文件本身，不依賴 admins
// 集合有沒有對應的文件存在，能完整涵蓋上述邊界情況。
async function collectAdminTokenDocs() {
  const snap = await db.collectionGroup('fcmTokens').get();
  return snap.docs.filter((docSnap) => {
    const parentDocRef = docSnap.ref.parent.parent; // admins/{adminId} 或 users/{uid} 的文件參照
    return !!parentDocRef && parentDocRef.parent.id === 'admins'; // 只留 admins/*/fcmTokens，排除 users/*/fcmTokens
  });
}

async function checkReplies() {
  const [snap, adminTokenDocs] = await Promise.all([
    db.collectionGroup('journals').where('studentReplyUnread', '==', true).get(),
    collectAdminTokenDocs(),
  ]);

  let sent = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.studentReply) continue;
    // 2026-07 修正：改比對 studentReplyContentAt，不再用 studentReplyAt——理由跟
    // checkComments() 改用 teacherCommentContentAt 完全一樣：student.html
    // saveStudentReply() 同步修正後，studentReplyAt 仍會在每次送出時無條件更新
    // （純粹用於畫面上「回覆時間」泡泡顯示），但 studentReplyContentAt 只在回覆內容
    // 真正改變時才寫入。若這裡繼續用 studentReplyAt 判斷，學生只是重新按一次「更新
    // 回覆」但文字沒改，也會被誤判成新內容而重複推播同一則老師可能都還沒讀到的回覆。
    // 相容性備註：這欄位是新增的，改版當下已存在、且 studentReplyUnread 仍為 true 的
    // 舊回覆文件會暫時沒有這個欄位（undefined），alreadyNotified() 對缺資料的處理是
    // 保守視為「尚未通知」，這類舊資料會在改版後第一次執行時再收到一次推播，之後恢復正常。
    if (alreadyNotified(data.studentReplyNotifiedAt, data.studentReplyContentAt)) continue;
    if (!adminTokenDocs.length) continue; // 目前沒有任何老師/管理員註冊過推播，安靜跳過

    const body = data.studentReply.length > 40 ? data.studentReply.slice(0, 40) + '…' : data.studentReply;
    const title = `💬 ${data.studentName || '學生'}回覆了評語`;

    // 2026-07 修正：tag 同步改用 studentReplyContentAt，不再用 studentReplyAt，理由同上——
    // 避免內容沒變時 tag 跟著變動、繞過瀏覽器端的 tag 防重複機制。額外好處維持不變：
    // 就算未來真的發生「同一支 admin token 字串意外掛在兩份不同的 admins/{adminId}
    // 文件底下、collectAdminTokenDocs() 撈出兩筆」這種情況，兩筆各自送出時 tag 仍然相同
    // （同一份月記、同一個 studentReplyContentAt），一樣會被瀏覽器收斂成一則。
    const tag = `${docSnap.ref.path}:${data.studentReplyContentAt || ''}`;
    await sendToTokenDocs(adminTokenDocs, {
      title,
      body,
      tag,
      link: `${SITE_BASE_URL}/teacher.html`,
    });
    await docSnap.ref.update({ studentReplyNotifiedAt: new Date().toISOString() });
    sent++;
  }
  console.log(`checkReplies: 本輪通知 ${sent} 筆`);
}

// ---------------------------------------------------------------------------
// 主流程：兩項檢查各自獨立 try/catch，其中一個因缺索引等原因失敗時，
// 另一個仍會照常執行；只要任一項失敗，整體以非 0 結束碼結束，
// 讓 GitHub Actions 的 Actions 分頁能看到這次執行標記為失敗（方便注意到）。
// ---------------------------------------------------------------------------
(async () => {
  let hadError = false;

  try {
    await checkComments();
  } catch (e) {
    hadError = true;
    console.error('checkComments 失敗（若訊息提到需要建立索引，點開錯誤裡附的連結建立即可）：', e);
  }

  try {
    await checkReplies();
  } catch (e) {
    hadError = true;
    console.error('checkReplies 失敗（若訊息提到需要建立索引，點開錯誤裡附的連結建立即可）：', e);
  }

  process.exit(hadError ? 1 : 0);
})();
