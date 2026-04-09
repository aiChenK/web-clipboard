const { MULTI_USER_MODE, SOCKET_SYNC_LIMIT } = require('./config');
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

  io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    if (MULTI_USER_MODE) {
      socket.on('join', (userId) => {
        if (userId) {
          socket.join(userId);
          console.log(`用户 ${socket.id} 加入房间: ${userId}`);

          const initialPage = getMessagesPage({
            before: Number.NaN,
            limit: SOCKET_SYNC_LIMIT,
            userId
          });

          socket.emit('sync', {
            ...initialPage,
            messages: initialPage.messages.map((msg) => toPublicMessage(msg, userId))
          });
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