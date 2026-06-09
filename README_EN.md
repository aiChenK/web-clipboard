# Web Clipboard

English | [简体中文](./README.md)

A cross-device clipboard synchronization tool supporting real-time synchronization of text, images, and files.

## Features

- Default password-free public access, with optional password protection
- **Multi-user mode, with data isolated by password (v1.4.0+)**
- **PWA (Progressive Web App) support for offline asset caching, installable directly to home screen like a native app (v1.6.0+)**
- Chatbox-style message display, supporting infinite scroll loading of historical messages
- Real-time synchronization via WebSocket, with automatic message synchronization upon reconnection
- Text message transmission and one-click copy, **supporting markdown inline code/code block and hyperlink intelligent highlight rendering with regex (v1.6.0+)**
- Image pasting/uploading, supporting adaptive thumbnails and copy original image (dynamic requests)
- File uploading/downloading, **supporting inline multimedia playback previews for audio and video messages directly on the page (v1.6.0+)**
- **Deep system clipboard integration: Double-click paste button to "paste & send", automatically focuses and loads clipboard when pasting via shortcuts while the page is inactive (v1.6.0+)**
- **Message sharing feature, generating shareable links with passwords and expiration times (v1.5.0+)**
- Server-side message persistence, preventing data loss upon service restarts
- Message deletion and one-click clear, clearing associated files simultaneously
- Automatic expiration cleanup, automatically deleting outdated data
- Scheduled cleaning of orphan files on disk, automatically removing empty date directories
- **Integrated API request rate limiting defense mechanism, with password brute-force protection (v1.5.9+)**
- **Security hardening: Completely blocks multi-user mode privilege escalation (IDOR), unauthorized file uploads, and broadcast eavesdropping risks (v1.5.9+)**

## Quick Start

### Docker Deployment (Recommended)

```bash
# Pull the image
docker pull aichenk/web-clipboard:latest

# Run the container (Default: password-free)
docker run -d \
  -p 3000:3000 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest

# Enable password protection (Single-user mode)
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORD=your_password \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest

# Multi-user mode (Data isolated by password) **v1.4.0+**
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
      # Single-user mode
      - ACCESS_PASSWORD=your_password
      # Multi-user mode **v1.4.0+** (uncomment to use)
      # - ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
      # - MIGRATE_DEFAULT_USER=user1  # Migrate single-user data to a specified user
      - EXPIRE_HOURS=168
      - FILE_CLEANUP_INTERVAL_MINUTES=30
    restart: unless-stopped
    volumes:
      - web-clipboard-data:/app/data

volumes:
  web-clipboard-data:
```

### Run Locally

```bash
# Install dependencies
npm install

# Start the service
npm start
```

## Environment Variables

| Variable | Description | Default |
|------|------|--------|
| `PORT` | Service port | `3000` |
| `ACCESS_PASSWORD` | Single-user mode access password (leave empty for password-free mode) | Empty (No password) |
| `ACCESS_PASSWORDS` | Multi-user mode password mapping (Format: `userId:password,userId:password`) **v1.4.0+** | Empty |
| `MIGRATE_DEFAULT_USER` | Migrate single-user data to a specified user (only on multi-user mode first run) **v1.4.0+** | Empty |
| `EXPIRE_HOURS` | Data expiration time (hours) | `168` (7 days) |
| `MESSAGE_PAGE_SIZE` | Messages loaded per page | `30` |
| `SOCKET_SYNC_LIMIT` | Socket initial sync limit | `20` |
| `STORAGE_ROOT` | Data root directory | `./data` |
| `FILE_CLEANUP_INTERVAL_MINUTES` | Interval for cleaning up orphan files (minutes) | `30` |
| `SHARE_MAX_EXPIRE_HOURS` | Maximum expiration time for shared links (hours) **v1.5.0+** | `168` (7 days) |

## Run Modes

### Single-user Mode

Set a password using the `ACCESS_PASSWORD` environment variable. Data is stored in `data/messages.json` and `data/uploads/`.

### Multi-user Mode **v1.4.0+**

Set user password mapping using the `ACCESS_PASSWORDS` environment variable:

```
ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
```

Each user's data is stored independently in:
- `data/users/user1/messages.json`
- `data/users/user1/uploads/`

After users enter their password, the system automatically identifies the user, and data is completely isolated.

### Migration from Single-user to Multi-user **v1.4.0+**

If you previously used single-user mode and are switching to multi-user mode:

1. Set `MIGRATE_DEFAULT_USER` to specify the target migration user.
2. The system will automatically migrate `data/messages.json` and `data/uploads/` to the target user's directory.

```bash
docker run -d \
  -p 3000:3000 \
  -e ACCESS_PASSWORDS=user1:pass1,user2:pass2 \
  -e MIGRATE_DEFAULT_USER=user1 \
  -v web-clipboard-data:/app/data \
  --name web-clipboard \
  aichenk/web-clipboard:latest
```

If `MIGRATE_DEFAULT_USER` is not set, single-user data will remain on disk but will not be read.

## Usage Instructions

1. Open the page (accesses directly in password-free mode, prompts for password if enabled).
2. Input text in the input box, press Enter or click "Send".
3. Click the "Paste" button to paste text from clipboard into the input box.
4. Click the "Paste Image" button or paste an image directly into the input box.
5. Click the attachment button 📎 to upload images or files.
6. Image messages support "Copy Thumbnail" and "Copy Original Image" (fetched dynamically from the server).
7. File messages support downloading. Click "Download File" to download.
8. Hover over a message card to reveal action buttons to delete a single message.
9. Click the "Share" button to generate a shareable link, supporting access password and expiration settings **v1.5.0+**.
10. Click "My Shares" to view, copy, or cancel created shares **v1.5.0+**.
11. Click "Clear" to clear all messages with one click.
12. Under password mode, click "Logout" to clear the local password cache and return to the login page.

## Risk Warning for Sharing Feature

> **Important Security Warning**

- **Link Leakage Risk**: Once a shared link is generated, anyone with access to the link can view the shared content. Share with caution and avoid sending links to untrusted parties.
- **Password Protection Limitations**: Shared passwords use simple verification and are not stored with encryption. Do not use important passwords; a unique, dedicated password for sharing is recommended.
- **Message Dependency**: Shares rely on the existence of the original message. If the original message is deleted, the shared link will expire.
- **No Access Audit**: Sharing visits do not log visitor identity, making it impossible to audit who accessed the shared content.
- **Content Forwarding Risk**: Shared content can be copied, downloaded, or screenshot and forwarded. Do not share sensitive or confidential information.

**Recommendations**:
- Share non-sensitive content only
- Set shorter expiration times
- Set passwords for important shares
- Clean up unneeded shares regularly in "My Shares"

## Changelog

> [View full changelog](CHANGELOG.md)

## Tech Stack

- Backend: Node.js + Express + Socket.io
- Frontend: Native HTML/CSS/JavaScript
- Real-time Communication: WebSocket

## License

MIT
