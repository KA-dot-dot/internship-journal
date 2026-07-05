// fcm-sw.js
// 專門處理 Web Push 背景通知，跟主要的 sw.js（PWA 離線快取邏輯）完全分開、
// 各自獨立註冊在不同 scope（見 student.html / teacher.html 的
// initPushNotifications()：scope 設為 './firebase-cloud-messaging-push-scope'）。
// 這支檔案完全不碰 BYPASS_DOMAINS、cache-first/network-first 那套邏輯，
// 不會影響 sw.js 既有的任何行為。

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// 跟 student.html / teacher.html 用同一份 firebaseConfig（Firebase Web API Key
// 本來就是公開的，安全性靠 Firestore Rules 把關，不是靠隱藏這組設定值）。
firebase.initializeApp({
  apiKey: "AIzaSyCuKnKaXNYAEU93rqQvfMsaJR6OuEIJMwI",
  authDomain: "project-4256549712592005708.firebaseapp.com",
  projectId: "project-4256549712592005708",
  storageBucket: "project-4256549712592005708.firebasestorage.app",
  messagingSenderId: "501835005211",
  appId: "1:501835005211:web:4a415978a06b860d4727be"
});

const messaging = firebase.messaging();

// 2026-07-06 新增：讓這支 Service Worker 每次更新後立刻生效，不用等舊分頁全部關閉。
// 沒有這兩行時，瀏覽器預設行為是「新版檔案上傳了，但只要還有分頁被舊版控制著，
// 新版就卡在 waiting 狀態，永遠不會真的接手」——這正是這次追查「加了 tag 防重複，
// 畫面上還是兩則」查到的根本原因：瀏覽器背景其實還在跑更早之前、還沒有 tag 防護
// 的舊版本。skipWaiting() 讓這支 SW 一安裝完就直接進入 activate，不用等待；
// clients.claim() 讓它啟用後立刻接管所有已開啟的分頁，不用重新整理頁面。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// App 沒開著（背景）時收到推播，顯示系統通知
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '產學班實習月記系統';
  const options = {
    body: payload.notification?.body || '',
    // 2026-07 修正：跟 initPushNotifications() 註冊路徑同一類問題——這個站在 GitHub Pages
    // 的 /internship-journal/ 子路徑下，Service Worker 裡的相對路徑是相對於「這支 SW 檔案
    // 自己的網址」解析（此檔已改用 './fcm-sw.js' 註冊，實際網址在子路徑下），所以這裡改成
    // 不帶開頭斜線的相對路徑，才能正確抓到 .../internship-journal/icon-192.png。
    icon: './icon-192.png',
    badge: './icon-192.png',
    // fcmOptions?.link／data?.link 平常都會由發送端（notify-service）帶完整網址過來；
    // 這裡的 './' 只是兩者都缺失時的保底預設值，資向這支 SW 檔案所在的子路徑本身，
    // 不會是「跳回不相干的網域根目錄」。
    data: { link: payload.fcmOptions?.link || payload.data?.link || './' },
    // 2026-07-05 新增：修正同一則通知在裝置上重複顯示兩次的問題。
    // 根本原因是 Web Push 協定本身「至少送達一次」的特性——同一則推播底層被重複投遞
    // （網路不穩、瀏覽器背景程序重啟等都可能觸發）本身是規格層級的正常現象，不是後端
    // 或 Firebase 的錯，但 `showNotification()` 預設每次呼叫都會疊加成一則新通知，沒有
    // 任何防重機制。
    // 解法：帶入 `tag`，瀏覽器看到相同 `tag` 的第二則通知時會直接「取代」畫面上第一則，
    // 不會顯示成兩則、也不會重新響鈴/震動（`renotify` 預設為 false）。
    // `tag` 刻意用 FCM 自動賦予的 `payload.messageId`（每次伺服器端呼叫送出時各自產生的
    // 唯一值），而不是寫死一個固定字串：
    //  - 底層協定重複投遞的是「同一次送出」，兩次投遞會帶著相同的 messageId，用它當 tag
    //    可以正確把這種重複收斂成一則。
    //  - 老師/學生短時間內收到兩則「內容不同」的真實通知（例如老師連續留言、或不同學生
    //    各自送出回覆）時，各自的 messageId 不同，仍會分開顯示、不會被誤判成重複而互相
    //    蓋掉——如果改用固定字串當 tag，會導致這種正常情境下的通知也被吃掉，反而遺漏資訊。
    // messageId 理論上一定存在（FCM SDK 自動賦予），保留 `|| payload.collapseKey` 作為
    // 極端情況下的備援，避免萬一缺失時 tag 直接變成 undefined。
    tag: payload.messageId || payload.collapseKey || undefined
  };
  self.registration.showNotification(title, options);
});

// 使用者點通知 → 開啟對應頁面（學生端固定回 student.html，老師端固定回 teacher.html）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
