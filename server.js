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

let messages = [];
let lastActivity = Date.now();

const EXPIRE_TIME = EXPIRE_HOURS * 60 * 60 * 1000;

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
  res.json({ messages, expireHours: EXPIRE_HOURS });
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
  
  messages.push(message);
  lastActivity = Date.now();
  
  io.emit('message-new', message);
  
  res.json({ success: true, message });
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
  
  socket.emit('sync', { messages });
  
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`访问密码: ${ACCESS_PASSWORD}`);
  console.log(`数据过期时间: ${EXPIRE_HOURS} 小时`);
});
