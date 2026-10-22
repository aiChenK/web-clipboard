/**
 * API 网络请求模块 (封装鉴权与通信)
 */

import { STORAGE_KEYS } from './config.js';
import { state } from './state.js';

// 统一的带凭证 Fetch 包装器
export async function authFetch(url, options = {}) {
  const headers = { ...options.headers };
  const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
  const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);

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

// 检查服务端认证配置与模式
export async function fetchAuthStatus() {
  const response = await fetch('/api/auth/status');
  if (!response.ok) {
    throw new Error('获取认证状态失败');
  }
  return response.json();
}

// 登录验证
export async function login(password) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '登录失败');
  }
  return data;
}

// 分页获取消息列表（支持关键词搜索与分类筛选）
export async function fetchMessages({ before, limit, keyword, category } = {}) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', limit);
  if (keyword) params.set('keyword', keyword);
  if (category && category !== 'all') params.set('category', category);
  if (state.currentMode === 'multi' && state.userId) {
    params.set('userId', state.userId);
  }

  const response = await authFetch(`/api/messages?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`获取消息列表失败: ${response.status}`);
  }
  return response.json();
}

// 获取收藏列表（支持关键词搜索与分类筛选）
export async function fetchFavorites({ keyword, category } = {}) {
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (category && category !== 'all') params.set('category', category);
  if (state.currentMode === 'multi' && state.userId) {
    params.set('userId', state.userId);
  }

  const response = await authFetch(`/api/favorites?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`获取收藏列表失败: ${response.status}`);
  }
  return response.json();
}

// 发送纯文本消息
export async function sendTextMessage({ content, remark }) {
  const body = { type: 'text', content, remark };
  if (state.currentMode === 'multi' && state.userId) {
    body.userId = state.userId;
  }

  const response = await authFetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '发送文本消息失败');
  }
  return data;
}

// 上传媒体/文件 (基于 XHR 支持进度展示与中途取消)
export function uploadMediaWithProgress({ formData, onProgress, onAbortRef }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onAbortRef) onAbortRef(xhr);

    xhr.open('POST', '/api/messages/upload');

    const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
    const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (savedPassword) {
      xhr.setRequestHeader('x-access-password', savedPassword);
    }
    if (savedUserId) {
      xhr.setRequestHeader('x-user-id', savedUserId);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      };
    }

    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = { error: '解析响应失败' };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || `上传失败: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new Error('上传已取消'));

    xhr.send(formData);
  });
}

// 获取原图流式二进制 (返回 Blob)
export async function fetchOriginalImageBlob(id, signal) {
  const params = new URLSearchParams();
  if (state.currentMode === 'multi' && state.userId) {
    params.set('userId', state.userId);
  }

  const response = await authFetch(`/api/messages/${id}/image-original?${params.toString()}`, {
    method: 'GET',
    signal
  });
  if (!response.ok) {
    throw new Error(`获取原图失败: ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error('无效的原图数据');
  }
  return blob;
}

// 切换收藏状态
export async function toggleFavorite(id, isFavorite = true) {
  const params = new URLSearchParams();
  if (state.currentMode === 'multi' && state.userId) {
    params.set('userId', state.userId);
  }

  const method = isFavorite ? 'POST' : 'DELETE';
  const response = await authFetch(`/api/messages/${id}/favorite?${params.toString()}`, {
    method
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '切换收藏状态失败');
  }
  return data;
}

// 更新消息备注
export async function updateRemark(id, remark) {
  const body = { remark };
  if (state.currentMode === 'multi' && state.userId) {
    body.userId = state.userId;
  }

  const response = await authFetch(`/api/messages/${id}/remark`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '更新备注失败');
  }
  return data;
}

// 删除消息
export async function deleteMessage(id) {
  const params = new URLSearchParams();
  if (state.currentMode === 'multi' && state.userId) {
    params.set('userId', state.userId);
  }

  const response = await authFetch(`/api/messages/${id}?${params.toString()}`, {
    method: 'DELETE'
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '删除消息失败');
  }
  return data;
}

// 清空未收藏消息
export async function clearAllMessages() {
  const body = {};
  if (state.currentMode === 'multi' && state.userId) {
    body.userId = state.userId;
  }

  const response = await authFetch('/api/messages/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '清空消息失败');
  }
  return data;
}

// 创建分享链接
export async function createShare(params) {
  const response = await authFetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '创建分享失败');
  }
  return data;
}

// 获取分享最大有效期配置
export async function fetchShareConfig() {
  const response = await fetch('/api/share/config');
  if (!response.ok) {
    throw new Error('获取分享配置失败');
  }
  return response.json();
}
