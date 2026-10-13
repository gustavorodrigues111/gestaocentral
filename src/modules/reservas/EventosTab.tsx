// Aba "Eventos" do módulo Reservas — eventos especiais (jantar pago etc.).
// Reservas do evento são lançadas pela EQUIPE (ReservaModal com bloco de
// pagamento + comprovante). Pasta do Drive por evento (conta central, subpasta
// de uma pasta-raiz indicada pelo usuário).
import { useEffect, useMemo, useState } from "react";
import { CalendarHeart, Plus, Settings, Trash2, X, Check, ChevronLeft, FolderOpen, CalendarDays, Link2, Armchair, Wine, RefreshCw, Ban, Users } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { fmtBR } from "../../core/utils/date";
import { reservaMesaIds, reservaMesasNomes } from "../../core/reservas/mesas";
import { centralConfigured, centralEnsureFolder, parseDriveFolderId } from "../../core/google/driveCentral";
import type { Mesa, Reserva, ReservaEvento, ReservaEventoConfig, Salao } from "../../core/types";
import { ouvirEventos, salvarEvento, excluirEvento, ouvirEventoConfig, salvarEventoConfig, atualizarMesasBloqueadas, atualizarMesasExtras } from "./eventosRepo";

const uid = () => { try { return crypto.randomUUID(); } catch { return "ev" + Date.now() + Math.random().toString(36).slice(2); } };
const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const fmtCents = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodoTxt = (e: ReservaEvento) => e.dataFim && e.dataFim !== e.dataInicio ? `${fmtBR(e.dataInicio)} – ${fmtBR(e.dataFim)}` : fmtBR(e.dataInicio);
// "há 3 min" / "há 2 h" / "agora" — freshness do painel do evento.
const tempoRel = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "agora";
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
};

