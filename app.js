const socket = io();

// Состояние
let myName = null;
let myColor = '#3390ec';
let activeChatId = null;
let myChats = [];
let myHistory = {};
let allUsers = [];

// Элементы
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const loginInput = document.getElementById('loginInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const meAvatar = document.getElementById('meAvatar');
const meLabel = document.getElementById('meLabel');
const createBtn = document.getElementById('createBtn');
const searchInput = document.getElementById('searchInput');
const chatListEl = document.getElementById('chatList');

const chatAvatarEl = document.getElementById('chatAvatar');
const chatNameEl = document.getElementById('chatName');
const chatStatusEl = document.getElementById('chatStatus');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const backBtn = document.getElementById('backBtn');
const stickerBtn = document.getElementById('stickerBtn');

// Модалки
const createModal = document.getElementById('createModal');
const createMenu = document.getElementById('createMenu');
const createForm = document.getElementById('createForm');
const newTitle = document.getElementById('newTitle');
const newMembers = document.getElementById('newMembers');
const createSubmit = document.getElementById('createSubmit');
const stickerSheet = document.getElementById('stickerSheet');
const stickerGrid = document.getElementById('stickerGrid');

let createType = null;

// Утилиты
function initial(name) { return String(name || '?').charAt(0).toUpperCase(); }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

// Вход
loginBtn.addEventListener('click', () => {
  const username = loginInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) return;
  
  socket.emit('login', { username, password }, (res) => {
    if (!res.ok) { loginError.textContent = res.error; return; }
    
    myName = res.me.username;
    myColor = res.me.color;
    myChats = res.chats;
    myHistory = res.history;
    allUsers = res.users;

    meAvatar.textContent = initial(res.me.displayName);
    meAvatar.style.background = myColor;
    meLabel.textContent = res.me.displayName;

    loginScreen.style.display = 'none';
    appScreen.style.display = 'flex';
    renderChats();
  });
});

// Список чатов
function renderChats() {
  chatListEl.innerHTML = '';
  
  // Сортируем: сначала чаты с последним сообщением, потом остальные
  const sortedChats = [...myChats].sort((a, b) => {
    const lastA = myHistory[a.id]?.slice(-1)[0];
    const lastB = myHistory[b.id]?.slice(-1)[0];
    return (lastB?.time || '') > (lastA?.time || '') ? 1 : -1;
  });

  sortedChats.forEach(chat => {
    const msgs = myHistory[chat.id] || [];
    const last = msgs[msgs.length - 1];
    
    let title = chat.title;
    if (chat.type === 'private') {
      const other = chat.members.find(m => m !== myName);
      title = allUsers.find(u => u.username === other)?.displayName || other;
    }
    if (chat.type === 'bot') title = '🤖 Messenger Bot';

    const li = document.createElement('li');
    li.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
    li.innerHTML = `
      <div class="chat-item__avatar" style="background:${chat.color}">${initial(title)}</div>
      <div class="chat-item__body">
        <div class="chat-item__top">
          <span class="chat-item__name">${escapeHtml(title)}</span>
          <span class="chat-item__time">${last ? last.time : ''}</span>
        </div>
        <div class="chat-item__last">${last ? (last.from === myName ? 'Вы: ' : '') + escapeHtml(last.text || '🎨') : 'Нет сообщений'}</div>
      </div>
    `;
    li.addEventListener('click', () => openChat(chat.id));
    chatListEl.appendChild(li);
  });
}

// Открытие чата
function openChat(chatId) {
  activeChatId = chatId;
  const chat = myChats.find(c => c.id === chatId);
  if (!chat) return;

  let title = chat.title;
  if (chat.type === 'private') {
    const other = chat.members.find(m => m !== myName);
    title = allUsers.find(u => u.username === other)?.displayName || other;
  }
  if (chat.type === 'bot') title = '🤖 Messenger Bot';

  chatAvatarEl.textContent = initial(title);
  chatAvatarEl.style.background = chat.color;
  chatNameEl.textContent = title;
  chatStatusEl.textContent = chat.type === 'group' ? 'группа' : chat.type === 'channel' ? 'канал' : chat.type === 'bot' ? 'бот' : 'личный чат';

  // Права на ввод
  if (chat.type === 'channel' && chat.owner !== myName) {
    input.disabled = true; sendBtn.disabled = true;
    input.placeholder = 'Только владелец может писать';
  } else {
    input.disabled = false; sendBtn.disabled = false;
    input.placeholder = 'Сообщение';
  }

  renderMessages();
  renderChats();
  document.body.classList.add('chat-open');
}

