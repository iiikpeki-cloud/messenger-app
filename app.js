const socket = io();

// ---------- Состояние ----------
let myName = null;
let myDisplay = null;
let myColor = '#3390ec';
let isAdmin = false;
let activeUser = null;
let allUsers = [];
let searchQuery = '';
const chatHistory = {};

// ---------- Настройки ----------
const SETTINGS_KEY = 'messenger_settings';
const defaultSettings = {
  theme: 'light',
  accent: 'blue',
  fontSize: 'medium',
  showOnline: true,
};
let settings = loadSettings();

function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...defaultSettings }; }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function applySettings() {
  document.body.classList.remove('theme-dark', 'accent-blue', 'accent-green', 'accent-purple',
                                  'accent-orange', 'accent-red', 'accent-pink', 'accent-teal',
                                  'font-small', 'font-medium', 'font-large');
  if (settings.theme === 'dark') document.body.classList.add('theme-dark');
  document.body.classList.add('accent-' + settings.accent);
  document.body.classList.add('font-' + settings.fontSize);
  saveSettings();
}
applySettings();

// ---------- Элементы ----------
const loginScreen = document.getElementById('loginScreen');
const nameScreen = document.getElementById('nameScreen');
const appScreen = document.getElementById('appScreen');
const loginInput = document.getElementById('loginInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const displayNameInput = document.getElementById('displayNameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const nameError = document.getElementById('nameError');

const meAvatar = document.getElementById('meAvatar');
const meLabel = document.getElementById('meLabel');
const myProfileBtn = document.getElementById('myProfileBtn');
const adminBtn = document.getElementById('adminBtn');
const settingsBtn = document.getElementById('settingsBtn');
const searchInput = document.getElementById('searchInput');

const chatListEl = document.getElementById('chatList');
const noUsersEl = document.getElementById('noUsers');
const messagesEl = document.getElementById('messages');
const emptyChatEl = document.getElementById('emptyChat');
const chatNameEl = document.getElementById('chatName');
const chatStatusEl = document.getElementById('chatStatus');
const chatAvatarEl = document.getElementById('chatAvatar');
const chatUserBtn = document.getElementById('chatUserBtn');
const composer = document.getElementById('composer');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const backBtn = document.getElementById('backBtn');
const giftBtn = document.getElementById('giftBtn');

const giftSheet = document.getElementById('giftSheet');
const giftGrid = document.getElementById('giftGrid');
const profileModal = document.getElementById('profileModal');
const profileContent = document.getElementById('profileContent');
const settingsScreen = document.getElementById('settingsScreen');
const settingsBack = document.getElementById('settingsBack');
const settingsBody = document.getElementById('settingsBody');

const adminScreen = document.getElementById('adminScreen');
const adminBack = document.getElementById('adminBack');
const adminBody = document.getElementById('adminBody');

// ---------- Утилиты ----------
function initial(name) { return String(name || '?').trim().charAt(0).toUpperCase(); }
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
function findUser(uname) { return allUsers.find(u => u.username === uname); }

// ---------- Вход ----------
function doLogin() {
  const username = loginInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    loginError.textContent = 'Введите username и пароль';
    return;
  }
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Подключение...';

  socket.emit('login', { username, password }, (res) => {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Войти';

    if (!res.ok) {
      loginError.textContent = res.error;
      return;
    }

    myName = res.me.username;
    myDisplay = res.me.displayName;
    myColor = res.me.color;
    isAdmin = !!res.isAdmin;
    Object.assign(chatHistory, res.history || {});

    meAvatar.textContent = initial(myDisplay);
    meAvatar.style.background = myColor;
    meLabel.textContent = myDisplay;
    if (isAdmin) adminBtn.style.display = 'flex';

    loginScreen.style.display = 'none';

    if (res.isNew) {
      nameScreen.style.display = 'flex';
      displayNameInput.focus();
    } else {
      appScreen.style.display = 'flex';
      renderUsers();
      input.focus();
    }
  });
}

