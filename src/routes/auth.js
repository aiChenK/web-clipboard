const express = require('express');
const { ACCESS_PASSWORD, APP_VERSION } = require('../config');
const { isMultiUserMode, authenticate } = require('../users');
const { authLimiter } = require('../middleware/rateLimit');
const { timingSafeCompare } = require('../utils');

const router = express.Router();

// 认证 API
// 多用户模式：{ userId, password }；单用户模式：{ password }
router.post('/auth', authLimiter, (req, res) => {
  const { userId, password } = req.body || {};

  // 单用户模式：仅密码（无密码模式下客户端甚至不会调用本接口）
  if (!isMultiUserMode()) {
    if (!ACCESS_PASSWORD) {
      return res.json({ success: true, noPassword: true, mode: 'single' });
    }

    if (typeof password === 'string' && password && timingSafeCompare(password, ACCESS_PASSWORD)) {
      return res.json({ success: true, mode: 'single' });
    }

    return res.status(401).json({ success: false, error: '密码错误' });
  }

  // 多用户模式：用户名 + 密码，两者缺一即按凭证错误处理（不区分「用户不存在 / 密码错误」）
  if (typeof password !== 'string' || !password) {
    return res.status(401).json({ success: false, error: '用户名或密码错误' });
  }

  const result = authenticate(userId, password);
  if (!result.ok) {
    const status = result.code === 'disabled' ? 403 : 401;
    return res.status(status).json({ success: false, error: result.error });
  }

  return res.json({
    success: true,
    mode: 'multi',
    userId: result.user.id,
    displayName: result.user.displayName || ''
  });
});

// 认证状态 API（不返回用户列表，避免用户名枚举）
router.get('/auth/status', (req, res) => {
  if (isMultiUserMode()) {
    return res.json({
      mode: 'multi',
      requirePassword: true
    });
  }

  return res.json({
    mode: 'single',
    requirePassword: Boolean(ACCESS_PASSWORD)
  });
});

// 版本信息 API
router.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, mode: isMultiUserMode() ? 'multi' : 'single' });
});

module.exports = {
  router
};
