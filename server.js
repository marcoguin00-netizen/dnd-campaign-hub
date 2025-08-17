import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

// === Configurazione cartella dati ===
const DATA_DIR = process.env.DATA_DIR || "D:\\dnd-hub-data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Funzioni di supporto per salvataggio su disco
const fileForRoom = (room) => path.join(DATA_DIR, `campaign_${room}.json`);

function readSnapshot(room) {
  try {
    const f = fileForRoom(room);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeSnapshot(room, snapshot) {
  try {
    fs.writeFileSync(fileForRoom(room), JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (e) {
    console.error('Errore salvataggio:', e);
  }
}

// === Gestione stanze ===
const rooms = new Map();

function joinRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws._room = room;
}

function leaveRoom(ws) {
  if (ws._room && rooms.has(ws._room)) {
    rooms.get(ws._room).delete(ws);
    if (rooms.get(ws._room).size === 0) rooms.delete(ws._room);
  }
  ws._room = null;
}

function broadcast(room, data, exclude) {
  const peers = rooms.get(room) || new Set();
  for (const client of peers) {
    if (client === exclude) continue;
    if (client.readyState === 1) client.send(JSON.stringify(data));
  }
}

// === Eventi socket ===
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      joinRoom(ws, msg.room);

      // Se esiste uno snapshot salvato, lo invio al client
      const snapshot = readSnapshot(msg.room);
      if (snapshot) {
        ws.send(JSON.stringify({ type: 'snapshot', room: msg.room, payload: snapshot }));
      }
      return;
    }

    if (msg.type === 'broadcast') {
      // Se il DM invia uno snapshot completo → salvalo su disco
      if (msg.innerType === 'snapshot' && msg.room && msg.payload) {
        writeSnapshot(msg.room, msg.payload);
      }

      // Invia il messaggio a tutti gli altri
      broadcast(msg.room, { type: msg.innerType, room: msg.room, payload: msg.payload }, ws);
      return;
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
