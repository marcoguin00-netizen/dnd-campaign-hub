import React, { useEffect, useMemo, useRef, useState } from "react";

// -------------------- Real-time client (WebSocket) --------------------
class RT {
  constructor(url, room) {
    this.url = url;
    this.room = room;
    this.ws = null;
    this.queue = [];
    this.listeners = new Set();
    this.open = false;
    this.connect();
  }
  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => {
      this.open = true;
      this.sendRaw({ type: 'join', room: this.room });
      this.queue.forEach(m => this.sendRaw(m));
      this.queue = [];
    });
    this.ws.addEventListener('message', (ev) => {
      try { const msg = JSON.parse(ev.data); this.listeners.forEach(fn => fn(msg)); } catch {}
    });
    this.ws.addEventListener('close', () => { this.open = false; /* auto-retry */ setTimeout(()=> this.connect(), 1000); });
    this.ws.addEventListener('error', () => { try { this.ws.close(); } catch {} });
  }
  on(fn){ this.listeners.add(fn); return () => this.listeners.delete(fn); }
  sendRaw(obj){ if(this.open) this.ws.send(JSON.stringify(obj)); else this.queue.push(obj); }
  send(innerType, payload){ this.sendRaw({ type:'broadcast', room:this.room, innerType, payload }); }
  close(){ try { this.ws.close(); } catch {} }
}

// -------------------- Helpers & persistence --------------------
const uid = () => Math.random().toString(36).slice(2, 10);
const genCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random()*32)]).join("");
const loadData = () => {
  try { const raw = localStorage.getItem("dndhub_data_v1"); if (raw) return JSON.parse(raw); } catch {}
  return { campaigns: [], lastCampaignId: null };
};
const saveData = (d) => localStorage.setItem("dndhub_data_v1", JSON.stringify(d));

const fileToObjectUrl = async (file) => URL.createObjectURL(file);

// -------------------- UI atoms --------------------
const Button = ({ as: As = "button", className = "", children, ...props }) => (
  <As className={`px-4 py-2 rounded-2xl shadow hover:shadow-md transition active:scale-[.99] disabled:opacity-50 disabled:cursor-not-allowed ${className}`} {...props}>{children}</As>
);
const Card = ({ className = "", children }) => (<div className={`rounded-2xl shadow p-4 bg-white/70 backdrop-blur border border-slate-200 ${className}`}>{children}</div>);
const Input = ({ className = "", ...props }) => (<input className={`px-3 py-2 rounded-xl border w-full outline-none focus:ring ring-sky-300 ${className}`} {...props} />);
const TextArea = ({ className = "", ...props }) => (<textarea className={`px-3 py-2 rounded-xl border w-full outline-none focus:ring ring-sky-300 min-h-[120px] ${className}`} {...props} />);
const Chip = ({ children, onClick, active }) => (<button onClick={onClick} className={`px-2 py-1 rounded-full border text-xs mr-2 mb-2 ${active ? "bg-sky-100 border-sky-400" : "bg-white border-slate-300"}`}>{children}</button>);

