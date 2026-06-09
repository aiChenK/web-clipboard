const { MULTI_USER_MODE, ACCESS_PASSWORD, SOCKET_SYNC_LIMIT, userPasswordMap } = require('./config');
const { getMessagesPage } = require('./storage');
const { toPublicMessage } = require('./message');

// Socket.io 广播辅助对象
const socketHelper = {
  io: null,

  // 设置 io 实例
  setIo(ioInstance) {
    this.io = ioInstance;
  },

  // 广播新消息
  broadcastMessage(userId, message) {
    if (MULTI_USER_MODE && userId) {
      this.io.to(userId).emit('message-new', message);
    } else {
      this.io.emit('message-new', message);
    }
  },

  // 广播删除消息
  broadcastDelete(userId, messageId) {
    if (MULTI_USER_MODE && userId) {
      this.io.to(userId).emit('message-delete', messageId);
    } else {
      this.io.emit('message-delete', messageId);
    }
  },

  // 广播清空消息
  broadcastClear(userId, data) {
    if (MULTI_USER_MODE && userId) {
      this.io.to(userId).emit('messages-clear', data);
    } else {
      this.io.emit('messages-clear', data);
    }
  },

  // 广播收藏状态变更
  broadcastFavorite(userId, data) {
    if (MULTI_USER_MODE && userId) {
      this.io.to(userId).emit('message-favorite', data);
    } else {
      this.io.emit('message-favorite', data);
    }
  }
};

// 设置 Socket.io 处理
function setupSocket(io) {
  socketHelper.setIo(io);

  // 连接建立时的鉴权拦截器
  io.use((socket, next) => {
    const { password, userId } = socket.handshake.auth || {};

    if (MULTI_USER_MODE) {
      if (!password) {
        return next(new Error('Authentication error: password required'));
      }
      const matchedUserId = userPasswordMap.get(password);
      if (!matchedUserId) {
        return next(new Error('Authentication error: invalid password'));
      }
      if (userId && matchedUserId !== userId) {
        return next(new Error('Authentication error: userId mismatch'));
      }
      // 将认证通过的 userId 绑定至 socket 实例上
      socket.userId = matchedUserId;
      return next();
    }

    if (ACCESS_PASSWORD) {
      if (password !== ACCESS_PASSWORD) {
        return next(new Error('Authentication error: invalid password'));
      }
    }

    socket.userId = null;
    return next();
  });

  io.on('connection', (socket) => {
    console.log('用户连接:', socket.id, '绑定用户ID:', socket.userId);

    if (MULTI_USER_MODE) {
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