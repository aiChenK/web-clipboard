const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const ACCESS_PASSWORDS = process.env.ACCESS_PASSWORDS || '';
const MIGRATE_DEFAULT_USER = process.env.MIGRATE_DEFAULT_USER || '';
const EXPIRE_HOURS = Number.parseInt(process.env.EXPIRE_HOURS, 10) || 168;
const MESSAGE_PAGE_SIZE = Number.parseInt(process.env.MESSAGE_PAGE_SIZE, 10) || 30;
const SOCKET_SYNC_LIMIT = Number.parseInt(process.env.SOCKET_SYNC_LIMIT, 10) || 20;

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, 'data');
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(STORAGE_ROOT, 'uploads');
const FILE_CLEANUP_INTERVAL_MINUTES = Number.parseInt(process.env.FILE_CLEANUP_INTERVAL_MINUTES, 10) || 30;
const APP_VERSION = process.env.APP_VERSION || process.env.npm_package_version || require('./package.json').version || '1.0';

// 多用户模式判断
const MULTI_USER_MODE = Boolean(ACCESS_PASSWORDS);

// 解析密码映射: userId:password，并校验格式和密码唯一性
const userPasswordMap = new Map();
const userIdSet = new Set();
const passwordSet = new Set();
const parseErrors = [];

if (MULTI_USER_MODE) {
  const pairs = ACCESS_PASSWORDS.split(',').map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const parts = pair.split(':').map((s) => s.trim());

    // 校验格式：必须为 userId:password
    if (parts.length !== 2) {
      parseErrors.push(`第 ${i + 1} 个配置格式错误: "${pair}"，应为 "userId:password"`);
      continue;
    }

    const [userId, password] = parts;

    // 校验 userId 非空
    if (!userId) {
      parseErrors.push(`第 ${i + 1} 个配置 userId 为空`);
      continue;
    }

    // 校验 password 非空
    if (!password) {
      parseErrors.push(`第 ${i + 1} 个配置密码为空 (用户: ${userId})`);
      continue;
    }

    // 校验 userId 唯一性
    if (userIdSet.has(userId)) {
      parseErrors.push(`userId 重复: "${userId}"`);
      continue;
    }

    // 校验密码唯一性
    if (passwordSet.has(password)) {
      parseErrors.push(`密码重复，多个用户使用了相同密码 (冲突用户包含: "${userId}")`);
      continue;
    }

    userIdSet.add(userId);
    passwordSet.add(password);
    userPasswordMap.set(password, userId);
  }

  // 如果有解析错误，输出错误并退出
  if (parseErrors.length > 0) {
    console.error('❌ ACCESS_PASSWORDS 配置错误:');
    parseErrors.forEach((err) => console.error(`   - ${err}`));
    console.error('\n正确格式: ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3');
    console.error('注意：每个用户的密码必须唯一，不能重复');
    process.exit(1);
  }

  // 校验 MIGRATE_DEFAULT_USER 是否在用户列表中
  if (MIGRATE_DEFAULT_USER && !userIdSet.has(MIGRATE_DEFAULT_USER)) {
    console.error('❌ MIGRATE_DEFAULT_USER 配置错误:');
    console.error(`   - 迁移目标用户 "${MIGRATE_DEFAULT_USER}" 未在 ACCESS_PASSWORDS 中定义`);
    console.error('\n请在 ACCESS_PASSWORDS 中添加该用户，例如:');
    console.error(`   ACCESS_PASSWORDS=${MIGRATE_DEFAULT_USER}:yourpassword,otheruser:otherpass`);
    process.exit(1);
  }
}

// 用户数据存储结构: userId -> { messages, lastActivity }
const userStates = new Map();

// 全局状态（单用户模式使用）
let messages = [];
let lastActivity = Date.now();
let persistScheduled = false;
let persistRunning = false;
let cleanupRunning = false;

const EXPIRE_TIME = EXPIRE_HOURS * 60 * 60 * 1000;

