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
//
// 2026-07-06 第二次修正：找到「加了 tag 還是固定兩則」的真正根因，跟 tag 本身無關。
// 問題出在 notify-service/send-push-notifications.js 原本送出的 FCM 訊息「同時」帶了
// 頂層 notification 欄位和 data 欄位。Firebase JS SDK 在 Web 平台上，只要偵測到訊息
// 帶有 notification 欄位，就會在瀏覽器背景時「自己」呼叫一次 showNotification()
// 自動顯示（這條路徑完全在 Firebase 內部函式庫裡執行，不會經過下面這個 onBackgroundMessage
// callback，所以上面加的 tag 防重複機制對它完全無效）；與此同時，因為訊息也帶了 data，
// 下面這個 onBackgroundMessage callback 一樣會被觸發、再手動呼叫一次 showNotification()。
// 一則訊息、兩條互相不知道對方存在的顯示路徑，結果就是不管 tag 加得多正確，永遠固定
// 兩則——這是 Firebase JS SDK 本身長期已知的行為（notification+data 同時存在時的重複顯示），
// 不是這支專案獨有的 bug。
// 修法：後端已經改成「只送 data，不再送 notification 頂層欄位」（見
// send-push-notifications.js 同日修正），這樣 Firebase SDK 內部就沒有 notification
// 可以自動顯示，只剩下面這一條路徑會執行，從根本上只會顯示一次。相對應地，這裡也要
// 全部改讀 payload.data.* ，不能再讀 payload.notification.*（已經不會存在了）。
// 上面 2026-07-05/06 加的 tag 機制本身沒有錯、仍然保留——它解決的是「Web Push 協定
// 本身至少送達一次、同一則被重複投遞」這個不同層面的問題，跟這次的 notification+data
// 雙路徑顯示是兩個各自獨立、都要處理的原因，不是二選一。
messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || '產學班實習月記系統';
  const options = {
    body: payload.data?.body || '',
    // 2026-07 修正：跟 initPushNotifications() 註冊路徑同一類問題——這個站在 GitHub Pages
    // 的 /internship-journal/ 子路徑下，Service Worker 裡的相對路徑是相對於「這支 SW 檔案
    // 自己的網址」解析（此檔已改用 './fcm-sw.js' 註冊，實際網址在子路徑下），所以這裡改成
    // 不帶開頭斜線的相對路徑，才能正確抓到 .../internship-journal/icon-192.png。
    icon: './icon-192.png',
    badge: './icon-192.png',
    // data?.link 由發送端（notify-service）帶完整網址過來；這裡的 './' 只是缺失時的
    // 保底預設值，指向這支 SW 檔案所在的子路徑本身，不會是「跳回不相干的網域根目錄」。
    data: { link: payload.data?.link || './' },
    // 解決同一則通知在裝置上重複顯示兩次的問題（跟上面 notification+data 雙路徑顯示是
    // 不同成因）：Web Push 協定本身「至少送達一次」，同一則推播底層可能被重複投遞
    // （網路不穩、瀏覽器背景程序重啟等都可能觸發），`showNotification()` 預設每次呼叫都會
    // 疊加成一則新通知，沒有任何防重機制。帶入 `tag`，瀏覽器看到相同 `tag` 的第二則通知時
    // 會直接「取代」畫面上第一則，不會顯示成兩則、也不會重新響鈴/震動（`renotify` 預設 false）。
    // tag 由 notify-service/send-push-notifications.js 自己組出來（月記文件完整路徑 +
    // 評語/回覆真正寫入的時間），不經過 FCM 內部機制，同一份評語/回覆不論被投遞幾次，
    // 這裡拿到的 tag 保證一樣，才能真正收斂成一則。
    tag: payload.data?.tag || undefined
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
