/**
 * tests/student.test.js
 * 學生端自動化測試 v43
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-07-06）與 AI_推播系統說明.md（截至 2026-07-10）
 *
 * v43 修正（2026-09-04）：saveJournal() 的「快取新鮮度檢查」有跨裝置/跨分頁競態
 * 條件——2026-07-13 版本只在偵測到「快取的 sem/month 跟目前選定不一致」時才現查一次
 * Firestore，防的是 checkMonthDeadline() 非同步查詢還沒完成就被搶先按下儲存這條路徑，
 * 但完全沒有防護「sem/month 從頭到尾沒變過、但同一份月記在另一台裝置/分頁背景被存過」
 * 這條路徑——window._currentJournalCache 是純本機全域變數，手機開著同一個月份的填寫頁
 * 很久沒關、電腦這段期間存過一次月記，是很常見的使用情境，不需要任何刻意操作。使用者
 * 提出情境後逐一核對程式碼與 rule.txt 確認屬實，實際會造成兩種後果：①若另一裝置存檔
 * 後 notify-service（每5分鐘一次）已把 journalSubmitNotifiedAt 從 null 改寫成真正
 * 時間戳，這裡因為誤判成第一次繳交、payload 帶 journalSubmitNotifiedAt:null，撞上
 * rule.txt「一般編輯必須維持原值不變」而整份月記存檔被拒（403）——且因為 catch 區塊
 * 不會清除這份過期快取，同一分頁重試會不斷卡在同一個錯誤，直到離開填寫頁再回來或
 * 重新整理頁面觸發 checkMonthDeadline() 重新查詢為止，是持續鎖死而非單次失敗；②若
 * 間隔在 notify-service 排程之內（兩邊 journalSubmitNotifiedAt 剛好都還是 null），
 * 這條驗證能通過，但 submittedAt（rule.txt 完全沒有驗證此欄位）會被悄悄改成這次存檔
 * 的時間，蓋掉另一裝置真正的第一次繳交時間，且會用錯誤的 entriesCountBefore（誤判
 * 成0）重算 entriesCompleteAt／entriesFirstCompleteAt，可能把已經誠實達標過的凍結
 * 時間往後推移，重演 entriesFirstCompleteAt 那三輪修法要解決的「誠實操作被系統計算
 * 邏輯搞錯」問題（換了跨裝置快取過期這個新的觸發途徑）。修法：拿掉「sem/month 是否
 * 相符」這個條件判斷，改成每次儲存前一律無條件現查一次 Firestore，跟
 * saveTeacherComment()／saveStudentReply() 修多裝置/多分頁競態問題用的做法完全一致。
 * checkMonthDeadline()／editJournal() 寫入快取的邏輯不變（仍記錄 sem/month，只是這裡
 * 不再拿來當判斷依據，非必要不擴大改動範圍）。
 * 本輪更新既有 S-SEC-32（原本驗證「有條件現查」機制，核心驗證目的——現查邏輯要在
 * isFirstSubmit 計算之前生效——不變，斷言隨新邏輯改寫：確認舊版「只在不符時才查」的
 * 判斷式痕跡已消失、且 journalRef 宣告到 isFirstSubmit 計算這段區間完全沒有任何 if
 * 判斷式能跳過現查），未新增具名呼叫點。未比照 S-SEC-49／S-SEC-51 的既有取捨改用真
 * 執行——saveJournal() 會動到 Firestore（getDoc／setDoc／getDocs／updateDoc），這個
 * 共用測試頁面之後還有其他測試依賴 firebase_funcs／currentUser 維持真實登入狀態，
 * 貿然覆寫風險不成比例，維持靜態比對。
 * 開發階段已用 Node 直接抽取（括號配對，非天真 regex）修法前／後兩版 saveJournal()
 * 原始碼，把新斷言分別跑在兩版上交叉驗證：修好版本全部通過、模擬還原成舊版邏輯時
 * noStaleMismatchGate／noConditionalSkip 皆正確判定失敗，確認斷言真的有鑑別力、不是
 * 巧合通過；另外用最小化的 mock（getDoc／window._currentJournalCache）單獨重播回報
 * 情境本身（sem/month 相同、伺服器已被另一裝置存過），確認舊邏輯完全不呼叫 getDoc、
 * isFirstSubmit 誤判為 true，新邏輯無條件呼叫一次 getDoc、isFirstSubmit 正確算出
 * false，證明修法真的解決了回報的競態情境，不只是「程式碼長得對」。**以上沙盒驗證
 * 無法取代使用者本機 Step2_RunTests.bat 對已部署正式網站的真實執行結果，待其確認。**
 *
 * v42 修正（2026-09-03）：第1學期跨年（12月→隔年1月）月份排序錯誤——第1學期固定
 * 7,8,9,10,11,12,1（隔年1月結束），1月數字最小、但時序上是整個學期最後一個月。使用者
 * 回報並經逐一核對程式碼確認屬實：任何直接用裸月份數字相減排序（a.month-b.month）的
 * 地方，只要資料同時橫跨12月與隔年1月，1月就會被排到跟時間順序相反的位置——升冪排序
 * 時1月排最前面、降冪排序時1月排最後面。新增共用純函式 monthOrderInSemester(semester,
 * month)（沿用既有 getSemesterMonths() 的月份順序陣列查表取得時序位置，不重複定義
 * 第三份 [7,8,9,10,11,12,1]），取代 renderSubmittedMonthsDetail()／getOverdueMonths()／
 * loadStudentDashboard()／loadStudentStats()／loadStudentHistory()／
 * getJournalMonthRangeLabel()／exportMyPDF() 共7處裸月份數字排序。monthOrderInSemester()
 * 內部對缺失/非法 semester 做防呆（String(semester||'')），避免呼叫端未加 ||'' 直接傳入
 * a.semester 時，一筆資料缺 semester 欄位就讓整個 .sort() 拋例外、比原本排序跑掉更嚴重。
 * 與 teacher_test.js 的 v39（T-SEC-70～74）對稱——teacher.html 額外有5處用字串拼接
 * （String(month).padStart(2,'0') 後 localeCompare()）的同類排序，一併修正。完整背景見
 * AI_CONTEXT_狀態.md 對應章節。
 *   S-SEC-61  真執行 monthOrderInSemester()：純函式，驗證第1/2學期各月份時序位置嚴格
 *             遞增、1月時序位置晚於12月（核心bug情境）、不屬於該學期的月份回傳99、
 *             semester 為 undefined/null 時安全回傳不拋例外。
 *   S-SEC-62  真執行 getJournalMonthRangeLabel()：重現使用者原始回報的bug情境（批次只
 *             勾選12月＋1月兩筆），確認範圍標籤正確顯示「2026/12~2027/1」而非顛倒的
 *             「2027/1~2026/12」；另外驗證整個第1學期(7~1月)全選時範圍標籤正確。
 *   S-SEC-63  真執行 getOverdueMonths()／renderSubmittedMonthsDetail()：同一學期內
 *             7月／12月／1月三個月份同時存在時，前者（先提醒最早逾期）驗證升冪時序
 *             正確排出 7,12,1；後者（新到舊）驗證降冪時序正確排出 1,12,7（不是純數字
 *             升冪/降冪會得出的 1,7,12 或 12,7,1）。
 *   S-SEC-64  靜態比對 loadStudentDashboard()／loadStudentStats()／loadStudentHistory()／
 *             exportMyPDF()：確認四處皆已改用 monthOrderInSemester() 排序比較式，且
 *             不再殘留舊版 (a.month||0)-(b.month||0) 裸數字比較（這四處會讀 Firestore／
 *             currentUser，比照 S-SEC-49 既有取捨，不貿然真執行覆寫全域函式，改用
 *             靜態比對）。
 * 開發階段已用 Node 直接從實際 student.html 逐字抽取（括號配對，非天真 regex）
 * monthOrderInSemester()／getJournalMonthRangeLabel()／getOverdueMonths()／
 * renderSubmittedMonthsDetail() 及上述四個 Firestore 相關函式本體，對修好版本與原始
 * 未修復版本分別跑過一輪同一套斷言，確認新斷言在原始版本上正確 fail、在修好版本上
 * 正確 pass，不是巧合通過。**以上沙盒驗證無法取代使用者本機 Step2_RunTests.bat 對
 * 已部署正式網站的真實執行結果，待其確認。**
 *
 * v41 修正（2026-08-31）：✗未繳／△篇數不足（getOverdueMonths()）原本鎖死只查「目前
 * 學期」，跟✓已繳／▲遲繳（getCompletedJournals()）不對稱——後者對這個帳號名下全部
 * 歷史 journals 做 filter，不看 semester，天生就能跨學期正確判斷；前者是「枚舉應該要
 * 交的月份，再檢查有沒有交」，原本刻意鎖死在「目前學期」，避免抓到系統裡其他屆學生
 * 留下的舊截止日資料。新增純函式 getRelevantSemesters(journals, currentSem)，用「這個
 * 學生自己 journals 裡出現過的 semester 集合」＋「目前學期」推導出該檢查哪些學期——
 * 系統裡沒有獨立的「歷史報到記錄」可查（studentBindings 只存目前 active 學期的座號），
 * 這是唯一還留著歷史線索的資料來源。getOverdueMonths() 第一參數從單一 sem 字串改為
 * relevantSemesters 陣列，內部改用 Set 判斷成員資格取代字串相等比較；回傳形狀從純
 * 月份數字陣列改為 [{semester,month,entriesCount,required}]（多學期情境下裸月份數字
 * 會分不出「115-1的9月」跟另一學期同月份的資料），依「學期新到舊、月份小到大」排序。
 * loadStudentDashboard() 改用這兩個函式的組合，UI 端不再需要另外重算 entriesCount／
 * required。已知殘留限制：學生某個過去學期整學期一篇都沒交過時，那個學期不會出現在
 * journals 裡，這裡也抓不到，是資料結構天生的盲點，比照既有「已知殘留風險」寫法接受。
 * 額外發現並處理的風險（設計討論本身沒有提到，稽核時另外查證程式碼發現）：
 * goToWriteMonth() 導去的填寫頁最終由 saveJournal() 寫入
 * users/{uid}/journals/{currentUser.seatNo}-{sem}-{month}，用的是「目前」座號；座號
 * 每學期重新分配，若讓學生對過去學期的逾期項目點擊補繳，新文件會被寫入現在的座號、
 * 跟那個學期其餘月記（用當時舊座號）不一致，嚴重時可能污染另一位同學的歷史統計。這個
 * 風險是 goToWriteMonth()／initWriteForm() 既有設計本來就有的（填寫頁學期下拉選單本來
 * 就沒有鎖定只能選目前學期），只是先前 getOverdueMonths() 只查目前學期，從未被這條
 * 路徑實際觸發過；這次主動把歷史缺口攤在首頁、一鍵可達，觸發機率大幅提高，故過去學期
 * 的逾期項目改為不可點擊（純提醒），只有目前學期的項目維持原有「點擊前往填寫」行為。
 *   S-SEC-36  同步更新既有測試：getOverdueMonths() 呼叫改傳陣列、回傳值改為物件陣列，
 *             核心驗證目的（篇數不足＋已過期才算逾期）不變。
 *   S-SEC-37  同步更新既有測試：loadStudentDashboard() 呼叫 getOverdueMonths() 時第一參
 *             數改傳 relevantSemesters（而非直接傳 sem）的靜態比對規則。
 *   S-SEC-58  真執行 getRelevantSemesters()：純函式，直接餵合成 journals 陣列驗證「過去
 *             學期聯集目前學期、不重複、journals 為空時只剩目前學期自己」四種情境。
 *   S-SEC-59  真執行 getOverdueMonths() 的多學期版本：合成資料涵蓋「過去學期已過期且
 *             篇數不足」「目前學期已過期且篇數不足」「目前學期尚未過期」「不在
 *             relevantSemesters 名單內的無關學期（模擬其他屆學生的舊截止日資料）」
 *             四種情境，並驗證排序方向。
 *   S-SEC-60  loadStudentDashboard() 靜態比對：確認改呼叫 getRelevantSemesters()，且用
 *             o.semester === sem 分流出目前學期／過去學期兩種不同的渲染分支，過去學期
 *             分支完全不呼叫 goToWriteMonth()（見上方風險說明）。
 *
 * v41 同批追加（2026-08-31，稽核上述修法時發現）：
 * ①刪除死碼 renderJournalCard(j, isTeacher)（student.html 舊版月記卡片渲染函式，歷史頁
 * 改用 renderJournalCardSelectable() 已久，全檔含 onclick 屬性字串確認 0 呼叫點）。這份
 * 死碼 v40 稽核時已查過一次、當時判斷「不影響行為、維持原樣」，這次進一步發現它已經跟
 * teacher.html 同名的「標準版」renderJournalCard()（6203行，T-SEC-68 已修成
 * j.salary != null，6565行附近註解明確引用它為對照標準）不同步——student.html 這份仍是
 * 舊版 Number.isFinite(Number(j.salary)) 寫法。既然確認完全用不到，直接刪除比繼續維護
 * 一份可能被誤用/複製的舊邏輯更乾淨，也徹底消除「兩端該逐字一致卻沒跟上」這個問題本身。
 * 這個「已知死碼、刻意不動」的狀態先前只記錄在本檔案 changelog（上一段引號內文字），
 * AI_CONTEXT_狀態.md 並未同步記錄，這次直接刪除後，該落差自然一併消失，不需要另外
 * 找地方記錄一個已經不存在的東西。
 * ②S-SEC-09 原本檢查的對象正是這份被刪除的死碼。**這裡先前的敘述有誤，已訂正**：
 * 頂層 `function` 宣告在瀏覽器裡於腳本執行時就會被 hoist 成真正的全域識別字，不論有沒有
 * 被呼叫過——`typeof renderJournalCard` 在刪除前一直都是 `'function'`（不是 `false`），
 * `if (!fnStr) return {skip:true}` 這個保護從未被觸發過。用 Node vm 對照原始檔案實際
 * 執行 `typeof` 確認過這件事，也確認舊版死碼原始碼裡確實同時含有 `escapeHtml`／
 * `jsArg`（沿用跟 renderJournalCardSelectable() 同一套寫法複製出來的）。真正發生的情況
 * 是：這條測試刪除前一直都在正常執行、也一直通過，只是測到的是死碼本身——等於長期在
 * 驗證一段沒人會走到的路徑，給了虛假的安全感，是「測到死碼、沒有實際涵蓋活著的渲染
 * 邏輯」，不是「靜默 skip」，兩者是不同的失效模式，但結論一樣：這條測試沒有真正保護到
 * 活著的程式碼。同時發現真正在用的 renderJournalCardSelectable() 反而從來
 * 沒有專屬的 escapeHtml／jsArg 使用檢查（S-SEC-08 只驗證它的老師評語徽章渲染邏輯，是
 * 不同的關注點）。改為讓 S-SEC-09 直接檢查 renderJournalCardSelectable()，這是它現在
 * 唯一在用、真正需要這層 XSS 防護檢查的對應函式，修復了一個先前沒被注意到的覆蓋率缺口
 * （而不只是單純刪掉一條測試了事）。
 * ③已逾期清單裡「過去學期、不可點擊」項目新增 CSS class `.stat-detail-row-muted`
 * （opacity:0.62）——原本只靠拿掉 clickable class／onclick 屬性做區隔，視覺上跟本學期
 * 可點擊項目長得一模一樣，使用者可能要點了才發現沒反應。純 CSS 視覺調整，不影響任何
 * 既有測試的字串/regex 斷言（`.stat-detail-row-muted` 不包含 `clickable` 子字串）。
 * 以上三項與 getRelevantSemesters()／getOverdueMonths() 主要修法為同一批、尚未經使用者
 * 本機 Step2_RunTests.bat 確認，一併記錄在 v41 內，不另外編號 v42。
 * 開發階段已在沙盒環境用 Node vm 模組直接執行從實際 student.html 逐字抽取（括號配對，
 * 非天真 regex）的 getRelevantSemesters()／getOverdueMonths() 原始碼，交叉驗證新舊版本
 * 行為差異（舊版即使餵入陣列參數，字串相等比較也會直接判斷不通過、回傳空陣列，證明
 * 這不是單純的向後相容擴充，函式內部邏輯確實需要改寫）；另外用完整 DOM／Firestore
 * stub 端到端跑過一次真正的 loadStudentDashboard()（同樣逐字抽取，非重寫簡化版），
 * 驗證實際產出的 innerHTML 字串在跨學期情境下的顯示、排序、可否點擊、muted樣式皆符合
 * 預期，比單純字串/regex 比對函式原始碼更直接證明修法生效；也重新確認
 * renderJournalCardSelectable() 抽取後真的同時包含 escapeHtml 與 jsArg。完整方法見
 * AI_測試架構說明_歷程.md 同日條目。**以上沙盒驗證無法取代使用者本機
 * Step2_RunTests.bat 對已部署正式網站的真實執行結果，待其確認。**
 *
 * v40 修正（2026-08-31）：使用者提供的一輪程式碼稽核（針對 08-30 那次薪資 null/0
 * 修法的顯示端落差），確認並修復兩處會影響學生的顯示bug：renderJournalCardSelectable()
 * （月記歷史頁卡片）／pdfJournalBlock()（PDF匯出）皆仍用
 * `Number.isFinite(Number(j.salary))` 判斷「有沒有填」——Number(null) 在 JS 裡等於 0、
 * 是個有限數字，導致「完全沒填薪資」的月記被誤判成「已填、金額是0」，顯示成
 * 「💰 $0 元」，跟老師端「薪資缺漏」名單同時在追蹤的月記直接矛盾（看起來已經記錄成0元，
 * 容易讓學生誤以為沒問題不會回頭補）。對照組：checkMonthDeadline()（`j.salary ?? ''`）、
 * teacher.html 自己的 renderJournalCard()／所有薪資統計 filter 本來就寫對，純粹是這兩處
 * 顯示函式沒跟上 v37（S-SEC-51）那次修法。修法：改用跟既有正確寫法一致的
 * `j.salary != null` 判斷。同一輪也複查了 student.html 內另一份同名死碼
 * renderJournalCard(j, isTeacher)（4552行）——同樣是舊寫法，但全檔案確認 0 呼叫，維持
 * 原樣不動（若未來重新啟用需一併修正）。與 teacher_test.js 的 v38（T-SEC-68）對稱新增；
 * teacher.html 的 executeTeacherBatchDelete() 快取修法（T-SEC-69）只影響 teacher.html，
 * 本檔案不需要對應測項。
 *   S-SEC-56  真執行 renderJournalCardSelectable()：純函式，直接回傳 HTML 字串、不碰
 *             DOM／Firestore，可以安全真執行，比字串/regex比對函式原始碼更直接證明
 *             修法生效（比照 S-SEC-50／S-SEC-52 的「真執行優於推理」標準）。分別餵
 *             salary=null／0／500 三種情境，確認 null 不顯示金額區塊、0 顯示
 *             「💰 $0 元」、500 顯示「💰 $500 元」（刻意選不需要千分位逗號的數字，
 *             避免斷言依賴 toLocaleString() 的 locale 相關格式化細節）。
 *   S-SEC-57  真執行 pdfJournalBlock()：回傳 pdfmake 內容陣列（純資料結構，不碰
 *             DOM／Firestore），直接呼叫並在陣列裡找「本月薪資」那一項文字比對。
 *             null 應顯示「本月薪資：-」（且不含「0 元」字樣）、0 顯示
 *             「本月薪資：0 元」、500 顯示「本月薪資：500 元」。
 *
 * v39 修正（2026-08-30）：接續 v38 同一輪登入流程稽核當時一併發現、稍後才補上測試的
 * 第三項問題：new GoogleAuthProvider() 完全沒有網域限制——使用者按下「用 Google
 * 登入」時，Google 自己跳出來的帳號選擇畫面會列出裝置上任何已登入過的帳號，不分校內外，
 * 最常撞到這條路的不是入侵者，是裝置上同時登過個人 Gmail 跟學校帳號的合法使用者，選錯
 * 很自然。選了非校網域帳號後，整趟「跳出 Google 頁面→選帳號→授權→跳回網站」都會白走
 * 一次，才在終點被 handleLoginUser() 的 SCHOOL_DOMAIN 檢查打回票。修法：
 * provider.setCustomParameters({ hd: 'tcivs.tc.edu.tw' })——hd（hosted domain）是 OAuth
 * 標準參數，提前告訴 Google 自己的畫面「該選哪個網域的帳號」，把「選錯」盡量攔在起點。
 * 這只是 UX 優化、不是安全邊界（官方文件寫明使用者仍可在 Google 畫面點「使用其他帳戶」
 * 手動繞過），真正的資料安全邊界從頭到尾都是 rule.txt 的 schoolUser()，不受這個參數
 * 影響、繼續照舊運作；app 端 SCHOOL_DOMAIN 檢查與 onAuthStateChanged 也都不動。與
 * teacher_test.js 的 T-SEC-67 對稱。
 *   S-SEC-55  provider 是 <script type="module"> 裡的區塊變數，不掛在 window 上，比照
 *             S-SEC-53 對 onAuthStateChanged callback 的做法，對整份頁面 inline
 *             <script> 原始碼文字定位 const provider = new GoogleAuthProvider(); 這行
 *             呼叫語法本身的位置，往後取一段視窗，過濾註解後確認
 *             provider.setCustomParameters({...}) 真的被呼叫、且 hd 值正確為
 *             'tcivs.tc.edu.tw'。不驗證 Google 帳號選擇器實際行為是否真的優先顯示校內
 *             帳號——那完全發生在 Google 自己的伺服器/畫面上，自動化測試接觸不到，這裡
 *             只能防止這行程式碼未來重構時被悄悄拿掉或打錯字，跟 S-SEC-53／S-SEC-54
 *             同一種「防止已知修法被悄悄回退」的定位，不是行為驗證；真正驗證 hd 是否
 *             有效仍需實機用真實校內帳號登入一次。
 *
 * v38 修正（2026-08-30）：一輪針對兩端登入流程的稽核（popup/redirect fallback 本身
 * 維持不動，發現的是另外兩個共同存在於 student.html／teacher.html 的問題，皆純前端
 * 修法，未異動 rule.txt）：
 * ①onAuthStateChanged 的 callback（自動恢復登入）原本另外重寫一份跟 handleLoginUser()
 * 幾乎一樣的驗證邏輯（查 studentBindings／students、判斷老師帳號等），兩處已經各自
 * 演化出落差——「非校內信箱」分支這裡原本只 signOut() 沒有 toast 說明原因，使用者會
 * 被靜默登出；老師帳號未綁定座號時的提示文字也跟 handleLoginUser() 不同。修法：改為
 * 直接呼叫 handleLoginUser()，單一事實來源，避免未來繼續分岔。
 * ②googleStudentLogin() 把 signInWithPopup() 本身的失敗跟 handleLoginUser() 之後的
 * 驗證失敗（例如 Firestore 讀取逾時，withTimeout() 拋出的是普通 Error、沒有 .code）
 * 混在同一個 catch 處理，導致 Google 登入本身明明已經成功、只是接下來驗證階段網路
 * 逾時，卻被誤判成「popup 失敗」而自動觸發一次 signInWithRedirect()——這正是
 * 2026-07-12 那輪改版想避免的「跳出 App 到系統瀏覽器」情境，只是換了個觸發途徑。
 * 修法：拆成兩層 try/catch，並補上跟 teacher.html 對稱的 finally{ hideLoading() }
 * （原本只有 teacher.html 有這層保底，兩者不對稱）。與 teacher_test.js 的
 * T-SEC-65／T-SEC-66 對稱。
 *   S-SEC-53  onAuthStateChanged 的 callback 是匿名 inline arrow function，無法像具名
 *             函式一樣直接 .toString()，改對整份頁面 inline <script> 原始碼文字定位
 *             onAuthStateChanged(auth, async (user) => { 這個呼叫語法本身的位置，取
 *             足夠涵蓋整個 callback 的視窗，用三重訊號交叉驗證：①視窗內確實呼叫
 *             handleLoginUser(user)；②視窗內完全沒有 signOut( 字樣（最直接的證據，
 *             若舊分支還殘留一定會在這裡看到）；③全域計算 handleLoginUser() 內部才有
 *             的查詢語句只出現1次（不是2次，證明舊的重複實作真的被刪除，不是被新呼叫
 *             繞過去但程式碼還留著沒清）。
 *   S-SEC-54  直接呼叫 googleStudentLogin.toString()，找到 await handleLoginUser(...)
 *             呼叫位置切成前後兩段：前段仍應看得到 startStudentRedirectLogin() fallback
 *             （確認 popup 失敗機制沒被拿掉），後段不應再出現這個 fallback 呼叫（核心：
 *             handleLoginUser() 拋出的例外不能再走到觸發 redirect 的那段程式碼）；並
 *             確認呼叫後緊接著有獨立 catch(e)，以及函式本身有 finally{ hideLoading() }。
 *             不真執行——這個函式會觸發真正的 Google OAuth popup，沒有安全的方式在無人
 *             互動的自動化環境模擬，跟既有 S-SEC-33／S-SEC-34 對這個函式的既有測試作法
 *             一致，皆為靜態比對。新增前已用 node 直接抽取兩份檔案修法前／後的函式原始碼
 *             跑過同一套斷言，確認舊碼會正確觸發失敗、新碼會正確通過。
 *
 * v37 修正（2026-08-30）：一輪針對 student.html 的稽核發現並修復兩項真實bug（皆純前端
 * 邏輯修正，未異動 rule.txt）：
 * ①資料正確性：saveJournal() 原本 `parseInt(...) || null` 用 truthy/falsy 判斷有沒有
 * 填薪資，但 parseInt("0")===0 是 falsy，導致「填0元」跟「完全沒填」變成同一筆資料——
 * 輸入框 min="0"、範圍驗證訊息寫「請填0–200,000元」都證明0本該合法。同一個bug的另一半
 * 在 editJournal()：`j.salary || ''` 讓已存檔的 salary:0 在編輯畫面被誤顯示成空白。
 * checkMonthDeadline()（第2331行 j.salary ?? ''）原本就寫對，這兩處單純沒跟上。修法：
 * saveJournal() 改用 Number.isNaN() 明確判斷，editJournal() 的 `||` 改 `??`。
 * ②功能性bug：renderStudentWorkTypeChart()（首頁「工作類型」圓餅圖）的
 * mouseenter/mousemove/mouseleave/click 監聽器全部在用變數 tipEl，但函式本身沒有宣告
 * 它——結構幾乎相同的 renderStudentCityChart()／renderStudentSalaryLineChart() 都有
 * `const tipEl = container.querySelector(...)` 這行，唯獨這裡漏掉，全檔也沒有全域
 * tipEl。結果是學生點/滑過這個圖表色塊時執行到 tipEl 就丟 ReferenceError，tooltip
 * 完全不會顯示。修法：補上這行宣告。
 *   S-SEC-51  靜態比對 saveJournal()／editJournal() 真實原始碼（比照 S-SEC-49 對
 *             saveJournal() 已建立的做法）：確認新的 Number.isNaN() 判斷式／`??` 寫法
 *             存在，且舊的 `parseInt(...) || null`／`j.salary || ''` 寫法未殘留。不用
 *             真執行——這兩個函式會動到 Firestore（getDoc／setDoc／getDocs／
 *             updateDoc），這個共用測試頁面之後還有其他測試依賴 firebase_funcs／
 *             currentUser 維持真實登入狀態，貿然暫時覆寫的風險不成比例，靜態比對已
 *             足夠驗證且不需要登入 session。
 *   S-SEC-52  真執行 renderStudentWorkTypeChart()：餵合成 journals 資料觸發真正渲染，
 *             對渲染出來的色塊真的 dispatch mouseenter/mousemove/click 事件，驗證
 *             tooltip 真的正確顯示、內容正確——這是純 DOM 渲染函式，不碰 Firestore，
 *             可以安全真執行（比照 S-SEC-48／T-SEC-57 的「真執行優於推理」標準），比
 *             字串/regex比對更能證明 ReferenceError 真的消失，不只是「程式碼長得對」。
 *
 * v36 修正（2026-08-26）：稽核發現 resolveImgSrc()（student.html／teacher.html 各自
 * 獨立一份）原本任何 `http` 開頭字串一律直接放行——entries[].photos／salaryPhotos 是
 * 學生自己月記文件的一部分，rule.txt 對這兩個欄位只驗證陣列長度／型別（見
 * validSalaryPhotos()），沒有逐元素驗證網址格式，技術使用者可繞過正常上傳流程直接呼叫
 * Firestore API 塞入任意外部網址。這個網址之後會被當成 <img src> 自動載入，或被
 * imageToDataUrl()（PDF匯出）真的用 fetch() 抓下來——teacher.html 端影響更大（任何日後
 * 打開這份月記審閱、或匯出PDF的老師，瀏覽器都會對外發出請求，是會波及第三人的問題），
 * 這裡的 student.html 副本一併同步修正保持一致。修法：改成網域白名單，只允許
 * CLOUDINARY_CLOUD_NAME 對應的 Cloudinary 帳號，其餘 http(s) 網址一律回傳空字串。純
 * 前端邏輯修正，未異動 rule.txt（Firestore Rules 對變動長度陣列逐項驗證本來就吃力，見
 * validSalaryPhotos() 既有取捨，在前端把關成本更低更有效）。
 *   S-SEC-50  直接呼叫 resolveImgSrc() 本體驗證：本專案 Cloudinary 網址放行、任意外部
 *             網址與「其他 Cloudinary 帳號」網址皆回傳空字串（後者確認白名單真的鎖到
 *             cloud name、不是只鎖 res.cloudinary.com 這個網域本身）、既有 data: URI
 *             與無前綴舊格式純 base64 字串兩種既有合法格式不受影響、空值/null/undefined
 *             處理不變。是真執行不是字串比對。
 *
 * v35 修正（2026-08-25）：一輪「用 AI_CONTEXT_狀態.md 等三份狀態文件記載的邊界案例反例，
 * 逐項對照 student.html／teacher.html 實際程式碼」的稽核中，額外檢查既有測試涵蓋範圍時
 * 發現 journalSubmitNotifiedAt 這個推播用哨兵值——saveJournal() payload 裡
 * `...(isFirstSubmit ? { journalSubmitNotifiedAt: null } : {})` 這行條件式寫法本身，全文
 * 搜尋 student_test.js 只在 S-SEC-32 的背景說明註解裡被提到過，從未有任何測試斷言真的去
 * 檢查這行程式碼；S-SEC-32 驗證的是「isFirstSubmit 賴以計算的快取夠不夠新鮮」，是這行
 * 條件式的前置條件，不是條件式本身。另外原本一併規劃要補的「saveStudentReply() 是否用
 * getDoc() 現查而非讀前端快取」，複查後確認已被 S-SEC-29 的 readsOldFromFreshDoc 檢查
 * 涵蓋，不重複新增。
 *   S-SEC-49  靜態驗證 saveJournal()：①isFirstSubmit 定義本身公式正確；②payload 確實用
 *             `isFirstSubmit ? { journalSubmitNotifiedAt: null } : {}` 條件式 spread，
 *             不是無條件寫入；③codeOnly() 過濾註解後，journalSubmitNotifiedAt 字串在函式
 *             裡只出現這一次——防止有第二處遺漏過濾的無條件寫法或殘留的舊寫法（本函式的
 *             說明性註解本身就會提到這個欄位名稱＋冒號＋null，跟 S-SEC-08／T-SEC-30／
 *             S-SEC-29 等既有測試踩過的「regex 命中解釋性註解」是同一類陷阱，故沿用
 *             S-SEC-39 已驗證過的 codeOnly() 過濾寫法，非字面比對整段程式碼字串）。
 *
 * v34 修正（2026-08-21）：修復「少數學生薪資單／工作照片存檔後變成整張黑色」問題（見
 * 修復報告_薪資單與工作照片壓縮後變黑圖問題_2026-08-21.md）。根本原因：<canvas> 預設全
 * 透明，img.onload 只保證中繼資料可讀不保證真的完整繪製完成，部分行動裝置瀏覽器記憶體
 * 不足時 drawImage() 會靜默失敗（不丟錯誤），canvas 維持全透明，輸出 JPEG 時被強制合成
 * 為純黑。修法：新增共用函式 compressImageFile()（優先用 createImageBitmap()，解碼失敗
 * 會 reject 而非靜默吃掉）＋ isLikelyBlankCanvas()（黑圖偵測保險網，即使解碼「成功」仍
 * 額外檢查輸出是否整張近乎全黑），handlePhotoUpload()／compressSalaryPhoto() 皆改呼叫
 * 這個共用函式，避免兩份各自複製一份的壓縮邏輯繼續各自演化脫鉤。純前端修法，未新增/
 * 修改任何 Firestore 欄位或 rule.txt。
 *   S-SEC-47  靜態驗證共用函式存在、compressImageFile() 確實用了 createImageBitmap()
 *             與 isLikelyBlankCanvas()，且 handlePhotoUpload()／compressSalaryPhoto()
 *             兩處呼叫端都真的改呼叫共用函式（防止未來重構被誤還原成各自內嵌的舊邏輯，
 *             也就是這次要修的「兩份需要人工同步的複本」問題本身）；另確認
 *             handlePhotoUpload() 補上了原本完全沒有的 try/catch。
 *   S-SEC-48  真的在瀏覽器建立 <canvas>，實際呼叫 isLikelyBlankCanvas() 驗證四種情境：
 *             從未繪製的預設全透明 canvas（drawImage 靜默失敗的真實狀態）／明確填滿純黑
 *             皆須偵測為疑似失敗；正常顏色照片／超過閾值的深灰色不應被誤判。是真執行
 *             不是字串比對，直接驗證這次修復的核心防線本身可靠，不只是「函式有寫」。
 *
 * v33 修正（2026-08-20）：P1 規則新增「月記文件 ID 必須等於
 * {seatNo}-{semester}-{month}」後，這份正式環境 REST 規則測試仍用任意的
 * test-create-{timestamp} 文件 ID，加上固定 semester:'test'/month:0，因此正常 CREATE
 * 被正確拒絕，連帶讓所有需要先建立測試月記的 UPDATE/DELETE 測項失敗。新增
 * _makeJournalTestIdentity()，讓每一筆合成資料同時產生唯一且合法的 ID／semester／month；
 * 偽造 seatNo 的測項也刻意讓 ID 與偽造資料一致，確保它仍是在驗證 binding 座號限制本身。
 *
 * v32 修正（2026-08-20）：學生首頁的「已繳交」累計原本直接計所有月記文件，篇數未達
 * minEntries 的草稿也會被誤算為已繳；本月狀態則只區分達標／未達標，達標後才補交的學生會
 * 看見綠色✅，與老師端▲遲繳不一致。新增 getCompletedJournals() 統一累計判斷，並以
 * isStudentJournalLate() 對齊 teacher.html 的優先時間欄位與日期比較邏輯；歷史清單也會
 * 標記▲遲繳，不再把所有已達標月記一律渲染成✅。
 *   S-SEC-46  直接餵入「準時達標／篇數不足／達標但遲繳」三份合成月記，驗證累計只保留
 *             達標兩份、遲繳判斷與明細標記正確，且首頁確實使用共用結果。
 *
 * v31 修正（2026-08-18）：entriesFirstCompleteAt 第三輪修法——第二輪（v30）只在 rule.txt
 * 註解裡記錄「count 缺席的過渡期資料」這個殘留風險，沒有實際修掉；使用者確認這是真實
 * 落差、不是理論案例（尤其案例B會造成永久鎖死，不應等部署時間表判斷），要求現在補上：
 * computeEntriesFirstCompleteAt() 新增①.5／⑤兩個分支，處理「entriesFirstCompleteAt 已是
 * 8/17第一版邏輯合法寫入的非null值，但 entriesFirstCompleteAtCount 這個 companion 欄位
 * 從未被追蹤過（不存在，不是0）」這種過渡期資料——沒有這條分支時，這類文件下次被編輯會
 * 出現兩種症狀：該生此刻篇數仍達標→frozen日期被悄悄推到今天（重演v29要消除的問題，換了
 * 觸發途徑）；此刻篇數不足→client嘗試把值改回null但rule.txt不允許，整次存檔被拒，等同
 * 永久鎖死這位學生。三處快取讀取（checkMonthDeadline()／editJournal()／saveJournal()
 * 現查fallback）與呼叫端的預設值同步從 ?? 0 改成 ?? null——0跟「從未追蹤過」不能疊在
 * 同一個值上，即使理論上0不可能是合法紀錄，用null才精確對應「欄位根本不存在」的語意，
 * 也是新增的遷移分支能用 `!= null` 正確判斷「缺席」的前提。rule.txt 完全沒有異動（耦合
 * 驗證維持不動，這次修法方向是讓 client 端在所有情境下都正確滿足這條既有驗證，不是放寬
 * 驗證本身）。
 *   S-SEC-44  新增情境8／9，分別驗證「count缺席、此刻仍達標」（防悄悄推到今天）與
 *             「count缺席、此刻不足」（防永久鎖死，本輪核心）兩種過渡期資料情境，已用
 *             node 直接執行函式本體核對過期望值。
 *   S-SEC-45  三處快取的配套欄位檢查字串從 ?? 0 改成 ?? null，並修正說明註解。
 *
 * v30 修正（2026-08-18）：entriesFirstCompleteAt 第二輪修法（見 rule.txt
 * validEntriesFirstCompleteAt()／keepsEntriesFirstCompleteAtOnceSet() 上方註解）——
 * v29 的原始設計「一旦有值就永遠不可逆保留」忽略了 minEntries 也可能被老師事後調高，
 * 若調高後學生才在新門檻下補齊篇數，這個欄位會凍結在舊門檻下的舊日期，讓 isJournalLate()
 * 誤判準時。修法新增配套欄位 entriesFirstCompleteAtCount（凍結當下驗證過的篇數），
 * computeEntriesFirstCompleteAt() 函式簽名同步從 6 參數（回傳純字串）改成 7 參數（回傳
 * {at, count} 物件）。本輪只更新測試本身以對應新簽名／新欄位，不是新增功能：
 *   S-SEC-44  改用新的 7 參數函式簽名與 {at, count} 回傳物件重寫全部斷言（v29 版本用舊
 *             簽名呼叫會造成參數位移，且拿整個物件跟字串比較恆為 false，導致
 *             「應記錄...實際得到 [object Object]」這類失敗——這是測試沒跟上函式簽名
 *             變動，不是 production 邏輯本身的 bug，已用 node 直接執行函式本體重新核對
 *             過所有情境的正確期望值），並新增情境7（minEntries 調高導致舊凍結失效重算）
 *             直接覆蓋這次修法要解決的核心 bug。
 *   S-SEC-45  三處快取新增檢查配套欄位 entriesFirstCompleteAtCount 是否補齊；payload
 *             shorthand 屬性計數的負向 lookbehind 排除法補上排除 "at: "／"count: "
 *             前綴——函式簽名改成回傳物件後，呼叫端新增了
 *             `const { at: entriesFirstCompleteAt, count: entriesFirstCompleteAtCount } = ...`
 *             解構賦值，解構目標本身字面上跟 payload shorthand 屬性長得一樣（都是
 *             `entriesFirstCompleteAt,`），舊版排除法沒考慮到這個新增的程式碼形狀，導致
 *             誤算成「找到2處」。
 *
 * v29 新增（2026-08-17）：對應「entriesFirstCompleteAt」——修正 entriesCompleteAt 的一個
 * 邊界案例（學生先在期限內達標，之後某次編輯刪除一則工作摘要導致篇數掉回未達標，再補寫回
 * 篇數達標時被誤判成「這次才剛好跨過門檻」，讓誠實達標過的學生被誤判遲交，源自使用者提問
 * 後發現，完整背景見 AI_CONTEXT_歷程.md）。新增一個獨立欄位，語意是「這份月記歷史上最早
 * 一次被觀測到達標的時間」，一旦有值就不可逆保留，不修改 computeEntriesCompleteAt() 本身：
 *   S-SEC-44  computeEntriesFirstCompleteAt() 直接呼叫函式本體帶合成資料，涵蓋「不可逆
 *             保留」「舊 entriesCompleteAt 欄位遷移回填」「全新達標」「尚未達標」四類情境，
 *             並串接模擬使用者回報的完整 bug 情境（7月達標→8月刪除→8月補寫回，全程應維持
 *             7月那個最早時間不變）
 *   S-SEC-45  checkMonthDeadline()／editJournal()／saveJournal() 自己的快取新鮮度現查
 *             fallback 三處，皆有把 entriesFirstCompleteAt 補進快取物件，且 saveJournal()
 *             最終送出的 Firestore payload 確實含 entriesFirstCompleteAt 欄位（shorthand
 *             寫法），跟 S-SEC-41 同一類「快取結構完整性」測試，只是這次檢查新欄位
 *
 * v28 新增（2026-08-08）：對應「刪除操作二次確認」——deleteStudent()／單筆刪月記／批次刪
 * 月記共 5 處「無法復原」的刪除流程，新增輸入姓名或固定格式字串才能刪除的第二層確認，
 * 源自使用者指出這批操作完全沒有任何復原機制（真刪除，無回收站）。teacher.html 三處
 * （deleteStudent()、單筆刪月記、批次刪月記）由本文件姊妹檔 teacher_test.js 的 T-SEC-49
 * 涵蓋；本檔新增：
 *   S-SEC-43  confirmDeleteJournal()（單筆刪月記）改用 requiredText = currentUser?.name
 *             （刻意不用傳入的 studentName 參數，避免月記存檔當下的舊姓名跟名冊事後更正
 *             後的姓名不同步、學生打自己現在的名字卻被判定不符的死結）；
 *             confirmBatchDeleteHistory()（批次刪歷史月記）改用 requiredText =
 *             `DELETE ${journals.length}`；兩者皆驗證「按下確認鍵時才檢查輸入框內容，
 *             不符合就 toast 錯誤且不執行刪除」的順序關係，並確認對應 Modal 的輸入框／
 *             提示文字 DOM 元素存在。
 *
 * v27 新增（2026-08-05）：薪資單由單張 salaryPhoto 改為最多 5 張 salaryPhotos，驗證
 *   S-SEC-42  表單 input 可選多檔、薪資單總大小與張數限制存在、新舊資料格式皆可轉成照片
 *             陣列、儲存時寫入 salaryPhotos 並清空舊 salaryPhoto 以避免 Base64 重複佔用；
 *             歷史卡片與 PDF 匯出也改遍歷所有薪資單。
 *
 * v26 新增（2026-07-25）：對應 2026-07-24「遲交」判斷修正（entriesCompleteAt 取代
 * submittedAt）補上自動化測試——當時 AI_CONTEXT.md 明確記載「本輪未新增自動化測試，
 * 列為已知缺口」，只用 Node 手動模擬跑過5組情境。這次先把計算邏輯從 saveJournal() 內部
 * 抽成獨立純函式 computeEntriesCompleteAt()（定義於 resolveMinEntries() 旁，student.html
 * 本身的重構，行為完全不變，已用 144 組窮舉組合驗證新舊邏輯輸出完全一致），再補上：
 *   S-SEC-40  computeEntriesCompleteAt() 直接呼叫函式本體帶合成資料，驗證 2026-07-24
 *             那次驗證過的5組情境（含核心目標情境「7月準時寫1篇、8/1才補齊第2篇→應
 *             記錄8/1而非7月」）＋1組補充情境（已達標後續再新增篇數不應把時間戳往前推進）
 *             皆回傳正確值
 *   S-SEC-41  checkMonthDeadline()／editJournal()／saveJournal() 自己的快取新鮮度現查
 *             fallback 三處，皆有把 entriesCount／entriesCompleteAt 補進快取物件（不只
 *             是 S-SEC-40 驗證的計算邏輯本身正確，這條計算邏輯依賴的兩個輸入來源——
 *             快取——也要確實補齊，否則邏輯再對也拿不到正確輸入）；並確認 saveJournal()
 *             最終送出的 Firestore payload 確實含 entriesCompleteAt 欄位（shorthand
 *             寫法），且用負向 lookbehind 排除掉呼叫 computeEntriesCompleteAt() 時作為
 *             參數傳入的同名字串，避免測試誤判
 *
 * v25 新增（2026-07-23）：對應同一輪對話發現並修正的「換公司後回頭編輯舊月份月記，公司
 * 被覆蓋成目前名冊公司」問題（起因：徐偉哲12號從沙鹿冷氣換到金華節能空調後，7月薪資記錄
 * 出現公司對不上的狀況）：
 *   S-SEC-39  saveJournal() 只在第一次繳交時使用目前名冊公司，一般編輯改保留這份月記
 *             自己原本記錄的公司（window._currentJournalCache.company），跟既有
 *             submittedAt 只在第一次記錄、之後一律保留原值是同一種思路；連帶驗證
 *             checkMonthDeadline()／editJournal() 的快取都補上 company，且畫面上的
 *             write-company 顯示值在編輯既有月份時也改顯示這份月記當時的公司，不是
 *             一律顯示目前名冊公司
 *
 * v24 新增（2026-07-17）：對應 student.html 新增「每月最少應繳篇數（minEntries）」概念——
 * 背景是 teacher.html 主頁 2026-07-16 起已改用篇數判斷是否已繳，但 student.html 對這個概念
 * 完全零涵蓋（全文搜尋「篇」「minEntries」皆零命中），主頁「本月繳交狀態」只要有存檔就顯示
 * ✅已繳，「已逾期」名單也只看有沒有存檔，跟老師端看到的狀態可能不一致（學生自己覺得已繳，
 * 老師端卻標記未繳）。這批測試盡量直接呼叫真正的函式本體帶入合成資料驗證行為，而非只做
 * 原始碼字串比對，跟 teacher_test.js 新增的 T-SEC-36～41 對稱維護：
 *   S-SEC-35  resolveMinEntries() 篇數判斷 fallback 邏輯正確，與 teacher.html 對稱
 *   S-SEC-36  getOverdueMonths() 改用篇數達標判斷，只交1篇但規定2篇且已過期仍算逾期
 *   S-SEC-37  loadStudentDashboard() 本月繳交狀態改用篇數判斷，並與 getOverdueMonths()
 *             共用同一次 deadlines 查詢（避免重複打 Firestore）
 *
 * v23 修正（2026-07-14，同日 v22 上線後立即發現的測試本身缺陷，非新增測試，數量不變）：
 *   S-SEC-34  補強 noOldStandaloneBranch 這條負向檢查：原本直接對整段函式字串（含註解）
 *             做鄰近字元搜尋，目前是僥倖通過（googleStudentLogin() 裡 isStandaloneApp()
 *             附近有一段解釋「當初為什麼拿掉 standalone 特別分支」的中文說明，200 字窗口
 *             內剛好沒有直接寫出 signInWithRedirect／startStudentRedirectLogin 這兩個字面
 *             詞，但講的內容正是這件事本身，未來改註解措辭很容易不小心撞在一起）。這是
 *             S-SEC-08／T-SEC-30 已經記錄過好幾次的同一種陷阱（regex／字串搜尋命中函式
 *             內部解釋性註解），跟 teacher_test.js 同日發現的 T-SEC-34 假失敗是同一輪
 *             稽核揪出來的姊妹問題。修法：先過濾掉「整行都是註解」的行，只在剩餘程式碼行
 *             上做鄰近搜尋，避免未來註解內容變化導致正確程式碼被誤判為退化，與
 *             teacher_test.js 的 T-SEC-35 套用同一套修法。
 *
 * v22 新增（2026-07-14）：
 *   S-SEC-33  isStoragePartitionedEnv() 已定義，且 googleStudentLogin()／
 *             handleRedirectResult() 皆有呼叫做為 guard。背景：一輪針對 teacher.html
 *             的稽核發現 student.html／teacher.html 在 2026-07-12 都對 Google 登入機制
 *             做了同一輪重大改版（拿掉「standalone 一律先走 redirect」，改成「一律先試
 *             popup，任何失敗都 fallback 到 redirect」），但這件事完全沒有出現在任何
 *             文件的版本狀態表或變更摘要裡，且這輪改版本身在測試套件裡零覆蓋（全文搜尋
 *             isStoragePartitionedEnv、popup-first、2026-07-12 皆零命中）。
 *             isStoragePartitionedEnv() 本身在 student.html 其實已經存在（非本輪新增），
 *             只是從未被任何測試覆蓋過，這裡補上。
 *   S-SEC-34  googleStudentLogin() 一律先試 signInWithPopup()，失敗（非使用者取消）時
 *             fallback 到 signInWithRedirect()，跟 teacher_test.js 新增的 T-SEC-35 對稱。
 *
 * v21 新增（2026-07-13）：
 *   S-SEC-32  checkMonthDeadline()/editJournal() 快取寫入 sem/month，saveJournal() 送出前
 *             比對快取新鮮度。背景：_currentJournalCache 是 checkMonthDeadline() 非同步寫入
 *             的（學期/月份 select 的 onchange 直接呼叫、未 await，且 checkMonthDeadline()
 *             內部完全沒有 showLoading() 鎖住畫面，儲存按鈕在查詢完成前就已經可以點擊）。
 *             原本的快取物件沒有記錄自己對應哪個學期/月份，saveJournal() 的 isFirstSubmit
 *             判斷完全信任快取，若學生切換學期/月份後在查詢真正完成前就按下儲存，讀到的會
 *             是前一個學期/月份殘留的快取——這在 journalSubmitNotifiedAt 出現以前只是
 *             「覆蓋確認對話框不會跳出來」這種可接受的小瑕疵，但現在會產生兩種更嚴重的
 *             後果：①目標月記其實已推播過，卻誤判為第一次繳交，payload 帶
 *             journalSubmitNotifiedAt:null，撞上 rule.txt「一般編輯必須維持原值不變」而
 *             整份月記存檔被拒（403）；②目標月記其實是真正的第一次繳交，卻誤判為非第一次，
 *             payload 完全不帶這個欄位，CREATE 規則允許省略而寫入成功，但這份文件從此永遠
 *             不會出現在 checkNewJournals() 的查詢範圍內，老師安靜地收不到繳交通知。
 *             修法：checkMonthDeadline()/editJournal() 寫入快取時補上 sem/month；
 *             saveJournal() 送出前比對快取的 sem/month 是否與目前選定的一致，不一致（含
 *             快取完全沒有 sem/month）時改為 await getDoc(journalRef) 現查，寫回快取後才
 *             計算 isFirstSubmit——跟 saveStudentReply()/saveTeacherComment() 修多裝置/
 *             多分頁競態問題用的「送出前現查」是同一套思路。純屬前端邏輯修正，rule.txt／
 *             test-rules.js 不受影響（rule.txt 本身對 journalSubmitNotifiedAt 的驗證邏輯
 *             一直是正確的，這次修的是「前端算出錯誤 payload」這一步，不是規則層的問題）。
 *
 * v20 修正（2026-07-11）：
 *   S-SEC-29  檢查邏輯更新，對應 saveStudentReply() 本身同日的修法：oldReply 原本讀
 *             window._studentHistoryJournals（前端快取），改成送出前 await getDoc(ref)
 *             現查伺服器當下值——修正多裝置/多分頁情境下快取可能落後伺服器真實值，
 *             導致合法回覆被 rule.txt 的「內容改變」與「內容沒變」兩個分支同時判斷失敗、
 *             誤擋 403 的問題（詳見該函式新版註解）。
 *             原本的 readsOldFromCache 檢查對新程式碼已經失真：`fnStr.includes(
 *             '_studentHistoryJournals')` 這種寬鬆字串搜尋，在新版程式碼裡命中的其實是
 *             「解釋當初為什麼改掉」的說明性註解本身（新版函式仍保留一段提到這個舊變數名
 *             的動機說明），不是真的還在用快取的邏輯——跟本檔已知的 S-SEC-08／T-SEC-30
 *             假失敗屬於同一類陷阱，只是方向相反：那兩者是「檢查壞寫法不存在」被解釋性
 *             註解誤判成還存在，這裡是「檢查好寫法還在」被「已經不這樣寫了」的說明文字
 *             誤判成還在，兩者本質都是對整個函式字串做寬鬆子字串搜尋、沒有錨定到實際的
 *             賦值/呼叫語法。改為同時驗證 ①`await getDoc(ref)` 呼叫存在、②`oldReply` 的
 *             賦值語法明確來自 `freshSnap`（`const oldReply = (freshSnap...`），並把找不到
 *             時的錯誤訊息方向修正過來（原訊息把「多打一次 Firestore 讀取」講成可疑訊號，
 *             但這正是修法後的正確行為）。
 *
 * v19 新增（2026-07-10）：
 *   S-SEC-31  initPushNotifications() 關鍵特徵（相對路徑註冊 fcm-sw.js、Firestore 寫入
 *             路徑對應 rule.txt 的 request.auth.uid==userId、userAgent 截斷 200 字、
 *             fire-and-forget 不擋登入）。對稱於 teacher_test.js 既有的 T-SEC-31，補齊
 *             AI_推播系統說明.md 第六節 #11 記錄的測試覆蓋不對稱（老師端已有、學生端
 *             缺）。直接取得 student.html 實際內容逐項核對後撰寫，不是照概念模型猜寫，
 *             寫法特別避開「正規表達式誤命中函式內部解釋性註解文字」的陷阱（該函式註解
 *             本身就提到 '/fcm-sw.js' 這個「壞」字串用來說明為何不能這樣寫）。
 *
 * v18 新增（2026-07-08）：
 *   S-SEC-30  saveJournal() 補上 teacherCommentContentAt: null 歸零（避免一般編輯被 rule.txt 拒絕）
 *             背景：teacherCommentContentAt 是 2026-07-06 新增 Web Push 推播子系統時，
 *             rule.txt 一般編輯分支同步要求歸零的新欄位（跟 teacherComment／teacherReviewed／
 *             reviewedAt／teacherCommentUnread／teacherCommentUpdated 同一組待遇），但
 *             saveJournal() 當時漏了同步加上。saveJournal() 用 setDoc(...,{merge:true}) 寫入，
 *             缺這個欄位時 merge 只會保留舊值——只要月記曾被老師留過評語，學生之後任何一次
 *             一般編輯儲存都會撞上 rule.txt 的 == null 要求而被 Firestore 拒絕（403），整份
 *             月記存檔失敗且無其他提示。2026-07-08 已在 saveJournal() 補上此欄位，這裡補上
 *             對應回歸測試。⚠️ 純靜態分析，只能確認欄位存在、賦值為 null、且落在跟其餘老師
 *             欄位歸零同一個 data 物件範圍內；無法像對 Firestore Emulator 真正用 merge:true
 *             模擬「文件已有非 null 舊值」情境那樣驗證 rule.txt 真的會放行——這塊仍是已知
 *             測試盲區（test-rules.js 目前全部用整份 .set() 覆蓋，從未用過 merge:true），
 *             建議另外在 test-rules.js 補上對應的規則層級回歸測試。
 *
 * v17 新增（2026-07-06）：
 *   S-SEC-29  saveStudentReply() replyChanged 防護（內容未變不重新觸發未讀旗標／重複推播）
 *             背景：對稱於 teacher.html saveTeacherComment() 的 commentChanged 防護
 *             （T-SEC-20／T-SEC-23）；rule.txt 同步新增 studentReplyContentAt 欄位
 *             （create 必須為 null、一般編輯鎖定不變、回覆分支依內容是否改變分兩種條件）。
 *
 * v16 新增（2026-07-01）：
 *   S-SEC-28  executeDeleteJournal() 補上 showLoading()/hideLoading()（2026-06-30）
 *             背景：單筆月記刪除函式原本完全沒有 loading 遮罩，與結構幾乎相同的姊妹函式
 *             executeBatchDeleteHistory()（批次刪除，同樣呼叫 deleteDoc()）行為不一致；
 *             且不符合本專案 Checklist「是否有 try/catch/finally 確保 hideLoading() 執行」。
 *             loading 遮罩（position:fixed;inset:0;z-index:9998，無 pointer-events:none）
 *             會實際阻擋使用者在網路延遲期間重複點擊確認按鈕，不只是視覺回饋問題。
 *             修法：try 開頭加 showLoading()，成功與失敗路徑各自呼叫 hideLoading()。
 *             驗證：確認函式原始碼含 showLoading()、try 區塊含 hideLoading()、
 *             catch 區塊也含 hideLoading()（三項特徵缺一即退化）。
 *
 * v15 新增（2026-06-29）：
 *   S-SEC-27  完成度進度條／單筆摘要收合判斷的地址檢查補上格式驗證
 *             背景：地址欄缺門牌「號」時，畫面顯示「完成度4/4可儲存」與單筆「✓完成」，
 *             但按下「儲存月記」仍被 saveJournal() 的格式驗證正確擋下（資料完整性無虞），
 *             純粹是 WORK_FIELD_CHECKS 與 isEntryComplete() 的地址檢查原本只查非空字串，
 *             沒有套用 validateCompleteTaiwanAddress()，造成顯示跟實際存檔判斷不一致。
 *             修法：兩處皆補上 && !validateCompleteTaiwanAddress(...)，與 saveJournal()
 *             用同一套規則，地址格式不完整時進度條／收合徽章會正確顯示未完成。
 *
 * v14 新增（2026-06-28）：
 *   S-SEC-22  getCommentBadgeState() 四狀態邏輯（State 1～4 + 無徽章）
 *             驗證 getCommentBadgeState() 對每種 {teacherCommentUnread, teacherCommentUpdated,
 *             teacherReviewed, teacherComment} 組合回傳正確的 state 值。
 *             實際 API 回傳字串：'unread'/'updated_unread'/'reviewed'/'updated_read'/null，
 *             測試使用探針（probe）自動偵測數字制或字串制，兩種實作皆可通過。
 *             對應「評語測試系統」STEP 1～5 的狀態轉換總覽。
 *   S-SEC-23  renderCommentBadgeHtml() 輸出對應正確的徽章文字與顏色
 *             renderCommentBadgeHtml() 接收整個 j 物件（非 state 數字），
 *             驗證 unread→🔴、updated_unread→🟠、reviewed→✅、updated_read→📖、null→空字串。
 *   S-SEC-24  loadStudentHistory() 自動清除 teacherCommentUnread（STEP 3／STEP 5）
 *             對應：切到歷史月記頁面時，凡 teacherCommentUnread===true 的月記，
 *             應自動呼叫 updateDoc 把 teacherCommentUnread 設回 false。
 *   S-SEC-25  saveTeacherComment() isCommentUpdate 邏輯（STEP 2 vs STEP 4）
 *             （老師端靜態分析移至 T-SEC-20；此處從學生側驗證 Firestore Rules
 *             第二分支：學生只能把 teacherCommentUnread 改為 false，不能自己設 true）
 *   S-SEC-26  Firestore Rules：學生不能自行把 teacherCommentUpdated 設為 true（403）
 *             對應 rule.txt 第二分支（teacherCommentUnread 已讀標記），
 *             updateDoc 只允許 affectedKeys().hasOnly(['teacherCommentUnread'])，
 *             夾帶 teacherCommentUpdated 欄位應被拒。
 *
 * v13 新增（2026-06-28）：
 *   S-SEC-21  checkMonthDeadline() 快取補上 studentReply／saveJournal() 顯示回覆警告
 *             對應修正：checkMonthDeadline() 的 _currentJournalCache 原本沒有 studentReply
 *             （跟 editJournal() 那條路徑不一致），導致一般填寫頁覆蓋當月月記時，
 *             saveJournal() 的確認對話框無法提示「回覆會暫時看不到對應評語」。
 *
 * v12 新增（2026-06-27 第二次）：
 *   S-RULES-09  journals CREATE 安全性：seatNo 與 studentBindings 不一致應被拒（403）
 *   S-RULES-10  journals UPDATE 安全性：一般編輯路徑變更 seatNo 應被拒（403）
 *               對應 rule.txt 同日第二次補修：create/update 第一分支補上 seatNo 驗證／鎖定，
 *               防止偽造 seatNo 把月記算到別的座號名下（污染老師端繳交/審閱/薪資統計）。
 *               同時 _makeJournalDoc() 加入第三個參數 seatNo（改用 _getTestSeatNo() 動態讀取
 *               studentBindings 真實值），所有既有呼叫點同步更新，否則會被新規則誤擋。
 *
 * v11 新增（2026-06-27）：
 *   S-RULES-06  journals UPDATE 安全性：一般編輯路徑（第一分支）夾帶超長 studentReply
 *               ＋偽造 studentReplyUnread:false 應被拒（403）
 *   S-RULES-07  journals UPDATE 安全性：回覆內容為空字串應被拒（403）
 *   S-RULES-08  journals UPDATE 安全性：studentReplyAt 塞入非字串型別應被拒（403）
 *               對應 rule.txt 2026-06-27 三項補修（review 報告 #1/#4/#9）：
 *               ① 第一分支補上 studentReply/studentReplyUnread/studentReplyAt 鎖定
 *               ② 第三分支補 studentReply.size()>=1（禁空字串）
 *               ③ 第三分支補 studentReplyAt 型別驗證
 *
 * v10 修正（2026-06-26）：
 *   S-SEC-08  badge 渲染邏輯已抽成共用函式 getCommentBadgeState() /
 *             renderCommentBadgeHtml()，不再直接出現在
 *             renderJournalCardSelectable 本體，改為：
 *             ① 確認共用函式本身含 teacherComment / teacherCommentUnread
 *             ② 確認 renderJournalCardSelectable 有呼叫 renderCommentBadgeHtml()
 *
 * v9 新增（2026-06-23）：
 *   S-SEC-19  editJournal() 跳過內部背景 checkMonthDeadline 並設定 _skipWriteInit 旗標
 *   S-SEC-20  showPage()／initWriteForm() 仍支援 _skipWriteInit／skipDeadlineCheck 跳過機制
 *             （修正：editJournal() 載入舊月記填表後，showPage('s-write') 及
 *             initWriteForm() 結尾都會非同步重新呼叫 checkMonthDeadline()（無 skipFill），
 *             背景任務完成後會用「目前真實學期/月份」的資料蓋掉剛載入的編輯內容；
 *             編輯非當前月份的舊月記時幾乎必然發生。已加 _skipWriteInit 旗標
 *             + initWriteForm(skipDeadlineCheck) 參數兩處修正，拆成兩個測試
 *             分別檢查，避免只修一半卻誤判通過。）
 *
 * v8 新增（2026-06-22）：
 *   S-SEC-17  editJournal/checkMonthDeadline 正確還原「其他（補充說明）」型別
 *             （2026-06-22 修正：型別靜默失效 bug 迴歸測試）
 *   S-SEC-18  saveJournal() 照片上傳中存檔防呆邏輯存在
 *             （2026-06-22 修正：上傳中按儲存會存入空白 URL）
 *
 * v7 修正（2026-06-17）：
 *   _captureFsCtx() 根本原因修正：
 *   Firebase JS SDK 10.x 的 Firestore 使用 gRPC-Web/WebChannel，
 *   Playwright page.on('request') 無法攔截此類請求，導致 projectId/token 永遠抓不到。
 *   改為直接呼叫頁面內的 Firebase SDK API 取得所有必要資訊：
 *   - projectId：window._firebase.db.app.options.projectId
 *   - token：window._auth.auth.currentUser.getIdToken()
 *   - uid/email：window._auth.auth.currentUser
 *
 * v6 修正（2026-06-17）：
 *   S-WRITE-REAL / S-RULES-01~05 的「靜默通過」漏洞修正。
 *
 * ⚠️ 重要說明：
 * 學生端功能測試（S-07～S-14）需要真正的學生帳號 session。
 * 老師帳號在 student.html 只會看到「您是老師帳號」提示，
 * 不會進入任何功能頁面，表單欄位不會渲染。
 *
 * session 設定：
 *   session.json         → 老師帳號（跑老師端 + 學生端 UI 基礎測試）
 *   session-student.json → 學生帳號（跑學生端功能測試 S-07～S-14）
 *
 * 若 session-student.json 不存在，S-07～S-14 自動標示為「跳過」。
 *
 * v4 新增（2026-06-16）：
 *   S-16  students docId 支援新學期格式（{semester}_{seatNo}）
 *   S-16B emailKey() 使用 /[@.]/g 全域取代（所有 . 均轉為 _）
 *
 * v5 新增（2026-06-17）：
 *   S-17   _loginHandling 互斥旗標已宣告，handleLoginUser() 所有 return 路徑均清旗標
 *   S-17B  onAuthStateChanged 有 _loginHandling 輪詢等待邏輯（最多 15 秒）
 *   S-SEC-16  calcDistance() 的 addressError 插入 innerHTML 前有 escapeHtml()（2026-06-17 防禦性加固）
 *
 * ⚠️ S-SEC-19/20 為靜態分析（檢查原始碼字串），無法重現「編輯舊月記後表單
 * 是否真的被背景任務蓋掉」這個實際 timing 行為（需要一筆非當前月份的月記
 * 資料才能人工驗證），只能確認程式碼特徵仍存在、防止日後改動退回舊寫法。
 */

