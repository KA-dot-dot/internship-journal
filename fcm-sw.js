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
    data: { link: payload.fcmOptions?.link || payload.data?.link || './' }
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
