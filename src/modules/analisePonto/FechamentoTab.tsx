// ════════════════════════════════════════════════════════════════════════════
//  Fechamento de ponto — Passo 1: REVISÃO (sem gravar na escala ainda).
//
//  Mostra o espelho do mês por empregado, com status sugerido (cruza ponto +
//  prevista), editável dia a dia, e permite VISUALIZAR o PDF do espelho (Sólides).
//  O "Fechar folha do empregado" (gravar na praticada) entra no Passo 2.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteField, doc, getDoc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { AjusteEscalaMeta, Cargo, Empregado, EscalaMes, Restaurant, ScheduleStatus } from "../../core/types";
import { AREAS, empregadoBatePonto } from "../../core/types";
import { fetchRoster, fetchEspelhoPdf, fetchScheduleCatalog, decidirAprovacao, type AprovacaoPendente } from "../../core/ponto/solidesPontoClient";
import { analisarPonto, ROTULOS, type Ocorrencia, type PontoColaborador, type PontoEscala, type PontoMarcacao, type TipoOcorrencia } from "../../core/ponto/analise";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import type { SolidesPunch } from "../../core/excecoes/types";
import { Modal } from "../../core/ui/Modal";
import { BatidasDiaModal } from "./BatidasDiaModal";
import { AfastamentoModal } from "./AfastamentoModal";

