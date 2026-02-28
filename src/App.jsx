import { useState, useEffect } from "react";
import { db, auth } from "./firebase.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";

/* ─── PASSWORDS ───────────────────────────────────────────────────────────
   PASSWORD_SOCI  → accesso in sola lettura (calendario visibile, nessuna azione)
   ADMINS         → accesso completo (prenotare, gestire, note, eliminare)
   Il sistema riconosce automaticamente il ruolo dalla password inserita.
   ────────────────────────────────────────────────────────────────────── */
const PASSWORD_SOCI = "veritas2024";

const ADMINS = [
  { name:"Filippo",  password:"filippo2024",  email:"filippo@example.com"  },
  { name:"Roberto",  password:"roberto2024",  email:"roberto@example.com"  },
  { name:"Patrizia", password:"patrizia2024", email:"patrizia@example.com" },
];

/* ─── STRUTTURA CAMPI ─────────────────────────────────────────────────── */
const FIELDS = [
  { id:"campo7a",   name:"Campo 7 — A", short:"C7A", color:"#16a34a", light:"#dcfce7", icon:"⚽" },
  { id:"campo7b",   name:"Campo 7 — B", short:"C7B", color:"#2563eb", light:"#dbeafe", icon:"⚽" },
  { id:"campo11",   name:"Campo 11",    short:"C11", color:"#d97706", light:"#fef3c7", icon:"🏟️" },
  { id:"clubhouse", name:"Club House",  short:"CH",  color:"#9333ea", light:"#f3e8ff", icon:"🏠" },
];

const HOURS        = [19,20,21,22,23];
const DAY_SHORT    = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const DAY_FULL     = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
const MONTH_NAMES  = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const MONTH_SHORT  = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

/* ─── UTILS ───────────────────────────────────────────────────────────── */
const fmtDate  = d => d.toISOString().split("T")[0];
const parseD   = s => { const [y,m,d]=s.split("-"); return new Date(+y,+m-1,+d); };
const addDays  = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const weekOf   = base => {
  const s=new Date(base), dy=s.getDay();
  s.setDate(s.getDate()+(dy===0?-6:1-dy));
  return Array.from({length:7},(_,i)=>addDays(s,i));
};

/* ─── TOKENS ──────────────────────────────────────────────────────────── */
const T = {
  font:    "'Nunito', sans-serif",
  display: "'Playfair Display', serif",
  r: { sm:8, md:12, lg:16, xl:20, pill:50 },
  s: {
    xs:"0 1px 3px rgba(0,0,0,.06)",
    sm:"0 2px 8px rgba(0,0,0,.08)",
    md:"0 4px 20px rgba(0,0,0,.12)",
    lg:"0 8px 40px rgba(0,0,0,.18)",
  },
};

