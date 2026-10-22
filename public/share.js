const shareLoading = document.getElementById('share-loading');
const shareError = document.getElementById('share-error');
const shareErrorMessage = document.getElementById('share-error-message');
const sharePasswordSection = document.getElementById('share-password-section');
const sharePasswordInput = document.getElementById('share-password-input');
const sharePasswordSubmit = document.getElementById('share-password-submit');
const sharePasswordError = document.getElementById('share-password-error');
const shareContent = document.getElementById('share-content');
const shareTime = document.getElementById('share-time');
const shareViews = document.getElementById('share-views');
const shareMessage = document.getElementById('share-message');
const shareDeletedNotice = document.getElementById('share-deleted-notice');
const shareRemark = document.getElementById('share-remark');
const shareRemarkText = document.getElementById('share-remark-text');
const toastEl = document.getElementById('toast');

let shareId = null;
let verifiedPassword = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3000);
}

// 工具函数（formatTime, formatFileSize, getImageContent, escapeHTML, renderSmartText, getFileContent 等已由 utils.js 统一提供）

function renderMessage(msg) {
  shareMessage.innerHTML = '';

  if (msg.remark && shareRemark && shareRemarkText) {
    shareRemarkText.textContent = msg.remark;
    shareRemark.classList.remove('hidden');
  } else if (shareRemark) {
    shareRemark.classList.add('hidden');
  }

  if (msg.type === 'text') {
    const textEl = document.createElement('div');
    textEl.className = 'share-text-content';
    textEl.innerHTML = renderSmartText(msg.content);

    const lines = (msg.content || '').split('\n').length;
    const isLongByContent = lines > 8 || (msg.content && msg.content.length > 300);

    if (isLongByContent) {
      textEl.classList.add('is-collapsed');
      textEl.title = '点击查看完整内容';
      textEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'a') return;
        openTextViewer(msg);
      });
    }

    shareMessage.appendChild(textEl);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'share-actions-row';

    if (isLongByContent) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-secondary';
      viewBtn.textContent = '查看全文';
      viewBtn.addEventListener('click', () => openTextViewer(msg));
      actionsRow.appendChild(viewBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = isLongByContent ? 'btn btn-primary' : 'btn btn-primary share-action-btn';
    copyBtn.textContent = '复制文本';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        showToast('已复制到剪贴板');
      } catch {
        showToast('复制失败');
      }
    });

    if (isLongByContent) {
      actionsRow.appendChild(copyBtn);
      shareMessage.appendChild(actionsRow);
    } else {
      shareMessage.appendChild(copyBtn);
    }
  } else if (msg.type === 'image') {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'share-image-container';

    const pwdParam = verifiedPassword ? `?password=${encodeURIComponent(verifiedPassword)}` : '';
    const shareImageUrl = `/api/share/${shareId}/image${pwdParam}`;

    const img = document.createElement('img');
    img.className = 'share-image';
    img.src = shareImageUrl;
    img.alt = '分享图片';

    img.addEventListener('click', () => {
      openImageViewer({ thumbnail: shareImageUrl });
    });

    imgContainer.appendChild(img);
    shareMessage.appendChild(imgContainer);

    const hint = document.createElement('p');
    hint.className = 'share-image-hint';
    hint.textContent = '点击图片查看大图';
    shareMessage.appendChild(hint);
  } else if (msg.type === 'file') {
    const fileData = getFileContent(msg.content);
    const fileEl = document.createElement('div');
    fileEl.className = 'share-file-content';

    const fileName = document.createElement('div');
    fileName.className = 'share-file-name';
    fileName.textContent = fileData.name;

    const fileMeta = document.createElement('div');
    fileMeta.className = 'share-file-meta';
    fileMeta.textContent = `${formatFileSize(fileData.size)}${fileData.mimeType ? ` · ${fileData.mimeType}` : ''}`;

    fileEl.appendChild(fileName);
    fileEl.appendChild(fileMeta);
    shareMessage.appendChild(fileEl);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-primary share-action-btn';
    downloadBtn.textContent = '下载文件';
    downloadBtn.addEventListener('click', () => {
      const pwdParam = verifiedPassword ? `?password=${encodeURIComponent(verifiedPassword)}` : '';
      window.open(`/api/share/${shareId}/file${pwdParam}`, '_blank', 'noopener');
    });
    shareMessage.appendChild(downloadBtn);
  }
}

function showError(message) {
  shareLoading.classList.add('hidden');
  sharePasswordSection.classList.add('hidden');
  shareContent.classList.add('hidden');
  shareErrorMessage.textContent = message;
  shareError.classList.remove('hidden');
}

async function loadShare() {
  const pathParts = window.location.pathname.split('/');
  shareId = pathParts[pathParts.length - 1];

  if (!shareId) {
    showError('分享链接无效');
    return;
  }

  try {
    const response = await fetch(`/api/share/${shareId}`);
    const data = await response.json();

    if (!response.ok) {
      showError(data.error || '分享不存在或已过期');
      return;
    }

    // 需要密码
    if (data.hasPassword) {
      shareLoading.classList.add('hidden');
      sharePasswordSection.classList.remove('hidden');
      sharePasswordInput.focus();
      return;
    }

    // 无需密码，直接加载内容
    await loadShareContent();
  } catch (error) {
    console.error(error);
    showError('加载分享失败');
  }
}

