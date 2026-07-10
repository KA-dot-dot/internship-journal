/**
 * test-rules.js
 * Firestore Security Rules 單元測試（Firebase Emulator）
 *
 * 目的：
 *   現有 test-suite/tests/student.test.js 的 S-WRITE-REAL / S-RULES-01~05
 *   是用學生帳號的 REST 請求直接打「正式環境」Firestore，只覆蓋少數幾個
 *   手寫的情境（CREATE 成功、特定欄位偽造被拒）。
 *
 *   這份測試改用官方 @firebase/rules-unit-testing + 本機 emulator，
 *   直接讀取 rule.txt 本身的邏輯，窮舉每個 match block 的允許/拒絕情境，
 *   不需要正式環境、不消耗 Firebase 配額、跑得更快，而且測的是規則本身，
 *   不依賴 student.html / teacher.html 有沒有正確呼叫 Firestore。
 *
 *   兩套測試互補：
 *   - student.test.js 的 Rules 測試：驗證「正式環境 + 目前程式碼」整體串起來是否正常
 *   - 這份測試：驗證「rule.txt 本身」在所有分支下是否都符合設計意圖
 *
 * 執行方式：
 *   cd test-suite/rules-tests
 *   npm install   （第一次需要，且需要本機已安裝 Java，emulator 依賴 Java 執行）
 *   npm test
 *
 * 詳細安裝步驟見同目錄 README.md。
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

// ── emailKey() 的 JS 版本，邏輯與 rule.txt 完全一致（含同樣的「最多處理 7 個點」限制）──
function emailKey(email) {
  let k = email.replace('@', '_');
  for (let i = 0; i < 7; i++) k = k.replace('.', '_');
  return k;
}

// ── 測試固定資料 ──────────────────────────────────────────────
const STUDENT_EMAIL = 'stu01@tcivs.tc.edu.tw';
const STUDENT_UID = 'student-01-uid';
const STUDENT_SEAT = '01';
const STUDENT_BINDING_ID = emailKey(STUDENT_EMAIL);

const OTHER_EMAIL = 'stu02@tcivs.tc.edu.tw';
const OTHER_UID = 'student-02-uid';
const OTHER_SEAT = '02';
const OTHER_BINDING_ID = emailKey(OTHER_EMAIL);

const ADMIN_EMAIL = 'teacher@tcivs.tc.edu.tw';
const ADMIN_UID = 'admin-uid';

const OUTSIDER_EMAIL = 'someone@gmail.com';
const OUTSIDER_UID = 'outsider-uid';

// 校內信箱但「沒有」studentBindings 文件：驗證 get() 找不到文件時不會意外放行
const NO_BINDING_EMAIL = 'nobind@tcivs.tc.edu.tw';
const NO_BINDING_UID = 'no-binding-uid';

// 2026-07-03 新增：模擬「老師已建立 studentBindings（開學匯入名單），但學生本人
// 尚未第一次登入」的空窗期——binding 存在、有真實 seatNo，但 uid 欄位還沒被寫入。
// 這是 email_verified 防護要擋的核心情境：在補上此檢查之前，任何人只要能取得一個
// email 對得上的 token（不論是否真的驗證過），就能讀取/竄改這份 binding、或直接
// 冒用該座號建立月記，因為 rule.txt 原本判斷全部只看 email 字串，不看 uid。
const UNCLAIMED_EMAIL = 'stu03@tcivs.tc.edu.tw';
const UNCLAIMED_SEAT = '03';
const UNCLAIMED_BINDING_ID = emailKey(UNCLAIMED_EMAIL);
const ATTACKER_UID = 'attacker-uid'; // 攻擊者自己的 Firebase 帳號 uid，不等於任何真實學生
const UNCLAIMED_UID_LEGIT = 'unclaimed-legit-uid'; // 對照組：該生本人第一次登入的 uid

let testEnv;
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

// 2026-07-03 補修：rule.txt 的 schoolUser() 新增 email_verified == true 檢查後，
// 這個 helper 改為預設帶 email_verified: true——因為全檔既有 64 條測試呼叫 authCtx()
// 時，代表的都是「合法使用者」（Google 登入的真人，或種子資料裡設定好的學生/老師），
// 語意上本來就應該通過驗證，所以在這裡統一補上，不需要逐一修改 64 個呼叫點。
// 真正要測試「未驗證信箱」情境時，改用下面新增的 authCtxUnverified()。
function authCtx(uid, email) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true });
}

// 2026-07-03 新增：模擬「拿到一個 email 對得上、但未經 Firebase 驗證」的 token——
// 例如攻擊者透過 Email/Password 自助註冊時填入的信箱字串，尚未點擊驗證信。
function authCtxUnverified(uid, email) {
  return testEnv.authenticatedContext(uid, { email, email_verified: false });
}

// 2026-06-27 補修：rule.txt create/update 規則補上 seatNo 必須等於 studentBindings
// 紀錄座號的驗證（防止偽造 seatNo 污染老師端統計）。journalDoc() 預設依 uid
// 自動帶對應的座號，所有既有呼叫點不用逐個改，否則會被新規則正確擋下（而不是
// 被測項本來想驗證的原因擋下）——這正是這次 3 個假失敗的根本原因。
function seatNoFor(uid) {
  if (uid === STUDENT_UID) return STUDENT_SEAT;
  if (uid === OTHER_UID) return OTHER_SEAT;
  return null;
}

function journalDoc(uid, email, overrides = {}) {
  return {
    ownerUid: uid,
    ownerEmail: email,
    storagePath: 'user',
    semester: 'test',
    month: 0,
    seatNo: seatNoFor(uid),
    teacherComment: null,
    teacherReviewed: false,
    reviewedAt: null,
    teacherCommentUnread: false,
    ...overrides,
  };
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-internship-journal',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'rule.txt'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // ── 種子資料（繞過規則寫入）──────────────────────────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`admins/${ADMIN_UID}`).set({ email: ADMIN_EMAIL });
    await db.doc(`studentBindings/${STUDENT_BINDING_ID}`).set({ email: STUDENT_EMAIL, seatNo: STUDENT_SEAT, uid: STUDENT_UID });
    await db.doc(`studentBindings/${OTHER_BINDING_ID}`).set({ email: OTHER_EMAIL, seatNo: OTHER_SEAT, uid: OTHER_UID });
    // 2026-07-03 新增：刻意不設 uid 欄位，模擬老師建好名冊但學生本人還沒登入過
    await db.doc(`studentBindings/${UNCLAIMED_BINDING_ID}`).set({ email: UNCLAIMED_EMAIL, seatNo: UNCLAIMED_SEAT });
    await db.doc('students/115-1_01').set({ seatNo: STUDENT_SEAT, semester: '115-1', name: '新格式學生' });
    await db.doc('students/01').set({ seatNo: STUDENT_SEAT, name: '舊格式學生' });
    await db.doc('students/115-1_02').set({ seatNo: OTHER_SEAT, semester: '115-1', name: '另一位學生' });
    await db.doc('students/115-1_03').set({ seatNo: UNCLAIMED_SEAT, semester: '115-1', name: '尚未登入學生' });
    await db.doc(`users/${STUDENT_UID}/journals/existing-01`).set(journalDoc(STUDENT_UID, STUDENT_EMAIL));
    await db.doc(`users/${OTHER_UID}/journals/existing-02`).set(journalDoc(OTHER_UID, OTHER_EMAIL));
    await db.doc('deadlines/d1').set({ month: 7, deadline: '2026-08-05' });
    await db.doc('settings/teacher').set({ foo: 'bar' });
    await db.doc('journals/legacy-flat-1').set({ note: '頂層平面集合（舊架構殘留）' });
  });

  console.log('\n══════════════════════════════════════');
  console.log('Firestore Rules 單元測試（rule.txt × emulator）');
  console.log('══════════════════════════════════════\n');

  // ════════════════════════════════════════════════════════════
  // /students/{docId}
  // ════════════════════════════════════════════════════════════
  await test('學生可用新格式 docId（{semester}_{seatNo}）讀取自己的 students 文件', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('students/115-1_01').get());
  });

  await test('學生可用舊格式 docId（無前綴）讀取自己的 students 文件', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('students/01').get());
  });

  await test('學生不能讀取別人座號的 students 文件', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('students/115-1_02').get());
  });

  await test('學生不能 list /students/ 整個集合', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().collection('students').get());
  });

  await test('學生不能 create /students/ 文件', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('students/115-1_99').set({ seatNo: '99' }));
  });

  await test('校外信箱（非 tcivs.tc.edu.tw）不能讀取 students', async () => {
    await assertFails(authCtx(OUTSIDER_UID, OUTSIDER_EMAIL).firestore().doc('students/01').get());
  });

  await test('校內信箱但沒有 studentBindings 文件 → 讀取 students 應被拒（而非因 get() 找不到文件而誤判放行）', async () => {
    await assertFails(authCtx(NO_BINDING_UID, NO_BINDING_EMAIL).firestore().doc('students/01').get());
  });

  await test('未登入者不能讀取 students', async () => {
    await assertFails(testEnv.unauthenticatedContext().firestore().doc('students/01').get());
  });

  await test('admin 可以 list /students/ 整個集合', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().collection('students').get());
  });

  await test('admin 可以 create /students/ 文件', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('students/115-1_99').set({ seatNo: '99' }));
  });

  // ════════════════════════════════════════════════════════════
  // /users/{uid}/journals/{id} — CREATE（2026-06-17 那次 bug 的發生處，最重要區塊）
  // ════════════════════════════════════════════════════════════
  await test('學生 CREATE 月記：teacher 四個欄位皆為初始空值 → 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/new-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL))
    );
  });

  await test('【迴歸測試】學生 CREATE 月記：完全不帶 teacher 四個欄位（依賴 .get() 預設值）→ 應成功 — 若規則誤用 !hasAny() 取代 .get()==null，此測試會失敗', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/new-02`)
        // 2026-06-27 補修：補上 seatNo（不影響本測試「不帶 teacher 欄位」的測試意圖，
        // 這裡只是滿足新增的 seatNo 必填驗證，不是本測試要驗證的對象）
        .set({ ownerUid: STUDENT_UID, ownerEmail: STUDENT_EMAIL, storagePath: 'user', seatNo: STUDENT_SEAT, content: '無 teacher 欄位' })
    );
  });

  await test('學生 CREATE 月記：偽造 teacherComment 有值 → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherComment: '我自己寫的評語' }))
    );
  });

  await test('學生 CREATE 月記：偽造 teacherReviewed=true → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-02`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherReviewed: true }))
    );
  });

  await test('學生 CREATE 月記：偽造 teacherCommentUnread=true → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-03`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherCommentUnread: true }))
    );
  });

  // 2026-07 補修：teacherCommentContentAt 是 2026-07-06 teacher.html saveTeacherComment()
  // 新增的欄位，rule.txt 的 create 分支同日補上必須為 null 的鎖定（見該行註解），但當時
  // 沒有補上對應的 Layer 1 回歸測試——跟其他三個老師專屬欄位（teacherComment／
  // teacherReviewed／teacherCommentUnread）都各自有一條「偽造應被拒」測試相比，這是一個
  // 遺漏，補上以維持覆蓋率一致（複查 studentReplyContentAt 這次改動時發現）。
  await test('【2026-07】學生 CREATE 月記：偽造 teacherCommentContentAt 有值 → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-03b`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherCommentContentAt: '2026-07-06T00:00:00+08:00' }))
    );
  });

  await test('學生 CREATE 月記：ownerUid 對不上自己 uid → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-04`)
        .set(journalDoc(OTHER_UID, STUDENT_EMAIL))
    );
  });

  await test('學生 CREATE 月記：ownerEmail 對不上自己 email → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-05`)
        .set(journalDoc(STUDENT_UID, OTHER_EMAIL))
    );
  });

  await test('學生 CREATE 月記：storagePath 不是 user → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-06`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { storagePath: 'admin' }))
    );
  });

  await test('學生不能在別人 uid 路徑下 CREATE 月記', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${OTHER_UID}/journals/fake-07`)
        .set(journalDoc(OTHER_UID, OTHER_EMAIL))
    );
  });

  await test('admin 可以代為 CREATE 任何學生的月記（即使帶 teacherComment）', async () => {
    await assertSucceeds(
      authCtx(ADMIN_UID, ADMIN_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/admin-created-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherComment: '老師代寫測試' }))
    );
  });

  // 2026-06-27 補修：CREATE 規則新增 seatNo 驗證
  await test('【2026-06-27】學生 CREATE 月記：seatNo 與 studentBindings 不符 → 應被拒（防止偽造座號污染老師端統計）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-seatno-01`)
        // STUDENT 的 binding 是 '01'，這裡故意填 '99' 模擬偽造
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { seatNo: '99' }))
    );
  });

  await test('【2026-06-27】學生 CREATE 月記：夾帶 studentReply 欄位 → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-reply-create-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { studentReply: '建立時偷塞回覆' }))
    );
  });

  await test('【2026-06-28】學生 CREATE 月記：夾帶 studentReplyAt 欄位 → 應被拒（回覆欄位在建立時三欄皆須為初始空值）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-reply-create-02`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { studentReplyAt: '2026-06-28T00:00:00+08:00' }))
    );
  });

  // 2026-07 補修：studentReplyContentAt 是這次（saveStudentReply() replyChanged 防護）
  // 新增的第四個回覆欄位，rule.txt create 分支同步補上必須為 null 的鎖定，比照
  // studentReply／studentReplyAt 既有的「CREATE 時夾帶應被拒」測試各補一條，這條專門
  // 驗證第四個欄位本身也真的被擋下，不是只有語法上寫了鎖定、實際沒被測到。
  await test('【2026-07】學生 CREATE 月記：夾帶 studentReplyContentAt 欄位 → 應被拒（回覆欄位家族第四欄同樣須為初始空值）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/fake-reply-create-03`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { studentReplyContentAt: '2026-07-06T00:00:00+08:00' }))
    );
  });

  // ════════════════════════════════════════════════════════════
  // UPDATE
  // ════════════════════════════════════════════════════════════
  await test('學生 UPDATE 自己月記：teacher 欄位歸零 → 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { content: '更新內容' }))
    );
  });

  await test('學生 UPDATE 自己月記：偽造 teacherReviewed=true → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherReviewed: true }))
    );
  });

  // 2026-07 補修：同上一條（teacherCommentContentAt CREATE 分支）的遺漏，一般編輯分支
  // 的鎖定（rule.txt 2026-07-06 補修，要求維持原值不變）同樣沒有對應測試，一併補上。
  await test('【2026-07】學生 UPDATE 自己月記（一般編輯）：偽造 teacherCommentContentAt 有值 → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { teacherCommentContentAt: '2026-07-06T00:00:00+08:00' }))
    );
  });

  // 2026-07-09（#12，補齊 test-rules.js 方法論缺口）：上面所有既有測試都用整份 .set()
  // （非 merge:true）模擬寫入，這跟 saveJournal() 實際用 setDoc(ref,{...},{merge:true})
  // 的寫法不同——整份 .set() 時 request.resource.data 就是傳入的物件本身，不會受文件
  // 「原本已經有的舊值」影響；merge:true 則是「傳入物件」跟「文件原本的值」合併後的結果，
  // 若某欄位沒出現在傳入物件裡，會直接沿用文件原本的舊值。這個差異不是理論性的——
  // 2026-07-08 的真實 bug（見第四節／AI_推播系統說明.md「已知真實 bug 修復記錄」）正是
  // saveJournal() 一般編輯忘記在 payload 裡補上 teacherCommentContentAt: null，
  // 而 merge:true 沿用了文件裡原本非 null 的舊值，導致任何被老師評過語的月記，學生之後
  // 編輯儲存一律被 rule.txt 正確擋下（403）。上面用整份 .set() 的測試從頭到尾都測不到
  // 這個情境（傳入物件裡沒有這個欄位時，整份覆蓋後的文件裡這個欄位就是 undefined，
  // 而不是「沿用舊的非 null 值」），因此新增以下兩條，先用 withSecurityRulesDisabled
  // 把 existing-01 種成「已有老師評語、teacherCommentContentAt 非 null」的已知狀態，
  // 再用真正的 .set({...},{merge:true}) 模擬 saveJournal() 的實際寫法。
  await test('【2026-07-09（#12）】學生 UPDATE 自己月記（一般編輯，merge:true 模擬 saveJournal() 真實寫法）：payload 漏帶 teacherCommentContentAt → 應被拒（重現 2026-07-08 真實 bug：merge 省略此欄位會沿用舊的非 null 值）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, {
          teacherComment: '老師評語',
          teacherReviewed: true,
          reviewedAt: '2026-07-08T10:00:00',
          teacherCommentContentAt: '2026-07-08T10:00:00', // 模擬「已有老師評語」的既有狀態
        }));
    });
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        // 只送一般內容編輯會動到的欄位，故意不提 teacherCommentContentAt——
        // 這正是修法之前 saveJournal() 的實際寫法（bug 重現）。
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { content: '學生編輯內容，但漏補 teacherCommentContentAt 歸零' }), { merge: true })
    );
  });

  await test('【2026-07-09（#12）】學生 UPDATE 自己月記（一般編輯，merge:true 模擬 saveJournal() 真實寫法）：payload 補上 teacherCommentContentAt: null → 應成功（驗證 2026-07-08 修法後的正確寫法真的會被放行）', async () => {
    // 重新種一次同樣的「已有老師評語」已知狀態，不依賴上一條測試失敗後文件沒被改動
    // 這個假設，保持每條測試各自獨立、可單獨執行。
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, {
          teacherComment: '老師評語',
          teacherReviewed: true,
          reviewedAt: '2026-07-08T10:00:00',
          teacherCommentContentAt: '2026-07-08T10:00:00',
        }));
    });
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        // 修法後的正確寫法：明確補上 teacherCommentContentAt: null，而不是依賴省略。
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { content: '學生編輯內容，正確補上歸零', teacherCommentContentAt: null }), { merge: true })
    );
  });

  await test('學生不能 UPDATE 別人的月記', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${OTHER_UID}/journals/existing-02`)
        .set(journalDoc(OTHER_UID, OTHER_EMAIL, { content: '想偷改別人的' }))
    );
  });

  await test('學生只把 teacherCommentUnread 改為 false（已讀機制）→ 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({ teacherCommentUnread: false })
    );
  });

  await test('學生把 teacherCommentUnread 改為 true → 應被拒（已讀旗標只能設為 false）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({ teacherCommentUnread: true })
    );
  });

  await test('學生同時改 teacherCommentUnread 和其他欄位 → 應被拒（已讀機制只能單獨改該欄位）', async () => {
    // 必須先讓老師欄位「不是初始值」（模擬老師已經寫過評語），
    // 否則 teacher 欄位仍是初始值時，一般 UPDATE 分支本來就允許學生同時改其他欄位，
    // 根本測不到「已讀機制只能單獨改該欄位」這條限制真正要擋的情境。
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({ teacherComment: '老師評語（測試用）', teacherReviewed: true, teacherCommentUnread: true });
    });
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({ teacherCommentUnread: false, content: '順便改點別的' })
    );
  });

  await test('admin 可以 UPDATE 任何學生的月記（含填寫評語）', async () => {
    await assertSucceeds(
      authCtx(ADMIN_UID, ADMIN_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({ teacherComment: '老師評語', teacherReviewed: true, teacherCommentUnread: true })
    );
  });

  // 2026-06-27 補修：UPDATE 一般編輯分支新增 seatNo 不可變 + reply 三欄鎖定
  await test('【2026-06-27】學生 UPDATE 月記（一般編輯）：嘗試更改 seatNo → 應被拒', async () => {
    // 先把文件恢復成乾淨初始狀態（前面的測試可能改過 teacher 欄位）
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL));
    });
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        // seatNo 從 '01' 改成 '99'，其餘欄位皆合法
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { seatNo: '99' }))
    );
  });

  await test('【2026-06-27】學生 UPDATE 月記（一般編輯）：嘗試帶入 studentReply → 應被拒（防止繞過 50 字限制）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        // 走一般編輯路徑但夾帶 studentReply，應被第一分支的鎖定規則擋下
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { studentReply: '想走一般編輯路徑偷塞回覆' }))
    );
  });

  // 2026-07 補修：studentReplyContentAt 是回覆欄位家族第四欄，一般編輯分支同樣要求
  // 維持原值不變（rule.txt 第168行），比照 studentReply 補上對應測試，驗證這個鎖定
  // 真的擋得住，而不是只在規則檔案裡寫了卻沒被任何測試驗證過。
  await test('【2026-07】學生 UPDATE 月記（一般編輯）：嘗試帶入 studentReplyContentAt → 應被拒（回覆欄位家族第四欄同樣鎖定）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .set(journalDoc(STUDENT_UID, STUDENT_EMAIL, { studentReplyContentAt: '2026-07-06T00:00:00+08:00' }))
    );
  });

  // 2026-06-27 補修：UPDATE 回覆分支新增 size() >= 1 與 studentReplyAt 型別驗證
  await test('【2026-06-27】學生 UPDATE 回覆：studentReply 為空字串 → 應被拒（size() >= 1 下限）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '',           // 空字串，size() == 0，應被拒
          studentReplyUnread: true,
          studentReplyAt: new Date().toISOString(),
        })
    );
  });

  await test('【2026-06-27】學生 UPDATE 回覆：studentReplyAt 寫入數字（非 string/null）→ 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '正常回覆內容',
          studentReplyUnread: true,
          studentReplyAt: 12345678,   // 數字型別，應被型別驗證擋下
        })
    );
  });

  // 2026-07（第一輪）補修：rule.txt 這條分支新增 studentReplyContentAt 之後，「回覆內容跟舊值不同」
  // 的情境（這條測試前面 existing-01 的 studentReply 還沒被合法設過值，等於「內容真的改變」）
  // 現在要求同時提供 studentReplyContentAt（必須是字串）。這條測試原本要驗證的重點是
  // 「studentReplyAt: null 本身合法」，跟新加的 studentReplyContentAt 要求是兩件獨立的事，
  // 所以補上這個欄位讓測試繼續驗證原本的意圖，而不是被新規則用不同原因擋下。
  //
  // 2026-07（第二輪）修正：上面這個「studentReplyAt: null 為合法值」的結論，在這一輪新增
  // 「內容真的改變時，studentReplyContentAt 必須等於 studentReplyAt」的一致性驗證之後
  // 不再成立——這條測試原本用 assertSucceeds，但 studentReplyAt(null) 跟
  // studentReplyContentAt(一個真正的時間字串) 明顯不相等，理當被新規則擋下。改成
  // assertFails 才是正確答案。這不是規則退化，而是刻意收斂：真實 saveStudentReply()
  // 每次都無條件送出一個有效的 studentReplyAt 字串，從來不會是 null，「內容真的改變、
  // 但送出時間卻是 null」本來就是不該存在的合成狀態，繼續放行反而是規則漏洞（詳見
  // AI_推播系統說明.md 第六節 #2：這正是 studentReplyContentAt 被獨立竄改成
  // 未來時間、造成 notify-service 無限重推的那個漏洞，本輪修正就是為了堵住它）。
  // 2026-07-11 更正：這裡原本誤寫成「見 AI_CONTEXT.md「推播通知」章節第 4 節②」，
  // 但 AI_CONTEXT.md 從未有過「推播通知」這個章節（本子系統文件依設計獨立成
  // AI_推播系統說明.md，見該文件開頭說明）。這是 AI_推播系統說明.md #13 修正
  // notify-logic.js／test-notify-logic.js（2處）／push-notify.yml 四處同款錯誤引用時
  // 漏掉的第 5 處，現已一併修正為正確章節。
  // 「studentReplyAt 型別可以是 null」這件事本身沒有跟著收回，只是不能再跟「內容真的
  // 改變」這個情境同時出現，該行為由下面新增的測試接手驗證。
  await test('【2026-07（第二輪修正）】學生 UPDATE 回覆：內容真的改變、但 studentReplyAt=null 與 studentReplyContentAt 不相等 → 應被拒（新增一致性驗證）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '正常回覆內容',
          studentReplyUnread: true,
          studentReplyAt: null,       // 跟下面的 studentReplyContentAt 不相等
          // 刻意用格式合法的字串（不用 new Date().toISOString()），確保這條測試失敗的
          // 原因單純是「跟 studentReplyAt 不相等」，不要跟格式驗證的失敗原因混在一起。
          studentReplyContentAt: '2026-07-08T09:00:00',
        })
    );
  });

  // 2026-07（第二輪）新增：這是稽核發現「studentReplyContentAt 只驗證型別、沒有格式驗證」
  // 之後補上的兩條核心測試——先驗證「格式明顯不合法的字串」會被擋下。localISOStr()
  // 的實際輸出格式固定是 'YYYY-MM-DDTHH:mm:ss'（不含毫秒、不含時區位移），這裡刻意用
  // new Date().toISOString()（帶毫秒＋'Z'）示範一個「看起來像時間字串、但格式不對」的
  // 典型錯誤示範，藉此確認新加的 .matches() 格式驗證真的有作用，而不是形同虛設。
  await test('【2026-07（第二輪新增）】學生 UPDATE 回覆：studentReplyContentAt 格式不符（帶毫秒/Z，非 localISOStr() 格式）→ 應被拒', async () => {
    // 兩個欄位刻意用同一個字面值（而非各自呼叫一次 new Date().toISOString()，那樣兩次
    // 呼叫的毫秒數可能不同，會讓這條測試意外變成同時觸發「不相等」，模糊了要驗證的重點），
    // 確保這裡失敗的原因單純是「格式不符 localISOStr() 規則」，不要跟一致性檢查混在一起。
    const badFormat = '2026-07-08T09:00:00.123Z';
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '格式錯誤測試',
          studentReplyUnread: true,
          studentReplyAt: badFormat,           // 兩者相同字面值，確保不是「不相等」導致失敗
          studentReplyContentAt: badFormat,     // 即使彼此相等，格式本身仍不合法（帶毫秒與 Z）
        })
    );
  });

  // 2026-07（第二輪）新增：確認「格式合法、但跟 studentReplyAt 不相等」一樣會被擋下——
  // 這正是稽核發現的攻擊手法本身：只竄改 studentReplyContentAt（例如塞入未來時間造成
  // notify-service 無限重推），studentReplyAt 維持看起來正常。兩個欄位都符合
  // localISOStr() 格式，差別只在數值不同，藉此確認新加的一致性比對不是只看格式。
  await test('【2026-07（第二輪新增）】學生 UPDATE 回覆：studentReplyContentAt 格式合法但與 studentReplyAt 不相等（模擬單獨竄改未來時間）→ 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '單獨竄改測試',
          studentReplyUnread: true,
          studentReplyAt: '2026-07-08T09:00:00',            // 正常、貌似當下的時間
          studentReplyContentAt: '2099-12-31T23:59:59',      // 格式合法，但刻意設成遙遠未來
        })
    );
  });

  // 2026-07（第二輪）新增：對照組——真實 saveStudentReply()（2026-07 修正後）的實際行為，
  // 兩個欄位共用同一次 localISOStr() 呼叫結果，格式正確、數值相等，應該要能成功。
  await test('【2026-07（第二輪新增）】學生 UPDATE 回覆：studentReplyAt 與 studentReplyContentAt 格式正確且相等（真實 saveStudentReply() 行為）→ 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '正常且一致的回覆',
          studentReplyUnread: true,
          studentReplyAt: '2026-07-08T09:00:00',
          studentReplyContentAt: '2026-07-08T09:00:00',       // 跟 studentReplyAt 完全相同字串
        })
    );
  });

  // 2026-07 新增：模擬「老師已讀過這則回覆」（studentReplyUnread=false）之後，學生重新
  // 打開回覆框、文字完全沒改就再按一次送出——這正是 saveStudentReply() 這次要防的情境：
  // 內容沒變不該把老師的已讀狀態誤打回未讀。先用 withSecurityRulesDisabled 把 existing-01
  // 設成明確的「已讀」已知狀態，才能真正測到「從 false 被誤翻回 true」這個轉變本身，
  // 而不是像最初版本那樣，前一條測試留下的狀態剛好已經是 true，測不出真正的迴歸情境。
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore()
      .doc(`users/${STUDENT_UID}/journals/existing-01`)
      .update({
        studentReply: '已讀回覆內容',
        studentReplyUnread: false,
        studentReplyContentAt: '2026-07-01T00:00:00+08:00',
      });
  });
  await test('【2026-07】學生 UPDATE 回覆：內容沒變但嘗試把已讀狀態誤打回未讀 → 應被拒（防止 saveStudentReply() 誤觸發老師端已讀狀態倒退）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '已讀回覆內容', // 跟上面設定的舊值完全相同，屬於「內容沒變」情境
          studentReplyUnread: true,     // 嘗試把已讀狀態翻回未讀
          studentReplyContentAt: new Date().toISOString(), // 同時嘗試推進內容改變時間
        })
    );
  });

  // 2026-07 新增：內容沒變時，只更新 studentReplyAt（不變動 studentReplyUnread／
  // studentReplyContentAt）應該要能成功——對應 saveStudentReply() 內容沒變時的 spread
  // 條件寫法（只送 studentReply + studentReplyAt 兩個欄位）。沿用上一條測試設定的「已讀」
  // 狀態（studentReplyUnread=false 未被上一條測試改動，因為上一條是 assertFails，
  // 寫入沒有真的生效，doc 仍停在 withSecurityRulesDisabled 那次設定的狀態）。
  await test('【2026-07】學生 UPDATE 回覆：內容沒變、只更新 studentReplyAt（不變動 unread/contentAt）→ 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/journals/existing-01`)
        .update({
          studentReply: '已讀回覆內容', // 跟現有值相同
          studentReplyAt: new Date().toISOString(),
        })
    );
  });

  // ════════════════════════════════════════════════════════════
  // GET / LIST / DELETE
  // ════════════════════════════════════════════════════════════
  await test('學生可以 get 自己的月記', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${STUDENT_UID}/journals/existing-01`).get());
  });

  await test('學生不能 get 別人 uid 路徑下的月記', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${OTHER_UID}/journals/existing-02`).get());
  });

  await test('學生可以 list 自己 uid 下的月記集合', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().collection(`users/${STUDENT_UID}/journals`).get());
  });

  await test('學生不能 list 別人 uid 下的月記集合', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().collection(`users/${OTHER_UID}/journals`).get());
  });

  await test('學生可以刪除自己的月記', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${STUDENT_UID}/journals/to-delete`).set(journalDoc(STUDENT_UID, STUDENT_EMAIL));
    });
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${STUDENT_UID}/journals/to-delete`).delete());
  });

  await test('學生不能刪除別人的月記', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${OTHER_UID}/journals/existing-02`).delete());
  });

  await test('未登入者不能讀取任何學生的月記', async () => {
    await assertFails(testEnv.unauthenticatedContext().firestore().doc(`users/${STUDENT_UID}/journals/existing-01`).get());
  });

  await test('/users/{uid} 文件本身一律禁止讀寫（只開放 journals 子集合）', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${STUDENT_UID}`).set({ foo: 'bar' }));
  });

  // ════════════════════════════════════════════════════════════
  // /users/{userId}/fcmTokens/{tokenId}（2026-07-06 新增，Web Push 推播 token）
  // 背景：這條規則新增當下沒有補上對應的 Layer 1 回歸測試（全文搜尋 fcmTokens 零筆），
  // 已人工手動逐條推演過規則本身邏輯正確（allow create,update,delete: if schoolUser()
  // && request.auth.uid == userId；get/list 固定 false），但缺乏自動化測試守著，
  // 未來若有人不小心把 uid 比對拿掉也不會被抓到。這裡補上，對稱 /admins/ 那邊同時補的
  // 4 條（本人可寫、他人不可寫、get 固定拒絕、list 固定拒絕）。
  // ════════════════════════════════════════════════════════════
  await test('【2026-07-07】學生可以 create 自己的 fcmTokens 文件', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/fake-token-self`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-07】別的學生不能 create 別人 uid 底下的 fcmTokens 文件', async () => {
    await assertFails(
      authCtx(OTHER_UID, OTHER_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/fake-token-intruder`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-07】學生不能 get 自己的 fcmTokens 文件（get 固定 false，前端本來就不該讀回自己的 token，讀取只透過 Admin SDK）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${STUDENT_UID}/fcmTokens/seed-token-get`).set({ createdAt: new Date().toISOString(), userAgent: 'seed' });
    });
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${STUDENT_UID}/fcmTokens/seed-token-get`).get());
  });

  await test('【2026-07-07】學生不能 list 自己的 fcmTokens 集合（list 固定 false）', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().collection(`users/${STUDENT_UID}/fcmTokens`).get());
  });

  // 2026-07-10 新增（稽核 #8）：fcmTokens 文件寫入原本無任何欄位型別/大小驗證，
  // 補上 validFcmTokenWrite() 後對應的規則層回歸測試。前端固定只會寫入 createdAt
  // （字串）與截斷至 200 字的 userAgent（字串），這裡驗證規則本身也擋得住直接呼叫
  // API 繞過前端限制的情境；同時補一條 delete 的回歸測試，確認拆開
  // create/update（需驗證）跟 delete（不驗證，因 delete 時 request.resource 為 null）
  // 這個改動沒有連帶把刪除功能弄壞。
  await test('【2026-07-10】學生 fcmTokens create：userAgent 超過 200 字元 → 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/oversized-useragent`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'x'.repeat(201) })
    );
  });

  await test('【2026-07-10】學生 fcmTokens create：userAgent 剛好 200 字元（邊界值）→ 應成功', async () => {
    await assertSucceeds(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/boundary-useragent`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'x'.repeat(200) })
    );
  });

  await test('【2026-07-10】學生 fcmTokens create：createdAt 型別錯誤（數字而非字串）→ 應被拒', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/bad-type-createdat`)
        .set({ createdAt: 20260710, userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-10】學生 fcmTokens create：夾帶未允許的額外欄位 → 應被拒（hasOnly 鎖住欄位清單）', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`users/${STUDENT_UID}/fcmTokens/extra-field`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'test-agent', extra: 'should-not-be-allowed' })
    );
  });

  await test('【2026-07-10】學生仍可以 delete 自己的 fcmTokens 文件（確認型別驗證改動未誤傷 delete，delete 時 request.resource 為 null）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${STUDENT_UID}/fcmTokens/to-delete-token`).set({ createdAt: new Date().toISOString(), userAgent: 'seed' });
    });
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`users/${STUDENT_UID}/fcmTokens/to-delete-token`).delete());
  });

  // ════════════════════════════════════════════════════════════
  // /admins/{adminId}
  // ════════════════════════════════════════════════════════════
  await test('admin 可以 get 自己的 admins 文件', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc(`admins/${ADMIN_UID}`).get());
  });

  await test('一般學生不能 get admins 文件', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`admins/${ADMIN_UID}`).get());
  });

  await test('一般學生不能 list admins 集合', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().collection('admins').get());
  });

  await test('【2026-07-04】一般學生不能 create /admins/ 文件（自我提權應被拒；email 格式本身合法，隔離出真正把關的是 isAdmin()）', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`admins/${STUDENT_UID}`).set({ email: STUDENT_EMAIL }));
  });

  await test('admin 新增管理員：email 格式不符 → 應被拒', async () => {
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('admins/new-admin').set({ email: 'not-a-school-email@gmail.com' }));
  });

  await test('admin 新增管理員：email 格式正確 → 應成功', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('admins/new-admin-2').set({ email: 'teacher2@tcivs.tc.edu.tw' }));
  });

  await test('刪除 protected 管理員 → 應被拒', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('admins/protected-admin').set({ email: ADMIN_EMAIL, protected: true });
    });
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('admins/protected-admin').delete());
  });

  await test('想把 protected 管理員的 protected 旗標改掉 → 應被拒（keepsProtectedFlag）', async () => {
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('admins/protected-admin').set({ email: ADMIN_EMAIL, protected: false }));
  });

  // ════════════════════════════════════════════════════════════
  // /admins/{adminId}/fcmTokens/{tokenId}（2026-07-06 新增，Web Push 推播 token）
  // 與上方 /users/{userId}/fcmTokens 同一輪缺口、同一次一併補上，理由詳見該處註解。
  // 規則：allow create,update,delete: if isAdmin() && (adminId==request.auth.uid ||
  // adminId==emailKey())；get/list 固定 false。
  // ════════════════════════════════════════════════════════════
  await test('【2026-07-07】admin 可以 create 自己的 fcmTokens 文件', async () => {
    await assertSucceeds(
      authCtx(ADMIN_UID, ADMIN_EMAIL).firestore()
        .doc(`admins/${ADMIN_UID}/fcmTokens/fake-token-self`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-07】非 admin 的一般學生不能 create 別人（admin）的 fcmTokens 文件', async () => {
    await assertFails(
      authCtx(STUDENT_UID, STUDENT_EMAIL).firestore()
        .doc(`admins/${ADMIN_UID}/fcmTokens/fake-token-intruder`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-07】admin 不能 get 自己的 fcmTokens 文件（get 固定 false）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`admins/${ADMIN_UID}/fcmTokens/seed-token-get`).set({ createdAt: new Date().toISOString(), userAgent: 'seed' });
    });
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc(`admins/${ADMIN_UID}/fcmTokens/seed-token-get`).get());
  });

  await test('【2026-07-07】admin 不能 list 自己的 fcmTokens 集合（list 固定 false）', async () => {
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().collection(`admins/${ADMIN_UID}/fcmTokens`).get());
  });

  // 2026-07-10 新增（稽核 #8）：對稱補上 admin 端的 fcmTokens 型別/大小驗證測試，
  // 理由與上方 /users/{userId}/fcmTokens 完全相同，不重複展開。
  await test('【2026-07-10】admin fcmTokens create：userAgent 超過 200 字元 → 應被拒', async () => {
    await assertFails(
      authCtx(ADMIN_UID, ADMIN_EMAIL).firestore()
        .doc(`admins/${ADMIN_UID}/fcmTokens/oversized-useragent`)
        .set({ createdAt: new Date().toISOString(), userAgent: 'x'.repeat(201) })
    );
  });

  await test('【2026-07-10】admin fcmTokens create：createdAt 型別錯誤（數字而非字串）→ 應被拒', async () => {
    await assertFails(
      authCtx(ADMIN_UID, ADMIN_EMAIL).firestore()
        .doc(`admins/${ADMIN_UID}/fcmTokens/bad-type-createdat`)
        .set({ createdAt: 20260710, userAgent: 'test-agent' })
    );
  });

  await test('【2026-07-10】admin 仍可以 delete 自己的 fcmTokens 文件（確認型別驗證改動未誤傷 delete）', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`admins/${ADMIN_UID}/fcmTokens/to-delete-token`).set({ createdAt: new Date().toISOString(), userAgent: 'seed' });
    });
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc(`admins/${ADMIN_UID}/fcmTokens/to-delete-token`).delete());
  });

  // ════════════════════════════════════════════════════════════
  // /studentBindings/{bindingId}
  // ════════════════════════════════════════════════════════════
  await test('學生可以 get 自己的 studentBindings 文件', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`studentBindings/${STUDENT_BINDING_ID}`).get());
  });

  await test('學生不能 get 別人的 studentBindings 文件', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`studentBindings/${OTHER_BINDING_ID}`).get());
  });

  await test('學生 update 自己 binding：只改 uid 欄位 → 應成功', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`studentBindings/${STUDENT_BINDING_ID}`).update({ uid: STUDENT_UID }));
  });

  await test('學生 update 自己 binding：想改 email 欄位 → 應被拒', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc(`studentBindings/${STUDENT_BINDING_ID}`).update({ email: 'hacked@tcivs.tc.edu.tw' }));
  });

  await test('學生不能 create 新的 studentBindings 文件', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('studentBindings/new-binding').set({ email: STUDENT_EMAIL, seatNo: '50' }));
  });

  // ════════════════════════════════════════════════════════════
  // /journals/{journalId}（頂層平面集合，僅 admin）
  // ════════════════════════════════════════════════════════════
  await test('admin 可以 read 頂層 /journals/ 集合', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('journals/legacy-flat-1').get());
  });

  await test('一般學生不能 read 頂層 /journals/ 集合', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('journals/legacy-flat-1').get());
  });

  // ════════════════════════════════════════════════════════════
  // /deadlines/{deadlineId}
  // ════════════════════════════════════════════════════════════
  await test('校內信箱可以 read deadlines', async () => {
    await assertSucceeds(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('deadlines/d1').get());
  });

  await test('校外信箱不能 read deadlines', async () => {
    await assertFails(authCtx(OUTSIDER_UID, OUTSIDER_EMAIL).firestore().doc('deadlines/d1').get());
  });

  await test('一般學生不能 create deadlines', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('deadlines/d2').set({ month: 8 }));
  });

  await test('admin 可以 create deadlines', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('deadlines/d2').set({ month: 8 }));
  });

  // ════════════════════════════════════════════════════════════
  // /settings/{settingId}
  // ════════════════════════════════════════════════════════════
  await test('一般學生不能 read settings', async () => {
    await assertFails(authCtx(STUDENT_UID, STUDENT_EMAIL).firestore().doc('settings/teacher').get());
  });

  await test('admin 可以 read settings', async () => {
    await assertSucceeds(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('settings/teacher').get());
  });

  // ════════════════════════════════════════════════════════════
  // email_verified 防護（2026-07-03）
  // 背景：schoolUser() 只驗證 email 字串格式，不代表這個字串背後真的受
  // tcivs.tc.edu.tw 網域控制——Google OAuth 路徑上網域控制力歸屬校方 Google
  // Workspace，但 Email/Password 是 Firebase 自己一套獨立帳號系統，註冊時
  // email 欄位填任意字串即可拿到通過 schoolUser() 的 token。最直接可被利用的
  // 情境：老師開學匯入名單後，studentBindings 文件已存在（有真實 seatNo），
  // 但學生本人尚未第一次登入（uid 欄位還沒被寫入）——這段空窗期內，任何人
  // 只要搶先用該信箱自助註冊，就能拿到一個 email 對得上的 token，而下方多條
  // 規則（studentBindings get/update、students get、journals create 的 seatNo
  // 驗證）原本都只比對 email 字串、不檢查 uid，會直接放行。
  // 修法：schoolUser() 新增 email_verified == true。以下測試分兩組對照：
  // 「未驗證」的攻擊者 token 應被全面擋下；「已驗證」（模擬該生本人首次
  // Google 登入）的相同操作應維持原本正常運作，確認修補沒有誤傷合法情境。
  // ════════════════════════════════════════════════════════════
  await test('【2026-07-03】未驗證信箱不能 get 尚未登入學生的 studentBindings（防止搶先冒用）', async () => {
    await assertFails(authCtxUnverified(ATTACKER_UID, UNCLAIMED_EMAIL).firestore().doc(`studentBindings/${UNCLAIMED_BINDING_ID}`).get());
  });

  await test('【2026-07-03】未驗證信箱不能把尚未登入學生的 binding.uid 改成自己（防止搶先綁定冒充身分）', async () => {
    await assertFails(authCtxUnverified(ATTACKER_UID, UNCLAIMED_EMAIL).firestore().doc(`studentBindings/${UNCLAIMED_BINDING_ID}`).update({ uid: ATTACKER_UID }));
  });

  await test('【2026-07-03】未驗證信箱不能 get 尚未登入學生對應座號的 students 文件', async () => {
    await assertFails(authCtxUnverified(ATTACKER_UID, UNCLAIMED_EMAIL).firestore().doc('students/115-1_03').get());
  });

  await test('【2026-07-03】未驗證信箱不能冒用尚未登入學生的座號 CREATE 月記', async () => {
    await assertFails(
      authCtxUnverified(ATTACKER_UID, UNCLAIMED_EMAIL).firestore()
        .doc(`users/${ATTACKER_UID}/journals/impersonate-01`)
        .set(journalDoc(ATTACKER_UID, UNCLAIMED_EMAIL, { seatNo: UNCLAIMED_SEAT }))
    );
  });

  await test('【2026-07-03】未驗證信箱（全新虛構信箱、無 binding）也不能再讀取 deadlines（收斂原本殘留的低敏感度讀取權）', async () => {
    await assertFails(authCtxUnverified(NO_BINDING_UID, NO_BINDING_EMAIL).firestore().doc('deadlines/d1').get());
  });

  await test('【2026-07-03】對照組：已驗證信箱（模擬該生首次 Google 登入）可以 get 自己尚未登入過的 studentBindings', async () => {
    await assertSucceeds(authCtx(UNCLAIMED_UID_LEGIT, UNCLAIMED_EMAIL).firestore().doc(`studentBindings/${UNCLAIMED_BINDING_ID}`).get());
  });

  await test('【2026-07-03】對照組：已驗證信箱可以把尚未登入學生的 binding.uid 首次綁定成自己（合法首登流程不受影響）', async () => {
    await assertSucceeds(authCtx(UNCLAIMED_UID_LEGIT, UNCLAIMED_EMAIL).firestore().doc(`studentBindings/${UNCLAIMED_BINDING_ID}`).update({ uid: UNCLAIMED_UID_LEGIT }));
  });

  await test('【2026-07-03】對照組：已驗證信箱、無 binding 時仍可讀取 deadlines（確認修補未過度限制既有低風險路徑）', async () => {
    await assertSucceeds(authCtx(NO_BINDING_UID, NO_BINDING_EMAIL).firestore().doc('deadlines/d1').get());
  });

  // ════════════════════════════════════════════════════════════
  // 萬用 catch-all：未列出的路徑一律拒絕
  // ════════════════════════════════════════════════════════════
  await test('未定義的集合路徑一律拒絕讀寫（即使是 admin）', async () => {
    await assertFails(authCtx(ADMIN_UID, ADMIN_EMAIL).firestore().doc('未來新增的不明集合/abc').get());
  });

  // ════════════════════════════════════════════════════════════
  // 結果輸出
  // ════════════════════════════════════════════════════════════
  console.log('\n──────────────────────────────────────');
  console.log(`Rules 單元測試結果：${pass}/${pass + fail} 通過，${fail} 失敗`);
  if (fail > 0) {
    console.log('失敗項目：');
    failedNames.forEach((n) => console.log('  ✗ ' + n));
  }
  console.log('──────────────────────────────────────');

  await testEnv.cleanup();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ 測試執行過程發生未預期錯誤：', e);
  process.exit(1);
});
