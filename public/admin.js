/**
 * 管理端页面逻辑（原生 JS，无框架）
 * 凭证：管理密码存 sessionStorage，逐请求通过 x-admin-password 头传递（与主应用同一套无会话风格）
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'web-clipboard-admin-password';

  const loginView = document.getElementById('login-view');
  const panel = document.getElementById('panel');
  const adminPasswordInput = document.getElementById('admin-password');
  const loginBtn = document.getElementById('login-btn');
  const loginMsg = document.getElementById('login-msg');
  const logoutBtn = document.getElementById('logout-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const createBtn = document.getElementById('create-btn');
  const createMsg = document.getElementById('create-msg');
  const listMsg = document.getElementById('list-msg');
  const usersBody = document.getElementById('users-body');
  const userCount = document.getElementById('user-count');
  const migrateRow = document.getElementById('migrate-row');
  const migrateLegacy = document.getElementById('migrate-legacy');
  const newIdInput = document.getElementById('new-id');
  const newNameInput = document.getElementById('new-name');
  const newPasswordInput = document.getElementById('new-password');

  const modeBadge = document.getElementById('mode-badge');
  const versionBadge = document.getElementById('version-badge');
  const statMode = document.getElementById('stat-mode');
  const statUsers = document.getElementById('stat-users');
  const statShares = document.getElementById('stat-shares');
  const statExpire = document.getElementById('stat-expire');
  const statUsersFile = document.getElementById('stat-users-file');
  const statStorage = document.getElementById('stat-storage');

  const deleteModal = document.getElementById('delete-modal');
  const deleteTarget = document.getElementById('delete-target');
  const deletePurge = document.getElementById('delete-purge');
  const deleteWarning = document.getElementById('delete-warning');
  const deleteCancel = document.getElementById('delete-cancel');
  const deleteConfirm = document.getElementById('delete-confirm');

  const passwordModal = document.getElementById('password-modal');
  const passwordTarget = document.getElementById('password-target');
  const passwordNew = document.getElementById('password-new');
  const passwordMsg = document.getElementById('password-msg');
  const passwordCancel = document.getElementById('password-cancel');
  const passwordConfirm = document.getElementById('password-confirm');

  const toastEl = document.getElementById('toast');

  let adminPassword = sessionStorage.getItem(STORAGE_KEY) || '';
  let currentUsers = [];
  let pendingDeleteId = null;
  let pendingDeleteIsLast = false;
  let pendingPasswordId = null;
  let toastTimer = null;

  // ========== 基础工具 ==========

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
  }

  function formatTime(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
    const date = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function showToast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function setMessage(el, text, type) {
    if (!el) return;
    el.textContent = text || '';
    el.className = text ? `msg ${type || 'error'}` : 'msg';
  }

  // ========== 请求封装 ==========

  async function adminRequest(path, options = {}) {
    const headers = Object.assign({}, options.headers, {
      'x-admin-password': adminPassword
    });

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(path, Object.assign({}, options, { headers }));

    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('管理密码已失效');
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error((data && data.error) || `请求失败 (${response.status})`);
    }

    return data;
  }

  function handleUnauthorized() {
    adminPassword = '';
    sessionStorage.removeItem(STORAGE_KEY);
    panel.classList.add('hidden');
    loginView.classList.remove('hidden');
    setMessage(loginMsg, '管理密码已失效，请重新输入', 'error');
  }

  // ========== 登录 ==========

  async function tryEnter() {
    const password = adminPasswordInput.value.trim();
    if (!password) {
      setMessage(loginMsg, '请输入管理密码', 'error');
      return;
    }

    setMessage(loginMsg, '', '');
    loginBtn.disabled = true;

    try {
      adminPassword = password;
      const session = await adminRequest('/api/admin/session');
      sessionStorage.setItem(STORAGE_KEY, password);
      enterPanel(session);
    } catch (error) {
      adminPassword = '';
      setMessage(loginMsg, error.message || '管理密码错误', 'error');
      adminPasswordInput.focus();
      adminPasswordInput.select();
    } finally {
      loginBtn.disabled = false;
    }
  }

  function enterPanel(session) {
    loginView.classList.add('hidden');
    panel.classList.remove('hidden');
    adminPasswordInput.value = '';
    setMessage(loginMsg, '', '');
    window.scrollTo({ top: 0 });

    modeBadge.textContent = session.mode === 'multi' ? '多用户模式' : '单用户模式';
    modeBadge.className = `badge ${session.mode}`;
    versionBadge.textContent = `v${session.version}`;

    // 单用户模式且存在遗留数据时才提示迁移
    migrateRow.classList.toggle('hidden', !(session.mode === 'single' && session.legacyDataPending));

    refreshAll();
  }

  // ========== 数据刷新 ==========

  async function refreshAll() {
    try {
      const [status, usersPayload] = await Promise.all([
        adminRequest('/api/admin/status'),
        adminRequest('/api/admin/users')
      ]);

      renderStatus(status);
      currentUsers = usersPayload.users || [];
      renderUsers(currentUsers);
      setMessage(listMsg, '', '');
    } catch (error) {
      if (error.message !== '管理密码已失效') {
        setMessage(listMsg, `加载失败: ${error.message}`, 'error');
      }
    }
  }

  function renderStatus(status) {
    statMode.textContent = status.mode === 'multi' ? '多用户' : '单用户';
    statUsers.textContent = `${status.userCount}（启用 ${status.enabledUserCount}）`;
    statShares.textContent = String(status.shareCount);
    statExpire.textContent = `${status.expireHours} 小时`;
    statUsersFile.textContent = status.usersFile || '-';
    statStorage.textContent = status.storageRoot || '-';
    statUsersFile.title = status.usersFile || '';
    statStorage.title = status.storageRoot || '';
  }

  function renderUsers(users) {
    if (userCount) userCount.textContent = String(users.length);

    if (!users.length) {
      usersBody.innerHTML = '<tr><td colspan="7" class="empty">暂无用户。新建第一个用户后，系统将切换到多用户模式。</td></tr>';
      return;
    }

    usersBody.innerHTML = users
      .map((user) => {
        const statusBadge = user.enabled
          ? '<span class="badge on">启用</span>'
          : '<span class="badge off">已禁用</span>';
        const nameLine = user.displayName
          ? `<div class="user-name">${escapeHtml(user.displayName)}</div>`
          : '';
        const dataHint = user.hasDataDir ? '' : '<span class="muted"> · 无目录</span>';

        return `
          <tr>
            <td class="cell-user">
              <div class="user-id">${escapeHtml(user.id)}</div>
              ${nameLine}
            </td>
            <td>${statusBadge}</td>
            <td class="num">${user.messageCount}</td>
            <td class="num col-favorite">${user.favoriteCount}</td>
            <td class="num col-storage">${formatBytes(user.storageBytes)}${dataHint}</td>
            <td class="col-activity">${formatTime(user.lastActivity || user.createdAt)}</td>
            <td class="cell-actions">
              <div class="row-actions">
                <button class="btn btn-secondary btn-small" data-action="password" data-id="${escapeHtml(user.id)}">重置密码</button>
                <button class="btn btn-secondary btn-small" data-action="toggle" data-id="${escapeHtml(user.id)}" data-enabled="${user.enabled ? '1' : '0'}">
                  ${user.enabled ? '禁用' : '启用'}
                </button>
                <button class="btn btn-danger btn-small" data-action="delete" data-id="${escapeHtml(user.id)}">删除</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  // ========== 新建用户 ==========

  async function createUser() {
    const id = newIdInput.value.trim().toLowerCase();
    const displayName = newNameInput.value.trim();
    const password = newPasswordInput.value;

    setMessage(createMsg, '', '');

    if (!id) {
      setMessage(createMsg, '请填写用户名', 'error');
      return;
    }

    createBtn.disabled = true;

    try {
      const payload = { id, displayName, password };

      if (!migrateRow.classList.contains('hidden') && migrateLegacy.checked) {
        payload.migrateLegacy = true;
      }

      const result = await adminRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const notes = [];
      if (result.migrated) notes.push('单用户数据已迁移');
      if (result.modeChanged) notes.push('已切换到多用户模式');
      if (result.sharesCleared) notes.push('分享数据已清理');

      setMessage(createMsg, `用户 ${result.user.id} 创建成功${notes.length ? `：${notes.join('，')}` : ''}`, 'ok');
      showToast('用户已创建');

      newIdInput.value = '';
      newNameInput.value = '';
      newPasswordInput.value = '';

      await refreshAll();
    } catch (error) {
      if (error.message !== '管理密码已失效') {
        setMessage(createMsg, error.message, 'error');
      }
    } finally {
      createBtn.disabled = false;
    }
  }

  // ========== 用户操作 ==========

  async function toggleUser(userId, nextEnabled) {
    try {
      await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled })
      });
      showToast(nextEnabled ? '用户已启用' : '用户已禁用并断开连接');
      await refreshAll();
    } catch (error) {
      if (error.message !== '管理密码已失效') {
        setMessage(listMsg, error.message, 'error');
      }
    }
  }

  function openDeleteModal(userId) {
    pendingDeleteId = userId;
    deleteTarget.textContent = userId;
    deletePurge.checked = false;

    // 删除最后一个用户会让系统退回单用户模式，必须提前说明后果
    pendingDeleteIsLast = currentUsers.length <= 1;
    if (pendingDeleteIsLast) {
      deleteWarning.textContent = '这是最后一个用户。删除后系统将退回单用户模式，所有分享链接会被清理，该用户的数据目录会保留（可勾选一并清除）。';
      deleteWarning.classList.remove('hidden');
    } else {
      deleteWarning.textContent = '';
      deleteWarning.classList.add('hidden');
    }

    deleteModal.classList.remove('hidden');
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;

    deleteConfirm.disabled = true;

    try {
      const params = new URLSearchParams();
      if (deletePurge.checked) params.set('purge', '1');
      if (pendingDeleteIsLast) params.set('force', '1');
      const queryString = params.toString() ? `?${params}` : '';

      const result = await adminRequest(`/api/admin/users/${encodeURIComponent(pendingDeleteId)}${queryString}`, {
        method: 'DELETE'
      });

      const notes = ['用户已删除'];
      if (result.purged) notes.push('数据已清除');
      if (result.sharesDeleted) notes.push(`清理 ${result.sharesDeleted} 个分享`);
      if (result.modeChanged) notes.push('已退回单用户模式');

      showToast(notes.join('，'));
      deleteModal.classList.add('hidden');
      pendingDeleteId = null;
      await refreshAll();
    } catch (error) {
      if (error.message !== '管理密码已失效') {
        setMessage(listMsg, error.message, 'error');
        deleteModal.classList.add('hidden');
      }
    } finally {
      deleteConfirm.disabled = false;
    }
  }

  function openPasswordModal(userId) {
    pendingPasswordId = userId;
    passwordTarget.textContent = userId;
    passwordNew.value = '';
    setMessage(passwordMsg, '', '');
    passwordModal.classList.remove('hidden');
    passwordNew.focus();
  }

  async function confirmPassword() {
    if (!pendingPasswordId) return;

    const password = passwordNew.value;

    if (!password) {
      setMessage(passwordMsg, '请输入新密码', 'error');
      return;
    }

    passwordConfirm.disabled = true;

    try {
      await adminRequest(`/api/admin/users/${encodeURIComponent(pendingPasswordId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password })
      });
      showToast('密码已重置，该用户需要重新登录');
      passwordModal.classList.add('hidden');
      pendingPasswordId = null;
    } catch (error) {
      if (error.message !== '管理密码已失效') {
        setMessage(passwordMsg, error.message, 'error');
      }
    } finally {
      passwordConfirm.disabled = false;
    }
  }

  // ========== 事件绑定 ==========

  loginBtn.addEventListener('click', tryEnter);
  adminPasswordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') tryEnter();
  });

  logoutBtn.addEventListener('click', () => {
    adminPassword = '';
    sessionStorage.removeItem(STORAGE_KEY);
    panel.classList.add('hidden');
    loginView.classList.remove('hidden');
    setMessage(loginMsg, '', '');
    adminPasswordInput.focus();
  });

  refreshBtn.addEventListener('click', () => refreshAll());
  createBtn.addEventListener('click', createUser);

  newPasswordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createUser();
  });

  [newIdInput, newNameInput].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') createUser();
    });
  });

  usersBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const userId = button.getAttribute('data-id');
    const action = button.getAttribute('data-action');

    if (action === 'delete') openDeleteModal(userId);
    if (action === 'password') openPasswordModal(userId);
    if (action === 'toggle') toggleUser(userId, button.getAttribute('data-enabled') !== '1');
  });

  deleteCancel.addEventListener('click', () => {
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
  });

  deleteConfirm.addEventListener('click', confirmDelete);

  passwordCancel.addEventListener('click', () => {
    passwordModal.classList.add('hidden');
    pendingPasswordId = null;
  });

  passwordConfirm.addEventListener('click', confirmPassword);

  passwordNew.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirmPassword();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    deleteModal.classList.add('hidden');
    passwordModal.classList.add('hidden');
    pendingDeleteId = null;
    pendingPasswordId = null;
  });

  // ========== 启动 ==========

  (async function boot() {
    if (!adminPassword) {
      adminPasswordInput.focus();
      return;
    }

    try {
      const session = await adminRequest('/api/admin/session');
      enterPanel(session);
    } catch {
      adminPassword = '';
      sessionStorage.removeItem(STORAGE_KEY);
      adminPasswordInput.focus();
    }
  })();
})();
