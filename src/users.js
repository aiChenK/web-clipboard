/**
 * 用户表存储与凭证校验
 *
 * - users.json 是多用户模式的唯一真相源（内存中维护一份 Map 快照，启动时加载）
 * - 密码使用 scrypt + 每用户独立 salt 哈希，文件内不保存明文
 * - 多用户模式判定：用户表非空即多用户，因此新增/删除用户可即时生效、无需重启
 * - ACCESS_PASSWORDS 仅在 users.json 不存在时作为一次性种子导入
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  USERS_FILE,
  USER_ID_PATTERN,
  envUserSeeds,
  envUserSeedErrors,
  envUserSeedWarnings
} = require('./config');
const { ensureDir } = require('./utils');

const USERS_FILE_VERSION = 1;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 128;
const DISPLAY_NAME_MAX_LENGTH = 32;

// scrypt 参数：N=16384 约 50-100ms/次，配合凭证缓存在请求链路上几乎无感
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// 凭证缓存：避免每个 API 请求都跑一次 scrypt（key 为 userId + sha256(password)，不落盘、不含明文）
const CREDENTIAL_CACHE_TTL_MS = 10 * 60 * 1000;
const CREDENTIAL_CACHE_MAX = 500;
const credentialCache = new Map();

// userId -> 用户记录 { id, displayName, salt, hash, enabled, createdAt, updatedAt }
const users = new Map();

// 用户不存在时用于对齐耗时的哑哈希（防止通过响应时间枚举用户名）
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = crypto.scryptSync('web-clipboard-dummy-credential', Buffer.from(DUMMY_SALT, 'hex'), SCRYPT_KEYLEN, SCRYPT_OPTIONS);

// ========== 基础工具 ==========

function normalizeUserId(rawUserId) {
  if (typeof rawUserId !== 'string') return '';
  return rawUserId.trim().toLowerCase();
}

function isValidUserId(userId) {
  return USER_ID_PATTERN.test(userId);
}

function deriveKey(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, SCRYPT_OPTIONS);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = deriveKey(password, salt).toString('hex');
  return { salt, hash };
}

function verifyPassword(record, password) {
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  const stored = Buffer.from(record.hash, 'hex');
  const derived = deriveKey(password, record.salt);
  if (stored.length !== derived.length) return false;
  return crypto.timingSafeEqual(stored, derived);
}

// 用户不存在/格式非法时也执行一次哈希，使失败耗时与「密码错误」对齐
function burnDummyHash(password) {
  crypto.scryptSync(String(password || ''), Buffer.from(DUMMY_SALT, 'hex'), SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(DUMMY_HASH, DUMMY_HASH);
}

// ========== 模式判定 ==========

function isMultiUserMode() {
  return users.size > 0;
}

function getUserCount() {
  return users.size;
}

function getEnabledUserCount() {
  let count = 0;
  for (const user of users.values()) {
    if (user.enabled) count += 1;
  }
  return count;
}

// ========== 查询 ==========

// 对外暴露的用户视图（不含 salt/hash）
function toPublicUser(record) {
  if (!record) return null;
  return {
    id: record.id,
    displayName: record.displayName || '',
    enabled: Boolean(record.enabled),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function getUser(userId) {
  const normalized = normalizeUserId(userId);
  return normalized ? users.get(normalized) || null : null;
}

function listUsers() {
  return Array.from(users.values())
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(toPublicUser);
}

function listUserIds() {
  return Array.from(users.keys());
}

// ========== 持久化 ==========

function serializeUsers() {
  return JSON.stringify(
    {
      version: USERS_FILE_VERSION,
      users: Array.from(users.values())
    },
    null,
    2
  );
}

// 原子写入：先写 .tmp 再 rename，文件权限 0600
async function writeUsersFile() {
  const payload = serializeUsers();
  const tmpFile = `${USERS_FILE}.tmp`;

  await ensureDir(path.dirname(USERS_FILE));
  await fs.writeFile(tmpFile, payload, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmpFile, USERS_FILE);
  await fs.chmod(USERS_FILE, 0o600).catch(() => {});
}

// 串行化写入，避免并发管理操作争抢同一个 .tmp 文件
let saveChain = Promise.resolve();

function persistUsers() {
  saveChain = saveChain.then(writeUsersFile, writeUsersFile);
  return saveChain;
}

function invalidateCredentialCache() {
  credentialCache.clear();
}

// ========== 加载与种子导入 ==========

function normalizeRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') return null;

  const id = normalizeUserId(rawRecord.id);
  if (!isValidUserId(id)) return null;
  if (typeof rawRecord.salt !== 'string' || !rawRecord.salt) return null;
  if (typeof rawRecord.hash !== 'string' || !rawRecord.hash) return null;

  const createdAt = Number.isFinite(rawRecord.createdAt) ? rawRecord.createdAt : Date.now();

  return {
    id,
    displayName: typeof rawRecord.displayName === 'string' ? rawRecord.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH) : '',
    salt: rawRecord.salt,
    hash: rawRecord.hash,
    enabled: rawRecord.enabled !== false,
    createdAt,
    updatedAt: Number.isFinite(rawRecord.updatedAt) ? rawRecord.updatedAt : createdAt
  };
}

async function readUsersFile() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.users) ? parsed.users : null;

    if (!list) {
      throw new Error('users.json 结构非法：缺少 users 数组');
    }

    return list;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 启动时加载用户表。
 * - users.json 存在：直接加载，忽略 ACCESS_PASSWORDS（仅告警）
 * - users.json 不存在：若配置了 ACCESS_PASSWORDS 则一次性导入并落盘
 * @returns {Promise<{seeded: boolean, skipped: number}>}
 */
