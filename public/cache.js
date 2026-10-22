/**
 * Web Clipboard - 本地图片 IndexedDB 缓存管理器
 * 用于在低带宽环境下缓存缩略图，提供秒开体验，并支持全生命周期自动/手动清理。
 */

(function (window) {
  'use strict';

  const DB_NAME = 'web_clipboard_cache';
  const DB_VERSION = 1;
  const STORE_NAME = 'thumbnails';
  const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB 存储上限
  const TARGET_WATERMARK_RATIO = 0.8; // 触发清理时降至上限的 80%

  let dbPromise = null;

  // 检查是否支持 IndexedDB
  function isSupported() {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  // 打开或获取数据库连接单例
  function getDB() {
    if (!isSupported()) {
      return Promise.reject(new Error('IndexedDB is not supported'));
    }
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('favorite', 'favorite', { unique: false });
          store.createIndex('messageId', 'messageId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onerror = (e) => {
          console.error('IndexedDB runtime error:', e);
        };
        resolve(db);
      };

      request.onerror = (event) => {
        dbPromise = null;
        reject(event.target.error || new Error('Failed to open IndexedDB'));
      };
    });

    return dbPromise;
  }

  // 构建复合主键：按用户隔离
  function makeKey(userId, messageId) {
    return `${userId || 'default'}:${messageId}`;
  }

  // 格式化字节大小
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
    return `${val} ${units[i]}`;
  }

  /**
   * 获取指定消息的缩略图缓存
   * @param {string|null} userId
   * @param {string} messageId
   * @returns {Promise<{blob: Blob, mimeType: string}|null>}
   */
  async function getThumbnail(userId, messageId) {
    if (!isSupported() || !messageId) return null;
    try {
      const db = await getDB();
      const key = makeKey(userId, messageId);

      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result;
          if (record && record.blob) {
            // 更新最后访问时间，维护 LRU 热度
            record.updatedAt = Date.now();
            try {
              store.put(record);
            } catch (err) {
              // 忽略热度更新异常
            }
            resolve({ blob: record.blob, mimeType: record.mimeType });
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('获取图片缓存失败:', e);
      return null;
    }
  }

  /**
   * 保存缩略图到缓存
   * @param {string|null} userId
   * @param {string} messageId
   * @param {string} url
   * @param {Blob} blob
   * @param {string} mimeType
   * @param {boolean} isFavorite
   */
  async function setThumbnail(userId, messageId, url, blob, mimeType, isFavorite = false) {
    if (!isSupported() || !messageId || !blob) return;
    try {
      const db = await getDB();
      const key = makeKey(userId, messageId);
      const size = blob.size || 0;

      const record = {
        key,
        userId: userId || 'default',
        messageId,
        url,
        blob,
        mimeType: mimeType || blob.type || 'image/webp',
        size,
        favorite: Boolean(isFavorite),
        updatedAt: Date.now()
      };

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // 异步触发容量上限检查（防止阻塞当前渲染）
      scheduleLRUCheck(userId);
    } catch (e) {
      console.warn('写入图片缓存失败:', e);
    }
  }

  /**
   * 删除单条消息的图片缓存
   */
  async function deleteThumbnail(userId, messageId) {
    if (!isSupported() || !messageId) return;
    try {
      const db = await getDB();
      const key = makeKey(userId, messageId);
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('删除图片缓存失败:', e);
    }
  }

  /**
   * 一键清空时：清除非收藏图片的本地缓存，保留收藏图片
   */
  async function clearNonFavoriteThumbnails(userId) {
    if (!isSupported()) return;
    try {
      const db = await getDB();
      const targetUser = userId || 'default';
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('userId');
        const request = index.openCursor(IDBKeyRange.only(targetUser));

        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const record = cursor.value;
            if (!record.favorite) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('清理非收藏缓存失败:', e);
    }
  }

  /**
   * 更新收藏状态（当用户收藏/取消收藏某条消息时）
   */
  async function updateFavoriteStatus(userId, messageId, isFavorite) {
    if (!isSupported() || !messageId) return;
    try {
      const db = await getDB();
      const key = makeKey(userId, messageId);
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result;
          if (record) {
            record.favorite = Boolean(isFavorite);
            store.put(record);
          }
          resolve();
        };

        req.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('更新缓存收藏状态失败:', e);
    }
  }

  /**
   * 用户退出登录时：清除该用户的全部本地缓存（隐私安全保护）
   */
  async function clearUserThumbnails(userId) {
    if (!isSupported()) return;
    try {
      const db = await getDB();
      const targetUser = userId || 'default';
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('userId');
        const request = index.openCursor(IDBKeyRange.only(targetUser));

        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('清空用户图片缓存失败:', e);
    }
  }

  /**
   * 手动一键清空所有图片缓存
   */
  async function clearAllThumbnails() {
    if (!isSupported()) return;
    try {
      const db = await getDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('清空所有图片缓存失败:', e);
    }
  }

  /**
   * 获取当前用户的缓存统计信息
   * @param {string|null} userId
   * @returns {Promise<{count: number, totalBytes: number, formattedSize: string}>}
   */
  async function getCacheStats(userId) {
    if (!isSupported()) {
      return { count: 0, totalBytes: 0, formattedSize: '0 B' };
    }
    try {
      const db = await getDB();
      const targetUser = userId || 'default';
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('userId');
        const request = index.openCursor(IDBKeyRange.only(targetUser));

        let count = 0;
        let totalBytes = 0;

        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            count += 1;
            totalBytes += (cursor.value.size || 0);
            cursor.continue();
          } else {
            resolve({
              count,
              totalBytes,
              size: totalBytes,
              formattedSize: formatBytes(totalBytes)
            });
          }
        };

        request.onerror = () => {
          resolve({ count: 0, totalBytes: 0, size: 0, formattedSize: '0 B' });
        };
      });
    } catch (e) {
      return { count: 0, totalBytes: 0, size: 0, formattedSize: '0 B' };
    }
  }

  /**
   * 后台异步执行 TTL 过期与 100MB LRU 淘汰清理
   * @param {string|null} userId
   * @param {number} expireHours 服务端设置的过期小时数
   * @param {number} maxBytes 存储上限（默认 100MB）
   */
  async function cleanupExpiredAndOverflow(userId, expireHours = 168, maxBytes = DEFAULT_MAX_SIZE_BYTES) {
    if (!isSupported()) return;
    try {
      const db = await getDB();
      const targetUser = userId || 'default';
      const cutoffTime = expireHours > 0 ? Date.now() - expireHours * 3600 * 1000 : 0;

      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('userId');
        const request = index.openCursor(IDBKeyRange.only(targetUser));

        const records = [];

        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const rec = cursor.value;
            // 1. TTL 淘汰：超过 expireHours 且未收藏的图片立即清理
            if (cutoffTime > 0 && rec.updatedAt < cutoffTime && !rec.favorite) {
              cursor.delete();
            } else {
              records.push({
                key: rec.key,
                size: rec.size || 0,
                updatedAt: rec.updatedAt || 0,
                favorite: Boolean(rec.favorite)
              });
            }
            cursor.continue();
          } else {
            // 2. LRU 容量淘汰：若剩余总容量超出 maxBytes，按访问时间由旧到新淘汰非收藏图片
            let totalBytes = records.reduce((sum, r) => sum + r.size, 0);
            if (totalBytes > maxBytes) {
              const targetWatermark = maxBytes * TARGET_WATERMARK_RATIO;
              // 按 updatedAt 升序排序（最旧的排在最前）
              records.sort((a, b) => a.updatedAt - b.updatedAt);
              for (const r of records) {
                if (!r.favorite) {
                  store.delete(r.key);
                  totalBytes -= r.size;
                  if (totalBytes <= targetWatermark) {
                    break;
                  }
                }
              }
            }
            resolve();
          }
        };

        request.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('后台缓存清理异常:', e);
    }
  }

  // 节流触发 LRU 检查
  let lruCheckTimer = null;
  function scheduleLRUCheck(userId) {
    if (lruCheckTimer) return;
    lruCheckTimer = setTimeout(() => {
      lruCheckTimer = null;
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => cleanupExpiredAndOverflow(userId));
      } else {
        setTimeout(() => cleanupExpiredAndOverflow(userId), 1000);
      }
    }, 10000);
  }

  // 暴露到全局命名空间
  window.ImageCache = {
    isSupported,
    formatBytes,
    getThumbnail,
    setThumbnail,
    deleteThumbnail,
    clearNonFavoriteThumbnails,
    updateFavoriteStatus,
    clearUserThumbnails,
    clearAllThumbnails,
    clearAll: clearAllThumbnails,
    getCacheStats,
    getStats: getCacheStats,
    cleanupExpiredAndOverflow
  };
})(window);
