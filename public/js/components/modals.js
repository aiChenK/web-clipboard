/**
 * 弹窗组件管理模块 (包含原图查看器、长文本详情、备注编辑、大图决策与登录时长设置)
 */

import { fetchOriginalImageBlob, updateRemark } from '../api.js';
import { copyTextToClipboard, copyImageToClipboard } from '../media/clipboard.js';
import { ORIGINAL_FETCH_TIMEOUT } from '../config.js';

// ========== 1. 原图 / 大图查看器 ==========
export class ImageViewerModal {
  constructor({ modalEl, onToast }) {
    this.el = modalEl;
    this.onToast = onToast;
    this.img = document.getElementById('image-viewer-img');
    this.originalBtn = document.getElementById('image-viewer-original');
    this.copyBtn = document.getElementById('image-viewer-copy');
    this.backdrop = this.el.querySelector('.image-viewer-backdrop');
    this.closeBtn = this.el.querySelector('.image-viewer-close');

    this.currentMessage = null;
    this.isViewingOriginal = false;
    this.blobUrl = null;

    this.initEvents();
  }

  initEvents() {
    if (this.backdrop) this.backdrop.addEventListener('click', () => this.close());
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    if (this.originalBtn) this.originalBtn.addEventListener('click', () => this.loadOriginal());
    if (this.copyBtn) this.copyBtn.addEventListener('click', () => this.copy());
  }

  open(msg) {
    this.currentMessage = msg;
    this.isViewingOriginal = false;

    const utils = window.ClipboardUtils;
    const imageData = utils ? utils.getImageContent(msg.content) : msg.content;

    // 优先复用当前卡片已存在的 ObjectURL
    const listImg = document.querySelector(`.message[data-id="${CSS.escape(msg.id)}"] img.message-image`);
    if (listImg && listImg.src) {
      this.img.src = listImg.src;
    } else {
      this.img.src = imageData.thumbnail;
    }

    if (imageData.hasOriginal) {
      this.originalBtn.classList.remove('hidden');
      this.originalBtn.textContent = '查看原图';
      this.originalBtn.disabled = false;
    } else {
      this.originalBtn.classList.add('hidden');
    }

    this.el.classList.remove('hidden');
  }

  close() {
    this.el.classList.add('hidden');
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.img.src = '';
    this.currentMessage = null;
    this.isViewingOriginal = false;
  }

  async loadOriginal() {
    if (!this.currentMessage) return;
    this.originalBtn.disabled = true;
    this.originalBtn.textContent = '加载中...';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ORIGINAL_FETCH_TIMEOUT);

    try {
      const blob = await fetchOriginalImageBlob(this.currentMessage.id, controller.signal);
      clearTimeout(timeoutId);

      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
      }
      this.blobUrl = URL.createObjectURL(blob);
      this.img.src = this.blobUrl;
      this.isViewingOriginal = true;
      this.originalBtn.textContent = '当前原图';
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('加载原图失败:', err);
      if (this.onToast) this.onToast('加载原图失败');
      this.originalBtn.textContent = '查看原图';
    } finally {
      this.originalBtn.disabled = false;
    }
  }

  async copy() {
    const src = this.img.src;
    if (!src) {
      if (this.onToast) this.onToast('没有可复制的图片');
      return;
    }

    const successToast = this.isViewingOriginal ? '原图已复制到剪贴板' : '图片已复制到剪贴板';
    await copyImageToClipboard(src, {
      successToast,
      failureToast: '复制图片失败',
      messageId: this.currentMessage ? this.currentMessage.id : null
    }, this.onToast);
  }
}

// ========== 2. 长文本查看器 ==========
export class TextViewerModal {
  constructor({ modalEl, onToast }) {
    this.el = modalEl;
    this.onToast = onToast;
    this.contentEl = document.getElementById('text-viewer-content');
    this.metaEl = document.getElementById('text-viewer-meta');
    this.closeBtn = document.getElementById('text-viewer-close');
    this.footerCloseBtn = document.getElementById('text-viewer-close-btn');
    this.copyBtn = document.getElementById('text-viewer-copy-btn');
    this.backdrop = this.el ? this.el.querySelector('.text-viewer-backdrop') : null;

    this.currentMessage = null;
    this.initEvents();
  }

  initEvents() {
    if (this.backdrop) this.backdrop.addEventListener('click', () => this.close());
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    if (this.footerCloseBtn) this.footerCloseBtn.addEventListener('click', () => this.close());
    if (this.copyBtn) this.copyBtn.addEventListener('click', () => this.copy());
  }

  open(msg) {
    if (!this.el || !this.contentEl) return;
    this.currentMessage = msg;

    const content = msg.content || '';
    const lines = content.split('\n').length;
    const chars = content.length;

    if (this.metaEl && window.ClipboardUtils) {
      this.metaEl.textContent = `${lines} 行 · ${chars} 字 · ${window.ClipboardUtils.formatTime(msg.timestamp)}`;
    }

    if (window.ClipboardUtils) {
      this.contentEl.innerHTML = window.ClipboardUtils.renderSmartText(content);
    } else {
      this.contentEl.textContent = content;
    }

    this.el.classList.remove('hidden');
  }

  close() {
    if (!this.el) return;
    this.el.classList.add('hidden');
    if (this.contentEl) this.contentEl.innerHTML = '';
    this.currentMessage = null;
  }

