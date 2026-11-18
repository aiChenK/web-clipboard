const path = require('path');

// 环境变量解析
const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const ACCESS_PASSWORDS = process.env.ACCESS_PASSWORDS || '';
// 管理端密码：未配置时 /admin 与 /api/admin/* 一律 404（不暴露入口存在）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MIGRATE_DEFAULT_USER = process.env.MIGRATE_DEFAULT_USER || '';
const BYTES_PER_MIB = 1024 * 1024;
const JSON_BODY_LIMIT = 10 * BYTES_PER_MIB;
const MAX_MESSAGE_PAGE_SIZE = 100;

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '..', 'data');
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(STORAGE_ROOT, 'uploads');

// 用户表文件：多用户模式的唯一真相源
const USERS_FILE = process.env.USERS_FILE || path.join(STORAGE_ROOT, 'users.json');
// 用户数据根目录（每个用户一个子目录）
const USERS_DATA_ROOT = path.join(STORAGE_ROOT, 'users');

// 分享功能配置
const SHARE_DIR = path.join(STORAGE_ROOT, 'shares');

// 用户名规则：全链路小写，同时作为数据目录名与上传 URL 段
const USER_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

// 获取版本号
function getAppVersion() {
  try {
    return process.env.APP_VERSION || process.env.npm_package_version || require('../package.json').version || '1.0';
  } catch {
    return '1.0';
  }
}

const APP_VERSION = getAppVersion();

// 解析 ACCESS_PASSWORDS 为种子用户列表。
// 仅在 users.json 不存在时用于首次导入；导入后运行期以 users.json 为唯一真相源。
// 不再要求密码唯一（登录以用户名为准），字符集非法与 userId 重复会记录为错误。
const envUserSeeds = [];
const envUserSeedErrors = [];
const envUserSeedWarnings = [];

function parseEnvUserSeeds(raw) {
  const pairs = String(raw).split(',').map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const separatorIndex = pair.indexOf(':');

    if (separatorIndex <= 0) {
      envUserSeedErrors.push(`第 ${i + 1} 个配置格式错误: "${pair}"，应为 "userId:password"`);
      continue;
    }

    const rawUserId = pair.slice(0, separatorIndex).trim();
    const password = pair.slice(separatorIndex + 1).trim();
    const userId = rawUserId.toLowerCase();

    if (!userId) {
      envUserSeedErrors.push(`第 ${i + 1} 个配置用户名为空`);
      continue;
    }

    if (!password) {
      envUserSeedErrors.push(`第 ${i + 1} 个配置密码为空 (用户: ${rawUserId})`);
      continue;
    }

    if (!USER_ID_PATTERN.test(userId)) {
      envUserSeedErrors.push(
        `第 ${i + 1} 个配置用户名非法: "${rawUserId}"，仅允许小写字母、数字、下划线、连字符，长度 1-32`
      );
      continue;
    }

    if (userId !== rawUserId) {
      envUserSeedWarnings.push(`用户名 "${rawUserId}" 已规范化为 "${userId}"`);
    }

    if (envUserSeeds.some((seed) => seed.userId === userId)) {
      envUserSeedErrors.push(`用户名重复: "${userId}"`);
      continue;
    }

    envUserSeeds.push({ userId, password });
  }
}

if (ACCESS_PASSWORDS) {
  parseEnvUserSeeds(ACCESS_PASSWORDS);
}

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
  ADMIN_PASSWORD,
  MIGRATE_DEFAULT_USER,
  BYTES_PER_MIB,
  JSON_BODY_LIMIT,
  MAX_MESSAGE_PAGE_SIZE,
  STORAGE_ROOT,
  UPLOAD_ROOT,
  APP_VERSION,

  // 用户表
  USERS_FILE,
  USERS_DATA_ROOT,
  USER_ID_PATTERN,
  envUserSeeds,
  envUserSeedErrors,
  envUserSeedWarnings,

  // 分享配置
  SHARE_DIR,

  MIME_EXTENSION_MAP
};
