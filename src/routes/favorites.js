const express = require('express');
const { extractUserId } = require('./auth');
const { getUserState, schedulePersist } = require('../storage');
const { toPublicMessage } = require('../message');
const { MULTI_USER_MODE } = require('../config');

const router = express.Router();

// 获取收藏列表
router.get('/', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const favorites = state.messages.filter((msg) => msg.favorite);
  res.json({
    messages: favorites.map((msg) => toPublicMessage(msg, userId)),
    total: favorites.length
  });
});

// 收藏消息
router.post('/:id/favorite', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = true;
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  req.app.get('io').broadcastFavorite(userId, { id, favorite: true, message: publicMessage });

  return res.json({ success: true, message: publicMessage });
});

// 取消收藏
router.delete('/:id/favorite', extractUserId, (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const { id } = req.params;
  const message = state.messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }

  message.favorite = false;
  schedulePersist(userId);

  const publicMessage = toPublicMessage(message, userId);

  req.app.get('io').broadcastFavorite(userId, { id, favorite: false, message: publicMessage });

  return res.json({ success: true, message: publicMessage });
});

module.exports = router;