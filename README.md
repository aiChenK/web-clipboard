# Web Clipboard

跨设备剪贴板同步工具，支持文字和图片消息的实时同步。

## 功能特性

- 🔒 **密码保护** - 访问密码验证，安全可靠
- 💬 **聊天形式** - 文字和图片消息统一展示
- 🔄 **实时同步** - WebSocket 实时推送，多设备同步
- 📋 **一键复制** - 快速复制文字或图片到剪贴板
- 🗑️ **消息管理** - 支持删除单条消息或清空全部
- ⏰ **自动过期** - 数据自动清理，可配置过期时间

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
version: '3'
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
| `EXPIRE_HOURS` | 数据过期时间（小时） | `168`（1周） |

## 使用说明

1. 打开网页，输入访问密码
2. 在输入框输入文字，按 Enter 或点击发送
3. 点击 🖼️ 按钮选择图片，或点击「粘贴图片」
4. 鼠标悬停消息可显示删除按钮
5. 点击消息下方的「复制」按钮复制内容

## 注意事项

### 图片复制

由于浏览器安全限制，网页端复制图片功能需要 **HTTPS** 环境：

- **HTTPS 环境**：可直接点击「复制图片」按钮
- **HTTP 环境**：请右键点击图片 → 选择「复制图片」使用系统级复制功能

推荐使用 Nginx 反向代理配置 HTTPS 证书。

## 技术栈

- **后端**: Node.js + Express + Socket.io
- **前端**: 原生 HTML/CSS/JavaScript
- **实时通信**: WebSocket

## License

MIT
