/**
 * Web Clipboard 前端主入口模块 (ES Module 架构胶水层)
 */

import {
  PAGE_SIZE,
  TOP_LOAD_THRESHOLD,
  THUMBNAIL_MAX_EDGE,
  LARGE_IMAGE_THRESHOLD_BYTES,
  STORAGE_KEYS
} from './js/config.js';

import { state } from './js/state.js';

import {
  authFetch,
  fetchAuthStatus,
  login as apiLogin,
  fetchMessages,
  fetchFavorites,
  sendTextMessage,
  uploadMediaWithProgress,
  toggleFavorite as apiToggleFavorite,
  deleteMessage as apiDeleteMessage,
  clearAllMessages as apiClearAll
} from './js/api.js';

import {
  initSocketConnection,
  connectSocket,
  disconnectSocket
} from './js/socket.js';

import {
  compressImageToBlob,
  createThumbnailBlob,
  convertHeicToJpegIfNeeded
} from './js/media/image-process.js';

import {
  ImageViewerModal,
  TextViewerModal,
  RemarkModal,
  ImageChoiceModal
} from './js/components/modals.js';

import {
  ShareModal,
  ShareListModal
} from './js/components/share-modal.js';

import {
  createMessageElement
} from './js/components/message-item.js';

// ========== DOM 元素引用 ==========
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
const clearCacheBtn = document.getElementById('clear-cache-btn');
const currentUserEl = document.getElementById('current-user');
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const toastEl = document.getElementById('toast');
const imageProcessingState = document.getElementById('image-processing-state');
const tabs = document.querySelectorAll('.tab');
const dropZone = document.getElementById('drop-zone');
const dropOverlay = document.getElementById('drop-overlay');

// 搜索与分类 DOM
const searchBarPanel = document.getElementById('search-bar-panel');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const searchPillsRow = document.getElementById('search-pills-row');
const searchPills = document.querySelectorAll('.search-pill');
const searchResultCount = document.getElementById('search-result-count');

const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const uploadProgressPercent = document.getElementById('upload-progress-percent');
const uploadProgressCancel = document.getElementById('upload-progress-cancel');
const limitDurationChk = document.getElementById('limit-duration-chk');
const loginDurationSelect = document.getElementById('login-duration-select');

let expireCheckInterval = null;
let toastTimeout = null;

// ========== 提示与通知 ==========
export function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3000);
}

// ========== 实例化弹窗组件 ==========
const imageViewerModal = new ImageViewerModal({
  modalEl: document.getElementById('image-viewer'),
  onToast: showToast
});

const textViewerModal = new TextViewerModal({
  modalEl: document.getElementById('text-viewer'),
  onToast: showToast
});

const remarkModal = new RemarkModal({
  modalEl: document.getElementById('remark-modal'),
  onRemarkSaved: (id, remark) => updateSingleMessageRemark(id, remark),
  onToast: showToast
});

const imageChoiceModal = new ImageChoiceModal();

const shareModal = new ShareModal({
  onToast: showToast
});

const shareListModal = new ShareListModal({
  onToast: showToast
});

// ========== 图片 IntersectionObserver 懒加载与本地缓存 ==========
export const imageObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (!img.src) {
          loadImageWithCache(img);
        }
        imageObserver.unobserve(img);
      });
    }, { rootMargin: '200px' })
  : null;

async function loadImageWithCache(img) {
  const url = img.dataset.src;
  if (!url) return;
  if (url.startsWith('data:')) {
    img.src = url;
    return;
  }

  const messageId = img.dataset.messageId;
  const isFavorite = img.dataset.favorite === '1';

  // 1. 优先从本地 IndexedDB 加载
  if (window.ImageCache && messageId) {
    try {
      const cached = await window.ImageCache.getThumbnail(state.userId, messageId);
      if (cached && cached.blob) {
        const objectUrl = URL.createObjectURL(cached.blob);
        img._blobUrl = objectUrl;
        img.src = objectUrl;
        return;
      }
    } catch (e) {
      console.warn('读取本地图片缓存失败:', e);
    }
  }

  // 2. 本地无缓存，通过带鉴权凭据的 authFetch 获取并写入缓存
  try {
    const response = await authFetch(url);
    if (!response.ok) {
      throw new Error(`fetch image failed: ${response.status}`);
    }
    const blob = await response.blob();
    if (window.ImageCache && messageId) {
      await window.ImageCache.setThumbnail(state.userId, messageId, url, blob, blob.type || 'image/webp', isFavorite);
      updateCacheButtonDisplay();
    }
    const objectUrl = URL.createObjectURL(blob);
    img._blobUrl = objectUrl;
    img.src = objectUrl;
  } catch (error) {
    // 降级使用带凭证的 url 触发原生图片错误事件
    try {
      const fallbackUrl = new URL(url, window.location.origin);
      const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
      const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
      if (savedPassword) fallbackUrl.searchParams.set('password', savedPassword);
      if (savedUserId) fallbackUrl.searchParams.set('userId', savedUserId);
      img.src = fallbackUrl.toString();
    } catch {
      img.src = url;
    }
  }
}

