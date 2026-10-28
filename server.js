/* =====================================================================
 *  DUELO NO VELHO OESTE — servidor multiplayer
 *  Node.js puro (sem dependências): serve os arquivos do jogo e mantém
 *  as salas via WebSocket (implementação mínima do RFC 6455).
 *
 *  Organização:
 *    1. Configuração
 *    2. Servidor HTTP (arquivos estáticos)
 *    3. WebSocket (handshake, quadros, ping)
 *    4. Salas e jogadores
 *    5. Lógica da partida (pareamento, rodada, eliminação)
 *    6. Mensagens dos clientes
 * ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* =====================================================================
 * 1. CONFIGURAÇÃO
 * ===================================================================== */

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const START_HP = 5;
const SLOTS = 6;                 // grade 2 x 3 da barraca
const CHOOSE_MS = Number(process.env.CHOOSE_MS) || 30000; // tempo para escolher a jogada
const REVEAL_MS = Number(process.env.REVEAL_MS) || 9000;   // tempo da revelação antes da próxima rodada
const LOBBY_GRACE_MS = 20000;    // quem cai no saguão tem esse tempo para voltar
const EMPTY_ROOM_MS = 10 * 60000;
const MAX_MESSAGE = 8 * 1024;
const CHAR_IDS = ['xerife', 'foradalei', 'cacador', 'pistoleira', 'garimpeiro', 'pregador', 'kid', 'dama'];

/* =====================================================================
 * 2. SERVIDOR HTTP — só entrega os arquivos do jogo (lista fechada)
 * ===================================================================== */

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/game.js': ['game.js', 'application/javascript; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  const entry = STATIC[url];
  if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
    return;
  }
  fs.readFile(path.join(__dirname, entry[0]), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

/* =====================================================================
 * 3. WEBSOCKET
 * ===================================================================== */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const connections = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  onConnection(new Conn(socket));
});

/* Uma conexão WebSocket: lê quadros de texto e envia JSON. */
class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragBytes = 0;
    this.alive = true;
    this.closed = false;
    this.session = null;   // { room, player }
    this.onmessage = null;
    this.onclose = null;
    connections.add(this);
    socket.on('data', (d) => this.receive(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  receive(data) {
    this.buf = Buffer.concat([this.buf, data]);
    while (!this.closed) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (!masked) return this.close(1002); // clientes sempre mascaram
      if (b.length < off + 4 + len) return;

      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.sendFrame(0xA, payload); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x0) {
        this.frags.push(payload);
        this.fragBytes += payload.length;
        if (this.fragBytes > MAX_MESSAGE) return this.close(1009);
        if (fin) {
          const text = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.fragBytes = 0;
          if (this.onmessage) this.onmessage(text);
        }
        continue;
      }
      return this.close(1003); // binário não é aceito
    }
  }

  sendFrame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(obj) {
    this.sendFrame(0x1, Buffer.from(JSON.stringify(obj)));
  }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    try { this.sendFrame(0x8, p); } catch (e) { /* conexão já caiu */ }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    connections.delete(this);
    if (this.onclose) this.onclose();
  }
}

/* Ping periódico: derruba conexões mortas (celular que apagou a tela, etc.). */
setInterval(() => {
  for (const c of connections) {
    if (!c.alive) { c.close(1001); continue; }
    c.alive = false;
    c.sendFrame(0x9, Buffer.alloc(0));
  }
}, 20000).unref();

