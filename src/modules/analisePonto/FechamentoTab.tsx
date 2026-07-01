// ════════════════════════════════════════════════════════════════════════════
//  Fechamento de ponto — Passo 1: REVISÃO (sem gravar na escala ainda).
//
//  Mostra o espelho do mês por empregado, com status sugerido (cruza ponto +
//  prevista), editável dia a dia, e permite VISUALIZAR o PDF do espelho (Sólides).
//  O "Fechar folha do empregado" (gravar na praticada) entra no Passo 2.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { AjusteEscalaMeta, Cargo, Empregado, EscalaMes, Pessoa, Restaurant, ScheduleStatus } from "../../core/types";
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
// solId sintético (negativo) pra empregados do app que não estão na Sólides —
// serve só de chave de seleção; ids reais da Sólides são positivos, então não
// colide. Determinístico a partir do id do empregado (estável entre renders).
function synthSolId(empId: string): number {
  let h = 0;
  for (let i = 0; i < empId.length; i++) h = (Math.imul(h, 31) + empId.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1);
}
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataBR = (ymd: string) => ymd ? ymd.slice(8, 10) + "/" + ymd.slice(5, 7) : "—";
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
// Afastamento lançado na Sólides PELA NOSSA TELA (registro em pontoAuditoria).
type AfastamentoAudit = { id: string; tipo?: string; employeeId: number; motivo?: string; inicio?: string; fim?: string; diaInteiro?: boolean; em?: string };

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
  rid, activeRestaurant, empregados, cargos, pessoas, mesInicial, por,
}: {
  rid: string;
  activeRestaurant: Restaurant;
  empregados: Empregado[];
  cargos: Cargo[];
  pessoas: Pessoa[];
  mesInicial: string; // YYYY-MM
  por: { id: string; nome: string };
}) {
  const [mes, setMes] = useState(mesInicial);
  // Faixa de dias dentro do mês (padrão = mês inteiro). Permite conferir "todo
  // mundo fechado até o dia X" (ex.: pra pagar gorjeta/rescisão até certo dia).
  const [diaIni, setDiaIni] = useState(`${mesInicial}-01`);
  const [diaFim, setDiaFim] = useState("");
  useEffect(() => { const ds = diasDoMes(mes); setDiaIni(ds[0]); setDiaFim(ds[ds.length - 1]); }, [mes]);
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
  const [afastamentos, setAfastamentos] = useState<AfastamentoAudit[]>([]);
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
  // WhatsApp vem do cadastro da Pessoa (campo whatsapp), casado por CPF — mesma
  // prioridade da aba Inconsistências (Pessoa.whatsapp → fallback Empregado.telefone).
  const whatsPorCpf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pessoas) { const c = soDigitos(p.cpf); if (c && p.whatsapp) m.set(c, soDigitos(p.whatsapp)); }
    return m;
  }, [pessoas]);
  const telDoColaborador = (emp?: Empregado): string =>
    (emp?.cpf ? whatsPorCpf.get(soDigitos(emp.cpf)) || "" : "") || soDigitos(emp?.telefone);
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
    // Afastamentos lançados na Sólides pela nossa tela (auditoria, tipo=afastamento).
    const u3 = onSnapshot(query(collection(db, "pontoAuditoria"), where("restaurantId", "==", rid)),
      (s) => setAfastamentos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AfastamentoAudit).filter((a) => a.tipo === "afastamento")));
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  // Relógio pro countdown das solicitações (atualiza a cada minuto).
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  // Ativos + demitidos RELEVANTES ao mês (saíram no mês ou depois) — sem o
  // histórico inteiro de demitidos antigos.
  const colaboradores = useMemo(() => {
    const monthStart = `${mes}-01`;
    const [my, mm] = mes.split("-").map(Number);
    const monthEnd = `${mes}-${String(new Date(my, mm, 0).getDate()).padStart(2, "0")}`;
    const rosterCols = roster
      .filter((r) => typeof r.id === "number")
      .map((r) => ({ solId: r.id as number, nome: r.name || "?", emp: empAppPorCpf.get(soDigitos(r.cpf)) as Empregado | undefined, demissao: demissaoYmd(r), fired: !!r.fired, appOnly: false }))
      .filter((c) => !c.fired || (c.demissao ? c.demissao >= monthStart : false));
    // Empregados do app que NÃO batem ponto e NÃO estão na Sólides (ex: freela
    // mensalista). Entram aqui pra dar pra revisar a prevista e fechar a
    // praticada — sem batidas pra cruzar (a sugestão vem da escala prevista).
    const cpfsRoster = new Set(roster.map((r) => soDigitos(r.cpf)).filter(Boolean));
    const appOnly = empregados
      .filter((e) => {
        if (e.cpf && cpfsRoster.has(soDigitos(e.cpf))) return false;   // já está na Sólides
        const cargo = e.cargoId ? cargoPorId.get(e.cargoId) : undefined;
        if (empregadoBatePonto(e, cargo)) return false;               // bate ponto → fluxo normal
        return (e.periodos || []).some((p) => p.admissao <= monthEnd && (!p.demissao || p.demissao > monthStart));
      })
      .map((e) => ({ solId: synthSolId(e.id), nome: e.nome, emp: e as Empregado | undefined, demissao: (e.demitidoEm || undefined) as string | undefined, fired: !e.estaAtivo, appOnly: true }));
    return [...rosterCols, ...appOnly].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [roster, empAppPorCpf, empregados, cargoPorId, mes]);
  type ColabItem = (typeof colaboradores)[number];

  const hojeYmd = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);

  // Status de fechamento por colaborador (pros chips). "fechado" = todos os dias
  // do contrato até hoje já fechados (solides_sync); "aberto" = ainda tem dias a
  // fechar; "sem_vinculo" = sem empregado no app (não dá pra fechar).
  // Dias do mês dentro da faixa selecionada [diaIni, diaFim].
  const diasPeriodo = useMemo(
    () => diasDoMes(mes).filter((d) => (!diaIni || d >= diaIni) && (!diaFim || d <= diaFim)),
    [mes, diaIni, diaFim],
  );

  const statusFechCol = useMemo(() => {
    const map = new Map<number, "fechado" | "aberto" | "sem_vinculo">();
    for (const c of colaboradores) {
      if (!c.emp) { map.set(c.solId, "sem_vinculo"); continue; }
      const aj = escala?.realAjustes?.[c.emp.id] || {};
      let pendentes = 0;
      for (const d of diasPeriodo) {
        if (c.demissao && d > c.demissao) continue;  // fora do contrato
        if (d >= hojeYmd) continue;                  // hoje (em curso) e futuro não contam — verde = fechado até ontem
        if ((aj[d] as AjusteEscalaMeta | undefined)?.origem === "solides_sync") continue;
        pendentes++;
      }
      map.set(c.solId, pendentes === 0 ? "fechado" : "aberto");
    }
    return map;
  }, [colaboradores, escala, diasPeriodo, hojeYmd]);

  // Agregado do período: todos fechados? (ignora sem_vínculo)
  const resumoFech = useMemo(() => {
    let fechados = 0, abertos = 0, semVinculo = 0;
    for (const c of colaboradores) {
      const st = statusFechCol.get(c.solId);
      if (st === "fechado") fechados++; else if (st === "aberto") abertos++; else semVinculo++;
    }
    return { fechados, abertos, semVinculo, total: colaboradores.length };
  }, [colaboradores, statusFechCol]);

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

  // Afastamento lançado na Sólides (pela nossa tela) por dia: employeeId|date →
  // { motivo, detalhe }. detalhe diz QUEM lançou, QUANDO e o PERÍODO — pra não
  // parecer que "apareceu sozinho" (o período inteiro é pintado a partir de UM lançamento).
  const afastamentoPorDia = useMemo(() => {
    const m = new Map<string, { motivo: string; detalhe: string }>();
    for (const a of afastamentos) {
      if (!a.inicio || !a.fim || typeof a.employeeId !== "number") continue;
      const motivo = a.motivo || "Afastamento";
      const quando = a.em ? new Date(a.em).toLocaleDateString("pt-BR") : "—";
      const detalhe = `"${motivo}" — lançado pela nossa tela em ${quando}, cobrindo ${fmtDataBR(a.inicio)} a ${fmtDataBR(a.fim)} (1 lançamento pinta o período todo). Confirmado na Sólides.`;
      for (const d of diasDoMes(mes)) {
        if (d >= a.inicio && d <= a.fim) m.set(`${a.employeeId}|${d}`, { motivo, detalhe });
      }
    }
    return m;
  }, [afastamentos, mes]);

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

  // Espelho de UM colaborador: 1 linha por dia do mês. Extraído numa função
  // pra dar pra computar o de todos (visão "dias pendentes"), não só o selecionado.
  const espelhoDe = useCallback((col: ColabItem | undefined): DiaEspelho[] => {
    if (!col) return [];
    const solId = col.solId;
    const appId = col.emp?.id;
    const dem = col.demissao;
    const naoBate = !!col.emp && !empregadoBatePonto(col.emp, col.emp.cargoId ? cargoPorId.get(col.emp.cargoId) : undefined);
    const prevista = appId ? escala?.prevista?.[appId] : undefined;
    const porDia = new Map<string, SolidesPunch[]>();
    for (const p of punches) {
      if (p.employeeId !== solId || (p as { excluded?: boolean }).excluded) continue;
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
  }, [escala, punches, mes, cargoPorId, hojeYmd]);

  const espelho = useMemo<DiaEspelho[]>(
    () => (selEmp ? espelhoDe(colaboradores.find((c) => c.solId === selEmp)) : []),
    [espelhoDe, colaboradores, selEmp],
  );

  const colSel = colaboradores.find((c) => c.solId === selEmp);
  const naoBateSel = naoBatePontoDe(colSel?.emp);
  const appOnlySel = !!colSel?.appOnly;   // não bate ponto E não está na Sólides
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
  // Muda o status de um dia de UM colaborador (por solId): feedback imediato +
  // rascunho persistente (não fecha o dia). Separado da escala.real pra não
  // afetar gorjeta/VT antes do fechamento.
  const setStatusDe = (solId: number, date: string, s: ScheduleStatus) => {
    setEdits((cur) => ({ ...cur, [solId]: { ...(cur[solId] || {}), [date]: s } }));
    if (rid) {
      void setDoc(
        doc(db, "pontoRascunhos", `${rid}_${solId}_${mes}`),
        { restaurantId: rid, employeeId: solId, anoMes: mes, statuses: { [date]: s }, updatedAt: new Date().toISOString() },
        { merge: true },
      ).catch((e) => console.error("[pontoRascunho setStatus]", e));
    }
  };
  // Status exibido de um dia de QUALQUER colaborador (por solId + appId).
  const statusDeCol = (solId: number, appId: string | undefined, d: DiaEspelho): ScheduleStatus | undefined => {
    if (appId && (escala?.realAjustes?.[appId]?.[d.date] as AjusteEscalaMeta | undefined)?.origem === "solides_sync") {
      return escala?.real?.[appId]?.[d.date];
    }
    return edits[solId]?.[d.date] ?? d.sugerido;
  };

  // Carrega os rascunhos de status persistidos de TODOS os colaboradores do
  // mês e semeia em `edits` — assim tanto a visão por-colaborador quanto a de
  // dias pendentes mostram o que foi escolhido mesmo sem o dia ter sido fechado.
  // Query só por restaurantId (sem índice composto); filtra o mês no cliente.
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pontoRascunhos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEdits((cur) => {
        const next = { ...cur };
        snap.forEach((d) => {
          const data = d.data() as { employeeId?: number; anoMes?: string; statuses?: Record<string, ScheduleStatus> };
          if (data.anoMes !== mes || typeof data.employeeId !== "number") return;
          next[data.employeeId] = { ...(data.statuses || {}), ...(next[data.employeeId] || {}) };
        });
        return next;
      });
    }, (e) => console.error("[pontoRascunho load]", e));
    return () => unsub();
  }, [rid, mes]);

  // limpa seleção ao trocar de colaborador/mês
  useEffect(() => { setSelDias(new Set()); }, [selEmp, mes]);

  // ── Visão "Dias pendentes de todos" ──────────────────────────────────────
  // Em vez de fechar colaborador por colaborador, lista TODOS os dias em aberto
  // (passados, não fechados) de todos os empregados, agrupados por pessoa, pra
  // fechar em lote — prático quando falta só 1-2 dias de todo mundo.
  const [visao, setVisao] = useState<"colaborador" | "pendentes">("colaborador");
  const [pendSel, setPendSel] = useState<Set<string>>(new Set());   // key `${appId}|${date}`
  useEffect(() => { setPendSel(new Set()); }, [visao, mes, diaIni, diaFim]);

  const pendentesPorEmp = useMemo(() => {
    if (visao !== "pendentes") return [] as { col: ColabItem; appId: string; dias: DiaEspelho[] }[];
    const out: { col: ColabItem; appId: string; dias: DiaEspelho[] }[] = [];
    for (const col of colaboradores) {
      if (!col.emp) continue;                       // sem vínculo → não dá pra fechar
      const appId = col.emp.id;
      const aj = escala?.realAjustes?.[appId] || {};
      const dias = espelhoDe(col).filter((d) =>
        !d.demitido && !d.futuro
        && d.date < hojeYmd                          // só dias já passados
        && (!diaIni || d.date >= diaIni) && (!diaFim || d.date <= diaFim)
        && (aj[d.date] as AjusteEscalaMeta | undefined)?.origem !== "solides_sync",
      );
      if (dias.length) out.push({ col, appId, dias });
    }
    return out;
  }, [visao, colaboradores, escala, espelhoDe, hojeYmd, diaIni, diaFim]);

  const pendKeys = useMemo(
    () => pendentesPorEmp.flatMap((g) => g.dias.map((d) => `${g.appId}|${d.date}`)),
    [pendentesPorEmp],
  );
  const totalPendentes = pendKeys.length;
  const todosPendSel = totalPendentes > 0 && pendKeys.every((k) => pendSel.has(k));
  const togglePend = (k: string) => setPendSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleTodosPend = () => setPendSel(todosPendSel ? new Set() : new Set(pendKeys));

  async function fecharPendentesSel() {
    if (!previstaFechada) { setErro("Feche a PREVISTA do mês primeiro (no módulo de Escala)."); return; }
    if (mesEncerrado) { setErro("Mês já encerrado — reabra no módulo de Escala pra editar a praticada."); return; }
    const pairs: { appId: string; date: string; status: ScheduleStatus }[] = [];
    for (const g of pendentesPorEmp) for (const d of g.dias) {
      const k = `${g.appId}|${d.date}`;
      if (pendSel.has(k)) pairs.push({ appId: g.appId, date: d.date, status: statusDeCol(g.col.solId, g.appId, d) ?? d.sugerido });
    }
    if (!pairs.length) { setErro("Selecione ao menos 1 dia."); return; }
    const nPessoas = new Set(pairs.map((p) => p.appId)).size;
    if (!window.confirm(`Fechar ${pairs.length} dia(s) de ${nPessoas} colaborador(es)?\n\nSobe pra escala PRATICADA do mês.`)) return;
    setErro(""); setSalvando(true);
    try {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = { updatedAt: now };
      for (const { appId, date, status } of pairs) {
        const ant = escala?.real?.[appId]?.[date];
        updates[`real.${appId}.${date}`] = status;
        updates[`realAjustes.${appId}.${date}`] = {
          origem: "solides_sync", ajustadoEm: now, ajustadoPor: por.id, ajustadoPorNome: por.nome,
          ...(ant ? { statusAnterior: ant } : {}),
        } satisfies AjusteEscalaMeta;
      }
      await updateDoc(doc(db, "escalas", `${rid}_${mes}`), updates);
      // limpa rascunhos das datas fechadas, por colaborador
      const porEmp = new Map<string, string[]>();
      for (const { appId, date } of pairs) { const arr = porEmp.get(appId) || []; arr.push(date); porEmp.set(appId, arr); }
      for (const [appId, datas] of porEmp) {
        const col = colaboradores.find((c) => c.emp?.id === appId);
        if (!col) continue;
        const statusesLimpar: Record<string, unknown> = {};
        for (const d of datas) statusesLimpar[d] = deleteField();
        void setDoc(doc(db, "pontoRascunhos", `${rid}_${col.solId}_${mes}`), { statuses: statusesLimpar }, { merge: true }).catch(() => {});
      }
      setPendSel(new Set());
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao fechar os dias.");
    } finally { setSalvando(false); }
  }

  const toggleDia = (date: string) => setSelDias((s) => {
    const n = new Set(s); n.has(date) ? n.delete(date) : n.add(date); return n;
  });
  const diasAbertos = espelho.filter((d) => !fechadoEm(d.date) && !d.demitido && !d.futuro).map((d) => d.date);
  const todosAbertosSel = diasAbertos.length > 0 && diasAbertos.every((d) => selDias.has(d));
  const totalFechados = espelho.filter((d) => fechadoEm(d.date)).length;
  const totalFechaveis = espelho.filter((d) => !d.demitido && !d.futuro).length;

  // Dias do empregado com ajuste aguardando aprovação (estado "aprovar").
  // Base pra aprovação em lote do colaborador selecionado.
  const diasAprovaveis = (selEmp === "" || naoBateSel)
    ? []
    : espelho
        .filter((d) => !d.demitido && !d.futuro && !fechadoEm(d.date)
          && inconsistDoDia(Number(selEmp), d.date).estado === "aprovar")
        .map((d) => d.date);

  // ── Ações inline de inconsistência (mesma lógica da aba Inconsistências) ──
  // Núcleo: monta UMA mensagem de WhatsApp com TODAS as ocorrências passadas e
  // registra UMA solicitação (usado tanto pelo 💬 do dia quanto pelo lote).
  function enviarCorrecaoOcsPara(col: ColabItem, ocs: Ocorrencia[]) {
    if (!ocs.length) return;
    const tel = telDoColaborador(col.emp);
    if (!tel) { alert(`${col.nome} não tem WhatsApp/telefone no cadastro (Pessoa ou Empregado). Cadastre pra poder enviar a correção.`); return; }
    const ordenadas = [...ocs].sort((a, b) => a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo));
    const prazoHoras = 6;
    const prazoEm = new Date(Date.now() + prazoHoras * 3_600_000).toISOString();
    window.open(waLink(tel, montarMensagem(col.nome, ordenadas, prazoEm)), "_blank");
    const itens = ordenadas.map((o) => ({ key: ocKey(o.employeeId, o.data, o.tipo), tipo: o.tipo, data: o.data, rotulo: ROTULOS[o.tipo] }));
    void addDoc(collection(db, "pontoSolicitacoes"), {
      restaurantId: rid, employeeId: col.solId, colaborador: col.nome, itens,
      enviadoEm: new Date().toISOString(), prazoHoras, prazoEm,
      por: { id: por.id, nome: por.nome }, status: "enviado",
    }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar a solicitação."));
  }
  function enviarCorrecaoOcs(ocs: Ocorrencia[]) { if (colSel) enviarCorrecaoOcsPara(colSel, ocs); }
  function solicitarDiaDe(col: ColabItem, date: string) {
    enviarCorrecaoOcsPara(col, inconsistDoDia(col.solId, date).ocs);
  }
  // Lote: junta as ocorrências de TODOS os dias selecionados (que tenham
  // inconsistência aberta, ainda não lançada como afastamento) em 1 mensagem.
  const diasSelComInconsist = selEmp === "" ? [] : [...selDias].filter((d) => {
    if (afastamentoPorDia.get(`${Number(selEmp)}|${d}`)) return false;
    return inconsistDoDia(Number(selEmp), d).ocs.length > 0;
  });
  function solicitarSelecionados() {
    if (selEmp === "") return;
    const ocs = diasSelComInconsist.flatMap((d) => inconsistDoDia(Number(selEmp), d).ocs);
    if (!ocs.length) { setErro("Nenhum dia selecionado com inconsistência pra solicitar."); return; }
    enviarCorrecaoOcs(ocs);
    setSelDias(new Set());
  }
  function cienciaDiaDe(solId: number, date: string) {
    const ocs = inconsistDoDia(solId, date).ocs;
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
  async function decidirDiaDe(solId: number, nome: string, date: string, status: "APPROVED" | "REPROVED") {
    const aps = inconsistDoDia(solId, date).aprovacoes;
    if (!aps.length) return;
    const verbo = status === "APPROVED" ? "Aprovar" : "Reprovar";
    if (!window.confirm(`${verbo} ${aps.length} ajuste(s) de ${nome} em ${date.split("-").reverse().join("/")}?\n\nGrava na Sólides (dado trabalhista).`)) return;
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
  // ── Linha do espelho (reutilizada nas 2 visões) ──────────────────────────
  // Mesmas cores por status, badges de inconsistência e ações (aprovar,
  // solicitar correção, corrigir batida, afastamento, ciência) — parametrizada
  // por colaborador, então funciona tanto no "por colaborador" quanto no
  // "dias pendentes de todos".
  function linhaEspelho(col: ColabItem, d: DiaEspelho, opts: {
    selecionado: boolean; onToggleSel?: () => void; podeSelecionar: boolean; fechado: boolean; onReabrir?: () => void;
  }) {
    const solId = col.solId;
    const appId = col.emp?.id;
    const dataBR = d.date.split("-").reverse().join("/");
    const wd = DIAS_PT[weekdayOf(d.date)];
    const kk = `${solId}-${d.date}`;
    if (d.demitido) return (
      <div key={kk} className="px-3 py-2 flex items-center gap-2.5 text-xs bg-rose-100/70 dark:bg-rose-900/30">
        <span className="w-4 shrink-0" />
        <span className="shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold bg-rose-600 text-white">DM</span>
        <span className="w-24 shrink-0 whitespace-nowrap text-gray-600 dark:text-gray-300 tabular-nums">{wd} {dataBR}</span>
        <div className="min-w-0 flex-1 truncate text-rose-700 dark:text-rose-300 font-medium">Demitido (fora do contrato)</div>
      </div>
    );
    if (d.futuro) return (
      <div key={kk} className="px-3 py-2 flex items-center gap-2.5 text-xs opacity-50">
        <span className="w-4 shrink-0" />
        <span className="shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300">–</span>
        <span className="w-24 shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400 tabular-nums">{wd} {dataBR}</span>
        <div className="min-w-0 flex-1 truncate text-gray-400">data futura{d.prevista ? <span className="ml-2">· prev: {STATUS_LABEL[d.prevista] || d.prevista}</span> : null}</div>
      </div>
    );
    const st = statusDeCol(solId, appId, d);
    const editado = !opts.fechado && edits[solId]?.[d.date] && edits[solId][d.date] !== d.sugerido;
    const vis = st ? STATUS_VIS[st] : null;
    const naoBate = naoBatePontoDe(col.emp);
    const inc = naoBate
      ? { ocs: [] as Ocorrencia[], estado: null as EstadoDia | null, prazoEm: undefined as string | undefined, aprovacoes: [] as AprovacaoPendente[] }
      : inconsistDoDia(solId, d.date);
    const incRot = inc.ocs[0] ? (ROTULOS[inc.ocs[0].tipo] || "").split(" (")[0] : "";
    const incExtra = inc.ocs.length > 1 ? ` +${inc.ocs.length - 1}` : "";
    const incTitle = inc.ocs.map((o) => ROTULOS[o.tipo]).join(" · ");
    const afastLancado = afastamentoPorDia.get(`${solId}|${d.date}`);
    const temEmp = !!col.emp;
    const btn = "w-7 h-7 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-[13px]";
    return (
      <div key={kk} className={`px-3 py-2 flex items-center gap-2.5 text-xs ${vis?.row || ""}`}>
        {opts.podeSelecionar && opts.onToggleSel ? (
          <input type="checkbox" checked={opts.selecionado} onChange={opts.onToggleSel} className="w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer" />
        ) : (
          <span className="w-4 shrink-0 text-center">{opts.fechado ? "🔒" : ""}</span>
        )}
        {vis && <span className={`shrink-0 inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold ${vis.badge}`}>{vis.short}</span>}
        <span className="w-24 shrink-0 whitespace-nowrap text-gray-600 dark:text-gray-300 tabular-nums">{wd} {dataBR}</span>
        <div className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
          {d.worked ? <span className="tabular-nums">{d.marks}</span>
            : d.afastamento ? <span className="text-indigo-700 dark:text-indigo-300">{d.afastamento}</span>
            : <span className="text-gray-400">sem batida</span>}
          {d.prevista && <span className="ml-2 text-gray-400">· prev: {STATUS_LABEL[d.prevista] || d.prevista}</span>}
        </div>
        {afastLancado && (
          <span title={afastLancado.detalhe} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">☂️ {afastLancado.motivo} · Sólides ✓</span>
        )}
        {!afastLancado && inc.estado === "aprovar" && (
          <span title="Ajuste do empregado aguardando aprovação" className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">a aprovar</span>
        )}
        {!afastLancado && inc.estado === "enviado" && (
          <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">enviado{inc.prazoEm ? ` · ${relogio(inc.prazoEm, now).txt}` : ""}</span>
        )}
        {!afastLancado && inc.estado === "ciente" && (
          <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">✓ ciente</span>
        )}
        {!afastLancado && inc.estado === "aberto" && (
          <span title={incTitle} className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">⚠ {incRot}{incExtra}</span>
        )}
        {!afastLancado && !opts.fechado && inc.estado === "aprovar" && temEmp && (
          <span className="shrink-0 flex gap-1">
            <button type="button" title="Aprovar ajuste do empregado" disabled={salvando} onClick={() => void decidirDiaDe(solId, col.nome, d.date, "APPROVED")}
              className="w-7 h-7 rounded-md border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 text-[13px]">✅</button>
            <button type="button" title="Reprovar ajuste do empregado" disabled={salvando} onClick={() => void decidirDiaDe(solId, col.nome, d.date, "REPROVED")}
              className="w-7 h-7 rounded-md border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40 text-[13px]">✗</button>
          </span>
        )}
        {!afastLancado && !opts.fechado && inc.estado && inc.estado !== "aprovar" && temEmp && (
          <span className="shrink-0 flex gap-1">
            <button type="button" title="Solicitar correção ao empregado (WhatsApp)" onClick={() => solicitarDiaDe(col, d.date)} className={btn}>💬</button>
            <button type="button" title="Corrigir / lançar batida na Sólides" onClick={() => setModalBatidas({ employeeId: solId, colaborador: col.nome, data: d.date })} className={btn}>🔧</button>
            <button type="button" title="Lançar afastamento / férias" onClick={() => setModalAfast({ employeeId: solId, colaborador: col.nome, data: d.date })} className={btn}>☂️</button>
            {inc.estado !== "ciente" && (
              <button type="button" title="Dar ciência (sem ação)" onClick={() => cienciaDiaDe(solId, d.date)} className={btn}>✓</button>
            )}
          </span>
        )}
        {opts.fechado ? (
          <button type="button" disabled={salvando || mesEncerrado} onClick={opts.onReabrir}
            className="shrink-0 text-[11px] font-medium px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40">
            ↩︎ reabrir
          </button>
        ) : (
          <select value={st || ""} onChange={(e) => setStatusDe(solId, d.date, e.target.value as ScheduleStatus)}
            className={`h-8 px-2 text-xs rounded-md border bg-white dark:bg-gray-900 dark:text-gray-100 shrink-0 ${editado ? "border-indigo-400 ring-1 ring-indigo-300" : "border-gray-300 dark:border-gray-700"}`}>
            {STATUS_OPCOES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  // Aprova de uma vez TODOS os ajustes pendentes do colaborador selecionado
  // (todos os dias com estado "aprovar"). Útil quando o empregado ajustou
  // vários dias e estão todos "a aprovar".
  async function aprovarTodosPendentes() {
    if (selEmp === "" || diasAprovaveis.length === 0) return;
    const aps = diasAprovaveis.flatMap((date) => inconsistDoDia(Number(selEmp), date).aprovacoes);
    if (!aps.length) return;
    if (!window.confirm(
      `Aprovar ${aps.length} ajuste(s) de ${colSel?.nome} em ${diasAprovaveis.length} dia(s)?\n\n` +
      `Grava na Sólides (dado trabalhista).`,
    )) return;
    setErro(""); setSalvando(true);
    try {
      for (const a of aps) {
        await decidirAprovacao(shortCode, { punchId: a.punchId, status: "APPROVED" });
        try {
          await addDoc(collection(db, "pontoAuditoria"), {
            restaurantId: rid, tipo: "aprovacao", status: "APPROVED", por: { id: por.id, nome: por.nome },
            punchId: a.punchId, employeeId: a.employeeId, colaborador: a.employeeName, em: new Date().toISOString(),
          });
        } catch { /* auditoria não bloqueia */ }
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aprovar os pontos.");
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
      // Dia fechado → limpa o rascunho dessas datas (a fonte agora é a praticada).
      const statusesLimpar: Record<string, unknown> = {};
      for (const d of dias) statusesLimpar[d] = deleteField();
      void setDoc(doc(db, "pontoRascunhos", `${rid}_${selEmp}_${mes}`), { statuses: statusesLimpar }, { merge: true })
        .catch((e) => console.error("[pontoRascunho limpeza]", e));
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
          {/* Faixa de dias dentro do mês (padrão = mês inteiro) */}
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">De</label>
            <input type="date" value={diaIni} min={`${mes}-01`} max={diaFim || undefined} onChange={(e) => setDiaIni(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Até</label>
            <input type="date" value={diaFim} min={diaIni || `${mes}-01`} max={diasDoMes(mes).at(-1)} onChange={(e) => setDiaFim(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          {(() => { const ds = diasDoMes(mes); const cheio = diaIni === ds[0] && diaFim === ds[ds.length - 1]; return !cheio ? (
            <button type="button" onClick={() => { setDiaIni(ds[0]); setDiaFim(ds[ds.length - 1]); }}
              className="h-9 px-3 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 self-end">Mês inteiro</button>
          ) : null; })()}
          <div className="flex-1" />
          <button type="button" onClick={() => void carregar()} disabled={carregando}
            title="Recarregar batidas, escala e inconsistências do mês"
            className="h-9 px-4 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap">
            {carregando ? "Atualizando…" : "🔄 Atualizar"}
          </button>
          {selEmp !== "" && !appOnlySel && (
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

      {/* Toggle de visão */}
      {colaboradores.length > 0 && (
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          <button type="button" onClick={() => setVisao("colaborador")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${visao === "colaborador" ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
            👤 Por colaborador
          </button>
          <button type="button" onClick={() => setVisao("pendentes")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md ${visao === "pendentes" ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500 dark:text-gray-400"}`}>
            📋 Dias pendentes de todos
          </button>
        </div>
      )}

      {/* Banner agregado do período */}
      {visao === "colaborador" && colaboradores.length > 0 && (
        resumoFech.abertos === 0 ? (
          <div className="text-sm rounded-xl px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-medium">
            ✓ Todos fechados de {fmtDataBR(diaIni)} a {fmtDataBR(diaFim)} — {resumoFech.fechados} colaborador(es){resumoFech.semVinculo > 0 ? ` · ${resumoFech.semVinculo} sem vínculo no app` : ""}.
          </div>
        ) : (
          <div className="text-sm rounded-xl px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium">
            ● {resumoFech.abertos} colaborador(es) com dias a fechar de {fmtDataBR(diaIni)} a {fmtDataBR(diaFim)} ({resumoFech.fechados} já fechados{resumoFech.semVinculo > 0 ? ` · ${resumoFech.semVinculo} sem vínculo` : ""}).
          </div>
        )
      )}

      {/* Chips por área — visão geral de quem já está fechado */}
      {visao === "colaborador" && colaboradores.length > 0 && (
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
                        <span className="truncate flex-1">{c.appOnly ? (c.emp?.freelaMensalista ? "🗓️ " : "📋 ") : naoBatePontoDe(c.emp) ? "🎩 " : ""}{c.nome}</span>
                        {c.appOnly && (
                          <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200"
                            title="Não bate ponto na Sólides — fecha pela escala prevista">
                            {c.emp?.freelaMensalista ? "FREELA" : "S/ PONTO"}
                          </span>
                        )}
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

      {visao === "colaborador" && (carregando ? (
        <div className="text-center text-sm text-gray-400 py-12">Carregando o mês…</div>
      ) : selEmp === "" ? (
        <div className="text-center text-sm text-gray-400 py-12">Escolha um colaborador pra revisar o espelho.</div>
      ) : (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {appOnlySel ? (
            <div className="px-4 py-2.5 bg-violet-50 dark:bg-violet-950/30 border-b border-violet-200 dark:border-violet-900/50 text-[12px] text-violet-800 dark:text-violet-200 flex items-start gap-2">
              <span className="text-base leading-none">📋</span>
              <span><strong>Não bate ponto na Sólides</strong> (ex: freela mensalista). Não há batidas pra cruzar — a sugestão abaixo vem da <strong>escala prevista</strong>. Revise dia a dia, declare se trabalhou e feche pra registrar na praticada (e entrar na gorjeta dos dias trabalhados).</span>
            </div>
          ) : naoBateSel && (
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
            {colSel?.emp && (
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {/* Aprovar em lote — independe da prevista fechada (ação na Sólides). */}
                {diasAprovaveis.length > 0 && (
                  <button type="button" disabled={salvando} onClick={() => void aprovarTodosPendentes()}
                    title={`Aprovar todos os ajustes pendentes de ${colSel?.nome} (${diasAprovaveis.length} dia(s))`}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                    {salvando ? "Aprovando…" : `✓ Aprovar pendentes (${diasAprovaveis.length})`}
                  </button>
                )}
                {previstaFechada && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={todosAbertosSel} onChange={() => setSelDias(todosAbertosSel ? new Set() : new Set(diasAbertos))} className="w-4 h-4 accent-indigo-600" />
                      Selecionar abertos
                    </label>
                    <button type="button" disabled={diasSelComInconsist.length === 0} onClick={() => solicitarSelecionados()}
                      title="Manda UM WhatsApp com todos os dias selecionados que têm inconsistência"
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                      💬 Solicitar correção{diasSelComInconsist.length ? ` (${diasSelComInconsist.length})` : ""}
                    </button>
                    <button type="button" disabled={selDias.size === 0 || salvando || mesEncerrado} onClick={() => void fecharDias()}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                      {salvando ? "Fechando…" : `🔒 Fechar dias${selDias.size ? ` (${selDias.size})` : ""}`}
                    </button>
                  </>
                )}
              </div>
            )}
          </header>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {colSel && espelho.map((d) => {
              const fechado = fechadoEm(d.date);
              return linhaEspelho(colSel, d, {
                selecionado: selDias.has(d.date),
                onToggleSel: () => toggleDia(d.date),
                podeSelecionar: !!colSel.emp && previstaFechada && !fechado,
                fechado,
                onReabrir: () => void reabrirDia(d.date),
              });
            })}
          </div>
        </section>
      ))}

      {/* ── Visão "Dias pendentes de todos" ── */}
      {visao === "pendentes" && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {carregando ? (
            <div className="text-center text-sm text-gray-400 py-12">Carregando o mês…</div>
          ) : !previstaFechada ? (
            <div className="p-4 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30">
              ⚠️ Feche a <strong>prevista</strong> do mês no módulo de Escala pra poder fechar os dias por aqui.
            </div>
          ) : totalPendentes === 0 ? (
            <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-12">
              ✓ Nenhum dia pendente de {fmtDataBR(diaIni)} a {fmtDataBR(diaFim)}.
            </div>
          ) : (
            <>
              <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2 sticky top-0 bg-white dark:bg-gray-900 z-10">
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={todosPendSel} onChange={toggleTodosPend} className="w-4 h-4 accent-indigo-600" />
                  Selecionar todos ({totalPendentes} dia(s) · {pendentesPorEmp.length} pessoa(s))
                </label>
                <div className="flex-1" />
                <span className="text-[11px] text-gray-400">{pendSel.size} selecionado(s)</span>
                <button type="button" disabled={pendSel.size === 0 || salvando || mesEncerrado} onClick={() => void fecharPendentesSel()}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                  {salvando ? "Fechando…" : `🔒 Fechar selecionados${pendSel.size ? ` (${pendSel.size})` : ""}`}
                </button>
              </header>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {pendentesPorEmp.map(({ col, appId, dias }) => {
                  const keysEmp = dias.map((d) => `${appId}|${d.date}`);
                  const todosDoEmp = keysEmp.every((k) => pendSel.has(k));
                  return (
                    <div key={appId} className="px-3 py-2.5">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer mb-1.5">
                        <input type="checkbox" checked={todosDoEmp}
                          onChange={() => setPendSel((s) => { const n = new Set(s); keysEmp.forEach((k) => todosDoEmp ? n.delete(k) : n.add(k)); return n; })}
                          className="w-4 h-4 accent-indigo-600" />
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{naoBatePontoDe(col.emp) ? "🎩 " : ""}{col.nome}</span>
                        <span className="text-[11px] text-gray-400">· {dias.length} dia(s) a fechar</span>
                      </label>
                      <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
                        {dias.map((d) => {
                          const k = `${appId}|${d.date}`;
                          return linhaEspelho(col, d, {
                            selecionado: pendSel.has(k),
                            onToggleSel: () => togglePend(k),
                            podeSelecionar: true,
                            fechado: false,
                          });
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {pdf && (
        <Modal title="👁 Espelho de ponto" onClose={fecharPdf} maxWidth="max-w-4xl">
          <div className="space-y-2">
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
              ℹ️ Este é o <strong>espelho oficial da Sólides</strong>: ele só cobre até o
              <strong> fechamento da competência da folha</strong> de cada colaborador. Dias mais
              recentes (ainda na competência aberta) entram na próxima folha e podem não aparecer
              aqui — mesmo já tendo batida. Pra conferência do dia-a-dia em tempo real, use a lista
              de dias acima (cruza as batidas direto da Sólides).
            </div>
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
