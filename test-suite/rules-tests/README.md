# Layer 1：Firestore Rules 單元測試（Emulator）

## 這是什麼

直接針對根目錄的 `rule.txt` 跑窮舉式測試，不需要正式 Firebase 環境、不消耗配額、
不依賴 student.html / teacher.html 有沒有正確呼叫 Firestore——只測規則本身的邏輯。

跟現有 `test-suite/tests/student.test.js` 裡的 S-WRITE-REAL、S-RULES-01~05 是互補關係：

| | 測什麼 | 怎麼測 |
|---|---|---|
| 現有 student.test.js | 正式環境 + 目前程式碼整體串起來是否正常 | 學生帳號 REST 直接打正式 Firebase |
| 這個 rules-tests | rule.txt 本身每個分支是否符合設計意圖 | 本機 emulator，不連正式環境 |

`test-rules.js` 目前涵蓋的情境（約 45 個）：
admins（含 protected 旗標保護）、studentBindings（含學生只能補寫 uid）、
students（新舊格式 docId、無 binding 時不應誤判放行）、journals 子集合的
get/list/create/update/delete（含本次 2026-06-17 那次 bug 的迴歸測試）、
頂層 journals 平面集合、deadlines、settings，以及最後的萬用 catch-all。

## 第一次安裝（每台電腦只需做一次）

### 1. 安裝 Java（Firestore Emulator 依賴 Java 執行，這跟 Node.js 是分開的東西）

打開命令提示字元，輸入 `java -version`。

- 如果顯示版本號 → 已經有了，跳過這步。
- 如果顯示「不是內部或外部命令」→ 到 https://adoptium.net/zh-TW/temurin/releases/
  下載對應 Windows 版本的 JDK（選 17 版即可），安裝時一路下一步就好，安裝完**重開命令提示字元**再測一次 `java -version`。

### 2. 安裝測試套件

```
cd test-suite\rules-tests
npm install
```

第一次執行會順便下載 firebase-tools，需要幾分鐘。

## 之後每次執行

```
cd test-suite\rules-tests
npm test
```

第一次跑 `npm test` 時，emulator 會自動下載 Firestore 模擬器本體（一次性，約幾十 MB，
需要能連到 Google 的伺服器），之後就會用本機快取，不用再下載。

跑完會看到類似這樣的結果：

```
Rules 單元測試結果：45/45 通過，0 失敗
```

如果有失敗，會列出失敗的測試名稱跟原因，對照名稱就能找到是規則的哪個區塊出問題。

## 什麼時候該跑這個

- 每次改完 `rule.txt`，部署前先跑一次，比手動看 diff 可靠。
- 想加新的規則情境（例如以後加新的集合）時，照現有寫法在 `test-rules.js` 加幾個
  `await test('描述', async () => { await assertSucceeds(...) 或 assertFails(...) })`
  就好，不用碰其他檔案。

## 它不能取代什麼

這個測試只驗證「規則邏輯」本身，不會發現「student.html 沒有正確帶欄位」這類前端程式問題
（例如 saveJournal() 忘記帶 teacherComment 欄位）——那要靠 student.test.js 的
S-WRITE-REAL 才能發現。兩套測試都跑，覆蓋面才完整。
