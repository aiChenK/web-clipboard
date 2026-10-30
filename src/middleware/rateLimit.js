const rateLimit = require('express-rate-limit');

// 针对登录验证 /api/auth 的防爆破限制：每个 IP 每 1 分钟最多失败 5 次
// skipSuccessfulRequests：登录成功（含启动时的静默校验）不占用配额，只统计失败
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 5, // 限制 5 次
  message: { error: '登录尝试过于频繁，请在 1 分钟后重试' },
  standardHeaders: true, // 返回 RateLimit-* 相关的 HTTP 头
  legacyHeaders: false, // 禁用 X-RateLimit-* 头
  skipSuccessfulRequests: true
});

// 针对敏感 API 的防刷限流限制：每个 IP 每 1 分钟最多 120 次请求
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 针对分享密码验证 /api/share/:shareId/verify 的防爆破限制：每个 IP 每 1 分钟最多尝试 10 次
const shareVerifyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: '密码尝试过于频繁，请在 1 分钟后重试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 针对管理端 /api/admin 的限流：管理操作本身较密集，只对失败请求计数
const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: '管理端请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

module.exports = {
  authLimiter,
  apiLimiter,
  shareVerifyLimiter,
  adminLimiter
};
