/**
 * 分享功能组件模块 (创建分享链接与分享列表管理)
 */

import { createShare, authFetch, fetchShareConfig } from '../api.js';
import { state } from '../state.js';

const SHARE_EXPIRY_PRESETS = [1, 6, 24, 72, 168];

function formatExpiryHours(hours) {
  return hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`;
}

export class ShareModal {
  constructor({ onToast, onCreationDisabledChange }) {
    this.onToast = onToast;
    this.onCreationDisabledChange = onCreationDisabledChange;
    this.modal = document.getElementById('share-modal');
    this.form = document.getElementById('share-form') || (this.modal ? this.modal.querySelector('.share-form') : null);
    this.result = document.getElementById('share-result');
    this.expiresSelect = document.getElementById('share-expires');
    this.passwordInput = document.getElementById('share-password');
    this.passwordLabel = document.getElementById('share-password-label');
    this.linkInput = document.getElementById('share-link');
    this.info = document.getElementById('share-info');
    this.cancelBtn = document.getElementById('share-cancel') || document.getElementById('share-cancel-btn');
    this.createBtn = document.getElementById('share-create') || document.getElementById('share-create-btn');
    this.copyBtn = document.getElementById('share-copy-link') || document.getElementById('share-copy-link-btn');

    this.currentMessage = null;
    this.creationDisabled = false;
    this.passwordRequired = false;
    this.initEvents();
  }

  initEvents() {
    if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.close());
    if (this.createBtn) this.createBtn.addEventListener('click', () => this.handleCreate());
    if (this.copyBtn) this.copyBtn.addEventListener('click', () => this.copyLink());

    if (this.passwordInput) {
      this.passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleCreate();
        }
      });
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }
  }

  open(msg) {
    if (this.creationDisabled) return;
    this.currentMessage = msg;
    if (this.form) this.form.classList.remove('hidden');
    if (this.result) this.result.classList.add('hidden');
    if (this.passwordInput) this.passwordInput.value = '';
    if (this.expiresSelect) this.expiresSelect.value = '';
    this.refreshConfig();
    if (this.modal) this.modal.classList.remove('hidden');
    if (this.passwordInput && typeof this.passwordInput.focus === 'function') {
      setTimeout(() => this.passwordInput.focus(), 50);
    }
  }

  async refreshConfig() {
    try {
      this.applyConfig(await fetchShareConfig());
    } catch {
      // 断线时沿用最近一次配置，创建请求仍由服务端校验。
    }
  }

  applyConfig({ creationDisabled = false, passwordRequired = false, defaultExpiresHours, maxExpiresHours }) {
    this.creationDisabled = creationDisabled;
    this.passwordRequired = passwordRequired;
    this.onCreationDisabledChange?.(creationDisabled);
    if (this.passwordLabel) {
      this.passwordLabel.textContent = passwordRequired ? '访问密码（必填）' : '访问密码（可选）';
    }
    if (this.passwordInput) {
      this.passwordInput.required = passwordRequired;
      this.passwordInput.placeholder = passwordRequired ? '请输入访问密码' : '留空则无需密码';
    }
    if (creationDisabled && this.currentMessage && !this.form?.classList.contains('hidden')) {
      this.close();
      this.onToast?.('管理员已禁止新建分享');
    }
    if (this.expiresSelect) this.renderExpiryOptions(defaultExpiresHours, maxExpiresHours);
  }

  renderExpiryOptions(defaultExpiresHours, maxExpiresHours) {
    const selectedHours = this.expiresSelect.value;
    const durations = [...new Set([...SHARE_EXPIRY_PRESETS, maxExpiresHours])]
      .filter((hours) => hours <= maxExpiresHours && hours !== defaultExpiresHours)
      .sort((a, b) => a - b);
    this.expiresSelect.replaceChildren(
      new Option(`${formatExpiryHours(defaultExpiresHours)}（默认）`, ''),
      ...durations.map((hours) => new Option(formatExpiryHours(hours), hours))
    );
    if (durations.includes(Number(selectedHours))) this.expiresSelect.value = selectedHours;
  }

  close() {
    if (this.modal) this.modal.classList.add('hidden');
    this.currentMessage = null;
  }

  async handleCreate() {
    if (!this.currentMessage || this.creationDisabled) return;

    const expiresHours = this.expiresSelect?.value;
    const password = this.passwordInput ? this.passwordInput.value.trim() || null : null;
    if (this.passwordRequired && !password) {
      this.onToast?.('新建分享必须设置访问密码');
      this.passwordInput?.focus();
      return;
    }

    try {
      if (this.createBtn) {
        this.createBtn.disabled = true;
        this.createBtn.textContent = '创建中...';
      }

      const payload = {
        messageId: this.currentMessage.id,
        expiresHours: expiresHours ? Number(expiresHours) : undefined
      };
      if (state.currentMode === 'multi' && state.userId) {
        payload.userId = state.userId;
      }
      if (password) {
        payload.password = password;
      }

      const data = await createShare(payload);

      if (this.form) this.form.classList.add('hidden');
      if (this.result) this.result.classList.remove('hidden');

      const shareUrl = window.location.origin + data.shareUrl;
      if (this.linkInput) this.linkInput.value = shareUrl;

      const expiresDate = new Date(data.expiresAt);
      const expiresStr = expiresDate.toLocaleString('zh-CN');
      const passwordInfo = data.hasPassword ? '（需要密码）' : '';
      if (this.info) this.info.textContent = `链接将在 ${expiresStr} 过期${passwordInfo}`;

      if (this.onToast) this.onToast('分享链接已创建');
    } catch (err) {
      if (this.onToast) this.onToast(err.message || '创建分享失败');
    } finally {
      if (this.createBtn) {
        this.createBtn.disabled = false;
        this.createBtn.textContent = '创建分享';
      }
    }
  }

  async copyLink() {
    if (!this.linkInput) return;
    try {
      await navigator.clipboard.writeText(this.linkInput.value);
      if (this.onToast) this.onToast('链接已复制到剪贴板');
    } catch {
      this.linkInput.select();
      document.execCommand('copy');
      if (this.onToast) this.onToast('链接已复制');
    }
  }
}

export class ShareListModal {
  constructor({ onToast }) {
    this.onToast = onToast;
    this.modal = document.getElementById('share-list-modal');
    this.container = document.getElementById('share-list-container');
    this.closeBtn = document.getElementById('share-list-close');
    this.triggerBtn = document.getElementById('my-shares-btn');

    this.initEvents();
  }

  initEvents() {
    if (this.triggerBtn) this.triggerBtn.addEventListener('click', () => this.open());
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }

    if (this.container) {
      this.container.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('.share-copy-url-btn');
        if (copyBtn) {
          const url = copyBtn.dataset.url;
          try {
            await navigator.clipboard.writeText(url);
            if (this.onToast) this.onToast('链接已复制到剪贴板');
          } catch {
            if (this.onToast) this.onToast('复制失败');
          }
          return;
        }

        const cancelBtn = e.target.closest('.share-cancel-btn');
        if (cancelBtn) {
          const shareId = cancelBtn.dataset.shareId;
          await this.deleteShareItem(shareId, cancelBtn);
        }
      });
    }
  }

  open() {
    if (this.modal) this.modal.classList.remove('hidden');
    this.load();
  }

  close() {
    if (this.modal) this.modal.classList.add('hidden');
  }

  async load() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="share-list-loading">加载中...</div>';

    try {
      const params = new URLSearchParams();
      if (state.currentMode === 'multi' && state.userId) {
        params.set('userId', state.userId);
      }

      const res = await authFetch(`/api/share/list?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取分享列表失败');

      this.render(data.shares || []);
    } catch (err) {
      const errorEl = document.createElement('div');
      errorEl.className = 'share-list-error';
      errorEl.textContent = err.message || '获取分享列表失败';
      this.container.innerHTML = '';
      this.container.appendChild(errorEl);
    }
  }

  render(shares) {
    if (shares.length === 0) {
      this.container.innerHTML = `
        <div class="share-list-empty">
          <p>暂无分享</p>
          <p style="font-size: 0.85rem; color: #888;">点击消息旁的「分享」按钮创建分享链接</p>
        </div>
      `;
      return;
    }

    const html = shares.map((share) => {
      const expiresDate = new Date(share.expiresAt);
      const expiresStr = expiresDate.toLocaleString('zh-CN');
      const passwordIcon = share.hasPassword ? ' 🔒' : '';
      const shareUrl = `${window.location.origin}/share/${share.shareId}`;

      return `
        <div class="share-list-item" data-share-id="${share.shareId}">
          <div class="share-list-item-info">
            <div class="share-list-item-id">分享 ID: ${share.shareId.slice(0, 8)}...${passwordIcon}</div>
            <div class="share-list-item-meta">
              <span>过期: ${expiresStr}</span>
              <span>访问: ${share.viewCount} 次</span>
            </div>
          </div>
          <div class="share-list-item-actions">
            <button class="btn btn-small btn-secondary share-copy-url-btn" data-url="${shareUrl}">复制链接</button>
            <button class="btn btn-small btn-danger share-cancel-btn" data-share-id="${share.shareId}">取消分享</button>
          </div>
        </div>
      `;
    }).join('');

    this.container.innerHTML = html;
  }

  async deleteShareItem(shareId, btn) {
    try {
      btn.disabled = true;
      btn.textContent = '取消中...';

      const params = new URLSearchParams();
      if (state.currentMode === 'multi' && state.userId) {
        params.set('userId', state.userId);
      }

      const res = await authFetch(`/api/share/${encodeURIComponent(shareId)}?${params.toString()}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取消分享失败');

      const itemEl = this.container.querySelector(`.share-list-item[data-share-id="${shareId}"]`);
      if (itemEl) itemEl.remove();

      if (this.onToast) this.onToast('已取消分享');

      if (this.container.querySelectorAll('.share-list-item').length === 0) {
        this.render([]);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '取消分享';
      if (this.onToast) this.onToast(err.message || '取消分享失败');
    }
  }
}
