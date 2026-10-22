const socket = io();

let myName = null, myColor = '#3390ec', activeChatId = null;
let myChats = [], myHistory = {}, allUsers = [], isAdmin = false;
let searchQuery = '', createType = null;

const defaultSettings = { theme: 'light', accent: 'blue', fontSize: 'medium' };
let settings = JSON.parse(localStorage.getItem('ms_settings') || '{}');
function applySettings() {
  document.body.className = '';
  if (settings.theme === 'dark') document.body.classList.add('theme-dark');
  document.body.classList.add('accent-' + (settings.accent || 'blue'));
  document.body.classList.add('font-' + (settings.fontSize || 'medium'));
  localStorage.setItem('ms_settings', JSON.stringify(settings));
}

const els = {
  login: document.getElementById('loginScreen'), name: document.getElementById('nameScreen'), app: document.getElementById('appScreen'),
  loginInput: document.getElementById('loginInput'), passInput: document.getElementById('passwordInput'), loginBtn: document.getElementById('loginBtn'), loginErr: document.getElementById('loginError'),
  nameInput: document.getElementById('displayNameInput'), saveNameBtn: document.getElementById('saveNameBtn'), nameErr: document.getElementById('nameError'),
  meAvatar: document.getElementById('meAvatar'), meLabel: document.getElementById('meLabel'), myProfileBtn: document.getElementById('myProfileBtn'),
  adminBtn: document.getElementById('adminBtn'), settingsBtn: document.getElementById('settingsBtn'), search: document.getElementById('searchInput'), chatList: document.getElementById('chatList'),
  chatAvatar: document.getElementById('chatAvatar'), chatName: document.getElementById('chatName'), chatStatus: document.getElementById('chatStatus'),
  msgs: document.getElementById('messages'), composer: document.getElementById('composer'), input: document.getElementById('messageInput'), sendBtn: document.getElementById('sendBtn'),
  backBtn: document.getElementById('backBtn'), stickerBtn: document.getElementById('stickerBtn'), giftBtn: document.getElementById('giftBtn'),
  mediaBtn: document.getElementById('mediaBtn'), mediaInput: document.getElementById('mediaInput'),
  createModal: document.getElementById('createModal'), createMenu: document.getElementById('createMenu'), createForm: document.getElementById('createForm'),
  newTitle: document.getElementById('newTitle'), newMembers: document.getElementById('newMembers'), createSubmit: document.getElementById('createSubmit'),
  stickerSheet: document.getElementById('stickerSheet'), stickerGrid: document.getElementById('stickerGrid'),
  giftSheet: document.getElementById('giftSheet'), giftGrid: document.getElementById('giftGrid'),
  settingsScreen: document.getElementById('settingsScreen'), settingsBack: document.getElementById('settingsBack'), settingsBody: document.getElementById('settingsBody'),
  adminScreen: document.getElementById('adminScreen'), adminBack: document.getElementById('adminBack'), adminBody: document.getElementById('adminBody'),
};

const initial = n => String(n||'?').charAt(0).toUpperCase();
const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const findUser = u => allUsers.find(x => x.username === u);

applySettings();

els.loginBtn.onclick = () => {
  const u = els.loginInput.value.trim(), p = els.passInput.value;
  if (!u || !p) return;
  socket.emit('login', { username: u, password: p }, res => {
    if (!res.ok) { els.loginErr.textContent = res.error; return; }
    myName = res.me.username; myColor = res.me.color; isAdmin = res.isAdmin;
    myChats = res.chats; myHistory = res.history; allUsers = res.users;
    els.meAvatar.textContent = initial(res.me.displayName); els.meAvatar.style.background = myColor;
    els.meLabel.textContent = res.me.displayName;
    if (isAdmin) els.adminBtn.style.display = 'flex';
    els.login.style.display = 'none'; els.app.style.display = 'flex';
    renderChats();
  });
};

els.saveNameBtn.onclick = () => {
  const n = els.nameInput.value.trim();
  if (!n) return;
  socket.emit('set-display-name', n, res => {
    if (res.ok) {
      els.meLabel.textContent = n; els.meAvatar.textContent = initial(n);
      els.name.style.display = 'none'; els.app.style.display = 'flex'; renderChats();
    } else els.nameErr.textContent = res.error;
  });
};

