// ════════════════════════════════════════════════════════════════════════════
//  Planner — planejamento pessoal do Gustavo (single-user).
//
//  ⚠️ MÓDULO PESSOAL: só monta pro master (gate). Rota de topo /planner.
//
//  Conexão Google = direto do navegador (Google Identity Services) → Calendar
//  API. As views Semana/Mês mostram os EVENTOS REAIS. Preferências de agenda
//  (cor + mostrar/ocultar) ficam em Firestore (plannerSettings/{uid}) pra
//  sincronizar entre dispositivos.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { TimeInput } from "../../core/ui/TimeInput";

const GOOGLE_CLIENT_ID = "777358299957-ojakrj15eaefgr8s6vmsrnj9p5nm8aca.apps.googleusercontent.com";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const TOKEN_KEY = "plannerGoogleToken";

type TipoVista = "calendario" | "kanban" | "crono";
type Periodo = "semana" | "mes" | "tri" | "ano";
const VISTAS: TipoVista[] = ["calendario", "kanban", "crono"];
const PERIODOS: Periodo[] = ["semana", "mes", "tri", "ano"];
const VISTA_LABEL: Record<TipoVista, string> = { calendario: "🗓 Calendário", kanban: "🗂 Kanban", crono: "📈 Cronograma" };
const PERIODO_LABEL: Record<Periodo, string> = { semana: "📆 Semana", mes: "🗓 Mês", tri: "📊 Trimestre", ano: "📅 Ano" };

// ─── Google Identity Services (token no browser) ────────────────────────────
type GsiTokenResponse = { access_token?: string; expires_in?: number; error?: string };
type GsiTokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
type GCal = { id: string; summary: string; primary?: boolean; backgroundColor?: string; accessRole?: string };

// Agenda "efetiva" = agenda do Google + preferências do usuário aplicadas.
type Agenda = { id: string; summary: string; cor: string; oculta: boolean; gravavel: boolean };

function gsiOauth() {
  return (window as unknown as {
    google?: { accounts?: { oauth2?: {
      initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: GsiTokenResponse) => void }) => GsiTokenClient;
    } } };
  }).google?.accounts?.oauth2;
}
function useGsiReady() {
  const [ready, setReady] = useState(!!gsiOauth());
  useEffect(() => {
    if (gsiOauth()) { setReady(true); return; }
    let s = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const onLoad = () => setReady(!!gsiOauth());
    if (!s) {
      s = document.createElement("script");
      s.src = GSI_SRC; s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", onLoad);
    return () => s?.removeEventListener("load", onLoad);
  }, []);
  return ready;
}
function salvarToken(access: string, expiresInSec: number) {
  const expiresAt = Date.now() + Math.max(0, expiresInSec - 60) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ access, expiresAt }));
}
function tokenValidoSalvo(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { access, expiresAt } = JSON.parse(raw) as { access?: string; expiresAt?: number };
    return access && expiresAt && expiresAt > Date.now() ? access : null;
  } catch { return null; }
}

type Conn = {
  gsiReady: boolean;
  token: string | null;
  calendars: GCal[];
  carregando: boolean;
  erro: string | null;
  conectar: () => void;
  invalidar: () => void;
};
function useGoogleConn(): Conn {
  const gsiReady = useGsiReady();
  const tokenClientRef = useRef<GsiTokenClient | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<GCal[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const invalidar = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCalendars([]);
  }, []);

  const carregarCalendarios = useCallback(async (accessToken: string) => {
    setCarregando(true);
    try {
      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.status === 401) { invalidar(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items?: Array<{ id: string; summary?: string; primary?: boolean; backgroundColor?: string; accessRole?: string }> };
      setCalendars((data.items || []).map((c) => ({
        id: c.id, summary: c.summary || c.id, primary: c.primary, backgroundColor: c.backgroundColor, accessRole: c.accessRole,
      })));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro lendo agendas.");
    } finally {
      setCarregando(false);
    }
  }, [invalidar]);

  const conectar = useCallback(() => {
    const oauth2 = gsiOauth();
    if (!oauth2) return;
    if (!tokenClientRef.current) {
      tokenClientRef.current = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: CAL_SCOPE,
        callback: (resp) => {
          if (resp.error || !resp.access_token) { setErro(resp.error || "Falha ao conectar."); return; }
          setErro(null);
          setToken(resp.access_token);
          salvarToken(resp.access_token, resp.expires_in || 3600);
          void carregarCalendarios(resp.access_token);
        },
      });
    }
    tokenClientRef.current.requestAccessToken({ prompt: "" });
  }, [carregarCalendarios]);

  useEffect(() => {
    const t = tokenValidoSalvo();
    if (t) { setToken(t); void carregarCalendarios(t); }
  }, [carregarCalendarios]);

  return { gsiReady, token, calendars, carregando, erro, conectar, invalidar };
}

