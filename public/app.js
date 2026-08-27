const socket = io({
  autoConnect: false,
  auth: (cb) => {
    cb({
      password: localStorage.getItem('web-clipboard-password') || '',
      userId: localStorage.getItem('web-clipboard-user-id') || ''
    });
  }
});

const PAGE_SIZE = 30;
const TOP_LOAD_THRESHOLD = 60;
const ORIGINAL_FETCH_TIMEOUT = 5000;
const THUMBNAIL_MAX_EDGE = 1200;
const LARGE_IMAGE_THRESHOLD_BYTES = 3 * 1024 * 1024;
const HD_COMPRESS_MAX_EDGE = 3840;

const authSection = document.getElementById('auth-section');
const chatSection = document.getElementById('chat-section');
const passwordInput = document.getElementById('password-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');
const messagesList = document.getElementById('messages-list');
const favoritesList = document.getElementById('favorites-list');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text');
const pasteTextBtn = document.getElementById('paste-text');
const imageInput = document.getElementById('image-input');
const fileInput = document.getElementById('file-input');
const pasteImageBtn = document.getElementById('paste-image');
const clearAllBtn = document.getElementById('clear-all');
const logoutBtn = document.getElementById('logout-btn');
const currentUserEl = document.getElementById('current-user');
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const toastEl = document.getElementById('toast');
const imageProcessingState = document.getElementById('image-processing-state');
const tabs = document.querySelectorAll('.tab');
const dropZone = document.getElementById('drop-zone');
const dropOverlay = document.getElementById('drop-overlay');

const imageCompressModal = document.getElementById('image-compress-modal');
const imageCompressMsg = document.getElementById('image-compress-message');
const imageCompressBtn = document.getElementById('image-compress-btn');
const imageOriginalBtn = document.getElementById('image-original-btn');
const imageCancelBtn = document.getElementById('image-cancel-btn');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const uploadProgressPercent = document.getElementById('upload-progress-percent');
const uploadProgressCancel = document.getElementById('upload-progress-cancel');
const limitDurationChk = document.getElementById('limit-duration-chk');
const loginDurationSelect = document.getElementById('login-duration-select');

let expireCheckInterval = null;

let currentXhr = null;
let uploadQueue = [];
let isUploading = false;

let messages = [];
let favorites = [];
let hasMoreMessages = false;
let initialLoaded = false;
let isInitialLoading = false;
let isLoadingOlder = false;
let isReconnectRefreshing = false;
let imageProcessingCount = 0;
let isAuthenticated = false;
let requirePassword = true;
let currentTab = 'messages';
let userId = null; // 多用户模式下的用户 ID
let currentMode = 'single'; // 运行模式: 'single' 或 'multi'
let shouldStickToBottom = false; // 是否应该保持在底部

// 统一的带凭证 Fetch 拦截包装
async function authFetch(url, options = {}) {
  const headers = { ...options.headers };
  const savedPassword = localStorage.getItem('web-clipboard-password');
  const savedUserId = localStorage.getItem('web-clipboard-user-id');

  if (savedPassword) {
    headers['x-access-password'] = savedPassword;
  }
  if (savedUserId) {
    headers['x-user-id'] = savedUserId;
  }

  return fetch(url, {
    ...options,
    headers
  });
}

const topLoadingIndicator = document.createElement('div');
topLoadingIndicator.className = 'messages-top-loading hidden';
topLoadingIndicator.textContent = '正在加载更早消息...';
messagesList.parentElement.insertBefore(topLoadingIndicator, messagesList);

const imageObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (!img.src) {
          img.src = img.dataset.src;
        }
        imageObserver.unobserve(img);
      });
    }, { rootMargin: '200px' })
  : null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3000);
}

function getImageContent(content) {
  if (typeof content === 'string') {
    return { thumbnail: content, hasOriginal: false };
  }
  if (content && typeof content === 'object') {
    const thumbnail = typeof content.thumbnail === 'string' ? content.thumbnail : '';
    const original = typeof content.original === 'string' ? content.original : '';
    const hasOriginal = typeof content.hasOriginal === 'boolean'
      ? content.hasOriginal
      : Boolean(original && original !== thumbnail);
    return { thumbnail: thumbnail || original, original, hasOriginal };
  }
  return { thumbnail: '', hasOriginal: false };
}

function getFileContent(content) {
  if (!content || typeof content !== 'object') {
    return { name: '未知文件', size: 0, mimeType: '', url: '' };
  }
  return {
    name: typeof content.name === 'string' ? content.name : '未知文件',
    size: Number.isFinite(content.size) ? content.size : 0,
    mimeType: typeof content.mimeType === 'string' ? content.mimeType : '',
    url: typeof content.url === 'string' ? content.url : ''
  };
}

function setImageProcessing(active) {
  imageProcessingCount += active ? 1 : -1;
  imageProcessingCount = Math.max(imageProcessingCount, 0);

  const isProcessing = imageProcessingCount > 0;
  imageProcessingState.classList.toggle('hidden', !isProcessing);
  imageProcessingState.textContent = isProcessing
    ? `图片处理中${imageProcessingCount > 1 ? ` (${imageProcessingCount})` : ''}...`
    : '';
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderSmartText(text) {
  if (!text) return '';

  const placeholders = [];
  let html = escapeHTML(text);

  // 1. 提取 ``` 多行代码块并占位（支持匹配可选语言声明，如 ```javascript）
  html = html.replace(/```(\w*)\n([\s\S]*?)\n?```/g, (match, lang, code) => {
    const placeholder = `___CODE_BLOCK_PLACEHOLDER_${placeholders.length}___`;
    placeholders.push({
      placeholder,
      content: `<pre class="code-block"><code>${code}</code></pre>`
    });
    return placeholder;
  });

  // 2. 提取 ` 行内代码并占位
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `___INLINE_CODE_PLACEHOLDER_${placeholders.length}___`;
    placeholders.push({
      placeholder,
      content: `<code class="inline-code">${code}</code>`
    });
    return placeholder;
  });

  // 3. 智能渲染 URL 链接
  const urlRegex = /(\bhttps?:\/\/[^\s<]+[^.,?\s<])/gi;
  html = html.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener" class="message-link">${url}</a>`;
  });

  // 4. 将剩余文本的换行符 \n 替换为 <br>
  html = html.replace(/\n/g, '<br>');

  // 5. 将代码块和行内代码占位符还原回去
  for (const item of placeholders) {
    html = html.replace(item.placeholder, item.content);
  }

  return html;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return `${date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${
    date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }`;
}

function updateMessageCount() {
  messageCount.textContent = `${messages.length} 条消息`;
  clearAllBtn.disabled = messages.length === 0;
}

function updateExpireInfo(hours) {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    expireInfo.textContent = `数据保留 ${days} 天`;
    return;
  }
  expireInfo.textContent = `数据保留 ${hours} 小时`;
}

function setTopLoading(visible) {
  topLoadingIndicator.classList.toggle('hidden', !visible);
}

function renderLoadingState() {
  messagesList.innerHTML = '<div class="messages-loading">正在加载消息...</div>';
  updateMessageCount();
}

function renderEmptyState() {
  messagesList.innerHTML = `
    <div class="empty-state">
      <p>暂无消息</p>
      <p style="font-size: 0.8rem; margin-top: 8px;">发送文字、图片或文件开始使用</p>
    </div>
  `;
  updateMessageCount();
}