function renderChats() {
  els.chatList.innerHTML = '';
  const q = searchQuery.toLowerCase();
  const filtered = myChats.filter(chat => {
    let title = chat.title;
    if (chat.type === 'private') {
      const other = chat.members.find(m => m !== myName);
      title = findUser(other)?.displayName || other;
    }
    return title.toLowerCase().includes(q);
  });

  filtered.sort((a, b) => {
    const lastA = myHistory[a.id]?.slice(-1)[0]?.id || '';
    const lastB = myHistory[b.id]?.slice(-1)[0]?.id || '';
    return lastB.localeCompare(lastA);
  });

  filtered.forEach(chat => {
    let title = chat.title;
    if (chat.type === 'private') {
      const other = chat.members.find(m => m !== myName);
      title = findUser(other)?.displayName || other;
    }
    const msgs = myHistory[chat.id] || [];
    const last = msgs[msgs.length - 1];

    const li = document.createElement('li');
    li.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
    li.innerHTML = `
      <div class="chat-item__avatar" style="background:${chat.color}">${initial(title)}</div>
      <div class="chat-item__body">
        <div class="chat-item__top">
          <span class="chat-item__name">${esc(title)}</span>
          <span class="chat-item__time">${last ? last.time : ''}</span>
        </div>
        <div class="chat-item__last">${last ? (last.from === myName ? 'Вы: ' : '') + esc(last.text || '🎨') : 'Нет сообщений'}</div>
      </div>
    `;
    li.onclick = () => openChat(chat.id);
    els.chatList.appendChild(li);
  });
}

els.search.oninput = e => { searchQuery = e.target.value; renderChats(); };

function openChat(id) {
  activeChatId = id;
  const chat = myChats.find(c => c.id === id);
  if (!chat) return;
  let title = chat.title;
  if (chat.type === 'private') {
    const other = chat.members.find(m => m !== myName);
    title = findUser(other)?.displayName || other;
  }
  els.chatAvatar.textContent = initial(title); els.chatAvatar.style.background = chat.color;
  els.chatName.textContent = title;
  els.chatStatus.textContent = chat.type === 'group' ? 'группа' : chat.type === 'channel' ? 'канал' : chat.type === 'bot' ? 'бот' : 'личный чат';
  
  if (chat.type === 'channel' && chat.owner !== myName) {
    els.input.disabled = true; els.sendBtn.disabled = true; els.input.placeholder = 'Только владелец может писать';
  } else {
    els.input.disabled = false; els.sendBtn.disabled = false; els.input.placeholder = 'Сообщение';
  }
  renderMessages(); renderChats(); document.body.classList.add('chat-open');
}

function renderMessages() {
  els.msgs.innerHTML = '';
  const msgs = myHistory[activeChatId] || [];
  const chat = myChats.find(c => c.id === activeChatId);
  
  if (chat.type === 'bot' && msgs.length === 0) {
    const startDiv = document.createElement('div');
    startDiv.style.textAlign = 'center';
    startDiv.style.margin = 'auto';
    startDiv.innerHTML = `<button class="start-btn" id="startBotBtn">/start</button>`;
    els.msgs.appendChild(startDiv);
    document.getElementById('startBotBtn').onclick = () => {
      socket.emit('send', { chatId: activeChatId, text: '/start' });
    };
  }

  msgs.forEach(m => {
    const div = document.createElement('div');
    const out = m.from === myName;
    div.className = 'msg ' + (out ? 'out' : 'in');
    
    if (m.type === 'sticker') {
      div.classList.add('msg--sticker'); div.innerHTML = `<span>${m.text}</span>`;
    } else if (m.type === 'media') {
      div.classList.add('msg--media');
      div.innerHTML = `<img src="${m.text}" alt="media"><span class="msg__time">${m.time}</span>`;
    } else {
      let author = '';
      if (!out && (chat.type === 'group' || chat.type === 'channel')) {
        const u = findUser(m.from);
        author = `<div class="msg__author" style="color:${u?.color || 'inherit'}">${esc(u?.displayName || m.from)}</div>`;
      }
      div.innerHTML = `${author}${esc(m.text)}<span class="msg__time">${m.time}</span>`;
    }
    els.msgs.appendChild(div);
  });
  els.msgs.scrollTop = els.msgs.scrollHeight;
}

els.composer.onsubmit = e => {
  e.preventDefault();
  const t = els.input.value.trim();
  if (!t || !activeChatId) return;
  socket.emit('send', { chatId: activeChatId, text: t });
  els.input.value = '';
};

// Медиа
els.mediaBtn.onclick = () => els.mediaInput.click();
els.mediaInput.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    socket.emit('send', { chatId: activeChatId, text: ev.target.result, type: 'media' });
    els.mediaInput.value = '';
  };
  reader.readAsDataURL(file);
};

