const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserState, schedulePersist, filterMessages } = require('../storage');
const { toPublicMessage } = require('../message');

const { getMessageCounts, validateGroup } = require('../groups');

const router = express.Router();

// 获取收藏列表（支持关键词搜索与分类筛选）
router.get('/', requireAuth, validateGroup('query', true), (req, res) => {
  const userId = req.userId;
  const state = getUserState(userId);
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : 'all';

  let favorites = state.messages.filter((msg) => msg.favorite);
  favorites = filterMessages(favorites, { keyword, category, groupId: req.groupId });

  const counts = getMessageCounts(state);
  res.json({
    messages: favorites.map((msg) => toPublicMessage(msg, userId)),
    total: favorites.length,
    counts,
    allFavoritesTotal: counts.favorites,
    totalFavorites: filterMessages(state.messages, { groupId: req.groupId }).filter((msg) => msg.favorite).length
  });
});

// 收藏消息
router.post('/:id/favorite', requireAuth, (req, res) => {
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
router.delete('/:id/favorite', requireAuth, (req, res) => {
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