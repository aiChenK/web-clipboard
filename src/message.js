const { toUploadUrl, decodeDataUrl, normalizeImageIncomingContent, extensionFromMime, isDataUrl, sanitizeFilename } = require('./utils');
const { writeBinaryToUpload } = require('./upload');

// 转换为公开消息格式
function toPublicMessage(message, userId = null) {
  const result = { ...message, favorite: Boolean(message.favorite) };

  if (message.type === 'image') {
    const content = message.content;

    if (content && typeof content === 'object' && typeof content.thumbnailPath === 'string') {
      const thumbnailUrl = toUploadUrl(content.thumbnailPath, userId);
      result.content = {
        thumbnail: thumbnailUrl,
        hasOriginal: Boolean(content.hasOriginal),
        mimeType: content.thumbnailMimeType || content.originalMimeType || 'image/png'
      };
      return result;
    }

    const legacy = normalizeImageIncomingContent(content);
    if (legacy) {
      result.content = {
        thumbnail: legacy.thumbnail,
        hasOriginal: legacy.original !== legacy.thumbnail
      };
      return result;
    }

    result.content = { thumbnail: '', hasOriginal: false };
    return result;
  }

  if (message.type === 'file') {
    const content = message.content;
    if (content && typeof content === 'object' && typeof content.filePath === 'string') {
      result.content = {
        name: content.name,
        size: content.size,
        mimeType: content.mimeType,
        url: toUploadUrl(content.filePath, userId)
      };
      return result;
    }
  }

  return result;
}

// 持久化图片内容
async function persistImageContent(message, content, userId = null) {
  const normalized = normalizeImageIncomingContent(content);
  if (!normalized) {
    throw new Error('图片内容格式错误');
  }

  const originalDecoded = decodeDataUrl(normalized.original);
  const originalPath = await writeBinaryToUpload({
    category: 'images',
    id: message.id,
    buffer: originalDecoded.buffer,
    mimeType: originalDecoded.mimeType,
    filenameHint: `original${extensionFromMime(originalDecoded.mimeType) || '.png'}`,
    suffix: '-orig',
    userId
  });

  let thumbnailPath = originalPath;
  let thumbnailMimeType = originalDecoded.mimeType;

  if (normalized.thumbnail !== normalized.original) {
    const thumbnailDecoded = decodeDataUrl(normalized.thumbnail);
    thumbnailPath = await writeBinaryToUpload({
      category: 'images',
      id: message.id,
      buffer: thumbnailDecoded.buffer,
      mimeType: thumbnailDecoded.mimeType,
      filenameHint: `thumbnail${extensionFromMime(thumbnailDecoded.mimeType) || '.jpg'}`,
      suffix: '-thumb',
      userId
    });
    thumbnailMimeType = thumbnailDecoded.mimeType;
  }

  message.content = {
    thumbnailPath,
    originalPath,
    hasOriginal: normalized.thumbnail !== normalized.original,
    thumbnailMimeType,
    originalMimeType: originalDecoded.mimeType
  };
}

// 持久化文件内容
async function persistFileContent(message, content, userId = null) {
  if (!content || typeof content !== 'object') {
    throw new Error('文件内容格式错误');
  }

  if (!isDataUrl(content.dataUrl)) {
    throw new Error('文件 dataUrl 格式错误');
  }

  const decoded = decodeDataUrl(content.dataUrl);
  const originalName = sanitizeFilename(content.name || 'file');
  const filePath = await writeBinaryToUpload({
    category: 'files',
    id: message.id,
    buffer: decoded.buffer,
    mimeType: decoded.mimeType,
    filenameHint: originalName,
    userId
  });

  message.content = {
    name: originalName,
    size: decoded.buffer.length,
    mimeType: decoded.mimeType,
    filePath
  };
}

module.exports = {
  toPublicMessage,
  persistImageContent,
  persistFileContent
};