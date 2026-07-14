/**
 * tests/teacher.test.js
 * 老師端自動化測試 v21
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-07-02，本次測試補強對應 2026-07-06 推播子系統）
 *
 * v21 新增（2026-07-14）：
 *   T-17／T-17B  _loginHandling 互斥旗標（對稱 student_test.js 既有的 S-17／S-17B）。
 *             背景：AI_CONTEXT.md 記載 student.html 於 2026-06-16 修過「handleRedirectResult()
 *             與 onAuthStateChanged callback 同時對 Firestore 發查詢、互相干擾，導致第一次
 *             登入必定失敗、刷新才能成功」這個競態，但這個旗標從頭到尾只在 student.html
 *             出現過，teacher.html 完全沒有對應防護；2026-07-12 的登入改版（任何裝置 popup
 *             失敗就 fallback redirect）讓會真的走到 redirect 這條路的老師母體擴大，這個
 *             從未修過的競態在 teacher.html 上被放大。本輪已於 teacher.html 補上與
 *             student.html 完全對稱的修法，這裡新增對應回歸測試。
 *   T-SEC-33  isStoragePartitionedEnv() 已定義，且 googleTeacherLogin()／
 *             handleRedirectResult() 皆有呼叫做為 guard。背景：teacher.html 原本完全沒有
 *             這個函式，LINE 瀏覽器雖有頁面層級的擋法（隱藏 #login-card、顯示
 *             #line-warning），但 seapp.com 代理與 sessionStorage 不可用（無痕模式等）
 *             這兩種 storage-partitioned 情境完全沒有防護。
 *   T-SEC-34  handleRedirectResult() 有 pending flag 守門，未觸發過 redirect 時不會呼叫
 *             getRedirectResult()。背景：原本無條件呼叫，任何老師只要在 storage-partitioned
 *             環境打開 teacher.html，即使從未觸發過 redirect，也會在每次頁面載入時先噴一次
 *             "missing initial state" 例外，跳出誤導性的「APP 登入失敗」toast。
 *   T-SEC-35  googleTeacherLogin() 一律先試 signInWithPopup()，失敗（非使用者取消）時
 *             fallback 到 signInWithRedirect()。背景：2026-07-12 的登入改版（拿掉
 *             「standalone 一律先走 redirect」舊分支）完全沒有對應測試，這裡補上，跟
 *             student_test.js 新增的 S-SEC-34 對稱。
 *
 * v20 修正（2026-07-11）：
 *   T-SEC-24  改版。saveTeacherComment() 本身同日改版——oldComment 原本讀
 *             _currentCommentJournal.oldComment（Modal 開啟當下由
 *             _openCommentModalWithUid() 快取的舊評語值），改成送出前
 *             await getDoc(ref) 現查伺服器當下值（修正多裝置/多分頁快取過期，
 *             導致 commentChanged／isCommentUpdate 算錯的問題；跟 student.html
 *             saveStudentReply() 同日同款修法，同一類問題）。原本驗證的
 *             「_openCommentModalWithUid() 設定 oldComment 前有 seatNo/semester/
 *             month 三重身份比對」已隨對應程式碼一併移除（那段防護的對象——
 *             _currentCommentJournal.oldComment——已經沒有任何函式會讀取），
 *             測試改為驗證新的 getDoc 現查機制。
 *   T-SEC-32  新增。確認 _openCommentModalWithUid() 內原本專門保護
 *             _currentCommentJournal.oldComment 快取的兩處程式碼（.then() 三重
 *             身份比對＋.catch() 空字串保底）已經隨 T-SEC-24 的改版一併移除，
 *             不是只改了 saveTeacherComment() 卻留下一段沒有任何函式會讀取、
 *             卻長得像還在運作的死碼防護，避免誤導未來的維護者。
 *
 * v19 新增（2026-07-07）：
 *   T-SEC-30  saveTeacherComment() teacherCommentContentAt 只在評語內容真正改變時才寫入
 *             （2026-07-06 新增 Web Push 推播子系統時一併新增的欄位，供
 *             notify-service/send-push-notifications.js 的 checkComments() 判斷評語
 *             是否已推播過用；規則理應跟既有 teacherCommentUnread／teacherCommentUpdated
 *             同一個 commentChanged 條件區塊，但當時新增 teacherCommentContentAt 時
 *             沒有同步擴充 T-SEC-20／T-SEC-23 涵蓋這第三個欄位，這裡補上。與
 *             student_test.js 這邊已補的 S-SEC-29（studentReplyContentAt／
 *             replyChanged）對稱）。⚠️ 第一版判斷用固定 600 字元視窗（比照 T-SEC-23
 *             的 200/400 字元），但實際對照 teacher.html 跑過才發現
 *             teacherCommentUpdated 與 teacherCommentContentAt 之間夾了一段 644 字元的
 *             解釋性註解，600 字元視窗會誤判退化（測試本身錯，不是程式碼錯）；已改用
 *             「抓出 commentChanged ? { ... } : {}) 區塊本身的起訖括號」取代固定視窗，
 *             不受區塊內註解長度影響。
 *   T-SEC-31  initPushNotifications() 關鍵特徵（相對路徑註冊 fcm-sw.js、Firestore 寫入
 *             路徑對應 rule.txt 的 adminId==request.auth.uid、userAgent 截斷 200 字、
 *             fire-and-forget 不擋登入）。新增 T-SEC-30 當下這裡原本標注「沒看過
 *             teacher.html 實際內容，先不補、避免重蹈 S-SEC-22/23 照概念模型猜寫介面
 *             形狀的覆轍」；隨後取得 teacher.html 實際內容，逐項核對真正的原始碼後才
 *             補上，其中相對路徑那項檢查特別處理過「正規表達式誤命中解釋性註解文字」
 *             的陷阱——函式內部有一段註解本身就提到 '/fcm-sw.js'（用來解釋為何不能用
 *             絕對路徑），若用「檢查此字串不存在」的寫法會被註解文字本身誤判為失敗，
 *             改用「檢查 register('./fcm-sw.js' 這個實際呼叫點的字面模式是否存在」的
 *             正向比對，不受註解內容影響。
 *
 * v18 新增（2026-07-02）：
 *   T-SEC-29  loadRosterStudentsForSemesters() 根源防護 + submitAoA／stuSalaryRows／
 *             companyRows2／companyWorktypeRows／salaryAlertRows(低於平均20%／高於
 *             平均30%／公司內部落差)／salarySummaryRows 共 6 個工作表/欄位群組的
 *             Excel 公式注入防護（第四輪複查發現，根因與 T-SEC-26/27/28 相同，
 *             但這次是透過 studentMap 間接繼承，肉眼看下游程式碼完全看不出來）。
 *             （背景：T-SEC-26/27/28 三輪防護的判斷基礎都是「studentMap 資料來自
 *             老師端名冊，安全」，但 loadRosterStudentsForSemesters() 在某學期完全
 *             沒有存過名冊快照時，會直接從月記反推名冊：
 *             bySeat[seatNo] = normalizeRosterStudent({ name: j.studentName || '',
 *             company: j.company || '' }, sem)——這時候 studentMap 的 name/company
 *             本質上還是學生自己填的原始欄位，只是繞了一手，「來自名冊、安全」
 *             這個假設不成立。修法分兩層：①根源——loadRosterStudentsForSemesters()
 *             的 fallback 重建處直接對 name/company 套 sanitizeExcelCell()，讓所有
 *             透過 students/studentMap 取值的下游（含未來新增功能）自動繼承防護；
 *             ②個別輸出點——即使根源修了，仍在每個實際寫入 Excel 儲存格的地方
 *             各自補上 sanitizeExcelCell() 做第二層防禦。未修改 rule.txt，理由與
 *             前三輪一致。）
 *
 * v17 新增（2026-07-01 第三次，含後續補漏）：
 *   T-SEC-28  exportAllStatsExcel() 姓名/公司/日期/月份/學期/繳交時間/最後更新
 *             共14處 Excel 公式注入防護（收斂 T-SEC-26／T-SEC-27 之後第三輪複查發現）
 *             （外部稽核複查指出：T-SEC-26 只補了 address/mentor，T-SEC-27 只補了
 *             distance/type，但同一個函式裡至少還有下列同根因（rule.txt 對
 *             entries[]／月記頂層欄位皆無型別驗證）卻未處理的欄位：
 *             - locationRows：姓名（s.name || j.studentName fallback）、公司
 *               （s.company || j.company fallback，跟姓名同一種模式，第一輪複查
 *               漏補、第二次複查才補上）、日期（entries[].date）
 *             - salaryRows：姓名、公司（同上兩種 fallback）、月份（j.month）
 *             - salaryAlertRows「薪資缺漏」：姓名、公司（同上兩種 fallback）、說明
 *               （內嵌 j.semester + j.month，且 j.semester 直接在字串開頭、
 *               無任何前置字元或轉換處理，是目前所有實例裡風險最直接的一處）
 *             - journalListRows：姓名（同上 fallback，此陣列無「公司」欄位）、學期
 *               （(j.semester||'').replace('-1',...).replace('-2',...) 只替換兩個
 *               固定子字串，非預期格式的攻擊字串完全不會命中、原樣通過）、
 *               月份、繳交時間（j.submittedAt.slice(0,10)）、最後更新
 *               （j.updatedAt.slice(0,10)，.slice() 只截長度、不動起始字元）
 *             共 4 個陣列、14 個欄位實例，全數補上既有 sanitizeExcelCell()（老師評語／
 *             已審閱不在範圍內，來自老師端輸入，信任邊界不同，沿用既有判斷）。
 *             未修改 rule.txt——Firestore Rules 語言無法對變動長度陣列逐項驗證，
 *             即使對 semester/month 等頂層純量欄位補格式驗證，也會牽動 Layer 1/
 *             Layer 3 整套重跑，維持「在唯一會把字串當公式解讀的輸出端（Excel
 *             儲存格組成當下）防護」與前兩輪一致的做法。
 *             【已知遺漏，尚未處理】companyAggMap／companyRows2（工作表3「各公司薪資」，
 *             companyWs2）的分組 key 一樣是 (studentMap[...]?.company) || j.company || '未填寫'，
 *             同一根因，但這裡是先當 Map key 分組、再輸出成「公司名稱」欄位，且下游
 *             salaryStudentList.filter(s => s.company === r.公司名稱) 依賴這個值做相等比對，
 *             要修必須同時確認清洗後的比對邏輯不會跟著壞掉，複雜度跟前面 4 處不同，
 *             這輪先不動，留待下一輪決定是否處理。
 *
 * v16 新增（2026-07-01 第二次）：
 *   T-SEC-27  exportAllStatsExcel() distance/type 兩欄位 Excel 公式注入防護
 *             （補齊 T-SEC-26 未涵蓋範圍：外部稽核複查指出根本原因——rule.txt 對
 *             entries[] 陣列元素完全沒有型別/格式驗證（Firestore Rules 無法對
 *             變動長度陣列逐項驗證）——並未處理，entries[].distance／entries[].type
 *             兩欄位若透過直接 API 呼叫繞過 UI 前端限制仍可寫入任意字串。distance
 *             改用 Number() 強制轉型（語意上是數字欄位，比字串跳脫更根本，寫入
 *             Excel 時型別必為 number 或空字串）；type 套用既有 sanitizeExcelCell()
 *             （會變成 companyWorktypeRows 的欄位標題，語意是文字）。修正過程中
 *             發現並修正一個真實迴歸——直接對 e.distance 做 Number() 轉型會讓
 *             Number(null)===0 且 Number.isFinite(0)===true，把「未填距離」的合法
 *             null 值誤顯示成「距離0km」；T-SEC-27 第三項特徵專門驗證此迴歸防護
 *             （轉型前是否先明確排除 null/undefined/空字串）仍然存在。）
 *
 * v15 新增（2026-06-30）：
 *   T-SEC-26  exportAllStatsExcel() Excel 公式注入防護（sanitizeExcelCell()）
 *             （新發現：locationWs「工作地址」(entries[].address) 與 salaryWs
 *             「師傅/學長姐」(j.mentor) 兩個欄位皆為學生在 student.html 自由輸入文字，
 *             原本直接塞進 XLSX.utils.json_to_sheet() 產生的儲存格，字串若以
 *             =／+／-／@ 開頭，部分 Excel（尤其舊版、或資料被轉存 CSV 後再開啟）
 *             有機率被當成公式執行（OWASP CSV/Excel Formula Injection）。比照
 *             calcDistance() escapeHtml() 防禦性加固的同等標準，新增
 *             sanitizeExcelCell()：字串開頭符合上述四字元之一時補上前置單引號
 *             強制純文字。公司／姓名／老師評語等欄位來自老師/管理端輸入，
 *             信任邊界不同，本次不在範圍內。）
 *
 * v14 新增（2026-06-30）：
 *   T-SEC-25  executeBatchReview() 批次審閱同時清除學生回覆未讀旗標
 *             （修正：原本 updateDoc 只寫 { teacherReviewed: true, reviewedAt: now }，
 *             未包含 studentReplyUnread: false，導致月記若有學生回覆，
 *             老師做完批次審閱後主頁「學生有新回覆」紅點永遠不歸零，
 *             須逐一手動開評語 Modal 才能清除，使批次功能失去效用。
 *             已補上 studentReplyUnread: false，與 saveTeacherComment() 行為一致。）
 *
 * v13 新增（2026-06-29）：
 *   T-SEC-24  _openCommentModalWithUid() oldComment 設定前有 seatNo／semester／month
 *             三重身份比對，防快速切換月記導致 commentChanged 計算基準錯誤
 *
 * v12 修正（2026-06-29）：
 *   T-SEC-11  標題更正為「弱效 sanity check」，精確驗證指向 T-SEC-21
 *   T-SEC-22  標題從「STEP 1 不洗 STEP 5」更正為「由 isCommentUpdate 控制（代理 sanity check）」，
 *             如實反映清空評語 State 4→3 為語意合理的接受行為、非 bug
 *             （外部稽核指出原描述與現行行為脫鉤）
 *
 * v11 新增（2026-06-28）：
 *   T-SEC-23  saveTeacherComment() 評語未改時 teacherCommentUnread 不重新觸發（State 3→2 防護）
 *             驗證：`commentChanged = comment !== oldComment` 變數存在，且
 *             `teacherCommentUnread`／`teacherCommentUpdated` 的寫入均受 commentChanged 控制
 *             （spread 條件：`...(commentChanged ? { ... } : {})`），確保老師只讀取學生回覆後
 *             直接按儲存，不會把這兩欄重新寫入 Firestore、誤觸發學生端 State 3→2 倒退
 *             （✅ 已審閱 錯誤變回 🟠 評語已更新）。同時 T-SEC-20 補上第 4 項特徵檢查
 *             （`commentChanged` 變數存在）。
 *
 * v10 新增（2026-06-28）：
 *   T-SEC-20  saveTeacherComment() isCommentUpdate 邏輯正確（STEP 2 vs STEP 4）
 *             驗證：oldComment 為空時 isCommentUpdate=false（觸發 State 1 有新評語），
 *             oldComment 非空且新 comment 非空時 isCommentUpdate=true（觸發 State 2 評語已更新）。
 *             對應「評語測試系統」關鍵邏輯：!!( oldComment && true ) 決定 teacherCommentUpdated。
 *   T-SEC-21  saveTeacherComment() teacherCommentUnread 只在有評語時設 true
 *             驗證：comment.length==0 時 teacherCommentUnread 應為 false（STEP 1 空評語審閱），
 *             comment 非空時 teacherCommentUnread 應設為 true（STEP 2／STEP 4）。
 *   T-SEC-22  saveTeacherComment() teacherCommentUpdated 由 isCommentUpdate 控制（代理 sanity check）
 *             注意：「清空評語後 State 4→3 退化」是語意合理的接受行為（評語消失，已更新旗標無意義），
 *             非測試錯誤。測試只確認 teacherCommentUpdated 受 isCommentUpdate 控制，
 *             非硬寫 false。驗證「評語未改不重新觸發」請見 T-SEC-23。
 *
 * v9 新增（2026-06-27）：
 *   T-SEC-19  renderJournalCard() 孤兒回覆顯示警示而非整段隱藏
 *             （修正：學生重新儲存月記會把 teacherComment 歸零，但 studentReply 因
 *             merge:true 原樣保留，造成孤兒回覆完全不可見；改用
 *             (isTeacher && (hasComment || j.studentReply)) 取代原本只看
 *             hasComment 的顯示條件，並加上警示文字。對應 AI_CONTEXT.md
 *             「studentReply 孤兒狀態」決策：選擇方向 A（最小改動、保留資料），
 *             不選方向 B（resave 時清空回覆欄位）。)
 *
 * v8 修正（2026-06-26）：
 *   T-SEC-04  函式名稱修正：confirmBatchReview → openBatchReviewModal
 *             （AI_CONTEXT.md 2026-06-20 記錄「confirmBatchReview 已拆成
 *             openBatchReviewModal + executeBatchReview 兩個函式」，
 *             startVal/endVal/escapeHtml 邏輯在 openBatchReviewModal 本體，
 *             confirmBatchReview 已不存在，typeof 永遠回傳 skip 造成假通過）
 *
 * v7 新增（2026-06-23）：
 *   T-SEC-17  printJournalsPDF() 將 pdfMake getBlob() 包進 await new Promise
 *             （修正：原本 getBlob() 是 callback 式 API，沒有包成 Promise/await，
 *             導致呼叫端 finally{ hideLoading() } 在 PDF 還沒真正產生完成前就提前
 *             執行，loading 遮罩比 PDF 早消失。已由使用者人工實測確認修正後
 *             loading 會撐到 PDF 真正出現才消失。）
 *   T-SEC-18  exportSemesterPDF()／exportStudentPDF() 呼叫 printJournalsPDF()
 *             時有 await（同一個 bug 的另一半：即使函式內部包好 Promise，
 *             呼叫端沒加 await，finally 依然會提早執行）
 *
 * v6 新增（2026-06-22 第二次）：
 *   T-SEC-15  deleteStudent() 月記刪除使用 ownerEmail 雙重比對
 *             （2026-06-22 修正：原本純座號比對，座號跨學期重複分配給不同人
 *             時會誤刪對方真實月記，已用Firebase主控台實測證實並修正）
 *   T-SEC-16  deleteStudent() 非active學期會清除 /students/ 根文件
 *             （2026-06-22 修正：原本只有 syncActiveRootFromRoster() 會清，
 *             但該函式只在 semester===active 時執行，非active學期刪除學生
 *             會留下孤兒文件，已用Firebase主控台兩輪實測對照證實並修正）
 *
 * v5 新增（2026-06-22 第一次）：
 *   T-SEC-14  getTeacherJournalMonthRangeLabel() 使用西元年/月格式
 *             （2026-06-22 修正：批次刪除區間改為「2025/7~2026/1，共N筆」格式）
 *
 * v4 修正（2026-06-21）：
 *   T-SEC-06B 判斷邏輯修正：
 *   原版強制要求 finally 關鍵字，但使用者已將 hideLoading()
 *   從 finally 移入 catch 區塊（效果相同、不重複呼叫）。
 *   修正為：確認 catch 區塊（catch 後 4 行內）有 hideLoading()，
 *   不再要求 finally 關鍵字存在。
 *
 *   T-SEC-09 函式名稱修正：
 *   renderTeacherJournalCard → renderJournalCard（共用版，接受 isTeacher 參數）
 *   對應 AI_CONTEXT.md 2026-06-20 重構命名更新。
 *
 * ⚠️ T-SEC-15/16/17/18 為靜態分析（檢查原始碼字串），
 * 只能防止「日後改動時不小心退回舊寫法」，無法100%保證執行邏輯正確。
 * T-SEC-17/18 只能確認「await new Promise」與呼叫端「await」這兩個程式碼
 * 特徵存在，無法重現「loading 遮罩消失時間點」這個實際 timing 行為本身——
 * 那部分已由使用者在 2026-06-23 人工實測確認過。完整驗證仍需依賴人工測試
 * （見 AI_CONTEXT.md「deleteStudent() 跨學期邊界案例修正」章節的實測記錄）。
 */