loginBtn.addEventListener('click', doLogin);
loginInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

function saveDisplayName() {
  const name = displayNameInput.value.trim();
  if (!name) { nameError.textContent = 'Введите имя'; return; }
  nameError.textContent = '';
  socket.emit('set-display-name', name, (res) => {
    if (!res.ok) { nameError.textContent = res.error || 'Ошибка'; return; }
    myDisplay = res.me.displayName;
    meAvatar.textContent = initial(myDisplay);
    meLabel.textContent = myDisplay;
    nameScreen.style.display = 'none';
    appScreen.style.display = 'flex';
    renderUsers();
    input.focus();
  });
}

saveNameBtn.addEventListener('click', saveDisplayName);
displayNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDisplayName(); });

// ---------- Список пользователей ----------
socket.on('users', (list) => {
  allUsers = list.filter(u => u.username !== myName);
  renderUsers();
  renderChatHeader();
  if (activeUser && !allUsers.find(u => u.username === activeUser)) {
    activeUser = null;
    document.body.classList.remove('chat-open');
    renderChatHeader();
    renderMessages();
  }
});

function renderUsers() {
  chatListEl.innerHTML = '';
  const filtered = allUsers
    .filter(u => {
      const q = searchQuery.toLowerCase();
      return u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

  if (filtered.length === 0) {
    noUsersEl.style.display = 'block';
    noUsersEl.textContent = searchQuery ? 'Никого не найдено' : 'Пока никого нет.';
    return;
  }
  noUsersEl.style.display = 'none';

  filtered.forEach(user => {
    const msgs = chatHistory[user.username] || [];
    const last = msgs[msgs.length - 1];
    const li = document.createElement('li');
    li.className = 'chat-item' + (user.username === activeUser ? ' active' : '');
    li.innerHTML = `
      <div class="chat-item__avatar ${user.online ? 'online' : ''}" style="background:${user.color}">
        ${initial(user.displayName)}
        <span class="chat-item__status"></span>
      </div>
      <div class="chat-item__body">
        <div class="chat-item__top">
          <span class="chat-item__name">${escapeHtml(user.displayName)}</span>
          <span class="chat-item__time">${last ? last.time : ''}</span>
        </div>
        <div class="chat-item__last">${last ? (last.from === myName ? 'Вы: ' : '') + escapeHtml(last.text || '🎁') : 'Нет сообщений'}</div>
      </div>
    `;
    li.addEventListener('click', () => openChat(user.username));
    chatListEl.appendChild(li);
  });
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderUsers();
});

// ---------- Открыть чат ----------
function openChat(username) {
  activeUser = username;
  if (!chatHistory[username]) chatHistory[username] = [];
  renderChatHeader();
  renderMessages();
  renderUsers();
  input.disabled = false;
  sendBtn.disabled = false;
  document.body.classList.add('chat-open');
  input.focus();
}

function renderChatHeader() {
  if (!activeUser) {
    chatNameEl.textContent = 'Выберите собеседника';
    chatStatusEl.textContent = '';
    chatStatusEl.className = 'chat__status';
    chatAvatarEl.textContent = '?';
    chatAvatarEl.style.background = 'var(--accent)';
    input.disabled = true;
    sendBtn.disabled = true;
    giftBtn.style.display = 'none';
    return;
  }
  const user = findUser(activeUser);
  chatNameEl.textContent = user ? user.displayName : activeUser;
  chatAvatarEl.textContent = initial(user ? user.displayName : activeUser);
  chatAvatarEl.style.background = user ? user.color : 'var(--accent)';
  if (user && user.online && settings.showOnline) {
    chatStatusEl.textContent = 'онлайн';
    chatStatusEl.className = 'chat__status online';
  } else {
    chatStatusEl.textContent = 'не в сети';
    chatStatusEl.className = 'chat__status';
  }
  giftBtn.style.display = 'flex';
}

function renderMessages() {
  messagesEl.innerHTML = '';
  if (!activeUser) {
    messagesEl.appendChild(emptyChatEl);
    emptyChatEl.style.display = '';
    return;
  }
  emptyChatEl.style.display = 'none';
  const msgs = chatHistory[activeUser] || [];
  msgs.forEach(m => {
    const div = document.createElement('div');
    if (m.type === 'gift') {
      div.className = 'msg ' + (m.from === myName ? 'out' : 'in') + ' msg--gift';
      div.innerHTML = `<span style="font-size:48px">${m.text}</span>`;
    } else if (m.type === 'nft') {
      div.className = 'msg ' + (m.from === myName ? 'out' : 'in') + ' msg--nft';
      div.innerHTML = `${escapeHtml(m.text)}<span class="msg__time">${m.time}</span>`;
    } else {
      div.className = 'msg ' + (m.from === myName ? 'out' : 'in');
      div.innerHTML = `${escapeHtml(m.text)}<span class="msg__time">${m.time}</span>`;
    }
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Отправка ----------
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !activeUser) return;
  socket.emit('send', { to: activeUser, text });
  input.value = '';
});

socket.on('message', (msg) => {
  const other = msg.from === myName ? msg.to : msg.from;
  if (!chatHistory[other]) chatHistory[other] = [];
  const exists = chatHistory[other].some(m =>
    m.from === msg.from && m.text === msg.text && m.time === msg.time);
  if (!exists) chatHistory[other].push(msg);
  if (other === activeUser) renderMessages();
  renderUsers();
});

// Broadcast от админа
socket.on('broadcast', (msg) => {
  alert('📢 ' + msg.text.replace('📢 ', ''));
});

socket.on('banned', () => {
  alert('Ваш аккаунт заблокирован администратором.');
  location.reload();
});

socket.on('profile-updated', (profile) => {
  if (!profile) return;
  if (profile.username === myName) {
    myDisplay = profile.displayName;
    myColor = profile.color;
    meAvatar.textContent = initial(myDisplay);
    meAvatar.style.background = myColor;
    meLabel.textContent = myDisplay;
  }
});

// ---------- Профиль ----------
function openProfile(username) {
  socket.emit('get-profile', username, (profile) => {
    if (!profile) return;
    const joinDate = profile.createdAt
      ? new Date(profile.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';

    let nftsHtml = '';
    if (profile.nfts && profile.nfts.length > 0) {
      nftsHtml = `<div class="profile__nfts">${profile.nfts.map(n => `
        <div class="profile__nft">
          <div class="profile__nft__emoji">${n.emoji}</div>
          <div class="profile__nft__name">${escapeHtml(n.name)}</div>
          <div class="profile__nft__rarity" style="color:${n.rarityColor || 'var(--text-muted)'}">${n.rarity || ''}</div>
        </div>
      `).join('')}</div>`;
    } else {
      nftsHtml = `<div class="profile__empty">Нет NFT</div>`;
    }

    const badges = [];
    if (profile.isAdmin) badges.push('<span class="admin-badge admin-badge--admin">ADMIN</span>');
    if (profile.banned) badges.push('<span class="admin-badge admin-badge--banned">BANNED</span>');

    profileContent.innerHTML = `
      <div class="profile">
        <div class="profile__avatar" style="background:${profile.color}">${initial(profile.displayName)}</div>
        <div class="profile__name">${escapeHtml(profile.displayName)} ${badges.join(' ')}</div>
        <div class="profile__username">@${escapeHtml(profile.username)}</div>
        <div class="profile__status ${profile.online && settings.showOnline ? 'online' : ''}">
          ${profile.online && settings.showOnline ? 'онлайн' : 'не в сети'}
        </div>
      </div>
      <div class="profile__stats">
        <div class="profile__stat"><b>${profile.giftTotal || 0}</b><span>подарков</span></div>
        <div class="profile__stat"><b>${profile.stars || 0}</b><span>⭐</span></div>
        <div class="profile__stat"><b>${(profile.nfts || []).length}</b><span>NFT</span></div>
      </div>
      <div class="profile__section">
        <div class="profile__label">Дата регистрации</div>
        <div>${joinDate}</div>
      </div>
      <div class="profile__section">
        <div class="profile__label">NFT</div>
        ${nftsHtml}
      </div>
    `;
    profileModal.classList.add('open');
  });
}

myProfileBtn.addEventListener('click', () => openProfile(myName));
chatUserBtn.addEventListener('click', () => { if (activeUser) openProfile(activeUser); });

// ---------- Подарки ----------
const GIFTS = ['🌹', '🍫', '🧸', '🎂', '💎', '🎈', '🎁', '🌷', '🍰', '🏆', '🐱', '💝'];

giftBtn.addEventListener('click', () => {
  giftGrid.innerHTML = '';
  GIFTS.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'gift-item';
    btn.type = 'button';
    btn.textContent = g;
    btn.addEventListener('click', () => {
      if (!activeUser) return;
      socket.emit('send-gift', { to: activeUser, emoji: g });
      giftSheet.classList.remove('open');
    });
    giftGrid.appendChild(btn);
  });
  giftSheet.classList.add('open');
});

