const fs = require('fs/promises');
const path = require('path');
const { MIME_EXTENSION_MAP, MESSAGE_PAGE_SIZE, MULTI_USER_MODE } = require('./config');

// 分页大小限制
function clampPageSize(limit) {
  if (!Number.isFinite(limit)) return MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), 100);
}

// 检查是否为 Data URL
function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

// 转换为 POSIX 路径
function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

// 获取上传文件 URL
function toUploadUrl(relativePath, userId = null) {
  if (MULTI_USER_MODE && userId) {
    return `/uploads/${userId}/${toPosixPath(relativePath)}`;
  }
  return `/uploads/${toPosixPath(relativePath)}`;
}

// 生成日期文件夹名
function toDateFolder(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 创建消息 ID
function createMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 清理文件名
function sanitizeFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) {
    return 'file';
  }
  return filename
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5 ]/g, '_')
    .trim()
    .slice(0, 120) || 'file';
}

// 从 MIME 类型获取扩展名
function extensionFromMime(mimeType) {
  if (!mimeType) return '';
  return MIME_EXTENSION_MAP[mimeType] || '';
}

// 解码 Data URL
function decodeDataUrl(dataUrl) {
  if (!isDataUrl(dataUrl)) {
    throw new Error('invalid data url');
  }

  const matched = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/);
  if (!matched) {
    throw new Error('malformed data url');
  }

  const mimeType = matched[1] || 'application/octet-stream';
  const isBase64 = Boolean(matched[2]);
  const payload = matched[3] || '';
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');

  return { mimeType, buffer };
}

// 规范化图片输入内容
function normalizeImageIncomingContent(content) {
  if (isDataUrl(content)) {
    return { thumbnail: content, original: content };
  }

  if (content && typeof content === 'object') {
    const thumbnail = isDataUrl(content.thumbnail) ? content.thumbnail : null;
    const original = isDataUrl(content.original) ? content.original : null;

    if (!thumbnail && !original) return null;

    return {
      thumbnail: thumbnail || original,
      original: original || thumbnail
    };
  }

  return null;
}

// 确保目录存在
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

// 添加优先扩展名
function withPreferredExt(filename, fallbackExt) {
  const parsed = path.parse(filename || '');
  const ext = parsed.ext || fallbackExt || '';
  const base = parsed.name || 'file';
  return `${base}${ext}`;
}

module.exports = {
  clampPageSize,
  isDataUrl,
  toPosixPath,
  toUploadUrl,
  toDateFolder,
  createMessageId,
  sanitizeFilename,
  extensionFromMime,
  decodeDataUrl,
  normalizeImageIncomingContent,
  ensureDir,
  withPreferredExt
};