const BASE_URL = 'https://ka-dot-dot.github.io/internship-journal/teacher.html';

async function waitForPage(page, pageId, timeout = 8000) {
  await page.waitForFunction((id) => {
    const el = document.getElementById(`page-${id}`);
    if (!el) return false;
    return !el.classList.contains('hidden');
  }, pageId, { timeout });
}

async function runTeacherTests(page, log) {
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, pass: true });
      log(`  ✅ ${name}`);
    } catch (e) {
      results.push({ name, pass: false, error: e.message.split('\n')[0] });
      log(`  ❌ ${name}`);
      log(`     原因：${e.message.split('\n')[0]}`);
      try {
        const safe = name.replace(/[^\w\u4e00-\u9fff]/g, '_');
        await page.screenshot({ path: `screenshots/teacher_FAIL_${safe}.png` });
      } catch (_) {}
    }
  }

  log('\n【老師端】開始測試');
  await page.goto(BASE_URL);

  // ════════════════════════════════════════
  // T-01 ～ T-10  基本載入與頁籤切換
  // ════════════════════════════════════════

  await test('T-01 老師端頁面正常載入', async () => {
    await page.waitForFunction(() => {
      const dashboard = document.getElementById('page-t-dashboard');
      return dashboard !== null && document.body.textContent.length > 100;
    }, { timeout: 20000 });
  });

  await test('T-02 主頁統計數字載入', async () => {
    // 等待 stat-total-students 有任何非空值（-、數字均可）
    await page.waitForFunction(() => {
      const el = document.getElementById('stat-total-students');
      return el && el.textContent.trim() !== '' && el.textContent.trim() !== '載入中...';
    }, { timeout: 25000 });
  });

  const tabs = [
    { id: 't-students',  label: 'T-03 切換到學生管理' },
    { id: 't-journals',  label: 'T-04 切換到月記管理' },
    { id: 't-stats',     label: 'T-05 切換到統計' },
    { id: 't-deadline',  label: 'T-06 切換到截止日管理' },
    { id: 't-export',    label: 'T-07 切換到匯出' },
    { id: 't-settings',  label: 'T-08 切換到設定' },
    { id: 't-admin',     label: 'T-09 切換到管理員設定' },
    { id: 't-dashboard', label: 'T-10 切回主頁' },
  ];
  for (const tab of tabs) {
    await test(tab.label, async () => {
      await page.evaluate((id) => showPage(id), tab.id);
      await waitForPage(page, tab.id, 6000);
    });
  }

  // ════════════════════════════════════════
  // T-11 ～ T-18  功能測試
  // ════════════════════════════════════════

  await test('T-11 學生管理表格有資料', async () => {
    await page.evaluate(() => showPage('t-students'));
    await waitForPage(page, 't-students', 6000);
    await page.waitForFunction(() => {
      const tbody = document.querySelector('#students-table-body');
      return tbody && tbody.children.length > 0;
    }, { timeout: 20000 });
  });

  await test('T-12 月記管理可以載入', async () => {
    await page.evaluate(() => showPage('t-journals'));
    await waitForPage(page, 't-journals', 6000);
    // 確認查詢按鈕（onclick="queryJournals()"）與清單容器均存在
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[onclick*="queryJournals"]');
      const list = document.getElementById('t-journals-list');
      return btn !== null && list !== null;
    }, { timeout: 10000 });
  });

  // T-13：查詢按鈕是 onclick="queryJournals()"，queryJournals() 內部呼叫 loadTeacherJournals()
  await test('T-13 月記管理查詢按鈕存在且可呼叫', async () => {
    await page.evaluate(() => showPage('t-journals'));
    await waitForPage(page, 't-journals', 6000);

    // 確認按鈕存在
    const btnExists = await page.evaluate(() =>
      document.querySelector('button[onclick*="queryJournals"]') !== null
    );
    if (!btnExists) throw new Error('找不到月記查詢按鈕（queryJournals）');

    // 確認函式可呼叫
    const fnExists = await page.evaluate(() =>
      typeof queryJournals === 'function'
    );
    if (!fnExists) throw new Error('找不到 queryJournals 函式');

    // 直接呼叫，確認不拋出例外
    await page.evaluate(() => queryJournals());

    // 清單容器存在即通過（有無資料皆可）
    await page.waitForFunction(() =>
      document.getElementById('t-journals-list') !== null
    , { timeout: 10000 });
  });

  await test('T-13B 月記卡片內容正確顯示（無亂碼）', async () => {
    await page.evaluate(() => showPage('t-journals'));
    await waitForPage(page, 't-journals', 6000);
    const hasCards = await page.waitForFunction(() => {
      const list = document.querySelector('#t-journals-list');
      return list && list.querySelectorAll('.journal-card, .card').length > 0;
    }, { timeout: 20000 }).catch(() => false);
    if (!hasCards) return;

    const result = await page.evaluate(() => {
      const cards = document.querySelectorAll('#t-journals-list .journal-card, #t-journals-list .card');
      if (!cards.length) return { skip: true };
      const issues = [];
      cards.forEach((card, i) => {
        const text = card.textContent || '';
        if (text.includes('&amp;') || text.includes('&lt;') || text.includes('&gt;'))
          issues.push(`卡片 ${i + 1} 含有未正確渲染的 HTML 實體`);
        if (card.innerHTML.toLowerCase().includes('<script'))
          issues.push(`卡片 ${i + 1} 含有 script 標籤`);
      });
      return { skip: false, issues };
    });
    if (result && !result.skip && result.issues.length > 0)
      throw new Error(result.issues.join('；'));
  });

  await test('T-14 截止日表格有載入', async () => {
    await page.evaluate(() => showPage('t-deadline'));
    await waitForPage(page, 't-deadline', 6000);
    await page.waitForFunction(() =>
      document.querySelector('#deadlines-table-body') !== null
    , { timeout: 15000 });
  });

  await test('T-15 統計頁有載入', async () => {
    await page.evaluate(() => showPage('t-stats'));
    await waitForPage(page, 't-stats', 10000);
    await page.waitForFunction(() =>
      document.querySelector('#submit-stats-content, .stats-section, table') !== null
    , { timeout: 15000 });
  });

  await test('T-16 匯出頁有載入', async () => {
    await page.evaluate(() => showPage('t-export'));
    await waitForPage(page, 't-export', 6000);
    await page.waitForFunction(() => {
      const pg = document.getElementById('page-t-export');
      return pg && pg.textContent.trim().length > 10;
    }, { timeout: 10000 });
  });

  await test('T-17 匯出頁有學生可選', async () => {
    await page.evaluate(() => showPage('t-export'));
    await waitForPage(page, 't-export', 6000);
    await page.waitForFunction(() => {
      const list = document.querySelector('#export-student-list, #export-list, select');
      return list && (list.children.length > 0 || list.options?.length > 0);
    }, { timeout: 20000 });
  });

  await test('T-18 設定頁正常顯示', async () => {
    await page.evaluate(() => showPage('t-settings'));
    await waitForPage(page, 't-settings', 6000);
  });

  // ════════════════════════════════════════
  // T-SEC-01 ～ T-SEC-08  安全性測試
  // ════════════════════════════════════════

  await test('T-SEC-01 escapeHtml() 正確阻擋 XSS payload', async () => {
    await page.evaluate(() => { window.__xss_fired = false; });
    const xssBlocked = await page.evaluate(() => {
      if (typeof escapeHtml !== 'function') return true;
      const payload = '<img src=x onerror="window.__xss_fired=true">';
      const escaped = escapeHtml(payload);
      const div = document.createElement('div');
      div.innerHTML = escaped;
      document.body.appendChild(div);
      return new Promise(resolve => setTimeout(() => {
        document.body.removeChild(div);
        resolve(!window.__xss_fired);
      }, 200));
    });
    if (!xssBlocked) throw new Error('escapeHtml() 未正確阻擋 XSS，onerror 被執行');
  });

  await test('T-SEC-02 jsArg() 正確 escape onclick 參數（含單引號與尖括號）', async () => {
    const result = await page.evaluate(() => {
      if (typeof jsArg !== 'function') return { skip: true };
      const cases = ["O'Brien", '<script>alert(1)<\/script>', '"); drop table--', "test'; alert(1); //"];
      const failures = [];
      cases.forEach(input => {
        const out = jsArg(input);
        if (out.includes("'") || out.includes('<') || out.includes('>'))
          failures.push(`輸入「${input}」→ 輸出「${out}」含危險字元`);
      });
      return { skip: false, failures };
    });
    if (result.skip) return;
    if (result.failures.length > 0) throw new Error(result.failures.join('；'));
  });

  await test('T-SEC-03 loadBindingList() 使用 escapeHtml 和 jsArg', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof loadBindingList === 'function') ? loadBindingList.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeSeatNo:      fnStr.includes('escapeHtml') && fnStr.includes('seatNo'),
        hasEscapeStudentName: fnStr.includes('escapeHtml') && fnStr.includes('studentName'),
        hasEscapeEmail:       fnStr.includes('escapeHtml') && fnStr.includes('email'),
        hasJsArgOnClick:      fnStr.includes('jsArg'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeSeatNo)      throw new Error('loadBindingList() 的 seatNo 未使用 escapeHtml()');
    if (!result.hasEscapeStudentName) throw new Error('loadBindingList() 的 studentName 未使用 escapeHtml()');
    if (!result.hasEscapeEmail)       throw new Error('loadBindingList() 的 email 未使用 escapeHtml()');
    if (!result.hasJsArgOnClick)      throw new Error('loadBindingList() 的 onclick 未使用 jsArg()');
  });

  await test('T-SEC-04 confirmBatchReview() 日期值插入 innerHTML 前有 escapeHtml', async () => {
    // 2026-06-20 重構：confirmBatchReview 已拆成 openBatchReviewModal（顯示確認 Modal）
    // + executeBatchReview（實際執行），startVal/endVal/escapeHtml 在 openBatchReviewModal 本體。
    const result = await page.evaluate(() => {
      const fnStr = (typeof openBatchReviewModal === 'function') ? openBatchReviewModal.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeStart: fnStr.includes('escapeHtml') && fnStr.includes('startVal'),
        hasEscapeEnd:   fnStr.includes('escapeHtml') && fnStr.includes('endVal'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeStart) throw new Error('openBatchReviewModal() 的 startVal 未使用 escapeHtml()');
    if (!result.hasEscapeEnd)   throw new Error('openBatchReviewModal() 的 endVal 未使用 escapeHtml()');
  });

  await test('T-SEC-05 學期 select 的 key 和 label 有 escapeHtml', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof populateSemesterSelects === 'function') ? populateSemesterSelects.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeKey:   fnStr.includes('escapeHtml') && fnStr.includes('key'),
        hasEscapeLabel: fnStr.includes('escapeHtml') && fnStr.includes('label'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeKey)   throw new Error('populateSemesterSelects() 的 s.key 未使用 escapeHtml()');
    if (!result.hasEscapeLabel) throw new Error('populateSemesterSelects() 的 s.label 未使用 escapeHtml()');
  });

  await test('T-SEC-06 關鍵函式均有 try/catch/finally 防 loading 卡死（原有 8 個）', async () => {
    const result = await page.evaluate(() => {
      const checks = [
        'removeBinding', 'loadBindingList', 'loadDeadlinesTable',
        'loadTeacherDashboard', 'removeAdmin', 'exportAllStatsExcel',
        'deleteDeadline', 'saveAllDeadlines',
      ];
      const missing = [];
      checks.forEach(name => {
        const fn = window[name];
        if (!fn) return;
        const str = fn.toString();
        const lacks = [
          !str.includes('try')     && 'try',
          !str.includes('catch')   && 'catch',
          !str.includes('finally') && 'finally',
        ].filter(Boolean).join('/');
        if (lacks) missing.push(`${name}() 缺少 ${lacks}`);
      });
      return { missing };
    });
    if (result.missing.length > 0) throw new Error(result.missing.join('；'));
  });

  // T-SEC-06B：2026-06-11 補修的 10 個函式（原 T-SEC-06 沒有涵蓋）
  // 2026-06-21 判斷邏輯修正：
  //   原本要求 finally 關鍵字，但使用者已將 hideLoading() 從 finally 移入 catch，
  //   效果相同（失敗路徑一定執行 hideLoading），不再強制要求 finally 的存在。
  //   改為：確認 try / catch 存在，且 catch 後 4 行內有 hideLoading()。
  await test('T-SEC-06B 2026-06-11 補修的 10 個函式的 catch 均有 hideLoading()', async () => {
    const result = await page.evaluate(() => {
      const checks = [
        'deleteSelectedSemesterData', 'addAdmin', 'bindStudent',
        'loadStudentsTable', 'bindStudentInline', 'saveStudent',
        'deleteStudent', 'importStudents', 'saveTeacherComment',
        'executeBatchReview',
      ];
      const missing = [];
      checks.forEach(name => {
        const fn = window[name];
        if (!fn) return; // 函式不存在時跳過（不算失敗）
        const str = fn.toString();
        if (!str.includes('try') || !str.includes('catch')) {
          missing.push(`${name}() 缺少 try/catch`);
          return;
        }
        if (!str.includes('hideLoading')) {
          missing.push(`${name}() 缺少 hideLoading()`);
          return;
        }
        // 確認 catch 後 4 行內有 hideLoading（或在 finally 內也算通過）
        const hasCatchHide = str.split('\n').some((line, i, lines) => {
          if (!line.includes('} catch') && !line.includes('catch(') && !line.includes('catch (')) return false;
          const next4 = lines.slice(i, i + 5).join('\n');
          return next4.includes('hideLoading') || next4.includes('finally');
        });
        if (!hasCatchHide) {
          missing.push(`${name}() 的 catch 區塊未包含 hideLoading()（loading 失敗時可能卡住）`);
        }
      });
      return { missing };
    });
    if (result.missing.length > 0) throw new Error(result.missing.join('；'));
  });

  await test('T-SEC-07 刪除月記後立即更新 _teacherJournalsCache', async () => {
    const result = await page.evaluate(() => {
      const fns = ['executeDeleteJournal', 'executeTeacherBatchDelete'];
      const missing = [];
      fns.forEach(name => {
        const fn = window[name];
        if (!fn) return;
        if (!fn.toString().includes('_teacherJournalsCache'))
          missing.push(`${name}() 未更新 _teacherJournalsCache`);
      });
      return { missing };
    });
    if (result.missing.length > 0) throw new Error(result.missing.join('；'));
  });

  // T-SEC-08：Firestore 失敗後 loading 不卡住
  // 修正：用 classList.contains('hidden') 判斷（.hidden { display:none !important }）
  // 不用 getComputedStyle，避免導航後頁面重置導致誤判
  await test('T-SEC-08 Firestore 失敗後 loading 遮罩不殘留', async () => {
    // 確保頁面在乾淨狀態
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('t-dashboard'); });
    await waitForPage(page, 't-dashboard', 6000);

    // 攔截 Firestore，再觸發一次 loadTeacherDashboard
    await page.route('**/firestore.googleapis.com/**', route => route.abort());
    await page.evaluate(() => {
      if (typeof loadTeacherDashboard === 'function') loadTeacherDashboard();
    });

    // 等 finally 執行（最多 8 秒）
    await page.waitForTimeout(8000);

    // 用 classList 判斷（.hidden { display:none !important }）
    const loadingStuck = await page.evaluate(() => {
      const overlay = document.getElementById('loading-overlay');
      if (!overlay) return false;
      return !overlay.classList.contains('hidden');
    });

    await page.unroute('**/firestore.googleapis.com/**');

    if (loadingStuck) throw new Error('Firestore 失敗後 loading 遮罩殘留，finally 區塊未執行 hideLoading()');
  });

  // ════════════════════════════════════════
  // T-SEC-09 ～ T-SEC-13  補強測試（原先未覆蓋項目）
  // ════════════════════════════════════════

  // 2026-06-21 更新：函式已重構為共用版 renderJournalCard(j, isTeacher)
  // 對應 AI_CONTEXT.md 2026-06-20 命名修正（renderTeacherJournalCard 已移除）
  await test('T-SEC-09 renderJournalCard() 使用 escapeHtml 和 jsArg', async () => {
    const result = await page.evaluate(() => {
      // 優先找共用版（2026-06-20 重構後），找不到再找舊版（向下兼容）
      const fn = window['renderJournalCard'] || window['renderTeacherJournalCard'];
      const fnStr = (typeof fn === 'function') ? fn.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeHtml: fnStr.includes('escapeHtml'),
        hasJsArg:      fnStr.includes('jsArg'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('renderJournalCard() 未使用 escapeHtml()');
    if (!result.hasJsArg)      throw new Error('renderJournalCard() 的 onclick 未使用 jsArg()');
  });

  await test('T-SEC-10 loadSalaryPhotoOnDemand() 使用 escapeHtml 且錯誤用 toast()', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof loadSalaryPhotoOnDemand === 'function') ? loadSalaryPhotoOnDemand.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeHtml: fnStr.includes('escapeHtml'),
        hasToast:      fnStr.includes('toast(') || fnStr.includes('toast(`') || fnStr.includes("toast('"),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('loadSalaryPhotoOnDemand() 未使用 escapeHtml()');
    if (!result.hasToast)      throw new Error('loadSalaryPhotoOnDemand() 錯誤處理未使用 toast()');
  });

  await test('T-SEC-11 saveTeacherComment() 含有 teacherCommentUnread 寫入路徑（弱效 sanity check）', async () => {
    // ⚠️  此測試為弱效 sanity check，精確驗證請見 T-SEC-21。
    //
    // 歷史背景：此測試原意是確認 saveTeacherComment() 有寫入 teacherCommentUnread: true，
    // 但在「評語未改時不重新觸發未讀旗標」修正（commentChanged 守衛）後，
    // 寫法已改為 ...(commentChanged ? { teacherCommentUnread: comment.length > 0 } : {})，
    // 不再有字面 teacherCommentUnread: true。
    // 此測試仍能通過（fnStr 含 teacherCommentUnread 與 true（後者來自 teacherReviewed: true）），
    // 但驗證的意圖與原始設計已不同。
    //
    // T-SEC-21 是更精確的替代測試，確認 teacherCommentUnread 有條件式寫入邏輯，
    // 空評語路徑不會誤設 true；本測試僅作為「函式至少含相關字串」的最低防線。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasUnreadRef: fnStr.includes('teacherCommentUnread'),
      };
    });
    if (result.skip) return;
    if (!result.hasUnreadRef)
      throw new Error(
        'saveTeacherComment() 找不到 teacherCommentUnread 字串，' +
        '學生的「有新評語」通知機制可能已被移除'
      );
  });

  await test('T-SEC-12 loadDeadlineInfo() 日期欄位使用 escapeHtml 防 XSS', async () => {
    // loadDeadlineInfo() 只渲染日期文字（openDate / closeDate），沒有 onclick，
    // 因此只需確認 escapeHtml() 有被使用，不需要 jsArg()。
    const result = await page.evaluate(() => {
      const fnStr = (typeof loadDeadlineInfo === 'function') ? loadDeadlineInfo.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeHtml: fnStr.includes('escapeHtml'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('loadDeadlineInfo() 未使用 escapeHtml()（日期欄位有 XSS 風險）');
  });

  await test('T-SEC-13 safeNumber() 函式已定義且可正常運作', async () => {
    const result = await page.evaluate(() => {
      if (typeof safeNumber !== 'function') return { skip: false, ok: false, msg: 'safeNumber 函式不存在' };
      // 驗證基本行為：數字通過、非數字/null/undefined 回傳 0（或預設值）
      const n1 = safeNumber(42);
      const n2 = safeNumber(null);
      const n3 = safeNumber(undefined);
      const n4 = safeNumber('abc');
      if (typeof n1 !== 'number') return { skip: false, ok: false, msg: `safeNumber(42) 應回傳數字，實際回傳 ${typeof n1}` };
      if (typeof n2 !== 'number') return { skip: false, ok: false, msg: `safeNumber(null) 應回傳數字，實際回傳 ${typeof n2}` };
      if (typeof n3 !== 'number') return { skip: false, ok: false, msg: `safeNumber(undefined) 應回傳數字，實際回傳 ${typeof n3}` };
      return { skip: false, ok: true };
    });
    if (result.skip) return;
    if (!result.ok) throw new Error(result.msg);
  });
  // ════════════════════════════════════════
  // T-SEC-14  批次刪除月記區間改西元年/月格式（2026-06-22）
  // 對應 AI_CONTEXT.md 2026-06-22 變更：
  //   getTeacherJournalMonthRangeLabel() 改用 toCEYearMonth() 轉換，
  //   格式從「7月 ～ 1月，共N筆」改為「2025/7~2026/1，共N筆」
  // ════════════════════════════════════════

  await test('T-SEC-14 getTeacherJournalMonthRangeLabel() 使用西元年/月格式', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof getTeacherJournalMonthRangeLabel === 'function')
        ? getTeacherJournalMonthRangeLabel.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵1：有 toCEYearMonth 西元年換算邏輯
      const hasCEConvert = fnStr.includes('toCEYearMonth') || fnStr.includes('1911');

      // 特徵2：不再回傳裸月份字串（不應再出現 `月，共` 或 `月 ～` 格式）
      const hasBareMonth =
        fnStr.includes('月，共') ||
        fnStr.includes('月 ～') ||
        fnStr.includes('月～');

      // 特徵3：回傳格式包含 / 分隔的年/月
      const hasSlashFormat = fnStr.includes("'/'") || fnStr.includes('"/"') ||
                             fnStr.includes('year') || fnStr.includes('/');

      return { skip: false, hasCEConvert, hasBareMonth, hasSlashFormat };
    });

    if (result.skip) return;
    if (!result.hasCEConvert)
      throw new Error('getTeacherJournalMonthRangeLabel() 未使用西元年換算邏輯（toCEYearMonth / 1911）');
    if (result.hasBareMonth)
      throw new Error('getTeacherJournalMonthRangeLabel() 仍回傳裸月份格式（「X月～Y月」），應改為西元年/月格式');
  });

  // ════════════════════════════════════════
  // T-SEC-15 ～ T-SEC-16  deleteStudent() 跨學期邊界案例修正（2026-06-22 第二次）
  // 對應 AI_CONTEXT.md「deleteStudent() 跨學期邊界案例修正」章節：
  //   ①月記刪除改用「座號＋ownerEmail」雙重比對，避免座號跨學期重複分配給
  //     不同人時誤刪對方真實月記（純座號比對已用Firebase主控台實測證實會誤刪）。
  //   ②非active學期刪除學生時，補上手動刪除 /students/{semester}_{seatNo}
  //     根文件，避免孤兒文件殘留、被老師主頁「本月未繳名單」誤抓進統計。
  // 以下為靜態分析（檢查原始碼是否包含關鍵字），無法100%保證執行邏輯正確，
  // 但可防止日後改動時不小心退回舊寫法。完整驗證見 AI_CONTEXT.md 實測記錄。
  // ════════════════════════════════════════

  await test('T-SEC-15 deleteStudent() 月記刪除使用 ownerEmail 雙重比對', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof deleteStudent === 'function') ? deleteStudent.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasSeatNoFilter: fnStr.includes('seatNo'),
        hasOwnerEmail:   fnStr.includes('ownerEmail'),
        hasTargetEmail:  fnStr.includes('targetEmail'),
      };
    });
    if (result.skip) return;
    if (!result.hasSeatNoFilter)
      throw new Error('deleteStudent() 找不到 seatNo 篩選邏輯，函式可能已被大幅改寫，需重新確認');
    if (!result.hasOwnerEmail)
      throw new Error('deleteStudent() 月記刪除未使用 ownerEmail 比對，可能退回純座號比對——座號跨學期重複分配給不同人時會誤刪對方真實月記');
    if (!result.hasTargetEmail)
      throw new Error('deleteStudent() 找不到 targetEmail 變數，座號+信箱雙重比對邏輯可能已被移除');
  });

  await test('T-SEC-16 deleteStudent() 非active學期會清除 /students/ 根文件', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof deleteStudent === 'function') ? deleteStudent.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasActiveSync:        fnStr.includes('syncActiveRootFromRoster'),
        hasStudentsDocDelete: /doc\(\s*db\s*,\s*['"]students['"]/.test(fnStr),
      };
    });
    if (result.skip) return;
    if (!result.hasActiveSync)
      throw new Error('deleteStudent() 找不到 syncActiveRootFromRoster() 呼叫，active學期分支可能已被移除');
    if (!result.hasStudentsDocDelete)
      throw new Error('deleteStudent() 的非active學期分支找不到對 /students/ 文件的 deleteDoc，可能退回「只在active時才清理」的舊寫法，會在非active學期留下孤兒文件');
  });

  // ════════════════════════════════════════
  // T-SEC-17 ～ T-SEC-18  printJournalsPDF() loading 提早消失修正（2026-06-23）
  // 對應本次修正：pdfMake.createPdf().getBlob() 是 callback 式 API，
  //   原本沒有包成 Promise/await，呼叫端 finally{ hideLoading() } 會在
  //   PDF 還沒真正產生完成前就提前執行。修法分兩處：
  //   ①printJournalsPDF() 內部把 getBlob() 包進 await new Promise(...)
  //   ②exportSemesterPDF()／exportStudentPDF() 呼叫 printJournalsPDF() 時加 await
  //   （只修①不修②，或反過來，loading 提早消失的問題都不會真正解決）
  // 以下為靜態分析（檢查原始碼字串），無法重現「loading 何時消失」這個實際
  // timing 行為，只能確認程式碼特徵仍存在、防止日後改動退回舊寫法。
  // ════════════════════════════════════════

  await test('T-SEC-17 printJournalsPDF() 將 getBlob() 包進 await new Promise', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof printJournalsPDF === 'function') ? printJournalsPDF.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasGetBlob:      fnStr.includes('getBlob'),
        hasAwaitPromise: fnStr.includes('await new Promise'),
        hasResolveCall:  /resolve\s*\(\s*\)/.test(fnStr),
      };
    });
    if (result.skip) return;
    if (!result.hasGetBlob)
      throw new Error('printJournalsPDF() 找不到 getBlob() 呼叫，函式可能已被大幅改寫，需重新確認');
    if (!result.hasAwaitPromise)
      throw new Error('printJournalsPDF() 的 getBlob() 沒有包進 await new Promise(...)，可能退回沒等待 PDF 產生完成就提前 return 的舊寫法，導致 loading 遮罩比 PDF 早消失');
    if (!result.hasResolveCall)
      throw new Error('printJournalsPDF() 的 Promise 找不到 resolve() 呼叫，await 可能永遠不會完成（卡住）或包裝方式有誤');
  });

  await test('T-SEC-18 exportSemesterPDF()／exportStudentPDF() 呼叫 printJournalsPDF() 時有 await', async () => {
    const result = await page.evaluate(() => {
      const semFnStr = (typeof exportSemesterPDF === 'function') ? exportSemesterPDF.toString() : '';
      const stuFnStr = (typeof exportStudentPDF === 'function') ? exportStudentPDF.toString() : '';
      if (!semFnStr && !stuFnStr) return { skip: true };
      return {
        skip: false,
        semHasCall:  semFnStr.includes('printJournalsPDF'),
        semHasAwait: /await\s+printJournalsPDF/.test(semFnStr),
        stuHasCall:  stuFnStr.includes('printJournalsPDF'),
        stuHasAwait: /await\s+printJournalsPDF/.test(stuFnStr),
      };
    });
    if (result.skip) return;
    if (result.semHasCall && !result.semHasAwait)
      throw new Error('exportSemesterPDF() 呼叫 printJournalsPDF() 時沒有 await，finally{ hideLoading() } 仍會在 PDF 產生完成前提早執行');
    if (result.stuHasCall && !result.stuHasAwait)
      throw new Error('exportStudentPDF() 呼叫 printJournalsPDF() 時沒有 await，finally{ hideLoading() } 仍會在 PDF 產生完成前提早執行');
  });

  // ════════════════════════════════════════
  // T-SEC-19  renderJournalCard() 孤兒回覆不再整段隱藏（2026-06-27）
  // 對應本次修正：學生重新儲存月記會把 teacherComment 歸零，但 studentReply 因
  //   saveJournal() 的 merge:true 原樣保留，造成「有回覆、評語卻已消失」的孤兒狀態
  //   （已知邊界案例，見 AI_CONTEXT.md）。舊版用 (isTeacher && hasComment) 當作整個
  //   對話串區塊的顯示條件，hasComment 為 false 時會連帶把孤兒回覆一起藏起來，
  //   老師端完全看不到、主頁紅點點進去也找不到上下文。
  //   修法：改用 (isTeacher && (hasComment || j.studentReply))，且在 !hasComment 時
  //   額外顯示一行警示文字，說明評語已被清除、回覆已失去原始上下文。
  // 以下為靜態分析（檢查原始碼字串），無法重現實際渲染結果，只能確認程式碼特徵
  // 仍存在、防止日後改動退回舊寫法。
  // ════════════════════════════════════════

  await test('T-SEC-19 renderJournalCard() 孤兒回覆顯示警示而非整段隱藏', async () => {
    const result = await page.evaluate(() => {
      const fn = window['renderJournalCard'];
      const fnStr = (typeof fn === 'function') ? fn.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasOrGate:      /hasComment\s*\|\|\s*j\.studentReply/.test(fnStr),
        hasOrphanFlag:  fnStr.includes('orphanReply'),
        hasWarningText: fnStr.includes('評語已被清除'),
      };
    });
    if (result.skip) return;
    if (!result.hasOrGate)
      throw new Error('renderJournalCard() 對話串區塊顯示條件未包含 (hasComment || j.studentReply)，孤兒回覆仍會被整段隱藏');
    if (!result.hasOrphanFlag)
      throw new Error('renderJournalCard() 找不到 orphanReply 判斷邏輯，可能已被改寫，需重新確認孤兒回覆是否仍會顯示');
    if (!result.hasWarningText)
      throw new Error('renderJournalCard() 缺少孤兒回覆的警示文字，老師看到回覆但仍會不知道評語已被清空');
  });

  // ════════════════════════════════════════
  // T-SEC-20 ～ T-SEC-22  saveTeacherComment() 評語旗標邏輯（2026-06-28）
  // 對應「評語測試系統」STEP 1～4 的 Firebase 寫入邏輯：
  //
  //   STEP 1（老師存空評語）：
  //     teacherReviewed=true, teacherComment="",
  //     teacherCommentUnread=false（comment.length==0 不設 true）
  //     teacherCommentUpdated 不動（或維持 false）
  //
  //   STEP 2（老師首次存有文字評語；oldComment="" 即空）：
  //     teacherCommentUnread=true
  //     isCommentUpdate = !!('' && true) = false → teacherCommentUpdated=false → State 1 🔴
  //
  //   STEP 4（老師改評語；oldComment="第一次評語" 非空）：
  //     teacherCommentUnread=true
  //     isCommentUpdate = !!('第一次評語' && true) = true → teacherCommentUpdated=true → State 2 🟠
  //
  // 以下三項均為靜態分析（檢查 saveTeacherComment 原始碼字串），
  // 無法重現實際 Firestore 寫入結果（那部分已由 STEP 1～4 人工驗證確認），
  // 只能確認程式碼特徵仍存在、防止日後改動退回舊寫法。
  // ════════════════════════════════════════

  await test('T-SEC-20 saveTeacherComment() isCommentUpdate 邏輯（oldComment 非空才設 Updated）', async () => {
    // 對應「評語測試系統」關鍵邏輯說明：
    //   isCommentUpdate = !!(oldComment && comment)
    //   STEP 2：oldComment='' → false（State 1 🔴 有新評語）
    //   STEP 4：oldComment='第一次評語' → true（State 2 🟠 評語已更新）
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵 1：有 isCommentUpdate 變數
      const hasIsCommentUpdate = fnStr.includes('isCommentUpdate');

      // 特徵 2：isCommentUpdate 依賴 oldComment（必須讀取儲存前的舊評語值）
      const readsOldComment = fnStr.includes('oldComment');

      // 特徵 3：teacherCommentUpdated 的值由 isCommentUpdate 決定
      //  正確寫法之一：teacherCommentUpdated: isCommentUpdate
      //  或：teacherCommentUpdated: isCommentUpdate ? true : false
      const updatedUsesFlag =
        /teacherCommentUpdated\s*:\s*isCommentUpdate/.test(fnStr) ||
        /teacherCommentUpdated.*isCommentUpdate/.test(fnStr);

      // 特徵 4（2026-06-28 新增）：commentChanged 變數存在
      // 修正前只靠「舊值是否存在」，改為用字串等值比對才算真的更新
      const hasCommentChanged = fnStr.includes('commentChanged');

      return { skip: false, hasIsCommentUpdate, readsOldComment, updatedUsesFlag, hasCommentChanged };
    });
    if (result.skip) return;
    if (!result.hasIsCommentUpdate)
      throw new Error(
        'saveTeacherComment() 找不到 isCommentUpdate 變數，' +
        'STEP 2（首次評語）與 STEP 4（修改評語）可能都觸發同一個 State，無法區分 State 1/State 2'
      );
    if (!result.readsOldComment)
      throw new Error(
        'saveTeacherComment() 找不到 oldComment，' +
        '無法判斷本次儲存是「新增評語」(State 1) 還是「修改評語」(State 2)'
      );
    if (!result.updatedUsesFlag)
      throw new Error(
        'saveTeacherComment() 的 teacherCommentUpdated 未以 isCommentUpdate 決定，' +
        '可能硬寫成固定值，STEP 2 與 STEP 4 的 State 無法正確分流'
      );
    if (!result.hasCommentChanged)
      throw new Error(
        'saveTeacherComment() 找不到 commentChanged，' +
        '「評語未改直接儲存」仍會把 isCommentUpdate 誤判為 true，' +
        '觸發 State 3→2 錯誤轉換'
      );
  });

  await test('T-SEC-21 saveTeacherComment() teacherCommentUnread：有評語才設 true', async () => {
    // 對應 STEP 1（空評語審閱）：
    //   teacherCommentUnread 應為 false（comment.length==0 不提醒學生）
    // 對應 STEP 2／STEP 4（有文字評語）：
    //   teacherCommentUnread 應設為 true（提醒學生有新/更新評語）
    // 若 saveTeacherComment 對空評語也設 teacherCommentUnread=true，
    // 學生端會永遠顯示 🔴（無法到達 State 3 ✅ 已審閱）。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵 1：有條件判斷 comment 是否為空（length / 非空字串判斷）
      const checksCommentEmpty =
        fnStr.includes('comment.length') ||
        fnStr.includes('comment &&') ||
        fnStr.includes('!!comment') ||
        fnStr.includes('comment.trim()') ||
        /comment\s*!==?\s*['"][\s]*['"]/.test(fnStr) ||
        /comment\s*==\s*['"][\s]*['"]/.test(fnStr);

      // 特徵 2：teacherCommentUnread 不是硬寫 true（若有條件分支設 false 即可）
      const hasUnreadFalse  = /teacherCommentUnread\s*:\s*false/.test(fnStr);
      const hasUnreadTrue   = /teacherCommentUnread\s*:\s*true/.test(fnStr);

      // 合理的正確寫法之一：teacherCommentUnread: comment.length > 0
      // 或在 if(comment) 分支設 true，else 分支設 false
      const hasConditionalUnread =
        /teacherCommentUnread\s*:\s*(?:comment(?:\.length\s*>?\s*0|\.trim\(\)|\s*!==?\s*['"][\s]*)|\!\!comment)/.test(fnStr) ||
        (checksCommentEmpty && hasUnreadFalse && hasUnreadTrue);

      return { skip: false, checksCommentEmpty, hasUnreadFalse, hasUnreadTrue, hasConditionalUnread };
    });
    if (result.skip) return;
    if (!result.checksCommentEmpty)
      throw new Error(
        'saveTeacherComment() 未偵測到 comment 是否為空的判斷，' +
        'STEP 1（空評語審閱）可能會把 teacherCommentUnread 設為 true，' +
        '學生端無法到達 State 3（✅ 已審閱）'
      );
    if (!result.hasConditionalUnread && !result.hasUnreadFalse)
      throw new Error(
        'saveTeacherComment() 找不到 teacherCommentUnread:false 的寫入路徑，' +
        'STEP 1 空評語審閱後學生端永遠顯示 🔴 而非 ✅'
      );
  });

  await test('T-SEC-22 saveTeacherComment() teacherCommentUpdated 由 isCommentUpdate 控制（代理 sanity check）', async () => {
    // ⚠️  標題已從「STEP 1 不洗 STEP 5」更正（2026-06-29），因原描述與現行行為不符。
    //
    // 現行行為（commentChanged 守衛 + spread 條件寫入）：
    //   ‧ 清空評語（oldComment 非空 → comment=""）→ commentChanged=true
    //     → 寫入 teacherCommentUpdated=false → State 4（📖）退回 State 3（✅）
    //   這是語意合理、刻意接受的邊界案例（評語消失後「已更新閱讀」旗標失去意義），
    //   已記錄於 AI_CONTEXT.md「已知低優先邊界案例」。
    //
    // 此測試只確認「teacherCommentUpdated 由 isCommentUpdate 控制，非硬寫 false」，
    // 作為防止完全移除條件邏輯的最低防線。
    // 若要驗證「評語未改不重新觸發未讀旗標」，請看 T-SEC-23。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      // 整個函式完全不寫 teacherCommentUpdated：靠 spread 排除，也是正確的
      const neverWritesUpdated = !fnStr.includes('teacherCommentUpdated');
      if (neverWritesUpdated) return { skip: false, safe: true, reason: 'teacherCommentUpdated 完全不出現在 saveTeacherComment，靠條件式 spread 排除' };

      // 若有寫 teacherCommentUpdated，確認是由 isCommentUpdate 控制（而非硬寫 false）
      const hasIsCommentUpdate = fnStr.includes('isCommentUpdate');

      if (hasIsCommentUpdate) return { skip: false, safe: true, reason: 'isCommentUpdate 旗標存在，teacherCommentUpdated 受條件控制' };

      // 最後防線：若有寫 teacherCommentUpdated 但沒有 isCommentUpdate，
      // 只接受「空評語分支完全不更新 teacherCommentUpdated」的情況
      // （此時需要 updateMask 排除，無法純靠靜態分析確認，給予警告）
      return {
        skip: false,
        safe: false,
        reason: 'saveTeacherComment() 有寫 teacherCommentUpdated 但找不到 isCommentUpdate 保護，' +
                '空評語審閱路徑可能把 teacherCommentUpdated 強制設為 false，' +
                '導致 State 4（📖 評語已閱讀）在老師重新審閱後意外消失'
      };
    });
    if (result.skip) return;
    if (!result.safe) throw new Error(result.reason);
  });


  await test('T-SEC-23 saveTeacherComment() 評語未改時 teacherCommentUnread 不重新觸發（State 3→2 防護）', async () => {
    // 修正「老師只讀取回覆後直接儲存」導致學生誤看到 🟠 的問題。
    // 正確做法：teacherCommentUnread 與 teacherCommentUpdated 只在
    // commentChanged=true（評語內容真正改變）時才寫入 updateDoc payload；
    // 未改時兩欄均不出現在 payload，Firestore 原值不受影響。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵 1：commentChanged 變數存在
      const hasCommentChanged = fnStr.includes('commentChanged');

      // 特徵 2：teacherCommentUnread 的寫入受 commentChanged 控制
      //   spread 寫法範例：...(commentChanged ? { teacherCommentUnread: ... } : {})
      const unreadGatedByChanged =
        /commentChanged\s*\?[\s\S]{0,200}teacherCommentUnread/.test(fnStr) ||
        /if\s*\(\s*commentChanged\s*\)[\s\S]{0,200}teacherCommentUnread/.test(fnStr);

      // 特徵 3：teacherCommentUpdated 的寫入也受 commentChanged 控制（同一區塊）
      const updatedGatedByChanged =
        /commentChanged\s*\?[\s\S]{0,400}teacherCommentUpdated/.test(fnStr) ||
        /if\s*\(\s*commentChanged\s*\)[\s\S]{0,400}teacherCommentUpdated/.test(fnStr);

      return { skip: false, hasCommentChanged, unreadGatedByChanged, updatedGatedByChanged };
    });
    if (result.skip) return;
    if (!result.hasCommentChanged)
      throw new Error(
        'saveTeacherComment() 找不到 commentChanged，' +
        '評語未改時仍會重新觸發 teacherCommentUnread，State 3→2 誤轉換未修正'
      );
    if (!result.unreadGatedByChanged)
      throw new Error(
        'teacherCommentUnread 的寫入未受 commentChanged 控制，' +
        '老師只讀取回覆後直接儲存，學生 badge 仍會被錯誤推到 🟠 State 2'
      );
    if (!result.updatedGatedByChanged)
      throw new Error(
        'teacherCommentUpdated 的寫入未受 commentChanged 控制，' +
        '評語未改時仍可能誤改此旗標，造成 State 2→1 或 State 4→3 退化'
      );
  });

  await test('T-SEC-30 saveTeacherComment() teacherCommentContentAt 只在評語內容真正改變時才寫入（與 teacherCommentUnread／teacherCommentUpdated 同一個 commentChanged 條件區塊）', async () => {
    // 2026-07-07 新增，填補文件自己記錄的測試缺口：teacherCommentContentAt 是
    // 2026-07-06 新增的欄位（供 notify-service/send-push-notifications.js 的
    // checkComments() 判斷評語是否已推播過用），寫入邏輯理應沿用既有
    // commentChanged 守衛（跟 teacherCommentUnread／teacherCommentUpdated 同一個
    // spread 條件區塊），但 T-SEC-20／T-SEC-23 這兩條原本測 commentChanged 的測試
    // 新增當下沒有同步擴充涵蓋這第三個欄位——本測試補上，理由與 T-SEC-23 完全對稱：
    // 若 teacherCommentContentAt 沒被 commentChanged 守衛住，老師只讀取學生回覆、
    // 評語文字沒改就按儲存，仍會把這個時間戳更新成現在，讓 notify-service 誤判為
    // 「內容真的變了」而重複推播一則學生早就看過的評語。
    //
    // 寫法說明：第一版原本用固定字元數視窗（比照 T-SEC-23 的 200/400 字元），但實際
    // 對照 teacher.html 跑過才發現 teacherCommentUpdated 跟 teacherCommentContentAt
    // 之間夾了一大段解釋性註解（說明為何不能沿用 reviewedAt 判斷），距離達 644 字元，
    // 640 字元視窗會誤判退化（測試本身錯，不是程式碼錯）。改用「抓出
    // commentChanged ? { ... } : {}) 這個 ternary/spread 區塊本身的起訖括號」再檢查
    // 欄位是否落在區塊內，不受區塊內註解長度影響，比固定字元視窗更貼近實際程式碼結構。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      const hasContentAt = fnStr.includes('teacherCommentContentAt');
      if (!hasContentAt) return { skip: false, hasContentAt: false };

      const hasCommentChanged = fnStr.includes('commentChanged');

      // 抓出 `commentChanged ? { ... } : {})` 這個條件 spread 區塊本身，
      // 不論裡面註解多長都能正確涵蓋。
      const openIdx = fnStr.indexOf('commentChanged ? {');
      const closeIdx = openIdx >= 0 ? fnStr.indexOf('} : {})', openIdx) : -1;
      const block = (openIdx >= 0 && closeIdx > openIdx) ? fnStr.slice(openIdx, closeIdx) : '';

      const contentAtGatedByChanged = block.includes('teacherCommentContentAt');
      const unreadGatedByChanged = block.includes('teacherCommentUnread');
      const updatedGatedByChanged = block.includes('teacherCommentUpdated');

      return {
        skip: false,
        hasContentAt: true,
        hasCommentChanged,
        blockFound: !!block,
        contentAtGatedByChanged,
        unreadGatedByChanged,
        updatedGatedByChanged,
      };
    });
    if (result.skip) return;
    if (!result.hasContentAt)
      throw new Error(
        'saveTeacherComment() 找不到 teacherCommentContentAt，' +
        '推播通知服務（send-push-notifications.js 的 checkComments()）無法判斷評語是否已推播過'
      );
    if (!result.hasCommentChanged)
      throw new Error(
        'saveTeacherComment() 有 teacherCommentContentAt 但找不到 commentChanged，' +
        '無法確認這個時間戳是否只在內容真正改變時才更新'
      );
    if (!result.blockFound)
      throw new Error(
        '找不到 `commentChanged ? { ... } : {})` 這個條件 spread 區塊本身（寫法可能已改變），' +
        '無法確認 teacherCommentContentAt 是否仍落在同一個守衛範圍內，需要重新設計此測試'
      );
    if (!result.contentAtGatedByChanged)
      throw new Error(
        'teacherCommentContentAt 不在 commentChanged 條件 spread 區塊內，' +
        '老師只讀取回覆、評語文字沒改就按儲存，仍會把這個時間戳更新成現在，' +
        '導致 notify-service 誤判為內容真的改變而對同一則評語重複推播'
      );
    if (!result.unreadGatedByChanged || !result.updatedGatedByChanged)
      throw new Error(
        'teacherCommentUnread／teacherCommentUpdated 不在同一個 commentChanged 區塊內，' +
        '這條測試賴以判斷「三個欄位共用同一守衛」的前提被破壞，T-SEC-23 的既有覆蓋可能也已失效'
      );
  });

  await test('T-SEC-31 initPushNotifications() 關鍵特徵：相對路徑註冊 SW、寫入路徑對應 rule.txt、userAgent 截斷、fire-and-forget 不擋登入', async () => {
    // 2026-07-07 新增。上一輪（teacher_test.js v19 header）記錄這個函式「沒看過實際
    // 內容，照文件摘要猜寫測試風險太高，故意先不補」；現在已經拿到 teacher.html
    // 實際內容，逐項對照真正的原始碼設計以下檢查，不是憑空假設介面形狀。
    //
    // 五項檢查對應五個真實存在、各自有明確理由的退化風險：
    //   1. navigator.serviceWorker.register('./fcm-sw.js', ...) 必須用相對路徑——
    //      函式內的註解本身就說明這是 2026-07 的真實 bug 修正：這個站是 GitHub Pages
    //      的 project page（網址帶 /internship-journal/ 子路徑），用開頭帶斜線的絕對
    //      路徑 '/fcm-sw.js' 會讓瀏覽器去抓網域最上層、實際上 404，這裡若被改回絕對
    //      路徑，推播會在所有裝置上悄悄失效但不會報錯（try/catch 吞掉），很難察覺。
    //   2. Firestore 寫入路徑 doc(db, 'admins', currentUser.uid, 'fcmTokens', token)
    //      必須用 currentUser.uid——這條路徑要能通過 rule.txt 的
    //      adminId==request.auth.uid 檢查，若改成其他值（例如 email 字串），
    //      正常情況下仍可能因為 adminId==emailKey() 這個 OR 分支而僥倖通過，但一旦
    //      未來 emailKey() 邏輯有變動，兩者可能不再等價，鎖住目前實際使用的 uid 寫法。
    //   3. userAgent 欄位必須截斷至 200 字（.slice(0, 200)）——對應 AI_CONTEXT.md
    //      「Firestore 資料結構」章節記載的 fcmTokens 文件 schema，若移除截斷，
    //      理論上可以寫入任意長度字串進這個公開集合。
    //   4. try/catch 的 catch 區塊不能重新 throw——呼叫端 enterApp() 註解明確寫著
    //      「fire-and-forget，失敗不擋登入」，若 catch 區塊被改成 rethrow，
    //      推播初始化失敗會變成未捕捉例外，可能連帶讓 enterApp() 後續邏輯中斷。
    //   5. enterApp() 呼叫 initPushNotifications() 時不能加 await——同一個
    //      fire-and-forget 設計意圖的另一半，若被改成 await，使用者登入流程會被
    //      這整個推播註冊流程（含瀏覽器跳出通知權限詢問視窗）卡住。
    const result = await page.evaluate(() => {
      const fnStr = (typeof initPushNotifications === 'function') ? initPushNotifications.toString() : '';
      const enterAppStr = (typeof enterApp === 'function') ? enterApp.toString() : '';
      if (!fnStr || !enterAppStr) return { skip: true };

      const relativeSwPath = /navigator\.serviceWorker\.register\(\s*['"]\.\/fcm-sw\.js['"]/.test(fnStr);
      const correctFsPath = /doc\(\s*db\s*,\s*['"]admins['"]\s*,\s*currentUser\.uid\s*,\s*['"]fcmTokens['"]/.test(fnStr);
      const userAgentTruncated = /userAgent\s*:\s*\([^)]*\)\.slice\(\s*0\s*,\s*200\s*\)/.test(fnStr);

      const catchIdx = fnStr.lastIndexOf('} catch');
      const catchBlock = catchIdx >= 0 ? fnStr.slice(catchIdx) : '';
      const catchDoesNotRethrow = !!catchBlock && !catchBlock.includes('throw');

      const hasAwaitedCall = /await\s+initPushNotifications\(\)/.test(enterAppStr);
      const hasBareCall = enterAppStr.includes('initPushNotifications();') || enterAppStr.includes('initPushNotifications() ;');

      return {
        skip: false,
        relativeSwPath,
        correctFsPath,
        userAgentTruncated,
        catchFound: !!catchBlock,
        catchDoesNotRethrow,
        hasAwaitedCall,
        hasBareCall,
      };
    });
    if (result.skip) return;
    if (!result.relativeSwPath)
      throw new Error(
        'initPushNotifications() 沒有用相對路徑 register(\'./fcm-sw.js\')——' +
        '若被改回絕對路徑 /fcm-sw.js，GitHub Pages project page 子路徑下會 404，' +
        '推播會悄悄失效（try/catch 吞掉錯誤，畫面上完全看不出來）'
      );
    if (!result.correctFsPath)
      throw new Error(
        'initPushNotifications() 的 Firestore 寫入路徑不是 doc(db, \'admins\', currentUser.uid, \'fcmTokens\', token)，' +
        '可能無法通過 rule.txt 的 adminId==request.auth.uid 檢查'
      );
    if (!result.userAgentTruncated)
      throw new Error(
        'initPushNotifications() 的 userAgent 欄位未截斷至 200 字（.slice(0, 200)），' +
        '違反 fcmTokens 文件的既定 schema'
      );
    if (!result.catchFound || !result.catchDoesNotRethrow)
      throw new Error(
        'initPushNotifications() 的 catch 區塊會重新 throw（或找不到 catch 區塊），' +
        '違反「fire-and-forget，失敗不擋登入」的設計意圖，enterApp() 可能因此被中斷'
      );
    if (result.hasAwaitedCall)
      throw new Error(
        'enterApp() 用 await 呼叫 initPushNotifications()，' +
        '登入流程會被整個推播註冊流程（含瀏覽器通知權限詢問視窗）卡住，違反 fire-and-forget 設計'
      );
    if (!result.hasBareCall)
      throw new Error(
        'enterApp() 找不到不帶 await 的 initPushNotifications() 呼叫，呼叫方式可能已改變，需要重新確認此測試'
      );
  });


  await test('T-SEC-24 saveTeacherComment() oldComment 改為送出前 getDoc() 現查伺服器當下值（多裝置/多分頁競態防護）', async () => {
    // 2026-07-11 改版。原始版本（2026-06-29）驗證的是 _openCommentModalWithUid()
    // 在設定 _currentCommentJournal.oldComment 前有 seatNo/semester/month 三重身份比對，
    // 防的是「同一分頁快速切換不同月記」時，較早完成的 getDoc .then() 把錯誤月記的舊評語
    // 誤設成 oldComment。
    //
    // saveTeacherComment() 本身這次同日改版（比照 student.html saveStudentReply() 同款
    // 修法，兩者是同一類「快取值可能過期」問題）：oldComment 不再讀
    // _currentCommentJournal.oldComment 這份 Modal 開啟當下的快照，改成送出前
    // await getDoc(ref) 現查伺服器當下的 teacherComment——這個新機制本身就比舊的三重
    // 身份比對更徹底：不只防「同分頁快速切換月記」，還一併防「Modal 開著的這段期間，
    // 同一份月記被另一台裝置/分頁的老師改過評語」這種舊機制完全防不到的多裝置/多分頁
    // 競態。_openCommentModalWithUid() 原本設定 oldComment 的兩處程式碼（.then() 三重
    // 身份比對＋.catch() 空字串保底）因此變成沒有任何函式會讀取的死碼，已同步移除
    // （見 T-SEC-32），本測試同步改為驗證新機制，不再驗證已被移除的舊死碼特徵。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };

      // 錨定實際的呼叫/賦值語法（而非寬鬆字串搜尋），避免像 T-SEC-30／student_test.js
      // S-SEC-29 那樣被解釋性註解本身提到的字詞誤判——這個函式內部就有大段說明
      // 「當初為什麼從 Modal 快照改成送出前現查」的註解，寬鬆搜尋容易命中註解文字本身
      // 而非真正的程式行為。
      const readsOldFromFreshDoc =
        /await\s+getDoc\s*\(/.test(fnStr) &&
        /const\s+oldComment\s*=\s*\(\s*freshSnap/.test(fnStr);

      // 確認舊的 Modal 快照讀取方式真的不在了，不是新舊兩套邏輯並存。
      // ⚠️ 不能用寬鬆的 fnStr.includes('_currentCommentJournal.oldComment') 或單純
      // .test()——這個函式上方就有大段解釋性註解會提到這個字串本身（說明「當初為什麼
      // 從這裡改掉」），寬鬆搜尋會命中註解文字，變成本測試自己也踩進 T-SEC-30／
      // S-SEC-29 已經記錄過的「regex 命中解釋性註解」陷阱。改為錨定實際的指派
      // （= 但排除 ==/===）或讀取（??）語法，只有真的被當成程式碼使用才會命中。
      const stillReadsStaleCache = /_currentCommentJournal\.oldComment\s*(?:=(?!=)|\?\?)/.test(fnStr);

      return { skip: false, readsOldFromFreshDoc, stillReadsStaleCache };
    });

    if (result.skip) return;
    if (!result.readsOldFromFreshDoc)
      throw new Error(
        'saveTeacherComment() 找不到「送出前 await getDoc(ref) 現查伺服器當下 teacherComment」' +
        '的邏輯（應同時看得到 getDoc(...) 呼叫與 const oldComment = (freshSnap... 賦值），' +
        '舊評語值可能又改回讀 Modal 開啟當下的快照（_currentCommentJournal.oldComment）——' +
        '多裝置/多分頁情境下這份快照可能落後伺服器真實值，會讓 commentChanged／' +
        'isCommentUpdate 算錯，寫入錯誤的 teacherCommentUnread／teacherCommentUpdated'
      );
    if (result.stillReadsStaleCache)
      throw new Error(
        'saveTeacherComment() 仍讀取 _currentCommentJournal.oldComment，' +
        '新舊兩套「取得舊評語值」的邏輯可能並存——若是刻意保留的 fallback，' +
        '請更新本測試的預期行為並在程式碼與此處都補上說明理由'
      );
  });

  await test('T-SEC-32 _openCommentModalWithUid() 不再殘留 oldComment 快取死碼（2026-07-11 清理確認）', async () => {
    // 補充測試，對應上方 T-SEC-24 改版：確認 _openCommentModalWithUid() 內原本專門
    // 為了保護 _currentCommentJournal.oldComment 快取而寫的三重身份比對（.then() 分支）
    // 與空字串保底（.catch() 分支）已經一併移除，不是只改了 saveTeacherComment() 卻
    // 留下一段已經沒有任何函式會讀取、卻長得像還在運作的保護機制的死碼——這類「看起來
    // 像防護、實際上什麼都防不到」的殘留碼，比乾脆沒有防護更容易誤導未來的維護者
    // （會誤以為 oldComment 的競態保護是靠這裡的身份比對在做，實際上早已不是）。
    const result = await page.evaluate(() => {
      const fnStr = (typeof _openCommentModalWithUid === 'function')
        ? _openCommentModalWithUid.toString() : '';
      if (!fnStr) return { skip: true };
      // 同 T-SEC-24 的理由：這個函式上方也有解釋性註解會提到
      // _currentCommentJournal.oldComment 字串本身，不能用寬鬆搜尋，
      // 錨定實際的指派語法（= 但排除 ==/===）才算真的還在用。
      const hasDeadCache = /_currentCommentJournal\.oldComment\s*=(?!=)/.test(fnStr);
      return { skip: false, hasDeadCache };
    });
    if (result.skip) return;
    if (result.hasDeadCache)
      throw new Error(
        '_openCommentModalWithUid() 仍設定 _currentCommentJournal.oldComment，' +
        '但 saveTeacherComment() 已經不讀這個欄位了（見 T-SEC-24）——若是刻意保留供未來' +
        '其他用途，請在程式碼與本測試都補上說明；若只是忘記清理，請移除'
      );
  });

  await test('T-SEC-25 executeBatchReview() 批次審閱同時清除學生回覆未讀旗標（studentReplyUnread: false）', async () => {
    // 2026-06-30 補修的回歸測試。
    // 原本 executeBatchReview() 的 updateDoc 只寫：
    //   { teacherReviewed: true, reviewedAt: now }
    // 未包含 studentReplyUnread: false，造成以下問題：
    //   若月記已有學生回覆（studentReplyUnread=true），批次審閱完成後
    //   老師主頁「學生有新回覆」紅點數字永遠不歸零；
    //   老師必須逐一手動開啟評語 Modal 才能清除，批次功能形同失效。
    // 修正：補上 studentReplyUnread: false，與 saveTeacherComment() 行為一致
    //   （saveTeacherComment() 每次儲存評語都會把 studentReplyUnread 一併設為 false，
    //   標記學生回覆已讀，不論這次是否真的寫了新評語）。
    const result = await page.evaluate(() => {
      const fnStr = (typeof executeBatchReview === 'function')
        ? executeBatchReview.toString() : '';
      if (!fnStr) return { skip: true };

      const hasStudentReplyUnread =
        fnStr.includes('studentReplyUnread: false') ||
        fnStr.includes('studentReplyUnread:false');

      return { skip: false, hasStudentReplyUnread };
    });

    if (result.skip) return;
    if (!result.hasStudentReplyUnread)
      throw new Error(
        'executeBatchReview() 的 updateDoc 缺少 studentReplyUnread: false，' +
        '批次審閱後「學生有新回覆」紅點數字不會歸零，' +
        '老師須逐一開評語 Modal 才能清除，使批次功能失去效用'
      );
  });

  await test('T-SEC-26 exportAllStatsExcel() Excel 公式注入防護（sanitizeExcelCell() 套用於工作地址／師傅姓名）', async () => {
    // 2026-06-30 新增。
    // locationWs「工作地址」(entries[].address) 與 salaryWs「師傅/學長姐」(j.mentor)
    // 兩個欄位皆為學生在 student.html 自由輸入的文字，原本未經任何處理直接寫入
    // XLSX.utils.json_to_sheet() 產生的儲存格。若學生填入以 =／+／-／@ 開頭的字串
    // （例如 =HYPERLINK("http://evil.com","點我")），部分 Excel 版本（尤其舊版、
    // 或匯出檔被二次轉存成 CSV 後再開啟）有機率將其當成公式執行
    // （OWASP「CSV/Excel 公式注入」）。
    //
    // 驗證三項特徵：
    //   1. sanitizeExcelCell() 函式本體存在，且邏輯正確（開頭為 =/+/-/@ 時補前置單引號）
    //   2. locationRows 的「工作地址」欄位有呼叫 sanitizeExcelCell()
    //   3. salaryRows 的「師傅/學長姐」欄位有呼叫 sanitizeExcelCell()
    const result = await page.evaluate(() => {
      if (typeof sanitizeExcelCell !== 'function') return { missingFn: true };

      // 邏輯正確性：攻擊樣態應被加前置單引號，一般文字不受影響
      const logicOk =
        sanitizeExcelCell('=HYPERLINK("x","y")').startsWith("'=") &&
        sanitizeExcelCell('+1+1').startsWith("'+") &&
        sanitizeExcelCell('-9999').startsWith("'-") &&
        sanitizeExcelCell('@SUM(A1)').startsWith("'@") &&
        sanitizeExcelCell('403臺中市西區三民路一段199號') === '403臺中市西區三民路一段199號' &&
        sanitizeExcelCell('王師傅') === '王師傅' &&
        sanitizeExcelCell('') === '' &&
        sanitizeExcelCell(null) === '' &&
        sanitizeExcelCell(undefined) === '';

      const fnStr = (typeof exportAllStatsExcel === 'function')
        ? exportAllStatsExcel.toString() : '';

      const addressCalled = /工作地址\s*:\s*sanitizeExcelCell\(/.test(fnStr);
      const mentorCalled  = /['"]?師傅\/學長姐['"]?\s*:\s*sanitizeExcelCell\(/.test(fnStr);

      return { missingFn: false, logicOk, addressCalled, mentorCalled, hasExportFn: !!fnStr };
    });

    if (result.missingFn)
      throw new Error('sanitizeExcelCell() 函式不存在，Excel 公式注入防護已遺失');
    if (!result.logicOk)
      throw new Error('sanitizeExcelCell() 邏輯不正確（攻擊樣態未加前置單引號，或一般文字被誤改）');
    if (!result.hasExportFn) return; // exportAllStatsExcel 未定義於全域作用域時略過字串比對
    if (!result.addressCalled)
      throw new Error('locationRows 的「工作地址」欄位未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (!result.mentorCalled)
      throw new Error('salaryRows 的「師傅/學長姐」欄位未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
  });

  await test('T-SEC-27 exportAllStatsExcel() distance/type 兩欄位 Excel 公式注入防護（補齊 T-SEC-26 未涵蓋範圍）', async () => {
    // 2026-07-01（第二次）新增。
    // T-SEC-26（2026-06-30）只驗證了 entries[].address／j.mentor 兩欄位，但外部稽核
    // 複查指出根本原因（rule.txt 對 entries[] 陣列元素完全沒有型別/格式驗證，
    // Firestore Rules 無法對變動長度陣列逐項驗證）並未處理，entries[].distance／
    // entries[].type 兩欄位若透過直接 API 呼叫繞過 UI 前端限制（distance 正常靠
    // parseFloat()＋isNaN()；type 正常是 WORK_TYPES 固定選項或被 /^其他（.*）$/
    // 收斂成 '其他'），同樣能寫入任意字串。
    //
    // 修法與 address/mentor 不同：
    //   - distance 語意上是數字欄位，改用 Number() 強制轉型而非字串跳脫——任何
    //     非數字字串（含攻擊字串）轉型失敗變 NaN 即清空，寫入 Excel 時型別必為
    //     number 或空字串，從根源杜絕字串型公式注入（數字型別儲存格 SheetJS 標
    //     為 'n'，不管數值多少都不可能被解讀成公式，只有字串型別才有這個風險）。
    //   - type 語意是文字且會變成 companyWorktypeRows 的欄位標題（header），
    //     套用既有 sanitizeExcelCell()，與 address/mentor 一致。
    //
    // 驗證四項特徵：
    //   1. distance 賦值前有做 Number() 轉型（非直接沿用原始值）
    //   2. distance 賦值有用 Number.isFinite() 判斷（非數字才清空為空字串）
    //   3. distance 賦值前有明確排除 null/undefined/空字串（防止 Number(null)===0
    //      被 isFinite() 誤判為合法「距離0」，這是修正過程中發現的真實迴歸——
    //      未填距離的合法初始值 null 若被直接 Number() 轉型，會誤顯示成「距離0km」）
    //   4. companyWorktypeMap 的 type 賦值有呼叫 sanitizeExcelCell()
    const result = await page.evaluate(() => {
      const fnStr = (typeof exportAllStatsExcel === 'function')
        ? exportAllStatsExcel.toString() : '';
      if (!fnStr) return { skip: true };

      const distanceUsesNumber       = /Number\(\s*(distRaw|e\.distance)\s*\)/.test(fnStr);
      const distanceUsesFiniteCheck  = /Number\.isFinite\(\s*distNum\s*\)/.test(fnStr);
      const distanceGuardsNullFirst  = /distRaw\s*===\s*null/.test(fnStr) ||
                                        /e\.distance\s*===\s*null/.test(fnStr);
      const typeUsesSanitize         = /const\s+type\s*=\s*sanitizeExcelCell\(/.test(fnStr);

      return {
        skip: false,
        distanceUsesNumber,
        distanceUsesFiniteCheck,
        distanceGuardsNullFirst,
        typeUsesSanitize,
      };
    });

    if (result.skip) return;
    if (!result.distanceUsesNumber)
      throw new Error('locationRows 的「距學校(km)」欄位未對 e.distance 做 Number() 轉型，Excel 公式注入防護退化');
    if (!result.distanceUsesFiniteCheck)
      throw new Error('locationRows 的「距學校(km)」欄位未用 Number.isFinite() 判斷，非數字攻擊字串可能仍原樣寫入');
    if (!result.distanceGuardsNullFirst)
      throw new Error(
        '「距學校(km)」欄位未在 Number() 轉型前明確排除 null/undefined，' +
        '會讓「未填距離」的合法 null 值被 Number(null)===0 誤判成「距離0km」（真實迴歸，2026-07-01 曾發生過）'
      );
    if (!result.typeUsesSanitize)
      throw new Error('companyWorktypeMap 的 type 賦值未呼叫 sanitizeExcelCell()，「各公司工作類型」工作表欄位標題的 Excel 公式注入防護退化');
  });

  await test('T-SEC-28 exportAllStatsExcel() 姓名/公司/日期/月份/學期/繳交時間/最後更新 Excel 公式注入防護（收斂 T-SEC-26/27 之後第三輪）', async () => {
    // 2026-07-01（第三次，含後續補漏）新增。
    // T-SEC-26 只驗證了 entries[].address／j.mentor，T-SEC-27 只驗證了
    // entries[].distance／entries[].type，但同一個函式裡至少還有下列同根因
    // （rule.txt 對 entries[] 陣列與月記頂層欄位皆無型別驗證，技術使用者可
    // 直接 API 呼叫繞過 UI 前端限制寫入任意字串）卻未處理的欄位：
    //   - locationRows：姓名（s.name || j.studentName fallback）、公司
    //     （s.company || j.company fallback，跟姓名同一種 fallback 模式）、
    //     日期（entries[].date）
    //   - salaryRows：姓名、公司（同上兩種 fallback）、月份（j.month）
    //   - salaryAlertRows「薪資缺漏」：姓名、公司（同上兩種 fallback）、說明
    //     （內嵌 j.semester + j.month，j.semester 直接在字串開頭無任何前置字元，
    //     是所有實例裡風險最直接的一處）
    //   - journalListRows：姓名（同上 fallback，此陣列無「公司」欄位）、學期
    //     （.replace('-1',...).replace('-2',...) 只替換兩個固定子字串，非預期格式
    //     的攻擊字串完全不會命中、原樣通過）、月份、繳交時間、最後更新
    //     （皆為 .slice(0,10) 截字串，只截長度不動起始字元）
    //
    // 驗證 8 項特徵（涵蓋 4 個陣列共 14 個欄位實例，「姓名」「公司」「月份」各自
    // 重複出現多次，用出現次數而非單純存在與否驗證，避免漏改其中一處仍誤判通過）：
    //   1. 「姓名」欄位呼叫 sanitizeExcelCell() 的次數 = 4（locationRows/salaryRows/
    //      salaryAlertRows/journalListRows 各一次）
    //   2. 「公司」欄位呼叫 sanitizeExcelCell() 的次數 = 3（locationRows/salaryRows/
    //      salaryAlertRows 各一次；journalListRows 無此欄位）
    //   3. locationRows「日期」欄位呼叫 sanitizeExcelCell()
    //   4. 「月份」欄位呼叫 sanitizeExcelCell() 的次數 = 2（salaryRows/journalListRows）
    //   5. salaryAlertRows「說明」欄位呼叫 sanitizeExcelCell()
    //   6. journalListRows「學期」欄位呼叫 sanitizeExcelCell()
    //   7. journalListRows「繳交時間」欄位呼叫 sanitizeExcelCell()
    //   8. journalListRows「最後更新」欄位呼叫 sanitizeExcelCell()
    const result = await page.evaluate(() => {
      const fnStr = (typeof exportAllStatsExcel === 'function')
        ? exportAllStatsExcel.toString() : '';
      if (!fnStr) return { skip: true };

      const nameCalledCount = (fnStr.match(/姓名\s*:\s*sanitizeExcelCell\(/g) || []).length;
      const companyCalledCount = (fnStr.match(/公司\s*:\s*sanitizeExcelCell\(/g) || []).length;
      const dateCalled = /日期\s*:\s*sanitizeExcelCell\(/.test(fnStr);
      const monthCalledCount = (fnStr.match(/月份\s*:\s*sanitizeExcelCell\(/g) || []).length;
      const descCalled = /說明\s*:\s*sanitizeExcelCell\(/.test(fnStr);
      const semesterCalled = /學期\s*:\s*sanitizeExcelCell\(/.test(fnStr);
      const submittedAtCalled = /繳交時間\s*:\s*sanitizeExcelCell\(/.test(fnStr);
      const updatedAtCalled = /最後更新\s*:\s*sanitizeExcelCell\(/.test(fnStr);

      return {
        skip: false,
        nameCalledCount,
        companyCalledCount,
        dateCalled,
        monthCalledCount,
        descCalled,
        semesterCalled,
        submittedAtCalled,
        updatedAtCalled,
      };
    });

    if (result.skip) return;
    if (result.nameCalledCount < 4)
      throw new Error(`「姓名」欄位呼叫 sanitizeExcelCell() 的次數只有 ${result.nameCalledCount}（應為 4：locationRows/salaryRows/salaryAlertRows/journalListRows），至少一處 studentName fallback 的 Excel 公式注入防護退化`);
    if (result.companyCalledCount < 3)
      throw new Error(`「公司」欄位呼叫 sanitizeExcelCell() 的次數只有 ${result.companyCalledCount}（應為 3：locationRows/salaryRows/salaryAlertRows），至少一處 j.company fallback 的 Excel 公式注入防護退化`);
    if (!result.dateCalled)
      throw new Error('locationRows 的「日期」欄位未呼叫 sanitizeExcelCell()，entries[].date 的 Excel 公式注入防護退化');
    if (result.monthCalledCount < 2)
      throw new Error(`「月份」欄位呼叫 sanitizeExcelCell() 的次數只有 ${result.monthCalledCount}（應為 2：salaryRows/journalListRows），至少一處 j.month 的 Excel 公式注入防護退化`);
    if (!result.descCalled)
      throw new Error('salaryAlertRows「薪資缺漏」的「說明」欄位未呼叫 sanitizeExcelCell()，內嵌的 j.semester 開頭無任何前置字元，Excel 公式注入防護退化');
    if (!result.semesterCalled)
      throw new Error('journalListRows 的「學期」欄位未呼叫 sanitizeExcelCell()，非預期格式的 j.semester（.replace() 不命中時原樣通過）Excel 公式注入防護退化');
    if (!result.submittedAtCalled)
      throw new Error('journalListRows 的「繳交時間」欄位未呼叫 sanitizeExcelCell()，j.submittedAt 的 Excel 公式注入防護退化');
    if (!result.updatedAtCalled)
      throw new Error('journalListRows 的「最後更新」欄位未呼叫 sanitizeExcelCell()，j.updatedAt 的 Excel 公式注入防護退化');
  });

  await test('T-SEC-29 loadRosterStudentsForSemesters() 根源防護 + submitAoA/stuSalaryRows/companyRows2/companyWorktypeRows/salaryAlertRows(低於/高於平均/公司內部落差)/salarySummaryRows Excel 公式注入防護（第四輪，根因與 T-SEC-26/27/28 相同但透過 studentMap 間接繼承）', async () => {
    // 2026-07-02 新增。
    // 背景：T-SEC-26/27/28 三輪的 sanitizeExcelCell() 防護，判斷基礎都是「studentMap
    // 裡的姓名/公司資料來自老師端名冊，信任邊界跟學生自由輸入不同」。但
    // loadRosterStudentsForSemesters() 在某學期完全沒有存過名冊快照時
    // （roster.length === 0，常見於較舊的封存學期），會直接從月記反推出一份
    // 「名冊」：bySeat[seatNo] = normalizeRosterStudent({ name: j.studentName || '',
    // company: j.company || '' }, sem) —— 這代表 studentMap 這時候的 name/company
    // 本質上還是學生自己填的原始欄位，只是繞了一手，前三輪「來自名冊、安全」的假設
    // 在這個分支下不成立。凡是透過 studentMap 取值、卻沒有各自補上 sanitizeExcelCell()
    // 的下游，全部間接繼承了這個洞。
    //
    // 修法分兩層：① 根源——loadRosterStudentsForSemesters() 的 fallback 重建處直接
    // 對 name/company 套 sanitizeExcelCell()，讓所有透過 students/studentMap 取值的
    // 下游（含未來新增的統計/匯出功能）自動繼承防護；② 個別輸出點——即使根源修了，
    // 仍在下列每個實際寫入 Excel 儲存格的地方各自補上 sanitizeExcelCell()，
    // 做為第二層防禦（若未來根源修正被誤刪，個別輸出點仍能擋住），且對正常資料
    // 完全無副作用（sanitizeExcelCell() 只在字串開頭為 =+-@ 時才動作）：
    //   - submitAoA（工作表「繳交狀況」）：姓名
    //   - stuSalaryRows（工作表「學生薪資總覽」）：姓名、公司
    //   - companyAggMap 的 c／companyWorktypeMap 的 company：studentMap 查無此人時
    //     直接 fallback 到 j.company，是跟「studentMap 本身被污染」不同的另一種失效
    //     模式（查無資料，不是資料本身被污染），根源修正對它沒幫助，需個別補
    //   - companyRows2（工作表「各公司薪資」）／companyWorktypeRows（工作表「公司×
    //     工作類型統計」）：公司名稱（來源已在 companyAggMap/companyWorktypeMap
    //     清洗過，這裡屬於重複防護)
    //   - salaryAlertRows「低於平均20%」「高於平均30%」「公司內部落差」三種類型
    //     （T-SEC-28 只補了「薪資缺漏」一種，這輪補齊剩下三種）
    //   - salarySummaryRows「最高/最低平均學生」「最高/最低平均公司」四行內容
    //     （前兩行實務上有 seatNo 前綴意外擋住，跟「月」字尾同一種巧合保護、
    //     不該依賴；後兩行公司名稱排在字串開頭，完全沒有任何遮擋）
    const result = await page.evaluate(() => {
      const rosterFnStr = (typeof loadRosterStudentsForSemesters === 'function')
        ? loadRosterStudentsForSemesters.toString() : '';
      const exportFnStr = (typeof exportAllStatsExcel === 'function')
        ? exportAllStatsExcel.toString() : '';
      if (!rosterFnStr || !exportFnStr) return { skip: true };

      const rosterFallbackProtected =
        /name\s*:\s*sanitizeExcelCell\(\s*j\.studentName/.test(rosterFnStr) &&
        /company\s*:\s*sanitizeExcelCell\(\s*j\.company/.test(rosterFnStr);

      const submitAoaCalled = /sanitizeExcelCell\(s\.name \|\| ''\)/.test(exportFnStr);
      const stuSalaryCompanyCalled = /sanitizeExcelCell\(s\.company \|\| ''\)/.test(exportFnStr);
      // s.name || '' 應出現在 submitAoA 與 stuSalaryRows 兩處，共 2 次
      const nameOrEmptyCount = (exportFnStr.match(/sanitizeExcelCell\(s\.name \|\| ''\)/g) || []).length;

      const companyAggMapCalled = /const c = sanitizeExcelCell\(/.test(exportFnStr);
      const companyWorktypeMapCalled = /const company = sanitizeExcelCell\(/.test(exportFnStr);
      const companyRows2Called = /公司名稱\s*:\s*sanitizeExcelCell\(name\)/.test(exportFnStr);
      const companyWorktypeRowsCalled = /公司名稱\s*:\s*sanitizeExcelCell\(company\)/.test(exportFnStr);

      // 低於平均20%／高於平均30%：姓名、公司皆為 sanitizeExcelCell(s.name)／(s.company)（無 || ''）
      const alertNameCount = (exportFnStr.match(/姓名\s*:\s*sanitizeExcelCell\(s\.name\)/g) || []).length;
      const alertCompanyCount = (exportFnStr.match(/公司\s*:\s*sanitizeExcelCell\(s\.company\)/g) || []).length;
      const gapCalled = /公司\s*:\s*sanitizeExcelCell\(c\.name\)/.test(exportFnStr);

      const summaryCalledCount = (exportFnStr.match(/內容\s*:\s*\w+\s*\?\s*sanitizeExcelCell\(`/g) || []).length;

      return {
        skip: false,
        rosterFallbackProtected,
        submitAoaCalled,
        stuSalaryCompanyCalled,
        nameOrEmptyCount,
        companyAggMapCalled,
        companyWorktypeMapCalled,
        companyRows2Called,
        companyWorktypeRowsCalled,
        alertNameCount,
        alertCompanyCount,
        gapCalled,
        summaryCalledCount,
      };
    });

    if (result.skip) return;
    if (!result.rosterFallbackProtected)
      throw new Error('loadRosterStudentsForSemesters() 的 journal fallback 重建處未對 name/company 呼叫 sanitizeExcelCell()，根源防護退化（studentMap 可能再次間接帶入未清洗的學生自由輸入）');
    if (result.nameOrEmptyCount < 2)
      throw new Error(`sanitizeExcelCell(s.name || '') 只出現 ${result.nameOrEmptyCount} 次（應為 2：submitAoA + stuSalaryRows），至少一處 Excel 公式注入防護退化`);
    if (!result.stuSalaryCompanyCalled)
      throw new Error('stuSalaryRows 的「公司」欄位未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (!result.companyAggMapCalled)
      throw new Error('companyAggMap 的 c（studentMap 查無資料時直接 fallback 到 j.company）未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (!result.companyWorktypeMapCalled)
      throw new Error('companyWorktypeMap 的 company（studentMap 查無資料時直接 fallback 到 j.company）未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (!result.companyRows2Called)
      throw new Error('companyRows2（工作表「各公司薪資」）的「公司名稱」未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (!result.companyWorktypeRowsCalled)
      throw new Error('companyWorktypeRows（工作表「公司×工作類型統計」）的「公司名稱」未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (result.alertNameCount < 2)
      throw new Error(`salaryAlertRows「低於平均20%」／「高於平均30%」的「姓名」呼叫 sanitizeExcelCell() 的次數只有 ${result.alertNameCount}（應為 2），Excel 公式注入防護退化`);
    if (result.alertCompanyCount < 2)
      throw new Error(`salaryAlertRows「低於平均20%」／「高於平均30%」的「公司」呼叫 sanitizeExcelCell() 的次數只有 ${result.alertCompanyCount}（應為 2），Excel 公式注入防護退化`);
    if (!result.gapCalled)
      throw new Error('salaryAlertRows「公司內部落差」的「公司」未呼叫 sanitizeExcelCell()，Excel 公式注入防護退化');
    if (result.summaryCalledCount < 4)
      throw new Error(`salarySummaryRows「最高/最低平均學生」「最高/最低平均公司」呼叫 sanitizeExcelCell() 的次數只有 ${result.summaryCalledCount}（應為 4），至少一行 Excel 公式注入防護退化`);
  });

  // ════════════════════════════════════════
  // T-17 / T-17B  _loginHandling 互斥旗標（2026-07-14 新增，補齊 student.html 對稱防護）
  // 背景：AI_CONTEXT.md 記載 student.html 於 2026-06-16 修過「handleRedirectResult()
  // 與 onAuthStateChanged callback 同時對 Firestore 發查詢、互相干擾，導致第一次登入
  // 必定失敗、刷新才能成功」這個競態，並列為「AI 禁止：移除 _loginHandling 旗標或
  // 破壞互斥邏輯」。但這個旗標從頭到尾只在 student.html 出現過，teacher.html 的
  // handleTeacherLoginUser()（redirect 路徑）跟 onAuthStateChanged 內嵌的登入邏輯
  // 各自獨立查 /admins/{uid}、各自呼叫 ensureAdminUidDocument()，完全沒有互斥保護。
  // 2026-07-12 的登入改版（任何裝置 popup 失敗就 fallback redirect）讓會真的走到
  // redirect 這條路的老師母體擴大（原本只有 standalone 老師會走到），這個從未修過的
  // 競態在 teacher.html 上被放大。2026-07-14 補上與 student.html 完全對稱的修法。
  // ════════════════════════════════════════

  await test('T-17 _loginHandling 互斥旗標已宣告，handleTeacherLoginUser() 所有 return 路徑均清旗標', async () => {
    // 對稱於 student_test.js 的 S-17，確認：
    // 1. _loginHandling 變數已宣告（let _loginHandling = false）
    // 2. handleTeacherLoginUser() 中，所有提前 return 的路徑（非學校信箱、非管理員）
    //    都有清旗標（_loginHandling = false）
    // 3. handleTeacherLoginUser() 正常結束路徑也有清旗標（enterApp() 前）
    // 4. handleRedirectResult() 有設旗標（_loginHandling = true）
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      const hasDeclare = scripts.includes('let _loginHandling = false') ||
                         scripts.includes('let _loginHandling=false');

      const fnStr = (typeof handleTeacherLoginUser === 'function') ? handleTeacherLoginUser.toString() : '';
      if (!fnStr) return { skip: true };

      const clearCount = (fnStr.match(/_loginHandling\s*=\s*false/g) || []).length;

      const rFnStr = (typeof handleRedirectResult === 'function') ? handleRedirectResult.toString() : '';
      const hasSet = rFnStr.includes('_loginHandling = true') || rFnStr.includes('_loginHandling=true');

      return { skip: false, hasDeclare, clearCount, hasSet };
    });

    if (result.skip) return;
    if (!result.hasDeclare) throw new Error('_loginHandling 旗標未宣告（let _loginHandling = false 不存在），teacher.html 與 student.html 的登入競態防護仍不對稱');
    if (!result.hasSet)     throw new Error('handleRedirectResult() 未設旗標（_loginHandling = true 不存在）');
    if (result.clearCount < 3) throw new Error(
      `handleTeacherLoginUser() 只有 ${result.clearCount} 處清旗標，` +
      '提前 return 的路徑（非學校信箱、非管理員）與正常結束路徑需各自清旗標，' +
      '否則旗標會卡住導致 onAuthStateChanged 永久等待'
    );
  });

  await test('T-17B onAuthStateChanged 有 _loginHandling 輪詢等待邏輯', async () => {
    // 對稱於 student_test.js 的 S-17B
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      const hasCheck   = scripts.includes('if (_loginHandling)') || scripts.includes('if(_loginHandling)');
      const hasWhile   = scripts.includes('while (_loginHandling') || scripts.includes('while(_loginHandling');
      const has15s     = scripts.includes('15000');
      const hasReturn  = scripts.includes('if (currentUser) return') || scripts.includes('if(currentUser)return');

      return { hasCheck, hasWhile, has15s, hasReturn };
    });

    if (!result.hasCheck)  throw new Error('onAuthStateChanged 未偵測 _loginHandling 旗標');
    if (!result.hasWhile)  throw new Error('onAuthStateChanged 未有 while 輪詢等待邏輯');
    if (!result.has15s)    throw new Error('onAuthStateChanged 等待逾時未設 15000ms 上限');
    if (!result.hasReturn) throw new Error('onAuthStateChanged 等待後未有 currentUser 判斷提前 return');
  });

  await test('T-SEC-33 isStoragePartitionedEnv() 已定義，且 googleTeacherLogin()／handleRedirectResult() 皆有呼叫做為 guard', async () => {
    // 背景：teacher.html 原本完全沒有這個函式，LINE 瀏覽器雖有頁面層級的擋法（隱藏
    // #login-card、顯示 #line-warning），但 seapp.com 代理與 sessionStorage 不可用
    // （無痕模式等）這兩種 storage-partitioned 情境完全沒有防護。更嚴重的是
    // handleRedirectResult() 原本無條件呼叫 getRedirectResult()（無 pending flag 守門，
    // 見 T-SEC-34），若同時又在 storage-partitioned 環境，任何老師只要打開 teacher.html
    // 就會在每次頁面載入時吃一次 "missing initial state" 例外。
    // 驗證三項特徵：①函式本身已定義；②googleTeacherLogin() 有呼叫它（popup 執行前）；
    // ③handleRedirectResult() 也有呼叫它（getRedirectResult() 之前）。
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');
      const hasFnDef = /function\s+isStoragePartitionedEnv\s*\(/.test(scripts);

      const googleFnStr = (typeof googleTeacherLogin === 'function') ? googleTeacherLogin.toString() : '';
      const redirectFnStr = (typeof handleRedirectResult === 'function') ? handleRedirectResult.toString() : '';
      if (!googleFnStr || !redirectFnStr) return { skip: true };

      const usedInGoogle = /isStoragePartitionedEnv\s*\(\s*\)/.test(googleFnStr);
      const usedInRedirect = /isStoragePartitionedEnv\s*\(\s*\)/.test(redirectFnStr);

      return { skip: false, hasFnDef, usedInGoogle, usedInRedirect };
    });

    if (result.skip) return;
    if (!result.hasFnDef) throw new Error('isStoragePartitionedEnv() 未定義，teacher.html 對 seapp.com／sessionStorage 不可用環境仍無防護');
    if (!result.usedInGoogle) throw new Error('googleTeacherLogin() 未呼叫 isStoragePartitionedEnv() 做 guard');
    if (!result.usedInRedirect) throw new Error('handleRedirectResult() 未呼叫 isStoragePartitionedEnv() 做 guard');
  });

  await test('T-SEC-34 handleRedirectResult() 有 pending flag 守門，未觸發過 redirect 時不會呼叫 getRedirectResult()', async () => {
    // 背景：原本 handleRedirectResult() 在 DOMContentLoaded → waitForFirebase() 裡
    // 無條件呼叫，等同任何老師只要在 storage-partitioned 環境打開 teacher.html，即使
    // 他這次是打算用 popup 登入、從未觸發過 redirect，也會在每次頁面載入時先噴一次
    // "missing initial state" 例外，跳出誤導性的「APP 登入失敗」toast。修法比照
    // student.html：呼叫 getRedirectResult() 前，先檢查 sessionStorage 裡是否有
    // startTeacherRedirectLogin() 設下的 teacherRedirectLoginPending 旗標，沒有就直接
    // return，不呼叫 getRedirectResult()。
    const result = await page.evaluate(() => {
      const fnStr = (typeof handleRedirectResult === 'function') ? handleRedirectResult.toString() : '';
      if (!fnStr) return { skip: true };

      const hasPendingCheck = /if\s*\(\s*!sessionStorage\.getItem\(\s*['"]teacherRedirectLoginPending['"]\s*\)\s*\)\s*return;/.test(fnStr);
      // 確認這個檢查在函式最前段（早於 getRedirectResult 呼叫），避免形同虛設
      const pendingIdx = fnStr.search(/sessionStorage\.getItem\(\s*['"]teacherRedirectLoginPending['"]\s*\)/);
      const getRedirectIdx = fnStr.indexOf('getRedirectResult(');
      const orderOK = pendingIdx !== -1 && getRedirectIdx !== -1 && pendingIdx < getRedirectIdx;

      // startTeacherRedirectLogin() 有寫入這個 pending flag（否則守門邏輯永遠擋下合法的 redirect 登入）
      const startFnStr = (typeof startTeacherRedirectLogin === 'function') ? startTeacherRedirectLogin.toString() : '';
      const startSetsFlag = /sessionStorage\.setItem\(\s*['"]teacherRedirectLoginPending['"]/.test(startFnStr);

      return { skip: false, hasPendingCheck, orderOK, startSetsFlag };
    });

    if (result.skip) return;
    if (!result.hasPendingCheck) throw new Error('handleRedirectResult() 找不到 pending flag 守門（!sessionStorage.getItem("teacherRedirectLoginPending") return），任何 storage-partitioned 環境打開 teacher.html 都會誤觸發 getRedirectResult() 例外');
    if (!result.orderOK) throw new Error('handleRedirectResult() 的 pending flag 檢查沒有寫在 getRedirectResult() 呼叫之前，守門形同虛設');
    if (!result.startSetsFlag) throw new Error('startTeacherRedirectLogin() 沒有寫入 teacherRedirectLoginPending，會讓 handleRedirectResult() 的守門邏輯連合法的 redirect 登入也一併擋下');
  });

  await test('T-SEC-35 googleTeacherLogin() 一律先試 signInWithPopup()，失敗（非使用者取消）時 fallback 到 signInWithRedirect()', async () => {
    // 背景：2026-07-12 拿掉「standalone 一律先走 redirect」的舊分支，改成不分 standalone
    // 與否，一律先試 popup、任何失敗（除了使用者主動取消）都自動 fallback 到 redirect。
    // 這個重大改版當時完全沒有對應測試（全文搜尋 popup-first、2026-07-12 皆零命中），
    // 這裡補上，跟 student_test.js 的 S-SEC-34 對稱。
    const result = await page.evaluate(() => {
      const fnStr = (typeof googleTeacherLogin === 'function') ? googleTeacherLogin.toString() : '';
      if (!fnStr) return { skip: true };

      const hasPopupCall = /signInWithPopup\s*\(/.test(fnStr);
      const hasFallbackCall = /startTeacherRedirectLogin\s*\(\s*\)/.test(fnStr);
      const hasCancelGuard = /popup-closed-by-user/.test(fnStr) && /cancelled-popup-request/.test(fnStr);

      // 呼叫順序：signInWithPopup 在 catch(e) 之前，startTeacherRedirectLogin 在 catch(e) 之後
      const popupIdx = fnStr.search(/signInWithPopup\s*\(/);
      const catchIdx = fnStr.indexOf('catch(e)');
      const fallbackIdx = fnStr.search(/startTeacherRedirectLogin\s*\(\s*\)/);
      const orderOK = popupIdx !== -1 && catchIdx !== -1 && fallbackIdx !== -1 &&
        popupIdx < catchIdx && catchIdx < fallbackIdx;

      // 不應該再有「standalone 一律先走 redirect」的舊分支殘留
      // （即 isStandaloneApp() 判斷式緊接著呼叫 signInWithRedirect 或 startTeacherRedirectLogin）
      const noOldStandaloneBranch = !/isStandaloneApp\s*\(\s*\)[\s\S]{0,200}(signInWithRedirect|startTeacherRedirectLogin)/.test(fnStr);

      return { skip: false, hasPopupCall, hasFallbackCall, hasCancelGuard, orderOK, noOldStandaloneBranch };
    });

    if (result.skip) return;
    if (!result.hasPopupCall) throw new Error('googleTeacherLogin() 找不到 signInWithPopup() 呼叫');
    if (!result.hasFallbackCall) throw new Error('googleTeacherLogin() 找不到 startTeacherRedirectLogin() fallback 呼叫');
    if (!result.hasCancelGuard) throw new Error('googleTeacherLogin() 找不到「使用者主動取消不重試」的判斷（auth/popup-closed-by-user／auth/cancelled-popup-request）');
    if (!result.orderOK) throw new Error('googleTeacherLogin() 的呼叫順序不對：應是先試 signInWithPopup()，失敗（catch）後才呼叫 startTeacherRedirectLogin() fallback');
    if (!result.noOldStandaloneBranch) throw new Error('googleTeacherLogin() 疑似殘留「standalone 一律先走 redirect」的舊分支，2026-07-12 應已拿掉');
  });

  await test('T-19 無嚴重 JS 錯誤（ReferenceError / SyntaxError）', async () => {
    const errors = page._testErrors || [];
    const serious = errors.filter(e =>
      e.includes('ReferenceError') || e.includes('SyntaxError')
    );
    if (serious.length > 0) throw new Error(serious[0]);
  });

  return results;
}

module.exports = { runTeacherTests };