// 获取用户数据路径
function getUserDataDir(userId) {
  return path.join(STORAGE_ROOT, 'users', userId);
}

function getUserDataFile(userId) {
  return path.join(getUserDataDir(userId), 'messages.json');
}

function getUserUploadRoot(userId) {
  return path.join(getUserDataDir(userId), 'uploads');
}

// 获取单用户模式的数据文件路径
const SINGLE_USER_DATA_FILE = path.join(STORAGE_ROOT, 'messages.json');

// 根据模式获取数据文件路径
function getDataFile(userId) {
  if (MULTI_USER_MODE && userId) {
    return getUserDataFile(userId);
  }
  return SINGLE_USER_DATA_FILE;
}

// 根据模式获取上传目录
function getUploadRoot(userId) {
  if (MULTI_USER_MODE && userId) {
    return getUserUploadRoot(userId);
  }
  return UPLOAD_ROOT;
}

// 获取用户状态
function getUserState(userId) {
  if (!MULTI_USER_MODE) {
    return { messages, lastActivity };
  }

  if (!userStates.has(userId)) {
    userStates.set(userId, { messages: [], lastActivity: Date.now() });
  }
  return userStates.get(userId);
}

// 通过密码获取用户ID
function getUserIdByPassword(password) {
  if (!MULTI_USER_MODE) {
    return null; // 单用户模式不返回 userId
  }
  return userPasswordMap.get(password) || null;
}

// Multer 配置用于 multipart/form-data 上传
// 注意：multipart 解析时字段顺序不确定，userId 可能在文件之后
// 所以先存到临时目录，后续再移动到正确的用户目录
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
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB 限制
});

const MIME_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/json': '.json',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
};

function clampPageSize(limit) {
  if (!Number.isFinite(limit)) return MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), 100);
}

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function toUploadUrl(relativePath, userId = null) {
  if (MULTI_USER_MODE && userId) {
    return `/uploads/${userId}/${toPosixPath(relativePath)}`;
  }
  return `/uploads/${toPosixPath(relativePath)}`;
}

function toDateFolder(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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

function extensionFromMime(mimeType) {
  if (!mimeType) return '';
  return MIME_EXTENSION_MAP[mimeType] || '';
}

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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function withPreferredExt(filename, fallbackExt) {
  const parsed = path.parse(filename || '');
  const ext = parsed.ext || fallbackExt || '';
  const base = parsed.name || 'file';
  return `${base}${ext}`;
}

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

function resolveUploadAbsolute(relativePath, userId = null) {
  const uploadRoot = getUploadRoot(userId);
  const absolutePath = path.resolve(uploadRoot, relativePath);
  const rootWithSep = `${path.resolve(uploadRoot)}${path.sep}`;
  if (absolutePath !== path.resolve(uploadRoot) && !absolutePath.startsWith(rootWithSep)) {
    throw new Error('invalid upload path');
  }
  return absolutePath;
}

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

async function deleteMessageFiles(message, userId = null) {
  const refs = getMessageFileRefs(message);
  for (const filePath of refs) {
    await removeFileIfExists(filePath, userId);
  }
}

function normalizePersistedState(state) {
  if (!state || typeof state !== 'object') {
    return { messages: [], lastActivity: Date.now() };
  }

  const persistedMessages = Array.isArray(state.messages) ? state.messages : [];
  const normalizedMessages = persistedMessages
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      if (typeof message.id !== 'string') return null;
      if (typeof message.type !== 'string') return null;
      if (!Number.isFinite(message.timestamp)) return null;
      if (!['text', 'image', 'file'].includes(message.type)) return null;
      // 添加 favorite 字段，默认 false
      message.favorite = Boolean(message.favorite);
      return message;
    })
    .filter(Boolean);

  const persistedLastActivity = Number.isFinite(state.lastActivity)
    ? state.lastActivity
    : Date.now();

  return {
    messages: normalizedMessages,
    lastActivity: persistedLastActivity
  };
}

