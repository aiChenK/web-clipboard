/**
 * 系统剪贴板交互模块 (支持 PNG 转码、ClipboardItem 异步写入与降级适配)
 */

import { fetchOriginalImageBlob } from '../api.js';
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

export async function copyImageToClipboard(dataUrl, options = {}, onToast) {
  const {
    successToast = '图片已复制到剪贴板',
    failureToast = '复制图片失败，请尝试右键另存',
    silentFailure = false
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

    const blobPromise = (async () => {
      return await convertImageSourceToPngBlob(dataUrl);
    })();

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
      if (typeof thumbnail === 'string' && thumbnail.startsWith('data:image/png;base64,') && utils) {
        const syncBlob = utils.dataURLtoBlobSync(thumbnail);
        if (syncBlob) return syncBlob;
      }
      return await convertImageSourceToPngBlob(thumbnail);
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