/* =====================================================================
 * 4. SALAS E JOGADORES
 * ===================================================================== */

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function createRoom() {
  const room = {
    code: makeCode(),
    phase: 'lobby',          // lobby | choose | reveal | over
    hostId: null,
    players: [],
    round: 0,
    deadline: 0,
    pairings: [],
    results: null,
    history: {},             // id -> oponentes recentes (para o rodízio)
    ghostPool: [],           // ids na ordem de eliminação
    timer: null,
    emptyTimer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function getPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function uniqueName(room, name) {
  let candidate = name;
  let n = 2;
  while (room.players.some((p) => p.name === candidate)) candidate = `${name.slice(0, 13)} ${n++}`;
  return candidate;
}

function addPlayer(room, conn, name) {
  const taken = new Set(room.players.map((p) => p.charId));
  const player = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(16).toString('hex'),
    name: uniqueName(room, name),
    charId: CHAR_IDS.find((c) => !taken.has(c)) || CHAR_IDS[0],
    hp: START_HP,
    alive: true,
    place: null,
    choice: null,
    left: false,
    conn: null,
    connected: false,
    dropTimer: null,
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  attach(room, player, conn);
  return player;
}

function attach(room, player, conn) {
  if (player.conn && player.conn !== conn) {
    player.conn.session = null;
    player.conn.close(4000);
  }
  clearTimeout(player.dropTimer);
  clearTimeout(room.emptyTimer);
  player.conn = conn;
  player.connected = true;
  conn.session = { room, player };
  conn.send({ t: 'joined', code: room.code, id: player.id, token: player.token });
}

function removePlayer(room, player) {
  room.players = room.players.filter((p) => p !== player);
  if (player.conn) player.conn.session = null;
  if (room.players.length === 0) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return;
  }
  ensureHost(room);
}

/* Se o anfitrião saiu ou caiu, passa o posto para o próximo conectado. */
function ensureHost(room) {
  const host = getPlayer(room, room.hostId);
  if (host && host.connected) return;
  const next = room.players.find((p) => p.connected) || room.players[0];
  if (next) room.hostId = next.id;
}

/* Estado público da sala. As jogadas só aparecem depois de resolvidas. */
function publicState(room, viewer) {
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    round: room.round,
    hostId: room.hostId,
    now: Date.now(),
    deadline: room.deadline,
    you: viewer.id,
    mine: viewer.choice,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, charId: p.charId, hp: p.hp, alive: p.alive,
      place: p.place, connected: p.connected, left: p.left, submitted: !!p.choice,
    })),
    pairings: room.phase === 'choose' || room.phase === 'reveal' ? room.pairings : [],
    results: room.phase === 'reveal' || room.phase === 'over' ? room.results : null,
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.conn && !p.conn.closed) p.conn.send(publicState(room, p));
  }
}

/* =====================================================================
 * 5. LÓGICA DA PARTIDA
 * ===================================================================== */

function startGame(room) {
  room.players = room.players.filter((p) => p.connected);
  room.players.forEach((p) => {
    p.hp = START_HP;
    p.alive = true;
    p.place = null;
    p.choice = null;
    p.left = false;
  });
  ensureHost(room);
  room.round = 0;
  room.history = {};
  room.ghostPool = [];
  room.results = null;
  nextRound(room);
}

function nextRound(room) {
  clearTimeout(room.timer);
  room.round += 1;
  room.phase = 'choose';
  room.results = null;
  room.players.forEach((p) => { p.choice = null; });
  room.pairings = makePairings(room);
  room.deadline = Date.now() + CHOOSE_MS;
  room.timer = setTimeout(() => resolveRound(room), CHOOSE_MS);
  broadcast(room);
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Penalidade por repetir oponente recente (último pesa mais). */
function repeatPenalty(room, id, opponent) {
  const h = room.history[id] || [];
  const last = h.lastIndexOf(opponent);
  if (last === -1) return 0;
  const age = h.length - 1 - last;  // 0 = rodada anterior
  return [100, 20, 5, 1][age] || 0;
}

/* Rodízio: sorteia vários pareamentos e fica com o que menos repete
 * adversários recentes. Com número ímpar, alguém enfrenta um fantasma. */
function makePairings(room) {
  const alive = room.players.filter((p) => p.alive).map((p) => p.id);
  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 300; attempt++) {
    const order = shuffle(alive);
    let score = 0;
    for (let i = 0; i < order.length; i += 2) {
      const a = order[i];
      const b = order[i + 1];
      score += b ? repeatPenalty(room, a, b) + repeatPenalty(room, b, a) : repeatPenalty(room, a, 'ghost') * 2;
    }
    if (score < bestScore) {
      bestScore = score;
      best = order;
      if (score === 0) break;
    }
  }

  const pairings = [];
  for (let i = 0; i < best.length; i += 2) {
    const a = best[i];
    const b = best[i + 1] || null;
    pairings.push({ a, b, ghost: b ? null : makeGhost(room) });
  }
  return pairings;
}

/* O fantasma é o último eliminado; antes de alguém cair, um fantasma genérico. */
function makeGhost(room) {
  const ofId = room.ghostPool[room.ghostPool.length - 1];
  const of = ofId && getPlayer(room, ofId);
  if (of) return { ofId: of.id, name: `Fantasma de ${of.name}`, charId: of.charId };
  return { ofId: null, name: 'Fantasma do Cemitério', charId: null };
}

function randomSlot() {
  return crypto.randomInt(SLOTS);
}

