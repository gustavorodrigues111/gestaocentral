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
type PEvent = { id: string; color: string; title: string; start: Date; end: Date; allDay: boolean };
async function listEvents(
  token: string,
  agendas: Agenda[],
  timeMin: Date,
  timeMax: Date,
  onUnauthorized: () => void,
): Promise<PEvent[]> {
  const out: PEvent[] = [];
  await Promise.all(agendas.map(async (cal) => {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`);
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { onUnauthorized(); return; }
    if (!res.ok) return;
    const data = await res.json() as {
      items?: Array<{ id: string; summary?: string; status?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }>;
    };
    for (const ev of (data.items || [])) {
      if (ev.status === "cancelled" || !ev.start) continue;
      const allDay = !!ev.start.date;
      const start = allDay ? parseDateOnly(ev.start.date!) : new Date(ev.start.dateTime!);
      const end = allDay ? parseDateOnly(ev.end?.date || ev.start.date!) : new Date(ev.end?.dateTime || ev.start.dateTime!);
      out.push({ id: ev.id, color: cal.cor, title: ev.summary || "(sem título)", start, end, allDay });
    }
  }));
  return out;
}
function useEventos(conn: Conn, agendas: Agenda[], timeMin: Date, timeMax: Date, refresh: number) {
  const [eventos, setEventos] = useState<PEvent[]>([]);
  const [carregando, setCarregando] = useState(false);
  const minISO = timeMin.toISOString();
  const maxISO = timeMax.toISOString();
  const chave = agendas.map((a) => `${a.id}:${a.cor}`).join(",");

  useEffect(() => {
    if (!conn.token || agendas.length === 0) { setEventos([]); return; }
    let vivo = true;
    setCarregando(true);
    listEvents(conn.token, agendas, new Date(minISO), new Date(maxISO), conn.invalidar)
      .then((evs) => { if (vivo) setEventos(evs); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.token, chave, minISO, maxISO, refresh]);

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

// ─── Datas ──────────────────────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
function ymd(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date): Date { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
function parseDateOnly(s: string): Date { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); }
function fmtHora(d: Date): string { const h = d.getHours(), m = d.getMinutes(); return m ? `${h}h${pad2(m)}` : `${h}h`; }
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

      {alvo === "semana" && <SemanaView conn={conn} agendas={visiveis} refresh={refresh} />}
      {alvo === "mes" && <MesView conn={conn} agendas={visiveis} refresh={refresh} />}
      {alvo === "tri" && <EmBreve titulo="Trimestre" desc="Grade de semanas × dias, com janelas livres." />}
      {alvo === "ano" && <EmBreve titulo="Ano (fita)" desc="12 faixas de meses; cada dia uma célula." />}
      {alvo === "kanban" && <EmBreve titulo="Kanban" desc="Colunas = fases dos projetos; arrastar muda a fase." />}
      {alvo === "crono" && <EmBreve titulo="Cronograma" desc="Barras por duração, swimlanes por agenda." />}

      {conn.token && agendas.length > 0 && <AgendasManager agendas={agendas} setPref={setPref} />}

      {criar && conn.token && (
        <CriarEventoModal
          modo={criar}
          token={conn.token}
          agendas={gravaveis}
          onClose={() => setCriar(null)}
          onCreated={() => { setCriar(null); setRefresh((r) => r + 1); }}
        />
      )}
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
            <span className={`${a.oculta ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-200"} max-w-[180px] truncate`}>{a.summary}</span>
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
function SemanaView({ conn, agendas, refresh }: { conn: Conn; agendas: Agenda[]; refresh: number }) {
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const { eventos, carregando } = useEventos(conn, agendas, weekStart, weekEnd, refresh);
  const hoje = new Date();
  const hojeIdx = (hoje.getDay() + 6) % 7;

  if (!conn.token) return <PrecisaConectar />;

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
  h0 = Math.max(0, Math.min(h0, hoje.getHours()));        // inclui a hora atual
  h1 = Math.min(23, Math.max(h1, hoje.getHours() + 1));
  if (h1 <= h0) h1 = Math.min(23, h0 + 1);

  const totH = (h1 - h0 + 1) * PX;
  const horas = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Semana · {weekStart.getDate()}–{addDays(weekStart, 6).getDate()} {MESES[addDays(weekStart, 6).getMonth()].slice(0, 3)}
        </h2>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "linha vermelha = agora"}</span>
      </div>
      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
        <div className="max-h-[600px] overflow-y-auto">
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
                      <div key={ev.id} className="text-[9.5px] px-1.5 py-0.5 rounded truncate text-white" style={{ background: ev.color }} title={ev.title}>{ev.title}</div>
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
            <div className="grid grid-cols-7 flex-1">
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
                      <div key={ev.id} className="absolute left-[3px] right-[3px] rounded-md text-white text-[9.5px] leading-tight px-1.5 py-1 overflow-hidden shadow-sm"
                        style={{ background: ev.color, top: (ini - h0) * PX, height: altura }} title={ev.title}>
                        <div style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: linhas, overflow: "hidden", wordBreak: "break-word" }}>
                          <span className="font-bold text-[9px] opacity-90">{fmtHora(ev.start)}</span> {ev.title}
                        </div>
                      </div>
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
    </section>
  );
}

// ─── Visão MÊS ──────────────────────────────────────────────────────────────
function MesView({ conn, agendas, refresh }: { conn: Conn; agendas: Agenda[]; refresh: number }) {
  const hoje = new Date();
  const monthStart = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42);
  const { eventos, carregando } = useEventos(conn, agendas, gridStart, gridEnd, refresh);

  if (!conn.token) return <PrecisaConectar />;

  const celulas = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const porDia = new Map<string, PEvent[]>();
  const push = (k: string, ev: PEvent) => { const arr = porDia.get(k); if (arr) arr.push(ev); else porDia.set(k, [ev]); };
  for (const ev of eventos) {
    if (ev.allDay) { for (let d = startOfDay(ev.start); d < startOfDay(ev.end); d = addDays(d, 1)) push(ymd(d), ev); }
    else push(ymd(ev.start), ev);
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 capitalize">{MESES[hoje.getMonth()]} {hoje.getFullYear()}</h2>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "sua agenda do mês"}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (<div key={d} className="text-[9.5px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold px-1 pb-0.5">{d}</div>))}
        {celulas.map((d, i) => {
          const noMes = d.getMonth() === hoje.getMonth();
          const isHoje = ymd(d) === ymd(hoje);
          const evs = (porDia.get(ymd(d)) || []).sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.start.getTime() - b.start.getTime());
          return (
            <div key={i} className={`min-h-[92px] rounded-xl border p-1.5 relative ${
              noMes ? "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800" : "bg-transparent border-dashed border-gray-200 dark:border-gray-800 opacity-50"
            } ${isHoje ? "ring-2 ring-indigo-200 dark:ring-indigo-800 border-indigo-400" : ""}`}>
              <div className={`text-[12.5px] font-semibold ${isHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400"}`}>{d.getDate()}</div>
              {evs.slice(0, 3).map((ev) => (
                <div key={ev.id} className="mt-1 text-[10px] px-1.5 py-0.5 rounded text-white truncate" style={{ background: ev.color }} title={ev.title}>
                  {ev.allDay ? ev.title : `${fmtHora(ev.start)} ${ev.title}`}
                </div>
              ))}
              {evs.length > 3 && <div className="mt-1 text-[10px] text-gray-400 px-1.5">+{evs.length - 3}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Modal: criar evento / pin ──────────────────────────────────────────────
function CriarEventoModal({ modo, token, agendas, onClose, onCreated }: {
  modo: "evento" | "pin";
  token: string;
  agendas: Agenda[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const isPin = modo === "pin";
  const [titulo, setTitulo] = useState("");
  const [calId, setCalId] = useState(agendas[0]?.id || "");
  const [data, setData] = useState(ymd(new Date()));
  const [inicio, setInicio] = useState("09:00");
  const [fim, setFim] = useState("10:00");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro("");
    if (!titulo.trim()) { setErro("Dê um título."); return; }
    if (!calId) { setErro("Escolha uma agenda."); return; }
    setSalvando(true);
    try {
      const [y, m, d] = data.split("-").map(Number);
      if (isPin) {
        await criarEvento(token, calId, { titulo: titulo.trim(), allDay: true, inicio: new Date(y, m - 1, d), fim: new Date(y, m - 1, d), pin: true });
      } else {
        const [hi, mi] = inicio.split(":").map(Number);
        const [hf, mf] = fim.split(":").map(Number);
        const ini = new Date(y, m - 1, d, hi || 0, mi || 0);
        let f = new Date(y, m - 1, d, hf || 0, mf || 0);
        if (f <= ini) f = new Date(ini.getTime() + 30 * 60000);
        await criarEvento(token, calId, { titulo: titulo.trim(), allDay: false, inicio: ini, fim: f });
      }
      onCreated();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title={isPin ? "📌 Novo pin" : "Novo evento"} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Título *" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus
          placeholder={isPin ? "Ex: Lembrar de…" : "Ex: Reunião com…"} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Agenda *</label>
          <select value={calId} onChange={(e) => setCalId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            {agendas.map((a) => (<option key={a.id} value={a.id}>{a.summary}</option>))}
          </select>
        </div>
        <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        {!isPin && (
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
        {isPin && <p className="text-[11px] text-gray-500 dark:text-gray-400">📌 Pin é um marcador do dia — não bloqueia horário.</p>}
        {erro && <div className="text-xs text-red-600 dark:text-red-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Criando…" : isPin ? "Criar pin" : "Criar evento"}</Button>
        </div>
      </div>
    </Modal>
  );
}