async function loadUsers() {
  const rawList = await readUsersFile();

  if (rawList === null) {
    users.clear();

    if (!envUserSeeds.length) {
      if (envUserSeedErrors.length) {
        // 有配置但没有一条可用：属于配置事故，直接失败
        throw new Error(`ACCESS_PASSWORDS 配置错误:\n${envUserSeedErrors.map((e) => `   - ${e}`).join('\n')}`);
      }
      return { seeded: false, skipped: 0 };
    }

    if (envUserSeedErrors.length) {
      throw new Error(
        `ACCESS_PASSWORDS 配置错误:\n${envUserSeedErrors.map((e) => `   - ${e}`).join('\n')}\n` +
          '正确格式: ACCESS_PASSWORDS=user1:pass1,user2:pass2'
      );
    }

    envUserSeedWarnings.forEach((warning) => console.warn(`⚠️ ${warning}`));

    const now = Date.now();
    for (const seed of envUserSeeds) {
      const { salt, hash } = hashPassword(seed.password);
      users.set(seed.userId, {
        id: seed.userId,
        displayName: '',
        salt,
        hash,
        enabled: true,
        createdAt: now,
        updatedAt: now
      });
    }

    await persistUsers();
    console.log(`✅ 已将 ${users.size} 个环境变量用户导入 ${USERS_FILE}（此后以该文件为准）`);

    return { seeded: true, skipped: 0 };
  }

  let skipped = 0;
  const normalized = new Map();

  for (const rawRecord of rawList) {
    const record = normalizeRecord(rawRecord);
    if (!record) {
      skipped += 1;
      continue;
    }
    normalized.set(record.id, record);
  }

  users.clear();
  for (const [id, record] of normalized) {
    users.set(id, record);
  }

  if (skipped > 0) {
    console.warn(`⚠️ users.json 中有 ${skipped} 条用户记录无法解析，已跳过`);
  }

  if (envUserSeeds.length) {
    console.warn('⚠️ 已存在 users.json，ACCESS_PASSWORDS 被忽略；请在管理界面维护用户');
  }

  return { seeded: false, skipped };
}

