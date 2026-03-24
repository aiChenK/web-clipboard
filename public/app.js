const socket = io();

const authSection = document.getElementById('auth-section');
const chatSection = document.getElementById('chat-section');
const passwordInput = document.getElementById('password-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');
const messagesList = document.getElementById('messages-list');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text');
const pasteTextBtn = document.getElementById('paste-text');
const imageInput = document.getElementById('image-input');
const pasteImageBtn = document.getElementById('paste-image');
const clearAllBtn = document.getElementById('clear-all');
const connectionStatus = document.getElementById('connection-status');
const messageCount = document.getElementById('message-count');
const expireInfo = document.getElementById('expire-info');
const toastEl = document.getElementById('toast');

let messages = [];

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3000);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear() && 
                  date.getMonth() === now.getMonth() && 
                  date.getDate() === now.getDate();
  
  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + 
           date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
}

function updateMessageCount() {
  messageCount.textContent = `${messages.length} 条消息`;
  clearAllBtn.disabled = messages.length === 0;
}

function renderMessages() {
  if (messages.length === 0) {
    messagesList.innerHTML = `
      <div class="empty-state">
        <p>暂无消息</p>
        <p style="font-size: 0.8rem; margin-top: 8px;">发送文字或图片开始使用</p>
      </div>
    `;
  } else {
    messagesList.innerHTML = messages.map(msg => createMessageHTML(msg)).join('');
    scrollToBottom();
  }
  updateMessageCount();
}

function createMessageHTML(msg) {
  const contentHTML = msg.type === 'text' 
    ? `<div class="message-content text">${escapeHTML(msg.content)}</div>`
    : `<div class="message-content image"><img src="${msg.content}" alt="图片" onclick="copyImageToClipboard('${msg.content}')"></div>`;
  
  const copyBtn = msg.type === 'text' 
    ? `<button class="btn btn-secondary" onclick="copyTextToClipboard('${escapeHTML(msg.content)}')">复制</button>`
    : `<button class="btn btn-secondary" onclick="copyImageToClipboard('${msg.content}')">复制图片</button>`;
  
  return `
    <div class="message" data-id="${msg.id}">
      <div class="message-header">
        <span class="message-time">${formatTime(msg.timestamp)}</span>
        <button class="message-delete" onclick="deleteMessage('${msg.id}')">删除</button>
      </div>
      ${contentHTML}
      <div class="message-actions">
        ${copyBtn}
      </div>
    </div>
  `;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function checkAuth() {
  const savedPassword = localStorage.getItem('web-clipboard-password');
  if (savedPassword) {
    verifyPassword(savedPassword);
  }
}

async function verifyPassword(password) {
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      localStorage.setItem('web-clipboard-password', password);
      authSection.classList.add('hidden');
      chatSection.classList.remove('hidden');
      loadMessages();
    } else {
      authError.classList.remove('hidden');
      localStorage.removeItem('web-clipboard-password');
    }
  } catch (error) {
    showToast('验证失败');
    console.error(error);
  }
}

async function loadMessages() {
  try {
    const response = await fetch('/api/messages');
    if (response.ok) {
      const data = await response.json();
      messages = data.messages || [];
      const expireHours = data.expireHours || 168;
      updateExpireInfo(expireHours);
      renderMessages();
    }
  } catch (error) {
    console.error('加载消息失败:', error);
  }
}

function updateExpireInfo(hours) {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    expireInfo.textContent = `数据保留 ${days} 天`;
  } else {
    expireInfo.textContent = `数据保留 ${hours} 小时`;
  }
}

async function sendMessage(type, content) {
  if (!content || !content.trim()) {
    showToast('内容不能为空');
    return;
  }
  
  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content })
    });
  } catch (error) {
    showToast('发送失败');
    console.error(error);
  }
}

async function deleteMessage(id) {
  try {
    await fetch(`/api/messages/${id}`, {
      method: 'DELETE'
    });
  } catch (error) {
    showToast('删除失败');
    console.error(error);
  }
}

