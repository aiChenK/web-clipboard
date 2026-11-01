# Web Clipboard

[English](./README_EN.md) | 简体中文

跨设备剪贴板同步工具，支持文字、图片和文件消息的实时同步。

## 功能特性

- **多端实时同步**
  - 基于 WebSocket 实现跨设备即时同步，断线自动重连并补齐离线消息
  - 聊天卡片式消息展示，支持无限滚动加载历史消息
  - 服务端可靠持久化存储，服务重启数据不丢失
- **多类型内容与富交互**
  - **文本**：一键快速复制，支持 Markdown 行内代码/代码块渲染与超链接智能识别
  - **图片**：支持剪贴板截图直接粘贴与多图上传，自适应缩略图与原图复制，HEIC 格式自动转码
  - **音视频与文件**：音频与视频支持在页面内直接内联播放预览，各类文件便捷上传与下载
  - **消息备注**：支持为每条消息添加/编辑备注说明，多端毫秒级同步显示
  - **剪贴板深度集成**：页面任意位置按 `Ctrl/Cmd + V` 即可直接抓取剪贴板文本与截图
- **全局搜索与分类筛选**
  - 关键词即时模糊搜索（匹配正文、文件名与备注），命中内容微光高亮
  - 支持按「全部 / 文本 / 图片 / 视频 / 文件」快捷筛选，支持分类与关键词联合检索
- **安全分享**
  - 支持为任意消息生成独立分享链接，可自定义访问密码与有效期限
  - 提供独立「我的分享」管理面板，随时查看、复制链接或撤回失效
- **用户隔离与访问控制**
  - **多模式支持**：支持公开无密码、单用户密码保护及多用户独立空间模式
  - **多用户隔离**：多用户模式以「用户名 + 密码」登录，数据与附件物理隔离
  - **可视化管理**：配置 `ADMIN_PASSWORD` 后，通过 `/admin` 页面增删用户、重置密码、启停账号并查看存储占用
  - **登录时效控制**：支持自选凭证有效时长（10 分钟～30 天），过期自动清理注销
- **体验优化与自动维护**
  - **PWA 支持**：可直接“添加到主屏幕”，享受类原生应用的流畅沉浸体验
  - **本地秒开缓存**：内置 IndexedDB 智能图片缓存，弱网环境下秒开渲染，支持 LRU 容量自淘汰
  - **生命周期维护**：支持消息定时到期自动清除、磁盘孤儿文件定时回收，支持单条删除与一键清空未收藏消息 (v1.8.1+)
  - **标签计数与视觉统一**：主应用与分享页统一为纸墨视觉体系；「消息 / 收藏」标签页直接显示真实条数 (v1.8.1+)
  - **深色模式**：页头（分享页为右上角浮标）一键切换深浅，默认跟随系统 `prefers-color-scheme`，偏好按浏览器本地记忆并在多标签页间同步；深色下全部文字对比度 ≥ 4.5:1 (v1.8.2+)

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

# 多用户模式（用户名 + 密码，数据隔离）
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3 \
  -e ADMIN_PASSWORD=你的管理密码 \
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
      # 多用户模式（取消注释使用；仅首次启动作为种子导入 users.json）
      # - ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
      # - ADMIN_PASSWORD=你的管理密码  # 启用 /admin 管理界面
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
| `ACCESS_PASSWORD` | 单用户模式访问密码（留空则为无密码模式） | 空（无密码） |
| `ACCESS_PASSWORDS` | 多用户种子（格式：`userId:password,...`），**仅在 `data/users.json` 不存在时导入一次** | 空 |
| `ADMIN_PASSWORD` | 管理界面密码；未配置时 `/admin` 与 `/api/admin/*` 一律 404 (v1.8.0+) | 空（管理端关闭） |
| `MIGRATE_DEFAULT_USER` | 迁移单用户数据到指定用户（仅多用户模式首次启动） | 空 |
| `EXPIRE_HOURS` | 数据过期时间（小时） | `168`（7天） |
| `MESSAGE_PAGE_SIZE` | 分页加载每页数量 | `30` |
| `SOCKET_SYNC_LIMIT` | Socket 首次同步数量 | `20` |
| `TEXT_MESSAGE_MAX_LENGTH` | 单条文本消息字符数上限 (v1.7.1+) | `100000` |
| `STORAGE_ROOT` | 数据根目录 | `./data` |
| `FILE_CLEANUP_INTERVAL_MINUTES` | 孤儿文件清理间隔（分钟） | `30` |
| `SHARE_MAX_EXPIRE_HOURS` | 分享链接最大过期时间（小时） | `168`（7天） |

> **安全说明**：`GET /api/auth/status` 只返回 `{ mode, requirePassword }`，不再暴露用户列表；多用户模式下密码以 scrypt 加盐哈希保存在 `data/users.json`（权限 0600）。

