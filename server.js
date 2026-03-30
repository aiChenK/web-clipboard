const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const EXPIRE_HOURS = Number.parseInt(process.env.EXPIRE_HOURS, 10) || 168;
const MESSAGE_PAGE_SIZE = Number.parseInt(process.env.MESSAGE_PAGE_SIZE, 10) || 30;
const SOCKET_SYNC_LIMIT = Number.parseInt(process.env.SOCKET_SYNC_LIMIT, 10) || 20;

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, 'data');
const DATA_FILE = process.env.DATA_FILE || path.join(STORAGE_ROOT, 'messages.json');
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(STORAGE_ROOT, 'uploads');
const FILE_CLEANUP_INTERVAL_MINUTES = Number.parseInt(process.env.FILE_CLEANUP_INTERVAL_MINUTES, 10) || 30;
const APP_VERSION = process.env.APP_VERSION || process.env.npm_package_version || require('./package.json').version || '1.0';

let messages = [];
let lastActivity = Date.now();
let persistScheduled = false;
let persistRunning = false;
let cleanupRunning = false;

const EXPIRE_TIME = EXPIRE_HOURS * 60 * 60 * 1000;

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

function toUploadUrl(relativePath) {
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

async function writeBinaryToUpload({ category, id, buffer, mimeType, filenameHint, suffix = '' }) {
  const dateDir = toDateFolder();
  const safeHint = sanitizeFilename(filenameHint || 'file');
  const finalName = withPreferredExt(safeHint, extensionFromMime(mimeType));
  const parsed = path.parse(finalName);
  const leaf = category === 'files'
    ? `${id}-${parsed.name}${parsed.ext}`
    : `${id}${suffix}${parsed.ext || extensionFromMime(mimeType) || '.bin'}`;

  const relativePath = path.join(category, dateDir, leaf);
  const absolutePath = path.join(UPLOAD_ROOT, relativePath);

  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, buffer);

  return toPosixPath(relativePath);
}

function resolveUploadAbsolute(relativePath) {
  const absolutePath = path.resolve(UPLOAD_ROOT, relativePath);
  const rootWithSep = `${path.resolve(UPLOAD_ROOT)}${path.sep}`;
  if (absolutePath !== path.resolve(UPLOAD_ROOT) && !absolutePath.startsWith(rootWithSep)) {
    throw new Error('invalid upload path');
  }
  return absolutePath;
}

async function removeFileIfExists(relativePath) {
  if (!relativePath) return;
  try {
    const absolute = resolveUploadAbsolute(relativePath);
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

async function deleteMessageFiles(message) {
  const refs = getMessageFileRefs(message);
  for (const filePath of refs) {
    await removeFileIfExists(filePath);
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

async function loadPersistedState() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizePersistedState(parsed);
    messages = normalized.messages;
    lastActivity = normalized.lastActivity;
    console.log(`已加载持久化数据: ${messages.length} 条, 文件: ${DATA_FILE}`);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`未找到持久化文件，使用空数据启动: ${DATA_FILE}`);
      return;
    }
    console.error('读取持久化数据失败，使用空数据启动:', error);
    messages = [];
    lastActivity = Date.now();
  }
}

async function persistState() {
  const payload = JSON.stringify(
    {
      messages,
      lastActivity
    },
    null,
    2
  );

  const dataDir = path.dirname(DATA_FILE);
  const tmpFile = `${DATA_FILE}.tmp`;

  await ensureDir(dataDir);
  await fs.writeFile(tmpFile, payload, 'utf8');
  await fs.rename(tmpFile, DATA_FILE);
}

function schedulePersist() {
  persistScheduled = true;
  if (persistRunning) return;

  setImmediate(async () => {
    if (!persistScheduled || persistRunning) return;
    persistScheduled = false;
    persistRunning = true;

    try {
      await persistState();
    } catch (error) {
      console.error('持久化消息失败:', error);
    } finally {
      persistRunning = false;
      if (persistScheduled) schedulePersist();
    }
  });
}

function toPublicMessage(message) {
  const result = { ...message, favorite: Boolean(message.favorite) };

  if (message.type === 'image') {
    const content = message.content;

    if (content && typeof content === 'object' && typeof content.thumbnailPath === 'string') {
      const thumbnailUrl = toUploadUrl(content.thumbnailPath);
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
        url: toUploadUrl(content.filePath)
      };
      return result;
    }
  }

  return result;
}

function getMessagesPage({ before, limit }) {
  const pageLimit = clampPageSize(limit);
  const source = Number.isFinite(before)
    ? messages.filter((item) => item.timestamp < before)
    : messages;
  const start = Math.max(source.length - pageLimit, 0);
  const page = source.slice(start);

  return {
    messages: page,
    hasMore: start > 0,
    total: messages.length
  };
}

async function persistImageContent(message, content) {
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
    suffix: '-orig'
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
      suffix: '-thumb'
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

async function persistFileContent(message, content) {
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
    filenameHint: originalName
  });

  message.content = {
    name: originalName,
    size: decoded.buffer.length,
    mimeType: decoded.mimeType,
    filePath
  };
}

