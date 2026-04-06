const socket = io();

const PAGE_SIZE = 30;
const TOP_LOAD_THRESHOLD = 60;
const ORIGINAL_FETCH_TIMEOUT = 5000;
const THUMBNAIL_MAX_EDGE = 480;
const THUMBNAIL_NO_COMPRESS_MAX_BYTES = 500 * 1024;

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
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const toastEl = document.getElementById('toast');
const imageProcessingState = document.getElementById('image-processing-state');
const tabs = document.querySelectorAll('.tab');
const dropZone = document.getElementById('drop-zone');
const dropOverlay = document.getElementById('drop-overlay');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const uploadProgressPercent = document.getElementById('upload-progress-percent');
const uploadProgressCancel = document.getElementById('upload-progress-cancel');

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
  });

  img.addEventListener('error', () => {
    placeholder.textContent = '图片加载失败';
    img.classList.add('hidden');
  });

  img.addEventListener('click', () => {
    copyImageToClipboard(thumbnailUrl, {
      successToast: '图片已复制到剪贴板',
      failureToast: '复制图片失败'
    });
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
    contentEl.textContent = msg.content;
    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

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
    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-secondary';
    downloadBtn.textContent = '下载文件';
    downloadBtn.addEventListener('click', () => {
      window.open(`/api/messages/${msg.id}/file-download`, '_blank', 'noopener');
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
    scrollToBottom();
  }
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function checkAuth() {
  // 先检查是否需要密码
  fetch('/api/auth/status')
    .then((res) => res.json())
    .then((data) => {
      requirePassword = data.requirePassword;
      if (!requirePassword) {
        // 无密码模式，直接进入
        enterChatMode();
        return;
      }
      // 有密码模式，检查本地缓存
      const savedPassword = localStorage.getItem('web-clipboard-password');
      if (savedPassword) {
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
  loadInitialMessages();
  loadFavorites();
  loadVersion();
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
    const response = await fetch('/api/favorites');
    if (!response.ok) return;
    const data = await response.json();
    favorites = data.messages || [];
  } catch (error) {
    console.error('加载收藏失败:', error);
  }
}

async function toggleFavorite(id, isFavorite) {
  try {
    const method = isFavorite ? 'POST' : 'DELETE';
    await fetch(`/api/messages/${id}/favorite`, { method });
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
  localStorage.removeItem('web-clipboard-password');
  isAuthenticated = false;
  messages = [];
  favorites = [];
  hasMoreMessages = false;
  initialLoaded = false;
  isInitialLoading = false;
  isLoadingOlder = false;
  isReconnectRefreshing = false;
  setTopLoading(false);

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

  const response = await fetch(`/api/messages?${params.toString()}`);
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

async function verifyPassword(password) {
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (data.success) {
      // 无密码模式不缓存密码
      if (!data.noPassword) {
        localStorage.setItem('web-clipboard-password', password);
      }
      enterChatMode();
      return;
    }

    authError.classList.remove('hidden');
    localStorage.removeItem('web-clipboard-password');
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

    if ((type === 'image' || type === 'file') && !(content instanceof File || content instanceof Blob)) {
      showToast('文件内容为空');
      reject(new Error('文件内容为空'));
      return;
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

    // 文本消息使用原有 JSON API
    if (type === 'text') {
      xhr.open('POST', '/api/messages');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ type, content }));
    } else {
      // 图片和文件使用 FormData
      const formData = new FormData();
      formData.append('type', type);
      formData.append('file', content);
      xhr.open('POST', '/api/messages/upload');
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
    await sendMessageWithProgress(type, content);
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
    await fetch(`/api/messages/${id}`, {
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
      await fetch('/api/messages/clear', {
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
    const response = await fetch(`/api/messages/${id}/image-original`, {
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

function getThumbnailCompressionConfig(sizeBytes) {
  if (sizeBytes <= THUMBNAIL_NO_COMPRESS_MAX_BYTES) {
    return null;
  }

  if (sizeBytes <= 1.5 * 1024 * 1024) {
    return { maxEdge: 1920, quality: 0.96 };
  }
  if (sizeBytes <= 3 * 1024 * 1024) {
    return { maxEdge: 1600, quality: 0.92 };
  }
  if (sizeBytes <= 6 * 1024 * 1024) {
    return { maxEdge: 1360, quality: 0.88 };
  }
  if (sizeBytes <= 12 * 1024 * 1024) {
    return { maxEdge: 1120, quality: 0.82 };
  }
  return { maxEdge: 960, quality: 0.78 };
}

async function createThumbnailDataUrl(blob) {
  const config = getThumbnailCompressionConfig(blob.size);
  if (!config) {
    return blobToDataUrl(blob);
  }

  const img = await loadImageElementFromBlob(blob);
  const maxEdge = Math.max(config.maxEdge, THUMBNAIL_MAX_EDGE);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(mimeType, config.quality);
}

async function buildImagePayload(blob) {
  const originalPromise = blobToDataUrl(blob);
  const thumbnailPromise = createThumbnailDataUrl(blob);
  const [thumbnail, original] = await Promise.all([thumbnailPromise, originalPromise]);
  return { thumbnail, original };
}

async function processAndSendImageBlob(blob) {
  setImageProcessing(true);
  try {
    const content = await buildImagePayload(blob);
    await sendMessage('image', content);
  } catch (error) {
    showToast('图片处理或发送失败');
    console.error(error);
  } finally {
    setImageProcessing(false);
  }
}

async function handleImageFiles(files) {
  for (const file of files) {
    if (!file || !file.type.startsWith('image/')) continue;
    queueUpload('image', file);
  }
}

async function handleFileUpload(files) {
  for (const file of files) {
    if (!file) continue;
    queueUpload('file', file);
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
        queueUpload('image', file);
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
pasteTextBtn.addEventListener('click', pasteText);
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
  messages.push(msg);
  renderMessages({ scrollBottom: true });
  showToast('收到新消息');
});

socket.on('message-delete', (id) => {
  if (!isAuthenticated) return;
  messages = messages.filter((m) => m.id !== id);
  favorites = favorites.filter((f) => f.id !== id);
  renderMessages();
  if (currentTab === 'favorites') {
    renderFavorites();
  }
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

  // 重新渲染
  renderMessages();
  if (currentTab === 'favorites') {
    renderFavorites();
  }
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

checkAuth();
