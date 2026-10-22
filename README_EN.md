# Web Clipboard

English | [简体中文](./README.md)

A cross-device clipboard synchronization tool supporting real-time synchronization of text, images, and files.

## Features

- **Multi-Device Real-Time Sync**
  - Instant cross-device synchronization powered by WebSocket, with auto-reconnection and missed-message backfill
  - Chatbox-style message cards with smooth infinite scroll history loading
  - Reliable server-side persistence, ensuring zero data loss upon server restarts
- **Rich Media & Interactive Experience**
  - **Text**: One-click quick copy, markdown inline code/code block rendering, and auto-hyperlink detection
  - **Images**: Direct paste from clipboard screenshot or multi-image upload, adaptive thumbnails with dynamic original image fetching, and auto-transcoding for HEIC
  - **Audio, Video & Files**: Direct in-card inline playback preview for audio/video media, and easy upload/download for any file format
  - **Message Remarks**: Add and edit multi-line contextual remarks for any message, synced in real-time across devices
  - **Deep Clipboard Integration**: Shortcut auto-capture when switching windows, and double-click paste button to "paste and send" instantly
- **Global Search & Filter**
  - Instant fuzzy search across text content, filenames, and remarks with luminous keyword highlighting
  - Category pill filters (All / Text / Image / Video / File) with combined keyword search support
- **Secure Sharing**
  - Generate standalone shareable links for any message with custom passwords and expiration durations
  - Dedicated "My Shares" panel to view, copy, or revoke active share links anytime
- **User Isolation & Access Control**
  - **Multiple Modes**: Support for public password-free mode, single-user password mode, and multi-user isolated mode
  - **Multi-User Isolation**: Different passwords map directly to independent workspaces with complete data and file isolation
  - **Session Expiration Control**: Selectable session validity durations (10 minutes to 30 days) with auto-logout upon expiry
- **Optimized Experience & Maintenance**
  - **PWA Ready**: Installable to desktop or mobile home screens for a fast, native-like app experience
  - **Local Fast-Open Cache**: IndexedDB smart caching for images, providing instant loading under weak networks with automatic LRU eviction
  - **Automated Lifecycle**: Auto-cleanup of expired messages and scheduled orphan file removal, with support for single message deletion and one-click clear all

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

# Multi-user mode (Data isolated by password)
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
      # Multi-user mode (uncomment to use)
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
| `ACCESS_PASSWORDS` | Multi-user mode password mapping (Format: `userId:password,userId:password`) | Empty |
| `MIGRATE_DEFAULT_USER` | Migrate single-user data to a specified user (only on multi-user mode first run) | Empty |
| `EXPIRE_HOURS` | Data expiration time (hours) | `168` (7 days) |
| `MESSAGE_PAGE_SIZE` | Messages loaded per page | `30` |
| `SOCKET_SYNC_LIMIT` | Socket initial sync limit | `20` |
| `STORAGE_ROOT` | Data root directory | `./data` |
| `FILE_CLEANUP_INTERVAL_MINUTES` | Interval for cleaning up orphan files (minutes) | `30` |
| `SHARE_MAX_EXPIRE_HOURS` | Maximum expiration time for shared links (hours) | `168` (7 days) |

## Run Modes

### Single-user Mode

Set a password using the `ACCESS_PASSWORD` environment variable. Data is stored in `data/messages.json` and `data/uploads/`.

### Multi-user Mode

Set user password mapping using the `ACCESS_PASSWORDS` environment variable:

```
ACCESS_PASSWORDS=user1:pass1,user2:pass2,user3:pass3
```

Each user's data is stored independently in:
- `data/users/user1/messages.json`
- `data/users/user1/uploads/`

After users enter their password, the system automatically identifies the user, and data is completely isolated.

### Migration from Single-user to Multi-user

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

1. **Access / Login**: Open the page (instant entry in password-free mode; choose session expiration duration in password mode).
2. **Send Text**: Type in the input box, press Enter or click "Send"; supports markdown code and link highlighting.
3. **Clipboard Interaction**: Click "Paste" to load text, double-click "Paste" to send immediately; press `Ctrl/Cmd + V` on an inactive window to auto-focus and load clipboard contents.
4. **Send Images & Files**: Click "Paste Image" or paste screenshots directly; click the attachment 📎 icon to upload images, audio, video, or files.
5. **Media Actions**: Click images to preview full size, copy thumbnails or original images with one click; audio/video can be played inline within cards.
6. **Search & Filter**: Type keywords in the top search bar for instant search, or click category pills (Text/Image/Video/File) to browse.
7. **Message Remarks**: Click "Remark" on a card to add or edit notes with instant multi-device sync.
8. **Share Messages**: Click "Share" to create a link with optional passwords and expiration; manage them in "My Shares".
9. **Manage & Logout**: Hover over message cards to delete; click "Clear" to clear all history; click "Logout" to sign out and clear saved credentials.

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
