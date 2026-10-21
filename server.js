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

const USERS_FILE = path.join(__dirname, 'users.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const NFTS_FILE = path.join(__dirname, 'nfts.json');

const ADMIN_USERNAME = 'durov';

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Ошибка сохранения', file, e); }
}

// users: { username: { displayName, passwordHash, salt, color, createdAt, stars, gifts, nftIds, banned } }
let users = loadJSON(USERS_FILE, {});
let history = loadJSON(HISTORY_FILE, {});
let nfts = loadJSON(NFTS_FILE, {});

const online = new Map();

// ---------- Хэши ----------
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

// ---------- NFT ----------
const NFT_EMOJIS = ['🐶','🐱','🦊','🐼','🦄','🐉','👾','🤖','👽','🎃','💎','🏆','🌈','⭐','🔥','🦋','🐺','🦉','🦁','🐸'];
const NFT_NAMES = ['CryptoDog','MoonCat','StarFox','PixelPanda','UnicornX','DragonZ','AlienBot','NeonGhost','DreamWing','CyberOwl','RareBird','MysticFrog','GoldenFish','IceWolf','ThunderLion'];
const NFT_RARITIES = [
  { name: 'Common',    weight: 60, color: '#8e9aaf' },
  { name: 'Rare',      weight: 25, color: '#3390ec' },
  { name: 'Epic',      weight: 10, color: '#a695e7' },
  { name: 'Legendary', weight: 4,  color: '#e5ca77' },
  { name: 'Mythic',    weight: 1,  color: '#e17076' },
];

function randomNft() {
  const total = NFT_RARITIES.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  let rarity = NFT_RARITIES[0];
  for (const r of NFT_RARITIES) {
    if (roll < r.weight) { rarity = r; break; }
    roll -= r.weight;
  }
  return {
    id: crypto.randomBytes(8).toString('hex'),
    emoji: NFT_EMOJIS[Math.floor(Math.random() * NFT_EMOJIS.length)],
    name: NFT_NAMES[Math.floor(Math.random() * NFT_NAMES.length)],
    rarity: rarity.name,
    rarityColor: rarity.color,
  };
}

