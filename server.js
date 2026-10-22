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

const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');

const ADMIN_USERNAME = 'durov';

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Ошибка сохранения', file, e); }
}

let users = loadJSON(USERS_FILE, {});
let history = loadJSON(HISTORY_FILE, {});
let chats = loadJSON(CHATS_FILE, {});
let bots = loadJSON(BOTS_FILE, {}); // { bot_username: { name, owner, description, replies: {} } }

const online = new Map();

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }

function colorFor(str) {
  const colors = ['#e17076', '#7bc862', '#e5ca77', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774', '#8e9aaf', '#c47c8b'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function isValidUsername(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }

function nowTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
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
  return Object.values(chats).filter(c => c.members.includes(username) || c.owner === username);
}

function publicProfile(uname) {
  const u = users[uname];
  if (!u) return null;
  let received = 0, sent = 0;
  for (const msgs of Object.values(history)) {
    for (const m of msgs) {
      if (m.type === 'gift' || m.type === 'nft') {
        if (m.to === uname) received++;
        if (m.from === uname) sent++;
      }
    }
  }
  return {
    username: uname, displayName: u.displayName || uname, color: u.color,
    online: online.has(uname), createdAt: u.createdAt,
    stars: u.stars || 0, gifts: u.gifts || {},
    giftTotal: Object.values(u.gifts || {}).reduce((s, n) => s + n, 0),
    giftsReceived: received, giftsSent: sent,
    isAdmin: uname === ADMIN_USERNAME, banned: !!u.banned,
  };
}

function broadcastProfile(uname) {
  io.emit('users', publicUsers());
  io.emit('profile-updated', publicProfile(uname));
}

function getStats() {
  let totalMessages = 0, totalGifts = 0, totalNfts = 0, totalStickers = 0;
  for (const msgs of Object.values(history)) {
    for (const m of msgs) {
      if (m.type === 'text') totalMessages++;
      if (m.type === 'gift') totalGifts++;
      if (m.type === 'nft') totalNfts++;
      if (m.type === 'sticker') totalStickers++;
    }
  }
  return {
    totalUsers: Object.keys(users).length, onlineUsers: online.size,
    totalMessages, totalGifts, totalNfts, totalStickers,
  };
}

// Обработка сообщений для ботов
function handleBotMessage(chatId, from, text) {
  const chat = chats[chatId];
  if (!chat || chat.type !== 'bot') return;

  const botName = chat.title.replace('🤖 ', '');
  const bot = bots[botName];
  if (!bot) return;

  // Логика для Sticker Bot
  if (botName === 'StickerBot') {
    const reply = `🎨 Вот твой стикер!\n\n[${text}]\n\nОтправь любой текст или эмодзи, и я сделаю из него стикер.`;
    const botMsg = { id: crypto.randomBytes(6).toString('hex'), from: 'system', type: 'text', text: reply, time: nowTime() };
    history[chatId].push(botMsg); saveJSON(HISTORY_FILE, history);
    chat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('message', { chatId, msg: botMsg });
    });
    return;
  }

  // Логика для BotFather
  if (botName === 'BotFather') {
    let reply = 'Я могу создать тебе бота. Просто отправь команду:\n/newbot ИмяБота';
    if (text.startsWith('/newbot ')) {
      const newBotName = text.slice(8).trim();
      if (!newBotName || !isValidUsername(newBotName)) {
        reply = 'Ошибка: имя бота должно быть на латинице, 3-20 символов.';
      } else if (bots[newBotName]) {
        reply = 'Ошибка: бот с таким именем уже существует.';
      } else {
        bots[newBotName] = {
          name: newBotName,
          owner: from,
          description: 'Создан через BotFather',
          replies: { 'привет': 'Привет! Я новый бот.', 'как дела': 'У меня всё отлично!' }
        };
        saveJSON(BOTS_FILE, bots);
        reply = `✅ Бот @${newBotName} успешно создан!\nТеперь ты можешь найти его в поиске чатов.`;
      }
    }
    const botMsg = { id: crypto.randomBytes(6).toString('hex'), from: 'system', type: 'text', text: reply, time: nowTime() };
    history[chatId].push(botMsg); saveJSON(HISTORY_FILE, history);
    chat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('message', { chatId, msg: botMsg });
    });
    return;
  }

  // Обычный бот (созданный пользователем)
  if (bot) {
    let reply = bot.replies[text.toLowerCase()] || 'Я не знаю такой команды.';
    const botMsg = { id: crypto.randomBytes(6).toString('hex'), from: 'system', type: 'text', text: reply, time: nowTime() };
    history[chatId].push(botMsg); saveJSON(HISTORY_FILE, history);
    chat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('message', { chatId, msg: botMsg });
    });
  }
}

