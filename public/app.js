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
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text');
const pasteTextBtn = document.getElementById('paste-text');
const imageInput = document.getElementById('image-input');
const pasteImageBtn = document.getElementById('paste-image');
const clearAllBtn = document.getElementById('clear-all');
const logoutBtn = document.getElementById('logout-btn');
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const toastEl = document.getElementById('toast');
const imageProcessingState = document.getElementById('image-processing-state');

let messages = [];
let hasMoreMessages = false;
let initialLoaded = false;
let isInitialLoading = false;
let isLoadingOlder = false;
let isReconnectRefreshing = false;
let imageProcessingCount = 0;
let isAuthenticated = false;

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
    }, { root: messagesList, rootMargin: '200px' })
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
      <p style="font-size: 0.8rem; margin-top: 8px;">发送文字或图片开始使用</p>
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

function createMessageElement(msg) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message';
  messageEl.dataset.id = msg.id;

  const headerEl = document.createElement('div');
  headerEl.className = 'message-header';

  const timeEl = document.createElement('span');
  timeEl.className = 'message-time';
  timeEl.textContent = formatTime(msg.timestamp);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'message-delete';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', () => deleteMessage(msg.id));

  headerEl.appendChild(timeEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'message-actions';

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
  } else {
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
  }

  actionsEl.appendChild(deleteBtn);
  messageEl.appendChild(actionsEl);
  return messageEl;
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
  const savedPassword = localStorage.getItem('web-clipboard-password');
  if (savedPassword) {
    verifyPassword(savedPassword);
  }
}

function logout(showMessage = true) {
  localStorage.removeItem('web-clipboard-password');
  isAuthenticated = false;
  messages = [];
  hasMoreMessages = false;
  initialLoaded = false;
  isInitialLoading = false;
  isLoadingOlder = false;
  isReconnectRefreshing = false;
  setTopLoading(false);
  authSection.classList.remove('hidden');
  chatSection.classList.add('hidden');
  authError.classList.add('hidden');
  passwordInput.value = '';
  passwordInput.focus();
  renderEmptyState();
  if (showMessage) {
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
      isAuthenticated = true;
      localStorage.setItem('web-clipboard-password', password);
      authSection.classList.add('hidden');
      chatSection.classList.remove('hidden');
      loadInitialMessages();
      return;
    }

    authError.classList.remove('hidden');
    localStorage.removeItem('web-clipboard-password');
  } catch (error) {
    showToast('验证失败');
    console.error(error);
  }
}

async function sendMessage(type, content) {
  if (type === 'text' && (!content || !content.trim())) {
    showToast('内容不能为空');
    return;
  }

  if (type === 'image' && !content) {
    return;
  }

  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content })
    });
  } catch (error) {
    showToast('发送失败');
    console.error(error);
  }
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
    await processAndSendImageBlob(file);
  }
}

async function pasteImage() {
  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith('image/')) continue;

        const blob = await item.getType(type);
        await processAndSendImageBlob(blob);
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

imageInput.addEventListener('change', (e) => {
  handleImageFiles(e.target.files);
  imageInput.value = '';
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
  renderMessages();
});

socket.on('messages-clear', () => {
  if (!isAuthenticated) return;
  messages = [];
  hasMoreMessages = false;
  renderMessages();
});

checkAuth();