// Card de estatística do dashboard do evento.
function Stat({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "muted" | "emerald" | "amber" | "indigo" | "rose" | "violet" }) {
  const toneCls: Record<string, string> = {
    default: "text-gray-900 dark:text-gray-100",
    muted: "text-gray-400 dark:text-gray-500",
    emerald: "text-emerald-600 dark:text-emerald-300",
    amber: "text-amber-600 dark:text-amber-300",
    indigo: "text-indigo-600 dark:text-indigo-300",
    rose: "text-rose-600 dark:text-rose-300",
    violet: "text-violet-600 dark:text-violet-300",
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight ${toneCls[tone]}`}>{value}</div>
      {hint && <div className="text-[10px] text-gray-400 truncate">{hint}</div>}
    </div>
  );
}
// Mesa(s) da reserva, com altura (alta/baixa) pelo cadastro atual quando
// a mesa ainda existe; senão cai no nome do snapshot (sem altura).
// Nº da mesa pra ordenação (menor→maior); sem número vai pro fim.
const mesaNum = (s: string): number => { const m = (s || "").match(/\d+/); return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER; };
function mesasDaReserva(r: Reserva, mesas: Mesa[]): { label: string; alta: boolean; num: number }[] {
  const ids = reservaMesaIds(r);
  const nomes = reservaMesasNomes(r);
  const n = Math.max(ids.length, nomes.length);
  if (!n) return [];
  const out: { label: string; alta: boolean; num: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = ids[i] ? mesas.find((x) => x.id === ids[i]) : undefined;
    const nome = m?.nome ?? nomes[i] ?? "";
    out.push({ label: nome ? nome.replace(/^mesa\s+/i, "Nº ") : "—", alta: m?.tipoMesa === "alta", num: mesaNum(nome) });
  }
  // Mesas juntas numa reserva: sempre do menor pro maior número.
  out.sort((a, b) => a.num - b.num || a.label.localeCompare(b.label));
  return out;
}
// Menor número de mesa da reserva (pra ordenar as linhas). Sem mesa vai pro fim.
const reservaMesaMin = (r: Reserva, mesas: Mesa[]): number => {
  const ms = mesasDaReserva(r, mesas);
  return ms.length ? ms[0].num : Number.MAX_SAFE_INTEGER;
};

// Chips de mesa com ícone de altura (🍸 alta / 🪑 baixa).
function MesaTags({ r, mesas }: { r: Reserva; mesas: Mesa[] }) {
  const items = mesasDaReserva(r, mesas);
  if (!items.length) return <>—</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
          {it.alta ? <Wine size={12} className="text-indigo-500" /> : <Armchair size={12} className="text-gray-400" />}
          {it.label}
        </span>
      ))}
    </span>
  );
}

export function EventosTab({ rid, reservas, mesas, saloes, carregando, podeEditar, onNovaReserva, onEditarReserva, onVincular }: {
  rid: string; reservas: Reserva[]; mesas: Mesa[]; saloes: Salao[]; carregando?: boolean; podeEditar: boolean;
  onNovaReserva: (ev: ReservaEvento) => void;
  onEditarReserva: (r: Reserva, ev: ReservaEvento) => void;
  onVincular: (r: Reserva, ev: ReservaEvento) => void;
}) {
  const [eventos, setEventos] = useState<ReservaEvento[]>([]);
  const [cfg, setCfg] = useState<ReservaEventoConfig | null>(null);
  const [central, setCentral] = useState<boolean | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ ev?: ReservaEvento } | null>(null);

  useEffect(() => ouvirEventos(rid, setEventos), [rid]);
  useEffect(() => ouvirEventoConfig(rid, setCfg), [rid]);
  useEffect(() => { centralConfigured().then(setCentral).catch(() => setCentral(false)); }, []);

  const sel = eventos.find((e) => e.id === selId) || null;
  const reservasDoEvento = useMemo(() => (ev: string) => reservas.filter((r) => r.eventoId === ev), [reservas]);
  // Reservas NORMAIS que caem na(s) data(s) do evento e ainda não estão vinculadas — pra "puxar pra dentro".
  const candidatasDoEvento = useMemo(() => (ev: ReservaEvento) => reservas.filter((r) =>
    !r.eventoId && r.status !== "cancelada" && r.data >= ev.dataInicio && r.data <= (ev.dataFim || ev.dataInicio)), [reservas]);

  function totais(evId: string) {
    const rs = reservas.filter((r) => r.eventoId === evId && r.status !== "cancelada");
    let recebido = 0, pendente = 0;
    for (const r of rs) { const v = r.pagamento?.valor || 0; if (r.pagamento?.pago) recebido += v; else pendente += v; }
    return { n: rs.length, recebido, pendente };
  }

  return (
    <>
      {sel ? (
        <PainelEvento ev={sel} reservas={reservasDoEvento(sel.id)} candidatas={candidatasDoEvento(sel)} mesas={mesas} saloes={saloes} carregando={carregando} podeEditar={podeEditar} onVoltar={() => setSelId(null)} onNovaReserva={onNovaReserva} onEditarReserva={onEditarReserva} onVincular={onVincular} onEditarEvento={() => setModal({ ev: sel })} />
      ) : (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[13px] text-gray-600 dark:text-gray-300 inline-flex items-center gap-1.5"><CalendarHeart size={15} className="text-indigo-500" /> Eventos próprios — datas especiais com reservas pagas, lançadas pela equipe.</div>
        <div className="flex-1" />
        {podeEditar && <button onClick={() => setModal({})} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Novo evento</button>}
      </div>

      {eventos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <CalendarHeart size={38} className="mx-auto text-gray-300 mb-2" />
          <div className="font-semibold text-gray-700 dark:text-gray-300">Nenhum evento ainda</div>
          <div className="text-sm text-gray-500 mt-1">Crie um evento (ex.: "Jantar harmonizado") pra lançar reservas com pagamento.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {eventos.map((e) => {
            const t = totais(e.id);
            return (
              <button key={e.id} onClick={() => setSelId(e.id)} className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                <div className="font-extrabold text-[15px]">{e.nome}</div>
                <div className="text-[12px] text-gray-500 inline-flex items-center gap-1 mt-0.5"><CalendarDays size={12} /> {periodoTxt(e)}{e.horarioPadrao ? ` · ${e.horarioPadrao}` : ""}</div>
                {e.valorPorPessoa ? <div className="text-[12px] text-gray-500 mt-0.5">{fmtR(e.valorPorPessoa)}/pessoa</div> : null}
                <div className="flex items-center gap-3 mt-2 text-[12px]">
                  <span className="text-gray-600 dark:text-gray-300">{t.n} reserva(s)</span>
                  <span className="text-emerald-600 font-semibold">{fmtR(t.recebido)} recebido</span>
                  {t.pendente > 0 && <span className="text-amber-600">{fmtR(t.pendente)} pendente</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
      )}

      {modal && <EventoModal rid={rid} ev={modal.ev} central={central} cfg={cfg} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); setSelId(id); }} />}
    </>
  );
}

function PainelEvento({ ev, reservas, candidatas, mesas, saloes, carregando, podeEditar, onVoltar, onNovaReserva, onEditarReserva, onVincular, onEditarEvento }: {
  ev: ReservaEvento; reservas: Reserva[]; candidatas: Reserva[]; mesas: Mesa[]; saloes: Salao[]; carregando?: boolean; podeEditar: boolean; onVoltar: () => void;
  onNovaReserva: (ev: ReservaEvento) => void; onEditarReserva: (r: Reserva, ev: ReservaEvento) => void; onVincular: (r: Reserva, ev: ReservaEvento) => void; onEditarEvento: () => void;
}) {
  // ── Snapshot local (Task 3): pinta na hora com a última atualização
  // conhecida enquanto o Firestore ainda carrega. Guarda só o timestamp no
  // localStorage (sem PII); os dados vêm do cache do Firestore (cache-first).
  const tsKey = `ev_ts_${ev.id}`;
  const [ultAtualiz, setUltAtualiz] = useState<number | null>(() => {
    try { const s = localStorage.getItem(tsKey); return s ? parseInt(s, 10) : null; } catch { return null; }
  });
  useEffect(() => {
    if (carregando) return;
    const now = Date.now();
    setUltAtualiz(now);
    try { localStorage.setItem(tsKey, String(now)); } catch { /* private mode */ }
  }, [carregando, reservas, tsKey]);

  const ordenadas = [...reservas].sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  const candOrd = [...candidatas].sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));

  // Mesas EXTRA do evento viram "Mesa" (sempre ativas) pra fluir no pool.
  const extras = useMemo<Mesa[]>(() => (ev.mesasExtras || []).map((e) => ({
    id: e.id, restaurantId: ev.restaurantId, nome: e.nome, capacidade: e.capacidade,
    tipoMesa: e.tipoMesa, salaoId: e.salaoId ?? undefined, ativa: true, ordem: 9999,
  })), [ev.mesasExtras, ev.restaurantId]);
  const extrasIds = useMemo(() => new Set(extras.map((e) => e.id)), [extras]);
  // Pool pra exibir nº da mesa (inclui inativas + extras).
  const mesasComExtras = useMemo(() => [...mesas, ...extras], [mesas, extras]);

  // Canceladas saem dos salões e vão pra um bloco separado no fim.
  const canceladas = useMemo(() => ordenadas.filter((r) => r.status === "cancelada"), [ordenadas]);
  // Salões do restaurante + os criados só pra este evento (ordem alta → por último).
  const salById = useMemo(() => {
    const m = new Map<string, { id: string; nome: string; ordem?: number }>();
    for (const s of saloes) m.set(s.id, s);
    for (const s of (ev.saloesExtras || [])) m.set(s.id, { id: s.id, nome: s.nome, ordem: 9000 });
    return m;
  }, [saloes, ev.saloesExtras]);
  const coletivasIds = useMemo(() => new Set((ev.mesasExtras || []).filter((e) => e.coletiva).map((e) => e.id)), [ev.mesasExtras]);
  const gruposReservas = useMemo(() => {
    const m = new Map<string, Reserva[]>();
    for (const r of ordenadas) {
      if (r.status === "cancelada") continue;   // canceladas vão pro bloco próprio
      const ids = reservaMesaIds(r);
      const mesa = ids.length ? mesasComExtras.find((x) => x.id === ids[0]) : undefined;
      const key = mesa?.salaoId || "__none__";
      const arr = m.get(key); if (arr) arr.push(r); else m.set(key, [r]);
    }
    const keys = [...m.keys()].sort((a, b) => {
      if (a === "__none__") return 1; if (b === "__none__") return -1;
      return (salById.get(a)?.ordem ?? 999) - (salById.get(b)?.ordem ?? 999);
    });
    // Dentro de cada salão, ordena as reservas pelo MENOR nº de mesa (menor→maior).
    return keys.map((k) => ({
      salao: k === "__none__" ? undefined : salById.get(k),
      reservas: m.get(k)!.slice().sort((a, b) =>
        reservaMesaMin(a, mesas) - reservaMesaMin(b, mesas) ||
        (a.data + a.horario).localeCompare(b.data + b.horario)),
    }));
  }, [ordenadas, mesasComExtras, salById]);

  // ── Dashboard do evento (Task 2) ────────────────────────────────────
  const ativas = reservas.filter((r) => r.status !== "cancelada");
  const mesasAtivas = useMemo(() => [...mesas.filter((m) => m.ativa), ...extras], [mesas, extras]);
  const usadas = new Set<string>();
  for (const r of ativas) for (const id of reservaMesaIds(r)) usadas.add(id);
  // Mesas bloqueadas NESTE evento (layout/restrições).
  const bloqueadas = useMemo(() => new Set(ev.mesasBloqueadas || []), [ev.mesasBloqueadas]);
  const mesasBloqueadas = mesasAtivas.filter((m) => bloqueadas.has(m.id) && !usadas.has(m.id)).sort((a, b) => mesaNum(a.nome) - mesaNum(b.nome) || a.nome.localeCompare(b.nome));
  // Coletiva (comunitária) continua "disponível" mesmo com reserva — aceita mais.
  const mesasLivres = mesasAtivas.filter((m) => (!usadas.has(m.id) || coletivasIds.has(m.id)) && !bloqueadas.has(m.id)).sort((a, b) => mesaNum(a.nome) - mesaNum(b.nome) || a.nome.localeCompare(b.nome));
  async function toggleBloqueio(mesaId: string) {
    if (!podeEditar) return;
    const atual = ev.mesasBloqueadas || [];
    const next = atual.includes(mesaId) ? atual.filter((x) => x !== mesaId) : [...atual, mesaId];
    try { await atualizarMesasBloqueadas(ev.id, next); } catch (e) { console.error("[eventos] bloquear mesa", e); }
  }
  async function removerExtra(id: string) {
    if (!podeEditar) return;
    if (usadas.has(id) && !confirm("Essa mesa extra já tem reserva. Remover mesmo assim? (as reservas mantêm o nome no histórico)")) return;
    try { await atualizarMesasExtras(ev.id, (ev.mesasExtras || []).filter((e) => e.id !== id)); } catch (e) { console.error("[eventos] remover mesa extra", e); }
  }
  const [addMesaOpen, setAddMesaOpen] = useState(false);
  async function adicionarExtra(nova: { nome: string; capacidade: number; tipoMesa: "baixa" | "alta"; salaoId?: string | null; coletiva?: boolean; novoSalaoNome?: string }) {
    const id = "evx_" + uid();
    let salaoId = nova.salaoId ?? null;
    let saloesExtras = ev.saloesExtras || [];
    // Salão só do evento (quando o usuário cria um novo na hora).
    if (nova.novoSalaoNome && nova.novoSalaoNome.trim()) {
      const sid = "evs_" + uid();
      saloesExtras = [...saloesExtras, { id: sid, nome: nova.novoSalaoNome.trim() }];
      salaoId = sid;
    }
    const mesasExtras = [...(ev.mesasExtras || []), { id, nome: nova.nome, capacidade: nova.capacidade, tipoMesa: nova.tipoMesa, salaoId, coletiva: nova.coletiva || undefined }];
    try { await salvarEvento({ ...ev, mesasExtras, saloesExtras }); setAddMesaOpen(false); }
    catch (e) { console.error("[eventos] add mesa extra", e); }
  }
  // Mesas disponíveis agrupadas por salão (mesmas regras de ordem dos blocos).
  const gruposMesasLivres = useMemo(() => {
    const m = new Map<string, Mesa[]>();
    for (const mesa of mesasLivres) {
      const k = mesa.salaoId || "__none__";
      const arr = m.get(k); if (arr) arr.push(mesa); else m.set(k, [mesa]);
    }
    const keys = [...m.keys()].sort((a, b) => {
      if (a === "__none__") return 1; if (b === "__none__") return -1;
      return (salById.get(a)?.ordem ?? 999) - (salById.get(b)?.ordem ?? 999);
    });
    return keys.map((k) => ({ salao: k === "__none__" ? undefined : salById.get(k), mesas: m.get(k)! }));
  }, [mesasLivres, salById]);
  const lugaresTotais = mesasAtivas.reduce((s, m) => s + (m.capacidade || 0), 0);
  const lugaresLivres = mesasLivres.reduce((s, m) => s + (m.capacidade || 0), 0);
  const totalPessoas = ativas.reduce((s, r) => s + (r.pessoas || 0), 0);
  let recebido = 0, pendente = 0, descontos = 0, cortesias = 0, cortesiasValor = 0;
  for (const r of ativas) {
    const p = r.pagamento; if (!p) continue;
    // Cortesia: valor cedido = o que seria cobrado (pessoas × valor/pessoa).
    if (p.ajusteTipo === "cortesia") { cortesias++; cortesiasValor += (r.pessoas || 0) * (ev.valorPorPessoa || 0); }
    if (p.ajusteTipo === "desconto" && p.ajusteValor) descontos += p.ajusteValor;
    const v = p.valor || 0;
    if (p.pago) recebido += v; else pendente += v;
  }
  const potencial = lugaresLivres * (ev.valorPorPessoa || 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onVoltar} className="h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1"><ChevronLeft size={15} /> Eventos</button>
        <div className="min-w-0">
          <div className="font-extrabold text-[15px] truncate">{ev.nome}</div>
          <div className="text-[12px] text-gray-500 inline-flex items-center gap-1"><CalendarDays size={12} /> {periodoTxt(ev)}{ev.horarioPadrao ? ` · ${ev.horarioPadrao}` : ""}{ev.valorPorPessoa ? ` · ${fmtR(ev.valorPorPessoa)}/pessoa` : ""}</div>
        </div>
        <div className="flex-1" />
        {podeEditar && <button onClick={onEditarEvento} className="h-9 w-9 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500" title="Editar evento"><Settings size={16} /></button>}
        <button onClick={() => onNovaReserva(ev)} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Nova reserva</button>
      </div>

      {/* Dashboard do evento */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Reservas" value={String(ativas.length)} />
        <Stat label="Pessoas" value={String(totalPessoas)} />
        <Stat label="Recebido" value={fmtR(recebido)} tone="emerald" />
        <Stat label="Pendente" value={fmtR(pendente)} tone={pendente > 0 ? "amber" : "muted"} />
        <Stat label="Mesas livres" value={`${mesasLivres.length}/${mesasAtivas.length}`} hint={`${lugaresLivres}/${lugaresTotais} lugares`} />
        <Stat label="Potencial restante" value={fmtR(potencial)} tone="indigo" hint={ev.valorPorPessoa ? `${lugaresLivres} × ${fmtR(ev.valorPorPessoa)}` : "sem valor/pessoa"} />
        {descontos > 0 && <Stat label="Descontos" value={`− ${fmtR(descontos)}`} tone="rose" />}
        {cortesias > 0 && <Stat label="Cortesias" value={fmtR(cortesiasValor)} tone="violet" hint={`${cortesias} reserva(s)`} />}
      </div>

      <div className="flex items-center gap-3 text-[12px] text-gray-500 flex-wrap">
        {carregando
          ? <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300"><RefreshCw size={12} className="animate-spin" /> Atualizando…</span>
          : <span>Atualizado {ultAtualiz ? tempoRel(ultAtualiz) : "agora"}</span>}
        {!ev.pastaDriveId && <span className="text-amber-600 inline-flex items-center gap-1"><FolderOpen size={13} /> sem pasta do Drive — edite o evento</span>}
      </div>

      {gruposReservas.length === 0 && canceladas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-gray-400 text-sm">Nenhuma reserva nesse evento. Clique em "Nova reserva".</div>
      ) : (
        <div className="space-y-4">
          {gruposReservas.map((g, gi) => {
            const salaoNome = g.salao?.nome || "Sem mesa atribuída";
            const gPessoas = g.reservas.filter((r) => r.status !== "cancelada").reduce((s, r) => s + (r.pessoas || 0), 0);
            return (
              <div key={g.salao?.id || `sem-${gi}`}>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {salaoNome}
                  <span className="text-gray-400 font-normal ml-2">({g.reservas.length} reserva(s) · {gPessoas} pax)</span>
                </h4>

                {/* Mobile: cards */}
                <div className="sm:hidden space-y-2">
                  {g.reservas.map((r) => (
                    <button key={r.id} onClick={() => onEditarReserva(r, ev)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{r.clienteNomeSnapshot || "—"}{r.status === "cancelada" && <span className="text-[11px] text-rose-500 ml-1">(cancelada)</span>}</div>
                        {r.pagamento?.ajusteTipo === "cortesia"
                          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">Cortesia</span>
                          : r.pagamento?.pago ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Pago</span> : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Pendente</span>}
                      </div>
                      <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span><CalendarDays size={11} className="inline align-[-1px]" /> {fmtBR(r.data)} · {r.horario}</span>
                        <span>· {r.pessoas} pax</span>
                        <span className="inline-flex items-center gap-1">· <MesaTags r={r} mesas={mesasComExtras} /></span>
                        {r.pagamento?.ajusteTipo !== "cortesia" && r.pagamento?.valor ? <span>· {fmtR(r.pagamento.valor)}{r.pagamento.forma ? ` (${r.pagamento.forma})` : ""}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop: tabela */}
                <div className="hidden sm:block border border-gray-200 dark:border-gray-800 rounded-2xl overflow-x-auto shadow-sm">
                  <table className="w-full text-sm min-w-[640px] table-fixed">
                    <colgroup>
                      <col style={{ width: "26%" }} /><col style={{ width: "17%" }} /><col style={{ width: "8%" }} /><col style={{ width: "21%" }} /><col style={{ width: "16%" }} /><col style={{ width: "12%" }} />
                    </colgroup>
                    <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-400 text-[11px] uppercase tracking-wider">
                      <tr><th className="text-left px-4 py-2.5">Cliente</th><th className="text-left px-4 py-2.5">Data/hora</th><th className="text-center px-4 py-2.5">Pax</th><th className="text-left px-4 py-2.5">Mesa</th><th className="text-left px-4 py-2.5">Pagamento</th><th className="text-right px-4 py-2.5">Valor</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/70">
                      {g.reservas.map((r) => (
                        <tr key={r.id} onClick={() => onEditarReserva(r, ev)} className="cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-gray-800/40">
                          <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100 truncate">{r.clienteNomeSnapshot || "—"}{r.status === "cancelada" && <span className="text-[11px] text-rose-500 ml-1">(cancelada)</span>}</td>
                          <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtBR(r.data)} · {r.horario}</td>
                          <td className="px-4 py-2.5 text-center tabular-nums">{r.pessoas}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap"><MesaTags r={r} mesas={mesasComExtras} /></td>
                          <td className="px-4 py-2.5">{r.pagamento?.ajusteTipo === "cortesia" ? <span className="text-violet-600 dark:text-violet-400 font-semibold">Cortesia</span> : <>{r.pagamento?.pago ? <span className="text-emerald-600 font-semibold">Pago</span> : <span className="text-amber-600">Pendente</span>}{r.pagamento?.forma ? <span className="text-gray-400 text-[12px]"> · {r.pagamento.forma}</span> : null}</>}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{r.pagamento?.ajusteTipo === "cortesia" ? <span className="text-violet-600 dark:text-violet-400 font-semibold">Cortesia</span> : r.pagamento?.valor ? fmtR(r.pagamento.valor) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Canceladas — bloco separado e discreto no fim */}
          {canceladas.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider font-semibold text-rose-500/80 dark:text-rose-400/80 mb-1.5 inline-flex items-center gap-1">
                <Ban size={12} /> Canceladas ({canceladas.length})
              </h4>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800/70 overflow-hidden opacity-70">
                {canceladas.map((r) => (
                  <button key={r.id} onClick={() => onEditarReserva(r, ev)} className="w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 flex-wrap hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <span className="font-medium text-gray-700 dark:text-gray-300 line-through">{r.clienteNomeSnapshot || "—"}</span>
                    <span className="text-gray-400 text-[12px]">{fmtBR(r.data)} · {r.horario} · {r.pessoas} pax</span>
                    <span className="inline-flex items-center gap-1 text-gray-400 text-[12px]"><MesaTags r={r} mesas={mesasComExtras} /></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mesas ainda disponíveis no evento */}
      {(mesasAtivas.length > 0 || podeEditar) && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
              <Armchair size={13} /> Mesas disponíveis ({mesasLivres.length} · {lugaresLivres} lugares)
            </div>
            <div className="flex items-center gap-2">
              {podeEditar && <span className="text-[11px] text-gray-400">toque pra bloquear/liberar</span>}
              {podeEditar && <button type="button" onClick={() => setAddMesaOpen(true)} className="h-7 px-2 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><Plus size={13} /> Mesa</button>}
            </div>
          </div>
          {mesasLivres.length === 0 && mesasBloqueadas.length === 0 ? (
            <div className="text-[13px] text-gray-500">{podeEditar ? "Nenhuma mesa disponível. Use \"+ Mesa\" pra criar uma mesa extra só deste evento." : "Todas as mesas ativas já têm reserva nesse evento. 🎉"}</div>
          ) : (
            <div className="space-y-2.5">
              {gruposMesasLivres.map((g, gi) => {
                const lugares = g.mesas.reduce((s, m) => s + (m.capacidade || 0), 0);
                return (
                  <div key={g.salao?.id || `sem-${gi}`}>
                    <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                      {g.salao?.nome || "Sem salão"}
                      <span className="text-gray-400 font-normal ml-1.5">({g.mesas.length} · {lugares} lugares)</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.mesas.map((m) => {
                        const alta = m.tipoMesa === "alta";
                        const ehExtra = extrasIds.has(m.id);
                        // Extra: chip com tom indigo + "×" pra remover. Normal: clique bloqueia.
                        if (ehExtra) {
                          const ehColetiva = coletivasIds.has(m.id);
                          return (
                            <span key={m.id} title={`Mesa extra deste evento${ehColetiva ? " · comunitária" : ""} · ${m.capacidade} pax · ${alta ? "alta" : "baixa"}`}
                              className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-200">
                              {alta ? <Wine size={12} /> : <Armchair size={12} />}
                              {m.nome}
                              <span className="opacity-70">· {m.capacidade}</span>
                              {ehColetiva && <Users size={11} className="opacity-80" />}
                              {podeEditar && <button type="button" onClick={() => void removerExtra(m.id)} title="Remover mesa extra" className="ml-0.5 text-indigo-400 hover:text-rose-500"><X size={12} /></button>}
                            </span>
                          );
                        }
                        return (
                          <button key={m.id} type="button" disabled={!podeEditar} onClick={() => toggleBloqueio(m.id)}
                            title={podeEditar ? "Clique pra bloquear neste evento" : `${m.capacidade} pax · ${alta ? "alta" : "baixa"}`}
                            className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${podeEditar ? "hover:border-rose-300 dark:hover:border-rose-700 cursor-pointer" : "cursor-default"}`}>
                            {alta ? <Wine size={12} className="text-indigo-500" /> : <Armchair size={12} className="text-gray-400" />}
                            {m.nome}
                            <span className="text-gray-400">· {m.capacidade}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {mesasBloqueadas.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mb-1 inline-flex items-center gap-1">
                    <Ban size={12} /> Bloqueadas neste evento ({mesasBloqueadas.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {mesasBloqueadas.map((m) => {
                      const alta = m.tipoMesa === "alta";
                      return (
                        <button key={m.id} type="button" disabled={!podeEditar} onClick={() => toggleBloqueio(m.id)}
                          title={podeEditar ? "Clique pra liberar" : "Bloqueada neste evento"}
                          className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/20 text-rose-500 line-through ${podeEditar ? "cursor-pointer hover:border-rose-400" : "cursor-default"}`}>
                          {alta ? <Wine size={12} /> : <Armchair size={12} />}
                          {m.nome}
                          <span className="opacity-70">· {m.capacidade}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vincular reservas normais que caem na data do evento */}
      {candOrd.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/10 p-3">
          <div className="text-[12px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-2 inline-flex items-center gap-1.5"><Link2 size={13} /> Reservas do dia pra vincular ({candOrd.length})</div>
          <div className="space-y-1.5">
            {candOrd.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[13px] bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-800">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.clienteNomeSnapshot || "—"}</span>
                  <span className="text-gray-400 text-[12px]"> · {fmtBR(r.data)} · {r.horario} · {r.pessoas} pessoa(s)</span>
                </div>
                <button onClick={() => onVincular(r, ev)} className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1"><Link2 size={12} /> Vincular</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {addMesaOpen && <AddMesaExtraModal saloes={saloes} saloesEvento={ev.saloesExtras || []} onClose={() => setAddMesaOpen(false)} onSalvar={adicionarExtra} />}
    </div>
  );
}

// Modal pra criar uma mesa EXTRA só do evento (nome livre, capacidade, altura,
// comunitária, e salão — do restaurante, do evento, ou um salão novo só do evento).
function AddMesaExtraModal({ saloes, saloesEvento, onClose, onSalvar }: {
  saloes: Salao[];
  saloesEvento: { id: string; nome: string }[];
  onClose: () => void;
  onSalvar: (m: { nome: string; capacidade: number; tipoMesa: "baixa" | "alta"; salaoId?: string | null; coletiva?: boolean; novoSalaoNome?: string }) => Promise<void> | void;
}) {
  const [nome, setNome] = useState("");
  const [capacidade, setCapacidade] = useState("2");
  const [tipoMesa, setTipoMesa] = useState<"baixa" | "alta">("baixa");
  const [salaoId, setSalaoId] = useState<string>("");   // "" = sem salão, "__novo__" = criar salão do evento
  const [novoSalao, setNovoSalao] = useState("");
  const [coletiva, setColetiva] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  async function salvar() {
    const cap = parseInt(capacidade, 10);
    if (!nome.trim()) { setErr("Dê um nome à mesa (ex.: Varanda, Lounge A)."); return; }
    if (!cap || cap <= 0) { setErr("Capacidade inválida."); return; }
    if (salaoId === "__novo__" && !novoSalao.trim()) { setErr("Dê um nome ao salão do evento."); return; }
    setErr(""); setSalvando(true);
    try {
      await onSalvar({
        nome: nome.trim(), capacidade: cap, tipoMesa, coletiva,
        salaoId: salaoId === "__novo__" ? null : (salaoId || null),
        novoSalaoNome: salaoId === "__novo__" ? novoSalao.trim() : undefined,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao salvar"); setSalvando(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Plus size={16} className="text-indigo-500" /> Mesa extra do evento</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nome *</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="ex.: Varanda 1, Lounge A, Deck" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Capacidade (pax) *</label>
              <input type="number" min={1} value={capacidade} onChange={(e) => setCapacidade(e.target.value)} className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Altura</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([["baixa", "🪑"], ["alta", "🍸"]] as const).map(([v, ic]) => (
                  <button key={v} type="button" onClick={() => setTipoMesa(v)} className={`h-10 rounded-lg text-sm border ${tipoMesa === v ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700 font-semibold" : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"}`}>{ic} {v === "alta" ? "Alta" : "Baixa"}</button>
                ))}
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={coletiva} onChange={(e) => setColetiva(e.target.checked)} className="accent-indigo-600" />
            <span className="font-medium">Mesa comunitária <span className="font-normal text-gray-400">— aceita várias reservas na mesma mesa</span></span>
          </label>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Salão</label>
            <select value={salaoId} onChange={(e) => setSalaoId(e.target.value)} className="w-full h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">— sem salão —</option>
              {saloes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              {saloesEvento.map((s) => <option key={s.id} value={s.id}>{s.nome} (deste evento)</option>)}
              <option value="__novo__">+ Criar salão só deste evento…</option>
            </select>
            {salaoId === "__novo__" && (
              <input value={novoSalao} onChange={(e) => setNovoSalao(e.target.value)} autoFocus placeholder="nome do salão (ex.: Jardim, Terraço)" className="w-full h-10 px-3 mt-2 text-sm rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900" />
            )}
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{salvando ? "..." : "Criar mesa"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventoModal({ rid, ev, central, cfg, onClose, onSaved }: {
  rid: string; ev?: ReservaEvento; central: boolean | null; cfg: ReservaEventoConfig | null;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(ev?.nome || "");
  const [dataInicio, setDataInicio] = useState(ev?.dataInicio || new Date().toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(ev?.dataFim || "");
  const [horario, setHorario] = useState(ev?.horarioPadrao || "20:00");
  const [valorPP, setValorPP] = useState(ev?.valorPorPessoa != null ? fmtCents(Math.round(ev.valorPorPessoa * 100)) : "");
  const [rootInput, setRootInput] = useState("");
  const [editRoot, setEditRoot] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const precisaRoot = central === true && (!cfg?.driveRootId || editRoot);

  async function salvar() {
    if (!nome.trim()) { setErro("Dê um nome ao evento."); return; }
    if (!dataInicio) { setErro("Informe a data."); return; }
    setSalvando(true); setErro("");
    try {
      let pastaDriveId = ev?.pastaDriveId, pastaDriveNome = ev?.pastaDriveNome;
      if (central === true) {
        let rootId = cfg?.driveRootId;
        if (!rootId || editRoot) {
          const parsed = parseDriveFolderId(rootInput);
          if (!parsed) { setErro("Cole o link ou o ID da pasta-raiz no Drive central."); setSalvando(false); return; }
          await salvarEventoConfig({ id: rid, restaurantId: rid, driveRootId: parsed });
          rootId = parsed;
        }
        const subId = await centralEnsureFolder(rootId, nome.trim());
        pastaDriveId = subId; pastaDriveNome = nome.trim();
      }
      const now = new Date().toISOString();
      const e: ReservaEvento = {
        id: ev?.id || uid(), restaurantId: rid, nome: nome.trim(),
        dataInicio, dataFim: dataFim && dataFim !== dataInicio ? dataFim : undefined,
        horarioPadrao: horario || undefined, valorPorPessoa: parseR(valorPP) || undefined,
        pastaDriveId, pastaDriveNome, ativo: true,
        criadoEm: ev?.criadoEm || now, criadoPor: ev?.criadoPor || (me?.id || ""),
      };
      await salvarEvento(e);
      onSaved(e.id);
    } catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }
  async function excluir() { if (!ev) return; if (!confirm(`Excluir o evento "${ev.nome}"? As reservas não são apagadas.`)) return; await excluirEvento(ev.id); onClose(); }

  const inp = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  const lbl = "text-[11px] font-bold text-gray-500 uppercase tracking-wide";
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] max-h-[92vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{ev ? "Editar evento" : "Novo evento"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
        <label className={lbl}>Nome</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Jantar harmonizado" autoFocus className={inp + " mt-1 mb-3"} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div><label className={lbl}>Data início</label><input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Data fim <span className="text-gray-400 normal-case">(opcional)</span></label><input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Horário padrão</label><input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className={inp + " mt-1"} /></div>
          <div><label className={lbl}>Valor por pessoa</label>
            <div className="relative mt-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">R$</span>
              <input value={valorPP} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValorPP(d ? fmtCents(parseInt(d, 10)) : ""); }} inputMode="numeric" placeholder="0,00" className={inp + " pl-8 text-right"} />
            </div>
          </div>
        </div>

        {central === true ? (
          <>
            <label className={lbl}>Pasta-raiz no Drive (conta central)</label>
            {!precisaRoot ? (
              <div className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5"><Check size={14} /> Configurada — cada evento vira uma subpasta. <button type="button" onClick={() => { setEditRoot(true); setRootInput(""); }} className="text-indigo-600 dark:text-indigo-400 underline">trocar</button></div>
            ) : (
              <>
                <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Cole o link ou ID da pasta-raiz" className={inp + " mt-1"} />
                <div className="text-[11px] text-gray-400 mt-1">Pasta no Drive da conta central (a mesma do Recebimento). Configura uma vez; cada evento cria uma subpasta. Sem popup.</div>
              </>
            )}
          </>
        ) : central === false ? (
          <div className="text-[12px] text-amber-600">Conta central do Drive não configurada — o evento é criado sem pasta (anexo de comprovante indisponível).</div>
        ) : <div className="text-[12px] text-gray-400">Verificando Drive…</div>}

        {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
        <div className="flex gap-2 mt-4">
          {ev && <button onClick={() => void excluir()} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          <button onClick={() => void salvar()} disabled={salvando || !nome.trim() || central === null} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