// Рендер сообщений
function renderMessages() {
  messagesEl.innerHTML = '';
  const msgs = myHistory[activeChatId] || [];
  const chat = myChats.find(c => c.id === activeChatId);
  
  msgs.forEach(m => {
    const div = document.createElement('div');
    const isOut = m.from === myName;
    div.className = 'msg ' + (isOut ? 'out' : 'in');
    
    if (m.type === 'sticker') {
      div.classList.add('msg--sticker');
      div.innerHTML = `<span>${m.text}</span>`;
    } else {
      let author = '';
      if (!isOut && (chat.type === 'group' || chat.type === 'channel')) {
        const u = allUsers.find(u => u.username === m.from);
        author = `<div class="msg__author" style="color:${u?.color || 'inherit'}">${escapeHtml(u?.displayName || m.from)}</div>`;
      }
      div.innerHTML = `${author}${escapeHtml(m.text)}<span class="msg__time">${m.time}</span>`;
    }
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Отправка
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !activeChatId) return;
  socket.emit('send', { chatId: activeChatId, text });
  input.value = '';
});

// Прием сообщений
socket.on('message', ({ chatId, msg }) => {
  if (!myHistory[chatId]) myHistory[chatId] = [];
  myHistory[chatId].push(msg);
  
  if (chatId === activeChatId) renderMessages();
  renderChats();
});

// Новый чат
socket.on('new-chat', (chat) => {
  if (!myChats.find(c => c.id === chat.id)) {
    myChats.push(chat);
    if (!myHistory[chat.id]) myHistory[chat.id] = [];
    renderChats();
  }
});

// Создание чатов
createBtn.addEventListener('click', () => {
  createModal.classList.add('open');
  createMenu.style.display = 'flex';
  createForm.style.display = 'none';
});

document.querySelectorAll('.create-item').forEach(btn => {
  btn.addEventListener('click', () => {
    createType = btn.dataset.type;
    createMenu.style.display = 'none';
    createForm.style.display = 'flex';
    
    if (createType === 'private') {
      newTitle.placeholder = 'Имя пользователя (username)';
      newMembers.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Введите username друга</div>';
    } else if (createType === 'bot') {
      newTitle.placeholder = 'Имя бота';
      newMembers.innerHTML = '';
    } else {
      newTitle.placeholder = 'Название ' + (createType === 'group' ? 'группы' : 'канала');
      renderMemberChecks();
    }
  });
});

function renderMemberChecks() {
  newMembers.innerHTML = allUsers.filter(u => u.username !== myName).map(u => `
    <label class="member-check">
      <input type="checkbox" value="${u.username}">
      <span>${escapeHtml(u.displayName)} (@${u.username})</span>
    </label>
  `).join('');
}

createSubmit.addEventListener('click', () => {
  const title = newTitle.value.trim();
  if (!title) return;

  let members = [];
  if (createType === 'private') {
    members = [title]; // В поле ввода username друга
  } else if (createType === 'group' || createType === 'channel') {
    members = Array.from(newMembers.querySelectorAll('input:checked')).map(i => i.value);
  } else if (createType === 'bot') {
    members = [myName];
  }

  socket.emit('create-chat', { type: createType, title, members }, (res) => {
    if (res.ok) {
      createModal.classList.remove('open');
      if (!myChats.find(c => c.id === res.chat.id)) {
        myChats.push(res.chat);
      }
      openChat(res.chat.id);
    }
  });
});

// Стикеры
const STICKERS = ['😀','😂','🥰','😎','🤔','😴','🤯','🥳','😭','🤬','👻','💩','🤖','👽','🐱','🐶','🐼','🦊','🍕','🍔','🍰','🍺','⚽','🎮','🎸','🚗','✈️','🏆','❤️','🔥','⭐','💎'];

stickerBtn.addEventListener('click', () => {
  stickerGrid.innerHTML = STICKERS.map(s => `<button class="sticker-item" data-sticker="${s}">${s}</button>`).join('');
  stickerGrid.querySelectorAll('.sticker-item').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('send', { chatId: activeChatId, text: btn.dataset.sticker, type: 'sticker' });
      stickerSheet.classList.remove('open');
    });
  });
  stickerSheet.classList.add('open');
});

// Закрытие модалок
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => el.closest('.modal, .sheet').classList.remove('open'));
});

// Мобильная кнопка назад
backBtn.addEventListener('click', () => {
  document.body.classList.remove('chat-open');
  activeChatId = null;
});