// ========== 变更操作 ==========

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`;
  }
  return null;
}

function normalizeDisplayName(displayName) {
  if (typeof displayName !== 'string') return '';
  return displayName.trim().slice(0, DISPLAY_NAME_MAX_LENGTH);
}

async function createUser({ id, password, displayName = '', enabled = true }) {
  const userId = normalizeUserId(id);

  if (!userId) return { ok: false, code: 'invalid_id', error: '用户名不能为空' };
  if (!isValidUserId(userId)) {
    return {
      ok: false,
      code: 'invalid_id',
      error: '用户名仅允许小写字母、数字、下划线、连字符，长度 1-32'
    };
  }
  if (users.has(userId)) return { ok: false, code: 'exists', error: `用户名 "${userId}" 已存在` };

  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, code: 'invalid_password', error: passwordError };

  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const record = {
    id: userId,
    displayName: normalizeDisplayName(displayName),
    salt,
    hash,
    enabled: enabled !== false,
    createdAt: now,
    updatedAt: now
  };

  users.set(userId, record);
  invalidateCredentialCache();

  try {
    await persistUsers();
  } catch (error) {
    users.delete(userId);
    return { ok: false, code: 'io_error', error: `写入用户表失败: ${error.message}` };
  }

  return { ok: true, user: toPublicUser(record) };
}

async function updateUser(userId, patch = {}) {
  const record = getUser(userId);
  if (!record) return { ok: false, code: 'not_found', error: '用户不存在' };

  // 先完成全部校验，再落到内存，避免校验失败时留下半成品修改
  const wantsPassword = patch.password !== undefined && patch.password !== null && patch.password !== '';
  let nextPasswordHash = null;

  if (wantsPassword) {
    const passwordError = validatePassword(patch.password);
    if (passwordError) return { ok: false, code: 'invalid_password', error: passwordError };
    nextPasswordHash = hashPassword(patch.password);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    const nextEnabled = Boolean(patch.enabled);
    if (!nextEnabled && record.enabled && getEnabledUserCount() <= 1) {
      return { ok: false, code: 'last_user', error: '至少保留一个可用用户，无法禁用最后一个用户' };
    }
  }

  const previous = { ...record };

  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
    record.displayName = normalizeDisplayName(patch.displayName);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    record.enabled = Boolean(patch.enabled);
  }

  if (nextPasswordHash) {
    record.salt = nextPasswordHash.salt;
    record.hash = nextPasswordHash.hash;
  }

  record.updatedAt = Date.now();
  invalidateCredentialCache();

  try {
    await persistUsers();
  } catch (error) {
    Object.assign(record, previous);
    invalidateCredentialCache();
    return { ok: false, code: 'io_error', error: `写入用户表失败: ${error.message}` };
  }

  return { ok: true, user: toPublicUser(record) };
}

async function deleteUser(userId, { allowLastUser = false } = {}) {
  const record = getUser(userId);
  if (!record) return { ok: false, code: 'not_found', error: '用户不存在' };

  // 删掉最后一个用户会让系统退回单用户模式（分享数据全部清理），
  // 因此默认拒绝，必须由管理端显式带上 allowLastUser 才放行。
  if (users.size <= 1 && !allowLastUser) {
    return {
      ok: false,
      code: 'last_user',
      error: '这是最后一个用户，删除后系统将退回单用户模式，请再次确认'
    };
  }

  users.delete(record.id);
  invalidateCredentialCache();

  try {
    await persistUsers();
  } catch (error) {
    users.set(record.id, record);
    invalidateCredentialCache();
    return { ok: false, code: 'io_error', error: `写入用户表失败: ${error.message}` };
  }

  return { ok: true, user: toPublicUser(record) };
}

// ========== 凭证校验 ==========

function credentialCacheKey(userId, password) {
  const digest = crypto.createHash('sha256').update(String(password)).digest('hex');
  return `${userId}:${digest}`;
}

function hitCredentialCache(userId, password) {
  const key = credentialCacheKey(userId, password);
  const expiresAt = credentialCache.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    credentialCache.delete(key);
    return false;
  }
  return true;
}

function storeCredentialCache(userId, password) {
  if (credentialCache.size >= CREDENTIAL_CACHE_MAX) {
    credentialCache.clear();
  }
  credentialCache.set(credentialCacheKey(userId, password), Date.now() + CREDENTIAL_CACHE_TTL_MS);
}

/**
 * 校验用户名 + 密码。
 * @returns {{ok: true, user: object} | {ok: false, code: 'invalid'|'disabled', error: string}}
 */
function authenticate(rawUserId, password) {
  const userId = normalizeUserId(rawUserId);

  if (!userId || !isValidUserId(userId) || typeof password !== 'string' || !password) {
    burnDummyHash(password);
    return { ok: false, code: 'invalid', error: '用户名或密码错误' };
  }

  const record = users.get(userId);
  if (!record) {
    burnDummyHash(password);
    return { ok: false, code: 'invalid', error: '用户名或密码错误' };
  }

  if (!hitCredentialCache(userId, password)) {
    if (!verifyPassword(record, password)) {
      return { ok: false, code: 'invalid', error: '用户名或密码错误' };
    }
    storeCredentialCache(userId, password);
  }

  if (!record.enabled) {
    return { ok: false, code: 'disabled', error: '该账号已被禁用，请联系管理员' };
  }

  return { ok: true, user: record };
}

module.exports = {
  // 模式
  isMultiUserMode,
  getUserCount,
  getEnabledUserCount,

  // 查询
  getUser,
  listUsers,
  listUserIds,
  toPublicUser,

  // 生命周期
  loadUsers,
  createUser,
  updateUser,
  deleteUser,

  // 认证
  authenticate,
  normalizeUserId,
  isValidUserId,
  hashPassword,
  invalidateCredentialCache,

  // 常量
  USERS_FILE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH
};
