/**
 * 图像计算与格式转码核心模块 (Canvas 压缩、HEIC 转换)
 */

import { HD_COMPRESS_MAX_EDGE, THUMBNAIL_MAX_EDGE } from '../config.js';

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取 Blob 失败'));
    reader.readAsDataURL(blob);
  });
}

export function loadImageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

// 基于 Canvas 将图片按比例缩放并压缩输出 WebP / JPEG
export async function compressImageToBlob(fileOrBlob, maxEdge = HD_COMPRESS_MAX_EDGE, quality = 0.95) {
  try {
    const img = await loadImageElementFromBlob(fileOrBlob);
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    // 若原图尺寸在限制内，保持 100% 原始尺寸不缩放
    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise((resolve) => {
      // 优先输出高质量 WebP，不支持时降级为 JPEG
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          canvas.toBlob((fallbackBlob) => {
            resolve(fallbackBlob || fileOrBlob);
          }, 'image/jpeg', quality);
        }
      }, 'image/webp', quality);
    });
  } catch (err) {
    console.error('压缩图片失败，回退使用原始文件:', err);
    return fileOrBlob;
  }
}

// 快速生成轻量缩略图
export async function createThumbnailBlob(fileOrBlob) {
  return compressImageToBlob(fileOrBlob, 1920, 0.92);
}

// 判定是否为 HEIC/HEIF 格式
export function isHeicFile(file) {
  if (!file) return false;
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  const name = file.name || '';
  const ext = name.split('.').pop().toLowerCase();
  return ext === 'heic' || ext === 'heif';
}

// 动态载入本地 heic2any 库
let heic2anyLoadingPromise = null;
export function ensureHeic2AnyLoaded() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (heic2anyLoadingPromise) return heic2anyLoadingPromise;

  heic2anyLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/heic2any.min.js';
    script.onload = () => {
      resolve(window.heic2any);
    };
    script.onerror = () => {
      heic2anyLoadingPromise = null;
      reject(new Error('加载 HEIC 转换器失败'));
    };
    document.head.appendChild(script);
  });

  return heic2anyLoadingPromise;
}

// 若为 HEIC 格式则在前端自动转换为高质量 JPEG File
export async function convertHeicToJpegIfNeeded(file, onNotice) {
  if (!isHeicFile(file)) return file;

  try {
    if (onNotice) onNotice('检测到 HEIC 图片，正在转换格式...');
    await ensureHeic2AnyLoaded();
    const result = await window.heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92
    });

    const jpegBlob = Array.isArray(result) ? result[0] : result;
    const origName = file.name || `image-${Date.now()}.heic`;
    const newName = origName.replace(/\.(heic|heif)$/i, '.jpg');

    return new File([jpegBlob], newName, {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now()
    });
  } catch (err) {
    console.error('HEIC 转换失败:', err);
    if (onNotice) onNotice('HEIC 图片转换失败，尝试原样上传');
    return file;
  }
}
