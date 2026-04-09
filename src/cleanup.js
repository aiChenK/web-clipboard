const fs = require('fs/promises');
const path = require('path');
const { MULTI_USER_MODE, EXPIRE_TIME, STORAGE_ROOT, FILE_CLEANUP_INTERVAL_MINUTES } = require('./config');
const { getUserState, getUploadRoot, schedulePersist } = require('./storage');
const { deleteMessageFiles, getMessageFileRefs } = require('./upload');
const { toPosixPath } = require('./utils');

let cleanupRunning = false;

// 清理过期数据
function cleanupExpiredData(userId = null) {
  const state = getUserState(userId);
  const now = Date.now();
  if (now - state.lastActivity <= EXPIRE_TIME) {
    return;
  }

  const favoriteMessages = state.messages.filter((msg) => msg.favorite);
  const expiredMessages = state.messages.filter((msg) => !msg.favorite);

  if (expiredMessages.length === 0) {
    return;
  }

  state.messages = favoriteMessages;
  state.lastActivity = now;
  schedulePersist(userId);

  Promise.allSettled(expiredMessages.map((msg) => deleteMessageFiles(msg, userId))).catch((error) => {
    console.error('清理过期文件失败:', error);
  });
}

// 清理所有用户过期数据
async function cleanupAllUsersExpiredData() {
  if (MULTI_USER_MODE) {
    const usersDir = path.join(STORAGE_ROOT, 'users');
    let userDirs = [];
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      userDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('扫描用户目录失败:', error);
      }
      return;
    }

    for (const userId of userDirs) {
      cleanupExpiredData(userId);
    }
  } else {
    cleanupExpiredData(null);
  }
}

// 递归列出所有文件
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

// 递归删除空目录
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

// 清理孤儿磁盘文件
async function cleanupOrphanDiskFiles(userId = null) {
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    const uploadRoot = getUploadRoot(userId);
    const state = getUserState(userId);

    const referenced = new Set();
    for (const msg of state.messages) {
      const refs = getMessageFileRefs(msg);
      refs.forEach((item) => referenced.add(item));
    }

    const allFiles = await listAllFilesRecursive(uploadRoot);
    let removedCount = 0;

    for (const absolutePath of allFiles) {
      const relativePath = toPosixPath(path.relative(uploadRoot, absolutePath));
      if (!referenced.has(relativePath)) {
        await fs.unlink(absolutePath).catch((error) => {
          if (error && error.code === 'ENOENT') return;
          throw error;
        });
        removedCount += 1;
      }
    }

    await removeEmptyDirsRecursive(uploadRoot, true);

    if (removedCount > 0) {
      console.log(`孤儿文件清理完成，用户 ${userId || '单用户'} 删除 ${removedCount} 个文件`);
    }
  } catch (error) {
    console.error('孤儿文件清理失败:', error);
  } finally {
    cleanupRunning = false;
  }
}

// 清理所有用户孤儿文件
async function cleanupAllUsersOrphanFiles() {
  if (MULTI_USER_MODE) {
    const usersDir = path.join(STORAGE_ROOT, 'users');
    let userDirs = [];
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      userDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('扫描用户目录失败:', error);
      }
    }

    for (const userId of userDirs) {
      await cleanupOrphanDiskFiles(userId);
    }
  } else {
    await cleanupOrphanDiskFiles(null);
  }
}

// 启动清理定时任务
function startCleanupSchedulers() {
  setInterval(cleanupAllUsersExpiredData, 5 * 60 * 1000);
  setInterval(cleanupAllUsersOrphanFiles, FILE_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
}

module.exports = {
  cleanupExpiredData,
  cleanupAllUsersExpiredData,
  cleanupOrphanDiskFiles,
  cleanupAllUsersOrphanFiles,
  startCleanupSchedulers
};