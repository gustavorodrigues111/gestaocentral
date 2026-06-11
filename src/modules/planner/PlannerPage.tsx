// ════════════════════════════════════════════════════════════════════════════
//  Planner — planejamento pessoal do Gustavo (single-user).
//
//  ⚠️ MÓDULO PESSOAL: só monta pro master (gate). Fora do escopo de restaurante
//  (rota de topo /planner).
//
//  Conexão Google = direto do navegador (Google Identity Services). O browser
//  pega um access token e fala com a Calendar API. As views Semana/Mês mostram
//  os EVENTOS REAIS da sua agenda. (Org policies do Workspace bloqueiam o
//  caminho server-side — ver memory/project_planner_backend.md.)
//
//  Navegação em 2 níveis: Calendário (Semana·Mês·Trimestre·Ano) / Kanban /
//  Cronograma. Padrão: Calendário → Semana.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";

const GOOGLE_CLIENT_ID = "777358299957-ojakrj15eaefgr8s6vmsrnj9p5nm8aca.apps.googleusercontent.com";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const TOKEN_KEY = "plannerGoogleToken";

type TipoVista = "calendario" | "kanban" | "crono";
type Periodo = "semana" | "mes" | "tri" | "ano";

// ─── Google Identity Services (token no browser) ────────────────────────────
type GsiTokenResponse = { access_token?: string; expires_in?: number; error?: string };
type GsiTokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
type GCal = { id: string; summary: string; primary?: boolean; backgroundColor?: string };

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

// Hook de conexão — UMA instância no PlannerPage, compartilhada com as views.
type Conn = {
  gsiReady: boolean;
  token: string | null;
  calendars: GCal[];
  carregando: boolean;
  erro: string | null;
  conectar: () => void;
  invalidar: () => void; // chamado em 401
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
      const data = await res.json() as { items?: Array<{ id: string; summary?: string; primary?: boolean; backgroundColor?: string }> };
      setCalendars((data.items || []).map((c) => ({
        id: c.id, summary: c.summary || c.id, primary: c.primary, backgroundColor: c.backgroundColor,
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

  // Restaura do localStorage no mount (sobrevive a navegar e voltar).
  useEffect(() => {
    const t = tokenValidoSalvo();
    if (t) { setToken(t); void carregarCalendarios(t); }
  }, [carregarCalendarios]);

  return { gsiReady, token, calendars, carregando, erro, conectar, invalidar };
}

// ─── Eventos (events.list por agenda) ───────────────────────────────────────
type PEvent = {
  id: string;
  color: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
};
async function listEvents(
  token: string,
  calendars: GCal[],
  timeMin: Date,
  timeMax: Date,
  onUnauthorized: () => void,
): Promise<PEvent[]> {
  const out: PEvent[] = [];
  await Promise.all(calendars.map(async (cal) => {
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
      items?: Array<{
        id: string; summary?: string; status?: string;
        start?: { date?: string; dateTime?: string };
        end?: { date?: string; dateTime?: string };
      }>;
    };
    for (const ev of (data.items || [])) {
      if (ev.status === "cancelled" || !ev.start) continue;
      const allDay = !!ev.start.date;
      const start = allDay ? parseDateOnly(ev.start.date!) : new Date(ev.start.dateTime!);
      const end = allDay
        ? parseDateOnly(ev.end?.date || ev.start.date!)
        : new Date(ev.end?.dateTime || ev.start.dateTime!);
      out.push({
        id: ev.id,
        color: cal.backgroundColor || "#6a5ae0",
        title: ev.summary || "(sem título)",
        start, end, allDay,
      });
    }
  }));
  return out;
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
  const { pessoa } = useAuth();
  const conn = useGoogleConn();
  const [vista, setVista] = useState<TipoVista>("calendario");
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [reviewOpen, setReviewOpen] = useState(false);

  if (!pessoa?.isMaster) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-medium text-gray-700 dark:text-gray-200">Planner é pessoal</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Este módulo é privado do dono da conta.</p>
      </div>
    );
  }

  const alvo: TipoVista | Periodo = vista === "calendario" ? periodo : vista;

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🗓 Planner</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">Pessoal · sua agenda do Google</p>
      </div>

      <GoogleConnectBar conn={conn} />

      <ReviewBand open={reviewOpen} onToggle={() => setReviewOpen((v) => !v)} />

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="inline-flex gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-1 rounded-xl">
          <NavBtn ativo={vista === "calendario"} onClick={() => setVista("calendario")}>🗓 Calendário</NavBtn>
          <NavBtn ativo={vista === "kanban"} onClick={() => setVista("kanban")}>🗂 Kanban</NavBtn>
          <NavBtn ativo={vista === "crono"} onClick={() => setVista("crono")}>📈 Cronograma</NavBtn>
        </div>
        {vista === "calendario" && (
          <div className="inline-flex gap-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-1 rounded-xl">
            <PerBtn ativo={periodo === "semana"} onClick={() => setPeriodo("semana")}>📆 Semana</PerBtn>
            <PerBtn ativo={periodo === "mes"} onClick={() => setPeriodo("mes")}>🗓 Mês</PerBtn>
            <PerBtn ativo={periodo === "tri"} onClick={() => setPeriodo("tri")}>📊 Trimestre</PerBtn>
            <PerBtn ativo={periodo === "ano"} onClick={() => setPeriodo("ano")}>📅 Ano</PerBtn>
          </div>
        )}
      </div>

      {alvo === "semana" && <SemanaView conn={conn} />}
      {alvo === "mes" && <MesView conn={conn} />}
      {alvo === "tri" && <EmBreve titulo="Trimestre" desc="Grade de semanas × dias, com janelas livres." />}
      {alvo === "ano" && <EmBreve titulo="Ano (fita)" desc="12 faixas de meses; cada dia uma célula." />}
      {alvo === "kanban" && <EmBreve titulo="Kanban" desc="Colunas = fases dos projetos; arrastar muda a fase." />}
      {alvo === "crono" && <EmBreve titulo="Cronograma" desc="Barras por duração, swimlanes por agenda." />}
    </div>
  );
}