window.deleteMessage = deleteMessage;

async function clearAllMessages() {
  showConfirmModal('确定要清空所有消息吗？', async () => {
    try {
      await fetch('/api/messages/clear', {
        method: 'POST'
      });
      showToast('已清空');
    } catch (error) {
      showToast('清空失败');
      console.error(error);
    }
  });
}

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const modalMessage = document.getElementById('modal-message');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');
  
  modalMessage.textContent = message;
  modal.classList.remove('hidden');
  
  const closeModal = () => {
    modal.classList.add('hidden');
    cancelBtn.removeEventListener('click', closeModal);
    confirmBtn.removeEventListener('click', handleConfirm);
  };
  
  const handleConfirm = () => {
    closeModal();
    onConfirm();
  };
  
  cancelBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', handleConfirm);
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
}

async function pasteText() {
  try {
    const text = await navigator.clipboard.readText();
    textInput.value = text;
    textInput.focus();
    autoResizeTextarea();
    showToast('已粘贴');
  } catch (error) {
    showToast('无法读取剪贴板');
    console.error(error);
  }
}

window.copyTextToClipboard = async function(text) {
  try {
    const decodedText = text.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');
    await navigator.clipboard.writeText(decodedText);
    showToast('已复制到剪贴板');
  } catch (error) {
    showToast('复制失败');
    console.error(error);
  }
};

window.copyImageToClipboard = async function(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    let blob = await response.blob();
    
    if (blob.type !== 'image/png') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      
      const pngDataUrl = canvas.toDataURL('image/png');
      const pngResponse = await fetch(pngDataUrl);
      blob = await pngResponse.blob();
    }
    
    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('图片已复制到剪贴板');
    } else {
      showToast('浏览器不支持复制图片，请右键另存');
    }
  } catch (error) {
    console.error('复制图片失败:', error);
    showToast('复制图片失败，请尝试右键另存');
  }
};

async function handleImageFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      await sendMessage('image', e.target.result);
    };
    reader.readAsDataURL(file);
  }
}

async function pasteImage() {
  try {
    const items = await navigator.clipboard.read();
    
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const reader = new FileReader();
          reader.onload = async (e) => {
            await sendMessage('image', e.target.result);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }
    
    showToast('剪贴板中没有图片');
  } catch (error) {
    showToast('无法读取剪贴板图片');
    console.error(error);
  }
}

function autoResizeTextarea() {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 100) + 'px';
}

authBtn.addEventListener('click', () => verifyPassword(passwordInput.value));
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') verifyPassword(passwordInput.value);
});
passwordInput.addEventListener('input', () => {
  authError.classList.add('hidden');
});

sendTextBtn.addEventListener('click', () => {
  sendMessage('text', textInput.value);
  textInput.value = '';
  autoResizeTextarea();
});

textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextBtn.click();
  }
});

textInput.addEventListener('input', autoResizeTextarea);

pasteTextBtn.addEventListener('click', pasteText);
pasteImageBtn.addEventListener('click', pasteImage);
clearAllBtn.addEventListener('click', clearAllMessages);

imageInput.addEventListener('change', (e) => {
  handleImageFiles(e.target.files);
  imageInput.value = '';
});

document.addEventListener('paste', (e) => {
  if (document.activeElement === textInput) {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        handleImageFiles([file]);
        break;
      }
    }
  }
});

socket.on('connect', () => {
  connectionStatus.textContent = '已连接';
  connectionStatus.className = 'status connected';
});

socket.on('disconnect', () => {
  connectionStatus.textContent = '已断开';
  connectionStatus.className = 'status disconnected';
});

socket.on('sync', (data) => {
  messages = data.messages || [];
  renderMessages();
});

socket.on('message-new', (msg) => {
  messages.push(msg);
  renderMessages();
  showToast('收到新消息');
});

socket.on('message-delete', (id) => {
  messages = messages.filter(m => m.id !== id);
  renderMessages();
});

socket.on('messages-clear', () => {
  messages = [];
  renderMessages();
});

checkAuth();
