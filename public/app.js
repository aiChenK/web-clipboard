/**
 * Web Clipboard 前端主入口模块 (ES Module 架构胶水层)
 */

import {
  TOP_LOAD_THRESHOLD,
  LARGE_IMAGE_THRESHOLD_BYTES,
  STORAGE_KEYS
} from './js/config.js';

import { state } from './js/state.js';
import { getClientId } from './js/client.js';

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

import { GroupControls } from './js/components/groups.js';

// ========== DOM 元素引用 ==========
const authSection = document.getElementById('auth-section');
const chatSection = document.getElementById('chat-section');
const authTitle = document.getElementById('auth-title');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');
const messagesList = document.getElementById('messages-list');
const olderMessagesControl = document.getElementById('older-messages-control');
const loadOlderMessagesBtn = document.getElementById('load-older-messages');
const favoritesList = document.getElementById('favorites-list');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text');
const pasteTextBtn = document.getElementById('paste-text');
const imageInput = document.getElementById('image-input');
const fileInput = document.getElementById('file-input');
const clearAllBtn = document.getElementById('clear-all');
const logoutBtn = document.getElementById('logout-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const currentUserEl = document.getElementById('current-user');
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const uploadLimitInfo = document.getElementById('upload-limit-info');
const toastEl = document.getElementById('toast');
const imageProcessingState = document.getElementById('image-processing-state');
const tabs = document.querySelectorAll('.tab[data-tab]');
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
  onToast: showToast,
  onCreationDisabledChange: (disabled) => chatSection.classList.toggle('share-creation-disabled', disabled)
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
    // 降级为无凭证 URL：仅免密模式可命中；带密码模式下原生 img 无法携带鉴权头，
    // 凭证不再进入 URL（避免泄漏到浏览器历史与访问日志），交由 error 事件提示
    img.src = url;
  }
}

// 释放容器中未被销毁的 ObjectURL 避免内存泄露（覆盖 img / audio / video 的懒加载 blob）
function revokeBlobUrls(container) {
  if (!container) return;
  const media = container.querySelectorAll('img, audio, video');
  media.forEach((el) => {
    if (el._blobUrl) {
      URL.revokeObjectURL(el._blobUrl);
      el._blobUrl = null;
    }
  });
}

// ========== 消息列表渲染与 DOM 更新 ==========
function updateTabCounts() {
  groupControls.updateCounts();
}