// -------------------- App --------------------
export default function App() {
  const [data, setData] = useState(loadData());
  const [role, setRole] = useState("DM");
  const [playerName, setPlayerName] = useState("");
  const [view, setView] = useState("entry");
  const activeCampaign = useMemo(() => data.campaigns.find(c => c.id === data.lastCampaignId) || null, [data]);
  const [joinRequest, setJoinRequest] = useState(null); // {code, name}
  const rtRef = useRef(null);

  useEffect(() => saveData(data), [data]);

  // setup RT connection based on active campaign or pending join
  useEffect(() => {
    const roomCode = activeCampaign?.code || joinRequest?.code;
    if (!roomCode) return;
    const rt = new RT(import.meta.env.VITE_WS_URL || "ws://localhost:3001", roomCode);
    rtRef.current = rt;

    const off = rt.on((msg) => {
      if (msg.type === 'snapshot') {
        const incoming = msg.payload;
        setData((d) => {
          const existing = d.campaigns.find(c => c.code === incoming.code);
          if (!existing) {
            return { ...d, campaigns: [...d.campaigns, incoming], lastCampaignId: incoming.id };
          }
          if ((existing.version || 0) >= (incoming.version || 0)) return d; // ignore older
          return { ...d, campaigns: d.campaigns.map(c => c.code === incoming.code ? incoming : c) };
        });
        if (joinRequest && joinRequest.code === incoming.code) {
          // add me as player (once)
          setJoinRequest(null);
          setPlayerName(joinRequest.name);
          setRole("Player");
          setView("home");
          // push my presence
          setTimeout(() => {
            updateCampaign((c) => {
              if (c.players.some(p => p.name === joinRequest.name)) return c;
              return { ...c, players: [...c.players, { id: uid(), name: joinRequest.name }] };
            });
          }, 0);
        }
      } else if (msg.type === 'request_snapshot') {
        if (activeCampaign && activeCampaign.code === roomCode) {
          rt.send('snapshot', activeCampaign);
        }
      }
    });

    // when connected, request snapshot if we are joining
    const onOpen = () => { if (joinRequest) rt.send('request_snapshot', {}); };
    rt.ws.addEventListener('open', onOpen);

    return () => { off(); rt.ws.removeEventListener('open', onOpen); rt.close(); if (rtRef.current === rt) rtRef.current = null; };
  }, [activeCampaign?.code, joinRequest?.code]);

  const setCampaign = (id) => setData((d) => ({ ...d, lastCampaignId: id }));

  const createCampaign = async ({ name, imageFile }) => {
    const id = uid();
    const code = genCode();
    const imageUrl = imageFile ? await fileToObjectUrl(imageFile) : "";
    const campaign = { id, name, code, imageUrl, players: [], manuals: [], gallery: [], characters: [], sessions: [], soundEnabled: true, version: 1 };
    setData((d) => ({ ...d, campaigns: [...d.campaigns, campaign], lastCampaignId: id }));
    setRole("DM");
    setView("home");
    // announce snapshot
    setTimeout(() => rtRef.current?.send('snapshot', campaign), 0);
  };

  const joinCampaign = ({ code, name }) => {
    const c = data.campaigns.find(x => x.code === code.trim().toUpperCase());
    if (c) {
      setPlayerName(name.trim());
      setRole("Player");
      setData((d) => ({ ...d, lastCampaignId: c.id }));
      setView("home");
      // add me if not present (local campaign case)
      updateCampaign((cc) => {
        if (cc.players.some(p => p.name === name.trim())) return cc;
        return { ...cc, players: [...cc.players, { id: uid(), name: name.trim() }] };
      });
      return;
    }
    // Remote join: connect to the room and request snapshot
    setJoinRequest({ code: code.trim().toUpperCase(), name: name.trim() });
    setView("home");
  };

  const upsertCampaign = (patch) => {
    if (!activeCampaign) return;
    setData((d) => {
      let updated = null;
      const campaigns = d.campaigns.map((c) => {
        if (c.id === activeCampaign.id) { updated = { ...c, ...patch, version: (c.version || 0) + 1 }; return updated; }
        return c;
      });
      const nd = { ...d, campaigns };
      setTimeout(() => updated && rtRef.current?.send('snapshot', updated), 0);
      return nd;
    });
  };

  const updateCampaign = (fn) => {
    if (!activeCampaign) return;
    setData((d) => {
      let updated = null;
      const campaigns = d.campaigns.map((c) => {
        if (c.id === activeCampaign.id) {
          const next = fn(c);
          updated = { ...next, version: (c.version || 0) + 1 };
          return updated;
        }
        return c;
      });
      const nd = { ...d, campaigns };
      setTimeout(() => updated && rtRef.current?.send('snapshot', updated), 0);
      return nd;
    });
  };

  const resetAll = () => {
    if (confirm("Sicuro di voler cancellare TUTTO il contenuto locale?")) {
      localStorage.removeItem("dndhub_data_v1");
      setData(loadData());
      setView("entry");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-indigo-100 text-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Header role={role} setRole={setRole} activeCampaign={activeCampaign} setView={setView} onReset={resetAll} />
        {view === "entry" && (
          <EntryView
            campaigns={data.campaigns}
            setCampaign={(id) => { setCampaign(id); setView("home"); }}
            onCreate={createCampaign}
            onJoin={joinCampaign}
          />
        )}
        {activeCampaign && view !== "entry" && (
          <>
            <NavTabs view={view} setView={setView} />
            {view === "home" && <HomeView role={role} campaign={activeCampaign} onReplaceImage={async (file) => { const url = await fileToObjectUrl(file); upsertCampaign({ imageUrl: url }); }} />}
            {view === "manuals" && <ManualsView role={role} campaign={activeCampaign} updateCampaign={updateCampaign} />}
            {view === "pg" && <PGView role={role} campaign={activeCampaign} playerName={playerName} updateCampaign={updateCampaign} />}
            {view === "session" && <SessionView role={role} campaign={activeCampaign} updateCampaign={updateCampaign} />}
            {view === "gallery" && <GalleryView role={role} campaign={activeCampaign} updateCampaign={updateCampaign} />}
          </>
        )}
      </div>
    </div>
  );
}

// -------------------- Header + Tabs --------------------
function Header({ role, setRole, activeCampaign, setView, onReset }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold">D&D Campaign Hub</h1>
        <p className="text-sm opacity-70">
          {activeCampaign ? (
            <>
              Campagna attiva: <span className="font-medium">{activeCampaign.name}</span> —
              Codice invito <code className="font-mono bg-white/60 px-1 rounded">{activeCampaign.code}</code>
              <Button className="ml-2 text-xs py-1 px-2" onClick={() => navigator.clipboard?.writeText(activeCampaign.code)}>Copia codice</Button>
            </>
          ) : (<>Nessuna campagna attiva</>)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-white rounded-xl p-1 border">
          {["DM", "Player"].map((r) => (
            <Button key={r} className={`px-3 py-1 text-sm ${role === r ? "bg-sky-200" : "bg-transparent"}`} onClick={() => setRole(r)}>{r}</Button>
          ))}
        </div>
        <Button className="bg-white border" onClick={() => setView("entry")}>Cambia campagna</Button>
        <Button className="bg-rose-50 border border-rose-200" onClick={onReset}>Reset dati</Button>
      </div>
    </div>
  );
}

function NavTabs({ view, setView }) {
  const tabs = [
    { id: "home", label: "Home" },
    { id: "manuals", label: "Manuali" },
    { id: "pg", label: "PG" },
    { id: "session", label: "Sessione" },
    { id: "gallery", label: "Galleria" },
  ];
  return (
    <div className="sticky top-2 z-10 bg-transparent mb-4">
      <div className="inline-flex bg-white rounded-2xl border shadow p-1">
        {tabs.map((t) => (
          <Button key={t.id} className={`px-4 py-2 text-sm ${view === t.id ? "bg-sky-200" : "bg-transparent"}`} onClick={() => setView(t.id)}>{t.label}</Button>
        ))}
      </div>
    </div>
  );
}

// -------------------- Entry --------------------
function EntryView({ campaigns, setCampaign, onCreate, onJoin }) {
  const [name, setName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [joinName, setJoinName] = useState("");
  const [code, setCode] = useState("");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <h2 className="font-semibold text-lg mb-2">Seleziona campagna esistente</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm opacity-70">Nessuna campagna salvata in questo browser.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-xl p-3 border">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs opacity-60">Codice: {c.code}</div>
                </div>
                <Button className="bg-sky-100" onClick={() => setCampaign(c.id)}>Apri</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-lg mb-2">Crea nuova campagna (DM)</h2>
        <div className="space-y-3">
          <Input placeholder="Nome campagna" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <label className="text-sm">Immagine campagna (opzionale)</label>
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
          </div>
          <Button className="bg-emerald-100" onClick={() => name.trim() && onCreate({ name: name.trim(), imageFile })}>Crea campagna</Button>
          <p className="text-xs opacity-70">Verrà generato un <b>codice invito</b> da condividere con i Player.</p>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-lg mb-2">Unisciti con codice (Player)</h2>
        <div className="space-y-3">
          <Input placeholder="Il tuo nome" value={joinName} onChange={(e) => setJoinName(e.target.value)} />
          <Input placeholder="Codice campagna" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button className="bg-sky-100" onClick={() => joinName.trim() && code.trim() && onJoin({ code, name: joinName })}>Entra</Button>
          <p className="text-xs opacity-70">Se la campagna non è presente in locale, verrà richiesta in <b>tempo reale</b> al DM.</p>
        </div>
      </Card>
    </div>
  );
}

// -------------------- Home --------------------
function HomeView({ role, campaign, onReplaceImage }) {
  const nextSession = useMemo(() => {
    const future = [...campaign.sessions].filter((s) => new Date(s.dateISO) >= new Date());
    future.sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO));
    return future[0] || null;
  }, [campaign.sessions]);

  const lastSession = useMemo(() => {
    const past = [...campaign.sessions].filter((s) => new Date(s.dateISO) < new Date());
    past.sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO));
    return past[0] || null;
  }, [campaign.sessions]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2">
        <div className="flex items-start gap-4">
          <img src={campaign.imageUrl || "https://picsum.photos/seed/dnd/600/300"} alt="cover" className="w-56 h-32 object-cover rounded-xl border" />
          <div className="flex-1">
            <h2 className="font-semibold text-xl mb-2">{campaign.name}</h2>
            {role === "DM" && (
              <div className="space-y-2">
                <label className="text-sm block">Sostituisci immagine</label>
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onReplaceImage(e.target.files[0])} />
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Card>
            <h3 className="font-semibold">Prossima sessione</h3>
            {nextSession ? (
              <div className="text-sm mt-2">
                <div><b>Data:</b> {new Date(nextSession.dateISO).toLocaleString()}</div>
                <div className="opacity-70 mt-1">{nextSession.summary || "—"}</div>
              </div>
            ) : (<p className="text-sm opacity-70 mt-2">Nessuna sessione pianificata.</p>)}
          </Card>
          <Card>
            <h3 className="font-semibold">Sessione precedente</h3>
            {lastSession ? (
              <div className="text-sm mt-2">
                <div><b>Data:</b> {new Date(lastSession.dateISO).toLocaleString()}</div>
                <div className="opacity-70 mt-1">{lastSession.summary || "—"}</div>
              </div>
            ) : (<p className="text-sm opacity-70 mt-2">Ancora nessuna sessione svolta.</p>)}
          </Card>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-2">Partecipanti</h3>
        <ul className="text-sm space-y-1 max-h-56 overflow-auto pr-2">
          {campaign.players.length === 0 && <li className="opacity-60">Nessun player ancora.</li>}
          {campaign.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between">
              <span>{p.name}</span>
              {role === "DM" && <span className="text-xs opacity-60">ID: {p.id.slice(0,6)}</span>}
            </li>
          ))}
        </ul>
        <div className="text-xs mt-3 opacity-70">Condividi il codice invito per aggiungere giocatori.</div>
      </Card>
    </div>
  );
}

