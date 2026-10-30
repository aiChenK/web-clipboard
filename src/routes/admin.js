/**
 * 管理端 API
 *
 * - 未配置 ADMIN_PASSWORD 时整个管理端（页面与接口）按不存在处理，一律 404
 * - 鉴权：请求头 x-admin-password（也兼容请求体/查询参数），与主应用保持同一套无会话风格
 * - 用户表为唯一真相源，增删改即时生效，无需重启
 */

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const {
  ADMIN_PASSWORD,
  APP_VERSION,
  USERS_FILE,
  STORAGE_ROOT,
  EXPIRE_HOURS,
  MESSAGE_PAGE_SIZE,
  SHARE_MAX_EXPIRE_HOURS
} = require('../config');
const {
  isMultiUserMode,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  isValidUserId,
  normalizeUserId,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH
} = require('../users');
const {
  getUserState,
  dropUserState,
  getUserDataDir,
  loadPersistedState,
  migrateLegacyData,
  SINGLE_USER_DATA_FILE
} = require('../storage');
const { timingSafeCompare } = require('../utils');
const { syncModeAfterUserChange, getCurrentMode } = require('../mode');
const { socketHelper } = require('../socket');
const { deleteSharesByUser, getShareList } = require('../share');

const router = express.Router();

// ========== 鉴权 ==========

router.use((req, res, next) => {
  if (!ADMIN_PASSWORD) {
    return res.status(404).json({ error: 'Not Found' });
  }
  next();
});

function requireAdmin(req, res, next) {
  const headers = req.headers || {};
  const password = headers['x-admin-password'] || (req.body && req.body.adminPassword) || req.query.adminPassword || '';

  if (typeof password !== 'string' || !password || !timingSafeCompare(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '管理密码错误' });
  }

  return next();
}

router.use(requireAdmin);

// ========== 工具 ==========

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// 目录体积统计（15 秒缓存，避免频繁遍历磁盘）
const DIR_SIZE_TTL_MS = 15000;
const dirSizeCache = new Map();

async function computeDirSize(dir) {
  let total = 0;
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = await fs.stat(fullPath);
          total += stats.size;
        } catch {
          // 文件可能刚好被清理，忽略
        }
      }
    }
  }

  return total;
}

async function getUserStorageBytes(userId) {
  const cached = dirSizeCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.bytes;

  const bytes = await computeDirSize(getUserDataDir(userId)).catch(() => 0);
  dirSizeCache.set(userId, { bytes, expiresAt: Date.now() + DIR_SIZE_TTL_MS });
  return bytes;
}

async function legacyDataExists() {
  try {
    await fs.access(SINGLE_USER_DATA_FILE);
    return true;
  } catch {
    return false;
  }
}

function sendResultError(res, result) {
  const statusMap = {
    not_found: 404,
    exists: 409,
    last_user: 409,
    invalid_id: 400,
    invalid_password: 400,
    io_error: 500
  };
  return res.status(statusMap[result.code] || 400).json({ error: result.error });
}

// ========== 会话与运行时信息 ==========

router.get('/session', wrap(async (req, res) => {
  res.json({
    ok: true,
    mode: getCurrentMode(),
    version: APP_VERSION,
    userCount: listUsers().length,
    legacyDataPending: !isMultiUserMode() && (await legacyDataExists())
  });
}));

router.get('/status', wrap(async (req, res) => {
  const users = listUsers();
  let shareCount = 0;

  try {
    shareCount = (await getShareList(null)).length;
  } catch {
    shareCount = 0;
  }

  res.json({
    mode: getCurrentMode(),
    version: APP_VERSION,
    userCount: users.length,
    enabledUserCount: users.filter((user) => user.enabled).length,
    shareCount,
    storageRoot: STORAGE_ROOT,
    usersFile: USERS_FILE,
    expireHours: EXPIRE_HOURS,
    messagePageSize: MESSAGE_PAGE_SIZE,
    shareMaxExpireHours: SHARE_MAX_EXPIRE_HOURS,
    legacyDataPending: await legacyDataExists(),
    usersFileExists: await fs.access(USERS_FILE).then(() => true, () => false)
  });
}));

// ========== 用户列表 ==========

router.get('/users', wrap(async (req, res) => {
  const users = listUsers();

  const enriched = await Promise.all(
    users.map(async (user) => {
      const state = getUserState(user.id);
      const messages = state.messages || [];
      const favoriteCount = messages.filter((message) => message.favorite).length;

      return {
        ...user,
        messageCount: messages.length,
        favoriteCount,
        storageBytes: await getUserStorageBytes(user.id),
        lastActivity: state.lastActivity || null,
        hasDataDir: await fs.access(getUserDataDir(user.id)).then(() => true, () => false)
      };
    })
  );

  res.json({
    users: enriched,
    limits: {
      passwordMinLength: PASSWORD_MIN_LENGTH,
      passwordMaxLength: PASSWORD_MAX_LENGTH,
      displayNameMaxLength: DISPLAY_NAME_MAX_LENGTH
    }
  });
}));

