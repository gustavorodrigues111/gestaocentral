// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Conferência / Apuração (prévia). Cruza as batidas sincronizadas
//  (ptrpBatidas, por shortCode = empresa) com o HORÁRIO PREVISTO do cadastro do
//  empregado (workSchedules — casado por CPF) e a CCT, e apura por colaborador
//  × dia. Não exige re-cadastro de turno: o previsto vem do vínculo/escala do
//  empregado (mesma fonte da Análise de Ponto). ptrpTurnos/ptrpEscalas ficam
//  como OVERRIDE opcional (fase seguinte). Valida contra o Sólides (Fase 1).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db, storage } from "../../core/firebase/config";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { authHeader } from "../../core/firebase/idToken";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { LucideIcon } from "lucide-react";
import {
  CircleOff, X, CalendarX2, Unlink, AlarmClock, Coffee, Hourglass, BedDouble, CircleDot,
  TriangleAlert, Pencil, Ban, Umbrella, MessageSquare, Settings, Lock, LockOpen,
  CalendarDays, Signature, Printer, ArrowDown, Search, Scale, PartyPopper, Landmark,
  HelpCircle, ChevronDown, Eye, Crown, RotateCw, CalendarCheck,
} from "lucide-react";
import type { Empregado, HorarioDia, Cargo, EscalaMes, ScheduleStatus, AjusteEscalaMeta } from "../../core/types";
import { calcularFechamentoPraticada } from "../../core/escala/fechamentoPraticada";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { empregadoBatePonto } from "../../core/types";
import type { ParametrosCCT, PtrpTurno, PtrpAjuste, PtrpAjusteTipo, PtrpBancoMov, PtrpApuracaoColab, PtrpApuracaoDia, PtrpFechamento, PtrpEvidencia } from "../../core/ptrp/tipos";
import { cctVigenteEm } from "../../core/ptrp/tipos";
import { gerarEspelhoPDF } from "../../core/ptrp/espelhoPDF";
import { gerarAEJ } from "../../core/ptrp/aej";
import { baixarOuCompartilhar } from "../../core/pdf/baixarOuCompartilhar";
import { DEV_PADRAO, REP_PADRAO, type ParametrosPTRP } from "./PtrpAejConfig";
import { PtrpAssinaturasModal, type AlvoAssinatura } from "./PtrpAssinaturasModal";
import { getActiveWorkSchedule, getEffectiveDays } from "../../core/escala/horarios";
import { apurarDia, minutoDoDiaBRT, hhmmToMin, type BatidaBloco, type AjusteDia } from "../../core/ptrp/apuracao";
import { feriadosDoAno } from "../../core/ptrp/feriados";
import { fetchRoster, decidirAprovacao, corrigirPontoAtraso, excluirBatida, fetchJustificativas, fetchMotivosAfastamento, lancarAfastamento, criarAfastamentoNovo } from "../../core/ponto/solidesPontoClient";
import type { Justificativa, MotivoAfastamento } from "../../core/ponto/solidesPontoClient";
import { fetchPunches } from "../../core/excecoes/solidesClient";
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

// Correção pendente derivada do feed de batidas (mesma regra da Análise de Ponto).

const compAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const hm = (min: number) => min <= 0 ? "0h00" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const hmSigned = (min: number) => (min < 0 ? "−" : "+") + hm(Math.abs(min));
const somaDiasYmd = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const fmtDataBR = (ymd?: string | null) => ymd ? ymd.split("-").reverse().join("/") : "—";
const DOW_ABREV = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemanaAbrev = (ymd: string) => DOW_ABREV[new Date(ymd + "T12:00:00").getDay()] || "";
const hhmm = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const hhmmN = (ms?: number | null) => ms == null ? null : hhmm(ms);
const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
const EXC_LABEL: Record<string, string> = { sem_batida: "sem batida", falta: "falta", fora_escala: "fora de escala", batida_impar: "batida ímpar", atraso: "atraso", intervalo_curto: "intervalo curto", jornada_longa: "jornada > limite", interjornada: "interjornada < mín.", correcao_pendente: "correção pendente" };
// Ícone por exceção (tooltip mostra o texto) — evita quebra de linha na coluna.
const EXC_LUCIDE: Record<string, LucideIcon> = { sem_batida: CircleOff, falta: X, fora_escala: CalendarX2, batida_impar: Unlink, atraso: AlarmClock, intervalo_curto: Coffee, jornada_longa: Hourglass, interjornada: BedDouble, correcao_pendente: CircleDot };
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