// ---------- Утилиты ----------
function chatKey(a, b) { return [a, b].sort().join('|'); }
function nowTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}
function getHistoryFor(username) {
  const result = {};
  for (const [key, msgs] of Object.entries(history)) {
    const [a, b] = key.split('|');
    if (a === username || b === username) {
      result[a === username ? b : a] = msgs;
    }
  }
  return result;
}
function publicUsers() {
  return Object.keys(users).map(uname => ({
    username: uname,
    displayName: users[uname].displayName || uname,
    color: users[uname].color,
    online: online.has(uname),
  }));
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
    username: uname,
    displayName: u.displayName || uname,
    color: u.color,
    online: online.has(uname),
    createdAt: u.createdAt,
    stars: u.stars || 0,
    gifts: u.gifts || {},
    giftTotal: Object.values(u.gifts || {}).reduce((s, n) => s + n, 0),
    giftsReceived: received,
    giftsSent: sent,
    nfts: (u.nftIds || []).map(id => nfts[id]).filter(Boolean),
    isAdmin: uname === ADMIN_USERNAME,
    banned: !!u.banned,
  };
}
function broadcastProfile(uname) {
  const profile = publicProfile(uname);
  io.emit('users', publicUsers());
  io.emit('profile-updated', profile);
}
function getStats() {
  let totalMessages = 0, totalGifts = 0, totalNfts = 0;
  for (const msgs of Object.values(history)) {
    for (const m of msgs) {
      if (m.type === 'text') totalMessages++;
      if (m.type === 'gift') totalGifts++;
      if (m.type === 'nft') totalNfts++;
    }
  }
  return {
    totalUsers: Object.keys(users).length,
    onlineUsers: online.size,
    totalMessages,
    totalGifts,
    totalNfts,
    totalNftObjects: Object.keys(nfts).length,
  };
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
      if (exists.banned) {
        return callback({ ok: false, error: 'Аккаунт заблокирован' });
      }
      if (hashPassword(password, exists.salt) !== exists.passwordHash) {
        return callback({ ok: false, error: 'Неверный пароль' });
      }
    } else {
      // Авто-регистрация. Админ создаётся с паролем по умолчанию или своим
      const salt = makeSalt();
      users[username] = {
        salt,
        passwordHash: hashPassword(password, salt),
        displayName: username,
        color: colorFor(username),
        createdAt: Date.now(),
        stars: username === ADMIN_USERNAME ? 99999 : 100,
        gifts: {},
        nftIds: [],
        banned: false,
      };
      if (username === ADMIN_USERNAME) {
        users[username].displayName = 'Pavel Durov';
      }
      const nft = randomNft();
      nft.owner = username;
      nfts[nft.id] = nft;
      users[username].nftIds.push(nft.id);
      saveJSON(USERS_FILE, users);
      saveJSON(NFTS_FILE, nfts);
    }

    if (online.has(username)) return callback({ ok: false, error: 'Этот username уже в сети' });

    online.set(username, socket.id);
    socket.username = username;

    io.emit('users', publicUsers());
    callback({
      ok: true,
      me: publicProfile(username),
      history: getHistoryFor(username),
      isNew: !exists,
      isAdmin: username === ADMIN_USERNAME,
    });
  });

  socket.on('set-display-name', (name, callback) => {
    const uname = socket.username;
    if (!uname || !users[uname]) return callback && callback({ ok: false });
    name = String(name || '').trim();
    if (!name || name.length < 1 || name.length > 30) {
      return callback && callback({ ok: false, error: 'Имя: 1-30 символов' });
    }
    users[uname].displayName = name;
    saveJSON(USERS_FILE, users);
    broadcastProfile(uname);
    if (callback) callback({ ok: true, me: publicProfile(uname) });
  });

  socket.on('send', ({ to, text }, callback) => {
    const from = socket.username;
    if (!from || !to || !text) return;
    const msg = { from, to, type: 'text', text, time: nowTime() };

    const key = chatKey(from, to);
    if (!history[key]) history[key] = [];
    history[key].push(msg);
    saveJSON(HISTORY_FILE, history);

    const toSocketId = online.get(to);
    if (toSocketId) io.to(toSocketId).emit('message', msg);
    socket.emit('message', msg);
    if (callback) callback({ ok: true });
  });

  socket.on('send-gift', ({ to, emoji }, callback) => {
    const from = socket.username;
    if (!from || !to || !emoji) return;
    if (!users[to]) return callback && callback({ ok: false });

    const msg = { from, to, type: 'gift', text: emoji, time: nowTime() };
    const key = chatKey(from, to);
    if (!history[key]) history[key] = [];
    history[key].push(msg);
    saveJSON(HISTORY_FILE, history);

    if (!users[to].gifts) users[to].gifts = {};
    users[to].gifts[emoji] = (users[to].gifts[emoji] || 0) + 1;
    saveJSON(USERS_FILE, users);

    const toSocketId = online.get(to);
    if (toSocketId) io.to(toSocketId).emit('message', msg);
    socket.emit('message', msg);

    broadcastProfile(to);
    broadcastProfile(from);
    if (callback) callback({ ok: true });
  });

  socket.on('send-nft', ({ to, nftId }, callback) => {
    const from = socket.username;
    if (!from || !to || !nftId) return;
    if (!users[from] || !users[to]) return callback && callback({ ok: false });
    if (!users[from].nftIds.includes(nftId)) return callback && callback({ ok: false });

    users[from].nftIds = users[from].nftIds.filter(id => id !== nftId);
    users[to].nftIds = users[to].nftIds || [];
    users[to].nftIds.push(nftId);
    nfts[nftId].owner = to;
    saveJSON(USERS_FILE, users);
    saveJSON(NFTS_FILE, nfts);

    const msg = {
      from, to, type: 'nft', time: nowTime(),
      text: `🎁 NFT: ${nfts[nftId].emoji} ${nfts[nftId].name}`,
      nft: nfts[nftId],
    };
    const key = chatKey(from, to);
    if (!history[key]) history[key] = [];
    history[key].push(msg);
    saveJSON(HISTORY_FILE, history);

    const toSocketId = online.get(to);
    if (toSocketId) io.to(toSocketId).emit('message', msg);
    socket.emit('message', msg);

    broadcastProfile(to);
    broadcastProfile(from);
    if (callback) callback({ ok: true });
  });

  socket.on('changePassword', ({ oldPassword, newPassword }, callback) => {
    const name = socket.username;
    const u = users[name];
    if (!u) return callback({ ok: false, error: 'Не авторизован' });
    if (!newPassword || newPassword.length < 3) return callback({ ok: false, error: 'Новый пароль минимум 3 символа' });
    if (hashPassword(String(oldPassword || ''), u.salt) !== u.passwordHash) {
      return callback({ ok: false, error: 'Старый пароль неверный' });
    }
    const salt = makeSalt();
    u.salt = salt;
    u.passwordHash = hashPassword(newPassword, salt);
    saveJSON(USERS_FILE, users);
    callback({ ok: true });
  });

  socket.on('get-profile', (uname, callback) => callback(publicProfile(uname)));

  // ---------- АДМИН ----------
  function isAdmin() { return socket.username === ADMIN_USERNAME; }

  socket.on('admin:get-data', (callback) => {
    if (!isAdmin()) return callback({ ok: false, error: 'Нет доступа' });
    const list = Object.keys(users).map(uname => ({
      username: uname,
      displayName: users[uname].displayName || uname,
      color: users[uname].color,
      online: online.has(uname),
      stars: users[uname].stars || 0,
      nftCount: (users[uname].nftIds || []).length,
      createdAt: users[uname].createdAt,
      banned: !!users[uname].banned,
      isAdmin: uname === ADMIN_USERNAME,
    })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    callback({ ok: true, stats: getStats(), users: list });
  });

  socket.on('admin:give-stars', ({ target, amount }, callback) => {
    if (!isAdmin()) return callback && callback({ ok: false });
    if (!users[target]) return callback && callback({ ok: false, error: 'Нет пользователя' });
    users[target].stars = (users[target].stars || 0) + Number(amount || 0);
    saveJSON(USERS_FILE, users);
    broadcastProfile(target);
    if (callback) callback({ ok: true });
  });

  socket.on('admin:give-nft', ({ target }, callback) => {
    if (!isAdmin()) return callback && callback({ ok: false });
    if (!users[target]) return callback && callback({ ok: false, error: 'Нет пользователя' });
    const nft = randomNft();
    nft.owner = target;
    nfts[nft.id] = nft;
    users[target].nftIds = users[target].nftIds || [];
    users[target].nftIds.push(nft.id);
    saveJSON(USERS_FILE, users);
    saveJSON(NFTS_FILE, nfts);
    broadcastProfile(target);
    if (callback) callback({ ok: true, nft });
  });

  socket.on('admin:ban', ({ target, banned }, callback) => {
    if (!isAdmin()) return callback && callback({ ok: false });
    if (target === ADMIN_USERNAME) return callback && callback({ ok: false, error: 'Нельзя забанить админа' });
    if (!users[target]) return callback && callback({ ok: false, error: 'Нет пользователя' });
    users[target].banned = !!banned;
    saveJSON(USERS_FILE, users);
    // Кикнуть, если онлайн и забанили
    if (banned && online.has(target)) {
      const sid = online.get(target);
      io.to(sid).emit('banned');
      online.delete(target);
      io.emit('users', publicUsers());
    }
    broadcastProfile(target);
    if (callback) callback({ ok: true });
  });

  socket.on('admin:delete-user', ({ target }, callback) => {
    if (!isAdmin()) return callback && callback({ ok: false });
    if (target === ADMIN_USERNAME) return callback && callback({ ok: false, error: 'Нельзя удалить админа' });
    if (!users[target]) return callback && callback({ ok: false, error: 'Нет пользователя' });

    // Кикнуть если онлайн
    if (online.has(target)) {
      const sid = online.get(target);
      io.to(sid).emit('banned');
      online.delete(target);
    }
    // Удалить сообщения
    for (const key of Object.keys(history)) {
      const [a, b] = key.split('|');
      if (a === target || b === target) delete history[key];
    }
    saveJSON(HISTORY_FILE, history);
    // Удалить NFT
    for (const nid of users[target].nftIds || []) delete nfts[nid];
    saveJSON(NFTS_FILE, nfts);
    // Удалить пользователя
    delete users[target];
    saveJSON(USERS_FILE, users);
    io.emit('users', publicUsers());
    if (callback) callback({ ok: true });
  });

  socket.on('admin:broadcast', ({ text }, callback) => {
    if (!isAdmin()) return callback && callback({ ok: false });
    if (!text) return callback && callback({ ok: false, error: 'Пустое сообщение' });
    // Отправить всем онлайн как системное сообщение в общий поток
    const msg = {
      from: ADMIN_USERNAME,
      to: '__all__',
      type: 'text',
      text: '📢 ' + text,
      time: nowTime(),
      isBroadcast: true,
    };
    for (const [uname, sid] of online) {
      if (uname === ADMIN_USERNAME) continue;
      io.to(sid).emit('broadcast', msg);
    }
    if (callback) callback({ ok: true });
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
  console.log('Админ: @' + ADMIN_USERNAME);
});