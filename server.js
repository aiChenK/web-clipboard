const fs = require('fs/promises');
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

async function start() {
  await ensureDir(STORAGE_ROOT);

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