function observeImage(img) {
  if (!img.dataset.src) return;
  if (img.dataset.src.startsWith('data:')) {
    img.src = img.dataset.src;
    return;
  }
  if (imageObserver) {
    imageObserver.observe(img);
    return;
  }
  img.src = img.dataset.src;
}

function createImageContent(msg) {
  const imageContent = getImageContent(msg.content);
  const thumbnailUrl = imageContent.thumbnail;
  const wrapper = document.createElement('div');
  wrapper.className = 'message-content image';

  const placeholder = document.createElement('div');
  placeholder.className = 'image-placeholder';
  placeholder.textContent = '图片加载中...';

  const img = document.createElement('img');
  img.alt = 'image';
  img.className = 'message-image loading';
  img.dataset.src = thumbnailUrl;
  img.loading = 'lazy';
  img.decoding = 'async';

  img.addEventListener('load', () => {
    img.classList.remove('loading');
    placeholder.classList.add('hidden');
    // 图片加载后，如果应该保持在底部则滚动
    if (shouldStickToBottom) {
      messagesList.scrollTop = messagesList.scrollHeight;
    }
  });

  img.addEventListener('error', () => {
    placeholder.textContent = '图片加载失败';
    img.classList.add('hidden');
  });

  img.addEventListener('click', () => {
    openImageViewer(msg);
  });

  wrapper.appendChild(placeholder);
  wrapper.appendChild(img);
  observeImage(img);
  return wrapper;
}

function createMessageElement(msg, isFavoritesView = false) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message';
  if (msg.favorite) {
    messageEl.classList.add('favorited');
  }
  messageEl.dataset.id = msg.id;

  const headerEl = document.createElement('div');
  headerEl.className = 'message-header';

  const timeEl = document.createElement('span');
  timeEl.className = 'message-time';
  timeEl.textContent = formatTime(msg.timestamp);

  headerEl.appendChild(timeEl);

  // 分享按钮放在头部右侧
  const shareBtn = document.createElement('button');
  shareBtn.className = 'message-share-btn';
  shareBtn.title = '分享';
  shareBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
  shareBtn.addEventListener('click', () => openShareModal(msg));
  headerEl.appendChild(shareBtn);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'message-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'message-delete-action';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', () => deleteMessage(msg.id));

  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = 'btn btn-secondary message-favorite-action';
  if (msg.favorite) {
    favoriteBtn.classList.add('active');
  }
  favoriteBtn.textContent = msg.favorite ? '★ 已收藏' : '☆ 收藏';
  favoriteBtn.title = msg.favorite ? '取消收藏' : '加入收藏';
  favoriteBtn.addEventListener('click', () => toggleFavorite(msg.id, !msg.favorite));

  if (msg.type === 'text') {
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content text';
    contentEl.innerHTML = renderSmartText(msg.content);

    const lines = (msg.content || '').split('\n').length;
    const isLongByContent = lines > 6 || (msg.content && msg.content.length > 220);

    if (isLongByContent) {
      contentEl.classList.add('is-collapsed');
      contentEl.title = '点击查看完整内容';
      contentEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'a') return;
        openTextViewer(msg);
      });
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    // 在 DOM 渲染后检测是否超出最大显示高度
    requestAnimationFrame(() => {
      if (contentEl.scrollHeight > 185 && !contentEl.classList.contains('is-collapsed')) {
        contentEl.classList.add('is-collapsed');
        contentEl.title = '点击查看完整内容';
        contentEl.addEventListener('click', (e) => {
          if (e.target.tagName.toLowerCase() === 'a') return;
          openTextViewer(msg);
        });
        if (!actionsEl.querySelector('.message-view-action')) {
          const dynamicViewBtn = document.createElement('button');
          dynamicViewBtn.className = 'btn btn-secondary message-view-action';
          dynamicViewBtn.textContent = '查看';
          dynamicViewBtn.title = '查看完整内容';
          dynamicViewBtn.addEventListener('click', () => openTextViewer(msg));
          actionsEl.insertBefore(dynamicViewBtn, actionsEl.firstChild);
        }
      }
    });

    if (isLongByContent) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-secondary message-view-action';
      viewBtn.textContent = '查看';
      viewBtn.title = '查看完整内容';
      viewBtn.addEventListener('click', () => openTextViewer(msg));
      actionsEl.appendChild(viewBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copyTextToClipboard(msg.content));
    actionsEl.appendChild(copyBtn);
  } else if (msg.type === 'image') {
    const imageContent = createImageContent(msg);
    messageEl.appendChild(headerEl);
    messageEl.appendChild(imageContent);

    const imageData = getImageContent(msg.content);

    if (imageData.hasOriginal) {
      const copyThumbBtn = document.createElement('button');
      copyThumbBtn.className = 'btn btn-secondary';
      copyThumbBtn.textContent = '复制缩略图';
      copyThumbBtn.addEventListener('click', () => {
        copyImageToClipboard(imageData.thumbnail, {
          successToast: '缩略图已复制到剪贴板',
          failureToast: '复制缩略图失败'
        });
      });

      const copyOriginalBtn = document.createElement('button');
      copyOriginalBtn.className = 'btn btn-secondary';
      copyOriginalBtn.textContent = '复制原图';
      copyOriginalBtn.addEventListener('click', () => copyOriginalImageWithFallback(msg));
      actionsEl.appendChild(copyThumbBtn);
      actionsEl.appendChild(copyOriginalBtn);
    } else {
      const copyImageBtn = document.createElement('button');
      copyImageBtn.className = 'btn btn-secondary';
      copyImageBtn.textContent = '复制图片';
      copyImageBtn.addEventListener('click', () => {
        copyImageToClipboard(imageData.thumbnail, {
          successToast: '图片已复制到剪贴板',
          failureToast: '复制图片失败'
        });
      });
      actionsEl.appendChild(copyImageBtn);
    }
  } else if (msg.type === 'file') {
    const fileData = getFileContent(msg.content);
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content file';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.textContent = fileData.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'file-meta';
    metaEl.textContent = `${formatFileSize(fileData.size)}${fileData.mimeType ? ` · ${fileData.mimeType}` : ''}`;

    contentEl.appendChild(nameEl);
    contentEl.appendChild(metaEl);

    // 凭证链接拼装，供音视频播放和下载使用
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }
    const savedPassword = localStorage.getItem('web-clipboard-password');
    if (savedPassword) {
      params.set('password', savedPassword);
    }
    const mediaUrl = `/api/messages/${msg.id}/file-download?${params.toString()}`;

    // 如果是音频文件，内联音频播放器
    if (fileData.mimeType && fileData.mimeType.startsWith('audio/')) {
      const audioEl = document.createElement('audio');
      audioEl.src = mediaUrl;
      audioEl.controls = true;
      audioEl.className = 'message-audio';
      contentEl.appendChild(audioEl);
    }

    // 如果是视频文件，内联视频播放器
    if (fileData.mimeType && fileData.mimeType.startsWith('video/')) {
      const videoEl = document.createElement('video');
      videoEl.src = mediaUrl;
      videoEl.controls = true;
      videoEl.preload = 'metadata';
      videoEl.className = 'message-video';
      contentEl.appendChild(videoEl);
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-secondary';
    downloadBtn.textContent = '下载文件';
    downloadBtn.addEventListener('click', () => {
      window.open(mediaUrl, '_blank', 'noopener');
    });
    actionsEl.appendChild(downloadBtn);
  }

  actionsEl.appendChild(favoriteBtn);
  actionsEl.appendChild(deleteBtn);
  messageEl.appendChild(actionsEl);
  return messageEl;
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderMessages({ scrollBottom = false } = {}) {
  if (isInitialLoading && messages.length === 0) {
    renderLoadingState();
    return;
  }

  if (messages.length === 0) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  messages.forEach((msg) => {
    fragment.appendChild(createMessageElement(msg));
  });

  messagesList.innerHTML = '';
  messagesList.appendChild(fragment);
  updateMessageCount();

  if (scrollBottom) {
    shouldStickToBottom = true;
    scrollToBottom();
  }
}

