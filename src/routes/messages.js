const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { MULTI_USER_MODE, EXPIRE_HOURS } = require('../config');
const { extractUserId } = require('./auth');
const { getUserState, getMessagesPage, schedulePersist } = require('../storage');
const { getUploadRoot, getUserUploadRoot, getDataFile, SINGLE_USER_DATA_FILE } = require('../storage');
const { uploadMiddleware, resolveUploadAbsolute, deleteMessageFiles, removeFileIfExists } = require('../upload');
const { toPublicMessage, persistImageContent, persistFileContent } = require('../message');
const { createMessageId, toDateFolder, sanitizeFilename, extensionFromMime, ensureDir, toPosixPath, normalizeImageIncomingContent, decodeDataUrl } = require('../utils');

const router = express.Router();

// 获取消息列表
router.get('/', extractUserId, (req, res) => {
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

// 创建消息（文本）
router.post('/', extractUserId, async (req, res) => {
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

  // 广播消息（需要通过 app.js 传入 io）
  req.app.get('io').broadcastMessage(userId, publicMessage);

  return res.json({ success: true, message: publicMessage });
});

// multipart/form-data 上传
router.post('/upload', uploadMiddleware.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '缺少文件' });
  }

  const userId = req.body.userId || null;
  const state = getUserState(userId);
  const uploadRoot = getUploadRoot(userId);

  const type = req.body.type || 'file';
  if (type !== 'image' && type !== 'file') {
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

  const oldPath = req.file.path;
  const newRelativePath = path.join(category, dateDir, filename);
  const newAbsolutePath = path.join(uploadRoot, newRelativePath);

  await ensureDir(path.dirname(newAbsolutePath));

  try {
    await fs.rename(oldPath, newAbsolutePath);
  } catch (error) {
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

  req.app.get('io').broadcastMessage(userId, publicMessage);

  return res.json({ success: true, message: publicMessage });
});

// 获取原图
router.get('/:id/image-original', extractUserId, async (req, res) => {
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

// 文件下载
router.get('/:id/file-download', extractUserId, async (req, res) => {
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

// 删除消息
router.delete('/:id', extractUserId, async (req, res) => {
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

  req.app.get('io').broadcastDelete(userId, id);

  return res.json({ success: true });
});

// 清空消息
router.post('/clear', extractUserId, async (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);

  const favoriteMessages = state.messages.filter((msg) => msg.favorite);
  const removedMessages = state.messages.filter((msg) => !msg.favorite);

  state.messages = favoriteMessages;
  state.lastActivity = Date.now();
  schedulePersist(userId);

  await Promise.allSettled(removedMessages.map((msg) => deleteMessageFiles(msg, userId)));

  req.app.get('io').broadcastClear(userId, { favoriteCount: favoriteMessages.length });

  return res.json({ success: true, favoriteCount: favoriteMessages.length });
});

module.exports = router;