async function loadPersistedState(userId = null) {
  const dataFile = getDataFile(userId);

  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizePersistedState(parsed);

    // 单用户模式：直接修改全局变量
    if (!MULTI_USER_MODE) {
      messages = normalized.messages;
      lastActivity = normalized.lastActivity;
    } else {
      // 多用户模式：修改用户状态
      const state = getUserState(userId);
      state.messages = normalized.messages;
      state.lastActivity = normalized.lastActivity;
    }

    console.log(`已加载持久化数据: ${normalized.messages.length} 条, 用户: ${userId || '单用户'}, 文件: ${dataFile}`);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`未找到持久化文件，使用空数据启动: ${dataFile}`);
      return;
    }
    console.error('读取持久化数据失败，使用空数据启动:', error);
    if (!MULTI_USER_MODE) {
      messages = [];
      lastActivity = Date.now();
    }
  }
}

async function persistState(userId = null) {
  const state = getUserState(userId);
  const dataFile = getDataFile(userId);

  const payload = JSON.stringify(
    {
      messages: state.messages,
      lastActivity: state.lastActivity
    },
    null,
    2
  );

  const dataDir = path.dirname(dataFile);
  const tmpFile = `${dataFile}.tmp`;

  await ensureDir(dataDir);
  await fs.writeFile(tmpFile, payload, 'utf8');
  await fs.rename(tmpFile, dataFile);
}

// 迁移单用户数据到指定用户
async function migrateLegacyData(targetUserId) {
  const legacyFile = SINGLE_USER_DATA_FILE;
  const legacyUploadsDir = UPLOAD_ROOT;
  const targetDir = getUserDataDir(targetUserId);
  const targetFile = getUserDataFile(targetUserId);
  const targetUploadsDir = getUserUploadRoot(targetUserId);

  // 检查原文件是否存在
  try {
    await fs.access(legacyFile);
  } catch {
    console.log('无单用户数据需要迁移');
    return false;
  }

  // 检查目标文件是否已存在，避免覆盖已有数据
  try {
    const targetStat = await fs.stat(targetFile);
    if (targetStat.size > 0) {
      console.log(`目标用户数据已存在，跳过迁移: ${targetFile}`);
      // 删除遗留的单用户数据文件，避免后续重复检查
      await fs.unlink(legacyFile);
      console.log(`已删除遗留的单用户数据文件: ${legacyFile}`);
      return false;
    }
  } catch {
    // 目标文件不存在，可以继续迁移
  }

  // 确保目标目录存在
  await ensureDir(targetDir);

  // 迁移数据文件
  await fs.rename(legacyFile, targetFile);
  console.log(`已迁移数据文件: ${legacyFile} -> ${targetFile}`);

  // 迁移上传文件
  try {
    await fs.access(legacyUploadsDir);
    await fs.rename(legacyUploadsDir, targetUploadsDir);
    console.log(`已迁移上传目录: ${legacyUploadsDir} -> ${targetUploadsDir}`);
  } catch {
    console.log('上传目录不存在，跳过迁移');
  }

  console.log(`迁移完成，数据已迁移到用户: ${targetUserId}`);
  return true;
}

function schedulePersist(userId = null) {
  persistScheduled = true;
  if (persistRunning) return;

  setImmediate(async () => {
    if (!persistScheduled || persistRunning) return;
    persistScheduled = false;
    persistRunning = true;

    try {
      if (MULTI_USER_MODE) {
        // 多用户模式：持久化所有用户数据
        for (const [uid] of userStates) {
          await persistState(uid);
        }
      } else {
        // 单用户模式
        await persistState(null);
      }
    } catch (error) {
      console.error('持久化消息失败:', error);
    } finally {
      persistRunning = false;
      if (persistScheduled) schedulePersist(userId);
    }
  });
}

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

