const fs = require('fs/promises');
const path = require('path');
const { SHARE_DIR, SHARE_MAX_EXPIRE_HOURS } = require('./config');
const { ensureDir, createMessageId } = require('./utils');
const { getUserState } = require('./storage');
const { toPublicMessage } = require('./message');

// 分享数据结构
// {
//   shareId: 'abc123',
//   messageId: 'xxx',
//   userId: 'user1',
//   password: null,           // 可选密码（明文简单校验）
//   expiresAt: timestamp,
//   createdAt: timestamp,
//   createdBy: 'user1',
//   viewCount: 0
// }

// 获取分享文件路径
function getShareFile(shareId) {
  return path.join(SHARE_DIR, `${shareId}.json`);
}

// 加载分享数据
async function loadShare(shareId) {
  const shareFile = getShareFile(shareId);
  try {
    const raw = await fs.readFile(shareFile, 'utf8');
    const share = JSON.parse(raw);
    return share;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// 保存分享数据
async function saveShare(share) {
  const shareFile = getShareFile(share.shareId);
  await ensureDir(SHARE_DIR);
  const payload = JSON.stringify(share, null, 2);
  const tmpFile = `${shareFile}.tmp`;
  await fs.writeFile(tmpFile, payload, 'utf8');
  await fs.rename(tmpFile, shareFile);
}

// 删除分享
async function deleteShare(shareId) {
  const shareFile = getShareFile(shareId);
  try {
    await fs.unlink(shareFile);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

// 创建分享
async function createShare({ messageId, userId, password, expiresHours }) {
  // 校验过期时间
  const maxExpiresHours = Math.min(expiresHours || 24, SHARE_MAX_EXPIRE_HOURS);
  const expiresAt = Date.now() + maxExpiresHours * 60 * 60 * 1000;

  // 获取消息
  const state = getUserState(userId);
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) {
    throw new Error('消息不存在');
  }

  // 创建分享 ID
  const shareId = createMessageId();

  const share = {
    shareId,
    messageId,
    userId,
    password: password || null,
    expiresAt,
    createdAt: Date.now(),
    createdBy: userId,
    viewCount: 0
  };

  await saveShare(share);
  return share;
}

// 获取分享信息（公开信息，不含消息内容）
async function getShareInfo(shareId) {
  const share = await loadShare(shareId);
  if (!share) {
    return null;
  }

  // 检查是否过期
  if (share.expiresAt && Date.now() > share.expiresAt) {
    await deleteShare(shareId);
    return null;
  }

  // 返回公开信息（不含密码）
  return {
    shareId: share.shareId,
    hasPassword: Boolean(share.password),
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    createdBy: share.createdBy,
    viewCount: share.viewCount,
    expired: false
  };
}

// 验证分享密码
async function verifySharePassword(shareId, password) {
  const share = await loadShare(shareId);
  if (!share) {
    return { success: false, error: '分享不存在' };
  }

  // 检查是否过期
  if (share.expiresAt && Date.now() > share.expiresAt) {
    await deleteShare(shareId);
    return { success: false, error: '分享已过期' };
  }

  // 无密码保护
  if (!share.password) {
    return { success: true };
  }

  // 校验密码
  if (password !== share.password) {
    return { success: false, error: '密码错误' };
  }

  return { success: true };
}

// 获取分享消息内容
async function getShareContent(shareId) {
  const share = await loadShare(shareId);
  if (!share) {
    return null;
  }

  // 检查是否过期
  if (share.expiresAt && Date.now() > share.expiresAt) {
    await deleteShare(shareId);
    return null;
  }

  // 获取原消息
  const state = getUserState(share.userId);
  const message = state.messages.find((item) => item.id === share.messageId);
  if (!message) {
    // 原消息已被删除
    return { share, message: null, deleted: true };
  }

  // 更新访问次数
  share.viewCount += 1;
  await saveShare(share);

  return {
    share,
    message: toPublicMessage(message, share.userId),
    deleted: false
  };
}

// 清理过期分享
async function cleanupExpiredShares() {
  try {
    const entries = await fs.readdir(SHARE_DIR).catch((error) => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });

    const now = Date.now();
    let removedCount = 0;

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue;

      const shareId = filename.slice(0, -5);
      const share = await loadShare(shareId);

      if (share && share.expiresAt && now > share.expiresAt) {
        await deleteShare(shareId);
        removedCount += 1;
      }
    }

    if (removedCount > 0) {
      console.log(`分享清理完成，删除 ${removedCount} 个过期分享`);
    }
  } catch (error) {
    console.error('分享清理失败:', error);
  }
}

// 删除所有分享（用于模式切换时清理）
async function deleteAllShares() {
  try {
    const entries = await fs.readdir(SHARE_DIR).catch((error) => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });

    let removedCount = 0;

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue;

      const shareId = filename.slice(0, -5);
      await deleteShare(shareId);
      removedCount += 1;
    }

    if (removedCount > 0) {
      console.log(`已清理所有分享，共 ${removedCount} 个`);
    }
  } catch (error) {
    console.error('清理所有分享失败:', error);
  }
}

// 根据消息 ID 删除所有相关分享
async function deleteSharesByMessageId(messageId, userId = null) {
  try {
    const entries = await fs.readdir(SHARE_DIR).catch((error) => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });

    let removedCount = 0;

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue;

      const shareId = filename.slice(0, -5);
      const share = await loadShare(shareId);

      if (share && share.messageId === messageId) {
        // 如果指定了 userId，只删除该用户的分享
        if (userId === null || share.userId === userId) {
          await deleteShare(shareId);
          removedCount += 1;
        }
      }
    }

    if (removedCount > 0) {
      console.log(`已删除消息 ${messageId} 的 ${removedCount} 个分享`);
    }
  } catch (error) {
    console.error('删除消息相关分享失败:', error);
  }
}

// 获取用户的分享列表
async function getShareList(userId = null) {
  try {
    const entries = await fs.readdir(SHARE_DIR).catch((error) => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });

    const shares = [];
    const now = Date.now();

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue;

      const shareId = filename.slice(0, -5);
      const share = await loadShare(shareId);

      if (!share) continue;

      // 如果指定了 userId，只返回该用户的分享
      if (userId !== null && share.userId !== userId) continue;

      // 跳过已过期的分享
      if (share.expiresAt && now > share.expiresAt) {
        await deleteShare(shareId);
        continue;
      }

      shares.push({
        shareId: share.shareId,
        messageId: share.messageId,
        hasPassword: Boolean(share.password),
        expiresAt: share.expiresAt,
        createdAt: share.createdAt,
        viewCount: share.viewCount
      });
    }

    // 按创建时间倒序排列
    shares.sort((a, b) => b.createdAt - a.createdAt);

    return shares;
  } catch (error) {
    console.error('获取分享列表失败:', error);
    return [];
  }
}

module.exports = {
  loadShare,
  saveShare,
  deleteShare,
  createShare,
  getShareInfo,
  verifySharePassword,
  getShareContent,
  cleanupExpiredShares,
  deleteSharesByMessageId,
  deleteAllShares,
  getShareList,
  SHARE_DIR
};