const fs = require('fs/promises');
const path = require('path');
const {
  PORT,
  MIGRATE_DEFAULT_USER,
  EXPIRE_HOURS,
  STORAGE_ROOT,
  UPLOAD_ROOT,
  FILE_CLEANUP_INTERVAL_MINUTES,
  USERS_FILE
} = require('./src/config');
const { ensureDir } = require('./src/utils');
const { loadPersistedState, migrateLegacyData, SINGLE_USER_DATA_FILE, flushAllPersist } = require('./src/storage');
const { cleanupOrphanDiskFiles, cleanupExpiredData, startCleanupSchedulers } = require('./src/cleanup');
const { createApp } = require('./src/app');
const {
  loadUsers,
  isMultiUserMode,
  getUserCount,
  listUserIds,
  getUser,
  normalizeUserId
} = require('./src/users');
const { syncModeOnStartup } = require('./src/mode');

/**
 * 升级兼容：旧版本 userId 未做小写规范化，数据目录可能是 "Zhang3" 这类名字，
 * 而新规范化的 userId 是 "zhang3"。在大小写敏感的文件系统（Linux/Docker）上
 * 两者指向不同目录，用户会误以为数据丢了。
 *
 * 只在目标目录不存在时重命名；出现多个大小写变体或重命名失败时仅告警，绝不覆盖。
 */
async function reconcileLegacyUserDirs() {
  const usersRoot = path.join(STORAGE_ROOT, 'users');
  let entries;

  try {
    entries = await fs.readdir(usersRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  const dirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const existing = new Set(dirNames);

  for (const userId of listUserIds()) {
    if (existing.has(userId)) continue;

    const candidates = dirNames.filter((name) => name.toLowerCase() === userId);
    if (!candidates.length) continue;

    if (candidates.length > 1) {
      console.warn(`⚠️ 用户 "${userId}" 存在多个大小写变体目录: ${candidates.join(', ')}，请手动合并`);
      continue;
    }

    const legacyName = candidates[0];
    try {
      await fs.rename(path.join(usersRoot, legacyName), path.join(usersRoot, userId));
      console.log(`已迁移用户数据目录: ${legacyName} -> ${userId}`);
    } catch (error) {
      console.warn(`⚠️ 迁移用户 "${userId}" 数据目录失败（${legacyName}）: ${error.message}`);
    }
  }
}

async function start() {
  await ensureDir(STORAGE_ROOT);

  // 加载用户表（users.json 缺失时从 ACCESS_PASSWORDS 一次性导入）
  await loadUsers();

  // 修正历史大小写不一致的用户数据目录（仅重命名，不覆盖）
  if (isMultiUserMode()) {
    await reconcileLegacyUserDirs();
  }

  // 遗留单用户数据迁移
  if (isMultiUserMode()) {
    const targetUserId = normalizeUserId(MIGRATE_DEFAULT_USER);

    if (targetUserId) {
      if (!getUser(targetUserId)) {
        console.error('❌ MIGRATE_DEFAULT_USER 配置错误:');
        console.error(`   - 迁移目标用户 "${MIGRATE_DEFAULT_USER}" 未在用户表中定义`);
        console.error(`   - 当前用户: ${listUserIds().join(', ') || '（空）'}`);
        process.exit(1);
      }

      try {
        const migrated = await migrateLegacyData(targetUserId);
        if (migrated) {
          await loadPersistedState(targetUserId);
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
  }

  // 运行模式变化时清理分享并写回 .mode 标记
  await syncModeOnStartup();

  // 按当前模式加载数据并清理过期消息与孤儿文件
  if (isMultiUserMode()) {
    for (const userId of listUserIds()) {
      await loadPersistedState(userId);
      await cleanupExpiredData(userId);
      await cleanupOrphanDiskFiles(userId);
    }
  } else {
    await ensureDir(UPLOAD_ROOT);
    await loadPersistedState(null);
    await cleanupExpiredData(null);
    await cleanupOrphanDiskFiles(null);
  }

  // 启动清理定时任务
  startCleanupSchedulers();

  // 创建应用
  const { server } = createApp();

  // 启动服务器
  server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`运行模式: ${isMultiUserMode() ? '多用户' : '单用户'}`);
    if (isMultiUserMode()) {
      console.log(`用户数量: ${getUserCount()}`);
      console.log(`用户列表: ${listUserIds().join(', ')}`);
      console.log(`用户表文件: ${USERS_FILE}`);
    }
    console.log(`密码保护: ${isMultiUserMode() ? '已启用' : (process.env.ACCESS_PASSWORD ? '已启用' : '未启用（无密码模式）')}`);
    console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
    console.log(`数据存储目录: ${STORAGE_ROOT}`);
    console.log(`孤儿文件清理间隔: ${FILE_CLEANUP_INTERVAL_MINUTES} 分钟`);
  });

  // 优雅停机：先落盘脏数据，再关闭连接，3 秒兜底强制退出
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在优雅停机...`);
    try {
      await flushAllPersist();
    } catch (error) {
      console.error('停机前持久化异常:', error);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});