// ─── Preferências de agenda (cor + visibilidade) ────────────────────────────
// Persiste no localStorage (sempre funciona, por dispositivo) E sincroniza no
// Firestore quando as regras permitem (cross-device). Se a regra não estiver
// deployada, a escrita no Firestore falha silenciosamente — o localStorage
// segura a persistência mesmo assim.
type AgendaPref = { cor?: string; oculta?: boolean };
const PREFS_KEY = "plannerAgendaPrefs";
function lerPrefsLocais(): Record<string, AgendaPref> {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; }
}
function usePlannerSettings(uid: string | undefined) {
  const [prefs, setPrefs] = useState<Record<string, AgendaPref>>(lerPrefsLocais);

  // Firestore é a verdade QUANDO existe (sync entre dispositivos). Sem permissão
  // (regra não deployada) → erro silencioso, mantém o localStorage.
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, "plannerSettings", uid),
      (snap) => {
        const d = snap.data() as { agendas?: Record<string, AgendaPref> } | undefined;
        if (d?.agendas) {
          setPrefs(d.agendas);
          try { localStorage.setItem(PREFS_KEY, JSON.stringify(d.agendas)); } catch { /* noop */ }
        }
      },
      () => { /* sem permissão: fica no localStorage */ },
    );
    return () => unsub();
  }, [uid]);

  const setPref = useCallback((calId: string, patch: AgendaPref) => {
    setPrefs((p) => {
      const next = { ...p, [calId]: { ...p[calId], ...patch } };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
    if (uid) void setDoc(doc(db, "plannerSettings", uid), { agendas: { [calId]: patch } }, { merge: true }).catch(() => { /* noop */ });
  }, [uid]);

  return { prefs, setPref };
}

// ─── Eventos (events.list por agenda) ───────────────────────────────────────
type PEvent = { id: string; calendarId: string; gravavel: boolean; color: string; title: string; start: Date; end: Date; allDay: boolean; pin: boolean; recorrente: boolean };
async function listEvents(
  token: string,
  agendas: Agenda[],
  timeMin: Date,
  timeMax: Date,
  onUnauthorized: () => void,
  maxResults = 250,
): Promise<PEvent[]> {
  const out: PEvent[] = [];
  await Promise.all(agendas.map(async (cal) => {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(maxResults));
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { onUnauthorized(); return; }
    if (!res.ok) return;
    const data = await res.json() as {
      items?: Array<{ id: string; summary?: string; status?: string; recurringEventId?: string; extendedProperties?: { private?: Record<string, string> }; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }>;
    };
    for (const ev of (data.items || [])) {
      if (ev.status === "cancelled" || !ev.start) continue;
      const allDay = !!ev.start.date;
      const start = allDay ? parseDateOnly(ev.start.date!) : new Date(ev.start.dateTime!);
      const end = allDay ? parseDateOnly(ev.end?.date || ev.start.date!) : new Date(ev.end?.dateTime || ev.start.dateTime!);
      const pin = ev.extendedProperties?.private?.kind === "pin";
      out.push({ id: ev.id, calendarId: cal.id, gravavel: cal.gravavel, color: cal.cor, title: ev.summary || "(sem título)", start, end, allDay, pin, recorrente: !!ev.recurringEventId });
    }
  }));
  return out;
}
function useEventos(conn: Conn, agendas: Agenda[], timeMin: Date, timeMax: Date, refresh: number, maxResults = 250) {
  const [eventos, setEventos] = useState<PEvent[]>([]);
  const [carregando, setCarregando] = useState(false);
  const minISO = timeMin.toISOString();
  const maxISO = timeMax.toISOString();
  const chave = agendas.map((a) => `${a.id}:${a.cor}`).join(",");

  useEffect(() => {
    if (!conn.token || agendas.length === 0) { setEventos([]); return; }
    let vivo = true;
    setCarregando(true);
    listEvents(conn.token, agendas, new Date(minISO), new Date(maxISO), conn.invalidar, maxResults)
      .then((evs) => { if (vivo) setEventos(evs); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.token, chave, minISO, maxISO, refresh, maxResults]);

  return { eventos, carregando };
}

// Cria um evento (ou pin) via events.insert.
async function criarEvento(token: string, calId: string, ev: {
  titulo: string; allDay: boolean; inicio: Date; fim: Date; pin?: boolean;
}): Promise<void> {
  const body: Record<string, unknown> = { summary: ev.titulo };
  if (ev.allDay) {
    body.start = { date: ymd(ev.inicio) };
    body.end = { date: ymd(addDays(ev.inicio, 1)) };
  } else {
    body.start = { dateTime: ev.inicio.toISOString() };
    body.end = { dateTime: ev.fim.toISOString() };
  }
  if (ev.pin) {
    body.transparency = "transparent"; // pin não bloqueia tempo
    body.extendedProperties = { private: { kind: "pin" } };
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Falha ao criar (HTTP ${res.status})`);
}
async function editarEvento(token: string, calId: string, eventId: string, ev: {
  titulo: string; allDay: boolean; inicio: Date; fim: Date;
}): Promise<void> {
  const body: Record<string, unknown> = { summary: ev.titulo };
  if (ev.allDay) {
    body.start = { date: ymd(ev.inicio) };
    body.end = { date: ymd(addDays(ev.inicio, 1)) };
  } else {
    body.start = { dateTime: ev.inicio.toISOString() };
    body.end = { dateTime: ev.fim.toISOString() };
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Falha ao salvar (HTTP ${res.status})`);
}
async function excluirEvento(token: string, calId: string, eventId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 410) throw new Error(`Falha ao excluir (HTTP ${res.status})`);
}
// Move um evento (drag-and-drop): PATCH só de início/fim, sem tocar no título.
async function moverEvento(token: string, calId: string, eventId: string, ev: {
  allDay: boolean; inicio: Date; fim: Date;
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (ev.allDay) {
    // `fim` é a data de término EXCLUSIVA (preserva eventos de vários dias).
    const fimEx = startOfDay(ev.fim) > startOfDay(ev.inicio) ? ev.fim : addDays(ev.inicio, 1);
    body.start = { date: ymd(ev.inicio) };
    body.end = { date: ymd(fimEx) };
  } else {
    body.start = { dateTime: ev.inicio.toISOString() };
    body.end = { dateTime: ev.fim.toISOString() };
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Falha ao mover (HTTP ${res.status})`);
}
// Troca o evento de agenda (events.move). Mantém o mesmo id no calendário destino.
async function moverParaAgenda(token: string, fromCal: string, eventId: string, toCal: string): Promise<void> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(fromCal)}/events/${encodeURIComponent(eventId)}/move`);
  url.searchParams.set("destination", toCal);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Falha ao trocar de agenda (HTTP ${res.status})`);
}

// ─── Datas ──────────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
function ymd(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date): Date { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
function parseDateOnly(s: string): Date { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); }
function fmtHora(d: Date): string { const h = d.getHours(), m = d.getMinutes(); return m ? `${h}h${pad2(m)}` : `${h}h`; }
function hhmm(d: Date): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
// Combina a DATA de `dia` com a HORA de `ref` (usado no drag do mês p/ eventos timados).
function comHoraDe(dia: Date, ref: Date): Date {
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), ref.getHours(), ref.getMinutes(), 0, 0);
}
const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ─── Página ─────────────────────────────────────────────────────────────────
export function PlannerPage() {
  const { pessoa, fbUser } = useAuth();
  const conn = useGoogleConn();
  const { prefs, setPref } = usePlannerSettings(fbUser?.uid);
  const [vista, setVista] = useState<TipoVista>("calendario");
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [refresh, setRefresh] = useState(0);
  const [criar, setCriar] = useState<null | "evento" | "pin">(null);
  const [editando, setEditando] = useState<PEvent | null>(null);
  const [refDate, setRefDate] = useState(() => new Date());

  if (!pessoa?.isMaster) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-medium text-gray-700 dark:text-gray-200">Planner é pessoal</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Este módulo é privado do dono da conta.</p>
      </div>
    );
  }

  // Agendas com preferências aplicadas.
  const agendas: Agenda[] = conn.calendars.map((c) => ({
    id: c.id,
    summary: c.summary,
    cor: prefs[c.id]?.cor || c.backgroundColor || "#6a5ae0",
    oculta: prefs[c.id]?.oculta ?? false,
    gravavel: c.accessRole === "owner" || c.accessRole === "writer",
  }));
  const visiveis = agendas.filter((a) => !a.oculta);
  const gravaveis = agendas.filter((a) => a.gravavel);
  const alvo: TipoVista | Periodo = vista === "calendario" ? periodo : vista;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 flex-wrap mb-3 pt-1">
        <Dropdown label={VISTA_LABEL[vista]}>
          {(close) => VISTAS.map((v) => (
            <MenuItem key={v} ativo={v === vista} onClick={() => { setVista(v); close(); }}>{VISTA_LABEL[v]}</MenuItem>
          ))}
        </Dropdown>
        {vista === "calendario" && (
          <Dropdown label={PERIODO_LABEL[periodo]}>
            {(close) => PERIODOS.map((p) => (
              <MenuItem key={p} ativo={p === periodo} onClick={() => { setPeriodo(p); close(); }}>{PERIODO_LABEL[p]}</MenuItem>
            ))}
          </Dropdown>
        )}
        <StatusGoogle conn={conn} />
        {conn.token && (
          <div className="ml-auto flex items-center gap-2">
            <RevisarButton count={0} />
            <Dropdown label="+ Novo" primary disabled={gravaveis.length === 0}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { setCriar("evento"); close(); }}>📅 Evento</MenuItem>
                  <MenuItem onClick={() => { setCriar("pin"); close(); }}>📌 Pin</MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        )}
      </div>

      {alvo === "semana" && <SemanaView conn={conn} agendas={visiveis} refresh={refresh} refDate={refDate} setRefDate={setRefDate} onEventClick={setEditando} onRefresh={() => setRefresh((r) => r + 1)} />}
      {alvo === "mes" && <MesView conn={conn} agendas={visiveis} refresh={refresh} refDate={refDate} setRefDate={setRefDate} onEventClick={setEditando} onRefresh={() => setRefresh((r) => r + 1)} />}
      {alvo === "tri" && <TrimestreView conn={conn} agendas={visiveis} refresh={refresh} refDate={refDate} setRefDate={setRefDate} onEventClick={setEditando} />}
      {alvo === "ano" && <AnoView conn={conn} agendas={visiveis} refresh={refresh} refDate={refDate} setRefDate={setRefDate} onEventClick={setEditando} />}
      {alvo === "kanban" && <EmBreve titulo="Kanban" desc="Colunas = fases dos projetos; arrastar muda a fase." />}
      {alvo === "crono" && <EmBreve titulo="Cronograma" desc="Barras por duração, swimlanes por agenda." />}

      {conn.token && agendas.length > 0 && <AgendasManager agendas={agendas} setPref={setPref} />}

      {criar && conn.token && (
        <EventoModal
          modo={criar}
          token={conn.token}
          agendas={gravaveis}
          onClose={() => setCriar(null)}
          onDone={() => { setCriar(null); setRefresh((r) => r + 1); }}
        />
      )}
      {editando && conn.token && (
        <EventoModal
          modo="editar"
          token={conn.token}
          agendas={gravaveis}
          evento={editando}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); setRefresh((r) => r + 1); }}
        />
      )}
    </div>
  );
}

// ─── Navegação ◀ Hoje ▶ ─────────────────────────────────────────────────────
function NavBtns({ onPrev, onHoje, onNext }: { onPrev: () => void; onHoje: () => void; onNext: () => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button type="button" onClick={onPrev} title="Anterior"
        className="px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">◀</button>
      <button type="button" onClick={onHoje}
        className="px-2.5 py-1.5 text-xs font-semibold border-x border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">Hoje</button>
      <button type="button" onClick={onNext} title="Próximo"
        className="px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">▶</button>
    </div>
  );
}

// ─── Status discreto da conexão (no header) ─────────────────────────────────
function StatusGoogle({ conn }: { conn: Conn }) {
  const connected = !!conn.token;
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={conn.conectar}
        disabled={!conn.gsiReady || conn.carregando}
        title={connected ? "Google conectado — clique pra reconectar" : "Clique para conectar sua conta Google"}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
      >
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-500"}`} />
        {conn.carregando ? "conectando…" : connected ? "Conectado" : "Clique para conectar"}
      </button>
      {conn.erro && <span className="text-[10px] text-rose-600 dark:text-rose-400">⚠️ {conn.erro}</span>}
    </div>
  );
}