// 释放容器中未被销毁的 ObjectURL 避免内存泄露
function revokeBlobUrls(container) {
  if (!container) return;
  const imgs = container.querySelectorAll('img');
  imgs.forEach((img) => {
    if (img._blobUrl) {
      URL.revokeObjectURL(img._blobUrl);
      img._blobUrl = null;
    }
  });
}

// ========== 消息列表渲染与 DOM 更新 ==========
function updateMessageCount() {
  if (messageCount) {
    if (state.isSearchActive) {
      const total = Number.isFinite(state.searchTotal) ? state.searchTotal : state.messages.length;
      messageCount.textContent = `筛选结果: ${state.messages.length}/${total} 条`;
    } else {
      messageCount.textContent = `${state.messages.length} 条消息`;
    }
  }
  if (clearAllBtn) clearAllBtn.disabled = state.messages.length === 0;
}

function renderLoadingState() {
  revokeBlobUrls(messagesList);
  messagesList.innerHTML = '<div class="messages-loading">正在加载消息...</div>';
  updateMessageCount();
}

function renderEmptyState() {
  revokeBlobUrls(messagesList);
  messagesList.innerHTML = `
    <div class="empty-state">
      <p>${state.isSearchActive ? '未找到匹配的消息' : '暂无消息'}</p>
      <p style="font-size: 0.8rem; margin-top: 8px;">${state.isSearchActive ? '请尝试更换关键词或分类选项' : '发送文字、图片或文件开始使用'}</p>
    </div>
  `;
  updateMessageCount();
}

function renderMessages({ scrollBottom = false } = {}) {
  if (state.isInitialLoading && state.messages.length === 0) {
    renderLoadingState();
    return;
  }

  if (state.messages.length === 0) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  state.messages.forEach((msg) => {
    fragment.appendChild(createMessageElement(msg, {
      searchKeyword: state.searchKeyword,
      onOpenTextViewer: (m) => textViewerModal.open(m),
      onOpenImageViewer: (m) => imageViewerModal.open(m),
      onOpenRemark: (m) => remarkModal.open(m),
      onOpenShare: (m) => shareModal.open(m),
      onToggleFavorite: (id) => handleToggleFavorite(id),
      onDelete: (id) => handleDeleteMessage(id),
      onToast: showToast,
      imageObserver
    }));
  });

  revokeBlobUrls(messagesList);
  messagesList.innerHTML = '';
  messagesList.appendChild(fragment);
  updateMessageCount();

  if (scrollBottom) {
    messagesList.scrollTop = messagesList.scrollHeight;
  }
}

function appendSingleMessage(msg) {
  const emptyEl = messagesList.querySelector('.empty-state, .messages-loading');
  if (emptyEl) {
    revokeBlobUrls(messagesList);
    messagesList.innerHTML = '';
  }

  const el = createMessageElement(msg, {
    searchKeyword: state.searchKeyword,
    onOpenTextViewer: (m) => textViewerModal.open(m),
    onOpenImageViewer: (m) => imageViewerModal.open(m),
    onOpenRemark: (m) => remarkModal.open(m),
    onOpenShare: (m) => shareModal.open(m),
    onToggleFavorite: (id) => handleToggleFavorite(id),
    onDelete: (id) => handleDeleteMessage(id),
    onToast: showToast,
    imageObserver
  });
  messagesList.appendChild(el);
  updateMessageCount();

  const isAtBottom = messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight < 150;
  if (isAtBottom || state.shouldStickToBottom) {
    messagesList.scrollTop = messagesList.scrollHeight;
  }
}

function removeSingleMessage(id) {
  const removeFromContainer = (container) => {
    if (!container) return;
    const el = container.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
    if (el) {
      revokeBlobUrls(el);
      el.remove();
    }
  };
  removeFromContainer(messagesList);
  removeFromContainer(favoritesList);

  state.messages = state.messages.filter((m) => m.id !== id);
  state.favorites = state.favorites.filter((m) => m.id !== id);

  if (state.currentTab === 'favorites') {
    renderFavorites();
  }
  updateMessageCount();

  if (state.messages.length === 0) {
    renderEmptyState();
  }

  if (window.ImageCache) {
    window.ImageCache.deleteThumbnail(state.userId, id);
    updateCacheButtonDisplay();
  }
}

