# D&D Campaign Hub — Real‑Time (Demo)

Prototipo React con **sincronizzazione in tempo reale** via WebSocket (server Node incluso).

## Requisiti
- **Node 18+**

## Avvio rapido
1. Apri un terminale nella cartella del progetto ed esegui:
   ```bash
   npm install
   npm run server   # avvia il server WS su ws://localhost:3001
   ```
2. In un secondo terminale:
   ```bash
   npm run dev      # avvia il client Vite su http://localhost:5173
   ```
3. Apri la pagina in **due browser o dispositivi**. Crea una campagna come **DM**,
   condividi il **codice** e, dall'altro client, entra come **Player**.
   Tutte le modifiche (player aggiunti, sessioni, galleria, manuali, PG...) vengono
   propagate in tempo reale alla stanza della campagna.

> Nota: questa è una demo **senza persistenza server**. I file caricati restano nel browser (Object URL) e lo stato è salvato in `localStorage`. Per produzione puoi sostituire il server WS con un backend (es. Supabase Realtime o Firebase) e salvare i file su storage.

## Config opzionale
Puoi cambiare l'URL del WebSocket impostando la variabile:
```
VITE_WS_URL=wss://tuo-dominio:3001
```
in un file `.env` (opzionale).
