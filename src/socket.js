const { ACCESS_PASSWORD, SOCKET_SYNC_LIMIT } = require('./config');
const { isMultiUserMode, authenticate } = require('./users');
const { getMessagesPage } = require('./storage');
const { toPublicMessage } = require('./message');
const { timingSafeCompare } = require('./utils');

// 握手失败限流：同来源 1 分钟内最多 10 次失败（与 HTTP 侧 authLimiter 对齐）
const HANDSHAKE_FAIL_LIMIT = 10;
const HANDSHAKE_FAIL_WINDOW_MS = 60 * 1000;
const handshakeFailures = new Map();

function getHandshakeKey(socket) {
  const forwarded = socket.handshake.headers && socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

function isHandshakeBlocked(key) {
  const entry = handshakeFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > HANDSHAKE_FAIL_WINDOW_MS) {
    handshakeFailures.delete(key);
    return false;
  }
  return entry.count >= HANDSHAKE_FAIL_LIMIT;
}

function recordHandshakeFailure(key) {
  const now = Date.now();
  const entry = handshakeFailures.get(key);
  if (!entry || now - entry.windowStart > HANDSHAKE_FAIL_WINDOW_MS) {
    handshakeFailures.set(key, { windowStart: now, count: 1 });
    return;
  }
  entry.count += 1;
}

// Socket.io 广播辅助对象（userId 为空即单用户模式，广播给所有连接）
const socketHelper = {
  io: null,

  // 设置 io 实例
  setIo(ioInstance) {
    this.io = ioInstance;
  },

  // 广播新消息
  broadcastMessage(userId, message) {
    if (userId) {
      this.io.to(userId).emit('message-new', message);
    } else {
      this.io.emit('message-new', message);
    }
  },

  // 广播删除消息
  broadcastDelete(userId, messageId) {
    if (userId) {
      this.io.to(userId).emit('message-delete', messageId);
    } else {
      this.io.emit('message-delete', messageId);
    }
  },

  // 广播清空消息
  broadcastClear(userId, data) {
    if (userId) {
      this.io.to(userId).emit('messages-clear', data);
    } else {
      this.io.emit('messages-clear', data);
    }
  },

  // 广播收藏状态变更
  broadcastFavorite(userId, data) {
    if (userId) {
      this.io.to(userId).emit('message-favorite', data);
    } else {
      this.io.emit('message-favorite', data);
    }
  },

  // 广播备注变更
  broadcastRemark(userId, data) {
    if (userId) {
      this.io.to(userId).emit('message-remark', data);
    } else {
      this.io.emit('message-remark', data);
    }
  },

  // 踢下线指定用户的全部连接（禁用 / 删除 / 重置密码后调用）
  disconnectUser(userId) {
    if (!this.io || !userId) return;
    this.io.in(userId).disconnectSockets(true);
  }
};

// 设置 Socket.io 处理
function setupSocket(io) {
  socketHelper.setIo(io);

  // 连接建立时的鉴权拦截器
  io.use((socket, next) => {
    const { password, userId } = socket.handshake.auth || {};
    const sourceKey = getHandshakeKey(socket);

    if (isHandshakeBlocked(sourceKey)) {
      return next(new Error('Authentication error: too many attempts, please retry later'));
    }

    if (isMultiUserMode()) {
      if (!userId) {
        recordHandshakeFailure(sourceKey);
        return next(new Error('Authentication error: username required'));
      }

      if (!password) {
        recordHandshakeFailure(sourceKey);
        return next(new Error('Authentication error: password required'));
      }

      const result = authenticate(userId, password);
      if (!result.ok) {
        recordHandshakeFailure(sourceKey);
        return next(new Error('Authentication error: invalid credentials'));
      }

      // 将认证通过的 userId 绑定至 socket 实例上
      socket.userId = result.user.id;
      handshakeFailures.delete(sourceKey);
      return next();
    }

    if (ACCESS_PASSWORD) {
      if (!timingSafeCompare(password, ACCESS_PASSWORD)) {
        recordHandshakeFailure(sourceKey);
        return next(new Error('Authentication error: invalid password'));
      }
    }

    socket.userId = null;
    handshakeFailures.delete(sourceKey);
    return next();
  });

  io.on('connection', (socket) => {
    console.log('用户连接:', socket.id, '绑定用户ID:', socket.userId);

    if (socket.userId) {
      socket.on('join', (userId) => {
        // 安全防御：只能加入经由认证绑定到该 Socket 实例的自身房间
        if (userId && userId === socket.userId) {
          socket.join(userId);
          console.log(`用户 ${socket.id} 成功加入自身房间: ${userId}`);

          const initialPage = getMessagesPage({
            before: Number.NaN,
            limit: SOCKET_SYNC_LIMIT,
            userId
          });

          socket.emit('sync', {
            ...initialPage,
            messages: initialPage.messages.map((msg) => toPublicMessage(msg, userId))
          });
        } else {
          console.warn(`用户 ${socket.id} 企图越权加入房间: ${userId}，已被拦截`);
          socket.emit('error', '越权访问被拒绝');
        }
      });
    } else {
      const initialPage = getMessagesPage({
        before: Number.NaN,
        limit: SOCKET_SYNC_LIMIT
      });

      socket.emit('sync', {
        ...initialPage,
        messages: initialPage.messages.map((msg) => toPublicMessage(msg))
      });
    }

    socket.on('disconnect', () => {
      console.log('用户断开连接:', socket.id);
    });
  });
}

module.exports = {
  setupSocket,
  socketHelper
};