function updateSingleMessageFavorite(id, favorite, updatedMessage = null) {
  // 1. 更新 DOM 样式与按钮状态
  const updateDom = (container) => {
    if (!container) return;
    const msgEl = container.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
    if (msgEl) {
      msgEl.classList.toggle('favorited', favorite);
      const favBtn = msgEl.querySelector('.message-favorite-action');
      if (favBtn) {
        favBtn.classList.toggle('active', favorite);
        favBtn.classList.toggle('favorited', favorite);
        favBtn.textContent = favorite ? '★ 已收藏' : '☆ 收藏';
        favBtn.title = favorite ? '取消收藏' : '添加收藏';
      }
    }
  };
  updateDom(messagesList);
  updateDom(favoritesList);

  // 2. 同步更新 state.messages 中的对应项
  const msg = state.messages.find((m) => m.id === id);
  if (msg) msg.favorite = favorite;

  // 3. 同步维护 state.favorites 列表
  if (favorite) {
    const favMsg = updatedMessage || msg || state.favorites.find((f) => f.id === id);
    if (favMsg) {
      const cloned = { ...favMsg, favorite: true };
      const idx = state.favorites.findIndex((f) => f.id === id);
      if (idx !== -1) {
        state.favorites[idx] = cloned;
      } else {
        state.favorites.push(cloned);
      }
    }
  } else {
    state.favorites = state.favorites.filter((f) => f.id !== id);
  }

  // 4. 同步更新图片本地缓存的收藏状态
  if (window.ImageCache) {
    window.ImageCache.updateFavoriteStatus(state.userId, id, favorite);
  }
  const targetImgs = document.querySelectorAll(`.message[data-id="${CSS.escape(id)}"] img.message-image`);
  targetImgs.forEach((img) => {
    img.dataset.favorite = favorite ? '1' : '0';
  });

  // 5. 若当前在收藏标签页，重新渲染收藏列表
  if (state.currentTab === 'favorites') {
    renderFavorites();
  }
}

function updateSingleMessageRemark(id, remark) {
  const updateDom = (container) => {
    if (!container) return;
    const msgEl = container.querySelector(`.message[data-id="${CSS.escape(id)}"]`);
    if (msgEl) {
      const remarkBtn = msgEl.querySelector('.message-remark-action');
      if (remarkBtn) {
        remarkBtn.classList.toggle('has-remark', Boolean(remark));
        remarkBtn.title = remark ? '修改备注' : '添加备注';
      }
      const remarkBox = msgEl.querySelector('.message-remark-box');
      if (remarkBox) {
        remarkBox.classList.toggle('hidden', !remark);
        const textSpan = remarkBox.querySelector('.message-remark-text');
        if (textSpan) textSpan.textContent = remark || '';
      }
    }
  };

  updateDom(messagesList);
  updateDom(favoritesList);

  const m = state.messages.find((item) => item.id === id);
  if (m) m.remark = remark;
  const f = state.favorites.find((item) => item.id === id);
  if (f) f.remark = remark;
}

