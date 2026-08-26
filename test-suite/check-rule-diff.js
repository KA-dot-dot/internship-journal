/**
 * check-rule-diff.js
 * Layer 3：rule.txt 高風險區塊變更偵測。
 *
 * 背景：2026-06-17 那次學生無法儲存月記的 bug，根源是 journals CREATE 規則
 * 把「檢查欄位等於初始值」(.get(field, default) == default) 誤寫成
 * 「檢查欄位不存在」(!hasAny([field]))——兩種寫法長得像，語意卻完全相反，
 * 光看整份 rule.txt 的 diff 很容易掃過去沒注意到。
 *
 * 這個腳本做三件事：
 *   1. 把 rule.txt 裡最容易出事的幾個區塊（students、journals 子集合、
 *      studentBindings，以及 schoolUser/emailKey/isAdmin 等輔助函式）單獨抽出來，
 *      新舊版本不一樣就完整印出來，逼自己仔細看這幾塊，而不是被全檔案的 diff洗掉。
 *   2. 掃描新版內容裡是否出現「用 !hasAny() 檢查 teacher 相關欄位不存在」這種
 *      已知會造成問題的寫法，無論是不是這次新改的，都直接示警。
 *   3.（2026-07-18 新增）反向掃描：比對 rule.txt 的月記欄位驗證邏輯，跟
 *      rules-tests/test-rules.js 實際測試過的欄位，找出兩邊「有落差」的地方——
 *      這是前兩項檢查天生抓不到的一種漏洞（見下方「反向掃描」章節完整說明）。
 *      源自 2026-07-16 那次稽核發現：journalSubmitNotifiedAt 這個欄位，
 *      test-rules.js 明明測了 7 條「應該被 rule.txt 擋下」的情境，但 rule.txt
 *      當時實際上完全沒有對應的驗證規則——RISK_TARGETS／DANGER_PATTERNS 兩層
 *      機制都抓不到這種「從一開始就沒被寫進規則」的落差（前者只比對新舊版本的
 *      diff，後者只認已知的錯誤寫法，兩者都假設規則本身「有寫、只是寫錯」，
 *      沒有涵蓋「根本沒寫」這個情況）。
 *
 * 用法：
 *   node check-rule-diff.js                      → 自動比對 git HEAD 版本 vs 目前工作區的 rule.txt
 *   node check-rule-diff.js <舊檔路徑> <新檔路徑>   → 手動指定兩個檔案比對
 *   加上 --confirm                                → 即使高風險區塊有變更，仍以 exit code 0 結束
 *                                                    （給人工確認過沒問題、想讓 CI/腳本繼續跑時用）
 *
 * exit code：
 *   0 → 沒有高風險變更，或加了 --confirm
 *   1 → 偵測到高風險區塊變更、危險寫法，或反向掃描出現落差，且未加 --confirm
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const fileArgs = args.filter((a) => a !== '--confirm');

// 反向掃描要讀的 test-rules.js 路徑——check-rule-diff.js 本身放在 test-suite/ 底下，
// test-rules.js 放在同層的 rules-tests/ 子資料夾（見 AI_測試架構說明.md 第二節檔案
// 位置地圖）。找不到這個檔案時（例如有人把這支腳本單獨抽出來在別的地方跑），反向
// 掃描直接跳過並印一行提示，不讓整支腳本因為這個新增功能而壞掉——前兩項既有檢查
// （RISK_TARGETS／DANGER_PATTERNS）完全不依賴這個檔案，理應繼續正常運作。
const TEST_RULES_PATH = path.join(__dirname, 'rules-tests', 'test-rules.js');

// ── 取得要比對的舊／新內容 ──────────────────────────────────────
function findGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (e) {
    return null;
  }
}

function getOldAndNewContent() {
  if (fileArgs.length >= 2) {
    return {
      oldContent: fs.readFileSync(fileArgs[0], 'utf8'),
      newContent: fs.readFileSync(fileArgs[1], 'utf8'),
      oldLabel: fileArgs[0],
      newLabel: fileArgs[1],
    };
  }

  const gitRoot = findGitRoot();
  if (!gitRoot) {
    console.error('❌ 找不到 git 專案，且未指定兩個檔案路徑。');
    console.error('   用法：node check-rule-diff.js <舊檔路徑> <新檔路徑>');
    process.exit(1);
  }

  const newPath = path.join(gitRoot, 'rule.txt');
  if (!fs.existsSync(newPath)) {
    console.error('❌ 找不到 ' + newPath);
    process.exit(1);
  }
  const newContent = fs.readFileSync(newPath, 'utf8');

  let oldContent;
  try {
    oldContent = execSync('git show HEAD:rule.txt', { cwd: gitRoot, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch (e) {
    console.log('ℹ️  git HEAD 沒有 rule.txt 的舊版本（可能是第一次加入版控），視為全新檔案。');
    oldContent = '';
  }

  return { oldContent, newContent, oldLabel: 'git HEAD', newLabel: '目前工作區' };
}

// ── 用括號配對抓出完整區塊（處理巢狀 {}）────────────────────────
function extractBlock(content, headerRegex) {
  const m = headerRegex.exec(content);
  if (!m) return null;

  // 注意：match 宣告行本身可能含有路徑參數的 {paramName}（例如 /users/{userId}），
  // 不能直接抓「最近的一個 {」，否則會抓到路徑參數的括號而不是區塊本體的括號。
  // 區塊本體的開頭括號照這份 rule.txt 的排版習慣，永遠是宣告那一行「最後一個」{。
  let lineEnd = content.indexOf('\n', m.index);
  if (lineEnd === -1) lineEnd = content.length;
  const headerLine = content.slice(m.index, lineEnd);
  const braceOffsetInLine = headerLine.lastIndexOf('{');
  if (braceOffsetInLine === -1) return null;
  const start = m.index + braceOffsetInLine;

  let depth = 0;
  let i = start;
  for (; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return content.slice(m.index, i);
}

function normalize(s) {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

const RISK_TARGETS = [
  { name: 'function schoolUser()', regex: /function\s+schoolUser\s*\(/ },
  { name: 'function emailKey()', regex: /function\s+emailKey\s*\(/ },
  { name: 'function isAdmin()', regex: /function\s+isAdmin\s*\(/ },
  { name: 'function validAdminWrite()', regex: /function\s+validAdminWrite\s*\(/ },
  { name: 'function keepsProtectedFlag()', regex: /function\s+keepsProtectedFlag\s*\(/ },
  // 2026-07 補修：validFcmTokenWrite() 是跟 schoolUser()/isAdmin() 同層級的頂層輔助函式
  // （鎖住 fcmTokens 文件的欄位型別/大小），但先前只有呼叫端（match /admins/{adminId}、
  // match /users/{userId} 底下的 fcmTokens create/update）因為巢狀在已監控的區塊裡才被
  // 連帶抓到；函式定義本體自己完全沒有對應的 RISK_TARGETS 項目，弱化函式內部驗證
  // （例如拿掉 userAgent.size() <= 200）不會被標記為高風險變更。跟 2026-07-03
  // （DANGER_PATTERNS 漏 studentReply 家族）、2026-07-04（RISK_TARGETS 漏
  // /admins/{adminId} 區塊本身）是同一種「新增東西時監控清單忘記同步擴充」的模式。
  { name: 'function validFcmTokenWrite()', regex: /function\s+validFcmTokenWrite\s*\(/ },
  // 2026-07-25 補上：validEntriesCompleteAt() 是跟 validFcmTokenWrite() 同層級的頂層輔助
  // 函式（鎖住 entriesCompleteAt 欄位的格式——「篇數真正達到 minEntries 那一刻」的時間戳，
  // 見 rule.txt 對應函式上方註解），CREATE／UPDATE 兩處呼叫端都巢狀在已監控的
  // /users/{userId} 區塊裡才會被連帶抓到，函式定義本體自己需要獨立一條，否則弱化這個函式
  // 內部驗證（例如拿掉格式正則、只剩 is string）不會被標記為高風險變更——跟
  // validFcmTokenWrite() 當初補上這條的理由完全相同，這次是新增當下就同步補上，不是像
  // 前幾次（2026-07-03／07-04／07-10）事後稽核才發現的模式。
  { name: 'function validEntriesCompleteAt()', regex: /function\s+validEntriesCompleteAt\s*\(/ },
  // 2026-08-13 補上：validSalaryPhotos() 是跟 validFcmTokenWrite()／validEntriesCompleteAt()
  // 同層級的頂層輔助函式（鎖住 salaryPhotos 陣列長度上限，見 rule.txt 對應函式上方註解），
  // CREATE／UPDATE 兩處呼叫端都巢狀在已監控的 /users/{userId} 區塊裡才會被連帶抓到，函式
  // 定義本體自己需要獨立一條，否則弱化這個函式內部驗證（例如拿掉 .size()<=5 或整條移除）
  // 不會被標記為高風險變更。跟前兩者不同的是，這條不是「新增功能當下就同步補上」——
  // salaryPhotos 本身是 2026-08-05 隨「薪資單可上傳多張」功能新增，rule.txt 當時完全沒有
  // 對應驗證，直到 2026-08-13 一輪稽核才發現並補上；RISK_TARGETS 這條因此也是稽核當下
  // 才補，跟 validFcmTokenWrite()／2026-07-25 的 validEntriesCompleteAt() 那次「新增當下
  // 就同步補上」不同，反而更接近 2026-07-03／07-04／07-10 那幾次「新增東西時監控清單
  // 忘記同步擴充」的模式——只是這次是欄位本身的驗證規則從一開始就沒補，不是規則補了、
  // 監控清單沒跟上。
  { name: 'function validSalaryPhotos()', regex: /function\s+validSalaryPhotos\s*\(/ },
  // 2026-08-17 補上：validEntriesFirstCompleteAt() 與 keepsEntriesFirstCompleteAtOnceSet()
  // 是跟 validFcmTokenWrite()／validEntriesCompleteAt()／validSalaryPhotos() 同層級的頂層
  // 輔助函式，修正 entriesCompleteAt 的一個邊界案例（學生先在期限內達標，之後某次編輯
  // 刪除一則工作摘要導致篇數掉回未達標，再補寫回達標時被誤判成「這次才剛好跨過門檻」，
  // 讓誠實達標過的學生被誤判遲交，見 rule.txt 對應函式上方註解／AI_CONTEXT_歷程.md）。
  // 新增一個獨立欄位 entriesFirstCompleteAt（歷史最早達標時間，一旦有值不可逆保留），
  // CREATE／UPDATE 兩處呼叫端都巢狀在已監控的 /users/{userId} 區塊裡才會被連帶抓到，
  // 函式定義本體自己需要獨立條目，否則弱化這兩個函式內部驗證（例如拿掉格式正則、或讓
  // keepsEntriesFirstCompleteAtOnceSet() 的「舊值非 null 時必須相等」這個不可逆保護失效）
  // 不會被標記為高風險變更。跟 validEntriesCompleteAt() 當初補上這條的理由相同，這次是
  // 新增功能當下就同步補上，不是事後稽核才發現的模式。
  { name: 'function validEntriesFirstCompleteAt()', regex: /function\s+validEntriesFirstCompleteAt\s*\(/ },
  { name: 'function keepsEntriesFirstCompleteAtOnceSet()', regex: /function\s+keepsEntriesFirstCompleteAtOnceSet\s*\(/ },
  // 2026-08-20 新增：這個函式把月記文件 ID 與資料欄位的 seatNo/semester/month 綁定；
  // 若被弱化，技術使用者就能用不一致的欄位污染老師端按欄位分組的統計，因此和其他
  // 頂層規則輔助函式一樣必須獨立納入高風險變更偵測。
  { name: 'function hasMatchingJournalId()', regex: /function\s+hasMatchingJournalId\s*\(/ },
  // 2026-08-26 新增：matchesOwnSeatNo() 是跟 hasMatchingJournalId() 同層級的頂層輔助
  // 函式，取代原本 /students/{docId} 的 docId.matches('.*_' + seatNo) 正則字串拼接
  // 寫法（座號若含正則特殊字元會被誤判成萬用字元，導致比對範圍意外放寬，見
  // AI_CONTEXT_狀態.md 第二十節）。呼叫端（/students/{docId} 的 allow get）巢狀在已被
  // 監控的 match /students/{docId} 區塊裡會連帶抓到，但函式定義本體是獨立寫在區塊外面
  // 的頂層函式，需要獨立一條——否則弱化這個函式內部邏輯（例如把 split('_') 改回正則
  // 字串拼接）不會被標記為高風險變更。新增當下就同步補上，不是事後稽核才發現。
  { name: 'function matchesOwnSeatNo()', regex: /function\s+matchesOwnSeatNo\s*\(/ },
  { name: 'match /admins/{adminId}', regex: /match\s+\/admins\/\{adminId\}/ },
  { name: 'match /students/{docId}', regex: /match\s+\/students\/\{docId\}/ },
  { name: 'match /studentBindings/{bindingId}', regex: /match\s+\/studentBindings\/\{bindingId\}/ },
  { name: 'match /users/{userId}（含 journals 子集合，2026-06-17 那次 bug 的位置）', regex: /match\s+\/users\/\{userId\}/ },
  // 2026-07-11 補上：match 區塊自我檢查（見下方 findUnmonitoredMatchBlocks()）第一次
  // 實際執行就抓到這 5 個既有的頂層 match 區塊完全沒被監控，逐一評估後判定全部都要補：
  // /{document=**} 是全站的預設拒絕後備規則，弱化後果最嚴重（優先度最高）；
  // /{path=**}/journals/{journalId} 是月記的另一個讀取入口（admin-only 跨路徑讀取）；
  // /settings/{settingId} 全部操作皆掛 isAdmin()，內容含影響全站的學期/名冊設定；
  // /deadlines/{deadlineId} 讀取本來就對外公開、敏感度較低，但寫入仍掛 isAdmin()；
  // /journals/{journalId}（裸的）全部操作皆掛 isAdmin()，值得留意這個路徑目前
  // 是否還有任何前端程式碼在讀寫，或只是舊架構的遺留。
  { name: 'match /{document=**}', regex: /match\s+\/\{document=\*\*\}/ },
  { name: 'match /{path=**}/journals/{journalId}', regex: /match\s+\/\{path=\*\*\}\/journals\/\{journalId\}/ },
  { name: 'match /settings/{settingId}', regex: /match\s+\/settings\/\{settingId\}/ },
  { name: 'match /deadlines/{deadlineId}', regex: /match\s+\/deadlines\/\{deadlineId\}/ },
  // 這條刻意錨定實際縮排（4 個空白）：rule.txt 裡 match /journals/{journalId} 這段文字
  // 出現兩次——一次是這裡要監控的頂層區塊（4 空白縮排），另一次是巢狀在
  // /users/{userId} 底下的區塊（6 空白縮排，文字完全相同，那個已經透過父層
  // /users/{userId} 監控涵蓋，不需要也不應該重複列出）。不錨定縮排的話，regex 會
  // 命中文件裡「第一個出現」的那個（剛好也是這裡要的那個，純屬巧合），一旦未來
  // rule.txt 內容順序調整，就可能誤抓到錯的區塊，所以直接錨定縮排消除這個歧義，
  // 不依賴目前的文件順序。
  { name: 'match /journals/{journalId}（頂層，非巢狀在 /users/{userId} 底下的那個）', regex: /^ {4}match\s+\/journals\/\{journalId\}/m },
];

// ── 已知危險寫法掃描 ─────────────────────────────────────────────
const DANGER_PATTERNS = [
  {
    desc:
      '用 !keys().hasAny([...]) 檢查 teacher 相關欄位「不存在」，而非用 .get(field, default) == default ' +
      '檢查「值等於初始值」——這正是 2026-06-17 造成學生無法儲存月記的錯誤寫法。' +
      '差別：學生端 saveJournal() 固定會帶這些欄位（值為 null/false），用 hasAny() 判斷「不存在」會把這種正常寫入也擋掉。',
    regex: /!\s*[\w.]*keys\(\)\.hasAny\(\s*\[[^\]]*(teacherComment|teacherReviewed|reviewedAt|teacherCommentUnread)[^\]]*\]\s*\)/,
  },
  {
    desc:
      '同一種 !keys().hasAny([...]) 誤用，發生在 2026-06-26～28 陸續新增的 teacherCommentUpdated／studentReply／' +
      'studentReplyUnread／studentReplyAt 這幾個欄位上（studentReply 孤兒狀態與 seatNo 驗證那五輪修正加的）。' +
      '這幾個欄位在 rule.txt 目前用的是 .get(field, default) == default（CREATE 分支）或 ' +
      '.get(field, default) == resource.data.get(field, default)（UPDATE 一般編輯分支，要求維持原值不變）這類寫法，' +
      '跟 2026-06-17 那次的欄位屬於同一種風險（誤寫成 hasAny() 檢查「不存在」，會放行不該通過的寫入，或擋下正常寫入)，' +
      '所以另外列一條規則掃描，不依賴人工在區塊 diff 裡自己看出來。',
    regex: /!\s*[\w.]*keys\(\)\.hasAny\(\s*\[[^\]]*(teacherCommentUpdated|studentReplyUnread|studentReplyAt|studentReply)[^\]]*\]\s*\)/,
  },
  {
    desc:
      '同一種 !keys().hasAny([...]) 誤用，發生在 teacherCommentContentAt／studentReplyContentAt／' +
      'journalSubmitNotifiedAt 這幾個欄位上（老師評語／學生回覆「內容真正改變」那一刻的時間戳、' +
      '以及學生「第一次繳交月記」是否已推播通知過老師的標記，皆供推播通知服務判斷是否已推播過、' +
      '避免內容沒變卻重複推播用）。rule.txt 對這幾個欄位目前用的是 .get(field, default) == default' +
      '（CREATE 分支，要求須為初始空值）或 .get(field, default) == resource.data.get(field, default)' +
      '（一般編輯分支，要求維持原值不變）這類寫法，跟前兩條規則涵蓋的欄位屬於同一種風險（誤寫成 ' +
      'hasAny() 檢查「不存在」，會放行不該通過的寫入，或擋下正常寫入)，所以另外列一條規則掃描，' +
      '不依賴人工在區塊 diff 裡自己看出來。' +
      '2026-07-12 補上 journalSubmitNotifiedAt：這是新增欄位跟著同一種模式（新增了屬於已知危險' +
      '類別的欄位，監控清單卻沒有同步跟著擴充）又發生一次的例子——這次落在 DANGER_PATTERNS，' +
      '不是 RISK_TARGETS。journalSubmitNotifiedAt 欄位本身是 2026-07-12 才隨「學生第一次繳交' +
      '月記→通知全體老師」這個新推播事件新增進 rule.txt（見 AI_推播系統說明.md 3.6 節），跟' +
      '前一天（2026-07-11）稽核 check-rule-diff.js 本身找到的函式／match 區塊自我檢查漏洞是' +
      '同一個根本問題（新增東西時監控清單忘記同步擴充）在不同一天、不同欄位上的重演。',
    regex: /!\s*[\w.]*keys\(\)\.hasAny\(\s*\[[^\]]*(teacherCommentContentAt|studentReplyContentAt|journalSubmitNotifiedAt)[^\]]*\]\s*\)/,
  },
];

function scanDangerPatterns(content) {
  const hits = [];
  for (const p of DANGER_PATTERNS) {
    const m = p.regex.exec(content);
    if (m) hits.push({ desc: p.desc, snippet: m[0] });
  }
  return hits;
}

// ── 自我檢查：rule.txt 有沒有頂層 function 宣告沒被 RISK_TARGETS 監控到 ──────
// 背景：這是同一種模式第三次發生，且三次都是事後稽核才抓到，不是新增當下就發現：
//   - 2026-07-03：DANGER_PATTERNS 只涵蓋舊欄位，2026-06-26～28 新增的 studentReply
//     家族欄位漏了。
//   - 2026-07-04：RISK_TARGETS 監控了三個 admin 輔助函式，卻沒把 /admins/{adminId}
//     這個 match 區塊本身納入。
//   - 2026-07-10：RISK_TARGETS 監控了 fcmTokens 的呼叫端（因為巢狀在已監控的
//     /admins/{adminId}／/users/{userId} 區塊裡才被連帶抓到），卻沒把新增的頂層輔助
//     函式 validFcmTokenWrite() 這個函式定義本體納入。
// 與其每次等外部稽核才補一條，這裡改成腳本自己掃描 rule.txt 裡所有頂層 function 宣告，
// 逐一確認 RISK_TARGETS 裡有沒有任何一條規則會命中它；找不到就直接示警，把「記得補監控
// 條目」從人工習慣，變成腳本自動檢查、擋下部署的事。
//
// 逐行處理並跳過整行註解（trim 後以 // 開頭），避免像 S-SEC-08／T-SEC-30 那種
// 「regex 命中說明性註解文字本身、而非真正的程式碼」的假訊號——這份專案的函式內部
// 常常會有長篇中文註解說明「這個函式是做什麼的」，若不排除註解行，容易誤判或漏判。
function findDeclaredFunctions(content) {
  const results = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('//')) continue;
    const m = /^function\s+(\w+)\s*\(/.exec(line);
    if (m) results.push({ name: m[1], rawLine });
  }
  return results;
}

function findUnmonitoredFunctions(content) {
  const declared = findDeclaredFunctions(content);
  // 用「這一行實際的原始文字，看有沒有任何 RISK_TARGETS 的 regex 會命中它」，而不是
  // 重新合成一行乾淨的 function NAME( 字串——用合成字串曾經在開發這個功能時踩到一個坑：
  // 如果某條 RISK_TARGETS 的 regex 為了消歧義而錨定了實際縮排（例如下面 match 區塊
  // 檢查那條，/journals/{journalId} 跟巢狀在 /users/{userId} 底下的同名區塊文字完全
  // 相同，只能靠縮排分辨），合成字串會遺失縮排資訊，導致「明明已經補了對應條目，
  // 自我檢查卻還是誤報成沒監控到」。用原始行文字比對，判斷的才是「這行真正的內容，
  // 送進 extractBlock() 時真的會不會被同一條 regex 抓到」，跟主程式實際比對區塊時
  // 用的邏輯是同一套依據。
  return declared
    .filter(({ rawLine }) => !RISK_TARGETS.some((t) => t.regex.test(rawLine)))
    .map(({ name }) => name);
}

// ── 自我檢查：rule.txt 有沒有頂層 match 區塊沒被 RISK_TARGETS 監控到 ──────────
// 跟上面的函式自我檢查是同一種模式，補的是 2026-07-04 那次事故真正對應的類型——
// 那次漏掉的是 /admins/{adminId} 這個 match 區塊本身，不是函式。函式檢查只解決了
// 一半，match 區塊這一半如果不比照處理，往後同一種疏漏還是可能在「新增 match 區塊」
// 這條路徑上重演，只是這次不是靠外部稽核事後抓到，而是完全沒人發現。
//
// 「頂層」定義為：直接掛在 match /databases/{database}/documents { ... } 這個外層
// 區塊底下的 match 宣告，不含巢狀在其他 match 區塊裡面的（例如 /admins/{adminId}
// 底下的 /fcmTokens/{tokenId}）——那些巢狀區塊只要父層區塊有被監控，diff 比對父層時
// 用括號配對抓出的內容本來就會包含它們，不需要也不應該重複列出來額外監控。
//
// 做法：逐行掃描，用「進到這一行 match 宣告的開括號之前，目前的括號深度」判斷這行
// 是不是直接掛在 documents 區塊底下（深度剛好等於 documents 區塊本身的深度 + 1）。
// 深度計算採用跟既有 extractBlock() 一致的做法——整行原始字元都算進去，不特別排除
// 註解行裡的括號；但「這一行算不算 match 宣告」的判斷會先跳過整行註解，避免像
// S-SEC-08／T-SEC-30 那種「regex 命中說明性註解文字本身」的假訊號。
function findTopLevelMatchBlocks(content) {
  const lines = content.split('\n');
  let depth = 0;
  let documentsBlockDepth = null; // 找到 documents 區塊那一行時，記錄「進入前」的深度
  const targets = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const depthBefore = depth;

    if (!line.startsWith('//')) {
      if (documentsBlockDepth === null && /^match\s+\/databases\/\{database\}\/documents\b/.test(line)) {
        documentsBlockDepth = depthBefore;
      } else if (documentsBlockDepth !== null && depthBefore === documentsBlockDepth + 1) {
        const m = /^match\s+(\S+)\s*\{/.exec(line);
        if (m) targets.push({ path: m[1], rawLine });
      }
    }

    const opens = (rawLine.match(/\{/g) || []).length;
    const closes = (rawLine.match(/\}/g) || []).length;
    depth += opens - closes;
  }

  return targets;
}

function escapeForRegexDisplay(str) {
  // 也要跳脫 /，否則印出來的建議字串塞進 /.../ regex literal 時，中間未跳脫的 /
  // 會被誤判成提前結束 regex，貼上去會直接語法錯誤——既有 RISK_TARGETS 裡的寫法
  // （例如 /match\s+\/admins\/\{adminId\}/）本來就都有跳脫 /，這裡的建議輸出要跟著一致。
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function findUnmonitoredMatchBlocks(content) {
  const targets = findTopLevelMatchBlocks(content);
  return targets
    .filter(({ rawLine }) => !RISK_TARGETS.some((t) => t.regex.test(rawLine)))
    .map(({ path }) => path);
}

// ── 反向掃描：test-rules.js 測到的月記欄位，跟 rule.txt 實際驗證的月記欄位，
//    互相比對找落差（2026-07-18 新增）──────────────────────────────────
//
// 動機：2026-07-16 那次稽核發現 journalSubmitNotifiedAt 這個欄位，test-rules.js
// 明明寫了 7 條「應該被 rule.txt 擋下」的測試，但 rule.txt 當時實際上完全沒有
// 對應的驗證規則——上面兩層機制都抓不到這種「從一開始就沒被寫進規則」的落差：
//   - RISK_TARGETS：只比對「監控中的區塊，新舊版本內容有沒有變」，一個從未存在過
//     的欄位不會被算成「變更」。
//   - DANGER_PATTERNS：只認已知的錯誤寫法（!hasAny() 誤用），規則裡完全沒寫這個
//     欄位不算「寫錯」，只是「沒寫」。
// 這裡换個角度：不看 rule.txt「改了什麼」，而是直接問「test-rules.js 覺得應該存在
// 的驗證，rule.txt 裡到底有沒有」，以及反過來「rule.txt 已經在驗證的欄位，
// test-rules.js 有沒有真的測到」。
//
// 範圍刻意只鎖定 /users/{userId}/journals/{journalId}（巢狀的月記子集合），
// 不含 fcmTokens／admins／studentBindings，理由：
//   ①journalSubmitNotifiedAt 那次真實漏洞就發生在這裡，是欄位數量最多（15+）、
//     分支邏輯最複雜（CREATE + 3 個互斥 UPDATE 分支）、也最容易「改了程式碼、
//     忘記同步改規則」的地方，投報率最高；
//   ②fcmTokens/admins/studentBindings 欄位少（2~4 個）、規則簡單，驗證函式本身
//     （validFcmTokenWrite()／validAdminWrite()）已被 RISK_TARGETS 監控，變更會被
//     既有機制抓到，人工看 diff 也不容易漏；
//   ③這些集合的欄位驗證邏輯有些落在 match 區塊之外的獨立頂層函式（例如
//     validFcmTokenWrite() 定義在檔案最前面，不在 /users/{userId} 區塊內），混進來
//     需要額外處理「這個欄位的驗證到底該去哪裡找」的歸屬問題，複雜度不成比例，
//     先只做投報率最高的這一塊。
//
// ── 從一段程式碼文字裡，切出「最外層逗號分隔」的片段（尊重引號與括號巢狀）──
// 不能直接用 split(',')，因為值裡可能有逗號（例如 new Date().toISOString() 沒有，
// 但字串值理論上可能含逗號），也不能無視引號內容，否則 ISO 時間字串裡的冒號
// （例如 '2026-07-06T00:00:00+08:00'）會被誤判成物件的 key/value 分界。
function splitTopLevelSegments(inner) {
  const segments = [];
  let depth = 0;
  let quote = null; // null | "'" | '"' | '`'
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const prev = inner[i - 1];
    if (quote) {
      cur += c;
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      depth++;
      cur += c;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segments.push(cur);
  return segments;
}

// 從一個物件字面量的內容（大括號中間那段文字）抽出所有 key。用上面的引號/括號感知
// 分段，而不是天真地對整段文字做 /identifier\s*:/g 正規表達式——那樣會被字串值裡
// 「看起來像 key:」的內容誤判，例如 ISO 時間字串 '...T00:00:00...' 裡的 'T00' 後面
// 剛好接著冒號，會被誤認成一個叫 T00 的欄位。
function extractKeysFromObjectLiteral(inner) {
  const keys = [];
  for (const seg of splitTopLevelSegments(inner)) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    let depth = 0;
    let quote = null;
    let colonIdx = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      const prev = trimmed[i - 1];
      if (quote) {
        if (c === quote && prev !== '\\') quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        continue;
      }
      if (c === '{' || c === '(' || c === '[') {
        depth++;
        continue;
      }
      if (c === '}' || c === ')' || c === ']') {
        depth--;
        continue;
      }
      if (c === ':' && depth === 0) {
        colonIdx = i;
        break;
      }
    }
    // colonIdx === -1 代表這段沒有冒號，是 ES6 shorthand 寫法（例如 { email }），
    // 這種情況下整段文字本身就是 key，不需要另外特判。
    const keyPart = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
    const keyMatch = /^([A-Za-z_$][\w$]*)$/.exec(keyPart.trim());
    if (keyMatch) keys.push(keyMatch[1]);
  }
  return keys;
}

// 從指定的開括號索引開始，找出對應的結束括號索引（處理巢狀）。跟檔案上方
// extractBlock() 用的是同一種括號配對邏輯，這裡獨立一份是因為要配對的是
// 圓括號/方括號，不是 extractBlock() 固定處理的大括號。
function findMatchingClose(str, openIdx, openChar, closeChar) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === openChar) depth++;
    else if (str[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// test-rules.js 是否為「journals 子集合」的路徑（巢狀在 users/{uid}/ 底下），
// 不含頂層平面 /journals/{journalId}（那個是 isAdmin() 全權放行、設計上就不做
// 欄位驗證，混進來只會產生恆定的假警報——已在開發這個功能時實際驗證過這個情境）。
function isJournalSubcollectionPath(pathStr) {
  return /^users\/[^/]+\/journals\//.test(pathStr);
}

// 從 test-rules.js 裡，抽出所有「journalDoc(uid, email, { ...overrides })」呼叫
// 第三個參數（overrides 物件）用到的欄位名稱。
function extractFieldsFromJournalDocCalls(testRulesContent) {
  const keys = new Set();
  const callRe = /journalDoc\s*\(/g;
  let m;
  while ((m = callRe.exec(testRulesContent))) {
    // 跳過 journalDoc 自己的函式定義那一行（function journalDoc(uid, email, overrides = {}) {），
    // 那一行的抓法由下面 extractJournalDocBaseFields() 另外處理。
    const lineStart = testRulesContent.lastIndexOf('\n', m.index) + 1;
    if (/function\s+$/.test(testRulesContent.slice(lineStart, m.index))) continue;

    const openParen = testRulesContent.indexOf('(', m.index);
    const closeParen = findMatchingClose(testRulesContent, openParen, '(', ')');
    if (closeParen === -1) continue;
    const argsText = testRulesContent.slice(openParen + 1, closeParen);
    // 第三個參數（overrides）是唯一的物件字面量參數，前兩個（uid, email）是變數，
    // 用「找第一個 {」的方式抓即可。
    const braceOpen = argsText.indexOf('{');
    if (braceOpen === -1) continue; // 沒有第三個參數，例如 journalDoc(STUDENT_UID, STUDENT_EMAIL)
    const braceClose = findMatchingClose(argsText, braceOpen, '{', '}');
    if (braceClose === -1) continue;
    for (const k of extractKeysFromObjectLiteral(argsText.slice(braceOpen + 1, braceClose))) keys.add(k);
  }
  return keys;
}

// journalDoc() 函式定義本身的基底欄位（每次呼叫都會帶到的欄位，即使沒被 override）。
function extractJournalDocBaseFields(testRulesContent) {
  const m = /function\s+journalDoc\s*\([^)]*\)\s*\{/.exec(testRulesContent);
  if (!m) return new Set();
  const braceOpen = testRulesContent.indexOf('{', m.index + m[0].length - 1);
  const braceClose = findMatchingClose(testRulesContent, braceOpen, '{', '}');
  const body = testRulesContent.slice(braceOpen + 1, braceClose);
  const retM = /return\s*\{/.exec(body);
  if (!retM) return new Set();
  const retBraceOpen = body.indexOf('{', retM.index);
  const retBraceClose = findMatchingClose(body, retBraceOpen, '{', '}');
  // 過濾掉 'overrides'：函式本體用 `...overrides` 展開最後一個參數，這個 key 本身
  // 不是真正的欄位名稱，是 JS 語法的一部分，防禦性濾掉以防未來函式改寫法時誤抓。
  return new Set(extractKeysFromObjectLiteral(body.slice(retBraceOpen + 1, retBraceClose)).filter((k) => k !== 'overrides'));
}

// 從 test-rules.js 裡，抽出所有「直接對 journals 路徑呼叫 .set({...}) 或 .update({...})」
// （不是透過 journalDoc() helper）用到的欄位名稱——UPDATE 分支的測試（例如
// .update({ teacherCommentUnread: false })、回覆分支的 studentReply/studentReplyUnread/
// studentReplyAt/studentReplyContentAt）大多是這種直接 .update() 寫法，journalDoc() 那組
// 函式只涵蓋 CREATE 與少數用整份 .set() 模擬的 UPDATE 測試，兩者互補，缺一都會漏掉
// 大半欄位。
function extractFieldsFromDirectSetUpdateCalls(testRulesContent) {
  const keys = new Set();
  const docCallRe = /\.doc\(\s*[`'"]([^`'"]*)[`'"]\s*\)/g;
  let m;
  while ((m = docCallRe.exec(testRulesContent))) {
    const pathStr = m[1];
    if (!isJournalSubcollectionPath(pathStr)) continue;
    const afterDoc = testRulesContent.slice(m.index + m[0].length);
    const nextCallM = /^\s*\.(set|update)\(/.exec(afterDoc);
    if (!nextCallM) continue; // 後面接的不是 set/update（例如 .get()/.delete()），略過
    const openParenIdx = testRulesContent.indexOf('(', m.index + m[0].length + nextCallM.index);
    const closeParenIdx = findMatchingClose(testRulesContent, openParenIdx, '(', ')');
    if (closeParenIdx === -1) continue;
    const argsText = testRulesContent.slice(openParenIdx + 1, closeParenIdx);
    // .set() 的參數若是 journalDoc(...) 呼叫，已經被 extractFieldsFromJournalDocCalls()
    // 處理過，這裡只抓「第一個參數本身就是物件字面量」的情況，避免重複計算（雖然
    // 重複計算對 Set 沒有影響，這裡跳過純粹是避免不必要的重複運算）。
    if (/^journalDoc\s*\(/.test(argsText.trimStart())) continue;
    const braceOpen = argsText.indexOf('{');
    if (braceOpen === -1) continue;
    const braceClose = findMatchingClose(argsText, braceOpen, '{', '}');
    if (braceClose === -1) continue;
    for (const k of extractKeysFromObjectLiteral(argsText.slice(braceOpen + 1, braceClose))) keys.add(k);
  }
  return keys;
}

// 從全文抓出所有頂層 function 的定義本體（name -> 函式本體文字，不含 function 宣告
// 那一行跟外層大括號本身）。2026-07-25 新增，供 extractRegulatedJournalFields() 使用——
// 見該函式上方的完整說明：驗證邏輯如果被抽成共用函式（例如 validEntriesCompleteAt()），
// 呼叫端只留下一個函式呼叫、看不到實際的 .get()／比對語法，反向掃描原本只看區塊字面文字
// 會誤判成「完全沒有驗證」。用跟 extractBlock() 同一種括號配對邏輯抓出函式本體。
//
// 跟 findDeclaredFunctions() 一樣要求「function」出現在該行實際程式碼的開頭（trim 後），
// 不能只是全文寬鬆搜尋——否則跟這次開發 callRe 那段一樣，會被解釋性註解裡提到的函式名稱
// 字面文字誤判（例如某處註解寫「這個函式跟 function validXxx() 那種寫法類似」，字面上
// 完全符合 regex 但不是真正的宣告）。做法：正規表達式全文搜尋到候選位置後，回頭檢查
// 這個位置所在行、從行首到這個位置之間是否只有空白字元，不是的話代表「function」前面
// 還有其他文字（最典型就是出現在 // 開頭的註解裡），視為假匹配並跳過。
function extractTopLevelFunctionBodies(fullContent) {
  const bodies = {};
  const fnRe = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = fnRe.exec(fullContent))) {
    const lineStart = fullContent.lastIndexOf('\n', m.index) + 1;
    const linePrefix = fullContent.slice(lineStart, m.index);
    if (linePrefix.trim() !== '') continue; // 前面還有文字，不是真正的行首宣告，跳過
    const name = m[1];
    const braceOpen = fullContent.indexOf('{', m.index + m[0].length - 1);
    const braceClose = findMatchingClose(fullContent, braceOpen, '{', '}');
    if (braceClose === -1) continue;
    bodies[name] = fullContent.slice(braceOpen + 1, braceClose);
  }
  return bodies;
}


// 從 rule.txt 的 /users/{userId}/journals/{journalId} 區塊裡，抽出所有「結構上看得出來
// 正在驗證」的欄位名稱——只認幾種固定語法：.get('field', default)、xxx.data.field ==／!=、
// xxx.data.field is string/bool/number/list/map、xxx.data.field.size()。故意不做
// 全文字串搜尋，只認這幾種「真的在檢查這個欄位」的結構化寫法，避免像 semester 這種
// 詞恰好出現在完全無關的註解裡（/students/{docId} 講 docId 命名格式的註解就提過
// 「{semester}_{seatNo}」，跟月記文件的 semester 欄位是否被驗證完全無關）却被誤判
// 成「已經提過」。
//
// 2026-07-25 補修：新增第二個參數 fullContent（完整 rule.txt 內容，選填）。起因：
// entriesCompleteAt 的格式驗證抽成共用函式 validEntriesCompleteAt()（比照
// validFcmTokenWrite() 的既有模式）後，journals 區塊裡只留下一個 `validEntriesCompleteAt()`
// 呼叫，看不到實際的 `.get()`／格式比對語法本身，導致反向掃描誤判成「這個欄位完全沒有
// 驗證」（Direction A 假警報——已用這次真實案例實測到，見下方 runReverseFieldScan()
// 呼叫處的說明）。修法：如果有傳入 fullContent，額外找出區塊文字裡呼叫到的頂層共用函式
// （零參數呼叫，例如 `validEntriesCompleteAt()`），把該函式的本體也一併納入掃描——這些
// 函式雖然定義在區塊外，但驗證的欄位邏輯上仍屬於這個區塊，只是抽出去重用而已。
//
// 刻意只掃描「/journals/{journalId} 巢狀子區塊」本身（不是整個外層 /users/{userId}，
// 那個還包含平行的 /fcmTokens/{tokenId} 子區塊）——原因：若掃描範圍是整個
// /users/{userId}，區塊文字裡也會出現 `validFcmTokenWrite()` 這個呼叫（在
// /fcmTokens/{tokenId} 底下），一旦解析函式呼叫，會把它的本體（驗證 createdAt／
// userAgent，這兩個是 fcmTokens 文件的欄位，不是月記欄位）也納入「月記欄位」的掃描
// 範圍，反而製造出新的假警報（誤判 createdAt／userAgent 是「規則有驗證但測試沒覆蓋」
// 的月記欄位）。縮小範圍到只有 journals 子區塊本身，能同時解決這兩個問題：既修正
// entriesCompleteAt 的假警報，也不會意外把 fcmTokens 的欄位混進來。
function extractRegulatedJournalFields(usersBlockText, fullContent) {
  const fields = new Set();
  if (!usersBlockText) return fields;

  const scanText = (text) => {
    const getRe = /\.get\(\s*['"]([a-zA-Z_][\w]*)['"]/g;
    let mm;
    while ((mm = getRe.exec(text))) fields.add(mm[1]);
    const dotCompareRe = /(?:request\.resource\.data|resource\.data)\.([a-zA-Z_][\w]*)\s*(?:==|!=)/g;
    while ((mm = dotCompareRe.exec(text))) fields.add(mm[1]);
    const dotTypeCheckRe = /(?:request\.resource\.data|resource\.data)\.([a-zA-Z_][\w]*)\s*(?:is\s+(?:string|bool|number|list|map)|\.size\(\))/g;
    while ((mm = dotTypeCheckRe.exec(text))) fields.add(mm[1]);
  };

  // 只鎖定巢狀的 /journals/{journalId} 子區塊（若抓不到就退回整個傳入的文字，維持
  // 呼叫端沒有這個巢狀結構時仍可運作，不會直接壞掉）。
  const journalsBlock = extractBlock(usersBlockText, /match\s+\/journals\/\{journalId\}/) || usersBlockText;
  scanText(journalsBlock);

  if (fullContent) {
    const fnBodies = extractTopLevelFunctionBodies(fullContent);
    // 2026-07-25 開發時期實測踩到的陷阱（跟這份文件自己記錄過四次的 S-SEC-08／T-SEC-30／
    // S-SEC-29／T-SEC-34 同一種模式，這次是在寫「反向掃描」機制本身時犯的）：直接對
    // journalsBlock 原始文字找零參數函式呼叫，會命中這次新增的解釋性註解本身——例如
    // 「entriesCompleteAt 格式驗證抽成共用函式 validEntriesCompleteAt()（定義於檔案前段、
    // validFcmTokenWrite() 旁，...)」這句話裡提到的 `validFcmTokenWrite()`，字面上跟真正
    // 的函式呼叫語法一模一樣，但只是在說明「這個函式定義在哪裡附近」，不是真的呼叫它。
    // 若不過濾就直接解析，會把 validFcmTokenWrite() 的本體（驗證 createdAt／userAgent，
    // fcmTokens 的欄位、不是月記欄位）誤納入月記欄位的掃描範圍，製造新的假警報。修法：
    // 逐行過濾掉註解（整行是註解的行整行跳過；行內文字後面接的 `//` 註解也一併截斷），
    // 只對剩餘的程式碼文字找函式呼叫。
    const codeOnlyText = journalsBlock
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//')) return '';
        const commentIdx = line.indexOf('//');
        return commentIdx === -1 ? line : line.slice(0, commentIdx);
      })
      .join('\n');
    const callRe = /\b([a-zA-Z_]\w*)\s*\(\s*\)/g;
    let m;
    while ((m = callRe.exec(codeOnlyText))) {
      const fnName = m[1];
      if (fnBodies[fnName]) scanText(fnBodies[fnName]);
    }
  }

  return fields;
}

// 少數已知、刻意排除的欄位——不是遺漏，是這個機制天生的假警報來源，逐一記錄理由：
//   - content：月記的自由文字內容欄位。AI_CONTEXT.md 的 Excel 公式注入稽核已多次
//     確認並記錄：rule.txt 對月記多數頂層欄位（date/month/semester/studentName/
//     company/submittedAt/updatedAt 等）刻意不做規則層驗證，改在 Excel 匯出層防護
//     （Firestore Rules 無法對這類內容欄位做有意義的格式限制），content 屬於這一類
//     已評估、判定維持現狀的欄位，不是新發現。
//   - month／semester：同上，屬於同一組已評估、判定不在規則層驗證的欄位。
//   - extra：test-rules.js 裡刻意用來測試 hasOnly() 會拒絕「未列在允許清單裡的
//     額外欄位」的假欄位名稱（例如 fcmTokens 的「夾帶未允許的額外欄位 → 應被拒」
//     測試），這個欄位「不該」出現在 rule.txt 裡才是正確狀態，不是漏洞。
// 未來若新增其他「刻意不在規則層驗證」的欄位，比照這裡的格式補上並註明理由，
// 不要因為想讓警報清單變乾淨就默默加東西進來卻不寫理由。
const KNOWN_UNVALIDATED_OR_TEST_ONLY_FIELDS = new Set(['content', 'month', 'semester', 'extra']);

function runReverseFieldScan(newRuleContent) {
  const result = { skipped: false, directionA: [], directionB: [] };

  let testRulesContent;
  try {
    testRulesContent = fs.readFileSync(TEST_RULES_PATH, 'utf8');
  } catch (e) {
    result.skipped = true;
    return result;
  }

  const testedFields = new Set([
    ...extractJournalDocBaseFields(testRulesContent),
    ...extractFieldsFromJournalDocCalls(testRulesContent),
    ...extractFieldsFromDirectSetUpdateCalls(testRulesContent),
  ]);

  const usersBlock = extractBlock(newRuleContent, /match\s+\/users\/\{userId\}/);
  const regulatedFields = extractRegulatedJournalFields(usersBlock, newRuleContent);

  // Direction A：test-rules.js 測到了，但 rule.txt 完全沒管——這正是
  // journalSubmitNotifiedAt 那次真實漏洞的樣態。
  for (const f of testedFields) {
    if (KNOWN_UNVALIDATED_OR_TEST_ONLY_FIELDS.has(f)) continue;
    if (!regulatedFields.has(f)) result.directionA.push(f);
  }
  result.directionA.sort();

  // Direction B：rule.txt 有管，但 test-rules.js 完全沒測到——方向相反，抓的是
  // 「規則寫了、但沒有回歸測試守著」的缺口（意外發現的真實案例：teacherCommentUpdated）。
  for (const f of regulatedFields) {
    if (!testedFields.has(f)) result.directionB.push(f);
  }
  result.directionB.sort();

  return result;
}

// ── 主程式 ──────────────────────────────────────────────────────
function main() {
  const { oldContent, newContent, oldLabel, newLabel } = getOldAndNewContent();

  console.log('══════════════════════════════════════');
  console.log('rule.txt 高風險區塊變更檢查');
  console.log(`比對：${oldLabel}  →  ${newLabel}`);
  console.log('══════════════════════════════════════\n');

  let hasRiskChange = false;
  const changedBlocks = [];

  for (const target of RISK_TARGETS) {
    const oldBlock = extractBlock(oldContent, target.regex);
    const newBlock = extractBlock(newContent, target.regex);

    if (oldBlock === null && newBlock === null) continue; // 兩邊都沒有這個區塊，跳過

    const oldNorm = oldBlock ? normalize(oldBlock) : null;
    const newNorm = newBlock ? normalize(newBlock) : null;

    if (oldNorm !== newNorm) {
      hasRiskChange = true;
      changedBlocks.push({ name: target.name, oldBlock, newBlock });
    }
  }

  if (changedBlocks.length === 0) {
    console.log('✅ 高風險區塊（students / journals / studentBindings / 權限輔助函式）皆無變更。\n');
  } else {
    console.log(`⚠️  偵測到 ${changedBlocks.length} 個高風險區塊有變更，請仔細確認：\n`);
    for (const b of changedBlocks) {
      console.log('────────────────────────────────────');
      console.log('區塊：' + b.name);
      console.log('────────────────────────────────────');
      console.log('【舊】');
      console.log(b.oldBlock === null ? '（此區塊原本不存在，是新增的）' : b.oldBlock);
      console.log('\n【新】');
      console.log(b.newBlock === null ? '（此區塊被刪除了）' : b.newBlock);
      console.log('');
    }
  }

  const dangerHits = scanDangerPatterns(newContent);
  if (dangerHits.length > 0) {
    hasRiskChange = true;
    console.log('🚨 偵測到已知危險寫法：\n');
    for (const hit of dangerHits) {
      console.log('  片段：' + hit.snippet);
      console.log('  說明：' + hit.desc);
      console.log('');
    }
  }

  const unmonitoredFns = findUnmonitoredFunctions(newContent);
  if (unmonitoredFns.length > 0) {
    hasRiskChange = true;
    console.log('⚠️  偵測到 rule.txt 有頂層 function 宣告，但 RISK_TARGETS 沒有任何一條規則會監控到它：\n');
    for (const name of unmonitoredFns) {
      console.log(`  - function ${name}()`);
    }
    console.log('');
    console.log('  這是同一種模式第三次發生（2026-07-03／2026-07-04／2026-07-10 各一次，皆是事後');
    console.log('  稽核才抓到）：新增了會影響安全性的函式，監控清單卻沒有同步跟著擴充。請在');
    console.log('  RISK_TARGETS 補上對應條目（{ name: \'function ' + (unmonitoredFns[0] || 'xxx') + '()\', regex: /function\\s+' + (unmonitoredFns[0] || 'xxx') + '\\s*\\(/ }' + '）後再繼續，');
    console.log('  或確認此函式風險極低、暫不需要監控後加 --confirm。');
    console.log('');
  }

  const unmonitoredMatches = findUnmonitoredMatchBlocks(newContent);
  if (unmonitoredMatches.length > 0) {
    hasRiskChange = true;
    console.log('⚠️  偵測到 rule.txt 有頂層 match 區塊，但 RISK_TARGETS 沒有任何一條規則會監控到它：\n');
    for (const matchPath of unmonitoredMatches) {
      console.log(`  - match ${matchPath}`);
    }
    console.log('');
    console.log('  這是同一種「新增東西時監控清單忘記同步擴充」的模式，2026-07-04 的');
    console.log('  /admins/{adminId} 就是這一類（match 區塊本身沒被監控，不是函式）。請在');
    console.log('  RISK_TARGETS 補上對應條目，例如：');
    for (const matchPath of unmonitoredMatches) {
      console.log(`    { name: 'match ${matchPath}', regex: /match\\s+${escapeForRegexDisplay(matchPath)}/ },`);
    }
    console.log('  或逐一評估後，確認某些區塊風險極低、暫不需要監控，加 --confirm 略過。');
    console.log('');
  }

  const reverseScan = runReverseFieldScan(newContent);
  if (reverseScan.skipped) {
    console.log(`ℹ️  找不到 ${TEST_RULES_PATH}，略過反向掃描（不影響上面幾項既有檢查）。\n`);
  } else {
    if (reverseScan.directionA.length > 0) {
      hasRiskChange = true;
      console.log('🔍 反向掃描 A：rules-tests/test-rules.js 測試過這些月記欄位，但 rule.txt 目前完全沒有對應的驗證：\n');
      for (const f of reverseScan.directionA) {
        console.log(`  - ${f}`);
      }
      console.log('');
      console.log('  這正是 2026-07-16 journalSubmitNotifiedAt 那次真實漏洞的樣態——test-rules.js');
      console.log('  寫了「應該被 rule.txt 擋下」的測試，但規則本身從未真的補上，前面幾項檢查');
      console.log('  （RISK_TARGETS／DANGER_PATTERNS）都抓不到這種「從一開始就沒寫」的落差。');
      console.log('  請確認：①這個欄位是否真的需要規則層驗證，是的話在 rule.txt 補上對應的');
      console.log('  .get(field, default) 檢查；②如果是刻意不驗證的欄位（例如自由文字內容），');
      console.log('  在這支腳本的 KNOWN_UNVALIDATED_OR_TEST_ONLY_FIELDS 補上並註明理由後再加');
      console.log('  --confirm 略過。');
      console.log('');
    }
    if (reverseScan.directionB.length > 0) {
      hasRiskChange = true;
      console.log('🔍 反向掃描 B：rule.txt 有驗證這些月記欄位，但 rules-tests/test-rules.js 完全沒有測試涵蓋：\n');
      for (const f of reverseScan.directionB) {
        console.log(`  - ${f}`);
      }
      console.log('');
      console.log('  方向相反：規則寫了，但沒有回歸測試守著，未來這條規則被改壞也不會被 Layer 1');
      console.log('  的 Rules 單元測試抓到。建議在 test-rules.js 補上對應的「偽造這個欄位的值 →');
      console.log('  應被拒」測試，或評估後確認風險低、暫不需要補測試，加 --confirm 略過。');
      console.log('');
    }
    if (reverseScan.directionA.length === 0 && reverseScan.directionB.length === 0) {
      console.log('✅ 反向掃描：月記欄位在 test-rules.js 與 rule.txt 之間沒有發現落差。\n');
    }
  }

  console.log('══════════════════════════════════════');
  if (!hasRiskChange) {
    console.log('結論：可以安全繼續部署。');
    process.exit(0);
  }

  if (confirmed) {
    console.log('結論：偵測到高風險變更，但已加 --confirm，視為人工已確認，繼續執行。');
    process.exit(0);
  }

  console.log('結論：偵測到高風險變更，請先用 test-suite/rules-tests 的 Rules 單元測試確認過，');
  console.log('     再加 --confirm 參數重跑這個腳本，或確認沒問題後手動繼續部署。');
  process.exit(1);
}

main();