function removeSingleMessage(id) {
  // 从数据数组中移除
  messages = messages.filter((m) => m.id !== id);
  favorites = favorites.filter((f) => f.id !== id);

  const removeElement = (container, emptyHandler) => {
    if (!container) return;
    const msgEl = container.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
    if (msgEl) {
      msgEl.classList.add('deleting');
      setTimeout(() => {
        msgEl.remove();
        if (emptyHandler) emptyHandler();
      }, 200);
    } else if (emptyHandler) {
      emptyHandler();
    }
  };

  removeElement(messagesList, () => {
    updateMessageCount();
    if (messages.length === 0) {
      renderEmptyState();
    }
  });

  if (favoritesList) {
    removeElement(favoritesList, () => {
      if (currentTab === 'favorites' && favorites.length === 0) {
        renderFavorites();
      }
    });
  }
}

function appendSingleMessage(msg) {
  if (!messagesList) return;
  if (messagesList.querySelector('.empty-state, .loading-state') || messages.length <= 1) {
    renderMessages({ scrollBottom: true });
    return;
  }

  const msgEl = createMessageElement(msg);
  messagesList.appendChild(msgEl);
  updateMessageCount();

  shouldStickToBottom = true;
  scrollToBottom();
}

function updateSingleMessageFavorite(id, favorite) {
  const updateElement = (container) => {
    if (!container) return;
    const msgEl = container.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
    if (msgEl) {
      if (favorite) {
        msgEl.classList.add('favorited');
      } else {
        msgEl.classList.remove('favorited');
      }
      const favBtn = msgEl.querySelector('.message-favorite-action');
      if (favBtn) {
        if (favorite) {
          favBtn.classList.add('active');
          favBtn.textContent = '★ 已收藏';
          favBtn.title = '取消收藏';
        } else {
          favBtn.classList.remove('active');
          favBtn.textContent = '☆ 收藏';
          favBtn.title = '加入收藏';
        }
      }
    }
  };

  updateElement(messagesList);
  if (currentTab === 'favorites') {
    renderFavorites();
  }
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function checkAuth() {
  // 检查是否已超过设定的登录有效时长
  const expireTimeStr = localStorage.getItem('web-clipboard-login-expires');
  if (expireTimeStr) {
    const expireTime = parseInt(expireTimeStr, 10);
    if (!isNaN(expireTime) && Date.now() >= expireTime) {
      localStorage.removeItem('web-clipboard-password');
      localStorage.removeItem('web-clipboard-user-id');
      localStorage.removeItem('web-clipboard-login-expires');
    }
  }

  // 先检查运行模式和是否需要密码
  fetch('/api/auth/status')
    .then((res) => res.json())
    .then((data) => {
      currentMode = data.mode || 'single';
      requirePassword = data.requirePassword;

      // 无密码模式下隐藏退出按钮
      if (!requirePassword) {
        logoutBtn.style.display = 'none';
        // 无密码模式（单用户），直接进入
        enterChatMode();
        return;
      }

      // 有密码模式，检查本地缓存的 userId 和密码
      const savedUserId = localStorage.getItem('web-clipboard-user-id');
      const savedPassword = localStorage.getItem('web-clipboard-password');

      if (currentMode === 'multi' && savedUserId && savedPassword) {
        // 多用户模式：有缓存的 userId 和密码
        verifyPassword(savedPassword, savedUserId);
      } else if (savedPassword) {
        // 单用户模式：只有密码
        verifyPassword(savedPassword);
      }
    })
    .catch((error) => {
      console.error('获取认证状态失败:', error);
      // 降级处理：假设需要密码
      const savedPassword = localStorage.getItem('web-clipboard-password');
      if (savedPassword) {
        verifyPassword(savedPassword);
      }
    });
}

function enterChatMode() {
  isAuthenticated = true;
  authSection.classList.add('hidden');
  chatSection.classList.remove('hidden');

  // 多用户模式下显示当前用户
  if (currentMode === 'multi' && userId) {
    currentUserEl.textContent = `👤 ${userId}`;
    currentUserEl.classList.remove('hidden');
  }

  // 延迟启动 Socket 握手连接并加入房间
  socket.connect();
  if (currentMode === 'multi' && userId) {
    socket.emit('join', userId);
  }

  loadInitialMessages();
  loadFavorites();

  // 启动登录有效时长定时检测
  if (expireCheckInterval) clearInterval(expireCheckInterval);
  expireCheckInterval = setInterval(checkLoginExpiration, 1000);
}

function checkLoginExpiration() {
  const expireTimeStr = localStorage.getItem('web-clipboard-login-expires');
  if (!expireTimeStr) return;
  const expireTime = parseInt(expireTimeStr, 10);
  if (isNaN(expireTime)) return;

  if (Date.now() >= expireTime) {
    showToast('登录已过期，自动退出登录');
    logout(false);
  }
}

async function loadVersion() {
  try {
    const response = await fetch('/api/version');
    if (!response.ok) return;
    const data = await response.json();
    const versionEl = document.getElementById('version');
    if (versionEl && data.version) {
      versionEl.textContent = `v${data.version}`;
    }
  } catch (error) {
    console.error('加载版本号失败:', error);
  }
}

function switchTab(tabName) {
  currentTab = tabName;
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
  if (tabName === 'favorites') {
    renderFavorites();
  }
}

async function loadFavorites() {
  try {
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }
    const response = await authFetch(`/api/favorites?${params.toString()}`);
    if (!response.ok) return;
    const data = await response.json();
    favorites = data.messages || [];
    if (currentTab === 'favorites') {
      renderFavorites();
    }
  } catch (error) {
    console.error('加载收藏失败:', error);
  }
}

async function toggleFavorite(id, isFavorite) {
  try {
    const method = isFavorite ? 'POST' : 'DELETE';
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }
    await authFetch(`/api/messages/${id}/favorite?${params.toString()}`, { method });
  } catch (error) {
    showToast('收藏操作失败');
    console.error(error);
  }
}