// ========== 收藏标签页 ==========
function renderFavorites() {
  if (!favoritesList) return;
  if (state.favorites.length === 0) {
    revokeBlobUrls(favoritesList);
    favoritesList.innerHTML = `
      <div class="empty-state">
        <p>${state.isSearchActive ? '未找到符合条件的收藏消息' : '暂无收藏'}</p>
        <p style="font-size: 0.8rem; margin-top: 8px;">${state.isSearchActive ? '请尝试更换关键词或分类选项' : '点击消息旁的 ☆ 收藏重要内容'}</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.favorites.forEach((msg) => {
    fragment.appendChild(createMessageElement(msg, {
      isFavoritesView: true,
      searchKeyword: state.searchKeyword,
      onOpenTextViewer: (m) => textViewerModal.open(m),
      onOpenImageViewer: (m) => imageViewerModal.open(m),
      onOpenRemark: (m) => remarkModal.open(m),
      onOpenShare: (m) => shareModal.open(m),
      onToggleFavorite: (id) => handleToggleFavorite(id),
      onDelete: (id) => handleDeleteMessage(id),
      onToast: showToast,
      imageObserver
    }));
  });

  revokeBlobUrls(favoritesList);
  favoritesList.innerHTML = '';
  favoritesList.appendChild(fragment);
}

async function loadFavorites() {
  try {
    const data = await fetchFavorites({
      keyword: state.searchKeyword,
      category: state.searchCategory
    });
    state.favorites = data.messages || [];
    state.searchTotal = Number.isFinite(data.total) ? data.total : (data.messages ? data.messages.length : 0);
    updateSearchResultCount();
    if (state.currentTab === 'favorites') {
      renderFavorites();
    }
  } catch (error) {
    console.error('加载收藏失败:', error);
  }
}

async function handleToggleFavorite(id) {
  try {
    const msgInList = state.messages.find((m) => m.id === id);
    const msgInFav = state.favorites.find((f) => f.id === id);
    const isCurrentlyFav = msgInList ? Boolean(msgInList.favorite) : Boolean(msgInFav);
    const newStatus = !isCurrentlyFav;

    const res = await apiToggleFavorite(id, newStatus);
    const updatedMsg = res && res.message ? res.message : null;
    updateSingleMessageFavorite(id, newStatus, updatedMsg);
    showToast(newStatus ? '已添加收藏' : '已取消收藏');
  } catch (error) {
    showToast('收藏操作失败');
    console.error(error);
  }
}

async function handleDeleteMessage(id) {
  try {
    await apiDeleteMessage(id);
    removeSingleMessage(id);
    showToast('已删除消息');
  } catch (error) {
    showToast(error.message || '删除消息失败');
  }
}

// ========== 数据加载与分页 ==========
async function loadInitialMessages() {
  state.isInitialLoading = true;
  renderMessages();

  try {
    const data = await fetchMessages({
      limit: PAGE_SIZE,
      keyword: state.searchKeyword,
      category: state.searchCategory
    });
    state.messages = data.messages || [];
    state.hasMoreMessages = Boolean(data.hasMore);
    state.searchTotal = Number.isFinite(data.total) ? data.total : (data.messages ? data.messages.length : 0);
    updateSearchResultCount();

    if (data.expireHours && expireInfo) {
      expireInfo.textContent = data.expireHours >= 24
        ? `消息将在 ${Math.round(data.expireHours / 24)} 天后过期`
        : `消息将在 ${data.expireHours} 小时后过期`;
    }
  } catch (error) {
    console.error('加载消息失败:', error);
    showToast('加载消息失败');
  } finally {
    state.isInitialLoading = false;
    renderMessages({ scrollBottom: true });
  }
}

const topLoadingIndicator = document.createElement('div');
topLoadingIndicator.className = 'messages-top-loading hidden';
topLoadingIndicator.textContent = '正在加载更早消息...';
if (messagesList && messagesList.parentElement) {
  messagesList.parentElement.insertBefore(topLoadingIndicator, messagesList);
}

async function loadOlderMessages() {
  if (state.isLoadingOlder || !state.hasMoreMessages || state.messages.length === 0) return;
  state.isLoadingOlder = true;
  topLoadingIndicator.classList.remove('hidden');

  const oldestTimestamp = state.messages[0].timestamp;
  const prevScrollHeight = messagesList.scrollHeight;
  const prevScrollTop = messagesList.scrollTop;

  try {
    const data = await fetchMessages({
      before: oldestTimestamp,
      limit: PAGE_SIZE,
      keyword: state.searchKeyword,
      category: state.searchCategory
    });
    const olderMessages = data.messages || [];
    state.hasMoreMessages = Boolean(data.hasMore);

    if (olderMessages.length > 0) {
      state.messages = [...olderMessages, ...state.messages];
      const fragment = document.createDocumentFragment();
      olderMessages.forEach((msg) => {
        fragment.appendChild(createMessageElement(msg, {
          searchKeyword: state.searchKeyword,
          onOpenTextViewer: (m) => textViewerModal.open(m),
          onOpenImageViewer: (m) => imageViewerModal.open(m),
          onOpenRemark: (m) => remarkModal.open(m),
          onOpenShare: (m) => shareModal.open(m),
          onToggleFavorite: (id) => handleToggleFavorite(id),
          onDelete: (id) => handleDeleteMessage(id),
          onToast: showToast,
          imageObserver
        }));
      });
      messagesList.insertBefore(fragment, messagesList.firstChild);
      updateMessageCount();
      // 保持相对视口位置
      messagesList.scrollTop = prevScrollTop + (messagesList.scrollHeight - prevScrollHeight);
    }
  } catch (err) {
    console.error('加载更早消息失败:', err);
    showToast('加载更早消息失败');
  } finally {
    state.isLoadingOlder = false;
    topLoadingIndicator.classList.add('hidden');
  }
}

if (messagesList) {
  messagesList.addEventListener('scroll', () => {
    if (messagesList.scrollTop <= TOP_LOAD_THRESHOLD && !state.isLoadingOlder && state.hasMoreMessages) {
      loadOlderMessages();
    }
  });
}

// ========== 缓存统计与按钮更新 ==========
async function updateCacheButtonDisplay() {
  if (!clearCacheBtn || !window.ImageCache) return;
  try {
    const stats = await window.ImageCache.getCacheStats(state.userId);
    clearCacheBtn.title = `本地图片缓存: ${stats.count} 张 (${stats.formattedSize})`;
    if (stats.count > 0) {
      clearCacheBtn.textContent = `清理缓存 (${stats.formattedSize})`;
    } else {
      clearCacheBtn.textContent = '清理缓存';
    }
  } catch {
    clearCacheBtn.textContent = '清理缓存';
  }
}

function showConfirmModal(message, onConfirm, { hint = '' } = {}) {
  const modal = document.getElementById('confirm-modal');
  const modalMessage = document.getElementById('modal-message');
  const modalHint = document.getElementById('modal-hint');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');

  if (!modal || !confirmBtn || !cancelBtn) {
    if (window.confirm(message)) {
      onConfirm();
    }
    return;
  }

  if (modalMessage) modalMessage.textContent = message;

  if (modalHint) {
    if (hint) {
      modalHint.textContent = hint;
      modalHint.classList.remove('hidden');
    } else {
      modalHint.textContent = '';
      modalHint.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');

  const closeModal = () => {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', closeModal);
    confirmBtn.removeEventListener('click', handleConfirm);
    modal.removeEventListener('click', onBackdropClick);
  };

  const handleConfirm = () => {
    closeModal();
    onConfirm();
  };

  const onBackdropClick = (e) => {
    if (e.target === modal) closeModal();
  };

  cancelBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', handleConfirm);
  modal.addEventListener('click', onBackdropClick);
}

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    if (!window.ImageCache) return;
    try {
      const stats = await window.ImageCache.getCacheStats(state.userId);
      if (stats.count === 0) {
        showToast('当前本地无图片缓存');
        return;
      }
      showConfirmModal(
        `确定要清理本地图片缓存吗？\n当前已缓存 ${stats.count} 张图片，共占用 ${stats.formattedSize}。`,
        async () => {
          try {
            await window.ImageCache.clearAllThumbnails();
            revokeBlobUrls(messagesList);
            if (favoritesList) revokeBlobUrls(favoritesList);
            await updateCacheButtonDisplay();
            showToast('本地图片缓存已清理');
          } catch {
            showToast('清理缓存失败');
          }
        },
        {
          hint: '提示：清理后不影响云端消息，但刷新页面或再次查看时将重新从服务端下载。'
        }
      );
    } catch {
      showToast('获取缓存信息失败');
    }
  });
}

// ========== 上传队列与媒体处理 ==========
function updateUploadProgress(percent, filename) {
  if (!uploadProgressContainer) return;
  uploadProgressContainer.classList.remove('hidden');
  if (uploadProgressFill) uploadProgressFill.style.width = `${percent}%`;
  if (uploadProgressPercent) uploadProgressPercent.textContent = `${percent}%`;
  if (uploadProgressText) uploadProgressText.textContent = `正在上传 ${filename}...`;
}

function hideUploadProgress() {
  if (!uploadProgressContainer) return;
  uploadProgressContainer.classList.add('hidden');
  if (uploadProgressFill) uploadProgressFill.style.width = '0%';
  if (uploadProgressPercent) uploadProgressPercent.textContent = '0%';
  state.currentXhr = null;
}

if (uploadProgressCancel) {
  uploadProgressCancel.addEventListener('click', () => {
    if (state.currentXhr) {
      state.currentXhr.abort();
      showToast('已取消上传');
    }
    hideUploadProgress();
  });
}

async function processUploadQueue() {
  if (state.isUploading || state.uploadQueue.length === 0) return;
  state.isUploading = true;

  const item = state.uploadQueue.shift();
  try {
    updateUploadProgress(0, item.filename);

    const formData = new FormData();
    formData.append('type', item.type);
    formData.append('file', item.file, item.filename);
    if (item.thumbnailBlob) {
      formData.append('thumbnail', item.thumbnailBlob, `thumb-${item.filename}.webp`);
    }
    if (item.remark) {
      formData.append('remark', item.remark);
    }
    if (state.currentMode === 'multi' && state.userId) {
      formData.append('userId', state.userId);
    }

    const res = await uploadMediaWithProgress({
      formData,
      onProgress: (percent) => updateUploadProgress(percent, item.filename),
      onAbortRef: (xhr) => { state.currentXhr = xhr; }
    });

    if (res && res.message) {
      // 避免 WebSocket 重复
      const exists = state.messages.some((m) => m.id === res.message.id);
      if (!exists) {
        state.messages.push(res.message);
        appendSingleMessage(res.message);
      }
    }
  } catch (err) {
    if (err.message !== '上传已取消') {
      console.error('文件上传错误:', err);
      showToast(err.message || '上传文件失败');
    }
  } finally {
    hideUploadProgress();
    state.isUploading = false;
    if (state.uploadQueue.length > 0) {
      processUploadQueue();
    }
  }
}

async function enqueueFilesForUpload(fileList) {
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList);

  // 1. 处理 HEIC 转换
  state.setImageProcessing(true);
  const convertedFiles = [];
  for (const f of files) {
    const readyFile = await convertHeicToJpegIfNeeded(f, showToast);
    convertedFiles.push(readyFile);
  }
  state.setImageProcessing(false);

  // 2. 区分大图与常规文件
  const largeImages = [];
  const normalFiles = [];

  for (const f of convertedFiles) {
    const isImage = f.type && f.type.startsWith('image/');
    if (isImage && f.size > LARGE_IMAGE_THRESHOLD_BYTES) {
      largeImages.push(f);
    } else {
      normalFiles.push(f);
    }
  }

  // 3. 超大图片统一弹窗询问策略
  let choice = 'compress';
  if (largeImages.length > 0) {
    const totalMB = (largeImages.reduce((sum, item) => sum + item.size, 0) / (1024 * 1024)).toFixed(1);
    choice = await imageChoiceModal.confirm(largeImages.length, totalMB);
    if (choice === 'cancel') return;
  }

  // 4. 加入队列
  state.setImageProcessing(true);
  for (const f of normalFiles) {
    const isImage = f.type && f.type.startsWith('image/');
    let thumbBlob = null;
    if (isImage) {
      thumbBlob = await createThumbnailBlob(f);
    }
    state.uploadQueue.push({
      type: isImage ? 'image' : 'file',
      file: f,
      filename: f.name || 'file',
      thumbnailBlob: thumbBlob,
      remark: ''
    });
  }

  for (const f of largeImages) {
    let uploadFile = f;
    let thumbBlob = null;

    if (choice === 'compress') {
      const compressedBlob = await compressImageToBlob(f, HD_COMPRESS_MAX_EDGE, 0.92);
      uploadFile = new File([compressedBlob], f.name, { type: 'image/webp' });
      thumbBlob = await createThumbnailBlob(compressedBlob);
    } else {
      // 原始无损上传，但生成缩略图供列表秒开
      thumbBlob = await createThumbnailBlob(f);
    }

    state.uploadQueue.push({
      type: 'image',
      file: uploadFile,
      filename: uploadFile.name || 'image',
      thumbnailBlob: thumbBlob,
      remark: ''
    });
  }
  state.setImageProcessing(false);

  processUploadQueue();
}

// ========== 文本发送与输入交互 ==========
async function handleSendText() {
  const content = textInput.value.trim();
  if (!content) return;

  sendTextBtn.disabled = true;
  try {
    const res = await sendTextMessage({ content, remark: '' });
    textInput.value = '';
    textInput.style.height = 'auto';

    const exists = state.messages.some((m) => m.id === res.message.id);
    if (!exists) {
      state.messages.push(res.message);
      appendSingleMessage(res.message);
    }
  } catch (err) {
    showToast(err.message || '发送失败');
  } finally {
    sendTextBtn.disabled = false;
    textInput.focus();
  }
}

if (sendTextBtn) sendTextBtn.addEventListener('click', handleSendText);

if (textInput) {
  textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendText();
    }
  });

  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 200) + 'px';
  });
}

if (pasteTextBtn) {
  pasteTextBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        textInput.value = text;
        textInput.focus();
        textInput.style.height = 'auto';
        textInput.style.height = Math.min(textInput.scrollHeight, 200) + 'px';
      }
    } catch {
      showToast('无法读取剪贴板，请手动粘贴');
    }
  });
}

if (imageInput) {
  imageInput.addEventListener('change', (e) => {
    enqueueFilesForUpload(e.target.files);
    imageInput.value = '';
  });
}

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    enqueueFilesForUpload(e.target.files);
    fileInput.value = '';
  });
}

// 粘贴文件与图片
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
  }

  if (files.length > 0) {
    e.preventDefault();
    enqueueFilesForUpload(files);
  }
});

// 拖拽文件上传
let dragCounter = 0;
if (dropZone) {
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dropOverlay) dropOverlay.classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0 && dropOverlay) {
      dropOverlay.classList.add('hidden');
      dragCounter = 0;
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropOverlay) dropOverlay.classList.add('hidden');

    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      enqueueFilesForUpload(dt.files);
    }
  });
}

// ========== 搜索与分类浏览控制器 ==========
let searchDebounceTimer = null;

function hasActiveFilter() {
  const hasKw = Boolean(state.searchKeyword && state.searchKeyword.trim());
  const hasCat = Boolean(state.searchCategory && state.searchCategory !== 'all');
  return hasKw || hasCat;
}

function updateSearchResultCount() {
  if (!searchResultCount) return;
  if (!hasActiveFilter()) {
    searchResultCount.classList.add('hidden');
    return;
  }
  const count = state.searchTotal || 0;
  searchResultCount.textContent = `共 ${count} 条`;
  searchResultCount.classList.remove('hidden');
}

function matchesCurrentSearch(msg) {
  if (!hasActiveFilter()) return true;
  const category = state.searchCategory || 'all';
  const keyword = (state.searchKeyword || '').trim().toLowerCase();

  // 1. 分类匹配
  if (category !== 'all') {
    if (category === 'text' && msg.type !== 'text') return false;
    if (category === 'image' && msg.type !== 'image') return false;
    const isVideo = msg.type === 'file' && msg.content && (
      (typeof msg.content.mimeType === 'string' && msg.content.mimeType.toLowerCase().startsWith('video/')) ||
      /\.(mp4|mov|webm|mkv|avi|m4v|flv|wmv)$/i.test(msg.content.name || '')
    );
    if (category === 'video' && !isVideo) return false;
    if (category === 'file' && (msg.type !== 'file' || isVideo)) return false;
  }

  // 2. 关键词匹配
  if (keyword) {
    if (msg.remark && typeof msg.remark === 'string' && msg.remark.toLowerCase().includes(keyword)) return true;
    if (msg.type === 'text' && typeof msg.content === 'string' && msg.content.toLowerCase().includes(keyword)) return true;
    if (msg.type === 'file' && msg.content && typeof msg.content.name === 'string' && msg.content.name.toLowerCase().includes(keyword)) return true;
    return false;
  }

  return true;
}

function updateSearchPanelExpansion() {
  if (!searchBarPanel) return;
  if (hasActiveFilter() || (searchInput && document.activeElement === searchInput)) {
    searchBarPanel.classList.add('is-expanded');
  } else {
    searchBarPanel.classList.remove('is-expanded');
  }
}

function clearSearch() {
  if (searchInput) {
    searchInput.value = '';
    searchInput.blur();
  }
  if (searchClearBtn) {
    searchClearBtn.classList.add('hidden');
  }
  state.searchKeyword = '';
  state.searchCategory = 'all';
  state.isSearchActive = false;

  if (searchBarPanel) {
    searchBarPanel.classList.remove('is-expanded');
  }

  if (searchPills) {
    searchPills.forEach((p) => p.classList.toggle('active', p.dataset.category === 'all'));
  }
  if (searchResultCount) {
    searchResultCount.classList.add('hidden');
  }

  if (state.currentTab === 'messages') {
    loadInitialMessages();
  } else {
    loadFavorites();
  }
}

function executeSearch() {
  const keyword = searchInput ? searchInput.value.trim() : '';
  state.searchKeyword = keyword;
  state.isSearchActive = hasActiveFilter();

  if (searchClearBtn) {
    searchClearBtn.classList.toggle('hidden', !state.isSearchActive);
  }
  updateSearchPanelExpansion();

  if (state.currentTab === 'messages') {
    loadInitialMessages();
  } else {
    loadFavorites();
  }
}

function handleSearchInput() {
  const keyword = searchInput ? searchInput.value.trim() : '';
  state.searchKeyword = keyword;
  state.isSearchActive = hasActiveFilter();

  if (searchClearBtn) {
    searchClearBtn.classList.toggle('hidden', !state.isSearchActive);
  }
  updateSearchPanelExpansion();

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    executeSearch();
  }, 300);
}

if (searchInput) {
  searchInput.addEventListener('focus', () => {
    if (searchBarPanel) searchBarPanel.classList.add('is-expanded');
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!hasActiveFilter() && (!searchBarPanel || !searchBarPanel.contains(document.activeElement))) {
        if (searchBarPanel) searchBarPanel.classList.remove('is-expanded');
      }
    }, 200);
  });

  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      executeSearch();
    } else if (e.key === 'Escape') {
      clearSearch();
    }
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    clearSearch();
  });
}

if (searchPills) {
  searchPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const category = pill.dataset.category || 'all';
      if (state.searchCategory === category) return;
      state.searchCategory = category;
      searchPills.forEach((p) => p.classList.toggle('active', p.dataset.category === category));
      executeSearch();
    });
  });
}

// ========== 标签页切换 ==========
function switchTab(tabName) {
  state.currentTab = tabName;
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
  if (state.isSearchActive) {
    if (tabName === 'messages') {
      loadInitialMessages();
    } else if (tabName === 'favorites') {
      loadFavorites();
    }
  } else {
    if (tabName === 'favorites') {
      renderFavorites();
      loadFavorites();
    }
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ========== 清空未收藏消息 ==========
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
    showConfirmModal(
      '确定要清空所有未收藏的消息吗？',
      async () => {
        try {
          const res = await apiClearAll();
          state.messages = state.messages.filter((m) => m.favorite);
          state.hasMoreMessages = false;
          renderMessages();
          if (state.currentTab === 'favorites') renderFavorites();

          if (window.ImageCache) {
            window.ImageCache.clearNonFavoriteThumbnails(state.userId);
            updateCacheButtonDisplay();
          }
          if (res && res.favoriteCount > 0) {
            showToast(`已清空，保留 ${res.favoriteCount} 条收藏`);
          } else {
            showToast('已清空全部消息');
          }
        } catch (err) {
          showToast(err.message || '清空失败');
        }
      },
      {
        hint: '提示：已收藏的消息和对应图片将被完整保留。'
      }
    );
  });
}

// ========== 退出登录 ==========
function logout(showMessage = true) {
  const prevUserId = state.userId;
  revokeBlobUrls(messagesList);
  if (favoritesList) revokeBlobUrls(favoritesList);

  if (window.ImageCache) {
    window.ImageCache.clearUserThumbnails(prevUserId);
    updateCacheButtonDisplay();
  }

  disconnectSocket();
  localStorage.removeItem(STORAGE_KEYS.PASSWORD);
  localStorage.removeItem(STORAGE_KEYS.USER_ID);
  localStorage.removeItem(STORAGE_KEYS.LOGIN_TIMESTAMP);

  if (expireCheckInterval) {
    clearInterval(expireCheckInterval);
    expireCheckInterval = null;
  }

  if (state.isSearchActive) {
    clearSearch();
  }

  state.isAuthenticated = false;
  state.messages = [];
  state.favorites = [];
  state.userId = null;

  if (authSection) authSection.classList.remove('hidden');
  if (chatSection) chatSection.classList.add('hidden');
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.focus();
  }
  if (currentUserEl) currentUserEl.classList.add('hidden');

  if (showMessage) showToast('已退出登录');
}

if (logoutBtn) logoutBtn.addEventListener('click', () => logout(true));

// ========== 会话有效期检测 ==========
function checkLoginExpiration() {
  const isLimited = localStorage.getItem(STORAGE_KEYS.DURATION_LIMIT) === 'true';
  const loginTimestamp = parseInt(localStorage.getItem(STORAGE_KEYS.LOGIN_TIMESTAMP), 10);
  const sessionMinutes = parseInt(localStorage.getItem(STORAGE_KEYS.SESSION_MINUTES) || '60', 10);

  if (isLimited && loginTimestamp && sessionMinutes) {
    const elapsedMinutes = (Date.now() - loginTimestamp) / (60 * 1000);
    if (elapsedMinutes >= sessionMinutes) {
      showToast('登录会话已过期，请重新登录');
      logout(false);
    }
  }
}

// ========== 应用登录与初始化流 ==========
function enterApp() {
  if (authSection) authSection.classList.add('hidden');
  if (chatSection) chatSection.classList.remove('hidden');
  state.isAuthenticated = true;

  if (state.currentMode === 'multi' && state.userId && currentUserEl) {
    currentUserEl.textContent = `👤 ${state.userId}`;
    currentUserEl.classList.remove('hidden');
  }

  connectSocket();
  loadInitialMessages();
  loadFavorites();
  updateCacheButtonDisplay();

  if (expireCheckInterval) clearInterval(expireCheckInterval);
  expireCheckInterval = setInterval(checkLoginExpiration, 30000);
}

async function handleLogin() {
  const password = passwordInput ? passwordInput.value : '';
  if (authError) authError.classList.add('hidden');

  try {
    const res = await apiLogin(password);
    if (res.success) {
      state.currentMode = res.mode || 'single';
      state.userId = res.userId || null;

      if (!res.noPassword) {
        localStorage.setItem(STORAGE_KEYS.PASSWORD, password);
        if (res.userId) {
          localStorage.setItem(STORAGE_KEYS.USER_ID, res.userId);
        }
        localStorage.setItem(STORAGE_KEYS.LOGIN_TIMESTAMP, Date.now().toString());
      }
      enterApp();
    }
  } catch (err) {
    if (authError) {
      authError.textContent = err.message || '密码错误';
      authError.classList.remove('hidden');
    }
  }
}

if (authBtn) authBtn.addEventListener('click', handleLogin);
if (passwordInput) {
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
}

// ========== Socket.IO 实时通信组装 ==========
initSocketConnection({
  onStatusChange: (statusCls, text) => {
    if (connectionStatus) {
      connectionStatus.className = `status ${statusCls}`;
      connectionStatus.textContent = text;
    }
  },
  onNewMessage: (msg) => {
    const exists = state.messages.some((m) => m.id === msg.id);
    if (!exists) {
      if (state.isSearchActive) {
        if (!matchesCurrentSearch(msg)) {
          showToast('收到新消息（不符合当前筛选条件）');
          return;
        }
        state.searchTotal = (state.searchTotal || 0) + 1;
        updateSearchResultCount();
      }
      state.messages.push(msg);
      appendSingleMessage(msg);
      showToast('收到新消息');
    }
  },
  onDeleteMessage: (id) => removeSingleMessage(id),
  onClearMessages: (data) => {
    state.messages = state.messages.filter((m) => m.favorite);
    state.hasMoreMessages = false;
    renderMessages();
    if (state.currentTab === 'favorites') renderFavorites();
    if (window.ImageCache) {
      window.ImageCache.clearNonFavoriteThumbnails(state.userId);
      updateCacheButtonDisplay();
    }
    if (data && data.favoriteCount > 0) {
      showToast(`已清空，保留 ${data.favoriteCount} 条收藏`);
    }
  },
  onFavoriteMessage: (data) => {
    updateSingleMessageFavorite(data.id, data.favorite, data.message);
  },
  onRemarkMessage: (data) => {
    updateSingleMessageRemark(data.id, data.remark);
  },
  onAuthError: () => {
    showToast('身份验证失效，请重新登录');
    logout(false);
  }
});

// 重连时自动刷新
state.on('socket:reconnect', () => {
  if (state.isAuthenticated && !state.isReconnectRefreshing) {
    state.isReconnectRefreshing = true;
    fetchMessages({ limit: PAGE_SIZE })
      .then((data) => {
        state.messages = data.messages || [];
        state.hasMoreMessages = Boolean(data.hasMore);
        renderMessages();
      })
      .catch((err) => console.error('重连刷新消息失败:', err))
      .finally(() => { state.isReconnectRefreshing = false; });
  }
});

// 处理图片处理状态指示
state.on('imageProcessingChange', (count) => {
  if (!imageProcessingState) return;
  const isProcessing = count > 0;
  imageProcessingState.classList.toggle('hidden', !isProcessing);
  imageProcessingState.textContent = isProcessing
    ? `图片处理中${count > 1 ? ` (${count})` : ''}...`
    : '';
});

// ESC 关闭所有查看器
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    imageViewerModal.close();
    textViewerModal.close();
    remarkModal.close();
    shareModal.close();
    shareListModal.close();
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && !confirmModal.classList.contains('hidden')) {
      const cancelBtn = document.getElementById('modal-cancel');
      if (cancelBtn) cancelBtn.click();
      else confirmModal.classList.add('hidden');
    }
  }
});

// ========== 初始化启动流 ==========
async function initApp() {
  // 检查版本号
  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      const versionEl = document.getElementById('version');
      if (versionEl && data.version) versionEl.textContent = `v${data.version}`;
    }
  } catch {}

  // 检查认证状态
  try {
    const authStatus = await fetchAuthStatus();
    state.currentMode = authStatus.mode || 'single';
    state.requirePassword = Boolean(authStatus.requirePassword);

    const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);

    if (!state.requirePassword) {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      enterApp();
    } else if (savedPassword) {
      state.userId = savedUserId || null;
      enterApp();
    } else {
      if (authSection) authSection.classList.remove('hidden');
      if (chatSection) chatSection.classList.add('hidden');
      if (passwordInput) passwordInput.focus();
    }
  } catch (err) {
    console.error('初始化认证失败，降级显示登录页:', err);
    if (authSection) authSection.classList.remove('hidden');
    if (chatSection) chatSection.classList.add('hidden');
  }

  // 注册 PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then((reg) => reg.update().catch(() => {}))
        .catch((err) => console.error('ServiceWorker 注册失败:', err));
    });
  }
}

// 启动应用
initApp();
