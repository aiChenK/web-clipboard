const path = require('path');
const express = require('express');
const { ACCESS_PASSWORD, ADMIN_PASSWORD, UPLOAD_ROOT } = require('../config');
const { isMultiUserMode } = require('../users');
const { getUserUploadRoot } = require('../storage');
const { requireAuth } = require('../middleware/auth');
const authRoutes = require('./auth');
const messagesRoutes = require('./messages');
const favoritesRoutes = require('./favorites');
const shareRoutes = require('./share');
const adminRoutes = require('./admin');
const { apiLimiter, adminLimiter } = require('../middleware/rateLimit');

// 上传静态文件响应加固：nosniff + 风险类型强制下载
// （阻断 .html/.svg 等同源导航执行；<img>/<video> 嵌入渲染不受 Content-Disposition 影响）
const UPLOAD_RISKY_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xhtml', '.xml']);

function uploadStaticHardening(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (UPLOAD_RISKY_EXTENSIONS.has(path.extname(req.path || '').toLowerCase())) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}

function serveSingleUserUploads(req, res, next) {
  const serveStatic = () => uploadStaticHardening(req, res, () => express.static(UPLOAD_ROOT)(req, res, next));

  if (ACCESS_PASSWORD) {
    return requireAuth(req, res, serveStatic);
  }

  return serveStatic();
}

// 设置静态文件路由（上传文件，增加权限控制与租户隔离）
// 多用户 / 单用户模式可运行期切换，因此两个分支都常驻注册，由 isMultiUserMode() 在请求时决定归属
function setupUploadRoutes(app) {
  // 单用户模式：多用户模式下直接放行给后一个处理链
  app.use('/uploads', (req, res, next) => {
    if (isMultiUserMode()) return next();
    return serveSingleUserUploads(req, res, next);
  });

  // 多用户模式：必须认证且仅允许访问属于当前登录用户的数据
  app.use('/uploads/:userId', (req, res, next) => {
    if (!isMultiUserMode()) return next();

    return requireAuth(req, res, () => {
      const targetUserId = req.params.userId;
      if (req.userId !== targetUserId) {
        return res.status(403).json({ error: '禁止访问：无权访问其他用户的私密附件' });
      }
      const userUploadRoot = getUserUploadRoot(targetUserId);
      uploadStaticHardening(req, res, () => express.static(userUploadRoot)(req, res, next));
    });
  });
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

  // 管理端路由（未配置 ADMIN_PASSWORD 时由 admin.js 内部统一返回 404）
  app.use('/api/admin', adminLimiter, adminRoutes);
}

// 设置所有路由
function setupRoutes(app) {
  const publicPath = path.join(__dirname, '..', '..', 'public');

  // 管理端页面：未配置 ADMIN_PASSWORD 时连页面入口都不存在
  // 必须注册在静态目录之前，否则 admin.html 会被 express.static 直接放出去
  const adminPageHandler = (req, res, next) => {
    if (!ADMIN_PASSWORD) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    return res.sendFile(path.join(publicPath, 'admin.html'));
  };
  app.get('/admin', adminPageHandler);
  app.get('/admin.html', adminPageHandler);

  // 静态文件（前端）
  app.use(express.static(publicPath));

  // 上传文件受控静态路由
  setupUploadRoutes(app);

  // JSON 解析中间件（收缩至合理的 10MB 大小限制，防止畸形大 JSON DoS）
  // 客户端仅使用 JSON 与 multipart/form-data，无需 urlencoded 解析器
  app.use(express.json({ limit: '10mb' }));

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
