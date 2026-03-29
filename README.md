# Web Clipboard

跨设备剪贴板同步工具，支持文字和图片消息的实时同步。

## 功能特性

- 密码保护访问
- 聊天框式消息展示
- WebSocket 实时同步
- 一键复制文本/图片
- 消息删除与清空
- 自动过期清理

## 快速开始

### Docker 部署（推荐）

```bash
# 拉取镜像
docker pull aichenk/web-clipboard:latest

# 运行容器
docker run -d -p 3000:3000 -e ACCESS_PASSWORD=你的密码 --name web-clipboard aichenk/web-clipboard:latest
```

### Docker Compose

```yaml
version: "3"
services:
  web-clipboard:
    image: aichenk/web-clipboard:latest
    ports:
      - "3000:3000"
    environment:
      - ACCESS_PASSWORD=你的密码
      - EXPIRE_HOURS=168
    restart: unless-stopped
```

### 本地运行

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `ACCESS_PASSWORD` | 访问密码 | `aichenk` |
| `EXPIRE_HOURS` | 数据过期时间（小时） | `168`（7天） |
| `MESSAGE_PAGE_SIZE` | 分页加载每页数量 | `30` |
| `SOCKET_SYNC_LIMIT` | Socket 首次同步数量 | `20` |

## 使用说明

1. 打开网页并输入访问密码。
2. 在输入框中输入文本，按 Enter 或点击“发送”。
3. 可通过“粘贴图片”或上传按钮发送图片。
4. 鼠标悬停消息可显示删除按钮。
5. 点击“复制/复制图片”可快速复制内容。

## 更新日志

### 1.0.5（2026-03-29）

- 删除按钮位置调整到消息卡片右下角。
- 图片新增自适应缩略图策略，避免加载速度过慢。
- 新增“退出”按钮，支持主动退出登录并清除本地密码缓存。

### 1.0.4（2026-03-27）

- 修复后台挂起导致 WebSocket 断开后，切回标签页虽重连但消息不自动刷新的问题。
- 新增重连后自动拉取最新消息，确保断线期间的数据能及时补齐。

### 1.0.3（2026-03-26）

- 修复文本换行显示问题（不再显示为 `\n`）。
- 优化消息初始化加载：首屏优先加载最近消息，支持上滚按需加载更早消息。
- 新增加载状态提示（首屏加载、上滚加载更早消息）。
- 图片消息增加占位与懒加载策略。

### 1.0.2（2026-03-24）

- 增加 favicon 图标。

### 1.0.1（2026-03-24）

- 布局改为聊天框模式。

### 1.0.0（2026-03-24）

- 实现跨设备剪贴板同步工具。

## 技术栈

- 后端：Node.js + Express + Socket.io
- 前端：原生 HTML/CSS/JavaScript
- 实时通信：WebSocket

## License

MIT