function getMessagesPage({ before, limit, userId = null }) {
  const state = getUserState(userId);
  const pageLimit = clampPageSize(limit);
  const source = Number.isFinite(before)
    ? state.messages.filter((item) => item.timestamp < before)
    : state.messages;
  const start = Math.max(source.length - pageLimit, 0);
  const page = source.slice(start);

  return {
    messages: page,
    hasMore: start > 0,
    total: state.messages.length
  };
}

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

function cleanupExpiredData(userId = null) {
  const state = getUserState(userId);
  const now = Date.now();
  if (now - state.lastActivity <= EXPIRE_TIME) {
    return;
  }

  // 分离收藏和非收藏消息
  const favoriteMessages = state.messages.filter((msg) => msg.favorite);
  const expiredMessages = state.messages.filter((msg) => !msg.favorite);

  if (expiredMessages.length === 0) {
    return;
  }

  state.messages = favoriteMessages; // 只保留收藏消息
  state.lastActivity = now;
  schedulePersist(userId);

  // 只删除非收藏消息的文件
  Promise.allSettled(expiredMessages.map((msg) => deleteMessageFiles(msg, userId))).catch((error) => {
    console.error('清理过期文件失败:', error);
  });
}

// 多用户模式下清理所有用户数据
async function cleanupAllUsersExpiredData() {
  if (MULTI_USER_MODE) {
    // 扫描磁盘上所有用户目录
    const usersDir = path.join(STORAGE_ROOT, 'users');
    let userDirs = [];
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      userDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('扫描用户目录失败:', error);
      }
      return;
    }

    // 清理每个用户目录
    for (const userId of userDirs) {
      cleanupExpiredData(userId);
    }
  } else {
    cleanupExpiredData(null);
  }
}

async function listAllFilesRecursive(baseDir) {
  const out = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  await walk(baseDir);
  return out;
}

async function removeEmptyDirsRecursive(dirPath, isRoot = true) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await removeEmptyDirsRecursive(path.join(dirPath, entry.name), false);
  }

  const after = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  });

  if (!isRoot && after.length === 0) {
    await fs.rmdir(dirPath).catch((error) => {
      if (error && error.code === 'ENOENT') return;
      throw error;
    });
  }
}

async function cleanupOrphanDiskFiles(userId = null) {
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    const uploadRoot = getUploadRoot(userId);
    const state = getUserState(userId);

    const referenced = new Set();
    for (const msg of state.messages) {
      const refs = getMessageFileRefs(msg);
      refs.forEach((item) => referenced.add(item));
    }

    const allFiles = await listAllFilesRecursive(uploadRoot);
    let removedCount = 0;

    for (const absolutePath of allFiles) {
      const relativePath = toPosixPath(path.relative(uploadRoot, absolutePath));
      if (!referenced.has(relativePath)) {
        await fs.unlink(absolutePath).catch((error) => {
          if (error && error.code === 'ENOENT') return;
          throw error;
        });
        removedCount += 1;
      }
    }

    await removeEmptyDirsRecursive(uploadRoot, true);

    if (removedCount > 0) {
      console.log(`孤儿文件清理完成，用户 ${userId || '单用户'} 删除 ${removedCount} 个文件`);
    }
  } catch (error) {
    console.error('孤儿文件清理失败:', error);
  } finally {
    cleanupRunning = false;
  }
}

// 多用户模式下清理所有用户的孤儿文件
async function cleanupAllUsersOrphanFiles() {
  if (MULTI_USER_MODE) {
    // 扫描磁盘上所有用户目录
    const usersDir = path.join(STORAGE_ROOT, 'users');
    let userDirs = [];
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      userDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('扫描用户目录失败:', error);
      }
    }

    // 清理每个用户目录
    for (const userId of userDirs) {
      await cleanupOrphanDiskFiles(userId);
    }
  } else {
    await cleanupOrphanDiskFiles(null);
  }
}

