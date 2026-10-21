const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// Все данные — в папку /data (для Amvera), локально — в корень
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

const ADMIN_USERNAME = 'durov';

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Ошибка сохранения', file, e); }
}

// users: { username: { displayName, passwordHash, salt, color, createdAt } }
let users = loadJSON(USERS_FILE, {});
// chats: { chatId: { id, type: 'private'|'group'|'channel'|'bot', title, members: [], owner, color } }
let chats = loadJSON(CHATS_FILE, {});
// history: { chatId: [ {id, from, type, text, time} ] }
let history = loadJSON(HISTORY_FILE, {});

const online = new Map(); // username -> socketId

// ---------- Пароли ----------
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }

function colorFor(str) {
  const colors = ['#e17076', '#7bc862', '#e5ca77', '#65aadd', '#a695e7',
                  '#ee7aae', '#6ec9cb', '#faa774', '#8e9aaf', '#c47c8b'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function isValidUsername(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }

// ---------- Утилиты ----------
function nowTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

function publicUsers() {
  return Object.keys(users).map(uname => ({
    username: uname,
    displayName: users[uname].displayName || uname,
    color: users[uname].color,
    online: online.has(uname),
  }));
}

function userChats(username) {
  return Object.values(chats).filter(c => 
    c.members.includes(username) || c.owner === username || c.type === 'bot'
  );
}

function getHistoryForChats(chatIds) {
  const result = {};
  chatIds.forEach(id => { result[id] = history[id] || []; });
  return result;
}

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('login', ({ username, password }, callback) => {
    username = String(username || '').trim();
    password = String(password || '');
    
    if (!isValidUsername(username)) {
      return callback({ ok: false, error: 'Логин: 3-20 символов, латиница/цифры/_' });
    }
    if (!password || password.length < 3) {
      return callback({ ok: false, error: 'Пароль минимум 3 символа' });
    }

    const exists = users[username];
    if (exists) {
      if (hashPassword(password, exists.salt) !== exists.passwordHash) {
        return callback({ ok: false, error: 'Неверный пароль' });
      }
    } else {
      const salt = makeSalt();
      users[username] = {
        salt,
        passwordHash: hashPassword(password, salt),
        displayName: username,
        color: colorFor(username),
        createdAt: Date.now(),
      };
      saveJSON(USERS_FILE, users);
    }

    if (online.has(username)) return callback({ ok: false, error: 'Этот username уже в сети' });
    online.set(username, socket.id);
    socket.username = username;

    // Создаем личный чат с ботом при первом входе, если его нет
    const botId = 'bot_' + username;
    if (!chats[botId]) {
      chats[botId] = {
        id: botId,
        type: 'bot',
        title: 'Messenger Bot',
        members: [username],
        owner: 'system',
        color: '#3390ec'
      };
      saveJSON(CHATS_FILE, chats);
    }

    const myChats = userChats(username);
    io.emit('users', publicUsers());

    callback({
      ok: true,
      me: { username, displayName: users[username].displayName, color: users[username].color },
      chats: myChats,
      history: getHistoryForChats(myChats.map(c => c.id)),
      users: publicUsers(),
    });
  });

  // Отправка сообщения
  socket.on('send', ({ chatId, text, type = 'text' }, callback) => {
    const from = socket.username;
    if (!from || !chatId || !text) return;
    
    const chat = chats[chatId];
    if (!chat) return;

    // Проверка прав для каналов
    if (chat.type === 'channel' && chat.owner !== from) {
      return callback({ ok: false, error: 'В канале может писать только владелец' });
    }

    const msg = { id: crypto.randomBytes(6).toString('hex'), from, type, text, time: nowTime() };
    if (!history[chatId]) history[chatId] = [];
    history[chatId].push(msg);
    saveJSON(HISTORY_FILE, history);

    // Рассылка всем участникам
    chat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('message', { chatId, msg });
    });

    // Если это бот, отвечаем
    if (chat.type === 'bot') {
      setTimeout(() => {
        let reply = 'Я пока не умею многого, но скоро научусь!';
        const lower = text.toLowerCase();
        if (lower.includes('привет')) reply = 'Привет! 👋';
        else if (lower.includes('как дела')) reply = 'У меня всё отлично! А у тебя?';
        else if (lower.includes('стикер')) reply = '🎨';
        
        const botMsg = { id: crypto.randomBytes(6).toString('hex'), from: 'system', type: 'text', text: reply, time: nowTime() };
        history[chatId].push(botMsg);
        saveJSON(HISTORY_FILE, history);
        
        chat.members.forEach(member => {
          const sid = online.get(member);
          if (sid) io.to(sid).emit('message', { chatId, msg: botMsg });
        });
      }, 1000);
    }

    if (callback) callback({ ok: true });
  });

  // Создание чата/группы/канала
  socket.on('create-chat', ({ type, title, members }, callback) => {
    const from = socket.username;
    if (!from || !title || !type) return;

    // Для личных чатов генерируем ID, чтобы он был одинаковым у обоих
    let chatId;
    if (type === 'private') {
      chatId = 'private_' + [from, members[0]].sort().join('_');
    } else {
      chatId = type + '_' + crypto.randomBytes(4).toString('hex');
    }

    if (chats[chatId]) {
      return callback({ ok: true, chat: chats[chatId] }); // Уже существует
    }

    const newChat = {
      id: chatId,
      type,
      title,
      members: [from, ...(members || [])],
      owner: from,
      color: colorFor(title),
    };
    chats[chatId] = newChat;
    saveJSON(CHATS_FILE, chats);

    // Оповещаем всех участников
    newChat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('new-chat', newChat);
    });

    if (callback) callback({ ok: true, chat: newChat });
  });

  socket.on('disconnect', () => {
    if (socket.username && online.get(socket.username) === socket.id) {
      online.delete(socket.username);
      io.emit('users', publicUsers());
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Сервер: http://localhost:' + PORT);
});