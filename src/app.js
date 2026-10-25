const express = require('express');
const http = require('http');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { setupRoutes } = require('./routes');
const { setupSocket, socketHelper } = require('./socket');

// 创建 Express 应用
function createApp() {
  const app = express();
  app.set('trust proxy', 1); // 支持反向代理，获取真实客户端 IP

  // 安全响应头（完整 CSP 需先梳理前端 blob:/data: 资源依赖，暂以专项任务另行启用）
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  const server = http.createServer(app);

  // 创建 Socket.io 服务器
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // 设置 socket helper 到 app，供路由使用
  app.set('io', socketHelper);

  // 设置路由
  setupRoutes(app);

  // 设置 Socket.io 处理
  setupSocket(io);

  return { app, server, io };
}

module.exports = {
  createApp
};