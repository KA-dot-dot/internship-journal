/**
 * notify-discord.js
 * Layer 2：CI 自動化健康檢查失敗時，組裝失敗摘要並推送到 Discord webhook。
 *
 * 只在 GitHub Actions 的 canary workflow 失敗時被呼叫（見 .github/workflows/canary.yml）。
 * 不需要在本機手動執行；但本機要除錯的話，先設定環境變數：
 *   set DISCORD_WEBHOOK_URL=你的webhook網址
 *   node notify-discord.js
 */
const fs = require('fs');
const path = require('path');

const REPORT_FILE = path.join(__dirname, '..', 'test-report.txt');
const webhook = process.env.DISCORD_WEBHOOK_URL;

if (!webhook) {
  console.log('⚠️ 未設定 DISCORD_WEBHOOK_URL，略過通知（請確認 GitHub Secrets 是否已設定）。');
  process.exit(0);
}

let report = '';
try {
  report = fs.readFileSync(REPORT_FILE, 'utf8');
} catch (e) {
  report = '（無法讀取 test-report.txt：' + e.message + '）';
}

// 抓出失敗項目（格式對應 run-tests.js 的 printSummary：'  ✗ 測試名稱' + 下一行錯誤原因）
const reportLines = report.split('\n');
const failedDetails = [];
for (let i = 0; i < reportLines.length; i++) {
  if (reportLines[i].trim().startsWith('✗')) {
    const name = reportLines[i].trim();
    const reason = reportLines[i + 1] ? reportLines[i + 1].trim() : '';
    failedDetails.push(reason ? `${name}\n      ${reason}` : name);
  }
}

const summaryMatch = report.match(/合計：(\d+)\/(\d+) 通過，(\d+) 失敗/);
const summaryText = summaryMatch
  ? `${summaryMatch[1]}/${summaryMatch[2]} 通過，${summaryMatch[3]} 失敗`
  : '（找不到測試合計摘要，請查看完整報告）';

const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

// canary.yml 是學生端＋老師端一起跑（node run-tests.js 不加 --student/--teacher），
// 失敗的可能只有一端、也可能兩端都有，不能寫死「學生端」。
// 從報告內容判斷實際是哪一端出問題：
//   - 正常測試失敗／未預期錯誤都會在報告裡留下「❌ 學生端」或「❌ 老師端」開頭的訊息
//     （見 run-tests.js 的 printSummary 總結行、以及各自 catch 區塊的錯誤訊息）
const failedSides = [];
if (/❌\s*學生端/.test(report)) failedSides.push('學生端');
if (/❌\s*老師端/.test(report)) failedSides.push('老師端');
const sidePrefix = failedSides.length > 0 ? failedSides.join(' + ') : '';

const lines = [
  '<@1014888012888412262>',
  `🚨 **產學班實習月記系統｜${sidePrefix}自動化健康檢查失敗**`,
  `結果：${summaryText}`,
  '',
];

if (failedSides.length === 0) {
  lines.push('⚠️ 無法從報告內容判斷是學生端還是老師端失敗（可能在瀏覽器啟動或 session 取得階段就中止），請看完整報告。', '');
}

if (failedDetails.length > 0) {
  lines.push('失敗項目：');
  lines.push(...failedDetails.slice(0, 10)); // Discord 單則訊息長度有限，最多列 10 項
  if (failedDetails.length > 10) lines.push(`...還有 ${failedDetails.length - 10} 項，請看完整報告`);
} else {
  lines.push('（測試以非預期方式中止，沒有產生失敗項目清單，請看完整報告）');
}

if (runUrl) {
  lines.push('', `完整報告與截圖：${runUrl}`);
}

const content = lines.join('\n').slice(0, 1900); // Discord 單則訊息上限約 2000 字元

(async () => {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.error('Discord webhook 回應異常：', res.status, await res.text());
      process.exit(1);
    }
    console.log('✅ Discord 通知已送出');
  } catch (e) {
    console.error('Discord webhook 發送失敗：', e.message);
    process.exit(1);
  }
})();