/* ═══════════════════════════════════════════════════════════════════════ */
export default function App() {

  /* ── auth: null = non loggato, "soci" = sola lettura, { name } = admin ── */
  const [session,    setSession]   = useState(null);
  const [pwd,        setPwd]       = useState("");
  const [pwdErr,     setPwdErr]    = useState("");
  const [pwdLoading, setPwdLoading]= useState(false);

  /* ── dati ── */
  const [bookings,   setBookings]  = useState([]);

  /* ── calendario ── */
  const [selDate,    setSelDate]   = useState(new Date());
  const [weekBase,   setWeekBase]  = useState(new Date());
  const [selField,   setSelField]  = useState("campo7a");
  const [view,       setView]      = useState("calendar");

  /* ── sheets ── */
  const [bookSheet,  setBookSheet] = useState(null);
  const [bookName,   setBookName]  = useState("");
  const [bookPhone,  setBookPhone] = useState("");
  const [editSheet,  setEditSheet] = useState(null);
  const [editNote,   setEditNote]  = useState("");

  /* ── feedback ── */
  const [occupied,   setOccupied]  = useState(null);
  const [toast,      setToast]     = useState(null);

  /* ── sync Firestore (realtime) ── */
  useEffect(() => {
    const qy = query(collection(db, "bookings"), orderBy("date"), orderBy("hour"));
    const unsub = onSnapshot(qy, (snap) => {
      const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBookings(arr);
    });
    return () => unsub();
  }, []);


  const notify = (msg,ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };


  // ── Export Excel (solo admin) ──
  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const rows = [...bookings]
        .sort((a,b)=>String(a.date).localeCompare(String(b.date)) || (a.hour??0)-(b.hour??0) || String(a.fieldId).localeCompare(String(b.fieldId)))
        .map(b => {
          const f = FIELDS.find(x=>x.id===b.fieldId);
          return {
            Data: b.date || "",
            Ora: `${b.hour}:00-${b.hour+1}:00`,
            Campo: f ? f.name : (b.fieldId || ""),
            Nome: b.name || "",
            Telefono: b.phone || "",
            Nota: b.adminNote || "",
          };
        });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Prenotazioni");
      const stamp = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, `prenotazioni-veritas-${stamp}.xlsx`);
      notify("Excel scaricato ✓");
    } catch (e) {
      notify("Impossibile generare Excel", false);
    }
  };

  /* ── login ── */
  const login = () => {
    const trimmed = pwd.trim();
    if (!trimmed) return;
    setPwdLoading(true);
    setTimeout(async()=>{
      const admin = ADMINS.find(a => a.password === trimmed);
      if (admin) {
        try {
          await signInWithEmailAndPassword(auth, admin.email, trimmed);
          setSession({ role:"admin", name:admin.name });
          setPwd(""); setPwdErr("");
        } catch (e) {
          setPwdErr("Login admin non valido (Firebase Auth)");
        }
      } else if (trimmed === PASSWORD_SOCI) {
        setSession({ role:"soci" });
        setPwd(""); setPwdErr("");
      } else {
        setPwdErr("Password non riconosciuta");
      }
      setPwdLoading(false);
    }, 300);
  };

  const logout = async () => {
    try { await signOut(auth); } catch (_) {}
    setSession(null); setPwd(""); setPwdErr("");
    setView("calendar"); setBookSheet(null); setEditSheet(null);
  };

  const isAdmin = session?.role === "admin";
  const authed  = session !== null;

  // Mantiene la sessione admin se la pagina si ricarica
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user && session?.role === "admin") setSession(null);
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── derived ── */
  const weekDates  = weekOf(weekBase);
  const todayStr   = fmtDate(new Date());
  const selStr     = fmtDate(selDate);
  const field      = FIELDS.find(f=>f.id===selField);
  const sorted     = [...bookings].sort((a,b)=>a.date.localeCompare(b.date)||a.hour-b.hour);
  const getSlot    = (ds,h,fid) => bookings.find(b=>b.date===ds&&b.hour===h&&b.fieldId===fid);

  const selDateObj = parseD(selStr);
  const dayLabel   = `${DAY_FULL[selDateObj.getDay()]}, ${selDateObj.getDate()} ${MONTH_NAMES[selDateObj.getMonth()]}`;
  const isPastDay  = selDateObj < new Date() && selStr !== todayStr;

  /* ── handlers ── */
  const tapSlot = (hour,fid) => {
    if (!isAdmin) return;
    const slot = getSlot(selStr,hour,fid);
    if (slot) { setOccupied({fid}); setTimeout(()=>setOccupied(null),2400); return; }
    setBookSheet({date:selStr,hour,fieldId:fid});
    setBookName(""); setBookPhone("");
  };

  const confirmBook = async () => {
    if (!bookName.trim()) { notify("Inserisci il nome",false); return; }

    // Evita doppie prenotazioni: stesso giorno + stessa ora + stesso campo
    const conflict = bookings.some(b =>
      b.date === bookSheet.date &&
      b.hour === bookSheet.hour &&
      b.fieldId === bookSheet.fieldId
    );
    if (conflict) { notify("Slot già occupato per questo campo", false); setBookSheet(null); return; }

    try {
      await addDoc(collection(db, "bookings"), {
        date: bookSheet.date,
        hour: bookSheet.hour,
        fieldId: bookSheet.fieldId,
        name: bookName.trim(),
        phone: bookPhone.trim(),
        adminNote: "",
        createdAt: serverTimestamp(),
      });
      setBookSheet(null);
      notify("Prenotazione confermata ✓");
    } catch (e) {
      notify("Errore salvataggio", false);
    }
  };

  const deleteBook = async (id) => {
    try {
      await deleteDoc(doc(db, "bookings", id));
      setEditSheet(null);
      notify("Prenotazione eliminata");
    } catch (_) {
      notify("Errore eliminazione", false);
    }
  };

  const saveNote = async () => {
    try {
      await updateDoc(doc(db, "bookings", editSheet.id), { adminNote: editNote });
      setEditSheet(p=>({...p,adminNote:editNote}));
      notify("Nota salvata ✓");
    } catch (_) {
      notify("Errore salvataggio nota", false);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCHERMATA DI LOGIN — visibile a tutti finché non si è autenticati
  ════════════════════════════════════════════════════════════════════════ */
  if (!authed) {
    return (
      <div style={{
        minHeight:"100dvh",
        background:"linear-gradient(160deg,#f0fdf4 0%,#e8f5e9 40%,#f1f5f9 100%)",
        fontFamily:T.font, color:"#111827",
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        maxWidth:480, margin:"0 auto", padding:"32px 24px",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet"/>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{
            width:88,height:88,borderRadius:24,
            background:"linear-gradient(135deg,#16a34a,#15803d)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:44,margin:"0 auto 18px",
            boxShadow:"0 8px 28px #16a34a44",
          }}>⚽</div>
          <div style={{fontFamily:T.display,fontWeight:800,fontSize:28,color:"#111827",lineHeight:1}}>
            Centro Sportivo
          </div>
          <div style={{fontFamily:T.display,fontWeight:700,fontSize:20,color:"#16a34a",letterSpacing:3,textTransform:"uppercase",marginTop:4}}>
            Veritas
          </div>
        </div>

        {/* Card login */}
        <div style={{
          width:"100%",background:"#fff",borderRadius:T.r.xl,
          padding:28,boxShadow:T.s.md,border:"1px solid #e5e7eb",
        }}>
          <p style={{
            fontSize:14,color:"#6b7280",textAlign:"center",
            margin:"0 0 20px",lineHeight:1.5,
          }}>
            Inserisci la password per accedere al calendario
          </p>

          <FocusInput
            type="password"
            placeholder="••••••••••"
            value={pwd}
            onChange={e=>{setPwd(e.target.value);setPwdErr("");}}
            onKeyDown={e=>e.key==="Enter"&&login()}
            style={{textAlign:"center",fontSize:22,letterSpacing:8,marginBottom:pwdErr?10:16}}
            accentColor="#16a34a"
          />

          {pwdErr && (
            <div style={{
              background:"#fef2f2",border:"1px solid #fecaca",borderRadius:T.r.md,
              padding:"10px 14px",color:"#dc2626",fontSize:14,fontWeight:700,
              textAlign:"center",marginBottom:14,
            }}>
              {pwdErr}
            </div>
          )}

          <button
            onClick={login}
            disabled={pwdLoading || !pwd.trim()}
            style={{
              width:"100%",padding:"16px",borderRadius:T.r.md,border:"none",
              background: pwd.trim() ? "#16a34a" : "#f3f4f6",
              color: pwd.trim() ? "#fff" : "#9ca3af",
              fontFamily:T.font,fontWeight:800,fontSize:16,
              cursor: pwd.trim() ? "pointer" : "not-allowed",
              boxShadow: pwd.trim() ? "0 4px 14px #16a34a44" : "none",
              transition:"all .2s",
            }}>
            {pwdLoading ? "..." : "Accedi"}
          </button>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     APP PRINCIPALE — visibile solo dopo login
  ════════════════════════════════════════════════════════════════════════ */
  return (
    <div style={{
      minHeight:"100dvh", background:"#f1f5f9",
      fontFamily:T.font, color:"#111827",
      display:"flex", flexDirection:"column",
      maxWidth:480, margin:"0 auto", position:"relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet"/>

      {/* ── HEADER ── */}
      <header style={{
        background:"#fff", borderBottom:"1px solid #e5e7eb",
        boxShadow:T.s.xs, padding:"0 16px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        height:56, position:"sticky", top:0, zIndex:200, flexShrink:0,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{
            width:36,height:36,borderRadius:10,flexShrink:0,
            background:"linear-gradient(135deg,#16a34a,#15803d)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:18,boxShadow:"0 2px 8px #16a34a44",
          }}>⚽</div>
          <div style={{lineHeight:1}}>
            <div style={{fontFamily:T.display,fontWeight:800,fontSize:14,color:"#111827"}}>Centro Sportivo</div>
            <div style={{fontFamily:T.display,fontWeight:700,fontSize:11,color:"#16a34a",letterSpacing:2,textTransform:"uppercase"}}>Veritas</div>
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {isAdmin && (
            <div style={{
              background:"#eff6ff",color:"#1e3a5f",
              borderRadius:T.r.pill,padding:"4px 10px",
              fontSize:11,fontWeight:800,letterSpacing:.3,
            }}>🔐 Admin</div>
          )}
          <button onClick={logout} style={{
            padding:"6px 12px",borderRadius:T.r.sm,border:"1px solid #e5e7eb",
            background:"#f9fafb",color:"#6b7280",cursor:"pointer",
            fontSize:12,fontWeight:700,
          }}>Esci</button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{flex:1,overflowY:"auto",paddingBottom: isAdmin ? 84 : 16}}>

        {/* ══ CALENDARIO ══ */}
        {view==="calendar" && <>

          {/* Striscia settimana */}
          <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",position:"sticky",top:56,zIndex:150}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px 6px"}}>
              <button onClick={()=>{const d=new Date(weekBase);d.setDate(d.getDate()-7);setWeekBase(d);setSelDate(weekOf(d)[0]);}}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#6b7280",padding:4,lineHeight:1}}>‹</button>
              <span style={{fontFamily:T.display,fontWeight:800,fontSize:15,color:"#111827"}}>
                {MONTH_NAMES[weekDates[0].getMonth()]} {weekDates[0].getFullYear()}
              </span>
              <button onClick={()=>{const d=new Date(weekBase);d.setDate(d.getDate()+7);setWeekBase(d);setSelDate(weekOf(d)[0]);}}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#6b7280",padding:4,lineHeight:1}}>›</button>
            </div>
            <div style={{display:"flex",padding:"0 8px 10px",gap:4}}>
              {weekDates.map((d,i)=>{
                const ds=fmtDate(d), isSel=ds===selStr, isToday=ds===todayStr;
                const hasBk=FIELDS.some(f=>HOURS.some(h=>getSlot(ds,h,f.id)));
                return (
                  <button key={i} onClick={()=>setSelDate(d)} style={{
                    flex:1,padding:"6px 2px",borderRadius:T.r.md,border:"none",cursor:"pointer",
                    background:isSel?"#16a34a":isToday?"#dcfce7":"transparent",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all .15s",
                    WebkitTapHighlightColor:"transparent",
                  }}>
                    <span style={{fontSize:9,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",
                      color:isSel?"#fff":isToday?"#16a34a":"#9ca3af"}}>{DAY_SHORT[d.getDay()]}</span>
                    <span style={{fontSize:17,fontWeight:800,fontFamily:T.display,
                      color:isSel?"#fff":isToday?"#16a34a":"#374151"}}>{d.getDate()}</span>
                    <div style={{width:5,height:5,borderRadius:"50%",
                      background:hasBk?(isSel?"rgba(255,255,255,.7)":"#16a34a"):"transparent"}}/>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab campi */}
          <div style={{padding:"12px 16px 0",display:"flex",gap:8,overflowX:"auto",scrollbarWidth:"none"}}>
            {FIELDS.map(f=>(
              <button key={f.id} onClick={()=>setSelField(f.id)} style={{
                flexShrink:0,padding:"7px 14px",borderRadius:T.r.pill,
                border:`2px solid ${selField===f.id?f.color:"#e5e7eb"}`,
                background:selField===f.id?f.color:"#fff",
                color:selField===f.id?"#fff":"#6b7280",
                cursor:"pointer",fontFamily:T.font,fontWeight:700,fontSize:13,
                transition:"all .15s",
                boxShadow:selField===f.id?`0 2px 8px ${f.color}44`:"none",
                WebkitTapHighlightColor:"transparent",
              }}>{f.icon} {f.name}</button>
            ))}
          </div>

          {/* Etichetta giorno */}
          <div style={{padding:"14px 16px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontFamily:T.display,fontWeight:800,fontSize:17,color:"#111827"}}>{dayLabel}</div>
            {isPastDay && <span style={{fontSize:12,color:"#9ca3af",fontWeight:600}}>Passato</span>}
            {isAdmin && !isPastDay && <span style={{fontSize:12,color:"#15803d",fontWeight:700}}>Tocca uno slot per prenotare</span>}
          </div>

          {/* Campo selezionato (solo informativo) */}
          <div style={{padding:"0 16px 10px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:"6px 10px",borderRadius:T.r.pill,
              background:field.light,border:`1px solid ${field.color}33`,
              color:field.color,fontWeight:800,fontSize:12,
            }}>
              <span style={{fontSize:14,lineHeight:1}}>{field.icon}</span>
              <span>Stai vedendo: {field.name}</span>
            </div>
            <span style={{fontSize:11,color:"#9ca3af",fontWeight:700}}>Le altre prenotazioni sono nei rispettivi campi</span>
          </div>

          {/* Slot orari */}
          <div style={{padding:"0 16px 16px",display:"flex",flexDirection:"column",gap:10}}>
            {HOURS.map(hour=>{
              const now=new Date();
              const isPastHour=isPastDay||(selStr===todayStr&&hour<now.getHours());
              const slot=getSlot(selStr,hour,selField);

              return (
                <div key={hour}
                  style={{
                    background:"#fff",
                    borderRadius:T.r.lg,
                    border:`2px solid ${isPastHour?"#f3f4f6":"#e5e7eb"}`,
                    padding:"14px 16px",
                    display:"flex",alignItems:"flex-start",gap:14,
                    opacity:isPastHour?0.5:1,
                    boxShadow:T.s.xs,
                    WebkitTapHighlightColor:"transparent",
                    userSelect:"none",
                  }}>

                  {/* Badge ora */}
                  <div style={{
                    width:52,height:52,borderRadius:T.r.md,flexShrink:0,
                    background:isPastHour?"#f9fafb":"#f3f4f6",
                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                  }}>
                    <span style={{fontSize:16,fontWeight:900,lineHeight:1,
                      color:isPastHour?"#d1d5db":"#374151"}}>{hour}</span>
                    <span style={{fontSize:10,fontWeight:700,
                      color:isPastHour?"#d1d5db":"#9ca3af"}}>:00</span>
                  </div>

                  {/* Prenotazioni per tutti i campi (stessa ora) */}
                  <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:8}}>
                    {FIELDS.map(f=>{
                      const s = getSlot(selStr, hour, f.id);
                      const booked = !!s;

                      return (
                        <div key={f.id} style={{
                          display:"flex",alignItems:"center",gap:10,
                          padding:"10px 12px",
                          borderRadius:T.r.md,
                          background: booked ? f.light : "#f9fafb",
                          border: `1px solid ${booked ? f.color+"55" : "#e5e7eb"}`,
                        }}>
                          <div style={{
                            width:34,height:34,borderRadius:10,flexShrink:0,
                            background: booked ? f.color : "#fff",
                            border: booked ? "none" : "1px solid #e5e7eb",
                            display:"flex",alignItems:"center",justifyContent:"center",
                            boxShadow: booked ? `0 2px 10px ${f.color}22` : "none",
                            fontSize:16,
                          }}>{f.icon}</div>

                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:12,fontWeight:900,color:f.color,letterSpacing:.4}}>
                                {f.short}
                              </span>
                              <span style={{
                                fontWeight:800,
                                fontSize:14,
                                color: booked ? "#111827" : "#6b7280",
                                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                              }}>
                                {booked ? s.name : (isAdmin ? "Disponibile" : "Libero")}
                              </span>
                            </div>
                            {booked && s.phone && (
                              <div style={{fontSize:12,color:"#6b7280",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                📞 {s.phone}
                              </div>
                            )}
                            {booked && s.adminNote && (
                              <div style={{fontSize:12,color:"#7c3aed",fontWeight:700,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                📌 {s.adminNote}
                              </div>
                            )}
                          </div>

                          {/* Azione (solo admin, solo futuro/presente) */}
                          {isAdmin && !isPastHour && (
                            booked ? (
                              <button
                                onClick={(e)=>{e.stopPropagation();setEditSheet({...s});setEditNote(s.adminNote||"");}}
                                style={{
                                  flexShrink:0,padding:"8px 10px",borderRadius:T.r.sm,border:"none",
                                  background:"rgba(255,255,255,.9)",color:f.color,
                                  cursor:"pointer",fontSize:12,fontWeight:900,boxShadow:T.s.xs,
                                }}>
                                Gestisci
                              </button>
                            ) : (
                              <button
                                onClick={(e)=>{e.stopPropagation(); tapSlot(hour, f.id);}}
                                style={{
                                  flexShrink:0,padding:"8px 10px",borderRadius:T.r.sm,border:"none",
                                  background:f.color,color:"#fff",
                                  cursor:"pointer",fontSize:12,fontWeight:900,boxShadow:`0 4px 14px ${f.color}33`,
                                }}>
                                Prenota +
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );})}
          </div>
        </>}

        {/* ══ GESTIONE ADMIN ══ */}
        {view==="admin" && isAdmin && (
          <div style={{padding:"16px"}}>
            <div style={{
              background:"linear-gradient(135deg,#eff6ff,#dbeafe)",
              borderRadius:T.r.lg,padding:"14px 16px",marginBottom:16,
              border:"1px solid #bfdbfe",display:"flex",alignItems:"center",gap:12,
            }}>
              <span style={{fontSize:24}}>🔐</span>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:"#111827"}}>Pannello Admin</div>
                <div style={{fontSize:12,color:"#6b7280",marginTop:1}}>Visualizza, aggiungi note, elimina prenotazioni</div>
              </div>
            </div>

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div>
                <h2 style={{fontFamily:T.display,fontWeight:800,fontSize:20,color:"#111827",margin:"0 0 2px"}}>Prenotazioni</h2>
                <p style={{color:"#6b7280",margin:0,fontSize:13}}>{sorted.length} totali</p>
              </div>
              <button onClick={exportExcel} style={{
                padding:"8px 14px",borderRadius:T.r.md,border:"1px solid #e5e7eb",
                background:"#fff",color:"#374151",cursor:"pointer",fontFamily:T.font,fontWeight:700,fontSize:13,
              }}>⬇️ Excel</button>
<button onClick={()=>setView("calendar")} style={{
                padding:"8px 14px",borderRadius:T.r.md,border:"1px solid #e5e7eb",
                background:"#fff",color:"#374151",cursor:"pointer",fontFamily:T.font,fontWeight:700,fontSize:13,
              }}>📅 Calendario</button>
            </div>

            {sorted.length===0 ? (
              <div style={{background:"#fff",borderRadius:T.r.lg,padding:"48px 24px",
                textAlign:"center",color:"#9ca3af",border:"1px solid #e5e7eb"}}>
                <div style={{fontSize:36,marginBottom:10}}>📋</div>
                <div style={{fontWeight:700,fontSize:15}}>Nessuna prenotazione</div>
              </div>
            ):(()=>{
              const grouped={};
              sorted.forEach(b=>{ if(!grouped[b.date])grouped[b.date]=[]; grouped[b.date].push(b); });
              return Object.entries(grouped).map(([date,bks])=>{
                const d=parseD(date), isToday=date===todayStr;
                return (
                  <div key={date} style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:800,letterSpacing:1,textTransform:"uppercase",
                      padding:"8px 4px 4px",color:isToday?"#16a34a":"#6b7280"}}>
                      {isToday?"Oggi · ":""}{DAY_FULL[d.getDay()]} {d.getDate()} {MONTH_SHORT[d.getMonth()]}
                    </div>
                    {bks.map(b=>{
                      const f=FIELDS.find(f=>f.id===b.fieldId);
                      return (
                        <div key={b.id} style={{
                          background:"#fff",borderRadius:T.r.lg,border:"1px solid #e5e7eb",
                          padding:"14px 16px",display:"flex",alignItems:"center",gap:12,
                          boxShadow:T.s.xs,marginBottom:8,
                        }}>
                          <div style={{width:46,height:46,borderRadius:T.r.md,flexShrink:0,
                            background:f.light,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                            <div style={{fontSize:16}}>{f.icon}</div>
                            <div style={{fontSize:9,fontWeight:900,color:f.color}}>{f.short}</div>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:800,fontSize:15,color:"#111827"}}>{b.name}</div>
                            <div style={{fontSize:13,color:"#6b7280",marginTop:1}}>
                              {b.hour}:00–{b.hour+1}:00 · {f.name}
                            </div>
                            {b.phone&&<div style={{fontSize:13,color:"#6b7280"}}>📞 {b.phone}</div>}
                            {b.adminNote&&<div style={{fontSize:12,color:"#7c3aed",fontWeight:700,marginTop:2}}>📌 {b.adminNote}</div>}
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
                            <button onClick={()=>{setEditSheet({...b});setEditNote(b.adminNote||"");}} style={{
                              padding:"8px 12px",borderRadius:T.r.sm,border:"1px solid #e5e7eb",
                              background:"#f9fafb",color:"#374151",cursor:"pointer",fontSize:13,fontWeight:700,
                            }}>✏️</button>
                            <button onClick={()=>deleteBook(b.id)} style={{
                              padding:"8px 12px",borderRadius:T.r.sm,border:"1px solid #fecaca",
                              background:"#fef2f2",color:"#dc2626",cursor:"pointer",fontSize:13,fontWeight:700,
                            }}>🗑️</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* ── BOTTOM NAV (solo admin) ── */}
      {isAdmin && (
        <nav style={{
          position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
          width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #e5e7eb",
          display:"flex",zIndex:200,paddingBottom:"env(safe-area-inset-bottom)",
          boxShadow:"0 -2px 12px rgba(0,0,0,.06)",
        }}>
          {[
            {key:"calendar",label:"Calendario",icon:"📅",accent:"#16a34a"},
            {key:"admin",   label:"Gestione",  icon:"⚙️",accent:"#1e3a5f"},
          ].map(({key,label,icon,accent})=>(
            <button key={key} onClick={()=>setView(key)} style={{
              flex:1,padding:"10px 4px 12px",border:"none",background:"transparent",
              cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              WebkitTapHighlightColor:"transparent",
            }}>
              <span style={{fontSize:22,lineHeight:1}}>{icon}</span>
              <span style={{fontSize:10,fontWeight:view===key?800:600,
                color:view===key?accent:"#9ca3af",letterSpacing:.3,transition:"color .15s"}}>{label}</span>
              {view===key&&<div style={{width:18,height:3,borderRadius:2,background:accent}}/>}
            </button>
          ))}
        </nav>
      )}

      {/* ── SHEET PRENOTAZIONE ── */}
      {bookSheet && isAdmin && (()=>{
        const f=FIELDS.find(f=>f.id===bookSheet.fieldId);
        return (
          <Sheet onClose={()=>setBookSheet(null)}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
              <div style={{width:48,height:48,borderRadius:T.r.md,background:f.light,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>{f.icon}</div>
              <div>
                <div style={{fontFamily:T.display,fontWeight:800,fontSize:18,color:"#111827"}}>Prenota {f.name}</div>
                <div style={{fontSize:13,color:"#6b7280"}}>{bookSheet.date} · {bookSheet.hour}:00 – {bookSheet.hour+1}:00</div>
              </div>
            </div>
                        <Lbl>Campo *</Lbl>
            <select
              value={bookSheet.fieldId}
              onChange={(e)=>setBookSheet(p=>({ ...p, fieldId: e.target.value }))}
              style={{
                width:"100%",padding:"14px 16px",borderRadius:12,
                border:"2px solid #e5e7eb",background:"#fff",
                fontSize:16,fontFamily:T.font,marginBottom:14,
              }}
            >
              {FIELDS.map(ff=>(
                <option key={ff.id} value={ff.id}>{ff.name}</option>
              ))}
            </select>

<Lbl>Nome e Cognome *</Lbl>
            <FocusInput type="text" placeholder="Mario Rossi" value={bookName}
              onChange={e=>setBookName(e.target.value)} accentColor={f.color} style={{marginBottom:14}}/>
            <Lbl>Recapito <span style={{fontWeight:600,color:"#9ca3af"}}>(opzionale)</span></Lbl>
            <FocusInput type="tel" placeholder="+39 333 0000000" value={bookPhone}
              onChange={e=>setBookPhone(e.target.value)} accentColor={f.color} style={{marginBottom:20}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setBookSheet(null)} style={{
                flex:1,padding:"15px",borderRadius:T.r.md,border:"1px solid #e5e7eb",
                background:"#f3f4f6",color:"#6b7280",fontFamily:T.font,fontWeight:700,fontSize:15,cursor:"pointer",
              }}>Annulla</button>
              <button onClick={confirmBook} style={{
                flex:2,padding:"15px",borderRadius:T.r.md,border:"none",
                background:f.color,color:"#fff",fontFamily:T.font,fontWeight:800,fontSize:15,cursor:"pointer",
                boxShadow:`0 4px 14px ${f.color}44`,
              }}>Conferma ✓</button>
            </div>
          </Sheet>
        );
      })()}

      {/* ── SHEET GESTIONE ── */}
      {editSheet && isAdmin && (()=>{
        const f=FIELDS.find(f=>f.id===editSheet.fieldId);
        return (
          <Sheet onClose={()=>setEditSheet(null)}>
            <div style={{fontFamily:T.display,fontWeight:800,fontSize:20,marginBottom:6,color:"#111827"}}>
              Gestisci Prenotazione
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
              <span style={{background:f.light,color:f.color,borderRadius:T.r.sm,padding:"3px 10px",fontSize:12,fontWeight:800}}>{f.name}</span>
              <span style={{color:"#6b7280",fontSize:13}}>{editSheet.date} · {editSheet.hour}:00</span>
            </div>
            <div style={{background:"#f9fafb",borderRadius:T.r.md,padding:"14px 16px",marginBottom:16,border:"1px solid #e5e7eb"}}>
              <div style={{fontWeight:800,fontSize:16,color:"#111827"}}>{editSheet.name}</div>
              {editSheet.phone&&<div style={{fontSize:14,color:"#6b7280",marginTop:2}}>📞 {editSheet.phone}</div>}
            </div>
            <Lbl>Nota admin <span style={{fontWeight:600,color:"#9ca3af"}}>(visibile nel calendario)</span></Lbl>
            <textarea rows={3} value={editNote} onChange={e=>setEditNote(e.target.value)}
              placeholder="Es: Pagamento ricevuto · campo riservato..."
              style={{
                width:"100%",padding:"14px",borderRadius:T.r.md,border:"2px solid #e5e7eb",
                background:"#fff",color:"#111827",fontSize:15,fontFamily:T.font,
                resize:"none",boxSizing:"border-box",lineHeight:1.5,outline:"none",marginBottom:14,
              }}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>deleteBook(editSheet.id)} style={{
                flex:1,padding:"14px",borderRadius:T.r.md,border:"1px solid #fecaca",
                background:"#fef2f2",color:"#dc2626",fontFamily:T.font,fontWeight:800,fontSize:14,cursor:"pointer",
              }}>🗑️ Elimina</button>
              <button onClick={saveNote} style={{
                flex:2,padding:"14px",borderRadius:T.r.md,border:"none",
                background:"#7c3aed",color:"#fff",fontFamily:T.font,fontWeight:800,fontSize:15,cursor:"pointer",
                boxShadow:"0 4px 14px #7c3aed33",
              }}>💾 Salva Nota</button>
            </div>
          </Sheet>
        );
      })()}

      {/* ── BANNER SLOT OCCUPATO ── */}
      {occupied && (
        <div style={{
          position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          background:"#1f2937",color:"#fff",padding:"20px 28px",borderRadius:T.r.lg,
          fontSize:15,fontWeight:800,zIndex:9999,textAlign:"center",
          boxShadow:T.s.lg,pointerEvents:"none",animation:"popIn .2s ease",
          maxWidth:"80vw",lineHeight:1.6,
        }}>
          <div style={{fontSize:32,marginBottom:8}}>
            {occupied.fid==="clubhouse"?"🏠":"⚽"}
          </div>
          {occupied.fid==="clubhouse"
            ?"Esiste già un evento\nper la Club House"
            :"Campo e orario\ngià occupato"}
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position:"fixed",bottom:isAdmin?96:24,left:"50%",transform:"translateX(-50%)",
          background:toast.ok?"#16a34a":"#dc2626",color:"#fff",
          padding:"12px 24px",borderRadius:T.r.pill,fontWeight:800,fontSize:14,
          zIndex:9999,boxShadow:T.s.md,whiteSpace:"nowrap",animation:"slideUp .25s ease",
        }}>{toast.msg}</div>
      )}

      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes popIn   { from{opacity:0;transform:translate(-50%,-50%) scale(.88)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes sheetUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        *{box-sizing:border-box;-webkit-font-smoothing:antialiased}
        input,select,textarea{font-size:16px!important}
        ::-webkit-scrollbar{display:none}
        button{-webkit-tap-highlight-color:transparent}
      `}</style>
    </div>
  );
}

/* ─── COMPONENTI HELPER ───────────────────────────────────────────────── */

function Sheet({children,onClose}){
  return (
    <div style={{position:"fixed",inset:0,zIndex:500,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
      <div onClick={onClose} style={{flex:1,background:"rgba(17,24,39,.5)",backdropFilter:"blur(4px)"}}/>
      <div style={{
        background:"#fff",borderRadius:"24px 24px 0 0",
        padding:"0 16px 36px",maxHeight:"90dvh",overflowY:"auto",
        animation:"sheetUp .28s cubic-bezier(.32,.72,0,1)",
        maxWidth:480,width:"100%",margin:"0 auto",
        boxShadow:"0 -8px 40px rgba(0,0,0,.2)",
      }}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 16px"}}>
          <div style={{width:40,height:4,borderRadius:2,background:"#e5e7eb"}}/>
        </div>
        {children}
      </div>
    </div>
  );
}

function FocusInput({accentColor="#16a34a",style:extra={},...props}){
  const [focused,setFocused]=useState(false);
  return (
    <input {...props}
      onFocus={e=>{setFocused(true);props.onFocus&&props.onFocus(e);}}
      onBlur={e=>{setFocused(false);props.onBlur&&props.onBlur(e);}}
      style={{
        width:"100%",padding:"14px 16px",borderRadius:12,
        background:"#fff",border:`2px solid ${focused?accentColor:"#e5e7eb"}`,
        color:"#111827",fontSize:16,fontFamily:"'Nunito',sans-serif",
        outline:"none",boxSizing:"border-box",transition:"border-color .2s",
        WebkitAppearance:"none",...extra,
      }}
    />
  );
}

function Lbl({children}){
  return (
    <label style={{display:"block",fontSize:11,fontWeight:800,letterSpacing:1,
      textTransform:"uppercase",color:"#6b7280",marginBottom:6}}>
      {children}
    </label>
  );
}