socket.on('message', ({ chatId, msg }) => {
  if (!myHistory[chatId]) myHistory[chatId] = [];
  myHistory[chatId].push(msg);
  if (chatId === activeChatId) renderMessages();
  renderChats();
});
socket.on('new-chat', chat => {
  if (!myChats.find(c => c.id === chat.id)) { myChats.push(chat); myHistory[chat.id] = myHistory[chat.id] || []; renderChats(); }
});
socket.on('users', list => {
  allUsers = list.filter(u => u.username !== myName);
  renderChats(); if (activeChatId) renderMessages();
});

els.createModal.querySelectorAll('[data-close]').forEach(el => el.onclick = () => els.createModal.classList.remove('open'));
els.createMenu.querySelectorAll('.create-item').forEach(btn => {
  btn.onclick = () => {
    createType = btn.dataset.type; els.createMenu.style.display = 'none'; els.createForm.style.display = 'flex';
    els.newTitle.placeholder = createType === 'private' ? 'Имя друга' : 'Название';
    els.newMembers.innerHTML = (createType === 'group' || createType === 'channel') ? allUsers.map(u => `<label class="member-check"><input type="checkbox" value="${u.username}"> ${esc(u.displayName)}</label>`).join('') : '';
  };
});
els.createSubmit.onclick = () => {
  const title = els.newTitle.value.trim(); if (!title) return;
  let members = createType === 'private' ? [title] : Array.from(els.newMembers.querySelectorAll('input:checked')).map(i => i.value);
  socket.emit('create-chat', { type: createType, title, members }, res => {
    if (res.ok) { els.createModal.classList.remove('open'); if (!myChats.find(c => c.id === res.chat.id)) myChats.push(res.chat); openChat(res.chat.id); }
  });
};

const STICKERS = ['😀','😂','🥰','😎','🤔','😴','🤯','🥳','😭','🤬','👻','💩','🤖','👽','🐱','🐶','🐼','🦊','🍕','🍔','🍰','🍺','⚽','🎮','🎸','🚗','✈️','🏆','❤️','🔥','⭐','💎'];
els.stickerBtn.onclick = () => {
  els.stickerGrid.innerHTML = STICKERS.map(s => `<button class="sticker-item">${s}</button>`).join('');
  els.stickerGrid.querySelectorAll('.sticker-item').forEach(b => b.onclick = () => { socket.emit('send', { chatId: activeChatId, text: b.textContent, type: 'sticker' }); els.stickerSheet.classList.remove('open'); });
  els.stickerSheet.classList.add('open');
};

const GIFTS = ['🌹','🍫','🧸','🎂','💎','🎈','🎁','🌷','🍰','🏆','🐱','💝'];
els.giftBtn.onclick = () => {
  els.giftGrid.innerHTML = GIFTS.map(g => `<button class="gift-item">${g}</button>`).join('');
  els.giftGrid.querySelectorAll('.gift-item').forEach(b => b.onclick = () => { socket.emit('send-gift', { chatId: activeChatId, emoji: b.textContent }); els.giftSheet.classList.remove('open'); });
  els.giftSheet.classList.add('open');
};

document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => el.closest('.modal, .sheet').classList.remove('open'));

els.settingsBtn.onclick = () => { els.settingsBody.innerHTML = `
  <div class="settings-section"><h3>Тема</h3>
    <div class="settings-row"><select id="selTheme"><option value="light" ${settings.theme==='light'?'selected':''}>Светлая</option><option value="dark" ${settings.theme==='dark'?'selected':''}>Тёмная</option></select></div>
    <div class="settings-row"><select id="selFont"><option value="small" ${settings.fontSize==='small'?'selected':''}>Мелкий</option><option value="medium" ${settings.fontSize==='medium'?'selected':''}>Средний</option><option value="large" ${settings.fontSize==='large'?'selected':''}>Крупный</option></select></div>
  </div>`; 
  els.settingsScreen.classList.add('open');
  document.getElementById('selTheme').onchange = e => { settings.theme = e.target.value; applySettings(); };
  document.getElementById('selFont').onchange = e => { settings.fontSize = e.target.value; applySettings(); };
};
els.settingsBack.onclick = () => els.settingsScreen.classList.remove('open');

els.adminBtn.onclick = () => { socket.emit('admin:get-data', res => { els.adminBody.innerHTML = res.ok ? '<div class="settings-section">Админка работает</div>' : 'Нет доступа'; }); els.adminScreen.classList.add('open'); };
els.adminBack.onclick = () => els.adminScreen.classList.remove('open');

els.backBtn.onclick = () => { document.body.classList.remove('chat-open'); activeChatId = null; };