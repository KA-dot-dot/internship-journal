// sw.js — Service Worker for 產學班實習月記
// 升版方式：將 CACHE_VER 數字 +1，舊快取會在下次啟動時自動清除。
const CACHE_VER = 5;

const APP_CACHE = `app-v${CACHE_VER}`;   // HTML 頁面
const IMG_CACHE = `img-v${CACHE_VER}`;   // Cloudinary 工作照片
const CDN_CACHE = `cdn-v${CACHE_VER}`;   // jsdelivr / cdnjs 靜態資源

// 預先快取的頁面（裝置離線時仍可開啟）
const PRECACHE_URLS = [
  './',
  './index.html',
  './student.html',
  './teacher.html',
  './offline.html',
  './manifest-student.json',
  './manifest-teacher.json',
  './icon-192.png',
  './icon-512.png',
];

// 完全略過（交給瀏覽器原生處理）的網域
// Firebase / Google 自行管理快取與 Auth token，不可介入
const BYPASS_DOMAINS = [
  'googleapis.com',
  'gstatic.com',
  'google.com',
  'firebaseapp.com',
  'firebaseio.com',
  'firebase.com',
];

// ──────────────────────────────────────────────────────────────
// Install：預先快取靜態頁面
// ──────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] precache failed:', err))
  );
});

// ──────────────────────────────────────────────────────────────
// Activate：清除舊版快取
// ──────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const keep = [APP_CACHE, IMG_CACHE, CDN_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => {
          console.log('[SW] removing old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────────────────
// Fetch：依來源選擇快取策略
// ──────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol === 'chrome-extension:') return;

  // Firebase / Google → 完全不快取
  if (BYPASS_DOMAINS.some(d =>
    url.hostname === d || url.hostname.endsWith('.' + d)
  )) return;

  // Cloudinary 工作照片 → cache-first（照片上傳後不會再變）
  if (url.hostname.includes('cloudinary.com')) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // jsdelivr / cdnjs 靜態資源 → cache-first（URL 含版本號，不會變）
  if (url.hostname === 'cdn.jsdelivr.net' ||
      url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // HTML 頁面導覽 → network-first，離線時回傳快取版本
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // 其他同源資源 → network-first
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});

// ──────────────────────────────────────────────────────────────
// 快取策略函式
// ──────────────────────────────────────────────────────────────

/** Cache-first：有快取立即回傳；沒有才打網路，成功則存入快取 */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/** Network-first：先打網路（順便更新快取）；失敗才回傳快取或離線頁 */
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(req, res.clone()); // 非同步更新，不阻塞回傳
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match('./offline.html');
    return offline || new Response(
      '<html lang="zh-TW"><body style="font-family:sans-serif;padding:2rem;text-align:center"><h2>離線中</h2><p>請確認網路後重新整理</p></body></html>',
      { headers: { 'Content-Type': 'text/html;charset=utf-8' }, status: 503 }
    );
  }
}
