const { ACCESS_PASSWORD } = require('../config');
const { isMultiUserMode, authenticate } = require('../users');
const { timingSafeCompare } = require('../utils');

// 从各类通道读取凭证：header 优先，其次请求体，最后查询参数
function readCredential(req) {
  const headers = req.headers || {};
  const body = req.body || {};
  const query = req.query || {};

  return {
    password: headers['x-access-password'] || body.password || query.password || '',
    userId: headers['x-user-id'] || body.userId || query.userId || ''
  };
}

// 统一的安全性认证中间件
// 多用户模式：用户名 + 密码双要素，服务端按用户名定位并绑定 req.userId（不信任客户端传入的 userId）
// 单用户模式：沿用仅密码（可选）认证，req.userId 恒为 null
function requireAuth(req, res, next) {
  const { password, userId } = readCredential(req);

  if (isMultiUserMode()) {
    if (!userId) {
      return res.status(401).json({ error: '未授权访问：缺少用户名' });
    }

    if (!password) {
      return res.status(401).json({ error: '未授权访问：缺少凭证' });
    }

    const result = authenticate(userId, password);
    if (!result.ok) {
      const status = result.code === 'disabled' ? 403 : 401;
      return res.status(status).json({ error: result.error });
    }

    req.userId = result.user.id;
    return next();
  }

  if (ACCESS_PASSWORD) {
    if (!timingSafeCompare(password, ACCESS_PASSWORD)) {
      return res.status(401).json({ error: '未授权访问：密码错误' });
    }
  }

  req.userId = null;
  return next();
}

module.exports = {
  requireAuth
};
