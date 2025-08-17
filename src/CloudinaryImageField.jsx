// src/CloudinaryImageField.jsx
import React, { useState } from "react";

// Leggo le variabili d'ambiente (impostate su Vercel)
const CLOUD_NAME = import.meta.env.VITE_CLD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLD_UPLOAD_PRESET;

/**
 * Campo upload immagine su Cloudinary (unsigned).
 * Dopo l'upload chiama onChange(url) con la URL Cloudinary.
 *
 * Props:
 * - value: string | null (URL immagine attuale)
 * - onChange: (url: string) => void   // aggiorna lo stato campagna nel parent
 * - roomId?: string                   // se vuoi organizzare per stanza (cartella)
 * - ws?: WebSocket                    // opzionale: per broadcast live agli altri client
 */
export default function CloudinaryImageField({ value, onChange, roomId, ws }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function uploadToCloudinary(file, folder = "dnd-hub") {
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      throw new Error(
        "Mancano VITE_CLD_NAME o VITE_CLD_UPLOAD_PRESET (controlla su Vercel)."
      );
    }

    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", UPLOAD_PRESET);
    form.append("folder", folder); // cartella in Cloudinary (opzionale)

    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload fallito: ${text}`);
    }
    const json = await res.json(); // json.secure_url è quello che ci serve
    return json.secure_url;
  }

  async function handleSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    try {
      const folder = roomId ? `dnd-hub/${roomId}` : "dnd-hub";
      const url = await uploadToCloudinary(file, folder);

      // aggiorno lo stato nel parent
      onChange?.(url);

      // opzionale: broadcasta agli altri client già collegati
      if (ws && roomId) {
        ws.send(
          JSON.stringify({
            type: "broadcast",
            room: roomId,
            innerType: "image:added",
            payload: url,
          })
        );
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Errore upload");
    } finally {
      setBusy(false);
      // resetto il valore dell'input in modo da poter ricaricare la stessa immagine
      e.target.value = "";
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ fontWeight: 600 }}>Immagine di copertina</label>

      <input type="file" accept="image/*" onChange={handleSelect} disabled={busy} />

      {busy && <div style={{ opacity: 0.7 }}>Caricamento…</div>}
      {error && <div style={{ color: "crimson" }}>{error}</div>}

      {value ? (
        <img
          src={value}
          alt="Campaign"
          style={{ maxWidth: 320, borderRadius: 8, border: "1px solid #333" }}
        />
      ) : (
        <div style={{ opacity: 0.6 }}>Nessuna immagine caricata.</div>
      )}
    </div>
  );
}