async function loadShareContent() {
  try {
    // 构建请求 URL，如果有密码则在查询参数中传递
    let url = `/api/share/${shareId}/content`;
    if (verifiedPassword) {
      url += `?password=${encodeURIComponent(verifiedPassword)}`;
    }

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || '获取分享内容失败');
      return;
    }

    shareLoading.classList.add('hidden');
    sharePasswordSection.classList.add('hidden');

    // 显示元信息
    const expiresDate = new Date(data.share.expiresAt);
    shareTime.textContent = `过期时间: ${expiresDate.toLocaleString('zh-CN')}`;
    shareViews.textContent = `访问次数: ${data.share.viewCount}`;

    // 原消息已删除
    if (data.deleted || !data.message) {
      shareContent.classList.remove('hidden');
      shareDeletedNotice.classList.remove('hidden');
      return;
    }

    // 渲染消息
    shareContent.classList.remove('hidden');
    renderMessage(data.message);
  } catch (error) {
    console.error(error);
    showError('获取分享内容失败');
  }
}

async function verifyPassword() {
  const password = sharePasswordInput.value.trim();
  if (!password) {
    showToast('请输入密码');
    return;
  }

  try {
    sharePasswordSubmit.disabled = true;
    sharePasswordSubmit.textContent = '验证中...';

    const response = await fetch(`/api/share/${shareId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (!response.ok) {
      sharePasswordError.textContent = data.error || '密码错误';
      sharePasswordError.classList.remove('hidden');
      sharePasswordInput.value = '';
      sharePasswordInput.focus();
      return;
    }

    verifiedPassword = password;
    sharePasswordError.classList.add('hidden');
    await loadShareContent();
  } catch (error) {
    console.error(error);
    showToast('验证失败');
  } finally {
    sharePasswordSubmit.disabled = false;
    sharePasswordSubmit.textContent = '确认';
  }
}

sharePasswordSubmit.addEventListener('click', verifyPassword);
sharePasswordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    verifyPassword();
  }
});

// 初始化
loadShare();

// ========== 图片查看器 ==========
const imageViewer = document.getElementById('image-viewer');
const imageViewerImg = document.getElementById('image-viewer-img');
const imageViewerOriginalBtn = document.getElementById('image-viewer-original');
const imageViewerCopyBtn = document.getElementById('image-viewer-copy');
const imageViewerBackdrop = imageViewer.querySelector('.image-viewer-backdrop');
const imageViewerCloseBtn = imageViewer.querySelector('.image-viewer-close');

let currentViewerImageData = null;
let isViewingOriginal = false;

function openImageViewer(imageData) {
  currentViewerImageData = imageData;
  isViewingOriginal = false;

  // 显示缩略图
  imageViewerImg.src = imageData.thumbnail;

  // 分享页面通常只有缩略图，不显示原图按钮
  imageViewerOriginalBtn.classList.add('hidden');

  imageViewer.classList.remove('hidden');
}

function closeImageViewer() {
  imageViewer.classList.add('hidden');
  imageViewerImg.src = '';
  currentViewerImageData = null;
  isViewingOriginal = false;
}

// dataURLtoBlobSync 已由 utils.js 统一提供

function convertImageSourceToPngBlob(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function writePngToClipboard(blobOrPromise) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
    throw new Error('浏览器不支持剪贴板图片写入');
  }

  try {
    const item = new ClipboardItem({ 'image/png': blobOrPromise });
    await navigator.clipboard.write([item]);
    return true;
  } catch (firstErr) {
    if (blobOrPromise instanceof Promise) {
      const resolvedBlob = await blobOrPromise;
      const item = new ClipboardItem({ 'image/png': resolvedBlob });
      await navigator.clipboard.write([item]);
      return true;
    }
    throw firstErr;
  }
}

async function copyViewerImage() {
  const src = imageViewerImg.src;
  if (!src) {
    showToast('没有可复制的图片');
    return;
  }

  try {
    if (typeof src === 'string' && src.startsWith('data:image/png;base64,')) {
      const syncBlob = dataURLtoBlobSync(src);
      if (syncBlob) {
        await writePngToClipboard(syncBlob);
        showToast('图片已复制到剪贴板');
        return;
      }
    }

    const blobPromise = (async () => {
      return await convertImageSourceToPngBlob(src);
    })();

    await writePngToClipboard(blobPromise);
    showToast('图片已复制到剪贴板');
  } catch (error) {
    console.error('复制图片失败:', error);
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
      showToast('浏览器不支持复制图片');
    } else {
      showToast('复制图片失败');
    }
  }
}

imageViewerBackdrop.addEventListener('click', closeImageViewer);
imageViewerCloseBtn.addEventListener('click', closeImageViewer);
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
    textViewerMeta.textContent = `${lines} 行 · ${chars} 字`;
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
  try {
    await navigator.clipboard.writeText(currentViewerTextMsg.content);
    showToast('已复制到剪贴板');
  } catch {
    showToast('复制失败');
  }
}

if (textViewerBackdrop) textViewerBackdrop.addEventListener('click', closeTextViewer);
if (textViewerClose) textViewerClose.addEventListener('click', closeTextViewer);
if (textViewerCloseBtn) textViewerCloseBtn.addEventListener('click', closeTextViewer);
if (textViewerCopyBtn) textViewerCopyBtn.addEventListener('click', copyViewerText);