import { state } from '../state.js';
import { fetchGroups, saveGroup, deleteGroup, moveMessageToGroup } from '../api.js';

export class GroupControls {
  constructor({ onChange, onToast, onConfirm }) {
    this.onChange = onChange;
    this.onToast = onToast;
    this.onConfirm = onConfirm;
    this.tabs = document.getElementById('group-tabs');
    this.modal = document.getElementById('group-modal');
    this.form = document.getElementById('group-form');
    this.name = document.getElementById('group-name');
    this.error = document.getElementById('group-error');
    this.save = document.getElementById('group-save');
    this.menu = document.getElementById('message-group-menu');
    this.menuButton = null;
    this.menuCloseTimer = null;

    this.tabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-group-id]');
      if (!tab) return;
      state.currentTab = 'messages';
      state.currentGroup = tab.dataset.groupId;
      this.onChange();
    });
    document.getElementById('group-add').addEventListener('click', () => this.open('create'));
    document.getElementById('group-rename').addEventListener('click', () => this.open('rename'));
    document.getElementById('group-delete').addEventListener('click', () => this.remove());
    document.getElementById('group-cancel').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) this.close();
    });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.menu.addEventListener('pointerenter', () => clearTimeout(this.menuCloseTimer));
    this.menu.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.scheduleMenuClose();
    });
    this.menu.addEventListener('keydown', (event) => {
      const options = [...this.menu.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        options[(index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length].focus();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        const button = this.menuButton;
        this.closeMoveMenu();
        button.focus();
      } else if (event.key === 'Tab') {
        this.closeMoveMenu();
      }
    });
    document.addEventListener('pointerout', (event) => {
      if (event.pointerType === 'mouse' && this.menuButton && event.target.closest('.message-group-action') === this.menuButton && !this.menu.contains(event.relatedTarget)) {
        this.scheduleMenuClose();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.contains(event.target) && event.target !== this.menuButton) this.closeMoveMenu();
    });
    document.addEventListener('focusin', (event) => {
      if (event.target !== this.menuButton && !this.menu.contains(event.target)) this.closeMoveMenu();
    });
    document.addEventListener('scroll', (event) => {
      if (event.target !== this.menu) this.closeMoveMenu();
    }, true);
    window.addEventListener('resize', () => this.closeMoveMenu());
  }

  async load() {
    try {
      const data = await fetchGroups();
      if (state.isAuthenticated) {
        state.maxGroups = data.maxGroups;
        this.apply(data.groups, data.counts);
      }
    } catch (error) {
      this.onToast(error.message);
    }
  }

  apply(groups, counts) {
    this.closeMoveMenu();
    state.groups = groups;
    state.counts = counts;
    if (state.currentGroup !== 'all' && !groups.some((group) => group.id === state.currentGroup)) {
      state.currentGroup = 'all';
    }
    this.render();
  }

  render() {
    const fragment = document.createDocumentFragment();
    for (const group of state.groups) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab group-tab';
      tab.dataset.groupId = group.id;
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = group.name;
      const count = document.createElement('span');
      count.className = 'tab-count';
      tab.append(label, count);
      tab.title = group.name;
      tab.classList.toggle('active', state.currentGroup === group.id);
      fragment.appendChild(tab);
    }
    this.tabs.replaceChildren(fragment);
    document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
      tab.classList.toggle('active', state.currentGroup === 'all' && tab.dataset.tab === state.currentTab);
    });
    const group = state.groups.find((item) => item.id === state.currentGroup);
    const addButton = document.getElementById('group-add');
    addButton.disabled = state.groups.length >= state.maxGroups;
    addButton.title = addButton.disabled ? `最多创建 ${state.maxGroups} 个分组` : '新建分组';
    document.getElementById('group-actions').classList.toggle('hidden', !group);
    document.getElementById('send-group-hint').textContent = `发送到：${group?.name || '未分组'} · 收藏后免于自动过期`;
    const clearButton = document.getElementById('clear-all');
    clearButton.textContent = state.currentGroup === 'all' ? '清空未收藏' : '清空本组未收藏';
    this.updateCounts();
  }

  updateCounts() {
    document.getElementById('tab-count-messages').textContent = formatTabCount(state.counts.messages);
    document.getElementById('tab-count-favorites').textContent = formatTabCount(state.counts.favorites);
    for (const tab of this.tabs.querySelectorAll('[data-group-id]')) {
      tab.querySelector('.tab-count').textContent = formatTabCount(state.counts.groups[tab.dataset.groupId] || 0);
    }
  }

  open(mode) {
    this.closeMoveMenu();
    this.mode = mode;
    this.editId = state.currentGroup;
    document.getElementById('group-modal-title').textContent = mode === 'create' ? '新建分组' : '重命名分组';
    this.name.value = mode === 'rename' ? state.groups.find((group) => group.id === this.editId).name : '';
    this.error.classList.add('hidden');
    this.modal.classList.remove('hidden');
    this.name.focus();
  }

  close() {
    this.modal.classList.add('hidden');
    this.closeMoveMenu();
  }

  async submit() {
    this.save.disabled = true;
    try {
      const data = await saveGroup(this.mode === 'rename' ? this.editId : null, this.name.value);
      state.currentTab = 'messages';
      state.currentGroup = data.group.id;
      this.apply(data.groups, data.counts);
      this.onToast(this.mode === 'rename' ? '已重命名分组' : '已新建分组');
      this.close();
      await this.onChange();
    } catch (error) {
      this.error.textContent = error.message;
      this.error.classList.remove('hidden');
    } finally {
      this.save.disabled = false;
    }
  }

  openMoveMenu(message, button, focus = false) {
    clearTimeout(this.menuCloseTimer);
    if (this.menuButton !== button) {
      this.closeMoveMenu();
      this.menuButton = button;
      this.menu.replaceChildren();
      for (const group of [{ id: null, name: '未分组' }, ...state.groups]) {
        const option = document.createElement('button');
        option.type = 'button';
        option.setAttribute('role', 'menuitemradio');
        option.setAttribute('aria-checked', String((message.groupId || null) === group.id));
        option.textContent = group.name;
        option.addEventListener('click', () => this.move(message.id, group.id));
        this.menu.appendChild(option);
      }
      const rect = button.getBoundingClientRect();
      this.menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      this.menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 216))}px`;
      this.menu.style.maxHeight = `${rect.top - 14}px`;
      this.menu.showPopover();
      button.setAttribute('aria-expanded', 'true');
    }
    if (focus) this.menu.querySelector('[aria-checked="true"]').focus();
  }

  scheduleMenuClose() {
    clearTimeout(this.menuCloseTimer);
    this.menuCloseTimer = setTimeout(() => this.closeMoveMenu(), 140);
  }

  closeMoveMenu() {
    clearTimeout(this.menuCloseTimer);
    this.menu.hidePopover();
    if (this.menuButton) this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton = null;
  }

  async move(id, groupId) {
    const options = this.menu.querySelectorAll('button');
    options.forEach((option) => { option.disabled = true; });
    try {
      await moveMessageToGroup(id, groupId);
      this.closeMoveMenu();
      await this.onChange();
      this.onToast('已设置分组');
    } catch (error) {
      options.forEach((option) => { option.disabled = false; });
      this.onToast(error.message);
    }
  }

  remove() {
    const group = state.groups.find((item) => item.id === state.currentGroup);
    this.onConfirm(`删除分组「${group.name}」？`, async () => {
      try {
        const data = await deleteGroup(group.id);
        this.apply(data.groups, data.counts);
        await this.onChange();
        this.onToast('已删除分组，消息仍保留在消息中');
      } catch (error) {
        this.onToast(error.message);
      }
    }, { hint: '消息及其收藏状态、附件和分享链接都会保留。' });
  }
}

function formatTabCount(value) {
  return value > 999 ? '999+' : String(value);
}
