/**
 * 消息卡片 DOM 渲染组件 (文本、图片懒加载、音视频/文件)
 */

import { state } from '../state.js';
import { authFetch } from '../api.js';
import { copyTextToClipboard, copyImageToClipboard, copyOriginalImageWithFallback } from '../media/clipboard.js';

export function createMessageElement(msg, {
  isFavoritesView = false,
  searchKeyword = '',
  onOpenTextViewer,
  onOpenImageViewer,
  onOpenRemark,
  onOpenShare,
  onToggleFavorite,
  onDelete,
  onToast,
  imageObserver
} = {}) {
  const utils = window.ClipboardUtils;
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
  timeEl.textContent = utils ? utils.formatTime(msg.timestamp) : new Date(msg.timestamp).toLocaleString();
  headerEl.appendChild(timeEl);

  // 分享按钮放在头部右侧
  const shareBtn = document.createElement('button');
  shareBtn.className = 'message-share-btn';
  shareBtn.title = '分享';
  shareBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
  shareBtn.addEventListener('click', () => onOpenShare && onOpenShare(msg));
  headerEl.appendChild(shareBtn);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'message-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'message-delete-action';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', () => onDelete && onDelete(msg.id));

  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = 'btn btn-secondary message-favorite-action';
  if (msg.favorite) {
    favoriteBtn.classList.add('active');
    favoriteBtn.classList.add('favorited');
    favoriteBtn.textContent = '★ 已收藏';
    favoriteBtn.title = '取消收藏';
  } else {
    favoriteBtn.textContent = '☆ 收藏';
    favoriteBtn.title = '添加收藏';
  }
  favoriteBtn.addEventListener('click', () => onToggleFavorite && onToggleFavorite(msg.id));

  // 根据类型渲染内容主体
  if (msg.type === 'text') {
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content text';
    if (utils) {
      contentEl.innerHTML = utils.renderSmartText(msg.content, searchKeyword);
    } else {
      // utils.js 加载失败时的安全回退：纯文本渲染，绝不直接 innerHTML 消息内容
      contentEl.textContent = msg.content;
    }

    const lines = (msg.content || '').split('\n').length;
    const isLongByContent = lines > 6 || (msg.content && msg.content.length > 220);

    if (isLongByContent) {
      contentEl.classList.add('is-collapsed');
      contentEl.title = '点击查看完整内容';
      contentEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'a') return;
        if (onOpenTextViewer) onOpenTextViewer(msg);
      });
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    requestAnimationFrame(() => {
      if (contentEl.scrollHeight > 185 && !contentEl.classList.contains('is-collapsed')) {
        contentEl.classList.add('is-collapsed');
        contentEl.title = '点击查看完整内容';
        contentEl.addEventListener('click', (e) => {
          if (e.target.tagName.toLowerCase() === 'a') return;
          if (onOpenTextViewer) onOpenTextViewer(msg);
        });
        if (!actionsEl.querySelector('.message-view-action')) {
          const dynamicViewBtn = document.createElement('button');
          dynamicViewBtn.className = 'btn btn-secondary message-view-action';
          dynamicViewBtn.textContent = '查看';
          dynamicViewBtn.title = '查看完整内容';
          dynamicViewBtn.addEventListener('click', () => onOpenTextViewer && onOpenTextViewer(msg));
          actionsEl.insertBefore(dynamicViewBtn, actionsEl.firstChild);
        }
      }
    });

    if (isLongByContent) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-secondary message-view-action';
      viewBtn.textContent = '查看';
      viewBtn.title = '查看完整内容';
      viewBtn.addEventListener('click', () => onOpenTextViewer && onOpenTextViewer(msg));
      actionsEl.appendChild(viewBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copyTextToClipboard(msg.content, onToast));
    actionsEl.appendChild(copyBtn);

  } else if (msg.type === 'image') {
    const imageData = utils ? utils.getImageContent(msg.content) : msg.content;
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content image';

    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = '图片加载中...';

    const img = document.createElement('img');
    img.alt = 'image';
    img.className = 'message-image loading';
    img.dataset.src = imageData.thumbnail;
    img.dataset.messageId = msg.id;
    img.dataset.favorite = msg.favorite ? '1' : '0';
    img.loading = 'lazy';
    img.decoding = 'async';

    img.addEventListener('load', () => {
      img.classList.remove('loading');
      placeholder.classList.add('hidden');
      if (state.shouldStickToBottom) {
        const list = document.getElementById('messages-list');
        if (list) list.scrollTop = list.scrollHeight;
      }
    });

    img.addEventListener('error', () => {
      placeholder.textContent = '图片加载失败';
      img.classList.add('hidden');
    });

    img.addEventListener('click', () => onOpenImageViewer && onOpenImageViewer(msg));

    wrapper.appendChild(placeholder);
    wrapper.appendChild(img);

    if (imageObserver) {
      imageObserver.observe(img);
    } else {
      img.src = imageData.thumbnail;
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(wrapper);

    if (imageData.hasOriginal) {
      const copyThumbBtn = document.createElement('button');
      copyThumbBtn.className = 'btn btn-secondary';
      copyThumbBtn.textContent = '复制缩略图';
      copyThumbBtn.addEventListener('click', () => {
        copyImageToClipboard(imageData.thumbnail, {
          successToast: '缩略图已复制到剪贴板',
          failureToast: '复制缩略图失败'
        }, onToast);
      });

      const copyOriginalBtn = document.createElement('button');
      copyOriginalBtn.className = 'btn btn-secondary';
      copyOriginalBtn.textContent = '复制原图';
      copyOriginalBtn.addEventListener('click', () => copyOriginalImageWithFallback(msg, onToast));
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
        }, onToast);
      });
      actionsEl.appendChild(copyImageBtn);
    }

  } else if (msg.type === 'file') {
    const fileData = utils ? utils.getFileContent(msg.content) : msg.content;
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content file';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    if (utils && searchKeyword) {
      nameEl.innerHTML = utils.highlightText(fileData.name, searchKeyword);
    } else {
      nameEl.textContent = fileData.name;
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'file-meta';
    const sizeStr = utils ? utils.formatFileSize(fileData.size) : `${fileData.size} B`;
    metaEl.textContent = `${sizeStr}${fileData.mimeType ? ` · ${fileData.mimeType}` : ''}`;

    contentEl.appendChild(nameEl);
    contentEl.appendChild(metaEl);

    // 媒体与下载统一经 authFetch 携带鉴权头后转 blob，避免访问密码进入 URL
    const mediaUrl = `/api/messages/${msg.id}/file-download`;

    async function fetchAuthenticatedBlobUrl(targetUrl) {
      try {
        const response = await authFetch(targetUrl);
        if (!response.ok) throw new Error(`加载失败: ${response.status}`);
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error('媒体资源加载失败:', err);
        return null;
      }
    }

    // 如果是音频文件，内联音频播放器（小体积，渲染时即预取）
    if (fileData.mimeType && fileData.mimeType.startsWith('audio/')) {
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.className = 'message-audio';
      fetchAuthenticatedBlobUrl(mediaUrl).then((blobUrl) => {
        if (blobUrl) {
          audioEl._blobUrl = blobUrl;
          audioEl.src = blobUrl;
        } else {
          audioEl.remove();
        }
      });
      contentEl.appendChild(audioEl);
    }

    // 如果是视频文件，懒加载播放器：避免渲染列表即整段下载大视频
    if (fileData.mimeType && fileData.mimeType.startsWith('video/')) {
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-secondary';
      loadBtn.textContent = '▶ 加载视频';

      const videoEl = document.createElement('video');
      videoEl.controls = true;
      videoEl.preload = 'none';
      videoEl.className = 'message-video hidden';

      loadBtn.addEventListener('click', async () => {
        if (videoEl._blobUrl || loadBtn.disabled) return;
        loadBtn.disabled = true;
        loadBtn.textContent = '视频加载中...';
        const blobUrl = await fetchAuthenticatedBlobUrl(mediaUrl);
        if (blobUrl) {
          videoEl._blobUrl = blobUrl;
          videoEl.src = blobUrl;
          loadBtn.classList.add('hidden');
          videoEl.classList.remove('hidden');
          videoEl.play().catch(() => {});
        } else {
          loadBtn.disabled = false;
          loadBtn.textContent = '▶ 重新加载视频';
        }
      });

      contentEl.appendChild(loadBtn);
      contentEl.appendChild(videoEl);
    }

    messageEl.appendChild(headerEl);
    messageEl.appendChild(contentEl);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-secondary';
    downloadBtn.textContent = '下载文件';
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = '下载中...';
      const blobUrl = await fetchAuthenticatedBlobUrl(mediaUrl);
      downloadBtn.disabled = false;
      downloadBtn.textContent = '下载文件';
      if (!blobUrl) {
        if (onToast) onToast('下载失败，请稍后重试');
        return;
      }
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileData.name || 'file';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
    actionsEl.appendChild(downloadBtn);
  }

  // 备注按钮与备注卡片
  const remarkBtn = document.createElement('button');
  remarkBtn.className = 'btn btn-secondary message-remark-action';
  if (msg.remark) {
    remarkBtn.classList.add('has-remark');
  }
  remarkBtn.textContent = '📝 备注';
  remarkBtn.title = msg.remark ? '修改备注' : '添加备注';
  remarkBtn.addEventListener('click', () => onOpenRemark && onOpenRemark(msg));
  actionsEl.appendChild(remarkBtn);

  actionsEl.appendChild(favoriteBtn);
  actionsEl.appendChild(deleteBtn);

  const remarkBoxEl = document.createElement('div');
  remarkBoxEl.className = 'message-remark-box' + (msg.remark ? '' : ' hidden');
  remarkBoxEl.title = '点击修改备注';
  remarkBoxEl.innerHTML = `
    <span class="message-remark-label">📝 备注：</span><span class="message-remark-text"></span>
  `;
  const remarkTextEl = remarkBoxEl.querySelector('.message-remark-text');
  if (utils && searchKeyword) {
    remarkTextEl.innerHTML = utils.highlightText(msg.remark || '', searchKeyword);
  } else {
    remarkTextEl.textContent = msg.remark || '';
  }
  remarkBoxEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onOpenRemark) onOpenRemark(msg);
  });

  messageEl.appendChild(remarkBoxEl);
  messageEl.appendChild(actionsEl);

  return messageEl;
}