  async copy() {
    if (!this.currentMessage || !this.currentMessage.content) {
      if (this.onToast) this.onToast('没有可复制的内容');
      return;
    }
    await copyTextToClipboard(this.currentMessage.content, this.onToast);
  }
}

// ========== 3. 备注设置弹窗 ==========
export class RemarkModal {
  constructor({ modalEl, onRemarkSaved, onToast }) {
    this.el = modalEl;
    this.onRemarkSaved = onRemarkSaved;
    this.onToast = onToast;
    this.previewEl = document.getElementById('remark-modal-preview');
    this.input = document.getElementById('remark-input');
    this.charCount = document.getElementById('remark-char-count');
    this.cancelBtn = document.getElementById('remark-cancel-btn');
    this.clearBtn = document.getElementById('remark-clear-btn');
    this.saveBtn = document.getElementById('remark-save-btn');

    this.currentMessage = null;
    this.initEvents();
  }

  initEvents() {
    if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.close());
    if (this.clearBtn) this.clearBtn.addEventListener('click', () => this.save(''));
    if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.save());

    if (this.input) {
      this.input.addEventListener('input', () => this.updateCount());
      this.input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          this.save();
        }
      });
    }

    if (this.el) {
      this.el.addEventListener('click', (e) => {
        if (e.target === this.el) this.close();
      });
    }
  }

  updateCount() {
    if (!this.charCount || !this.input) return;
    const count = this.input.value.length;
    this.charCount.textContent = `${count} / 500`;
    this.charCount.style.color = count >= 500 ? '#e53e3e' : '#a0aec0';
  }

  open(msg) {
    this.currentMessage = msg;
    if (!this.el || !this.input) return;

    if (this.previewEl) {
      let previewText = '';
      if (msg.type === 'text') {
        const plainText = (msg.content || '').replace(/\s+/g, ' ').trim();
        previewText = `文本: ${plainText.slice(0, 50)}${plainText.length > 50 ? '...' : ''}`;
      } else if (msg.type === 'image') {
        previewText = `图片: [${new Date(msg.timestamp).toLocaleTimeString()}]`;
      } else if (msg.type === 'file') {
        const fileData = window.ClipboardUtils ? window.ClipboardUtils.getFileContent(msg.content) : msg.content;
        previewText = `文件: ${fileData.name || '附件'}`;
      }
      this.previewEl.textContent = previewText || '消息';
    }

    this.input.value = msg.remark || '';
    this.updateCount();

    if (this.clearBtn) {
      this.clearBtn.classList.toggle('hidden', !msg.remark);
    }

    this.el.classList.remove('hidden');
    setTimeout(() => {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }, 50);
  }

  close() {
    if (this.el) this.el.classList.add('hidden');
    this.currentMessage = null;
  }

  async save(forcedRemark = null) {
    if (!this.currentMessage) return;

    const targetId = this.currentMessage.id;
    const remarkToSave = typeof forcedRemark === 'string' ? forcedRemark : this.input.value.trim();

    try {
      if (this.saveBtn) {
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = '保存中...';
      }

      await updateRemark(targetId, remarkToSave);

      if (this.onRemarkSaved) {
        this.onRemarkSaved(targetId, remarkToSave);
      }

      this.close();
      if (this.onToast) {
        this.onToast(remarkToSave ? '备注已保存' : '备注已清除');
      }
    } catch (err) {
      console.error('保存备注错误:', err);
      if (this.onToast) this.onToast(err.message || '保存备注失败');
    } finally {
      if (this.saveBtn) {
        this.saveBtn.disabled = false;
        this.saveBtn.textContent = '保存';
      }
    }
  }
}

// ========== 4. 大图压缩/原图决策弹窗 ==========
export class ImageChoiceModal {
  constructor() {
    this.modalEl = document.getElementById('image-compress-modal');
    this.msgEl = document.getElementById('image-compress-message');
    this.compressBtn = document.getElementById('image-compress-btn');
    this.originalBtn = document.getElementById('image-original-btn');
    this.cancelBtn = document.getElementById('image-cancel-btn');
  }

  confirm(fileOrCount, totalSizeMB = null) {
    return new Promise((resolve) => {
      if (!this.modalEl || !this.msgEl || !this.compressBtn || !this.originalBtn || !this.cancelBtn) {
        resolve('compress');
        return;
      }

      if (typeof fileOrCount === 'number') {
        this.msgEl.textContent = `检测到本次有 ${fileOrCount} 张图片较大（总计 ${totalSizeMB} MB），建议压缩后上传以大幅提升传输速度并节省带宽。`;
      } else {
        const sizeMB = (fileOrCount.size / (1024 * 1024)).toFixed(1);
        this.msgEl.textContent = `检测到当前图片较大（${sizeMB} MB），建议压缩后上传以大幅提升传输速度并节省带宽。`;
      }

      this.modalEl.classList.remove('hidden');

      const cleanup = () => {
        this.modalEl.classList.add('hidden');
        this.compressBtn.removeEventListener('click', onCompress);
        this.originalBtn.removeEventListener('click', onOriginal);
        this.cancelBtn.removeEventListener('click', onCancel);
      };

      const onCompress = () => { cleanup(); resolve('compress'); };
      const onOriginal = () => { cleanup(); resolve('original'); };
      const onCancel = () => { cleanup(); resolve('cancel'); };

      this.compressBtn.addEventListener('click', onCompress);
      this.originalBtn.addEventListener('click', onOriginal);
      this.cancelBtn.addEventListener('click', onCancel);
    });
  }
}
