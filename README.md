# Web Clipboard

跨设备剪贴板同步工具，支持文字、图片和文件消息的实时同步。

## 功能特性

- 默认无密码开放访问，可选密码保护
- 聊天框式消息展示，支持滚动加载历史消息
- WebSocket 实时同步，断线重连自动补齐消息
- 文本消息发送与一键复制
- 图片粘贴/上传，支持自适应缩略图与原图复制（动态请求）
- 文件上传与下载，支持常见文件格式
- 服务端消息持久化，重启服务数据不丢失
- 消息删除与一键清空，同时清理关联文件
- 自动过期清理，超时数据自动清除
- 磁盘孤儿文件定时清理，自动删除空日期目录

## 快速开始

### Docker 部署（推荐）

```bash
# 拉取镜像
docker pull aichenk/web-clipboard:latest

# 运行容器（默认无密码）
docker run -d \
  -p 3000:3000 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest

# 启用密码保护
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORD=你的密码 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest
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
      - DATA_FILE=/app/data/messages.json
      - UPLOAD_ROOT=/app/data/uploads
      - FILE_CLEANUP_INTERVAL_MINUTES=30
    restart: unless-stopped
    volumes:
      - web-clipboard-data:/app/data

volumes:
  web-clipboard-data:
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
| `ACCESS_PASSWORD` | 访问密码（留空则无密码模式） | 空（无密码） |
| `EXPIRE_HOURS` | 数据过期时间（小时） | `168`（7天） |
| `MESSAGE_PAGE_SIZE` | 分页加载每页数量 | `30` |
| `SOCKET_SYNC_LIMIT` | Socket 首次同步数量 | `20` |
| `DATA_FILE` | 服务端消息持久化文件路径 | `./data/messages.json` |
| `STORAGE_ROOT` | 数据根目录（默认包含消息/上传） | `./data` |
| `UPLOAD_ROOT` | 上传文件根目录 | `./data/uploads` |
| `FILE_CLEANUP_INTERVAL_MINUTES` | 孤儿文件清理间隔（分钟） | `30` |

## 使用说明

1. 打开网页（无密码模式直接进入，有密码则需输入）。
2. 在输入框中输入文本，按 Enter 或点击「发送」。
3. 点击「粘贴」按钮可将剪贴板文本粘贴到输入框。
4. 点击「粘贴图片」按钮或直接在输入框粘贴剪贴板图片。
5. 点击附件按钮 📎 可选择上传图片或文件。
6. 图片消息支持「复制缩略图」与「复制原图」（动态从服务端获取）。
7. 文件消息支持下载，点击「下载文件」即可。
8. 悬停消息卡片显示删除按钮，可删除单条消息。
9. 点击「清空」可一键清除所有消息。
10. 密码模式下点击「退出」可清除本地密码缓存并返回登录页。

## 更新日志

> [查看完整更新日志](CHANGELOG.md)

### 1.3.1（2026-04-06）

- 优化文件/图片上传：改用 FormData 方式，避免 base64 编码导致的 33% 体积膨胀。
- 进度条显示真实文件大小，不再显示编码后的膨胀体积。

### 1.3.0（2026-04-06）

- 新增拖放上传功能：支持拖放图片和文件到输入区域直接上传。
- 新增上传进度条：实时显示上传进度、已上传大小和总大小。
- 新增上传取消功能：上传过程中可点击取消按钮中断上传。

### 1.2.0（2026-03-30）

- 新增消息收藏功能：重要消息可收藏保留，清空/过期时自动保留收藏消息。
- 新增收藏标签页：独立展示已收藏内容。

## 技术栈

- 后端：Node.js + Express + Socket.io
- 前端：原生 HTML/CSS/JavaScript
- 实时通信：WebSocket

## License

MIT
