/**
 * WebSocket 实时通信模块 (基于 Socket.IO 封装)
 */

import { STORAGE_KEYS } from './config.js';
import { state } from './state.js';

let socketInstance = null;

export function getSocket() {
  if (!socketInstance && typeof io !== 'undefined') {
    socketInstance = io({
      autoConnect: false,
      auth: (cb) => {
        cb({
          password: localStorage.getItem(STORAGE_KEYS.PASSWORD) || '',
          userId: localStorage.getItem(STORAGE_KEYS.USER_ID) || ''
        });
      }
    });
  }
  return socketInstance;
}

export function initSocketConnection(callbacks = {}) {
  const socket = getSocket();
  if (!socket) return null;

  const {
    onStatusChange,
    onSync,
    onNewMessage,
    onDeleteMessage,
    onClearMessages,
    onFavoriteMessage,
    onRemarkMessage,
    onAuthError
  } = callbacks;

  socket.on('connect', () => {
    if (onStatusChange) onStatusChange('connected', '已连接');
    if (!state.isAuthenticated) return;

    if (state.currentMode === 'multi' && state.userId) {
      socket.emit('join', state.userId);
    }

    state.emit('socket:reconnect');
  });

  socket.on('disconnect', () => {
    if (onStatusChange) onStatusChange('disconnected', '已断开');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket 连接失败:', err.message);
    if (err && err.message && err.message.includes('Authentication error')) {
      if (onAuthError) onAuthError();
    }
  });

  socket.on('sync', (data) => {
    if (!state.isAuthenticated) return;
    if (onSync) onSync(data);
  });

  socket.on('message-new', (msg) => {
    if (!state.isAuthenticated) return;
    if (onNewMessage) onNewMessage(msg);
  });

  socket.on('message-delete', (id) => {
    if (!state.isAuthenticated) return;
    if (onDeleteMessage) onDeleteMessage(id);
  });

  socket.on('messages-clear', (data) => {
    if (!state.isAuthenticated) return;
    if (onClearMessages) onClearMessages(data);
  });

  socket.on('message-favorite', (data) => {
    if (!state.isAuthenticated) return;
    if (onFavoriteMessage) onFavoriteMessage(data);
  });

  socket.on('message-remark', (data) => {
    if (!state.isAuthenticated) return;
    if (onRemarkMessage) onRemarkMessage(data);
  });

  return socket;
}

export function connectSocket() {
  const socket = getSocket();
  if (socket) {
    socket.connect();
    if (state.currentMode === 'multi' && state.userId) {
      socket.emit('join', state.userId);
    }
  }
}

export function disconnectSocket() {
  const socket = getSocket();
  if (socket) {
    socket.disconnect();
  }
}
