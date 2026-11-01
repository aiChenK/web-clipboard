/* ==========================================================================
   主题引导与切换（classic script，必须在 <head> 同步加载）
   - 先落 data-theme 再让浏览器绘制，避免深色用户首屏闪白
   - 偏好写 localStorage['wc-theme'] = light | dark；未设置时跟随系统
   - 多标签页用 storage 事件同步；系统主题变化时实时跟随（仅「跟随系统」状态）
   - 页面上任意 <button data-theme-toggle> 都会被自动接管：注入图标、同步状态
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'wc-theme';
  var META_LIGHT = '#f3f2ee';
  var META_DARK = '#121218';

  var root = document.documentElement;
  var media = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  var listeners = [];

  var ICON_SUN =
    '<svg class="ico ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.1"/>' +
    '<path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3' +
    'M6.1 6.1 4.5 4.5M19.5 19.5l-1.6-1.6M17.9 6.1l1.6-1.6M4.5 19.5l1.6-1.6"/>' +
    '</svg>';

  var ICON_MOON =
    '<svg class="ico ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20.8 13.6A8.6 8.6 0 0 1 10.4 3.2 8.6 8.6 0 1 0 20.8 13.6z"/>' +
    '</svg>';

  function systemTheme() {
    return media && media.matches ? 'dark' : 'light';
  }

  function readStored() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (err) {
      return null;
    }
  }

  function writeStored(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      /* 隐私模式 / 禁用存储：仅本次会话生效 */
    }
  }

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  /** 把主题落到 DOM：令牌、原生控件配色、地址栏主题色、按钮状态 */
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? META_DARK : META_LIGHT);
    }

    syncToggles(theme);

    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](theme);
      } catch (err) {
        /* 单个订阅者报错不应影响主题切换 */
      }
    }
  }

  function syncToggles(theme) {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    var isDark = theme === 'dark';
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
      if (!btn.firstChild) {
        btn.innerHTML = ICON_SUN + ICON_MOON;
      }
    }
  }

  function setTheme(next) {
    writeStored(next);
    apply(next);
  }

  function toggle() {
    setTheme(current() === 'dark' ? 'light' : 'dark');
  }

  /* 立即应用：此时 body 还没解析完，但 <html> 与 <head> 已就位 */
  apply(readStored() || systemTheme());

  /* 未显式选择过主题时，跟随系统切换 */
  if (media) {
    var onSystemChange = function () {
      if (!readStored()) apply(systemTheme());
    };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  /* 其它标签页改了偏好，这边跟着变 */
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) apply(readStored() || systemTheme());
  });

  /* 事件委托：后插入 DOM 的按钮也能用 */
  document.addEventListener('click', function (e) {
    var hit = e.target && e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
    if (hit) {
      e.preventDefault();
      toggle();
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    syncToggles(current());
  });

  window.WCTheme = {
    get: current,
    set: setTheme,
    toggle: toggle,
    isSystem: function () {
      return !readStored();
    },
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    }
  };
})();
