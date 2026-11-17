const { getUserState } = require('./storage');
const MAX_GROUPS = 5;

function getMessageCounts(state) {
  const groups = Object.fromEntries(state.groups.map((group) => [group.id, 0]));
  let favorites = 0;
  for (const message of state.messages) {
    if (message.favorite) favorites++;
    if (message.groupId) groups[message.groupId]++;
  }
  return { messages: state.messages.length, favorites, groups };
}

function parseGroupId(value, groups, allowAll = false) {
  if (allowAll && (value === undefined || value === 'all')) return undefined;
  if (value === undefined || value === null || value === '' || (allowAll && value === 'ungrouped')) return null;
  if (typeof value !== 'string' || !groups.some((group) => group.id === value)) {
    throw new Error('分组不存在');
  }
  return value;
}

function validateGroup(source, allowAll = false) {
  return (req, res, next) => {
    try {
      req.groupId = parseGroupId(req[source]?.groupId, getUserState(req.userId).groups, allowAll);
      next();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}

function validateGroupName(value, groups, excludeId = null) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30) {
    return '分组名称须为 1–30 个字符';
  }
  if (['消息', '收藏', '全部', '未分组'].includes(value.trim())) return '此名称为系统保留名称';
  if (groups.some((group) => group.id !== excludeId && group.name === value.trim())) {
    return '分组名称已存在';
  }
  return null;
}

module.exports = { MAX_GROUPS, getMessageCounts, parseGroupId, validateGroup, validateGroupName };
