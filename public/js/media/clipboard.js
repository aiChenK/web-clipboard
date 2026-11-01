/**
 * 系统剪贴板交互模块 (支持 PNG 转码、ClipboardItem 异步写入与降级适配)
 */

import { fetchOriginalImageBlob, fetchUploadBlob } from '../api.js';
import { state } from '../state.js';
import { ORIGINAL_FETCH_TIMEOUT } from '../config.js';

export function convertImageSourceToPngBlob(src) {
  return new Promise((resolve, reject) => {
    const isBlob = src instanceof Blob;
    const url = isBlob ? URL.createObjectURL(src) : src;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        if (isBlob) URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, 'image/png');
      } catch (err) {
        if (isBlob) URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      if (isBlob) URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

export async function writePngToClipboard(blobOrPromise) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
    throw new Error('浏览器不支持剪贴板图片写入');
  }

  try {
    const item = new ClipboardItem({ 'image/png': blobOrPromise });
    await navigator.clipboard.write([item]);
    return true;
  } catch (firstErr) {
    if (blobOrPromise instanceof Promise) {
      const resolvedBlob = await blobOrPromise;
      const item = new ClipboardItem({ 'image/png': resolvedBlob });
      await navigator.clipboard.write([item]);
      return true;
    }
    throw firstErr;
  }
}

export async function copyTextToClipboard(text, onToast) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      if (onToast) onToast('已复制到剪贴板');
      return true;
    }
    // 降级使用 textarea execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (successful) {
      if (onToast) onToast('已复制到剪贴板');
      return true;
    }
    throw new Error('execCommand copy failed');
  } catch (err) {
    console.error('复制文本失败:', err);
    if (onToast) onToast('复制失败，请手动长按复制');
    return false;
  }
}

// 统一把图片来源解析为 PNG Blob
// 关键点：/uploads/* 在设置访问密码（单用户）或多用户模式下需要鉴权头，
// 而 <img src="/uploads/..."> 无法携带 x-access-password / x-user-id，
// 直接按 URL 转码必然 401 失败，因此必须走 authFetch（或复用本地 IndexedDB 缓存）。
async function resolveImageToPngBlob(src, options = {}) {
  const { messageId = null, timeout = ORIGINAL_FETCH_TIMEOUT } = options;

  if (src instanceof Blob) {
    return src.type === 'image/png' ? src : convertImageSourceToPngBlob(src);
  }

  if (typeof src !== 'string' || !src) {
    throw new Error('图片地址为空');
  }

  // 本地可解码的来源（data URL / blob URL）不涉及鉴权，直接走原有转码路径
  if (src.startsWith('data:')) {
    if (src.startsWith('data:image/png;base64,') && window.ClipboardUtils) {
      const syncBlob = window.ClipboardUtils.dataURLtoBlobSync(src);
      if (syncBlob) return syncBlob;
    }
    return convertImageSourceToPngBlob(src);
  }
  if (src.startsWith('blob:')) {
    return convertImageSourceToPngBlob(src);
  }

  // 1. 优先命中本地 IndexedDB 缩略图缓存（离线/弱网也可复制）
  if (messageId && window.ImageCache) {
    try {
      const cached = await window.ImageCache.getThumbnail(state.userId, messageId);
      if (cached && cached.blob) {
        const cachedBlob = cached.blob.type || !cached.mimeType
          ? cached.blob
          : new Blob([cached.blob], { type: cached.mimeType });
        return cachedBlob.type === 'image/png' ? cachedBlob : convertImageSourceToPngBlob(cachedBlob);
      }
    } catch (err) {
      console.warn('读取缩略图缓存失败，改走网络:', err);
    }
  }

  // 2. 带鉴权凭证拉取二进制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const blob = await fetchUploadBlob(src, controller.signal);
    return blob.type === 'image/png' ? blob : convertImageSourceToPngBlob(blob);
  } catch (err) {
    console.warn('带凭证获取图片失败，降级为直接加载:', err);
    // 3. 降级：免密部署下裸 URL 仍可命中
    return convertImageSourceToPngBlob(src);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function copyImageToClipboard(dataUrl, options = {}, onToast) {
  const {
    successToast = '图片已复制到剪贴板',
    failureToast = '复制图片失败，请尝试右键另存',
    silentFailure = false,
    messageId = null
  } = options;

  if (!dataUrl) {
    if (!silentFailure && onToast) onToast(failureToast);
    return false;
  }

  try {
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
      const syncBlob = window.ClipboardUtils ? window.ClipboardUtils.dataURLtoBlobSync(dataUrl) : null;
      if (syncBlob) {
        await writePngToClipboard(syncBlob);
        if (successToast && onToast) onToast(successToast);
        return true;
      }
    }

    const blobPromise = resolveImageToPngBlob(dataUrl, { messageId });

    await writePngToClipboard(blobPromise);
    if (successToast && onToast) onToast(successToast);
    return true;
  } catch (error) {
    console.error('复制图片失败:', error);
    if (!silentFailure && onToast) {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
        onToast('浏览器不支持复制图片，请右键另存');
      } else {
        onToast(failureToast);
      }
    }
    return false;
  }
}

export async function copyOriginalImageWithFallback(msg, onToast) {
  const utils = window.ClipboardUtils;
  const imageData = utils ? utils.getImageContent(msg.content) : msg.content;
  const thumbnail = imageData ? imageData.thumbnail : '';
  if (!thumbnail) {
    if (onToast) onToast('当前消息缺少可复制的缩略图');
    return;
  }

  let usedFallback = false;
  let fallbackReason = '';

  const originalBlobPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ORIGINAL_FETCH_TIMEOUT);
    try {
      const originalBlob = await fetchOriginalImageBlob(msg.id, controller.signal);
      clearTimeout(timeoutId);
      if (originalBlob.type === 'image/png') {
        return originalBlob;
      }
      return await convertImageSourceToPngBlob(originalBlob);
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('获取原图失败，回退复制缩略图:', err);
      usedFallback = true;
      fallbackReason = err && err.name === 'AbortError' ? '超时' : '失败';
      return await resolveImageToPngBlob(thumbnail, { messageId: msg.id });
    }
  })();

  try {
    await writePngToClipboard(originalBlobPromise);
    if (onToast) {
      if (usedFallback) {
        onToast(fallbackReason === '超时' ? '复制原图超时，已回退复制缩略图' : '获取原图失败，已回退复制缩略图');
      } else {
        onToast('原图已复制到剪贴板');
      }
    }
  } catch (error) {
    console.error('复制原图失败:', error);
    if (onToast) onToast('复制原图失败，请尝试右键另存');
  }
}
