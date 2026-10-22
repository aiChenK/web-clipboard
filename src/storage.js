const fs = require('fs/promises');
const path = require('path');
const { MULTI_USER_MODE, STORAGE_ROOT, UPLOAD_ROOT, MIGRATE_DEFAULT_USER, userPasswordMap } = require('./config');
const { ensureDir, clampPageSize } = require('./utils');

// 用户数据存储结构: userId -> { messages, lastActivity }
const userStates = new Map();

// 全局状态（单用户模式使用）
const singleUserState = {
  messages: [],
  lastActivity: Date.now()
};
const dirtyUserIds = new Set();
let persistRunning = false;

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

// 单用户模式的数据文件路径
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
    return singleUserState;
  }

  if (!userStates.has(userId)) {
    userStates.set(userId, { messages: [], lastActivity: Date.now() });
  }
  return userStates.get(userId);
}

// 通过密码获取用户ID
function getUserIdByPassword(password) {
  if (!MULTI_USER_MODE) {
    return null;
  }
  return userPasswordMap.get(password) || null;
}

// 规范化持久化状态
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
      message.favorite = Boolean(message.favorite);
      message.remark = typeof message.remark === 'string' ? message.remark : '';
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

// 加载持久化状态
async function loadPersistedState(userId = null) {
  const dataFile = getDataFile(userId);

  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizePersistedState(parsed);

    if (!MULTI_USER_MODE) {
      singleUserState.messages = normalized.messages;
      singleUserState.lastActivity = normalized.lastActivity;
    } else {
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
      singleUserState.messages = [];
      singleUserState.lastActivity = Date.now();
    }
  }
}

// 持久化状态
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
      await fs.unlink(legacyFile);
      console.log(`已删除遗留的单用户数据文件: ${legacyFile}`);
      return false;
    }
  } catch {
    // 目标文件不存在，可以继续迁移
  }

  await ensureDir(targetDir);

  await fs.rename(legacyFile, targetFile);
  console.log(`已迁移数据文件: ${legacyFile} -> ${targetFile}`);

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

// 调度持久化（定向增量落盘，避免多用户写入放大）
function schedulePersist(userId = null) {
  dirtyUserIds.add(userId);
  if (persistRunning) return;

  setImmediate(async () => {
    if (dirtyUserIds.size === 0 || persistRunning) return;
    persistRunning = true;

    // 取出当前批次的脏用户集合
    const targetUsers = Array.from(dirtyUserIds);
    dirtyUserIds.clear();

    try {
      if (MULTI_USER_MODE) {
        for (const uid of targetUsers) {
          if (uid) {
            await persistState(uid);
          }
        }
      } else {
        await persistState(null);
      }
    } catch (error) {
      console.error('持久化消息失败:', error);
    } finally {
      persistRunning = false;
      if (dirtyUserIds.size > 0) {
        schedulePersist();
      }
    }
  });
}

// 判断消息是否为视频消息
function isVideoMessage(item) {
  if (!item || item.type !== 'file' || !item.content) return false;
  const content = item.content;
  if (typeof content.mimeType === 'string' && content.mimeType.toLowerCase().startsWith('video/')) {
    return true;
  }
  const name = typeof content.name === 'string' ? content.name : '';
  return /\.(mp4|mov|webm|mkv|avi|m4v|flv|wmv)$/i.test(name);
}

// 检查单条消息是否符合分类要求
function matchesCategory(item, category) {
  if (!category || category === 'all') return true;
  if (category === 'text') {
    return item.type === 'text';
  }
  if (category === 'image') {
    return item.type === 'image';
  }
  if (category === 'video') {
    return isVideoMessage(item);
  }
  if (category === 'file') {
    return item.type === 'file' && !isVideoMessage(item);
  }
  return true;
}

// 检查单条消息是否符合关键词搜索
function matchesKeyword(item, keyword) {
  if (!keyword) return true;
  const lowerKeyword = keyword.toLowerCase();

  // 1. 匹配备注 remark
  if (item.remark && typeof item.remark === 'string' && item.remark.toLowerCase().includes(lowerKeyword)) {
    return true;
  }

  // 2. 匹配文本内容
  if (item.type === 'text') {
    return typeof item.content === 'string' && item.content.toLowerCase().includes(lowerKeyword);
  }

  // 3. 匹配文件/视频的文件名
  if (item.type === 'file' && item.content && typeof item.content.name === 'string') {
    return item.content.name.toLowerCase().includes(lowerKeyword);
  }

  return false;
}

// 统一过滤函数
function filterMessages(messages, { keyword, category } = {}) {
  const normKeyword = typeof keyword === 'string' ? keyword.trim() : '';
  const normCategory = typeof category === 'string' ? category.trim() : 'all';

  if (!normKeyword && (!normCategory || normCategory === 'all')) {
    return messages;
  }

  return messages.filter((item) => {
    return matchesCategory(item, normCategory) && matchesKeyword(item, normKeyword);
  });
}

// 获取消息分页
function getMessagesPage({ before, limit, userId = null, keyword = null, category = null }) {
  const state = getUserState(userId);
  const pageLimit = clampPageSize(limit);
  
  // 1. 先进行分类和关键词过滤
  const filteredMessages = filterMessages(state.messages, { keyword, category });

  // 2. 沿用基于时间戳的游标分页
  const source = Number.isFinite(before)
    ? filteredMessages.filter((item) => item.timestamp < before)
    : filteredMessages;
  const start = Math.max(source.length - pageLimit, 0);
  const page = source.slice(start);

  return {
    messages: page,
    hasMore: start > 0,
    total: filteredMessages.length
  };
}

module.exports = {
  // 状态变量
  userStates,

  // 目录路径函数
  getUserDataDir,
  getUserDataFile,
  getUserUploadRoot,
  getDataFile,
  getUploadRoot,
  SINGLE_USER_DATA_FILE,

  // 状态管理函数
  getUserState,
  getUserIdByPassword,

  // 持久化函数
  normalizePersistedState,
  loadPersistedState,
  persistState,
  migrateLegacyData,
  schedulePersist,

  // 分页函数
  getMessagesPage,

  // 搜索与过滤工具函数
  filterMessages,
  isVideoMessage,
  matchesCategory,
  matchesKeyword
};