setInterval(cleanupAllUsersExpiredData, 5 * 60 * 1000);
setInterval(cleanupAllUsersOrphanFiles, FILE_CLEANUP_INTERVAL_MINUTES * 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));

// 多用户模式下的上传目录路由
if (MULTI_USER_MODE) {
  app.use('/uploads/:userId', (req, res, next) => {
    const userId = req.params.userId;
    const userUploadRoot = getUserUploadRoot(userId);
    express.static(userUploadRoot)(req, res, next);
  });
} else {
  app.use('/uploads', express.static(UPLOAD_ROOT));
}

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// 认证中间件：提取 userId
function extractUserId(req, res, next) {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};
  const userId = body.userId || query.userId || headers['x-user-id'];
  req.userId = userId || null;
  next();
}

app.post('/api/auth', (req, res) => {
  const { password } = req.body;

  // 多用户模式
  if (MULTI_USER_MODE) {
    const userId = getUserIdByPassword(password);
    if (userId) {
      return res.json({ success: true, userId, mode: 'multi' });
    }
    return res.status(401).json({ success: false, error: '密码错误' });
  }

  // 单用户模式：无密码模式直接通过
  if (!ACCESS_PASSWORD) {
    return res.json({ success: true, noPassword: true, mode: 'single' });
  }

  if (password === ACCESS_PASSWORD) {
    res.json({ success: true, mode: 'single' });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

app.get('/api/auth/status', (req, res) => {
  if (MULTI_USER_MODE) {
    res.json({
      mode: 'multi',
      requirePassword: true,
      users: Array.from(userPasswordMap.values())
    });
  } else {
    res.json({
      mode: 'single',
      requirePassword: Boolean(ACCESS_PASSWORD)
    });
  }
});

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION, mode: MULTI_USER_MODE ? 'multi' : 'single' });
});

app.get('/api/messages', extractUserId, (req, res) => {
  const userId = req.userId;
  const before = Number(req.query.before);
  const limit = Number(req.query.limit);
  const page = getMessagesPage({ before, limit, userId });

  res.json({
    ...page,
    messages: page.messages.map((msg) => toPublicMessage(msg, userId)),
    expireHours: EXPIRE_HOURS
  });
});

app.post('/api/messages', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { type, content } = req.body;

  if (!type || !content) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const message = {
    id: createMessageId(),
    type,
    content,
    timestamp: Date.now()
  };

  try {
    if (type === 'image') {
      await persistImageContent(message, content, userId);
    } else if (type === 'file') {
      await persistFileContent(message, content, userId);
    } else if (type === 'text') {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: '文本内容不能为空' });
      }
      message.content = content;
    } else {
      return res.status(400).json({ error: '不支持的消息类型' });
    }
  } catch (error) {
    console.error('处理消息失败:', error);
    return res.status(400).json({ error: error.message || '消息内容格式错误' });
  }

  state.messages.push(message);
  state.lastActivity = Date.now();
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('message-new', publicMessage);
  } else {
    io.emit('message-new', publicMessage);
  }

  return res.json({ success: true, message: publicMessage });
});

