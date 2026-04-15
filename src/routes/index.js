const path = require('path');
const express = require('express');
const fs = require('fs/promises');
const { MULTI_USER_MODE, UPLOAD_ROOT, STORAGE_ROOT } = require('../config');
const { getUserUploadRoot } = require('../storage');
const authRoutes = require('./auth');
const messagesRoutes = require('./messages');
const favoritesRoutes = require('./favorites');
const shareRoutes = require('./share');

// 设置静态文件路由（上传文件）
function setupUploadRoutes(app) {
  if (MULTI_USER_MODE) {
    app.use('/uploads/:userId', (req, res, next) => {
      const userId = req.params.userId;
      const userUploadRoot = getUserUploadRoot(userId);
      express.static(userUploadRoot)(req, res, next);
    });
  } else {
    app.use('/uploads', express.static(UPLOAD_ROOT));
  }
}

// 设置 API 路由
function setupApiRoutes(app) {
  // 认证路由
  app.use('/api', authRoutes.router);

  // 消息路由（需要在 /api/messages 路径）
  app.use('/api/messages', messagesRoutes);

  // 收藏路由（需要在 /api/messages 路径，但 favorites.js 已经处理了 /:id/favorite）
  // 所以 favorites 路由需要挂载到 /api/messages
  app.use('/api/messages', favoritesRoutes);

  // 兼容旧的路由 /api/favorites
  app.use('/api/favorites', favoritesRoutes);

  // 分享路由
  app.use('/api/share', shareRoutes);
}

// 设置所有路由
function setupRoutes(app) {
  // 静态文件（前端）
  const publicPath = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicPath));

  // 上传文件静态路由
  setupUploadRoutes(app);

  // JSON 解析中间件
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API 路由
  setupApiRoutes(app);

  // 分享页面路由（需要在 API 路由之后，静态文件之前已处理）
  app.get('/share/:shareId', (req, res) => {
    res.sendFile(path.join(publicPath, 'share.html'));
  });
}

module.exports = {
  setupRoutes,
  extractUserId: authRoutes.extractUserId
};