function renderFavorites() {
  if (favorites.length === 0) {
    favoritesList.innerHTML = `
      <div class="empty-state">
        <p>暂无收藏</p>
        <p style="font-size: 0.8rem; margin-top: 8px;">点击消息旁的 ☆ 收藏重要内容</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  favorites.forEach((msg) => {
    fragment.appendChild(createMessageElement(msg, true));
  });
  favoritesList.innerHTML = '';
  favoritesList.appendChild(fragment);
}

function logout(showMessage = true) {
  socket.disconnect();
  localStorage.removeItem('web-clipboard-password');
  localStorage.removeItem('web-clipboard-user-id');
  localStorage.removeItem('web-clipboard-login-expires');

  if (expireCheckInterval) {
    clearInterval(expireCheckInterval);
    expireCheckInterval = null;
  }

  userId = null;
  isAuthenticated = false;
  messages = [];
  favorites = [];
  hasMoreMessages = false;
  initialLoaded = false;
  isInitialLoading = false;
  isLoadingOlder = false;
  isReconnectRefreshing = false;
  setTopLoading(false);
  shouldStickToBottom = false;

  // 重置到消息tab
  switchTab('messages');

  if (requirePassword) {
    authSection.classList.remove('hidden');
    chatSection.classList.add('hidden');
    authError.classList.add('hidden');
    passwordInput.value = '';
    passwordInput.focus();
  } else {
    // 无密码模式，直接重新进入
    enterChatMode();
  }

  renderEmptyState();
  if (showMessage && requirePassword) {
    showToast('已退出登录');
  }
}

async function fetchMessagesPage({ before, limit = PAGE_SIZE } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (Number.isFinite(before)) {
    params.set('before', String(before));
  }

  // 多用户模式下添加 userId 参数
  if (currentMode === 'multi' && userId) {
    params.set('userId', userId);
  }

  const response = await authFetch(`/api/messages?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load messages: ${response.status}`);
  }
  return response.json();
}

async function loadInitialMessages() {
  isInitialLoading = true;
  renderMessages();

  try {
    const data = await fetchMessagesPage({ limit: PAGE_SIZE });
    messages = data.messages || [];
    hasMoreMessages = Boolean(data.hasMore);
    updateExpireInfo(data.expireHours || 168);
    initialLoaded = true;
    isInitialLoading = false;
    renderMessages({ scrollBottom: true });
  } catch (error) {
    isInitialLoading = false;
    renderMessages();
    showToast('加载消息失败');
    console.error(error);
  }
}

async function refreshMessagesAfterReconnect() {
  if (!initialLoaded || isInitialLoading || isReconnectRefreshing) {
    return;
  }

  isReconnectRefreshing = true;
  try {
    const data = await fetchMessagesPage({ limit: PAGE_SIZE });
    if (!Array.isArray(data.messages)) return;
    messages = data.messages;
    hasMoreMessages = Boolean(data.hasMore);
    updateExpireInfo(data.expireHours || 168);
    renderMessages({ scrollBottom: true });
  } catch (error) {
    showToast('重连后刷新失败');
    console.error(error);
  } finally {
    isReconnectRefreshing = false;
  }
}

async function loadOlderMessages() {
  if (!hasMoreMessages || isLoadingOlder || isInitialLoading || messages.length === 0) {
    return;
  }

  const oldestTimestamp = messages[0].timestamp;
  if (!Number.isFinite(oldestTimestamp)) {
    return;
  }

  isLoadingOlder = true;
  setTopLoading(true);

  const prevScrollHeight = messagesList.scrollHeight;
  const prevScrollTop = messagesList.scrollTop;

  try {
    const data = await fetchMessagesPage({
      before: oldestTimestamp,
      limit: PAGE_SIZE
    });

    const olderMessages = data.messages || [];
    if (olderMessages.length > 0) {
      messages = olderMessages.concat(messages);
      renderMessages();
      const heightDiff = messagesList.scrollHeight - prevScrollHeight;
      messagesList.scrollTop = prevScrollTop + heightDiff;
    }
    hasMoreMessages = Boolean(data.hasMore);
  } catch (error) {
    showToast('加载更早消息失败');
    console.error(error);
  } finally {
    isLoadingOlder = false;
    setTopLoading(false);
  }
}

async function verifyPassword(password, cachedUserId = null) {
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success) {
      // 多用户模式：存储 userId
      if (data.mode === 'multi' && data.userId) {
        userId = data.userId;
        localStorage.setItem('web-clipboard-user-id', userId);
      }

      // 无密码模式不缓存密码
      if (!data.noPassword) {
        localStorage.setItem('web-clipboard-password', password);

        // 处理登录有效时长
        if (limitDurationChk && limitDurationChk.checked) {
          const durationVal = loginDurationSelect.value;
          let durationMs = 0;
          if (durationVal === '10m') durationMs = 10 * 60 * 1000;
          else if (durationVal === '30m') durationMs = 30 * 60 * 1000;
          else if (durationVal === '1h') durationMs = 1 * 60 * 60 * 1000;
          else if (durationVal === '6h') durationMs = 6 * 60 * 60 * 1000;
          else if (durationVal === '12h') durationMs = 12 * 60 * 60 * 1000;
          else if (durationVal === '24h') durationMs = 24 * 60 * 60 * 1000;
          else if (durationVal === '3d') durationMs = 3 * 24 * 60 * 60 * 1000;
          else if (durationVal === '7d') durationMs = 7 * 24 * 60 * 60 * 1000;
          else if (durationVal === '30d') durationMs = 30 * 24 * 60 * 60 * 1000;

          if (durationMs > 0) {
            localStorage.setItem('web-clipboard-login-expires', (Date.now() + durationMs).toString());
          } else {
            localStorage.removeItem('web-clipboard-login-expires');
          }
        } else {
          localStorage.removeItem('web-clipboard-login-expires');
        }
      } else {
        localStorage.removeItem('web-clipboard-login-expires');
      }

      enterChatMode();
      return;
    }

    authError.classList.remove('hidden');
    localStorage.removeItem('web-clipboard-password');
    localStorage.removeItem('web-clipboard-user-id');
  } catch (error) {
    showToast('验证失败');
    console.error(error);
  }
}

function setUploadProgress(visible, percent = 0, text = '上传中...') {
  if (visible) {
    uploadProgressContainer.classList.remove('hidden');
    uploadProgressFill.style.width = `${percent}%`;
    uploadProgressText.textContent = text;
    uploadProgressPercent.textContent = `${Math.round(percent)}%`;
  } else {
    uploadProgressContainer.classList.add('hidden');
    uploadProgressFill.style.width = '0%';
  }
}

function cancelUpload() {
  if (currentXhr) {
    currentXhr.abort();
    currentXhr = null;
  }
  uploadQueue = [];
  isUploading = false;
  setUploadProgress(false);
  showToast('上传已取消');
}

function sendMessageWithProgress(type, content) {
  return new Promise((resolve, reject) => {
    if (type === 'text' && (!content || !content.trim())) {
      showToast('内容不能为空');
      reject(new Error('内容不能为空'));
      return;
    }

    if (type === 'image' || type === 'file') {
      const isFileOrBlob = content instanceof File || content instanceof Blob;
      const isImagePayload = content && typeof content === 'object' && (content.file instanceof File || content.file instanceof Blob);
      if (!isFileOrBlob && !isImagePayload) {
        showToast('文件内容为空');
        reject(new Error('文件内容为空'));
        return;
      }
    }

    const xhr = new XMLHttpRequest();
    currentXhr = xhr;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        setUploadProgress(true, percent, `上传中... ${formatFileSize(e.loaded)} / ${formatFileSize(e.total)}`);
      }
    });

    xhr.addEventListener('load', () => {
      currentXhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (error) {
          reject(new Error('响应解析失败'));
        }
      } else {
        try {
          const response = JSON.parse(xhr.responseText);
          reject(new Error(response.error || '上传失败'));
        } catch (error) {
          reject(new Error('上传失败'));
        }
      }
    });

    xhr.addEventListener('error', () => {
      currentXhr = null;
      reject(new Error('网络错误'));
    });

    xhr.addEventListener('abort', () => {
      currentXhr = null;
      reject(new Error('上传已取消'));
    });

    const setXhrHeaders = (x) => {
      const savedPassword = localStorage.getItem('web-clipboard-password');
      const savedUserId = localStorage.getItem('web-clipboard-user-id');
      if (savedPassword) {
        x.setRequestHeader('x-access-password', savedPassword);
      }
      if (savedUserId) {
        x.setRequestHeader('x-user-id', savedUserId);
      }
    };

    // 文本消息使用原有 JSON API
    if (type === 'text') {
      xhr.open('POST', '/api/messages');
      xhr.setRequestHeader('Content-Type', 'application/json');
      setXhrHeaders(xhr);
      const payload = { type, content };
      // 多用户模式下添加 userId
      if (currentMode === 'multi' && userId) {
        payload.userId = userId;
      }
      xhr.send(JSON.stringify(payload));
    } else {
      // 图片和文件使用 FormData
      const formData = new FormData();
      formData.append('type', type);

      if (content && typeof content === 'object' && ('file' in content || 'thumbnail' in content)) {
        if (content.file) {
          formData.append('file', content.file);
        }
        if (content.thumbnail) {
          formData.append('thumbnail', content.thumbnail);
        }
      } else {
        formData.append('file', content);
      }

      // 多用户模式下添加 userId
      if (currentMode === 'multi' && userId) {
        formData.append('userId', userId);
      }
      xhr.open('POST', '/api/messages/upload');
      setXhrHeaders(xhr);
      xhr.send(formData);
    }
  });
}

async function processUploadQueue() {
  if (isUploading || uploadQueue.length === 0) return;

  isUploading = true;
  const { type, content } = uploadQueue[0];

  try {
    setUploadProgress(true, 0, '准备上传...');
    const response = await sendMessageWithProgress(type, content);

    // 直接将返回的消息添加到本地列表，不依赖 WebSocket
    if (response && response.message) {
      // 检查消息是否已存在（避免 WebSocket 重复添加）
      const exists = messages.some((m) => m.id === response.message.id);
      if (!exists) {
        messages.push(response.message);
        appendSingleMessage(response.message);
        showToast('发送成功');
      }
    }
  } catch (error) {
    if (error.message !== '上传已取消') {
      showToast(error.message || '上传失败');
      console.error(error);
    }
  } finally {
    uploadQueue.shift();
    isUploading = false;
    setUploadProgress(false);

    if (uploadQueue.length > 0) {
      processUploadQueue();
    }
  }
}

function queueUpload(type, content) {
  uploadQueue.push({ type, content });
  processUploadQueue();
}

async function sendMessage(type, content) {
  queueUpload(type, content);
}

async function deleteMessage(id) {
  try {
    removeSingleMessage(id);
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }
    await authFetch(`/api/messages/${id}?${params.toString()}`, {
      method: 'DELETE'
    });
  } catch (error) {
    showToast('删除失败');
    console.error(error);
  }
}

async function clearAllMessages() {
  showConfirmModal('确定要清空所有消息吗？', async () => {
    try {
      const params = new URLSearchParams();
      if (currentMode === 'multi' && userId) {
        params.set('userId', userId);
      }
      await authFetch(`/api/messages/clear?${params.toString()}`, {
        method: 'POST'
      });
      showToast('已清空');
    } catch (error) {
      showToast('清空失败');
      console.error(error);
    }
  });
}

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const modalMessage = document.getElementById('modal-message');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');

  modalMessage.textContent = message;
  modal.classList.remove('hidden');

  const closeModal = () => {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', closeModal);
    confirmBtn.removeEventListener('click', handleConfirm);
  };

  const handleConfirm = () => {
    closeModal();
    onConfirm();
  };

  cancelBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', handleConfirm);

  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
}

async function pasteText() {
  try {
    const text = await navigator.clipboard.readText();
    textInput.value = text;
    textInput.focus();
    autoResizeTextarea();
    showToast('已粘贴');
  } catch (error) {
    showToast('无法读取剪贴板');
    console.error(error);
  }
}

async function pasteAndSendText() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      showToast('剪贴板无文本内容');
      return;
    }
    sendMessage('text', text);
    showToast('已一键粘贴并发送');
  } catch (error) {
    showToast('无法读取剪贴板');
    console.error(error);
  }
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch (error) {
    showToast('复制失败');
    console.error(error);
  }
}

async function copyImageToClipboard(dataUrl, options = {}) {
  const {
    successToast = '图片已复制到剪贴板',
    failureToast = '复制图片失败，请尝试右键另存',
    silentFailure = false
  } = options;

  if (!dataUrl) {
    if (!silentFailure) showToast(failureToast);
    return false;
  }

  try {
    const response = await fetch(dataUrl);
    let blob = await response.blob();

    if (blob.type !== 'image/png') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const pngDataUrl = canvas.toDataURL('image/png');
      const pngResponse = await fetch(pngDataUrl);
      blob = await pngResponse.blob();
    }

    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      if (successToast) showToast(successToast);
      return true;
    } else {
      if (!silentFailure) showToast('浏览器不支持复制图片，请右键另存');
      return false;
    }
  } catch (error) {
    console.error('复制图片失败:', error);
    if (!silentFailure) showToast(failureToast);
    return false;
  }
}

async function fetchOriginalImageWithTimeout(id, timeoutMs = ORIGINAL_FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }
    const response = await authFetch(`/api/messages/${id}/image-original?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data.original !== 'string' || !data.original.startsWith('data:image/')) {
      throw new Error('invalid original data');
    }
    return data.original;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function copyOriginalImageWithFallback(msg) {
  const imageData = getImageContent(msg.content);
  const thumbnail = imageData.thumbnail;
  if (!thumbnail) {
    showToast('当前消息缺少可复制的缩略图');
    return;
  }

  try {
    const original = await fetchOriginalImageWithTimeout(msg.id, ORIGINAL_FETCH_TIMEOUT);
    const copiedOriginal = await copyImageToClipboard(original, {
      successToast: '原图已复制到剪贴板',
      silentFailure: true
    });
    if (copiedOriginal) {
      return;
    }
    const copiedFallback = await copyImageToClipboard(thumbnail, { silentFailure: true });
    showToast(copiedFallback ? '复制原图失败，已回退复制缩略图' : '复制原图失败，且回退缩略图复制失败');
  } catch (error) {
    console.error('获取原图失败:', error);
    const copiedFallback = await copyImageToClipboard(thumbnail, { silentFailure: true });
    if (error && error.name === 'AbortError') {
      showToast(copiedFallback ? '复制原图超时，已回退复制缩略图' : '复制原图超时，且回退缩略图复制失败');
      return;
    }
    showToast(copiedFallback ? '获取原图失败，已回退复制缩略图' : '获取原图失败，且回退缩略图复制失败');
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read blob failed'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load image failed'));
    };
    img.src = url;
  });
}