document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => el.closest('.modal, .sheet').classList.remove('open'));
});

// ---------- Настройки ----------
settingsBtn.addEventListener('click', () => { renderSettings(); settingsScreen.classList.add('open'); });
settingsBack.addEventListener('click', () => settingsScreen.classList.remove('open'));

function renderSettings() {
  const accents = [
    { value: 'blue', color: '#3390ec' }, { value: 'green', color: '#4fae4e' },
    { value: 'purple', color: '#a695e7' }, { value: 'orange', color: '#f5822a' },
    { value: 'red', color: '#e53935' }, { value: 'pink', color: '#ee7aae' },
    { value: 'teal', color: '#1fb6a6' },
  ];

  settingsBody.innerHTML = `
    <div class="settings-section">
      <h3>Внешний вид</h3>
      <div class="theme-options">
        <div class="theme-option ${settings.theme === 'light' ? 'active' : ''}" data-theme="light">
          <div class="theme-option__preview theme-option__preview--light"></div>
          <div class="theme-option__label">Светлая</div>
        </div>
        <div class="theme-option ${settings.theme === 'dark' ? 'active' : ''}" data-theme="dark">
          <div class="theme-option__preview theme-option__preview--dark"></div>
          <div class="theme-option__label">Тёмная</div>
        </div>
      </div>
      <div style="padding: 0 16px 8px; color: var(--text-muted); font-size: 12px;">Акцентный цвет</div>
      <div class="color-options">
        ${accents.map(a => `
          <div class="color-option ${settings.accent === a.value ? 'active' : ''}" data-accent="${a.value}" style="background:${a.color}"></div>
        `).join('')}
      </div>
      <div class="settings-row" style="cursor:default">
        <div class="settings-row__icon">🔤</div>
        <div class="settings-row__body"><div class="settings-row__title">Размер шрифта</div></div>
        <select id="fontSizeSelect">
          <option value="small" ${settings.fontSize === 'small' ? 'selected' : ''}>Мелкий</option>
          <option value="medium" ${settings.fontSize === 'medium' ? 'selected' : ''}>Средний</option>
          <option value="large" ${settings.fontSize === 'large' ? 'selected' : ''}>Крупный</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <h3>Приватность</h3>
      <div class="settings-row" style="cursor:default">
        <div class="settings-row__icon">👁</div>
        <div class="settings-row__body"><div class="settings-row__title">Показывать онлайн-статус</div></div>
        <label class="switch">
          <input type="checkbox" id="showOnlineToggle" ${settings.showOnline ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <h3>Аккаунт</h3>
      <div class="settings-row" id="changeNameRow">
        <div class="settings-row__icon">✏️</div>
        <div class="settings-row__body">
          <div class="settings-row__title">Сменить имя</div>
          <div class="settings-row__sub">${escapeHtml(myDisplay || '')}</div>
        </div>
      </div>
      <div class="settings-row" id="changePasswordRow">
        <div class="settings-row__icon">🔒</div>
        <div class="settings-row__body"><div class="settings-row__title">Сменить пароль</div></div>
      </div>
      <div class="settings-row" id="logoutRow">
        <div class="settings-row__icon" style="color:var(--red)">🚪</div>
        <div class="settings-row__body"><div class="settings-row__title" style="color:var(--red)">Выйти</div></div>
      </div>
    </div>

    ${isAdmin ? `
      <div class="settings-section">
        <h3>Администратор</h3>
        <div class="settings-row" id="openAdminRow">
          <div class="settings-row__icon">🛡</div>
          <div class="settings-row__body"><div class="settings-row__title">Админ-панель</div></div>
          <div class="settings-row__value">→</div>
        </div>
      </div>
    ` : ''}

    <div class="settings-section">
      <h3>О приложении</h3>
      <div class="settings-row" style="cursor:default">
        <div class="settings-row__icon">ℹ️</div>
        <div class="settings-row__body"><div class="settings-row__title">Версия</div></div>
        <div class="settings-row__value">1.1</div>
      </div>
    </div>
  `;

  settingsBody.querySelectorAll('[data-theme]').forEach(el => {
    el.addEventListener('click', () => {
      settings.theme = el.dataset.theme;
      applySettings();
      renderSettings();
    });
  });
  settingsBody.querySelectorAll('[data-accent]').forEach(el => {
    el.addEventListener('click', () => {
      settings.accent = el.dataset.accent;
      applySettings();
      renderSettings();
    });
  });
  document.getElementById('fontSizeSelect').addEventListener('change', (e) => {
    settings.fontSize = e.target.value; applySettings();
  });
  document.getElementById('showOnlineToggle').addEventListener('change', (e) => {
    settings.showOnline = e.target.checked; applySettings();
    renderChatHeader(); renderUsers();
  });
  document.getElementById('changeNameRow').addEventListener('click', () => {
    const newName = prompt('Новое имя:', myDisplay);
    if (newName && newName.trim()) {
      socket.emit('set-display-name', newName.trim(), (res) => {
        if (res.ok) {
          myDisplay = res.me.displayName;
          meLabel.textContent = myDisplay;
          meAvatar.textContent = initial(myDisplay);
          renderUsers();
          renderSettings();
        } else alert(res.error || 'Ошибка');
      });
    }
  });
  document.getElementById('changePasswordRow').addEventListener('click', () => {
    const oldPw = prompt('Старый пароль:'); if (!oldPw) return;
    const newPw = prompt('Новый пароль (мин. 3 символа):'); if (!newPw) return;
    socket.emit('changePassword', { oldPassword: oldPw, newPassword: newPw }, (res) => {
      alert(res.ok ? 'Пароль изменён' : (res.error || 'Ошибка'));
    });
  });
  document.getElementById('logoutRow').addEventListener('click', () => {
    if (confirm('Выйти из аккаунта?')) location.reload();
  });
  if (isAdmin) {
    document.getElementById('openAdminRow').addEventListener('click', () => {
      settingsScreen.classList.remove('open');
      openAdmin();
    });
  }
}