// ─── Hook de eventos por intervalo (usado pelas views) ──────────────────────
function useEventos(conn: Conn, timeMin: Date, timeMax: Date) {
  const [eventos, setEventos] = useState<PEvent[]>([]);
  const [carregando, setCarregando] = useState(false);
  const minISO = timeMin.toISOString();
  const maxISO = timeMax.toISOString();
  const calIds = conn.calendars.map((c) => c.id).join(",");

  useEffect(() => {
    if (!conn.token || conn.calendars.length === 0) { setEventos([]); return; }
    let vivo = true;
    setCarregando(true);
    listEvents(conn.token, conn.calendars, new Date(minISO), new Date(maxISO), conn.invalidar)
      .then((evs) => { if (vivo) setEventos(evs); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.token, calIds, minISO, maxISO]);

  return { eventos, carregando };
}

// ─── Barra de conexão (presentational) ──────────────────────────────────────
function GoogleConnectBar({ conn }: { conn: Conn }) {
  const connected = !!conn.token;
  return (
    <div className={`mb-4 rounded-xl border p-3 ${
      connected
        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15"
        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    }`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          {connected ? (
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              ✓ Google conectado{conn.calendars.length ? ` · ${conn.calendars.length} agenda(s)` : ""}
            </span>
          ) : (
            <span className="text-gray-600 dark:text-gray-300">Conecte sua conta Google pra ver sua agenda de verdade.</span>
          )}
          {conn.erro && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">⚠️ {conn.erro}</div>}
        </div>
        <button
          type="button"
          onClick={conn.conectar}
          disabled={!conn.gsiReady || conn.carregando}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
        >
          {conn.carregando ? "Carregando…" : connected ? "Reconectar" : "🔗 Conectar Google"}
        </button>
      </div>
      {connected && conn.calendars.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {conn.calendars.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
              <span className="w-2 h-2 rounded-full" style={{ background: c.backgroundColor || "#9aa" }} />
              {c.summary}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Navegação ──────────────────────────────────────────────────────────────
function NavBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
        ativo ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}>{children}</button>
  );
}
function PerBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
        ativo ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      }`}>{children}</button>
  );
}

// ─── Faixa "Para revisar" (placeholder — detector/automações vêm depois) ────
function ReviewBand({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1.5 mb-4">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
        📥 Para revisar
        <span className="font-normal text-gray-400">detector de janelas e automações — em breve</span>
        <span className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-[12px] text-gray-500 dark:text-gray-400">
          Aqui vão aparecer janelas livres detectadas e itens capturados por automação (Gmail) pra você aprovar. Ainda não ligado.
        </div>
      )}
    </div>
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

// ─── Visão SEMANA (grade de horas, eventos reais) ───────────────────────────
const H0 = 0, H1 = 23, PX = 44;
function SemanaView({ conn }: { conn: Conn }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const { eventos, carregando } = useEventos(conn, weekStart, weekEnd);
  const hoje = new Date();
  const hojeIdx = (hoje.getDay() + 6) % 7;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (hoje.getHours() - 1)) * PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!conn.token) return <PrecisaConectar />;

  const dias = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const totH = (H1 - H0 + 1) * PX;
  const horas = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);

  // separa por dia: timados (na grade) e dia-todo (na faixa de cima)
  const timadosPorDia: PEvent[][] = dias.map(() => []);
  const alldayPorDia: PEvent[][] = dias.map(() => []);
  for (const ev of eventos) {
    if (ev.allDay) {
      // all-day end é exclusivo; marca cada dia coberto dentro da semana
      for (let i = 0; i < 7; i++) {
        const d = dias[i];
        if (d >= startOfDay(ev.start) && d < startOfDay(ev.end)) alldayPorDia[i].push(ev);
      }
    } else {
      const idx = dias.findIndex((d) => ymd(d) === ymd(ev.start));
      if (idx >= 0) timadosPorDia[idx].push(ev);
    }
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Semana · {weekStart.getDate()}–{addDays(weekStart, 6).getDate()} {MESES[addDays(weekStart, 6).getMonth()].slice(0, 3)}
        </h2>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{carregando ? "carregando…" : "linha vermelha = agora"}</span>
      </div>

      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
        <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
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
                <div key={i}
                  className={`relative border-l border-gray-200 dark:border-gray-800 ${i === hojeIdx ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}`}
                  style={{ height: totH, backgroundImage: "repeating-linear-gradient(to bottom,transparent,transparent 43px,rgba(0,0,0,.06) 43px,rgba(0,0,0,.06) 44px)" }}>
                  {timadosPorDia[i].map((ev) => {
                    const ini = ev.start.getHours() + ev.start.getMinutes() / 60;
                    let fim = ev.end.getHours() + ev.end.getMinutes() / 60;
                    if (fim <= ini) fim = ini + 0.5;
                    const top = (ini - H0) * PX;
                    const height = Math.max(16, (fim - ini) * PX - 3);
                    return (
                      <div key={ev.id} className="absolute left-[3px] right-[3px] rounded-md text-white text-[9.5px] leading-tight px-1.5 py-1 overflow-hidden shadow-sm" style={{ background: ev.color, top, height }} title={ev.title}>
                        <span className="font-bold text-[9px] opacity-90">{fmtHora(ev.start)}</span> {ev.title}
                      </div>
                    );
                  })}
                  {i === hojeIdx && (
                    <div className="absolute left-0 right-0 h-0.5 bg-rose-500 z-10" style={{ top: (hoje.getHours() + hoje.getMinutes() / 60 - H0) * PX }}>
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

// ─── Visão MÊS (eventos reais) ──────────────────────────────────────────────
function MesView({ conn }: { conn: Conn }) {
  const hoje = new Date();
  const monthStart = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42); // 6 semanas
  const { eventos, carregando } = useEventos(conn, gridStart, gridEnd);

  if (!conn.token) return <PrecisaConectar />;

  const celulas = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // eventos por dia (YYYY-MM-DD do início; all-day cobre cada dia)
  const porDia = new Map<string, PEvent[]>();
  for (const ev of eventos) {
    if (ev.allDay) {
      for (let d = startOfDay(ev.start); d < startOfDay(ev.end); d = addDays(d, 1)) {
        const k = ymd(d); (porDia.get(k) || porDia.set(k, []).get(k)!).push(ev);
      }
    } else {
      const k = ymd(ev.start); (porDia.get(k) || porDia.set(k, []).get(k)!).push(ev);
    }
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
