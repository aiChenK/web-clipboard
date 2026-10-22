const path = require('path');
const express = require('express');
const { MULTI_USER_MODE, ACCESS_PASSWORD, UPLOAD_ROOT } = require('../config');
const { getUserUploadRoot } = require('../storage');
const { requireAuth } = require('../middleware/auth');
const authRoutes = require('./auth');
const messagesRoutes = require('./messages');
const favoritesRoutes = require('./favorites');
const shareRoutes = require('./share');
const { apiLimiter } = require('../middleware/rateLimit');

// 设置静态文件路由（上传文件，增加权限控制与租户隔离）
function setupUploadRoutes(app) {
  if (MULTI_USER_MODE) {
    // 多用户模式：必须认证且仅允许访问属于当前登录用户的数据
    app.use('/uploads/:userId', requireAuth, (req, res, next) => {
      const targetUserId = req.params.userId;
      if (req.userId !== targetUserId) {
        return res.status(403).json({ error: '禁止访问：无权访问其他用户的私密附件' });
      }
      const userUploadRoot = getUserUploadRoot(targetUserId);
      express.static(userUploadRoot)(req, res, next);
    });
  } else {
    // 单用户模式：若配置了访问密码，必须通过密码鉴权方可访问上传目录
    if (ACCESS_PASSWORD) {
      app.use('/uploads', requireAuth, express.static(UPLOAD_ROOT));
    } else {
      app.use('/uploads', express.static(UPLOAD_ROOT));
    }
  }
}

// 设置 API 路由
function setupApiRoutes(app) {
  // 认证路由
  app.use('/api', authRoutes.router);

  // 消息路由（需要在 /api/messages 路径）
  app.use('/api/messages', apiLimiter, messagesRoutes);

  // 收藏路由（需要在 /api/messages 路径，但 favorites.js 已经处理了 /:id/favorite）
  // 所以 favorites 路由需要挂载到 /api/messages
  app.use('/api/messages', apiLimiter, favoritesRoutes);

  // 兼容旧的路由 /api/favorites
  app.use('/api/favorites', apiLimiter, favoritesRoutes);

  // 分享路由
  app.use('/api/share', apiLimiter, shareRoutes);
}

// 设置所有路由
function setupRoutes(app) {
  // 静态文件（前端）
  const publicPath = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicPath));

  // 上传文件受控静态路由
  setupUploadRoutes(app);

  // JSON 解析中间件（收缩至合理的 10MB 大小限制，防止畸形大 JSON DoS）
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // API 路由
  setupApiRoutes(app);

  // 分享页面路由（需要在 API 路由之后，静态文件之前已处理）
  app.get('/share/:shareId', (req, res) => {
    res.sendFile(path.join(publicPath, 'share.html'));
  });
}

module.exports = {
  setupRoutes
};