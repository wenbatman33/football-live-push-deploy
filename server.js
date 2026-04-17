#!/usr/bin/env node
// ======================================================================
// 足球即時推播伺服器
// ----------------------------------------------------------------------
// 零依賴：只使用 Node 內建模組
//   - HTTP 靜態檔案 + REST API (管理比賽 / 事件 / 推送)
//   - WebSocket 房間制廣播 (每個 matchId 一個房間)
// 用途：
//   - Admin 透過 REST 建立比賽、加事件、手動推送
//   - 觀眾 widget 透過 WS 接收指定 matchId 的即時推送
// 啟動：
//   node server.js          (預設 port 8766)
//   PORT=9000 node server.js
// ======================================================================

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT        = parseInt(process.env.PORT || '8766', 10);
const PUBLIC_DIR  = path.join(__dirname, 'public');
const DATA_FILE   = path.join(__dirname, 'data', 'matches.json');

// ── 狀態管理 ──────────────────────────────────────────────────────────
// matches: { [id]: Match }
// rooms:   { [matchId]: Set<socket> }
let matches = loadMatches();
const rooms = new Map();

function loadMatches() {
  try {
    const txt = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(txt);
  } catch (_) { return {}; }
}

function saveMatches() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(matches, null, 2));
  } catch (e) { console.error('寫入失敗:', e.message); }
}

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

// ── WebSocket RFC6455 最小實作 ────────────────────────────────────────
function wsAcceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}
function encodeTextFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[0]=0x81; header[1]=len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
  return Buffer.concat([header, payload]);
}
function encodeControlFrame(opcode, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(2); h[0] = 0x80 | (opcode & 0x0f); h[1] = payload.length;
  return Buffer.concat([h, payload]);
}
function tryDecodeFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f, offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4); offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    payload = out;
  }
  return { opcode, payload, rest: buf.slice(offset + len) };
}

function sendJson(sock, obj) {
  if (!sock.writable || sock.destroyed) return;
  try { sock.write(encodeTextFrame(JSON.stringify(obj))); } catch (_) {}
}

function broadcastToRoom(matchId, obj, except) {
  const room = rooms.get(matchId);
  if (!room) return;
  const frame = encodeTextFrame(JSON.stringify(obj));
  for (const s of room) if (s !== except && s.writable && !s.destroyed) {
    try { s.write(frame); } catch (_) {}
  }
}

function joinRoom(matchId, sock) {
  if (!rooms.has(matchId)) rooms.set(matchId, new Set());
  rooms.get(matchId).add(sock);
  sock._matchId = matchId;
}
function leaveRoom(sock) {
  const id = sock._matchId;
  if (id && rooms.has(id)) {
    rooms.get(id).delete(sock);
    if (rooms.get(id).size === 0) rooms.delete(id);
  }
}

// ── REST API ──────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function sendJsonRes(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(obj));
}

const EVENT_TYPES = {
  goal:      { icon: '⚽', label: '進球' },
  yellow:    { icon: '🟨', label: '黃牌' },
  red:       { icon: '🟥', label: '紅牌' },
  corner:    { icon: '🚩', label: '角球' },
  sub:       { icon: '🔄', label: '換人' },
  injury:    { icon: '🩹', label: '傷停' },
  var:       { icon: '⚠️', label: 'VAR' },
  freekick:  { icon: '🎯', label: '自由球' },
  throwin:   { icon: '📥', label: '邊線球' },
  kickoff:   { icon: '🏟', label: '開賽' },
  halftime:  { icon: '⏱', label: '半場' },
  fulltime:  { icon: '⏱', label: '終場' },
  custom:    { icon: '📣', label: '自訂' },
};

function normalizeTeam(t, fallbackName, fallbackColor) {
  // 允許 name + 選用的 teamId / league / logo（來自名單）
  return {
    name:   t?.name   || fallbackName,
    color:  t?.color  || fallbackColor,
    teamId: t?.teamId || null,     // TheSportsDB 的球隊 id，可用來綁球員名單
    league: t?.league || null,
    logo:   t?.logo   || null,
  };
}

function makeMatch({ home, away, sport }) {
  return {
    id: newId('m'),
    sport: sport === 'basketball' ? 'basketball' : 'football',
    home:  normalizeTeam(home, '主隊', '#5ba3f5'),
    away:  normalizeTeam(away, '客隊', '#f5a623'),
    homeScore: 0,
    awayScore: 0,
    status: 'upcoming',
    minute: 0,
    events: [],
    createdAt: Date.now(),
  };
}