function updateMessageCount() {
  if (messageCount) {
    if (state.isSearchActive) {
      const list = state.currentTab === 'favorites' ? state.favorites : state.messages;
      messageCount.textContent = `筛选结果: ${list.length}/${state.searchTotal} 条`;
    } else {
      // 分页只加载了最近一页，状态栏与标签页计数都用服务端总数，避免显示「已加载条数」
      messageCount.textContent = state.currentTab === 'favorites' ? `${state.totalFavorites} 条收藏` : `${state.totalMessages} 条消息`;
    }
  }
  if (clearAllBtn) {
    // 清空只作用于未收藏消息，用服务端总数计算，避免分页只加载一页时误判；
    // 未收藏数为 0 时禁用，杜绝「点了没反应」的空点击
    const favoriteTotal = state.totalFavorites || 0;
    const clearableCount = Math.max(0, (state.totalMessages || 0) - favoriteTotal);
    clearAllBtn.disabled = state.isInitialLoading || clearableCount === 0;
    clearAllBtn.title =
      clearableCount > 0
        ? `将删除 ${clearableCount} 条未收藏消息，保留 ${favoriteTotal} 条收藏`
        : '没有可清空的未收藏消息';
  }
  updateTabCounts();
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
  renderOlderMessagesControl();
  groupControls.closeMoveMenu();
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
      onMoveGroup: (m, button, focus) => groupControls.openMoveMenu(m, button, focus),
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
    onMoveGroup: (m, button, focus) => groupControls.openMoveMenu(m, button, focus),
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

  // 删除会同时经本端调用与 socket 广播到达，第二次已无此消息，据此保证计数只减一次
  const removedMsg = state.messages.find((m) => m.id === id) || state.favorites.find((f) => f.id === id);
  const wasFavorite = removedMsg
    ? Boolean(removedMsg.favorite) || Boolean(state.favorites.find((f) => f.id === id))
    : false;

  state.messages = state.messages.filter((m) => m.id !== id);
  state.favorites = state.favorites.filter((m) => m.id !== id);

  if (removedMsg) {
    state.totalMessages = Math.max(state.totalMessages - 1, 0);
    if (wasFavorite) state.totalFavorites = Math.max(state.totalFavorites - 1, 0);
  }

  if (state.currentTab === 'favorites') {
    renderFavorites();
  }
  updateMessageCount();

  if (state.messages.length === 0) {
    renderEmptyState();
    renderOlderMessagesControl();
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
  // 先记录变更前的收藏状态，用于幂等地维护收藏总数（本端操作与 socket 广播都会走到这里）
  const wasFavorite = msg
    ? Boolean(msg.favorite)
    : Boolean(state.favorites.find((f) => f.id === id));
  if (msg) msg.favorite = favorite;
  if (wasFavorite !== Boolean(favorite)) {
    state.totalFavorites = Math.max(state.totalFavorites + (favorite ? 1 : -1), 0);
    updateTabCounts();
  }

  // 3. 同步维护 state.favorites 列表
  if (favorite) {
    const favMsg = updatedMessage || msg || state.favorites.find((f) => f.id === id);
    if (favMsg && matchesCurrentSearch(favMsg)) {
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
  groupControls.closeMoveMenu();
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
      onMoveGroup: (m, button, focus) => groupControls.openMoveMenu(m, button, focus),
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
  const viewKey = getViewKey();
  try {
    const data = await fetchFavorites({
      keyword: state.searchKeyword,
      category: state.searchCategory,
      groupId: state.currentGroup
    });
    if (!state.isAuthenticated || viewKey !== getViewKey()) return;
    state.favorites = data.messages || [];
    state.totalFavorites = data.totalFavorites;
    state.counts = data.counts;
    if (state.currentTab === 'favorites') state.searchTotal = Number.isFinite(data.total) ? data.total : (data.messages ? data.messages.length : 0);
    updateMessageCount();
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
    await loadFavorites();
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
    await refreshGroupView({ scrollBottom: false, preserveHistory: true });
    showToast('已删除消息');
  } catch (error) {
    showToast(error.message || '删除消息失败');
  }
}

const groupControls = new GroupControls({
  onChange: () => switchTab(state.currentTab, state.currentGroup),
  onToast: showToast,
  onConfirm: showConfirmModal
});

function getViewKey() {
  return JSON.stringify([state.userId, state.currentGroup, state.searchKeyword, state.searchCategory]);
}

async function refreshGroupView({ scrollBottom = true, preserveHistory = false } = {}) {
  if (!state.isAuthenticated) return;
  await Promise.all([loadInitialMessages({ scrollBottom, preserveHistory }), loadFavorites()]);
}

async function receiveMessage(message) {
  if (!state.messages.some((item) => item.id === message.id) && matchesCurrentSearch(message)) {
    state.messages.push(message);
    if (state.currentTab === 'messages') state.searchTotal += 1;
    appendSingleMessage(message);
    updateSearchResultCount();
  }
  const viewKey = getViewKey();
  try {
    const data = await fetchMessages({ limit: 1, groupId: state.currentGroup });
    if (!state.isAuthenticated || viewKey !== getViewKey()) return;
    state.totalMessages = data.totalMessages;
    state.totalFavorites = data.totalFavorites;
    state.counts = data.counts;
    updateMessageCount();
  } catch (error) {
    console.error('刷新消息计数失败:', error);
  }
}

function applyClearedMessages(data) {
  const removedIds = new Set(data.ids);
  state.messages = state.messages.filter((message) => !removedIds.has(message.id));
  if (window.ImageCache) {
    for (const id of removedIds) window.ImageCache.deleteThumbnail(state.userId, id);
    updateCacheButtonDisplay();
  }
}

// ========== 数据加载与分页 ==========
async function loadInitialMessages({ scrollBottom = true, preserveHistory = false } = {}) {
  const viewKey = getViewKey();
  state.isInitialLoading = true;
  renderMessages();

  try {
    const data = await fetchMessages({
      keyword: state.searchKeyword,
      category: state.searchCategory,
      groupId: state.currentGroup
    });
    if (!state.isAuthenticated || viewKey !== getViewKey()) return;
    const page = data.messages || [];
    if (preserveHistory) {
      const messages = new Map(state.messages.filter(matchesCurrentSearch).map((message) => [message.id, message]));
      for (const message of page) messages.set(message.id, message);
      state.messages = [...messages.values()].sort((a, b) => a.timestamp - b.timestamp);
    } else {
      state.messages = page;
    }
    state.totalMessages = data.totalMessages;
    state.totalFavorites = data.totalFavorites;
    state.counts = data.counts;
    if (!preserveHistory || !state.messagePageCursor) {
      state.hasMoreMessages = Boolean(data.hasMore);
      state.messagePageCursor = page[0] || null;
    }
    if (state.currentTab === 'messages') state.searchTotal = data.total;
    updateSearchResultCount();

    renderUploadLimit(data.uploadMaxFileSizeMiB);
    if (data.expireHours && expireInfo) {
      expireInfo.textContent = data.expireHours % 24 === 0
        ? `消息将在 ${data.expireHours / 24} 天后过期`
        : `消息将在 ${data.expireHours} 小时后过期`;
    }
  } catch (error) {
    console.error('加载消息失败:', error);
    showToast('加载消息失败');
  } finally {
    if (viewKey === getViewKey()) {
      state.isInitialLoading = false;
      renderMessages({ scrollBottom });
    }
  }
}

function renderOlderMessagesControl() {
  if (!loadOlderMessagesBtn) return;
  olderMessagesControl.classList.toggle('hidden', !state.hasMoreMessages || !state.messagePageCursor || !state.messages.length);
  loadOlderMessagesBtn.disabled = state.isInitialLoading || state.isLoadingOlder;
  loadOlderMessagesBtn.textContent = state.isLoadingOlder ? '正在加载更早消息…' : '加载更早消息';
}

async function loadOlderMessages() {
  const cursor = state.messagePageCursor;
  if (state.isInitialLoading || state.isLoadingOlder || !state.hasMoreMessages || !cursor) return;
  state.isLoadingOlder = true;
  renderOlderMessagesControl();

  const viewKey = getViewKey();
  const prevScrollHeight = messagesList.scrollHeight;
  const prevScrollTop = messagesList.scrollTop;

  try {
    const data = await fetchMessages({
      before: cursor.timestamp,
      beforeId: cursor.id,
      keyword: state.searchKeyword,
      category: state.searchCategory,
      groupId: state.currentGroup
    });
    if (!state.isAuthenticated || viewKey !== getViewKey()) return;
    const existingIds = new Set(state.messages.map((message) => message.id));
    const page = data.messages || [];
    const olderMessages = page.filter((message) => !existingIds.has(message.id));
    state.hasMoreMessages = Boolean(data.hasMore);
    state.messagePageCursor = page[0] || null;

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
          onMoveGroup: (m, button, focus) => groupControls.openMoveMenu(m, button, focus),
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
    renderOlderMessagesControl();
  }
}

loadOlderMessagesBtn?.addEventListener('click', loadOlderMessages);

if (messagesList) {
  messagesList.addEventListener('scroll', () => {
    if (messagesList.scrollTop <= TOP_LOAD_THRESHOLD && messagesList.scrollHeight > messagesList.clientHeight) {
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
function renderUploadLimit(maxSizeMiB) {
  if (uploadLimitInfo && maxSizeMiB) {
    uploadLimitInfo.textContent = ` · 单个文件上限 ${maxSizeMiB} MiB`;
  }
}

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
    formData.append('groupId', item.groupId || '');
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

    if (res.message) await receiveMessage(res.message);
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
  const groupId = state.currentGroup === 'all' ? null : state.currentGroup;
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
      remark: '',
      groupId
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
      remark: '',
      groupId
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
    const res = await sendTextMessage({ content, remark: '', groupId: state.currentGroup === 'all' ? null : state.currentGroup });
    textInput.value = '';
    textInput.style.height = 'auto';

    if (res.message) await receiveMessage(res.message);
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

// 注意：本函数与服务端 src/storage.js 的 isVideoMessage/matchesKeyword 存在等价实现，修改时需同步
function matchesCurrentSearch(msg) {
  if (state.currentGroup !== 'all' && msg.groupId !== state.currentGroup) return false;
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
function switchTab(tabName, groupId = 'all') {
  state.currentTab = tabName;
  state.currentGroup = groupId;
  groupControls.render();
  document.querySelector('.tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
  return refreshGroupView();
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ========== 清空未收藏消息 ==========
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
    const groupId = state.currentGroup;
    const scope = groupId === 'all' ? '所有消息' : state.groups.find((group) => group.id === groupId).name;
    const favoriteTotal = state.totalFavorites;
    const clearableCount = Math.max(0, state.totalMessages - favoriteTotal);
    showConfirmModal(
      `确定清空「${scope}」的未收藏消息？\n将删除 ${clearableCount} 条消息，保留 ${favoriteTotal} 条收藏。搜索和类型筛选不影响清空范围。`,
      async () => {
        try {
          const res = await apiClearAll(groupId);
          applyClearedMessages(res);
          await refreshGroupView();
          showToast(`已清空 ${res.ids.length} 条未收藏消息`);
        } catch (err) {
          showToast(err.message || '清空失败');
        }
      },
      {
        hint: '关联的图片、文件与已创建的分享链接会一并删除，此操作不可撤销。'
      }
    );
  });
}

// ========== 退出登录 ==========
function clearStoredCredentials() {
  localStorage.removeItem(STORAGE_KEYS.PASSWORD);
  localStorage.removeItem(STORAGE_KEYS.USER_ID);
  localStorage.removeItem(STORAGE_KEYS.LOGIN_TIMESTAMP);
}

// 结束首屏引导态：认证结果已知，交给登录区或主界面自行渲染
function endBootState() {
  document.documentElement.removeAttribute('data-boot');
}

// 渲染登录表单：多用户模式展示用户名 + 密码，单用户模式仅密码
function showAuthForm() {
  endBootState();
  const isMulti = state.currentMode === 'multi';

  if (authTitle) {
    authTitle.textContent = isMulti ? '请输入用户名与密码' : '请输入访问密码';
  }

  if (usernameInput) {
    usernameInput.classList.toggle('hidden', !isMulti);
    if (isMulti) {
      usernameInput.value = localStorage.getItem(STORAGE_KEYS.USER_ID) || '';
    }
  }

  if (authError) authError.classList.add('hidden');
  if (authSection) authSection.classList.remove('hidden');
  if (chatSection) chatSection.classList.add('hidden');
  if (passwordInput) passwordInput.value = '';

  const focusEl = isMulti ? usernameInput : passwordInput;
  if (focusEl) focusEl.focus();
}

function logout(showMessage = true) {
  const prevUserId = state.userId;
  revokeBlobUrls(messagesList);
  if (favoritesList) revokeBlobUrls(favoritesList);

  if (window.ImageCache) {
    window.ImageCache.clearUserThumbnails(prevUserId);
    updateCacheButtonDisplay();
  }

  disconnectSocket();
  clearStoredCredentials();

  if (expireCheckInterval) {
    clearInterval(expireCheckInterval);
    expireCheckInterval = null;
  }

  if (state.isSearchActive) {
    clearSearch();
  }

  state.isAuthenticated = false;
  state.messages = [];
  state.hasMoreMessages = false;
  state.messagePageCursor = null;
  state.favorites = [];
  state.groups = [];
  state.currentGroup = 'all';
  groupControls.close();
  groupControls.render();
  state.totalMessages = 0;
  state.totalFavorites = 0;
  state.counts = { messages: 0, favorites: 0, groups: {} };
  updateTabCounts();
  state.userId = null;
  state.displayName = '';

  if (currentUserEl) currentUserEl.classList.add('hidden');
  showAuthForm();

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
  endBootState();
  if (authSection) authSection.classList.add('hidden');
  if (chatSection) chatSection.classList.remove('hidden');
  state.isAuthenticated = true;

  if (state.currentMode === 'multi' && state.userId && currentUserEl) {
    currentUserEl.textContent = `👤 ${state.displayName || state.userId}`;
    currentUserEl.classList.remove('hidden');
  }

  connectSocket();
  shareModal.refreshConfig();
  groupControls.load().then(() => refreshGroupView());
  updateCacheButtonDisplay();

  if (expireCheckInterval) clearInterval(expireCheckInterval);
  expireCheckInterval = setInterval(checkLoginExpiration, 30000);
}

async function handleLogin() {
  const password = passwordInput ? passwordInput.value : '';
  const isMulti = state.currentMode === 'multi';
  const username = isMulti && usernameInput ? usernameInput.value.trim().toLowerCase() : '';

  if (authError) authError.classList.add('hidden');

  if (isMulti && !username) {
    if (authError) {
      authError.textContent = '请输入用户名';
      authError.classList.remove('hidden');
    }
    if (usernameInput) usernameInput.focus();
    return;
  }

  try {
    const res = await apiLogin(username, password);
    if (res.success) {
      state.currentMode = res.mode || 'single';
      state.userId = res.userId || null;
      state.displayName = res.displayName || '';

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
      authError.textContent = err.message || '用户名或密码错误';
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
if (usernameInput) {
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && passwordInput) passwordInput.focus();
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
    if (msg.sourceClientId !== getClientId()) {
      showToast(matchesCurrentSearch(msg) ? '收到新消息' : '收到新消息（不符合当前筛选条件）');
    }
    receiveMessage(msg);
  },
  onDeleteMessage: (id) => {
    removeSingleMessage(id);
    refreshGroupView({ scrollBottom: false, preserveHistory: true });
  },
  onClearMessages: (data) => {
    applyClearedMessages(data);
    refreshGroupView({ scrollBottom: false, preserveHistory: true });
  },
  onFavoriteMessage: (data) => {
    updateSingleMessageFavorite(data.id, data.favorite, data.message);
    loadFavorites();
  },
  onRemarkMessage: (data) => {
    updateSingleMessageRemark(data.id, data.remark);
    if (hasActiveFilter()) refreshGroupView({ scrollBottom: false, preserveHistory: true });
  },
  onGroupsUpdated: (data) => {
    groupControls.apply(data.groups, data.counts);
    const groupIds = new Set(data.groups.map((group) => group.id));
    for (const message of [...state.messages, ...state.favorites]) {
      if (!groupIds.has(message.groupId)) message.groupId = null;
    }
    refreshGroupView({ scrollBottom: false, preserveHistory: true });
  },
  onMessageGroup: (message) => {
    state.messages = state.messages.map((item) => item.id === message.id ? message : item).filter(matchesCurrentSearch);
    refreshGroupView({ scrollBottom: false, preserveHistory: true });
  },
  onUploadLimit: renderUploadLimit,
  onShareConfig: (config) => shareModal.applyConfig(config),
  onAuthError: () => {
    showToast('身份验证失效，请重新登录');
    logout(false);
  }
});

// 重连时自动刷新
state.on('socket:reconnect', () => {
  if (state.isAuthenticated && !state.isReconnectRefreshing) {
    state.isReconnectRefreshing = true;
    groupControls.load()
      .then(() => refreshGroupView({ scrollBottom: false }))
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
    groupControls.close();
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
  // 版本号与认证状态互不依赖，版本号不阻塞首屏判定（串行只会推后登录页/主界面的展示）
  fetch('/api/version')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const versionEl = document.getElementById('version');
      if (data && data.version && versionEl) versionEl.textContent = `v${data.version}`;
    })
    .catch(() => { });

  // 检查认证状态
  try {
    const authStatus = await fetchAuthStatus();
    state.currentMode = authStatus.mode || 'single';
    state.requirePassword = Boolean(authStatus.requirePassword);

    const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    const isMulti = state.currentMode === 'multi';
    // 多用户模式必须同时具备用户名与密码，缺一即视为残留凭证
    const hasCompleteCredential = Boolean(savedPassword) && (!isMulti || Boolean(savedUserId));

    if (!state.requirePassword) {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      enterApp();
    } else if (hasCompleteCredential) {
      // 进入前静默校验一次，避免带着失效凭证进主界面后每个请求都 401
      try {
        const verified = await apiLogin(isMulti ? savedUserId : '', savedPassword);
        state.currentMode = verified.mode || state.currentMode;
        state.userId = verified.userId || null;
        state.displayName = verified.displayName || '';
        enterApp();
      } catch (verifyError) {
        if (verifyError.status === 429) {
          // 限流只说明请求太频繁，不代表凭证失效，按本地凭证进入即可，
          // 否则用户一分钟内刷新几次就会被踢回登录页并清掉凭证。
          console.warn('静默校验被限流，按本地凭证直接进入');
          state.userId = isMulti ? savedUserId : null;
          enterApp();
        } else {
          console.warn('本地凭证已失效，返回登录页:', verifyError.message);
          clearStoredCredentials();
          showAuthForm();
        }
      }
    } else {
      if (savedPassword || savedUserId) clearStoredCredentials();
      showAuthForm();
    }
  } catch (err) {
    console.error('初始化认证失败，降级显示登录页:', err);
    showAuthForm();
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
