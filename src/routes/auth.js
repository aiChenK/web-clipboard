const express = require('express');
const { MULTI_USER_MODE, ACCESS_PASSWORD, APP_VERSION, userPasswordMap } = require('../config');

const router = express.Router();

// 认证中间件：提取 userId
function extractUserId(req, res, next) {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};
  const userId = body.userId || query.userId || headers['x-user-id'];
  req.userId = userId || null;
  next();
}

// 认证 API
router.post('/auth', (req, res) => {
  const { password } = req.body;

  if (MULTI_USER_MODE) {
    const userId = userPasswordMap.get(password);
    if (userId) {
      return res.json({ success: true, userId, mode: 'multi' });
    }
    return res.status(401).json({ success: false, error: '密码错误' });
  }

  if (!ACCESS_PASSWORD) {
    return res.json({ success: true, noPassword: true, mode: 'single' });
  }

  if (password === ACCESS_PASSWORD) {
    res.json({ success: true, mode: 'single' });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// 认证状态 API
router.get('/auth/status', (req, res) => {
  if (MULTI_USER_MODE) {
    res.json({
      mode: 'multi',
      requirePassword: true,
      users: Array.from(userPasswordMap.values())
    });
  } else {
    res.json({
      mode: 'single',
      requirePassword: Boolean(ACCESS_PASSWORD)
    });
  }
});

// 版本信息 API
router.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, mode: MULTI_USER_MODE ? 'multi' : 'single' });
});

module.exports = {
  router,
  extractUserId
};