// multipart/form-data 上传 endpoint
app.post('/api/messages/upload', uploadMiddleware.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '缺少文件' });
  }

  const userId = req.body.userId || null;
  const state = getUserState(userId);
  const uploadRoot = getUploadRoot(userId);

  const type = req.body.type || 'file';
  if (type !== 'image' && type !== 'file') {
    // 删除临时文件
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: '不支持的消息类型' });
  }

  const id = createMessageId();
  const category = type === 'image' ? 'images' : 'files';
  const dateDir = toDateFolder();
  const safeName = sanitizeFilename(req.file.originalname || 'file');
  const parsed = path.parse(safeName);
  const ext = parsed.ext || extensionFromMime(req.file.mimetype) || '';
  const suffix = type === 'image' ? '-orig' : '';
  const filename = category === 'files'
    ? `${id}-${parsed.name}${ext}`
    : `${id}${suffix}${ext}`;

  // 从临时目录移动到正确的用户目录
  const oldPath = req.file.path;
  const newRelativePath = path.join(category, dateDir, filename);
  const newAbsolutePath = path.join(uploadRoot, newRelativePath);

  // 确保目标目录存在
  await ensureDir(path.dirname(newAbsolutePath));

  try {
    await fs.rename(oldPath, newAbsolutePath);
  } catch (error) {
    // 如果跨目录 rename 失败，使用 copy + delete
    await fs.copyFile(oldPath, newAbsolutePath);
    await fs.unlink(oldPath);
  }

  const message = {
    id,
    type,
    content: {},
    timestamp: Date.now()
  };

  if (type === 'image') {
    message.content = {
      originalPath: newRelativePath,
      hasOriginal: true,
      originalMimeType: req.file.mimetype
    };
    // 对于图片，暂无缩略图，后续可按需生成
    message.content.thumbnailPath = newRelativePath;
    message.content.thumbnailMimeType = req.file.mimetype;
  } else {
    message.content = {
      name: safeName,
      size: req.file.size,
      mimeType: req.file.mimetype,
      filePath: newRelativePath
    };
  }

  state.messages.push(message);
  state.lastActivity = Date.now();
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('message-new', publicMessage);
  } else {
    io.emit('message-new', publicMessage);
  }

  return res.json({ success: true, message: publicMessage });
});

app.get('/api/messages/:id/image-original', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }
  if (message.type !== 'image') {
    return res.status(400).json({ error: '该消息不是图片' });
  }

  const content = message.content;

  if (content && typeof content === 'object' && typeof content.originalPath === 'string') {
    try {
      const absolute = resolveUploadAbsolute(content.originalPath, userId);
      const binary = await fs.readFile(absolute);
      const mimeType = content.originalMimeType || 'image/png';
      const original = `data:${mimeType};base64,${binary.toString('base64')}`;
      return res.json({ id: message.id, original });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return res.status(404).json({ error: '原图不存在' });
      }
      console.error('读取原图失败:', error);
      return res.status(500).json({ error: '读取原图失败' });
    }
  }

  const legacy = normalizeImageIncomingContent(content);
  if (legacy) {
    return res.json({ id: message.id, original: legacy.original });
  }

  return res.status(404).json({ error: '原图不存在' });
});

app.get('/api/messages/:id/file-download', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }
  if (message.type !== 'file') {
    return res.status(400).json({ error: '该消息不是文件' });
  }

  const content = message.content;
  if (!content || typeof content !== 'object' || typeof content.filePath !== 'string') {
    return res.status(404).json({ error: '文件不存在' });
  }

  try {
    const absolute = resolveUploadAbsolute(content.filePath, userId);
    return res.download(absolute, content.name);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: '文件不存在' });
    }
    console.error('下载文件失败:', error);
    return res.status(500).json({ error: '下载文件失败' });
  }
});

app.delete('/api/messages/:id', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;

  const index = state.messages.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({ error: '消息不存在' });
  }

  const [removed] = state.messages.splice(index, 1);
  state.lastActivity = Date.now();
  schedulePersist(userId);

  await deleteMessageFiles(removed, userId);

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('message-delete', id);
  } else {
    io.emit('message-delete', id);
  }

  return res.json({ success: true });
});

app.post('/api/messages/clear', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);

  // 分离收藏和非收藏消息
  const favoriteMessages = state.messages.filter((msg) => msg.favorite);
  const removedMessages = state.messages.filter((msg) => !msg.favorite);

  state.messages = favoriteMessages; // 只保留收藏消息
  state.lastActivity = Date.now();
  schedulePersist(userId);

  // 只删除非收藏消息的文件
  await Promise.allSettled(removedMessages.map((msg) => deleteMessageFiles(msg, userId)));

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('messages-clear', { favoriteCount: favoriteMessages.length });
  } else {
    io.emit('messages-clear', { favoriteCount: favoriteMessages.length });
  }

  return res.json({ success: true, favoriteCount: favoriteMessages.length });
});