const STATUS_OPCOES: Array<{ id: ScheduleStatus; label: string }> = [
  { id: "trabalho", label: "Trabalho" },
  { id: "folga", label: "Folga" },
  { id: "freela", label: "Freela" },
  { id: "comp", label: "Folga por compensação" },
  { id: "comp_trab", label: "Trabalho por compensação" },
  { id: "ferias", label: "Férias" },
  { id: "falta_j", label: "Falta justificada" },
  { id: "falta_i", label: "Falta injustificada" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPCOES.map((o) => [o.id, o.label]));

// Mesmas cores da Escala — sigla (fundo sólido) + tom claro pra sombrear a linha.
const STATUS_VIS: Record<ScheduleStatus, { short: string; badge: string; row: string }> = {
  trabalho:  { short: "TR", badge: "bg-emerald-500 text-white", row: "bg-emerald-50 dark:bg-emerald-950/20" },
  folga:     { short: "FO", badge: "bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200", row: "bg-gray-100/70 dark:bg-gray-800/40" },
  freela:    { short: "FR", badge: "bg-purple-500 text-white", row: "bg-purple-50 dark:bg-purple-950/20" },
  comp:      { short: "FC", badge: "bg-gray-500 text-white", row: "bg-slate-100 dark:bg-slate-800/40" },
  comp_trab: { short: "TC", badge: "bg-emerald-800 text-white", row: "bg-emerald-100/70 dark:bg-emerald-900/30" },
  ferias:    { short: "FE", badge: "bg-sky-500 text-white", row: "bg-sky-50 dark:bg-sky-950/20" },
  falta_j:   { short: "FJ", badge: "bg-rose-300 text-rose-900", row: "bg-rose-50 dark:bg-rose-950/20" },
  falta_i:   { short: "FI", badge: "bg-rose-600 text-white", row: "bg-rose-100/70 dark:bg-rose-900/30" },
};

const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
const DIAS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function nomeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const n = MESES_PT[m - 1] || "";
  return `${n.charAt(0).toUpperCase()}${n.slice(1)}/${y}`;
}
const fmtH = (ms?: number) => { if (!ms) return ""; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function diasDoMes(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const out: string[] = [];
  const total = new Date(y, m, 0).getDate();
  for (let d = 1; d <= total; d++) out.push(`${ym}-${pad(d)}`);
  return out;
}
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function demissaoYmd(r: PontoColaborador): string | undefined {
  if (!r.fired) return undefined;
  const ms = typeof r.resignationDate === "number" ? r.resignationDate
    : typeof r.firedDate === "number" ? r.firedDate : undefined;
  if (!ms) return undefined;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function mapMotivo(txt?: string): ScheduleStatus {
  const t = (txt || "").toLowerCase();
  if (/féri|feri/.test(t)) return "ferias";
  if (/atestado|justif/.test(t)) return "falta_j";
  return "folga";
}
function descAfast(p: SolidesPunch): string | undefined {
  const ar = (p as { adjustmentReason?: unknown }).adjustmentReason;
  if (typeof ar === "string") return ar || undefined;
  if (ar && typeof ar === "object") return (ar as { description?: string }).description || undefined;
  const j = (p as { justification?: unknown }).justification;
  if (typeof j === "string") return j || undefined;
  if (j && typeof j === "object") return (j as { description?: string }).description || undefined;
  return undefined;
}

// ─── Integração com Análise de Ponto (inconsistências / fluxo) ───────────────
const ocKey = (employeeId: number, data: string, tipo: TipoOcorrencia) => `${employeeId}|${data}|${tipo}`;

type SolItem = { key: string; tipo: TipoOcorrencia; data: string; rotulo: string };
type Solicitacao = { id: string; employeeId: number; itens: SolItem[]; prazoEm: string; status: string };
type Avaliacao = { id: string; key: string };

function textoOuDesc(x: unknown): string | undefined {
  if (x == null) return undefined;
  if (typeof x === "string") return x || undefined;
  if (typeof x === "object") {
    const o = x as { description?: string; descricao?: string; name?: string };
    return o.description || o.descricao || o.name || undefined;
  }
  return String(x);
}
function derivarAprovacoes(punches: SolidesPunch[]): AprovacaoPendente[] {
  return punches
    .filter((p) => String(p.status || "").toUpperCase() === "PENDING" && (p.adjustmentReason != null || p.edited === true))
    .map((p) => ({
      punchId: p.id, employeeId: p.employeeId,
      employeeName: p.employeeName || p.employee?.name || "?",
      date: p.date || "",
      dateIn: typeof p.dateIn === "number" ? p.dateIn : undefined,
      dateOut: typeof p.dateOut === "number" && p.dateOut > p.dateIn ? p.dateOut : undefined,
      status: "PENDING" as const,
      motivo: textoOuDesc(p.adjustmentReason),
      observation: textoOuDesc(p.justification),
      editIn: (p as { editedIn?: boolean }).editedIn === true,
      editOut: (p as { editedOut?: boolean }).editedOut === true,
    }));
}
function relogio(prazoEm: string, now: number): { txt: string; vencido: boolean } {
  const diff = new Date(prazoEm).getTime() - now;
  const vencido = diff < 0; const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000); const m = Math.floor((abs % 3_600_000) / 60_000);
  const dur = h > 0 ? `${h}h${pad(m)}` : `${m}min`;
  return { txt: vencido ? `venceu há ${dur}` : `faltam ${dur}`, vencido };
}
const fmtBRdata = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function montarMensagem(colaborador: string, ocs: Ocorrencia[], prazoEm: string): string {
  const primeiro = (colaborador || "").trim().split(/\s+/)[0] || colaborador;
  const linhas = ocs.map((o) => `• ${fmtBRdata(o.data)} — ${ROTULOS[o.tipo]}`).join("\n");
  return `Olá ${primeiro}, tudo bem?\n\nIdentificamos pendências no seu registro de ponto que precisam de ajuste no aplicativo da Sólides:\n\n${linhas}\n\nPor favor, faça os ajustes até ${fmtDataHora(prazoEm)}. Depois disso eles passam pela nossa revisão e aprovação. Qualquer dúvida, é só falar com a gente. Obrigado! 🙏`;
}
function waLink(tel: string, msg: string): string {
  const d = (tel || "").replace(/\D/g, "");
  const num = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

// Estado do fluxo de inconsistência num dia do empregado.
type EstadoDia = "aberto" | "enviado" | "ciente" | "aprovar";

type DiaEspelho = {
  date: string;
  worked: boolean;
  marks: string;        // "08:00-12:00 · 13:00-17:00"
  afastamento?: string; // descrição do afastamento, se houver
  prevista?: ScheduleStatus;
  sugerido: ScheduleStatus;
  demitido?: boolean;   // dia posterior à demissão do empregado
  futuro?: boolean;     // dia ainda não ocorrido — não há o que fechar
};

export function FechamentoTab({
  rid, activeRestaurant, empregados, cargos, mesInicial, por,
}: {
  rid: string;
  activeRestaurant: Restaurant;
  empregados: Empregado[];
  cargos: Cargo[];
  mesInicial: string; // YYYY-MM
  por: { id: string; nome: string };
}) {
  const [mes, setMes] = useState(mesInicial);
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [punches, setPunches] = useState<SolidesPunch[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [selEmp, setSelEmp] = useState<number | "">("");
  const [edits, setEdits] = useState<Record<number, Record<string, ScheduleStatus>>>({});
  const [pdf, setPdf] = useState<{ url: string; nome: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selDias, setSelDias] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  // Integração Análise de Ponto: catálogo de escalas Sólides + estado do fluxo.
  const [schedules, setSchedules] = useState<PontoEscala[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [modalBatidas, setModalBatidas] = useState<{ employeeId: number; colaborador: string; data: string } | null>(null);
  const [modalAfast, setModalAfast] = useState<{ employeeId: number; colaborador: string; data: string } | null>(null);

  const shortCode = activeRestaurant.shortCode || "";
  // Opções do seletor de mês (últimos 18 meses + o mês atual selecionado).
  const mesesOpcoes = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    for (let i = 0; i < 18; i++) { out.push(`${y}-${pad(m)}`); m--; if (m < 1) { m = 12; y--; } }
    if (!out.includes(mes)) out.unshift(mes);
    return out;
  }, [mes]);
  const empAppPorCpf = useMemo(() => {
    const m = new Map<string, Empregado>();
    for (const e of empregados) { const c = soDigitos(e.cpf); if (c) m.set(c, e); }
    return m;
  }, [empregados]);
  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);
  // Cargo de confiança / dispensado de ponto (CLT Art. 62 II): não bate ponto.
  // Pra esses a praticada = prevista (não há batidas pra cruzar).
  const naoBatePontoDe = (emp?: Empregado) =>
    !!emp && !empregadoBatePonto(emp, emp.cargoId ? cargoPorId.get(emp.cargoId) : undefined);

  async function carregar() {
    if (!shortCode) { setErro("Restaurante sem shortCode."); return; }
    setErro(""); setCarregando(true); setEdits({});
    const dias = diasDoMes(mes);
    const ini = dias[0]; const fim = dias[dias.length - 1];
    try {
      const [ros, rosFired, pun, escSnap, sched] = await Promise.all([
        fetchRoster(shortCode).catch(() => []),
        fetchRoster(shortCode, true).catch(() => []),  // demitidos (p/ fechar quem saiu no meio do mês)
        fetchPunches(ini, fim, shortCode, true).then((r) => r.punches).catch(() => []),  // inclui demitidos
        getDoc(doc(db, "escalas", `${rid}_${mes}`)),
        fetchScheduleCatalog(shortCode).catch(() => []),  // catálogo de escalas Sólides (p/ análise de inconsistências)
      ]);
      const mapR = new Map<number, PontoColaborador>();
      for (const r of [...ros, ...rosFired]) if (typeof r.id === "number" && !mapR.has(r.id)) mapR.set(r.id, r);
      setRoster([...mapR.values()]);
      setPunches(pun);
      setSchedules(sched);
      setEscala(escSnap.exists() ? ({ id: escSnap.id, ...escSnap.data() } as EscalaMes) : null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o mês.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes, shortCode, rid]);

  // Estado do fluxo (solicitações enviadas + ciências dadas) — tempo real.
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "pontoSolicitacoes"), where("restaurantId", "==", rid)),
      (s) => setSolicitacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Solicitacao)));
    const u2 = onSnapshot(query(collection(db, "pontoAvaliacoes"), where("restaurantId", "==", rid)),
      (s) => setAvaliacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Avaliacao)));
    return () => { u1(); u2(); };
  }, [rid]);

  // Relógio pro countdown das solicitações (atualiza a cada minuto).
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  // Ativos + demitidos RELEVANTES ao mês (saíram no mês ou depois) — sem o
  // histórico inteiro de demitidos antigos.
  const colaboradores = useMemo(() => {
    const monthStart = `${mes}-01`;
    return roster
      .filter((r) => typeof r.id === "number")
      .map((r) => ({ solId: r.id as number, nome: r.name || "?", emp: empAppPorCpf.get(soDigitos(r.cpf)), demissao: demissaoYmd(r), fired: !!r.fired }))
      .filter((c) => !c.fired || (c.demissao ? c.demissao >= monthStart : false))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [roster, empAppPorCpf, mes]);

  const hojeYmd = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);

  // Status de fechamento por colaborador (pros chips). "fechado" = todos os dias
  // do contrato até hoje já fechados (solides_sync); "aberto" = ainda tem dias a
  // fechar; "sem_vinculo" = sem empregado no app (não dá pra fechar).
  const statusFechCol = useMemo(() => {
    const map = new Map<number, "fechado" | "aberto" | "sem_vinculo">();
    const dias = diasDoMes(mes);
    for (const c of colaboradores) {
      if (!c.emp) { map.set(c.solId, "sem_vinculo"); continue; }
      const aj = escala?.realAjustes?.[c.emp.id] || {};
      let pendentes = 0;
      for (const d of dias) {
        if (c.demissao && d > c.demissao) continue;  // fora do contrato
        if (d > hojeYmd) continue;                   // futuro não conta
        if ((aj[d] as AjusteEscalaMeta | undefined)?.origem === "solides_sync") continue;
        pendentes++;
      }
      map.set(c.solId, pendentes === 0 ? "fechado" : "aberto");
    }
    return map;
  }, [colaboradores, escala, mes, hojeYmd]);

  // Colaboradores agrupados por área (coluna por área) pros chips.
  const colaboradoresPorArea = useMemo(() => {
    const groups = new Map<string, typeof colaboradores>();
    for (const c of colaboradores) {
      const area = c.emp?.cargoId ? cargoPorId.get(c.emp.cargoId)?.area : undefined;
      const key = area || "Sem área";
      const arr = groups.get(key) || []; arr.push(c); groups.set(key, arr);
    }
    const ordem: string[] = [...AREAS, "Sem área"];
    return [...groups.entries()].sort((a, b) => {
      const ia = ordem.indexOf(a[0]); const ib = ordem.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [colaboradores, cargoPorId]);

  // ── Análise de inconsistências do mês (motor determinístico Sólides) ──────
  const ocorrenciasPorDia = useMemo(() => {
    const map = new Map<string, Ocorrencia[]>();
    if (!roster.length) return map;
    const dias = diasDoMes(mes);
    const res = analisarPonto(punches as unknown as PontoMarcacao[], roster, schedules, dias[0], dias[dias.length - 1]);
    for (const o of res.ocorrencias) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.data)) continue; // ignora ocorrências de período (déficit/excesso)
      const k = `${o.employeeId}|${o.data}`;
      const arr = map.get(k) || []; arr.push(o); map.set(k, arr);
    }
    return map;
  }, [punches, roster, schedules, mes]);
  const cienteKeys = useMemo(() => new Set(avaliacoes.map((a) => a.key)), [avaliacoes]);
  const solPorKey = useMemo(() => {
    const m = new Map<string, Solicitacao>();
    for (const s of solicitacoes) for (const it of s.itens || []) {
      const cur = m.get(it.key);
      if (!cur || s.prazoEm > cur.prazoEm) m.set(it.key, s);
    }
    return m;
  }, [solicitacoes]);
  const aprovacoesPorDia = useMemo(() => {
    const m = new Map<string, AprovacaoPendente[]>();
    for (const a of derivarAprovacoes(punches)) {
      const k = `${a.employeeId}|${a.date}`;
      const arr = m.get(k) || []; arr.push(a); m.set(k, arr);
    }
    return m;
  }, [punches]);

  // Inconsistências + estado do fluxo de um dia do empregado (pros badges/ações).
  function inconsistDoDia(employeeId: number, date: string): { ocs: Ocorrencia[]; estado: EstadoDia | null; prazoEm?: string; aprovacoes: AprovacaoPendente[] } {
    const ocs = ocorrenciasPorDia.get(`${employeeId}|${date}`) || [];
    const aprovacoes = aprovacoesPorDia.get(`${employeeId}|${date}`) || [];
    if (!ocs.length && !aprovacoes.length) return { ocs, estado: null, aprovacoes };
    if (aprovacoes.length) return { ocs, estado: "aprovar", aprovacoes };
    let sol: Solicitacao | undefined;
    for (const o of ocs) { const s = solPorKey.get(ocKey(o.employeeId, o.data, o.tipo)); if (s && (!sol || s.prazoEm > sol.prazoEm)) sol = s; }
    if (sol) return { ocs, estado: "enviado", prazoEm: sol.prazoEm, aprovacoes };
    if (ocs.length && ocs.every((o) => cienteKeys.has(ocKey(o.employeeId, o.data, o.tipo)))) return { ocs, estado: "ciente", aprovacoes };
    return { ocs, estado: "aberto", aprovacoes };
  }

  // Espelho do empregado selecionado: 1 linha por dia do mês.
  const espelho = useMemo<DiaEspelho[]>(() => {
    if (!selEmp) return [];
    const col = colaboradores.find((c) => c.solId === selEmp);
    const appId = col?.emp?.id;
    const dem = col?.demissao;
    const naoBate = !!col?.emp && !empregadoBatePonto(col.emp, col.emp.cargoId ? cargoPorId.get(col.emp.cargoId) : undefined);
    const prevista = appId ? escala?.prevista?.[appId] : undefined;
    const porDia = new Map<string, SolidesPunch[]>();
    for (const p of punches) {
      if (p.employeeId !== selEmp || (p as { excluded?: boolean }).excluded) continue;
      const arr = porDia.get(p.date) || []; arr.push(p); porDia.set(p.date, arr);
    }
    return diasDoMes(mes).map((date) => {
      if (dem && date > dem) return { date, worked: false, marks: "", prevista: prevista?.[date], sugerido: "folga" as ScheduleStatus, demitido: true };
      // Dia futuro: ainda não ocorreu — não há batida nem o que fechar.
      if (date > hojeYmd) return { date, worked: false, marks: "", prevista: prevista?.[date], sugerido: prevista?.[date] || ("folga" as ScheduleStatus), futuro: true };
      // Cargo de confiança: ignora batidas (não existem) e adota a prevista como praticada.
      if (naoBate) {
        const prev = prevista?.[date];
        return { date, worked: false, marks: "", prevista: prev, sugerido: prev || ("folga" as ScheduleStatus) };
      }
      const ps = (porDia.get(date) || []).sort((a, b) => a.dateIn - b.dateIn);
      const trabalho = ps.filter((p) => !(p as { allowance?: boolean }).allowance && p.dateIn);
      const afastP = ps.find((p) => (p as { allowance?: boolean }).allowance) || ps.find((p) => descAfast(p));
      const worked = trabalho.length > 0;
      const marks = trabalho.map((p) => p.dateOut && p.dateOut > p.dateIn ? `${fmtH(p.dateIn)}-${fmtH(p.dateOut)}` : `${fmtH(p.dateIn)}-?`).join(" · ");
      const afastamento = !worked ? descAfast(afastP || ({} as SolidesPunch)) : undefined;
      const prev = prevista?.[date];
      let sugerido: ScheduleStatus;
      // Trabalhou: preserva a prevista quando ela já é "trabalho-like" (TC/freela);
      // se a prevista era folga (folga ou folga-por-compensação), virou compensação.
      if (worked) sugerido = (prev === "comp_trab" || prev === "freela") ? prev
        : (prev === "folga" || prev === "comp") ? "comp_trab"
        : "trabalho";
      else if (afastamento) sugerido = mapMotivo(afastamento);
      else if (prev === "freela") sugerido = "freela";
      else if (prev === "trabalho") sugerido = "falta_i";
      else sugerido = prev || "folga";
      return { date, worked, marks, afastamento, prevista: prev, sugerido };
    });
  }, [selEmp, colaboradores, escala, punches, mes, cargoPorId, hojeYmd]);

  const colSel = colaboradores.find((c) => c.solId === selEmp);
  const naoBateSel = naoBatePontoDe(colSel?.emp);
  const appIdSel = colSel?.emp?.id;
  const previstaFechada = !!escala?.previstaFechadaEm;
  const mesEncerrado = !!escala?.fechadoEm;
  const realAjustesSel = appIdSel ? escala?.realAjustes?.[appIdSel] : undefined;
  const fechadoEm = (date: string) => realAjustesSel?.[date]?.origem === "solides_sync";

  // Status exibido: dia fechado mostra o que foi gravado na praticada; senão, edição/sugestão.
  const statusDe = (date: string): ScheduleStatus | undefined => {
    if (!selEmp) return undefined;
    if (appIdSel && fechadoEm(date)) return escala?.real?.[appIdSel]?.[date];
    const ed = edits[selEmp]?.[date];
    if (ed) return ed;
    return espelho.find((d) => d.date === date)?.sugerido;
  };
  const setStatus = (date: string, s: ScheduleStatus) => {
    if (!selEmp) return;
    setEdits((cur) => ({ ...cur, [selEmp]: { ...(cur[selEmp] || {}), [date]: s } }));
  };

  // limpa seleção ao trocar de colaborador/mês
  useEffect(() => { setSelDias(new Set()); }, [selEmp, mes]);

  const toggleDia = (date: string) => setSelDias((s) => {
    const n = new Set(s); n.has(date) ? n.delete(date) : n.add(date); return n;
  });
  const diasAbertos = espelho.filter((d) => !fechadoEm(d.date) && !d.demitido && !d.futuro).map((d) => d.date);
  const todosAbertosSel = diasAbertos.length > 0 && diasAbertos.every((d) => selDias.has(d));
  const totalFechados = espelho.filter((d) => fechadoEm(d.date)).length;
  const totalFechaveis = espelho.filter((d) => !d.demitido && !d.futuro).length;

  // ── Ações inline de inconsistência (mesma lógica da aba Inconsistências) ──
  function solicitarDia(date: string) {
    if (selEmp === "" || !colSel) return;
    const ocs = inconsistDoDia(Number(selEmp), date).ocs;
    if (!ocs.length) return;
    const tel = colSel.emp?.telefone || "";
    if (!tel) { setErro("Empregado sem telefone cadastrado pra enviar a correção."); return; }
    const prazoHoras = 6;
    const prazoEm = new Date(Date.now() + prazoHoras * 3_600_000).toISOString();
    window.open(waLink(tel, montarMensagem(colSel.nome, ocs, prazoEm)), "_blank");
    const itens = ocs.map((o) => ({ key: ocKey(o.employeeId, o.data, o.tipo), tipo: o.tipo, data: o.data, rotulo: ROTULOS[o.tipo] }));
    void addDoc(collection(db, "pontoSolicitacoes"), {
      restaurantId: rid, employeeId: Number(selEmp), colaborador: colSel.nome, itens,
      enviadoEm: new Date().toISOString(), prazoHoras, prazoEm,
      por: { id: por.id, nome: por.nome }, status: "enviado",
    }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar a solicitação."));
  }
  function cienciaDia(date: string) {
    if (selEmp === "") return;
    const ocs = inconsistDoDia(Number(selEmp), date).ocs;
    const em = new Date().toISOString();
    for (const o of ocs) {
      const k = ocKey(o.employeeId, o.data, o.tipo);
      if (cienteKeys.has(k)) continue;
      void addDoc(collection(db, "pontoAvaliacoes"), {
        restaurantId: rid, key: k, employeeId: o.employeeId, colaborador: o.colaborador,
        tipo: o.tipo, data: o.data, detalhe: o.detalhe, obs: "",
        por: { id: por.id, nome: por.nome }, em,
      }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar ciência."));
    }
  }
  async function decidirDia(date: string, status: "APPROVED" | "REPROVED") {
    if (selEmp === "") return;
    const aps = inconsistDoDia(Number(selEmp), date).aprovacoes;
    if (!aps.length) return;
    const verbo = status === "APPROVED" ? "Aprovar" : "Reprovar";
    if (!window.confirm(`${verbo} ${aps.length} ajuste(s) de ${colSel?.nome} em ${date.split("-").reverse().join("/")}?\n\nGrava na Sólides (dado trabalhista).`)) return;
    setErro(""); setSalvando(true);
    try {
      for (const a of aps) {
        await decidirAprovacao(shortCode, { punchId: a.punchId, status });
        try {
          await addDoc(collection(db, "pontoAuditoria"), {
            restaurantId: rid, tipo: "aprovacao", status, por: { id: por.id, nome: por.nome },
            punchId: a.punchId, employeeId: a.employeeId, colaborador: a.employeeName, em: new Date().toISOString(),
          });
        } catch { /* auditoria não bloqueia */ }
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao decidir o ponto.");
    } finally { setSalvando(false); }
  }

  async function fecharDias() {
    if (!selEmp || !appIdSel) return;
    const dias = [...selDias].filter((d) => !fechadoEm(d) && statusDe(d));
    if (dias.length === 0) return;
    if (!previstaFechada) { setErro("Feche a PREVISTA do mês primeiro (no módulo de Escala)."); return; }
    if (mesEncerrado) { setErro("Mês já encerrado — reabra no módulo de Escala pra editar a praticada."); return; }
    if (!window.confirm(`Fechar ${dias.length} dia(s) de ${colSel?.nome}?\n\nSobe pra escala PRATICADA do mês.`)) return;
    setErro(""); setSalvando(true);
    try {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };
      for (const d of dias) {
        const status = statusDe(d);
        if (!status) continue;
        const ant = escala?.real?.[appIdSel]?.[d];
        updates[`real.${appIdSel}.${d}`] = status;
        const meta: AjusteEscalaMeta = {
          origem: "solides_sync", ajustadoEm: now, ajustadoPor: por.id, ajustadoPorNome: por.nome,
          ...(ant ? { statusAnterior: ant } : {}),
        };
        updates[`realAjustes.${appIdSel}.${d}`] = meta;
      }
      await updateDoc(doc(db, "escalas", `${rid}_${mes}`), updates);
      setSelDias(new Set());
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao fechar os dias.");
    } finally { setSalvando(false); }
  }

  async function reabrirDia(date: string) {
    if (!appIdSel) return;
    if (!window.confirm(`Reabrir ${date.split("-").reverse().join("/")}? Volta a ficar editável (o valor já gravado permanece até você fechar de novo).`)) return;
    setSalvando(true);
    try {
      await updateDoc(doc(db, "escalas", `${rid}_${mes}`), {
        [`realAjustes.${appIdSel}.${date}`]: deleteField(),
        updatedAt: new Date().toISOString(),
      });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao reabrir o dia.");
    } finally { setSalvando(false); }
  }

  async function verPdf() {
    if (!selEmp) return;
    setErro(""); setPdfLoading(true);
    const dias = diasDoMes(mes);
    try {
      const r = await fetchEspelhoPdf(shortCode, selEmp, dias[0], dias[dias.length - 1]);
      const bytes = atob(r.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      setPdf({ url, nome: r.fileName || "espelho.pdf" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o PDF do espelho.");
    } finally {
      setPdfLoading(false);
    }
  }
  function fecharPdf() {
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf(null);
  }

  return (
    <div className="space-y-4">
      {/* Barra */}
      <div className="bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900 border border-indigo-100 dark:border-indigo-900/40 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Mês</label>
            <select value={mes} onChange={(e) => { setSelEmp(""); setMes(e.target.value); }}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              {mesesOpcoes.map((ym) => <option key={ym} value={ym}>{nomeMes(ym)}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          {selEmp !== "" && (
            <button type="button" onClick={() => void verPdf()} disabled={pdfLoading}
              className="h-9 px-4 text-sm font-semibold rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 whitespace-nowrap">
              {pdfLoading ? "Gerando…" : "👁 Visualizar espelho (PDF)"}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Escolha um colaborador pelo chip. <span className="text-emerald-700 dark:text-emerald-300 font-semibold">✓ verde</span> = período fechado · <span className="text-amber-700 dark:text-amber-300 font-semibold">● amarelo</span> = ainda tem dias a fechar · <span className="text-gray-400 font-semibold">○ cinza</span> = sem vínculo no app.
        </p>
      </div>

      {/* Chips por área — visão geral de quem já está fechado */}
      {colaboradores.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {colaboradoresPorArea.map(([area, cols]) => {
            const fechadosArea = cols.filter((c) => statusFechCol.get(c.solId) === "fechado").length;
            return (
              <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{area}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{fechadosArea}/{cols.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {cols.map((c) => {
                    const st = statusFechCol.get(c.solId);
                    const sel = c.solId === selEmp;
                    const cls = st === "fechado"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800"
                      : st === "aberto"
                      ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
                      : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800/40 dark:border-gray-700";
                    return (
                      <button
                        key={c.solId}
                        type="button"
                        onClick={() => setSelEmp(c.solId)}
                        title={st === "sem_vinculo" ? "Sem vínculo no app — não dá pra fechar" : st === "fechado" ? "Período fechado" : "Ainda tem dias a fechar"}
                        className={`text-left text-xs px-2 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors hover:brightness-95 ${cls} ${sel ? "ring-2 ring-indigo-500" : ""}`}
                      >
                        <span className="shrink-0">{st === "fechado" ? "✓" : st === "aberto" ? "●" : "○"}</span>
                        <span className="truncate flex-1">{naoBatePontoDe(c.emp) ? "🎩 " : ""}{c.nome}</span>
                        {c.fired && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200">DEM</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {carregando ? (
        <div className="text-center text-sm text-gray-400 py-12">Carregando o mês…</div>
      ) : selEmp === "" ? (
        <div className="text-center text-sm text-gray-400 py-12">Escolha um colaborador pra revisar o espelho.</div>
      ) : (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {naoBateSel && (
            <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/50 text-[12px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <span className="text-base leading-none">🎩</span>
              <span><strong>Cargo de confiança</strong> — dispensado de bater ponto (CLT Art. 62 II). Não há batidas pra cruzar: a sugestão abaixo vem direto da <strong>escala prevista</strong>. Confira e feche pra registrar a praticada do mês.</span>
            </div>
          )}
          <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2">
            <div className="font-bold text-sm text-gray-900 dark:text-gray-100">
              {colSel?.nome} — {nomeMes(mes)}
              <span className="ml-2 text-[11px] font-normal text-gray-400">{totalFechados}/{totalFechaveis} fechados</span>
            </div>
            {!colSel?.emp && <span className="text-[10px] text-amber-600">sem empregado vinculado no app — não dá pra fechar</span>}
            {colSel?.emp && !previstaFechada && <span className="text-[10px] text-amber-600">feche a prevista do mês na Escala pra poder fechar o ponto</span>}
            {colSel?.emp && previstaFechada && (
              <div className="ml-auto flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={todosAbertosSel} onChange={() => setSelDias(todosAbertosSel ? new Set() : new Set(diasAbertos))} className="w-4 h-4 accent-indigo-600" />
                  Selecionar abertos
                </label>
                <button type="button" disabled={selDias.size === 0 || salvando || mesEncerrado} onClick={() => void fecharDias()}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                  {salvando ? "Fechando…" : `🔒 Fechar dias${selDias.size ? ` (${selDias.size})` : ""}`}
                </button>
              </div>
            )}
          </header>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {espelho.map((d) => {
              const dataBR = d.date.split("-").reverse().join("/");
              const wd = DIAS_PT[weekdayOf(d.date)];
              if (d.demitido) {
                return (
                  <div key={d.date} className="px-3 py-2 flex items-center gap-2.5 text-xs bg-rose-100/70 dark:bg-rose-900/30">
                    <span className="w-4 shrink-0" />
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold bg-rose-600 text-white">DM</span>
                    <span className="w-24 shrink-0 whitespace-nowrap text-gray-600 dark:text-gray-300 tabular-nums">{wd} {dataBR}</span>
                    <div className="min-w-0 flex-1 truncate text-rose-700 dark:text-rose-300 font-medium">Demitido (fora do contrato)</div>
                  </div>
                );
              }
              if (d.futuro) {
                return (
                  <div key={d.date} className="px-3 py-2 flex items-center gap-2.5 text-xs opacity-50">
                    <span className="w-4 shrink-0" />
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300">–</span>
                    <span className="w-24 shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400 tabular-nums">{wd} {dataBR}</span>
                    <div className="min-w-0 flex-1 truncate text-gray-400">data futura{d.prevista ? <span className="ml-2">· prev: {STATUS_LABEL[d.prevista] || d.prevista}</span> : null}</div>
                  </div>
                );
              }
              const st = statusDe(d.date);
              const fechado = fechadoEm(d.date);
              const editado = !fechado && edits[selEmp]?.[d.date] && edits[selEmp][d.date] !== d.sugerido;
              const vis = st ? STATUS_VIS[st] : null;
              const inc = naoBateSel
                ? { ocs: [] as Ocorrencia[], estado: null as EstadoDia | null, prazoEm: undefined as string | undefined, aprovacoes: [] as AprovacaoPendente[] }
                : inconsistDoDia(Number(selEmp), d.date);
              const incRot = inc.ocs[0] ? (ROTULOS[inc.ocs[0].tipo] || "").split(" (")[0] : "";
              const incExtra = inc.ocs.length > 1 ? ` +${inc.ocs.length - 1}` : "";
              const incTitle = inc.ocs.map((o) => ROTULOS[o.tipo]).join(" · ");
              return (
                <div key={d.date} className={`px-3 py-2 flex items-center gap-2.5 text-xs ${vis?.row || ""}`}>
                  {colSel?.emp && previstaFechada && !fechado ? (
                    <input type="checkbox" checked={selDias.has(d.date)} onChange={() => toggleDia(d.date)}
                      className="w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer" />
                  ) : (
                    <span className="w-4 shrink-0 text-center">{fechado ? "🔒" : ""}</span>
                  )}
                  {vis && <span className={`shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold ${vis.badge}`}>{vis.short}</span>}
                  <span className="w-24 shrink-0 whitespace-nowrap text-gray-600 dark:text-gray-300 tabular-nums">{wd} {dataBR}</span>
                  <div className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
                    {d.worked ? <span className="tabular-nums">{d.marks}</span>
                      : d.afastamento ? <span className="text-indigo-700 dark:text-indigo-300">{d.afastamento}</span>
                      : <span className="text-gray-400">sem batida</span>}
                    {d.prevista && <span className="ml-2 text-gray-400">· prev: {STATUS_LABEL[d.prevista] || d.prevista}</span>}
                  </div>
                  {inc.estado === "aprovar" && (
                    <span title="Ajuste do empregado aguardando aprovação" className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">a aprovar</span>
                  )}
                  {inc.estado === "enviado" && (
                    <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">enviado{inc.prazoEm ? ` · ${relogio(inc.prazoEm, now).txt}` : ""}</span>
                  )}
                  {inc.estado === "ciente" && (
                    <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">✓ ciente</span>
                  )}
                  {inc.estado === "aberto" && (
                    <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠ {incRot}{incExtra}</span>
                  )}
                  {!fechado && inc.estado === "aprovar" && colSel?.emp && (
                    <span className="shrink-0 flex gap-1">
                      <button type="button" title="Aprovar ajuste do empregado" disabled={salvando} onClick={() => void decidirDia(d.date, "APPROVED")}
                        className="w-7 h-7 rounded-md border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 text-[13px]">✅</button>
                      <button type="button" title="Reprovar ajuste do empregado" disabled={salvando} onClick={() => void decidirDia(d.date, "REPROVED")}
                        className="w-7 h-7 rounded-md border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40 text-[13px]">✗</button>
                    </span>
                  )}
                  {!fechado && inc.estado && inc.estado !== "aprovar" && colSel?.emp && (
                    <span className="shrink-0 flex gap-1">
                      <button type="button" title="Solicitar correção ao empregado (WhatsApp)" onClick={() => solicitarDia(d.date)}
                        className="w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-[13px]">💬</button>
                      <button type="button" title="Corrigir / lançar batida na Sólides" onClick={() => setModalBatidas({ employeeId: Number(selEmp), colaborador: colSel?.nome || "", data: d.date })}
                        className="w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-[13px]">🔧</button>
                      <button type="button" title="Lançar afastamento / férias" onClick={() => setModalAfast({ employeeId: Number(selEmp), colaborador: colSel?.nome || "", data: d.date })}
                        className="w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-[13px]">☂️</button>
                      {inc.estado !== "ciente" && (
                        <button type="button" title="Dar ciência (sem ação)" onClick={() => cienciaDia(d.date)}
                          className="w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-[13px]">✓</button>
                      )}
                    </span>
                  )}
                  {fechado ? (
                    <button type="button" disabled={salvando || mesEncerrado} onClick={() => void reabrirDia(d.date)}
                      className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40">
                      ↩︎ reabrir
                    </button>
                  ) : (
                    <select value={st || ""} onChange={(e) => setStatus(d.date, e.target.value as ScheduleStatus)}
                      className={`h-8 px-2 text-xs rounded-md border bg-white dark:bg-gray-900 dark:text-gray-100 shrink-0 ${editado ? "border-indigo-400 ring-1 ring-indigo-300" : "border-gray-300 dark:border-gray-700"}`}>
                      {STATUS_OPCOES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pdf && (
        <Modal title="👁 Espelho de ponto" onClose={fecharPdf} maxWidth="max-w-4xl">
          <div className="space-y-2">
            <object data={pdf.url} type="application/pdf" className="w-full h-[70vh] rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="p-6 text-center text-sm text-gray-500">
                Não deu pra exibir o PDF aqui (o Safari às vezes bloqueia).{" "}
                <button type="button" onClick={() => window.open(pdf.url, "_blank")} className="text-indigo-600 underline">Abrir em nova aba</button>.
              </div>
            </object>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => window.open(pdf.url, "_blank")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">↗ Abrir em nova aba</button>
              <a href={pdf.url} download={pdf.nome}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">⬇ Baixar PDF</a>
            </div>
          </div>
        </Modal>
      )}

      {modalBatidas && (
        <BatidasDiaModal
          info={modalBatidas}
          shortCode={shortCode}
          restaurantId={rid}
          por={por}
          onClose={() => setModalBatidas(null)}
          onChanged={() => { void carregar(); }}
        />
      )}
      {modalAfast && (
        <AfastamentoModal
          prefill={{ employeeId: modalAfast.employeeId, colaborador: modalAfast.colaborador, data: modalAfast.data }}
          roster={roster}
          shortCode={shortCode}
          restaurantId={rid}
          por={por}
          onClose={() => setModalAfast(null)}
          onDone={() => { setModalAfast(null); void carregar(); }}
        />
      )}
    </div>
  );
}
