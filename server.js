// server.js
import { WebSocketServer } from 'ws';
import { MongoClient } from 'mongodb';

const PORT = process.env.PORT || 10000;

// ------- MongoDB config -------
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'dndhub';
const COLLECTION_NAME = process.env.MONGODB_COLLECTION || 'rooms';

if (!MONGODB_URI) {
  console.error('❌ Manca MONGODB_URI (Render -> Environment).');
  process.exit(1);
}

async function start() {
  // Connetti a MongoDB
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const collection = client.db(DB_NAME).collection(COLLECTION_NAME);
  await collection.createIndex({ _id: 1 });
  console.log('✅ Connesso a MongoDB');

  // Avvia WebSocket
  const wss = new WebSocketServer({ port: PORT });
  console.log(`✅ WebSocket server in ascolto su ws://localhost:${PORT}`);

  // roomId -> Set<WebSocket>
  const rooms = new Map();

  function joinRoom(ws, roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
    ws._roomId = roomId;
  }

  function leaveRoom(ws) {
    const roomId = ws._roomId;
    if (!roomId) return;
    const set = rooms.get(roomId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(roomId);
    }
    ws._roomId = null;
  }

  function broadcast(roomId, data, exclude) {
    const peers = rooms.get(roomId);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === exclude) continue;
      if (peer.readyState === 1) peer.send(JSON.stringify(data));
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // { type: 'join', room }
      if (msg.type === 'join' && msg.room) {
        joinRoom(ws, msg.room);
        // invia lo stato salvato, se esiste
        const doc = await collection.findOne({ _id: msg.room });
        ws.send(JSON.stringify({ type: 'restore', payload: doc?.state ?? null }));
        return;
      }

      // { type: 'broadcast', room, innerType, payload }
      if (msg.type === 'broadcast' && msg.room) {
        broadcast(
          msg.room,
          { type: msg.innerType, payload: msg.payload },
          ws
        );
        return;
      }

      // { type: 'save', room, payload: <stato intero> }
      if (msg.type === 'save' && msg.room) {
        await collection.updateOne(
          { _id: msg.room },
          { $set: { state: msg.payload, updatedAt: new Date() } },
          { upsert: true }
        );
        return;
      }

      // { type: 'restore', room }
      if (msg.type === 'restore' && msg.room) {
        const doc = await collection.findOne({ _id: msg.room });
        ws.send(JSON.stringify({ type: 'restore', payload: doc?.state ?? null }));
        return;
      }
    });

    ws.on('close', () => {
      leaveRoom(ws);
    });
  });

  process.on('SIGINT', async () => {
    try { await client.close(); } catch {}
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('Errore all’avvio:', err);
  process.exit(1);
});