// -------------------- Manuals --------------------
function ManualsView({ role, campaign, updateCampaign }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");

  const addManual = async () => {
    if (!file) return;
    const url = await fileToObjectUrl(file);
    updateCampaign((c) => ({ ...c, manuals: [...c.manuals, { id: uid(), name: title || file.name, url }] }));
    setFile(null); setTitle("");
  };
  const removeManual = (id) => updateCampaign((c) => ({ ...c, manuals: c.manuals.filter((m) => m.id !== id) }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2">
        <h2 className="font-semibold text-lg mb-3">Manuali</h2>
        {campaign.manuals.length === 0 ? (
          <p className="text-sm opacity-70">Nessun documento caricato.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {campaign.manuals.map((m) => (
              <Card key={m.id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <a className="text-xs text-sky-700 underline" href={m.url} target="_blank" rel="noreferrer">Apri</a>
                </div>
                {role === "DM" && (<Button className="bg-rose-100" onClick={() => removeManual(m.id)}>Elimina</Button>)}
              </Card>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold mb-2">{role === "DM" ? "Carica PDF" : "Info"}</h3>
        {role === "DM" ? (
          <div className="space-y-3">
            <Input placeholder="Titolo (opzionale)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button className="bg-emerald-100" onClick={addManual} disabled={!file}>Carica</Button>
            <p className="text-xs opacity-70">I documenti sono salvati localmente in questo browser (demo).</p>
          </div>
        ) : (<p className="text-sm opacity-70">Qui puoi consultare i PDF caricati dal DM.</p>)}
      </Card>
    </div>
  );
}

// -------------------- PG --------------------
function PGView({ role, campaign, playerName, updateCampaign }) {
  const [charName, setCharName] = useState("");
  const [charFile, setCharFile] = useState(null);

  const me = useMemo(() => campaign.players.find((p) => p.name === playerName) || null, [campaign.players, playerName]);

  const myCharacters = useMemo(() => {
    if (role === "DM") return campaign.characters;
    return campaign.characters.filter((ch) => ch.ownerPlayerId === me?.id);
  }, [campaign.characters, role, me]);

  const addCharacter = async () => {
    if (!charName.trim()) return;
    const charId = uid();
    let files = [];
    if (charFile) {
      const url = await fileToObjectUrl(charFile);
      files = [{ id: uid(), name: charFile.name, url }];
    }
    const ownerPlayerId = role === "DM" ? null : me?.id || null;
    updateCampaign((c) => ({ ...c, characters: [...c.characters, { id: charId, name: charName.trim(), ownerPlayerId, files }] }));
    setCharName(""); setCharFile(null);
  };

  const removeCharacter = (id) => updateCampaign((c) => ({ ...c, characters: c.characters.filter((x) => x.id !== id) }));

  const addFile = async (charId, file) => {
    const url = await fileToObjectUrl(file);
    updateCampaign((c) => ({
      ...c,
      characters: c.characters.map((ch) => ch.id === charId ? { ...ch, files: [...ch.files, { id: uid(), name: file.name, url }] } : ch)
    }));
  };

  const removeFile = (charId, fileId) => updateCampaign((c) => ({
    ...c,
    characters: c.characters.map((ch) => ch.id === charId ? { ...ch, files: ch.files.filter((f) => f.id !== fileId) } : ch)
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2">
        <h2 className="font-semibold text-lg mb-3">Schede personaggi</h2>
        {myCharacters.length === 0 ? (
          <p className="text-sm opacity-70">Nessun personaggio.</p>
        ) : (
          <div className="space-y-3">
            {myCharacters.map((ch) => (
              <Card key={ch.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{ch.name}</div>
                    {role === "DM" && ch.ownerPlayerId && (
                      <div className="text-xs opacity-60">Giocatore: {campaign.players.find((p) => p.id === ch.ownerPlayerId)?.name}</div>
                    )}
                  </div>
                  {(role === "DM" || (me && ch.ownerPlayerId === me.id)) && (
                    <Button className="bg-rose-100" onClick={() => removeCharacter(ch.id)}>Elimina</Button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {ch.files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between bg-white rounded-xl p-2 border">
                      <a className="text-sm underline" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                      {(role === "DM" || (me && ch.ownerPlayerId === me.id)) && (
                        <Button className="bg-rose-50" onClick={() => removeFile(ch.id, f.id)}>Rimuovi</Button>
                      )}
                    </div>
                  ))}
                </div>
                {(role === "DM" || (me && ch.ownerPlayerId === me.id)) && (
                  <div className="mt-3">
                    <label className="text-sm">Aggiungi file alla scheda</label><br />
                    <input type="file" onChange={(e) => e.target.files?.[0] && addFile(ch.id, e.target.files[0])} />
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold mb-2">{role === "DM" ? "Crea personaggio" : "Il tuo personaggio"}</h3>
        <div className="space-y-3">
          <Input placeholder="Nome personaggio" value={charName} onChange={(e) => setCharName(e.target.value)} />
          <input type="file" onChange={(e) => setCharFile(e.target.files?.[0] || null)} />
          <Button className="bg-emerald-100" onClick={addCharacter} disabled={!charName.trim()}>Salva</Button>
          <p className="text-xs opacity-70">Puoi allegare PDF/immagini della scheda.</p>
        </div>
      </Card>
    </div>
  );
}

// -------------------- Session --------------------
function SessionView({ role, campaign, updateCampaign }) {
  const [date, setDate] = useState("");
  const [summary, setSummary] = useState("");

  const addSession = () => {
    if (!date) return;
    updateCampaign((c) => ({ ...c, sessions: [...c.sessions, { id: uid(), dateISO: new Date(date).toISOString(), summary, images: [], docs: [] }] }));
    setDate(""); setSummary("");
  };

  const removeSession = (id) => updateCampaign((c) => ({ ...c, sessions: c.sessions.filter((s) => s.id !== id) }));

  const sorted = useMemo(() => {
    const list = [...campaign.sessions];
    list.sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO));
    return list;
  }, [campaign.sessions]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2">
        <h2 className="font-semibold text-lg mb-3">Sessioni</h2>
        {sorted.length === 0 ? (
          <p className="text-sm opacity-70">Nessuna sessione pianificata.</p>
        ) : (
          <div className="space-y-3">
            {sorted.map((s) => (
              <Card key={s.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{new Date(s.dateISO).toLocaleString()}</div>
                    <div className="text-sm opacity-70 mt-1 whitespace-pre-wrap">{s.summary || "—"}</div>
                  </div>
                  {role === "DM" && (<Button className="bg-rose-100" onClick={() => removeSession(s.id)}>Elimina</Button>)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold mb-2">{role === "DM" ? "Nuova sessione" : "Info"}</h3>
        {role === "DM" ? (
          <div className="space-y-3">
            <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            <TextArea placeholder="Riassunto / appunti" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <Button className="bg-emerald-100" onClick={addSession} disabled={!date}>Aggiungi</Button>
          </div>
        ) : (<p className="text-sm opacity-70">Consulta qui la pianificazione creata dal DM.</p>)}
      </Card>
    </div>
  );
}

// -------------------- Gallery --------------------
function GalleryView({ role, campaign, updateCampaign }) {
  const [files, setFiles] = useState([]);
  const [tagText, setTagText] = useState("");
  const [activeTag, setActiveTag] = useState("");

  const allTags = useMemo(() => {
    const s = new Set();
    campaign.gallery.forEach((g) => g.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [campaign.gallery]);

  const visible = useMemo(() => {
    if (!activeTag) return campaign.gallery;
    return campaign.gallery.filter((g) => g.tags.includes(activeTag));
  }, [campaign.gallery, activeTag]);

  const addImages = async () => {
    if (!files.length) return;
    const items = await Promise.all(
      Array.from(files).map(async (file) => {
        const url = await fileToObjectUrl(file);
        const tags = tagText.split(",").map((t) => t.trim()).filter(Boolean);
        return { id: uid(), name: file.name, url, tags };
      })
    );
    updateCampaign((c) => ({ ...c, gallery: [...c.gallery, ...items] }));
    setFiles([]); setTagText("");
  };

  const removeImage = (id) => updateCampaign((c) => ({ ...c, gallery: c.gallery.filter((g) => g.id !== id) }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-lg">Galleria</h2>
          <div className="flex items-center flex-wrap">
            <Chip active={!activeTag} onClick={() => setActiveTag("")}>Tutte</Chip>
            {allTags.map((t) => (<Chip key={t} active={activeTag === t} onClick={() => setActiveTag(t)}>{t}</Chip>))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm opacity-70">Nessuna immagine{activeTag ? ` con tag "${activeTag}"` : ""}.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {visible.map((g) => (
              <Card key={g.id} className="p-2">
                <img src={g.url} alt={g.name} className="w-full h-32 object-cover rounded-xl border" />
                <div className="mt-2 text-sm font-medium truncate" title={g.name}>{g.name}</div>
                <div className="mt-1 flex flex-wrap">
                  {g.tags.map((t) => (<span key={t} className="text-[10px] px-2 py-0.5 bg-slate-100 rounded-full mr-1 mb-1 border">{t}</span>))}
                </div>
                {role === "DM" && (<div className="mt-2 text-right"><Button className="bg-rose-100" onClick={() => removeImage(g.id)}>Elimina</Button></div>)}
              </Card>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold mb-2">{role === "DM" ? "Carica immagini" : "Ricerca"}</h3>
        {role === "DM" ? (
          <div className="space-y-3">
            <input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.target.files || [])} />
            <Input placeholder="Tag separati da virgola (es. mappa, npc)" value={tagText} onChange={(e) => setTagText(e.target.value)} />
            <Button className="bg-emerald-100" onClick={addImages} disabled={!files.length}>Carica</Button>
            <p className="text-xs opacity-70">Aggiungi tag per facilitare la ricerca in sessione.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm opacity-70">Filtra per tag:</p>
            <div>{allTags.map((t) => (<Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? "" : t)}>{t}</Chip>))}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
