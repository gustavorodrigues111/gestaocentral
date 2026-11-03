// Painel do Salão — tela de parede (kiosk) do restaurante. Só visualização;
// ações (responder/abrir turno/preencher checklist) caem num "portão" pedindo
// login no dispositivo pessoal. A MÚSICA é controlável direto (via
// /api/spotify-control). As 4 colunas operacionais leem Firestore ao vivo,
// filtrando SEMPRE por restaurantId (o rid da URL). Rota: /r/:rid/painel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, MessageSquare, CheckSquare, Utensils, ChefHat, Lock, Users, Clock } from "lucide-react";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";

// ── Helpers ──
async function ctrl(rid: string, action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch("/api/spotify-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid, action, ...extra }) });
  return r.json().catch(() => ({ ok: false }));
}
const fmtTime = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function todayYmd(): string { const d = new Date(); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function hhmmToMin(s?: string): number { if (!s) return -1; const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function daysBetween(a: string, b: string): number { const da = new Date(a + "T12:00:00").getTime(); const dbt = new Date(b + "T12:00:00").getTime(); return Math.round((dbt - da) / 86400000); }
// Agrupa telefones: DDI 55 removido + 9º dígito normalizado (DDD + 8 últimos).
function foneKey(waId?: string): string { let d = String(waId || "").replace(/\D/g, ""); if (d.startsWith("55")) d = d.slice(2); if (d.length >= 10) d = d.slice(0, 2) + d.slice(-8); return d; }

const RESERVA_COR: Record<string, string> = { confirmada: "#1db954", pendente: "#e3a63c", chegou: "#4b9bf0" };
const TURNO_LABEL: Record<string, string> = { abertura: "Abertura", meio: "Meio", fechamento: "Fechamento" };

export function PainelSalaoPage() {
  const { rid = "" } = useParams();
  const { activeRestaurant } = useRestaurant();
  const [agora, setAgora] = useState(new Date());
  const [gate, setGate] = useState(false);

  // ── Música (ao vivo) ──
  const [player, setPlayer] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [vol, setVol] = useState(50);
  const [progress, setProgress] = useState(0);
  const volRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faixa = player?.item;
  const tocando = !!player?.is_playing;
  const devAtivo = useMemo(() => devices.find((d) => d.is_active) || null, [devices]);
  const alvo = () => (devAtivo?.id || devices[0]?.id || "");

  const carregarMusica = useCallback(async () => {
    const [st, dv] = await Promise.all([ctrl(rid, "state"), ctrl(rid, "devices")]);
    setPlayer(st?.player || null);
    setProgress(Number(st?.player?.progress_ms) || 0);
    const devs = Array.isArray(dv?.devices) ? dv.devices : [];
    setDevices(devs);
    const a = devs.find((d: any) => d.is_active);
    if (a && typeof a.volume_percent === "number") setVol(a.volume_percent);
  }, [rid]);

  useEffect(() => { void carregarMusica(); const t = setInterval(() => void carregarMusica(), 8000); return () => clearInterval(t); }, [carregarMusica]);
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!tocando) return; const dur = Number(faixa?.duration_ms) || 0; const t = setInterval(() => setProgress((p) => (dur && p + 1000 > dur ? dur : p + 1000)), 1000); return () => clearInterval(t); }, [tocando, faixa?.duration_ms]);

  async function mus(action: string, extra: Record<string, unknown> = {}) { await ctrl(rid, action, extra); setTimeout(() => void carregarMusica(), 400); }

  // ── Reservas (ao vivo) ── /reservas + /reservasPII (nome), filtro restaurantId + data de hoje
  const [reservasBase, setReservasBase] = useState<any[]>([]);
  const [reservasPii, setReservasPii] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!rid) return;
    const hoje = todayYmd();
    const qb = query(collection(db, "reservas"), where("restaurantId", "==", rid), where("data", "==", hoje));
    const qp = query(collection(db, "reservasPII"), where("restaurantId", "==", rid), where("data", "==", hoje));
    const u1 = onSnapshot(qb, (s) => setReservasBase(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
    const u2 = onSnapshot(qp, (s) => { const m: Record<string, any> = {}; s.docs.forEach((d) => { m[d.id] = d.data(); }); setReservasPii(m); }, () => {});
    return () => { u1(); u2(); };
  }, [rid]);
  const reservasView = useMemo(() => {
    const nowMin = agora.getHours() * 60 + agora.getMinutes();
    return reservasBase
      .filter((r) => r.status !== "cancelada" && r.status !== "no_show")
      .map((r) => { const min = hhmmToMin(r.horario); return { ...r, nome: reservasPii[r.id]?.clienteNomeSnapshot || r.clienteNomeSnapshot, _min: min, _delta: min - nowMin }; })
      .filter((r) => r._delta > -120) // somem 2h após o horário
      .sort((a, b) => a._min - b._min);
  }, [reservasBase, reservasPii, agora]);

  // ── Freelas & Turnos (ao vivo) ── freelaShifts, filtro restaurantId
  const [shifts, setShifts] = useState<any[]>([]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "freelaShifts"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setShifts(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);
  const freelasView = useMemo(() => {
    const hoje = todayYmd();
    const abertos = shifts.filter((s) => s.status === "aberto" && !s.saida).sort((a, b) => hhmmToMin(a.entrada) - hhmmToMin(b.entrada));
    const programados = shifts.filter((s) => s.status === "agendado" && s.date === hoje).sort((a, b) => hhmmToMin(a.entradaPrevista) - hhmmToMin(b.entradaPrevista));
    return { abertos, programados };
  }, [shifts, agora]);

  // ── Checklists (ao vivo) ── checklistTemplates + checklistRuns, filtro restaurantId
  const [tmpls, setTmpls] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "checklistTemplates"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setTmpls(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);
  useEffect(() => { if (!rid) return; const q = query(collection(db, "checklistRuns"), where("restaurantId", "==", rid)); return onSnapshot(q, (s) => setRuns(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, [rid]);
  const checklistsView = useMemo(() => {
    const hoje = todayYmd();
    const dow = new Date(hoje + "T12:00:00").getDay();
    const nowMin = agora.getHours() * 60 + agora.getMinutes();
    const runHoje = new Map<string, any>();
    const ultimoRun = new Map<string, string>();
    for (const r of runs) {
      if (r.data === hoje && !runHoje.has(r.templateId)) runHoje.set(r.templateId, r);
      const prev = ultimoRun.get(r.templateId);
      if (!prev || (r.data || "") > prev) ultimoRun.set(r.templateId, r.data || "");
    }
    return tmpls
      .filter((t) => {
        if (t.ativo === false) return false;
        const f = t.frequencia;
        if (f === "diaria") return !t.diasSemana || t.diasSemana.length === 0 || t.diasSemana.includes(dow);
        if (f === "semanal") { const lr = ultimoRun.get(t.id); return !lr || daysBetween(lr, hoje) >= 7; }
        if (f === "mensal") { const lr = ultimoRun.get(t.id); return !lr || lr.slice(0, 7) !== hoje.slice(0, 7); }
        return runHoje.has(t.id); // avulsa: só se já rodou hoje
      })
      .map((t) => {
        const run = runHoje.get(t.id);
        const pct = run ? Math.round(((run.feitos || 0) / Math.max(1, run.totalItens || 1)) * 100) : 0;
        const completo = run?.status === "completo";
        const refMin = hhmmToMin(t.horarioReferencia);
        const atrasado = !completo && refMin >= 0 && nowMin > refMin;
        return { id: t.id, nome: t.nome || "Checklist", turno: t.turno, area: t.area, hora: t.horarioReferencia, pct, completo, atrasado, iniciado: !!run };
      })
      .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
  }, [tmpls, runs, agora]);
  const chkStats = useMemo(() => ({ completos: checklistsView.filter((c) => c.completo).length, total: checklistsView.length, atrasados: checklistsView.filter((c) => c.atrasado).length }), [checklistsView]);

  // ── WhatsApp (ao vivo) ── derivado de whatsappMensagens; vínculo via whatsappNumeros.restaurantIds
  const [waNumeros, setWaNumeros] = useState<any[]>([]);
  const [waMsgs, setWaMsgs] = useState<any[]>([]);
  useEffect(() => { const q = collection(db, "whatsappNumeros"); return onSnapshot(q, (s) => setWaNumeros(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}); }, []);
  useEffect(() => {
    const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const q = query(collection(db, "whatsappMensagens"), where("timestamp", ">=", cutoff), orderBy("timestamp", "desc"), limit(1500));
    return onSnapshot(q, (s) => setWaMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
  }, []);
  const waView = useMemo(() => {
    const numIds = new Set(waNumeros.filter((n) => (n.restaurantIds || []).includes(rid) && n.ativo !== false).map((n) => n.id));
    const conv = new Map<string, any>();
    for (const m of waMsgs) {
      if (!m.numeroId || !numIds.has(m.numeroId) || m.ehGrupo) continue;
      const k = foneKey(m.waId);
      let c = conv.get(k);
      if (!c) { c = { waId: m.waId, nome: undefined, ultima: m, naoLidas: 0 }; conv.set(k, c); }
      if ((m.timestamp || "") > (c.ultima.timestamp || "")) c.ultima = m;
      if (m.nome && m.direcao === "in" && !c.nome) c.nome = m.nome;
      if (m.direcao === "in" && !m.lido) c.naoLidas++;
    }
    const list = [...conv.values()].filter((c) => c.naoLidas > 0).sort((a, b) => (b.ultima.timestamp || "").localeCompare(a.ultima.timestamp || ""));
    return { list, total: list.reduce((s, c) => s + c.naoLidas, 0) };
  }, [waNumeros, waMsgs, rid]);

  // ── UI helpers ──
  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const mes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const hora = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  function relReserva(r: any): { t: string; c: string } {
    if (r.status === "chegou") return { t: "chegou", c: "#4b9bf0" };
    const d = r._delta;
    if (d <= 0) return { t: "agora", c: "#e3a63c" };
    if (d < 60) return { t: `em ${d}min`, c: "#9aa3b2" };
    const h = Math.floor(d / 60), m = d % 60;
    return { t: `em ${h}h${m ? " " + m + "min" : ""}`, c: "#9aa3b2" };
  }

  const Kpi = ({ ic, cor, v, l }: { ic: React.ReactNode; cor: string; v: string; l: string }) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-[#2a2f39] bg-[#1b1e25] px-3 py-2">
      <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: cor + "22", color: cor }}>{ic}</div>
      <div><div className="font-extrabold text-lg leading-none tabular-nums">{v}</div><div className="text-[10px] uppercase tracking-wide text-[#9aa3b2] font-semibold mt-0.5">{l}</div></div>
    </div>
  );
  const ColHead = ({ ic, cor, title, tag }: { ic: React.ReactNode; cor: string; title: string; tag?: string }) => (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: cor + "22", color: cor }}>{ic}</div>
      <h2 className="font-extrabold text-[15px] flex-1">{title}</h2>
      {tag && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: cor + "22", color: cor }}>{tag}</span>}
    </div>
  );
  const Vazio = ({ txt }: { txt: string }) => <div className="flex-1 grid place-items-center text-center text-sm px-3" style={{ color: "#5c6373" }}>{txt}</div>;
  const col = "bg-[#15171c] border border-[#222730] rounded-2xl p-3.5 flex flex-col gap-3 min-w-0 overflow-hidden";
  const listCls = "flex-1 flex flex-col gap-2 overflow-auto -mr-1 pr-1";

  return (
    <div className="fixed inset-0 z-50 bg-[#121317] text-[#eef1f5] overflow-auto" style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="min-h-full flex flex-col gap-3 p-4">
        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl grid place-items-center font-extrabold text-[#1a1205]" style={{ background: "linear-gradient(135deg,#e3a63c,#b9792a)" }}>{(activeRestaurant?.nome || "R")[0]}</div>
            <div><div className="font-extrabold text-lg leading-none">{activeRestaurant?.nome || "Restaurante"} · Salão</div><div className="text-[11px] text-[#9aa3b2]">Painel operacional</div></div>
          </div>
          <div className="flex gap-2 flex-wrap ml-auto items-center">
            <Kpi ic={<MessageSquare size={15} />} cor="#25d366" v={String(waView.total)} l="a responder" />
            <Kpi ic={<CheckSquare size={15} />} cor="#e3a63c" v={`${chkStats.completos}/${chkStats.total}`} l="Checklists" />
            <Kpi ic={<Utensils size={15} />} cor="#e3a63c" v={String(reservasView.length)} l="Reservas" />
            <Kpi ic={<ChefHat size={15} />} cor="#4b9bf0" v={String(freelasView.abertos.length)} l="Turnos abertos" />
            <div className="text-right pl-1"><div className="font-extrabold text-2xl tabular-nums leading-none">{hora}</div><div className="text-[11px] text-[#9aa3b2] capitalize">{dias[agora.getDay()].slice(0, 3)}, {agora.getDate()} {mes[agora.getMonth()]}</div></div>
          </div>
        </div>

        {/* Colunas */}
        <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1.15fr 1fr 1fr 1fr 1fr" }}>
          {/* MÚSICA (ao vivo) */}
          <div className={col}>
            <ColHead ic={<Music size={15} />} cor="#1db954" title="Música Ambiente" tag={devAtivo ? "● No ar" : "parado"} />
            <div className="flex gap-3">
              <div className="w-28 h-28 shrink-0 rounded-xl overflow-hidden bg-[#20242c] grid place-items-center text-[#6f7889]">
                {faixa?.album?.images?.[0]?.url ? <img src={faixa.album.images[0].url} alt="" className="w-full h-full object-cover" /> : <Music size={34} />}
              </div>
              <div className="min-w-0 flex flex-col justify-center">
                <div className="font-extrabold text-[17px] leading-tight line-clamp-2">{faixa?.name || "Nada tocando"}</div>
                <div className="text-[13px] text-[#9aa3b2] truncate">{(faixa?.artists || []).map((a: any) => a.name).join(", ") || (devAtivo ? devAtivo.name : "—")}</div>
              </div>
            </div>
            <div>
              <div className="h-1.5 rounded bg-[#2b3038] overflow-hidden"><div className="h-full bg-[#1db954] rounded" style={{ width: `${faixa?.duration_ms ? Math.min(100, progress / faixa.duration_ms * 100) : 0}%` }} /></div>
              <div className="flex justify-between text-[10.5px] text-[#6f7889] tabular-nums mt-1"><span>{fmtTime(progress)}</span><span>{fmtTime(Number(faixa?.duration_ms) || 0)}</span></div>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button className="w-9 h-9 grid place-items-center rounded-full border border-[#2a2f39]" onClick={() => void mus("previous")}><SkipBack size={16} /></button>
              <button className="w-12 h-12 grid place-items-center rounded-full bg-[#1db954] text-[#04170c]" onClick={() => void mus(tocando ? "pause" : "play", tocando ? {} : { deviceId: alvo() })}>{tocando ? <Pause size={22} /> : <Play size={22} />}</button>
              <button className="w-9 h-9 grid place-items-center rounded-full border border-[#2a2f39]" onClick={() => void mus("next")}><SkipForward size={16} /></button>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-[#9aa3b2]" />
              <input type="range" min={0} max={100} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (volRef.current) clearTimeout(volRef.current); volRef.current = setTimeout(() => void ctrl(rid, "volume", { volume: v, deviceId: alvo() }), 250); }} className="flex-1 accent-[#1db954]" />
              <b className="text-xs text-[#9aa3b2] w-9 text-right tabular-nums">{vol}%</b>
            </div>
            {player?.context && <div className="text-[11px] text-[#1db954] truncate">▸ tocando de uma playlist</div>}
          </div>

          {/* RESERVAS */}
          <div className={col}>
            <ColHead ic={<Utensils size={15} />} cor="#e3a63c" title="Reservas do turno" tag={reservasView.length ? `${reservasView.length}` : undefined} />
            {reservasView.length === 0 ? <Vazio txt="Sem reservas pro restante do turno" /> : (
              <div className={listCls}>
                {reservasView.map((r) => {
                  const rel = relReserva(r);
                  const mesas = (r.mesasNomesSnapshot || []).join(" + ") || r.mesaNomeSnapshot || "";
                  return (
                    <div key={r.id} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: RESERVA_COR[r.status] || "#9aa3b2" }} />
                        <span className="font-extrabold tabular-nums text-[15px]">{r.horario || "--:--"}</span>
                        <span className="text-[11px] font-bold" style={{ color: rel.c }}>{rel.t}</span>
                        <span className="ml-auto flex items-center gap-1 text-[12px] text-[#9aa3b2]"><Users size={12} />{r.pessoas || "?"}</span>
                      </div>
                      <div className="text-[13px] font-semibold truncate mt-0.5">{r.nome || "Reserva"}</div>
                      {mesas && <div className="text-[11px] text-[#6f7889] truncate">{mesas}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* FREELAS & TURNOS */}
          <div className={col}>
            <ColHead ic={<ChefHat size={15} />} cor="#4b9bf0" title="Freelas & Turnos" tag={freelasView.abertos.length ? `${freelasView.abertos.length} aberto(s)` : undefined} />
            {freelasView.abertos.length === 0 && freelasView.programados.length === 0 ? <Vazio txt="Nenhum freela programado hoje" /> : (
              <div className={listCls}>
                {freelasView.abertos.map((s) => (
                  <div key={s.id} className="rounded-xl border px-3 py-2" style={{ borderColor: "#1e4a2e", background: "#13241a" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: "#1db95422", color: "#1db954" }}>EM TURNO</span>
                      <span className="ml-auto text-[12px] tabular-nums text-[#9aa3b2]">desde {s.entrada || "--:--"}</span>
                    </div>
                    <div className="text-[13px] font-semibold truncate mt-0.5">{s.nomeSnapshot || "Freela"}</div>
                    {s.area && <div className="text-[11px] text-[#6f7889] truncate">{s.area}</div>}
                  </div>
                ))}
                {freelasView.programados.map((s) => (
                  <div key={s.id} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-[#6f7889]" />
                      <span className="font-extrabold tabular-nums text-[14px]">{s.entradaPrevista || "--:--"}{s.saidaPrevista ? `–${s.saidaPrevista}` : ""}</span>
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#4b9bf022", color: "#4b9bf0" }}>programado</span>
                    </div>
                    <div className="text-[13px] font-semibold truncate mt-0.5">{s.nomeSnapshot || "Freela"}</div>
                    {s.area && <div className="text-[11px] text-[#6f7889] truncate">{s.area}</div>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setGate(true)} className="rounded-xl border border-[#2a2f39] bg-[#1b1e25] py-2.5 text-[13px] font-bold shrink-0">Abrir turno</button>
          </div>

          {/* CHECKLISTS */}
          <div className={col}>
            <ColHead ic={<CheckSquare size={15} />} cor="#e3a63c" title="Checklists" tag={chkStats.total ? `${chkStats.completos}/${chkStats.total}` : undefined} />
            {checklistsView.length === 0 ? <Vazio txt="Sem checklists pra hoje" /> : (
              <div className={listCls}>
                {checklistsView.map((c) => (
                  <div key={c.id} className={`rounded-xl border px-3 py-2 ${c.atrasado ? "animate-pulse" : ""}`} style={{ borderColor: c.completo ? "#1e4a2e" : c.atrasado ? "#5a2320" : "#242a33", background: c.completo ? "#13241a" : c.atrasado ? "#241414" : "#1b1e25" }}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] truncate flex-1">{c.nome}</span>
                      <span className="font-extrabold tabular-nums text-[13px]" style={{ color: c.completo ? "#1db954" : c.atrasado ? "#f06b60" : "#e3a63c" }}>{c.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded bg-[#2b3038] overflow-hidden mt-1.5"><div className="h-full rounded" style={{ width: `${c.pct}%`, background: c.completo ? "#1db954" : c.atrasado ? "#f06b60" : "#e3a63c" }} /></div>
                    <div className="flex items-center gap-2 mt-1 text-[10.5px] text-[#6f7889]">
                      {c.turno && <span className="font-semibold" style={{ color: "#9aa3b2" }}>{TURNO_LABEL[c.turno] || c.turno}</span>}
                      {c.hora && <span className="flex items-center gap-0.5"><Clock size={10} />{c.hora}</span>}
                      {c.atrasado && <span className="ml-auto font-extrabold" style={{ color: "#f06b60" }}>atrasado</span>}
                      {c.completo && <span className="ml-auto font-extrabold" style={{ color: "#1db954" }}>✓ ok</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WHATSAPP */}
          <div className={col}>
            <ColHead ic={<MessageSquare size={15} />} cor="#25d366" title="WhatsApp" tag={waView.total ? `${waView.total}` : undefined} />
            {waView.list.length === 0 ? <Vazio txt="Tudo respondido 🎉" /> : (
              <div className={listCls}>
                {waView.list.map((c) => (
                  <div key={foneKey(c.waId)} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] truncate flex-1">{c.nome || foneKey(c.waId)}</span>
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "#25d36622", color: "#25d366" }}>{c.naoLidas}</span>
                    </div>
                    <div className="text-[11.5px] text-[#9aa3b2] truncate mt-0.5">{c.ultima?.texto || (c.ultima?.tipo ? `[${c.ultima.tipo}]` : "…")}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setGate(true)} className="rounded-xl border border-[#2a2f39] bg-[#1b1e25] py-2.5 text-[13px] font-bold shrink-0">Abrir inbox</button>
          </div>
        </div>
      </div>

      {/* Portão: ações pedem login pessoal */}
      {gate && (
        <div className="fixed inset-0 z-[60] bg-black/75 grid place-items-center p-6" onClick={() => setGate(false)}>
          <div className="bg-[#1b1e25] border border-[#2a2f39] rounded-2xl max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: "#3a2e17", color: "#e3a63c" }}><Lock size={26} /></div>
            <div className="font-extrabold text-lg mb-1">Ação protegida</div>
            <p className="text-sm text-[#9aa3b2] mb-4">Este painel é só de visualização. Pra responder ou lançar, entre com o <b>seu login</b> no planejamento.app pelo celular ou navegador.</p>
            <div className="text-[13px] font-bold">admin.planejamento.app</div>
            <button className="mt-4 w-full rounded-xl py-3 font-extrabold text-[#1a1205]" style={{ background: "#e3a63c" }} onClick={() => setGate(false)}>Entendi</button>
          </div>
        </div>
      )}
    </div>
  );
}
