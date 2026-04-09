const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { STORAGE_ROOT, MIME_EXTENSION_MAP } = require('./config');
const { getUploadRoot } = require('./storage');
const { ensureDir, toDateFolder, createMessageId, sanitizeFilename, extensionFromMime, withPreferredExt, toPosixPath } = require('./utils');

// Multer 配置用于 multipart/form-data 上传
const multerStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const tempDir = path.join(STORAGE_ROOT, 'temp', toDateFolder());
    await ensureDir(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const id = createMessageId();
    const ext = path.extname(file.originalname) || extensionFromMime(file.mimetype) || '';
    cb(null, `${id}${ext}`);
  }
});

const uploadMiddleware = multer({
  storage: multerStorage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// 写入二进制文件到上传目录
async function writeBinaryToUpload({ category, id, buffer, mimeType, filenameHint, suffix = '', userId = null }) {
  const uploadRoot = getUploadRoot(userId);
  const dateDir = toDateFolder();
  const safeHint = sanitizeFilename(filenameHint || 'file');
  const finalName = withPreferredExt(safeHint, extensionFromMime(mimeType));
  const parsed = path.parse(finalName);
  const leaf = category === 'files'
    ? `${id}-${parsed.name}${parsed.ext}`
    : `${id}${suffix}${parsed.ext || extensionFromMime(mimeType) || '.bin'}`;

  const relativePath = path.join(category, dateDir, leaf);
  const absolutePath = path.join(uploadRoot, relativePath);

  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, buffer);

  return toPosixPath(relativePath);
}

// 解析上传文件绝对路径
function resolveUploadAbsolute(relativePath, userId = null) {
  const uploadRoot = getUploadRoot(userId);
  const absolutePath = path.resolve(uploadRoot, relativePath);
  const rootWithSep = `${path.resolve(uploadRoot)}${path.sep}`;
  if (absolutePath !== path.resolve(uploadRoot) && !absolutePath.startsWith(rootWithSep)) {
    throw new Error('invalid upload path');
  }
  return absolutePath;
}

// 删除文件（如存在）
async function removeFileIfExists(relativePath, userId = null) {
  if (!relativePath) return;
  try {
    const absolute = resolveUploadAbsolute(relativePath, userId);
    await fs.unlink(absolute);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return;
    console.error('删除文件失败:', relativePath, error);
  }
}

// 获取消息文件引用
function getMessageFileRefs(message) {
  if (!message || typeof message !== 'object') return [];

  if (message.type === 'image' && message.content && typeof message.content === 'object') {
    const refs = [];
    if (typeof message.content.thumbnailPath === 'string') refs.push(message.content.thumbnailPath);
    if (typeof message.content.originalPath === 'string') refs.push(message.content.originalPath);
    return [...new Set(refs)];
  }

  if (message.type === 'file' && message.content && typeof message.content === 'object') {
    return typeof message.content.filePath === 'string' ? [message.content.filePath] : [];
  }

  return [];
}

// 删除消息相关文件
async function deleteMessageFiles(message, userId = null) {
  const refs = getMessageFileRefs(message);
  for (const filePath of refs) {
    await removeFileIfExists(filePath, userId);
  }
}

module.exports = {
  uploadMiddleware,
  writeBinaryToUpload,
  resolveUploadAbsolute,
  removeFileIfExists,
  getMessageFileRefs,
  deleteMessageFiles
};