// ---------- Админ-панель ----------
adminBtn.addEventListener('click', openAdmin);
adminBack.addEventListener('click', () => adminScreen.classList.remove('open'));

function openAdmin() {
  renderAdmin();
  adminScreen.classList.add('open');
}

function renderAdmin() {
  socket.emit('admin:get-data', (res) => {
    if (!res.ok) {
      adminBody.innerHTML = `<div class="no-users">${res.error || 'Нет доступа'}</div>`;
      return;
    }
    const { stats, users } = res;

    const usersHtml = users.map(u => {
      const joinDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—';
      const badges = [];
      if (u.isAdmin) badges.push('<span class="admin-badge admin-badge--admin">ADMIN</span>');
      if (u.online) badges.push('<span class="admin-badge admin-badge--online">ONLINE</span>');
      if (u.banned) badges.push('<span class="admin-badge admin-badge--banned">BANNED</span>');

      const actions = [];
      if (!u.isAdmin) {
        actions.push(`<button class="admin-action" data-act="stars" data-user="${u.username}">+100 ⭐</button>`);
        actions.push(`<button class="admin-action" data-act="nft" data-user="${u.username}">+NFT</button>`);
        if (u.banned) actions.push(`<button class="admin-action" data-act="unban" data-user="${u.username}">Разбан</button>`);
        else actions.push(`<button class="admin-action danger" data-act="ban" data-user="${u.username}">Бан</button>`);
        actions.push(`<button class="admin-action danger" data-act="delete" data-user="${u.username}">Удалить</button>`);
      }

      return `
        <div class="admin-user">
          <div class="admin-user__avatar" style="background:${u.color}">${initial(u.displayName)}</div>
          <div class="admin-user__info">
            <div class="admin-user__name">${escapeHtml(u.displayName)} ${badges.join(' ')}</div>
            <div class="admin-user__sub">@${escapeHtml(u.username)} · ⭐${u.stars} · NFT:${u.nftCount} · ${joinDate}</div>
          </div>
          <div class="admin-user__actions">${actions.join('')}</div>
        </div>
      `;
    }).join('');

    adminBody.innerHTML = `
      <div class="admin-stats">
        <div class="admin-stat"><div class="admin-stat__value">${stats.totalUsers}</div><div class="admin-stat__label">Пользователей</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${stats.onlineUsers}</div><div class="admin-stat__label">Онлайн</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${stats.totalMessages}</div><div class="admin-stat__label">Сообщений</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${stats.totalGifts}</div><div class="admin-stat__label">Подарков</div></div>
        <div class="admin-stat"><div class="admin-stat__value">${stats.totalNftObjects}</div><div class="admin-stat__label">NFT</div></div>
      </div>

      <div class="settings-section">
        <h3>Broadcast (всем онлайн)</h3>
        <div class="admin-broadcast">
          <input type="text" id="broadcastInput" placeholder="Текст сообщения...">
          <button id="broadcastBtn">Отправить</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Пользователи (${users.length})</h3>
        ${usersHtml}
      </div>
    `;

    document.getElementById('broadcastBtn').addEventListener('click', () => {
      const val = document.getElementById('broadcastInput').value.trim();
      if (!val) return;
      socket.emit('admin:broadcast', { text: val }, (r) => {
        alert(r.ok ? 'Отправлено' : (r.error || 'Ошибка'));
        if (r.ok) document.getElementById('broadcastInput').value = '';
      });
    });

    adminBody.querySelectorAll('.admin-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        const target = btn.dataset.user;
        if (act === 'stars') {
          socket.emit('admin:give-stars', { target, amount: 100 }, () => renderAdmin());
        } else if (act === 'nft') {
          socket.emit('admin:give-nft', { target }, (r) => {
            if (r.ok) alert(`Выдан NFT: ${r.nft.emoji} ${r.nft.name}`);
            renderAdmin();
          });
        } else if (act === 'ban') {
          if (confirm(`Забанить @${target}?`)) {
            socket.emit('admin:ban', { target, banned: true }, () => renderAdmin());
          }
        } else if (act === 'unban') {
          socket.emit('admin:ban', { target, banned: false }, () => renderAdmin());
        } else if (act === 'delete') {
          if (confirm(`УДАЛИТЬ @${target}? Все сообщения и NFT будут удалены.`)) {
            socket.emit('admin:delete-user', { target }, () => renderAdmin());
          }
        }
      });
    });
  });
}

// ---------- Мобильная кнопка назад ----------
backBtn.addEventListener('click', () => {
  document.body.classList.remove('chat-open');
  activeUser = null;
  renderChatHeader();
  renderMessages();
  renderUsers();
});