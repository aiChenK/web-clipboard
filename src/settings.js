const fs = require('fs/promises');
const path = require('path');
const { constants: { MAX_STRING_LENGTH } } = require('node:buffer');
const { STORAGE_ROOT, BYTES_PER_MIB, JSON_BODY_LIMIT, MAX_MESSAGE_PAGE_SIZE } = require('./config');

const SETTINGS_FILE = path.join(STORAGE_ROOT, 'settings.json');
// JSON 图片可包含两个 Base64 文件，需为原图、缩略图和其他字段预留空间。
const MAX_UPLOAD_SIZE_MIB = Math.floor((MAX_STRING_LENGTH - JSON_BODY_LIMIT) * 3 / (8 * BYTES_PER_MIB));
// Node.js 超出定时器延迟上限会按 1 毫秒执行。
const MAX_FILE_CLEANUP_INTERVAL_MINUTES = Math.floor(2_147_483_647 / (60 * 1000));
const NUMBER_SETTING_LABELS = {
  expireHours: '消息保留期',
  shareDefaultExpireHours: '分享默认有效期',
  shareMaxExpireHours: '分享最长有效期',
  textMessageMaxLength: '单条文本长度上限',
  uploadMaxFileSizeMiB: '单个文件上传上限',
  messagePageSize: '消息分页大小',
  socketSyncLimit: 'WebSocket 首次同步条数',
  fileCleanupIntervalMinutes: '孤儿文件清理间隔'
};
const BOOLEAN_SETTING_LABELS = {
  shareCreationDisabled: '禁止新建分享',
  sharePasswordRequired: '分享必须设置密码'
};

function readEnvInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const shareMaxExpireHours = readEnvInteger('SHARE_MAX_EXPIRE_HOURS', 168);
let settings = {
  expireHours: readEnvInteger('EXPIRE_HOURS', 168),
  shareDefaultExpireHours: Math.min(168, shareMaxExpireHours),
  shareMaxExpireHours,
  textMessageMaxLength: readEnvInteger('TEXT_MESSAGE_MAX_LENGTH', 100000),
  uploadMaxFileSizeMiB: 100,
  shareCreationDisabled: false,
  sharePasswordRequired: false,
  messagePageSize: Math.min(readEnvInteger('MESSAGE_PAGE_SIZE', 30), MAX_MESSAGE_PAGE_SIZE),
  socketSyncLimit: Math.min(readEnvInteger('SOCKET_SYNC_LIMIT', 20), MAX_MESSAGE_PAGE_SIZE),
  fileCleanupIntervalMinutes: Math.min(readEnvInteger('FILE_CLEANUP_INTERVAL_MINUTES', 30), MAX_FILE_CLEANUP_INTERVAL_MINUTES)
};
let saveChain = Promise.resolve();

function parseSettings(input) {
  // 旧设置文件和已打开的旧管理页面没有后来新增的字段。
  input = {
    uploadMaxFileSizeMiB: settings.uploadMaxFileSizeMiB,
    shareCreationDisabled: settings.shareCreationDisabled,
    sharePasswordRequired: settings.sharePasswordRequired,
    messagePageSize: settings.messagePageSize,
    socketSyncLimit: settings.socketSyncLimit,
    fileCleanupIntervalMinutes: settings.fileCleanupIntervalMinutes,
    ...input
  };
  const parsed = {};
  for (const [key, label] of Object.entries(NUMBER_SETTING_LABELS)) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${label}必须为正整数`);
    }
    parsed[key] = value;
  }
  for (const [key, label] of Object.entries(BOOLEAN_SETTING_LABELS)) {
    const value = input[key];
    if (typeof value !== 'boolean') {
      throw new Error(`${label}必须为布尔值`);
    }
    parsed[key] = value;
  }
  if (parsed.shareDefaultExpireHours > parsed.shareMaxExpireHours) {
    throw new Error('分享默认有效期不能超过最长有效期');
  }
  if (parsed.uploadMaxFileSizeMiB > MAX_UPLOAD_SIZE_MIB) {
    throw new Error(`单个文件上传上限不能超过 ${MAX_UPLOAD_SIZE_MIB} MiB`);
  }
  if (parsed.messagePageSize > MAX_MESSAGE_PAGE_SIZE || parsed.socketSyncLimit > MAX_MESSAGE_PAGE_SIZE) {
    throw new Error(`消息分页大小和 WebSocket 首次同步条数不能超过 ${MAX_MESSAGE_PAGE_SIZE} 条`);
  }
  if (parsed.fileCleanupIntervalMinutes > MAX_FILE_CLEANUP_INTERVAL_MINUTES) {
    throw new Error(`孤儿文件清理间隔不能超过 ${MAX_FILE_CLEANUP_INTERVAL_MINUTES} 分钟`);
  }
  return parsed;
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    settings = parseSettings(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(`读取全站设置失败（${SETTINGS_FILE}）：${error.message}`);
  }
}

function getSettings() {
  return settings;
}

function getShareConfig(current = settings) {
  return {
    defaultExpiresHours: current.shareDefaultExpireHours,
    maxExpiresHours: current.shareMaxExpireHours,
    creationDisabled: current.shareCreationDisabled,
    passwordRequired: current.sharePasswordRequired
  };
}

function saveSettings(nextSettings) {
  saveChain = saveChain.catch(() => {}).then(async () => {
    const tmpFile = `${SETTINGS_FILE}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(nextSettings, null, 2), 'utf8');
    await fs.rename(tmpFile, SETTINGS_FILE);
    settings = nextSettings;
    return settings;
  });
  return saveChain;
}

module.exports = { getSettings, getShareConfig, loadSettings, parseSettings, saveSettings };