function makeEvent(body) {
  const type = body.type || 'custom';
  const meta = EVENT_TYPES[type] || EVENT_TYPES.custom;
  return {
    id: newId('e'),
    type,
    icon:   body.icon   || meta.icon,
    team:   body.team   || null,        // 'home' | 'away' | null
    player: body.player || '',
    minute: parseInt(body.minute, 10) || 0,
    second: parseInt(body.second, 10) || 0,
    desc:   body.desc   || meta.label,
    pushed: false,
    pushedAt: null,
    createdAt: Date.now(),
  };
}

async function handleApi(req, res, urlPath) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parts = urlPath.split('/').filter(Boolean); // ['api', 'match', ':id', ...]

  // GET /api/event-types
  if (req.method === 'GET' && parts[1] === 'event-types') {
    return sendJsonRes(res, 200, EVENT_TYPES);
  }

  // GET /api/rosters[?sport=football|basketball]
  if (req.method === 'GET' && parts[1] === 'rosters') {
    const rostersFile = path.join(__dirname, 'data', 'rosters.json');
    try {
      const raw = fs.readFileSync(rostersFile, 'utf8');
      const roster = JSON.parse(raw);
      const sport = new URL(req.url, 'http://x').searchParams.get('sport');
      if (sport && roster[sport]) {
        return sendJsonRes(res, 200, { fetchedAt: roster.fetchedAt, teams: roster[sport] });
      }
      return sendJsonRes(res, 200, roster);
    } catch (_) {
      return sendJsonRes(res, 200, { fetchedAt: null, football: [], basketball: [] });
    }
  }

  // GET /api/matches
  if (req.method === 'GET' && parts[1] === 'matches') {
    const list = Object.values(matches).map(m => ({
      id: m.id, home: m.home, away: m.away,
      homeScore: m.homeScore, awayScore: m.awayScore,
      status: m.status, eventCount: m.events.length,
      createdAt: m.createdAt
    }));
    list.sort((a, b) => b.createdAt - a.createdAt);
    return sendJsonRes(res, 200, list);
  }

  // POST /api/matches  (create)
  if (req.method === 'POST' && parts[1] === 'matches') {
    const body = await readBody(req);
    const m = makeMatch(body);
    matches[m.id] = m;
    saveMatches();
    return sendJsonRes(res, 201, m);
  }

  // /api/match/:id/...
  if (parts[1] === 'match' && parts[2]) {
    const m = matches[parts[2]];
    if (!m) return sendJsonRes(res, 404, { error: 'match not found' });

    // GET /api/match/:id
    if (req.method === 'GET' && parts.length === 3) {
      return sendJsonRes(res, 200, m);
    }

    // PATCH /api/match/:id  (update meta/score/status)
    if (req.method === 'PATCH' && parts.length === 3) {
      const body = await readBody(req);
      if (body.home) m.home = { ...m.home, ...body.home };
      if (body.away) m.away = { ...m.away, ...body.away };
      if (body.homeScore != null) m.homeScore = parseInt(body.homeScore, 10) || 0;
      if (body.awayScore != null) m.awayScore = parseInt(body.awayScore, 10) || 0;
      if (body.status) m.status = body.status;
      if (body.minute != null) m.minute = parseInt(body.minute, 10) || 0;
      saveMatches();
      broadcastToRoom(m.id, { type: 'match-update', data: publicMatch(m) });
      return sendJsonRes(res, 200, m);
    }

    // DELETE /api/match/:id
    if (req.method === 'DELETE' && parts.length === 3) {
      delete matches[parts[2]];
      saveMatches();
      // 把房內所有客戶端踢走
      const room = rooms.get(parts[2]);
      if (room) for (const s of room) { try { s.end(); } catch(_){} }
      rooms.delete(parts[2]);
      return sendJsonRes(res, 200, { ok: true });
    }

    // POST /api/match/:id/events  (add event, not pushed)
    if (req.method === 'POST' && parts[3] === 'events' && parts.length === 4) {
      const body = await readBody(req);
      const evt = makeEvent(body);
      m.events.push(evt);
      m.events.sort((a, b) => (a.minute - b.minute) || (a.second - b.second) || (a.createdAt - b.createdAt));
      saveMatches();
      return sendJsonRes(res, 201, evt);
    }

    // /api/match/:id/events/:evtId/...
    if (parts[3] === 'events' && parts[4]) {
      const evt = m.events.find(e => e.id === parts[4]);
      if (!evt) return sendJsonRes(res, 404, { error: 'event not found' });

      // POST .../push
      if (req.method === 'POST' && parts[5] === 'push') {
        evt.pushed = true;
        evt.pushedAt = Date.now();
        saveMatches();
        broadcastToRoom(m.id, { type: 'event', data: evt, match: publicMatch(m) });
        return sendJsonRes(res, 200, evt);
      }

      // POST .../unpush
      if (req.method === 'POST' && parts[5] === 'unpush') {
        evt.pushed = false;
        evt.pushedAt = null;
        saveMatches();
        broadcastToRoom(m.id, { type: 'event-retracted', data: { id: evt.id } });
        return sendJsonRes(res, 200, evt);
      }

      // PATCH .../events/:evtId  (edit)
      if (req.method === 'PATCH' && parts.length === 5) {
        const body = await readBody(req);
        Object.assign(evt, {
          desc:   body.desc   ?? evt.desc,
          team:   body.team   ?? evt.team,
          player: body.player ?? evt.player,
          minute: body.minute != null ? parseInt(body.minute,10)||0 : evt.minute,
          second: body.second != null ? parseInt(body.second,10)||0 : evt.second,
          icon:   body.icon   ?? evt.icon,
        });
        saveMatches();
        if (evt.pushed) broadcastToRoom(m.id, { type: 'event-update', data: evt });
        return sendJsonRes(res, 200, evt);
      }

      // DELETE .../events/:evtId
      if (req.method === 'DELETE' && parts.length === 5) {
        const wasPushed = evt.pushed;
        m.events = m.events.filter(e => e.id !== parts[4]);
        saveMatches();
        if (wasPushed) broadcastToRoom(m.id, { type: 'event-retracted', data: { id: parts[4] } });
        return sendJsonRes(res, 200, { ok: true });
      }
    }
  }

  sendJsonRes(res, 404, { error: 'not found' });
}

