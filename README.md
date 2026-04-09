# Web Clipboard

跨设备剪贴板同步工具，支持文字、图片和文件消息的实时同步。

## 功能特性

- 默认无密码开放访问，可选密码保护
- **支持多用户模式，密码隔离数据**
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

# 启用密码保护（单用户模式）
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORD=你的密码 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest

# 多用户模式（密码隔离数据）
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3 \
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
      # 单用户模式
      - ACCESS_PASSWORD=你的密码
      # 多用户模式（取消注释使用）
      # - ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
      # - MIGRATE_DEFAULT_USER=user1  # 迁移单用户数据到指定用户
      - EXPIRE_HOURS=168
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
| `ACCESS_PASSWORD` | 单用户模式访问密码（留空则无密码模式） | 空（无密码） |
| `ACCESS_PASSWORDS` | 多用户模式密码映射（格式：`userId:password,userId:password`） | 空 |
| `MIGRATE_DEFAULT_USER` | 迁移单用户数据到指定用户（仅多用户模式首次启动） | 空 |
| `EXPIRE_HOURS` | 数据过期时间（小时） | `168`（7天） |
| `MESSAGE_PAGE_SIZE` | 分页加载每页数量 | `30` |
| `SOCKET_SYNC_LIMIT` | Socket 首次同步数量 | `20` |
| `STORAGE_ROOT` | 数据根目录 | `./data` |
| `FILE_CLEANUP_INTERVAL_MINUTES` | 孤儿文件清理间隔（分钟） | `30` |

## 运行模式

### 单用户模式

使用 `ACCESS_PASSWORD` 环境变量设置密码。数据存储在 `data/messages.json` 和 `data/uploads/`。

### 多用户模式

使用 `ACCESS_PASSWORDS` 环境变量设置密码映射：

```
ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
```

每个用户的数据独立存储在：
- `data/users/user1/messages.json`
- `data/users/user1/uploads/`

用户输入密码后，系统自动识别用户身份，数据完全隔离。

### 从单用户迁移到多用户

如果之前使用单用户模式，切换到多用户模式时：

1. 设置 `MIGRATE_DEFAULT_USER` 指定迁移目标用户
2. 系统会自动将 `data/messages.json` 和 `data/uploads/` 迁移到目标用户目录

```bash
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORDS=user1:pass1,user2:pass2 \
  -e MIGRATE_DEFAULT_USER=user1 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest
```

如果不设置 `MIGRATE_DEFAULT_USER`，单用户数据会保留在磁盘但不会被读取。

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

### 1.4.0（2026-04-08）

- 新增多用户模式：通过不同密码隔离数据，每个用户独立存储空间。
- 新增数据迁移：支持从单用户模式自动迁移。
- 修复图片懒加载导致页面打开时不能自动滚动到底部问题。
- 修复密码访问界面无法展示版本号问题。

### 1.3.2（2026-04-06）

- 修复上传进度条挤占按钮布局问题。

### 1.3.1（2026-04-06）

- 优化文件/图片上传：改用 FormData 方式，避免 base64 编码导致的 33% 体积膨胀。
- 进度条显示真实文件大小，不再显示编码后的膨胀体积。

## 技术栈

- 后端：Node.js + Express + Socket.io
- 前端：原生 HTML/CSS/JavaScript
- 实时通信：WebSocket

## License

MIT
