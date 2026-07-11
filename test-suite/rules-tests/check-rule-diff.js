/**
 * check-rule-diff.js
 * Layer 3：rule.txt 高風險區塊變更偵測。
 *
 * 背景：2026-06-17 那次學生無法儲存月記的 bug，根源是 journals CREATE 規則
 * 把「檢查欄位等於初始值」(.get(field, default) == default) 誤寫成
 * 「檢查欄位不存在」(!hasAny([field]))——兩種寫法長得像，語意卻完全相反，
 * 光看整份 rule.txt 的 diff 很容易掃過去沒注意到。
 *
 * 這個腳本做兩件事：
 *   1. 把 rule.txt 裡最容易出事的幾個區塊（students、journals 子集合、
 *      studentBindings，以及 schoolUser/emailKey/isAdmin 等輔助函式）單獨抽出來，
 *      新舊版本不一樣就完整印出來，逼自己仔細看這幾塊，而不是被全檔案的 diff洗掉。
 *   2. 掃描新版內容裡是否出現「用 !hasAny() 檢查 teacher 相關欄位不存在」這種
 *      已知會造成問題的寫法，無論是不是這次新改的，都直接示警。
 *
 * 用法：
 *   node check-rule-diff.js                      → 自動比對 git HEAD 版本 vs 目前工作區的 rule.txt
 *   node check-rule-diff.js <舊檔路徑> <新檔路徑>   → 手動指定兩個檔案比對
 *   加上 --confirm                                → 即使高風險區塊有變更，仍以 exit code 0 結束
 *                                                    （給人工確認過沒問題、想讓 CI/腳本繼續跑時用）
 *
 * exit code：
 *   0 → 沒有高風險變更，或加了 --confirm
 *   1 → 偵測到高風險區塊變更或危險寫法，且未加 --confirm
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const fileArgs = args.filter((a) => a !== '--confirm');

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
      '2026-07-11 補上 journalSubmitNotifiedAt：這是新增欄位跟著同一種模式（新增了屬於已知危險' +
      '類別的欄位，監控清單卻沒有同步跟著擴充）又發生一次的例子——這次落在 DANGER_PATTERNS，' +
      '不是 RISK_TARGETS，跟同一天稽核 check-rule-diff.js 本身找到的函式／match 區塊漏洞是同一個' +
      '根本問題的不同展現形式。',
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
