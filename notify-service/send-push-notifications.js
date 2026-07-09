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
// 2026-07（稽核修正）：parseAsInstant()／alreadyNotified()／emailToDocId() 抽到
// notify-logic.js 這支不依賴 firebase-admin、不碰網路的純邏輯檔，讓它能被
// test-notify-logic.js 安全 require() 並測試（本檔案在被 require() 的當下就會執行
// 下面的 admin.initializeApp()，沒辦法安全地被測試檔直接引用）。三個函式的行為與
// 原本完全相同，只是搬了位置，詳見 notify-logic.js 內的完整註解。
const { parseAsInstant, alreadyNotified, emailToDocId } = require('./notify-logic');

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
    // 2026-07-07 修正：自我修復缺 teacherCommentContentAt 的資料，避免無限重推。
    // 原本這裡只寫 teacherCommentNotifiedAt，從未補上 teacherCommentContentAt——這個欄位
    // 2026-07-06 才新增，改版當下所有「本來就 teacherCommentUnread=true」的既有月記
    // （評語系統本來就會出現的正常狀態，不是罕見邊界案例）永遠不會有這個欄位，導致
    // alreadyNotified() 因為 contentAt 缺資料而永遠回傳 false，每輪排程都判定「尚未通知」
    // 再送一次，直到使用者正常操作（學生開歷史頁／老師開評語 Modal）把 Unread 旗標清掉
    // 才會停止——這跟下方「改版後第一次執行多收到一次、之後恢復正常」的舊註解矛盾，
    // 實際上不會恢復正常，是資料遷移的真實 bug，任何舊的未讀評語都會中招。
    // 修法：只在 contentAt 本來就缺資料時（真正評語內容改變的情況，contentAt 已有值，
    // 不會進這個分支），把這次送出通知的同一個時間戳一併補上當 contentAt 基準值，
    // 讓下一輪 notifiedAt >= contentAt 成立、自然收斂；不需要另外寫一次性遷移腳本，
    // 任何原因造成 contentAt 缺資料都能用同一套邏輯自癒。
    const notifiedAt = new Date().toISOString();
    const updatePayload = { teacherCommentNotifiedAt: notifiedAt };
    if (!data.teacherCommentContentAt) updatePayload.teacherCommentContentAt = notifiedAt;
    await docSnap.ref.update(updatePayload);
    sent++;
  }
  console.log(`checkComments: 本輪通知 ${sent} 筆`);
}

// ---------------------------------------------------------------------------
// 學生回覆評語 → 通知全體老師/管理員
// ---------------------------------------------------------------------------
// emailToDocId() 現在從 notify-logic.js 引入（見上方 require），跟 teacher.html 的
// emailToDocId()（~1533 行）完全一致，這裡不重複定義。