// 公開給觀眾的 match 資料：只含已推送的事件
function publicMatch(m) {
  return {
    id: m.id,
    sport: m.sport || 'football',
    home: m.home, away: m.away,
    homeScore: m.homeScore, awayScore: m.awayScore,
    status: m.status, minute: m.minute,
    events: m.events.filter(e => e.pushed),
  };
}

// ── 靜態檔案 ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
};
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  // 防止路徑穿越
  if (rel.includes('..')) return sendJsonRes(res, 400, { error: 'bad path' });
  const full = path.join(PUBLIC_DIR, rel);
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) return sendJsonRes(res, 404, { error: 'not found' });
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

// ── HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/healthz') {
    return sendJsonRes(res, 200, {
      ok: true,
      matches: Object.keys(matches).length,
      rooms: Array.from(rooms.entries()).map(([k, v]) => ({ id: k, clients: v.size }))
    });
  }
  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);
  if (req.method === 'GET') return serveStatic(req, res, urlPath);
  sendJsonRes(res, 405, { error: 'method not allowed' });
});

// ── WS Upgrade：路由 /ws?match=xxx ────────────────────────────────────
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const matchId = url.searchParams.get('match');
  if (!matchId) { socket.destroy(); return; }

  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAcceptKey(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  joinRoom(matchId, socket);
  console.log(`[+] ${matchId} (房內 ${rooms.get(matchId).size} 位)`);

  // 入房立即送出當前狀態
  const m = matches[matchId];
  if (m) sendJson(socket, { type: 'match-state', data: publicMatch(m) });
  else   sendJson(socket, { type: 'match-missing', data: { id: matchId } });

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = tryDecodeFrame(buffer);
      if (!frame) break;
      buffer = frame.rest;
      switch (frame.opcode) {
        case 0x8:
          try { socket.write(encodeControlFrame(0x8)); } catch(_){}
          socket.end();
          return;
        case 0x9:
          try { socket.write(encodeControlFrame(0xa, frame.payload)); } catch(_){}
          break;
        case 0x1:
          // 觀眾端目前不需要送訊息，忽略即可（未來可放心跳）
          break;
      }
    }
  });
  socket.on('close', () => { leaveRoom(socket); console.log(`[-] ${matchId}`); });
  socket.on('error', () => leaveRoom(socket));
});

server.listen(PORT, () => {
  console.log('─'.repeat(56));
  console.log(`足球即時推播伺服器啟動`);
  console.log(`  HTTP:  http://localhost:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}/admin.html`);
  console.log(`  Demo:  http://localhost:${PORT}/demo-host.html`);
  console.log(`  WS:    ws://localhost:${PORT}/ws?match=<matchId>`);
  console.log('─'.repeat(56));
});
