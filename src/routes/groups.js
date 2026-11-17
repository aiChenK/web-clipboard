const express = require('express');
const { randomUUID } = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { getUserState, schedulePersist } = require('../storage');
const { MAX_GROUPS, getMessageCounts, validateGroupName } = require('../groups');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const state = getUserState(req.userId);
  res.json({ groups: state.groups, counts: getMessageCounts(state), maxGroups: MAX_GROUPS });
});

router.post('/', (req, res) => {
  const state = getUserState(req.userId);
  const error = validateGroupName(req.body?.name, state.groups);
  if (error) return res.status(400).json({ error });
  if (state.groups.length >= MAX_GROUPS) return res.status(400).json({ error: `最多创建 ${MAX_GROUPS} 个分组` });

  const group = { id: randomUUID(), name: req.body.name.trim() };
  state.groups.push(group);
  schedulePersist(req.userId);
  const counts = getMessageCounts(state);
  req.app.get('io').broadcastGroups(req.userId, { groups: state.groups, counts });
  res.json({ success: true, group, groups: state.groups, counts });
});

router.patch('/:id', (req, res) => {
  const state = getUserState(req.userId);
  const group = state.groups.find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: '分组不存在' });
  const error = validateGroupName(req.body?.name, state.groups, group.id);
  if (error) return res.status(400).json({ error });

  group.name = req.body.name.trim();
  schedulePersist(req.userId);
  const counts = getMessageCounts(state);
  req.app.get('io').broadcastGroups(req.userId, { groups: state.groups, counts });
  res.json({ success: true, group, groups: state.groups, counts });
});

router.delete('/:id', (req, res) => {
  const state = getUserState(req.userId);
  const index = state.groups.findIndex((group) => group.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: '分组不存在' });

  state.groups.splice(index, 1);
  for (const message of state.messages) {
    if (message.groupId === req.params.id) message.groupId = null;
  }
  schedulePersist(req.userId);
  const counts = getMessageCounts(state);
  req.app.get('io').broadcastGroups(req.userId, { groups: state.groups, counts });
  res.json({ success: true, groups: state.groups, counts });
});

module.exports = router;
