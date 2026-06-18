/**
 * copy-rules.js
 * 每次跑測試前，把專案根目錄最新的 rule.txt 複製成 firestore.rules
 * （Firebase CLI 不允許 firebase.json 的 rules 路徑用 ".." 跳出專案資料夾，
 *   所以無法直接指向 ../../rule.txt，改用這個腳本同步一份本機副本）。
 *
 * firestore.rules 是自動產生的暫存檔，不應手動編輯，也建議加進 .gitignore。
 * 真正要改規則，永遠只改根目錄的 rule.txt。
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'rule.txt');
const dest = path.join(__dirname, 'firestore.rules');

if (!fs.existsSync(src)) {
  console.error('❌ 找不到根目錄的 rule.txt（預期路徑：' + src + '）');
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('✅ 已同步最新 rule.txt → firestore.rules（emulator 測試用）');