async function compressImageToBlob(fileOrBlob, maxEdge = 3840, quality = 0.95) {
  try {
    const img = await loadImageElementFromBlob(fileOrBlob);
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    // 若原图尺寸在限制内，保持 100% 点对点原始尺寸不缩放
    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise((resolve) => {
      // 优先输出高质量 webp，不支持时降级为 jpeg
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          canvas.toBlob((fallbackBlob) => {
            resolve(fallbackBlob || fileOrBlob);
          }, 'image/jpeg', quality);
        }
      }, 'image/webp', quality);
    });
  } catch (err) {
    console.error('压缩图片失败，回退使用原始文件:', err);
    return fileOrBlob;
  }
}

async function createThumbnailBlob(fileOrBlob) {
  return compressImageToBlob(fileOrBlob, 1920, 0.92);
}

function confirmLargeImageUpload(file) {
  return new Promise((resolve) => {
    if (!imageCompressModal || !imageCompressMsg || !imageCompressBtn || !imageOriginalBtn || !imageCancelBtn) {
      resolve('compress');
      return;
    }

    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    imageCompressMsg.textContent = `检测到当前图片较大（${sizeMB} MB），建议压缩后上传以大幅提升传输速度并节省带宽。`;
    imageCompressModal.classList.remove('hidden');

    const cleanup = () => {
      imageCompressModal.classList.add('hidden');
      imageCompressBtn.removeEventListener('click', onCompress);
      imageOriginalBtn.removeEventListener('click', onOriginal);
      imageCancelBtn.removeEventListener('click', onCancel);
      imageCompressModal.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onCompress = () => {
      cleanup();
      resolve('compress');
    };

    const onOriginal = () => {
      cleanup();
      resolve('original');
    };

    const onCancel = () => {
      cleanup();
      resolve('cancel');
    };

    const onBackdropClick = (e) => {
      if (e.target === imageCompressModal) {
        onCancel();
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    imageCompressBtn.addEventListener('click', onCompress);
    imageOriginalBtn.addEventListener('click', onOriginal);
    imageCancelBtn.addEventListener('click', onCancel);
    imageCompressModal.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown);
  });
}

async function handleSingleImageFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return;

  // 1. 如果图片 <= 3MB：100% 原始无损直传，完全不进行有损转码，确保极致清晰度
  if (file.size <= LARGE_IMAGE_THRESHOLD_BYTES) {
    queueUpload('image', {
      file: file,
      thumbnail: null
    });
    return;
  }

  // 2. 如果图片 > 3MB：弹出确认框询问用户
  const choice = await confirmLargeImageUpload(file);
  if (choice === 'cancel') {
    return;
  }

  let mainBlob = file;
  if (choice === 'compress') {
    showToast('正在高清压缩图片...');
    // 保持高分辨率（最高 4K），画质 0.95 高清压缩至 3MB 以内
    mainBlob = await compressImageToBlob(file, HD_COMPRESS_MAX_EDGE, 0.95);
  }

  // 3. 为大图生成超清 1920px 缩略图（质量 0.92）
  const thumbnailBlob = await createThumbnailBlob(mainBlob);

  // 4. 构造上传文件对象
  const origName = file.name || `image-${Date.now()}.png`;
  const ext = mainBlob.type === 'image/webp' ? '.webp' : (mainBlob.type === 'image/jpeg' ? '.jpg' : '.png');
  const mainFile = new File([mainBlob], origName.replace(/\.[^.]+$/, ext), {
    type: mainBlob.type || 'image/png'
  });
  const thumbFile = new File([thumbnailBlob], `thumb-${Date.now()}.webp`, {
    type: thumbnailBlob.type || 'image/webp'
  });

  queueUpload('image', {
    file: mainFile,
    thumbnail: thumbFile
  });
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  const name = file.name || '';
  const ext = name.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'svg', 'avif'].includes(ext);
}

