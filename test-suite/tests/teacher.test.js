/**
 * tests/teacher.test.js
 * 老師端自動化測試 v29
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-07-02，本次測試補強對應 2026-07-06 推播子系統）
 *
 * v29 新增（2026-08-11）：對應「薪資缺漏」新增依月份分組＋複製功能，分兩輪完成：
 *
 * 【第一輪】新增共用函式 computeSalaryMissingGroups()（依真正的西元年月分組，避免查詢
 * 區間橫跨學年時同一個月份數字被誤合併）、renderSalaryMissingGroupedHtml()（畫面清單，
 * 月份標題列＋加粗分隔線）、copySalaryMissingList()（比照 copyOverdueList()，只複製座號、
 * 依複製範圍下拉選單篩選單一月份或全部）；「薪資缺漏」box 拆成獨立整行卡片（.salary-alert-box
 * .full-width，grid-column:1/-1），標題列加上複製範圍下拉選單＋複製按鈕。
 *
 * 【第二輪】使用者確認後追加三項調整：①`.salary-alert-grid` 改成固定 `repeat(3,
 * minmax(0,1fr))`，讓另外3個清單（低於平均20%／公司內部落差／高於平均30%）永遠等寬平分
 * （原本 `repeat(auto-fit, minmax(250px,1fr))` 在容器寬度不是250px整數倍時三欄寬度會
 * 不一致），手機版（≤768px）加對應覆寫改回單欄；②「薪資缺漏」從 boxes 陣列最後面搬到
 * 最前面（畫面上獨立整行、排最上層），下層依左至右改為公司內部落差／低於平均20%／
 * 高於平均30%；③`computeSalaryMissingGroups()` 排序方向從「舊到新」改成「新到舊」——
 * 跟「已逾期未達標」（依月份由小到大）刻意不同：那邊是「越早逾期越該優先處理」，這裡是
 * 「老師通常最關心最近一次的繳交狀況」，複製範圍下拉選單與複製文字的月份區塊順序皆共用
 * 同一份已排序資料，不需要另外處理。CSS 變動（①）純屬視覺呈現，本輪未新增對應測試，
 * 列為已知缺口（比照 2026-08-06 面板改版當時的既有處理方式）；②③則直接反映在下面兩條
 * 新測試裡。
 *
 * 新增：
 *   T-SEC-50  computeSalaryMissingGroups()／renderSalaryMissingGroupedHtml() 直接呼叫
 *             函式本體帶合成資料驗證：不同學年同一個月份數字不會被誤合併成同一組、依
 *             「新到舊」排序（含核心目標情境：同一年內月份較大的排較前面、1月跨年與
 *             第2學期隔年的換算公式套用正確）、組內依座號排序；renderSalaryMissingGroupedHtml()
 *             輸出含月份標題列與分組容器 class（供加粗分隔線樣式使用）、每筆項目只顯示
 *             公司名稱不重複月份文字；renderSalaryAlerts() 已改呼叫這兩個共用函式、把
 *             分組結果存進 window._salaryMissingGroups、full-width class 與複製按鈕皆
 *             存在、且「薪資缺漏」在 boxes 陣列裡排最前面。
 *   T-SEC-51  copySalaryMissingList() 直接呼叫函式本體（暫時注入一個獨立的
 *             #salary-missing-copy-scope select，測試結束後移除，不依賴「薪資統計」
 *             頁籤真的跑過查詢），驗證複製文字只有座號不含姓名、依 window._salaryMissingGroups
 *             既有順序輸出月份區塊（不自己另外排序）、複製範圍下拉選單可篩選單一月份。
 *
 * 【T-SEC-43 同步修正（regression fix，不是新發現的問題）】：T-SEC-43 原本檢查
 * `renderSalaryAlerts.toString()` 裡有沒有 `const company = getJournalCompany(j,
 * stuCompanyMap)` 這行呼叫——這是「薪資缺漏」清單當初（重構前）寫在 renderSalaryAlerts()
 * 內部的 missingItems() 區域函式裡的邏輯。第一輪重構把這段邏輯搬進新的頂層函式
 * computeSalaryMissingGroups() 後，renderSalaryAlerts() 字串裡已經找不到這行，導致
 * T-SEC-43 在正式環境真的跑出失敗（2026-08-11 test-report.txt：老師端 71/72，唯一
 * 失敗項正是 T-SEC-43）——**這不是 getJournalCompany()／薪資缺漏歸屬邏輯本身壞掉**，
 * 是函式搬家後測試檢查的目標沒有跟著搬，跟 T-SEC-43 自己 v25 那次「stuCompanyMap key
 * 格式改變、fixture 沒跟上」是同一類「修改共用函式時要盤點有哪些測試直接讀它原始碼」的
 * 教訓（陷阱24／25）。修法：檢查目標改成 `computeSalaryMissingGroups.toString()`，其餘
 * 斷言（journalWins／rosterFallback／bothMissingFallback／salaryUsesSharedFn／
 * salaryNoDuplicateLogic）完全不受影響，`getJournalCompany()` 邏輯本身從頭到尾正確
 * 無誤。
 *
 * v28 新增（2026-08-08）：對應「刪除操作二次確認」——deleteStudent()／單筆刪月記／批次刪
 * 月記共 5 處「無法復原」的刪除流程，新增輸入姓名或固定格式字串才能刪除的第二層確認，
 * 源自使用者指出這批操作完全沒有任何復原機制（真刪除，無回收站）。student.html 兩處
 * （單筆刪月記、批次刪歷史月記）由本文件姊妹檔 student_test.js 的 S-SEC-43 涵蓋；本檔
 * 新增：
 *   T-SEC-49  deleteStudent() 從 confirm() 改成單一 prompt()（警告文字＋姓名輸入要求
 *             合併在同一段），驗證確實要求輸入完全等於該生姓名才會繼續、且舊版 confirm()
 *             寫法真的不在了（regression check）；confirmDeleteJournal()（單筆刪月記）
 *             改用 requiredText = studentName（呼叫端本來就有帶目標學生姓名，直接用
 *             參數即可，跟 student.html 那份改用 currentUser?.name 的理由不同——見
 *             S-SEC-43 header 說明）；confirmTeacherBatchDelete()（批次刪月記，可能
 *             橫跨多位學生）改用 requiredText = `DELETE ${journals.length}`（不用姓名，
 *             因為批次可能沒有單一對象）。三者皆驗證「按下確認鍵時才檢查、不符合就不
 *             執行刪除」的順序關係，並確認對應 Modal 的輸入框／提示文字 DOM 元素存在。
 *
 * v27 新增（2026-08-05）：對應學生端薪資單由單張 salaryPhoto 改為 salaryPhotos 陣列：
 *   T-SEC-48  新舊資料格式皆可讀取，localStorage 快取會移除兩種 Base64 欄位而保留照片
 *             張數，老師按需載入、月記卡片與 PDF 匯出皆會顯示所有薪資單。
 *
 * v26 新增（2026-07-25）：對應 2026-07-24「遲交」判斷修正（isJournalLate() 改用
 * entriesCompleteAt || submittedAt，取代直接用 submittedAt）補上自動化測試——當時
 * AI_CONTEXT.md 明確記載「本輪未新增自動化測試，列為已知缺口」。isJournalLate() 本身
 * 已經是乾淨的獨立函式，不需要像 student.html 那樣先重構才能測：
 *   T-SEC-47  isJournalLate() 直接呼叫函式本體帶合成資料，驗證 entriesCompleteAt 優先於
 *             submittedAt（含核心目標情境「entriesCompleteAt遲交、submittedAt若被誤讀
 *             會判準時」）、entriesCompleteAt 為 null／欄位不存在兩種情況皆正確退回用
 *             submittedAt；並用 statusSymbolForJournal() 端對端驗證目標情境本身（篇數
 *             達標、submittedAt準時、entriesCompleteAt遲交 → 應顯示▲）；另外兩項回歸
 *             確認 isJournalComplete()／statusSymbolForJournal() 沒有被這次修改牽動
 *             （isJournalComplete() 完全不提 entriesCompleteAt，statusSymbolForJournal()
 *             仍然是先擋 isJournalComplete() 才判斷 isJournalLate()，順序沒有被調換）
 *
 * v25（2026-07-23，同一輪對話延伸）：
 * ①T-SEC-45 補齊第四處——`loadSalaryStats()` 自己的
 * `stuCompanyMap`／`stuInfoMap` 先前不在範圍內（原本使用者只點名 loadLocationStats()／
 * loadWorkTypeStats()／fetchJournalsFromServer() 三處），這次確認一併補上，`getJournalCompany()`
 * 讀取時同步改用學期＋座號 key。
 * ②連帶修正 T-SEC-43 本身的測試固定資料（fixture）：`getJournalCompany()` 改成讀取
 * `stuCompanyMap[\`${j.semester}-${j.seatNo}\`]`（複合 key）後，T-SEC-43 原本 mock 的
 * `stuCompanyMap = { '12': ... }`（裸座號）與月記物件（沒有 `semester` 欄位）就對不上
 * 新的 key 格式，導致「備援情境」那個斷言（月記完全沒有 company 時應退回名冊值）在
 * GitHub Actions 上真的跑出失敗（真實 Playwright 執行結果：老師端 68/69，唯一失敗項
 * 正是 T-SEC-43 這條）。**這不是 `getJournalCompany()` 本身的邏輯錯誤**——production
 * 環境的月記文件一定有 `semester` 欄位，只有這條測試自己手刻的 mock 資料沒補上，是
 * 測試固定資料沒跟著新的 key 格式同步更新（跟本專案先前「新增 seatNo 必填驗證後測試
 * 固定資料未同步補欄位」是同一類問題）。修法：`stuCompanyMap` 改成
 * `{ '115-1-12': ... }`，三個 mock 月記物件都補上 `semester: '115-1'`。已用實際
 * `normalizeCompanyName()`／`getJournalCompany()` 邏輯在 Node 裡重新跑過這三個斷言，
 * 確認修正後全數為 true。測試數量不變（仍是「新增4條、修正1條」，T-SEC-45 是延伸範圍
 * 不是新測試，T-SEC-43 是修正既有測試的固定資料不是新增）。
 *
 * v24 新增／修正（2026-07-23）：對應同一輪對話發現並修正的「換公司後薪資統計/公司篩選清單
 * 出現學生消失／舊公司殘留」問題（起因：徐偉哲12號從沙鹿冷氣換到金華節能空調後，7月薪資
 * 記錄從「統計總覽→薪資統計」消失，但 Excel 匯出跟 Firebase 實際文件都正常）。新增 4 條、
 * 修正 1 條既有測試：
 *   T-SEC-43  getJournalCompany() 改為月記優先於名冊備援（直接呼叫函式驗證，含
 *             loadSalaryStats()／renderSalaryAlerts() 皆已改呼叫共用函式，不再各自
 *             重複維護一份「名冊優先」判斷）——這是根本修正，其餘測試都是圍繞這個修法
 *             的周邊一致性檢查
 *   T-SEC-44  地點／薪資／工作類型三個統計頁籤的公司篩選清單，都改成從「目前日期範圍內
 *             的月記」自己的 company 建立，不再讀取整個 /students 集合；loadWorkTypeStats()
 *             補上跟另外兩個統計一致的 populateCompanyFilter() 呼叫，不再讓篩選清單完全
 *             依賴「地點統計／薪資統計哪一個先跑完」這個競態
 *   T-SEC-45  loadLocationStats()／loadWorkTypeStats()／fetchJournalsFromServer()／
 *             loadSalaryStats() 的名冊備援 studentMap／stuCompanyMap／stuInfoMap 皆改用
 *             「學期＋座號」當 key（比照 exportAllStatsExcel() 既有寫法），不再用裸座號
 *             合併整個 /students 集合（loadSalaryStats() 這第4處是 v25 才補齊，見上方）
 *   T-SEC-46  exportAllStatsExcel() 五處公司欄位（locationRows／salaryRows／薪資缺漏／
 *             各公司薪資分組／各公司工作類型分組）統一改為月記優先，跟「統計總覽」三頁籤
 *             的邏輯一致
 *   T-SEC-40  修正既有測試本身「時好時壞」的第二次競態條件（2026-07-18 第一次修法本身
 *             不夠可靠）：原本靠等待全站共用的 #loading-overlay 重新隱藏來判斷
 *             loadTeacherDashboard() 是否跑完，但這個元素全檔至少 52 處呼叫，任何無關的
 *             背景動作都可能讓這個快照式檢查提早通過，完全沒等到「這次」的背景載入真正
 *             結束。改成先清空 window._missingWithCount，再直接等待它變回真正的陣列——
 *             因為全檔只有 loadTeacherDashboard() 內部那一行會寫入它，不會被其他函式的
 *             loading 遮罩開關或「巧合殘留的舊值」誤觸發。測試數量不變（修正既有測試，
 *             非新增）。
 *
 * v23 新增（2026-07-17）：對應 teacher.html／student.html 新增「每月最少應繳篇數
 * （minEntries）」概念後，補齊的一批回歸測試——背景是使用者實測發現「統計總覽→繳交狀況」
 * 頁籤與 Excel 匯出只看「月記文件存不存在」，跟老師主頁（2026-07-16 起已改用篇數判斷）標準
 * 不一致（同一位學生同一個月，主頁顯示未繳、統計總覽卻顯示✓已繳），連帶又發現主頁自己內部
 * 「本月已繳」統計卡片跟「本月已繳名單」面板兩者標準也不一致。這批測試盡量直接呼叫真正的
 * 函式本體帶入合成資料驗證行為，而非只做原始碼字串比對（可以做到的地方就不只做靜態分析）：
 *   T-SEC-36  resolveMinEntries()／isJournalComplete() 篇數判斷邏輯正確（直接呼叫函式驗證）
 *   T-SEC-37  statusSymbolForJournal() 篇數不足回傳新符號△，不再跟已達標的✓混淆
 *   T-SEC-38  loadSubmitStats()／exportAllStatsExcel() 皆改用 isJournalComplete() 判斷已繳，
 *             避免其中一處日後被單獨改動又跟另一處或主頁脫鉤
 *   T-SEC-39  「截止日期設定」快速套用新增「最少應繳篇數」子區塊 C，
 *             applyBatchMinEntries() 邏輯正確（含避免覆蓋已填日期、避免存檔時被略過的陷阱）
 *   T-SEC-40  copyMissingList() 複製到剪貼簿的文字不含姓名，只留座號＋篇數註記
 *             （直接餵入合成資料呼叫真正的函式、攔截 clipboard 寫入驗證，而非只看原始碼）
 *   T-SEC-41  window._statLists.submitted（本月已繳名單面板）改用 completeSeats 篩選，
 *             避免跟「本月已繳」統計卡片矛盾（同一頁面「已繳0人」但「已繳名單」列出好幾人）
 *
 * v22 修正（2026-07-14，同日 v21 上線後立即發現的測試本身缺陷，非新增測試，數量不變）：
 *   T-SEC-34  修正假失敗：getRedirectIdx 原本用裸字串 fnStr.indexOf('getRedirectResult(')
 *             尋找呼叫位置，命中的其實是函式最上面解釋性註解裡提到這個名字的地方，遠早於
 *             真正的呼叫語句（await getRedirectResult(auth)），導致 orderOK 誤判為 false。
 *             這是 S-SEC-08／T-SEC-30／S-SEC-29 已經記錄過好幾次的同一種陷阱（regex／
 *             字串搜尋命中函式內部解釋性註解）第一次在 T-SEC-34 上重演——teacher.html
 *             的程式碼本身完全正確，是測試比對方式不夠精確。修法：改用
 *             fnStr.search(/await\s+getRedirectResult\s*\(\s*auth\s*\)/) 錨定實際呼叫語法。
 *   T-SEC-35  補強 noOldStandaloneBranch 這條負向檢查：原本直接對整段函式字串（含註解）
 *             做鄰近字元搜尋，目前是僥倖通過（isStandaloneApp() 附近的中文說明剛好沒有
 *             直接寫出 signInWithRedirect／startTeacherRedirectLogin 這兩個字面詞，但講的
 *             內容正是這件事本身，未來改註解措辭很容易不小心撞在一起）。修法：先過濾掉
 *             「整行都是註解」的行，只在剩餘程式碼行上做鄰近搜尋，避免未來注釋內容變化
 *             導致正確程式碼被誤判為退化。
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

      // 2026-07-14 修正：getRedirectIdx 原本用裸字串 fnStr.indexOf('getRedirectResult(')
      // 尋找呼叫位置，命中的其實是函式最上面解釋性註解裡提到「getRedirectResult()」這個
      // 字串本身的地方（第113字元附近），比真正的呼叫語句（await getRedirectResult(auth)，
      // 第1384字元附近）早了超過1000字元，導致 orderOK 誤判為 false——這是 S-SEC-08／
      // T-SEC-30／S-SEC-29 已經記錄過好幾次的同一種陷阱（regex／字串搜尋命中函式內部的
      // 解釋性註解），這次在 T-SEC-34 上第一次重演。teacher.html 的程式碼本身沒有問題，
      // pending flag 檢查確實寫在真正的 getRedirectResult() 呼叫之前，是這條測試的比對
      // 方式不夠精確。修法：改用 search() 錨定實際呼叫語法（await getRedirectResult(auth)），
      // 只會命中真正的呼叫語句，不會誤命中提及這個名字的註解文字。
      const hasPendingCheck = /if\s*\(\s*!sessionStorage\.getItem\(\s*['"]teacherRedirectLoginPending['"]\s*\)\s*\)\s*return;/.test(fnStr);
      // 確認這個檢查在函式最前段（早於 getRedirectResult 呼叫），避免形同虛設
      const pendingIdx = fnStr.search(/sessionStorage\.getItem\(\s*['"]teacherRedirectLoginPending['"]\s*\)/);
      const getRedirectIdx = fnStr.search(/await\s+getRedirectResult\s*\(\s*auth\s*\)/);
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

      // 2026-07-14 修正：這條負向檢查（確認舊分支「不存在」）原本直接對整段函式字串
      // （含註解）做鄰近字元搜尋，屬於僥倖通過——目前 isStandaloneApp() 附近 200 字內的
      // 中文說明剛好沒有直接寫出 signInWithRedirect／startTeacherRedirectLogin 這兩個
      // 英文字面詞，但這幾行註解講的內容正是「為什麼不再用 redirect」這件事本身，未來
      // 改註解措辭時很容易不小心把這兩個詞寫進 200 字窗口內，導致這條測試在程式碼完全
      // 正確的情況下無端失敗——跟 T-SEC-34 的 getRedirectIdx 是同一類陷阱（S-SEC-08／
      // T-SEC-30／S-SEC-29 也踩過），只是這次剛好還沒真的爆炸。修法：先過濾掉「整行都是
      // 註解」的行（trim 後以 // 開頭），只在剩餘的程式碼行上做鄰近搜尋，這樣即使未來
      // 註解怎麼寫都不會被誤判，只有真正的程式碼結構（例如舊分支被重新加回來）才會被抓到。
      const codeOnlyLines = fnStr.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const noOldStandaloneBranch = !/isStandaloneApp\s*\(\s*\)[\s\S]{0,200}(signInWithRedirect|startTeacherRedirectLogin)/.test(codeOnlyLines);

      return { skip: false, hasPopupCall, hasFallbackCall, hasCancelGuard, orderOK, noOldStandaloneBranch };
    });

    if (result.skip) return;
    if (!result.hasPopupCall) throw new Error('googleTeacherLogin() 找不到 signInWithPopup() 呼叫');
    if (!result.hasFallbackCall) throw new Error('googleTeacherLogin() 找不到 startTeacherRedirectLogin() fallback 呼叫');
    if (!result.hasCancelGuard) throw new Error('googleTeacherLogin() 找不到「使用者主動取消不重試」的判斷（auth/popup-closed-by-user／auth/cancelled-popup-request）');
    if (!result.orderOK) throw new Error('googleTeacherLogin() 的呼叫順序不對：應是先試 signInWithPopup()，失敗（catch）後才呼叫 startTeacherRedirectLogin() fallback');
    if (!result.noOldStandaloneBranch) throw new Error('googleTeacherLogin() 疑似殘留「standalone 一律先走 redirect」的舊分支，2026-07-12 應已拿掉');
  });

  // ════════════════════════════════════════
  // T-SEC-36 ～ T-SEC-41　2026-07-17 新增：每月最少應繳篇數（minEntries）
  // ════════════════════════════════════════
  // 背景：teacher.html 主頁（loadTeacherDashboard()）2026-07-16 起已改用
  // 「entries.length >= minEntries」判斷一份月記是否算已繳，但「統計總覽→繳交狀況」頁籤
  // （loadSubmitStats()）與 Excel 匯出（exportAllStatsExcel()）當時仍只看「月記文件存不存在」，
  // 使用者實測發現兩套標準不一致（同一位學生同一個月，主頁顯示「未繳（已交1篇，尚差1篇）」，
  // 統計總覽卻顯示✓已繳）。修正後又從使用者提供的截圖發現主頁自己內部也有同類矛盾——
  // 「本月已繳」統計卡片（completeSeats，篇數需達標）跟「本月已繳名單」面板
  // （window._statLists.submitted，原本是 activeJournals，本月有存檔就算）標準不一致。

  await test('T-SEC-36 resolveMinEntries()／isJournalComplete() 篇數判斷邏輯正確', async () => {
    // 直接呼叫函式本體帶入合成資料驗證，而非只看原始碼字串——這兩個函式都是不依賴 DOM／
    // Firestore 的純函式，可以直接測試行為本身。
    const result = await page.evaluate(() => {
      if (typeof resolveMinEntries !== 'function' || typeof isJournalComplete !== 'function')
        return { skip: true };

      const deadlineMap = { '115-1-7': { minEntries: 2 } };

      const fallbackNoDoc    = resolveMinEntries(undefined) === 1;
      const fallbackNoField  = resolveMinEntries({}) === 1;
      const fallbackZero     = resolveMinEntries({ minEntries: 0 }) === 1;
      const fallbackNonInt   = resolveMinEntries({ minEntries: 1.5 }) === 1;
      const respectsSetValue = resolveMinEntries({ minEntries: 2 }) === 2;

      const noJournal      = isJournalComplete(null, deadlineMap) === false;
      const oneEntryNeedTwo = isJournalComplete({ semester: '115-1', month: 7, entries: [{}] }, deadlineMap) === false;
      const twoEntriesOK    = isJournalComplete({ semester: '115-1', month: 7, entries: [{}, {}] }, deadlineMap) === true;
      const noEntriesField  = isJournalComplete({ semester: '115-1', month: 7 }, deadlineMap) === false;
      const defaultsToOne   = isJournalComplete({ semester: '115-2', month: 3, entries: [{}] }, deadlineMap) === true;

      return {
        skip: false,
        fallbackNoDoc, fallbackNoField, fallbackZero, fallbackNonInt, respectsSetValue,
        noJournal, oneEntryNeedTwo, twoEntriesOK, noEntriesField, defaultsToOne,
      };
    });

    if (result.skip) return;
    if (!result.fallbackNoDoc || !result.fallbackNoField || !result.fallbackZero || !result.fallbackNonInt)
      throw new Error('resolveMinEntries() 對未設定/非法 minEntries 未正確 fallback 為 1');
    if (!result.respectsSetValue)
      throw new Error('resolveMinEntries() 未正確讀出已設定的 minEntries 值');
    if (!result.noJournal)
      throw new Error('isJournalComplete(null,...) 應回傳 false（沒有月記本來就不算完成）');
    if (!result.oneEntryNeedTwo)
      throw new Error('isJournalComplete() 未正確擋下「只交1篇但規定2篇」的情境——這正是本次要修正的核心落差本身');
    if (!result.twoEntriesOK)
      throw new Error('isJournalComplete() 誤判「篇數已達標」的月記為未完成');
    if (!result.noEntriesField)
      throw new Error('isJournalComplete() 對缺少 entries 欄位的月記未視為未完成（應 fallback 為 0 篇）');
    if (!result.defaultsToOne)
      throw new Error('isJournalComplete() 對未設定 minEntries 的月份未 fallback 為預設 1 篇');
  });

  await test('T-SEC-37 statusSymbolForJournal() 篇數不足回傳新符號△，不再跟已達標的✓混淆', async () => {
    // 「統計總覽→繳交狀況」頁籤與 Excel 匯出圖例原本只有 ✓／▲／✗ 三種符號，篇數不足的
    // 月記會被歸類成✓（因為舊版只檢查月記文件存不存在）。新增△獨立顯示，這裡驗證四種
    // 情境的符號都正確。
    const result = await page.evaluate(() => {
      if (typeof statusSymbolForJournal !== 'function') return { skip: true };
      const deadlineMap = { '115-1-7': { minEntries: 2, closeDate: '2026-07-31' } };

      const miss = statusSymbolForJournal(null, deadlineMap) === '✗';
      const incomplete = statusSymbolForJournal(
        { semester: '115-1', month: 7, entries: [{}], submittedAt: '2026-07-10T00:00:00' }, deadlineMap
      ) === '△';
      const doneOnTime = statusSymbolForJournal(
        { semester: '115-1', month: 7, entries: [{}, {}], submittedAt: '2026-07-10T00:00:00' }, deadlineMap
      ) === '✓';
      const doneLate = statusSymbolForJournal(
        { semester: '115-1', month: 7, entries: [{}, {}], submittedAt: '2026-08-10T00:00:00' }, deadlineMap
      ) === '▲';

      return { skip: false, miss, incomplete, doneOnTime, doneLate };
    });

    if (result.skip) return;
    if (!result.miss) throw new Error('沒有月記時應回傳 ✗');
    if (!result.incomplete) throw new Error('篇數不足時應回傳 △，不應仍顯示成 ✓ 已繳（這正是本次要修的落差本身）');
    if (!result.doneOnTime) throw new Error('篇數達標且準時繳交時應回傳 ✓');
    if (!result.doneLate) throw new Error('篇數達標但遲交時應回傳 ▲');
  });

  await test('T-SEC-38 「統計總覽」與「Excel 匯出」皆改用 isJournalComplete() 判斷已繳（避免任一處漏改重現落差）', async () => {
    // 這兩個函式上方都留了提到 isJournalComplete() 這個名字的說明性註解，先過濾掉整行都是
    // 註解的行才做關鍵字搜尋，避免像 S-SEC-08／T-SEC-30／T-SEC-34 那樣 regex 命中的其實是
    // 註解文字本身、而非真正的呼叫語句。
    const result = await page.evaluate(() => {
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const submitStrRaw = (typeof loadSubmitStats === 'function') ? loadSubmitStats.toString() : '';
      const excelStrRaw  = (typeof exportAllStatsExcel === 'function') ? exportAllStatsExcel.toString() : '';
      if (!submitStrRaw || !excelStrRaw) return { skip: true };
      const submitStr = codeOnly(submitStrRaw);
      const excelStr  = codeOnly(excelStrRaw);

      const statsUsesComplete = /isJournalComplete\s*\(/.test(submitStr);
      const excelUsesComplete = /isJournalComplete\s*\([^)]*\)\)\s*submitted\+\+/.test(excelStr);
      const legendHasIncomplete = submitStrRaw.includes('篇數不足');

      return { skip: false, statsUsesComplete, excelUsesComplete, legendHasIncomplete };
    });

    if (result.skip) return;
    if (!result.statsUsesComplete)
      throw new Error('loadSubmitStats() 的儲存格判斷（濾掉註解行後）找不到 isJournalComplete() 呼叫，「繳交狀況」頁籤可能又跟主頁的篇數標準脫鉤');
    if (!result.excelUsesComplete)
      throw new Error('exportAllStatsExcel() 的「已繳/合計」計算（濾掉註解行後）找不到 isJournalComplete() 呼叫，Excel 匯出可能又跟主頁的篇數標準脫鉤');
    if (!result.legendHasIncomplete)
      throw new Error('「繳交狀況」頁籤圖例未提及「篇數不足」，使用者可能看不懂新符號△代表什麼');
  });

  await test('T-SEC-39 「截止日期設定」快速套用新增「最少應繳篇數」子區塊 C，applyBatchMinEntries() 邏輯正確', async () => {
    // 背景：最少篇數（dl-min-{m}）原本只能在③逐月微調表格逐月輸入，這裡新增子區塊 C
    // 可一次套用到整學期所有月份。關鍵陷阱：③逐月微調表格本身刻意不預先帶出已存的開放/
    // 截止日（「整組重填後送出」設計），若只套最少篇數、日期欄位是空的，儲存時會被
    // saveAllDeadlines() 的 `!openRaw && !closeRaw` 邏輯整月跳過——applyBatchMinEntries()
    // 因此需要先讀一次既有期限資料，把已存在的日期一併帶入，這裡一併驗證這個防呆存在。
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('t-deadline'); });
    await waitForPage(page, 't-deadline', 6000);

    const uiCheck = await page.evaluate(() => {
      const input = document.getElementById('batch-min-entries');
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.getAttribute('onclick') === 'applyBatchMinEntries()');
      return { hasInput: !!input, hasButton: !!btn };
    });
    if (!uiCheck.hasInput) throw new Error('找不到 #batch-min-entries 輸入框，快速套用最少篇數的 UI 缺失');
    if (!uiCheck.hasButton) throw new Error('找不到呼叫 applyBatchMinEntries() 的按鈕');

    const fnCheck = await page.evaluate(() => {
      if (typeof applyBatchMinEntries !== 'function') return { skip: true };
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const fnStr = codeOnly(applyBatchMinEntries.toString());
      return {
        skip: false,
        validatesInteger: /Number\.isInteger\(\s*minEntries\s*\)/.test(fnStr),
        fillsAllMonths: fnStr.includes('dl-min-'),
        fetchesExistingDeadlines: /getDocs\s*\(\s*collection\s*\(\s*db\s*,\s*['"]deadlines['"]\s*\)\s*\)/.test(fnStr),
        avoidsOverwritingTypedDates: fnStr.includes('alreadyTyped'),
      };
    });
    if (fnCheck.skip) return;
    if (!fnCheck.validatesInteger)
      throw new Error('applyBatchMinEntries() 未驗證輸入值是否為 >=1 的整數');
    if (!fnCheck.fillsAllMonths)
      throw new Error('applyBatchMinEntries() 找不到套用到 dl-min-{m} 各月輸入框的邏輯');
    if (!fnCheck.fetchesExistingDeadlines)
      throw new Error('applyBatchMinEntries() 未讀取既有的 deadlines 集合，可能導致只填最少篇數、日期空白的月份被 saveAllDeadlines() 略過');
    if (!fnCheck.avoidsOverwritingTypedDates)
      throw new Error('applyBatchMinEntries() 未避免覆蓋畫面上已經填過的開放/截止日欄位');
  });

  await test('T-SEC-40 copyMissingList() 複製到剪貼簿的文字不含姓名，只留座號＋篇數註記', async () => {
    // 背景：複製名單原本連姓名一起複製，手機上不同姓名長度會讓每行對不齊、排版容易顯得亂；
    // 新增 labelNoName 欄位只在複製文字裡使用，畫面上的「本月未繳名單」列表本身完全不受
    // 影響（仍照舊顯示座號＋姓名）。這裡直接餵入合成資料呼叫真正的 copyMissingList()，
    // 攔截 navigator.clipboard.writeText() 檢查複製出來的實際文字內容，而非只做靜態字串比對。
    const hasFn = await page.evaluate(() => typeof copyMissingList === 'function');
    if (!hasFn) return;

    // 2026-07-23 修正（T-SEC-40 間歇性失敗的第二次修正，2026-07-18 那次修法本身不夠）：
    // 先清空 window._missingWithCount，再觸發 showPage('t-dashboard')。理由見下方等待
    // 邏輯的註解——這一步是讓下面「等它變回陣列」的檢查有意義的前提。
    await page.evaluate(() => {
      window._missingWithCount = undefined;
      if (typeof showPage === 'function') showPage('t-dashboard');
    });
    await waitForPage(page, 't-dashboard', 6000);

    // 2026-07-18 第一次修正（真實 bug，非 copyMissingList() 本身的問題）：showPage('t-dashboard')
    // 內部呼叫 loadTeacherDashboard() 是 fire-and-forget（loaders[pageId]() 沒有 await，
    // 見 teacher.html showPage()），waitForPage() 只確認 DOM 的 .hidden class 被拿掉，
    // 完全不保證 loadTeacherDashboard() 的三個 Firestore 集合查詢（Promise.all）已經跑完。
    // 當時的修法是等待 #loading-overlay 重新變回 hidden，才繼續往下設定合成資料。
    //
    // 2026-07-23 第二次修正：上面那個修法本身仍不夠可靠，才是「時好時壞、遇到很多次」的
    // 真正原因——`hideLoading()` 是全站共用同一個 #loading-overlay 元素，全檔至少 52 處
    // 呼叫，任何跟這次 dashboard 載入無關的背景動作（甚至只是先前某次操作殘留、剛好還沒
    // 被下一次 showLoading() 蓋掉的「hidden」狀態）都可能讓這個快照式檢查一開始就通過，
    // 完全沒有真的等到「這次」showPage() 觸發的 loadTeacherDashboard() 跑完——這是比
    // 「完全沒等」更隱蔽的競態，多數情況下巧合仍會等到足夠久，只有少數情況才會提早通過
    // 而失敗，符合使用者回報的「時好時壞」現象。
    // 修法：改成直接等待 window._missingWithCount 本身變回真正的陣列。因為上面已經先把它
    // 清空成 undefined，只有 loadTeacherDashboard() 內部真正執行到寫入這個全域變數那一行
    // （teacher.html 全檔只有這一處會寫入它）才會讓它變回陣列，不會被其他無關函式的
    // loading 遮罩開關誤觸發，也不會被「巧合殘留的舊值」騙過去。
    try {
      await page.waitForFunction(() => Array.isArray(window._missingWithCount), { timeout: 15000 });
    } catch (e) {
      throw new Error('等待 loadTeacherDashboard() 真正完成逾時（window._missingWithCount 15 秒內未變回陣列），可能是背景載入本身卡住或逾時，非本測試邏輯問題');
    }

    const result = await page.evaluate(async () => {
      let captured = null;
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      // 攔截剪貼簿寫入：copyMissingList() 呼叫 navigator.clipboard.writeText(text) 時
      // 同步把 text 存起來（不是在 .then() 回呼裡才存，因為 copyMissingList() 本身沒有
      // await 這個呼叫，用 .then()/.catch() 是 fire-and-forget，若改成非同步存取可能
      // 讀不到值）
      navigator.clipboard.writeText = (text) => { captured = text; return Promise.resolve(); };

      window._missingWithCount = [
        { label: '00 測試學生甲', labelNoName: '00', sno: '00', name: '測試學生甲', missCount: 1, partial: false },
        { label: '01 測試學生乙（已交1篇，尚差1篇）', labelNoName: '01（已交1篇，尚差1篇）', sno: '01', name: '測試學生乙', missCount: 1, partial: true },
      ];
      window._statLists = window._statLists || {};
      window._statLists.missing = window._missingWithCount.map(s => s.label);

      try {
        await copyMissingList();
      } finally {
        navigator.clipboard.writeText = originalWriteText;
      }
      return { captured };
    });

    if (!result.captured)
      throw new Error('copyMissingList() 沒有呼叫 navigator.clipboard.writeText()，可能執行中拋出例外');
    if (result.captured.includes('測試學生甲'))
      throw new Error('複製出來的文字仍包含姓名「測試學生甲」，未依需求移除姓名');
    if (result.captured.includes('測試學生乙'))
      throw new Error('複製出來的文字仍包含姓名「測試學生乙」，未依需求移除姓名');
    if (!result.captured.includes('00'))
      throw new Error('複製出來的文字遺失座號 00');
    if (!result.captured.includes('01（已交1篇，尚差1篇）'))
      throw new Error('複製出來的文字未保留篇數註記（已交1篇，尚差1篇）');
  });

  await test('T-SEC-41 「本月已繳名單」（_statLists.submitted）改用 completeSeats 篩選，避免跟「本月已繳」卡片矛盾', async () => {
    // 背景：loadTeacherDashboard() 原本用 activeJournals（本月有存檔就算，不論篇數）建立
    // window._statLists.submitted（本月已繳名單面板的資料來源），但「本月已繳」統計卡片
    // 本身（stat-submitted）用的是 completeSeats（篇數需達標）——同一頁面會出現「本月已繳」
    // 顯示0，但「本月已繳名單」面板卻列出好幾位只交1篇（規定2篇）學生的矛盾畫面，是使用者
    // 實測截圖發現的真實案例。
    const result = await page.evaluate(() => {
      if (typeof loadTeacherDashboard !== 'function') return { skip: true };
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const fnStr = codeOnly(loadTeacherDashboard.toString());

      const submittedUsesCompleteSeats = /submitted:\s*activeJournals\.filter\(\s*j\s*=>\s*completeSeats\.has\(\s*j\.seatNo\s*\)\s*\)/.test(fnStr);
      const hasPartialFlag = /const\s+partial\s*=\s*thisEntriesCount\s*>\s*0/.test(fnStr);

      return { skip: false, submittedUsesCompleteSeats, hasPartialFlag };
    });

    if (result.skip) return;
    if (!result.submittedUsesCompleteSeats)
      throw new Error('window._statLists.submitted 未用 completeSeats 篩選，可能又跟「本月已繳」統計卡片的篇數標準脫鉤，重現「本月已繳0人但已繳名單列出好幾人」的矛盾畫面');
    if (!result.hasPartialFlag)
      throw new Error('_missingWithCount 的 partial 標記遺失，「本月未繳名單」無法區分「完全沒交」與「有交但篇數不足」兩種狀態');
  });

  await test('T-SEC-42 push-enable-modal 相關函式與 DOM 元素完整存在，maybeShowPushEnableModal() 有登入狀態守門', async () => {
    // 2026-07-17 新增。與 student_test.js 的 S-SEC-38 對稱。#push-enable-modal／
    // maybeShowPushEnableModal()／enablePushFromModal() 是 2026-07-16 新增、目前唯一
    // 決定老師裝置能否收到任何推播的入口（見 AI_推播系統說明.md 第六節 #22），上線後
    // 一直完全沒有自動化測試覆蓋，靠人工實測驗證，缺回歸保護網。比照 T-SEC-31 的模式
    // 補上靜態分析。
    //
    // 同時驗證 2026-07-17 補修的登入狀態守門：maybeShowPushEnableModal() 由 enterApp()
    // 尾端的 setTimeout(...,1500) 排程觸發，若老師在這 1.5 秒窗口內登出，currentUser
    // 可能已被清空，原本沒有檢查會讓彈窗在跟登入狀態不一致的情況下顯示。
    //
    // 四項檢查（與 S-SEC-38 同構）：
    //   1. maybeShowPushEnableModal() 開頭有 currentUser?.uid 守門（本次補修的重點）——
    //      用 codeOnly() 過濾掉整行註解再比對，避免像 S-SEC-08／T-SEC-30／T-SEC-34 那樣
    //      被函式內部解釋性註解誤判命中。
    //   2. enablePushFromModal() 有呼叫 closeModal('push-enable-modal') 與
    //      initPushNotifications()。
    //   3. enterApp() 尾端有 setTimeout(maybeShowPushEnableModal, 1500)。
    //   4. #push-enable-modal 這個 DOM 元素確實存在於頁面上。
    const result = await page.evaluate(() => {
      const hasFns = typeof maybeShowPushEnableModal === 'function'
        && typeof enablePushFromModal === 'function'
        && typeof enterApp === 'function';
      if (!hasFns) return { skip: true };

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const maybeFnStr = codeOnly(maybeShowPushEnableModal.toString());
      const enableFnStr = codeOnly(enablePushFromModal.toString());
      const enterAppFnStr = codeOnly(enterApp.toString());

      const hasLoginGuard = /if\s*\(\s*!currentUser\?\.uid\s*\)\s*return;/.test(maybeFnStr);
      const guardBeforeShow = (() => {
        const guardIdx = maybeFnStr.search(/!currentUser\?\.uid/);
        const showIdx = maybeFnStr.search(/classList\.remove\(\s*['"]hidden['"]\s*\)/);
        return guardIdx !== -1 && showIdx !== -1 && guardIdx < showIdx;
      })();

      const closesModal = /closeModal\(\s*['"]push-enable-modal['"]\s*\)/.test(enableFnStr);
      const callsInit = /initPushNotifications\s*\(\s*\)/.test(enableFnStr);

      const schedulesModal = /setTimeout\(\s*maybeShowPushEnableModal\s*,\s*1500\s*\)/.test(enterAppFnStr);

      const modalElExists = document.getElementById('push-enable-modal') !== null;

      return {
        skip: false,
        hasLoginGuard,
        guardBeforeShow,
        closesModal,
        callsInit,
        schedulesModal,
        modalElExists,
      };
    });
    if (result.skip) return;
    if (!result.hasLoginGuard)
      throw new Error(
        'maybeShowPushEnableModal() 找不到 !currentUser?.uid 登入狀態守門——' +
        '2026-07-17 補修：若老師在 enterApp() 排程的 1.5 秒窗口內登出，' +
        'currentUser 可能已被清空，彈窗理論上仍可能顯示在畫面上'
      );
    if (!result.guardBeforeShow)
      throw new Error('maybeShowPushEnableModal() 的登入狀態守門沒有寫在顯示彈窗（classList.remove(\'hidden\')）之前');
    if (!result.closesModal || !result.callsInit)
      throw new Error('enablePushFromModal() 沒有同時呼叫 closeModal(\'push-enable-modal\') 與 initPushNotifications()');
    if (!result.schedulesModal)
      throw new Error('enterApp() 找不到 setTimeout(maybeShowPushEnableModal, 1500)，彈窗機制的唯一觸發點消失');
    if (!result.modalElExists)
      throw new Error('#push-enable-modal 這個 DOM 元素不存在於頁面上，maybeShowPushEnableModal() 顯示的目標消失了');
  });

  await test('T-SEC-43 getJournalCompany() 改為月記優先於名冊備援，loadSalaryStats()／renderSalaryAlerts() 皆已改呼叫共用函式（12號徐偉哲換公司後從薪資統計消失的根本修正）', async () => {
    // 背景：getJournalCompany() 原本是「名冊優先」（stuCompanyMap[j.seatNo] || j.company），
    // 導致已經換過公司的學生，舊月記也被追溯算成名冊上「目前」登記的那一間；若名冊資料
    // 又混進跨學期同座號的舊格式殘留文件，甚至可能整份查詢結果被歸到查詢範圍內根本不
    // 存在的舊公司、被公司篩選清單排除在外——這正是徐偉哲（12號）7月薪資記錄從「統計
    // 總覽→薪資統計」消失的根本原因。修法：改成「月記自己的 company 優先，名冊只在
    // 月記完全沒填時才當備援」。這裡直接呼叫真正的函式驗證行為，而非只做原始碼字串比對。
    const result = await page.evaluate(() => {
      if (typeof getJournalCompany !== 'function' || typeof normalizeCompanyName !== 'function')
        return { skip: true };

      // 2026-07-23 補修：stuCompanyMap 改用「學期＋座號」複合 key（跟 getJournalCompany()
      // 現在的讀取方式一致，見下方 loadSalaryStats() 那次補齊第4處的修法），mock 的月記
      // 物件也補上 semester 欄位——真實 Firestore 月記文件一定有 semester，這裡原本沒帶
      // 這個欄位單純是因為寫測試當下 getJournalCompany() 還是裸座號查找，這次一併同步。
      const stuCompanyMap = { '115-1-12': '金華節能空調科技有限公司' };

      // 核心情境：月記自己有 company，名冊是不同（更新過）的公司 → 必須以月記為準
      const journalWins = getJournalCompany({ seatNo: '12', semester: '115-1', company: '沙鹿冷氣有限公司' }, stuCompanyMap) === '沙鹿冷氣有限公司';
      // 備援情境：月記完全沒有 company（理論上不該發生的舊資料）→ 才退回名冊
      const rosterFallback = getJournalCompany({ seatNo: '12', semester: '115-1', company: '' }, stuCompanyMap) === '金華節能空調科技有限公司';
      // 兩者皆無資料 → normalizeCompanyName() 的預設值「未填寫」
      const bothMissingFallback = getJournalCompany({ seatNo: '99', semester: '115-1', company: '' }, {}) === '未填寫';

      // loadSalaryStats() 不應再重複維護一份「j.company || getJournalCompany(...)」的判斷，
      // 應直接呼叫共用函式本身——避免同一套邏輯分別寫在兩處、忘記同步。先用 codeOnly()
      // 過濾掉整行都是註解的行再檢查，避開「regex 命中函式內部解釋性註解」這個本專案
      // 已經記錄過好幾次的陷阱（S-SEC-08／T-SEC-30／T-SEC-34 等）。
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const salaryFnStr = (typeof loadSalaryStats === 'function') ? codeOnly(loadSalaryStats.toString()) : '';
      const salaryUsesSharedFn = /company:\s*getJournalCompany\(\s*j\s*,\s*stuCompanyMap\s*\)/.test(salaryFnStr);
      const salaryNoDuplicateLogic = !/company:\s*j\.company\s*\|\|\s*getJournalCompany/.test(salaryFnStr);

      // 2026-08-11 補修：「薪資缺漏」清單原本的 getJournalCompany() 呼叫寫在
      // renderSalaryAlerts() 內部的 missingItems() 這個區域函式裡（當時這條斷言檢查的
      // 就是 renderSalaryAlerts.toString()）；2026-08-11「薪資缺漏依月份分組＋複製」
      // 重構把這段邏輯搬到新的頂層共用函式 computeSalaryMissingGroups()（
      // renderSalaryMissingGroupedHtml() 只負責畫面渲染，不碰 stuCompanyMap），
      // renderSalaryAlerts() 本身現在只是呼叫這個函式取得結果，字串裡已經找不到這行
      // 呼叫——這條測試因此在正式環境跑出「T-SEC-43 失敗」（見 2026-08-11
      // test-report.txt），但不是 getJournalCompany() 邏輯本身壞掉，是函式搬家後測試
      // 檢查的目標沒有跟著搬。修法：改成直接檢查 computeSalaryMissingGroups.toString()
      // ——跟陷阱24（`stuCompanyMap` key 格式改變、測試 fixture 沒跟上）、陷阱25
      // （驗證邏輯抽成共用函式後、依賴讀原始碼字面文字的檢查機制沒跟著看見）是同一類
      // 「修改共用函式時，要盤點有哪些測試直接讀它的原始碼字串」的教訓，詳見
      // AI_測試架構說明.md。
      const missingGroupsFnStr = (typeof computeSalaryMissingGroups === 'function') ? codeOnly(computeSalaryMissingGroups.toString()) : '';
      const alertsUsesSharedFn = /const company = getJournalCompany\(\s*j\s*,\s*stuCompanyMap\s*\)/.test(missingGroupsFnStr);
      const alertsNoOldPattern = !/stuCompanyMap\[j\.seatNo\]\s*\|\|\s*j\.company/.test(missingGroupsFnStr);

      return {
        skip: false, journalWins, rosterFallback, bothMissingFallback,
        salaryUsesSharedFn, salaryNoDuplicateLogic, alertsUsesSharedFn, alertsNoOldPattern,
      };
    });

    if (result.skip) return;
    if (!result.journalWins)
      throw new Error('getJournalCompany() 仍是名冊優先——這正是換過公司的學生從薪資統計消失的根本原因，尚未修正');
    if (!result.rosterFallback)
      throw new Error('getJournalCompany() 在月記完全沒有 company 時，未正確退回名冊備援值');
    if (!result.bothMissingFallback)
      throw new Error('getJournalCompany() 兩者皆無資料時，未正確 fallback 為「未填寫」');
    if (!result.salaryUsesSharedFn)
      throw new Error('loadSalaryStats() 未直接呼叫 getJournalCompany() 設定 company 欄位');
    if (!result.salaryNoDuplicateLogic)
      throw new Error('loadSalaryStats() 仍殘留「j.company || getJournalCompany(...)」的重複判斷，未簡化為直接呼叫共用函式');
    if (!result.alertsUsesSharedFn)
      throw new Error('computeSalaryMissingGroups()（薪資缺漏分組邏輯，2026-08-11 從 renderSalaryAlerts() 內部搬出）未改呼叫 getJournalCompany()');
    if (!result.alertsNoOldPattern)
      throw new Error('computeSalaryMissingGroups() 仍殘留舊的「stuCompanyMap[j.seatNo] || j.company」名冊優先判斷');
  });

  await test('T-SEC-44 公司篩選清單改由「目前日期範圍內的月記」自己的 company 欄位建立，不再讀取整個 /students 集合；loadWorkTypeStats() 補上一致的清單建立呼叫', async () => {
    // 背景：loadLocationStats() 原本用「從學生資料讀取」建立公司篩選清單（讀整個
    // /students 集合，任何學期、任何格式皆算入），會把跨學期同座號殘留的舊公司名稱
    // 一起塞進篩選清單，即使那間公司跟目前查詢範圍內任何一份月記都無關——這正是篩選
    // 清單裡會冒出「沙鹿」這類跟目前資料無關的舊公司選項的根本原因。loadWorkTypeStats()
    // 原本完全沒有呼叫 populateCompanyFilter()，篩選清單完全被動依賴「地點統計／薪資
    // 統計哪一個先跑完」這個競態（三個頁籤各自有獨立日期區間，可能顯示到不相干範圍
    // 算出來的清單）。這裡用 codeOnly() 過濾掉整行都是註解的行再檢查。
    const result = await page.evaluate(() => {
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const locFnStr = (typeof loadLocationStats === 'function') ? codeOnly(loadLocationStats.toString()) : '';
      const worktypeFnStr = (typeof loadWorkTypeStats === 'function') ? codeOnly(loadWorkTypeStats.toString()) : '';
      const salaryFnStr = (typeof loadSalaryStats === 'function') ? codeOnly(loadSalaryStats.toString()) : '';
      if (!locFnStr || !worktypeFnStr || !salaryFnStr) return { skip: true };

      const locNoOldRosterCompanySet = !/companySet\.add\(\s*d\.data\(\)\.company\s*\)/.test(locFnStr);
      const locBuildsFromJournals = /const companies = journals\.map\(j => j\.company\)\.filter\(Boolean\)/.test(locFnStr);
      const locCallsPopulate = /populateCompanyFilter\(companies\)/.test(locFnStr);

      const worktypeBuildsFromJournals = /const companies = journals\.map\(j => j\.company\)\.filter\(Boolean\)/.test(worktypeFnStr);
      const worktypeCallsPopulate = /populateCompanyFilter\(companies\)/.test(worktypeFnStr);
      // populateCompanyFilter() 必須在 getSelectedCompanies() 之前呼叫，篩選清單才能在
      // 讀取「目前勾選了哪些公司」之前先被刷新成這個頁籤自己算出來的清單
      const populateIdx = worktypeFnStr.indexOf('populateCompanyFilter(companies)');
      const selectedIdx = worktypeFnStr.indexOf('getSelectedCompanies()');
      const worktypeOrderOK = populateIdx !== -1 && selectedIdx !== -1 && populateIdx < selectedIdx;

      const salaryCallsPopulate = /populateCompanyFilter\(companies\)/.test(salaryFnStr);

      return {
        skip: false,
        locNoOldRosterCompanySet, locBuildsFromJournals, locCallsPopulate,
        worktypeBuildsFromJournals, worktypeCallsPopulate, worktypeOrderOK,
        salaryCallsPopulate,
      };
    });

    if (result.skip) return;
    if (!result.locNoOldRosterCompanySet)
      throw new Error('loadLocationStats() 仍殘留從整個 /students 集合建立公司清單的舊寫法（沙鹿等跨學期舊公司名稱會重新混入篩選清單）');
    if (!result.locBuildsFromJournals)
      throw new Error('loadLocationStats() 的公司清單未改成從目前日期範圍內的 journals 建立');
    if (!result.locCallsPopulate)
      throw new Error('loadLocationStats() 未呼叫 populateCompanyFilter(companies)');
    if (!result.worktypeBuildsFromJournals)
      throw new Error('loadWorkTypeStats() 未補上跟另外兩個統計一致的公司清單建立邏輯');
    if (!result.worktypeCallsPopulate)
      throw new Error('loadWorkTypeStats() 未呼叫 populateCompanyFilter(companies)，篩選清單仍會完全依賴地點/薪資統計哪個先跑完');
    if (!result.worktypeOrderOK)
      throw new Error('loadWorkTypeStats() 的 populateCompanyFilter() 沒有寫在 getSelectedCompanies() 之前，篩選清單刷新的時機不對');
    if (!result.salaryCallsPopulate)
      throw new Error('loadSalaryStats() 未呼叫 populateCompanyFilter(companies)');
  });

  await test('T-SEC-45 loadLocationStats()／loadWorkTypeStats()／fetchJournalsFromServer()／loadSalaryStats() 的名冊備援 studentMap／stuCompanyMap／stuInfoMap 皆改用「學期＋座號」當 key，不再用裸座號合併整個 /students 集合', async () => {
    // 背景：這四個函式建立「月記自己沒填 company/姓名時」的備援查詢表時，原本只用裸
    // 座號當 key（studentMap[sno] = d.data() 或 stuCompanyMap[sno] = ...），會把不同
    // 學期、同一個座號的多份 /students 文件互相覆蓋——即使 company 本身已是月記優先、
    // 只在真的缺資料時才會用到這份備援，裸座號合併仍可能讓備援值跨學期撈到不相干的
    // 舊資料（例如座號被重新分配給別的學生）。修法比照 exportAllStatsExcel() 既有的
    // studentMap[`${s.semester}-${s.seatNo}`] 寫法，改用「學期＋座號」當 key；找不到
    // semester 的舊格式文件（學期前綴架構上線之前）無法安全歸類，不納入這份備援 map。
    // 2026-07-23 補齊第四處：loadSalaryStats() 自己的 stuCompanyMap／stuInfoMap（先前
    // 三處已改，這處使用者確認範圍才一併補上，變數名不同（stuCompanyMap／stuInfoMap
    // 而非 studentMap），連帶要求 getJournalCompany() 讀取時也同步改用學期＋座號 key，
    // 否則不論其他三處建 map 的方式再正確，透過 getJournalCompany() 讀取這份 map 的
    // 呼叫端（loadSalaryStats() 本身與 renderSalaryAlerts()）一樣會查不到、退回舊行為。
    const result = await page.evaluate(() => {
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const locFnStr = (typeof loadLocationStats === 'function') ? codeOnly(loadLocationStats.toString()) : '';
      const worktypeFnStr = (typeof loadWorkTypeStats === 'function') ? codeOnly(loadWorkTypeStats.toString()) : '';
      const fetchFnStr = (typeof fetchJournalsFromServer === 'function') ? codeOnly(fetchJournalsFromServer.toString()) : '';
      const salaryFnStr = (typeof loadSalaryStats === 'function') ? codeOnly(loadSalaryStats.toString()) : '';
      const getCompanyFnStr = (typeof getJournalCompany === 'function') ? codeOnly(getJournalCompany.toString()) : '';
      if (!locFnStr || !worktypeFnStr || !fetchFnStr || !salaryFnStr || !getCompanyFnStr) return { skip: true };

      const check = (fnStr) => ({
        writesSemesterScoped: /studentMap\[`\$\{sem\}-\$\{sno\}`\]\s*=/.test(fnStr),
        noBareSeatNoWrite: !/studentMap\[sno\]\s*=\s*d\.data\(\)/.test(fnStr),
      });

      const loc = check(locFnStr);
      const worktype = check(worktypeFnStr);
      const fetchJ = check(fetchFnStr);

      const locReadsSemesterScoped = /studentMap\[`\$\{data\.semester\}-\$\{data\.seatNo\}`\]/.test(locFnStr);
      const worktypeReadsSemesterScoped = /studentMap\[`\$\{j\.semester\}-\$\{j\.seatNo\}`\]/.test(worktypeFnStr);
      const fetchReadsSemesterScoped = /studentMap\[`\$\{j\.semester\}-\$\{j\.seatNo\}`\]/.test(fetchFnStr);

      // loadSalaryStats() 用的是 stuCompanyMap／stuInfoMap，變數名跟另外三處不同，
      // 分開檢查；寫入是 `${sem}-${sno}` 複合 key，且不再出現舊的裸座號寫法。
      const salaryWritesSemesterScoped =
        /stuCompanyMap\[`\$\{sem\}-\$\{sno\}`\]\s*=/.test(salaryFnStr) &&
        /stuInfoMap\[`\$\{sem\}-\$\{sno\}`\]\s*=/.test(salaryFnStr);
      const salaryNoBareSeatNoWrite =
        !/stuCompanyMap\[sno\]\s*=/.test(salaryFnStr) &&
        !/stuInfoMap\[sno\]\s*=/.test(salaryFnStr);
      const salaryReadsSemesterScopedInfoMap = /stuInfoMap\[`\$\{j\.semester\}-\$\{j\.seatNo\}`\]/.test(salaryFnStr);
      // getJournalCompany() 本身讀 stuCompanyMap 也要改成學期＋座號 key，否則
      // loadSalaryStats()／renderSalaryAlerts() 兩個呼叫端都會查不到剛剛存進去的值。
      const getCompanyReadsSemesterScoped = /stuCompanyMap\[`\$\{j\.semester\}-\$\{j\.seatNo\}`\]/.test(getCompanyFnStr);
      const getCompanyNoOldBareRead = !/stuCompanyMap\[j\.seatNo\]/.test(getCompanyFnStr);

      return {
        skip: false,
        loc, worktype, fetchJ,
        locReadsSemesterScoped, worktypeReadsSemesterScoped, fetchReadsSemesterScoped,
        salaryWritesSemesterScoped, salaryNoBareSeatNoWrite, salaryReadsSemesterScopedInfoMap,
        getCompanyReadsSemesterScoped, getCompanyNoOldBareRead,
      };
    });

    if (result.skip) return;
    if (!result.loc.writesSemesterScoped || !result.loc.noBareSeatNoWrite)
      throw new Error('loadLocationStats() 的 studentMap 仍用裸座號當 key，未改成學期＋座號範圍');
    if (!result.worktype.writesSemesterScoped || !result.worktype.noBareSeatNoWrite)
      throw new Error('loadWorkTypeStats() 的 studentMap 仍用裸座號當 key，未改成學期＋座號範圍');
    if (!result.fetchJ.writesSemesterScoped || !result.fetchJ.noBareSeatNoWrite)
      throw new Error('fetchJournalsFromServer() 的 studentMap 仍用裸座號當 key，未改成學期＋座號範圍');
    if (!result.locReadsSemesterScoped)
      throw new Error('loadLocationStats() 下游讀取 studentMap 時未使用學期＋座號 key');
    if (!result.worktypeReadsSemesterScoped)
      throw new Error('loadWorkTypeStats() 下游讀取 studentMap 時未使用學期＋座號 key');
    if (!result.fetchReadsSemesterScoped)
      throw new Error('fetchJournalsFromServer() 下游讀取 studentMap 時未使用學期＋座號 key');
    if (!result.salaryWritesSemesterScoped || !result.salaryNoBareSeatNoWrite)
      throw new Error('loadSalaryStats() 的 stuCompanyMap／stuInfoMap 仍用裸座號當 key，未改成學期＋座號範圍');
    if (!result.salaryReadsSemesterScopedInfoMap)
      throw new Error('loadSalaryStats() 下游讀取 stuInfoMap 時未使用學期＋座號 key');
    if (!result.getCompanyReadsSemesterScoped || !result.getCompanyNoOldBareRead)
      throw new Error('getJournalCompany() 讀取 stuCompanyMap 時未改成學期＋座號 key，loadSalaryStats()／renderSalaryAlerts() 會查不到剛存進去的值');
  });

  await test('T-SEC-46 exportAllStatsExcel() 五處公司欄位皆改為「月記優先、名冊備援」，跟「統計總覽」三頁籤統一邏輯', async () => {
    // 背景：locationRows／salaryRows／salaryAlertRows「薪資缺漏」／companyAggMap
    // （各公司薪資分組）／companyWorktypeMap（各公司工作類型分組）原本都是
    // 「s.company || j.company」名冊優先，會讓已經換過公司的學生，Excel 匯出把整學期
    // 所有月記都算成名冊上「目前」登記的那一間，即使某些月記當時實際待的是別間公司
    // ——跟「統計總覽」三頁籤原本的 bug 是同一種問題。已確認統一改成月記優先，一次改
    // 5 處，這裡驗證兩種寫法各自的出現次數，並確認舊的名冊優先寫法不再殘留。
    const result = await page.evaluate(() => {
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const fnStr = (typeof exportAllStatsExcel === 'function') ? codeOnly(exportAllStatsExcel.toString()) : '';
      if (!fnStr) return { skip: true };

      // locationRows／salaryRows／salaryAlertRows「薪資缺漏」共 3 處：
      // 公司: sanitizeExcelCell(j.company || s.company || '')
      const journalFirstSimpleCount = (fnStr.match(/公司\s*:\s*sanitizeExcelCell\(j\.company \|\| s\.company \|\| ''\)/g) || []).length;
      // companyAggMap／companyWorktypeMap 分組 key 共 2 處：sanitizeExcelCell(j.company || (studentMap[...
      const journalFirstStudentMapCount = (fnStr.match(/sanitizeExcelCell\(j\.company \|\| \(studentMap\[/g) || []).length;
      // 舊的「名冊優先」寫法不應再出現在這個函式裡
      const noOldRosterFirstPattern =
        !/sanitizeExcelCell\(s\.company \|\| j\.company/.test(fnStr) &&
        !/sanitizeExcelCell\(\(studentMap\[[^\]]*\][^)]*\)\?\.company\)\s*\|\|\s*j\.company/.test(fnStr);

      return { skip: false, journalFirstSimpleCount, journalFirstStudentMapCount, noOldRosterFirstPattern };
    });

    if (result.skip) return;
    if (result.journalFirstSimpleCount < 3)
      throw new Error(`「公司: sanitizeExcelCell(j.company || s.company || '')」（月記優先）出現次數只有 ${result.journalFirstSimpleCount}（應為3：locationRows／salaryRows／salaryAlertRows 薪資缺漏），至少一處仍是名冊優先或退化`);
    if (result.journalFirstStudentMapCount < 2)
      throw new Error(`「sanitizeExcelCell(j.company || (studentMap[...）」（月記優先）出現次數只有 ${result.journalFirstStudentMapCount}（應為2：companyAggMap／companyWorktypeMap 分組），至少一處仍是名冊優先或退化`);
    if (!result.noOldRosterFirstPattern)
      throw new Error('exportAllStatsExcel() 仍殘留「s.company || j.company」名冊優先的舊寫法，跟「統計總覽」三頁籤的月記優先邏輯不一致');
  });

  await test('T-SEC-47 isJournalLate() 優先讀 entriesCompleteAt、缺欄位時退回用 submittedAt，且 isJournalComplete()／statusSymbolForJournal() 未被這次修改牽動', async () => {
    // 2026-07-25 新增。背景：2026-07-24 那輪「遲交」判斷修正——isJournalLate() 從直接用
    // submittedAt（月記第一次存檔時間）比對截止日，改成優先讀 entriesCompleteAt（篇數
    // 真正達到 minEntries 那一刻的時間），缺這個欄位時才退回用 submittedAt——當時
    // AI_CONTEXT.md 明確記載「本輪未新增自動化測試，列為已知缺口」。這條測試直接呼叫
    // isJournalLate()／statusSymbolForJournal() 本體帶合成資料驗證，不做原始碼字串比對。
    //
    // 驗證六項：
    //   caseA  entriesCompleteAt 有值且準時（即使 submittedAt 若被誤讀會判成遲交）→ 準時
    //   caseB  entriesCompleteAt 有值且遲交（即使 submittedAt 若被誤讀會判成準時）→ 遲交，
    //          這正是 2026-07-24 修法要解決的核心情境本身：學生7月準時先存一份篇數不足
    //          的月記（submittedAt=準時），8/1才真正補齊篇數（entriesCompleteAt=遲）
    //   caseC  entriesCompleteAt 為 null（例如篇數不足的文件，或這個功能上線前已達標的
    //          舊資料）→ 退回用 submittedAt 判斷，這裡準時
    //   caseD  entriesCompleteAt 欄位完全不存在（更貼近真實舊資料的形狀——Firestore
    //          文件本來就不會有從未寫過的欄位）→ 同樣退回用 submittedAt，這裡遲交
    //   caseE  端對端（statusSymbolForJournal()）：篇數已達標（2/2）、submittedAt準時、
    //          entriesCompleteAt遲交 → 應顯示▲，不是✓，重現目標情境本身
    //   caseF  篇數不足（1/2）、entriesCompleteAt 刻意塞一個很早的日期 → 應顯示△，不會
    //          被 isJournalLate() 讀到（isJournalComplete() 先擋下），驗證「entries不夠時
    //          偽造 entriesCompleteAt 沒有用」這件事本身沒有被意外破壞
    // 另外兩項回歸確認：isJournalComplete() 完全不提 entriesCompleteAt（沒有被這次修改
    // 誤觸），statusSymbolForJournal() 仍然是先呼叫 isJournalComplete() 才呼叫
    // isJournalLate()（順序沒有被調換，維持「篇數不夠時完全不看遲交判斷」的既有行為）。
    const result = await page.evaluate(() => {
      if (typeof isJournalLate !== 'function' || typeof statusSymbolForJournal !== 'function' || typeof isJournalComplete !== 'function') {
        return { skip: true };
      }
      const deadlineMap = { '115-1-7': { minEntries: 2, closeDate: '2026-07-31' } };

      const caseA = isJournalLate({
        semester: '115-1', month: 7,
        submittedAt: '2026-08-10T00:00:00',
        entriesCompleteAt: '2026-07-20T00:00:00',
      }, deadlineMap);

      const caseB = isJournalLate({
        semester: '115-1', month: 7,
        submittedAt: '2026-07-10T00:00:00',
        entriesCompleteAt: '2026-08-01T00:00:00',
      }, deadlineMap);

      const caseC = isJournalLate({
        semester: '115-1', month: 7,
        submittedAt: '2026-07-10T00:00:00',
        entriesCompleteAt: null,
      }, deadlineMap);

      const caseD = isJournalLate({
        semester: '115-1', month: 7,
        submittedAt: '2026-08-15T00:00:00',
      }, deadlineMap);

      const caseE = statusSymbolForJournal({
        semester: '115-1', month: 7,
        entries: [{}, {}],
        submittedAt: '2026-07-10T00:00:00',
        entriesCompleteAt: '2026-08-01T00:00:00',
      }, deadlineMap);

      const caseF = statusSymbolForJournal({
        semester: '115-1', month: 7,
        entries: [{}],
        submittedAt: '2026-07-10T00:00:00',
        entriesCompleteAt: '2026-01-01T00:00:00',
      }, deadlineMap);

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const isJournalCompleteUntouched = !codeOnly(isJournalComplete.toString()).includes('entriesCompleteAt');
      const statusFnCode = codeOnly(statusSymbolForJournal.toString());
      const completeCallIdx = statusFnCode.indexOf('isJournalComplete(');
      const lateCallIdx = statusFnCode.indexOf('isJournalLate(');
      const completeCheckedBeforeLate = completeCallIdx !== -1 && lateCallIdx !== -1 && completeCallIdx < lateCallIdx;

      return {
        skip: false,
        caseA, caseB, caseC, caseD, caseE, caseF,
        isJournalCompleteUntouched, completeCheckedBeforeLate,
      };
    });

    if (result.skip) return;
    if (result.caseA !== false)
      throw new Error(`情境A（entriesCompleteAt準時，submittedAt若誤讀會判遲交）應為準時(false)，實際得到 ${result.caseA}——代表函式沒有優先讀 entriesCompleteAt`);
    if (result.caseB !== true)
      throw new Error(`情境B（entriesCompleteAt遲交，submittedAt若誤讀會判準時）應為遲交(true)，實際得到 ${result.caseB}——這正是2026-07-24修法要解決的核心情境，若此測試失敗代表修法可能已被還原`);
    if (result.caseC !== false)
      throw new Error(`情境C（entriesCompleteAt為null，退回submittedAt準時）應為準時(false)，實際得到 ${result.caseC}`);
    if (result.caseD !== true)
      throw new Error(`情境D（entriesCompleteAt欄位不存在，退回submittedAt遲交）應為遲交(true)，實際得到 ${result.caseD}`);
    if (result.caseE !== '▲')
      throw new Error(`情境E（端對端：篇數達標、entriesCompleteAt遲交）應顯示▲，實際得到 ${result.caseE}`);
    if (result.caseF !== '△')
      throw new Error(`情境F（篇數不足、entriesCompleteAt偽造成很早的日期）應顯示△不受影響，實際得到 ${result.caseF}——若不是△代表 isJournalComplete() 的擋關失效了`);
    if (!result.isJournalCompleteUntouched)
      throw new Error('isJournalComplete() 不應提到 entriesCompleteAt，這次修改理當只動 isJournalLate() 本身');
    if (!result.completeCheckedBeforeLate)
      throw new Error('statusSymbolForJournal() 應先呼叫 isJournalComplete() 才呼叫 isJournalLate()，順序被調換的話「篇數不夠時完全不看遲交判斷」這個既有行為會被破壞');
  });

  await test('T-SEC-48 老師端完整支援多張薪資單：新舊資料相容、快取排除 Base64、按需載入/卡片/PDF 均遍歷 salaryPhotos', async () => {
    const result = await page.evaluate(() => {
      const onDemandFn = (typeof loadSalaryPhotoOnDemand === 'function') ? loadSalaryPhotoOnDemand.toString() : '';
      const cacheFn = (typeof saveJournalsToCache === 'function') ? saveJournalsToCache.toString() : '';
      const cardFn = (typeof renderJournalCard === 'function') ? renderJournalCard.toString() : '';
      const pdfFn = (typeof preparePdfJournalImages === 'function') ? preparePdfJournalImages.toString() : '';
      if (!onDemandFn || !cacheFn || !cardFn || !pdfFn || typeof getJournalSalaryPhotos !== 'function' || typeof renderSalaryPhotosHtml !== 'function') return { skip: true };

      const newFormat = getJournalSalaryPhotos({ salaryPhotos: ['first', '', 42, 'second'] });
      const legacyFormat = getJournalSalaryPhotos({ salaryPhoto: 'legacy' });
      const html = renderSalaryPhotosHtml({ salaryPhotos: ['first', 'second'] });

      return {
        skip: false,
        newFormat: JSON.stringify(newFormat) === JSON.stringify(['first', 'second']),
        legacyFormat: JSON.stringify(legacyFormat) === JSON.stringify(['legacy']),
        displayAll: html.includes('薪資單（2 張）') && (html.match(/class="entry-photo"/g) || []).length === 2,
        cacheRemovesBoth: /const\s*\{\s*salaryPhoto\s*,\s*salaryPhotos\s*,\s*\.\.\.rest\s*\}\s*=\s*j/.test(cacheFn) && cacheFn.includes('salaryPhotoCount: photos.length'),
        onDemandReadsArray: onDemandFn.includes('getJournalSalaryPhotos(snap.data())') && onDemandFn.includes('salaryPhotos.map') && onDemandFn.includes('escapeHtml'),
        cardReadsArray: cardFn.includes('getJournalSalaryPhotos(j).length') && cardFn.includes('renderSalaryPhotosHtml(j)'),
        pdfReadsArray: pdfFn.includes('getJournalSalaryPhotos(j).map(imageToDataUrl)') && pdfFn.includes('_pdfSalaryPhotos'),
      };
    });
    if (result.skip) return;
    if (!result.newFormat || !result.legacyFormat) throw new Error('老師端 getJournalSalaryPhotos() 未同時相容 salaryPhotos 新格式與 salaryPhoto 舊格式');
    if (!result.displayAll) throw new Error('老師端月記卡片未顯示所有薪資單照片或未顯示正確張數');
    if (!result.cacheRemovesBoth) throw new Error('老師端 localStorage 快取未同時排除 salaryPhoto 與 salaryPhotos Base64，可能造成 QuotaExceededError');
    if (!result.onDemandReadsArray) throw new Error('老師端按需載入薪資單沒有讀取所有 salaryPhotos，或圖片 src 未經 escapeHtml');
    if (!result.cardReadsArray) throw new Error('老師端月記卡片沒有改用多張薪資單渲染邏輯');
    if (!result.pdfReadsArray) throw new Error('老師端 PDF 匯出沒有遍歷所有薪資單照片');
  });

  await test('T-SEC-49 deleteStudent()／單筆刪月記／批次刪月記皆改為需輸入姓名或 DELETE {筆數} 才能刪除，不符合時不執行刪除', async () => {
    const result = await page.evaluate(() => {
      const delStuFn = (typeof deleteStudent === 'function') ? deleteStudent.toString() : '';
      const singleFn = (typeof confirmDeleteJournal === 'function') ? confirmDeleteJournal.toString() : '';
      const batchFn = (typeof confirmTeacherBatchDelete === 'function') ? confirmTeacherBatchDelete.toString() : '';
      if (!delStuFn || !singleFn || !batchFn) return { skip: true };

      // deleteStudent()：原本是 confirm()，現在改成單一 prompt()，把警告文字與姓名輸入
      // 要求合併在同一段；確認舊的 confirm() 寫法真的不在了（regression check），且
      // 「truthy 才繼續」的判斷改成「打的字必須完全等於姓名」
      const delStuHasPrompt = /const typed = prompt\(`/.test(delStuFn);
      const delStuAsksName = delStuFn.includes('請輸入該生姓名');
      const delStuHasCheck = /if \(typed !== name\) return toast\('已取消刪除', 'info'\);/.test(delStuFn);
      const delStuNoOldConfirm = !delStuFn.includes('if (!confirm(');

      // 單筆刪月記（老師端呼叫端本來就有帶 studentName 參數，這裡跟 student.html 不同，
      // 直接使用參數即可，不需要像 student.html 那樣改用 currentUser?.name）
      const singleHasRequiredText = /const requiredText = studentName \|\| '';/.test(singleFn);
      const singleHasCheck = /if \(\(inputEl\?\.value \|\| ''\) !== requiredText\)/.test(singleFn);
      const singleCheckIdx = singleFn.indexOf("if ((inputEl?.value || '') !== requiredText)");
      const singleExecuteIdx = singleFn.indexOf('executeDeleteJournal(seatNo, semester, month, isTeacher)');
      const singleOrderOK = singleCheckIdx !== -1 && singleExecuteIdx !== -1 && singleExecuteIdx > singleCheckIdx;

      const batchHasRequiredText = /const requiredText = `DELETE \$\{journals\.length\}`;/.test(batchFn);
      const batchHasCheck = /if \(\(inputEl\?\.value \|\| ''\) !== requiredText\)/.test(batchFn);
      const batchCheckIdx = batchFn.indexOf("if ((inputEl?.value || '') !== requiredText)");
      const batchExecuteIdx = batchFn.indexOf('executeTeacherBatchDelete(journals)');
      const batchOrderOK = batchCheckIdx !== -1 && batchExecuteIdx !== -1 && batchExecuteIdx > batchCheckIdx;

      const domElementsExist = !!document.getElementById('delete-journal-confirm-input')
        && !!document.getElementById('delete-journal-confirm-hint')
        && !!document.getElementById('t-batch-delete-confirm-input')
        && !!document.getElementById('t-batch-delete-confirm-hint');

      return {
        skip: false,
        delStuHasPrompt, delStuAsksName, delStuHasCheck, delStuNoOldConfirm,
        singleHasRequiredText, singleHasCheck, singleOrderOK,
        batchHasRequiredText, batchHasCheck, batchOrderOK,
        domElementsExist,
      };
    });
    if (result.skip) return;
    if (!result.delStuHasPrompt || !result.delStuNoOldConfirm) throw new Error('deleteStudent() 沒有改成單一 prompt()，可能還停在舊版 confirm() 或寫法退化');
    if (!result.delStuAsksName) throw new Error('deleteStudent() 的 prompt 文字沒有要求輸入該生姓名');
    if (!result.delStuHasCheck) throw new Error('deleteStudent() 缺少「輸入需完全等於姓名」的檢查，可能退化成只要有輸入就放行');
    if (!result.singleHasRequiredText) throw new Error('confirmDeleteJournal() 缺少 requiredText = studentName 的姓名輸入要求');
    if (!result.singleHasCheck) throw new Error('confirmDeleteJournal() 缺少輸入不符時的檢查');
    if (!result.singleOrderOK) throw new Error('confirmDeleteJournal() 的刪除呼叫沒有被輸入驗證正確保護，可能不驗證就直接執行刪除');
    if (!result.batchHasRequiredText) throw new Error('confirmTeacherBatchDelete() 缺少 requiredText = `DELETE {筆數}` 的輸入要求');
    if (!result.batchHasCheck) throw new Error('confirmTeacherBatchDelete() 缺少輸入不符時的檢查');
    if (!result.batchOrderOK) throw new Error('confirmTeacherBatchDelete() 的刪除呼叫沒有被輸入驗證正確保護，可能不驗證就直接執行刪除');
    if (!result.domElementsExist) throw new Error('刪除確認 Modal 缺少對應的輸入框或提示文字 DOM 元素');
  });

  await test('T-SEC-50 computeSalaryMissingGroups()／renderSalaryMissingGroupedHtml() 依西元年月正確分組並由新到舊排序（不同學年同一個月份數字不會被混在一起），renderSalaryAlerts() 已改呼叫這兩個共用函式並把「薪資缺漏」拆成獨立整行卡片、排在最上層', async () => {
    // 背景：2026-08-11 新增「薪資缺漏依月份分組＋複製」功能，同日第二輪調整又把排序方向
    // 從「舊到新」改成「新到舊」（老師通常最關心最近一次的繳交狀況），並把「薪資缺漏」
    // 從4欄網格最下方搬到最上層獨立整行（見 AI_CONTEXT.md）。查詢區間常常橫跨不同學年
    // （例如查一整學年），computeSalaryMissingGroups() 換算真正的西元年月（沿用
    // getTeacherJournalMonthRangeLabel() 既有公式：第1學期7~12月為當年、1月為隔年；
    // 第2學期2~6月皆隔年）當分組鍵，避免不同學年的同一個月份數字被誤合併。這裡直接呼叫
    // 真正的函式驗證行為，而非只做原始碼比對。
    const result = await page.evaluate(() => {
      if (typeof computeSalaryMissingGroups !== 'function' || typeof renderSalaryMissingGroupedHtml !== 'function')
        return { skip: true };

      // 5筆分屬4個不同的西元年月，其中114-1的7月跟115-1的7月刻意都是「7月」但差一年，
      // 驗證不會被誤合併成同一組；115-1的1月（第1學期1月跨年）跟115-2的3月（第2學期
      // 全部隔年）也刻意排進來驗證「學期+月份→西元年月」的換算公式套用正確；115-1的7月
      // 故意放2筆（座號01、03），驗證組內仍依座號排序。
      const missingSalary = [
        { seatNo: '05', studentName: '學生A', semester: '115-2', month: 3 },  // → 2027-03（最新）
        { seatNo: '02', studentName: '學生B', semester: '114-1', month: 7 },  // → 2025-07（最舊）
        { seatNo: '07', studentName: '學生C', semester: '115-1', month: 1 },  // → 2027-01（1月跨年）
        { seatNo: '03', studentName: '學生D', semester: '115-1', month: 7 },  // → 2026-07
        { seatNo: '01', studentName: '學生E', semester: '115-1', month: 7 },  // → 2026-07（跟上面同組）
      ];
      const groups = computeSalaryMissingGroups(missingSalary, {});
      const keys = groups.map(g => g.key);
      const notMerged = groups.length === 4; // 114-1的7月跟115-1的7月沒有被誤合併成同一組
      // 2026-08-11（第二輪）：由新到舊排序，2027-03（最新）排最前，2025-07（最舊）排最後
      const chronoOrderNewToOld = JSON.stringify(keys) === JSON.stringify(['2027-03', '2027-01', '2026-07', '2025-07']);
      const julyGroup = groups.find(g => g.key === '2026-07');
      const intraGroupSorted = !!julyGroup && julyGroup.students.map(s => s.sno).join(',') === '01,03';

      const html = renderSalaryMissingGroupedHtml(groups);
      const hasGroupClass = html.includes('class="salary-missing-group"');
      const hasMonthHeader = html.includes('📅 115-1　7月（2筆）');
      // 每組標題已經有「學期 月份」，項目本身不應再重複顯示同樣的文字，只留公司名稱
      // （這裡的 company 全部沒有給值，getJournalCompany() 會 fallback 成「未填寫」）
      const hasCompanyOnlyNote = html.includes('<div class="salary-alert-note">未填寫</div>');

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const alertsFnStr = (typeof renderSalaryAlerts === 'function') ? codeOnly(renderSalaryAlerts.toString()) : '';
      const usesComputeGroups = /computeSalaryMissingGroups\(\s*missingSalary\s*,\s*stuCompanyMap\s*\)/.test(alertsFnStr);
      const usesRenderGrouped = /renderSalaryMissingGroupedHtml\(\s*missingSalaryGroups\s*\)/.test(alertsFnStr);
      const exposesForCopy = /window\._salaryMissingGroups\s*=\s*missingSalaryGroups/.test(alertsFnStr);
      const hasFullWidthClass = /cls:\s*'warn full-width'/.test(alertsFnStr);
      const hasCopyButton = /onclick="copySalaryMissingList\(\)"/.test(alertsFnStr);
      const oldFnGone = !/function\s+missingItems/.test(alertsFnStr);

      // 2026-08-11（第二輪）：「薪資缺漏」應排在 boxes 陣列最前面（畫面上獨立整行、排
      // 最上層），不是原本（第一輪）排在最後面
      const missingIdx = alertsFnStr.indexOf(`title:'薪資缺漏'`);
      const lowIdx = alertsFnStr.indexOf(`title:'低於平均`);
      const gapIdx = alertsFnStr.indexOf(`title:'公司內部落差'`);
      const highIdx = alertsFnStr.indexOf(`title:'高於平均`);
      const missingFirst = missingIdx !== -1 && lowIdx !== -1 && gapIdx !== -1 && highIdx !== -1
        && missingIdx < lowIdx && missingIdx < gapIdx && missingIdx < highIdx;

      return {
        skip: false, notMerged, chronoOrderNewToOld, intraGroupSorted, hasGroupClass, hasMonthHeader,
        hasCompanyOnlyNote, usesComputeGroups, usesRenderGrouped, exposesForCopy,
        hasFullWidthClass, hasCopyButton, oldFnGone, missingFirst, keys,
      };
    });

    if (result.skip) return;
    if (!result.notMerged)
      throw new Error(`不同學年同一個月份數字被誤合併成同一組，實際分組數：${JSON.stringify(result.keys)}`);
    if (!result.chronoOrderNewToOld)
      throw new Error(`分組排序不是「由新到舊」，實際順序：${JSON.stringify(result.keys)}`);
    if (!result.intraGroupSorted)
      throw new Error('同一組內的座號未依座號排序');
    if (!result.hasGroupClass)
      throw new Error('renderSalaryMissingGroupedHtml() 輸出缺少 salary-missing-group 分組容器（分隔線樣式依賴這個 class）');
    if (!result.hasMonthHeader)
      throw new Error('renderSalaryMissingGroupedHtml() 輸出缺少「📅 115-1　7月（2筆）」這種月份標題列');
    if (!result.hasCompanyOnlyNote)
      throw new Error('renderSalaryMissingGroupedHtml() 每筆項目的備註未正確只顯示公司名稱');
    if (!result.usesComputeGroups)
      throw new Error('renderSalaryAlerts() 未呼叫 computeSalaryMissingGroups() 計算薪資缺漏分組');
    if (!result.usesRenderGrouped)
      throw new Error('renderSalaryAlerts() 未呼叫 renderSalaryMissingGroupedHtml() 渲染薪資缺漏清單');
    if (!result.exposesForCopy)
      throw new Error('renderSalaryAlerts() 未把分組結果存進 window._salaryMissingGroups，copySalaryMissingList() 會拿不到資料');
    if (!result.hasFullWidthClass)
      throw new Error('「薪資缺漏」box 未套用 full-width class，應獨立成整行卡片而非跟其他3個清單並排');
    if (!result.hasCopyButton)
      throw new Error('renderSalaryAlerts() 的薪資缺漏標題列缺少複製按鈕（onclick="copySalaryMissingList()"）');
    if (!result.oldFnGone)
      throw new Error('舊的 missingItems() 內部函式仍殘留在 renderSalaryAlerts() 裡，應已被 computeSalaryMissingGroups()／renderSalaryMissingGroupedHtml() 取代');
    if (!result.missingFirst)
      throw new Error('「薪資缺漏」在 boxes 陣列裡未排在最前面（應獨立整行排最上層，下方依序才是公司內部落差／低於平均20%／高於平均30%）');
  });

  await test('T-SEC-51 copySalaryMissingList() 複製到剪貼簿的文字只有座號、不含姓名，依 window._salaryMissingGroups 既有順序分組（新到舊），且複製範圍下拉選單可篩選單一月份', async () => {
    // 背景：比照「已逾期未達標」的 copyOverdueList()，但薪資缺漏沒有「已交X篇」這種
    // 逐筆註記（只有「未填」二元狀態），複製格式因此更精簡——每個座號各自一行，不附
    // 任何註記。複製文字的月份區塊順序直接沿用 window._salaryMissingGroups 本身的順序
    // （2026-08-11 第二輪起改成新到舊），這裡刻意不重新排序，驗證 copySalaryMissingList()
    // 沒有自己另外排序、真的是「共用同一份已排序好的資料」（見 computeSalaryMissingGroups()
    // 與 copySalaryMissingList() 上方註解），排序正確性本身由 T-SEC-50 覆蓋。
    const hasFn = await page.evaluate(() => typeof copySalaryMissingList === 'function');
    if (!hasFn) return;

    const result = await page.evaluate(async () => {
      // 暫時插入一個獨立的 <select id="salary-missing-copy-scope">，不依賴「薪資統計」
      // 頁籤是否已經跑過真實查詢、渲染出真正的下拉選單——測試結束後會移除，不影響頁面
      // 其他部分。
      const sel = document.createElement('select');
      sel.id = 'salary-missing-copy-scope';
      const optAll = document.createElement('option'); optAll.value = 'all';
      const optJuly = document.createElement('option'); optJuly.value = '2026-07';
      sel.appendChild(optAll); sel.appendChild(optJuly);
      document.body.appendChild(sel);

      // 刻意已經是「新到舊」順序（8月在前、7月在後），驗證 copySalaryMissingList() 只是
      // 忠實依序輸出，沒有自己另外排序。
      window._salaryMissingGroups = [
        { key: '2026-08', year: 2026, month: 8, semester: '115-1', students: [
          { sno: '12', name: '測試學生丙', company: 'C公司' },
        ]},
        { key: '2026-07', year: 2026, month: 7, semester: '115-1', students: [
          { sno: '01', name: '測試學生甲', company: 'A公司' },
          { sno: '03', name: '測試學生乙', company: 'B公司' },
        ]},
      ];

      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      const captured = [];
      navigator.clipboard.writeText = (text) => { captured.push(text); return Promise.resolve(); };

      try {
        sel.value = 'all';
        await copySalaryMissingList();
        sel.value = '2026-07';
        await copySalaryMissingList();
      } finally {
        navigator.clipboard.writeText = originalWriteText;
        sel.remove();
      }

      return { all: captured[0] || '', julyOnly: captured[1] || '' };
    });

    if (!result.all)
      throw new Error('copySalaryMissingList() 選「全部」時沒有呼叫 navigator.clipboard.writeText()');
    if (result.all.includes('測試學生甲') || result.all.includes('測試學生乙') || result.all.includes('測試學生丙'))
      throw new Error('複製出來的文字仍包含姓名，未依需求只保留座號');
    if (!result.all.includes('01') || !result.all.includes('03') || !result.all.includes('12'))
      throw new Error('複製範圍「全部」時，複製出來的文字未包含所有月份的座號');
    if (!result.all.includes('115-1　7月') || !result.all.includes('115-1　8月'))
      throw new Error('複製出來的文字缺少月份分組標題（【學期　月份】）');
    if (result.all.indexOf('115-1　8月') > result.all.indexOf('115-1　7月'))
      throw new Error('複製文字的月份區塊順序沒有依照 window._salaryMissingGroups 既有順序（8月應排在7月之前）');

    if (!result.julyOnly)
      throw new Error('copySalaryMissingList() 選特定月份時沒有呼叫 navigator.clipboard.writeText()');
    if (!result.julyOnly.includes('01') || !result.julyOnly.includes('03'))
      throw new Error('只複製 2026-07 時，遺失該月份的座號');
    if (result.julyOnly.includes('12'))
      throw new Error('複製範圍選了「只複製 2026-07」，但複製出來的文字仍包含 8 月的座號 12，範圍篩選未生效');
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
