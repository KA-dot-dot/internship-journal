/**
 * tests/teacher.test.js
 * 老師端自動化測試 v15
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-06-30）
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

  await test('T-SEC-24 _openCommentModalWithUid() oldComment 設定前做身份比對（防快速切換導致 commentChanged 基準錯誤）', async () => {
    // 2026-06-29 補修的回歸測試。
    // 若老師在前一個 getDoc 尚未完成時快速點開另一筆月記的評語按鈕，
    // _currentCommentJournal 會被覆寫成新月記，但較早的 .then() 若不先比對
    // seatNo/semester/month 三欄，會對「已是新月記的 _currentCommentJournal」
    // 設定舊的 oldComment，使 commentChanged 計算基準錯誤，
    // 造成 teacherCommentUpdated 旗標誤判（State 1/2 顯示錯誤）。
    const result = await page.evaluate(() => {
      const fnStr = (typeof _openCommentModalWithUid === 'function')
        ? _openCommentModalWithUid.toString() : '';
      if (!fnStr) return { skip: true };

      // 特徵 1：設定 oldComment 前有 seatNo 身份比對
      const hasSeatNoCheck  = fnStr.includes('_currentCommentJournal.seatNo === seatNo');
      // 特徵 2：設定 oldComment 前有 semester 身份比對
      const hasSemesterCheck = fnStr.includes('_currentCommentJournal.semester === semester');
      // 特徵 3：設定 oldComment 前有 month 身份比對
      const hasMonthCheck   = fnStr.includes('_currentCommentJournal.month === month');

      return { skip: false, hasSeatNoCheck, hasSemesterCheck, hasMonthCheck };
    });

    if (result.skip) return;
    if (!result.hasSeatNoCheck)
      throw new Error(
        '_openCommentModalWithUid() 缺少 _currentCommentJournal.seatNo === seatNo 比對，' +
        '快速切換月記時 oldComment 可能被設成錯誤月記的舊評語，commentChanged 計算基準錯誤'
      );
    if (!result.hasSemesterCheck)
      throw new Error(
        '_openCommentModalWithUid() 缺少 _currentCommentJournal.semester === semester 比對，' +
        'oldComment 身份比對不完整，不同學期的月記切換時有 commentChanged 錯誤風險'
      );
    if (!result.hasMonthCheck)
      throw new Error(
        '_openCommentModalWithUid() 缺少 _currentCommentJournal.month === month 比對，' +
        'oldComment 身份比對不完整，同學期不同月份切換時有 commentChanged 錯誤風險'
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