/* Completa jogadas vazias ou parciais com escolhas aleatórias. */
function finalChoice(choice) {
  const c = choice || {};
  const auto = !Number.isInteger(c.pos) || !Number.isInteger(c.target);
  return {
    pos: Number.isInteger(c.pos) ? c.pos : randomSlot(),
    target: Number.isInteger(c.target) ? c.target : randomSlot(),
    auto,
  };
}

function pushHistory(room, id, opponent) {
  const h = room.history[id] || (room.history[id] = []);
  h.push(opponent);
  if (h.length > 6) h.shift();
}

/* Resolve todos os duelos da rodada ao mesmo tempo. */
function resolveRound(room) {
  if (room.phase !== 'choose') return;
  clearTimeout(room.timer);

  const duels = room.pairings.map((pr) => {
    const A = getPlayer(room, pr.a);
    const B = pr.b ? getPlayer(room, pr.b) : null;
    const ca = finalChoice(A && A.alive ? A.choice : null);
    const cb = finalChoice(B && B.alive ? B.choice : null);
    const hitA = ca.target === cb.pos;  // A acertou B
    const hitB = cb.target === ca.pos;  // B acertou A
    // Fantasmas (e quem abandonou) não perdem vida, mas ainda atiram
    if (hitA && B && B.alive) B.hp -= 1;
    if (hitB && A && A.alive) A.hp -= 1;
    pushHistory(room, pr.a, pr.b || 'ghost');
    if (pr.b) pushHistory(room, pr.b, pr.a);
    return {
      a: { id: pr.a, ...ca, hit: hitA },
      b: { id: pr.b, ghost: pr.ghost, ...cb, hit: hitB },
    };
  });

  const eliminated = eliminateDead(room);
  room.results = { round: room.round, duels, eliminated };
  room.phase = 'reveal';
  room.deadline = Date.now() + REVEAL_MS;
  // Decide no fim da revelação (alguém pode ter abandonado nesse meio-tempo)
  room.timer = setTimeout(() => {
    if (room.players.filter((p) => p.alive).length <= 1) finishGame(room);
    else nextRound(room);
  }, REVEAL_MS);
  broadcast(room);
}

/* Quem chegou a 0 sai; quem cai na mesma rodada divide a colocação. */
function eliminateDead(room) {
  const dying = room.players.filter((p) => p.alive && p.hp <= 0);
  const remaining = room.players.filter((p) => p.alive).length - dying.length;
  dying.forEach((p) => {
    p.alive = false;
    p.hp = 0;
    p.place = remaining === 0 ? 1 : remaining + 1;
    room.ghostPool.push(p.id);
  });
  const alive = room.players.filter((p) => p.alive);
  if (alive.length === 1) alive[0].place = 1;
  return dying.map((p) => p.id);
}

function finishGame(room) {
  clearTimeout(room.timer);
  room.phase = 'over';
  room.deadline = 0;
  broadcast(room);
}

/* Volta todos ao saguão mantendo os personagens. */
function backToLobby(room) {
  clearTimeout(room.timer);
  room.players.filter((p) => !p.connected || p.left).forEach((p) => removePlayer(room, p));
  if (!rooms.has(room.code)) return;
  room.phase = 'lobby';
  room.round = 0;
  room.pairings = [];
  room.results = null;
  room.deadline = 0;
  room.players.forEach((p) => {
    p.hp = START_HP;
    p.alive = true;
    p.place = null;
    p.choice = null;
  });
  broadcast(room);
}

/* Jogador saiu de vez. No saguão some da lista; na partida é eliminado. */
function leave(conn) {
  const s = conn.session;
  if (!s) return;
  conn.session = null;
  const { room, player } = s;
  player.conn = null;
  player.connected = false;

  if (room.phase === 'lobby') {
    removePlayer(room, player);
  } else {
    player.left = true;
    if (player.alive && room.phase !== 'over') {
      const remaining = room.players.filter((p) => p.alive).length - 1;
      player.alive = false;
      player.hp = 0;
      player.place = remaining + 1;
      room.ghostPool.push(player.id);
      const alive = room.players.filter((p) => p.alive);
      if (alive.length === 1) alive[0].place = 1;
      if (alive.length <= 1 && room.phase === 'choose') {
        finishGame(room);
        return;
      }
    }
    ensureHost(room);
    if (room.players.every((p) => !p.connected)) scheduleEmpty(room);
  }
  if (rooms.has(room.code)) {
    broadcast(room);
    if (room.phase === 'choose') checkAllSubmitted(room);
  }
}