// 获取收藏消息列表
app.get('/api/favorites', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const favorites = state.messages.filter((msg) => msg.favorite);
  res.json({
    messages: favorites.map((msg) => toPublicMessage(msg, userId)),
    total: favorites.length
  });
});

// 收藏消息
app.post('/api/messages/:id/favorite', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = true;
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('message-favorite', { id, favorite: true, message: publicMessage });
  } else {
    io.emit('message-favorite', { id, favorite: true, message: publicMessage });
  }

  return res.json({ success: true, message: publicMessage });
});

// 取消收藏
app.delete('/api/messages/:id/favorite', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = false;
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  // 多用户模式：只向该用户的房间广播
  if (MULTI_USER_MODE && userId) {
    io.to(userId).emit('message-favorite', { id, favorite: false, message: publicMessage });
  } else {
    io.emit('message-favorite', { id, favorite: false, message: publicMessage });
  }

  return res.json({ success: true, message: publicMessage });
});

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 多用户模式下，等待客户端发送 userId 加入房间
  if (MULTI_USER_MODE) {
    socket.on('join', (userId) => {
      if (userId) {
        socket.join(userId);
        console.log(`用户 ${socket.id} 加入房间: ${userId}`);

        const initialPage = getMessagesPage({
          before: Number.NaN,
          limit: SOCKET_SYNC_LIMIT,
          userId
        });

        socket.emit('sync', {
          ...initialPage,
          messages: initialPage.messages.map((msg) => toPublicMessage(msg, userId))
        });
      }
    });
  } else {
    // 单用户模式：直接同步
    const initialPage = getMessagesPage({
      before: Number.NaN,
      limit: SOCKET_SYNC_LIMIT
    });

    socket.emit('sync', {
      ...initialPage,
      messages: initialPage.messages.map((msg) => toPublicMessage(msg))
    });
  }

  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

async function start() {
  await ensureDir(STORAGE_ROOT);

  // 多用户模式
  if (MULTI_USER_MODE) {
    // 检查是否需要迁移单用户数据
    if (MIGRATE_DEFAULT_USER) {
      try {
        const migrated = await migrateLegacyData(MIGRATE_DEFAULT_USER);
        if (migrated) {
          // 加载迁移后的用户数据
          await loadPersistedState(MIGRATE_DEFAULT_USER);
        }
      } catch (error) {
        console.error('迁移数据失败:', error);
      }
    } else {
      // 检查是否有遗留的单用户数据
      try {
        await fs.access(SINGLE_USER_DATA_FILE);
        console.warn('⚠️ 检测到单用户数据遗留，请设置 MIGRATE_DEFAULT_USER=<userId> 指定迁移目标');
      } catch {
        // 无遗留数据
      }
    }

    // 加载所有用户的数据
    for (const [password, userId] of userPasswordMap) {
      await loadPersistedState(userId);
      await cleanupOrphanDiskFiles(userId);
    }
  } else {
    // 单用户模式
    await ensureDir(UPLOAD_ROOT);
    await loadPersistedState(null);
    await cleanupOrphanDiskFiles(null);
  }

  server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`运行模式: ${MULTI_USER_MODE ? '多用户' : '单用户'}`);
    if (MULTI_USER_MODE) {
      console.log(`用户数量: ${userPasswordMap.size}`);
      console.log(`用户列表: ${Array.from(userPasswordMap.values()).join(', ')}`);
    }
    console.log(`密码保护: ${MULTI_USER_MODE ? '已启用' : (ACCESS_PASSWORD ? '已启用' : '未启用（无密码模式）')}`);
    console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
    console.log(`数据存储目录: ${STORAGE_ROOT}`);
    console.log(`孤儿文件清理间隔: ${FILE_CLEANUP_INTERVAL_MINUTES} 分钟`);
  });
}

start().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});
