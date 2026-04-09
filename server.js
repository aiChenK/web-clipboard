const fs = require('fs/promises');
const path = require('path');
const {
  PORT,
  MULTI_USER_MODE,
  MIGRATE_DEFAULT_USER,
  EXPIRE_HOURS,
  STORAGE_ROOT,
  UPLOAD_ROOT,
  FILE_CLEANUP_INTERVAL_MINUTES,
  userPasswordMap,
  userIdSet
} = require('./src/config');
const { ensureDir } = require('./src/utils');
const { loadPersistedState, migrateLegacyData, SINGLE_USER_DATA_FILE } = require('./src/storage');
const { cleanupOrphanDiskFiles } = require('./src/cleanup');
const { startCleanupSchedulers } = require('./src/cleanup');
const { createApp } = require('./src/app');
const { deleteAllShares, SHARE_DIR } = require('./src/share');

const MODE_FILE = path.join(STORAGE_ROOT, '.mode');

// 检查并处理运行模式变化
async function checkModeChange() {
  const currentMode = MULTI_USER_MODE ? 'multi' : 'single';

  try {
    const savedMode = await fs.readFile(MODE_FILE, 'utf8').catch(() => null);

    if (savedMode && savedMode.trim() !== currentMode) {
      console.log(`检测到运行模式变化: ${savedMode.trim()} -> ${currentMode}`);
      console.log('清理所有分享数据...');
      await deleteAllShares();
    }

    // 保存当前模式
    await ensureDir(STORAGE_ROOT);
    await fs.writeFile(MODE_FILE, currentMode, 'utf8');
  } catch (error) {
    console.error('检查模式变化失败:', error);
  }
}

async function start() {
  await ensureDir(STORAGE_ROOT);

  // 检查运行模式变化
  await checkModeChange();

  // 多用户模式
  if (MULTI_USER_MODE) {
    // 检查是否需要迁移单用户数据
    if (MIGRATE_DEFAULT_USER) {
      try {
        const migrated = await migrateLegacyData(MIGRATE_DEFAULT_USER);
        if (migrated) {
          await loadPersistedState(MIGRATE_DEFAULT_USER);
        }
      } catch (error) {
        console.error('迁移数据失败:', error);
      }
    } else {
      // 检查是否有遗留的单用户数据
      try {
        await fs.access(SINGLE_USER_DATA_FILE);
        console.warn('⚠️ 检测到单用户数据遗留，请设置 MIGRATE_DEFAULT_USER=<userId> 指定迁移目标');
      } catch {
        // 无遗留数据
      }
    }

    // 加载所有用户的数据
    for (const [password, userId] of userPasswordMap) {
      await loadPersistedState(userId);
      await cleanupOrphanDiskFiles(userId);
    }
  } else {
    // 单用户模式
    await ensureDir(UPLOAD_ROOT);
    await loadPersistedState(null);
    await cleanupOrphanDiskFiles(null);
  }

  // 启动清理定时任务
  startCleanupSchedulers();

  // 创建应用
  const { server } = createApp();

  // 启动服务器
  server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`运行模式: ${MULTI_USER_MODE ? '多用户' : '单用户'}`);
    if (MULTI_USER_MODE) {
      console.log(`用户数量: ${userPasswordMap.size}`);
      console.log(`用户列表: ${Array.from(userPasswordMap.values()).join(', ')}`);
    }
    console.log(`密码保护: ${MULTI_USER_MODE ? '已启用' : (process.env.ACCESS_PASSWORD ? '已启用' : '未启用（无密码模式）')}`);
    console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
    console.log(`数据存储目录: ${STORAGE_ROOT}`);
    console.log(`孤儿文件清理间隔: ${FILE_CLEANUP_INTERVAL_MINUTES} 分钟`);
  });
}

start().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});