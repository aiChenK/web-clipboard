const express = require('express');
const { MULTI_USER_MODE, ACCESS_PASSWORD, APP_VERSION, userPasswordMap } = require('../config');
const { authLimiter } = require('../middleware/rateLimit');
const { timingSafeCompare } = require('../utils');

const router = express.Router();

// 认证 API
router.post('/auth', authLimiter, (req, res) => {
  const { password } = req.body || {};

  if (typeof password !== 'string') {
    return res.status(401).json({ success: false, error: '密码错误' });
  }

  if (MULTI_USER_MODE) {
    let matchedUserId = null;
    for (const [validPassword, userId] of userPasswordMap.entries()) {
      if (timingSafeCompare(password, validPassword)) {
        matchedUserId = userId;
        break;
      }
    }
    if (matchedUserId) {
      return res.json({ success: true, userId: matchedUserId, mode: 'multi' });
    }
    return res.status(401).json({ success: false, error: '密码错误' });
  }

  if (!ACCESS_PASSWORD) {
    return res.json({ success: true, noPassword: true, mode: 'single' });
  }

  if (timingSafeCompare(password, ACCESS_PASSWORD)) {
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
  router
};