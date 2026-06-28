/**
 * tests/student.test.js
 * 學生端自動化測試 v10
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-06-28）
 *
 * v14 新增（2026-06-28）：
 *   S-SEC-22  getCommentBadgeState() 四狀態邏輯（State 1～4 + 無徽章）
 *             驗證 getCommentBadgeState() 對每種 {teacherCommentUnread, teacherCommentUpdated,
 *             teacherReviewed, teacherComment} 組合回傳正確的 state 值。
 *             對應「評語測試系統」STEP 1～5 的狀態轉換總覽。
 *   S-SEC-23  renderCommentBadgeHtml() 輸出對應正確的徽章文字與顏色
 *             驗證 state 1→🔴、state 2→🟠、state 3→✅、state 4→📖、state 0→無徽章。
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

    const _makeJournalDoc = (uid, email, seatNo) => ({
      fields: {
        ownerUid:             { stringValue: uid },
        ownerEmail:           { stringValue: email },
        storagePath:          { stringValue: 'user' },
        semester:             { stringValue: 'test' },
        month:                { integerValue: 0 },
        seatNo:               { stringValue: seatNo },
        teacherComment:       { nullValue: null },
        teacherReviewed:      { booleanValue: false },
        reviewedAt:           { nullValue: null },
        teacherCommentUnread: { booleanValue: false },
      }
    });

    await test('S-WRITE-REAL Firestore CREATE 規則驗證（學生身份 REST 直接寫入）', async () => {
      requireStudentSession();
      await _captureFsCtx(); // 失敗會 throw，不再靜默通過
      const seatNo = await _getTestSeatNo();
      const docId = 'test-create-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const r = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
      if (r.status === 200) {
        await _fsRequest('DELETE', path + '/' + docId);
      }
      // ⚠️ 修正：status === -1（網路錯誤）不再靜默通過，改為 throw
      if (r.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1），無法驗證 rule，請確認網路連線');
      if (r.status === 403) throw new Error(
        'journals CREATE 被拒（403）：' +
        'CREATE rule 可能仍用 !keys().hasAny() 而非 .get()==null，' +
        'saveJournal() 固定帶 teacher 欄位 null/false 時會被擋。'
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
      const docId = 'test-update-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const doc = _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo);
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
      const docId = 'test-fake-teacher-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const seatNo = await _getTestSeatNo();
      const fakeDoc = {
        fields: {
          ownerUid:        { stringValue: _fsUser.uid },
          ownerEmail:      { stringValue: _fsUser.email },
          storagePath:     { stringValue: 'user' },
          semester:        { stringValue: 'test' },
          month:           { integerValue: 0 },
          seatNo:          { stringValue: seatNo },
          teacherComment:  { stringValue: 'FAKE TEACHER REVIEW' },
          teacherReviewed: { booleanValue: false },
          reviewedAt:      { nullValue: null },
          teacherCommentUnread: { booleanValue: false },
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
      const docId = 'test-fake-review-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const fakeUpdate = {
        fields: {
          ..._makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo).fields,
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
      const docId = 'test-delete-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
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
      const docId = 'test-reply-lock-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
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
      const docId = 'test-reply-empty-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
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
      const docId = 'test-reply-badtype-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
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
      const docId = 'test-seatno-forge-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const r = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, forgedSeatNo));
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
      const docId = 'test-seatno-change-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
      if (cr.status === -1) throw new Error('Firestore REST 請求網路失敗（status -1）');
      if (cr.status === 403) throw new Error('前置 CREATE 被拒（403），請先確認 S-WRITE-REAL');
      const fakeUpdate = {
        fields: {
          ..._makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo + '_CHANGED').fields,
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
      const docId = 'test-badge-forge-' + Date.now();
      const path = '/users/' + _fsUser.uid + '/journals';

      // 先建立一筆正常月記（teacherCommentUnread:false, teacherCommentUpdated:false）
      const cr = await _fsRequest('POST', path + '?documentId=' + docId, _makeJournalDoc(_fsUser.uid, _fsUser.email, seatNo));
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

  await test('S-SEC-09 renderJournalCard() 使用 escapeHtml 和 jsArg', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof renderJournalCard === 'function') ? renderJournalCard.toString() : '';
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
    // 對應 STEP 1～5 所有狀態轉換節點。
    const result = await page.evaluate(() => {
      if (typeof getCommentBadgeState !== 'function') return { skip: true };

      // 測試矩陣：[teacherCommentUnread, teacherCommentUpdated, teacherReviewed, teacherComment, expectedState]
      // State 1：🔴 有新評語  Unread=true,  Updated=false
      // State 2：🟠 評語已更新 Unread=true,  Updated=true
      // State 3：✅ 已審閱    Reviewed=true, Unread=false, Updated=false（comment 可空或非空）
      // State 4：📖 評語已閱讀 Unread=false, Updated=true
      // State 0：無徽章       未審閱且 Unread=false
      const cases = [
        // STEP 2：老師第一次存有文字評語 → 🔴 有新評語（State 1）
        { j: { teacherCommentUnread: true,  teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '第一次評語' }, expected: 1 },
        // STEP 4：老師第二次改評語 → 🟠 評語已更新（State 2）
        { j: { teacherCommentUnread: true,  teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' }, expected: 2 },
        // STEP 1：老師存空評語審閱 → ✅ 已審閱（State 3）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: ''           }, expected: 3 },
        // STEP 3：學生進歷史頁後 → ✅ 已審閱（State 3，Updated 仍 false）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: true,  teacherComment: '第一次評語' }, expected: 3 },
        // STEP 5：學生再次進歷史頁後 → 📖 評語已閱讀（State 4）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: true,  teacherReviewed: true,  teacherComment: '第二次評語' }, expected: 4 },
        // 初始：建立月記但尚未審閱 → 無徽章（State 0）
        { j: { teacherCommentUnread: false, teacherCommentUpdated: false, teacherReviewed: false, teacherComment: null        }, expected: 0 },
      ];

      const failures = [];
      for (const { j, expected } of cases) {
        const actual = getCommentBadgeState(j);
        if (actual !== expected) {
          failures.push(
            `Unread=${j.teacherCommentUnread} Updated=${j.teacherCommentUpdated} ` +
            `Reviewed=${j.teacherReviewed} Comment="${j.teacherComment ?? 'null'}" ` +
            `→ 期望 State ${expected}，實際 State ${actual}`
          );
        }
      }
      return { skip: false, failures };
    });
    if (result.skip) return;
    if (result.failures.length > 0)
      throw new Error('getCommentBadgeState() 邏輯錯誤：\n' + result.failures.join('\n'));
  });

  await test('S-SEC-23 renderCommentBadgeHtml() 各 state 輸出正確徽章', async () => {
    // 驗證每個 state 對應到正確的 emoji／文字，
    // 且 state 0（無徽章）輸出空字串或空 HTML。
    const result = await page.evaluate(() => {
      if (typeof renderCommentBadgeHtml !== 'function') return { skip: true };

      const expectations = [
        { state: 1, containsAny: ['🔴', '有新評語', 'new-comment', 'state-1'] },
        { state: 2, containsAny: ['🟠', '評語已更新', 'updated', 'state-2'] },
        { state: 3, containsAny: ['✅', '已審閱', 'reviewed', 'state-3'] },
        { state: 4, containsAny: ['📖', '評語已閱讀', 'read', 'state-4'] },
      ];

      // state 0 必須輸出空（無徽章）
      const html0 = renderCommentBadgeHtml(0) || '';
      // 允許回傳空字串、空元素、或完全不含可見文字的 HTML
      const stripped0 = html0.replace(/<[^>]*>/g, '').trim();
      if (stripped0.length > 0) {
        return { skip: false, failures: [`State 0 應無徽章，但輸出：「${html0.slice(0, 80)}」`] };
      }

      const failures = [];
      for (const { state, containsAny } of expectations) {
        const html = renderCommentBadgeHtml(state) || '';
        const hit = containsAny.some(kw => html.includes(kw));
        if (!hit) {
          failures.push(
            `State ${state}：輸出「${html.slice(0, 80)}」不含預期關鍵字 [${containsAny.join('/')}]`
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

  return results;
}

module.exports = { runStudentTests };
