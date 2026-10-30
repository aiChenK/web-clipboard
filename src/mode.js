/**
 * 运行模式同步
 *
 * 多用户 / 单用户模式由用户表是否为空动态决定。模式一旦变化，
 * 分享数据（携带 userId 归属，跨模式语义不一致）必须整体清理，
 * 同时更新 data/.mode 标记，供下次启动比对。
 */

const fs = require('fs/promises');
const path = require('path');
const { STORAGE_ROOT } = require('./config');
const { ensureDir } = require('./utils');
const { isMultiUserMode } = require('./users');
const { deleteAllShares } = require('./share');

const MODE_FILE = path.join(STORAGE_ROOT, '.mode');

function getCurrentMode() {
  return isMultiUserMode() ? 'multi' : 'single';
}

async function readSavedMode() {
  try {
    const saved = await fs.readFile(MODE_FILE, 'utf8');
    return saved.trim() || null;
  } catch {
    return null;
  }
}

async function writeSavedMode(mode) {
  await ensureDir(STORAGE_ROOT);
  await fs.writeFile(MODE_FILE, mode, 'utf8');
}

/**
 * 启动时调用：比对上次运行模式，变化则清理分享并写回标记。
 */
async function syncModeOnStartup() {
  const currentMode = getCurrentMode();
  const savedMode = await readSavedMode();
  let clearedShares = false;

  if (savedMode && savedMode !== currentMode) {
    console.log(`检测到运行模式变化: ${savedMode} -> ${currentMode}`);
    console.log('清理所有分享数据...');
    await deleteAllShares();
    clearedShares = true;
  }

  await writeSavedMode(currentMode);

  return { previousMode: savedMode, currentMode, clearedShares };
}

/**
 * 用户表变更后调用：模式发生切换时立即清理分享并写回标记，无需重启。
 * @param {string|null} previousMode 变更前由 getCurrentMode() 取得的值
 */
async function syncModeAfterUserChange(previousMode) {
  const currentMode = getCurrentMode();
  if (previousMode === currentMode) {
    return { changed: false, currentMode, clearedShares: false };
  }

  console.log(`运行模式已切换: ${previousMode} -> ${currentMode}，清理所有分享数据...`);
  await deleteAllShares();
  await writeSavedMode(currentMode);

  return { changed: true, previousMode, currentMode, clearedShares: true };
}

module.exports = {
  MODE_FILE,
  getCurrentMode,
  syncModeOnStartup,
  syncModeAfterUserChange
};
