const path = require('path');

// 环境变量解析
const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const ACCESS_PASSWORDS = process.env.ACCESS_PASSWORDS || '';
const MIGRATE_DEFAULT_USER = process.env.MIGRATE_DEFAULT_USER || '';
const EXPIRE_HOURS = Number.parseInt(process.env.EXPIRE_HOURS, 10) || 168;
const MESSAGE_PAGE_SIZE = Number.parseInt(process.env.MESSAGE_PAGE_SIZE, 10) || 30;
const SOCKET_SYNC_LIMIT = Number.parseInt(process.env.SOCKET_SYNC_LIMIT, 10) || 20;

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '..', 'data');
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(STORAGE_ROOT, 'uploads');
const FILE_CLEANUP_INTERVAL_MINUTES = Number.parseInt(process.env.FILE_CLEANUP_INTERVAL_MINUTES, 10) || 30;

// 分享功能配置
const SHARE_MAX_EXPIRE_HOURS = Number.parseInt(process.env.SHARE_MAX_EXPIRE_HOURS, 10) || 168;
const SHARE_DIR = path.join(STORAGE_ROOT, 'shares');

// 获取版本号
function getAppVersion() {
  try {
    return process.env.APP_VERSION || process.env.npm_package_version || require('../package.json').version || '1.0';
  } catch {
    return '1.0';
  }
}

const APP_VERSION = getAppVersion();

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

    if (parts.length !== 2) {
      parseErrors.push(`第 ${i + 1} 个配置格式错误: "${pair}"，应为 "userId:password"`);
      continue;
    }

    const [userId, password] = parts;

    if (!userId) {
      parseErrors.push(`第 ${i + 1} 个配置 userId 为空`);
      continue;
    }

    if (!password) {
      parseErrors.push(`第 ${i + 1} 个配置密码为空 (用户: ${userId})`);
      continue;
    }

    if (userIdSet.has(userId)) {
      parseErrors.push(`userId 重复: "${userId}"`);
      continue;
    }

    if (passwordSet.has(password)) {
      parseErrors.push(`密码重复，多个用户使用了相同密码 (冲突用户包含: "${userId}")`);
      continue;
    }

    userIdSet.add(userId);
    passwordSet.add(password);
    userPasswordMap.set(password, userId);
  }

  if (parseErrors.length > 0) {
    console.error('❌ ACCESS_PASSWORDS 配置错误:');
    parseErrors.forEach((err) => console.error(`   - ${err}`));
    console.error('\n正确格式: ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3');
    console.error('注意：每个用户的密码必须唯一，不能重复');
    process.exit(1);
  }

  if (MIGRATE_DEFAULT_USER && !userIdSet.has(MIGRATE_DEFAULT_USER)) {
    console.error('❌ MIGRATE_DEFAULT_USER 配置错误:');
    console.error(`   - 迁移目标用户 "${MIGRATE_DEFAULT_USER}" 未在 ACCESS_PASSWORDS 中定义`);
    console.error('\n请在 ACCESS_PASSWORDS 中添加该用户，例如:');
    console.error(`   ACCESS_PASSWORDS=${MIGRATE_DEFAULT_USER}:yourpassword,otheruser:otherpass`);
    process.exit(1);
  }
}

// 常量
const EXPIRE_TIME = EXPIRE_HOURS * 60 * 60 * 1000;

// MIME 类型到扩展名映射
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

module.exports = {
  // 环境变量
  PORT,
  ACCESS_PASSWORD,
  ACCESS_PASSWORDS,
  MIGRATE_DEFAULT_USER,
  EXPIRE_HOURS,
  MESSAGE_PAGE_SIZE,
  SOCKET_SYNC_LIMIT,
  STORAGE_ROOT,
  UPLOAD_ROOT,
  FILE_CLEANUP_INTERVAL_MINUTES,
  APP_VERSION,

  // 分享配置
  SHARE_MAX_EXPIRE_HOURS,
  SHARE_DIR,

  // 计算常量
  EXPIRE_TIME,
  MIME_EXTENSION_MAP,
  MULTI_USER_MODE,

  // 多用户配置
  userPasswordMap,
  userIdSet,
  passwordSet
};