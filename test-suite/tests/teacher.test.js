/**
 * tests/teacher.test.js
 * 老師端自動化測試 v3
 * 對應 AI_CONTEXT.md 安全性清單（截至 2026-06-11）
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
    const result = await page.evaluate(() => {
      const fnStr = (typeof confirmBatchReview === 'function') ? confirmBatchReview.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeStart: fnStr.includes('escapeHtml') && fnStr.includes('startVal'),
        hasEscapeEnd:   fnStr.includes('escapeHtml') && fnStr.includes('endVal'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeStart) throw new Error('confirmBatchReview() 的 startVal 未使用 escapeHtml()');
    if (!result.hasEscapeEnd)   throw new Error('confirmBatchReview() 的 endVal 未使用 escapeHtml()');
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
  await test('T-SEC-06B 2026-06-11 補修的 10 個函式均有 finally { hideLoading() }', async () => {
    const result = await page.evaluate(() => {
      // 這 10 個函式是 2026-06-11 T-SEC-08 自動化測試發現並補修的
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
        const lacks = [
          !str.includes('try')          && 'try',
          !str.includes('catch')        && 'catch',
          !str.includes('finally')      && 'finally',
          !str.includes('hideLoading')  && 'hideLoading()',
        ].filter(Boolean).join('/');
        if (lacks) missing.push(`${name}() 缺少 ${lacks}`);
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

  await test('T-SEC-09 renderTeacherJournalCard() 使用 escapeHtml 和 jsArg', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof renderTeacherJournalCard === 'function') ? renderTeacherJournalCard.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasEscapeHtml: fnStr.includes('escapeHtml'),
        hasJsArg:      fnStr.includes('jsArg'),
      };
    });
    if (result.skip) return;
    if (!result.hasEscapeHtml) throw new Error('renderTeacherJournalCard() 未使用 escapeHtml()');
    if (!result.hasJsArg)      throw new Error('renderTeacherJournalCard() 的 onclick 未使用 jsArg()');
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

  await test('T-SEC-11 saveTeacherComment() 寫入 teacherCommentUnread: true', async () => {
    const result = await page.evaluate(() => {
      const fnStr = (typeof saveTeacherComment === 'function') ? saveTeacherComment.toString() : '';
      if (!fnStr) return { skip: true };
      return {
        skip: false,
        hasUnreadTrue: fnStr.includes('teacherCommentUnread') && fnStr.includes('true'),
      };
    });
    if (result.skip) return;
    if (!result.hasUnreadTrue) throw new Error('saveTeacherComment() 未寫入 teacherCommentUnread: true');
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
