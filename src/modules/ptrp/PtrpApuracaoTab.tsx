// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Conferência / Apuração (prévia). Cruza as batidas sincronizadas
//  (ptrpBatidas, por shortCode = empresa) com o HORÁRIO PREVISTO do cadastro do
//  empregado (workSchedules — casado por CPF) e a CCT, e apura por colaborador
//  × dia. Não exige re-cadastro de turno: o previsto vem do vínculo/escala do
//  empregado (mesma fonte da Análise de Ponto). ptrpTurnos/ptrpEscalas ficam
//  como OVERRIDE opcional (fase seguinte). Valida contra o Sólides (Fase 1).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Empregado, HorarioDia, Cargo, EscalaMes, ScheduleStatus } from "../../core/types";
import { empregadoBatePonto } from "../../core/types";
import type { ParametrosCCT, PtrpTurno, PtrpAjuste, PtrpAjusteTipo, PtrpBancoMov, PtrpApuracaoColab, PtrpApuracaoDia, PtrpFechamento } from "../../core/ptrp/tipos";
import { cctVigenteEm } from "../../core/ptrp/tipos";
import { gerarEspelhoPDF } from "../../core/ptrp/espelhoPDF";
import { gerarAEJ } from "../../core/ptrp/aej";
import { baixarOuCompartilhar } from "../../core/pdf/baixarOuCompartilhar";
import { DEV_PADRAO, REP_PADRAO, type ParametrosPTRP } from "./PtrpAejConfig";
import { PtrpAssinaturasModal, type AlvoAssinatura } from "./PtrpAssinaturasModal";
import { getActiveWorkSchedule, getEffectiveDays } from "../../core/escala/horarios";
import { apurarDia, minutoDoDiaBRT, hhmmToMin, type BatidaBloco, type AjusteDia } from "../../core/ptrp/apuracao";
import { feriadosDoAno } from "../../core/ptrp/feriados";
import { fetchRoster, decidirAprovacao, corrigirPontoAtraso, excluirBatida, fetchJustificativas } from "../../core/ponto/solidesPontoClient";
import type { Justificativa } from "../../core/ponto/solidesPontoClient";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { useTodasPessoas } from "../../core/pessoas/PessoasContext";
import type { PontoColaborador } from "../../core/ponto/analise";
import { nomeMes } from "../../core/utils/date";

const labelComp = (ym: string) => { const [y, m] = ym.split("-"); return `${nomeMes(Number(m))}/${y}`; };
const addMes = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

type BatidaDoc = { id: string; empresaKey: string; punchId?: string; employeeId?: string | null; cpf?: string | null; date?: string | null; dateIn?: number | null; dateOut?: number | null; excluded?: boolean; status?: string | null; edited?: boolean; raw?: { employee?: { name?: string }; employeeName?: string } };

// Correção AINDA NÃO aprovada no Sólides (o empregado/gestor pediu ajuste, mas
// não entrou no espelho oficial). Portaria 671: batida original ≠ tratamento.
// O espelho legal do Sólides só conta APPROVED — espelhamos isso: PENDING/REJECTED
// não somam horas, mas ficam VISÍVEIS na conferência (correção a aprovar).
const correcaoPendente = (b: BatidaDoc) => b.status === "PENDING" || b.status === "REJECTED";

const compAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const hm = (min: number) => min <= 0 ? "0h00" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const hmSigned = (min: number) => (min < 0 ? "−" : "+") + hm(Math.abs(min));
const somaDiasYmd = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const fmtDataBR = (ymd?: string | null) => ymd ? ymd.split("-").reverse().join("/") : "—";
const hhmm = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const hhmmN = (ms?: number | null) => ms == null ? null : hhmm(ms);
const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
const EXC_LABEL: Record<string, string> = { sem_batida: "sem batida", falta: "falta", fora_escala: "fora de escala", batida_impar: "batida ímpar", atraso: "atraso", intervalo_curto: "intervalo curto", jornada_longa: "jornada > limite", interjornada: "interjornada < mín.", correcao_pendente: "correção pendente" };
// Ícone por exceção (tooltip mostra o texto) — evita quebra de linha na coluna.
const EXC_ICON: Record<string, string> = { sem_batida: "⭕", falta: "❌", fora_escala: "📆", batida_impar: "3️⃣", atraso: "⏰", intervalo_curto: "☕", jornada_longa: "⏳", interjornada: "🛌", correcao_pendente: "🟡" };
// Exceções que o EMPREGADO resolve ajustando a própria marcação (esquecimento /
// batida ímpar / intervalo não registrado) → cabe pedir correção por WhatsApp.
const EXC_CORRIGIVEL = new Set(["batida_impar", "sem_batida", "intervalo_curto"]);
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
// Mesmo visual dos status da Escala (short + cor), pra a coluna Previsto bater.
const STATUS_INFO: Record<ScheduleStatus, { label: string; short: string; bg: string; text: string }> = {
  trabalho:  { label: "Trabalho", short: "TR", bg: "bg-emerald-500", text: "text-white" },
  folga:     { label: "Folga", short: "FO", bg: "bg-gray-300 dark:bg-gray-700", text: "text-gray-700 dark:text-gray-200" },
  freela:    { label: "Freela", short: "FR", bg: "bg-purple-500", text: "text-white" },
  comp:      { label: "Folga por compensação", short: "FC", bg: "bg-gray-500", text: "text-white" },
  comp_trab: { label: "Trabalho por compensação", short: "TC", bg: "bg-emerald-800", text: "text-white" },
  ferias:    { label: "Férias", short: "FE", bg: "bg-sky-500", text: "text-white" },
  falta_j:   { label: "Falta justificada", short: "FJ", bg: "bg-rose-300", text: "text-rose-900" },
  falta_i:   { label: "Falta injustificada", short: "FI", bg: "bg-rose-600", text: "text-white" },
};

const FOLGA_TIPOS = new Set<string>(["folga", "ferias", "falta_j", "falta_i", "afastamento"]);
const TRAB_TIPOS = new Set<string>(["trabalho", "comp_trab", "freela", "comp"]);

// Previsto do dia: HORÁRIO vem do vínculo (workSchedules → dia da semana). O
// STATUS do dia (folga × trabalho) é SOBREPOSTO pela ESCALA DO MÊS quando houver
// (alterações pontuais: folga trocada, dia mexido). statusEscala = célula da
// escala praticada/prevista daquele dia (ScheduleStatus).
function turnoPrevisto(emp: Empregado, date: string, statusEscala?: string): { kind: "trabalho" | "folga" | "implicito"; turno: PtrpTurno | null } {
  const ws = getActiveWorkSchedule(emp.workSchedules, date);
  const days = ws ? (getEffectiveDays(ws, date) as Record<number, HorarioDia> | null) : null;
  const dow = new Date(date + "T12:00:00").getDay();
  const hd = days ? days[dow] : null;
  const hdAtivo = !!(hd && hd.active && hd.in && hd.out);
  const turnoDoHd = (): PtrpTurno => {
    const partido = !!(hd!.intervalIn && hd!.intervalOut);
    const janelas = partido ? [{ in: hd!.in!, out: hd!.intervalIn! }, { in: hd!.intervalOut!, out: hd!.out! }] : [{ in: hd!.in!, out: hd!.out! }];
    return { id: "prev", empresaKey: "", nome: "previsto", janelas, intervaloMin: partido ? 0 : (hd!.break || 0), toleranciaEntradaMin: 5, adicionalNoturno: false };
  };
  // Escala do mês manda no STATUS do dia:
  if (statusEscala && FOLGA_TIPOS.has(statusEscala)) return { kind: "folga", turno: null };
  if (statusEscala && TRAB_TIPOS.has(statusEscala)) return hdAtivo ? { kind: "trabalho", turno: turnoDoHd() } : { kind: "implicito", turno: null };
  // Sem escala do mês → deriva só do vínculo (folga/trabalho pelo dia da semana).
  if (!ws || !days) return { kind: "implicito", turno: null };
  if (!hdAtivo) return { kind: "folga", turno: null };
  return { kind: "trabalho", turno: turnoDoHd() };
}

