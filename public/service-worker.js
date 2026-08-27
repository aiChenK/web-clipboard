const CACHE_NAME = 'web-clipboard-v1.6.5';
const ASSETS = [
  '/',
  '/index.html',
  '/share.html',
  '/style.css',
  '/app.js',
  '/share.js',
  '/favicon.svg',
  '/socket.io/socket.io.js'
];

// 安装 Service Worker 并预缓存核心静态资产
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 激活并清理旧版本的缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('清理旧缓存:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 拦截 fetch 请求并应用 Stale-While-Revalidate 缓存策略
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 安全排除：API、大文件上传目录以及 Socket.IO 连接不进行 Service Worker 拦截缓存
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/socket.io/')
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 静态资产：缓存优先返回，同时后台默默 fetch 更新最新版本缓存
        fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => { });
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