async function handleImageFiles(files) {
  for (const file of files) {
    if (!isImageFile(file)) continue;
    await handleSingleImageFile(file);
  }
}

async function handleFileUpload(files) {
  for (const file of files) {
    if (!file) continue;
    if (isImageFile(file)) {
      await handleSingleImageFile(file);
    } else {
      queueUpload('file', file);
    }
  }
}

async function pasteImage() {
  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith('image/')) continue;

        const blob = await item.getType(type);
        // 将 Blob 转为 File 对象，添加默认文件名
        const file = new File([blob], `clipboard-${Date.now()}.png`, { type: blob.type || 'image/png' });
        await handleSingleImageFile(file);
        return;
      }
    }

    showToast('剪贴板中没有图片');
  } catch (error) {
    showToast('无法读取剪贴板图片');
    console.error(error);
  }
}

function autoResizeTextarea() {
  textInput.style.height = 'auto';
  textInput.style.height = `${Math.min(textInput.scrollHeight, 100)}px`;
}

authBtn.addEventListener('click', () => verifyPassword(passwordInput.value));
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') verifyPassword(passwordInput.value);
});
passwordInput.addEventListener('input', () => {
  authError.classList.add('hidden');
});

if (limitDurationChk) {
  limitDurationChk.addEventListener('change', () => {
    loginDurationSelect.disabled = !limitDurationChk.checked;
  });
}

sendTextBtn.addEventListener('click', () => {
  const value = textInput.value;
  sendMessage('text', value);
  textInput.value = '';
  autoResizeTextarea();
});

textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextBtn.click();
  }
});

textInput.addEventListener('input', autoResizeTextarea);
pasteTextBtn.title = '单击粘贴，双击粘贴并直接发送';
pasteTextBtn.addEventListener('click', pasteText);
pasteTextBtn.addEventListener('dblclick', pasteAndSendText);

// 全局粘贴监听器，实现免聚焦一键粘贴
document.addEventListener('paste', (e) => {
  const activeEl = document.activeElement;
  const isInputActive = activeEl && (
    activeEl.tagName === 'INPUT' || 
    activeEl.tagName === 'TEXTAREA' || 
    activeEl.contentEditable === 'true'
  );
  
  if (isInputActive) return; // 输入聚焦时由浏览器默认处理
  if (!isAuthenticated) return;

  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        handleImageFiles([file]);
      }
      e.preventDefault();
      break;
    } else if (item.type === 'text/plain') {
      item.getAsString((text) => {
        textInput.value = text;
        textInput.focus();
        autoResizeTextarea();
        showToast('已自动载入粘贴文本');
      });
      e.preventDefault();
      break;
    }
  }
});
pasteImageBtn.addEventListener('click', pasteImage);
clearAllBtn.addEventListener('click', clearAllMessages);
logoutBtn.addEventListener('click', () => logout(true));
uploadProgressCancel.addEventListener('click', cancelUpload);

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

imageInput.addEventListener('change', (e) => {
  handleImageFiles(e.target.files);
  imageInput.value = '';
});
fileInput.addEventListener('change', (e) => {
  handleFileUpload(e.target.files);
  fileInput.value = '';
});

messagesList.addEventListener('scroll', () => {
  // 检测是否离开底部
  const threshold = 150;
  const isNearBottom = messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight < threshold;
  if (!isNearBottom) {
    shouldStickToBottom = false;
  }

  if (messagesList.scrollTop <= TOP_LOAD_THRESHOLD) {
    loadOlderMessages();
  }
});

document.addEventListener('paste', (e) => {
  if (document.activeElement !== textInput) return;

  const items = e.clipboardData.items;
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    e.preventDefault();
    const file = item.getAsFile();
    handleImageFiles([file]);
    break;
  }
});

