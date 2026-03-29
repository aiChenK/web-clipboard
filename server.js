const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'aichenk';
const EXPIRE_HOURS = parseInt(process.env.EXPIRE_HOURS) || 168;
const MESSAGE_PAGE_SIZE = parseInt(process.env.MESSAGE_PAGE_SIZE) || 30;
const SOCKET_SYNC_LIMIT = parseInt(process.env.SOCKET_SYNC_LIMIT) || 20;

let messages = [];
let lastActivity = Date.now();

const EXPIRE_TIME = EXPIRE_HOURS * 60 * 60 * 1000;

function clampPageSize(limit) {
  if (!Number.isFinite(limit)) return MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(limit, 1), 100);
}

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function normalizeImageContent(content) {
  if (isDataUrl(content)) {
    return { thumbnail: content, original: content };
  }

  if (content && typeof content === 'object') {
    const thumbnail = isDataUrl(content.thumbnail) ? content.thumbnail : null;
    const original = isDataUrl(content.original) ? content.original : null;
    if (thumbnail || original) {
      return {
        thumbnail: thumbnail || original,
        original: original || thumbnail
      };
    }
  }

  return null;
}

function extractOriginalImageContent(content) {
  if (isDataUrl(content)) return content;
  if (!content || typeof content !== 'object') return null;
  if (isDataUrl(content.original)) return content.original;
  if (isDataUrl(content.thumbnail)) return content.thumbnail;
  return null;
}

function toPublicMessage(message) {
  if (message.type !== 'image') {
    return message;
  }

  const normalized = normalizeImageContent(message.content);
  if (!normalized) {
    return {
      ...message,
      content: { thumbnail: '' }
    };
  }

  return {
    ...message,
    content: {
      thumbnail: normalized.thumbnail,
      hasOriginal: normalized.original !== normalized.thumbnail
    }
  };
}

function getMessagesPage({ before, limit }) {
  const pageLimit = clampPageSize(limit);
  const source = Number.isFinite(before)
    ? messages.filter((item) => item.timestamp < before)
    : messages;
  const start = Math.max(source.length - pageLimit, 0);
  const page = source.slice(start);

  return {
    messages: page,
    hasMore: start > 0,
    total: messages.length
  };
}

function cleanupExpiredData() {
  const now = Date.now();
  if (now - lastActivity > EXPIRE_TIME) {
    messages = [];
    lastActivity = now;
  }
}

setInterval(cleanupExpiredData, 5 * 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  
  if (password === ACCESS_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

app.get('/api/messages', (req, res) => {
  const before = Number(req.query.before);
  const limit = Number(req.query.limit);
  const page = getMessagesPage({ before, limit });
  res.json({
    ...page,
    messages: page.messages.map(toPublicMessage),
    expireHours: EXPIRE_HOURS
  });
});

app.post('/api/messages', (req, res) => {
  const { type, content } = req.body;
  
  if (!type || !content) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  const message = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    type,
    content,
    timestamp: Date.now()
  };

  if (type === 'image') {
    const normalized = normalizeImageContent(content);
    if (!normalized) {
      return res.status(400).json({ error: '图片内容格式错误' });
    }
    message.content = normalized;
  }
  
  messages.push(message);
  lastActivity = Date.now();
  
  io.emit('message-new', toPublicMessage(message));
  
  res.json({ success: true, message: toPublicMessage(message) });
});

app.get('/api/messages/:id/image-original', (req, res) => {
  const { id } = req.params;
  const message = messages.find((item) => item.id === id);
  if (!message) {
    return res.status(404).json({ error: '消息不存在' });
  }
  if (message.type !== 'image') {
    return res.status(400).json({ error: '该消息不是图片' });
  }

  const original = extractOriginalImageContent(message.content);
  if (!original) {
    return res.status(404).json({ error: '原图不存在' });
  }

  return res.json({ id: message.id, original });
});

app.delete('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  
  const index = messages.findIndex(m => m.id === id);
  if (index === -1) {
    return res.status(404).json({ error: '消息不存在' });
  }
  
  messages.splice(index, 1);
  lastActivity = Date.now();
  
  io.emit('message-delete', id);
  
  res.json({ success: true });
});

app.post('/api/messages/clear', (req, res) => {
  messages = [];
  lastActivity = Date.now();
  
  io.emit('messages-clear');
  
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  const initialPage = getMessagesPage({
    before: Number.NaN,
    limit: SOCKET_SYNC_LIMIT
  });
  socket.emit('sync', {
    ...initialPage,
    messages: initialPage.messages.map(toPublicMessage)
  });
  
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`访问密码: ${ACCESS_PASSWORD}`);
  console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
});