io.on('connection', (socket) => {
  socket.on('login', ({ username, password }, callback) => {
    username = String(username || '').trim();
    password = String(password || '');
    if (!isValidUsername(username)) return callback({ ok: false, error: 'Логин: 3-20 символов, латиница/цифры/_' });
    if (!password || password.length < 3) return callback({ ok: false, error: 'Пароль минимум 3 символа' });

    const exists = users[username];
    if (exists) {
      if (exists.banned) return callback({ ok: false, error: 'Аккаунт заблокирован' });
      if (hashPassword(password, exists.salt) !== exists.passwordHash) return callback({ ok: false, error: 'Неверный пароль' });
    } else {
      const salt = makeSalt();
      users[username] = {
        salt, passwordHash: hashPassword(password, salt),
        displayName: username, color: colorFor(username),
        createdAt: Date.now(), stars: username === ADMIN_USERNAME ? 99999 : 100,
        gifts: {}, nftIds: [], banned: false,
      };
      if (username === ADMIN_USERNAME) users[username].displayName = 'Pavel Durov';
      saveJSON(USERS_FILE, users);
    }

    if (online.has(username)) return callback({ ok: false, error: 'Этот username уже в сети' });
    online.set(username, socket.id);
    socket.username = username;

    // Создаем чаты с ботами при входе, если их нет
    const systemBots = [
      { id: 'bot_sticker', title: '🤖 StickerBot' },
      { id: 'bot_father', title: '🤖 BotFather' }
    ];

    systemBots.forEach(sb => {
      if (!chats[sb.id]) {
        chats[sb.id] = { id: sb.id, type: 'bot', title: sb.title, members: [], owner: 'system', color: '#3390ec' };
      }
      if (!chats[sb.id].members.includes(username)) {
        chats[sb.id].members.push(username);
      }
    });
    saveJSON(CHATS_FILE, chats);

    const myChats = userChats(username);
    io.emit('users', publicUsers());

    callback({
      ok: true, me: publicProfile(username), chats: myChats,
      history: Object.fromEntries(myChats.map(c => [c.id, history[c.id] || []])),
      users: publicUsers(), isAdmin: username === ADMIN_USERNAME,
    });
  });

  socket.on('send', ({ chatId, text, type = 'text' }, callback) => {
    const from = socket.username;
    if (!from || !chatId || !text) return;
    const chat = chats[chatId];
    if (!chat) return;
    if (chat.type === 'channel' && chat.owner !== from) return callback({ ok: false, error: 'В канале может писать только владелец' });

    const msg = { id: crypto.randomBytes(6).toString('hex'), from, type, text, time: nowTime() };
    if (!history[chatId]) history[chatId] = [];
    history[chatId].push(msg);
    saveJSON(HISTORY_FILE, history);

    chat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('message', { chatId, msg });
    });

    if (chat.type === 'bot') {
      setTimeout(() => handleBotMessage(chatId, from, text), 500);
    }

    if (callback) callback({ ok: true });
  });

  socket.on('create-chat', ({ type, title, members }, callback) => {
    const from = socket.username;
    if (!from || !title || !type) return;

    let chatId;
    if (type === 'private') chatId = 'private_' + [from, members[0]].sort().join('_');
    else chatId = type + '_' + crypto.randomBytes(4).toString('hex');

    if (chats[chatId]) return callback({ ok: true, chat: chats[chatId] });

    const newChat = { id: chatId, type, title, members: [from, ...(members || [])], owner: from, color: colorFor(title) };
    chats[chatId] = newChat;
    saveJSON(CHATS_FILE, chats);

    newChat.members.forEach(member => {
      const sid = online.get(member);
      if (sid) io.to(sid).emit('new-chat', newChat);
    });
    if (callback) callback({ ok: true, chat: newChat });
  });

  // Поиск ботов (для создания чата с новым ботом)
  socket.on('find-bot', (botName, callback) => {
    const b = bots[botName];
    if (!b) return callback({ ok: false });
    const chatId = 'bot_' + botName;
    if (!chats[chatId]) {
      chats[chatId] = { id: chatId, type: 'bot', title: '🤖 ' + botName, members: [], owner: 'system', color: colorFor(botName) };
      saveJSON(CHATS_FILE, chats);
    }
    if (!chats[chatId].members.includes(socket.username)) {
      chats[chatId].members.push(socket.username);
      saveJSON(CHATS_FILE, chats);
    }
    const sid = online.get(socket.username);
    if (sid) io.to(sid).emit('new-chat', chats[chatId]);
    callback({ ok: true, chat: chats[chatId] });
  });

  socket.on('disconnect', () => {
    if (socket.username && online.get(socket.username) === socket.id) {
      online.delete(socket.username);
      io.emit('users', publicUsers());
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));