// ─── Gerenciador de agendas (abaixo do calendário): cor + visibilidade ──────
function AgendasManager({ agendas, setPref }: { agendas: Agenda[]; setPref: (id: string, p: AgendaPref) => void }) {
  const visiveis = agendas.filter((a) => !a.oculta).length;
  return (
    <div className="mt-6 border-t border-gray-200 dark:border-gray-800 pt-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
        Agendas ({visiveis}/{agendas.length}) · cor e visibilidade
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agendas.map((a) => (
          <div key={a.id}
            className={`inline-flex items-center gap-1.5 text-[11px] pl-1 pr-2 py-1 rounded-full border ${
              a.oculta ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 opacity-60" : "border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/50"
            }`}>
            <label className="relative w-4 h-4 rounded-full cursor-pointer border border-black/10" style={{ background: a.cor }} title="Mudar cor">
              <input type="color" value={a.cor} onChange={(e) => setPref(a.id, { cor: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            <span className={`${a.oculta ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-200"} whitespace-nowrap`}>{a.summary}</span>
            <button type="button" onClick={() => setPref(a.id, { oculta: !a.oculta })}
              title={a.oculta ? "Mostrar no Planner" : "Ocultar do Planner"}
              className="text-[12px] leading-none hover:opacity-70">
              {a.oculta ? "🙈" : "👁️"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dropdown genérico (seletor / menu) ─────────────────────────────────────
function Dropdown({ label, primary, tone, disabled, children }: {
  label: React.ReactNode;
  primary?: boolean;
  tone?: "green" | "amber";
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const cls = primary
    ? "bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600"
    : tone === "amber"
      ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
      : tone === "green"
        ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
        : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800";
  const align = primary || tone ? "right-0" : "left-0";
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 ${cls}`}>
        {label} <span className="text-[9px] opacity-70">▾</span>
      </button>
      {open && (
        <div className={`absolute ${align} z-30 mt-1 min-w-[150px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
function MenuItem({ ativo, onClick, children }: { ativo?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left text-xs px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap ${
        ativo ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-gray-700 dark:text-gray-200"
      }`}>{children}</button>
  );
}
// Botão "Revisar" — verde quando vazio, amarelo quando tem novidade.
function RevisarButton({ count }: { count: number }) {
  return (
    <Dropdown tone={count ? "amber" : "green"}
      label={<><span className={`w-2 h-2 rounded-full ${count ? "bg-amber-500" : "bg-emerald-500"}`} /> {count ? `${count} pra revisar` : "Revisar"}</>}>
      {() => (
        <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 w-56">
          {count ? "Clique nos itens pra aprovar ou descartar." : "Nada a revisar ainda. Aqui vão aparecer janelas livres detectadas e itens de automação (em breve)."}
        </div>
      )}
    </Dropdown>
  );
}
function EmBreve({ titulo, desc }: { titulo: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
      <div className="text-3xl mb-2">🚧</div>
      <div className="font-semibold text-gray-700 dark:text-gray-200">{titulo}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">{desc}</div>
      <div className="text-[11px] text-gray-400 mt-3">Próxima etapa.</div>
    </div>
  );
}
function PrecisaConectar() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
      🔗 Conecte sua conta Google (acima) pra ver seus eventos aqui.
    </div>
  );
}

// ─── Visão SEMANA ───────────────────────────────────────────────────────────
const PX = 44;
function SemanaView({ conn, agendas, refresh, refDate, setRefDate, onEventClick, onRefresh }: {
  conn: Conn; agendas: Agenda[]; refresh: number;
  refDate: Date; setRefDate: (d: Date) => void; onEventClick: (ev: PEvent) => void; onRefresh: () => void;
}) {
  const weekStart = startOfWeek(refDate);
  const weekEnd = addDays(weekStart, 7);
  const { eventos, carregando } = useEventos(conn, agendas, weekStart, weekEnd, refresh);
  const hoje = new Date();
  const mostraHoje = hoje >= weekStart && hoje < weekEnd;
  const hojeIdx = mostraHoje ? (hoje.getDay() + 6) % 7 : -1;

  // Drag-and-drop: mover timado (hora+dia), redimensionar (fim) e mover all-day (dia).
  const gridRef = useRef<HTMLDivElement>(null);
  type DragKind = "move" | "resize" | "allday";
  const dragRef = useRef<{ ev: PEvent; kind: DragKind; origCol: number; startX: number; startY: number; moved: boolean; target: { start: Date; end: Date } | null } | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);

  if (!conn.token) return <PrecisaConectar />;
  const token = conn.token;

  const dias = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const timadosPorDia: PEvent[][] = dias.map(() => []);
  const alldayPorDia: PEvent[][] = dias.map(() => []);
  for (const ev of eventos) {
    if (ev.allDay) {
      for (let i = 0; i < 7; i++) { const d = dias[i]; if (d >= startOfDay(ev.start) && d < startOfDay(ev.end)) alldayPorDia[i].push(ev); }
    } else {
      const idx = dias.findIndex((d) => ymd(d) === ymd(ev.start));
      if (idx >= 0) timadosPorDia[idx].push(ev);
    }
  }

  // Faixa de horário DINÂMICA: só o intervalo com evento (+ "agora").
  const timados = timadosPorDia.flat();
  let h0 = 7, h1 = 22; // default quando não há evento timado
  if (timados.length) {
    const minH = Math.min(...timados.map((e) => e.start.getHours() + e.start.getMinutes() / 60));
    const maxH = Math.max(...timados.map((e) => e.end.getHours() + e.end.getMinutes() / 60));
    h0 = Math.floor(minH);
    h1 = Math.min(23, Math.ceil(maxH));
  }
  if (mostraHoje) {                                       // inclui a hora atual só na semana de hoje
    h0 = Math.max(0, Math.min(h0, hoje.getHours()));
    h1 = Math.min(23, Math.max(h1, hoje.getHours() + 1));
  }
  if (h1 <= h0) h1 = Math.min(23, h0 + 1);

  const totH = (h1 - h0 + 1) * PX;
  const horas = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);

  function startDrag(e: React.PointerEvent, ev: PEvent, origCol: number, kind: DragKind) {
    suppressClick.current = false;                         // limpa estado preso de um drag anterior
    if (!ev.gravavel || e.button !== 0) return;
    if (kind === "resize") e.stopPropagation();           // não dispara o "move" do bloco
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = { ev, kind, origCol, startX: e.clientX, startY: e.clientY, moved: false, target: null };
  }
  function colDoX(clientX: number): number {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const colW = rect.width / 7;
    return Math.max(0, Math.min(6, Math.floor((clientX - rect.left) / colW)));
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    if (d.kind === "resize") {
      const quartos = Math.round((dy / PX) * 4);
      let novoFim = new Date(d.ev.end.getTime() + quartos * 15 * 60000);
      if (novoFim.getTime() <= d.ev.start.getTime() + 15 * 60000) novoFim = new Date(d.ev.start.getTime() + 15 * 60000);
      d.target = { start: d.ev.start, end: novoFim };
      setGhost({ x: e.clientX, y: e.clientY, label: `${fmtHora(d.ev.start)}–${fmtHora(novoFim)}` });
    } else if (d.kind === "allday") {
      const col = colDoX(e.clientX);
      const novoIni = startOfDay(dias[col]);
      const nDias = Math.max(1, Math.round((startOfDay(d.ev.end).getTime() - startOfDay(d.ev.start).getTime()) / 86400000));
      const novoFim = addDays(novoIni, nDias);             // fim exclusivo, preserva duração
      d.target = { start: novoIni, end: novoFim };
      setGhost({ x: e.clientX, y: e.clientY, label: `${DOW[col]} · ${novoIni.getDate()} ${MESES[novoIni.getMonth()].slice(0, 3)}` });
    } else {
      const col = colDoX(e.clientX);
      const quartos = Math.round((dy / PX) * 4);          // passos de 15 min
      const novoIni = new Date(d.ev.start.getTime() + (col - d.origCol) * 86400000 + quartos * 15 * 60000);
      const dur = d.ev.end.getTime() - d.ev.start.getTime();
      const novoFim = new Date(novoIni.getTime() + dur);
      d.target = { start: novoIni, end: novoFim };
      setGhost({ x: e.clientX, y: e.clientY, label: `${DOW[col]} · ${fmtHora(novoIni)}–${fmtHora(novoFim)}` });
    }
  }
  async function endDrag(e: React.PointerEvent, ev: PEvent) {
    const d = dragRef.current;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setGhost(null);
    dragRef.current = null;
    if (!d || !d.moved || !d.target) return;              // não moveu → onClick abre o modal
    // No resize a alça já faz stopPropagation no clique; só os moves precisam engolir.
    if (d.kind !== "resize") suppressClick.current = true;
    const { start, end } = d.target;
    const allDay = d.kind === "allday";
    try { await moverEvento(token, ev.calendarId, ev.id, { allDay, inicio: start, fim: end }); }
    catch { /* recarrega pra refletir o estado real */ }
    onRefresh();
  }
  function clickEvento(ev: PEvent) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onEventClick(ev);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <NavBtns
            onPrev={() => setRefDate(addDays(weekStart, -7))}
            onHoje={() => setRefDate(new Date())}
            onNext={() => setRefDate(addDays(weekStart, 7))}
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Semana · {weekStart.getDate()}–{addDays(weekStart, 6).getDate()} {MESES[addDays(weekStart, 6).getMonth()].slice(0, 3)}
          </h2>
        </div>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "linha vermelha = agora"}</span>
      </div>
      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
        <div className="max-h-[600px] overflow-auto">
          {/* min-w garante colunas tocáveis no mobile (rola na horizontal). */}
          <div className="min-w-[600px]">
          <div className="sticky top-0 z-20 bg-white dark:bg-gray-900">
            <div className="flex border-b border-gray-200 dark:border-gray-800">
              <div className="w-[46px] flex-none" />
              <div className="grid grid-cols-7 flex-1">
                {dias.map((d, i) => (
                  <div key={i} className={`py-2 px-1.5 text-center border-l border-gray-200 dark:border-gray-800 ${i === hojeIdx ? "bg-indigo-50 dark:bg-indigo-900/30" : ""}`}>
                    <div className="text-[9.5px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">{DOW[i]}</div>
                    <div className={`text-[15px] font-semibold ${i === hojeIdx ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-100"}`}>{d.getDate()}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex border-b border-gray-200 dark:border-gray-800">
              <div className="w-[46px] flex-none grid place-items-center text-[8px] uppercase tracking-wider text-gray-400 border-r border-gray-200 dark:border-gray-800">dia<br />todo</div>
              <div className="grid grid-cols-7 flex-1">
                {dias.map((_, i) => (
                  <div key={i} className="p-1 border-l border-gray-200 dark:border-gray-800 min-h-[28px] space-y-0.5">
                    {alldayPorDia[i].map((ev) => (
                      <button key={ev.id} type="button"
                        onPointerDown={(e) => startDrag(e, ev, i, "allday")}
                        onPointerMove={moveDrag}
                        onPointerUp={(e) => endDrag(e, ev)}
                        onClick={() => clickEvento(ev)}
                        className={`block w-full text-left text-[9.5px] px-1.5 py-0.5 rounded truncate touch-none select-none hover:brightness-95 ${ev.pin ? "bg-transparent border border-dashed font-semibold" : "text-white"}`}
                        style={ev.pin
                          ? { borderColor: ev.color, color: ev.color, cursor: ev.gravavel ? "grab" : "pointer" }
                          : { background: ev.color, cursor: ev.gravavel ? "grab" : "pointer" }}
                        title={ev.gravavel ? "Clique pra editar · arraste pra outro dia" : ev.title}>
                        {ev.pin ? "📌 " : ""}{ev.title}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex">
            <div className="w-[46px] flex-none border-r border-gray-200 dark:border-gray-800">
              {horas.map((h, idx) => (
                <div key={h} className={`h-[44px] text-[9.5px] text-gray-400 text-right pr-1.5 pt-0.5 ${idx > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>{h}h</div>
              ))}
            </div>
            <div ref={gridRef} className="grid grid-cols-7 flex-1">
              {dias.map((_, i) => (
                <div key={i} className={`relative border-l border-gray-200 dark:border-gray-800 ${i === hojeIdx ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}`}
                  style={{ height: totH, backgroundImage: "repeating-linear-gradient(to bottom,transparent,transparent 43px,rgba(0,0,0,.06) 43px,rgba(0,0,0,.06) 44px)" }}>
                  {timadosPorDia[i].map((ev) => {
                    const ini = ev.start.getHours() + ev.start.getMinutes() / 60;
                    let fim = ev.end.getHours() + ev.end.getMinutes() / 60;
                    if (fim <= ini) fim = ini + 0.5;
                    const altura = Math.max(16, (fim - ini) * PX - 3);
                    const linhas = Math.max(1, Math.floor((altura - 6) / 11)); // qtd de linhas que cabe inteira
                    return (
                      <button key={ev.id} type="button"
                        onPointerDown={(e) => startDrag(e, ev, i, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={(e) => endDrag(e, ev)}
                        onClick={() => clickEvento(ev)}
                        className="absolute left-[3px] right-[3px] rounded-md text-white text-[9.5px] leading-tight px-1.5 py-1 overflow-hidden shadow-sm text-left hover:brightness-95 touch-none select-none"
                        style={{ background: ev.color, top: (ini - h0) * PX, height: altura, cursor: ev.gravavel ? "grab" : "pointer" }} title={ev.gravavel ? "Clique pra editar · arraste pra mover · alça embaixo redimensiona" : ev.title}>
                        <div style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: linhas, overflow: "hidden", wordBreak: "break-word" }}>
                          <span className="font-bold text-[9px] opacity-90">{ev.pin ? "📌 " : ""}{fmtHora(ev.start)}</span> {ev.title}
                        </div>
                        {ev.gravavel && altura >= 24 && (
                          <span
                            onPointerDown={(e) => startDrag(e, ev, i, "resize")}
                            onPointerMove={moveDrag}
                            onPointerUp={(e) => endDrag(e, ev)}
                            onClick={(e) => e.stopPropagation()}
                            className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize touch-none"
                            title="Arraste pra mudar a duração"
                          >
                            <span className="absolute left-1/2 -translate-x-1/2 bottom-[2px] w-5 h-0.5 rounded bg-white/70" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {i === hojeIdx && (
                    <div className="absolute left-0 right-0 h-0.5 bg-rose-500 z-10" style={{ top: (hoje.getHours() + hoje.getMinutes() / 60 - h0) * PX }}>
                      <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-rose-500" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </div>
      {ghost && (
        <div className="fixed z-[80] pointer-events-none px-2 py-1 rounded-md bg-gray-900/90 text-white text-[11px] font-semibold shadow-lg -translate-x-1/2"
          style={{ left: ghost.x, top: ghost.y - 34 }}>{ghost.label}</div>
      )}
    </section>
  );
}

// ─── Visão MÊS ──────────────────────────────────────────────────────────────
function MesView({ conn, agendas, refresh, refDate, setRefDate, onEventClick, onRefresh }: {
  conn: Conn; agendas: Agenda[]; refresh: number;
  refDate: Date; setRefDate: (d: Date) => void; onEventClick: (ev: PEvent) => void; onRefresh: () => void;
}) {
  const hoje = new Date();
  const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42);
  const { eventos, carregando } = useEventos(conn, agendas, gridStart, gridEnd, refresh);
  const [diaAberto, setDiaAberto] = useState<Date | null>(null);

  // Drag-and-drop das pílulas entre dias.
  const dragRef = useRef<{ ev: PEvent; origYmd: string; startX: number; startY: number; moved: boolean; targetYmd: string | null } | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [overYmd, setOverYmd] = useState<string | null>(null);

  if (!conn.token) return <PrecisaConectar />;
  const token = conn.token;

  const celulas = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const porDia = new Map<string, PEvent[]>();
  const push = (k: string, ev: PEvent) => { const arr = porDia.get(k); if (arr) arr.push(ev); else porDia.set(k, [ev]); };
  for (const ev of eventos) {
    if (ev.allDay) { for (let d = startOfDay(ev.start); d < startOfDay(ev.end); d = addDays(d, 1)) push(ymd(d), ev); }
    else push(ymd(ev.start), ev);
  }
  const evsDoDia = (d: Date) => (porDia.get(ymd(d)) || []).sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.start.getTime() - b.start.getTime());

  function targetYmdFrom(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest("[data-date]") as HTMLElement | null)?.getAttribute("data-date") || null;
  }
  function startDragMes(e: React.PointerEvent, ev: PEvent, dia: Date) {
    suppressClick.current = false;                         // limpa estado preso de um drag anterior
    if (!ev.gravavel || e.button !== 0) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = { ev, origYmd: ymd(dia), startX: e.clientX, startY: e.clientY, moved: false, targetYmd: null };
  }
  function moveDragMes(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const ty = targetYmdFrom(e.clientX, e.clientY);
    d.targetYmd = ty;
    setOverYmd(ty);
    if (ty) {
      const dt = parseDateOnly(ty);
      setGhost({ x: e.clientX, y: e.clientY, label: `→ ${dt.getDate()} ${MESES[dt.getMonth()].slice(0, 3)}` });
    } else {
      setGhost({ x: e.clientX, y: e.clientY, label: "solte sobre um dia" });
    }
  }
  async function endDragMes(e: React.PointerEvent, ev: PEvent) {
    const d = dragRef.current;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setGhost(null);
    setOverYmd(null);
    dragRef.current = null;
    if (!d || !d.moved) return;                                  // não moveu → onClick abre o modal
    suppressClick.current = true;                                // moveu → engole o clique seguinte
    if (!d.targetYmd || d.targetYmd === d.origYmd) return;       // soltou fora ou no mesmo dia
    const dt = parseDateOnly(d.targetYmd);
    const dur = ev.end.getTime() - ev.start.getTime();
    const nDias = Math.max(1, Math.round((startOfDay(ev.end).getTime() - startOfDay(ev.start).getTime()) / 86400000));
    const novoIni = ev.allDay ? dt : comHoraDe(dt, ev.start);
    const novoFim = ev.allDay ? addDays(dt, nDias) : new Date(novoIni.getTime() + dur);
    try { await moverEvento(token, ev.calendarId, ev.id, { allDay: ev.allDay, inicio: novoIni, fim: novoFim }); }
    catch { /* recarrega pra refletir o estado real */ }
    onRefresh();
  }
  function clickPill(ev: PEvent) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onEventClick(ev);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <NavBtns
            onPrev={() => setRefDate(new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1))}
            onHoje={() => setRefDate(new Date())}
            onNext={() => setRefDate(new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1))}
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 capitalize">{MESES[monthStart.getMonth()]} {monthStart.getFullYear()}</h2>
        </div>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "clique no dia · arraste eventos entre dias"}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (<div key={d} className="text-[9.5px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold px-1 pb-0.5">{d}</div>))}
        {celulas.map((d, i) => {
          const noMes = d.getMonth() === monthStart.getMonth();
          const isHoje = ymd(d) === ymd(hoje);
          const isOver = overYmd === ymd(d);
          const evs = evsDoDia(d);
          return (
            <div key={i} data-date={ymd(d)} onClick={() => setDiaAberto(d)}
              className={`min-h-[92px] rounded-xl border p-1.5 relative text-left cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors ${
              noMes ? "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800" : "bg-transparent border-dashed border-gray-200 dark:border-gray-800 opacity-50"
            } ${isHoje ? "ring-2 ring-indigo-200 dark:ring-indigo-800 border-indigo-400" : ""} ${isOver ? "ring-2 ring-indigo-400 border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/30" : ""}`}>
              <div className={`text-[12.5px] font-semibold ${isHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400"}`}>{d.getDate()}</div>
              {evs.slice(0, 3).map((ev) => (
                <div key={ev.id}
                  onPointerDown={(e) => startDragMes(e, ev, d)}
                  onPointerMove={moveDragMes}
                  onPointerUp={(e) => endDragMes(e, ev)}
                  onClick={(e) => { e.stopPropagation(); clickPill(ev); }}
                  className={`mt-1 text-[10px] px-1.5 py-0.5 rounded truncate touch-none select-none hover:brightness-95 ${ev.pin ? "bg-transparent border border-dashed font-semibold" : "text-white"}`}
                  style={ev.pin
                    ? { borderColor: ev.color, color: ev.color, cursor: ev.gravavel ? "grab" : "pointer" }
                    : { background: ev.color, cursor: ev.gravavel ? "grab" : "pointer" }}
                  title={ev.gravavel ? "Clique pra editar · arraste pra outro dia" : ev.title}>
                  {ev.pin ? "📌 " : ""}{ev.allDay ? ev.title : `${fmtHora(ev.start)} ${ev.title}`}
                </div>
              ))}
              {evs.length > 3 && <div className="mt-1 text-[10px] text-gray-400 px-1.5">+{evs.length - 3}</div>}
            </div>
          );
        })}
      </div>
      {diaAberto && (
        <DiaPopup
          dia={diaAberto}
          eventos={evsDoDia(diaAberto)}
          onClose={() => setDiaAberto(null)}
          onEventClick={(ev) => { setDiaAberto(null); onEventClick(ev); }}
        />
      )}
      {ghost && (
        <div className="fixed z-[80] pointer-events-none px-2 py-1 rounded-md bg-gray-900/90 text-white text-[11px] font-semibold shadow-lg -translate-x-1/2"
          style={{ left: ghost.x, top: ghost.y - 34 }}>{ghost.label}</div>
      )}
    </section>
  );
}

// ─── Popup do dia (mês → clique no dia) ─────────────────────────────────────
function DiaPopup({ dia, eventos, onClose, onEventClick }: {
  dia: Date; eventos: PEvent[]; onClose: () => void; onEventClick: (ev: PEvent) => void;
}) {
  return (
    <Modal title={`${DOW[(dia.getDay() + 6) % 7]} · ${dia.getDate()} de ${MESES[dia.getMonth()]}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-2">
        {eventos.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Nenhum evento nesse dia.</p>}
        {eventos.map((ev) => (
          <button key={ev.id} type="button" onClick={() => onEventClick(ev)}
            className="w-full flex items-start gap-2 text-left p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
            <span className="w-2.5 h-2.5 rounded-full mt-1 flex-none" style={{ background: ev.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100 break-words">{ev.pin ? "📌 " : ""}{ev.title}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {ev.pin ? "Pin" : ev.allDay ? "Dia todo" : `${fmtHora(ev.start)}–${fmtHora(ev.end)}`}
                {ev.recorrente ? " · 🔁 recorrente" : ""}{ev.gravavel ? "" : " · só leitura"}
              </div>
            </div>
            <span className="text-[11px] text-indigo-500 dark:text-indigo-400 flex-none">✏️</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Constrói o mapa dia(ymd) → eventos, expandindo all-day por todos os dias.
function mapaPorDia(eventos: PEvent[]): Map<string, PEvent[]> {
  const porDia = new Map<string, PEvent[]>();
  const push = (k: string, ev: PEvent) => { const arr = porDia.get(k); if (arr) arr.push(ev); else porDia.set(k, [ev]); };
  for (const ev of eventos) {
    if (ev.allDay) { for (let d = startOfDay(ev.start); d < startOfDay(ev.end); d = addDays(d, 1)) push(ymd(d), ev); }
    else push(ymd(ev.start), ev);
  }
  return porDia;
}
function ordenaDia(a: PEvent, b: PEvent) { return Number(a.allDay) - Number(b.allDay) || a.start.getTime() - b.start.getTime(); }

// ─── Visão TRIMESTRE (semanas × dias) ───────────────────────────────────────
function TrimestreView({ conn, agendas, refresh, refDate, setRefDate, onEventClick }: {
  conn: Conn; agendas: Agenda[]; refresh: number;
  refDate: Date; setRefDate: (d: Date) => void; onEventClick: (ev: PEvent) => void;
}) {
  const hoje = new Date();
  const qMonth = Math.floor(refDate.getMonth() / 3) * 3;
  const ano = refDate.getFullYear();
  const quarterStart = new Date(ano, qMonth, 1);
  const quarterEnd = new Date(ano, qMonth + 3, 1);                 // exclusivo
  const gridStart = startOfWeek(quarterStart);
  const semanas = Math.ceil((quarterEnd.getTime() - gridStart.getTime()) / (7 * 86400000));
  const gridEnd = addDays(gridStart, semanas * 7);
  const { eventos, carregando } = useEventos(conn, agendas, gridStart, gridEnd, refresh, 2500);
  const [diaAberto, setDiaAberto] = useState<Date | null>(null);

  if (!conn.token) return <PrecisaConectar />;

  const porDia = mapaPorDia(eventos);
  const evsDoDia = (d: Date) => (porDia.get(ymd(d)) || []).sort(ordenaDia);
  const trimestreNo = Math.floor(qMonth / 3) + 1;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <NavBtns
            onPrev={() => setRefDate(new Date(ano, qMonth - 3, 1))}
            onHoje={() => setRefDate(new Date())}
            onNext={() => setRefDate(new Date(ano, qMonth + 3, 1))}
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {trimestreNo}º trimestre · {MESES[qMonth].slice(0, 3)}–{MESES[qMonth + 2].slice(0, 3)} {ano}
          </h2>
        </div>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "clique num dia pra ver o detalhe"}</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => (<div key={d} className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold px-1 pb-0.5 text-center">{d}</div>))}
        {Array.from({ length: semanas * 7 }, (_, i) => addDays(gridStart, i)).map((d, i) => {
          const noTri = d >= quarterStart && d < quarterEnd;
          const isHoje = ymd(d) === ymd(hoje);
          const ehDia1 = d.getDate() === 1;
          const evs = evsDoDia(d);
          return (
            <button key={i} type="button" onClick={() => setDiaAberto(d)}
              className={`min-h-[52px] rounded-lg border p-1 text-left relative hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors ${
                noTri ? "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800" : "bg-transparent border-dashed border-gray-200 dark:border-gray-800 opacity-40"
              } ${isHoje ? "ring-2 ring-indigo-300 dark:ring-indigo-700 border-indigo-400" : ""}`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-[10.5px] font-semibold ${isHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400"}`}>{d.getDate()}</span>
                {ehDia1 && <span className="text-[8px] uppercase font-bold text-gray-400 dark:text-gray-500">{MESES[d.getMonth()].slice(0, 3)}</span>}
              </div>
              <div className="flex flex-wrap gap-0.5 mt-1">
                {evs.slice(0, 6).map((ev) => (
                  <span key={ev.id} className="w-1.5 h-1.5 rounded-full" style={{ background: ev.color }} title={ev.title} />
                ))}
                {evs.length > 6 && <span className="text-[8px] text-gray-400 leading-none">+{evs.length - 6}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {diaAberto && (
        <DiaPopup dia={diaAberto} eventos={evsDoDia(diaAberto)} onClose={() => setDiaAberto(null)}
          onEventClick={(ev) => { setDiaAberto(null); onEventClick(ev); }} />
      )}
    </section>
  );
}

// ─── Visão ANO (12 faixas de meses; cada dia uma célula) ────────────────────
function AnoView({ conn, agendas, refresh, refDate, setRefDate, onEventClick }: {
  conn: Conn; agendas: Agenda[]; refresh: number;
  refDate: Date; setRefDate: (d: Date) => void; onEventClick: (ev: PEvent) => void;
}) {
  const hoje = new Date();
  const ano = refDate.getFullYear();
  const yStart = new Date(ano, 0, 1);
  const yEnd = new Date(ano + 1, 0, 1);
  const { eventos, carregando } = useEventos(conn, agendas, yStart, yEnd, refresh, 2500);
  const [diaAberto, setDiaAberto] = useState<Date | null>(null);

  if (!conn.token) return <PrecisaConectar />;

  const porDia = mapaPorDia(eventos);
  const evsDoDia = (d: Date) => (porDia.get(ymd(d)) || []).sort(ordenaDia);
  // Escala de "calor" por quantidade de eventos no dia.
  function heat(n: number): string {
    if (!n) return "bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700";
    if (n === 1) return "bg-indigo-200 dark:bg-indigo-900/50 hover:bg-indigo-300";
    if (n <= 3) return "bg-indigo-400 dark:bg-indigo-700 hover:bg-indigo-500";
    if (n <= 5) return "bg-indigo-500 dark:bg-indigo-600 hover:bg-indigo-600";
    return "bg-indigo-700 dark:bg-indigo-500 hover:bg-indigo-800";
  }
  const maxDias = 31;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <NavBtns
            onPrev={() => setRefDate(new Date(ano - 1, refDate.getMonth(), 1))}
            onHoje={() => setRefDate(new Date())}
            onNext={() => setRefDate(new Date(ano + 1, refDate.getMonth(), 1))}
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{ano}</h2>
        </div>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          {carregando ? "carregando…" : <>menos <span className="inline-flex gap-0.5">{[0, 1, 3, 5, 6].map((n) => <span key={n} className={`w-2.5 h-2.5 rounded-sm ${heat(n)}`} />)}</span> mais</>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] space-y-1">
          {/* Cabeçalho de números dos dias */}
          <div className="flex items-center gap-0.5">
            <div className="w-8 flex-none" />
            {Array.from({ length: maxDias }, (_, i) => i + 1).map((n) => (
              <div key={n} className="w-[18px] text-center text-[8px] text-gray-400 dark:text-gray-500 tabular-nums">{n % 2 === 1 ? n : ""}</div>
            ))}
          </div>
          {Array.from({ length: 12 }, (_, m) => {
            const diasNoMes = new Date(ano, m + 1, 0).getDate();
            return (
              <div key={m} className="flex items-center gap-0.5">
                <div className="w-8 flex-none text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{MESES[m].slice(0, 3)}</div>
                {Array.from({ length: maxDias }, (_, i) => i + 1).map((dia) => {
                  if (dia > diasNoMes) return <div key={dia} className="w-[18px] h-[18px]" />;
                  const d = new Date(ano, m, dia);
                  const evs = evsDoDia(d);
                  const isHoje = ymd(d) === ymd(hoje);
                  return (
                    <button key={dia} type="button" onClick={() => evs.length ? setDiaAberto(d) : undefined}
                      title={`${dia}/${m + 1} · ${evs.length} evento(s)`}
                      className={`w-[18px] h-[18px] rounded-sm transition-colors ${heat(evs.length)} ${isHoje ? "ring-2 ring-rose-400" : ""} ${evs.length ? "cursor-pointer" : "cursor-default"}`} />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {diaAberto && (
        <DiaPopup dia={diaAberto} eventos={evsDoDia(diaAberto)} onClose={() => setDiaAberto(null)}
          onEventClick={(ev) => { setDiaAberto(null); onEventClick(ev); }} />
      )}
    </section>
  );
}

// ─── Modal: criar / editar / excluir evento ou pin ──────────────────────────
function EventoModal({ modo, token, agendas, evento, onClose, onDone }: {
  modo: "evento" | "pin" | "editar";
  token: string;
  agendas: Agenda[];
  evento?: PEvent;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = modo === "editar";
  const isPin = modo === "pin";
  // No modo edição, o horário vem do evento; senão começa em branco/agora.
  const [titulo, setTitulo] = useState(evento?.title || "");
  const [calId, setCalId] = useState(evento?.calendarId || agendas[0]?.id || "");
  const [data, setData] = useState(ymd(evento?.start || new Date()));
  const [semHora] = useState(isPin || (isEdit && !!evento?.allDay));
  const [inicio, setInicio] = useState(evento && !evento.allDay ? hhmm(evento.start) : "09:00");
  const [fim, setFim] = useState(evento && !evento.allDay ? hhmm(evento.end) : "10:00");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Evento de agenda só-leitura: não dá pra editar por aqui.
  if (isEdit && evento && !evento.gravavel) {
    return (
      <Modal title={evento.title} onClose={onClose} maxWidth="max-w-md">
        <div className="space-y-3 text-sm">
          <p className="text-gray-700 dark:text-gray-200">
            {evento.allDay ? "Dia todo" : `${fmtHora(evento.start)}–${fmtHora(evento.end)}`}
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">Esta agenda é só leitura — não dá pra editar ou excluir o evento por aqui.</p>
          <div className="flex justify-end pt-1"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
        </div>
      </Modal>
    );
  }

  async function salvar() {
    setErro("");
    if (!titulo.trim()) { setErro("Dê um título."); return; }
    if (!isEdit && !calId) { setErro("Escolha uma agenda."); return; }
    setSalvando(true);
    try {
      const [y, m, d] = data.split("-").map(Number);
      let ini: Date, f: Date;
      if (semHora) {
        ini = new Date(y, m - 1, d);
        f = new Date(y, m - 1, d);
      } else {
        const [hi, mi] = inicio.split(":").map(Number);
        const [hf, mf] = fim.split(":").map(Number);
        ini = new Date(y, m - 1, d, hi || 0, mi || 0);
        f = new Date(y, m - 1, d, hf || 0, mf || 0);
        if (f <= ini) f = new Date(ini.getTime() + 30 * 60000);
      }
      if (isEdit && evento) {
        // Trocou de agenda? Move primeiro (events.move), depois aplica o resto.
        const destino = calId || evento.calendarId;
        if (destino !== evento.calendarId) {
          await moverParaAgenda(token, evento.calendarId, evento.id, destino);
        }
        await editarEvento(token, destino, evento.id, { titulo: titulo.trim(), allDay: semHora, inicio: ini, fim: f });
      } else {
        await criarEvento(token, calId, { titulo: titulo.trim(), allDay: semHora, inicio: ini, fim: f, pin: isPin });
      }
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!evento) return;
    if (!window.confirm("Excluir este evento? Ele será removido do Google Calendar.")) return;
    setErro("");
    setSalvando(true);
    try {
      await excluirEvento(token, evento.calendarId, evento.id);
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir.");
      setSalvando(false);
    }
  }

  const tituloModal = isEdit ? "Editar evento" : isPin ? "📌 Novo pin" : "Novo evento";
  // No modo edição, o nome da agenda pode não estar em `agendas` (gravaveis) —
  // mostra um fallback legível.
  const agendaNome = agendas.find((a) => a.id === calId)?.summary || evento?.calendarId || "";

  return (
    <Modal title={tituloModal} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Título *" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus
          placeholder={isPin ? "Ex: Lembrar de…" : "Ex: Reunião com…"} />
        {evento?.recorrente && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            🔁 Evento recorrente — as alterações valem só pra <strong>esta ocorrência</strong>.
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Agenda{isEdit ? "" : " *"}</label>
          {/* Em edição, se a agenda atual não está na lista gravável (caso raro)
              ou se é recorrente, trava com texto; senão deixa trocar de agenda. */}
          {isEdit && (evento?.recorrente || !agendas.some((a) => a.id === calId)) ? (
            <div className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 truncate">{agendaNome}</div>
          ) : (
            <select value={calId} onChange={(e) => setCalId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              {agendas.map((a) => (<option key={a.id} value={a.id}>{a.summary}</option>))}
            </select>
          )}
        </div>
        <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        {!semHora && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Início *</label>
              <TimeInput value={inicio} onChange={setInicio} placeholder="HH:MM" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fim *</label>
              <TimeInput value={fim} onChange={setFim} placeholder="HH:MM" />
            </div>
          </div>
        )}
        {semHora && !isEdit && <p className="text-[11px] text-gray-500 dark:text-gray-400">📌 Pin é um marcador do dia — não bloqueia horário.</p>}
        {erro && <div className="text-xs text-red-600 dark:text-red-400">{erro}</div>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {isEdit
            ? <Button variant="danger" onClick={excluir} disabled={salvando}>Excluir</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : isEdit ? "Salvar" : isPin ? "Criar pin" : "Criar evento"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
