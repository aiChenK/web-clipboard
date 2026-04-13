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

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

function renderMessage(msg) {
  shareMessage.innerHTML = '';

  if (msg.type === 'text') {
    const textEl = document.createElement('div');
    textEl.className = 'share-text-content';
    textEl.textContent = msg.content;
    shareMessage.appendChild(textEl);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary share-action-btn';
    copyBtn.textContent = '复制文本';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        showToast('已复制到剪贴板');
      } catch {
        showToast('复制失败');
      }
    });
    shareMessage.appendChild(copyBtn);
  } else if (msg.type === 'image') {
    const imageData = getImageContent(msg.content);
    const imgContainer = document.createElement('div');
    imgContainer.className = 'share-image-container';

    const img = document.createElement('img');
    img.className = 'share-image';
    img.src = imageData.thumbnail;
    img.alt = '分享图片';

    img.addEventListener('click', () => {
      openImageViewer(imageData);
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
      window.open(fileData.url, '_blank', 'noopener');
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

async function copyViewerImage() {
  const src = imageViewerImg.src;
  if (!src) {
    showToast('没有可复制的图片');
    return;
  }

  try {
    const response = await fetch(src);
    const blob = await response.blob();

    // 如果不是 PNG，转换为 PNG
    if (blob.type !== 'image/png') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
      });

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const pngDataUrl = canvas.toDataURL('image/png');
      const pngResponse = await fetch(pngDataUrl);
      blob = await pngResponse.blob();
    }

    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('图片已复制到剪贴板');
    } else {
      showToast('浏览器不支持复制图片');
    }
  } catch {
    showToast('复制图片失败');
  }
}

imageViewerBackdrop.addEventListener('click', closeImageViewer);
imageViewerCloseBtn.addEventListener('click', closeImageViewer);
imageViewerCopyBtn.addEventListener('click', copyViewerImage);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !imageViewer.classList.contains('hidden')) {
    closeImageViewer();
  }
});