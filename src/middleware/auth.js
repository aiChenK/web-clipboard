const { MULTI_USER_MODE, ACCESS_PASSWORD, userPasswordMap } = require('../config');

// 统一的安全性认证中间件
function requireAuth(req, res, next) {
  const headers = req.headers || {};
  const query = req.query || {};
  const body = req.body || {};

  // 尝试从各个通道获取密码凭证和用户ID
  const password = headers['x-access-password'] || body.password || query.password || '';
  const userId = headers['x-user-id'] || body.userId || query.userId || null;

  if (MULTI_USER_MODE) {
    // 多用户模式
    if (!password) {
      return res.status(401).json({ error: '未授权访问：缺少凭证' });
    }

    const matchedUserId = userPasswordMap.get(password);
    if (!matchedUserId) {
      return res.status(401).json({ error: '未授权访问：凭证无效' });
    }

    // 校验传入的 userId 是否与由密码推导出的匹配
    if (userId && matchedUserId !== userId) {
      return res.status(401).json({ error: '未授权访问：凭证与用户ID不匹配' });
    }

    // 绑定校验成功后的真实 userId
    req.userId = matchedUserId;
    return next();
  }

  // 单用户模式
  if (ACCESS_PASSWORD) {
    if (password !== ACCESS_PASSWORD) {
      return res.status(401).json({ error: '未授权访问：密码错误' });
    }
  }

  req.userId = null;
  return next();
}

module.exports = {
  requireAuth
};
