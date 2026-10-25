const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { shareVerifyLimiter } = require('../middleware/rateLimit');
const { createShare, getShareInfo, verifySharePassword, getShareContent, deleteShare, getShareList, loadShare } = require('../share');
const { SHARE_MAX_EXPIRE_HOURS } = require('../config');
const { getUserState } = require('../storage');
const { resolveUploadAbsolute } = require('../upload');

const router = express.Router();

// 获取最大过期时间配置（必须放在 /:shareId 之前）
router.get('/config', (req, res) => {
  res.json({
    maxExpiresHours: SHARE_MAX_EXPIRE_HOURS
  });
});

// 获取用户的分享列表（必须放在 /:shareId 之前）
router.get('/list', requireAuth, async (req, res) => {
  const userId = req.userId;

  try {
    const shares = await getShareList(userId);
    return res.json({ shares });
  } catch (error) {
    console.error('获取分享列表失败:', error);
    return res.status(500).json({ error: '获取分享列表失败' });
  }
});

// 创建分享
router.post('/', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { messageId, password, expiresHours } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: '缺少消息ID' });
  }

  try {
    const share = await createShare({
      messageId,
      userId,
      password: password || null,
      expiresHours: expiresHours || 24
    });

    // 返回分享链接
    const shareUrl = `/share/${share.shareId}`;
    return res.json({
      success: true,
      shareId: share.shareId,
      shareUrl,
      expiresAt: share.expiresAt,
      hasPassword: Boolean(share.password)
    });
  } catch (error) {
    console.error('创建分享失败:', error);
    return res.status(400).json({ error: '创建分享失败' });
  }
});

// 获取分享基本信息
router.get('/:shareId', async (req, res) => {
  const { shareId } = req.params;

  try {
    const shareInfo = await getShareInfo(shareId);
    if (!shareInfo) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    return res.json(shareInfo);
  } catch (error) {
    console.error('获取分享信息失败:', error);
    return res.status(500).json({ error: '获取分享信息失败' });
  }
});

// 验证分享密码（挂载 shareVerifyLimiter 严格防爆破限流）
router.post('/:shareId/verify', shareVerifyLimiter, async (req, res) => {
  const { shareId } = req.params;
  const { password } = req.body;

  try {
    const result = await verifySharePassword(shareId, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('验证分享密码失败:', error);
    return res.status(500).json({ error: '验证失败' });
  }
});

// 获取分享消息内容（挂 shareVerifyLimiter：密码校验内联于本端点，需与 /verify 同等防爆破强度）
router.get('/:shareId/content', shareVerifyLimiter, async (req, res) => {
  const { shareId } = req.params;
  // 优先取 header（避免密码进入 URL 与访问日志），保留 query 通道兼容旧客户端
  const password = req.headers['x-share-password'] || req.query.password;

  try {
    // 如果有密码保护，先验证密码
    const shareInfo = await getShareInfo(shareId);
    if (!shareInfo) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    if (shareInfo.hasPassword) {
      const result = await verifySharePassword(shareId, password || '');
      if (!result.success) {
        return res.status(401).json({ error: '需要密码或密码错误' });
      }
    }

    const content = await getShareContent(shareId);
    if (!content) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    return res.json(content);
  } catch (error) {
    console.error('获取分享内容失败:', error);
    return res.status(500).json({ error: '获取分享内容失败' });
  }
});

// 安全受控获取分享图片（供未登录但持有有效分享权限的访客访问）
router.get('/:shareId/image', shareVerifyLimiter, async (req, res) => {
  const { shareId } = req.params;
  const password = req.headers['x-share-password'] || req.query.password;

  try {
    const share = await loadShare(shareId);
    if (!share) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    if (share.expiresAt && Date.now() > share.expiresAt) {
      await deleteShare(shareId);
      return res.status(404).json({ error: '分享已过期' });
    }

    if (share.password) {
      const verify = await verifySharePassword(shareId, password || '');
      if (!verify.success) {
        return res.status(401).json({ error: '需要密码或密码错误' });
      }
    }

    const state = getUserState(share.userId);
    const message = state.messages.find((item) => item.id === share.messageId);
    if (!message || message.type !== 'image' || !message.content) {
      return res.status(404).json({ error: '分享的图片已不存在' });
    }

    const targetPath = message.content.thumbnailPath || message.content.originalPath;
    if (!targetPath) {
      return res.status(404).json({ error: '图片文件不存在' });
    }

    const absolute = resolveUploadAbsolute(targetPath, share.userId);
    return res.sendFile(absolute, {
      headers: {
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('获取分享图片失败:', error);
    return res.status(500).json({ error: '获取分享图片失败' });
  }
});

// 安全受控获取分享文件（供未登录但持有有效分享权限的访客下载）
router.get('/:shareId/file', shareVerifyLimiter, async (req, res) => {
  const { shareId } = req.params;
  const password = req.headers['x-share-password'] || req.query.password;

  try {
    const share = await loadShare(shareId);
    if (!share) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    if (share.expiresAt && Date.now() > share.expiresAt) {
      await deleteShare(shareId);
      return res.status(404).json({ error: '分享已过期' });
    }

    if (share.password) {
      const verify = await verifySharePassword(shareId, password || '');
      if (!verify.success) {
        return res.status(401).json({ error: '需要密码或密码错误' });
      }
    }

    const state = getUserState(share.userId);
    const message = state.messages.find((item) => item.id === share.messageId);
    if (!message || message.type !== 'file' || !message.content || !message.content.filePath) {
      return res.status(404).json({ error: '分享的文件已不存在' });
    }

    const absolute = resolveUploadAbsolute(message.content.filePath, share.userId);
    return res.download(absolute, message.content.name || 'file');
  } catch (error) {
    console.error('获取分享文件失败:', error);
    return res.status(500).json({ error: '获取分享文件失败' });
  }
});

// 取消分享
router.delete('/:shareId', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { shareId } = req.params;

  try {
    // 验证分享属于当前用户（使用模块顶层导入的 loadShare）
    const share = await loadShare(shareId);

    if (!share) {
      return res.status(404).json({ error: '分享不存在或已过期' });
    }

    // 权限验证：
    // - 单用户模式（userId 为 null）：只能删除 share.userId 为 null 的分享
    // - 多用户模式（userId 不为 null）：只能删除 share.userId 与 userId 相同的分享
    if (share.userId !== userId) {
      return res.status(403).json({ error: '无权取消此分享' });
    }

    await deleteShare(shareId);
    return res.json({ success: true });
  } catch (error) {
    console.error('取消分享失败:', error);
    return res.status(500).json({ error: '取消分享失败' });
  }
});

module.exports = router;