// 老師端 fcmTokens 存在 /admins/{adminId}/fcmTokens/ 底下，但 admins 這個集合本身
// 有兩種可能的 docId（uid 或 emailKey，見 rule.txt isAdmin() 與 teacher.html
// ensureAdminUidDocument() 的歷史遷移設計）。若直接 db.collection('admins').get()
// 列舉「目前存在的 admins 文件」、再逐一查其 fcmTokens 子集合，會漏掉「admins/{uid}
// 這份文件本身還沒建立、但 fcmTokens 子集合已經因為 isAdmin() 檢查通過而寫入成功」
// 這種情境（例如 ensureAdminUidDocument() 那次網路呼叫剛好失敗，這個情況已有 catch、
// 不會擋登入，所以使用者完全不會發現，但會讓通知永遠找不到這位老師的 token）。
// 所以改用 collectionGroup('fcmTokens') 直接掃描所有 token 文件本身，不能只依賴
// 「admins 集合裡有沒有對應的文件」來判斷該不該收這則通知。
//
// 2026-07-08 修正（稽核發現的真實資料外洩管道，非上述既有設計考量）：teacher.html
// 的 removeAdmin() 只 deleteDoc(doc(db,'admins',id))，從未清過對方的
// admins/{id}/fcmTokens/ 子集合（Firestore 刪除文件不會連帶刪除子集合），而
// rule.txt 對 /admins/{adminId}/fcmTokens 的 get/list 規則寫死 false（連 admin 本人
// 都查不到自己有哪些 token 文件），前端完全沒有機會、也沒有權限在移除當下順手清除。
// 後果：被移除老師/管理員權限的人，裝置上仍會持續收到「學生回覆評語」推播（含回覆內容
// 前 40 字），直到 token 自然失效為止——權限收回並不完整。
// 修法：改成 db.collection('admins').get() 拿到「目前確實存在」的 admins 文件 ID 集合，
// 逐一比對每個 token 的 adminId（= 寫入時的 currentUser.uid，見 teacher.html
// initPushNotifications()）是否還在這個集合裡；不在的話，不能直接判定為孤兒——
// 還必須複刻 verifyCurrentAdmin() 的判斷邏輯（admins/{uid} 或 admins/{emailKey} 任一
// 存在即算數），用 Admin SDK 的 admin.auth().getUser(uid) 查出對應 email 換算 emailKey
// 再查一次，才不會把「isAdmin() 檢查通過、但還沒走過 uid 遷移」這種本來就該保留的正常
// 在職老師 token 一併誤刪（這正是上一段既有設計特別要涵蓋的情境）。兩種存在方式都查
// 不到，才視為孤兒 token 一併刪除（順手清理，不留著讓下一輪繼續判斷）。
async function collectAdminTokenDocs() {
  const [tokenSnap, adminSnap] = await Promise.all([
    db.collectionGroup('fcmTokens').get(),
    db.collection('admins').get(),
  ]);
  const activeAdminIds = new Set(adminSnap.docs.map((d) => d.id));

  const candidates = tokenSnap.docs.filter((docSnap) => {
    const parentDocRef = docSnap.ref.parent.parent; // admins/{adminId} 或 users/{uid} 的文件參照
    return !!parentDocRef && parentDocRef.parent.id === 'admins'; // 只留 admins/*/fcmTokens，排除 users/*/fcmTokens
  });

  const valid = [];
  const orphaned = [];
  for (const docSnap of candidates) {
    const adminId = docSnap.ref.parent.parent.id;
    if (activeAdminIds.has(adminId)) {
      valid.push(docSnap);
      continue;
    }
    // admins/{uid} 直接查無此文件：再比對 emailKey 格式，避免誤刪尚未遷移的正常老師 token。
    let stillValid = false;
    try {
      const userRecord = await admin.auth().getUser(adminId);
      const emailKey = emailToDocId(userRecord.email || '');
      stillValid = !!emailKey && activeAdminIds.has(emailKey);
    } catch (e) {
      // getUser 失敗（Auth 帳號已不存在或其他例外）：視為孤兒，往下清除
    }
    if (stillValid) {
      valid.push(docSnap);
    } else {
      orphaned.push(docSnap);
    }
  }

  if (orphaned.length) {
    await Promise.all(orphaned.map((d) => d.ref.delete().catch(() => {})));
    console.log(`collectAdminTokenDocs: 清除 ${orphaned.length} 筆孤兒 token（對應的 /admins/ 權限已不存在，通常是 removeAdmin() 移除後的殘留）`);
  }

  return valid;
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
    // 相容性備註（2026-07-07 更正）：這欄位是新增的，改版當下已存在、且 studentReplyUnread
    // 仍為 true 的舊回覆文件會暫時沒有這個欄位（undefined），alreadyNotified() 對缺資料的
    // 處理是保守視為「尚未通知」。**這行原本寫「這類舊資料會在改版後第一次執行時再收到一次
    // 推播，之後恢復正常」，但當時的 update() 只寫 NotifiedAt、從未補上 ContentAt，實際上
    // 不會恢復正常，會每輪排程無限重推**，直到 Unread 被使用者正常操作清掉才停止——保留這句
    // 更正紀錄，是為了誠實記錄當時的認知狀態。現在會恢復正常，是因為下方 update() 已補上
    // 「contentAt 缺資料時，用這次通知的時間戳一併回填」的自我修復邏輯，見該處註解。
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
    // 2026-07-07 修正：自我修復缺 studentReplyContentAt 的資料，理由與 checkComments()
    // 的 teacherCommentContentAt 完全對稱，見該處註解——原本只補 studentReplyNotifiedAt、
    // 從未補 studentReplyContentAt，導致改版當下所有既有的 studentReplyUnread=true
    // 舊回覆永遠無限重推，直到 Unread 被正常操作清掉才停止。
    const notifiedAt = new Date().toISOString();
    const updatePayload = { studentReplyNotifiedAt: notifiedAt };
    if (!data.studentReplyContentAt) updatePayload.studentReplyContentAt = notifiedAt;
    await docSnap.ref.update(updatePayload);
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