export function PtrpApuracaoTab({ mode = "conferencia" }: { mode?: "conferencia" | "banco" | "comparar" | "validar" | "validadores" | "fechar" } = {}) {
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
  const [ajusteModal, setAjusteModal] = useState<{ emp: Empregado; data: string; bs: BatidaDoc[]; reorgPares?: { in: string; out: string }[] } | null>(null);
  // Reclassificar o status na escala praticada de um dia (ex.: folga trabalhada).
  const [reclass, setReclass] = useState<{ emp: Empregado; data: string; prev?: ScheduleStatus } | null>(null);
  const [reclassBusy, setReclassBusy] = useState(false);
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
  // Dias com correção pendente → o dia INTEIRO ao vivo (cada marcação com seu
  // status real), chaveado por `${cpf}|${date}`. Substitui o dia do espelho pra
  // o PTRP ficar idêntico à Análise (que lê ao vivo).
  // Batidas do mês lidas AO VIVO da Sólides (por cpf|dia). Fonte PRIMÁRIA da
  // apuração — o espelho ptrpBatidas vira só fallback quando a Sólides cai.
  const [liveCorrigidos, setLiveCorrigidos] = useState<Record<string, BatidaDoc[]>>({});
  const [liveMesOk, setLiveMesOk] = useState(false);   // o mês inteiro veio ao vivo?
  const [pendErr, setPendErr] = useState("");
  const [selCorr, setSelCorr] = useState<Set<string>>(new Set());   // dias marcados p/ pedir correção (lote)
  const [corrModal, setCorrModal] = useState(false);
  const [fecharMode, setFecharMode] = useState(false);              // modo "travar dias na praticada"
  const [selFechar, setSelFechar] = useState<Set<string>>(new Set());
  const [fecharBusy, setFecharBusy] = useState(false);
  const [chunkIni, setChunkIni] = useState(1);                      // 1º dia da semana visível (aba Fechar praticada)
  const [selGrid, setSelGrid] = useState<Set<string>>(new Set());   // "empId|YYYY-MM-DD" marcados no grid semanal
  const [gridBusy, setGridBusy] = useState(false);
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

  // Sincroniza a Sólides SOB DEMANDA (não espera o cron de 15 min): re-varre o
  // mês visível inteiro (desde dia 01) e traz batidas/correções novas pro espelho
  // imutável. O onSnapshot em ptrpBatidas atualiza a tabela sozinho quando chega.
  const [sincBusy, setSincBusy] = useState(false);
  const [sincMsg, setSincMsg] = useState("");
  async function sincronizarSolides() {
    if (!shortCode) { setSincMsg("Empresa sem shortCode."); return; }
    setSincBusy(true); setSincMsg("");
    try {
      const r = await fetch(`/api/ptrp-punch-sync?empresa=${encodeURIComponent(shortCode)}&desde=${comp}-01`, { method: "GET", headers: { ...(await authHeader()) } });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; resultado?: Record<string, { lidas?: number; criadas?: number; erro?: string }> };
      if (!r.ok || j.error) { setSincMsg(j.error || `Falha (HTTP ${r.status}).`); return; }
      const res = j.resultado?.[shortCode];
      if (res?.erro) { setSincMsg(`Falha: ${res.erro}`); return; }
      const criadas = res?.criadas ?? 0;
      setSincMsg(criadas > 0 ? `✓ ${criadas} batida(s) nova(s) trazida(s) da Sólides — a tabela atualiza sozinha.` : `✓ Sincronizado — nenhuma batida nova na Sólides desde a última vez (correção pendente só entra depois de aprovada).`);
    } catch (e) { setSincMsg(e instanceof Error ? e.message : "Falha na sincronização."); }
    finally { setSincBusy(false); void carregarPendentes(); }
  }

  // Correções AINDA NÃO aprovadas na Sólides (a Sólides só materializa a batida
  // no feed depois de aprovada; até lá elas vivem só na fila de aprovação). Puxa
  // o mês e injeta como batida PENDING sintética — a UI de correção pendente
  // (tracejado + ✓/✗) acende sem depender do espelho imutável.
  async function carregarPendentes() {
    if (!shortCode || !comp) { setLiveCorrigidos({}); setLiveMesOk(false); return; }
    try {
      const hojeStr = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const fimMes = `${comp}-${String(diasDoMes).padStart(2, "0")}`;
      const ini = `${comp}-01`, fim = fimMes < hojeStr ? fimMes : hojeStr;   // não pede dia futuro (Sólides 404)
      if (ini > fim) { setLiveCorrigidos({}); setLiveMesOk(false); setPendErr(""); return; }   // mês futuro: nada a buscar
      const { punches } = await fetchPunches(ini, fim, shortCode, true);
      // Fonte da verdade = Sólides. Lê o MÊS INTEIRO ao vivo (todos os dias, todas
      // as marcações, com o status real: aprovada conta, PENDING fica tracejada).
      // Assim o PTRP fica idêntico à Análise e some a divergência do espelho velho.
      const ymd = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
      const corr: Record<string, BatidaDoc[]> = {};
      for (const p of punches) {
        const cpf = (p.employee?.cpf || "").replace(/\D/g, "");
        const date = p.date || (typeof p.dateIn === "number" ? ymd(p.dateIn) : "");
        if (!cpf || !date) continue;
        const key = `${cpf}|${date}`;
        const st = String(p.status || "").toUpperCase();
        (corr[key] = corr[key] || []).push({
          id: `live_${p.id}`, empresaKey: shortCode, punchId: String(p.id),
          employeeId: p.employeeId != null ? String(p.employeeId) : null, cpf, date,
          dateIn: typeof p.dateIn === "number" ? p.dateIn : null,
          dateOut: (typeof p.dateOut === "number" && p.dateOut > p.dateIn) ? p.dateOut : null,
          status: st === "PENDING" ? "PENDING" : st === "REJECTED" ? "REJECTED" : null,
          excluded: p.excluded === true,
          edited: p.edited === true,
        });
      }
      setLiveCorrigidos(corr);
      setLiveMesOk(true);
      setPendErr("");
    } catch (e) {
      // Se a Sólides recusar/estourar (404/timeout), NÃO quebra a tela: cai pro
      // espelho ptrpBatidas (última sincronização) e registra a causa na nota.
      setLiveCorrigidos({});
      setLiveMesOk(false);
      setPendErr(e instanceof Error ? e.message : "");
    }
  }
  useEffect(() => { void carregarPendentes(); }, [shortCode, comp]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  // Nº de correções pendentes (pra o aviso no topo).
  const qtdPendentes = useMemo(() => Object.values(liveCorrigidos).reduce((s, arr) => s + arr.filter(correcaoPendente).length, 0), [liveCorrigidos]);

  // Batidas por CPF → dia. FONTE PRIMÁRIA = ao vivo da Sólides (mês inteiro): a
  // apuração fica idêntica à Análise e some a divergência do espelho congelado.
  // Se o ao vivo falhou (timeout/404), cai pro espelho ptrpBatidas da última
  // sincronização — a tela nunca fica em branco.
  const batidasPorCpf = useMemo(() => {
    const m: Record<string, Record<string, BatidaDoc[]>> = {};
    if (liveMesOk) {
      for (const [key, arr] of Object.entries(liveCorrigidos)) { const i = key.indexOf("|"); const cpf = key.slice(0, i), date = key.slice(i + 1); if (!cpf || !date) continue; (m[cpf] = m[cpf] || {})[date] = arr; }
    } else {
      for (const b of batidas) { const c = soDig(b.cpf); if (!c) continue; (m[c] = m[c] || {}); (m[c][b.date || ""] = m[c][b.date || ""] || []).push(b); }
    }
    return m;
  }, [batidas, liveCorrigidos, liveMesOk]);
  // employeeId do Sólides por CPF (espelho + dias ao vivo) — pra aplicar correções lá.
  const empIdPorCpf = useMemo(() => { const m = new Map<string, string>(); const all = [...batidas, ...Object.values(liveCorrigidos).flat()]; for (const b of all) { const c = soDig(b.cpf); if (c && b.employeeId && !m.has(c)) m.set(c, String(b.employeeId)); } return m; }, [batidas, liveCorrigidos]);
  // Ajustes (não cancelados) por CPF → dia.
  const ajustesPorCpf = useMemo(() => {
    const m: Record<string, Record<string, PtrpAjuste[]>> = {};
    for (const a of ajustes) { if (a.cancelado) continue; const c = soDig(a.cpf); if (!c) continue; (m[c] = m[c] || {}); (m[c][a.data] = m[c][a.data] || []).push(a); }
    return m;
  }, [ajustes]);

  type Linha = { data: string; bs: BatidaDoc[]; bsRaw: BatidaDoc[]; descPunch: Set<string>; decididos: Set<string>; ajustesDia: PtrpAjuste[]; previstoTxt: string; statusEscala?: ScheduleStatus; statusPrevisto?: ScheduleStatus; trabalhado: number; extra: number; noturno: number; previstoMin: number; atrasoMin: number; abonadoMin: number; excecoes: string[]; primeiraMs: number | null; ultimaMs: number | null; ehFeriado: boolean; ehFuturo: boolean; ehHoje: boolean; pendenteCorrecao: boolean; reorgPares?: { in: string; out: string }[]; bsVirada?: BatidaDoc[] };
  function apurarColab(emp: Empregado) {
    const cpf = soDig(emp.cpf);
    const dias = batidasPorCpf[cpf] || {};
    const ajDias = ajustesPorCpf[cpf] || {};
    const linhas: Linha[] = [];
    let saldoMes = 0;   // banco de horas do mês: Σ (trabalhado + abonado − previsto)
    const hojeStr = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    for (let d = 1; d <= diasDoMes; d++) {
      const data = `${comp}-${String(d).padStart(2, "0")}`;
      // Ordena as batidas por horário (a correção lançada depois pode vir fora de
      // ordem no armazenamento) — deixa render/marcações/CSV cronológicos.
      const bsRaw = dias[data] || [];   // registros crus da Sólides (p/ excluir individualmente no modal)
      // Turno que vira a meia-noite: a Sólides data a SAÍDA (00:00) no dia SEGUINTE.
      // Se hoje tem entrada noturna aberta, puxa as marcações de madrugada (<05:00)
      // do dia seguinte pra o tratamento poder pareá-las aqui (ex.: 18:01 + 00:00).
      const temEntradaNoiteAberta = bsRaw.some(b => !b.excluded && typeof b.dateIn === "number" && minutoDoDiaBRT(b.dateIn) > 720 && (b.dateOut == null || minutoDoDiaBRT(b.dateOut) < minutoDoDiaBRT(b.dateIn)));
      const bsVirada = temEntradaNoiteAberta ? (dias[somaDiasYmd(data, 1)] || []).filter(b => !b.excluded && typeof b.dateIn === "number" && minutoDoDiaBRT(b.dateIn) < 300) : [];
      const ajustesDia = ajDias[data] || [];
      // Desconsideração: remove a batida referida ANTES de reparear/apurar — assim
      // os horários que sobram são remontados cronologicamente (igual ao preview do
      // modal). Imutável: a batida original continua na Sólides, só é ignorada aqui.
      const descPunch = new Set(ajustesDia.filter(a => a.tipo === "desconsideracao" && a.punchId).map(a => a.punchId as string));
      const bs = reparearDia(bsRaw.filter(b => !(b.punchId && descPunch.has(b.punchId))));
      const ehFuturo = data > hojeStr;   // dia ainda não aconteceu (BRT)
      const ehHoje = data === hojeStr;   // dia em ANDAMENTO — não acusa erro ainda
      const statusEscala = escala ? (escala.real?.[emp.id]?.[data] ?? escala.prevista?.[emp.id]?.[data]) : undefined;
      const statusPrevisto = escala?.prevista?.[emp.id]?.[data];   // SÓ o previsto (sem a real) — pra comparar previsto × praticado
      const prev = turnoPrevisto(emp, data, statusEscala);
      // Mostra TODOS os dias do mês — inclusive folgas, dias sem batida e FUTUROS
      // (estes só com o previsto, sem virar falta e fora do saldo).
      // Batidas pendentes já DECIDIDAS (aprovada→inclusão / reprovada→desconsideração
      // carregam o punchId) — deixam de contar como "correção pendente".
      const decididos = new Set<string>([...descPunch, ...ajustesDia.filter(a => a.tipo === "inclusao" && a.punchId).map(a => a.punchId as string)]);
      // Só a batida EFETIVA (aprovada) entra na apuração — espelha o oficial.
      // A correção pendente é preservada em `bs` (aparece na linha), mas não soma.
      const blocos: BatidaBloco[] = bs.filter(b => !b.excluded && !correcaoPendente(b) && !(b.punchId && descPunch.has(b.punchId))).map(b => ({ dateIn: b.dateIn as number, dateOut: (b.dateOut ?? null) as number | null }));
      // REORGANIZAÇÃO MANUAL: se o DP redefiniu os pares do dia (ex.: 18:01–00:00),
      // a apuração usa ESSES pares e ignora as batidas (app-only, independe de
      // aprovação). Some a pendência de "batida aberta"/ímpar deste dia.
      const reorg = ajustesDia.find(a => a.tipo === "reorganizacao" && !a.cancelado);
      const blocosEfetivos: BatidaBloco[] = reorg ? [] : blocos;
      // Batida ABERTA (entrada sem a saída pareada) = dia PENDENTE: não dá pra
      // apurar o saldo até completar a batida. O dia fica "pendente" e conta
      // ZERO no banco de horas (não distorce o mês por esquecimento de batida).
      const temBatidaAberta = blocosEfetivos.some(b => b.dateIn != null && b.dateOut == null);
      const pendenteCorrecao = !ehFuturo && !ehHoje && temBatidaAberta;
      // Inclusões e abonos entram como lançamento no motor. Com reorganização, os
      // pares dela SUBSTITUEM as inclusões de batida (mas mantém abonos).
      const ajMotor: AjusteDia[] = [];
      for (const a of ajustesDia) {
        if (reorg && a.tipo === "inclusao") continue;
        if (a.tipo === "inclusao" && a.in && a.out) ajMotor.push({ tipo: "inclusao", in: hhmmToMin(a.in), out: hhmmToMin(a.out) });
        else if (["abono", "atestado", "folga", "ferias", "afastamento"].includes(a.tipo)) ajMotor.push({ tipo: a.tipo as "abono", minutos: a.minutos || undefined });
      }
      if (reorg) for (const p of (reorg.pares || [])) if (p.in && p.out) ajMotor.push({ tipo: "inclusao", in: hhmmToMin(p.in), out: hhmmToMin(p.out) });
      const ehDomingo = new Date(data + "T12:00:00").getDay() === 0;
      const ehFeriado = feriadosSet.has(data);
      let trabalhado = 0, extra = 0, noturno = 0, previstoMin = 0, atrasoMin = 0, abonadoMin = 0, excecoes: string[] = [], previstoTxt = "—";
      if (prev.kind === "trabalho" && prev.turno) previstoTxt = prev.turno.janelas.map(j => `${j.in}–${j.out}`).join(" ");
      else if (prev.kind === "folga") previstoTxt = "folga";
      else previstoTxt = "sem cadastro";
      if (ehFuturo) {
        // Dia futuro: só o previsto aparece; nada de falta/exceção nem saldo.
        trabalhado = blocosEfetivos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      } else if (cct && prev.kind !== "implicito") {
        const ap = apurarDia({ data, blocos: blocosEfetivos, turno: prev.turno, cct, ehDomingo, ehFeriado, ajustes: ajMotor });
        trabalhado = ap.minutosTrabalhados; extra = ap.minutosExtras; noturno = ap.noturnoMin;
        excecoes = ehHoje ? [] : ap.excecoes;   // HOJE em andamento → sem erro (falta/ponto aberto só a partir de amanhã)
        previstoMin = ap.minutosPrevistos; atrasoMin = ap.atrasoMin; abonadoMin = ap.abonadoMin;
        if (!ehHoje && !pendenteCorrecao) saldoMes += ap.minutosTrabalhados + ap.abonadoMin - ap.minutosPrevistos;   // hoje/pendente não entram no saldo
      } else {
        trabalhado = blocosEfetivos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      }
      // Correção não aprovada E ainda não decidida → pendência a tratar. Como a
      // batida pendente não conta, o motor marca falta/sem batida — mas a pessoa
      // BATEU (só aguarda aprovação): remove falta/sem batida e sinaliza pendência.
      if (!reorg && !ehHoje && bs.some(b => correcaoPendente(b) && !(b.punchId && decididos.has(b.punchId)))) excecoes = [...excecoes.filter(e => e !== "falta" && e !== "sem_batida"), "correcao_pendente"];
      // Entrada/saída reais (ms) do dia — pra checar interjornada entre dias.
      const ins = blocosEfetivos.map(b => b.dateIn).filter((x): x is number => typeof x === "number");
      const outs = blocos.map(b => b.dateOut).filter((x): x is number => typeof x === "number");
      const primeiraMs = ins.length ? Math.min(...ins) : null;
      const ultimaMs = outs.length ? Math.max(...outs) : null;
      // Atraso VALIDADO pelo líder como "não foi atraso" (autorizado) → abona os
      // minutos (zera no saldo) e some a exceção de atraso da trilha.
      if (!ehHoje && !pendenteCorrecao && atrasoMin > 0 && ajustesDia.some(a => a.tipo === "atraso_justificado")) {
        abonadoMin += atrasoMin; saldoMes += atrasoMin; excecoes = excecoes.filter(e => e !== "atraso"); atrasoMin = 0;
      }
      linhas.push({ data, bs, bsRaw, descPunch, decididos, ajustesDia, previstoTxt, statusEscala: statusEscala as ScheduleStatus | undefined, statusPrevisto: statusPrevisto as ScheduleStatus | undefined, trabalhado, extra, noturno, previstoMin, atrasoMin, abonadoMin, excecoes, primeiraMs, ultimaMs, ehFeriado, ehFuturo, ehHoje, pendenteCorrecao, reorgPares: reorg?.pares, bsVirada });
    }
    // Interjornada: descanso entre a última saída de um dia e a 1ª entrada do dia
    // seguinte (calendário) < mínimo da CCT → exceção no dia seguinte.
    const minInter = (cct?.interjornadaMinHoras || 11) * 3_600_000;
    for (let i = 1; i < linhas.length; i++) {
      const ant = linhas[i - 1], atu = linhas[i];
      const consecutivo = (Date.parse(atu.data) - Date.parse(ant.data)) === 86_400_000;
      if (consecutivo && !atu.ehHoje && !atu.ehFuturo && ant.ultimaMs != null && atu.primeiraMs != null && (atu.primeiraMs - ant.ultimaMs) < minInter && !atu.excecoes.includes("interjornada")) atu.excecoes.push("interjornada");
    }
    // Apurados = dias já fechados (do dia 01 até ONTEM). Hoje e futuros não
    // entram no saldo — por isso o previsto/trabalhado do saldo também é só até ontem.
    const apurados = linhas.filter(l => !l.ehHoje && !l.ehFuturo && !l.pendenteCorrecao);
    const prevAteOntem = apurados.reduce((s, l) => s + l.previstoMin, 0);
    const trabAteOntem = apurados.reduce((s, l) => s + l.trabalhado + l.abonadoMin, 0);
    return { linhas, temCpf: !!cpf, saldoMes, prevAteOntem, trabAteOntem, totTrab: linhas.reduce((s, l) => s + l.trabalhado, 0), totExtra: linhas.reduce((s, l) => s + l.extra, 0), totNot: linhas.reduce((s, l) => s + l.noturno, 0), exc: linhas.reduce((s, l) => s + l.excecoes.length, 0) };
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
    finally { setAcaoBusy(false); void carregarPendentes(); }
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
      // A solicitação de correção do empregado NÃO entra no espelho/AEJ enquanto
      // pendente, e nunca se for reprovada — o dia fica sem batida até a aprovação
      // (Portaria 671: o oficial só reflete o que foi aprovado).
      if ((pend && !decidido) || reprovada) continue;
      out.push({
        in: hhmmN(b.dateIn), out: hhmmN(b.dateOut), status: b.status || null,
        pendente: false,
        desconsiderada: descByAjuste,
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

  // Status PRATICADO do dia (a partir da apuração + tratamento) — vira a escala real.
  // Regra alinhada ao Análise de Ponto: motivo mapeado tem prioridade; senão,
  // trabalhou→trabalho (ou comp_trab se previsto era folga/comp); dia de trabalho
  // sem batida→falta_i; folga/comp/férias mantém. Futuro/hoje NÃO fecham.
  function statusPraticado(l: Linha): ScheduleStatus | null {
    if (l.ehFuturo || l.ehHoje) return null;
    const ajComStatus = l.ajustesDia.find(a => a.statusEscala);
    if (ajComStatus?.statusEscala) return ajComStatus.statusEscala as ScheduleStatus;
    const prev = l.statusEscala as ScheduleStatus | undefined;
    const trabalhou = l.trabalhado > 0 || l.bs.some(b => !b.excluded && !correcaoPendente(b) && b.dateIn != null);
    if (trabalhou) {
      if (prev === "comp_trab" || prev === "freela") return prev;
      if (prev === "folga" || prev === "comp") return "comp_trab";
      return "trabalho";
    }
    if (prev === "trabalho" || prev === "comp_trab" || (!prev && l.previstoTxt.includes("–"))) return "falta_i";   // dia de trabalho sem batida
    return prev ?? "folga";   // folga/comp/férias mantém; sem previsto vira folga
  }

  // Grava a escala PRATICADA (escalas/{rid}_{comp}.real) a partir da apuração.
  async function gerarPraticada() {
    if (!me || !rid) return;
    const alvo = colabsFechaveis();
    if (!alvo.length) { setAcaoMsg("Nada a fechar."); return; }
    if (!window.confirm(`Gerar a escala PRATICADA de ${labelComp(comp)} a partir da apuração?\n\nGrava o status realizado de cada dia (trabalho / falta / folga / afastamento) na escala do mês — vira a base da gorjeta e do fechamento. Dias de hoje/futuro não entram.`)) return;
    setFechBusy(true); setAcaoMsg("");
    try {
      const realPatch: Record<string, Record<string, ScheduleStatus>> = {};
      let n = 0;
      for (const x of alvo) for (const l of x.r.linhas) { const st = statusPraticado(l); if (!st) continue; (realPatch[x.emp.id] = realPatch[x.emp.id] || {})[l.data] = st; n++; }
      await setDoc(doc(db, "escalas", `${rid}_${comp}`), sanitizeForFirestore({ real: realPatch, atualizadoEm: new Date().toISOString(), atualizadoPor: { id: me.id, nome: me.nome } }), { merge: true });
      setAcaoMsg(`✓ Escala praticada gerada — ${n} dia(s) em ${alvo.length} colaborador(es).`);
    } catch (e) { setAcaoMsg("Falha ao gerar praticada: " + (e instanceof Error ? e.message : "erro")); }
    finally { setFechBusy(false); }
  }

  // ─── Travar dias na praticada (por empregado, tipo Análise de Ponto) ──────────
  // Grava real + realAjustes.origem="solides_sync" (o marcador que a Escala lê pra
  // pintar o dia como PRATICADO/vivo e liberar a gorjeta daquele dia). Serve pra
  // fechar um período no meio do mês (ex.: rescisão) sem esperar o fim.
  const mesEncerrado = !!escala?.fechadoEm;
  const diaFechado = (empId: string, data: string) => (escala?.realAjustes?.[empId]?.[data] as AjusteEscalaMeta | undefined)?.origem === "solides_sync";
  const toggleFechar = (data: string) => setSelFechar(prev => { const n = new Set(prev); if (n.has(data)) n.delete(data); else n.add(data); return n; });
  async function travarDias() {
    if (!aberto || !me || !rid || !selFechar.size) return;
    const alvo = resultados.find(x => x.emp.id === aberto);
    if (!alvo) return;
    if (mesEncerrado) { setAcaoMsg("Mês encerrado — reabra no módulo Escala pra editar a praticada."); return; }
    // Guardrail: não fecha dia com pendência (correção não decidida / batida ímpar
    // ou aberta) e avisa quando um dia vai fechar como FALTA (sem batida) sem o DP
    // ter classificado — evita gorjeta em cima de dia errado.
    const bloqueados: string[] = [];
    const faltasAuto: string[] = [];
    for (const l of alvo.r.linhas) {
      if (!selFechar.has(l.data)) continue;
      if (!statusPraticado(l)) continue;   // hoje/futuro nem entram
      const dd = `${l.data.slice(-2)}/${l.data.slice(5, 7)}`;
      if (l.excecoes.includes("correcao_pendente")) { bloqueados.push(`${dd} (correção do empregado ainda não aprovada)`); continue; }
      if (l.excecoes.includes("batida_impar") || l.pendenteCorrecao) { bloqueados.push(`${dd} (batida ímpar/aberta)`); continue; }
      // Falta auto (previsto trabalho, sem batida) que o DP NÃO classificou:
      if (statusPraticado(l) === "falta_i" && !l.ajustesDia.some(a => a.statusEscala)) faltasAuto.push(dd);
    }
    if (bloqueados.length) { setAcaoMsg(`Não dá pra fechar — resolva estes dias antes: ${bloqueados.join("; ")}. Aprove/reprove a correção (✓/✗) ou corrija a batida (⚙️ Tratar).`); return; }
    if (faltasAuto.length && !window.confirm(`${faltasAuto.length} dia(s) vão fechar como FALTA INJUSTIFICADA (previsto trabalho, sem batida): ${faltasAuto.join(", ")}.\n\nSe alguma for falta justificada, férias ou atestado, CANCELE e classifique antes (botão 📅 na 1ª coluna, ou ⚙️ Tratar). Fechar assim mesmo?`)) return;
    setFecharBusy(true); setAcaoMsg("");
    try {
      const now = new Date().toISOString();
      const realPatch: Record<string, ScheduleStatus> = {};
      const ajPatch: Record<string, AjusteEscalaMeta> = {};
      let n = 0;
      for (const l of alvo.r.linhas) {
        if (!selFechar.has(l.data)) continue;
        const st = statusPraticado(l);
        if (!st) continue;   // hoje/futuro não fecham
        realPatch[l.data] = st;
        ajPatch[l.data] = { origem: "solides_sync", ajustadoEm: now, ajustadoPor: me.id, ajustadoPorNome: me.nome, statusAnterior: escala?.real?.[alvo.emp.id]?.[l.data] as ScheduleStatus | undefined };
        n++;
      }
      if (!n) { setAcaoMsg("Nada a fechar — dias de hoje/futuro não fecham."); setFecharBusy(false); return; }
      await setDoc(doc(db, "escalas", `${rid}_${comp}`), sanitizeForFirestore({ real: { [alvo.emp.id]: realPatch }, realAjustes: { [alvo.emp.id]: ajPatch }, atualizadoEm: now, atualizadoPor: { id: me.id, nome: me.nome } }), { merge: true });
      setAcaoMsg(`✓ ${n} dia(s) fechado(s) na praticada de ${alvo.emp.nome}.`);
      setSelFechar(new Set()); setFecharMode(false);
    } catch (e) { setAcaoMsg("Falha ao fechar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setFecharBusy(false); }
  }
  async function reabrirDiaPraticada(empId: string, data: string) {
    if (!rid) return;
    if (mesEncerrado) { setAcaoMsg("Mês encerrado — reabra no módulo Escala."); return; }
    if (!confirm(`Reabrir ${data.slice(-2)}/${data.slice(5, 7)}? O dia volta a ser editável na praticada (o status gravado permanece até fechar de novo).`)) return;
    try {
      await updateDoc(doc(db, "escalas", `${rid}_${comp}`), { [`realAjustes.${empId}.${data}`]: deleteField(), atualizadoEm: new Date().toISOString() });
      setAcaoMsg("✓ Dia reaberto.");
    } catch (e) { setAcaoMsg("Falha ao reabrir: " + (e instanceof Error ? e.message : "erro")); }
  }
  // Fecha em LOTE os pares (empId, dia) marcados no grid semanal — mesmos guardrails.
  async function fecharGrid() {
    if (!me || !rid || !selGrid.size) return;
    if (mesEncerrado) { setAcaoMsg("Mês encerrado — reabra no módulo Escala."); return; }
    const porEmp = new Map<string, string[]>();
    for (const key of selGrid) { const i = key.indexOf("|"); const e = key.slice(0, i), d = key.slice(i + 1); (porEmp.get(e) || porEmp.set(e, []).get(e)!).push(d); }
    const now = new Date().toISOString();
    const bloqueados: string[] = []; const faltasAuto: string[] = [];
    const realFull: Record<string, Record<string, ScheduleStatus>> = {}; const ajFull: Record<string, Record<string, AjusteEscalaMeta>> = {};
    let n = 0;
    for (const [empId, dias] of porEmp) {
      const emp = empregados.find(e => e.id === empId); if (!emp) continue;
      for (const d of dias) {
        const info = statusFechavel(emp, d);
        if (!info.st || info.ehFut) continue;
        const dd = `${d.slice(-2)}/${d.slice(5, 7)}`;
        if (info.bloqueio === "pendente") { bloqueados.push(`${emp.nome} ${dd} (correção pendente)`); continue; }
        if (info.bloqueio === "impar") { bloqueados.push(`${emp.nome} ${dd} (batida ímpar)`); continue; }
        if (info.st === "falta_i" && info.l && !info.l.ajustesDia.some(a => a.statusEscala)) faltasAuto.push(`${emp.nome} ${dd}`);
        (realFull[empId] = realFull[empId] || {})[d] = info.st;
        (ajFull[empId] = ajFull[empId] || {})[d] = { origem: "solides_sync", ajustadoEm: now, ajustadoPor: me.id, ajustadoPorNome: me.nome, statusAnterior: escala?.real?.[empId]?.[d] as ScheduleStatus | undefined };
        n++;
      }
    }
    if (bloqueados.length) { setAcaoMsg(`Não dá pra fechar — resolva antes (correção pendente / batida ímpar): ${bloqueados.slice(0, 6).join("; ")}${bloqueados.length > 6 ? "…" : ""}.`); return; }
    if (!n) { setAcaoMsg("Nada a fechar (dias de hoje/futuro não fecham)."); return; }
    if (faltasAuto.length && !window.confirm(`${faltasAuto.length} vão fechar como FALTA INJUSTIFICADA (previsto trabalho, sem batida): ${faltasAuto.slice(0, 8).join(", ")}${faltasAuto.length > 8 ? "…" : ""}.\n\nSe alguma for justificada/férias/atestado, CANCELE e classifique antes. Fechar assim mesmo?`)) return;
    setGridBusy(true); setAcaoMsg("");
    try {
      await setDoc(doc(db, "escalas", `${rid}_${comp}`), sanitizeForFirestore({ real: realFull, realAjustes: ajFull, atualizadoEm: now, atualizadoPor: { id: me.id, nome: me.nome } }), { merge: true });
      setAcaoMsg(`✓ ${n} dia(s) fechado(s) na praticada.`);
      setSelGrid(new Set());
    } catch (e) { setAcaoMsg("Falha ao fechar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setGridBusy(false); }
  }
  const toggleGrid = (empId: string, data: string) => setSelGrid(prev => { const n = new Set(prev); const k = `${empId}|${data}`; if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
    // Verde = RESOLVIDO (nada a fazer): folga/freela/afastamento, ou dia com as
    // batidas completas e correções aprovadas — mesmo que tenha exceção só
    // informativa (atraso/interjornada). Vermelho = precisa corrigir. Âmbar =
    // suspeito/pendente. Azul = hoje/futuro.
    void idx;
    const rowBg = (l.ehFuturo || l.ehHoje) ? "bg-blue-50/70 dark:bg-blue-950/25" : precisaCorrecao ? "bg-rose-100/70 dark:bg-rose-900/25" : (suspeito || temPendente) ? "bg-amber-50 dark:bg-amber-950/25" : "bg-emerald-50/70 dark:bg-emerald-950/20";
    return { folga, pendUndecided, temCorrigivel, inclPunch, incompleta, suspeito, rowBg };
  };
  // Saldo do dia = trabalhado + abonado − previsto (com sinal). + verde · − vermelho · 0 azul.
  const renderSaldo = (l: Linha) => {
    if (l.ehFuturo || l.ehHoje) return null;
    if (l.pendenteCorrecao) return <span className="text-amber-600 dark:text-amber-400 text-[11px] font-semibold" title="Batida aberta (falta a saída) — o saldo fica pendente e conta zero no banco até a correção">pendente</span>;
    const s = l.trabalhado + l.abonadoMin - l.previstoMin;
    if (s === 0) return <span className="text-blue-600 dark:text-blue-300 tabular-nums">0</span>;
    const pos = s > 0;
    return <span className={`tabular-nums font-medium ${pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{pos ? "+" : "−"}{hm(Math.abs(s))}</span>;
  };
  const renderPrevisto = (l: Linha) => (<>
    {l.statusPrevisto && <span className={`inline-block mr-1 text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[l.statusPrevisto].bg} ${STATUS_INFO[l.statusPrevisto].text}`} title={STATUS_INFO[l.statusPrevisto].label}>{STATUS_INFO[l.statusPrevisto].short}</span>}
    {l.statusPrevisto ? (l.previstoTxt.includes("–") ? l.previstoTxt : "") : l.previstoTxt}
    {l.ehFeriado && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">feriado</span>}
  </>);
  // PRATICADO da escala = o que a apuração diz que aconteceu (statusPraticado).
  // Fica lado a lado com o previsto pra o DP comparar mudança por dia. "•" marca
  // que o praticado difere do previsto (o dia mudou). Hoje/futuro não têm praticado.
  const renderPraticado = (l: Linha) => {
    if (l.ehFuturo || l.ehHoje) return <span className="text-gray-300 dark:text-gray-600">—</span>;
    const st = statusPraticado(l);
    if (!st) return <span className="text-gray-300 dark:text-gray-600">—</span>;
    const difere = (l.statusPrevisto || "trabalho") !== st;
    return <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[st].bg} ${STATUS_INFO[st].text}`} title={difere ? `Mudou: ${l.statusPrevisto ? STATUS_INFO[l.statusPrevisto].label : "trabalho"} → ${STATUS_INFO[st].label}` : STATUS_INFO[st].label}>{STATUS_INFO[st].short}{difere && <span className="text-[10px] leading-none">•</span>}</span>;
  };
  const renderBatidas = (l: Linha, inclPunch: Set<string>) => l.ehFuturo ? <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-300">futuro</span> : l.reorgPares ? (
    <div className="tabular-nums text-violet-700 dark:text-violet-300" title="Batidas reorganizadas manualmente (o original segue imutável na Sólides)">
      {[...l.reorgPares].sort((a, b) => (horaMin(a.in) ?? 0) - (horaMin(b.in) ?? 0)).map((p, i) => <span key={i}>{i > 0 ? " · " : ""}{p.in}–{p.out}</span>)} <span className="text-[10px] text-violet-500">↔ reorganizado</span>
      {(() => { const a = l.ajustesDia.find(x => x.tipo === "reorganizacao" && !x.cancelado); return a ? <button type="button" onClick={() => void cancelarAjuste(a)} className="ml-1 text-rose-400 hover:text-rose-600" title="Desfazer reorganização">✕</button> : null; })()}
    </div>
  ) : (<>
    <div className="tabular-nums">{l.bs.length ? l.bs.map((b, i) => { const desc = !!(b.punchId && l.descPunch.has(b.punchId)); const pend = correcaoPendente(b) && !(b.punchId && l.decididos.has(b.punchId)); const tratada = !!(b.punchId && inclPunch.has(b.punchId)); const cls = b.excluded || desc ? "line-through text-gray-400" : pend ? "text-amber-600 dark:text-amber-400 underline decoration-dashed decoration-amber-400" : tratada ? "text-indigo-600 dark:text-indigo-300 underline decoration-dotted decoration-indigo-400" : ""; return <span key={i} className={cls} title={desc ? "desconsiderada" : pend ? `correção ${b.status === "REJECTED" ? "rejeitada" : "pendente"} no Sólides — não entra no oficial` : tratada ? "horário tratado (correção)" : undefined}>{i > 0 ? " · " : ""}{hhmm(b.dateIn)}–{hhmm(b.dateOut)}{pend ? " 🟡" : ""}{tratada ? " ✎" : ""}</span>; }) : <span className="text-gray-300 dark:text-gray-600">—</span>}</div>
    {l.ajustesDia.length > 0 && (
      <div className="mt-1 flex flex-col gap-0.5">
        {l.ajustesDia.map(a => { const inline = a.tipo === "inclusao" && !!a.punchId && l.bs.some(b => b.punchId === a.punchId); const Icon = a.tipo === "inclusao" ? Pencil : a.tipo === "desconsideracao" ? Ban : a.tipo === "reclassificacao" ? CalendarDays : Umbrella; const label = a.motivo?.trim() || (a.tipo === "inclusao" ? "Correção incluída" : a.tipo === "desconsideracao" ? "Batida desconsiderada" : a.tipo); return (
          <div key={a.id} className="flex items-center gap-x-1 text-[10.5px] text-indigo-700 dark:text-indigo-300">
            <span className="inline-flex items-center gap-1"><Icon size={11}/> {a.tipo === "inclusao" && !inline && a.in ? `${a.in}–${a.out} · ` : ""}{label}</span>
            {a.autor?.nome && <span className="text-indigo-400 dark:text-indigo-500">· por {a.autor.nome}</span>}
            {(a.evidencias || []).map((ev, i) => (
              <a key={i} href={ev.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-teal-600 dark:text-teal-400 hover:underline" title={ev.nome}>{ev.tipo === "arquivo" ? "📎" : "🔗"}</a>
            ))}
            <button type="button" onClick={() => void cancelarAjuste(a)} className="text-rose-400 hover:text-rose-600 ml-0.5" title={a.solidesDecisao ? "Desfazer nos dois lados (Sólides + app)" : "Cancelar tratamento no app"}>✕</button>
          </div>
        ); })}
      </div>
    )}
  </>);
  const renderExcecoes = (l: Linha, incompleta: boolean, suspeito: boolean) => l.ehHoje ? <span className="text-blue-600 dark:text-blue-300 text-[11px] font-bold">HOJE</span> : l.ehFuturo ? <span className="text-blue-500 text-[11px]">a realizar</span> : l.excecoes.length ? <span className="inline-flex flex-wrap items-center gap-1 leading-none">{l.excecoes.map(e => { const Ic = EXC_LUCIDE[e] || TriangleAlert; return <span key={e} className="cursor-help" title={EXC_LABEL[e] || e}><Ic size={14}/></span>; })}</span> : incompleta ? <span className="cursor-help inline-flex" title="Batida sem par (ponto aberto) — precisa corrigir"><Unlink size={14}/></span> : suspeito ? <span className="cursor-help inline-flex text-amber-600 dark:text-amber-400" title="Só 2 batidas — o padrão é 4 ou 6 (conferir)"><Eye size={14}/></span> : <span className="text-emerald-500 text-[12px]">✓</span>;
  // 1ª coluna à esquerda: cadeado se o dia está FECHADO na praticada (clica destrava);
  // no modo "Fechar dias", checkbox pra selecionar. Vazio em futuro/hoje/mês travado.
  const renderFecharCell = (l: Linha) => {
    if (!sel) return null;
    if (diaFechado(sel.emp.id, l.data)) return <button type="button" onClick={() => sel && void reabrirDiaPraticada(sel.emp.id, l.data)} className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" title="Dia fechado na praticada (alimenta a gorjeta) — clique pra reabrir"><Lock size={15} className="inline"/></button>;
    if (fecharMode && !l.ehFuturo && !l.ehHoje && !travado && !mesEncerrado) return <input type="checkbox" checked={selFechar.has(l.data)} onChange={() => toggleFechar(l.data)} className="w-4 h-4 accent-emerald-600 align-middle" title="Selecionar pra fechar na praticada" />;
    return null;
  };
  const renderAcoes = (l: Linha, pendUndecided: boolean, temCorrigivel: boolean) => { const corrSel = selCorr.has(l.data); return (
    <div className="inline-flex items-center gap-1">
      {pendUndecided && !travado && <>
        <button type="button" disabled={acaoBusy} onClick={() => sel && void decidirCorrecao(sel.emp, l, "APPROVED")} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-emerald-300 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40" title="Aprovar correção (Sólides + trilha)">✓</button>
        <button type="button" disabled={acaoBusy} onClick={() => sel && void decidirCorrecao(sel.emp, l, "REPROVED")} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-rose-300 dark:border-rose-800 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40" title="Reprovar correção">✗</button>
      </>}
      {(l.excecoes.includes("fora_escala") || l.excecoes.includes("falta") || l.excecoes.includes("sem_batida")) && !travado && (
        <button type="button" disabled={reclassBusy} onClick={() => sel && setReclass({ emp: sel.emp, data: l.data, prev: l.statusEscala })} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-amber-300 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40" title="Definir o status na escala praticada (folga trabalhada, ou falta → justificada / injustificada / férias)"><CalendarDays size={14} className="inline"/></button>
      )}
      <button type="button" onClick={() => toggleCorr(l.data)} className={`text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border ${corrSel ? "bg-blue-500 border-blue-500 text-white" : temCorrigivel ? "border-blue-300 dark:border-blue-800 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" : "border-gray-300 dark:border-gray-700 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`} title={corrSel ? "Remover do pedido de correção" : "Selecionar p/ pedir correção"}><MessageSquare size={14} className="inline"/></button>
      <button type="button" disabled={travado} onClick={() => sel && setAjusteModal({ emp: sel.emp, data: l.data, bs: [...l.bsRaw, ...(l.bsVirada || [])], reorgPares: l.reorgPares })} className="text-[12px] w-7 h-7 sm:w-6 sm:h-6 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30" title={travado ? "Mês fechado" : "Tratar"}><Settings size={14} className="inline"/></button>
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

  // ── Exceções a validar (líder da área) ──────────────────────────────────────
  // ptrpValidadores/{empresa} = { mapa: { [area]: pessoaId } } — quem valida cada área.
  const [validadores, setValidadores] = useState<Record<string, string>>({});
  useEffect(() => { if (!shortCode) return; return onSnapshot(doc(db, "ptrpValidadores", shortCode), d => setValidadores((d.exists() ? (d.data() as { mapa?: Record<string, string> }).mapa : {}) || {})); }, [shortCode]);
  const ehMasterLocal = !!me?.isMaster;
  // Atrasos ainda NÃO validados, filtrados pela(s) área(s) do usuário (master vê tudo).
  const atrasosAValidar = useMemo(() => {
    const out: { emp: Empregado; area: string; l: Linha }[] = [];
    for (const x of resultados) {
      if (!ehMasterLocal && validadores[x.area] !== me?.id) continue;
      for (const l of x.r.linhas) {
        if (l.ehFuturo || l.ehHoje || !l.excecoes.includes("atraso")) continue;
        // Só sobe pra validar quando o dia está LIMPO: sem correção pendente (do
        // empregado) e sem batida incompleta/faltando. Enquanto não aprovar a
        // correção ou o dia estiver ímpar, o atraso ainda não é confiável.
        if (l.excecoes.some(e => e === "correcao_pendente" || e === "batida_impar" || e === "sem_batida" || e === "falta")) continue;
        if (l.ajustesDia.some(a => a.tipo === "atraso_confirmado" || a.tipo === "atraso_justificado")) continue;
        out.push({ emp: x.emp, area: x.area, l });
      }
    }
    return out.sort((a, b) => a.emp.nome.localeCompare(b.emp.nome) || a.l.data.localeCompare(b.l.data));
  }, [resultados, validadores, ehMasterLocal, me?.id]);
  const areasComEmpregado = useMemo(() => [...new Set(resultados.map(x => x.area))].sort(), [resultados]);
  // Só as pessoas DESTE restaurante (ativas) podem ser responsáveis de área.
  const pessoasDoRest = useMemo(() => pessoas.filter(p => (p.restaurantIds || []).includes(rid)).sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas, rid]);
  // Atrasos agrupados por ÁREA → EMPREGADO (expansível).
  const atrasosPorArea = useMemo(() => {
    const areas = new Map<string, Map<string, { emp: Empregado; linhas: Linha[] }>>();
    for (const it of atrasosAValidar) {
      const porEmp = areas.get(it.area) || new Map();
      const cur = porEmp.get(it.emp.id) || { emp: it.emp, linhas: [] };
      cur.linhas.push(it.l); porEmp.set(it.emp.id, cur); areas.set(it.area, porEmp);
    }
    return [...areas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, m]) => ({ area, emps: [...m.values()].sort((a, b) => a.emp.nome.localeCompare(b.emp.nome)) }));
  }, [atrasosAValidar]);
  const [expEmp, setExpEmp] = useState<Set<string>>(new Set());
  const [valBusy, setValBusy] = useState("");
  // Publica o snapshot de pendências do PTRP (pendencias/{rid}_ptrp) pro cron das
  // Rotinas ("só com pendência"): geral = correções a aprovar (DP); porPessoa =
  // atrasos a validar por líder de área. Só do mês corrente, a partir da Conferência.
  useEffect(() => {
    if (mode !== "conferencia" || !rid || comp !== compAtual()) return;
    const porArea: Record<string, number> = {}; let geral = 0;
    for (const x of resultados) for (const l of x.r.linhas) {
      if (l.excecoes.includes("correcao_pendente")) geral++;
      if (!l.ehFuturo && !l.ehHoje && l.excecoes.includes("atraso") && !l.excecoes.some(e => e === "correcao_pendente" || e === "batida_impar" || e === "sem_batida" || e === "falta") && !l.ajustesDia.some(a => a.tipo === "atraso_confirmado" || a.tipo === "atraso_justificado")) porArea[x.area] = (porArea[x.area] || 0) + 1;
    }
    const porPessoa: Record<string, number> = {};
    for (const [area, n] of Object.entries(porArea)) { const v = validadores[area]; if (v) porPessoa[v] = (porPessoa[v] || 0) + n; }
    void setDoc(doc(db, "pendencias", `${rid}_ptrp`), sanitizeForFirestore({ modulo: "ptrp", restaurantId: rid, geral, porPessoa, porArea, atualizadoEm: new Date().toISOString() })).catch(() => {});
  }, [mode, rid, comp, resultados, validadores]);
  async function validarAtraso(emp: Empregado, l: Linha, justificar: boolean) {
    if (!me) return;
    let motivo = "";
    if (justificar) { motivo = (window.prompt("Por que não foi atraso? (ex.: líder pediu pra entrar mais tarde)") || "").trim(); if (!motivo) return; }
    setValBusy(`${emp.id}_${l.data}`);
    try {
      await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({
        empresaKey: shortCode, colaboradorId: emp.id, cpf: soDig(emp.cpf), data: l.data,
        tipo: justificar ? "atraso_justificado" : "atraso_confirmado",
        motivo: justificar ? motivo : "atraso confirmado pelo líder",
        autor: { id: me.id, nome: me.nome }, criadoEm: new Date().toISOString(), cancelado: false,
      }));
    } catch { /* noop */ } finally { setValBusy(""); }
  }
  async function setValidadorArea(area: string, pessoaId: string) {
    await setDoc(doc(db, "ptrpValidadores", shortCode), sanitizeForFirestore({ mapa: { ...validadores, [area]: pessoaId }, atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
  }

  // Banco de horas: saldo acumulado (Σ movimentos) e extrato por colaborador.
  const saldoAcumPorColab = useMemo(() => { const m = new Map<string, number>(); for (const mv of bancoMovs) m.set(mv.colaboradorId, (m.get(mv.colaboradorId) || 0) + (mv.saldoMinutos || 0)); return m; }, [bancoMovs]);
  const movsPorColab = useMemo(() => { const m = new Map<string, PtrpBancoMov[]>(); for (const mv of bancoMovs) { const a = m.get(mv.colaboradorId) || []; a.push(mv); m.set(mv.colaboradorId, a); } for (const a of m.values()) a.sort((x, y) => x.competencia.localeCompare(y.competencia)); return m; }, [bancoMovs]);
  const hojeYmd = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  // Fechamento da praticada do mês (até que dia TODOS estão fechados) — base do
  // painel de pendências e do que a gorjeta pode dividir.
  // TODOS os empregados (empregadoAtivoEm filtra por dia) — CLT ativo, freela em
  // cobertura e demitido nos dias trabalhados. É o conjunto que entra na gorjeta.
  const fechamentoPrat = useMemo(
    () => calcularFechamentoPraticada(escala, empregados, Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), hojeYmd),
    [escala, empregados, comp, hojeYmd],
  );
  // Grid semanal (aba Fechar praticada): linha do dia por empregado + dias da semana visível.
  const linhasPorEmp = useMemo(() => new Map(resultados.map(x => [x.emp.id, new Map(x.r.linhas.map(l => [l.data, l]))])), [resultados]);
  // Status praticado + horário de QUALQUER empregado num dia: CLT usa a apuração
  // (batidas); freela/demitido sem apuração usa a praticada (real ?? prevista),
  // pois não batem ponto. Retorna null se o empregado não está ativo no dia.
  const statusFechavel = (emp: Empregado, d: string): { st: ScheduleStatus | null; horarios: string[]; l?: Linha; ehFut: boolean; bloqueio?: "pendente" | "impar"; grave?: boolean; alerta?: string } => {
    if (!empregadoAtivoEm(emp, d)) return { st: null, horarios: [], ehFut: false };
    const l = linhasPorEmp.get(emp.id)?.get(d);
    if (l) {
      // TODAS as batidas do dia (cada par entrada–saída), não só a 1ª e a última.
      const horarios = (l.bs || []).filter(b => !b.excluded).map(b => `${hhmm(b.dateIn)}–${hhmm(b.dateOut)}`);
      const bloqueio = l.excecoes.includes("correcao_pendente") ? "pendente" as const : (l.excecoes.includes("batida_impar") || l.pendenteCorrecao) ? "impar" as const : undefined;
      const st = statusPraticado(l);
      // Inconsistências: FALTA com batida bruta, correção pendente, batida ímpar/
      // aberta, sem batida, fora de escala — o ⚠ acende; o tooltip lista TODAS.
      const temBatidaRaw = (l.bsRaw || []).some(b => !b.excluded && b.dateIn != null);
      const faltaComBatida = (st === "falta_i" || st === "falta_j") && temBatidaRaw;
      const graves = new Set(["correcao_pendente", "batida_impar", "sem_batida", "falta", "fora_escala"]);
      const grave = faltaComBatida || l.excecoes.some(e => graves.has(e));
      const labels = [...(faltaComBatida ? ["FALTA mas há batida no dia"] : []), ...l.excecoes.map(e => EXC_LABEL[e] || e)];
      return { st, horarios, l, ehFut: l.ehFuturo || l.ehHoje, bloqueio, grave, alerta: labels.join(" · ") || undefined };
    }
    const st = (escala?.real?.[emp.id]?.[d] ?? escala?.prevista?.[emp.id]?.[d]) as ScheduleStatus | undefined;
    return { st: st ?? null, horarios: [], ehFut: d >= hojeYmd };
  };
  const diasNoMesComp = new Date(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), 0).getDate();
  const diasSemana = useMemo(() => { const out: string[] = []; for (let d = chunkIni; d <= Math.min(chunkIni + 6, diasNoMesComp); d++) out.push(`${comp}-${String(d).padStart(2, "0")}`); return out; }, [chunkIni, diasNoMesComp, comp]);
  // Linhas do grid: todo empregado ativo em algum dia da semana visível (CLT,
  // freela em cobertura, demitido nos dias trabalhados). Ordena por nome.
  const empregadosSemana = useMemo(
    () => empregados.filter(e => diasSemana.some(d => empregadoAtivoEm(e, d))).sort((a, b) => a.nome.localeCompare(b.nome)),
    [empregados, diasSemana],
  );
  // Ao entrar na aba (ou trocar mês), começa na semana onde o fechamento parou.
  useEffect(() => { if (mode === "fechar") setChunkIni(Math.max(1, Math.floor(fechamentoPrat.fechadoAteDia / 7) * 7 + 1)); }, [mode, comp, fechamentoPrat.fechadoAteDia]);
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

  // Grava o status escolhido na escala PRATICADA do dia (escalas/{rid}_{comp}.real)
  // e registra a reclassificação como ajuste (trilha + prioridade no "Gerar
  // praticada", pra não ser recomputado). Uso típico: folga trabalhada → TR/TC.
  async function aplicarReclass(status: ScheduleStatus) {
    if (!reclass || !me || !rid) return;
    const { emp, data, prev } = reclass;
    setReclassBusy(true);
    try {
      await setDoc(doc(db, "escalas", `${rid}_${comp}`), sanitizeForFirestore({ real: { [emp.id]: { [data]: status } }, atualizadoEm: new Date().toISOString(), atualizadoPor: { id: me.id, nome: me.nome } }), { merge: true });
      const de = prev ? STATUS_INFO[prev].label : "sem status";
      await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({
        empresaKey: shortCode, colaboradorId: emp.id, cpf: soDig(emp.cpf), data,
        tipo: "reclassificacao" as PtrpAjusteTipo, statusEscala: status,
        motivo: `Escala praticada: ${de} → ${STATUS_INFO[status].label}`,
        autor: { id: me.id, nome: me.nome }, criadoEm: new Date().toISOString(), cancelado: false,
      }));
      setReclass(null);
    } catch (e) { setAcaoMsg("Falha ao reclassificar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setReclassBusy(false); }
  }

  async function cancelarAjuste(a: PtrpAjuste) {
    // Reclassificação de escala: desfazer volta a real pro previsto (remove a real).
    if (a.tipo === "reclassificacao") {
      if (!confirm("Desfazer a reclassificação? A escala praticada deste dia volta ao previsto.")) return;
      try {
        await setDoc(doc(db, "escalas", `${rid}_${comp}`), { real: { [a.colaboradorId]: { [a.data]: deleteField() } }, atualizadoEm: new Date().toISOString() }, { merge: true });
        await updateDoc(doc(db, "ptrpAjustes", a.id), { cancelado: true, canceladoPor: { id: me?.id || "", nome: me?.nome || "" }, canceladoEm: new Date().toISOString() });
        setAcaoMsg("✓ Reclassificação desfeita — voltou ao previsto.");
      } catch (e) { setAcaoMsg("Falha ao desfazer: " + (e instanceof Error ? e.message : "erro")); }
      return;
    }
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
        {!cct && <span className="text-xs text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"><TriangleAlert size={12}/> Sem CCT — configure em Regras (extras/noturno não calculam).</span>}
      </div>
      )}

      {mode === "fechar" && (() => {
        const selecionaveisDoDia = (d: string) => empregadosSemana.filter(e => { if (diaFechado(e.id, d)) return false; const info = statusFechavel(e, d); return !!info.st && !info.ehFut; }).map(e => e.id);
        const diaMarcado = (d: string) => { const ids = selecionaveisDoDia(d); return ids.length > 0 && ids.every(id => selGrid.has(`${id}|${d}`)); };
        const toggleDia = (d: string) => { const ids = selecionaveisDoDia(d); setSelGrid(prev => { const n = new Set(prev); const all = ids.length > 0 && ids.every(id => n.has(`${id}|${d}`)); for (const id of ids) { const k = `${id}|${d}`; if (all) n.delete(k); else n.add(k); } return n; }); };
        const semLabel = `${diasSemana[0]?.slice(-2)}–${diasSemana[diasSemana.length - 1]?.slice(-2)}/${comp.slice(5, 7)}`;
        return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[12.5px] text-gray-700 dark:text-gray-200 inline-flex items-center gap-1.5">
              <CalendarCheck size={15} className="text-emerald-600 dark:text-emerald-400"/> {fechamentoPrat.fechadoAteYmd ? <>Praticada fechada até <b>{fmtDataBR(fechamentoPrat.fechadoAteYmd)}</b>.</> : "Nada fechado ainda."} Marque os dias e feche — a gorjeta avança até onde <b>todos</b> estiverem fechados.
            </div>
            <div className="inline-flex items-center gap-1.5">
              <button type="button" onClick={() => setChunkIni(Math.max(1, chunkIni - 7))} disabled={chunkIni <= 1} className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">‹</button>
              <span className="text-[12px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 w-20 text-center">{semLabel}</span>
              <button type="button" onClick={() => setChunkIni(Math.min(chunkIni + 7, Math.floor((diasNoMesComp - 1) / 7) * 7 + 1))} disabled={chunkIni + 7 > diasNoMesComp} className="w-7 h-7 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">›</button>
            </div>
          </div>
          {acaoMsg && <div className={`text-[12px] ${acaoMsg.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{acaoMsg}</div>}
          {empregadosSemana.length === 0 ? <div className="text-sm text-gray-400 py-6 text-center">Sem empregados ativos nesta semana.</div> : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                  <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800/50 text-left px-3 py-2 font-semibold text-gray-500 min-w-[140px]">Empregado</th>
                  {diasSemana.map(d => { const marc = diaMarcado(d); const n = selecionaveisDoDia(d).length; return (
                    <th key={d} className={`px-2 py-1.5 text-center font-semibold ${[0, 6].includes(new Date(d + "T12:00:00").getDay()) ? "text-rose-500" : "text-gray-500"}`}>
                      <div className="tabular-nums">{d.slice(-2)} <span className="text-[10px] font-normal">{diaSemanaAbrev(d)}</span></div>
                      <button type="button" disabled={n === 0} onClick={() => toggleDia(d)} className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded ${marc ? "bg-emerald-600 text-white" : n === 0 ? "text-gray-300 dark:text-gray-600" : "border border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`} title="Marcar o dia inteiro (todos)">{marc ? "✓ dia" : "dia"}</button>
                    </th>
                  ); })}
                </tr>
              </thead>
              <tbody>
                {empregadosSemana.map(emp => (
                  <tr key={emp.id} className="border-b border-gray-50 dark:border-gray-800/40">
                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100 truncate max-w-[160px] border-r border-gray-100 dark:border-gray-800">{emp.nome}{emp.freelaMensalista && <span className="ml-1 text-[9px] uppercase text-violet-500">freela</span>}</td>
                    {diasSemana.map(d => {
                      const ativo = empregadoAtivoEm(emp, d);
                      const fechado = diaFechado(emp.id, d);
                      const info = statusFechavel(emp, d);
                      const st = fechado ? ((escala?.real?.[emp.id]?.[d] as ScheduleStatus | undefined) ?? info.st ?? undefined) : (info.st ?? undefined);
                      const selecionavel = ativo && !fechado && !!info.st && !info.ehFut;
                      const marcado = selGrid.has(`${emp.id}|${d}`);
                      return (
                        <td key={d} className="px-1 py-1 text-center align-middle">
                          {!ativo ? <span className="text-gray-200 dark:text-gray-700">·</span> : fechado ? (
                            <button type="button" onClick={() => void reabrirDiaPraticada(emp.id, d)} title="Fechado — clique pra reabrir" className="w-full rounded-md px-1 py-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
                              <span className="inline-flex items-center gap-0.5"><Lock size={10} className="text-emerald-600"/>{st && <span className={`text-[9px] font-bold px-1 rounded ${STATUS_INFO[st].bg} ${STATUS_INFO[st].text}`}>{STATUS_INFO[st].short}</span>}</span>
                            </button>
                          ) : info.ehFut ? <span className="text-blue-400 text-[10px]">{info.l?.ehHoje ? "hoje" : "—"}</span> : (
                            <button type="button" onClick={() => selecionavel && toggleGrid(emp.id, d)} title={info.alerta || undefined} className={`relative w-full rounded-md px-1 py-1 border transition-colors ${info.grave ? "border-rose-300 dark:border-rose-800 ring-1 ring-rose-300 dark:ring-rose-800 bg-rose-50/50 dark:bg-rose-950/20" : marcado ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 ring-1 ring-emerald-400" : "border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-900/10"} ${marcado && info.grave ? "ring-emerald-500" : ""}`}>
                              {info.grave && <TriangleAlert size={10} className="absolute -top-1 -right-1 text-rose-500 bg-white dark:bg-gray-900 rounded-full" />}
                              <div className="flex flex-col items-center gap-0.5 leading-none">
                                {st ? <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[st].bg} ${STATUS_INFO[st].text}`}>{STATUS_INFO[st].short}</span> : <span className="text-[9px] text-gray-400">?</span>}
                                {info.horarios.length ? info.horarios.map((h, i) => <span key={i} className="text-[9.5px] tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</span>) : <span className="text-[9.5px] text-gray-400">—</span>}
                              </div>
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <p className="text-[11px] text-gray-500">Clique nas células (ou em <b>"dia"</b> pra marcar a coluna inteira) e feche. Verde com 🔒 = já fechado (clique pra reabrir). Status/horário vêm da apuração; pra mudar, use a Conferência (📅 / ⚙️).</p>
          {selGrid.size > 0 && (
            <div className="sticky bottom-0 bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap shadow-lg">
              <span className="text-[12.5px] font-medium text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-1.5"><Lock size={13}/> {selGrid.size} dia(s) de empregado marcados</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelGrid(new Set())} className="text-[12px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Limpar</button>
                <button type="button" disabled={gridBusy} onClick={() => void fecharGrid()} className="text-[12px] font-semibold px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{gridBusy ? "Fechando…" : `🔒 Fechar (${selGrid.size})`}</button>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {mode === "conferencia" && (<>
      {/* Fechamento mensal + exportações (espelho PDF / AEJ) */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {travado
          ? <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 inline-flex items-center gap-1" title={fech?.fechadoEm ? `Fechado em ${fmtDataBR(fech.fechadoEm.slice(0, 10))}${fech.fechadoPor ? ` por ${fech.fechadoPor.nome}` : ""}` : ""}><Lock size={11}/> Mês fechado</span>
          : fech?.status === "reaberto"
            ? <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">↻ Reaberto</span>
            : <span className="text-[11px] font-bold uppercase px-2 py-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Aberto</span>}
        {travado
          ? <Button size="sm" variant="secondary" disabled={fechBusy} onClick={() => void reabrirMes()}>{fechBusy ? "…" : <span className="inline-flex items-center gap-1"><LockOpen size={13}/> Reabrir mês</span>}</Button>
          : <Button size="sm" disabled={fechBusy} onClick={() => void encerrarMes()}>{fechBusy ? "Fechando…" : <span className="inline-flex items-center gap-1"><Lock size={13}/> Encerrar {labelComp(comp)}</span>}</Button>}
        {travado && <Button size="sm" variant="secondary" disabled={fechBusy} onClick={() => void gerarPraticada()}><span className="inline-flex items-center gap-1"><CalendarDays size={13}/> Gerar praticada</span></Button>}
        {travado && <Button size="sm" onClick={() => setAssModal(true)}><span className="inline-flex items-center gap-1"><Signature size={13}/> Enviar para assinatura</span></Button>}
        <Button size="sm" variant="secondary" disabled={!!exportBusy} onClick={() => void baixarEspelhosTodos()}>{exportBusy === "espelhos" ? "Gerando…" : <span className="inline-flex items-center gap-1"><Printer size={13}/> Espelhos (todos)</span>}</Button>
        <Button size="sm" variant="secondary" disabled={!!exportBusy} onClick={() => void baixarAEJ()}>{exportBusy === "aej" ? "Gerando…" : <span className="inline-flex items-center gap-1"><ArrowDown size={13}/> AEJ</span>}</Button>
        <Button size="sm" variant="secondary" disabled={sincBusy} onClick={() => void sincronizarSolides()} title={`Buscar batidas/correções novas da Sólides agora (mês ${labelComp(comp)}), sem esperar o sync automático`}>{sincBusy ? "Sincronizando…" : <span className="inline-flex items-center gap-1"><RotateCw size={13}/> Sincronizar Sólides</span>}</Button>
      </div>
      {sincMsg && <div className="mb-2 text-[12px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">{sincMsg}</div>}
      {qtdPendentes > 0 && <div className="mb-2 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 inline-flex items-center gap-1.5"><TriangleAlert size={13}/> {qtdPendentes} correção(ões) a aprovar na Sólides aparecem tracejadas (🟡) — use ✓ / ✗ no dia pra decidir.</div>}
      {pendErr && <div className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">Leitura ao vivo da Sólides indisponível agora ({pendErr.replace(/\s+/g, " ").slice(0, 80)}) — mostrando o espelho da última sincronização, que pode estar desatualizado. Tente novamente em instantes.</div>}

      {/* Fechamento da praticada → o que a gorjeta pode dividir + pendências */}
      {fechamentoPrat.ultimoDiaConsiderado > 0 && (
        <div className={`mb-2 rounded-xl border p-3 ${fechamentoPrat.pendencias.length ? "border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20" : "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[12.5px] font-medium text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5">
              {fechamentoPrat.fechadoAteDia > 0
                ? <><Lock size={14} className="text-emerald-600 dark:text-emerald-400"/> Praticada fechada até <b>{fmtDataBR(fechamentoPrat.fechadoAteYmd)}</b> — a gorjeta divide só até aí.</>
                : <><TriangleAlert size={14} className="text-amber-600 dark:text-amber-400"/> Nenhum dia totalmente fechado ainda — a gorjeta não divide até fechar a praticada de todos.</>}
            </span>
            {fechamentoPrat.pendencias.length > 0 && <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{fechamentoPrat.pendencias.length} pessoa(s) · {fechamentoPrat.totalDiasAbertos} dia(s) a fechar</span>}
          </div>
          {fechamentoPrat.pendencias.length > 0 && (
            <details className="mt-2 group">
              <summary className="cursor-pointer select-none text-[11.5px] font-medium text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"><ChevronDown size={12} className="transition-transform group-open:rotate-180"/> Ver quem falta fechar pra destravar a gorjeta</summary>
              <div className="mt-1.5 flex flex-col gap-1">
                {fechamentoPrat.pendencias.map(p => (
                  <button key={p.empId} type="button" onClick={() => setAberto(p.empId)} className="text-left text-[12px] rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-amber-100 dark:border-amber-900/40 hover:border-amber-300 dark:hover:border-amber-700 flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 tabular-nums shrink-0" title={p.diasAbertos.map(d => d.slice(-2) + "/" + d.slice(5, 7)).join(", ")}>dias {p.diasAbertos.map(d => d.slice(-2)).join(", ")}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-gray-500 mt-1.5">Clique numa pessoa, feche os dias (📅 / checkbox) e a gorjeta avança sozinha.</p>
            </details>
          )}
        </div>
      )}

      {/* Legenda recolhida: some da visão permanente e abre só quando quiser. */}
      <details className="group mb-2 rounded-lg border border-gray-200 dark:border-gray-800">
        <summary className="flex items-center gap-1.5 cursor-pointer select-none list-none px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <HelpCircle size={13} /> Como ler esta tela (legenda)
          <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="text-[12px] px-3 pb-2.5 pt-0.5 border-t border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 leading-relaxed">
        Escolha um colaborador pelo chip. <span className="font-semibold text-emerald-700 dark:text-emerald-300">✓ verde</span> = sem exceções · <span className="font-semibold text-amber-700 dark:text-amber-300">● amarelo</span> = tem exceções a tratar · <span className="font-semibold text-gray-400">○ cinza</span> = sem batidas / sem CPF. Previsto vem do cadastro do empregado; prévia — validar contra o Sólides. Na tabela do dia: <span className="text-amber-600 dark:text-amber-400">🟡 tracejado</span> = correção pedida no Sólides ainda não aprovada (não conta) → <span className="font-semibold text-emerald-700 dark:text-emerald-300">✓ aprovar</span> / <span className="font-semibold text-rose-600">✗ reprovar</span>; <span className="text-blue-600"><MessageSquare size={12} className="inline"/></span> marca o dia p/ pedir correção — junta vários numa mensagem só (inclusive dias sem erro que você suspeita), e o botão azul no topo monta o WhatsApp (linha do DP). Cor da linha do dia: <span className="px-1 rounded bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">vermelha</span> = correção necessária (nº ímpar de batidas / falta) · <span className="px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">amarela</span> = suspeito (só 2 batidas; o padrão é 4 ou 6) · <span className="px-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">azul</span> = dia futuro.
        </div>
      </details>
      </>)}

      {mode === "comparar" && (
      <div className="mb-3">
        <div className="text-[12px] text-gray-500 mb-2">Cruza a equipe CLT ativa do <strong>{activeRestaurant?.nome}</strong> com o cadastro da Sólides (por CPF).</div>
        <button type="button" onClick={() => (mostrarComp && roster ? setMostrarComp(false) : void carregarRoster())} disabled={carregandoRoster}
          className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
          {carregandoRoster ? "Buscando cadastro da Sólides…" : mostrarComp && roster ? "▲ Ocultar comparação de cadastros" : <span className="inline-flex items-center gap-1"><Search size={13}/> Comparar cadastros (Sólides × app)</span>}
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

      {mode === "validar" && (
      <div className="mb-3">
        <div className="flex items-baseline gap-2 flex-wrap mb-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Scale size={14}/> Exceções a validar · {labelComp(comp)}</span>
          <span className="text-[11px] text-gray-500">Confirme se cada atraso foi mesmo atraso. <b>"Não foi"</b> (autorizado pelo líder) zera o atraso no saldo e na trilha.</span>
        </div>
        {atrasosAValidar.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 inline-flex items-center justify-center gap-1 w-full"><PartyPopper size={15}/> Nenhum atraso a validar {ehMasterLocal ? "no período." : "na sua área neste período."}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {atrasosPorArea.map(({ area, emps }) => { const tot = emps.reduce((s, e) => s + e.linhas.length, 0); return (
              <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{area}</span>
                  <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{tot} atraso{tot > 1 ? "s" : ""}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {emps.map(({ emp, linhas }) => { const open = expEmp.has(emp.id); return (
                    <div key={emp.id} className={`rounded-lg border overflow-hidden ${open ? "border-indigo-300 dark:border-indigo-800" : "border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/15"}`}>
                      <button type="button" onClick={() => setExpEmp(s => { const n = new Set(s); if (n.has(emp.id)) n.delete(emp.id); else n.add(emp.id); return n; })} className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-white/60 dark:hover:bg-gray-800/40">
                        <span className="text-gray-400 text-[10px] w-3">{open ? "▾" : "▸"}</span>
                        <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 flex-1 truncate">{emp.nome}</span>
                        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 rounded-full px-1.5 py-0.5 tabular-nums">{linhas.length}</span>
                      </button>
                      {open && (
                        <div className="px-2.5 pb-2 pt-0.5 bg-white dark:bg-gray-900 overflow-x-auto">
                          {linhas.map(l => { const busy = valBusy === `${emp.id}_${l.data}`; return (
                            <div key={l.data} className="flex items-center gap-2 py-1 border-t border-gray-100 dark:border-gray-800/60 text-[12px]">
                              <span className="tabular-nums font-medium text-gray-700 dark:text-gray-200 w-12">{l.data.slice(-2)}/{l.data.slice(5, 7)}</span>
                              <span className="text-gray-400 tabular-nums whitespace-nowrap flex-1">{l.previstoTxt}</span>
                              <span className="tabular-nums font-semibold text-rose-600 dark:text-rose-400 w-14 text-right inline-flex items-center justify-end gap-1"><AlarmClock size={12}/> {hm(l.atrasoMin)}</span>
                              <button type="button" disabled={busy} onClick={() => void validarAtraso(emp, l, false)} className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40">Foi atraso</button>
                              <button type="button" disabled={busy} onClick={() => void validarAtraso(emp, l, true)} className="text-[11px] px-2 py-1 rounded-md border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-40">Não foi</button>
                            </div>
                          ); })}
                        </div>
                      )}
                    </div>
                  ); })}
                </div>
              </div>
            ); })}
          </div>
        )}
      </div>
      )}

      {mode === "validadores" && (
      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Scale size={14}/> Responsáveis por validar exceções</div>
        <p className="text-[11px] text-gray-500 mb-3">Defina o líder que valida os atrasos de cada área. Só ele vê as exceções da área dele na aba <b>Exceções a validar</b>.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {areasComEmpregado.map(area => (
            <div key={area} className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-2.5 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 w-24 truncate" title={area}>{area}</span>
              <select value={validadores[area] || ""} onChange={e => void setValidadorArea(area, e.target.value)} className="flex-1 px-2 py-1 text-[12px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
                <option value="">— ninguém —</option>
                {pessoasDoRest.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          ))}
          {areasComEmpregado.length === 0 && <div className="text-[12px] text-gray-400">Nenhuma área com empregado ativo neste mês.</div>}
        </div>
      </div>
      )}

      {mode === "banco" && (
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Landmark size={14}/> Banco de horas / compensação · {labelComp(comp)}</span>
          <Button size="sm" variant="secondary" disabled={registrando || !cct} onClick={() => void registrarBanco()}>
            {registrando ? "Registrando…" : `Registrar ${labelComp(comp)} no banco`}
          </Button>
          {!cct && <span className="text-[11px] text-amber-600">configure a CCT (Regras) pra calcular o vencimento.</span>}
        </div>
        {(
          <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
            <table className="w-full text-[12px] min-w-[560px] [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
              <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-200 dark:border-gray-800">
                <th className="py-1.5 font-semibold">Colaborador</th><th className="font-semibold text-right">Saldo {labelComp(comp)} <span className="normal-case font-normal text-gray-300">(até ontem)</span></th><th className="font-semibold text-right">Saldo acumulado</th><th className="font-semibold">Próx. vencimento</th><th className="font-semibold">Extrato</th>
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
                      <td title={`Do dia 01 até ontem — previsto ${hm(r.prevAteOntem)} · trabalhado+abonado ${hm(r.trabAteOntem)}`} className={`text-right tabular-nums font-medium ${r.saldoMes < 0 ? "text-rose-600 dark:text-rose-400" : r.saldoMes > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{r.saldoMes ? hmSigned(Math.round(r.saldoMes)) : "0h00"}</td>
                      <td className={`text-right tabular-nums font-semibold ${acum < 0 ? "text-rose-600 dark:text-rose-400" : acum > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{acum ? hmSigned(acum) : "0h00"}</td>
                      <td className="text-gray-600 dark:text-gray-300">{vencidos.length > 0 ? <span className="text-rose-600 dark:text-rose-400 font-semibold inline-flex items-center gap-1"><TriangleAlert size={11}/> {vencidos.length} vencido(s)</span> : proxVenc ? fmtDataBR(proxVenc) : "—"}</td>
                      <td className="text-[11px] text-gray-500">{movs.length === 0 ? "—" : movs.map(m => <span key={m.id} className={`inline-block mr-1.5 ${movVencido(m) ? "text-rose-500" : ""}`} title={m.vencimento ? `vence ${fmtDataBR(m.vencimento)}` : ""}>{labelComp(m.competencia).slice(0, 3)}: {hmSigned(m.saldoMinutos || 0)}</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800">Saldo do mês = trabalhado + abonado − previsto, apurado <b>do dia 01 até ontem</b> (hoje e dias futuros não entram). O <b>previsto</b> vem da escala/horário cadastrado no vínculo do empregado. Passe o mouse no saldo pra ver previsto × trabalhado. "Registrar no banco" grava o saldo com vencimento = fim da competência + {cct?.prazoCompensacaoDias || 90} dias (prazo da CCT). Crédito vencido (não compensado no prazo) deve ser pago como extra.</div>
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
                        <span className="truncate flex-1 inline-flex items-center gap-1">{naoBate && <Crown size={12} className="shrink-0 text-violet-500 dark:text-violet-300"/>}{emp.nome}</span>
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
              {Object.entries(EXC_LUCIDE).map(([k, Ic]) => <span key={k} className="inline-flex items-center gap-1"><Ic size={12}/>{EXC_LABEL[k]}</span>)}
              <span className="inline-flex items-center gap-1"><Eye size={12} className="text-amber-600 dark:text-amber-400"/>2 batidas (conferir)</span>
              <span className="inline-flex items-center gap-1"><span className="text-emerald-500">✓</span>sem exceção</span>
            </div>
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{sel.emp.nome} <span className="text-[11px] font-normal text-gray-500">· {sel.area}</span></div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-gray-500">trab. {hm(sel.r.totTrab)}{sel.r.totExtra ? ` · extra ${hm(sel.r.totExtra)}` : ""}{sel.r.totNot ? ` · not. ${hm(sel.r.totNot)}` : ""}</span>
                {!mesEncerrado && (fecharMode
                  ? <button type="button" onClick={() => { setFecharMode(false); setSelFechar(new Set()); }} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
                  : <button type="button" onClick={() => { setFecharMode(true); setSelCorr(new Set()); }} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="Fechar dias na escala praticada (fecha um período — ex.: rescisão)"><span className="inline-flex items-center gap-1"><Lock size={12}/> Fechar dias</span></button>)}
                <button type="button" disabled={!!exportBusy} onClick={() => void baixarEspelho(sel)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40" title="Espelho de ponto deste colaborador (PDF)">{exportBusy === "espelho" ? "…" : <span className="inline-flex items-center gap-1"><Printer size={12}/> Espelho</span>}</button>
              </div>
            </div>
            {acaoMsg && <div className={`px-3 py-1.5 text-[11.5px] border-b border-gray-100 dark:border-gray-800 ${acaoMsg.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{acaoMsg}</div>}
            {fecharMode && (
              <div className="px-3 py-2 border-b border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[12px] text-emerald-800 dark:text-emerald-200 font-medium inline-flex items-center gap-1"><Lock size={13}/> Fechar dias — marque os dias e feche a praticada (fecha o período p/ a gorjeta). {selFechar.size > 0 && <b>{selFechar.size} selecionado(s)</b>}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSelFechar(new Set())} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800">Limpar</button>
                  <button type="button" disabled={fecharBusy || selFechar.size === 0} onClick={() => void travarDias()} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">{fecharBusy ? "Fechando…" : `🔒 Fechar (${selFechar.size})`}</button>
                </div>
              </div>
            )}
            {selCorr.size > 0 && (
              <div className="px-3 py-2 border-b border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[12px] text-blue-800 dark:text-blue-200 font-medium inline-flex items-center gap-1"><MessageSquare size={13}/> {selCorr.size} dia(s) selecionado(s) para pedir correção ao empregado</span>
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
                      <div className="min-w-0 text-[12.5px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                        <span className="shrink-0 w-5 inline-flex justify-center">{renderFecharCell(l)}</span>
                        <span><span className="font-semibold tabular-nums text-gray-800 dark:text-gray-100 mr-1.5">{l.data.slice(-2)}/{l.data.slice(5, 7)}</span>{renderPrevisto(l)}{!l.ehFuturo && !l.ehHoje && statusPraticado(l) && statusPraticado(l) !== (l.statusPrevisto || "trabalho") && <span className="text-gray-400"> → {renderPraticado(l)}</span>}</span>
                      </div>
                      {renderAcoes(l, f.pendUndecided, f.temCorrigivel)}
                    </div>
                    <div className="mt-1 text-[12.5px] text-gray-700 dark:text-gray-200">{renderBatidas(l, f.inclPunch)}</div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
                      <span className="text-gray-500">Trab. <strong className="text-gray-700 dark:text-gray-200 tabular-nums">{l.trabalhado ? hm(l.trabalhado) : "—"}</strong></span>
                      <span className="text-gray-500">Saldo {renderSaldo(l) || <span className="text-gray-300">—</span>}</span>
                      {l.noturno > 0 && <span className="text-indigo-500 tabular-nums">not. {hm(l.noturno)}</span>}
                      <span className="ml-auto">{renderExcecoes(l, f.incompleta, f.suspeito)}</span>
                    </div>
                  </div>
                ); })}
              </div>

              {/* DESKTOP — tabela */}
              <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[12px] min-w-[720px] border-collapse [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-2">
                <colgroup><col className="w-8" /><col className="w-14" /><col className="w-32" /><col className="w-20" /><col /><col className="w-16" /><col className="w-16" /><col className="w-14" /><col className="w-20" /><col className="w-12" /></colgroup>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-200 dark:border-gray-800">
                    <th className="py-1.5 font-semibold text-center" title={fecharMode ? "Marque pra fechar" : "Fechado ✓"}>{fecharMode ? "✓" : <Lock size={11} className="inline"/>}</th><th className="py-1.5 font-semibold">Dia</th><th className="font-semibold" title="Status previsto na escala (o que foi programado)">Previsto</th><th className="font-semibold" title="Status praticado na escala (o que a apuração indica) — '•' = mudou em relação ao previsto">Praticado</th><th className="font-semibold">Batidas / tratamento</th>
                    <th className="font-semibold text-right">Trab.</th><th className="font-semibold text-right" title="Saldo do dia = trabalhado + abonado − previsto (+ verde / − vermelho / 0 azul). Dia com batida aberta fica 'pendente' e conta zero no banco até a correção.">Saldo</th><th className="font-semibold text-right" title="Adicional noturno — minutos trabalhados na faixa noturna (22h–05h)">Not.</th><th className="font-semibold">Exceções</th><th className="font-semibold text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.r.linhas.map((l, idx) => { const f = flagsLinha(l, idx); return (
                    <tr key={l.data} className={`border-b border-gray-50 dark:border-gray-800/40 ${f.rowBg}`}>
                      <td className="text-center">{renderFecharCell(l)}</td>
                      <td className="tabular-nums font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{l.data.slice(-2)}/{l.data.slice(5, 7)} <span className={`text-[10px] font-normal ${[0, 6].includes(new Date(l.data + "T12:00:00").getDay()) ? "text-rose-400 dark:text-rose-400/70" : "text-gray-400"}`}>{diaSemanaAbrev(l.data)}</span></td>
                      <td className={`whitespace-nowrap ${f.folga ? "text-gray-400" : "text-gray-600 dark:text-gray-300"}`}>{renderPrevisto(l)}</td>
                      <td className="whitespace-nowrap">{renderPraticado(l)}</td>
                      <td className="text-gray-700 dark:text-gray-200">{renderBatidas(l, f.inclPunch)}</td>
                      <td className="text-right tabular-nums font-medium">{l.trabalhado ? hm(l.trabalhado) : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="text-right">{renderSaldo(l)}</td>
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
            <TriangleAlert size={13} className="inline align-[-2px] mr-1"/> {batidasSemCadastro.length} pessoa(s) com batida mas <strong>sem empregado cadastrado</strong> neste restaurante (CPF não casou).
          </div>
        )}
        </>
      ))}
      {ajusteModal && me && <AjusteModal empresaKey={shortCode} emp={ajusteModal.emp} data={ajusteModal.data} bs={ajusteModal.bs} reorgExistente={ajusteModal.reorgPares} solidesEmpId={empIdPorCpf.get(soDig(ajusteModal.emp.cpf)) || null} autor={{ id: me.id, nome: me.nome }} onClose={() => setAjusteModal(null)} />}

      {/* Reclassificar status na escala praticada (dia fora de escala / folga trabalhada) */}
      {reclass && (
        <Modal title={`Escala praticada · ${reclass.emp.nome} · ${reclass.data.slice(-2)}/${reclass.data.slice(5, 7)}`} onClose={() => setReclass(null)} maxWidth="max-w-sm">
          <div className="space-y-3">
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              Previsto era <b>{reclass.prev ? STATUS_INFO[reclass.prev].label : "—"}</b>. Como esse dia entra na <b>escala praticada</b> (base da gorjeta)?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["trabalho", "comp_trab", "falta_j", "falta_i", "ferias", "folga"] as ScheduleStatus[]).map(s => (
                <button key={s} type="button" disabled={reclassBusy} onClick={() => void aplicarReclass(s)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-[13px] transition-colors disabled:opacity-50 ${s === reclass.prev ? "border-gray-200 dark:border-gray-800" : "border-gray-300 dark:border-gray-700 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20"}`}>
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text}`}>{STATUS_INFO[s].short}</span>
                  <span className="text-gray-800 dark:text-gray-100">{STATUS_INFO[s].label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-gray-400">Grava direto na praticada e fica registrado na trilha do dia. Pra desfazer, use o ✕ no lançamento.</p>
          </div>
        </Modal>
      )}
      {assModal && me && <PtrpAssinaturasModal empresaKey={shortCode} comp={comp} compLabel={labelComp(comp)} restaurantId={rid} driveFolderInit={{ id: (activeRestaurant as { drivePontoAssinadoFolderId?: string } | null)?.drivePontoAssinadoFolderId, nome: (activeRestaurant as { drivePontoAssinadoFolderNome?: string } | null)?.drivePontoAssinadoFolderNome }} alvos={alvosAssinatura()} meta={espelhoMeta()} autor={{ id: me.id, nome: me.nome }} onClose={() => setAssModal(false)} />}
      {preview && (
        <Modal title={preview.titulo} onClose={fecharPreview} maxWidth="max-w-4xl">
          <div className="space-y-2">
            <iframe title="Espelho de ponto" src={preview.url} className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white" style={{ height: "70vh" }} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">Pré-visualização — role para ver todas as páginas.</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={fecharPreview}>Fechar</Button>
                <Button onClick={() => void baixarOuCompartilhar(preview.blob, preview.nome, { titulo: preview.titulo })}><span className="inline-flex items-center gap-1"><ArrowDown size={14}/> Baixar / Compartilhar</span></Button>
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
          <Button onClick={() => onEnviar(texto)} disabled={!texto.trim()}><span className="inline-flex items-center gap-1"><MessageSquare size={14}/> Abrir no WhatsApp</span></Button>
        </div>
      </div>
    </Modal>
  );
}

// Cada punch da Sólides já é um BLOCO [entrada, saída] — confiamos no bloco
// (igual à Análise/Exceções). NÃO repareamos cronologicamente entre blocos: isso
// colapsava dois blocos ABERTOS (saída nula) num único par a→c, escondendo a
// pausa e o total. Bloco com saída nula OU <= entrada = aberto (saída = null; a
// apuração sinaliza o ímpar). Pendentes/excluídas ficam de fora (fluxo próprio).
// Máscara leve de hora "HHMM" → "HH:MM" (aceita até 27:59 pra turno que vira o dia).
function mascararHora(s: string): string {
  const digits = (s || "").replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
// "HH:MM" → minutos (0..1679). null se inválido. 24:00 = 1440 (vira o dia).
function horaMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 27 || mm > 59) return null;
  return h * 60 + mm;
}

function reparearDia(docs: BatidaDoc[]): BatidaDoc[] {
  const ehPend = (b: BatidaDoc) => b.status === "PENDING" || b.status === "REJECTED";
  const reais = docs.filter(b => !b.excluded && !ehPend(b));
  const outros = docs.filter(b => b.excluded || ehPend(b));
  const blocos = reais.map(b => {
    const dIn = typeof b.dateIn === "number" ? b.dateIn : null;
    const dOut = typeof b.dateOut === "number" && (dIn == null || b.dateOut > dIn) ? b.dateOut : null;
    return { ...b, dateIn: dIn, dateOut: dOut };
  }).filter(b => b.dateIn != null || b.dateOut != null);
  // Regra do negócio: o restaurante NÃO abre de madrugada — ninguém ENTRA 00:00.
  // Então uma batida ABERTA de madrugada (< 05:00) é uma SAÍDA que virou o dia:
  // casa com a entrada aberta mais tardia (turno noite → madrugada). Ex.: a
  // entrada 18:01 + a "00:00" viram um par 18:01–00:00 (a apuração soma 24h).
  const mn = (ms: number) => minutoDoDiaBRT(ms);
  const abertos = blocos.filter(b => b.dateIn != null && b.dateOut == null);
  const madrugadas = abertos.filter(b => mn(b.dateIn as number) < 300).sort((a, b) => mn(a.dateIn as number) - mn(b.dateIn as number));
  const entradasNoite = abertos.filter(b => mn(b.dateIn as number) >= 300).sort((a, b) => mn(b.dateIn as number) - mn(a.dateIn as number)); // mais tarde primeiro
  const usados = new Set<typeof blocos[number]>();
  const casadas = new Set<typeof blocos[number]>();
  for (const saida of madrugadas) {
    const entrada = entradasNoite.find(e => !usados.has(e));
    if (entrada) { entrada.dateOut = saida.dateIn; usados.add(entrada); casadas.add(saida); }
  }
  const final = blocos.filter(b => !casadas.has(b));
  return [...final, ...outros].sort((a, b) => (a.dateIn ?? Infinity) - (b.dateIn ?? Infinity));
}

// Modal de TRATAMENTO (gera ptrpAjustes — nunca edita a batida original).
// 2 caminhos: (A) Editar marcações (incluir/excluir, cronológico, sempre reflete
// na Sólides) · (B) Lançar motivo (afastamento/abono: motivo Sólides + status escala).
const STATUS_LISTA: ScheduleStatus[] = ["trabalho", "falta_j", "falta_i", "folga", "comp", "comp_trab", "ferias", "freela"];
function AjusteModal({ empresaKey, emp, data, bs, reorgExistente, solidesEmpId, autor, onClose }: { empresaKey: string; emp: Empregado; data: string; bs: BatidaDoc[]; reorgExistente?: { in: string; out: string }[]; solidesEmpId: string | null; autor: { id: string; nome: string }; onClose: () => void }) {
  const [caminho, setCaminho] = useState<"" | "marcacoes" | "motivo" | "atestado" | "reorganizar">("");
  const [reorgT, setReorgT] = useState<string[]>([]);   // marcações individuais (HH:MM), em ordem
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [atIni, setAtIni] = useState(data);          // período do atestado
  const [atFim, setAtFim] = useState(data);
  const [trocarMotivo, setTrocarMotivo] = useState(false);
  const [trocarStatus, setTrocarStatus] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const [aviso, setAviso] = useState("");
  const [obs, setObs] = useState("");
  const inp = "w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const cpf = (emp.cpf || "").replace(/\D/g, "");
  const ehPend = (b: BatidaDoc) => b.status === "PENDING" || b.status === "REJECTED";
  const hhmmLocal = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const iso = (hhmm: string) => `${data}T${hhmm}:00.000-0300`;

  // ── Caminho A: editar marcações ────────────────────────────────────────────
  const existentes = useMemo(() => bs.filter(b => !b.excluded && !ehPend(b)).map(b => ({ punchId: b.punchId || "", in: hhmmLocal(b.dateIn), out: hhmmLocal(b.dateOut), inMs: b.dateIn ?? null, dateIn: b.dateIn ?? undefined, dateOut: b.dateOut ?? undefined })), [bs]);
  // Reorganizar: parte de TODAS as batidas do dia (inclusive pendentes — antes de
  // aprovar), pra o DP corrigir o pareamento (ex.: 18:01–00:00).
  const abrirReorganizar = () => {
    // Se já existe uma reorganização salva pra este dia, reabre NA ORDEM salva
    // (achatando os pares em marcações individuais: in,out,in,out…), pra o DP não
    // perder o rearranjo que fez. Só quando não há reorganização é que extraímos
    // as marcações cruas do dia e ordenamos cronologicamente como ponto de partida.
    if (reorgExistente && reorgExistente.length) {
      const flat = reorgExistente.flatMap(p => [p.in, p.out]).filter(t => t && t !== "—");
      setReorgT(flat.length ? flat : [""]);
      setCaminho("reorganizar");
      return;
    }
    // Extrai TODAS as marcações individuais do dia (entradas e saídas de cada
    // batida, inclusive pendentes), em ordem cronológica. O DP arrasta/edita/
    // exclui cada uma; os pares saem por adjacência (1ª+2ª, 3ª+4ª…).
    const tempos = bs.filter(b => !b.excluded).flatMap(b => [hhmmLocal(b.dateIn), hhmmLocal(b.dateOut)]).filter(t => t && t !== "—");
    tempos.sort((a, b) => (horaMin(a) ?? 0) - (horaMin(b) ?? 0));
    setReorgT(tempos.length ? tempos : [""]);
    setCaminho("reorganizar");
  };
  // Pares por adjacência: [t0,t1,t2,t3] → [(t0–t1),(t2–t3)]. Saída < entrada = vira
  // o dia (a apuração soma 24h). Sobra ímpar fica como par incompleto (ignorado).
  const paresDeTempos = (ts: string[]): { in: string; out: string }[] => {
    const out: { in: string; out: string }[] = [];
    for (let i = 0; i + 1 < ts.length; i += 2) out.push({ in: ts[i], out: ts[i + 1] });
    return out;
  };
  const moverTempo = (from: number, to: number) => setReorgT(v => { if (to < 0 || to >= v.length) return v; const n = [...v]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());
  const [novos, setNovos] = useState<{ in: string; out: string }[]>([]);
  const [nin, setNin] = useState("08:00");
  const [nout, setNout] = useState("17:00");
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [justId, setJustId] = useState<number | null>(null);
  useEffect(() => { fetchJustificativas(empresaKey).then(js => { setJusts(js); const esq = js.find(j => /esquec/i.test(j.description)); setJustId((esq || js[0])?.id ?? null); }).catch(() => {}); }, [empresaKey]);
  // Repareia CRONOLOGICAMENTE os horários que sobram (registros não removidos) +
  // os novos — igual à apuração (reparearDia). Assim dá pra excluir UMA batida
  // avulsa e ver o resultado remontado (1º=entrada, 2º=saída), sem precisar
  // mexer de duas em duas.
  const preview = useMemo(() => {
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const ev: { m: number; novo: boolean }[] = [];
    for (const e of existentes) {
      if (removidos.has(e.punchId)) continue;
      if (e.dateIn != null) ev.push({ m: minutoDoDiaBRT(e.dateIn), novo: false });
      if (e.dateOut != null) ev.push({ m: minutoDoDiaBRT(e.dateOut), novo: false });
    }
    for (const n of novos) { ev.push({ m: hhmmToMin(n.in), novo: true }); ev.push({ m: hhmmToMin(n.out), novo: true }); }
    ev.sort((a, b) => a.m - b.m);
    const rows: { in: string; out: string; novo: boolean }[] = [];
    for (let i = 0; i < ev.length; i += 2) rows.push({ in: fmt(ev[i].m), out: ev[i + 1] != null ? fmt(ev[i + 1].m) : "—", novo: ev[i].novo || (ev[i + 1]?.novo ?? false) });
    const trabMin = rows.reduce((s, r) => s + (r.out !== "—" ? Math.max(0, hhmmToMin(r.out) - hhmmToMin(r.in)) : 0), 0);
    return { rows, impar: ev.length % 2 !== 0, trabMin };
  }, [existentes, removidos, novos]);

  // ── Caminho B: motivo / afastamento ────────────────────────────────────────
  const [motivos, setMotivos] = useState<MotivoAfastamento[]>([]);
  const [mapa, setMapa] = useState<Record<string, { status?: string; exibir?: boolean; descricao?: string }>>({});
  const [motivoId, setMotivoId] = useState<number | null>(null);
  const [motivoPreset, setMotivoPreset] = useState<"abono" | "atestado" | "outro" | null>(null);
  const [statusEscala, setStatusEscala] = useState<ScheduleStatus>("falta_j");
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [ain, setAin] = useState("08:00");
  const [aout, setAout] = useState("12:00");
  const [buscaMotivo, setBuscaMotivo] = useState("");
  useEffect(() => { fetchMotivosAfastamento(empresaKey).then(setMotivos).catch(() => {}); }, [empresaKey]);
  useEffect(() => onSnapshot(doc(db, "ptrpMotivosMapa", empresaKey), d => setMapa((d.exists() ? (d.data() as { mapa?: Record<string, { status?: string; exibir?: boolean; descricao?: string }> }).mapa : {}) || {})), [empresaKey]);
  // Família de motivos por caminho (casada por DESCRIÇÃO — os ids variam entre as
  // empresas, então não dá pra fixar id). Usada pra pré-selecionar e subir os
  // relevantes ao topo, sem esconder os demais.
  const reFamilia = (p: "abono" | "atestado" | "outro" | null): RegExp =>
    p === "atestado" ? /atestad|afastament|inss|licen|acidente|óbito|obito|matern|patern/i
      : p === "abono" ? /abono|falta justif|intervalo/i : /.^/;
  const familia = useMemo(() => {
    if (!motivoPreset || motivoPreset === "outro") return null;
    const re = reFamilia(motivoPreset);
    return new Set(motivos.filter(m => re.test(m.description)).map(m => m.id));
  }, [motivoPreset, motivos]);
  const motivosOrd = useMemo(() => {
    const q = buscaMotivo.trim().toLowerCase();
    return motivos.filter(m => !q || m.description.toLowerCase().includes(q))
      .sort((a, b) => {
        const fa = familia ? (familia.has(a.id) ? 0 : 1) : 0, fb = familia ? (familia.has(b.id) ? 0 : 1) : 0;
        if (fa !== fb) return fa - fb;
        const pa = mapa[String(a.id)]?.exibir ? 0 : 1, pb = mapa[String(b.id)]?.exibir ? 0 : 1;
        return pa !== pb ? pa - pb : a.description.localeCompare(b.description);
      });
  }, [motivos, mapa, buscaMotivo, familia]);
  const escolherMotivo = (id: number) => { setMotivoId(id); const st = mapa[String(id)]?.status; if (st) setStatusEscala(st as ScheduleStatus); };
  // Motivo-padrão do caminho (por descrição): Atestado→"ATESTADO MÉDICO", Abono→"ABONO".
  const motivoPadrao = (p: "abono" | "atestado" | "outro" | null): number | null => {
    if (p === "atestado") return (motivos.find(m => /atestado m/i.test(m.description)) || motivos.find(m => /atestad/i.test(m.description)))?.id ?? null;
    if (p === "abono") return (motivos.find(m => /^abono$/i.test(m.description.trim())) || motivos.find(m => /abono/i.test(m.description)))?.id ?? null;
    return null;
  };
  const abrirCaminhoMotivo = (p: "abono" | "outro") => {
    setMotivoPreset(p); setCaminho("motivo"); setBuscaMotivo("");
    const def = p === "abono" ? motivoPadrao("abono") : null;
    if (def) escolherMotivo(def); else setMotivoId(null);
  };
  // Caminho dedicado ao atestado: motivo PRÉ-SELECIONADO (ATESTADO MÉDICO) +
  // status DERIVADO (falta justificada) + período de/até. Sem listas cheias.
  const STATUS_AUSENCIA: ScheduleStatus[] = ["falta_j", "falta_i", "folga", "ferias"];
  const abrirAtestado = () => {
    setMotivoPreset("atestado"); setCaminho("atestado"); setBuscaMotivo("");
    setAtIni(data); setAtFim(data); setTrocarMotivo(false); setTrocarStatus(false);
    setStatusEscala("falta_j");
    const def = motivoPadrao("atestado");
    if (def) escolherMotivo(def); else setMotivoId(null);
    if (!(motivoPadrao("atestado") && mapa[String(motivoPadrao("atestado"))]?.status)) setStatusEscala("falta_j");
  };
  const diasDoIntervalo = (ini: string, fim: string): string[] => {
    const out: string[] = []; let d = ini; let guard = 0;
    while (d <= fim && guard++ < 366) { out.push(d); d = somaDiasYmd(d, 1); }
    return out;
  };
  const togglePreferido = (id: number) => { const cur = mapa[String(id)] || {}; const m = motivos.find(x => x.id === id); void setDoc(doc(db, "ptrpMotivosMapa", empresaKey), sanitizeForFirestore({ mapa: { ...mapa, [String(id)]: { ...cur, exibir: !cur.exibir, descricao: m?.description || cur.descricao } }, atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {}); };

  // ── Evidência opcional (respaldo jurídico do tratamento) ────────────────────
  const [evidencias, setEvidencias] = useState<PtrpEvidencia[]>([]);
  const [subindoEvid, setSubindoEvid] = useState(false);
  const [linkEvid, setLinkEvid] = useState("");
  async function subirEvidencia(file: File | null) {
    if (!file) return;
    setSubindoEvid(true); setErr("");
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const rid = Math.random().toString(36).slice(2, 10);
      const path = `ptrp-evidencias/${empresaKey}/${data}_${cpf}_${rid}.${ext}`;
      const task = uploadBytesResumable(storageRef(storage, path), file, { customMetadata: { cpf, data, autor: autor.id } });
      await task;
      const url = await getDownloadURL(task.snapshot.ref);
      setEvidencias(prev => [...prev, { tipo: "arquivo", url, nome: file.name.slice(0, 120), adicionadoEm: new Date().toISOString(), adicionadoPor: autor.id }]);
    } catch (e) {
      setErr("Falha ao subir evidência: " + (e instanceof Error ? e.message : "erro"));
    } finally { setSubindoEvid(false); }
  }
  function addLinkEvidencia() {
    let u = linkEvid.trim(); if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setEvidencias(prev => [...prev, { tipo: "link", url: u, nome: u.replace(/^https?:\/\//, "").slice(0, 80), adicionadoEm: new Date().toISOString(), adicionadoPor: autor.id }]);
    setLinkEvid("");
  }
  const evidPayload = evidencias.length ? { evidencias } : {};

  async function salvar() {
    setErr(""); setAviso("");
    try {
      if (caminho === "marcacoes") {
        const rem = existentes.filter(e => removidos.has(e.punchId));
        if (!rem.length && !novos.length) { setErr("Adicione ou remova ao menos uma marcação."); return; }
        if (preview.impar) { setErr("Resultado ficou ímpar — toda entrada precisa de uma saída."); return; }
        if (!solidesEmpId) { setErr("Sem vínculo Sólides deste colaborador no mês — sincronize antes."); return; }
        if (novos.length && !justId) { setErr("Escolha a justificativa da Sólides."); return; }
        setSalvando(true);
        // Exclui na Sólides quando possível; SEMPRE registra a desconsideração
        // (ignora a batida na apuração pelo punchId). Batidas "abertas" (só entrada,
        // sem saída) a Sólides às vezes recusa ("Punch not found") — nesse caso a
        // apuração já fica corrigida no app e avisamos que a Sólides não excluiu.
        let solidesFalhas = 0;
        for (const e of rem) {
          let okSolides = false;
          try {
            await excluirBatida(empresaKey, { employeeId: Number(solidesEmpId), punchId: Number(e.punchId), dateIn: e.dateIn, dateOut: e.dateOut });
            okSolides = true;
          } catch { solidesFalhas++; }
          await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({ empresaKey, colaboradorId: emp.id, cpf, data, tipo: "desconsideracao", punchId: e.punchId, motivo: obs.trim() || "marcação desconsiderada", ...evidPayload, autor, criadoEm: new Date().toISOString(), cancelado: false, solidesDecisao: okSolides }));
        }
        for (const n of novos) {
          await corrigirPontoAtraso(empresaKey, { employeeId: Number(solidesEmpId), dataHoraIso: iso(n.in), justificativaId: justId! });
          await corrigirPontoAtraso(empresaKey, { employeeId: Number(solidesEmpId), dataHoraIso: iso(n.out), justificativaId: justId! });
          await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({ empresaKey, colaboradorId: emp.id, cpf, data, tipo: "inclusao", in: n.in, out: n.out, motivo: obs.trim() || "esquecimento", ...evidPayload, autor, criadoEm: new Date().toISOString(), cancelado: false, solidesDecisao: true }));
        }
        if (solidesFalhas > 0) {
          setSalvando(false);
          setAviso(`Pronto — o ponto no app já está corrigido. ${solidesFalhas} marcação(ões) foram desconsideradas na apuração, mas a Sólides não excluiu a batida original (geralmente uma batida "aberta", só entrada, ou já alterada lá) — se precisar, remova também direto no painel da Sólides. Pode fechar.`);
          return;
        }
        onClose();
      } else if (caminho === "motivo") {
        if (!motivoId) { setErr("Escolha o motivo da Sólides."); return; }
        setSalvando(true);
        const mInfo = motivos.find(m => m.id === motivoId);
        const abonMin = diaInteiro ? 0 : Math.max(0, hhmmToMin(aout) - hhmmToMin(ain));
        if (solidesEmpId && diaInteiro) await lancarAfastamento(empresaKey, { employeeId: Number(solidesEmpId), adjustmentReasonId: motivoId, startDate: data, endDate: data, fullDay: true });
        await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({ empresaKey, colaboradorId: emp.id, cpf, data, tipo: "abono", statusEscala, motivoSolidesId: motivoId, ...(abonMin ? { minutos: abonMin, in: ain, out: aout } : {}), motivo: obs.trim() || (mInfo?.description || ""), ...evidPayload, autor, criadoEm: new Date().toISOString(), cancelado: false, solidesDecisao: !!(solidesEmpId && diaInteiro) }));
        await setDoc(doc(db, "ptrpMotivosMapa", empresaKey), sanitizeForFirestore({ mapa: { ...mapa, [String(motivoId)]: { ...(mapa[String(motivoId)] || {}), status: statusEscala, descricao: mInfo?.description || `Motivo ${motivoId}` } }, atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
        // NÃO grava em escalas.real aqui: o abono trata o dia (vira statusPraticado);
        // quem SOBE pra escala praticada é o FECHAMENTO do dia ("Fechar dias" grava
        // real + realAjustes.solides_sync). A visibilidade imediata fica na coluna
        // "Praticado" da Conferência.
        onClose();
      } else if (caminho === "atestado") {
        if (!motivoId) { setErr("Escolha o motivo do atestado."); return; }
        if (atIni > atFim) { setErr("A data de início não pode ser depois do fim."); return; }
        const mInfo = motivos.find(m => m.id === motivoId);
        const desc = mInfo?.description || "";
        // Atestado médico vai pelo MÓDULO NOVO (timeoffwork) — o /adjustment/register
        // recusa atestados/licenças com HTTP 400. Só o atestado médico está mapeado
        // (timeOffWork 4 · eSocial COD_02); os demais (licença/INSS/acidente/óbito/
        // acompanhamento) ainda não têm mapeamento → orienta lançar na Sólides.
        const ehAtestadoMedico = /atestado m[ée]dico|doen[çc]a n[ãa]o relacionada/i.test(desc);
        const ehLongoBloqueado = !ehAtestadoMedico && /licen[çc]a|matern|patern|[oó]bito|afastament|inss|acidente|acompanhament|doen[çc]a do trabalho/i.test(desc);
        if (ehLongoBloqueado) { setErr(`"${desc}" ainda não está integrado aqui — lance direto no módulo de Afastamentos da Sólides (exige o evento eSocial). O atestado médico comum funciona por aqui.`); return; }
        setSalvando(true);
        // Sólides: 1 chamada cobre o período inteiro (dia inteiro).
        if (solidesEmpId && ehAtestadoMedico) {
          await criarAfastamentoNovo(empresaKey, { employee: Number(solidesEmpId), timeOffWork: 4, esocialReason: "COD_02", startDate: atIni, endDate: atFim });
        }
        const foiSolides = !!(solidesEmpId && ehAtestadoMedico);
        // App: 1 lançamento por dia (pra refletir no espelho de cada dia). Sobe pra
        // escala praticada no FECHAMENTO do dia (não aqui) — igual ao abono.
        for (const dia of diasDoIntervalo(atIni, atFim)) {
          await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({ empresaKey, colaboradorId: emp.id, cpf, data: dia, tipo: "abono", statusEscala, motivoSolidesId: motivoId, motivo: obs.trim() || (desc || "Atestado médico"), ...evidPayload, autor, criadoEm: new Date().toISOString(), cancelado: false, solidesDecisao: foiSolides }));
        }
        await setDoc(doc(db, "ptrpMotivosMapa", empresaKey), sanitizeForFirestore({ mapa: { ...mapa, [String(motivoId)]: { ...(mapa[String(motivoId)] || {}), status: statusEscala, descricao: desc || `Motivo ${motivoId}` } }, atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
        onClose();
      } else if (caminho === "reorganizar") {
        // App-only: grava os pares corretos do dia. NÃO toca na Sólides (a batida
        // original é imutável) — só sobrepõe a interpretação da apuração.
        for (const t of reorgT) if (t.trim() && horaMin(t) == null) { setErr(`Horário inválido: "${t}". Use HH:MM.`); return; }
        const validos = reorgT.filter(t => horaMin(t) != null);
        const pares = paresDeTempos(validos);   // por adjacência: (1,2),(3,4)… saída<entrada = vira o dia
        if (!pares.length) { setErr("Precisa de pelo menos um par (2 marcações: entrada e saída)."); return; }
        setSalvando(true);
        // Remove reorganizações ANTERIORES do dia (app-only, sem trilha) pra não duplicar.
        const qOld = query(collection(db, "ptrpAjustes"), where("empresaKey", "==", empresaKey), where("colaboradorId", "==", emp.id), where("data", "==", data), where("tipo", "==", "reorganizacao"));
        const snapOld = await getDocs(qOld);
        for (const d of snapOld.docs) await deleteDoc(d.ref);
        await addDoc(collection(db, "ptrpAjustes"), sanitizeForFirestore({ empresaKey, colaboradorId: emp.id, cpf, data, tipo: "reorganizacao" as PtrpAjusteTipo, pares, motivo: obs.trim() || "Batidas reorganizadas manualmente", ...evidPayload, autor, criadoEm: new Date().toISOString(), cancelado: false }));
        onClose();
      }
    } catch (e) { setErr("Falha ao aplicar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }

  return (
    <Modal title={`Tratar · ${emp.nome} · ${data.slice(-2)}/${data.slice(5, 7)}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="text-[11px] text-gray-500">A batida original é imutável — o tratamento entra como lançamento adicional (Portaria 671) e sempre reflete na Sólides.</div>

        {!caminho && (<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button onClick={() => setCaminho("marcacoes")} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Pencil size={14}/> Editar marcações</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Incluir uma esquecida, excluir uma duplicada ou corrigir uma errada.</div>
            </button>
            <button onClick={abrirReorganizar} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-violet-400 hover:bg-violet-50/40 dark:hover:bg-violet-900/10">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><RotateCw size={14}/> Reorganizar marcações</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Arrasta, edita ou exclui <b>cada marcação</b> e refaz os pares (ex.: joga o 00:00 pro fim → 18:01–00:00). App-only, antes de aprovar.</div>
            </button>
            <button onClick={() => abrirCaminhoMotivo("abono")} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Umbrella size={14}/> Abono / justificativa</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Abona falta ou intervalo (dia inteiro ou parcial) — na Sólides e na escala.</div>
            </button>
            <button onClick={abrirAtestado} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Umbrella size={14}/> Atestado / afastamento médico</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Atestado médico por período, com anexo — motivo e status já vêm prontos.</div>
            </button>
            <button onClick={() => abrirCaminhoMotivo("outro")} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1"><Umbrella size={14}/> Outro motivo</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Folga, feriado, home office, falta não justificada, compensação…</div>
            </button>
          </div>
          <div className="text-[11px] text-gray-400">Férias: registre no fluxo de Escala (previsão de férias do período), não aqui.</div>
        </>)}

        {caminho === "marcacoes" && (<>
          <button onClick={() => setCaminho("")} className="text-[11px] text-gray-400 hover:underline">‹ voltar</button>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5">
            <div className="text-[11px] font-semibold text-gray-500 mb-1">Como vai ficar (ordem cronológica)</div>
            {preview.rows.length === 0 ? <div className="text-[12px] text-gray-400">sem marcações</div> :
              <div className="space-y-0.5">{preview.rows.map((r, i) => <div key={i} className={`text-[12.5px] tabular-nums ${r.novo ? "text-emerald-600 dark:text-emerald-300" : "text-gray-700 dark:text-gray-200"}`}>{r.in}–{r.out}{r.novo ? " (nova)" : ""}</div>)}</div>}
            <div className="text-[11px] text-gray-500 mt-1">Trabalhado: {String(Math.floor(preview.trabMin / 60)).padStart(2, "0")}h{String(preview.trabMin % 60).padStart(2, "0")}{preview.impar && <span className="text-rose-600 ml-2 inline-flex items-center gap-1"><TriangleAlert size={11}/> nº ímpar de marcações</span>}</div>
          </div>
          {existentes.length > 0 && <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold text-gray-500">Marcações registradas na Sólides <span className="font-normal text-gray-400">— marque pra excluir (uma a uma)</span></div>
            {existentes.map(e => { const rem = removidos.has(e.punchId); return <label key={e.punchId} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={rem} onChange={ev => setRemovidos(s => { const n = new Set(s); if (ev.target.checked) n.add(e.punchId); else n.delete(e.punchId); return n; })} /><span className={rem ? "line-through text-gray-400" : ""}>{e.in}–{e.out}</span>{rem && <span className="text-[10px] text-rose-500">será excluída</span>}</label>; })}
          </div>}
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold text-gray-500">Adicionar marcação esquecida</div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-[10px] text-gray-500">Entrada<input type="time" value={nin} onChange={e => setNin(e.target.value)} className={inp} /></label>
              <label className="text-[10px] text-gray-500">Saída<input type="time" value={nout} onChange={e => setNout(e.target.value)} className={inp} /></label>
              <Button size="sm" variant="secondary" onClick={() => setNovos(v => [...v, { in: nin, out: nout }])}>+ add</Button>
            </div>
            {novos.length > 0 && <div className="text-[11px] text-gray-500">Adicionadas: {novos.map((n, i) => <span key={i} className="mr-2">{n.in}–{n.out} <button onClick={() => setNovos(v => v.filter((_, k) => k !== i))} className="text-rose-500">✕</button></span>)}</div>}
          </div>
          {novos.length > 0 && <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-gray-500">Justificativa na Sólides</span>
            <select value={justId ?? ""} onChange={e => setJustId(Number(e.target.value) || null)} className={inp}>{justs.length === 0 && <option value="">carregando…</option>}{justs.map(j => <option key={j.id} value={j.id}>{j.description}</option>)}</select>
          </label>}
        </>)}

        {caminho === "motivo" && (<>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => { setCaminho(""); setMotivoPreset(null); }} className="text-[11px] text-gray-400 hover:underline">‹ voltar</button>
            <span className="text-[11px] font-semibold text-gray-500">{motivoPreset === "abono" ? "Abono / justificativa" : "Outro motivo"}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">Motivo na Sólides {motivos.length === 0 && <span className="text-gray-400">(carregando…)</span>}</label>
              <input value={buscaMotivo} onChange={e => setBuscaMotivo(e.target.value)} placeholder="buscar…" className={`${inp} mb-1`} />
              <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {motivosOrd.map(m => { const pref = mapa[String(m.id)]?.exibir; return <div key={m.id} className={`flex items-center gap-1.5 px-2 py-1 text-[12px] ${motivoId === m.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
                  <button onClick={() => togglePreferido(m.id)} title="Preferido (aparece no topo)" className={pref ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}>★</button>
                  <button onClick={() => escolherMotivo(m.id)} className="flex-1 text-left text-gray-700 dark:text-gray-200">{m.description}</button>
                </div>; })}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">Status na escala (praticada)</label>
              {/* Lista sempre aberta (igual à de Motivo, ao lado) — navega e escolhe. */}
              <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                {STATUS_LISTA.map(s => <button key={s} type="button" onClick={() => setStatusEscala(s)} className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${s === statusEscala ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text}`}>{STATUS_INFO[s].short}</span>
                  <span className="text-gray-700 dark:text-gray-200">{STATUS_INFO[s].label}</span>
                </button>)}
              </div>
              <label className="flex items-center gap-2 text-[12px] mt-1"><input type="checkbox" checked={diaInteiro} onChange={e => setDiaInteiro(e.target.checked)} /> Dia inteiro</label>
              {!diaInteiro && <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-gray-500">De<input type="time" value={ain} onChange={e => setAin(e.target.value)} className={inp} /></label><label className="text-[10px] text-gray-500">Até<input type="time" value={aout} onChange={e => setAout(e.target.value)} className={inp} /></label></div>}
            </div>
          </div>
          {!solidesEmpId && <div className="text-[11px] text-amber-600 inline-flex items-center gap-1"><TriangleAlert size={11}/> Sem vínculo Sólides — fica só no app (sincronize antes pra refletir lá).</div>}
          {!diaInteiro && <div className="text-[11px] text-gray-400">Abono parcial entra no saldo do app. Envio parcial à Sólides ainda não disponível — use dia inteiro pra refletir lá.</div>}
        </>)}

        {caminho === "atestado" && (() => {
          const mSel = motivos.find(m => m.id === motivoId) || null;
          const dSel = mSel?.description || "";
          const ehAtMed = /atestado m[ée]dico|doen[çc]a n[ãa]o relacionada/i.test(dSel);
          const ehLongo = !ehAtMed && /licen[çc]a|matern|patern|[oó]bito|afastament|inss|acidente|acompanhament|doen[çc]a do trabalho/i.test(dSel);
          const nDias = atIni && atFim && atIni <= atFim ? diasDoIntervalo(atIni, atFim).length : 0;
          return (<>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => { setCaminho(""); setMotivoPreset(null); }} className="text-[11px] text-gray-400 hover:underline">‹ voltar</button>
              <span className="text-[11px] font-semibold text-gray-500 inline-flex items-center gap-1"><Umbrella size={11}/> Atestado / afastamento médico</span>
            </div>

            {/* Motivo PRÉ-SELECIONADO + trocar (só a família de atestado) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">Motivo na Sólides</label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-900/40 text-[12.5px] font-medium text-gray-800 dark:text-gray-100">
                  {mSel?.description || (motivos.length ? "escolha um motivo" : "carregando…")}
                </span>
                <button type="button" onClick={() => setTrocarMotivo(v => !v)} className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline">trocar</button>
              </div>
              {trocarMotivo && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 mt-1">
                  {motivos.filter(m => !familia || familia.has(m.id)).map(m => (
                    <button key={m.id} type="button" onClick={() => { escolherMotivo(m.id); setTrocarMotivo(false); }} className={`flex w-full px-2 py-1.5 text-[12px] text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${m.id === motivoId ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}>{m.description}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Status DERIVADO + trocar (só status de ausência) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">Status na escala (praticada)</label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px] font-medium`}>
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[statusEscala].bg} ${STATUS_INFO[statusEscala].text}`}>{STATUS_INFO[statusEscala].short}</span>
                  {STATUS_INFO[statusEscala].label}
                </span>
                <button type="button" onClick={() => setTrocarStatus(v => !v)} className="text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline">trocar</button>
              </div>
              {trocarStatus && (
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {STATUS_AUSENCIA.map(s => (
                    <button key={s} type="button" onClick={() => { setStatusEscala(s); setTrocarStatus(false); }} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[12px] ${s === statusEscala ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-gray-200 dark:border-gray-700"}`}>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text}`}>{STATUS_INFO[s].short}</span>{STATUS_INFO[s].label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Período de/até (dia inteiro) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">Período do atestado (dia inteiro)</label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-gray-500">Início<input type="date" value={atIni} onChange={e => { setAtIni(e.target.value); if (e.target.value > atFim) setAtFim(e.target.value); }} className={inp} /></label>
                <label className="text-[10px] text-gray-500">Fim<input type="date" value={atFim} min={atIni} onChange={e => setAtFim(e.target.value)} className={inp} /></label>
              </div>
              {nDias > 0 && <span className="text-[11px] text-gray-500">{nDias} dia(s) — 1 lançamento na Sólides cobrindo o período.</span>}
            </div>

            {ehAtMed && <div className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-start gap-1"><Umbrella size={11} className="mt-0.5 shrink-0"/> Atestado médico vai pro <b className="font-semibold">módulo de Afastamentos</b> da Sólides (eSocial COD_02) — a rotina certa. Anexe o atestado no campo Evidência abaixo.</div>}
            {ehLongo && <div className="text-[11px] text-rose-600 dark:text-rose-400 inline-flex items-start gap-1"><TriangleAlert size={11} className="mt-0.5 shrink-0"/> "{dSel}" ainda não está integrado aqui (exige evento eSocial próprio) — <b className="font-semibold">lance direto no módulo de Afastamentos da Sólides</b>. O botão vai recusar este tipo.</div>}
            {!solidesEmpId && <div className="text-[11px] text-amber-600 inline-flex items-center gap-1"><TriangleAlert size={11}/> Sem vínculo Sólides — fica só no app (sincronize antes pra refletir lá).</div>}
          </>);
        })()}

        {caminho === "reorganizar" && (() => {
          const previa = paresDeTempos(reorgT.filter(t => horaMin(t) != null));
          const impar = reorgT.filter(t => horaMin(t) != null).length % 2 !== 0;
          return (<>
          <button onClick={() => setCaminho("")} className="text-[11px] text-gray-400 hover:underline">‹ voltar</button>
          <div className="text-[11px] text-gray-600 dark:text-gray-300">Cada linha é uma <b>marcação</b>. <b>Arraste</b> (ou ↑/↓) pra reordenar, edite ou exclua cada uma. Os pares saem por ordem: <b>1ª+2ª = entrada→saída</b>, 3ª+4ª, e assim por diante. Saída depois da meia-noite: é só deixar o horário da madrugada <b>por último</b> (ex.: 18:01 … 00:00) — o sistema soma 24h. <span className="text-gray-400">A batida na Sólides continua intacta; isto é só a interpretação do app.</span></div>
          <div className="flex flex-col gap-1">
            {reorgT.map((t, i) => (
              <div key={i} draggable onDragStart={() => setDragIdx(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragIdx != null && dragIdx !== i) moverTempo(dragIdx, i); setDragIdx(null); }}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${dragIdx === i ? "opacity-50" : ""} ${i % 2 === 0 ? "border-emerald-200 dark:border-emerald-900/40" : "border-indigo-200 dark:border-indigo-900/40"}`}>
                <span className="cursor-grab text-gray-400 select-none" title="Arraste pra reordenar">⠿</span>
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${i % 2 === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"}`}>{i % 2 === 0 ? "entra" : "sai"}</span>
                <input type="text" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={t} onChange={e => setReorgT(v => v.map((x, k) => k === i ? mascararHora(e.target.value) : x))} className={`${inp} tabular-nums flex-1`} />
                <button type="button" onClick={() => moverTempo(i, i - 1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-0.5" title="Subir">↑</button>
                <button type="button" onClick={() => moverTempo(i, i + 1)} disabled={i === reorgT.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-0.5" title="Descer">↓</button>
                <button type="button" onClick={() => setReorgT(v => v.filter((_, k) => k !== i))} className="text-rose-500 hover:text-rose-600 px-1" title="Excluir marcação">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setReorgT(v => [...v, ""])} className="text-[11px] text-violet-600 dark:text-violet-300 hover:underline self-start">+ adicionar marcação</button>
          </div>
          {previa.length > 0 && <div className="text-[11px] text-gray-600 dark:text-gray-300">Vai ficar: <b className="tabular-nums">{previa.map(p => `${p.in}–${p.out}`).join(" · ")}</b>{impar && <span className="text-amber-600 dark:text-amber-400 ml-2">⚠ 1 marcação sem par (ímpar) — vai ser ignorada</span>}</div>}
          </>);
        })()}

        {caminho && caminho !== "reorganizar" && <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação (trilha do app)</span><textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Ex.: esqueceu de bater a saída; atestado de 1 dia…" className={inp} /></label>}

        {caminho && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Evidência (opcional) <span className="font-normal text-gray-400">— print do WhatsApp, atestado…</span></span>
            {evidencias.length > 0 && (
              <div className="flex flex-col gap-1">
                {evidencias.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <span className="text-gray-400">{ev.tipo === "arquivo" ? "📎" : "🔗"}</span>
                    <a href={ev.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-teal-600 dark:text-teal-400 hover:underline">{ev.nome}</a>
                    <button type="button" onClick={() => setEvidencias(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-rose-500" title="Remover">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className={`text-xs rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${subindoEvid ? "opacity-50 pointer-events-none" : ""}`}>
                {subindoEvid ? "Subindo…" : "📎 Anexar arquivo"}
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={subindoEvid} onChange={e => { void subirEvidencia(e.target.files?.[0] || null); e.target.value = ""; }} />
              </label>
              <div className="flex items-center gap-1 flex-1 min-w-[180px]">
                <input value={linkEvid} onChange={e => setLinkEvid(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLinkEvidencia(); } }} placeholder="ou colar um link (Drive, etc.)" className={`${inp} text-xs`} />
                <Button size="sm" variant="secondary" onClick={addLinkEvidencia} disabled={!linkEvid.trim()}>Add</Button>
              </div>
            </div>
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}
        {aviso && <div className="text-[13px] rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">{aviso}</div>}
        {caminho && <div className="flex justify-end gap-2 pt-1"><Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Confirmar tratamento"}</Button></div>}
      </div>
    </Modal>
  );
}
