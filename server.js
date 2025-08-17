// server.js
import { WebSocketServer } from 'ws';
import { MongoClient } from 'mongodb';

/** ====== Config ====== */
const PORT = process.env.PORT || 10000;

// ENV su Render:
// - MONGODB_URI (obbligatoria): connection string completa di utente e password
// - MONGODB_DB (opzionale)     : default 'dndhub'
// - MONGODB_COLLECTION (opt.)  : default 'rooms'
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'dndhub';
const COLLECTION_NAME = process.env.MONGODB_COLLECTION || 'rooms';

if (!MONGODB_URI) {
  console.error('❌ Manca MONGODB_URI (Render → Environment).');
  process.exit(1);
}

/** ====== Stato runtime ====== */
// roomId -> Set<WebSocket>
const rooms = new Map();

// sarà valorizzata dopo la connessione a Mongo
let collection;

/** ====== Mongo helpers ====== */
async function connectMongo() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  collection = client.db(DB_NAME).collection(COLLECTION_NAME);
  // 1 doc per stanza
  await collection.createIndex({ room: 1 }, { unique: true });

  console.log('✅ Connesso a MongoDB');
}

async function readSnapshot(room) {
  const doc = await collection.findOne({ room });
  return doc?.snapshot ?? null;
}

async function writeSnapshot(room, snapshot) {
  await collection.updateOne(
    { room },
    { $set: { room, snapshot, updatedAt: new Date() } },
    { upsert: true }
  );
}

/** ====== WS helpers ====== */
function broadcast(room, messageObj, exceptWs = null) {
  const set = rooms.get(room);
  if (!set) return;
  const raw = JSON.stringify(messageObj);
  for (const ws of set) {
    if (ws !== exceptWs && ws.readyState === ws.OPEN) {
      ws.send(raw);
    }
  }
}

/** ====== Server ====== */
async function start() {
  // 1) connetti Mongo
  await connectMongo();

  // 2) avvia WS
  const wss = new WebSocketServer({ port: PORT });
  console.log(`🔌 WebSocket server su ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    let currentRoom = null;

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // 💡 Adegua i "type" a quelli che già usa il tuo client
      switch (msg.type) {
        case 'join': {
          // msg.room
          currentRoom = String(msg.room);
          if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set());
          rooms.get(currentRoom).add(ws);

          // manda al nuovo utente lo snapshot salvato (se c'è)
          const snap = await readSnapshot(currentRoom);
          ws.send(JSON.stringify({ type: 'snapshot', snapshot: snap ?? null }));
          break;
        }

        case 'snapshot': {
          // msg.snapshot (stato completo)
          if (!currentRoom) break;
          await writeSnapshot(currentRoom, msg.snapshot);
          // inoltra agli altri
          broadcast(currentRoom, { type: 'snapshot', snapshot: msg.snapshot }, ws);
          break;
        }

        case 'patch': {
          // msg.patch (diff/operazioni) – inoltra agli altri
          if (!currentRoom) break;
          broadcast(currentRoom, { type: 'patch', patch: msg.patch }, ws);
          break;
        }

        // aggiungi qui eventuali altri messaggi che usi
        // es. chat, typing, ecc.
      }
    });

    ws.on('close', () => {
      if (currentRoom && rooms.has(currentRoom)) {
        const set = rooms.get(currentRoom);
        set.delete(ws);
        if (set.size === 0) rooms.delete(currentRoom);
      }
    });
  });
}

start().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});
