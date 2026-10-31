/**
 * 全局应用状态中枢 (响应式单例)
 */

class StateManager {
  constructor() {
    this.userId = null;
    this.displayName = '';
    this.currentMode = 'single'; // 'single' 或 'multi'
    this.isAuthenticated = false;
    this.requirePassword = true;
    this.currentTab = 'messages'; // 'messages' 或 'favorites'
    
    this.messages = [];
    this.favorites = [];
    this.hasMoreMessages = false;

    // 标签页计数（消息为服务端总数，收藏为收藏总数；均由接口 total 维护）
    this.totalMessages = 0;
    this.totalFavorites = 0;
    
    this.isInitialLoading = false;
    this.isLoadingOlder = false;
    this.isReconnectRefreshing = false;
    
    this.isUploading = false;
    this.uploadQueue = [];
    this.imageProcessingCount = 0;
    this.currentXhr = null;
    this.shouldStickToBottom = false;

    // 搜索与分类状态
    this.searchKeyword = '';
    this.searchCategory = 'all'; // 'all', 'text', 'image', 'video', 'file'
    this.isSearchActive = false; // 搜索栏是否展开/处于搜索模式
    this.searchTotal = 0;

    this.listeners = new Map();
  }

  resetSearch() {
    this.searchKeyword = '';
    this.searchCategory = 'all';
    this.isSearchActive = false;
    this.searchTotal = 0;
    this.emit('searchReset');
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (err) {
          console.error(`事件回调错误 [${event}]:`, err);
        }
      }
    }
  }

  setImageProcessing(active) {
    this.imageProcessingCount += active ? 1 : -1;
    this.imageProcessingCount = Math.max(this.imageProcessingCount, 0);
    this.emit('imageProcessingChange', this.imageProcessingCount);
  }
}

export const state = new StateManager();