## 运行模式

### 单用户模式

使用 `ACCESS_PASSWORD` 环境变量设置密码。数据存储在 `data/messages.json` 和 `data/uploads/`。

### 多用户模式

用户不再直接来自环境变量，而是保存在 `data/users.json`（唯一真相源）。启动时若该文件不存在，会用 `ACCESS_PASSWORDS` 一次性导入并落盘；此后环境变量被忽略，用户以文件为准。

```
ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
```

用户表里存在至少一个用户时即为多用户模式，登录需要「用户名 + 密码」：

- 用户名规则：`^[a-z0-9_-]{1,32}$`，全链路按小写处理，创建后不可改名
- 密码以 scrypt + 独立 salt 哈希存储，明文不落盘
- 每个用户的数据独立存储在 `data/users/<userId>/messages.json` 与 `data/users/<userId>/uploads/`

### 管理界面 (v1.8.0+)

设置 `ADMIN_PASSWORD` 后访问 `/admin`，可完成：

- 新建用户（可选是否把单用户遗留数据迁移给该用户）、重置密码、启用/禁用、删除（可选择一并清除数据）
- 查看每个用户的消息数、收藏数、占用空间与最后活跃时间
- 查看运行模式、版本、分享数量、过期配置与用户表路径

管理凭证通过 `x-admin-password` 请求头传递，与用户登录体系完全独立；管理操作即时生效，无需重启：

- 重置密码 / 禁用 / 删除后，该用户的在线连接会被立即断开，需重新登录
- 禁用后登录返回 403，删除最后一个用户会退回单用户模式（需二次确认，且会清理全部分享链接）

### 从单用户迁移到多用户

两种方式任选：

1. **命令行**：设置 `MIGRATE_DEFAULT_USER` 指定目标用户，启动时自动迁移 `data/messages.json` 与 `data/uploads/`
2. **管理界面**：首次创建用户时勾选「迁移现有单用户数据」

```bash
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORDS=user1:pass1,user2:pass2 \
  -e ADMIN_PASSWORD=your-admin-password \
  -e MIGRATE_DEFAULT_USER=user1 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest
```

如果不做迁移，单用户数据会保留在磁盘但不会被读取。

## 使用说明

1. **登录访问**：打开网页（无密码模式直接进入；单用户模式输入密码，多用户模式输入用户名与密码；可勾选登录保持有效时长）。
2. **发送文本**：在输入框输入内容，按 Enter 或点击「发送」；支持 Markdown 代码与超链接高亮。
3. **剪贴板交互**：点击「粘贴」可载入文本；未聚焦页面时直接按 `Ctrl/Cmd + V` 自动激活载入。
4. **发送图片与文件**：在输入框直接粘贴截图（页面任意位置 `Ctrl/Cmd + V` 均可），或点击 🖼️ 选择图片；点击附件 📎 图标可上传图片、音频、视频或文件。
5. **多媒体交互**：图片支持点击预览大图、一键复制缩略图或原图；音视频支持在卡片内直接内联播放。
6. **搜索与筛选**：使用顶部搜索栏输入关键词即时检索，或点击分类标签（文本/图片/视频/文件）进行分类浏览。
7. **消息备注**：点击卡片操作栏的「备注」按钮可添加或编辑文字说明，多端实时同步。
8. **消息分享**：点击「分享」可生成独立链接，支持设置有效期与访问密码；可在「我的分享」中统一管理。
9. **管理与退出**：鼠标悬停消息卡片可删除单条；点击底部「清空未收藏」可清空历史（收藏会保留，确认弹窗会给出将删除与保留的条数）；密码模式下点击「退出」注销登录。

## 分享功能风险提示

> **重要安全提醒**

- **链接传播风险**：分享链接一旦生成，任何获得链接的人都可以访问分享内容。请谨慎分享，避免将链接发送给不信任的人。
- **密码保护局限**：分享密码采用简单校验，未进行加密存储。请勿使用重要密码，建议设置独立的分享密码。
- **消息依赖**：分享依赖原消息存在。原消息被删除后，分享链接将失效。
- **无访问审计**：分享访问不会记录访问者身份，无法追溯谁访问了分享内容。
- **内容转发风险**：分享内容可被复制、下载或截图转发，请勿分享敏感或机密信息。

**建议**：
- 仅分享非敏感内容
- 设置较短的过期时间
- 为重要分享设置密码
- 定期在「我的分享」中清理不需要的分享

## 更新日志

> [查看完整更新日志](CHANGELOG.md)

## 技术栈

- 后端：Node.js + Express + Socket.io
- 前端：原生 HTML/CSS/JavaScript
- 实时通信：WebSocket

## License

MIT
