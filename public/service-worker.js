// 缓存版本号与 package.json 发布版本及 index.html 静态资源 ?v= 同步更新
const CACHE_NAME = 'web-clipboard-v1.8.2';
const ASSETS = [
  '/',
  '/index.html',
  '/share.html',
  '/style.css',
  '/theme.js',
  '/utils.js',
  '/cache.js',
  '/app.js',
  '/share.js',
  '/heic2any.min.js',
  '/favicon.svg',
  '/socket.io/socket.io.js',
  '/js/config.js',
  '/js/state.js',
  '/js/api.js',
  '/js/socket.js',
  '/js/media/image-process.js',
  '/js/media/clipboard.js',
  '/js/components/message-item.js',
  '/js/components/modals.js',
  '/js/components/share-modal.js'
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
  // 仅处理同源 GET 请求
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 安全排除：API、大文件上传目录、Socket.IO 连接以及管理端页面
  // （管理端入口是否可用由服务端按 ADMIN_PASSWORD 决定，不能被缓存"复活"）
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname === '/admin' ||
    url.pathname === '/admin.html' ||
    url.pathname === '/admin.js' ||
    url.pathname === '/admin.css'
  ) {
    return;
  }

  e.respondWith(
    // ignoreSearch：预缓存为无版本号 URL，运行时请求带 ?v= 查询参数，忽略查询串才能命中
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // 静态资产：缓存优先返回，同时后台默默 fetch 更新最新版本缓存
        fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => { });
        return cachedResponse;
      }
      // 未命中：走网络并回写运行时缓存（仅缓存同源成功响应）
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
