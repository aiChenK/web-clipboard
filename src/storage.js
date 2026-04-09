const fs = require('fs/promises');
const path = require('path');
const { MULTI_USER_MODE, STORAGE_ROOT, UPLOAD_ROOT, MIGRATE_DEFAULT_USER, userPasswordMap } = require('./config');
const { ensureDir, clampPageSize } = require('./utils');

// 用户数据存储结构: userId -> { messages, lastActivity }
const userStates = new Map();

// 全局状态（单用户模式使用）
let messages = [];
let lastActivity = Date.now();
let persistScheduled = false;
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
      messages = normalized.messages;
      lastActivity = normalized.lastActivity;
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
      messages = [];
      lastActivity = Date.now();
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

// 调度持久化
function schedulePersist(userId = null) {
  persistScheduled = true;
  if (persistRunning) return;

  setImmediate(async () => {
    if (!persistScheduled || persistRunning) return;
    persistScheduled = false;
    persistRunning = true;

    try {
      if (MULTI_USER_MODE) {
        for (const [uid] of userStates) {
          await persistState(uid);
        }
      } else {
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

// 获取消息分页
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
  getMessagesPage
};