socket.on('connect', () => {
  connectionStatus.textContent = '已连接';
  connectionStatus.className = 'status connected';
  if (!isAuthenticated) return;

  // 多用户模式下重连需要重新加入房间
  if (currentMode === 'multi' && userId) {
    socket.emit('join', userId);
  }

  refreshMessagesAfterReconnect();
});

socket.on('disconnect', () => {
  connectionStatus.textContent = '已断开';
  connectionStatus.className = 'status disconnected';
});

socket.on('sync', (data) => {
  if (!isAuthenticated) return;
  if (initialLoaded) return;
  if (!Array.isArray(data.messages)) return;

  messages = data.messages;
  hasMoreMessages = Boolean(data.hasMore);
  renderMessages({ scrollBottom: true });
});

socket.on('message-new', (msg) => {
  if (!isAuthenticated) return;

  // 检查消息是否已存在（避免重复添加自己发送的消息）
  const exists = messages.some((m) => m.id === msg.id);
  if (exists) return;

  messages.push(msg);
  appendSingleMessage(msg);
  showToast('收到新消息');
});

socket.on('message-delete', (id) => {
  if (!isAuthenticated) return;
  removeSingleMessage(id);
});

socket.on('messages-clear', (data) => {
  if (!isAuthenticated) return;
  // 只清空非收藏消息，保留收藏消息
  messages = messages.filter((m) => m.favorite);
  hasMoreMessages = false;
  renderMessages();
  if (currentTab === 'favorites') {
    renderFavorites();
  }
  if (data && data.favoriteCount > 0) {
    showToast(`已清空，保留 ${data.favoriteCount} 条收藏`);
  }
});

socket.on('message-favorite', (data) => {
  if (!isAuthenticated) return;
  const { id, favorite, message } = data;

  // 更新 messages 中的消息
  const msgIndex = messages.findIndex((m) => m.id === id);
  if (msgIndex !== -1) {
    messages[msgIndex].favorite = favorite;
  }

  // 更新 favorites 列表
  if (favorite) {
    const favMsg = message || messages.find((m) => m.id === id);
    if (favMsg && !favorites.find((f) => f.id === id)) {
      favorites.push(favMsg);
    }
  } else {
    favorites = favorites.filter((f) => f.id !== id);
  }

  updateSingleMessageFavorite(id, favorite);
});

// 拖放文件处理
let dragCounter = 0;

function handleDragEnter(e) {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.remove('hidden');
  dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) {
    dropOverlay.classList.add('hidden');
    dropZone.classList.remove('drag-over');
  }
}

function handleDragOver(e) {
  e.preventDefault();
}

async function handleDrop(e) {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add('hidden');
  dropZone.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  // 分离图片和普通文件
  const imageFiles = [];
  const otherFiles = [];

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      imageFiles.push(file);
    } else {
      otherFiles.push(file);
    }
  }

  // 处理图片
  if (imageFiles.length > 0) {
    await handleImageFiles(imageFiles);
  }

  // 处理普通文件
  if (otherFiles.length > 0) {
    await handleFileUpload(otherFiles);
  }
}

dropZone.addEventListener('dragenter', handleDragEnter);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('drop', handleDrop);

// 页面加载时立即获取版本号
loadVersion();

checkAuth();

// ========== 分享功能 ==========
const shareModal = document.getElementById('share-modal');
const shareExpiresSelect = document.getElementById('share-expires');
const sharePasswordInput = document.getElementById('share-password');
const shareCancelBtn = document.getElementById('share-cancel');
const shareCreateBtn = document.getElementById('share-create');
const shareResult = document.getElementById('share-result');
const shareLinkInput = document.getElementById('share-link');
const shareCopyLinkBtn = document.getElementById('share-copy-link');
const shareInfo = document.getElementById('share-info');
const shareForm = document.querySelector('.share-form');

let currentShareMessage = null;

function openShareModal(msg) {
  currentShareMessage = msg;
  sharePasswordInput.value = '';
  shareExpiresSelect.value = '168';
  shareForm.classList.remove('hidden');
  shareResult.classList.add('hidden');
  shareModal.classList.remove('hidden');
}

function closeShareModal() {
  shareModal.classList.add('hidden');
  currentShareMessage = null;
}

async function createShare() {
  if (!currentShareMessage) return;

  const expiresHours = parseInt(shareExpiresSelect.value, 10);
  const password = sharePasswordInput.value.trim() || null;

  try {
    shareCreateBtn.disabled = true;
    shareCreateBtn.textContent = '创建中...';

    const payload = {
      messageId: currentShareMessage.id,
      expiresHours
    };

    if (currentMode === 'multi' && userId) {
      payload.userId = userId;
    }

    if (password) {
      payload.password = password;
    }

    const response = await authFetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '创建分享失败');
    }

    // 显示分享结果
    shareForm.classList.add('hidden');
    shareResult.classList.remove('hidden');

    const shareUrl = window.location.origin + data.shareUrl;
    shareLinkInput.value = shareUrl;

    const expiresDate = new Date(data.expiresAt);
    const expiresStr = expiresDate.toLocaleString('zh-CN');
    const passwordInfo = data.hasPassword ? '（需要密码）' : '';
    shareInfo.textContent = `链接将在 ${expiresStr} 过期${passwordInfo}`;

    showToast('分享链接已创建');
  } catch (error) {
    showToast(error.message || '创建分享失败');
    console.error(error);
  } finally {
    shareCreateBtn.disabled = false;
    shareCreateBtn.textContent = '创建分享';
  }
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    showToast('链接已复制到剪贴板');
  } catch (error) {
    shareLinkInput.select();
    document.execCommand('copy');
    showToast('链接已复制');
  }
}

shareCancelBtn.addEventListener('click', closeShareModal);
shareCreateBtn.addEventListener('click', createShare);
shareCopyLinkBtn.addEventListener('click', copyShareLink);

shareModal.addEventListener('click', (e) => {
  if (e.target === shareModal) {
    closeShareModal();
  }
});

// ========== 分享列表管理 ==========
const shareListModal = document.getElementById('share-list-modal');
const shareListContainer = document.getElementById('share-list-container');
const shareListCloseBtn = document.getElementById('share-list-close');
const mySharesBtn = document.getElementById('my-shares-btn');

function openShareListModal() {
  shareListModal.classList.remove('hidden');
  loadShareList();
}

function closeShareListModal() {
  shareListModal.classList.add('hidden');
}

