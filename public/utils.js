/**
 * Web Clipboard 前端公共工具函数库
 */

(function (global) {
  'use strict';

  // HTML 实体转义
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // HTML 属性转义（防止属性逃逸与提前闭合）
  function escapeAttribute(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 格式化时间戳
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return `${date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // 格式化文件大小
  function formatFileSize(size) {
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // 解析图片内容格式
  function getImageContent(content) {
    if (typeof content === 'string') {
      return { thumbnail: content, original: content, hasOriginal: false };
    }
    if (content && typeof content === 'object') {
      const thumbnail = typeof content.thumbnail === 'string' ? content.thumbnail : '';
      const original = typeof content.original === 'string' ? content.original : '';
      const hasOriginal =
        typeof content.hasOriginal === 'boolean'
          ? content.hasOriginal
          : Boolean(original && original !== thumbnail);
      return { thumbnail: thumbnail || original, original, hasOriginal };
    }
    return { thumbnail: '', original: '', hasOriginal: false };
  }

  // 解析文件内容格式
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

  // 同步将 Data URL 转为 Blob
  function dataURLtoBlobSync(dataUrl) {
    try {
      const parts = dataUrl.split(',');
      if (parts.length !== 2) return null;
      const match = parts[0].match(/:(.*?);/);
      const mime = match ? match[1] : 'image/png';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch {
      return null;
    }
  }

  /**
   * 安全重构的智能文本渲染：
   * 1. 在纯文本阶段通过正则隔离多行代码块、行内代码与 URL，绝不在经过实体转义的字符串上二次匹配正则；
   * 2. URL 正则显式排除双引号、单引号与尖括号，防止属性注入；
   * 3. 对 href 属性实施严格的属性安全转义，并限制仅允许 http/https 协议；
   * 4. 彻底杜绝属性提前闭合与存储型/反射型 XSS 漏洞。
   */
  function renderSmartText(text) {
    if (!text || typeof text !== 'string') return '';

    const placeholders = [];

    // 1. 纯文本提取多行代码块并生成占位符
    let processed = text.replace(/```(\w*)\n([\s\S]*?)\n?```/g, (match, lang, code) => {
      const placeholder = `__CB_BLOCK_PLH_${placeholders.length}__`;
      placeholders.push({
        placeholder,
        content: `<pre class="code-block"><code>${escapeHTML(code)}</code></pre>`
      });
      return placeholder;
    });

    // 2. 纯文本提取行内代码并生成占位符
    processed = processed.replace(/`([^`\n]+)`/g, (match, code) => {
      const placeholder = `__CB_INLINE_PLH_${placeholders.length}__`;
      placeholders.push({
        placeholder,
        content: `<code class="inline-code">${escapeHTML(code)}</code>`
      });
      return placeholder;
    });

    // 3. 纯文本提取 URL 链接（严格限制不包含引号、尖括号，并以有效字符结尾）
    const urlPattern = /\bhttps?:\/\/[^\s"'<>]+(?:\([^\s"'<>]+\)|[^\s"'<>.,?!;:~*`])/gi;
    processed = processed.replace(urlPattern, (rawUrl) => {
      // 协议安全性校验
      if (!/^https?:\/\//i.test(rawUrl)) {
        return rawUrl;
      }
      const placeholder = `__CB_URL_PLH_${placeholders.length}__`;
      const safeHref = escapeAttribute(rawUrl);
      const safeText = escapeHTML(rawUrl);
      placeholders.push({
        placeholder,
        content: `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="message-link">${safeText}</a>`
      });
      return placeholder;
    });

    // 4. 将剩余纯文本转义为 HTML 实体，换行符转为 <br>
    let html = escapeHTML(processed).replace(/\n/g, '<br>');

    // 5. 还原受保护的 HTML 占位符
    for (const item of placeholders) {
      html = html.replace(item.placeholder, item.content);
    }

    return html;
  }

  // 挂载工具函数
  const Utils = {
    escapeHTML,
    escapeAttribute,
    formatTime,
    formatFileSize,
    getImageContent,
    getFileContent,
    dataURLtoBlobSync,
    renderSmartText
  };

  global.ClipboardUtils = Utils;

  // 兼容老代码直接调用的全局函数名
  global.escapeHTML = escapeHTML;
  global.escapeAttribute = escapeAttribute;
  global.formatTime = formatTime;
  global.formatFileSize = formatFileSize;
  global.getImageContent = getImageContent;
  global.getFileContent = getFileContent;
  global.dataURLtoBlobSync = dataURLtoBlobSync;
  global.renderSmartText = renderSmartText;

})(typeof window !== 'undefined' ? window : globalThis);
