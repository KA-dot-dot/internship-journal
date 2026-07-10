/**
 * notify-service/notify-discord.js
 * push-notify.yml（推播通知輪詢，每5分鐘一次）失敗時，推送簡短通知到 Discord webhook。
 *
 * 跟 test-suite/notify-discord.js（Layer 2 canary 專用）是兩支獨立檔案，刻意不共用：
 * canary 那支是解析 Playwright 測試產生的 test-report.txt（「幾項測試通過/失敗」的
 * 結構化摘要），這支服務沒有對應的報告檔可解析——push-notify.yml 就是單純執行
 * send-push-notifications.js 一支腳本，失敗就是這支腳本本身丟出非 0 結束碼（見該檔案
 * 尾端的 process.exit(hadError ? 1 : 0)），沒有「幾項測試」這種摘要可抓，硬套用 canary
 * 那份報告解析邏輯只會生出無意義或錯誤的內容，所以這裡改成簡短固定文字＋連結到本次
 * 執行紀錄，實際失敗原因請人點進去看 log。
 *
 * 只在 GitHub Actions 的 push-notify workflow 失敗時被呼叫
 * （見 .github/workflows/push-notify.yml 的 `推播失敗時推送 Discord 通知` step）。
 * 本機除錯：
 *   set DISCORD_WEBHOOK_URL=你的webhook網址
 *   node notify-discord.js
 */

const webhook = process.env.DISCORD_WEBHOOK_URL;

if (!webhook) {
  console.log('⚠️ 未設定 DISCORD_WEBHOOK_URL，略過通知（請確認 GitHub Secrets 是否已設定）。');
  process.exit(0);
}

const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

// 沿用 canary.yml 那份既有通知會 @ 的同一個 Discord 使用者 ID（同一位維護者）。
// 若這不是正確對象，換成實際要通知的 ID 即可，跟下面其餘邏輯無關。
const lines = [
  '<@1014888012888412262>',
  '🚨 **產學班實習月記系統｜推播通知服務執行失敗**',
  '`push-notify.yml`（每 5 分鐘排程／手動觸發）這次執行失敗，代表這一輪老師評語／學生回覆的推播可能沒有正常送出（下一輪 5 分鐘後才會再試一次，這段期間對方裝置不會收到通知，但不影響 Firestore 資料本身，登入網站仍能正常看到內容）。',
  '',
  '常見原因：Firestore 索引尚未建立（log 裡通常會附一個直接建立索引的連結）、Service Account 憑證（FIREBASE_SERVICE_ACCOUNT_JSON）過期或設定錯誤、`npm test` 這個步驟沒過（代表 notify-logic.js 的時間比較邏輯本身有回歸，不是單純網路問題）、FCM/Firestore 暫時性錯誤等。實際原因請看下方連結的完整 log。',
];

if (runUrl) {
  lines.push('', `完整執行紀錄：${runUrl}`);
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