// ========== 新建用户 ==========

router.post('/users', wrap(async (req, res) => {
  const { id, password, displayName, migrateLegacy } = req.body || {};
  const previousMode = getCurrentMode();

  const result = await createUser({ id, password, displayName });
  if (!result.ok) return sendResultError(res, result);

  let migrated = false;
  if (migrateLegacy && (await legacyDataExists())) {
    try {
      migrated = await migrateLegacyData(result.user.id);
      if (migrated) {
        await loadPersistedState(result.user.id);
      }
    } catch (error) {
      console.error('迁移单用户数据失败:', error);
    }
  }

  const modeChange = await syncModeAfterUserChange(previousMode);

  return res.status(201).json({
    user: result.user,
    migrated,
    mode: modeChange.currentMode,
    modeChanged: modeChange.changed,
    sharesCleared: modeChange.clearedShares
  });
}));

// ========== 修改用户（显示名 / 启用状态 / 重置密码） ==========

router.patch('/users/:id', wrap(async (req, res) => {
  const userId = normalizeUserId(req.params.id);
  const { displayName, enabled, password } = req.body || {};

  const patch = {};
  if (displayName !== undefined) patch.displayName = displayName;
  if (enabled !== undefined) patch.enabled = Boolean(enabled);
  if (password !== undefined && password !== null && password !== '') patch.password = password;

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: '没有需要修改的字段' });
  }

  const result = await updateUser(userId, patch);
  if (!result.ok) return sendResultError(res, result);

  // 改密或禁用后立刻断开会话，强制客户端用新凭证重新登录
  if (patch.password !== undefined || patch.enabled === false) {
    socketHelper.disconnectUser(userId);
  }

  return res.json({ user: result.user });
}));

// ========== 删除用户 ==========

router.delete('/users/:id', wrap(async (req, res) => {
  const userId = normalizeUserId(req.params.id);
  if (!isValidUserId(userId)) {
    return res.status(400).json({ error: '用户名非法' });
  }

  const purge = req.query.purge === '1' || req.query.purge === 'true';
  // force=1 表示已确认「删除最后一个用户、退回单用户模式」的后果
  const allowLastUser = req.query.force === '1' || req.query.force === 'true';
  const previousMode = getCurrentMode();

  const result = await deleteUser(userId, { allowLastUser });
  if (!result.ok) return sendResultError(res, result);

  socketHelper.disconnectUser(userId);
  dropUserState(userId);
  dirSizeCache.delete(userId);

  const sharesDeleted = await deleteSharesByUser(userId);

  let purged = false;
  if (purge) {
    try {
      await fs.rm(getUserDataDir(userId), { recursive: true, force: true });
      purged = true;
    } catch (error) {
      console.error(`清除用户 ${userId} 数据目录失败:`, error);
    }
  }

  const modeChange = await syncModeAfterUserChange(previousMode);

  return res.json({
    deleted: result.user.id,
    purged,
    sharesDeleted,
    mode: modeChange.currentMode,
    modeChanged: modeChange.changed
  });
}));

// ========== 单个用户详情（含数据目录状态） ==========

router.get('/users/:id', wrap(async (req, res) => {
  const userId = normalizeUserId(req.params.id);
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const state = getUserState(userId);

  res.json({
    user: {
      id: user.id,
      displayName: user.displayName || '',
      enabled: Boolean(user.enabled),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
    stats: {
      messageCount: (state.messages || []).length,
      favoriteCount: (state.messages || []).filter((message) => message.favorite).length,
      storageBytes: await getUserStorageBytes(userId),
      lastActivity: state.lastActivity || null,
      hasDataDir: await fs.access(getUserDataDir(userId)).then(() => true, () => false)
    }
  });
}));

// ========== 手工迁移遗留单用户数据 ==========

router.post('/migrate-legacy', wrap(async (req, res) => {
  const userId = normalizeUserId((req.body || {}).userId);
  const user = getUser(userId);

  if (!user) return res.status(404).json({ error: '目标用户不存在' });
  if (!(await legacyDataExists())) {
    return res.status(409).json({ error: '没有可迁移的单用户数据' });
  }

  const migrated = await migrateLegacyData(userId);
  if (migrated) {
    await loadPersistedState(userId);
    dirSizeCache.delete(userId);
  }

  return res.json({ migrated, userId });
}));

// 统一错误出口：避免把堆栈泄漏给客户端
router.use((error, req, res, next) => {
  console.error('管理端接口异常:', error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: '管理端内部错误' });
});

module.exports = router;