function cleanupExpiredData() {
  const now = Date.now();
  if (now - lastActivity <= EXPIRE_TIME) {
    return;
  }

  // 分离收藏和非收藏消息
  const favoriteMessages = messages.filter((msg) => msg.favorite);
  const expiredMessages = messages.filter((msg) => !msg.favorite);

  if (expiredMessages.length === 0) {
    return;
  }

  messages = favoriteMessages; // 只保留收藏消息
  lastActivity = now;
  schedulePersist();

  // 只删除非收藏消息的文件
  Promise.allSettled(expiredMessages.map((msg) => deleteMessageFiles(msg))).catch((error) => {
    console.error('清理过期文件失败:', error);
  });
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

async function cleanupOrphanDiskFiles() {
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    const referenced = new Set();
    for (const msg of messages) {
      const refs = getMessageFileRefs(msg);
      refs.forEach((item) => referenced.add(item));
    }

    const allFiles = await listAllFilesRecursive(UPLOAD_ROOT);
    let removedCount = 0;

    for (const absolutePath of allFiles) {
      const relativePath = toPosixPath(path.relative(UPLOAD_ROOT, absolutePath));
      if (!referenced.has(relativePath)) {
        await fs.unlink(absolutePath).catch((error) => {
          if (error && error.code === 'ENOENT') return;
          throw error;
        });
        removedCount += 1;
      }
    }

    await removeEmptyDirsRecursive(UPLOAD_ROOT, true);

    if (removedCount > 0) {
      console.log(`孤儿文件清理完成，删除 ${removedCount} 个文件`);
    }
  } catch (error) {
    console.error('孤儿文件清理失败:', error);
  } finally {
    cleanupRunning = false;
  }
}

setInterval(cleanupExpiredData, 5 * 60 * 1000);
setInterval(cleanupOrphanDiskFiles, FILE_CLEANUP_INTERVAL_MINUTES * 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_ROOT));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.post('/api/auth', (req, res) => {
  const { password } = req.body;

  // 无密码模式：直接通过
  if (!ACCESS_PASSWORD) {
    return res.json({ success: true, noPassword: true });
  }

  if (password === ACCESS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({ requirePassword: Boolean(ACCESS_PASSWORD) });
});

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get('/api/messages', (req, res) => {
  const before = Number(req.query.before);
  const limit = Number(req.query.limit);
  const page = getMessagesPage({ before, limit });

  res.json({
    ...page,
    messages: page.messages.map(toPublicMessage),
    expireHours: EXPIRE_HOURS
  });
});

app.post('/api/messages', async (req, res) => {
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
      await persistImageContent(message, content);
    } else if (type === 'file') {
      await persistFileContent(message, content);
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

  messages.push(message);
  lastActivity = Date.now();
  schedulePersist();

  const publicMessage = toPublicMessage(message);
  io.emit('message-new', publicMessage);

  return res.json({ success: true, message: publicMessage });
});

app.get('/api/messages/:id/image-original', async (req, res) => {
  const { id } = req.params;
  const message = messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }
  if (message.type !== 'image') {
    return res.status(400).json({ error: '该消息不是图片' });
  }

  const content = message.content;

  if (content && typeof content === 'object' && typeof content.originalPath === 'string') {
    try {
      const absolute = resolveUploadAbsolute(content.originalPath);
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

app.get('/api/messages/:id/file-download', async (req, res) => {
  const { id } = req.params;
  const message = messages.find((item) => item.id === id);
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
    const absolute = resolveUploadAbsolute(content.filePath);
    return res.download(absolute, content.name);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: '文件不存在' });
    }
    console.error('下载文件失败:', error);
    return res.status(500).json({ error: '下载文件失败' });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  const { id } = req.params;

  const index = messages.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({ error: '消息不存在' });
  }

  const [removed] = messages.splice(index, 1);
  lastActivity = Date.now();
  schedulePersist();

  await deleteMessageFiles(removed);

  io.emit('message-delete', id);

  return res.json({ success: true });
});

app.post('/api/messages/clear', async (req, res) => {
  // 分离收藏和非收藏消息
  const favoriteMessages = messages.filter((msg) => msg.favorite);
  const removedMessages = messages.filter((msg) => !msg.favorite);

  messages = favoriteMessages; // 只保留收藏消息
  lastActivity = Date.now();
  schedulePersist();

  // 只删除非收藏消息的文件
  await Promise.allSettled(removedMessages.map((msg) => deleteMessageFiles(msg)));

  io.emit('messages-clear', { favoriteCount: favoriteMessages.length });

  return res.json({ success: true, favoriteCount: favoriteMessages.length });
});

// 获取收藏消息列表
app.get('/api/favorites', (req, res) => {
  const favorites = messages.filter((msg) => msg.favorite);
  res.json({
    messages: favorites.map(toPublicMessage),
    total: favorites.length
  });
});

// 收藏消息
app.post('/api/messages/:id/favorite', (req, res) => {
  const { id } = req.params;
  const message = messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = true;
  schedulePersist();

  const publicMessage = toPublicMessage(message);
  io.emit('message-favorite', { id, favorite: true, message: publicMessage });

  return res.json({ success: true, message: publicMessage });
});

// 取消收藏
app.delete('/api/messages/:id/favorite', (req, res) => {
  const { id } = req.params;
  const message = messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = false;
  schedulePersist();

  const publicMessage = toPublicMessage(message);
  io.emit('message-favorite', { id, favorite: false, message: publicMessage });

  return res.json({ success: true, message: publicMessage });
});

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  const initialPage = getMessagesPage({
    before: Number.NaN,
    limit: SOCKET_SYNC_LIMIT
  });

  socket.emit('sync', {
    ...initialPage,
    messages: initialPage.messages.map(toPublicMessage)
  });

  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

async function start() {
  await ensureDir(STORAGE_ROOT);
  await ensureDir(UPLOAD_ROOT);

  await loadPersistedState();
  await cleanupOrphanDiskFiles();

  server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`密码保护: ${ACCESS_PASSWORD ? '已启用' : '未启用（无密码模式）'}`);
    console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
    console.log(`消息持久化文件: ${DATA_FILE}`);
    console.log(`上传目录: ${UPLOAD_ROOT}`);
    console.log(`孤儿文件清理间隔: ${FILE_CLEANUP_INTERVAL_MINUTES} 分钟`);
  });
}

start().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});