/* Conexão caiu sem "sair": dá um tempo para o jogador voltar. */
function handleDisconnect(conn) {
  const s = conn.session;
  if (!s) return;
  conn.session = null;
  const { room, player } = s;
  if (player.conn !== conn) return;
  player.conn = null;
  player.connected = false;

  if (room.phase === 'lobby') {
    player.dropTimer = setTimeout(() => {
      if (!player.connected && room.phase === 'lobby' && rooms.has(room.code)) {
        removePlayer(room, player);
        if (rooms.has(room.code)) broadcast(room);
      }
    }, LOBBY_GRACE_MS);
  }
  ensureHost(room);
  if (room.players.every((p) => !p.connected)) scheduleEmpty(room);
  broadcast(room);
  if (room.phase === 'choose') checkAllSubmitted(room);
}

function scheduleEmpty(room) {
  clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(() => {
    if (room.players.every((p) => !p.connected)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
    }
  }, EMPTY_ROOM_MS);
  room.emptyTimer.unref();
}

/* Se todos os vivos conectados já atiraram, não espera o relógio. */
function checkAllSubmitted(room) {
  const waiting = room.players.filter((p) => p.alive && p.connected && !p.choice);
  if (waiting.length === 0) resolveRound(room);
}

/* =====================================================================
 * 6. MENSAGENS DOS CLIENTES
 * ===================================================================== */

function sendError(conn, msg) {
  conn.send({ t: 'error', msg });
}

function onConnection(conn) {
  conn.onmessage = (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(conn, msg);
    } catch (e) {
      console.error(e);
      sendError(conn, 'Erro no servidor.');
    }
  };
  conn.onclose = () => handleDisconnect(conn);
}

function isSlot(v) {
  return Number.isInteger(v) && v >= 0 && v < SLOTS;
}

function handle(conn, msg) {
  switch (msg.t) {
    case 'create': {
      const name = cleanName(msg.name);
      if (!name) return sendError(conn, 'Digite seu nome.');
      if (conn.session) leave(conn);
      const room = createRoom();
      addPlayer(room, conn, name);
      broadcast(room);
      return;
    }

    case 'join': {
      const name = cleanName(msg.name);
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!name) return sendError(conn, 'Digite seu nome.');
      if (!room) return sendError(conn, 'Sala não encontrada. Confira o código.');
      if (room.phase !== 'lobby') return sendError(conn, 'A partida desta sala já começou.');
      if (room.players.length >= MAX_PLAYERS) return sendError(conn, `Sala cheia (${MAX_PLAYERS} jogadores).`);
      if (conn.session) leave(conn);
      addPlayer(room, conn, name);
      broadcast(room);
      return;
    }

    case 'rejoin': {
      const room = rooms.get(String(msg.code || ''));
      const player = room && room.players.find((p) => p.id === msg.id && p.token === msg.token && !p.left);
      if (!player) return conn.send({ t: 'rejoin-failed' });
      attach(room, player, conn);
      ensureHost(room);
      broadcast(room);
      return;
    }

    case 'leave':
      leave(conn);
      conn.send({ t: 'left' });
      return;
  }

  // Daqui para baixo é preciso estar numa sala
  const s = conn.session;
  if (!s) return;
  const { room, player } = s;

  switch (msg.t) {
    case 'pick': {
      if (room.phase !== 'lobby' || !CHAR_IDS.includes(msg.charId)) return;
      if (room.players.some((p) => p !== player && p.charId === msg.charId)) {
        return sendError(conn, 'Esse pistoleiro já foi escolhido.');
      }
      player.charId = msg.charId;
      broadcast(room);
      return;
    }

    case 'start': {
      if (room.phase !== 'lobby' || room.hostId !== player.id) return;
      const ready = room.players.filter((p) => p.connected).length;
      if (ready < MIN_PLAYERS) return sendError(conn, `São necessários pelo menos ${MIN_PLAYERS} jogadores.`);
      startGame(room);
      return;
    }

    case 'choice': {
      if (room.phase !== 'choose' || !player.alive || player.choice) return;
      const pos = isSlot(msg.pos) ? msg.pos : null;
      const target = isSlot(msg.target) ? msg.target : null;
      // Escolha parcial só é aceita no envio automático do fim do tempo
      if ((pos === null || target === null) && !msg.timeout) return sendError(conn, 'Escolha onde aparecer e onde atirar.');
      player.choice = { pos, target };
      broadcast(room);
      checkAllSubmitted(room);
      return;
    }

    case 'again': {
      if (room.phase !== 'over' || room.hostId !== player.id) return;
      backToLobby(room);
      return;
    }
  }
}

server.listen(PORT, () => {
  console.log(`Duelo no Velho Oeste rodando em http://localhost:${PORT}`);
});
