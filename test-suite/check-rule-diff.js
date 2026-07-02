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
  { name: 'match /students/{docId}', regex: /match\s+\/students\/\{docId\}/ },
  { name: 'match /studentBindings/{bindingId}', regex: /match\s+\/studentBindings\/\{bindingId\}/ },
  { name: 'match /users/{userId}（含 journals 子集合，2026-06-17 那次 bug 的位置）', regex: /match\s+\/users\/\{userId\}/ },
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
];

function scanDangerPatterns(content) {
  const hits = [];
  for (const p of DANGER_PATTERNS) {
    const m = p.regex.exec(content);
    if (m) hits.push({ desc: p.desc, snippet: m[0] });
  }
  return hits;
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