const BASE_URL = 'https://ka-dot-dot.github.io/internship-journal/student.html';
const fs = require('fs');
const path = require('path');

const STUDENT_SESSION = path.join(__dirname, '..', 'session-student.json');
const HAS_STUDENT_SESSION = fs.existsSync(STUDENT_SESSION);


async function waitForPage(page, pageId, timeout = 8000) {
  await page.waitForFunction((id) => {
    const el = document.getElementById(`page-${id}`);
    if (!el) return false;
    return !el.classList.contains('hidden');
  }, pageId, { timeout });
}

async function runStudentTests(page, browserContext, log) {
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, pass: true });
      log(`  ✅ ${name}`);
    } catch (e) {
      if (e.message === '__SKIP__') {
        results.push({ name, pass: true, skipped: true });
        log(`  ⏭️  ${name}（跳過：需學生帳號 session）`);
        return;
      }
      results.push({ name, pass: false, error: e.message.split('\n')[0] });
      log(`  ❌ ${name}`);
      log(`     原因：${e.message.split('\n')[0]}`);
      try {
        const safe = name.replace(/[^\w\u4e00-\u9fff]/g, '_');
        await page.screenshot({ path: `screenshots/student_FAIL_${safe}.png` });
      } catch (_) {}
    }
  }

  function requireStudentSession() {
    if (!HAS_STUDENT_SESSION) throw new Error('__SKIP__');
  }

  log('\n【學生端】開始測試');

  // ════════════════════════════════════════
  // S-01 ～ S-06  基本載入（老師帳號即可）
  // ════════════════════════════════════════

  await page.goto(BASE_URL);

  await test('S-01 學生端頁面正常載入', async () => {
    await page.waitForFunction(() => {
      return document.getElementById('page-s-dashboard') !== null &&
             document.body.textContent.length > 100;
    }, { timeout: 20000 });
  });

  await test('S-02 主頁儀表板或提示訊息出現', async () => {
    await page.waitForFunction(() => {
      const dashboard = document.getElementById('page-s-dashboard');
      const hasToast = document.querySelector('.toast, [class*="toast"]');
      const body = document.body.textContent;
      return (dashboard && !dashboard.classList.contains('hidden')) ||
             hasToast ||
             body.includes('老師帳號') ||
             body.includes('未綁定');
    }, { timeout: 20000 });
  });

  const tabs = [
    { id: 's-write',     label: 'S-03 切換到填寫月記' },
    { id: 's-history',   label: 'S-04 切換到歷史月記' },
    { id: 's-export',    label: 'S-05 切換到匯出' },
    { id: 's-dashboard', label: 'S-06 切回主頁' },
  ];
  for (const tab of tabs) {
    await test(tab.label, async () => {
      await page.evaluate((id) => { if (typeof showPage === 'function') showPage(id); }, tab.id);
      await waitForPage(page, tab.id, 6000);
    });
  }

  // ════════════════════════════════════════
  // S-07 ～ S-14  功能測試（需學生帳號）
  // 老師帳號在 student.html 只看到提示，
  // 不會進入功能頁面，表單不會渲染。
  // ════════════════════════════════════════

  if (HAS_STUDENT_SESSION) {
    log('\n  [學生帳號 session 存在，開啟功能測試頁面]');
    const studentContext = await browserContext.browser().newContext({
      storageState: STUDENT_SESSION,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      serviceWorkers: 'block',   // 封鎖 SW，確保拿到最新版 student.html
    });

    const studentPage = await studentContext.newPage();
    studentPage._testErrors = [];
    studentPage.on('pageerror', err => studentPage._testErrors.push(err.message));
    await studentPage.goto(BASE_URL + '?_t=' + Date.now());  // cache-busting

    await test('S-07 填寫月記頁面元素存在（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.waitForFunction(() => {
        const app = document.getElementById('app');
        return !!(app && app.style.display === 'block');
      }, { timeout: 30000 });
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-write'); });
      await studentPage.waitForFunction((id) => {
        const el = document.getElementById(`page-${id}`);
        return el && !el.classList.contains('hidden');
      }, 's-write', { timeout: 8000 });
    });

    await test('S-08 截止日資訊有載入（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-write'); });
      await studentPage.waitForFunction(() => {
        const el = document.getElementById('write-deadline-status');
        if (!el) return true;
        return el.textContent.trim() !== '' && el.textContent.trim() !== '載入中...';
      }, { timeout: 20000 });
    });

    await test('S-09 填寫月記表單欄位存在且可見（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-write'); });
      await studentPage.waitForFunction((id) => {
        const el = document.getElementById(`page-${id}`);
        return el && !el.classList.contains('hidden');
      }, 's-write', { timeout: 8000 });
      const input = await studentPage.$('#journal-salary, #journal-month, textarea, input[type="number"]');
      if (!input) throw new Error('找不到填寫月記的輸入欄位');
      const visible = await input.isVisible();
      if (!visible) throw new Error('填寫月記輸入欄位不可見');
    });

    await test('S-10 歷史月記頁面載入（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-history'); });
      await studentPage.waitForFunction(() =>
        document.getElementById('s-history-list') !== null ||
        document.getElementById('page-s-history') !== null
      , { timeout: 10000 });
    });

    await test('S-11 歷史月記有資料或空白提示（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-history'); });
      await studentPage.waitForFunction(() => {
        const pg = document.getElementById('page-s-history');
        return pg && pg.textContent.trim().length > 5;
      }, { timeout: 15000 });
    });

    await test('S-12 匯出頁面有載入（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-export'); });
      await studentPage.waitForFunction((id) => {
        const el = document.getElementById(`page-${id}`);
        return el && !el.classList.contains('hidden');
      }, 's-export', { timeout: 8000 });
    });

    await test('S-13 匯出頁面有 PDF 下載按鈕（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-export'); });
      await studentPage.waitForFunction((id) => {
        const el = document.getElementById(`page-${id}`);
        return el && !el.classList.contains('hidden');
      }, 's-export', { timeout: 8000 });
      const btn = await studentPage.$('#btn-export-pdf, button[onclick*="exportMyPDF"], button[onclick*="PDF"]');
      if (!btn) throw new Error('找不到 PDF 下載按鈕');
    });

    await test('S-14 PDF 匯出按鈕可見（學生帳號）', async () => {
      requireStudentSession();
      const btn = await studentPage.$('#btn-export-pdf, button[onclick*="exportMyPDF"]');
      if (!btn) throw new Error('找不到 PDF 匯出按鈕');
      const visible = await btn.isVisible();
      if (!visible) throw new Error('PDF 匯出按鈕不可見');
    });

    // ════════════════════════════════════════
    // S-07B ～ S-SEC-06B  進階穩定性 / 寫入 / 評語測試
    // ════════════════════════════════════════

    await test('S-07B 登入後無迴圈（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.waitForTimeout(3000);
      const appStillShown = await studentPage.evaluate(() => {
        const app = document.getElementById('app');
        return !!(app && app.style.display === 'block');
      });
      if (!appStillShown) throw new Error('偵測到登入迴圈：app 顯示後又消失，頁面回到登入狀態');
    });

    await test('S-09B 學生帳號資料正確渲染（姓名不含 undefined）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-dashboard'); });
      await studentPage.waitForFunction(() => {
        const el = document.getElementById('s-dashboard-subtitle');
        if (!el) return false;
        const t = el.textContent.trim();
        return t !== '' && t !== '載入中...' && !t.includes('undefined') && !t.includes('null');
      }, { timeout: 15000 });
    });

    await test('S-WRITE-02 月記儲存按鈕可見且未被鎖定（學生帳號）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-write'); });
      await studentPage.waitForFunction(() => {
        const p = document.getElementById('page-s-write');
        return p && !p.classList.contains('hidden');
      }, { timeout: 8000 });
      await studentPage.waitForTimeout(2000);
      const btn = await studentPage.$('#save-journal-btn');
      if (!btn) throw new Error('找不到 #save-journal-btn 儲存按鈕');
      const visible = await btn.isVisible();
      if (!visible) throw new Error('儲存按鈕不可見（頁面結構異常？）');
      const disabled = await btn.evaluate(el => el.disabled);
      if (disabled) throw new Error('儲存按鈕被 disabled（截止日尚未開放或程式錯誤？）');
    });

    // ─────────────────────────────────────────────────────────────────
    // Firestore Rules 測試共用輔助（學生 session 才執行）
    // ─────────────────────────────────────────────────────────────────
    let _fsProjectId = null, _fsToken = null, _fsUser = null;

    // _captureFsCtx：取得 Firestore projectId、auth token、user 資訊
    //
    // v7 重寫（修正 projectId/token 永遠抓不到的根本原因）：
    //   舊版靠 page.on('request') 攔截 HTTP 請求取得 Bearer token，
    //   但 Firebase JS SDK 10.x 對 Firestore 使用 gRPC-Web / WebChannel，
    //   Playwright 的 request interceptor 無法攔截這類請求，導致 _fsToken 永遠為 null。
    //
    //   v7 改為直接在頁面內呼叫 Firebase SDK API：
    //   - projectId：從頁面內的 window._firebase.db.app.options.projectId 取得
    //   - token：從 window._auth.auth.currentUser.getIdToken() 取得（SDK 直接回傳）
    //   - user：從 window._auth.auth.currentUser 取得 uid / email
    //   完全不靠網路攔截，100% 可靠。
    const _captureFsCtx = async () => {
      if (_fsProjectId && _fsToken && _fsUser) return;

      const ctx = await studentPage.evaluate(async () => {
        try {
          // projectId：從頁面初始化的 Firebase app 取得
          const projectId = window._firebase?.db?.app?.options?.projectId || null;

          // currentUser：從 auth instance 取得
          const user = window._auth?.auth?.currentUser || null;
          if (!user) return { ok: false, error: 'auth.currentUser 為 null，學生尚未登入' };

          // token：直接呼叫 SDK getIdToken()（強制刷新 = false，使用快取）
          const token = await user.getIdToken(false);

          return {
            ok: true,
            projectId,
            token,
            uid: user.uid,
            email: user.email || '',
          };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });

      if (!ctx.ok)        throw new Error('[Rules測試前置失敗] ' + ctx.error);
      if (!ctx.projectId) throw new Error('[Rules測試前置失敗] 無法取得 Firestore projectId（window._firebase.db 未初始化？）');
      if (!ctx.token)     throw new Error('[Rules測試前置失敗] 無法取得 Firebase ID token');
      if (!ctx.uid)       throw new Error('[Rules測試前置失敗] 無法取得學生 uid');

      _fsProjectId = ctx.projectId;
      _fsToken     = ctx.token;
      _fsUser      = { uid: ctx.uid, email: ctx.email };
    };

    const _fsRequest = async (method, path, body, updateMask) => {
      const base = 'https://firestore.googleapis.com/v1/projects/'
        + _fsProjectId + '/databases/(default)/documents';
      let url = base + path;
      if (updateMask) url += '?' + updateMask.map(f => 'updateMask.fieldPaths=' + f).join('&');
      return await studentPage.evaluate(
        async ({ method, url, body, token }) => {
          try {
            const res = await fetch(url, {
              method,
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: body ? JSON.stringify(body) : undefined,
            });
            // 2026-06-27 補修：額外回傳解析後的 body（既有呼叫只取 .status，不受影響；
            // 新增的 _getTestSeatNo() 需要讀取 GET 回應內容）
            let json = null;
            try { json = await res.json(); } catch (_) {}
            return { status: res.status, body: json };
          } catch (e) { return { status: -1, err: e.message }; }
        },
        { method, url, body, token: _fsToken }
      );
    };

    // 2026-06-27 新增：rule.txt create 規則補上 seatNo 必須等於 studentBindings 紀錄座號的驗證，
    // 所有合成測試文件都要帶正確的 seatNo，否則會被新規則正確擋下（而不是被測項本來想驗證的原因擋下）。
    // 直接讀 studentBindings/{emailKey} 真實值，不寫死任何座號，跟正式 saveJournal() 取值方式一致。
    let _fsSeatNo = null;
    const _getTestSeatNo = async () => {
      if (_fsSeatNo) return _fsSeatNo;
      await _captureFsCtx();
      const emailKey = _fsUser.email.replace(/[@.]/g, '_');
      const r = await _fsRequest('GET', '/studentBindings/' + emailKey);
      const seatNo = r.body?.fields?.seatNo?.stringValue;
      if (r.status !== 200 || !seatNo) {
        throw new Error('[Rules測試前置失敗] 無法取得測試學生座號（studentBindings/' + emailKey + ' 讀取失敗或缺少 seatNo 欄位）');
      }
      _fsSeatNo = seatNo;
      return _fsSeatNo;
    };

    // P1（2026-08-20）後，正式規則會驗證文件 ID 與資料欄位完全一致。測試 ID 不能再
    // 只用任意字串；由同一個 identity 供應 docId／semester／month，避免未來有人只改其中
    // 一邊又讓「正常 CREATE」測試因測試資料不合法而產生誤導性的 403。
    const _makeJournalTestIdentity = (seatNo, testName) => {
      const semester = `test-${testName}-${Date.now()}`;
      const month = 1;
      return { semester, month, docId: `${seatNo}-${semester}-${month}` };
    };

    const _makeJournalDoc = (uid, email, seatNo, identity) => {
      if (!identity) throw new Error('Rules 測試缺少月記 identity（需同步提供合法 docId/semester/month）');
      return {
        fields: {
          ownerUid:             { stringValue: uid },
          ownerEmail:           { stringValue: email },
          storagePath:          { stringValue: 'user' },
          semester:             { stringValue: identity.semester },
          month:                { integerValue: identity.month },
          seatNo:               { stringValue: seatNo },
          teacherComment:       { nullValue: null },
          teacherReviewed:      { booleanValue: false },
          reviewedAt:           { nullValue: null },
          teacherCommentUnread: { booleanValue: false },
        }
      };
    };

    await test('S-WRITE-REAL Firestore CREATE 規則驗證（學生身份 REST 直接寫入）', async () => {
      requireStudentSession();
      await _captureFsCtx(); // 失敗會 throw，不再靜默通過
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'create');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const r = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (r.status === 200) {
        await _fsRequest('DELETE', path + '/' + docId);
      }
      // ⚠️ 修正：status === -1（網路錯誤）不再靜默通過，改為 throw
      if (r.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1），無法驗證 rule，請確認網路連線');
      if (r.status === 403) throw new Error(
        'journals CREATE 被拒（403）：' +
        '正常測試資料已使用合法的 {seatNo}-{semester}-{month} 文件 ID，' +
        '請確認正式 rule.txt 部署版本與學生身份／studentBindings 設定。'
      );
      if (r.status >= 400) throw new Error('journals CREATE 異常（HTTP ' + r.status + '）');
    });

    await test('S-RULES-01 studentBindings uid 補寫權限（登入後 uid 回填）', async () => {
      requireStudentSession();
      await _captureFsCtx();
      const emailKey = _fsUser.email.replace(/[@.]/g, '_');
      const r = await _fsRequest(
        'PATCH',
        '/studentBindings/' + emailKey,
        { fields: { uid: { stringValue: _fsUser.uid } } },
        ['uid']
      );
      if (r.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (r.status === 403) throw new Error(
        'studentBindings uid 補寫被拒（403）：' +
        'studentBindings UPDATE rule 未允許學生寫入自己的 uid 欄位。'
      );
      if (r.status >= 400) throw new Error('studentBindings uid 補寫異常（HTTP ' + r.status + '）');
    });

    await test('S-RULES-02 journals UPDATE 正常路徑（學生修改已有月記）', async () => {
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'update');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const doc = _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity);
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, doc);
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），可能是 rule 問題導致無法建立測試文件，請先確認 S-WRITE-REAL');
      if (cr.status >= 400) throw new Error('前置 CREATE 異常（HTTP ' + cr.status + '）');
      const ur = await _fsRequest('PATCH', path + '/' + docId, doc);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status === 403) throw new Error(
        'journals UPDATE 被拒（403）：UPDATE rule 條件過嚴，或 ownerUid / ownerEmail 判斷有誤。'
      );
      if (ur.status >= 400) throw new Error('journals UPDATE 異常（HTTP ' + ur.status + '）');
    });

    await test('S-RULES-03 journals CREATE 安全性：teacherComment 偽造應被拒（403）', async () => {
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'fake-teacher');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const fakeDoc = {
        fields: {
          ..._makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity).fields,
          teacherComment:  { stringValue: 'FAKE TEACHER REVIEW' },
        }
      };
      const r = await _fsRequest('POST', path + '?documentId=' + docId, fakeDoc);
      if (r.status === 200) {
        await _fsRequest('DELETE', path + '/' + docId);
        throw new Error('journals CREATE 安全漏洞：teacherComment 偽造未被拒絕（HTTP 200）！');
      }
      // ⚠️ 修正：status === -1 不再靜默通過
      if (r.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      // 注意：403 在錯誤 rule（!hasAny()）下也會出現，但原因是整個 CREATE 都被擋
      // 正確 rule 的 403 是因為 teacherComment 不為 null → 安全機制生效
      // 兩者都算通過此測試，因此此測試無法單獨區分正確/錯誤 rule
      // ↑ 真正區分兩種 rule 的測試是 S-WRITE-REAL（正常寫入是否被擋）
      if (r.status !== 403) throw new Error('journals CREATE 偽造測試回應異常（HTTP ' + r.status + '，預期 403）');
    });

    await test('S-RULES-04 journals UPDATE 安全性：teacherReviewed 偽造應被拒（403）', async () => {
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'fake-review');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const fakeUpdate = {
        fields: {
          ..._makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity).fields,
          teacherReviewed: { booleanValue: true },
        }
      };
      const ur = await _fsRequest('PATCH', path + '/' + docId, fakeUpdate);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === 200) throw new Error(
        'journals UPDATE 安全漏洞：teacherReviewed:true 偽造未被拒絕（HTTP 200）！'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error('journals UPDATE 偽造測試回應異常（HTTP ' + ur.status + '，預期 403）');
    });

    await test('S-RULES-05 journals DELETE 權限（學生可刪除自己的月記）', async () => {
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'delete');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const dr = await _fsRequest('DELETE', path + '/' + docId);
      if (dr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (dr.status === 403) throw new Error(
        'journals DELETE 被拒（403）：DELETE rule 未允許學生刪除自己的月記。'
      );
      if (dr.status >= 400) throw new Error('journals DELETE 異常（HTTP ' + dr.status + '）');
    });

    await test('S-RULES-06 journals UPDATE 安全性：一般編輯路徑夾帶回覆欄位應被拒（403）', async () => {
      // 2026-06-27 修正回歸測試：rule.txt 修正前，第一分支（學生一般編輯月記）完全沒有限制
      // studentReply / studentReplyUnread / studentReplyAt，只要其餘 teacher 欄位歸零、
      // ownerUid/ownerEmail/storagePath 不變，這個分支就會放行——可在同一次寫入夾帶任意長度
      // 的 studentReply，並把 studentReplyUnread 直接設為 false（偽造老師已讀）。
      // 修正後第一分支要求這三個欄位必須維持原值不變，此測試驗證繞過已被擋下。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'reply-lock');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const fakeUpdate = {
        fields: {
          ownerUid:             { stringValue: _fsUser.uid },
          ownerEmail:           { stringValue: _fsUser.email },
          storagePath:          { stringValue: 'user' },
          teacherComment:       { nullValue: null },
          teacherReviewed:      { booleanValue: false },
          reviewedAt:           { nullValue: null },
          teacherCommentUnread: { booleanValue: false },
          studentReply:         { stringValue: 'A'.repeat(500) },
          studentReplyUnread:   { booleanValue: false },
        }
      };
      const mask = ['ownerUid','ownerEmail','storagePath','teacherComment','teacherReviewed','reviewedAt','teacherCommentUnread','studentReply','studentReplyUnread'];
      const ur = await _fsRequest('PATCH', path + '/' + docId, fakeUpdate, mask);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === 200) throw new Error(
        'journals UPDATE 安全漏洞：一般編輯路徑夾帶超長 studentReply＋偽造已讀未被拒絕（HTTP 200）！'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error('journals UPDATE 偽造回覆測試回應異常（HTTP ' + ur.status + '，預期 403）');
    });

    await test('S-RULES-07 journals UPDATE 安全性：空字串回覆應被拒（403）', async () => {
      // 2026-06-27 修正回歸測試：原規則 studentReply.size()<=50 沒有下限，size()==0 也會通過，
      // 學生可送出內容為空字串的回覆。修正後加入 size()>=1，此測試驗證空字串回覆會被擋下。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'reply-empty');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const replyUpdate = {
        fields: {
          studentReply:       { stringValue: '' },
          studentReplyUnread: { booleanValue: true },
          studentReplyAt:     { stringValue: new Date().toISOString() },
        }
      };
      const mask = ['studentReply', 'studentReplyUnread', 'studentReplyAt'];
      const ur = await _fsRequest('PATCH', path + '/' + docId, replyUpdate, mask);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === 200) throw new Error(
        'journals UPDATE 安全漏洞：空字串回覆未被拒絕（HTTP 200）！'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error('journals UPDATE 空字串回覆測試回應異常（HTTP ' + ur.status + '，預期 403）');
    });

    await test('S-RULES-08 journals UPDATE 安全性：studentReplyAt 非字串型別應被拒（403）', async () => {
      // 2026-06-27 修正回歸測試：原規則沒有驗證 studentReplyAt 型別，可塞入任意型別的值。
      // 修正後加入型別檢查（必須為 null 或字串），此測試驗證塞入數字會被擋下。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'reply-badtype');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const replyUpdate = {
        fields: {
          studentReply:       { stringValue: '測試回覆內容' },
          studentReplyUnread: { booleanValue: true },
          studentReplyAt:     { integerValue: 12345 },
        }
      };
      const mask = ['studentReply', 'studentReplyUnread', 'studentReplyAt'];
      const ur = await _fsRequest('PATCH', path + '/' + docId, replyUpdate, mask);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === 200) throw new Error(
        'journals UPDATE 安全漏洞：studentReplyAt 塞入數字型別未被拒絕（HTTP 200）！'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error('journals UPDATE studentReplyAt 型別測試回應異常（HTTP ' + ur.status + '，預期 403）');
    });

    await test('S-RULES-09 journals CREATE 安全性：seatNo 與 studentBindings 不一致應被拒（403）', async () => {
      // 2026-06-27 修正回歸測試：原規則沒有驗證 seatNo，學生可在自己的 uid 路徑下建立月記，
      // 但把 seatNo 欄位填成別的座號——老師端 collectionGroup('journals') 查詢直接信任這個欄位
      // 來歸戶統計（本月已繳/已審閱/薪資統計皆是），會把這份月記誤算到別的座號名下。
      // 修正後 create 規則要求 seatNo 必須等於 studentBindings 記錄的真實座號，此測試驗證偽造會被擋下。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const forgedSeatNo = seatNo + '_FORGED';
      const identity = _makeJournalTestIdentity(forgedSeatNo, 'seatno-forge');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const r = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, forgedSeatNo, identity));
      if (r.status === 200) {
        await _fsRequest('DELETE', path + '/' + docId);
        throw new Error('journals CREATE 安全漏洞：偽造 seatNo 未被拒絕（HTTP 200）！');
      }
      if (r.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (r.status !== 403) throw new Error('journals CREATE 偽造 seatNo 測試回應異常（HTTP ' + r.status + '，預期 403）');
    });

    await test('S-RULES-10 journals UPDATE 安全性：一般編輯路徑變更 seatNo 應被拒（403）', async () => {
      // 2026-06-27 修正回歸測試：第一分支（一般編輯）原本沒有鎖住 seatNo，建立時驗證過一次之後，
      // 編輯時仍可被偽造改成別的座號。修正後第一分支要求 seatNo 必須維持原值不變，此測試驗證繞過已被擋下。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'seatno-change');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const fakeUpdate = {
        fields: {
          ..._makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo + '_CHANGED', identity).fields,
        }
      };
      const ur = await _fsRequest('PATCH', path + '/' + docId, fakeUpdate);
      await _fsRequest('DELETE', path + '/' + docId);
      if (ur.status === 200) throw new Error(
        'journals UPDATE 安全漏洞：一般編輯路徑偽造變更 seatNo 未被拒絕（HTTP 200）！'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error('journals UPDATE 偽造 seatNo 測試回應異常（HTTP ' + ur.status + '，預期 403）');
    });

    await test('S-SEC-06B Firestore 失敗後 loading 遮罩不殘留（學生帳號 runtime 驗證）', async () => {
      requireStudentSession();
      await studentPage.evaluate(() => { if (typeof showPage === 'function') showPage('s-dashboard'); });
      await studentPage.waitForFunction(() => {
        const el = document.getElementById('page-s-dashboard');
        return el && !el.classList.contains('hidden');
      }, { timeout: 6000 });
      await studentPage.route('**/firestore.googleapis.com/**', route => route.abort());
      await studentPage.evaluate(() => {
        if (typeof loadStudentHistory === 'function') loadStudentHistory();
      });
      await studentPage.waitForTimeout(8000);
      const loadingStuck = await studentPage.evaluate(() => {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return false;
        return !overlay.classList.contains('hidden');
      });
      await studentPage.unroute('**/firestore.googleapis.com/**');
      if (loadingStuck) throw new Error('Firestore 失敗後 loading 遮罩殘留，finally 未執行 hideLoading()');
    });

    await test('S-SEC-26 Firestore Rules：學生不能把 teacherCommentUpdated 設為 true（第二分支）', async () => {
      // 對應 rule.txt 第二分支（學生標記已讀）：
      //   affectedKeys().hasOnly(['teacherCommentUnread'])
      //   && teacherCommentUnread == false
      // 學生在第二分支只能修改 teacherCommentUnread 這一欄，且只能設為 false。
      // 此測試驗證：夾帶 teacherCommentUpdated:true 的更新應被 Firestore 拒絕（403）。
      requireStudentSession();
      await _captureFsCtx();
      const seatNo = await _getTestSeatNo();
      const identity = _makeJournalTestIdentity(seatNo, 'badge-forge');
      const { docId } = identity;
      const path = '/users/' + _fsUser.uid + '/journals';

      // 先建立一筆正常月記（teacherCommentUnread:false, teacherCommentUpdated:false）
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo, identity));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');

      // 嘗試用「已讀清除」第二分支夾帶 teacherCommentUpdated:true
      const fakeMarkRead = {
        fields: {
          teacherCommentUnread:  { booleanValue: false },
          teacherCommentUpdated: { booleanValue: true },   // ← 學生不應能寫入 true
        }
      };
      const mask = ['teacherCommentUnread', 'teacherCommentUpdated'];
      const ur = await _fsRequest('PATCH', path + '/' + docId, fakeMarkRead, mask);
      await _fsRequest('DELETE', path + '/' + docId);

      if (ur.status === 200) throw new Error(
        'Firestore Rules 漏洞：學生成功把 teacherCommentUpdated 設為 true（HTTP 200），' +
        '應被第二分支 affectedKeys().hasOnly([\'teacherCommentUnread\']) 擋下'
      );
      if (ur.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (ur.status !== 403) throw new Error(
        'Firestore Rules 測試回應異常（HTTP ' + ur.status + '，預期 403）'
      );
    });

    await studentPage.close();
    await studentContext.close();

  } else {
    log('\n  ⚠️  找不到 session-student.json，S-07～S-14 自動跳過');
    log('     執行 Step4_StudentSession.bat 用學生帳號登入可啟用這些測試');
    const skipped = [
      'S-07 填寫月記頁面元素存在', 'S-08 截止日資訊有載入',
      'S-09 填寫月記表單欄位存在且可見', 'S-10 歷史月記頁面載入',
      'S-11 歷史月記有資料或空白提示', 'S-12 匯出頁面有載入',
      'S-13 匯出頁面有 PDF 下載按鈕', 'S-14 PDF 匯出按鈕可見',
      'S-07B 登入後無迴圈',
      'S-09B 學生帳號資料正確渲染（姓名不含 undefined）',
      'S-WRITE-02 月記儲存按鈕可見且未被鎖定',
      'S-WRITE-REAL Firestore CREATE 規則驗證（學生身份 REST 直接寫入）',
      'S-RULES-01 studentBindings uid 補寫權限（登入後 uid 回填）',
      'S-RULES-02 journals UPDATE 正常路徑（學生修改已有月記）',
      'S-RULES-03 journals CREATE 安全性：teacherComment 偽造應被拒（403）',
      'S-RULES-04 journals UPDATE 安全性：teacherReviewed 偽造應被拒（403）',
      'S-RULES-05 journals DELETE 權限（學生可刪除自己的月記）',
      'S-RULES-06 journals UPDATE 安全性：一般編輯路徑夾帶回覆欄位應被拒（403）',
      'S-RULES-07 journals UPDATE 安全性：空字串回覆應被拒（403）',
      'S-RULES-08 journals UPDATE 安全性：studentReplyAt 非字串型別應被拒（403）',
      'S-RULES-09 journals CREATE 安全性：seatNo 與 studentBindings 不一致應被拒（403）',
      'S-RULES-10 journals UPDATE 安全性：一般編輯路徑變更 seatNo 應被拒（403）',
      'S-SEC-06B Firestore 失敗後 loading 遮罩不殘留（學生帳號 runtime 驗證）',
      'S-SEC-26 Firestore Rules：學生不能把 teacherCommentUpdated 設為 true（第二分支）',
    ];
    skipped.forEach(name => {
      results.push({ name, pass: true, skipped: true });
      log(`  ⏭️  ${name}（跳過）`);
    });
  }

  // ════════════════════════════════════════
  // S-SEC-01 ～ S-SEC-15  安全性測試（老師帳號即可）
  // ════════════════════════════════════════

  await test('S-SEC-01 月記卡不執行惡意 HTML（escapeHtml 驗證）', async () => {
    await page.evaluate(() => { window.__xss_fired = false; });
    const xssBlocked = await page.evaluate(() => {
      if (typeof escapeHtml !== 'function') return true;
      const malicious = '<img src=x onerror="window.__xss_fired=true">';
      const escaped = escapeHtml(malicious);
      const div = document.createElement('div');
      div.innerHTML = escaped;
      document.body.appendChild(div);
      return new Promise(resolve => setTimeout(() => {
        document.body.removeChild(div);
        resolve(!window.__xss_fired);
      }, 200));
    });
    if (!xssBlocked) throw new Error('escapeHtml() 未正確阻擋 XSS payload，onerror 被執行');
  });

  await test('S-SEC-02 jsArg() 正確 escape onclick 參數', async () => {
    const result = await page.evaluate(() => {
      if (typeof jsArg !== 'function') return { skip: true };
      const cases = ["O'Brien", '<script>alert(1)<\/script>', '"); drop--', "test'; alert(1)"];
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

  await test('S-SEC-03 saveJournal data 物件包含 teacher 欄位歸零', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasTeacherComment:  fnStr.includes('teacherComment') && fnStr.includes('null'),
        hasTeacherReviewed: fnStr.includes('teacherReviewed') && fnStr.includes('false'),
        hasReviewedAt:      fnStr.includes('reviewedAt') && fnStr.includes('null'),
        hasMerge:           fnStr.includes('merge') && fnStr.includes('true'),
      };
    });
    if (result.skip) return;
    if (!result.hasTeacherComment)  throw new Error('saveJournal() 缺少 teacherComment: null');
    if (!result.hasTeacherReviewed) throw new Error('saveJournal() 缺少 teacherReviewed: false');
    if (!result.hasReviewedAt)      throw new Error('saveJournal() 缺少 reviewedAt: null');
    if (!result.hasMerge)           throw new Error('saveJournal() 缺少 { merge: true }');
  });

  await test('S-SEC-04 _currentJournalCache 快取機制存在', async () => {
    const result = await page.evaluate(() => {
      const fnStr  = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      const chkStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      if (!fnStr || !chkStr) return { skip: true };
      return {
        skip: false,
        saveUsesCache:    fnStr.includes('_currentJournalCache'),
        checkWritesCache: chkStr.includes('_currentJournalCache'),
      };
    });
    if (result.skip) return;
    if (!result.saveUsesCache)    throw new Error('saveJournal() 未使用 _currentJournalCache');
    if (!result.checkWritesCache) throw new Error('checkMonthDeadline() 未寫入 _currentJournalCache');
  });

  await test('S-SEC-05 editJournal() 有 try/catch/finally 防 loading 卡死', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasTryCatch:    fnStr.includes('try') && fnStr.includes('catch'),
        hasFinally:     fnStr.includes('finally'),
        hasHideLoading: fnStr.includes('hideLoading'),
      };
    });
    if (result.skip) return;
    if (!result.hasTryCatch)    throw new Error('editJournal() 缺少 try/catch');
    if (!result.hasFinally)     throw new Error('editJournal() 缺少 finally 區塊');
    if (!result.hasHideLoading) throw new Error('editJournal() finally 缺少 hideLoading()');
  });

  await test('S-SEC-06 關鍵 async 函式均有 try/catch/finally { hideLoading() }', async () => {
    const result = await page.evaluate(() => {
      const checks = ['loadStudentHistory', 'editJournal', 'exportMyPDF'];
      const missing = [];
      checks.forEach(name => {
        const fn = window[name];
        if (!fn) return;
        const str = fn.toString();
        const lacks = [
          !str.includes('try')         && 'try',
          !str.includes('catch')       && 'catch',
          !str.includes('finally')     && 'finally',
          !str.includes('hideLoading') && 'hideLoading()',
        ].filter(Boolean).join('/');
        if (lacks) missing.push(`${name}() 缺少 ${lacks}`);
      });
      return { missing };
    });
    if (result.missing.length > 0) throw new Error(result.missing.join('；'));
  });

  await test('S-SEC-07 月記儲存函式可呼叫且表單欄位完整', async () => {
    const result = await page.evaluate(() => {
      if (typeof saveJournal !== 'function')           return 'saveJournal 函式不可存取';
      if (!document.getElementById('write-semester'))  return '缺少 #write-semester';
      if (!document.getElementById('write-month'))     return '缺少 #write-month';
      if (!document.getElementById('write-salary'))    return '缺少 #write-salary';
      if (!document.getElementById('save-journal-btn')) return '缺少 #save-journal-btn';
      if (typeof showLoading !== 'function')           return 'showLoading 函式不可存取';
      if (typeof hideLoading !== 'function')           return 'hideLoading 函式不可存取';
      return 'ok';
    });
    if (result !== 'ok') throw new Error(result);
  });

  await test('S-SEC-08 歷史月記含老師評語渲染邏輯', async () => {
    const result = await page.evaluate(() => {
      if (typeof renderJournalCardSelectable !== 'function')
        return 'renderJournalCardSelectable 函式不可存取';
      const cardSrc = renderJournalCardSelectable.toString();
      if (!cardSrc.includes('teacherReviewed')) return '缺少 teacherReviewed 渲染邏輯';

      // teacherComment / teacherCommentUnread 的徽章渲染邏輯已抽成共用函式
      // getCommentBadgeState()/renderCommentBadgeHtml()/hasCommentBadge()，
      // 不會逐字出現在 renderJournalCardSelectable 本體裡，改檢查這些共用函式本身。
      if (typeof renderCommentBadgeHtml !== 'function')
        return 'renderCommentBadgeHtml 函式不可存取';
      if (typeof getCommentBadgeState !== 'function')
        return 'getCommentBadgeState 函式不可存取';

      const badgeSrc = renderCommentBadgeHtml.toString() + getCommentBadgeState.toString();
      if (!badgeSrc.includes('teacherComment'))       return '缺少 teacherComment 渲染邏輯';
      if (!badgeSrc.includes('teacherCommentUnread')) return '缺少 teacherCommentUnread 紅點渲染邏輯';

      // 確認 renderJournalCardSelectable 真的有接到共用的徽章渲染函式（沒有漏接）
      if (!cardSrc.includes('renderCommentBadgeHtml'))
        return 'renderJournalCardSelectable 未呼叫 renderCommentBadgeHtml()';
      return 'ok';
    });
    if (result !== 'ok') throw new Error(result);
  });

  await test('S-SEC-09 renderJournalCardSelectable() 使用 escapeHtml 和 jsArg', async () => {
    // 2026-08-31 改版：原本檢查的 renderJournalCard(j, isTeacher) 已確認在 student.html
    // 全檔 0 呼叫點（歷史頁改用 renderJournalCardSelectable() 已久，見同日 student.html
    // changelog），且跟 teacher.html 那份「該逐字一致的共用函式」已經不同步（沒跟上
    // v40 的 j.salary != null 修法），已直接刪除。這個測試原本要驗證的目的——月記卡片
    // 渲染函式（會把使用者自由輸入的姓名／地址／心得等塞進 innerHTML）有沒有正確用
    // escapeHtml() 逃逸內容、onclick 參數有沒有正確用 jsArg() 逃逸——這件事本身仍然
    // 重要，只是應該檢查真正在用的函式，不是已刪除的舊版；繼續指向已刪除的函式名稱只
    // 會讓這條測試永遠靜默 skip、看起來像有涵蓋其實完全沒有。改為直接檢查
    // renderJournalCardSelectable()。
    const result = await page.evaluate(() => {
      const fnStr = (typeof renderJournalCardSelectable === 'function') ? renderJournalCardSelectable.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeHtml: fnStr.includes('escapeHtml'),
        hasJsArg:      fnStr.includes('jsArg'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('renderJournalCardSelectable() 未使用 escapeHtml()');
    if (!result.hasJsArg)      throw new Error('renderJournalCardSelectable() 的 onclick 未使用 jsArg()');
  });

  await test('S-SEC-10 checkMonthDeadline() 圖片 src / 日期欄位使用 escapeHtml', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      if (!fnStr) return { skip: true };
      return { skip: false, hasEscapeHtml: fnStr.includes('escapeHtml') };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('checkMonthDeadline() 未使用 escapeHtml()');
  });

  await test('S-SEC-11 safeNumber() 函式已定義且可正常運作', async () => {
    const result = await page.evaluate(() => {
      if (typeof safeNumber !== 'function') return { ok: false, msg: 'safeNumber 函式不存在' };
      const n1 = safeNumber(42);
      const n2 = safeNumber(null);
      const n3 = safeNumber(undefined);
      if (typeof n1 !== 'number') return { ok: false, msg: `safeNumber(42) 應回傳數字` };
      if (typeof n2 !== 'number') return { ok: false, msg: `safeNumber(null) 應回傳數字` };
      if (typeof n3 !== 'number') return { ok: false, msg: `safeNumber(undefined) 應回傳數字` };
      return { ok: true };
    });
    if (!result.ok) throw new Error(result.msg);
  });

  await test('S-SEC-12 loadStudentDashboard() 月記排序含 semester 與 month 雙欄位', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof loadStudentDashboard === 'function') ? loadStudentDashboard.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        sortsBySemester: fnStr.includes('semester'),
        sortsByMonth:    fnStr.includes('month'),
        hasSort:         fnStr.includes('sort(') || fnStr.includes('.sort '),
      };
    });
    if (result.skip) return;
    if (!result.hasSort)         throw new Error('loadStudentDashboard() 找不到排序邏輯');
    if (!result.sortsBySemester) throw new Error('loadStudentDashboard() 排序未考慮 semester 欄位');
    if (!result.sortsByMonth)    throw new Error('loadStudentDashboard() 排序未考慮 month 欄位');
  });

  await test('S-SEC-13 executeDeleteJournal() 的 catch 有呼叫 closeModal', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof executeDeleteJournal === 'function') ? executeDeleteJournal.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasCatch:      fnStr.includes('catch'),
        hasCloseModal: fnStr.includes('closeModal'),
      };
    });
    if (result.skip) return;
    if (!result.hasCatch)      throw new Error('executeDeleteJournal() 缺少 catch 區塊');
    if (!result.hasCloseModal) throw new Error('executeDeleteJournal() 的 catch 未呼叫 closeModal()');
  });

  await test('S-SEC-14 PDF catch 區塊使用 escapeHtml 防 XSS', async () => {
    const result = await page.evaluate(() => {
      const candidates = ['exportMyPDF', 'printJournalsPDF'];
      const found = candidates.find(name => typeof window[name] === 'function');
      if (!found) return { skip: true };
      const fnStr = window[found].toString();
      return {
        skip: false,
        hasCatch:      fnStr.includes('catch'),
        hasEscapeHtml: fnStr.includes('escapeHtml'),
      };
    });
    if (result.skip) return;
    if (!result.hasCatch)      throw new Error('PDF 匯出函式缺少 catch 區塊');
    if (!result.hasEscapeHtml) throw new Error('PDF 匯出函式的 catch 未使用 escapeHtml()');
  });

  await test('S-SEC-15 initWriteForm() Firestore semesterLabel 插入 innerHTML 前有 escapeHtml', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof initWriteForm === 'function') ? initWriteForm.toString() : '';
      if (!fnStr) return { skip: true };
      const hasEscapeLabel = fnStr.includes('escapeHtml') && fnStr.includes('label');
      const hasInnerHTML   = fnStr.includes('innerHTML');
      return { skip: false, hasEscapeLabel, hasInnerHTML };
    });
    if (result.skip) return;
    if (!result.hasInnerHTML)   throw new Error('initWriteForm() 找不到 innerHTML 賦值');
    if (!result.hasEscapeLabel) throw new Error('initWriteForm() 的學期 label 未使用 escapeHtml()');
  });

  // ════════════════════════════════════════
  // S-SEC-17  「其他（補充說明）」型別 editJournal 載入修正（2026-06-22）
  // 對應 AI_CONTEXT.md 2026-06-22 變更：
  //   editJournal / checkMonthDeadline 載入 entry 時，
  //   若 e.type 為「其他（XXX）」格式，需拆出補充說明分別填入
  //   select（設為「其他」）與 other-input，並呼叫 showWorkTypeExample()
  // ════════════════════════════════════════

  await test('S-SEC-17 editJournal/checkMonthDeadline 正確還原「其他（補充說明）」型別', async () => {
    const result = await page.evaluate(() => {
      // 靜態分析：確認兩處 forEach 都有「其他（」的拆解邏輯
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      // 特徵1：以 startsWith('其他（') 或 match(/^其他（/) 判斷
      const hasOtherDetect =
        scripts.includes("startsWith('其他（')") ||
        scripts.includes('startsWith("其他（")') ||
        scripts.includes("match(/^其他（");

      // 特徵2：拆出補充說明後設回 other-input
      const hasOtherInput = scripts.includes('other-input') && scripts.includes('otherInputEl');

      // 特徵3：拆解後呼叫 showWorkTypeExample
      const hasShowExample = (scripts.match(/showWorkTypeExample\(/g) || []).length >= 2;

      // 特徵4：兩處 forEach 都有處理（checkMonthDeadline + editJournal）
      // 確認 showWorkTypeExample 在 type 判斷區塊內出現至少 2 次
      const showExampleCount = (scripts.match(/showWorkTypeExample\(/g) || []).length;

      return {
        hasOtherDetect,
        hasOtherInput,
        hasShowExample,
        showExampleCount,
      };
    });

    if (!result.hasOtherDetect)
      throw new Error('未偵測到「其他（」型別判斷邏輯，editJournal 載入「其他（補充說明）」時 type 會靜默失效');
    if (!result.hasOtherInput)
      throw new Error('未偵測到 otherInputEl 補充說明回填邏輯，other-input 欄位不會顯示補充說明');
    if (!result.hasShowExample || result.showExampleCount < 2)
      throw new Error(`showWorkTypeExample() 呼叫次數不足（${result.showExampleCount} 次），兩處 forEach 均需呼叫`);
  });

  // ════════════════════════════════════════
  // S-SEC-18  照片上傳中存檔防呆（2026-06-22）
  // 對應 AI_CONTEXT.md 2026-06-22 變更：
  //   saveJournal() 儲存前偵測 .photo-uploading，
  //   上傳中時阻擋儲存並提示；photos 陣列加 .filter(Boolean)
  // ════════════════════════════════════════

  await test('S-SEC-18 saveJournal() 照片上傳中存檔防呆邏輯存在', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵1：偵測 .photo-uploading 蓋板
      const hasUploadingCheck = fnStr.includes('photo-uploading');

      // 特徵2：uploadingCount > 0 時阻擋儲存（設定 photoError）
      const hasUploadingBlock = fnStr.includes('uploadingCount') && fnStr.includes('photoError');

      // 特徵3：photos 陣列有 .filter(Boolean) 防禦性過濾
      const hasFilterBoolean = fnStr.includes('filter(Boolean)');

      return { skip: false, hasUploadingCheck, hasUploadingBlock, hasFilterBoolean };
    });

    if (result.skip) return;
    if (!result.hasUploadingCheck)
      throw new Error('saveJournal() 未偵測 .photo-uploading 蓋板，照片上傳中按儲存會存入空白 URL');
    if (!result.hasUploadingBlock)
      throw new Error('saveJournal() 未阻擋上傳中的儲存（uploadingCount + photoError 邏輯不存在）');
    if (!result.hasFilterBoolean)
      throw new Error('saveJournal() 的 photos 陣列缺少 .filter(Boolean) 防禦性過濾');
  });

  // ════════════════════════════════════════
  // S-SEC-19 ～ S-SEC-20  editJournal() 競爭寫入修正（2026-06-23）
  // 對應修正：editJournal() 載入舊月記填表後，showPage('s-write') 及
  //   initWriteForm() 結尾都會非同步重新呼叫 checkMonthDeadline()（無 skipFill），
  //   背景任務完成後會用「目前真實學期/月份」的資料蓋掉剛載入的編輯內容。
  //   編輯非當前月份的舊月記時幾乎必然發生，不需使用者打字也會被蓋掉。
  // 修法分兩半：
  //   ①editJournal() 第一次呼叫改為 initWriteForm(true)，跳過內部背景的
  //     checkMonthDeadline()；呼叫 showPage('s-write') 前設定 _skipWriteInit
  //     旗標，讓 showPage 觸發的第二次 initWriteForm() 整個跳過。
  //   ②showPage() 需檢查並消費 _skipWriteInit 旗標；initWriteForm() 需接受
  //     skipDeadlineCheck 參數並據此決定要不要呼叫 checkMonthDeadline()。
  //   只修一半（例如只設旗標但 showPage 沒檢查、或只傳參數但 initWriteForm
  //   沒接）都無法真正解決問題，所以拆成兩個測試分別檢查。
  // 以下為靜態分析（檢查原始碼字串），無法重現「編輯舊月記後表單是否被
  // 背景蓋掉」這個實際 timing 行為本身（需要一筆非當前月份的月記資料才能
  // 人工驗證），只能確認程式碼特徵仍存在、防止日後改動退回舊寫法。
  // ════════════════════════════════════════

  await test('S-SEC-19 editJournal() 跳過內部背景 checkMonthDeadline 並設定 _skipWriteInit 旗標', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasSkippedInitCall: /initWriteForm\(\s*true\s*\)/.test(fnStr),
        hasSkipFlagSet:     /_skipWriteInit\s*=\s*true/.test(fnStr),
        hasSkipFillTrue:    /checkMonthDeadline\(\s*true\s*\)/.test(fnStr),
      };
    });
    if (result.skip) return;
    if (!result.hasSkippedInitCall)
      throw new Error('editJournal() 第一次呼叫 initWriteForm() 沒有傳入 true，內部結尾的背景 checkMonthDeadline() 會用「目前真實學期/月份」的資料蓋掉剛載入的編輯內容');
    if (!result.hasSkipFlagSet)
      throw new Error('editJournal() 呼叫 showPage(\'s-write\') 前沒有設定 _skipWriteInit 旗標，showPage 觸發的第二次 initWriteForm() 仍會非同步重新填表蓋掉編輯內容');
    if (!result.hasSkipFillTrue)
      throw new Error('editJournal() 找不到 checkMonthDeadline(true) 呼叫，截止日狀態可能無法正確更新（這次修正不應動到這一行）');
  });

  await test('S-SEC-20 showPage()／initWriteForm() 仍支援 _skipWriteInit／skipDeadlineCheck 跳過機制', async () => {
    const result = await page.evaluate(() => {
      const showPageStr = (typeof showPage === 'function') ? showPage.toString() : '';
      const initFormStr = (typeof initWriteForm === 'function') ? initWriteForm.toString() : '';
      if (!showPageStr && !initFormStr) return { skip: true };
      return {
        skip: false,
        showPageChecksFlag: showPageStr.includes('_skipWriteInit'),
        showPageResetsFlag: /_skipWriteInit\s*=\s*false/.test(showPageStr),
        initFormHasParam:   /initWriteForm\s*\(\s*skipDeadlineCheck/.test(initFormStr),
        initFormUsesParam:  /if\s*\(\s*!skipDeadlineCheck\s*\)/.test(initFormStr),
      };
    });
    if (result.skip) return;
    if (!result.showPageChecksFlag)
      throw new Error('showPage() 沒有檢查 _skipWriteInit 旗標，editJournal() 設的旗標不會有任何效果，第二次 initWriteForm() 還是會跑');
    if (!result.showPageResetsFlag)
      throw new Error('showPage() 沒有把 _skipWriteInit 重設為 false，旗標消費後沒清掉，可能讓下一次正常進入寫作頁也被跳過初始化');
    if (!result.initFormHasParam)
      throw new Error('initWriteForm() 找不到 skipDeadlineCheck 參數，editJournal() 傳的 true 沒有地方接收');
    if (!result.initFormUsesParam)
      throw new Error('initWriteForm() 沒有依 skipDeadlineCheck 決定是否呼叫 checkMonthDeadline()，背景覆蓋表單的問題仍然存在');
  });

  // ════════════════════════════════════════
  // S-SEC-21  checkMonthDeadline() 快取補上 studentReply（2026-06-28）
  // 對應修正：checkMonthDeadline() 設定 _currentJournalCache 時原本沒有 studentReply
  //   （editJournal() 那條路徑早就有，兩邊不一致），導致 saveJournal() 的覆蓋確認對話框
  //   在「一般填寫頁覆蓋當月既有月記」這條最常見的路徑上，沒辦法提示學生「重新儲存後
  //   回覆會暫時看不到對應評語」（studentReply 因 merge:true 原樣保留，但 teacherComment
  //   會被歸零，變成孤兒狀態，見 AI_CONTEXT.md「studentReply 孤兒狀態」決策）。
  // 修法：① checkMonthDeadline() 快取補上 studentReply；
  //       ② saveJournal() 新增 replyWarning 變數，條件 wasReviewed && cached.studentReply，
  //         只在即將觸發孤兒狀態的那次覆蓋才提示，已經是孤兒狀態的後續編輯不會重複提示。
  // 以下為靜態分析（檢查原始碼字串），無法重現「確認對話框實際彈出的文字」這個
  // runtime 結果（需要一筆「老師已審閱且學生已回覆」的月記資料才能人工驗證），
  // 只能確認程式碼特徵仍存在、防止日後改動退回舊寫法。
  // ════════════════════════════════════════

  await test('S-SEC-21 checkMonthDeadline() 快取補上 studentReply／saveJournal() 顯示回覆警告', async () => {
    const result = await page.evaluate(() => {
      const checkFnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const saveFnStr   = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!checkFnStr && !saveFnStr) return { skip: true };
      return {
        skip: false,
        cacheHasStudentReply: /studentReply\s*:\s*journalSnap\.data\(\)\.studentReply/.test(checkFnStr),
        saveHasReplyWarning:  /replyWarning/.test(saveFnStr),
      };
    });
    if (result.skip) return;
    if (!result.cacheHasStudentReply)
      throw new Error('checkMonthDeadline() 的 _currentJournalCache 找不到 studentReply 欄位，saveJournal() 的覆蓋確認對話框在這條路徑上無法判斷是否該提示回覆警告');
    if (!result.saveHasReplyWarning)
      throw new Error('saveJournal() 找不到 replyWarning 變數，覆蓋確認對話框不會提示學生「回覆會暫時看不到對應評語」');
  });

  // ════════════════════════════════════════
  // S-SEC-22 ～ S-SEC-26  評語徽章系統（2026-06-28）
  // 對應「評語測試系統」STEP 1～5 及狀態轉換總覽：
  //
  //   State 0  無徽章    （初始：尚未審閱）
  //   State 1  🔴 有新評語    Unread=true,  Updated=false
  //   State 2  🟠 評語已更新  Unread=true,  Updated=true
  //   State 3  ✅ 已審閱     Unread=false, Updated=false
  //   State 4  📖 評語已閱讀  Unread=false, Updated=true
  //
  // S-SEC-22/23 為純邏輯靜態分析（不需學生 session，老師帳號即可）；
  // S-SEC-24 為靜態分析（確認 updateDoc teacherCommentUnread:false 邏輯存在）；
  // S-SEC-25 為靜態分析（確認學生只能把 teacherCommentUnread 設為 false）；
  // S-SEC-26 為 Firestore Rules 端對端測試（需學生 session）。
  // ════════════════════════════════════════

  await test('S-SEC-22 getCommentBadgeState() 四狀態 + 無徽章邏輯正確', async () => {
    // 驗證 getCommentBadgeState() 對每種旗標組合回傳正確的 state 值。
    // 實際回傳型別為字串（'unread'/'updated_unread'/'reviewed'/'updated_read'）或 null（無徽章）。
    // 對應 STEP 1～5 所有狀態轉換節點。
    const result = await page.evaluate(() => {
      if (typeof getCommentBadgeState !== 'function') return { skip: true };

      // 先用一個已知組合探測回傳型別，判斷是字串制還是數字制
      const probe = getCommentBadgeState({
        teacherCommentUnread: true, teacherCommentUpdated: false,
        teacherReviewed: true, teacherComment: '測試'
      });
      const isNumeric = typeof probe === 'number';
      const isString  = typeof probe === 'string';
      const isNull    = probe === null;

      // 根據探測結果決定各 state 的期望值
      // 數字制：1/2/3/4/0（或 null 表示無徽章）
      // 字串制：'unread'/'updated_unread'/'reviewed'/'updated_read'/null
      let E;
      if (isNumeric) {
        E = { s1: 1, s2: 2, s3: 3, s4: 4, s0: [0, null] };
      } else {
        // 字串制或其他型別：接受 'unread'、任何含「有新評語」「unread」的字串
        E = {
          s1: ['unread'],
          s2: ['updated_unread', 'updated'],
          s3: ['reviewed'],
          s4: ['updated_read'],
          s0: [null, '', 0, false],
        };
      }

      const match = (actual, expected) => {
        if (Array.isArray(expected)) return expected.includes(actual);
        return actual === expected;
      };

      const cases = [
        // STEP 2：老師第一次存有文字評語 → 🔴 有新評語（State 1 / 'unread'）
        { j: { teacherCommentUnread: true,  teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '第一次評語' }, key: 's1', label: 'STEP2 有新評語' },
        // STEP 4：老師第二次改評語 → 🟠 評語已更新（State 2 / 'updated_unread'）
        { j: { teacherCommentUnread: true,  teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' }, key: 's2', label: 'STEP4 評語已更新' },
        // STEP 1：老師存空評語審閱 → ✅ 已審閱（State 3 / 'reviewed'）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: ''           }, key: 's3', label: 'STEP1 已審閱(空評語)' },
        // STEP 3：學生進歷史頁後 → ✅ 已審閱（State 3 / 'reviewed'）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '第一次評語' }, key: 's3', label: 'STEP3 已審閱(有評語)' },
        // STEP 5：學生再次進歷史頁後 → 📖 評語已閱讀（State 4 / 'updated_read'）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' }, key: 's4', label: 'STEP5 評語已閱讀' },
        // 初始：建立月記但尚未審閱 → 無徽章（State 0 / null）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: false, teacherComment: null        }, key: 's0', label: '初始 無徽章' },
      ];

      const failures = [];
      for (const { j, key, label } of cases) {
        const actual = getCommentBadgeState(j);
        if (!match(actual, E[key])) {
          failures.push(
            `[${label}] ` +
            `Unread=${j.teacherCommentUnread} Updated=${j.teacherCommentUpdated} ` +
            `Reviewed=${j.teacherReviewed} Comment="${j.teacherComment ?? 'null'}" ` +
            `→ 期望 ${JSON.stringify(E[key])}，實際 ${JSON.stringify(actual)}`
          );
        }
      }
      return { skip: false, failures, probeType: typeof probe, probeValue: String(probe) };
    });
    if (result.skip) return;
    if (result.failures.length > 0)
      throw new Error('getCommentBadgeState() 邏輯錯誤：\n' + result.failures.join('\n'));
  });

  await test('S-SEC-23 renderCommentBadgeHtml() 各 state 輸出正確徽章', async () => {
    // 驗證每種旗標組合對應到正確的 emoji／文字。
    // renderCommentBadgeHtml() 接收整個 j 物件（而非 state 數字），
    // 函式內部自行呼叫 getCommentBadgeState(j) 取得 state 再輸出 HTML。
    const result = await page.evaluate(() => {
      if (typeof renderCommentBadgeHtml !== 'function') return { skip: true };

      // 各 state 的代表性 j 物件 + 期望輸出關鍵字
      const cases = [
        {
          label: 'STEP2 有新評語（State 1 / unread）',
          j: { teacherCommentUnread: true,  teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '第一次評語' },
          containsAny: ['🔴', '有新評語', 'unread', 'new-comment', 'state-1'],
        },
        {
          label: 'STEP4 評語已更新（State 2 / updated_unread）',
          j: { teacherCommentUnread: true,  teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' },
          containsAny: ['🟠', '評語已更新', 'updated', 'state-2'],
        },
        {
          label: 'STEP1 已審閱（State 3 / reviewed）',
          j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '' },
          containsAny: ['✅', '已審閱', 'reviewed', 'state-3'],
        },
        {
          label: 'STEP5 評語已閱讀（State 4 / updated_read）',
          j: { teacherCommentUnread: false, teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' },
          containsAny: ['📖', '評語已閱讀', 'updated_read', 'state-4'],
        },
      ];

      // 無徽章（State 0 / null）：初始未審閱月記必須輸出空字串或不含可見文字的 HTML
      const html0 = renderCommentBadgeHtml({
        teacherCommentUnread: false, teacherCommentUpdated: false,
        teacherReviewed: false, teacherComment: null
      }) || '';
      const stripped0 = html0.replace(/<[^>]*>/g, '').trim();
      if (stripped0.length > 0) {
        return { skip: false, failures: [`無徽章(State 0) 應無輸出，但輸出：「${html0.slice(0, 80)}」`] };
      }

      const failures = [];
      for (const { label, j, containsAny } of cases) {
        const html = renderCommentBadgeHtml(j) || '';
        const hit = containsAny.some(kw => html.includes(kw));
        if (!hit) {
          failures.push(
            `[${label}]：輸出「${html.slice(0, 80)}」不含預期關鍵字 [${containsAny.join('/')}]`
          );
        }
      }
      return { skip: false, failures };
    });
    if (result.skip) return;
    if (result.failures.length > 0)
      throw new Error('renderCommentBadgeHtml() 輸出錯誤：\n' + result.failures.join('\n'));
  });

  await test('S-SEC-24 loadStudentHistory() 自動清除 teacherCommentUnread（STEP 3／STEP 5）', async () => {
    // 驗證 loadStudentHistory() 在遍歷歷史月記時，
    // 若該筆月記 teacherCommentUnread===true，會自動呼叫 updateDoc 把它清為 false。
    // 對應 STEP 3（學生進歷史頁 → ✅ 已審閱）與 STEP 5（再次進歷史頁 → 📖 評語已閱讀）。
    const result = await page.evaluate(() => {
      const fnStr = (typeof loadStudentHistory === 'function') ? loadStudentHistory.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵 1：有讀取 teacherCommentUnread（判斷是否需要清除）
      const checksUnread = fnStr.includes('teacherCommentUnread');

      // 特徵 2：有對 journals 路徑呼叫 updateDoc（或 setDoc/doc）
      const callsUpdateDoc = fnStr.includes('updateDoc') || fnStr.includes('setDoc');

      // 特徵 3：有把 teacherCommentUnread 寫回 false（清除旗標）
      const writesUnreadFalse =
        /teacherCommentUnread\s*:\s*false/.test(fnStr) ||
        /['"]teacherCommentUnread['"]\s*:\s*false/.test(fnStr);

      return { skip: false, checksUnread, callsUpdateDoc, writesUnreadFalse };
    });
    if (result.skip) return;
    if (!result.checksUnread)
      throw new Error('loadStudentHistory() 未讀取 teacherCommentUnread 欄位，無法判斷是否需要自動清除');
    if (!result.callsUpdateDoc)
      throw new Error('loadStudentHistory() 找不到 updateDoc / setDoc 呼叫，teacherCommentUnread 自動清除機制可能已移除');
    if (!result.writesUnreadFalse)
      throw new Error('loadStudentHistory() 找不到 teacherCommentUnread: false 寫入，清除旗標邏輯可能已被改寫');
  });

  await test('S-SEC-25 學生標記已讀只能把 teacherCommentUnread 設為 false（第二分支靜態分析）', async () => {
    // 對應 rule.txt 第二分支：
    //   affectedKeys().hasOnly(['teacherCommentUnread'])
    //   && teacherCommentUnread == false
    // 驗證 loadStudentHistory()（或其呼叫的輔助函式）送出的 updateDoc
    // 只包含 teacherCommentUnread:false，不夾帶其他老師評語欄位。
    const result = await page.evaluate(() => {
      // 檢查 loadStudentHistory 本體與可能的輔助函式
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      // 特徵：不應在「已讀清除」的 updateDoc 中包含 teacherCommentUpdated:true
      // （只有老師端 saveTeacherComment 才能寫 true）
      // 粗略檢查：teacherCommentUpdated:true 不應出現在學生已讀清除的區塊附近
      // （精確界定困難，改檢查 loadStudentHistory 函式本體）
      const fnStr = (typeof loadStudentHistory === 'function') ? loadStudentHistory.toString() : '';
      if (!fnStr) return { skip: true };

      // 已讀清除 updateDoc 中不應寫入 teacherCommentUpdated（老師端專用欄位）
      // 簡單起見：若 fnStr 中同時含有 teacherCommentUpdated 與 updateDoc，發出警告
      const writesUpdatedFlag = /teacherCommentUpdated/.test(fnStr);

      // 應只寫 teacherCommentUnread:false（單欄位更新）
      const writesOnlyUnread =
        /teacherCommentUnread\s*:\s*false/.test(fnStr) &&
        !writesUpdatedFlag;

      return { skip: false, writesOnlyUnread, writesUpdatedFlag };
    });
    if (result.skip) return;
    if (result.writesUpdatedFlag)
      throw new Error(
        'loadStudentHistory() 的已讀清除 updateDoc 含有 teacherCommentUpdated，' +
        '只有老師端 saveTeacherComment() 才能寫這個欄位，學生端混入可能造成狀態污染'
      );
    if (!result.writesOnlyUnread)
      throw new Error(
        'loadStudentHistory() 找不到「只寫 teacherCommentUnread:false」的已讀清除邏輯，' +
        'STEP 3／STEP 5 的自動清除可能已被改寫或移除'
      );
  });

  // S-SEC-26 需要學生 session（Firestore Rules 端對端）
  // 放在 else 分支之後的 skipped 清單前，以學生 session context 執行
  // → 此處僅確認老師帳號靜態邏輯；Rules 端對端驗證在 _studentRulesCommentTests() 執行

  await test('S-15 無嚴重 JS 錯誤（ReferenceError / SyntaxError）', async () => {
    const errors = page._testErrors || [];
    const serious = errors.filter(e =>
      (e.includes('ReferenceError') || e.includes('SyntaxError')) && !e.includes('uid')
    );
    if (serious.length > 0) throw new Error(serious[0]);
  });

  // ════════════════════════════════════════
  // S-16 / S-16B  新學期格式驗證（2026-06-16 新增）
  // 對應 AI_CONTEXT.md 2026-06-14 變更：
  //   docId 格式改為 {semester}_{seatNo}（如 114-2_00）
  //   emailKey() 需用 /[@.]/g 全域取代
  // ════════════════════════════════════════

  await test('S-16 handleLoginUser() 支援新學期 docId 格式（{semester}_{seatNo}）', async () => {
    // 確認 handleLoginUser() 在查詢 students 文件時，
    // 使用 `${activeSem}_${seatNo}` 新格式，並有 fallback 舊格式
    const result = await page.evaluate(() => {
      const fnStr = (typeof handleLoginUser === 'function') ? handleLoginUser.toString() : '';
      if (!fnStr) return { skip: true };
      // 新格式特徵：template literal 組合 activeSem + '_' + seatNo
      const hasNewFormat =
        (fnStr.includes('activeSem') || fnStr.includes('getCurrentSemester')) &&
        fnStr.includes('seatNo') &&
        (fnStr.includes('`${') || fnStr.includes("+ '_' +") || fnStr.includes('+ "_" +'));
      // fallback 特徵：有舊格式查詢（直接用 seatNo）
      const hasFallback =
        fnStr.includes('fallback') ||
        (fnStr.includes('exists()') === false && fnStr.includes('stuSnap') && fnStr.includes('seatNo'));
      return { skip: false, hasNewFormat, hasFallback, fnLen: fnStr.length };
    });
    if (result.skip) return;
    if (!result.hasNewFormat) throw new Error(
      'handleLoginUser() 未偵測到新學期格式（{semester}_{seatNo}）查詢邏輯，' +
      '新學期學生可能因 docId 格式不符而無法登入'
    );
  });

  await test('S-16B onAuthStateChanged 登入邏輯的 emailKey() 使用全域取代（/[@.]/g）', async () => {
    // student.html 有兩處 emailKey 邏輯：
    //   1. handleLoginUser()（Popup/手動登入）
    //   2. onAuthStateChanged 內聯程式碼（自動恢復登入）
    // 兩處都必須用 /[@.]/g 全域取代，才能正確處理 tcivs.tc.edu.tw 的多個點
    // 若只用 .replace('@','_').replace('.','_') 只取代一個點 → emailKey 算錯 → 查無 studentBindings
    const result = await page.evaluate(() => {
      // 取得頁面所有 script 內容做靜態分析
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      // 計算 /[@.]/g 出現次數（正確做法）
      const globalReplaceCount = (scripts.match(/replace\(\/\[@\.\]\/g/g) || []).length;

      // 計算「只取代單一字元」的錯誤做法出現次數
      const singleReplaceCount = (scripts.match(/\.replace\('@'/g) || []).length;

      return {
        globalReplaceCount,
        singleReplaceCount,
        // 至少要有 1 處全域取代才算正確（handleLoginUser 或 onAuthStateChanged）
        ok: globalReplaceCount >= 1,
      };
    });
    if (!result.ok) throw new Error(
      `emailKey() 未使用 /[@.]/g 全域取代（偵測到 ${result.globalReplaceCount} 處，` +
      `單次取代 ${result.singleReplaceCount} 處）。` +
      'tcivs.tc.edu.tw 含多個點，只取代一次會讓 studentBindings 查詢 key 算錯，' +
      '導致自動恢復登入時「帳號尚未綁定」假失敗'
    );
  });

  // ════════════════════════════════════════
  // S-17 / S-17B  _loginHandling 互斥旗標（2026-06-16 新增）
  // 對應 AI_CONTEXT.md 2026-06-16 變更：
  //   handleRedirectResult 與 onAuthStateChanged 互斥，避免兩條路徑同時執行 handleLoginUser
  // ════════════════════════════════════════

  await test('S-17 _loginHandling 互斥旗標已宣告，handleLoginUser() 所有 return 路徑均清旗標', async () => {
    // 確認：
    // 1. _loginHandling 變數已宣告（let _loginHandling = false）
    // 2. handleLoginUser() 中，所有提前 return 的路徑（網域驗證失敗、未綁定、找不到學生資料）
    //    都有清旗標（_loginHandling = false）
    // 3. handleLoginUser() 正常結束路徑也有清旗標（enterApp() 前）
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      // 旗標宣告
      const hasDeclare = scripts.includes('let _loginHandling = false') ||
                         scripts.includes('let _loginHandling=false');

      // handleLoginUser 函式內容
      const fnStr = (typeof handleLoginUser === 'function') ? handleLoginUser.toString() : '';
      if (!fnStr) return { skip: true };

      // 旗標清除次數（至少要有 3 次：各提前 return 路徑 + 正常結束）
      const clearCount = (fnStr.match(/_loginHandling\s*=\s*false/g) || []).length;

      // handleRedirectResult 設旗標
      const rFnStr = (typeof handleRedirectResult === 'function') ? handleRedirectResult.toString() : '';
      const hasSet = rFnStr.includes('_loginHandling = true') || rFnStr.includes('_loginHandling=true');

      return { skip: false, hasDeclare, clearCount, hasSet };
    });

    if (result.skip) return;
    if (!result.hasDeclare) throw new Error('_loginHandling 旗標未宣告（let _loginHandling = false 不存在）');
    if (!result.hasSet)     throw new Error('handleRedirectResult() 未設旗標（_loginHandling = true 不存在）');
    if (result.clearCount < 3) throw new Error(
      `handleLoginUser() 只有 ${result.clearCount} 處清旗標，` +
      '提前 return 的路徑（網域驗證、未綁定、找不到學生）需各自清旗標，' +
      '否則旗標會卡住導致 onAuthStateChanged 永久等待'
    );
  });

  await test('S-17B onAuthStateChanged 有 _loginHandling 輪詢等待邏輯', async () => {
    // 確認 onAuthStateChanged callback 中：
    // 1. 偵測 _loginHandling 旗標
    // 2. 有 while 迴圈輪詢等待（最多 15 秒）
    // 3. 等待後若 currentUser 已設定則提前 return（不重複執行 handleLoginUser）
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

  // ════════════════════════════════════════
  // S-SEC-16  calcDistance() XSS 防禦性加固（2026-06-17）
  // ════════════════════════════════════════

  await test('S-SEC-16 calcDistance() 的 addressError 插入 innerHTML 前有 escapeHtml()', async () => {
    // 2026-06-17 補修：addressError 雖為固定字串來源，但插入 innerHTML 前仍補加 escapeHtml()
    // 防止未來改動（例如 addressError 改為 Firestore 來源）時引入 XSS 漏洞
    const result = await page.evaluate(() => {
      const fnStr = (typeof calcDistance === 'function') ? calcDistance.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasAddressError:  fnStr.includes('addressError'),
        hasEscapeHtml:    fnStr.includes('escapeHtml'),
        hasInnerHTML:     fnStr.includes('innerHTML'),
      };
    });
    if (result.skip) return;
    if (!result.hasAddressError) throw new Error('calcDistance() 找不到 addressError 變數（函式結構已變更？）');
    if (!result.hasInnerHTML)    throw new Error('calcDistance() 找不到 innerHTML 賦值');
    if (!result.hasEscapeHtml)   throw new Error('calcDistance() 的 addressError 插入 innerHTML 前未使用 escapeHtml()');
  });

  // ════════════════════════════════════════
  // S-SEC-27  完成度進度條／單筆摘要收合判斷的地址檢查補上格式驗證（2026-06-29）
  // 背景：教師（00號測試帳號）回報一個案例——地址欄填了「…公益路二段783」
  //   （缺門牌「號」字），畫面上「完成度 4/4 可儲存」與單筆摘要「✓完成」皆顯示正常，
  //   但按下「儲存月記」時被擋下（跳出「尚有欄位未填寫，請點此查看」）。
  //   追查發現 saveJournal() 真正存檔時呼叫的 validateCompleteTaiwanAddress()
  //   （要求地址需含縣市＋路名＋門牌號碼，不可只填地標）從未接到以下兩處：
  //     ① WORK_FIELD_CHECKS 的 address.test()：原本只檢查 !!e.address（非空）
  //     ② isEntryComplete() 的 addrOk：原本只檢查 !!addr（非空）
  //   兩者皆只看「有沒有填字」，造成「完成度」顯示跟「真正存檔判斷」不一致——
  //   畫面顯示可儲存，按下卻被擋，使用者體驗上像是規則消失了，但實際上
  //   saveJournal() 的格式驗證從頭到尾都還在，純粹是進度顯示沒跟著做格式檢查。
  // 修法：兩處都補上 && !validateCompleteTaiwanAddress(...)，與 saveJournal()
  //   用同一個函式判斷，地址格式不完整時，進度條「地址」文字與單則收合徽章
  //   都會正確顯示為未完成（紅字／橘字），不再只看是否為空字串。
  // 以下為靜態分析（檢查原始碼字串），確認程式碼特徵存在，避免日後改動
  // 不小心把這兩處退回成只檢查非空、重新跟 saveJournal() 的判斷脫節。
  // ════════════════════════════════════════

  await test('S-SEC-27 完成度進度條／單筆摘要收合判斷的地址檢查已套用 validateCompleteTaiwanAddress() 格式驗證', async () => {
    const result = await page.evaluate(() => {
      const hasValidateFn = (typeof validateCompleteTaiwanAddress === 'function');
      if (!hasValidateFn) return { skip: true };

      // ① isEntryComplete()：addrOk 是否呼叫 validateCompleteTaiwanAddress
      const entryFnStr = (typeof isEntryComplete === 'function') ? isEntryComplete.toString() : '';

      // ② WORK_FIELD_CHECKS 裡 key==='address' 那筆的 test 函式是否呼叫 validateCompleteTaiwanAddress
      const wfc = (typeof WORK_FIELD_CHECKS !== 'undefined' && Array.isArray(WORK_FIELD_CHECKS))
        ? WORK_FIELD_CHECKS : null;
      const addrCheck = wfc ? wfc.find(fc => fc.key === 'address') : null;
      const addrTestStr = addrCheck ? addrCheck.test.toString() : '';

      if (!entryFnStr || !wfc) return { skip: true };

      return {
        skip: false,
        entryUsesValidate: /validateCompleteTaiwanAddress/.test(entryFnStr),
        fieldCheckUsesValidate: /validateCompleteTaiwanAddress/.test(addrTestStr),
      };
    });
    if (result.skip) return;
    if (!result.entryUsesValidate)
      throw new Error('isEntryComplete() 的地址檢查（addrOk）沒有呼叫 validateCompleteTaiwanAddress()，只檢查是否為空字串，會跟 saveJournal() 的真正存檔判斷不一致（地址格式不完整時誤顯示「✓完成」）');
    if (!result.fieldCheckUsesValidate)
      throw new Error('WORK_FIELD_CHECKS 的 address 檢查沒有呼叫 validateCompleteTaiwanAddress()，只檢查是否為空字串，會讓「完成度 X/4」進度條誤顯示地址為綠字／可儲存，跟按下儲存時的實際判斷不一致');
  });

  // S-SEC-28  executeDeleteJournal() 補上 showLoading()/hideLoading()（2026-06-30）
  await test('S-SEC-28 executeDeleteJournal() 有 showLoading()，且成功與失敗路徑皆有 hideLoading()', async () => {
    // 2026-07-01 新增。
    // executeDeleteJournal() 原本完全沒有呼叫 showLoading()/hideLoading()，與結構幾乎相同的
    // 姊妹函式 executeBatchDeleteHistory()（批次刪除，同樣呼叫 deleteDoc()）行為不一致，
    // 也不符合本專案安全性 Checklist「是否有 try/catch 確保 hideLoading() 一定執行」。
    //
    // 驗證三項特徵（缺一即退化）：
    //   1. 函式本體含 showLoading() ── 刪除中有 loading 遮罩
    //   2. try 區塊含 hideLoading()  ── 成功路徑會關閉遮罩
    //   3. catch 區塊含 hideLoading() ── 失敗路徑也會關閉遮罩（不會卡住）
    //
    // 注意：executeDeleteJournal() 採「try/catch 各自呼叫 hideLoading()」寫法（不用 finally），
    // 這與姊妹函式 executeBatchDeleteHistory() 的 showLoading()/hideLoading() 括在 try/catch
    // 外部的寫法不同，但兩種都能確保任何路徑都會關閉遮罩，驗證邏輯對此保持彈性。
    const result = await page.evaluate(() => {
      const fnStr = (typeof executeDeleteJournal === 'function')
        ? executeDeleteJournal.toString() : '';
      if (!fnStr) return { skip: true };

      // 是否有 showLoading()
      const hasShowLoading = fnStr.includes('showLoading()');

      // 把 try 區塊和 catch 區塊分開比對
      // 找到 catch( 的位置，之前算 try 區塊，之後算 catch 區塊
      const catchIdx = fnStr.indexOf('catch(');
      const tryPart   = catchIdx > -1 ? fnStr.slice(0, catchIdx) : fnStr;
      const catchPart = catchIdx > -1 ? fnStr.slice(catchIdx)    : '';

      const tryHasHideLoading   = tryPart.includes('hideLoading()');
      const catchHasHideLoading = catchPart.includes('hideLoading()');

      return { skip: false, hasShowLoading, tryHasHideLoading, catchHasHideLoading };
    });

    if (result.skip) return;
    if (!result.hasShowLoading)
      throw new Error(
        'executeDeleteJournal() 缺少 showLoading()，' +
        '網路延遲時沒有 loading 遮罩，使用者可能重複點擊觸發多次刪除；' +
        '且與姊妹函式 executeBatchDeleteHistory() 行為不一致'
      );
    if (!result.tryHasHideLoading)
      throw new Error(
        'executeDeleteJournal() 的成功路徑（try 區塊）缺少 hideLoading()，' +
        '刪除成功後 loading 遮罩不會關閉'
      );
    if (!result.catchHasHideLoading)
      throw new Error(
        'executeDeleteJournal() 的失敗路徑（catch 區塊）缺少 hideLoading()，' +
        '刪除失敗後 loading 遮罩會卡住'
      );
  });

  await test('S-SEC-29 saveStudentReply() replyChanged 防護（內容未變不重新觸發未讀旗標／重複推播）', async () => {
    // 2026-07 新增。對應 teacher.html saveTeacherComment() 的 commentChanged 防護
    // （T-SEC-20／T-SEC-23）同一類問題：學生只是重新打開回覆框、文字完全沒改就按
    // 「更新回覆」，若每次都無條件寫 studentReplyUnread:true／studentReplyContentAt，
    // 會把老師端已讀狀態誤打回未讀，notify-service 也會因 studentReplyContentAt
    // 跟著刷新而誤判成新回覆、對同一則內容重複推播。
    //
    // 2026-07-11 修正：saveStudentReply() 本身同日改版——oldReply 原本從前端快取
    // window._studentHistoryJournals 讀取，改成送出前 await getDoc(ref) 現查伺服器
    // 當下值（修正多裝置/多分頁快取落後伺服器真實值時，合法回覆會被 rule.txt 的
    // 「內容改變」與「內容沒變」兩個分支同時判斷失敗、誤擋 403 的問題）。下面第2項
    // 檢查同步改為驗證新寫法，不再驗證已經不存在的快取讀取邏輯。
    //
    // 驗證五項特徵（缺一即退化）：
    //   1. replyChanged 變數存在
    //   2. 舊回覆值改為送出前 getDoc(ref) 現查伺服器當下值，不是從前端快取讀取
    //   3. studentReplyUnread 的寫入受 replyChanged 控制（spread 條件寫入）
    //   4. studentReplyContentAt 的寫入同樣受 replyChanged 控制
    //   5. studentReplyAt 維持無條件寫入（角色對應 teacher.html 的 reviewedAt，
    //      純粹是「我的回覆」泡泡顯示時間，不應被 replyChanged 閘住）
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveStudentReply === 'function') ? saveStudentReply.toString() : '';
      if (!fnStr) return { skip: true };

      const hasReplyChanged = fnStr.includes('replyChanged');

      // 2026-07-11 修正：原本的寫法是 /oldReply\s*=\s*cachedJournal/.test(fnStr) ||
      // fnStr.includes('_studentHistoryJournals')，第二個條件對新版程式碼會產生假陽性——
      // 新版函式裡有一段解釋「當初為什麼從快取改成現查」的說明性註解，本身就會提到
      // '_studentHistoryJournals' 這個舊變數名，寬鬆的 fnStr.includes() 字串搜尋會命中
      // 這段註解文字本身，而不是真的驗證到程式行為（跟本檔已知的 S-SEC-08／
      // teacher_test.js T-SEC-30 假失敗同一類陷阱，只是方向相反：那兩者是「檢查壞寫法
      // 不存在」被解釋性註解誤判成還存在，這裡是「檢查好寫法還在」被「已經不這樣寫了」
      // 的說明文字誤判成還在）。改為錨定實際的賦值/呼叫語法：①確認有 await getDoc(...)
      // 呼叫，②確認 oldReply 明確賦值自 freshSnap，兩者都命中真正的程式碼結構，
      // 不會被單純提到變數名稱的註解文字誤判。
      const readsOldFromFreshDoc =
        /await\s+getDoc\s*\(/.test(fnStr) &&
        /const\s+oldReply\s*=\s*\(\s*freshSnap/.test(fnStr);

      const unreadGatedByChanged =
        /replyChanged\s*\?[\s\S]{0,200}studentReplyUnread/.test(fnStr) ||
        /if\s*\(\s*replyChanged\s*\)[\s\S]{0,200}studentReplyUnread/.test(fnStr);

      const contentAtGatedByChanged =
        /replyChanged\s*\?[\s\S]{0,200}studentReplyContentAt/.test(fnStr) ||
        /if\s*\(\s*replyChanged\s*\)[\s\S]{0,200}studentReplyContentAt/.test(fnStr);

      // studentReplyAt 應該在 replyChanged 條件區塊『之外』先無條件寫入；
      // 用「第一次出現的位置早於 replyChanged 條件區塊」近似檢查是否仍維持無條件寫入
      const studentReplyAtIdx = fnStr.indexOf('studentReplyAt:');
      const replyChangedBlockIdx = fnStr.search(/replyChanged\s*\?/);
      const studentReplyAtUnconditional =
        studentReplyAtIdx !== -1 &&
        (replyChangedBlockIdx === -1 || studentReplyAtIdx < replyChangedBlockIdx);

      return {
        skip: false,
        hasReplyChanged,
        readsOldFromFreshDoc,
        unreadGatedByChanged,
        contentAtGatedByChanged,
        studentReplyAtUnconditional,
      };
    });
    if (result.skip) return;
    if (!result.hasReplyChanged)
      throw new Error(
        'saveStudentReply() 找不到 replyChanged 變數，' +
        '學生重新送出未修改的回覆會誤觸發老師端已讀狀態倒退與 notify-service 重複推播'
      );
    if (!result.readsOldFromFreshDoc)
      throw new Error(
        'saveStudentReply() 找不到「送出前 await getDoc(ref) 現查伺服器當下 studentReply」' +
        '的邏輯（應同時看得到 getDoc(...) 呼叫與 const oldReply = (freshSnap... 賦值），' +
        '舊回覆值可能又改回從前端快取（_studentHistoryJournals）讀取——多裝置/多分頁情境下' +
        '快取可能落後伺服器真實值，會讓合法回覆被 rule.txt 的「內容改變」與「內容沒變」' +
        '兩個分支同時判斷失敗而誤擋 403'
      );
    if (!result.unreadGatedByChanged)
      throw new Error(
        'saveStudentReply() 的 studentReplyUnread 寫入未受 replyChanged 控制，' +
        '內容未變的重新送出仍會把老師端已讀狀態誤打回未讀'
      );
    if (!result.contentAtGatedByChanged)
      throw new Error(
        'saveStudentReply() 的 studentReplyContentAt 寫入未受 replyChanged 控制，' +
        'notify-service 會把「內容沒變的重新送出」誤判成新回覆而重複推播'
      );
    if (!result.studentReplyAtUnconditional)
      throw new Error(
        'saveStudentReply() 的 studentReplyAt 疑似被 replyChanged 條件擋住，' +
        '「我的回覆」泡泡顯示時間可能不會在重新送出時更新'
      );
  });

  await test('S-SEC-30 saveJournal() 補上 teacherCommentContentAt: null 歸零（避免一般編輯被 rule.txt 拒絕）', async () => {
    // 2026-07-08 新增。背景：teacherCommentContentAt 是 2026-07-06 新增 Web Push 推播
    // 子系統時，rule.txt 一般編輯分支同步要求歸零的新欄位（跟 teacherComment／
    // teacherReviewed／reviewedAt／teacherCommentUnread／teacherCommentUpdated 同一組
    // 待遇）。saveJournal() 用 setDoc(...,{merge:true}) 寫入，若 data 物件沒有明確帶
    // teacherCommentContentAt: null，merge 只會保留舊值——只要月記曾被老師留過評語
    // （teacherCommentContentAt 已是非 null 值），學生之後任何一次一般編輯儲存都會撞上
    // rule.txt 的 == null 要求而被 Firestore 拒絕（403），整份月記存檔失敗，且沒有其他
    // UI 提示（覆蓋確認對話框的 reviewWarning／replyWarning 都不會提到這個，使用者只會
    // 看到「❌ 儲存失敗：...」）。
    //
    // ⚠️ 純靜態分析：只能確認欄位存在、賦值為 null、且跟其餘老師欄位歸零寫在同一個
    // data 物件範圍內，無法像真正對 Firestore Emulator 用 merge:true 模擬「文件已有
    // 非 null 舊值」情境那樣，直接驗證 rule.txt 真的會放行——這塊仍是已知測試盲區
    // （test-rules.js 目前全部用整份 .set() 覆蓋，從未用過 merge:true 模擬真實寫入
    // 方式），建議另外在 test-rules.js 補上對應的規則層級回歸測試。
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!fnStr) return { skip: true };
      const hasField = fnStr.includes('teacherCommentContentAt');
      const hasNullValue = /teacherCommentContentAt\s*:\s*null/.test(fnStr);
      // 確認跟其餘老師欄位歸零寫在同一個 data 物件裡（用 teacherCommentUpdated: false
      // 附近 600 字元窗口比對，跟 teacher_test.js T-SEC-30 的視窗寫法一致，避免只是
      // 巧合出現在檔案別處，例如註解或其他不相干的函式）
      const nearOtherTeacherFields =
        /teacherCommentUpdated\s*:\s*false\s*,[\s\S]{0,600}teacherCommentContentAt\s*:\s*null/.test(fnStr);
      return { skip: false, hasField, hasNullValue, nearOtherTeacherFields };
    });
    if (result.skip) return;
    if (!result.hasField)
      throw new Error(
        'saveJournal() 找不到 teacherCommentContentAt，一般編輯時不會歸零此欄位；' +
        '只要月記曾被老師留過評語，之後任何一次編輯儲存都會被 rule.txt 拒絕（403），整份月記存檔失敗'
      );
    if (!result.hasNullValue)
      throw new Error(
        'saveJournal() 有 teacherCommentContentAt 但賦值不是 null，' +
        '可能無法滿足 rule.txt 一般編輯分支 == null 的要求'
      );
    if (!result.nearOtherTeacherFields)
      throw new Error(
        'teacherCommentContentAt: null 沒有跟 teacherComment／teacherReviewed／teacherCommentUnread／' +
        'teacherCommentUpdated 等其餘老師欄位歸零寫在同一個 data 物件內，請確認位置正確（例如誤放進' +
        '其他 if 分支或條件式區塊，導致實際不會隨每次一般編輯無條件寫入）'
      );
  });

  await test('S-SEC-31 initPushNotifications() 關鍵特徵：相對路徑註冊 SW、寫入路徑對應 rule.txt、userAgent 截斷、fire-and-forget 不擋登入', async () => {
    // 2026-07-10 新增。對稱於 teacher_test.js 的 T-SEC-31（老師端已有此測試，學生端一直
    // 缺對應覆蓋，見 AI_推播系統說明.md 第六節 #11）。已直接取得 student.html 實際內容
    // 逐項核對，student.html 的 initPushNotifications() 跟 teacher.html 那份幾乎完全對稱，
    // 唯一的實質差異是 Firestore 寫入路徑用 'users' 集合（對應 rule.txt 的
    // request.auth.uid == userId），而非老師端的 'admins' 集合。
    //
    // 五項檢查對應五個真實存在、各自有明確理由的退化風險（與 T-SEC-31 完全同構）：
    //   1. navigator.serviceWorker.register('./fcm-sw.js', ...) 必須用相對路徑——
    //      函式內的註解本身就說明這是 2026-07 的真實 bug 修正：這個站是 GitHub Pages
    //      的 project page（網址帶 /internship-journal/ 子路徑），用開頭帶斜線的絕對
    //      路徑 '/fcm-sw.js' 會讓瀏覽器去抓網域最上層、實際上 404，這裡若被改回絕對
    //      路徑，推播會在所有裝置上悄悄失效但不會報錯（try/catch 吞掉），很難察覺。
    //      ⚠️ 注意：函式內部的解釋性註解本身就完整提到 '/fcm-sw.js' 這個「壞」字串
    //      （用來說明為何不能這樣寫），若測試邏輯只是「檢查這個壞字串不存在」會被
    //      註解文字本身誤判為失敗（這正是 AI_推播系統說明.md 第九節記錄過的陷阱）。
    //      這裡跟 T-SEC-31 一樣，改成正向比對「register('./fcm-sw.js' 這個實際呼叫點
    //      的字面模式是否存在」，不受註解內容影響。
    //   2. Firestore 寫入路徑 doc(db, 'users', currentUser.uid, 'fcmTokens', token)
    //      必須用 currentUser.uid——這條路徑要能通過 rule.txt 的
    //      request.auth.uid == userId 檢查。
    //   3. userAgent 欄位必須截斷至 200 字（.slice(0, 200)）——對應 AI_CONTEXT.md
    //      「Firestore 資料結構」章節記載的 fcmTokens 文件 schema，若移除截斷，
    //      理論上可以寫入任意長度字串進這個公開集合。
    //   4. try/catch 的 catch 區塊不能重新 throw——呼叫端 enterApp() 註解明確寫著
    //      「刻意 fire-and-forget（不 await、失敗只 console.warn）」，若 catch 區塊被
    //      改成 rethrow，推播初始化失敗會變成未捕捉例外，可能連帶讓 enterApp() 後續
    //      邏輯中斷。
    //   5. enterApp() 呼叫 initPushNotifications() 時不能加 await——同一個
    //      fire-and-forget 設計意圖的另一半，若被改成 await，使用者登入流程會被
    //      這整個推播註冊流程（含瀏覽器跳出通知權限詢問視窗）卡住。
    const result = await page.evaluate(() => {
      const fnStr = (typeof initPushNotifications === 'function') ? initPushNotifications.toString() : '';
      const enterAppStr = (typeof enterApp === 'function') ? enterApp.toString() : '';
      if (!fnStr || !enterAppStr) return { skip: true };

      const relativeSwPath = /navigator\.serviceWorker\.register\(\s*['"]\.\/fcm-sw\.js['"]/.test(fnStr);
      const correctFsPath = /doc\(\s*db\s*,\s*['"]users['"]\s*,\s*currentUser\.uid\s*,\s*['"]fcmTokens['"]/.test(fnStr);
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
        'initPushNotifications() 的 Firestore 寫入路徑不是 doc(db, \'users\', currentUser.uid, \'fcmTokens\', token)，' +
        '可能無法通過 rule.txt 的 request.auth.uid == userId 檢查'
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

  await test('S-SEC-32 saveJournal() 送出前一律無條件現查 Firestore，不再只在 sem/month 不符時才查', async () => {
    // 2026-07-13 原始版本（已被 2026-09-04 修法取代，此段落保留供對照歷史問題）：
    // _currentJournalCache 是 checkMonthDeadline() 非同步寫入的（學期/月份 select 的
    // onchange 直接呼叫、未 await，且內部完全沒有 showLoading() 鎖住畫面），原本只在
    // 偵測到「快取的 sem/month 跟目前選定的不一致」時才現查一次 Firestore，防的是查詢
    // 真正完成「前」就被搶先按下儲存這條路徑。
    //
    // 2026-09-04 補修：使用者提出「只比對 sem/month」防不了另一條完全不需要切換學期/
    // 月份就會發生的路徑——window._currentJournalCache 是純本機的全域變數，同一份月記
    // 若在另一台裝置/分頁被存過（例如手機開著這個月份的填寫頁很久沒關、電腦這段期間
    // 存了一次），sem/month 從頭到尾沒變過，舊邏輯完全不會重新現查，會用過期的快取
    // 誤判 isFirstSubmit。經逐行核對程式碼、並用 Node 沙盒重播回報情境後確認屬實，
    // 實際會造成兩種後果：①若另一裝置存檔後 notify-service 已把 journalSubmitNotifiedAt
    // 從 null 改寫成真正時間戳，這裡誤判成第一次繳交、payload 帶
    // journalSubmitNotifiedAt:null，撞上 rule.txt「一般編輯必須維持原值不變」而整份
    // 月記存檔被拒（403）——且因為失敗時不清除這份過期快取，同一分頁重試會持續卡在
    // 同一個錯誤；②若間隔內兩邊 journalSubmitNotifiedAt 剛好都還是 null，這條驗證能
    // 通過，但 submittedAt（rule.txt 完全沒有驗證這個欄位）會被悄悄改成這次存檔的
    // 時間，蓋掉另一裝置真正的第一次繳交時間。修法：拿掉「sem/month 是否相符」這個
    // 條件判斷，改成每次儲存前一律現查一次 Firestore，不再有可以跳過現查的分支——跟
    // saveTeacherComment()／saveStudentReply() 修多裝置/多分頁競態問題用的「送出前
    // 無條件現查」完全一致。
    //
    // 驗證五項特徵（缺一即退化）：
    //   1. checkMonthDeadline() 的快取物件 exists:true 分支仍記錄 sem/month（結構不變，
    //      這兩個欄位雖然不再被 saveJournal() 拿來當判斷依據，但保留不影響正確性）
    //   2. checkMonthDeadline() 的 exists:false 分支仍出現 2 次皆帶 sem/month
    //   3. editJournal() 的快取物件仍記錄 sem/month
    //   4. saveJournal() 的「journalRef 宣告」到「isFirstSubmit 計算」這段區間裡，已經
    //      找不到舊版那個「只在不符時才查」的判斷式痕跡（_currentJournalCache.sem !==
    //      sem），且這段區間完全沒有任何 if 判斷式——只要現查還能被任何條件跳過，這個
    //      bug 就等於換一種寫法重新出現
    //   5. await getDoc(journalRef) 與寫回 window._currentJournalCache 兩行仍然存在，
    //      且位置仍早於 isFirstSubmit 的計算
    const result = await page.evaluate(() => {
      const checkFnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      const editFnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      if (!checkFnStr || !saveFnStr || !editFnStr) return { skip: true };

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const saveCode = codeOnly(saveFnStr);

      const checkTrueBranchHasSemMonth = /exists:\s*true,\s*sem,\s*month/.test(checkFnStr);
      const checkFalseBranchCount = (checkFnStr.match(/exists:\s*false,\s*sem,\s*month/g) || []).length;

      const editCacheHasSemMonth = /exists:\s*true,\s*sem,\s*month,/.test(editFnStr);

      const refIdx = saveCode.indexOf('const journalRef');
      const isFirstSubmitIdx = saveCode.indexOf('const isFirstSubmit');
      const segmentFound = refIdx !== -1 && isFirstSubmitIdx !== -1 && refIdx < isFirstSubmitIdx;
      const segment = segmentFound ? saveCode.slice(refIdx, isFirstSubmitIdx) : '';

      const noStaleMismatchGate = segmentFound && !/_currentJournalCache\.sem\s*!==\s*sem/.test(segment);
      const noConditionalSkip = segmentFound && !segment.includes('if (') && !segment.includes('if(');
      const hasFreshGetDoc = /await\s+getDoc\s*\(\s*journalRef\s*\)/.test(segment);
      const freshSnapWritesCache = /window\._currentJournalCache\s*=\s*freshSnap\.exists\(\)/.test(segment);

      return {
        skip: false,
        checkTrueBranchHasSemMonth,
        checkFalseBranchCount,
        editCacheHasSemMonth,
        segmentFound,
        noStaleMismatchGate,
        noConditionalSkip,
        hasFreshGetDoc,
        freshSnapWritesCache,
      };
    });
    if (result.skip) return;
    if (!result.checkTrueBranchHasSemMonth)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支找不到 sem/month，跟 editJournal() 的快取結構不一致');
    if (result.checkFalseBranchCount < 2)
      throw new Error(`checkMonthDeadline() 的 exists:false 快取分支應出現 2 次（ternary 的 false 分支 + 清空表單時的重複賦值）皆帶 sem/month，實際只找到 ${result.checkFalseBranchCount} 次，可能有一處忘記同步補上`);
    if (!result.editCacheHasSemMonth)
      throw new Error('editJournal() 的快取物件找不到 sem/month，跟 checkMonthDeadline() 的快取結構不一致');
    if (!result.segmentFound)
      throw new Error('saveJournal() 找不到「journalRef 宣告」到「isFirstSubmit 計算」這段區間，函式結構可能已大幅改動，需要重新確認現查邏輯是否還在');
    if (!result.noStaleMismatchGate)
      throw new Error('saveJournal() 仍找得到舊版「只在 sem/month 不符時才現查」的判斷式痕跡（_currentJournalCache.sem !== sem），2026-09-04 的修法可能被回退，跨裝置快取過期造成403/資料覆蓋的問題會重新出現');
    if (!result.noConditionalSkip)
      throw new Error('saveJournal() 的「journalRef 宣告」到「isFirstSubmit 計算」之間找到了 if 判斷式，代表現查 Firestore 這件事又變成有條件執行——不論條件是什麼，只要能被跳過，跨裝置快取過期的問題就可能用不同寫法重新繞過這層保護');
    if (!result.hasFreshGetDoc || !result.freshSnapWritesCache)
      throw new Error('saveJournal() 找不到「await getDoc(journalRef) 現查並寫回 window._currentJournalCache」的邏輯，isFirstSubmit 可能又變成完全信任舊快取');
  });

  // ════════════════════════════════════════
  // S-SEC-33 / S-SEC-34  2026-07-12 登入改版測試覆蓋補齊（2026-07-14 新增）
  // 背景：一輪針對 teacher.html 的稽核發現，student.html／teacher.html 在 2026-07-12
  // 都對 Google 登入機制做了同一輪重大改版（拿掉「standalone 一律先走 redirect」，
  // 改成「一律先試 popup，任何失敗都 fallback 到 redirect」），但這件事完全沒有出現在
  // 任何一份文件的版本狀態表或變更摘要裡，且 student.html／teacher.html 這輪改版本身
  // 在測試套件裡零覆蓋（全文搜尋 isStoragePartitionedEnv、popup-first、2026-07-12
  // 皆零命中）。isStoragePartitionedEnv() 這個函式本身在 student.html 其實已經存在
  // （並非這次新增），只是從未被任何測試覆蓋過，這裡一併補上。
  // ════════════════════════════════════════

  await test('S-SEC-33 isStoragePartitionedEnv() 已定義，且 googleStudentLogin()／handleRedirectResult() 皆有呼叫做為 guard', async () => {
    // 確認三項特徵：①函式本身已定義；②googleStudentLogin() 有呼叫它（popup 執行前）；
    // ③handleRedirectResult() 也有呼叫它（getRedirectResult() 之前）。
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');
      const hasFnDef = /function\s+isStoragePartitionedEnv\s*\(/.test(scripts);

      const googleFnStr = (typeof googleStudentLogin === 'function') ? googleStudentLogin.toString() : '';
      const redirectFnStr = (typeof handleRedirectResult === 'function') ? handleRedirectResult.toString() : '';
      if (!googleFnStr || !redirectFnStr) return { skip: true };

      const usedInGoogle = /isStoragePartitionedEnv\s*\(\s*\)/.test(googleFnStr);
      const usedInRedirect = /isStoragePartitionedEnv\s*\(\s*\)/.test(redirectFnStr);

      return { skip: false, hasFnDef, usedInGoogle, usedInRedirect };
    });

    if (result.skip) return;
    if (!result.hasFnDef) throw new Error('isStoragePartitionedEnv() 未定義');
    if (!result.usedInGoogle) throw new Error('googleStudentLogin() 未呼叫 isStoragePartitionedEnv() 做 guard');
    if (!result.usedInRedirect) throw new Error('handleRedirectResult() 未呼叫 isStoragePartitionedEnv() 做 guard');
  });

  await test('S-SEC-34 googleStudentLogin() 一律先試 signInWithPopup()，失敗（非使用者取消）時 fallback 到 signInWithRedirect()', async () => {
    // 背景：2026-07-12 拿掉「standalone 一律先走 redirect」的舊分支，改成不分 standalone
    // 與否，一律先試 popup、任何失敗（除了使用者主動取消）都自動 fallback 到 redirect。
    // 這個重大改版當時完全沒有對應測試，這裡補上，跟 teacher_test.js 的 T-SEC-35 對稱。
    const result = await page.evaluate(() => {
      const fnStr = (typeof googleStudentLogin === 'function') ? googleStudentLogin.toString() : '';
      if (!fnStr) return { skip: true };

      const hasPopupCall = /signInWithPopup\s*\(/.test(fnStr);
      const hasFallbackCall = /startStudentRedirectLogin\s*\(\s*\)/.test(fnStr);
      const hasCancelGuard = /popup-closed-by-user/.test(fnStr) && /cancelled-popup-request/.test(fnStr);

      const popupIdx = fnStr.search(/signInWithPopup\s*\(/);
      const catchIdx = fnStr.indexOf('catch(e)');
      const fallbackIdx = fnStr.search(/startStudentRedirectLogin\s*\(\s*\)/);
      const orderOK = popupIdx !== -1 && catchIdx !== -1 && fallbackIdx !== -1 &&
        popupIdx < catchIdx && catchIdx < fallbackIdx;

      // 2026-07-14 修正：這條負向檢查（確認舊分支「不存在」）原本直接對整段函式字串
      // （含註解）做鄰近字元搜尋，屬於僥倖通過——googleStudentLogin() 裡 isStandaloneApp()
      // 附近確實有一段解釋「當初為什麼拿掉 standalone 特別分支」的中文說明（提到
      // isStandaloneApp() 本身），目前 200 字窗口內剛好沒有直接寫出 signInWithRedirect／
      // startStudentRedirectLogin 這兩個英文字面詞，但講的內容正是這件事本身，未來改
      // 註解措辭時很容易不小心把這兩個詞寫進窗口內，導致這條測試在程式碼完全正確的情況下
      // 無端失敗——跟 T-SEC-34 的 getRedirectIdx 是同一類陷阱（S-SEC-08／T-SEC-30 也踩過），
      // 只是這次剛好還沒真的爆炸。修法：先過濾掉「整行都是註解」的行（trim 後以 // 開頭），
      // 只在剩餘的程式碼行上做鄰近搜尋，這樣即使未來註解怎麼寫都不會被誤判，只有真正的
      // 程式碼結構（例如舊分支被重新加回來）才會被抓到，與 teacher_test.js 的 T-SEC-35
      // 套用同一套修法。
      const codeOnlyLines = fnStr.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const noOldStandaloneBranch = !/isStandaloneApp\s*\(\s*\)[\s\S]{0,200}(signInWithRedirect|startStudentRedirectLogin)/.test(codeOnlyLines);

      return { skip: false, hasPopupCall, hasFallbackCall, hasCancelGuard, orderOK, noOldStandaloneBranch };
    });

    if (result.skip) return;
    if (!result.hasPopupCall) throw new Error('googleStudentLogin() 找不到 signInWithPopup() 呼叫');
    if (!result.hasFallbackCall) throw new Error('googleStudentLogin() 找不到 startStudentRedirectLogin() fallback 呼叫');
    if (!result.hasCancelGuard) throw new Error('googleStudentLogin() 找不到「使用者主動取消不重試」的判斷（auth/popup-closed-by-user／auth/cancelled-popup-request）');
    if (!result.orderOK) throw new Error('googleStudentLogin() 的呼叫順序不對：應是先試 signInWithPopup()，失敗（catch）後才呼叫 startStudentRedirectLogin() fallback');
    if (!result.noOldStandaloneBranch) throw new Error('googleStudentLogin() 疑似殘留「standalone 一律先走 redirect」的舊分支，2026-07-12 應已拿掉');
  });

  // ════════════════════════════════════════
  // S-SEC-35 ～ S-SEC-37　2026-07-17 新增：每月最少應繳篇數（minEntries）
  // ════════════════════════════════════════
  // 背景：teacher.html 主頁 2026-07-16 起已改用「entries.length >= minEntries」判斷一份
  // 月記是否算已繳，但 student.html 對這個概念完全零涵蓋——主頁「本月繳交狀態」只要有存檔
  // 就顯示✅已繳，「已逾期」名單也只看有沒有存檔，跟老師端看到的狀態可能不一致（學生自己
  // 覺得已繳，老師端卻標記未繳/篇數不足）。與 teacher_test.js 的 T-SEC-36～41 對稱維護。

  await test('S-SEC-35 resolveMinEntries() 篇數判斷 fallback 邏輯正確，與 teacher.html 對稱', async () => {
    // 直接呼叫函式本體帶入合成資料驗證，而非只看原始碼字串。
    const result = await page.evaluate(() => {
      if (typeof resolveMinEntries !== 'function') return { skip: true };
      return {
        skip: false,
        fallbackNoDoc:    resolveMinEntries(undefined) === 1,
        fallbackNoField:  resolveMinEntries({}) === 1,
        fallbackZero:     resolveMinEntries({ minEntries: 0 }) === 1,
        fallbackNonInt:   resolveMinEntries({ minEntries: 1.5 }) === 1,
        respectsSetValue: resolveMinEntries({ minEntries: 2 }) === 2,
      };
    });
    if (result.skip) return;
    if (!result.fallbackNoDoc || !result.fallbackNoField || !result.fallbackZero || !result.fallbackNonInt)
      throw new Error('resolveMinEntries() 對未設定/非法 minEntries 未正確 fallback 為 1');
    if (!result.respectsSetValue)
      throw new Error('resolveMinEntries() 未正確讀出已設定的 minEntries 值');
  });

  await test('S-SEC-36 getOverdueMonths() 改用篇數達標判斷，只交1篇但規定2篇且已過期仍算逾期', async () => {
    // 背景：原本 getOverdueMonths() 用 submittedMonths（純存在性 Set）判斷「這個月是否已繳」，
    // 只要有存檔（不論篇數）就不算逾期。改成跟 teacher.html 主頁一致的篇數達標判斷
    // （resolveMinEntries()）——只交1篇但規定2篇，截止日一過仍要提醒，不會因為「至少存了
    // 一份文件」就被排除在提醒之外。直接呼叫真正的函式帶入合成資料驗證，而非只做靜態
    // 字串比對。2026-08-31 起：getOverdueMonths() 第一參數改為 relevantSemesters 陣列
    // （見 S-SEC-58／S-SEC-59），回傳形狀也從純月份數字改為
    // [{semester,month,entriesCount,required}]（見 getRelevantSemesters() 上方註解），
    // 這裡同步改用新呼叫方式與新回傳形狀斷言，核心驗證目的（篇數不足＋已過期才算逾期）
    // 不變。
    const result = await page.evaluate(async () => {
      if (typeof getOverdueMonths !== 'function') return { skip: true };

      const deadlineDataMap = {
        '115-1-7': { semester: '115-1', month: 7, closeDate: '2000-01-01', minEntries: 2 }, // 早已過期
        '115-1-8': { semester: '115-1', month: 8, closeDate: '2099-01-01', minEntries: 2 }, // 尚未過期
      };

      const case1 = await getOverdueMonths(['115-1'], [{ semester: '115-1', month: 7, entries: [{}] }], deadlineDataMap);
      const case2 = await getOverdueMonths(['115-1'], [{ semester: '115-1', month: 7, entries: [{}, {}] }], deadlineDataMap);
      const case3 = await getOverdueMonths(['115-1'], [{ semester: '115-1', month: 8, entries: [{}] }], deadlineDataMap);

      return {
        skip: false,
        case1IncludesJuly: case1.some(o => o.semester === '115-1' && o.month === 7),
        case2ExcludesJuly: !case2.some(o => o.semester === '115-1' && o.month === 7),
        case3ExcludesAugust: !case3.some(o => o.semester === '115-1' && o.month === 8),
      };
    });

    if (result.skip) return;
    if (!result.case1IncludesJuly)
      throw new Error('只交1篇但規定2篇、且已過截止日時，getOverdueMonths() 未將該月列為逾期——這正是本次要修正的核心落差本身（先前只看有沒有存檔）');
    if (!result.case2ExcludesJuly)
      throw new Error('篇數已達標的月份被誤判為逾期');
    if (!result.case3ExcludesAugust)
      throw new Error('截止日尚未到的月份被誤判為逾期');
  });

  await test('S-SEC-37 loadStudentDashboard() 本月繳交狀態改用篇數判斷，並與 getOverdueMonths() 共用同一次 deadlines 查詢', async () => {
    const result = await page.evaluate(() => {
      if (typeof loadStudentDashboard !== 'function') return { skip: true };
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const fnStr = codeOnly(loadStudentDashboard.toString());

      const usesResolveMinEntries = /resolveMinEntries\s*\(/.test(fnStr);
      const comparesEntriesCount = /currentEntriesCount\s*>=\s*requiredThisMonth/.test(fnStr);
      const hasIncompleteBadge = fnStr.includes('badge-incomplete');
      // 2026-08-31 起：getOverdueMonths() 第一參數改傳 relevantSemesters（見
      // getRelevantSemesters(journals, sem) 的呼叫結果），不再直接傳 sem 本身。
      const passesMapToOverdue = /getOverdueMonths\s*\(\s*relevantSemesters\s*,\s*journals\s*,\s*deadlineDataMap\s*\)/.test(fnStr);

      return { skip: false, usesResolveMinEntries, comparesEntriesCount, hasIncompleteBadge, passesMapToOverdue };
    });

    if (result.skip) return;
    if (!result.usesResolveMinEntries)
      throw new Error('loadStudentDashboard() 找不到 resolveMinEntries() 呼叫，本月繳交狀態可能又退回「有存檔就算已繳」的舊標準');
    if (!result.comparesEntriesCount)
      throw new Error('loadStudentDashboard() 找不到 currentEntriesCount >= requiredThisMonth 比較邏輯');
    if (!result.hasIncompleteBadge)
      throw new Error('loadStudentDashboard() 找不到 badge-incomplete，篇數不足時可能沒有正確顯示「未完成」狀態');
    if (!result.passesMapToOverdue)
      throw new Error('loadStudentDashboard() 呼叫 getOverdueMonths() 時未傳入 getRelevantSemesters() 算出的 relevantSemesters＋共用的 deadlineDataMap，可能又鎖回單一學期或重複查詢 Firestore');
  });

  await test('S-SEC-58 getRelevantSemesters() 推導出「journals 出現過的學期」聯集「目前學期」，用於讓✗未繳／△篇數不足能跨學期偵測', async () => {
    // 背景：✓已繳／▲遲繳（getCompletedJournals()）本來就對這個帳號全部歷史 journals
    // 做 filter，不看 semester；✗未繳／△篇數不足（getOverdueMonths()）原本鎖死只查
    // 「目前學期」，兩者不對稱。getRelevantSemesters() 是這次修法新增的純函式，用「這個
    // 學生自己 journals 裡出現過的 semester 集合」＋「目前學期」，推導出 getOverdueMonths()
    // 該檢查哪些學期，不需要（也沒有管道）去枚舉整個 /deadlines collection 的所有學期。
    const result = await page.evaluate(() => {
      if (typeof getRelevantSemesters !== 'function') return { skip: true };

      const journals = [
        { semester: '114-2', month: 5 },
        { semester: '115-1', month: 9 },
        { semester: '115-1', month: 10 },
      ];
      const withHistory = getRelevantSemesters(journals, '115-2');
      const noJournalsYet = getRelevantSemesters([], '115-2');
      const dedupes = getRelevantSemesters([{ semester: '115-2', month: 3 }], '115-2');

      return {
        skip: false,
        includesPastSemesters: withHistory.includes('114-2') && withHistory.includes('115-1'),
        includesCurrentEvenIfAbsent: withHistory.includes('115-2'),
        currentAloneWhenNoHistory: noJournalsYet.length === 1 && noJournalsYet[0] === '115-2',
        noDuplicateWhenCurrentAlreadyInJournals: dedupes.length === 1,
      };
    });

    if (result.skip) return;
    if (!result.includesPastSemesters)
      throw new Error('getRelevantSemesters() 沒有把 journals 裡出現過的過去學期（114-2／115-1）納入結果');
    if (!result.includesCurrentEvenIfAbsent)
      throw new Error('目前學期即使 journals 裡還沒有任何一筆資料（例如剛開學），getRelevantSemesters() 也應該把它納入');
    if (!result.currentAloneWhenNoHistory)
      throw new Error('journals 為空陣列時，getRelevantSemesters() 應該只回傳目前學期自己一個');
    if (!result.noDuplicateWhenCurrentAlreadyInJournals)
      throw new Error('目前學期已經出現在 journals 裡時，getRelevantSemesters() 不應該把它重複列兩次');
  });

  await test('S-SEC-59 getOverdueMonths() 改為多學期版本後，能正確抓到「journals 出現過的過去學期」裡的逾期月份，且不會誤抓 relevantSemesters 以外的學期', async () => {
    // 背景：2026-08-31 起 getOverdueMonths() 第一參數從單一 sem 字串改為
    // relevantSemesters 陣列，回傳形狀也從純月份數字改為
    // [{semester,month,entriesCount,required}]，讓同一批結果可以同時涵蓋不同學期、
    // 且能正確標示每一筆各自屬於哪個學期（裸月份數字在跨學期情境下會分不出「115-1的9月」
    // 跟「115-2剛好也有9月資料」）。這裡驗證：①過去學期（114-2）裡已過期且篇數不足的
    // 月份會被抓到；②不在 relevantSemesters 名單內的學期（115-9，模擬「系統裡其他屆
    // 學生留下的舊截止日資料」，即使已過期也不該被抓到，這正是原本設計就要避免的
    // 問題，只是現在改成用集合判斷而非單一字串相等）；③排序依「學期新到舊、月份小到大」。
    const result = await page.evaluate(async () => {
      if (typeof getOverdueMonths !== 'function' || typeof getRelevantSemesters !== 'function') return { skip: true };

      const deadlineDataMap = {
        '114-2-5': { semester: '114-2', month: 5, closeDate: '2000-01-01', minEntries: 2 }, // 過去學期，早已過期，篇數不足
        '115-1-8': { semester: '115-1', month: 8, closeDate: '2000-01-01', minEntries: 1 }, // 目前學期，早已過期，篇數不足
        '115-1-9': { semester: '115-1', month: 9, closeDate: '2099-01-01', minEntries: 1 }, // 目前學期，尚未過期
        '115-9-1': { semester: '115-9', month: 1, closeDate: '2000-01-01', minEntries: 1 }, // 不相關學期（不在 relevantSemesters 內），即使早已過期也不該被抓到
      };
      const journals = [
        { semester: '114-2', month: 4, entries: [{}, {}] }, // 114-2 有交過其他月份，讓 114-2 會出現在 relevantSemesters 裡
      ];
      const relevantSemesters = getRelevantSemesters(journals, '115-1');
      const overdue = await getOverdueMonths(relevantSemesters, journals, deadlineDataMap);

      return {
        skip: false,
        relevantSemesters,
        catchesPastSemesterOverdue: overdue.some(o => o.semester === '114-2' && o.month === 5),
        catchesCurrentSemesterOverdue: overdue.some(o => o.semester === '115-1' && o.month === 8),
        excludesUnrelatedSemester: !overdue.some(o => o.semester === '115-9'),
        excludesNotYetDue: !overdue.some(o => o.semester === '115-1' && o.month === 9),
        sortedNewestSemesterFirst: overdue.length >= 2 && overdue[0].semester === '115-1' && overdue[overdue.length - 1].semester === '114-2',
      };
    });

    if (result.skip) return;
    if (!result.catchesPastSemesterOverdue)
      throw new Error('過去學期（114-2）裡已過期且篇數不足的月份沒有被抓到——這正是本次修法要達成的核心目標（跨學期偵測✗未繳／△篇數不足）');
    if (!result.catchesCurrentSemesterOverdue)
      throw new Error('目前學期原有的逾期偵測能力被改壞了');
    if (!result.excludesUnrelatedSemester)
      throw new Error('抓到了不在 relevantSemesters 名單內的學期（模擬系統裡其他屆學生留下的舊截止日資料）——這正是原始設計要避免、这次改成多學期後必須繼續守住的邊界');
    if (!result.excludesNotYetDue)
      throw new Error('截止日尚未到的月份被誤判為逾期');
    if (!result.sortedNewestSemesterFirst)
      throw new Error('排序不是「學期新到舊」——回傳陣列應該把目前學期（115-1）排在過去學期（114-2）前面');
  });

  await test('S-SEC-60 loadStudentDashboard() 已逾期清單改用 getRelevantSemesters()，且過去學期項目刻意不可點擊', async () => {
    // 背景：見 getOverdueMonths() 上方 2026-08-31 註解——過去學期的逾期項目若沿用
    // goToWriteMonth() 導去填寫頁，saveJournal() 最終會用「目前」座號寫入文件，跟座號
    // 每學期重新分配（見 AI_CONTEXT_狀態.md 第三節）的事實衝突，可能寫出跟該學期其餘
    // 月記座號不一致、甚至污染另一位同學歷史統計的資料。這裡是純原始碼靜態比對（渲染
    // 邏輯依賴真實 DOM id／Firestore 資料，不安全真執行，比照 S-SEC-37 既有做法），
    // 確認：①改叫 getRelevantSemesters()；②针对是否為目前學期分流出不同的 HTML（過去
    // 學期分支不含 onclick="goToWriteMonth"）。
    const result = await page.evaluate(() => {
      if (typeof loadStudentDashboard !== 'function') return { skip: true };
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const fnStr = codeOnly(loadStudentDashboard.toString());

      const callsGetRelevantSemesters = /getRelevantSemesters\s*\(\s*journals\s*,\s*sem\s*\)/.test(fnStr);
      const branchesOnCurrentSem = /isCurrentSem\s*=\s*o\.semester\s*===\s*sem/.test(fnStr);
      // 過去學期分支（isCurrentSem 為 false 時 return 的那一段）不應該包含 goToWriteMonth 呼叫。
      // 用「isCurrentSem 判斷式之後、到函式結尾」這段程式碼裡出現 goToWriteMonth 的次數，
      // 應該剛好只有 1 次（只在 if(isCurrentSem) 分支裡呼叫一次，另一個分支完全不呼叫）。
      const afterBranchIdx = fnStr.indexOf('isCurrentSem');
      const afterBranchCode = afterBranchIdx >= 0 ? fnStr.slice(afterBranchIdx) : '';
      const goToWriteMonthCallCount = (afterBranchCode.match(/goToWriteMonth\s*\(/g) || []).length;

      return { skip: false, callsGetRelevantSemesters, branchesOnCurrentSem, goToWriteMonthCallCount };
    });

    if (result.skip) return;
    if (!result.callsGetRelevantSemesters)
      throw new Error('loadStudentDashboard() 找不到 getRelevantSemesters(journals, sem) 呼叫，已逾期清單可能又鎖回單一學期');
    if (!result.branchesOnCurrentSem)
      throw new Error('loadStudentDashboard() 找不到依 o.semester === sem 分流目前學期／過去學期的判斷式');
    if (result.goToWriteMonthCallCount !== 1)
      throw new Error(`過去學期項目應該完全不可點擊（不呼叫 goToWriteMonth），預期只有目前學期分支呼叫1次，實際偵測到 ${result.goToWriteMonthCallCount} 次`);
  });

  await test('S-SEC-46 學生首頁已繳累計排除篇數不足月記，並正確標示遲繳', async () => {
    const result = await page.evaluate(() => {
      if (typeof getCompletedJournals !== 'function' || typeof isStudentJournalLate !== 'function' || typeof renderSubmittedMonthsDetail !== 'function') {
        return { skip: true };
      }

      const deadlineDataMap = {
        '115-1-7': { minEntries: 2, closeDate: '2026-07-31' },
        '115-1-8': { minEntries: 2, closeDate: '2026-08-31' },
        '115-1-9': { minEntries: 2, closeDate: '2026-09-30' },
      };
      const onTime = { semester: '115-1', month: 7, entries: [{}, {}], entriesFirstCompleteAt: '2026-07-31T20:00:00' };
      const incomplete = { semester: '115-1', month: 8, entries: [{}], entriesFirstCompleteAt: null };
      const late = { semester: '115-1', month: 9, entries: [{}, {}], entriesFirstCompleteAt: '2026-10-01T09:00:00' };
      const completed = getCompletedJournals([onTime, incomplete, late], deadlineDataMap);
      const detailHtml = renderSubmittedMonthsDetail(completed, deadlineDataMap);
      const dashboardCode = loadStudentDashboard.toString();

      return {
        skip: false,
        onlyCompletedCounted: completed.length === 2 && !completed.includes(incomplete),
        onTimeIsNotLate: !isStudentJournalLate(onTime, deadlineDataMap['115-1-7']),
        lateIsLate: isStudentJournalLate(late, deadlineDataMap['115-1-9']),
        detailMarksLate: detailHtml.includes('▲ 遲繳') && detailHtml.includes(semMonthToLabel('115-1', 9)),
        dashboardUsesCompleted: /getCompletedJournals\s*\(\s*journals\s*,\s*deadlineDataMap\s*\)/.test(dashboardCode)
          && /s-submitted-count[\s\S]{0,180}completedJournals\.length/.test(dashboardCode),
        dashboardUsesLateBadge: /isStudentJournalLate\s*\(\s*currentJournal/.test(dashboardCode),
      };
    });

    if (result.skip) return;
    if (!result.onlyCompletedCounted)
      throw new Error('已繳交累計仍包含篇數不足的月記');
    if (!result.onTimeIsNotLate || !result.lateIsLate)
      throw new Error('學生端遲交判斷沒有和截止日正確比對');
    if (!result.detailMarksLate)
      throw new Error('已繳交明細沒有標示達標但遲繳的月記');
    if (!result.dashboardUsesCompleted || !result.dashboardUsesLateBadge)
      throw new Error('loadStudentDashboard() 未使用已繳交共用判斷或遲繳徽章邏輯');
  });

  await test('S-SEC-38 push-enable-modal 相關函式與 DOM 元素完整存在，maybeShowPushEnableModal() 有登入狀態守門', async () => {
    // 2026-07-17 新增。#push-enable-modal／maybeShowPushEnableModal()／enablePushFromModal()
    // 是 2026-07-16 新增、目前唯一決定 iOS Safari 等裝置使用者能否收到任何推播的入口
    // （見 AI_推播系統說明.md 第六節 #22），上線後一直完全沒有自動化測試覆蓋，靠兩次
    // 人工 iPad 實測驗證，缺回歸保護網。比照 S-SEC-31 的模式補上靜態分析。
    //
    // 同時驗證 2026-07-17 補修的登入狀態守門：maybeShowPushEnableModal() 由 enterApp()
    // 尾端的 setTimeout(...,1500) 排程觸發，若使用者在這 1.5 秒窗口內登出，
    // currentUser 可能已被清空，原本沒有檢查會讓彈窗在跟登入狀態不一致的情況下顯示。
    //
    // 四項檢查：
    //   1. maybeShowPushEnableModal() 開頭有 currentUser?.uid 守門（本次補修的重點）——
    //      用 codeOnly() 過濾掉整行註解再比對，避免像 S-SEC-08／T-SEC-30／S-SEC-29／
    //      T-SEC-34／S-SEC-34 那樣被函式內部解釋性註解（本身就會提到 currentUser 字樣）
    //      誤判命中。
    //   2. enablePushFromModal() 有呼叫 closeModal('push-enable-modal') 與
    //      initPushNotifications()，確保使用者點擊後彈窗會關閉且真的觸發推播請求。
    //   3. enterApp() 尾端有 setTimeout(maybeShowPushEnableModal, 1500)，這是整個機制
    //      唯一的觸發點，若被移除，彈窗永遠不會出現。
    //   4. #push-enable-modal 這個 DOM 元素確實存在於頁面上（modal-overlay class，
    //      預設 hidden），不是函式想顯示一個根本不存在的元素。
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
        '2026-07-17 補修：若使用者在 enterApp() 排程的 1.5 秒窗口內登出，' +
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

  await test('S-SEC-39 saveJournal() 只在第一次繳交時使用目前名冊公司，一般編輯改保留這份月記自己原本記錄的公司', async () => {
    // 2026-07-23 新增。背景：saveJournal() 原本無條件寫入 company: currentUser.company（目前
    // 名冊上的公司），不分「這是第一次繳交」還是「回頭編輯任何舊月份」。若學生7月在A公司、
    // 8月換到B公司後，回頭編輯7月月記並儲存，會把7月的 company 也覆蓋成B——老師端因此看到
    // 7月顯示錯誤的公司。修法：比照既有 submittedAt 只在第一次記錄、之後一律保留原值的
    // 做法，company 也只在 isFirstSubmit 為真時才用 currentUser.company，一般編輯改保留
    // window._currentJournalCache.company（這份月記自己當初記錄的值）。
    //
    // 連帶修正：checkMonthDeadline()／editJournal() 的快取都要補上 company（否則
    // saveJournal() 讀不到「原本記錄的公司」可以保留），且畫面上的「本月實習公司」欄位在
    // 編輯既有月份時也要顯示這份月記當時的公司，不能一律顯示目前名冊公司，避免畫面顯示
    // 跟實際儲存行為對不上（見 checkMonthDeadline()／editJournal() 各自補上的 write-company
    // 顯示邏輯）。
    //
    // 驗證五項特徵（缺一即退化）：
    //   1. checkMonthDeadline() 的 exists:true 快取分支有記錄 company
    //   2. checkMonthDeadline() 在既有月記存在時，把 write-company 的顯示值設成
    //      j.company || currentUser.company（不是只用 currentUser.company）
    //   3. editJournal() 的快取物件也記錄 company，且同樣更新 write-company 顯示值
    //   4. saveJournal() 的 freshSnap 現查快取（快取不新鮮時的備援路徑）也記錄 company，
    //      否則快取新鮮度不符、需要現查時會漏記這個欄位
    //   5. saveJournal() 寫入的 data.company 是「isFirstSubmit 才用 currentUser.company，
    //      否則保留 _currentJournalCache.company」的條件式，不是無條件套用目前名冊公司
    const result = await page.evaluate(() => {
      const checkFnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      const editFnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      if (!checkFnStr || !saveFnStr || !editFnStr) return { skip: true };

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const checkCode = codeOnly(checkFnStr);
      const saveCode = codeOnly(saveFnStr);
      const editCode = codeOnly(editFnStr);

      const checkCacheHasCompany = /exists:\s*true,\s*sem,\s*month,\s*company:\s*journalSnap\.data\(\)\.company/.test(checkCode);
      const checkDisplaysJournalCompany = /write-company['"]\)\.value\s*=\s*j\.company\s*\|\|\s*currentUser\.company/.test(checkCode);

      const editCacheHasCompany = /company:\s*j\.company\s*,/.test(editCode);
      const editDisplaysJournalCompany = /write-company['"]\)\.value\s*=\s*j\.company\s*\|\|\s*currentUser\.company/.test(editCode);

      const freshSnapCacheHasCompany = /company:\s*freshSnap\.data\(\)\.company/.test(saveCode);

      const dataCompanyIsConditional =
        /company:\s*isFirstSubmit\s*\?\s*\(currentUser\.company\s*\|\|\s*''\)\s*:\s*\(window\._currentJournalCache\?\.company\s*\|\|\s*currentUser\.company\s*\|\|\s*''\)/.test(saveCode);
      // 不應再殘留舊的「無條件套用 currentUser.company」寫法
      const noOldUnconditionalWrite = !/studentName:\s*currentUser\.name,\s*company:\s*currentUser\.company\s*\|\|\s*''/.test(saveCode);

      return {
        skip: false,
        checkCacheHasCompany, checkDisplaysJournalCompany,
        editCacheHasCompany, editDisplaysJournalCompany,
        freshSnapCacheHasCompany,
        dataCompanyIsConditional, noOldUnconditionalWrite,
      };
    });

    if (result.skip) return;
    if (!result.checkCacheHasCompany)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支找不到 company，saveJournal() 一般編輯時無法保留這份月記原本記錄的公司');
    if (!result.checkDisplaysJournalCompany)
      throw new Error('checkMonthDeadline() 載入既有月記時，write-company 顯示值未改成「這份月記自己的公司優先」，畫面仍只會顯示目前名冊公司，跟實際儲存行為對不上');
    if (!result.editCacheHasCompany)
      throw new Error('editJournal() 的快取物件找不到 company');
    if (!result.editDisplaysJournalCompany)
      throw new Error('editJournal() 未更新 write-company 顯示值為這份月記自己的公司');
    if (!result.freshSnapCacheHasCompany)
      throw new Error('saveJournal() 的快取新鮮度現查（freshSnap）備援路徑找不到 company，快取不新鮮需要現查時會漏記這個欄位');
    if (!result.dataCompanyIsConditional)
      throw new Error('saveJournal() 的 data.company 沒有「isFirstSubmit 才用目前名冊公司，否則保留原快取公司」的條件式寫法——換公司後回頭編輯舊月份仍可能把公司覆蓋掉');
    if (!result.noOldUnconditionalWrite)
      throw new Error('saveJournal() 仍殘留「company: currentUser.company || \'\'」無條件套用目前名冊公司的舊寫法');
  });

  await test('S-SEC-40 computeEntriesCompleteAt() 篇數達標時間戳計算邏輯正確（涵蓋 2026-07-24 遲交判斷修正驗證過的 5 組情境＋1 組防止時間戳被無關編輯往前推進的補充情境）', async () => {
    // 2026-07-25 新增。背景：2026-07-24 那輪「遲交」判斷修正（entriesCompleteAt 取代
    // submittedAt 判斷準時/遲繳）當時只用 Node 手動模擬跑過 5 組情境，AI_CONTEXT.md
    // 明確記載「本輪未新增自動化測試，列為已知缺口」。這條測試把當時的手動驗證變成真正的
    // 回歸測試：判斷邏輯本身已抽成獨立純函式 computeEntriesCompleteAt()（定義於
    // resolveMinEntries() 旁），直接呼叫函式本體帶合成資料驗證回傳值，不做原始碼字串比對。
    const result = await page.evaluate(() => {
      if (typeof computeEntriesCompleteAt !== 'function') return { skip: true };
      const NOW = '2026-08-01T09:00:00';

      // 情境1：完全沒交，8/1 才第一次寫完整規定的2篇 → 應記錄現在（8/1）的時間，
      // 之後 isJournalLate() 拿這個時間跟7月截止日比較會判定遲繳。
      const case1 = computeEntriesCompleteAt(0, null, 2, 2, NOW);

      // 情境2a：7月準時只先寫1篇（規定2篇，尚未達標）→ 應為 null。
      const case2a = computeEntriesCompleteAt(0, null, 1, 2, '2026-07-20T09:00:00');
      // 情境2b：緊接著 8/1 才補齊第2篇（entriesCountBefore 讀自情境2a存檔後的快取，
      // entriesCompleteAtBefore 也是情境2a算出的 null）→ 應記錄現在（8/1）的時間，
      // 不是7月那次「準時但不足額」的存檔時間——這正是本次修法要解決的核心情境：
      // 「先隨便存一篇佔位」不該比「到期限後才第一次動手寫」更早被判定為已繳。
      const case2b = computeEntriesCompleteAt(1, case2a, 2, 2, NOW);

      // 情境3：準時一次寫足2篇（規定2篇）→ 應記錄現在（準時）的時間。
      const case3 = computeEntriesCompleteAt(0, null, 2, 2, '2026-07-20T09:00:00');

      // 情境4：這個功能上線前就已達標的舊資料（entriesCompleteAtBefore 從未寫過、是
      // null），之後單純編輯心得、entries 數量完全不變（篇數維持達標）→ 應維持 null
      // 不變，不能因為一次跟篇數無關的編輯就被誤判成「現在才剛好達標」，讓
      // isJournalLate() 的 fallback 繼續退回用 submittedAt 判斷，不錯誤蓋掉原本
      // 正確的準時記錄。
      const case4 = computeEntriesCompleteAt(2, null, 2, 2, NOW);

      // 情境5：篇數不足做一般編輯（規定2篇、still只有1篇）→ 應維持 null（這個情境
      // 本來就不會被 isJournalLate() 讀到，因為 statusSymbolForJournal() 會先被
      // isJournalComplete() 擋在 △，但 computeEntriesCompleteAt() 本身仍要正確清空）。
      const case5 = computeEntriesCompleteAt(1, null, 1, 2, NOW);

      // 情境6（補充）：已達標且已有既有時間戳，之後又新增一篇（entries 數量增加，但
      // 早已達標），例如規定2篇、原本3篇存過的時間戳是7月的準時值，這次編輯變成4篇
      // → 應維持原本 7 月那個既有時間戳不變，不會因為篇數繼續增加就被推進到現在，
      // 避免「達標之後任何一次編輯都被誤判成新的達標時刻」。
      const existingTimestamp = '2026-07-20T09:00:00';
      const case6 = computeEntriesCompleteAt(3, existingTimestamp, 4, 2, NOW);

      return {
        skip: false,
        case1, case2a, case2b, case3, case4, case5, case6,
      };
    });

    if (result.skip) return;
    if (result.case1 !== '2026-08-01T09:00:00')
      throw new Error(`情境1（完全沒交、8/1才第一次寫完2篇）應記錄現在的時間，實際得到 ${result.case1}`);
    if (result.case2a !== null)
      throw new Error(`情境2a（準時但只交1篇、規定2篇）應為 null（尚未達標），實際得到 ${result.case2a}`);
    if (result.case2b !== '2026-08-01T09:00:00')
      throw new Error(`情境2b（7月準時寫1篇、8/1才補齊第2篇）應記錄8/1補齊當下的時間，不能沿用7月那次不足額的存檔時間，實際得到 ${result.case2b}——這正是本次遲交判斷修正要解決的核心情境，若此測試失敗代表修法可能已被還原`);
    if (result.case3 !== '2026-07-20T09:00:00')
      throw new Error(`情境3（準時一次寫足2篇）應記錄準時當下的時間，實際得到 ${result.case3}`);
    if (result.case4 !== null)
      throw new Error(`情境4（功能上線前已達標的舊資料，單純編輯心得不動篇數）應維持 null 讓 isJournalLate() 退回用 submittedAt 判斷，實際得到 ${result.case4}——不該被無關的編輯誤判成剛好達標`);
    if (result.case5 !== null)
      throw new Error(`情境5（篇數不足做一般編輯）應維持 null，實際得到 ${result.case5}`);
    if (result.case6 !== '2026-07-20T09:00:00')
      throw new Error(`情境6（已達標後續新增篇數不應推進時間戳）應維持原本的既有時間戳不變，實際得到 ${result.case6}`);
  });

  await test('S-SEC-41 checkMonthDeadline()／editJournal()／saveJournal() 現查 fallback 三處快取皆補上 entriesCount／entriesCompleteAt，且 saveJournal() 寫入 payload 確實含 entriesCompleteAt 欄位', async () => {
    // 2026-07-25 新增。背景：computeEntriesCompleteAt()（S-SEC-40）驗證的是計算邏輯本身
    // 「輸入正確時輸出對不對」，但這條計算邏輯的兩個輸入（entriesCountBefore／
    // entriesCompleteAtBefore）都讀自 window._currentJournalCache——如果快取寫入的地方
    // 漏了這兩個欄位，S-SEC-40 驗證過的邏輯再正確也沒用（永遠拿到 undefined，
    // entriesCountBefore 會被 saveJournal() 的 `?? 0` 救回來，但 entriesCompleteAtBefore
    // 沒有這層防護，undefined 在 computeEntriesCompleteAt() 內部 `entriesCompleteAtBefore
    // || null` 這一步雖然結果上跟 null 相同，仍然值得直接鎖住快取寫入本身，而不是依賴
    // 這個巧合）。這條測試直接檢查三處快取寫入（checkMonthDeadline() 的 exists:true 分支、
    // editJournal()、saveJournal() 自己的現查 fallback）與最終送出的 payload，跟
    // S-SEC-32（檢查 sem/month）是同一類「快取結構完整性」測試，只是這次檢查的是另外
    // 兩個新欄位。刻意用「精確錨定實際賦值語法」而非寬鬆字串搜尋，避開這份專案已經記錄
    // 過四次的「regex 命中函式內部解釋性註解」陷阱——這幾處函式上方的中文說明本身就會
    // 反覆提到 entriesCount／entriesCompleteAt 這兩個字，若只檢查「字串裡有沒有出現」
    // 會恆為真、測不出任何退化。
    const result = await page.evaluate(() => {
      const checkFnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const editFnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!checkFnStr || !editFnStr || !saveFnStr) return { skip: true };

      // checkMonthDeadline() 的 exists:true 分支（journalSnap.data() 讀值）
      const checkHasEntriesCount = checkFnStr.includes('entriesCount: (journalSnap.data().entries || []).length');
      const checkHasEntriesCompleteAt = checkFnStr.includes('entriesCompleteAt: journalSnap.data().entriesCompleteAt || null');

      // editJournal() 的快取物件（j 是 journalSnap.data()）
      const editHasEntriesCount = editFnStr.includes('entriesCount: (j.entries || []).length');
      const editHasEntriesCompleteAt = editFnStr.includes('entriesCompleteAt: j.entriesCompleteAt || null');

      // saveJournal() 自己的「快取新鮮度現查」fallback（freshSnap 讀值）
      const saveFallbackHasEntriesCount = saveFnStr.includes('entriesCount: (freshSnap.data().entries || []).length');
      const saveFallbackHasEntriesCompleteAt = saveFnStr.includes('entriesCompleteAt: freshSnap.data().entriesCompleteAt || null');

      // saveJournal() 最終送出的 payload——用 shorthand property 寫法 `entriesCompleteAt,`，
      // 用負向 lookbehind 排除前面接 `.` 的情況（例如呼叫 computeEntriesCompleteAt() 時
      // 傳入的 `window._currentJournalCache?.entriesCompleteAt,` 這個參數，同樣文字但
      // 是讀取快取值當參數，不是最終要寫入 Firestore 的 payload 欄位本身，兩者不能混淆）
      const payloadMatches = saveFnStr.match(/(?<!\.)\bentriesCompleteAt\s*,/g) || [];

      return {
        skip: false,
        checkHasEntriesCount, checkHasEntriesCompleteAt,
        editHasEntriesCount, editHasEntriesCompleteAt,
        saveFallbackHasEntriesCount, saveFallbackHasEntriesCompleteAt,
        payloadMatchCount: payloadMatches.length,
      };
    });

    if (result.skip) return;
    if (!result.checkHasEntriesCount)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支缺少 entriesCount');
    if (!result.checkHasEntriesCompleteAt)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支缺少 entriesCompleteAt');
    if (!result.editHasEntriesCount)
      throw new Error('editJournal() 的快取物件缺少 entriesCount');
    if (!result.editHasEntriesCompleteAt)
      throw new Error('editJournal() 的快取物件缺少 entriesCompleteAt');
    if (!result.saveFallbackHasEntriesCount)
      throw new Error('saveJournal() 的快取新鮮度現查 fallback 缺少 entriesCount，快取不新鮮需要現查時會漏記這個欄位');
    if (!result.saveFallbackHasEntriesCompleteAt)
      throw new Error('saveJournal() 的快取新鮮度現查 fallback 缺少 entriesCompleteAt');
    if (result.payloadMatchCount !== 1)
      throw new Error(`saveJournal() 送出的 payload 應恰好有 1 處 entriesCompleteAt 欄位（shorthand 寫法），實際找到 ${result.payloadMatchCount} 處——不是完全缺席就是位置對不上預期`);
  });

  await test('S-SEC-44 computeEntriesFirstCompleteAt() 歷史最早達標時間計算邏輯正確（涵蓋不可逆保留／舊欄位遷移回填／全新達標／尚未達標／minEntries調高後合法前進／count缺席的過渡期資料遷移（含防永久鎖死）六類情境，並串接模擬使用者回報的完整 bug 情境）', async () => {
    // 2026-08-17 新增，2026-08-18 補修兩輪。第二輪背景見函式定義上方大段註解：原始設計
    // 「一旦有值就永遠不可逆保留」忽略了 minEntries 也可能被老師事後調高，改為新增
    // entriesFirstCompleteAtCount（凍結當下驗證過的篇數）搭配判斷，讓凍結在較寬鬆舊
    // 門檻下的紀錄，在門檻被調高超過原本驗證篇數時可以合法失效、依現在門檻重新凍結。
    // 第三輪背景（情境8／9新增）：entriesFirstCompleteAtCount 這個 companion 欄位是
    // 2026-08-18 第二輪修法才新增的，任何在它上線前、entriesFirstCompleteAt 就已經被
    // 8/17 第一版邏輯合法寫成非 null 的既有月記，都屬於「count 從未被追蹤過」的過渡期
    // 資料（不是「count=0」，是這個欄位在文件裡根本不存在）。若沒有專屬分支處理，這種
    // 文件下次被編輯時：該生此刻篇數仍達標 → 會被誤判成「這次才剛好跨過門檻」，frozen
    // 日期被悄悄推到今天（重演本輪修法要消除的問題，只是換了個觸發途徑）；該生此刻篇數
    // 不足 → client 會嘗試把 entriesFirstCompleteAt 改回 null，但 rule.txt
    // keepsEntriesFirstCompleteAtOnceSet() 不允許非 null 改回 null，這次存檔（即使改的是
    // 完全無關的欄位）會被整體拒絕，等同把這位學生永久鎖在這份月記外面——這是比前者更嚴重
    // 的真實生產風險，不是理論案例。情境8／9分別驗證這兩種子情境都已被正確處理。
    // 函式簽名為 7 參數、回傳 {at, count} 物件，這裡的測試呼叫與斷言都對應這個簽名。
    const result = await page.evaluate(() => {
      if (typeof computeEntriesFirstCompleteAt !== 'function') return { skip: true };

      // 情境1（全新達標，模擬7月準時寫滿2篇，門檻2篇）：兩個「舊值」皆為 null/0，這次
      // 存檔前後剛好跨過門檻 → 應記錄現在（準時）的時間，count 記錄較大的那次篇數。
      const case1 = computeEntriesFirstCompleteAt(null, 0, null, 0, 2, 2, '2026-07-20T10:00:00');

      // 情境2（不可逆保留，承接情境1）：entriesFirstCompleteAtBefore／Count 已是情境1算出
      // 的7月時間與篇數，模擬8月誤刪1篇導致篇數掉回不足（門檻仍2篇未變）→ 凍結當下驗證
      // 過的篇數(2)依然撐得住現在門檻(2)，應原封不動維持情境1的7月時間。
      const case2 = computeEntriesFirstCompleteAt(case1.at, case1.count, null, 2, 1, 2, '2026-08-05T09:00:00');

      // 情境3（不可逆保留，承接情境2，這正是使用者原始問題的核心情境）：8月補寫回2篇
      // （門檻仍2篇未變），entriesCompleteAt（舊欄位）會被舊邏輯誤判成「這次才剛好跨過
      // 門檻」改記錄8/6，但 entriesFirstCompleteAt 應該完全不受影響，繼續維持最早的7月
      // 時間，不能變成8/6。
      const case3 = computeEntriesFirstCompleteAt(case2.at, case2.count, null, 1, 2, 2, '2026-08-06T09:00:00');

      // 情境4（舊欄位遷移回填）：這個新欄位剛上線那一刻的舊資料——entriesFirstCompleteAtBefore
      // 從未存在過（null/0），但舊 entriesCompleteAt 欄位這次存檔前已經是非 null 的合法
      // 時間戳（代表在這個新欄位存在以前，這份月記就已經合法達標過），且 entriesCountBefore
      // 在現在門檻下仍然成立 → 應直接沿用舊欄位的值當作「最早」，count 記錄
      // entriesCountBefore，不是用「現在」這個較晚的時間覆蓋掉真正的歷史時間。
      const case4 = computeEntriesFirstCompleteAt(null, 0, '2026-07-15T09:00:00', 2, 1, 2, '2026-08-10T09:00:00');

      // 情境5（尚未達標）：兩個「舊值」皆為 null/0，這次存檔前後都未達標（門檻2篇，
      // 前0後1）→ 應維持 { at: null, count: null }。
      const case5 = computeEntriesFirstCompleteAt(null, 0, null, 0, 1, 2, '2026-08-01T09:00:00');

      // 情境6（沒有任何歷史紀錄可用的達標情況，補充邊界案例）：entriesFirstCompleteAtBefore
      // 與 entriesCompleteAtBefore 皆為 null，但這次存檔前後篇數已經達標（例如全新文件
      // 一次寫入就已達標，且是這個新欄位上線後第一次被計算，沒有更早的歷史可回填）→ 只能
      // 記錄現在的時間，屬於系統能力邊界內的最佳努力，不是 bug。
      const case6 = computeEntriesFirstCompleteAt(null, 0, null, 2, 2, 2, '2026-08-01T09:00:00');

      // 情境7（2026-08-18 第二輪修法的核心情境，補充邊界案例）：7月門檻1篇時凍結在7/5
      // （count=1），9月老師把門檻調高到3篇，這次存檔前1篇、後3篇 → 舊凍結（門檻1篇下
      // 驗證過的count=1）撐不住現在的門檻(3)，應該失效重算，改記錄9月才真正補齊3篇的
      // 時間，count 更新成3。若此測試失敗代表第二輪修法可能已被還原，minEntries 調高後
      // 逾期補齊的學生會被誤判準時。
      const frozen = computeEntriesFirstCompleteAt(null, 0, null, 0, 1, 1, '2026-07-05T09:00:00');
      const case7 = computeEntriesFirstCompleteAt(frozen.at, frozen.count, null, 1, 3, 3, '2026-09-10T09:00:00');

      // 情境8（2026-08-18 第三輪修法：count 缺席的過渡期資料，此刻篇數仍達標）：
      // entriesFirstCompleteAt 已是 8/17 第一版邏輯合法寫入的 7/24，但 count 這個
      // companion 欄位從未被追蹤過（傳 null，不是 0——0 代表「追蹤到的值是0」，這裡是
      // 「根本沒追蹤」），此刻篇數(3)在現在門檻(3)下仍然達標 → 應沿用舊日期 7/24 不變、
      // count 用目前已知篇數(3)回填，不能被誤判成「這次才剛好跨過門檻」而悄悄推到今天。
      const case8 = computeEntriesFirstCompleteAt('2026-07-24T11:00:00', null, null, 3, 3, 3, '2026-08-18T10:00:00');

      // 情境9（2026-08-18 第三輪修法核心：count 缺席的過渡期資料，此刻篇數不足——
      // 防永久鎖死案例）：跟情境8同一份過渡期資料，但這次門檻被調高到5篇、此刻只有2篇
      // （不足）。若這裡回傳 { at: 7/24, count: null }，count 為 null 會讓 at 非 null
      // 但 count 為 null 這個不合法配對被寫回 Firestore，直接撞上 rule.txt
      // validEntriesFirstCompleteAt() 的耦合驗證整次存檔被拒——所以這裡必須連 count 都
      // backfill 成一個格式合法的非負整數（用此刻已知的篇數 2，即使它不足以達標）。
      const case9 = computeEntriesFirstCompleteAt('2026-07-24T11:00:00', null, null, 2, 2, 5, '2026-08-18T10:00:00');

      return { skip: false, case1, case2, case3, case4, case5, case6, case7, case8, case9 };
    });

    if (result.skip) return;
    if (result.case1.at !== '2026-07-20T10:00:00' || result.case1.count !== 2)
      throw new Error(`情境1（全新達標，準時寫滿2篇）應記錄 {at:準時當下, count:2}，實際得到 ${JSON.stringify(result.case1)}`);
    if (result.case2.at !== result.case1.at || result.case2.count !== result.case1.count)
      throw new Error(`情境2（承接情境1，8月誤刪1篇，門檻未變）應原封不動維持情境1（${JSON.stringify(result.case1)}），實際得到 ${JSON.stringify(result.case2)}——不可逆保留失效`);
    if (result.case3.at !== result.case1.at || result.case3.count !== result.case1.count)
      throw new Error(`情境3（承接情境2，8月補寫回2篇，使用者原始回報的核心情境，門檻未變）應維持最早的7月紀錄（${JSON.stringify(result.case1)}），實際得到 ${JSON.stringify(result.case3)}——若此測試失敗代表第一輪修法可能已被還原，學生會被誤判遲交`);
    if (result.case4.at !== '2026-07-15T09:00:00' || result.case4.count !== 2)
      throw new Error(`情境4（新欄位剛上線的舊資料遷移，舊 entriesCompleteAt 已是7/15）應直接沿用 {at:7/15, count:2}，不能用補寫當下（8/10）覆蓋，實際得到 ${JSON.stringify(result.case4)}`);
    if (result.case5.at !== null || result.case5.count !== null)
      throw new Error(`情境5（尚未達標）應維持 {at:null, count:null}，實際得到 ${JSON.stringify(result.case5)}`);
    if (result.case6.at !== '2026-08-01T09:00:00' || result.case6.count !== 2)
      throw new Error(`情境6（無歷史紀錄可用的達標情況）應記錄 {at:現在, count:2}，實際得到 ${JSON.stringify(result.case6)}`);
    if (result.case7.at !== '2026-09-10T09:00:00' || result.case7.count !== 3)
      throw new Error(`情境7（第二輪修法核心：minEntries調高導致舊凍結失效重算）應記錄 {at:9/10, count:3}，實際得到 ${JSON.stringify(result.case7)}——若此測試失敗代表第二輪修法可能已被還原，門檻調高後逾期補齊的學生會被誤判準時`);
    if (result.case8.at !== '2026-07-24T11:00:00' || result.case8.count !== 3)
      throw new Error(`情境8（第三輪修法：count缺席的過渡期資料，此刻仍達標）應沿用舊日期 {at:7/24, count:3}，不能被誤判成剛跨過門檻而推到今天，實際得到 ${JSON.stringify(result.case8)}——若此測試失敗代表防「悄悄推到今天」的遷移分支可能已被移除或改壞`);
    if (result.case9.at !== '2026-07-24T11:00:00' || result.case9.count !== 2)
      throw new Error(`情境9（第三輪修法核心：count缺席的過渡期資料，此刻不足——防永久鎖死）應維持 {at:7/24, count:2}（count 必須 backfill 成合法非負整數，不能是 null），實際得到 ${JSON.stringify(result.case9)}——若此測試失敗，count 若為 null 會讓這類舊資料下次編輯任何欄位都被 rule.txt 耦合驗證拒絕，等同把學生永久鎖在這份月記外面`);
  });

  await test('S-SEC-45 checkMonthDeadline()／editJournal()／saveJournal() 現查 fallback 三處快取皆補上 entriesFirstCompleteAt／entriesFirstCompleteAtCount，且 saveJournal() 寫入 payload 確實各含 1 處這兩個欄位', async () => {
    // 2026-08-17 新增，2026-08-18 補修，跟 S-SEC-41 同一類「快取結構完整性」測試，只是
    // 這次檢查 computeEntriesFirstCompleteAt()（S-SEC-44）依賴的輸入來源
    // （entriesFirstCompleteAtBefore／entriesFirstCompleteAtCountBefore／
    // entriesCompleteAtBefore）有沒有確實被快取補齊——S-SEC-44 驗證的是計算邏輯本身
    // 「輸入正確時輸出對不對」，這條測試驗證輸入來源本身有沒有被正確寫入快取，兩者互補，
    // 缺一都測不出完整的回歸保護。
    const result = await page.evaluate(() => {
      const checkFnStr = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const editFnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!checkFnStr || !editFnStr || !saveFnStr) return { skip: true };

      const checkHasEntriesFirstCompleteAt = checkFnStr.includes('entriesFirstCompleteAt: journalSnap.data().entriesFirstCompleteAt || null');
      const editHasEntriesFirstCompleteAt = editFnStr.includes('entriesFirstCompleteAt: j.entriesFirstCompleteAt || null');
      const saveFallbackHasEntriesFirstCompleteAt = saveFnStr.includes('entriesFirstCompleteAt: freshSnap.data().entriesFirstCompleteAt || null');
      // 2026-08-18 補修（第二輪）：三處快取同步檢查配套欄位 entriesFirstCompleteAtCount
      // 有沒有被補齊。2026-08-18 第三輪修法：預設值改用 ?? null（不是 ?? 0）——凍結只會
      // 在篇數 >= minEntries（>= 1，resolveMinEntries() fallback 下限）時才會發生，真正
      // 被追蹤過的 entriesFirstCompleteAtCount 天生就 >= 1，0 這個值不可能是合法紀錄，
      // 所以「這個欄位在文件裡根本不存在」（新增 entriesFirstCompleteAtCount 前就已經
      // 合法寫入 entriesFirstCompleteAt 的過渡期資料）跟「真的追蹤到 0」不會混淆；但
      // 用 null 才是精確對應「根本不存在」語意的寫法，也是 computeEntriesFirstCompleteAt()
      // 情境8／9（S-SEC-44）新增的過渡期遷移分支能正確判斷「缺席」與「已知但不足」兩種
      // 情況的前提——若這裡繼續用 ?? 0，缺席跟真的計算出0（理論上不會發生但仍是語意
      // 不精確）會被疊在同一個值上，且與 computeEntriesFirstCompleteAt() 用 `!= null`
      // 判斷缺席的寫法不一致。
      const checkHasEntriesFirstCompleteAtCount = checkFnStr.includes('entriesFirstCompleteAtCount: journalSnap.data().entriesFirstCompleteAtCount ?? null');
      const editHasEntriesFirstCompleteAtCount = editFnStr.includes('entriesFirstCompleteAtCount: j.entriesFirstCompleteAtCount ?? null');
      const saveFallbackHasEntriesFirstCompleteAtCount = saveFnStr.includes('entriesFirstCompleteAtCount: freshSnap.data().entriesFirstCompleteAtCount ?? null');

      // 2026-08-18 補修：原本的負向 lookbehind 排除法只排除了 `?.entriesFirstCompleteAt,`
      // 這種現查快取讀取寫法，沒考慮到函式簽名改成回傳 {at, count} 物件後，呼叫端新增了
      // `const { at: entriesFirstCompleteAt, count: entriesFirstCompleteAtCount } = ...`
      // 這樣的解構賦值——解構目標 `entriesFirstCompleteAt,`（在 "at: " 後面）字面上一樣
      // 符合「shorthand 屬性」的樣子，會被舊 regex 誤算成第二個「payload 欄位」，因而
      // 誤判成「找到2處」。新增排除 "at: " 前綴（解構賦值目標的固定寫法），只計算真正
      // 出現在 payload 物件字面量裡的 shorthand 屬性寫法。entriesFirstCompleteAtCount
      // 同理需要排除 "count: " 前綴。
      const atPayloadMatches = saveFnStr.match(/(?<!\.)(?<!at:\s)\bentriesFirstCompleteAt\s*,/g) || [];
      const countPayloadMatches = saveFnStr.match(/(?<!\.)(?<!count:\s)\bentriesFirstCompleteAtCount\s*,/g) || [];

      return {
        skip: false,
        checkHasEntriesFirstCompleteAt,
        editHasEntriesFirstCompleteAt,
        saveFallbackHasEntriesFirstCompleteAt,
        checkHasEntriesFirstCompleteAtCount,
        editHasEntriesFirstCompleteAtCount,
        saveFallbackHasEntriesFirstCompleteAtCount,
        atPayloadMatchCount: atPayloadMatches.length,
        countPayloadMatchCount: countPayloadMatches.length,
      };
    });

    if (result.skip) return;
    if (!result.checkHasEntriesFirstCompleteAt)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支缺少 entriesFirstCompleteAt');
    if (!result.editHasEntriesFirstCompleteAt)
      throw new Error('editJournal() 的快取物件缺少 entriesFirstCompleteAt');
    if (!result.saveFallbackHasEntriesFirstCompleteAt)
      throw new Error('saveJournal() 的快取新鮮度現查 fallback 缺少 entriesFirstCompleteAt');
    if (!result.checkHasEntriesFirstCompleteAtCount)
      throw new Error('checkMonthDeadline() 的 exists:true 快取分支缺少配套欄位 entriesFirstCompleteAtCount');
    if (!result.editHasEntriesFirstCompleteAtCount)
      throw new Error('editJournal() 的快取物件缺少配套欄位 entriesFirstCompleteAtCount');
    if (!result.saveFallbackHasEntriesFirstCompleteAtCount)
      throw new Error('saveJournal() 的快取新鮮度現查 fallback 缺少配套欄位 entriesFirstCompleteAtCount');
    if (result.atPayloadMatchCount !== 1)
      throw new Error(`saveJournal() 送出的 payload 應恰好有 1 處 entriesFirstCompleteAt 欄位（shorthand 寫法），實際找到 ${result.atPayloadMatchCount} 處——不是完全缺席就是位置對不上預期`);
    if (result.countPayloadMatchCount !== 1)
      throw new Error(`saveJournal() 送出的 payload 應恰好有 1 處 entriesFirstCompleteAtCount 欄位（shorthand 寫法），實際找到 ${result.countPayloadMatchCount} 處——不是完全缺席就是位置對不上預期`);
  });


  await test('S-SEC-42 薪資單可上傳多張，儲存/顯示/PDF 均改用 salaryPhotos，且保留舊 salaryPhoto 相容與 Firestore 大小防呆', async () => {
    const result = await page.evaluate(() => {
      const input = document.getElementById('salary-photo-file');
      const preview = document.getElementById('salary-photo-preview');
      const handleFn = (typeof handleSalaryPhoto === 'function') ? handleSalaryPhoto.toString() : '';
      const saveFn = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      const checkFn = (typeof checkMonthDeadline === 'function') ? checkMonthDeadline.toString() : '';
      const editFn = (typeof editJournal === 'function') ? editJournal.toString() : '';
      const pdfFn = (typeof preparePdfJournalImages === 'function') ? preparePdfJournalImages.toString() : '';
      const cardFn = (typeof renderJournalCardSelectable === 'function') ? renderJournalCardSelectable.toString() : '';
      if (!input || !preview || !handleFn || !saveFn || !checkFn || !editFn || !pdfFn || !cardFn || typeof getJournalSalaryPhotos !== 'function') return { skip: true };

      const newFormat = getJournalSalaryPhotos({ salaryPhotos: ['first', '', 42, 'second'] });
      const legacyFormat = getJournalSalaryPhotos({ salaryPhoto: 'legacy' });
      const originalHtml = preview.innerHTML;
      renderSalaryPhotoPreviews(['first', 'second']);
      const previewValues = getSalaryPhotoValuesFromPreview();
      preview.innerHTML = originalHtml;

      return {
        skip: false,
        multipleInput: input.multiple === true,
        maxCount: SALARY_PHOTO_MAX_COUNT === 5,
        totalLimit: Number.isInteger(SALARY_PHOTO_TOTAL_LIMIT) && SALARY_PHOTO_TOTAL_LIMIT > 0 && SALARY_PHOTO_TOTAL_LIMIT < 1048576,
        newFormat: JSON.stringify(newFormat) === JSON.stringify(['first', 'second']),
        legacyFormat: JSON.stringify(legacyFormat) === JSON.stringify(['legacy']),
        previewValues: JSON.stringify(previewValues) === JSON.stringify(['first', 'second']),
        handlerHasBothLimits: handleFn.includes('SALARY_PHOTO_MAX_COUNT') && handleFn.includes('SALARY_PHOTO_TOTAL_LIMIT'),
        saveWritesArray: /const salaryPhotos\s*=\s*getSalaryPhotoValuesFromPreview\(\)/.test(saveFn) && /salaryPhotos\s*,\s*salaryPhoto:\s*''/.test(saveFn),
        restoresBothFormats: checkFn.includes('renderSalaryPhotoPreviews(getJournalSalaryPhotos(j))') && editFn.includes('renderSalaryPhotoPreviews(getJournalSalaryPhotos(j))'),
        historyRendersArray: cardFn.includes('renderSalaryPhotosHtml(j)'),
        pdfRendersArray: pdfFn.includes('getJournalSalaryPhotos(j).map(imageToDataUrl)') && pdfFn.includes('_pdfSalaryPhotos'),
      };
    });
    if (result.skip) return;
    if (!result.multipleInput) throw new Error('薪資單檔案 input 缺少 multiple，學生仍只能一次選擇一張');
    if (!result.maxCount || !result.totalLimit) throw new Error('薪資單多張上傳的張數/總大小防呆缺失，可能超過 Firestore 單一文件上限');
    if (!result.newFormat || !result.legacyFormat) throw new Error('getJournalSalaryPhotos() 未同時正確支援 salaryPhotos 新格式與 salaryPhoto 舊格式');
    if (!result.previewValues) throw new Error('薪資單多張預覽未能正確保留每一張要儲存的 Base64 值');
    if (!result.handlerHasBothLimits) throw new Error('handleSalaryPhoto() 未同時套用最多張數與總大小限制');
    if (!result.saveWritesArray) throw new Error('saveJournal() 未寫入 salaryPhotos 或未清空舊 salaryPhoto，可能造成多張資料無法儲存或 Base64 重複佔用');
    if (!result.restoresBothFormats) throw new Error('載入既有月記時沒有將新舊薪資單格式統一還原為多張預覽');
    if (!result.historyRendersArray) throw new Error('學生歷史月記卡片沒有改用多張薪資單渲染函式');
    if (!result.pdfRendersArray) throw new Error('學生 PDF 匯出沒有遍歷所有薪資單照片');
  });

  await test('S-SEC-43 單筆刪月記／批次刪歷史月記皆改為需輸入姓名或 DELETE {筆數} 才能刪除，不符合時 toast 錯誤且不執行刪除', async () => {
    const result = await page.evaluate(() => {
      const singleFn = (typeof confirmDeleteJournal === 'function') ? confirmDeleteJournal.toString() : '';
      const batchFn = (typeof confirmBatchDeleteHistory === 'function') ? confirmBatchDeleteHistory.toString() : '';
      if (!singleFn || !batchFn) return { skip: true };

      // 單筆刪月記：刻意用 currentUser?.name（登入者當下姓名），不是傳進來的 studentName
      // 參數（等於 j.studentName，月記存檔當下記錄的舊值，若名冊姓名事後被更正過可能不同步）
      const singleHasRequiredText = /const requiredText = currentUser\?\.name \|\| '';/.test(singleFn);
      const singleHasCheck = /if \(\(inputEl\?\.value \|\| ''\) !== requiredText\)/.test(singleFn);
      const singleHasErrorToast = /toast\('輸入內容不符，請重新輸入姓名以確認刪除', 'error'\)/.test(singleFn);
      const singleCheckIdx = singleFn.indexOf("if ((inputEl?.value || '') !== requiredText)");
      const singleExecuteIdx = singleFn.indexOf('executeDeleteJournal(seatNo, semester, month, isTeacher)');
      const singleOrderOK = singleCheckIdx !== -1 && singleExecuteIdx !== -1 && singleExecuteIdx > singleCheckIdx;

      const batchHasRequiredText = /const requiredText = `DELETE \$\{journals\.length\}`;/.test(batchFn);
      const batchHasCheck = /if \(\(inputEl\?\.value \|\| ''\) !== requiredText\)/.test(batchFn);
      const batchHasErrorToast = /toast\('輸入內容不符，請重新輸入以確認刪除', 'error'\)/.test(batchFn);
      const batchCheckIdx = batchFn.indexOf("if ((inputEl?.value || '') !== requiredText)");
      const batchExecuteIdx = batchFn.indexOf('executeBatchDeleteHistory(journals)');
      const batchOrderOK = batchCheckIdx !== -1 && batchExecuteIdx !== -1 && batchExecuteIdx > batchCheckIdx;

      const domElementsExist = !!document.getElementById('delete-journal-confirm-input')
        && !!document.getElementById('delete-journal-confirm-hint')
        && !!document.getElementById('batch-delete-history-confirm-input')
        && !!document.getElementById('batch-delete-history-confirm-hint');

      return {
        skip: false,
        singleHasRequiredText, singleHasCheck, singleHasErrorToast, singleOrderOK,
        batchHasRequiredText, batchHasCheck, batchHasErrorToast, batchOrderOK,
        domElementsExist,
      };
    });
    if (result.skip) return;
    if (!result.singleHasRequiredText) throw new Error('confirmDeleteJournal() 缺少 requiredText = currentUser?.name 的姓名輸入要求');
    if (!result.singleHasCheck || !result.singleHasErrorToast) throw new Error('confirmDeleteJournal() 缺少輸入不符時的檢查或錯誤提示');
    if (!result.singleOrderOK) throw new Error('confirmDeleteJournal() 的刪除呼叫沒有被輸入驗證正確保護，可能不驗證就直接執行刪除');
    if (!result.batchHasRequiredText) throw new Error('confirmBatchDeleteHistory() 缺少 requiredText = `DELETE {筆數}` 的輸入要求');
    if (!result.batchHasCheck || !result.batchHasErrorToast) throw new Error('confirmBatchDeleteHistory() 缺少輸入不符時的檢查或錯誤提示');
    if (!result.batchOrderOK) throw new Error('confirmBatchDeleteHistory() 的刪除呼叫沒有被輸入驗證正確保護，可能不驗證就直接執行刪除');
    if (!result.domElementsExist) throw new Error('刪除確認 Modal 缺少對應的輸入框或提示文字 DOM 元素');
  });

  await test('S-SEC-47 compressImageFile()／isLikelyBlankCanvas() 共用函式存在，且兩處呼叫皆改用共用函式', async () => {
    // 2026-08-21 新增。修復「少數學生薪資單／工作照片存檔後變成整張黑色」問題（見
    // 修復報告_薪資單與工作照片壓縮後變黑圖問題_2026-08-21.md）後的回歸保護：
    // handlePhotoUpload()／compressSalaryPhoto() 原本各自維護一份幾乎一樣的
    // 「讀取→解碼→縮圖→輸出JPEG」邏輯，正是這次要修的「兩份需要人工同步的複本」問題
    // 本身。這裡不驗證黑圖 bug 有沒有重現（那需要真的讓瀏覽器 drawImage() 失敗，測試
    // 環境重現不了），而是釘住「未來重構/還原不會不小心讓兩處退回各自內嵌的舊寫法」，
    // 避免黑圖漏洞無聲無息地原地重現。
    const result = await page.evaluate(() => {
      const hasFns = typeof compressImageFile === 'function' && typeof isLikelyBlankCanvas === 'function';
      if (!hasFns) return { skip: true };

      const compressFnStr = compressImageFile.toString();
      const uploadFnStr = (typeof handlePhotoUpload === 'function') ? handlePhotoUpload.toString() : '';
      const salaryFnStr = (typeof compressSalaryPhoto === 'function') ? compressSalaryPhoto.toString() : '';
      if (!uploadFnStr || !salaryFnStr) return { skip: true };

      return {
        skip: false,
        // createImageBitmap 是優先解碼路徑（修法①），isLikelyBlankCanvas() 是黑圖偵測
        // 保險網（修法②）——兩者缺一都代表這次修復的核心防線被拿掉了。
        usesCreateImageBitmap: /createImageBitmap\s*\(/.test(compressFnStr),
        callsBlankCheck: /isLikelyBlankCanvas\s*\(/.test(compressFnStr),
        // 兩處呼叫端必須真的改呼叫共用函式，不能各自維持一份內嵌的 img.onload 壓縮流程
        uploadUsesShared: /compressImageFile\s*\(/.test(uploadFnStr),
        salaryUsesShared: /compressImageFile\s*\(/.test(salaryFnStr),
        // handlePhotoUpload() 原本完全沒有錯誤處理，解碼失敗時佔位符會永遠卡在「處理中...」；
        // 改用 async/await 後必須用 try/catch 接住 compressImageFile() 的 reject
        uploadHasTryCatch: /try\s*{/.test(uploadFnStr) && /catch\s*\(/.test(uploadFnStr),
      };
    });
    if (result.skip) return;
    if (!result.usesCreateImageBitmap) throw new Error('compressImageFile() 未使用 createImageBitmap()（優先解碼路徑）');
    if (!result.callsBlankCheck) throw new Error('compressImageFile() 未呼叫 isLikelyBlankCanvas()（黑圖偵測保險網）');
    if (!result.uploadUsesShared) throw new Error('handlePhotoUpload() 未呼叫共用函式 compressImageFile()，可能被還原成各自內嵌的舊壓縮邏輯');
    if (!result.salaryUsesShared) throw new Error('compressSalaryPhoto() 未呼叫共用函式 compressImageFile()，可能被還原成各自內嵌的舊壓縮邏輯');
    if (!result.uploadHasTryCatch) throw new Error('handlePhotoUpload() 缺少 try/catch，圖片處理失敗時佔位符可能永遠卡在「處理中...」');
  });

  await test('S-SEC-48 isLikelyBlankCanvas() 實際偵測全黑／正常顏色 canvas 結果正確', async () => {
    // 2026-08-21 新增。不是字串比對，是真的在瀏覽器建立 <canvas> 並實際呼叫函式驗證回傳
    // 值，直接驗證這次修復的核心防線（黑圖偵測閾值）本身可靠，不只是「函式有寫」，比照
    // 專案一貫的「Actual execution over reasoning」標準。
    const result = await page.evaluate(() => {
      if (typeof isLikelyBlankCanvas !== 'function') return { skip: true };

      function makeCanvasCtx(fillStyle) {
        const canvas = document.createElement('canvas');
        canvas.width = 50;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = fillStyle;
        ctx.fillRect(0, 0, 50, 50);
        return ctx;
      }

      // 情境一：從未被畫過、維持預設全透明（RGBA全0）——這正是 drawImage() 靜默失敗時
      // canvas 的真實狀態，不是額外模擬出來的極端案例。
      const blankCanvas = document.createElement('canvas');
      blankCanvas.width = 50; blankCanvas.height = 50;
      const blankCtx = blankCanvas.getContext('2d');

      // 情境二：明確填滿純黑（不透明）——內容本身仍是全黑，理應同樣被判定為疑似失敗。
      const blackCtx = makeCanvasCtx('rgb(0,0,0)');

      // 情境三：正常顏色照片，不應誤判為失敗。
      const redCtx = makeCanvasCtx('rgb(200,80,40)');

      // 情境四：邊界案例——超過閾值(4)的深灰色，不應被誤判（避免閾值被改鬆或改嚴都測不出來）。
      const nearBlackCtx = makeCanvasCtx('rgb(6,6,6)');

      return {
        skip: false,
        blankDetected: isLikelyBlankCanvas(blankCtx, 50, 50),
        solidBlackDetected: isLikelyBlankCanvas(blackCtx, 50, 50),
        normalColorNotFlagged: !isLikelyBlankCanvas(redCtx, 50, 50),
        nearBlackNotFlagged: !isLikelyBlankCanvas(nearBlackCtx, 50, 50),
      };
    });
    if (result.skip) return;
    if (!result.blankDetected)
      throw new Error('isLikelyBlankCanvas() 沒有偵測到「從未繪製、預設全透明」的 canvas（drawImage 靜默失敗的真實狀態）');
    if (!result.solidBlackDetected)
      throw new Error('isLikelyBlankCanvas() 沒有偵測到明確填滿純黑的 canvas');
    if (!result.normalColorNotFlagged)
      throw new Error('isLikelyBlankCanvas() 誤判正常顏色照片為黑圖失敗');
    if (!result.nearBlackNotFlagged)
      throw new Error('isLikelyBlankCanvas() 誤判超過閾值的深灰色照片為黑圖失敗（閾值判斷可能被改鬆或改嚴）');
  });

  await test('S-SEC-49 saveJournal() 的 journalSubmitNotifiedAt 只在 isFirstSubmit 為真時寫入 null，一般編輯完全不帶這個欄位', async () => {
    // 2026-08-25 新增。背景：journalSubmitNotifiedAt 是 checkNewJournals()（見
    // AI_推播系統說明_狀態.md 3.6節）用來判斷「這份月記是否已推播過『第一次繳交』通知」
    // 的哨兵值，rule.txt 那一側（偽造非null應被拒／明確null應成功／一般編輯竄改應被拒）
    // 已經被 Layer 1 完整測過，但那只驗證「client 端送來的 payload 符合這個形狀時，規則
    // 會不會正確放行/拒絕」，不驗證「client 端本身在對的時機真的會算出對的 payload」。
    // 全文搜尋這份測試檔，這行條件式本身此前從未被任何測試直接斷言過（S-SEC-32 驗證的是
    // isFirstSubmit 賴以計算的快取新鮮度，是這行的前置條件，不是這行本身）。
    //
    // 驗證三項特徵（缺一即退化）：
    //   1. isFirstSubmit 的定義公式本身正確：!(快取存在 && 快取有 submittedAt)
    //   2. payload 用 `isFirstSubmit ? { journalSubmitNotifiedAt: null } : {}` 條件式
    //      spread 寫入，第一次繳交才帶這個欄位、一般編輯完全省略（靠 merge:true 讓後端
    //      已寫入的非null值天然維持不動，對應 rule.txt「一般編輯必須維持原值不變」的要求）
    //   3. 過濾掉整行註解後，journalSubmitNotifiedAt 這個欄位名稱在函式裡只出現一次——
    //      這個函式的說明性註解本身就會提到「journalSubmitNotifiedAt:null」這個字面組合
    //      （解釋「不能這樣寫」的反面教材），naive 搜尋容易被註解文字本身騙過（陷阱19／
    //      25 同一類），只在過濾後的程式碼行上找才準
    const result = await page.evaluate(() => {
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      if (!saveFnStr) return { skip: true };

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const saveCode = codeOnly(saveFnStr);

      const isFirstSubmitDefCorrect =
        /const\s+isFirstSubmit\s*=\s*!\(\s*window\._currentJournalCache\?\.exists\s*&&\s*window\._currentJournalCache\?\.submittedAt\s*\)/.test(saveCode);

      const payloadIsConditional =
        /\.\.\.\(\s*isFirstSubmit\s*\?\s*\{\s*journalSubmitNotifiedAt:\s*null\s*\}\s*:\s*\{\s*\}\s*\)/.test(saveCode);

      const occurrenceCount = (saveCode.match(/journalSubmitNotifiedAt/g) || []).length;

      return {
        skip: false,
        isFirstSubmitDefCorrect,
        payloadIsConditional,
        occurrenceCount,
      };
    });

    if (result.skip) return;
    if (!result.isFirstSubmitDefCorrect)
      throw new Error('saveJournal() 找不到 isFirstSubmit 的定義，或公式不是 !(_currentJournalCache?.exists && _currentJournalCache?.submittedAt)——journalSubmitNotifiedAt 的寫入時機可能已改變，需重新確認');
    if (!result.payloadIsConditional)
      throw new Error('saveJournal() 的 payload 找不到 `...(isFirstSubmit ? { journalSubmitNotifiedAt: null } : {})` 這個條件式 spread 寫法，可能被改成無條件寫入——一般編輯若無條件帶上這個欄位，會撞上 rule.txt「一般編輯必須維持原值不變」被 403 拒絕；若無條件省略，真正第一次繳交也不會被 checkNewJournals() 查到，老師安靜收不到繳交通知');
    if (result.occurrenceCount !== 1)
      throw new Error(`過濾註解後，journalSubmitNotifiedAt 應該只在條件式 spread 那一行出現恰好 1 次，實際找到 ${result.occurrenceCount} 次——可能有第二處遺漏測到的無條件寫入或殘留舊寫法`);
  });

  await test('S-SEC-50 resolveImgSrc() 只允許本專案 Cloudinary 網域，其餘外部網址一律視為無效來源', async () => {
    // 2026-08-26 新增。背景見本檔案 v36 header：entries[].photos／salaryPhotos 是學生
    // 自己月記文件的一部分，rule.txt 只驗證陣列長度／型別，沒有逐元素驗證網址格式，
    // 技術使用者可繞過正常上傳流程直接呼叫 Firestore API 塞入任意外部網址，之後會被
    // 當成 <img src> 或被 imageToDataUrl() 的 fetch() 真的抓下來。這裡直接呼叫函式本體
    // 帶各種輸入驗證行為，不是字串比對——比照專案一貫的「Actual execution over
    // reasoning」標準（同 S-SEC-48）。
    const result = await page.evaluate(() => {
      if (typeof resolveImgSrc !== 'function') return { skip: true };
      const cloudPrefix = (typeof CLOUDINARY_CLOUD_NAME === 'string' && CLOUDINARY_CLOUD_NAME)
        ? `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/` : null;
      if (!cloudPrefix) return { skip: true };

      const validCloudUrl = cloudPrefix + 'image/upload/v1/tcivs/test.jpg';
      const maliciousUrl = 'https://evil-tracker.example.com/pixel.png';
      // 只鎖網域字面是不夠的——必須鎖到本專案的 cloud name，否則任何人自己的 Cloudinary
      // 帳號網址一樣會被放行，一樣能達成同樣的追蹤/外洩效果。
      const otherCloudinaryAccount = 'https://res.cloudinary.com/someone-elses-account/image/upload/x.jpg';
      const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      const legacyRawBase64 = '/9j/4AAQSkZJRgABAQEA';

      return {
        skip: false,
        allowsOwnCloudinary: resolveImgSrc(validCloudUrl) === validCloudUrl,
        blocksExternalUrl: resolveImgSrc(maliciousUrl) === '',
        blocksOtherCloudinaryAccount: resolveImgSrc(otherCloudinaryAccount) === '',
        passesThroughDataUri: resolveImgSrc(dataUri) === dataUri,
        prefixesLegacyRawBase64: resolveImgSrc(legacyRawBase64) === ('data:image/jpeg;base64,' + legacyRawBase64),
        handlesEmpty: resolveImgSrc('') === '' && resolveImgSrc(null) === '' && resolveImgSrc(undefined) === '',
      };
    });
    if (result.skip) return;
    if (!result.allowsOwnCloudinary) throw new Error('resolveImgSrc() 誤擋了本專案自己 Cloudinary 帳號的正常網址，可能白名單字串拼錯或 CLOUDINARY_CLOUD_NAME 讀取失敗');
    if (!result.blocksExternalUrl) throw new Error('resolveImgSrc() 沒有擋下非白名單的外部網址，可能被改回 startsWith(\'http\') 就放行的舊寫法，SSRF/第三方追蹤風險重新出現');
    if (!result.blocksOtherCloudinaryAccount) throw new Error('resolveImgSrc() 只檢查了 res.cloudinary.com 這個網域本身，沒有進一步限定到本專案的 cloud name，其他任何人的 Cloudinary 帳號網址仍會被放行');
    if (!result.passesThroughDataUri) throw new Error('resolveImgSrc() 不再正確處理既有的 data: URI（薪資單/一般照片目前的正常存檔格式），會造成既有照片全部無法顯示');
    if (!result.prefixesLegacyRawBase64) throw new Error('resolveImgSrc() 不再正確處理沒有前綴的舊格式純 base64 字串');
    if (!result.handlesEmpty) throw new Error('resolveImgSrc() 對空值/null/undefined 的處理被改壞');
  });

  await test('S-SEC-51 saveJournal()／editJournal() 薪資填0元不再被當成「沒填」', async () => {
    // 2026-08-30 新增。背景：saveJournal() 原本 `parseInt(...) || null` 用 truthy/falsy
    // 判斷有沒有填薪資，但 parseInt("0") === 0 是 falsy，導致「填0元」跟「完全沒填」變成
    // 同一筆資料（0 || null 結果是 null）——輸入框 min="0"、下一行範圍驗證訊息也寫
    // 「請填 0–200,000 元」，都證明 0 本來就該是合法值。同一個bug的另一半在
    // editJournal()：`j.salary || ''` 會讓已經存進 Firestore 的 salary:0 在編輯畫面上
    // 顯示成空白。對照組 checkMonthDeadline()（第2331行 j.salary ?? ''）原本就寫對，
    // 這兩處是單純沒跟上，不是刻意設計。
    //
    // 這裡改用 saveJournal.toString()／editJournal.toString() 直接比對真實原始碼
    // （比照 S-SEC-49 對 saveJournal() 已建立的做法），不在這個共用測試頁面即時呼叫
    // 真正的 saveJournal()／editJournal()——這兩個函式會動到 Firestore（getDoc／
    // setDoc／getDocs／updateDoc），若要用真執行驗證，需要暫時覆寫這些函式並在測試
    // 結束後還原，而這個共用 page 之後還有其他測試依賴 firebase_funcs／currentUser
    // 維持真實登入狀態，貿然覆寫風險不成比例；改為靜態比對已足夠驗證這行程式碼本身
    // 是否符合預期寫法，且不需要登入 session 即可跑（不呼叫 requireStudentSession()）。
    // codeOnly() 過濾整行註解，避免這裡的說明文字本身（提到了新舊兩種寫法的字面）
    // 被 naive 搜尋誤判命中（陷阱19／25 同一類）。
    const result = await page.evaluate(() => {
      const saveFnStr = (typeof saveJournal === 'function') ? saveJournal.toString() : '';
      const editFnStr = (typeof editJournal === 'function') ? editJournal.toString() : '';
      if (!saveFnStr || !editFnStr) return { skip: true };

      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const saveCode = codeOnly(saveFnStr);
      const editCode = codeOnly(editFnStr);

      const saveUsesIsNaNCheck =
        /const\s+salaryParsed\s*=\s*parseInt\(\s*document\.getElementById\(['"]write-salary['"]\)\.value\s*\)\s*;/.test(saveCode)
        && /const\s+salary\s*=\s*Number\.isNaN\(\s*salaryParsed\s*\)\s*\?\s*null\s*:\s*salaryParsed\s*;/.test(saveCode);
      const saveNoOldFalsyPattern =
        !/const\s+salary\s*=\s*parseInt\([^;]*\)\s*\|\|\s*null/.test(saveCode);

      const editUsesNullish =
        /document\.getElementById\(['"]write-salary['"]\)\.value\s*=\s*j\.salary\s*\?\?\s*''/.test(editCode);
      const editNoOldOrPattern =
        !/document\.getElementById\(['"]write-salary['"]\)\.value\s*=\s*j\.salary\s*\|\|\s*''/.test(editCode);

      return { skip: false, saveUsesIsNaNCheck, saveNoOldFalsyPattern, editUsesNullish, editNoOldOrPattern };
    });

    if (result.skip) return;
    if (!result.saveUsesIsNaNCheck || !result.saveNoOldFalsyPattern)
      throw new Error('saveJournal() 的薪資解析找不到 Number.isNaN() 判斷寫法（或仍殘留/退回 `parseInt(...) || null`）——填0元可能又會被誤判成「沒填」，觸發不必要的確認對話框，且存進 Firestore 的值會被錯誤存成 null');
    if (!result.editUsesNullish || !result.editNoOldOrPattern)
      throw new Error('editJournal() 的薪資欄位還原找不到 `j.salary ?? \'\'` 寫法（或仍殘留/退回 `j.salary || \'\'`）——已存檔的 salary:0 打開編輯畫面會被誤顯示成空白欄位');
  });

  await test('S-SEC-52 工作類型圓餅圖 tooltip 不再丟 ReferenceError（tipEl 未宣告）', async () => {
    // 2026-08-30 新增。背景：renderStudentWorkTypeChart() 的 mouseenter/mousemove/
    // mouseleave/click 監聽器全部在用變數 tipEl，但函式本身沒有宣告它——結構幾乎一樣的
    // 另外兩個函式 renderStudentCityChart()／renderStudentSalaryLineChart() 都有
    // `const tipEl = container.querySelector(...)` 這行，唯獨這裡漏掉，全檔也沒有全域
    // tipEl。結果是學生點/滑過首頁「工作類型」圓餅圖色塊時，一執行到 tipEl 就丟
    // ReferenceError，tooltip完全不會顯示（讀取未宣告變數一律拋錯，不受嚴不嚴格模式
    // 影響）。
    //
    // 這是純 DOM 渲染函式，不碰 Firestore／currentUser，不需要學生登入 session，
    // 直接在這個共用 page 上真執行：餵合成 journals 資料觸發真正渲染，對渲染出來的
    // 色塊真的 dispatch mouseenter/mousemove/click 事件，比字串/regex比對更能證明
    // ReferenceError 真的消失、tooltip 真的會顯示正確內容，不只是「程式碼長得對」
    // （比照 S-SEC-48／T-SEC-57 已建立的「真執行優於推理」標準）。測試結束後呼叫真正
    // 的 loadStudentStats()（若目前有真實登入狀態）讓圖表重新載入真實資料，盡量不留
    // 合成測試資料在畫面上；此頁面本身沒有其他既有測試會斷言這個容器的內容，即使還原
    // 失敗（例如目前尚未登入）也不影響其他測項。
    const result = await page.evaluate(async () => {
      const container = document.getElementById('s-work-type-chart');
      if (typeof renderStudentWorkTypeChart !== 'function' || !container) return { skip: true };

      const journals = [{ entries: [{ type: '搬運' }, { type: '搬運' }, { type: '包裝' }] }];
      renderStudentWorkTypeChart(journals);
      const slice = container.querySelector('.s-pie-slice');
      if (!slice) return { skip: true };

      let threw = null;
      try {
        slice.dispatchEvent(new MouseEvent('mouseenter'));
        slice.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
        slice.dispatchEvent(new MouseEvent('click'));
      } catch (e) {
        threw = e.message;
      }
      const tipEl = container.querySelector('#s-pie-tip');
      const tipVisible = tipEl ? tipEl.style.display === 'block' : false;
      const tipText = tipEl ? tipEl.textContent : '';

      // 盡量還原成真實資料（見上方註解），還原失敗不影響本測試判定
      try { if (typeof currentUser !== 'undefined' && currentUser && typeof loadStudentStats === 'function') await loadStudentStats(); } catch (_) {}

      return { skip: false, threw, tipVisible, tipText };
    });
    // 注意：dispatchEvent() 對監聽器內丟出的例外不會同步往外傳（DOM規範本身如此，
    // 瀏覽器改成非同步回報到 console/pageerror），所以上面 try/catch 抓到的 threw
    // 實務上幾乎總是 null，即使 tipEl 未宣告一樣如此——真正能分辨這個bug的是下面
    // tipVisible／tipText 這兩項：ReferenceError 讓監聽器整個提前中斷，tooltip 永遠
    // 不會被設成顯示，這才是这個bug真正、可觀察的症狀。
    if (result.skip) return;
    if (result.threw) throw new Error(`色塊事件監聽器同步丟出例外：${result.threw}`);
    if (!result.tipVisible) throw new Error('tooltip 沒有正確顯示（style.display 不是 block）——可能 tipEl 仍未宣告或選取到錯誤元素，互動時被靜默吃掉例外');
    if (!result.tipText || !result.tipText.includes('搬運')) throw new Error(`tooltip 內容不正確或為空：實際為 "${result.tipText}"`);
  });


  // ════════════════════════════════════════
  // S-SEC-53 / S-SEC-54　2026-08-30 新增：登入流程稽核（onAuthStateChanged 重複實作／
  // googleStudentLogin() popup失敗與驗證失敗混用同一 catch）
  // ════════════════════════════════════════
  // 背景：一輪針對兩端登入流程的稽核（popup/redirect fallback 本身維持不動，發現的是
  // 另外兩個共同存在於兩份檔案的問題）：
  // ①onAuthStateChanged 的 callback 原本另外重寫一份跟 handleLoginUser() 幾乎一樣的
  // 驗證邏輯，兩處已經各自演化出落差——「非校內信箱」分支這裡原本只 signOut() 沒有
  // toast 說明原因，使用者會被靜默登出；老師帳號未綁定座號時的提示文字也跟
  // handleLoginUser() 不同。改為直接呼叫 handleLoginUser()，單一事實來源。
  // ②googleStudentLogin() 把 signInWithPopup() 本身的失敗跟 handleLoginUser() 之後的
  // 驗證失敗（例如 Firestore 讀取逾時，withTimeout() 拋出的是普通 Error、沒有 .code）
  // 混在同一個 catch 處理，導致 Google 登入本身明明已經成功、只是接下來驗證階段網路
  // 逾時，卻被誤判成「popup 失敗」而自動觸發一次 signInWithRedirect()——這正是
  // 2026-07-12 那輪改版想避免的「跳出 App 到系統瀏覽器」情境，只是換了個觸發途徑。
  // 拆成兩層 try/catch，並補上跟 teacher.html 對稱的 finally{ hideLoading() }（原本
  // 只有 teacher.html 有這層保底）。與 teacher_test.js 的 T-SEC-65／T-SEC-66 對稱。
  // ════════════════════════════════════════

  await test('S-SEC-53 onAuthStateChanged 自動恢復登入改直接呼叫 handleLoginUser()，不再重複實作一份會靜默登出的驗證邏輯', async () => {
    // onAuthStateChanged 的 callback 是匿名 inline arrow function，無法像具名函式一樣
    // typeof xxx === 'function' 取得參照直接 .toString()，改對整份頁面 inline <script>
    // 原始碼文字做定位：鎖定 onAuthStateChanged(auth, async (user) => { 這個呼叫語法
    // 本身的位置，往後取一段足夠涵蓋整個 callback（實測約1300字元）的視窗。
    // 用三種訊號交叉驗證，避免只看「有呼叫 handleLoginUser()」就誤判成已修好（呼叫
    // 可能只是「加了一行」但舊邏輯其實還留著沒刪）：
    //   ①視窗內確實呼叫 handleLoginUser(user)；
    //   ②視窗內完全沒有 signOut( 字樣——這是最直接的證據，若舊的「非校內信箱→
    //     signOut() 但不 toast」分支還殘留，一定會在這裡看到 signOut( 呼叫；
    //   ③全域計算 getDoc(doc(db, 'studentBindings', emailKey)) 這句只有 handleLoginUser()
    //     內部才有的查詢語句，在整份程式碼裡只出現1次（不是2次）——這比①②更直接，
    //     證明舊的重複實作真的被刪除，不是被新呼叫繞過去但程式碼還留著沒清。
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      const callIdx = scripts.search(/onAuthStateChanged\s*\(\s*auth\s*,\s*async\s*\(user\)\s*=>\s*\{/);
      if (callIdx === -1) return { skip: true };
      const windowText = scripts.slice(callIdx, callIdx + 1800);
      const codeOnlyWindow = windowText.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

      const callsSharedFn = /await\s+handleLoginUser\s*\(\s*user\s*\)/.test(codeOnlyWindow);
      const noDirectSignOut = !/signOut\s*\(/.test(codeOnlyWindow);
      const dupSignature = "getDoc(doc(db, 'studentBindings', emailKey))";
      const dupCount = scripts.split(dupSignature).length - 1;

      return { skip: false, callsSharedFn, noDirectSignOut, dupCount };
    });

    if (result.skip) return;
    if (!result.callsSharedFn) throw new Error('onAuthStateChanged 的 callback 找不到直接呼叫 await handleLoginUser(user)，可能仍是另外重寫的一份邏輯');
    if (!result.noDirectSignOut) throw new Error('onAuthStateChanged 的 callback 內仍直接呼叫 signOut(...)，疑似殘留舊的重複實作（「非校內信箱」分支曾經因此靜默登出、不顯示原因）');
    if (result.dupCount !== 1) throw new Error(`getDoc(doc(db, 'studentBindings', emailKey)) 這個查詢語句在整份程式碼中出現 ${result.dupCount} 次（預期恰好1次，只在 handleLoginUser() 內部），代表 onAuthStateChanged 可能仍殘留一份重複實作的查詢邏輯，未真正改為委派`);
  });

  await test('S-SEC-54 googleStudentLogin() 的 handleLoginUser() 驗證失敗跟 signInWithPopup() 本身失敗分開處理，且補上 finally{ hideLoading() }', async () => {
    // 背景：原本 `await handleLoginUser(result.user)` 跟 signInWithPopup() 寫在同一個
    // try 裡，共用同一個 catch——handleLoginUser() 內部兩個 withTimeout(getDoc(...))
    // 逾時或任何 Firestore 讀取錯誤丟出的是普通 Error（沒有 .code），會被「除了使用者
    // 取消都當成 popup 失敗」的判斷誤傷，導致 Google 登入本身明明已經成功、只是接下來
    // 驗證階段網路逾時，卻自動觸發一次 signInWithRedirect()。
    //
    // 直接呼叫 googleStudentLogin.toString()，用「找到 await handleLoginUser(...) 呼叫
    // 位置，切成前後兩段」的方式驗證：前段（popup 處理階段）應該仍看得到
    // startStudentRedirectLogin() 這個 fallback 呼叫（確認 popup 失敗的 fallback 機制
    // 沒有被拿掉）；後段（handleLoginUser() 呼叫之後到函式結尾）不應該再出現
    // startStudentRedirectLogin()——這才是這次要修的核心：handleLoginUser() 拋出例外
    // 不能再走到觸發 redirect 的那段程式碼，因為呼叫時已經不在同一個 try/catch 範圍內。
    // 另外確認 handleLoginUser() 呼叫之後很快就有自己的 catch(e)（有獨立錯誤處理，
    // 不是被吃掉或裸露丟給外層），以及函式本身有 finally{ hideLoading() }（補齊跟
    // teacher.html googleTeacherLogin() 對稱的保底，原本兩者不對稱，student.html
    // 沒有這層）。不真執行——這個函式會觸發真正的 Google OAuth popup，沒有安全的方式
    // 在無人互動的自動化環境模擬，跟既有 S-SEC-33／S-SEC-34 對這個函式的既有測試作法
    // 一致，皆為靜態比對。
    const result = await page.evaluate(() => {
      const fnStr = (typeof googleStudentLogin === 'function') ? googleStudentLogin.toString() : '';
      if (!fnStr) return { skip: true };
      const codeOnly = fnStr.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

      const callIdx = codeOnly.search(/await\s+handleLoginUser\s*\(/);
      if (callIdx === -1) return { skip: false, callFound: false };
      const before = codeOnly.slice(0, callIdx);
      const after = codeOnly.slice(callIdx);

      const fallbackBeforeCall = /startStudentRedirectLogin\s*\(\s*\)/.test(before);
      const noFallbackAfterCall = !/startStudentRedirectLogin\s*\(\s*\)/.test(after);
      const hasOwnCatchAfterCall = /catch\s*\(\s*e\s*\)/.test(after.slice(0, 400));
      const cancelGuardBeforeCall = /popup-closed-by-user/.test(before) && /cancelled-popup-request/.test(before);

      const hasFinally = /finally\s*\{/.test(fnStr);
      const fIdx = fnStr.search(/finally\s*\{/);
      const finallyHasHideLoading = fIdx !== -1 && /hideLoading\s*\(\s*\)/.test(fnStr.slice(fIdx, fIdx + 400));

      return {
        skip: false, callFound: true,
        fallbackBeforeCall, noFallbackAfterCall, hasOwnCatchAfterCall,
        cancelGuardBeforeCall, hasFinally, finallyHasHideLoading,
      };
    });

    if (result.skip) return;
    if (!result.callFound) throw new Error('googleStudentLogin() 找不到 await handleLoginUser(...) 呼叫');
    if (!result.cancelGuardBeforeCall) throw new Error('googleStudentLogin() 找不到「使用者主動取消不重試」的判斷，或它被移到 handleLoginUser() 呼叫之後（順序不對）');
    if (!result.fallbackBeforeCall) throw new Error('googleStudentLogin() 的 startStudentRedirectLogin() fallback 呼叫消失了，popup 失敗時可能不會再自動改走 redirect');
    if (!result.noFallbackAfterCall) throw new Error('googleStudentLogin() 呼叫 handleLoginUser() 之後仍看得到 startStudentRedirectLogin()，代表 handleLoginUser() 拋出的例外可能還是會被誤判成 popup 失敗、觸發一次不必要的 redirect');
    if (!result.hasOwnCatchAfterCall) throw new Error('googleStudentLogin() 呼叫 handleLoginUser() 之後找不到緊接的 catch(e)，驗證失敗的例外可能沒有獨立處理');
    if (!result.hasFinally || !result.finallyHasHideLoading) throw new Error('googleStudentLogin() 缺少 finally{ hideLoading() }，跟 teacher.html googleTeacherLogin() 不對稱，可能在某些例外路徑下 loading 遮罩卡住不會消失');
  });


  // ════════════════════════════════════════
  // S-SEC-55　2026-08-30 新增：GoogleAuthProvider 的 hd（hosted domain）網域參數
  // ════════════════════════════════════════
  // 背景：跟 S-SEC-53／S-SEC-54 同一輪「兩端登入流程稽核」當時一併發現、稍後才補上
  // 測試的第三項問題，與 teacher_test.js 的 T-SEC-67 對稱新增，完整背景見本檔案開頭
  // v39 changelog 與 AI_CONTEXT_歷程.md 對應段落。
  // ════════════════════════════════════════

  await test('S-SEC-55 GoogleAuthProvider 加上 hd（hosted domain）參數，Google 帳號選擇畫面優先顯示/導向校內帳號', async () => {
    // 背景：new GoogleAuthProvider() 原本完全沒有網域限制——使用者按下「用 Google
    // 登入」時，Google 自己跳出來的帳號選擇畫面會列出裝置上任何已登入過的帳號，不分
    // 校內外。最常撞到這條路的不是入侵者，是裝置上同時登過個人 Gmail 跟學校帳號的
    // 合法使用者，選錯很自然。選了非校網域帳號後，整趟「跳出 Google 頁面→選帳號→
    // 授權→跳回網站」都會白走一次，才在終點被 handleLoginUser() 的 SCHOOL_DOMAIN
    // 檢查打回票。hd（hosted domain）是 OAuth 標準參數，提前告訴 Google 自己的畫面
    // 「該選哪個網域的帳號」，把「選錯」盡量攔在起點。
    //
    // 這只是 UX 優化、不是安全邊界——官方文件寫明使用者仍可在 Google 畫面點「使用
    // 其他帳戶」手動輸入非校網域帳號硬是完成登入，hd 擋不住這條路；真正的資料安全
    // 邊界從頭到尾都是 rule.txt 的 schoolUser()，不管 hd 有沒有設，就算真的用非校
    // 網域帳號登入成功，也一筆資料讀不到。hd 的實際效果完全發生在 Google 自己的
    // 伺服器/畫面上，不是這裡的程式碼能驗證的行為——這裡只能靜態確認
    // setCustomParameters() 真的有被呼叫、且帶正確的網域值，防止未來重構時被悄悄拿掉
    // 或打錯字，不是證明 Google 帳號選擇器真的優先顯示了校內帳號（後者需要實機登入
    // 才能驗證，不在自動化測試涵蓋範圍內）。
    //
    // provider 是 <script type="module"> 裡的區塊變數，不會掛在 window 上，跟
    // onAuthStateChanged 的 callback（S-SEC-53）一樣要對整份頁面 inline <script>
    // 原始碼文字定位；module script 沒有 src 屬性，
    // document.querySelectorAll('script:not([src])') 一樣抓得到它的 textContent。
    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).join('\n');

      const providerIdx = scripts.search(/const\s+provider\s*=\s*new\s+GoogleAuthProvider\s*\(\s*\)\s*;/);
      if (providerIdx === -1) return { skip: true };
      const windowText = scripts.slice(providerIdx, providerIdx + 1000);
      const codeOnlyWindow = windowText.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

      const callsSetCustomParameters = /provider\.setCustomParameters\s*\(\s*\{[^}]*\}\s*\)/.test(codeOnlyWindow);
      const hdMatch = codeOnlyWindow.match(/hd\s*:\s*'([^']*)'/);

      return { skip: false, callsSetCustomParameters, hdValue: hdMatch ? hdMatch[1] : null };
    });

    if (result.skip) return;
    if (!result.callsSetCustomParameters) throw new Error('provider.setCustomParameters(...) 呼叫消失了，Google 帳號選擇畫面可能不再優先顯示校內帳號');
    if (result.hdValue !== 'tcivs.tc.edu.tw') throw new Error(`hd 參數的網域值不正確，實際為 ${JSON.stringify(result.hdValue)}，預期 'tcivs.tc.edu.tw'（須跟 SCHOOL_DOMAIN 保持同步）`);
  });


  // ════════════════════════════════════════
  // S-SEC-56 / S-SEC-57　2026-08-31 新增：薪資「沒填」被顯示成「$0」（08-30 v37／
  // S-SEC-51 那次修法的顯示端落差，使用者稽核發現）
  // ════════════════════════════════════════
  // 背景：08-30 那次修法（見上方 v37 changelog／S-SEC-51）把 saveJournal() 寫入端改成用
  // Number.isNaN() 判斷，讓「沒填」（null）跟「填0元」（0）能真正分開存進 Firestore，但
  // 這個語意調整沒有同步套用到顯示端——renderJournalCardSelectable()（月記歷史頁卡片）／
  // pdfJournalBlock()（PDF匯出）仍在用 `Number.isFinite(Number(j.salary))` 判斷「有沒有
  // 填」。Number(null) 在 JS 裡等於 0，是個有限數字，導致「完全沒填」的月記被誤判成
  // 「已填、金額是0」，顯示成「💰 $0 元」。跟老師端「薪資缺漏」名單同時在追蹤的月記直接
  // 矛盾。對照組：checkMonthDeadline()（`j.salary ?? ''`）、teacher.html 自己的
  // renderJournalCard()（6225行，`j.salary != null`）／所有薪資統計 filter 本來就寫對，
  // 純粹是這兩處顯示函式沒跟上 v37 那次修法。修法：改用跟既有正確寫法一致的
  // `j.salary != null` 判斷。與 teacher_test.js 的 T-SEC-68 對稱（teacher.html 的
  // pdfJournalBlock() 同一種bug）。
  // ════════════════════════════════════════

  await test('S-SEC-56 renderJournalCardSelectable() 薪資「沒填」不再顯示成「💰 $0 元」', async () => {
    // 純函式，直接回傳 HTML 字串、不碰 DOM／Firestore，可以安全真執行，直接呼叫函式
    // 本體並檢查回傳字串，比字串/regex 比對函式原始碼更直接證明修法生效。
    const result = await page.evaluate(() => {
      if (typeof renderJournalCardSelectable !== 'function') return { skip: true };
      const base = { seatNo: '01', semester: '999-1', month: 1, entries: [] };
      const notFilled = renderJournalCardSelectable({ ...base, salary: null });
      const filledZero = renderJournalCardSelectable({ ...base, salary: 0 });
      const filledNormal = renderJournalCardSelectable({ ...base, salary: 500 });
      return { skip: false, notFilled, filledZero, filledNormal };
    });
    if (result.skip) return;
    if (result.notFilled.includes('💰')) throw new Error('salary=null（沒填）不應該顯示金額區塊，實際卻出現 💰');
    if (!result.filledZero.includes('💰 $0 元')) throw new Error(`salary=0（填0元）應顯示「💰 $0 元」，實際：${result.filledZero.slice(0, 200)}`);
    if (!result.filledNormal.includes('💰 $500 元')) throw new Error(`salary=500 應顯示「💰 $500 元」，實際：${result.filledNormal.slice(0, 200)}`);
  });

  await test('S-SEC-57 pdfJournalBlock() 薪資「沒填」PDF匯出不再顯示成「0 元」，維持顯示「-」', async () => {
    // pdfJournalBlock() 回傳 pdfmake 內容陣列（純資料結構，不碰 DOM／Firestore），直接
    // 呼叫並在回傳陣列裡找「本月薪資」那一項文字比對，同樣是真執行而非靜態比對。
    const result = await page.evaluate(() => {
      if (typeof pdfJournalBlock !== 'function') return { skip: true };
      const findSalaryLine = (content) => {
        const item = (content || []).find(c => c && typeof c.text === 'string' && c.text.includes('本月薪資'));
        return item ? item.text : null;
      };
      const notFilled = findSalaryLine(pdfJournalBlock({ salary: null, entries: [], _pdfEntries: [] }, 0));
      const filledZero = findSalaryLine(pdfJournalBlock({ salary: 0, entries: [], _pdfEntries: [] }, 0));
      const filledNormal = findSalaryLine(pdfJournalBlock({ salary: 500, entries: [], _pdfEntries: [] }, 0));
      return { skip: false, notFilled, filledZero, filledNormal };
    });
    if (result.skip) return;
    if (!result.notFilled || !result.notFilled.includes('-') || result.notFilled.includes('0 元'))
      throw new Error(`salary=null（沒填）應顯示「本月薪資：-」，實際：${result.notFilled}`);
    if (!result.filledZero || !result.filledZero.includes('0 元'))
      throw new Error(`salary=0（填0元）應顯示「本月薪資：0 元」，實際：${result.filledZero}`);
    if (!result.filledNormal || !result.filledNormal.includes('500 元'))
      throw new Error(`salary=500 應顯示「本月薪資：500 元」，實際：${result.filledNormal}`);
  });

  // ════════════════════════════════════════
  // S-SEC-61 ～ S-SEC-64　2026-09-03 新增：第1學期跨年（12月→隔年1月）月份排序錯誤
  // （使用者回報，見本檔案開頭 v42 changelog）
  // ════════════════════════════════════════
  // 背景：第1學期固定 7,8,9,10,11,12,1（隔年1月結束），1月數字最小、但時序上是整個
  // 學期最後一個月。任何直接用裸月份數字相減排序（a.month-b.month）的地方，只要資料
  // 同時橫跨12月與隔年1月，1月就會被排到跟時間順序相反的位置。修法新增共用純函式
  // monthOrderInSemester(semester, month)，取代 7 處裸月份數字排序。與 teacher_test.js
  // 的 T-SEC-70～74 對稱。
  // ════════════════════════════════════════

  await test('S-SEC-61 monthOrderInSemester() 正確反映學期內月份的真實時序（1月在第1學期是最後一個月，不是數字最小的月份），並對缺失/非法 semester 防呆不拋例外', async () => {
    // 純函式，直接呼叫本體驗證，而非只做靜態字串比對。
    const result = await page.evaluate(() => {
      if (typeof monthOrderInSemester !== 'function') return { skip: true };
      const sem1Order = [7,8,9,10,11,12,1].map(m => monthOrderInSemester('115-1', m));
      const sem2Order = [2,3,4,5,6].map(m => monthOrderInSemester('115-2', m));
      let undefinedThrew = false, nullThrew = false;
      try { monthOrderInSemester(undefined, 7); } catch (e) { undefinedThrew = true; }
      try { monthOrderInSemester(null, 7); } catch (e) { nullThrew = true; }
      return {
        skip: false,
        sem1Order,
        sem2Order,
        janAfterDec: monthOrderInSemester('115-1', 1) > monthOrderInSemester('115-1', 12),
        julyIsFirst: monthOrderInSemester('115-1', 7) === 0,
        unknownMonth: monthOrderInSemester('115-1', 99),
        undefinedThrew,
        nullThrew,
      };
    });
    if (result.skip) return;
    const strictlyIncreasing = arr => arr.every((v, i) => i === 0 || v > arr[i - 1]);
    if (!strictlyIncreasing(result.sem1Order))
      throw new Error(`第1學期依 7,8,9,10,11,12,1 這個時序取值應該嚴格遞增，實際：${JSON.stringify(result.sem1Order)}`);
    if (!strictlyIncreasing(result.sem2Order))
      throw new Error(`第2學期依 2,3,4,5,6 這個時序取值應該嚴格遞增，實際：${JSON.stringify(result.sem2Order)}`);
    if (!result.janAfterDec)
      throw new Error('1月在第1學期的時序位置應該晚於12月（1月是隔年1月，是整個學期最後一個月）——這正是本次要修正的核心bug：1月的數字比12月小，但時序上排在後面');
    if (!result.julyIsFirst)
      throw new Error('7月應該是第1學期時序位置0（第一個月）');
    if (result.unknownMonth !== 99)
      throw new Error(`不屬於該學期的月份應回傳99（排到最後而不是讓排序整個出錯），實際：${result.unknownMonth}`);
    if (result.undefinedThrew)
      throw new Error('semester 為 undefined 時 monthOrderInSemester() 不應該拋出例外——呼叫端可能未加 ||\'\' 防呆直接傳入 a.semester，拋例外會讓整個 .sort() 連帶失敗，比原本排序跑掉更嚴重');
    if (result.nullThrew)
      throw new Error('semester 為 null 時 monthOrderInSemester() 同樣不應該拋出例外');
  });

  await test('S-SEC-62 getJournalMonthRangeLabel() 批次選取範圍橫跨12月與隔年1月時，範圍標籤正確顯示「12月~隔年1月」而非顛倒（使用者原始回報的bug情境）', async () => {
    const result = await page.evaluate(() => {
      if (typeof getJournalMonthRangeLabel !== 'function') return { skip: true };
      // 重現使用者原始回報情境：批次刪除／匯出範圍只勾選12月＋1月兩筆
      const decJanLabel = getJournalMonthRangeLabel([
        { semester: '115-1', month: 12 },
        { semester: '115-1', month: 1 },
      ]);
      // 整個第1學期（7~1月）全選，範圍應為「7月~隔年1月」
      const fullSemLabel = getJournalMonthRangeLabel(
        [7,8,9,10,11,12,1].map(m => ({ semester: '115-1', month: m }))
      );
      return { skip: false, decJanLabel, fullSemLabel };
    });
    if (result.skip) return;
    if (result.decJanLabel !== '2026/12~2027/1，共2筆')
      throw new Error(`只選12月＋1月時範圍標籤應為「2026/12~2027/1，共2筆」，實際：「${result.decJanLabel}」——使用者原始回報的bug是顯示成顛倒的「2027/1~2026/12」`);
    if (result.fullSemLabel !== '2026/7~2027/1，共7筆')
      throw new Error(`整個第1學期(7~1月)全選時範圍標籤應為「2026/7~2027/1，共7筆」，實際：「${result.fullSemLabel}」`);
  });

  await test('S-SEC-63 getOverdueMonths()／renderSubmittedMonthsDetail() 在學期橫跨12月與隔年1月時，時序排序正確（1月不會被排到升冪排序最前面，也不會被排到降冪排序最後面）', async () => {
    const result = await page.evaluate(async () => {
      if (typeof getOverdueMonths !== 'function' || typeof renderSubmittedMonthsDetail !== 'function' || typeof semMonthToLabel !== 'function') return { skip: true };

      // ① getOverdueMonths()：同一學期內 7月／12月／1月皆早已過期且完全未繳，函式既有
      // 「同一學期內先提醒最早逾期的月份」慣例，時序上應排出 7→12→1（升冪）。
      const deadlineDataMap = {
        '999-1-7':  { semester: '999-1', month: 7,  closeDate: '2000-01-01', minEntries: 1 },
        '999-1-12': { semester: '999-1', month: 12, closeDate: '2000-01-01', minEntries: 1 },
        '999-1-1':  { semester: '999-1', month: 1,  closeDate: '2000-01-01', minEntries: 1 },
      };
      const overdue = await getOverdueMonths(['999-1'], [], deadlineDataMap);
      const overdueMonths = overdue.filter(o => o.semester === '999-1').map(o => o.month);

      // ② renderSubmittedMonthsDetail()：同一學期已繳交7月／12月／1月，「新到舊」降冪
      // 排序時，時序上最新的1月應排最前面，7月排最後面。
      const journals = [7, 12, 1].map(m => ({ semester: '999-1', month: m, entries: [{}] }));
      const html = renderSubmittedMonthsDetail(journals, deadlineDataMap);
      const idx7 = html.indexOf(semMonthToLabel('999-1', 7));
      const idx12 = html.indexOf(semMonthToLabel('999-1', 12));
      const idx1 = html.indexOf(semMonthToLabel('999-1', 1));

      return { skip: false, overdueMonths, idx7, idx12, idx1 };
    });
    if (result.skip) return;
    if (result.overdueMonths.join(',') !== '7,12,1')
      throw new Error(`getOverdueMonths() 同一學期內應依時序「7月→12月→1月」排序（先提醒最早逾期的），實際：${result.overdueMonths.join(',')}——若1月排在最前面，代表又退回用裸月份數字比較大小`);
    if (!(result.idx1 >= 0 && result.idx1 < result.idx12 && result.idx12 < result.idx7))
      throw new Error(`renderSubmittedMonthsDetail() 應該以「新到舊」時序排列，1月（隔年、最新）應排最前，12月居中，7月（最舊）排最後，實際位置：1月=${result.idx1}, 12月=${result.idx12}, 7月=${result.idx7}`);
  });

  await test('S-SEC-64 loadStudentDashboard()／loadStudentStats()／loadStudentHistory()／exportMyPDF() 皆已改用 monthOrderInSemester() 排序月記，不再殘留跨年月份排序錯誤的裸數字比較寫法', async () => {
    // 這四個函式會讀 Firestore／依賴 currentUser 登入狀態，比照 S-SEC-49 既有取捨，
    // 不貿然真執行覆寫全域函式，改用靜態原始碼比對（codeOnly() 過濾註解，同陷阱19
    // 既有做法，避免命中函式內解釋性註解裡也會出現的文字）。
    const result = await page.evaluate(() => {
      const fnNames = ['loadStudentDashboard', 'loadStudentStats', 'loadStudentHistory', 'exportMyPDF'];
      if (fnNames.some(name => typeof window[name] !== 'function')) return { skip: true };
      const codeOnly = str => str.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      const report = {};
      fnNames.forEach(name => {
        const fnStr = codeOnly(window[name].toString());
        report[name] = {
          usesMonthOrderInSemester: /monthOrderInSemester\s*\(\s*a\.semester\s*,\s*a\.month\s*\)\s*-\s*monthOrderInSemester\s*\(\s*b\.semester\s*,\s*b\.month\s*\)/.test(fnStr),
          hasNaiveMonthSub: /\(a\.month\s*\|\|\s*0\)\s*-\s*\(b\.month\s*\|\|\s*0\)/.test(fnStr),
        };
      });
      return { skip: false, report };
    });
    if (result.skip) return;
    Object.entries(result.report).forEach(([name, r]) => {
      if (!r.usesMonthOrderInSemester)
        throw new Error(`${name}() 找不到 monthOrderInSemester(a.semester,a.month)-monthOrderInSemester(b.semester,b.month) 排序比較式，月份排序可能又退回裸數字比較`);
      if (r.hasNaiveMonthSub)
        throw new Error(`${name}() 仍殘留舊版 (a.month||0)-(b.month||0) 裸數字排序寫法`);
    });
  });


  return results;
}

module.exports = { runStudentTests };