export function PtrpApuracaoTab({ mode = "conferencia" }: { mode?: "conferencia" | "banco" | "comparar" } = {}) {
  const { pessoa: me } = useAuth();
  // Segue o restaurante ATIVO do sistema (seletor global), como a Análise de Ponto.
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id || "";
  const shortCode = (activeRestaurant as { shortCode?: string } | null)?.shortCode || "";
  const [comp, setComp] = useState(compAtual());
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [batidas, setBatidas] = useState<BatidaDoc[]>([]);
  const [ajustes, setAjustes] = useState<PtrpAjuste[]>([]);
  const [ajusteModal, setAjusteModal] = useState<{ emp: Empregado; data: string; bs: BatidaDoc[] } | null>(null);
  const [ccts, setCcts] = useState<ParametrosCCT[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [bancoMovs, setBancoMovs] = useState<PtrpBancoMov[]>([]);
  const [registrando, setRegistrando] = useState(false);
  const [roster, setRoster] = useState<PontoColaborador[] | null>(null);
  const [carregandoRoster, setCarregandoRoster] = useState(false);
  const [rosterErr, setRosterErr] = useState("");
  const [mostrarComp, setMostrarComp] = useState(false);
  const [acaoBusy, setAcaoBusy] = useState(false);
  const [acaoMsg, setAcaoMsg] = useState("");
  const [selCorr, setSelCorr] = useState<Set<string>>(new Set());   // dias marcados p/ pedir correção (lote)
  const [corrModal, setCorrModal] = useState(false);
  const [ptrpCfg, setPtrpCfg] = useState<ParametrosPTRP>({});        // config AEJ (empregador/REP/desenvolvedor)
  const [fech, setFech] = useState<PtrpFechamento | null>(null);    // fechamento do mês (empresa+comp)
  const [fechBusy, setFechBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState("");                  // "espelho" | "espelhos" | "aej"
  const [preview, setPreview] = useState<{ url: string; blob: Blob; nome: string; titulo: string } | null>(null);
  const abrirWhatsapp = useAbrirWhatsapp();
  const pessoas = useTodasPessoas();
  // WhatsApp do empregado: Pessoa.whatsapp (por CPF) → fallback Empregado.telefone.
  const whatsPorCpf = useMemo(() => { const m = new Map<string, string>(); for (const p of pessoas) { const c = soDig(p.cpf); if (c && p.whatsapp) m.set(c, soDig(p.whatsapp)); } return m; }, [pessoas]);
  const emailPorCpf = useMemo(() => { const m = new Map<string, string>(); for (const p of pessoas) { const c = soDig(p.cpf); const e = (p as { email?: string }).email; if (c && e) m.set(c, e); } return m; }, [pessoas]);
  const [assModal, setAssModal] = useState(false);

  async function carregarRoster(silencioso = false) {
    if (!shortCode) return;
    setCarregandoRoster(true); setRosterErr(""); if (!silencioso) setMostrarComp(true);
    try { setRoster(await fetchRoster(shortCode, true)); }
    catch (e) { if (!silencioso) setRosterErr(e instanceof Error ? e.message : "Falha ao buscar o cadastro da Sólides."); }
    finally { setCarregandoRoster(false); }
  }
  useEffect(() => { setRoster(null); setMostrarComp(false); setRosterErr(""); }, [shortCode]);

  useEffect(() => onSnapshot(collection(db, "parametrosCCT"), s => setCcts(s.docs.map(d => ({ id: d.id, ...d.data() }) as ParametrosCCT))), []);
  useEffect(() => {
    if (!rid) { setEmpregados([]); setCargos([]); return; }
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), s => setEmpregados(s.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const u2 = onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)), s => setCargos(s.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo)));
    return () => { u1(); u2(); };
  }, [rid]);
  useEffect(() => {
    if (!shortCode || !comp) { setBatidas([]); return; }
    const q = query(collection(db, "ptrpBatidas"), where("empresaKey", "==", shortCode), where("date", ">=", `${comp}-01`), where("date", "<=", `${comp}-99`));
    return onSnapshot(q, s => setBatidas(s.docs.map(d => ({ id: d.id, ...d.data() }) as BatidaDoc)), () => setBatidas([]));
  }, [shortCode, comp]);
  useEffect(() => {
    // Escala do mês (prevista/praticada) — sobrepõe o status do dia (folga trocada etc.).
    if (!rid || !comp) { setEscala(null); return; }
    return onSnapshot(doc(db, "escalas", `${rid}_${comp}`), d => setEscala(d.exists() ? ({ id: d.id, ...d.data() } as EscalaMes) : null), () => setEscala(null));
  }, [rid, comp]);
  useEffect(() => {
    if (!shortCode) { setAjustes([]); return; }
    // Ajustes são poucos → filtra por empresa e recorta o mês no cliente (sem índice).
    return onSnapshot(query(collection(db, "ptrpAjustes"), where("empresaKey", "==", shortCode)),
      s => setAjustes(s.docs.map(d => ({ id: d.id, ...d.data() }) as PtrpAjuste).filter(a => (a.data || "").startsWith(comp))), () => setAjustes([]));
  }, [shortCode, comp]);
  useEffect(() => {
    if (!shortCode) { setBancoMovs([]); return; }
    return onSnapshot(query(collection(db, "ptrpBancoHoras"), where("empresaKey", "==", shortCode)),
      s => setBancoMovs(s.docs.map(d => ({ id: d.id, ...d.data() }) as PtrpBancoMov)), () => setBancoMovs([]));
  }, [shortCode]);
  // Troca de colaborador/mês/empresa → limpa a seleção de correção do lote.
  useEffect(() => { setSelCorr(new Set()); setCorrModal(false); setAcaoMsg(""); }, [aberto, comp, shortCode]);
  useEffect(() => onSnapshot(doc(db, "parametrosPTRP", "global"), d => setPtrpCfg(d.exists() ? (d.data() as ParametrosPTRP) : {})), []);
  // Fechamento do mês (empresa+competência) — trava a apuração quando "fechado".
  useEffect(() => {
    if (!shortCode || !comp) { setFech(null); return; }
    return onSnapshot(doc(db, "ptrpFechamentos", `${shortCode}_${comp}`), d => setFech(d.exists() ? ({ id: d.id, ...d.data() } as PtrpFechamento) : null), () => setFech(null));
  }, [shortCode, comp]);

  const cct = useMemo(() => cctVigenteEm(ccts, shortCode, `${comp}-15`), [ccts, shortCode, comp]);
  const [ano, mes] = comp.split("-").map(Number);
  const diasDoMes = new Date(ano, mes, 0).getDate();
  const mesesOpcoes = useMemo(() => { const out: string[] = []; let c = compAtual(); for (let i = 0; i < 24; i++) { out.push(c); c = addMes(c, -1); } return out; }, []);
  const feriadosSet = useMemo(() => feriadosDoAno(ano, cct), [ano, cct]);

  const cargoPorId = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos]);
  const areaDoEmp = (e: Empregado) => (cargoPorId[e.cargoId]?.area) || "";
  // Cargo de confiança / que NÃO bate ponto (usa o override do empregado ou o
  // default do cargo/vínculo). Esses não têm ponto na Sólides → sempre verde.
  const naoBatePonto = (e: Empregado) => !empregadoBatePonto(e, cargoPorId[e.cargoId]);
  // Só EQUIPE CLT ATIVA do planejamento.app (fonte da verdade de quem entra). Tira
  // demitidos/inativos e freela mensalista (não bate ponto).
  const empVis = useMemo(() => empregados.filter(e => e.estaAtivo && !e.freelaMensalista).sort((a, b) => a.nome.localeCompare(b.nome)), [empregados]);

  // Batidas por CPF → dia.
  const batidasPorCpf = useMemo(() => {
    const m: Record<string, Record<string, BatidaDoc[]>> = {};
    for (const b of batidas) { const c = soDig(b.cpf); if (!c) continue; (m[c] = m[c] || {}); (m[c][b.date || ""] = m[c][b.date || ""] || []).push(b); }
    return m;
  }, [batidas]);
  // employeeId do Sólides por CPF (das batidas) — pra aplicar correções lá.
  const empIdPorCpf = useMemo(() => { const m = new Map<string, string>(); for (const b of batidas) { const c = soDig(b.cpf); if (c && b.employeeId && !m.has(c)) m.set(c, String(b.employeeId)); } return m; }, [batidas]);
  // Ajustes (não cancelados) por CPF → dia.
  const ajustesPorCpf = useMemo(() => {
    const m: Record<string, Record<string, PtrpAjuste[]>> = {};
    for (const a of ajustes) { if (a.cancelado) continue; const c = soDig(a.cpf); if (!c) continue; (m[c] = m[c] || {}); (m[c][a.data] = m[c][a.data] || []).push(a); }
    return m;
  }, [ajustes]);

  type Linha = { data: string; bs: BatidaDoc[]; descPunch: Set<string>; decididos: Set<string>; ajustesDia: PtrpAjuste[]; previstoTxt: string; statusEscala?: ScheduleStatus; trabalhado: number; extra: number; noturno: number; previstoMin: number; atrasoMin: number; abonadoMin: number; excecoes: string[]; primeiraMs: number | null; ultimaMs: number | null; ehFeriado: boolean; ehFuturo: boolean; ehHoje: boolean };
  function apurarColab(emp: Empregado) {
    const cpf = soDig(emp.cpf);
    const dias = batidasPorCpf[cpf] || {};
    const ajDias = ajustesPorCpf[cpf] || {};
    const linhas: Linha[] = [];
    let saldoMes = 0;   // banco de horas do mês: Σ (trabalhado + abonado − previsto)
    const hojeStr = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    for (let d = 1; d <= diasDoMes; d++) {
      const data = `${comp}-${String(d).padStart(2, "0")}`;
      const bs = dias[data] || [];
      const ajustesDia = ajDias[data] || [];
      const ehFuturo = data > hojeStr;   // dia ainda não aconteceu (BRT)
      const ehHoje = data === hojeStr;   // dia em ANDAMENTO — não acusa erro ainda
      const statusEscala = escala ? (escala.real?.[emp.id]?.[data] ?? escala.prevista?.[emp.id]?.[data]) : undefined;
      const prev = turnoPrevisto(emp, data, statusEscala);
      // Mostra TODOS os dias do mês — inclusive folgas, dias sem batida e FUTUROS
      // (estes só com o previsto, sem virar falta e fora do saldo).
      // Desconsideração: remove a batida referida ANTES de apurar (imutável — só ignora).
      const descPunch = new Set(ajustesDia.filter(a => a.tipo === "desconsideracao" && a.punchId).map(a => a.punchId as string));
      // Batidas pendentes já DECIDIDAS (aprovada→inclusão / reprovada→desconsideração
      // carregam o punchId) — deixam de contar como "correção pendente".
      const decididos = new Set<string>([...descPunch, ...ajustesDia.filter(a => a.tipo === "inclusao" && a.punchId).map(a => a.punchId as string)]);
      // Só a batida EFETIVA (aprovada) entra na apuração — espelha o oficial.
      // A correção pendente é preservada em `bs` (aparece na linha), mas não soma.
      const blocos: BatidaBloco[] = bs.filter(b => !b.excluded && !correcaoPendente(b) && !(b.punchId && descPunch.has(b.punchId))).map(b => ({ dateIn: b.dateIn as number, dateOut: (b.dateOut ?? null) as number | null }));
      // Inclusões e abonos entram como lançamento no motor.
      const ajMotor: AjusteDia[] = [];
      for (const a of ajustesDia) {
        if (a.tipo === "inclusao" && a.in && a.out) ajMotor.push({ tipo: "inclusao", in: hhmmToMin(a.in), out: hhmmToMin(a.out) });
        else if (["abono", "atestado", "folga", "ferias", "afastamento"].includes(a.tipo)) ajMotor.push({ tipo: a.tipo as "abono", minutos: a.minutos || undefined });
      }
      const ehDomingo = new Date(data + "T12:00:00").getDay() === 0;
      const ehFeriado = feriadosSet.has(data);
      let trabalhado = 0, extra = 0, noturno = 0, previstoMin = 0, atrasoMin = 0, abonadoMin = 0, excecoes: string[] = [], previstoTxt = "—";
      if (prev.kind === "trabalho" && prev.turno) previstoTxt = prev.turno.janelas.map(j => `${j.in}–${j.out}`).join(" ");
      else if (prev.kind === "folga") previstoTxt = "folga";
      else previstoTxt = "sem cadastro";
      if (ehFuturo) {
        // Dia futuro: só o previsto aparece; nada de falta/exceção nem saldo.
        trabalhado = blocos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      } else if (cct && prev.kind !== "implicito") {
        const ap = apurarDia({ data, blocos, turno: prev.turno, cct, ehDomingo, ehFeriado, ajustes: ajMotor });
        trabalhado = ap.minutosTrabalhados; extra = ap.minutosExtras; noturno = ap.noturnoMin;
        excecoes = ehHoje ? [] : ap.excecoes;   // HOJE em andamento → sem erro (falta/ponto aberto só a partir de amanhã)
        previstoMin = ap.minutosPrevistos; atrasoMin = ap.atrasoMin; abonadoMin = ap.abonadoMin;
        if (!ehHoje) saldoMes += ap.minutosTrabalhados + ap.abonadoMin - ap.minutosPrevistos;   // hoje ainda não entra no saldo
      } else {
        trabalhado = blocos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      }
      // Correção não aprovada E ainda não decidida → pendência a tratar. Como a
      // batida pendente não conta, o motor marca falta/sem batida — mas a pessoa
      // BATEU (só aguarda aprovação): remove falta/sem batida e sinaliza pendência.
      if (!ehHoje && bs.some(b => correcaoPendente(b) && !(b.punchId && decididos.has(b.punchId)))) excecoes = [...excecoes.filter(e => e !== "falta" && e !== "sem_batida"), "correcao_pendente"];
      // Entrada/saída reais (ms) do dia — pra checar interjornada entre dias.
      const ins = blocos.map(b => b.dateIn).filter((x): x is number => typeof x === "number");
      const outs = blocos.map(b => b.dateOut).filter((x): x is number => typeof x === "number");
      const primeiraMs = ins.length ? Math.min(...ins) : null;
      const ultimaMs = outs.length ? Math.max(...outs) : null;
      linhas.push({ data, bs, descPunch, decididos, ajustesDia, previstoTxt, statusEscala: statusEscala as ScheduleStatus | undefined, trabalhado, extra, noturno, previstoMin, atrasoMin, abonadoMin, excecoes, primeiraMs, ultimaMs, ehFeriado, ehFuturo, ehHoje });
    }
    // Interjornada: descanso entre a última saída de um dia e a 1ª entrada do dia
    // seguinte (calendário) < mínimo da CCT → exceção no dia seguinte.
    const minInter = (cct?.interjornadaMinHoras || 11) * 3_600_000;
    for (let i = 1; i < linhas.length; i++) {
      const ant = linhas[i - 1], atu = linhas[i];
      const consecutivo = (Date.parse(atu.data) - Date.parse(ant.data)) === 86_400_000;
      if (consecutivo && !atu.ehHoje && !atu.ehFuturo && ant.ultimaMs != null && atu.primeiraMs != null && (atu.primeiraMs - ant.ultimaMs) < minInter && !atu.excecoes.includes("interjornada")) atu.excecoes.push("interjornada");
    }
    return { linhas, temCpf: !!cpf, saldoMes, totTrab: linhas.reduce((s, l) => s + l.trabalhado, 0), totExtra: linhas.reduce((s, l) => s + l.extra, 0), totNot: linhas.reduce((s, l) => s + l.noturno, 0), exc: linhas.reduce((s, l) => s + l.excecoes.length, 0) };
  }

  // Aprovar/Reprovar a correção pendente: grava a decisão na Sólides (PUT status,
  // espelho legal de hoje) E registra a trilha no app (Portaria 671) — aprovada
  // vira inclusão (passa a contar); reprovada vira desconsideração.
  async function decidirCorrecao(emp: Empregado, l: Linha, status: "APPROVED" | "REPROVED") {
    if (!me) return;
    const pend = l.bs.filter(b => correcaoPendente(b) && b.punchId && !l.decididos.has(b.punchId));
    if (!pend.length) return;
    const diaBR = `${l.data.slice(-2)}/${l.data.slice(5, 7)}`;
    if (!window.confirm(`${status === "APPROVED" ? "Aprovar" : "Reprovar"} a correção de ${emp.nome} em ${diaBR}?\n\n${status === "APPROVED" ? "A marcação passa a contar e a Sólides é atualizada." : "A marcação é descartada e a Sólides é atualizada."}`)) return;
    setAcaoBusy(true); setAcaoMsg("");
    try {
      for (const b of pend) {
        await decidirAprovacao(shortCode, { punchId: Number(b.punchId), status });
        const inMin = b.dateIn != null ? minutoDoDiaBRT(b.dateIn) : null;
        const outMin = b.dateOut != null ? minutoDoDiaBRT(b.dateOut) : null;
        const aprovComHoras = status === "APPROVED" && inMin != null && outMin != null;
        const aj: Omit<PtrpAjuste, "id"> = {
          empresaKey: shortCode, colaboradorId: emp.id, cpf: soDig(emp.cpf), data: l.data, punchId: b.punchId as string,
          ...(aprovComHoras ? { tipo: "inclusao" as PtrpAjusteTipo, in: minToHHMM(inMin as number), out: minToHHMM(outMin as number) } : { tipo: "desconsideracao" as PtrpAjusteTipo }),
          motivo: status === "APPROVED" ? "Correção do empregado aprovada (via Sólides)" : "Correção do empregado reprovada (via Sólides)",
          autor: { id: me.id, nome: me.nome }, criadoEm: new Date().toISOString(), solidesDecisao: true, cancelado: false,
        };
        await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore(aj));
      }
      setAcaoMsg(`✓ Correção de ${diaBR} ${status === "APPROVED" ? "aprovada" : "reprovada"}.`);
    } catch (e) { setAcaoMsg("Falha ao decidir: " + (e instanceof Error ? e.message : "erro")); }
    finally { setAcaoBusy(false); }
  }

  // Marca/desmarca um dia p/ o pedido de correção em LOTE (qualquer dia serve —
  // não só os que o sistema aponta; ex.: você sabe que faltou batida num dia par).
  const toggleCorr = (data: string) => setSelCorr(prev => { const n = new Set(prev); if (n.has(data)) n.delete(data); else n.add(data); return n; });

  // Monta UMA mensagem com todos os dias selecionados. Dia detectado → lista o
  // problema; dia sem exceção (suspeita sua) → "revisar as marcações". Editável no modal.
  function montarTextoCorrecao(emp: Empregado, linhas: Linha[]): string {
    const itens = linhas.slice().sort((a, b) => a.data.localeCompare(b.data)).map(l => {
      const diaBR = `${l.data.slice(-2)}/${l.data.slice(5, 7)}`;
      const probs = l.excecoes.filter(e => EXC_CORRIGIVEL.has(e)).map(e => EXC_LABEL[e] || e);
      const bat = l.bs.filter(b => !b.excluded && !correcaoPendente(b)).map(b => `${hhmm(b.dateIn)}–${hhmm(b.dateOut)}`).join(", ") || "sem batidas";
      const desc = probs.length ? probs.join("; ") : "revisar as marcações — parece faltar batida";
      return `• ${diaBR}: ${desc} (registrado: ${bat})`;
    });
    const n = linhas.length;
    return `Olá ${emp.nome.split(" ")[0]}, tudo bem?\n\nRevisando seu registro de ponto, ${n === 1 ? "um dia precisa" : "alguns dias precisam"} de ajuste no aplicativo da Sólides:\n\n${itens.join("\n")}\n\nPor favor, corrija as marcações no app da Sólides. Depois passam pela nossa revisão e aprovação. Qualquer dúvida, é só chamar por aqui. Obrigado! 🙏`;
  }

  // Abre o WhatsApp (linha do DP/Ponto = papel "empregados") com o texto do lote.
  function enviarCorrecaoLote(emp: Empregado, texto: string) {
    const tel = (emp.cpf ? whatsPorCpf.get(soDig(emp.cpf)) : "") || soDig((emp as { telefone?: string }).telefone);
    if (!tel) { setAcaoMsg(`${emp.nome} não tem WhatsApp no cadastro (Pessoa ou Empregado).`); setCorrModal(false); return; }
    void abrirWhatsapp(rid, "empregados", tel, emp.nome, texto);
    setSelCorr(new Set()); setCorrModal(false);
    setAcaoMsg("✓ Pedido de correção aberto no WhatsApp (linha do DP/Ponto).");
  }

  const travado = fech?.status === "fechado";

  // Marcações do dia para o espelho: batida do REP + tratadas (incluída,
  // desconsiderada) distinguidas — como a Portaria 671 exige. Aprovação de
  // correção pendente vira "incluída" (não duplica com a batida pendente).
  function montarMarcacoes(l: Linha): PtrpApuracaoDia["marcacoes"] {
    const inclusaoPunch = new Set(l.ajustesDia.filter(a => a.tipo === "inclusao" && a.punchId).map(a => a.punchId as string));
    const punchIdsBatida = new Set(l.bs.map(b => b.punchId).filter(Boolean) as string[]);
    const out: PtrpApuracaoDia["marcacoes"] = [];
    for (const b of l.bs) {
      if (b.excluded) continue;
      const pend = correcaoPendente(b);
      const decidido = !!(b.punchId && l.decididos.has(b.punchId));
      const descByAjuste = !!(b.punchId && l.descPunch.has(b.punchId));
      const aprovadaTratada = pend && decidido && !!(b.punchId && inclusaoPunch.has(b.punchId));   // pendente aprovada → tratada/incluída
      const reprovada = pend && decidido && !aprovadaTratada;                                       // pendente reprovada → desprezada
      out.push({
        in: hhmmN(b.dateIn), out: hhmmN(b.dateOut), status: b.status || null,
        pendente: pend && !decidido,
        desconsiderada: descByAjuste || reprovada,
        origem: aprovadaTratada ? "incluida" : "rep",
        punchId: b.punchId || null,
      });
    }
    // Inclusões manuais (esquecimento) — sem batida correspondente no dia.
    for (const a of l.ajustesDia) {
      if (a.tipo === "inclusao" && a.in && a.out && !(a.punchId && punchIdsBatida.has(a.punchId))) {
        out.push({ in: a.in, out: a.out, origem: "incluida", punchId: a.punchId || null });
      }
    }
    return out;
  }

  // Serializa a apuração de um colaborador no snapshot congelável (base do
  // fechamento, do espelho PDF e do AEJ).
  function snapshotColab(x: { emp: Empregado; area: string; r: ReturnType<typeof apurarColab> }): PtrpApuracaoColab {
    const emp = x.emp;
    const dias: PtrpApuracaoDia[] = x.r.linhas.map(l => ({
      data: l.data, previstoMin: l.previstoMin, trabalhadoMin: l.trabalhado, extraMin: l.extra, noturnoMin: l.noturno,
      atrasoMin: l.atrasoMin, faltaMin: l.excecoes.includes("falta") ? l.previstoMin : 0, abonadoMin: l.abonadoMin,
      excecoes: l.excecoes,
      marcacoes: montarMarcacoes(l),
      ajustes: l.ajustesDia.map(a => ({ tipo: a.tipo, in: a.in || null, out: a.out || null, motivo: a.motivo || null })),
      previstoTxt: l.previstoTxt, statusEscala: l.statusEscala || null, feriado: l.ehFeriado,
    }));
    return {
      id: `${shortCode}_${comp}_${emp.id}`, empresaKey: shortCode, competencia: comp, colaboradorId: emp.id,
      cpf: soDig(emp.cpf), nome: emp.nome, cargo: (cargoPorId[emp.cargoId] as { nome?: string })?.nome || null, area: x.area,
      admissao: (emp as { admissao?: string }).admissao || null, dias,
      totalPrevistoMin: dias.reduce((s, d) => s + d.previstoMin, 0), totalTrabalhadoMin: x.r.totTrab, totalExtraMin: x.r.totExtra,
      totalNoturnoMin: x.r.totNot, totalAtrasoMin: dias.reduce((s, d) => s + (d.atrasoMin || 0), 0), saldoMin: x.r.saldoMes,
      geradoEm: new Date().toISOString(),
    };
  }

  const colabsFechaveis = () => resultados.filter(x => x.r.temCpf && !naoBatePonto(x.emp) && x.r.linhas.length);
  const empCfg = () => ptrpCfg.empresas?.[shortCode] || {};
  // CNPJ e razão social vêm do CADASTRO do restaurante (Configurações); REP da config do AEJ.
  const empCnpj = () => (((activeRestaurant as { cnpj?: string } | null)?.cnpj || "").replace(/\D/g, "") || null);
  const empNome = () => (activeRestaurant as { razaoSocial?: string } | null)?.razaoSocial || activeRestaurant?.nome || shortCode;
  const espelhoMeta = () => ({ empresaNome: empNome(), empresaCnpj: empCnpj(), cctNome: cct?.cctNome || null, compLabel: labelComp(comp), geradoPor: me?.nome || null });
  const alvosAssinatura = (): AlvoAssinatura[] => colabsFechaveis().map(x => { const cpf = soDig(x.emp.cpf); return { snap: snapshotColab(x), whatsapp: (cpf ? whatsPorCpf.get(cpf) : "") || soDig((x.emp as { telefone?: string }).telefone), email: (cpf ? emailPorCpf.get(cpf) : "") || "" }; });

  // ─── Helpers de render da linha do dia (reusados na tabela desktop e nos cards mobile) ───
  const flagsLinha = (l: Linha, idx: number) => {
    const folga = l.previstoTxt === "folga";
    const pendUndecided = l.bs.some(b => correcaoPendente(b) && b.punchId && !l.decididos.has(b.punchId));
    const temCorrigivel = l.excecoes.some(e => EXC_CORRIGIVEL.has(e));
    const inclPunch = new Set(l.ajustesDia.filter(a => a.tipo === "inclusao" && a.punchId).map(a => a.punchId as string));
    const validMarcs = montarMarcacoes(l).filter(m => !m.desconsiderada && !m.pendente);
    const marks = validMarcs.reduce((n, m) => n + (m.in ? 1 : 0) + (m.out ? 1 : 0), 0);
    const incompleta = validMarcs.some(m => (!!m.in) !== (!!m.out));
    const temPendente = l.excecoes.includes("correcao_pendente");
    const precisaCorrecao = !l.ehFuturo && !l.ehHoje && (l.excecoes.includes("falta") || incompleta || (marks > 0 && marks % 2 !== 0));
    const suspeito = !folga && !l.ehFuturo && !l.ehHoje && !incompleta && marks === 2;
    const rowBg = (l.ehFuturo || l.ehHoje) ? "bg-blue-50/70 dark:bg-blue-950/25" : precisaCorrecao ? "bg-rose-100/70 dark:bg-rose-900/25" : (suspeito || temPendente) ? "bg-amber-50 dark:bg-amber-950/25" : idx % 2 ? "bg-gray-50/40 dark:bg-gray-800/20" : "";
    return { folga, pendUndecided, temCorrigivel, inclPunch, incompleta, suspeito, rowBg };
  };
  const renderPrevisto = (l: Linha) => (<>
    {l.statusEscala && <span className={`inline-block mr-1 text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[l.statusEscala].bg} ${STATUS_INFO[l.statusEscala].text}`} title={STATUS_INFO[l.statusEscala].label}>{STATUS_INFO[l.statusEscala].short}</span>}
    {l.statusEscala ? (l.previstoTxt.includes("–") ? l.previstoTxt : "") : l.previstoTxt}
    {l.ehFeriado && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">feriado</span>}
  </>);
  const renderBatidas = (l: Linha, inclPunch: Set<string>) => l.ehFuturo ? <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-300">futuro</span> : (<>
    <div className="tabular-nums">{l.bs.length ? l.bs.map((b, i) => { const desc = !!(b.punchId && l.descPunch.has(b.punchId)); const pend = correcaoPendente(b) && !(b.punchId && l.decididos.has(b.punchId)); const tratada = !!(b.punchId && inclPunch.has(b.punchId)); const cls = b.excluded || desc ? "line-through text-gray-400" : pend ? "text-amber-600 dark:text-amber-400 underline decoration-dashed decoration-amber-400" : tratada ? "text-indigo-600 dark:text-indigo-300 underline decoration-dotted decoration-indigo-400" : ""; return <span key={i} className={cls} title={desc ? "desconsiderada" : pend ? `correção ${b.status === "REJECTED" ? "rejeitada" : "pendente"} no Sólides — não entra no oficial` : tratada ? "horário tratado (correção)" : undefined}>{i > 0 ? " · " : ""}{hhmm(b.dateIn)}–{hhmm(b.dateOut)}{pend ? " 🟡" : ""}{tratada ? " ✎" : ""}</span>; }) : <span className="text-gray-300 dark:text-gray-600">—</span>}</div>
    {l.ajustesDia.length > 0 && (
      <div className="mt-1 flex flex-col gap-0.5">
        {l.ajustesDia.map(a => { const inline = a.tipo === "inclusao" && !!a.punchId && l.bs.some(b => b.punchId === a.punchId); const icon = a.tipo === "inclusao" ? "✎" : a.tipo === "desconsideracao" ? "🚫" : "☂️"; const label = a.motivo?.trim() || (a.tipo === "inclusao" ? "Correção incluída" : a.tipo === "desconsideracao" ? "Batida desconsiderada" : a.tipo); return (
          <div key={a.id} className="flex items-center gap-x-1 text-[10.5px] text-indigo-700 dark:text-indigo-300">
            <span>{icon} {a.tipo === "inclusao" && !inline && a.in ? `${a.in}–${a.out} · ` : ""}{label}</span>
            {a.autor?.nome && <span className="text-indigo-400 dark:text-indigo-500">· por {a.autor.nome}</span>}
            <button type="button" onClick={() => void cancelarAjuste(a)} className="text-rose-400 hover:text-rose-600 ml-0.5" title={a.solidesDecisao ? "Desfazer nos dois lados (Sólides + app)" : "Cancelar tratamento no app"}>✕</button>
          </div>
        ); })}
      </div>
    )}
  </>);
  const renderExcecoes = (l: Linha, incompleta: boolean, suspeito: boolean) => l.ehHoje ? <span className="text-blue-600 dark:text-blue-300 text-[11px] font-bold">HOJE</span> : l.ehFuturo ? <span className="text-blue-500 text-[11px]">a realizar</span> : l.excecoes.length ? <span className="inline-flex flex-wrap items-center gap-1 text-[14px] leading-none">{l.excecoes.map(e => <span key={e} className="cursor-help" title={EXC_LABEL[e] || e}>{EXC_ICON[e] || "⚠️"}</span>)}</span> : incompleta ? <span className="cursor-help text-[14px]" title="Batida sem par (ponto aberto) — precisa corrigir">3️⃣</span> : suspeito ? <span className="cursor-help text-[14px]" title="Só 2 batidas — o padrão é 4 ou 6">✌️</span> : <span className="text-emerald-500 text-[12px]">✓</span>;
  const renderAcoes = (l: Linha, pendUndecided: boolean, temCorrigivel: boolean) => { const corrSel = selCorr.has(l.data); return (
    <div className="inline-flex items-center gap-1">
      {pendUndecided && !travado && <>
        <button type="button" disabled={acaoBusy} onClick={() => sel && void decidirCorrecao(sel.emp, l, "APPROVED")} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-emerald-300 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40" title="Aprovar correção (Sólides + trilha)">✓</button>
        <button type="button" disabled={acaoBusy} onClick={() => sel && void decidirCorrecao(sel.emp, l, "REPROVED")} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-rose-300 dark:border-rose-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40" title="Reprovar correção">✗</button>
      </>}
      <button type="button" onClick={() => toggleCorr(l.data)} className={`text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border ${corrSel ? "bg-blue-500 border-blue-500 text-white" : temCorrigivel ? "border-blue-300 dark:border-blue-800 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" : "border-gray-300 dark:border-gray-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`} title={corrSel ? "Remover do pedido de correção" : "Selecionar p/ pedir correção"}>💬</button>
      <button type="button" disabled={travado} onClick={() => sel && setAjusteModal({ emp: sel.emp, data: l.data, bs: l.bs })} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30" title={travado ? "Mês fechado" : "Tratar"}>⚙️</button>
    </div>
  ); };

  // Encerrar mês: congela a apuração (ptrpApuracoes) + marca o fechamento.
  async function encerrarMes() {
    if (!me) return;
    const alvo = colabsFechaveis();
    if (!alvo.length) { setAcaoMsg("Nada a fechar — nenhum colaborador cruzável neste mês."); return; }
    if (!window.confirm(`Encerrar ${labelComp(comp)} de ${activeRestaurant?.nome}?\n\n${alvo.length} colaborador(es) terão a apuração CONGELADA (base do espelho e do AEJ). Dá pra reabrir depois.`)) return;
    setFechBusy(true); setAcaoMsg("");
    try {
      const batch = writeBatch(db);
      for (const x of alvo) { const snap = snapshotColab(x); batch.set(doc(db, "ptrpApuracoes", snap.id), sanitizeForFirestore(snap)); }
      const header: PtrpFechamento = { id: `${shortCode}_${comp}`, empresaKey: shortCode, competencia: comp, status: "fechado", colaboradores: alvo.length, cctNome: cct?.cctNome || null, fechadoEm: new Date().toISOString(), fechadoPor: { id: me.id, nome: me.nome } };
      batch.set(doc(db, "ptrpFechamentos", header.id), sanitizeForFirestore(header));
      await batch.commit();
      setAcaoMsg(`✓ ${labelComp(comp)} fechado — ${alvo.length} colaborador(es) congelados.`);
    } catch (e) { setAcaoMsg("Falha ao fechar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setFechBusy(false); }
  }
  async function reabrirMes() {
    if (!me || !fech) return;
    if (!window.confirm(`Reabrir ${labelComp(comp)}? A apuração volta a ser editável (o snapshot fica guardado).`)) return;
    setFechBusy(true);
    try { await setDoc(doc(db, "ptrpFechamentos", `${shortCode}_${comp}`), sanitizeForFirestore({ ...fech, status: "reaberto", reabertoEm: new Date().toISOString(), reabertoPor: { id: me.id, nome: me.nome } })); setAcaoMsg(`✓ ${labelComp(comp)} reaberto.`); }
    catch (e) { setAcaoMsg("Falha ao reabrir: " + (e instanceof Error ? e.message : "erro")); }
    finally { setFechBusy(false); }
  }

  // Abre o modal de preview (revoga a URL anterior).
  function abrirPreview(blob: Blob, nome: string, titulo: string) {
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url: URL.createObjectURL(blob), blob, nome, titulo }; });
  }
  function fecharPreview() { setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; }); }

  async function baixarEspelho(x: { emp: Empregado; area: string; r: ReturnType<typeof apurarColab> }) {
    setExportBusy("espelho");
    try { const pdf = await gerarEspelhoPDF([snapshotColab(x)], espelhoMeta()); abrirPreview(pdf.output("blob"), `espelho-${x.emp.nome.split(" ")[0].toLowerCase()}-${comp}.pdf`, `Espelho de ponto · ${x.emp.nome}`); }
    catch (e) { setAcaoMsg("Falha no PDF: " + (e instanceof Error ? e.message : "erro")); }
    finally { setExportBusy(""); }
  }
  async function baixarEspelhosTodos() {
    const alvo = colabsFechaveis();
    if (!alvo.length) { setAcaoMsg("Sem colaboradores para o espelho."); return; }
    setExportBusy("espelhos");
    try { const pdf = await gerarEspelhoPDF(alvo.map(snapshotColab), espelhoMeta()); abrirPreview(pdf.output("blob"), `espelhos-${shortCode}-${comp}.pdf`, `Espelhos de ponto · ${labelComp(comp)} (${alvo.length})`); }
    catch (e) { setAcaoMsg("Falha no PDF: " + (e instanceof Error ? e.message : "erro")); }
    finally { setExportBusy(""); }
  }
  async function baixarAEJ() {
    const alvo = colabsFechaveis();
    if (!alvo.length) { setAcaoMsg("Sem dados para o AEJ."); return; }
    setExportBusy("aej");
    try {
      const e = empCfg();
      const dev = ptrpCfg.desenvolvedor || DEV_PADRAO;
      const txt = gerarAEJ(alvo.map(snapshotColab), {
        empresaNome: empNome(), empresaCnpj: empCnpj(), compLabel: labelComp(comp), competencia: comp,
        repTipo: e.repTipo || "3", repNumero: e.repNumero || REP_PADRAO,
        ptrp: { nome: "planejamento.app", versao: "5", devTipoId: dev.tipoId, devId: dev.id, devNome: dev.nome, devEmail: dev.email },
      });
      await baixarOuCompartilhar(new Blob([txt], { type: "text/plain;charset=utf-8" }), `AEJ-${shortCode}-${comp}.txt`, { titulo: "AEJ" });
    } catch (e) { setAcaoMsg("Falha no AEJ: " + (e instanceof Error ? e.message : "erro")); }
    finally { setExportBusy(""); }
  }

  const cpfsComEmpregado = useMemo(() => new Set(empregados.map(e => soDig(e.cpf)).filter(Boolean)), [empregados]);
  const batidasSemCadastro = useMemo(() => Object.keys(batidasPorCpf).filter(c => !cpfsComEmpregado.has(c)), [batidasPorCpf, cpfsComEmpregado]);

  const cpfNoRoster = useMemo(() => new Set((roster || []).map(r => soDig(r.cpf)).filter(Boolean)), [roster]);
  const cpfComBatida = useMemo(() => new Set(Object.keys(batidasPorCpf)), [batidasPorCpf]);
  // NOTA: o roster do Sólides (employee/find-all) devolve CPF só de PARTE das
  // pessoas — não dá pra afirmar "não tem cadastro" a partir dele. Por isso o
  // chip NÃO pinta cinza por roster: cinza só pra quem não tem CPF no app (não
  // dá pra cruzar). Quem tem cadastro mas não bateu no mês vira amarelo (faltas).
  // A conferência explícita de quem falta cadastrar fica na aba "Comparar cadastros".

  // Comparação de cadastros: equipe CLT ATIVA do app (empVis) × Sólides (roster ∪ batidas).
  const comparacao = useMemo(() => {
    if (!roster) return null;
    const solCpfs = new Set<string>([...cpfNoRoster, ...cpfComBatida]);
    const ativosComCpf = empVis.filter(e => soDig(e.cpf));
    const soNoApp = ativosComCpf.filter(e => !solCpfs.has(soDig(e.cpf)));
    const appCpfs = new Set(ativosComCpf.map(e => soDig(e.cpf)));
    const soNaSolides = roster.filter(r => soDig(r.cpf) && !appCpfs.has(soDig(r.cpf)));
    return { soNaSolides, soNoApp, semCpfApp: empVis.filter(e => !soDig(e.cpf)), ambos: ativosComCpf.length - soNoApp.length };
  }, [roster, empVis, cpfNoRoster, cpfComBatida]);

  // Apura todo mundo e agrupa por ÁREA (colunas), como o Fechamento de ponto.
  const resultados = useMemo(() => empVis.map(emp => ({ emp, area: areaDoEmp(emp) || "Sem área", r: apurarColab(emp) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empVis, batidasPorCpf, ajustesPorCpf, escala, feriadosSet, cct, comp, cargoPorId]);
  const porArea = useMemo(() => {
    const m = new Map<string, typeof resultados>();
    for (const x of resultados) { const a = m.get(x.area) || []; a.push(x); m.set(x.area, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [resultados]);
  const sel = resultados.find(x => x.emp.id === aberto) || null;

  // Banco de horas: saldo acumulado (Σ movimentos) e extrato por colaborador.
  const saldoAcumPorColab = useMemo(() => { const m = new Map<string, number>(); for (const mv of bancoMovs) m.set(mv.colaboradorId, (m.get(mv.colaboradorId) || 0) + (mv.saldoMinutos || 0)); return m; }, [bancoMovs]);
  const movsPorColab = useMemo(() => { const m = new Map<string, PtrpBancoMov[]>(); for (const mv of bancoMovs) { const a = m.get(mv.colaboradorId) || []; a.push(mv); m.set(mv.colaboradorId, a); } for (const a of m.values()) a.sort((x, y) => x.competencia.localeCompare(y.competencia)); return m; }, [bancoMovs]);
  const hojeYmd = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const movVencido = (mv: PtrpBancoMov) => (mv.saldoMinutos || 0) > 0 && !!mv.vencimento && mv.vencimento < hojeYmd;
  const registradoComp = (colabId: string) => bancoMovs.some(mv => mv.colaboradorId === colabId && mv.competencia === comp);

  async function registrarBanco() {
    if (!shortCode) return;
    setRegistrando(true);
    try {
      const fim = `${comp}-${String(diasDoMes).padStart(2, "0")}`;
      const prazo = cct?.prazoCompensacaoDias || 90;
      for (const x of resultados) {
        const saldo = Math.round(x.r.saldoMes || 0);
        if (!saldo) continue;
        const mov: Omit<PtrpBancoMov, "id"> = {
          empresaKey: shortCode, colaboradorId: x.emp.id, cpf: soDig(x.emp.cpf), competencia: comp,
          saldoMinutos: saldo, vencimento: saldo > 0 ? somaDiasYmd(fim, prazo) : null,
          regime: cct?.regimeCompensacao, registradoEm: new Date().toISOString(), registradoPor: { id: me?.id || "", nome: me?.nome || "" },
        };
        await setDoc(doc(db, "ptrpBancoHoras", `${shortCode}_${comp}_${x.emp.id}`), sanitizeForFirestore(mov));
      }
    } catch (e) { alert("Falha ao registrar no banco: " + (e instanceof Error ? e.message : "?")); }
    finally { setRegistrando(false); }
  }

  async function cancelarAjuste(a: PtrpAjuste) {
    const reverteSolides = !!(a.solidesDecisao && a.punchId);
    const msg = reverteSolides
      ? "Desfazer esta decisão? A correção volta a PENDENTE na Sólides E o tratamento é cancelado aqui (fica na trilha)."
      : "Cancelar este tratamento? Ele fica registrado na trilha (não some).";
    if (!confirm(msg)) return;
    try {
      // Desfaz nos DOIS lados: primeiro reverte a decisão na Sólides (→ PENDENTE),
      // só então cancela o tratamento no app (se a Sólides falhar, não cancela aqui).
      if (reverteSolides) await decidirAprovacao(shortCode, { punchId: Number(a.punchId), status: "PENDING", observation: "Decisão desfeita no planejamento.app" });
      await updateDoc(doc(db, "ptrpAjustes", a.id), { cancelado: true, canceladoPor: { id: me?.id || "", nome: me?.nome || "" }, canceladoEm: new Date().toISOString() });
      setAcaoMsg(reverteSolides ? "✓ Decisão desfeita — correção voltou a pendente na Sólides." : "✓ Tratamento cancelado.");
    } catch (e) { setAcaoMsg("Falha ao desfazer: " + (e instanceof Error ? e.message : "erro")); }
  }

  // Acesso é controlado pelas PERMISSÕES por aba (Perfis de Acesso), não mais só master.

  if (!shortCode) return <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">O restaurante ativo (<strong>{activeRestaurant?.nome || "—"}</strong>) não tem <strong>shortCode</strong> do Sólides configurado. Troque de restaurante no seletor do topo, ou configure o shortCode.</div>;

  return (
    <div>
      {mode !== "comparar" && (
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{activeRestaurant?.nome} · {shortCode}</span>
        <div className="inline-flex items-center rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
          <button type="button" onClick={() => setComp(addMes(comp, -1))} className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="Mês anterior">‹</button>
          <select value={comp} onChange={e => setComp(e.target.value)} className="px-2 py-1.5 text-sm bg-white dark:bg-gray-900 dark:text-gray-100 font-medium border-x border-gray-200 dark:border-gray-700 focus:outline-none">
            {mesesOpcoes.map(m => <option key={m} value={m}>{labelComp(m)}</option>)}
          </select>
          <button type="button" onClick={() => setComp(addMes(comp, 1))} disabled={comp >= compAtual()} className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30" title="Próximo mês">›</button>
        </div>
        {!cct && <span className="text-xs text-amber-600 dark:text-amber-400">⚠ Sem CCT — configure em Regras (extras/noturno não calculam).</span>}
      </div>
      )}

      {mode === "conferencia" && (<>
      {/* Fechamento mensal + exportações (espelho PDF / AEJ) */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {travado
          ? <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" title={fech?.fechadoEm ? `Fechado em ${fmtDataBR(fech.fechadoEm.slice(0, 10))}${fech.fechadoPor ? ` por ${fech.fechadoPor.nome}` : ""}` : ""}>🔒 Mês fechado</span>
          : fech?.status === "reaberto"
            ? <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">↻ Reaberto</span>
            : <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Aberto</span>}
        {travado
          ? <Button size="sm" variant="secondary" disabled={fechBusy} onClick={() => void reabrirMes()}>{fechBusy ? "…" : "🔓 Reabrir mês"}</Button>
          : <Button size="sm" disabled={fechBusy} onClick={() => void encerrarMes()}>{fechBusy ? "Fechando…" : `🔒 Encerrar ${labelComp(comp)}`}</Button>}
        {travado && <Button size="sm" onClick={() => setAssModal(true)}>✍️ Enviar para assinatura</Button>}
        <Button size="sm" variant="secondary" disabled={!!exportBusy} onClick={() => void baixarEspelhosTodos()}>{exportBusy === "espelhos" ? "Gerando…" : "🖨 Espelhos (todos)"}</Button>
        <Button size="sm" variant="secondary" disabled={!!exportBusy} onClick={() => void baixarAEJ()}>{exportBusy === "aej" ? "Gerando…" : "⬇️ AEJ"}</Button>
      </div>
      <div className="text-[12px] rounded-lg px-3 py-2 mb-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
        Escolha um colaborador pelo chip. <span className="font-semibold text-emerald-700 dark:text-emerald-300">✓ verde</span> = sem exceções · <span className="font-semibold text-amber-700 dark:text-amber-300">● amarelo</span> = tem exceções a tratar · <span className="font-semibold text-gray-400">○ cinza</span> = sem batidas / sem CPF. Previsto vem do cadastro do empregado; prévia — validar contra o Sólides. Na tabela do dia: <span className="text-amber-600 dark:text-amber-400">🟡 tracejado</span> = correção pedida no Sólides ainda não aprovada (não conta) → <span className="font-semibold text-emerald-700 dark:text-emerald-300">✓ aprovar</span> / <span className="font-semibold text-rose-600">✗ reprovar</span>; <span className="text-blue-600">💬</span> marca o dia p/ pedir correção — junta vários numa mensagem só (inclusive dias sem erro que você suspeita), e o botão azul no topo monta o WhatsApp (linha do DP). Cor da linha do dia: <span className="px-1 rounded bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">vermelha</span> = correção necessária (nº ímpar de batidas / falta) · <span className="px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">amarela</span> = suspeito (só 2 batidas; o padrão é 4 ou 6) · <span className="px-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">azul</span> = dia futuro.
      </div>
      </>)}

      {mode === "comparar" && (
      <div className="mb-3">
        <div className="text-[12px] text-gray-500 mb-2">Cruza a equipe CLT ativa do <strong>{activeRestaurant?.nome}</strong> com o cadastro da Sólides (por CPF).</div>
        <button type="button" onClick={() => (mostrarComp && roster ? setMostrarComp(false) : void carregarRoster())} disabled={carregandoRoster}
          className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
          {carregandoRoster ? "Buscando cadastro da Sólides…" : mostrarComp && roster ? "▲ Ocultar comparação de cadastros" : "🔍 Comparar cadastros (Sólides × app)"}
        </button>
        {rosterErr && <span className="ml-2 text-[12px] text-rose-600">{rosterErr}</span>}
        {mostrarComp && comparacao && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-900/10 p-3">
              <div className="text-[11px] font-bold uppercase text-rose-700 dark:text-rose-300 mb-1">Na Sólides, fora da equipe ativa ({comparacao.soNaSolides.length})</div>
              <div className="text-[11px] text-gray-500 mb-1.5">Estão na Sólides mas não são equipe CLT ativa no app — ex.: demitido/inativo no app ainda ativo na Sólides (remover lá), ou falta cadastrar.</div>
              {comparacao.soNaSolides.length === 0 ? <div className="text-[12px] text-gray-400">— nenhum —</div> :
                <ul className="space-y-0.5 text-[12.5px] text-gray-700 dark:text-gray-200">{comparacao.soNaSolides.map(r => <li key={r.id || r.cpf}>{r.name || r.cpf}{r.fired && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200">DEM</span>}</li>)}</ul>}
            </div>
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-900/10 p-3">
              <div className="text-[11px] font-bold uppercase text-indigo-700 dark:text-indigo-300 mb-1">Equipe ativa sem Sólides ({comparacao.soNoApp.length})</div>
              <div className="text-[11px] text-gray-500 mb-1.5">Equipe CLT ativa no app mas sem cadastro na Sólides — batem ponto? Falta cadastrar na Sólides (aparecem em cinza na lista).</div>
              {comparacao.soNoApp.length === 0 ? <div className="text-[12px] text-gray-400">— nenhum —</div> :
                <ul className="space-y-0.5 text-[12.5px] text-gray-700 dark:text-gray-200">{comparacao.soNoApp.map(e => <li key={e.id}>{e.nome}</li>)}</ul>}
              {comparacao.semCpfApp.length > 0 && <div className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">+ {comparacao.semCpfApp.length} no app sem CPF (não dá pra casar).</div>}
            </div>
            <div className="sm:col-span-2 text-[11px] text-gray-400">✓ {comparacao.ambos} em ambos os cadastros.</div>
          </div>
        )}
      </div>
      )}

      {mode === "banco" && (
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">🏦 Banco de horas / compensação · {labelComp(comp)}</span>
          <Button size="sm" variant="secondary" disabled={registrando || !cct} onClick={() => void registrarBanco()}>
            {registrando ? "Registrando…" : `Registrar ${labelComp(comp)} no banco`}
          </Button>
          {!cct && <span className="text-[11px] text-amber-600">configure a CCT (Regras) pra calcular o vencimento.</span>}
        </div>
        {(
          <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
            <table className="w-full text-[12px] min-w-[560px] [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
              <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-200 dark:border-gray-800">
                <th className="py-1.5 font-semibold">Colaborador</th><th className="font-semibold text-right">Saldo {labelComp(comp)}</th><th className="font-semibold text-right">Saldo acumulado</th><th className="font-semibold">Próx. vencimento</th><th className="font-semibold">Extrato</th>
              </tr></thead>
              <tbody>
                {resultados.filter(x => !naoBatePonto(x.emp)).map(({ emp, r }) => {
                  const acum = saldoAcumPorColab.get(emp.id) || 0;
                  const movs = movsPorColab.get(emp.id) || [];
                  const vencidos = movs.filter(movVencido);
                  const proxVenc = movs.filter(m => (m.saldoMinutos || 0) > 0 && m.vencimento && m.vencimento >= hojeYmd).map(m => m.vencimento!).sort()[0];
                  if (!r.saldoMes && movs.length === 0) return null;
                  return (
                    <tr key={emp.id} className="border-b border-gray-50 dark:border-gray-800/40">
                      <td className="font-medium text-gray-700 dark:text-gray-200 truncate">{emp.nome}{registradoComp(emp.id) && <span className="ml-1 text-[9px] text-emerald-600">✓ registrado</span>}</td>
                      <td className={`text-right tabular-nums font-medium ${r.saldoMes < 0 ? "text-rose-600 dark:text-rose-400" : r.saldoMes > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{r.saldoMes ? hmSigned(Math.round(r.saldoMes)) : "0h00"}</td>
                      <td className={`text-right tabular-nums font-semibold ${acum < 0 ? "text-rose-600 dark:text-rose-400" : acum > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{acum ? hmSigned(acum) : "0h00"}</td>
                      <td className="text-gray-600 dark:text-gray-300">{vencidos.length > 0 ? <span className="text-rose-600 dark:text-rose-400 font-semibold">⚠ {vencidos.length} vencido(s)</span> : proxVenc ? fmtDataBR(proxVenc) : "—"}</td>
                      <td className="text-[11px] text-gray-500">{movs.length === 0 ? "—" : movs.map(m => <span key={m.id} className={`inline-block mr-1.5 ${movVencido(m) ? "text-rose-500" : ""}`} title={m.vencimento ? `vence ${fmtDataBR(m.vencimento)}` : ""}>{labelComp(m.competencia).slice(0, 3)}: {hmSigned(m.saldoMinutos || 0)}</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800">Saldo do mês = trabalhado + abonado − previsto. "Registrar no banco" grava o saldo do mês com vencimento = fim da competência + {cct?.prazoCompensacaoDias || 90} dias (prazo da CCT). Crédito vencido (não compensado no prazo) deve ser pago como extra.</div>
          </div>
        )}
      </div>
      )}

      {mode === "conferencia" && (empVis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhum empregado neste restaurante.</div>
      ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {porArea.map(([area, cols]) => {
            const comExc = cols.filter(c => !naoBatePonto(c.emp) && c.r.exc > 0).length;
            return (
              <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{area}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{comExc}/{cols.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {cols.map(({ emp, r }) => {
                    const naoBate = naoBatePonto(emp);
                    const semCpf = !naoBate && !r.temCpf;   // cinza: sem CPF no app → não dá pra cruzar
                    // Confiança → verde. Sem CPF → cinza. Com exceções (inclusive sem
                    // batida no mês = faltas) → amarelo. Sem exceções → verde.
                    const st = naoBate ? "ok" : semCpf ? "sem" : r.exc > 0 ? "exc" : "ok";
                    const selado = emp.id === aberto;
                    const cls = st === "ok" ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800"
                      : st === "exc" ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
                      : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800/40 dark:border-gray-700";
                    return (
                      <button key={emp.id} type="button" onClick={() => setAberto(selado ? null : emp.id)}
                        title={naoBate ? "Cargo de confiança — não bate ponto" : semCpf ? "Sem CPF no cadastro do app — não dá pra cruzar com a Sólides" : st === "exc" ? `${r.exc} exceção(ões)` : "Sem exceções"}
                        className={`text-left text-xs px-2 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors hover:brightness-95 ${cls} ${selado ? "ring-2 ring-indigo-500" : ""}`}>
                        <span className="shrink-0">{st === "ok" ? "✓" : st === "exc" ? "●" : "○"}</span>
                        <span className="truncate flex-1">{naoBate ? "🎩 " : ""}{emp.nome}</span>
                        {!naoBate && !semCpf && r.exc > 0 && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 tabular-nums">{r.exc}</span>}
                        {naoBate && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200">S/ PONTO</span>}
                        {semCpf && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200">SEM CPF</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {sel && (
          <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="font-semibold uppercase tracking-wide text-gray-400">Legenda:</span>
              {Object.entries(EXC_ICON).map(([k, ic]) => <span key={k} className="inline-flex items-center gap-1"><span className="text-[12px] leading-none">{ic}</span>{EXC_LABEL[k]}</span>)}
              <span className="inline-flex items-center gap-1"><span className="text-[12px] leading-none">✌️</span>2 batidas (conferir)</span>
              <span className="inline-flex items-center gap-1"><span className="text-emerald-500">✓</span>sem exceção</span>
            </div>
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{sel.emp.nome} <span className="text-[11px] font-normal text-gray-500">· {sel.area}</span></div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-gray-500">trab. {hm(sel.r.totTrab)}{sel.r.totExtra ? ` · extra ${hm(sel.r.totExtra)}` : ""}{sel.r.totNot ? ` · not. ${hm(sel.r.totNot)}` : ""}</span>
                <button type="button" disabled={!!exportBusy} onClick={() => void baixarEspelho(sel)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40" title="Espelho de ponto deste colaborador (PDF)">{exportBusy === "espelho" ? "…" : "🖨 Espelho"}</button>
              </div>
            </div>
            {acaoMsg && <div className={`px-3 py-1.5 text-[11.5px] border-b border-gray-100 dark:border-gray-800 ${acaoMsg.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{acaoMsg}</div>}
            {selCorr.size > 0 && (
              <div className="px-3 py-2 border-b border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[12px] text-blue-800 dark:text-blue-200 font-medium">💬 {selCorr.size} dia(s) selecionado(s) para pedir correção ao empregado</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSelCorr(new Set())} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800">Limpar</button>
                  <button type="button" onClick={() => setCorrModal(true)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600">Montar mensagem →</button>
                </div>
              </div>
            )}
            <div className="px-3 py-2">
              {sel.r.linhas.length === 0 ? <div className="text-sm text-gray-400 py-4 text-center">Sem batidas nem dias previstos de trabalho em {comp}.</div> : (<>

              {/* MOBILE — card por dia */}
              <div className="sm:hidden flex flex-col gap-1.5">
                {sel.r.linhas.map((l, idx) => { const f = flagsLinha(l, idx); return (
                  <div key={l.data} className={`rounded-lg px-2.5 py-2 ${f.rowBg || "bg-gray-50/40 dark:bg-gray-800/20"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-[12.5px] text-gray-600 dark:text-gray-300"><span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100 mr-1.5">{l.data.slice(-2)}/{l.data.slice(5, 7)}</span>{renderPrevisto(l)}</div>
                      {renderAcoes(l, f.pendUndecided, f.temCorrigivel)}
                    </div>
                    <div className="mt-1 text-[12.5px] text-gray-700 dark:text-gray-200">{renderBatidas(l, f.inclPunch)}</div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
                      <span className="text-gray-500">Trab. <strong className="text-gray-700 dark:text-gray-200 tabular-nums">{l.trabalhado ? hm(l.trabalhado) : "—"}</strong></span>
                      {l.extra > 0 && <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">extra {hm(l.extra)}</span>}
                      {l.noturno > 0 && <span className="text-indigo-500 tabular-nums">not. {hm(l.noturno)}</span>}
                      <span className="ml-auto">{renderExcecoes(l, f.incompleta, f.suspeito)}</span>
                    </div>
                  </div>
                ); })}
              </div>

              {/* DESKTOP — tabela */}
              <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[12px] min-w-[640px] border-collapse [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-2">
                <colgroup><col className="w-14" /><col className="w-32" /><col /><col className="w-16" /><col className="w-16" /><col className="w-14" /><col className="w-20" /><col className="w-12" /></colgroup>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-200 dark:border-gray-800">
                    <th className="py-1.5 font-semibold">Dia</th><th className="font-semibold">Previsto</th><th className="font-semibold">Batidas / tratamento</th>
                    <th className="font-semibold text-right">Trab.</th><th className="font-semibold text-right">Extra</th><th className="font-semibold text-right" title="Adicional noturno — minutos trabalhados na faixa noturna (22h–05h)">Not.</th><th className="font-semibold">Exceções</th><th className="font-semibold text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.r.linhas.map((l, idx) => { const f = flagsLinha(l, idx); return (
                    <tr key={l.data} className={`border-b border-gray-50 dark:border-gray-800/40 ${f.rowBg}`}>
                      <td className="tabular-nums font-medium text-gray-700 dark:text-gray-200">{l.data.slice(-2)}/{l.data.slice(5, 7)}</td>
                      <td className={`whitespace-nowrap ${f.folga ? "text-gray-400" : "text-gray-600 dark:text-gray-300"}`}>{renderPrevisto(l)}</td>
                      <td className="text-gray-700 dark:text-gray-200">{renderBatidas(l, f.inclPunch)}</td>
                      <td className="text-right tabular-nums font-medium">{l.trabalhado ? hm(l.trabalhado) : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{l.extra ? hm(l.extra) : ""}</td>
                      <td className="text-right tabular-nums text-indigo-500">{l.noturno ? hm(l.noturno) : ""}</td>
                      <td>{renderExcecoes(l, f.incompleta, f.suspeito)}</td>
                      <td className="text-right whitespace-nowrap">{renderAcoes(l, f.pendUndecided, f.temCorrigivel)}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
              </div>
              </>)}
            </div>
          </div>
        )}
        {batidasSemCadastro.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10 p-3 text-[12px] text-amber-800 dark:text-amber-300">
            ⚠ {batidasSemCadastro.length} pessoa(s) com batida mas <strong>sem empregado cadastrado</strong> neste restaurante (CPF não casou).
          </div>
        )}
        </>
      ))}
      {ajusteModal && me && <AjusteModal empresaKey={shortCode} emp={ajusteModal.emp} data={ajusteModal.data} bs={ajusteModal.bs} solidesEmpId={empIdPorCpf.get(soDig(ajusteModal.emp.cpf)) || null} autor={{ id: me.id, nome: me.nome }} onClose={() => setAjusteModal(null)} />}
      {assModal && me && <PtrpAssinaturasModal empresaKey={shortCode} comp={comp} compLabel={labelComp(comp)} restaurantId={rid} driveFolderInit={{ id: (activeRestaurant as { drivePontoAssinadoFolderId?: string } | null)?.drivePontoAssinadoFolderId, nome: (activeRestaurant as { drivePontoAssinadoFolderNome?: string } | null)?.drivePontoAssinadoFolderNome }} alvos={alvosAssinatura()} meta={espelhoMeta()} autor={{ id: me.id, nome: me.nome }} onClose={() => setAssModal(false)} />}
      {preview && (
        <Modal title={preview.titulo} onClose={fecharPreview} maxWidth="max-w-4xl">
          <div className="space-y-2">
            <iframe title="Espelho de ponto" src={preview.url} className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white" style={{ height: "70vh" }} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">Pré-visualização — role para ver todas as páginas.</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={fecharPreview}>Fechar</Button>
                <Button onClick={() => void baixarOuCompartilhar(preview.blob, preview.nome, { titulo: preview.titulo })}>⬇️ Baixar / Compartilhar</Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {corrModal && sel && (
        <CorrecaoLoteModal
          emp={sel.emp}
          qtd={selCorr.size}
          textoInicial={montarTextoCorrecao(sel.emp, sel.r.linhas.filter(l => selCorr.has(l.data)))}
          onClose={() => setCorrModal(false)}
          onEnviar={texto => enviarCorrecaoLote(sel.emp, texto)}
        />
      )}
    </div>
  );
}

// Modal do pedido de correção em LOTE — mostra a mensagem montada (todos os dias
// selecionados), EDITÁVEL, e envia pela linha do DP/Ponto no WhatsApp interno.
function CorrecaoLoteModal({ emp, qtd, textoInicial, onClose, onEnviar }: { emp: Empregado; qtd: number; textoInicial: string; onClose: () => void; onEnviar: (texto: string) => void }) {
  const [texto, setTexto] = useState(textoInicial);
  return (
    <Modal title={`Pedir correção · ${emp.nome} · ${qtd} dia(s)`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="text-[11px] text-gray-500">Revise/edite a mensagem — ela vai pela linha de <strong>Empregados / DP</strong> no WhatsApp. Você pode ajustar o texto (ex.: “faltam 2 batidas nesse dia”).</div>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={12} className="w-full px-2.5 py-1.5 text-[12.5px] leading-relaxed rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 font-mono" />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onEnviar(texto)} disabled={!texto.trim()}>💬 Abrir no WhatsApp</Button>
        </div>
      </div>
    </Modal>
  );
}

// Modal de TRATAMENTO (gera ptrpAjustes — nunca edita a batida original).
function AjusteModal({ empresaKey, emp, data, bs, solidesEmpId, autor, onClose }: { empresaKey: string; emp: Empregado; data: string; bs: BatidaDoc[]; solidesEmpId: string | null; autor: { id: string; nome: string }; onClose: () => void }) {
  const [sel, setSel] = useState("inclusao");   // "inclusao" | "desconsideracao" | "motivo:<id>"
  const [motivosMapa, setMotivosMapa] = useState<{ id: number; descricao: string; status: string }[]>([]);
  useEffect(() => onSnapshot(doc(db, "ptrpMotivosMapa", empresaKey), d => {
    const m = (d.exists() ? (d.data() as { mapa?: Record<string, { status?: string; exibir?: boolean; descricao?: string }> }).mapa : {}) || {};
    setMotivosMapa(Object.entries(m).filter(([, v]) => v.exibir).map(([id, v]) => ({ id: Number(id), descricao: v.descricao || `Motivo ${id}`, status: v.status || "" })));
  }), [empresaKey]);
  const ehMotivo = sel.startsWith("motivo:");
  const motivoInfo = ehMotivo ? motivosMapa.find(m => m.id === Number(sel.slice(7))) : null;
  const tipo: PtrpAjusteTipo = sel === "desconsideracao" ? "desconsideracao" : sel === "inclusao" ? "inclusao" : "abono";
  const [hin, setHin] = useState("08:00");
  const [hout, setHout] = useState("17:00");
  const [punchId, setPunchId] = useState(bs[0]?.punchId || "");
  const [motivo, setMotivo] = useState("");
  const [aplicarSolides, setAplicarSolides] = useState(true);
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [justId, setJustId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const inp = "w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  // Fase 1: só inclusão/desconsideração refletem na Sólides. Afastamentos = fase 2.
  const refleteSolides = tipo === "inclusao" || tipo === "desconsideracao";

  useEffect(() => {
    if (tipo === "inclusao" && aplicarSolides && justs.length === 0) {
      void fetchJustificativas(empresaKey).then(js => { setJusts(js); if (js[0]) setJustId(js[0].id); }).catch(() => {});
    }
  }, [tipo, aplicarSolides, empresaKey, justs.length]);

  async function salvar() {
    if (!ehMotivo && !motivo.trim()) { setErr("Descreva o motivo (obrigatório na trilha)."); return; }
    if (tipo === "desconsideracao" && !punchId) { setErr("Escolha a batida a desconsiderar."); return; }
    const aplicar = refleteSolides && aplicarSolides;
    if (aplicar && !solidesEmpId) { setErr("Sem o vínculo Sólides deste colaborador (nenhuma batida com employeeId no mês). Sincronize, ou desmarque 'aplicar na Sólides'."); return; }
    if (aplicar && tipo === "inclusao" && !justId) { setErr("Escolha a justificativa (exigida pela Sólides)."); return; }
    setErr(""); setSalvando(true);
    try {
      // 1) Aplica na Sólides PRIMEIRO (mantém os dois lados consistentes; se falhar, não grava aqui).
      if (aplicar && tipo === "inclusao") {
        const iso = (hhmm: string) => `${data}T${hhmm}:00.000-0300`;
        await corrigirPontoAtraso(empresaKey, { employeeId: Number(solidesEmpId), dataHoraIso: iso(hin), justificativaId: justId! });
        await corrigirPontoAtraso(empresaKey, { employeeId: Number(solidesEmpId), dataHoraIso: iso(hout), justificativaId: justId! });
      } else if (aplicar && tipo === "desconsideracao") {
        const b = bs.find(x => (x.punchId || "") === punchId);
        if (!b) throw new Error("Batida não encontrada.");
        const empId = b.employeeId || solidesEmpId;
        if (!empId) throw new Error("Sem o employeeId da batida.");
        await excluirBatida(empresaKey, { employeeId: Number(empId), punchId: Number(punchId), dateIn: b.dateIn ?? undefined, dateOut: b.dateOut ?? undefined });
      }
      // 2) Grava a trilha no app (Portaria 671).
      const aj: Omit<PtrpAjuste, "id"> = {
        empresaKey, colaboradorId: emp.id, cpf: (emp.cpf || "").replace(/\D/g, ""), data, tipo,
        ...(tipo === "inclusao" ? { in: hin, out: hout } : {}),
        ...(tipo === "desconsideracao" ? { punchId } : {}),
        ...(ehMotivo && motivoInfo ? { motivoSolidesId: motivoInfo.id, statusEscala: motivoInfo.status || null } : {}),
        motivo: motivo.trim() || (motivoInfo ? motivoInfo.descricao : ""), autor, criadoEm: new Date().toISOString(), cancelado: false,
      };
      await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore(aj));
      onClose();
    } catch (e) { setErr((refleteSolides && aplicarSolides ? "Falha ao aplicar na Sólides: " : "Falha ao salvar: ") + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }

  const hhmmLocal = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

  return (
    <Modal title={`Tratar · ${emp.nome} · ${data.slice(-2)}/${data.slice(5, 7)}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="text-[11px] text-gray-500">A batida original é imutável — o tratamento entra como lançamento adicional, com autor e data (Portaria 671).</div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo de tratamento</label>
          <select value={sel} onChange={e => setSel(e.target.value)} className={inp}>
            <option value="inclusao">➕ Incluir marcação (esquecimento)</option>
            <option value="desconsideracao">🚫 Desconsiderar uma batida (duplicada/errada)</option>
            {motivosMapa.length > 0 && <optgroup label="☂️ Abono / Afastamento (motivos da Sólides)">
              {motivosMapa.map(m => <option key={m.id} value={`motivo:${m.id}`}>{m.descricao}</option>)}
            </optgroup>}
          </select>
          {motivosMapa.length === 0 && <span className="text-[10px] text-amber-600 dark:text-amber-400">Nenhum motivo marcado — configure em Configurações › Mapeamento de motivos pra abonar/afastar.</span>}
        </div>
        {tipo === "inclusao" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Entrada</label><input type="time" value={hin} onChange={e => setHin(e.target.value)} className={inp} /></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Saída</label><input type="time" value={hout} onChange={e => setHout(e.target.value)} className={inp} /></div>
          </div>
        )}
        {tipo === "desconsideracao" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Batida a desconsiderar</label>
            <select value={punchId} onChange={e => setPunchId(e.target.value)} className={inp}>
              {bs.length === 0 && <option value="">— sem batidas neste dia —</option>}
              {bs.map(b => <option key={b.punchId || b.id} value={b.punchId || ""}>{hhmmLocal(b.dateIn)}–{hhmmLocal(b.dateOut)}</option>)}
            </select>
          </div>
        )}
        {refleteSolides ? (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-900/10 p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={aplicarSolides} onChange={e => setAplicarSolides(e.target.checked)} />
              Aplicar também na Sólides {tipo === "inclusao" ? "(registra as marcações lá)" : "(exclui a batida lá)"}
            </label>
            {aplicarSolides && !solidesEmpId && <div className="text-[11px] text-amber-700 dark:text-amber-400">⚠ Sem vínculo Sólides deste colaborador no mês — sincronize antes, ou desmarque acima.</div>}
            {aplicarSolides && tipo === "inclusao" && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">Justificativa (exigida pela Sólides)</label>
                <select value={justId ?? ""} onChange={e => setJustId(Number(e.target.value) || null)} className={inp}>
                  {justs.length === 0 && <option value="">carregando…</option>}
                  {justs.map(j => <option key={j.id} value={j.id}>{j.description}</option>)}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-900/10 p-2 text-indigo-800 dark:text-indigo-200">☂️ Motivo <strong>{motivoInfo?.descricao}</strong> (Sólides) → praticada como <strong>{STATUS_INFO[(motivoInfo?.status || "trabalho") as ScheduleStatus]?.label || motivoInfo?.status || "—"}</strong>. Registrado no app por enquanto; envio à Sólides vem na fase 2.</div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo / justificativa (trilha do app)</label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder="Ex.: esqueceu de bater a saída; atestado de 1 dia; batida duplicada…" className={inp} />
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1"><Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Lançar tratamento"}</Button></div>
      </div>
    </Modal>
  );
}