async function loadShareList() {
  shareListContainer.innerHTML = '<div class="share-list-loading">加载中...</div>';

  try {
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }

    const response = await authFetch(`/api/share/list?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '获取分享列表失败');
    }

    renderShareList(data.shares || []);
  } catch (error) {
    shareListContainer.innerHTML = `<div class="share-list-error">${error.message}</div>`;
  }
}

function renderShareList(shares) {
  if (shares.length === 0) {
    shareListContainer.innerHTML = `
      <div class="share-list-empty">
        <p>暂无分享</p>
        <p style="font-size: 0.85rem; color: #888;">点击消息旁的「分享」按钮创建分享链接</p>
      </div>
    `;
    return;
  }

  const html = shares.map((share) => {
    const expiresDate = new Date(share.expiresAt);
    const expiresStr = expiresDate.toLocaleString('zh-CN');
    const passwordIcon = share.hasPassword ? ' 🔒' : '';
    const shareUrl = `${window.location.origin}/share/${share.shareId}`;

    return `
      <div class="share-list-item" data-share-id="${share.shareId}">
        <div class="share-list-item-info">
          <div class="share-list-item-id">分享 ID: ${share.shareId.slice(0, 8)}...${passwordIcon}</div>
          <div class="share-list-item-meta">
            <span>过期: ${expiresStr}</span>
            <span>访问: ${share.viewCount} 次</span>
          </div>
        </div>
        <div class="share-list-item-actions">
          <button class="btn btn-small btn-secondary share-copy-url-btn" data-url="${shareUrl}">复制链接</button>
          <button class="btn btn-small btn-danger share-cancel-btn" data-share-id="${share.shareId}">取消分享</button>
        </div>
      </div>
    `;
  }).join('');

  shareListContainer.innerHTML = html;

  // 绑定事件
  shareListContainer.querySelectorAll('.share-copy-url-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        showToast('链接已复制');
      } catch {
        showToast('复制失败');
      }
    });
  });

  shareListContainer.querySelectorAll('.share-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const shareId = btn.dataset.shareId;
      await cancelShare(shareId);
    });
  });
}

async function cancelShare(shareId) {
  try {
    const params = new URLSearchParams();
    if (currentMode === 'multi' && userId) {
      params.set('userId', userId);
    }

    const response = await authFetch(`/api/share/${shareId}?${params.toString()}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '取消分享失败');
    }

    showToast('分享已取消');
    loadShareList();
  } catch (error) {
    showToast(error.message);
  }
}

mySharesBtn.addEventListener('click', openShareListModal);
shareListCloseBtn.addEventListener('click', closeShareListModal);
shareListModal.addEventListener('click', (e) => {
  if (e.target === shareListModal) {
    closeShareListModal();
  }
});

// ========== 图片查看器 ==========
const imageViewer = document.getElementById('image-viewer');
const imageViewerImg = document.getElementById('image-viewer-img');
const imageViewerOriginalBtn = document.getElementById('image-viewer-original');
const imageViewerCopyBtn = document.getElementById('image-viewer-copy');
const imageViewerBackdrop = imageViewer.querySelector('.image-viewer-backdrop');
const imageViewerCloseBtn = imageViewer.querySelector('.image-viewer-close');

let currentViewerMessage = null;
let isViewingOriginal = false;

function openImageViewer(msg) {
  currentViewerMessage = msg;
  isViewingOriginal = false;

  const imageData = getImageContent(msg.content);

  // 显示缩略图
  imageViewerImg.src = imageData.thumbnail;

  // 如果有原图，显示原图按钮（需用户手动点击后加载）
  if (imageData.hasOriginal) {
    imageViewerOriginalBtn.classList.remove('hidden');
    imageViewerOriginalBtn.textContent = '查看原图';
    imageViewerOriginalBtn.disabled = false;
  } else {
    imageViewerOriginalBtn.classList.add('hidden');
  }

  imageViewer.classList.remove('hidden');
}

function closeImageViewer() {
  imageViewer.classList.add('hidden');
  imageViewerImg.src = '';
  currentViewerMessage = null;
  isViewingOriginal = false;
}

async function viewOriginalImage() {
  if (!currentViewerMessage) return;

  const imageData = getImageContent(currentViewerMessage.content);
  if (!imageData.hasOriginal) return;

  imageViewerOriginalBtn.disabled = true;
  imageViewerOriginalBtn.textContent = '加载中...';

  try {
    const original = await fetchOriginalImageWithTimeout(currentViewerMessage.id, ORIGINAL_FETCH_TIMEOUT);
    imageViewerImg.src = original;
    isViewingOriginal = true;
    imageViewerOriginalBtn.textContent = '当前原图';
  } catch (error) {
    console.error('加载原图失败:', error);
    showToast('加载原图失败');
    imageViewerOriginalBtn.textContent = '查看原图';
  } finally {
    imageViewerOriginalBtn.disabled = false;
  }
}

async function copyViewerImage() {
  const src = imageViewerImg.src;
  if (!src) {
    showToast('没有可复制的图片');
    return;
  }

  const successToast = isViewingOriginal ? '原图已复制到剪贴板' : '图片已复制到剪贴板';
  await copyImageToClipboard(src, {
    successToast,
    failureToast: '复制图片失败'
  });
}

imageViewerBackdrop.addEventListener('click', closeImageViewer);
imageViewerCloseBtn.addEventListener('click', closeImageViewer);
imageViewerOriginalBtn.addEventListener('click', viewOriginalImage);
imageViewerCopyBtn.addEventListener('click', copyViewerImage);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (imageViewer && !imageViewer.classList.contains('hidden')) {
      closeImageViewer();
    }
    if (textViewer && !textViewer.classList.contains('hidden')) {
      closeTextViewer();
    }
  }
});

// ========== 文本查看器 ==========
const textViewer = document.getElementById('text-viewer');
const textViewerContent = document.getElementById('text-viewer-content');
const textViewerMeta = document.getElementById('text-viewer-meta');
const textViewerClose = document.getElementById('text-viewer-close');
const textViewerCloseBtn = document.getElementById('text-viewer-close-btn');
const textViewerCopyBtn = document.getElementById('text-viewer-copy-btn');
const textViewerBackdrop = textViewer ? textViewer.querySelector('.text-viewer-backdrop') : null;

let currentViewerTextMsg = null;

function openTextViewer(msg) {
  if (!textViewer || !textViewerContent) return;
  currentViewerTextMsg = msg;

  const content = msg.content || '';
  const lines = content.split('\n').length;
  const chars = content.length;

  if (textViewerMeta) {
    textViewerMeta.textContent = `${lines} 行 · ${chars} 字 · ${formatTime(msg.timestamp)}`;
  }

  textViewerContent.innerHTML = renderSmartText(content);
  textViewer.classList.remove('hidden');
}

function closeTextViewer() {
  if (!textViewer) return;
  textViewer.classList.add('hidden');
  if (textViewerContent) {
    textViewerContent.innerHTML = '';
  }
  currentViewerTextMsg = null;
}

async function copyViewerText() {
  if (!currentViewerTextMsg || !currentViewerTextMsg.content) {
    showToast('没有可复制的内容');
    return;
  }
  await copyTextToClipboard(currentViewerTextMsg.content);
}

if (textViewerBackdrop) textViewerBackdrop.addEventListener('click', closeTextViewer);
if (textViewerClose) textViewerClose.addEventListener('click', closeTextViewer);
if (textViewerCloseBtn) textViewerCloseBtn.addEventListener('click', closeTextViewer);
if (textViewerCopyBtn) textViewerCopyBtn.addEventListener('click', copyViewerText);

// 处理 Socket.IO 连接认证失败
socket.on('connect_error', (err) => {
  console.error('Socket 连接失败:', err.message);
  if (err && err.message && err.message.includes('Authentication error')) {
    showToast('身份验证失效，请重新登录');
    requirePassword = true;
    logout(false);
  }
});

// 注册 PWA Service Worker 离线缓存服务
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => {
        console.log('ServiceWorker 注册成功，作用域为:', reg.scope);
        // 主动检测更新
        reg.update().catch(() => {});
      })
      .catch((err) => console.error('ServiceWorker 注册失败:', err));
  });
}
