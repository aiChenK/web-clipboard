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

### 1.2.1（2026-03-30）

- 修复版本号展示问题。

### 1.2.0（2026-03-30）

- 新增消息收藏功能：重要消息可收藏保留，清空/过期时自动保留收藏消息。
- 新增收藏标签页：独立展示已收藏内容。
- 新增版本号显示：页面标题栏显示当前版本。
- 优化界面布局：容器宽度与高度增加，展示更宽敞。

### 1.1.1（2026-03-30）

- 改为默认无密码模式，通过 `ACCESS_PASSWORD` 环境变量可选启用密码保护。

### 1.1.0（2026-03-30）

- 新增文件上传能力，文件消息支持下载。
- 新增服务端消息持久化：重启服务后仍可恢复消息数据。
- 图片原图和文件统一落盘，消息仅保存元数据。
- 图片与文件按日期目录存储（`YYYY-MM-DD`）。
- 保留「复制原图」动态请求能力（按需读取原图并返回）。
- 新增磁盘孤儿文件定时清理，并自动删除空日期目录。

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
