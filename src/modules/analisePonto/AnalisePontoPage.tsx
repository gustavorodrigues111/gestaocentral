// ════════════════════════════════════════════════════════════════════════════
//  Análise de Ponto — módulo NOVO (lado a lado com "Registros de Ponto"/Exceções,
//  que será aposentado depois). Motor determinístico sobre a API Sólides:
//  carga prevista × trabalhada + saldo do período (jornada flexível), com as
//  ocorrências divididas em duas categorias de AÇÃO: A Corrigir × A Avaliar.
//
//  Fluxo central: o EMPREGADO corrige no app dele → a gente APROVA. Correção
//  manual (editar/excluir batida) é exceção, em aba à parte com permissão própria.
//
//  Aba Inconsistências: agrupado por empregado, seleciono apontamentos → mando
//  UMA mensagem de WhatsApp com prazo (config, default 6h) → relógio no nome.
//  "Ciente / sem ação" tira da lista (registra quem avaliou). Estado persiste
//  em pontoSolicitacoes / pontoAvaliacoes (a análise em si é recalculada do zero).
// ════════════════════════════════════════════════════════════════════════════

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { AREAS, type Area, type Cargo, type Empregado, type Pessoa } from "../../core/types";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import type { SolidesPunch } from "../../core/excecoes/types";
import { Modal } from "../../core/ui/Modal";
import {
  fetchScheduleCatalog, fetchRoster, fetchJustificativas, corrigirPontoAtraso,
  decidirAprovacao, editarBatida, excluirBatida,
  fetchMotivosAfastamento, lancarAfastamento,
  type Justificativa, type AprovacaoPendente, type MotivoAfastamento,
} from "../../core/ponto/solidesPontoClient";
import {
  analisarPonto, CAT_LABEL, ROTULOS, type Categoria, type Ocorrencia,
  type PontoColaborador, type PontoMarcacao, type ResultadoAnalise, type Severidade,
  type TipoOcorrencia, type SaldoColaborador,
} from "../../core/ponto/analise";

import { EscalasComparacaoTab } from "./EscalasComparacaoTab";
import { FechamentoTab } from "./FechamentoTab";

const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");

const pad = (n: number) => String(n).padStart(2, "0");
const fmtYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Converte qualquer YYYY-MM-DD (inclusive dentro de "X a Y") → DD/MM/YYYY.
const fmtBR = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");

// Identidade estável de uma ocorrência (pra casar com solicitações / avaliações).
const ocKey = (o: Ocorrencia) => `${o.employeeId}|${o.data}|${o.tipo}`;

// adjustmentReason/justification dos punches às vezes vêm como OBJETO
// ({id, description, ...}), não string. Extrai um texto seguro pra não renderizar
// objeto (React error #31).
function textoOuDesc(x: unknown): string | undefined {
  if (x == null) return undefined;
  if (typeof x === "string") return x || undefined;
  if (typeof x === "object") {
    const o = x as { description?: string; descricao?: string; name?: string };
    return o.description || o.descricao || o.name || undefined;
  }
  return String(x);
}

// Pendências de aprovação = ajustes do empregado (editado/com motivo) aguardando
// aval. NÃO depende de período — se está PENDING, aparece.
function derivarAprovacoes(punches: SolidesPunch[]): AprovacaoPendente[] {
  return punches
    .filter((p) => {
      if (String(p.status || "").toUpperCase() !== "PENDING") return false;
      return p.adjustmentReason != null || p.edited === true;
    })
    .map((p) => ({
      punchId: p.id,
      employeeId: p.employeeId,
      employeeName: p.employeeName || p.employee?.name || "?",
      date: p.date || "",
      dateIn: typeof p.dateIn === "number" ? p.dateIn : undefined,
      dateOut: typeof p.dateOut === "number" && p.dateOut > p.dateIn ? p.dateOut : undefined,
      status: "PENDING",
      motivo: textoOuDesc(p.adjustmentReason),
      observation: textoOuDesc(p.justification),
      editIn: (p as { editedIn?: boolean }).editedIn === true,
      editOut: (p as { editedOut?: boolean }).editedOut === true,
    }));
}

const SEV_COR: Record<Severidade, string> = {
  alta: "bg-red-500",
  media: "bg-amber-500",
  baixa: "bg-gray-400",
};

// ─── Persistência (Firestore) ───────────────────────────────────────────────
type SolItem = { key: string; tipo: TipoOcorrencia; data: string; rotulo: string };
type Solicitacao = {
  id: string;
  restaurantId: string;
  employeeId: number;
  colaborador: string;
  itens: SolItem[];
  enviadoEm: string;   // ISO
  prazoHoras: number;
  prazoEm: string;     // ISO
  por: { id: string; nome: string };
  status: string;      // "enviado"
};
type Avaliacao = {
  id: string;
  restaurantId: string;
  key: string;
  employeeId: number;
  colaborador: string;
  tipo: TipoOcorrencia;
  data: string;
  obs?: string;
  por: { id: string; nome: string };
  em: string;
};

// ─── Helpers de mensagem / relógio ──────────────────────────────────────────
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtHoraMs(ms?: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDataMs(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function montarMensagem(colaborador: string, itens: Ocorrencia[], prazoEm: string): string {
  const primeiro = (colaborador || "").trim().split(/\s+/)[0] || colaborador;
  const linhas = itens.map((o) => `• ${fmtBR(o.data)} — ${ROTULOS[o.tipo]}`).join("\n");
  return (
    `Olá ${primeiro}, tudo bem?\n\n` +
    `Identificamos pendências no seu registro de ponto que precisam de ajuste no aplicativo da Sólides:\n\n` +
    `${linhas}\n\n` +
    `Por favor, faça os ajustes até ${fmtDataHora(prazoEm)}. Depois disso eles passam pela nossa revisão e aprovação. ` +
    `Qualquer dúvida, é só falar com a gente. Obrigado! 🙏`
  );
}
function waLink(tel: string, msg: string): string {
  const d = soDigitos(tel);
  const num = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}
function relogio(prazoEm: string, now: number): { txt: string; vencido: boolean } {
  const diff = new Date(prazoEm).getTime() - now;
  const vencido = diff < 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const dur = h > 0 ? `${h}h${pad(m)}` : `${m}min`;
  return { txt: vencido ? `venceu há ${dur}` : `faltam ${dur}`, vencido };
}

function agrupar(itens: Ocorrencia[]): Array<{ employeeId: number; colaborador: string; itens: Ocorrencia[] }> {
  const m = new Map<number, { employeeId: number; colaborador: string; itens: Ocorrencia[] }>();
  for (const o of itens) {
    let g = m.get(o.employeeId);
    if (!g) { g = { employeeId: o.employeeId, colaborador: o.colaborador, itens: [] }; m.set(o.employeeId, g); }
    g.itens.push(o);
  }
  // Dentro de cada empregado: ordem cronológica (o sort global do motor é por
  // nome, que separa FALTA dos demais por variação do texto do nome).
  for (const g of m.values()) g.itens.sort((a, b) => a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo));
  return [...m.values()].sort((a, b) => a.colaborador.localeCompare(b.colaborador));
}

// Error boundary local: se algo quebrar, mostra a mensagem na tela em vez de
// sumir o site inteiro (e me dá o texto do erro pra corrigir).
class PontoErrorBoundary extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  render() {
    if (this.state.erro) {
      return (
        <div className="m-4 p-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-sm">
          <div className="font-bold mb-1">⚠️ A Análise de Ponto quebrou nesta tela.</div>
          <div className="font-mono text-xs whitespace-pre-wrap break-all">{this.state.erro.message}</div>
          <div className="font-mono text-[10px] mt-2 whitespace-pre-wrap break-all opacity-70">{this.state.erro.stack?.slice(0, 800)}</div>
          <button type="button" onClick={() => this.setState({ erro: null })}
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white">Tentar de novo</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AnalisePontoPage() {
  return (
    <PontoErrorBoundary>
      <AnalisePontoInner />
    </PontoErrorBoundary>
  );
}

function AnalisePontoInner() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("analise-ponto", "ver");
  const podeSolicitar = can("analise-ponto", "solicitar");
  const podeAprovar = can("analise-ponto", "aprovar");
  const podeCorrigir = can("analise-ponto", "corrigir");
  const podeAfastar = can("analise-ponto", "afastamentos");
  const podeFechar = can("analise-ponto", "fecharFolha");

  const hoje = new Date();
  // Default: 1º dia do mês corrente → ontem.
  const [inicio, setInicio] = useState(fmtYmd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [fim, setFim] = useState(fmtYmd(new Date(hoje.getTime() - 86400000)));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoAnalise | null>(null);
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [batidasDia, setBatidasDia] = useState<{ employeeId: number; colaborador: string; data: string } | null>(null);
  // Afastamento/férias: null = fechado; objeto (mesmo vazio) = aberto, com prefill opcional.
  const [afastamento, setAfastamento] = useState<{ employeeId?: number; colaborador?: string; data?: string } | null>(null);
  // Prazo de correção (horas) — configurável, padrão 6h. Persiste no navegador.
  const [prazoHoras, setPrazoHoras] = useState<number>(() => {
    const v = Number(localStorage.getItem("analisePonto.prazoHoras"));
    return Number.isFinite(v) && v > 0 ? v : 6;
  });
  useEffect(() => { localStorage.setItem("analisePonto.prazoHoras", String(prazoHoras)); }, [prazoHoras]);
  // Seleção de apontamentos (por ocKey) pra montar a mensagem única.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (k: string) => setSel((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  // Filtro por área: conjunto vazio = TODAS. "sem" = não vinculado no app.
  const [filtroAreas, setFiltroAreas] = useState<Set<Area | "sem">>(new Set());
  const toggleArea = (a: Area | "sem") => setFiltroAreas((cur) => {
    const next = new Set(cur);
    if (next.has(a)) next.delete(a); else next.add(a);
    return next;
  });
  const [mostrarAvaliados, setMostrarAvaliados] = useState(false);
  const [mostrarSaldos, setMostrarSaldos] = useState(false);
  const [editObs, setEditObs] = useState<{ id: string; text: string } | null>(null);
  const [aprovacoes, setAprovacoes] = useState<AprovacaoPendente[]>([]);
  const [selAprov, setSelAprov] = useState<Set<number>>(new Set());
  const [decidindo, setDecidindo] = useState<number | null>(null); // punchId em decisão
  const [decidindoLote, setDecidindoLote] = useState(false);
  const [searchParams] = useSearchParams();
  const tabInicial = searchParams.get("tab");
  const [tab, setTab] = useState<"inconsist" | "fechamento" | "escalas">(
    tabInicial === "fechamento" || tabInicial === "escalas" ? tabInicial : "inconsist",
  );

  // Relógio: re-render a cada minuto pra atualizar os countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Empregados + cargos + pessoas do app → ponte pra área + WhatsApp (Sólides id ↔ CPF).
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)));
    const u2 = onSnapshot(collection(db, "cargos"),
      (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)));
    const u3 = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (s) => setPessoas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa)));
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  // Solicitações enviadas + avaliações (ciente) — estado persistido.
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "pontoSolicitacoes"), where("restaurantId", "==", rid)),
      (s) => setSolicitacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Solicitacao)));
    const u2 = onSnapshot(query(collection(db, "pontoAvaliacoes"), where("restaurantId", "==", rid)),
      (s) => setAvaliacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Avaliacao)));
    return () => { u1(); u2(); };
  }, [rid]);

  // Mapa: employeeId da Sólides → { área, telefone }. Ponte por CPF
  // (roster Sólides → empregado do app → cargo.area / empregado.telefone).
  const dadosPorEmpId = useMemo(() => {
    const cargoArea = new Map<string, Area>();
    for (const c of cargos) cargoArea.set(c.id, c.area);
    const empPorCpf = new Map<string, Empregado>();
    for (const e of empregados) {
      const cpf = soDigitos(e.cpf);
      if (cpf) empPorCpf.set(cpf, e);
    }
    // WhatsApp vem do cadastro da Pessoa (campo whatsapp), casado por CPF.
    const whatsPorCpf = new Map<string, string>();
    for (const p of pessoas) {
      const cpf = soDigitos(p.cpf);
      if (cpf && p.whatsapp) whatsPorCpf.set(cpf, soDigitos(p.whatsapp));
    }
    const m = new Map<number, { area?: Area; tel: string }>();
    for (const r of roster) {
      if (typeof r.id !== "number") continue;
      const cpf = soDigitos(r.cpf);
      const e = empPorCpf.get(cpf);
      // Prioriza WhatsApp da Pessoa; fallback no telefone do empregado.
      const tel = whatsPorCpf.get(cpf) || soDigitos(e?.telefone);
      if (!e && !tel) continue;
      m.set(r.id, { area: e ? cargoArea.get(e.cargoId) : undefined, tel });
    }
    return m;
  }, [empregados, cargos, pessoas, roster]);
  const areaPorEmpId = (id: number): Area | undefined => dadosPorEmpId.get(id)?.area;
  const telPorEmpId = (id: number): string => dadosPorEmpId.get(id)?.tel || "";

  // Solicitação ativa por ocKey (mais recente) e por empregado (prazo mais urgente).
  const solPorKey = useMemo(() => {
    const m = new Map<string, Solicitacao>();
    for (const s of solicitacoes) {
      for (const it of s.itens || []) {
        const prev = m.get(it.key);
        if (!prev || new Date(s.enviadoEm) > new Date(prev.enviadoEm)) m.set(it.key, s);
      }
    }
    return m;
  }, [solicitacoes]);

  const cienteKeys = useMemo(() => new Set(avaliacoes.map((a) => a.key)), [avaliacoes]);

  async function analisar(ini: string = inicio, fimArg: string = fim) {
    if (!activeRestaurant) return;
    const shortCode = activeRestaurant.shortCode || "";
    if (!shortCode) { setErro("Restaurante sem shortCode configurado."); return; }
    setErro("");
    setCarregando(true);
    setResultado(null);
    try {
      // Roster pode vir vazio em algumas contas → FALTA simplesmente não aponta;
      // não derruba o resto. Por isso o catch dele é tolerante.
      // Busca até HOJE (o fim padrão pode ser ontem) pra o banner de aprovações
      // não esconder uma pendência de hoje; a análise fica limitada a [ini, fim].
      const hojeStr = fmtYmd(hoje);
      const fimFetch = fimArg < hojeStr ? hojeStr : fimArg;
      const [{ punches }, schedules, employees] = await Promise.all([
        fetchPunches(ini, fimFetch, shortCode),
        fetchScheduleCatalog(shortCode),
        fetchRoster(shortCode).catch(() => []),
      ]);
      setRoster(employees);
      const punchesAnalise = punches.filter((p) => p.date >= ini && p.date <= fimArg);
      const res = analisarPonto(
        punchesAnalise as unknown as PontoMarcacao[], employees, schedules, ini, fimArg,
      );
      setResultado(res);
      if (podeAprovar) setAprovacoes(derivarAprovacoes(punches));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar.");
    } finally {
      setCarregando(false);
    }
  }

  // Auto-analisa ao abrir (e ao trocar de restaurante) — atualiza com os dados
  // atuais, sem tela vazia. Roda 1× por restaurante quando permissão e dados
  // estão prontos. Mudança manual de data NÃO dispara (aí é o botão Analisar).
  const autoRef = useRef<string>("");
  useEffect(() => {
    if (permLoading || !podeVer || !activeRestaurant) return;
    if (autoRef.current === rid) return;
    autoRef.current = rid;
    void analisar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, permLoading, podeVer, activeRestaurant]);

  // ─── Ações ────────────────────────────────────────────────────────────────
  function enviarCorrecao(colaborador: string, employeeId: number, itens: Ocorrencia[]) {
    const tel = telPorEmpId(employeeId);
    if (!tel || itens.length === 0) return;
    const prazoEm = new Date(Date.now() + prazoHoras * 3_600_000).toISOString();
    const msg = montarMensagem(colaborador, itens, prazoEm);
    // Abre o WhatsApp NA HORA do clique (evita bloqueio de popup).
    window.open(waLink(tel, msg), "_blank");
    const solItens: SolItem[] = itens.map((o) => ({ key: ocKey(o), tipo: o.tipo, data: o.data, rotulo: ROTULOS[o.tipo] }));
    void addDoc(collection(db, "pontoSolicitacoes"), {
      restaurantId: rid, employeeId, colaborador,
      itens: solItens,
      enviadoEm: new Date().toISOString(),
      prazoHoras, prazoEm,
      por: { id: me?.id || "", nome: me?.nome || "?" },
      status: "enviado",
    }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar a solicitação."));
    // Limpa a seleção dos itens enviados.
    setSel((cur) => {
      const next = new Set(cur);
      itens.forEach((o) => next.delete(ocKey(o)));
      return next;
    });
  }

  // Ciência em lote (sem caixa) — mesma lógica do envio: seleciona e dá ciência
  // de uma vez. Observação é opcional, adicionada depois na seção "Avaliados".
  function darCiencia(itens: Ocorrencia[]) {
    if (itens.length === 0) return;
    const por = { id: me?.id || "", nome: me?.nome || "?" };
    const em = new Date().toISOString();
    for (const o of itens) {
      void addDoc(collection(db, "pontoAvaliacoes"), {
        restaurantId: rid, key: ocKey(o),
        employeeId: o.employeeId, colaborador: o.colaborador,
        tipo: o.tipo, data: o.data, detalhe: o.detalhe, obs: "",
        por, em,
      }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar ciência."));
    }
    setSel((cur) => {
      const next = new Set(cur);
      itens.forEach((o) => next.delete(ocKey(o)));
      return next;
    });
  }

  async function salvarObs() {
    if (!editObs) return;
    const { id, text } = editObs;
    setEditObs(null);
    try { await updateDoc(doc(db, "pontoAvaliacoes", id), { obs: text.trim() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar observação."); }
  }

  async function reabrirAvaliacao(a: Avaliacao) {
    try { await deleteDoc(doc(db, "pontoAvaliacoes", a.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao reabrir."); }
  }

  // Aprova / reprova um ponto na Sólides; audita, remove da lista e reanalisa
  // (a inconsistência some quando o ajuste aprovado entra na base).
  async function decidir(p: AprovacaoPendente, status: "APPROVED" | "REPROVED") {
    setErro("");
    setDecidindo(p.punchId);
    try {
      await decidirAprovacao(activeRestaurant?.shortCode || "", { punchId: p.punchId, status });
      try {
        await addDoc(collection(db, "pontoAuditoria"), {
          restaurantId: rid, tipo: "aprovacao", status,
          por: { id: me?.id || "", nome: me?.nome || "?" },
          punchId: p.punchId, employeeId: p.employeeId, colaborador: p.employeeName,
          em: new Date().toISOString(),
        });
      } catch { /* auditoria não bloqueia */ }
      setAprovacoes((prev) => prev.filter((x) => x.punchId !== p.punchId));
      void analisar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao decidir o ponto.");
    } finally {
      setDecidindo(null);
    }
  }

  const toggleSelAprov = (id: number) => setSelAprov((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Aprova/reprova vários de uma vez (sequencial p/ não estourar a API).
  async function decidirLote(itens: AprovacaoPendente[], status: "APPROVED" | "REPROVED") {
    if (itens.length === 0 || decidindoLote) return;
    const verbo = status === "APPROVED" ? "Aprovar" : "Reprovar";
    if (!window.confirm(`${verbo} ${itens.length} ajuste(s) de uma vez?\n\nGrava na Sólides (dado trabalhista).`)) return;
    setErro("");
    setDecidindoLote(true);
    const sc = activeRestaurant?.shortCode || "";
    let falhas = 0;
    for (const p of itens) {
      try {
        await decidirAprovacao(sc, { punchId: p.punchId, status });
        try {
          await addDoc(collection(db, "pontoAuditoria"), {
            restaurantId: rid, tipo: "aprovacao", status,
            por: { id: me?.id || "", nome: me?.nome || "?" },
            punchId: p.punchId, employeeId: p.employeeId, colaborador: p.employeeName,
            em: new Date().toISOString(),
          });
        } catch { /* auditoria não bloqueia */ }
      } catch { falhas += 1; }
    }
    setSelAprov(new Set());
    setDecidindoLote(false);
    if (falhas > 0) setErro(`${falhas} de ${itens.length} não puderam ser ${status === "APPROVED" ? "aprovados" : "reprovados"}.`);
    void analisar();
  }

  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (permLoading) return <div className="text-gray-400 py-12 text-center text-sm">Carregando permissões…</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const tabsDisp = ([
    { id: "inconsist", label: "⚠️ Inconsistências" },
    podeFechar ? { id: "fechamento", label: "📄 Fechamento de ponto" } : null,
    { id: "escalas", label: "🗓️ Escalas (Sólides × planejamento.app)" },
  ].filter(Boolean)) as Array<{ id: typeof tab; label: ReactNode }>;

  return (
    <div className="max-w-5xl space-y-4">
      {/* Abas */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {tabsDisp.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "escalas" && <EscalasComparacaoTab rid={rid} activeRestaurant={activeRestaurant} />}

      {tab === "fechamento" && (
        <FechamentoTab rid={rid} activeRestaurant={activeRestaurant} empregados={empregados} cargos={cargos} mesInicial={inicio.slice(0, 7)}
          por={{ id: me?.id || "", nome: me?.nome || "?" }} />
      )}

      {tab === "inconsist" && <>
      {/* Filtros */}
      <div className="bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900 border border-indigo-100 dark:border-indigo-900/40 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Início</label>
            <input type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Fim</label>
            <input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          {tab === "inconsist" && (
            <div className="flex flex-col gap-1 shrink-0">
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Prazo p/ correção</label>
              <div className="h-9 inline-flex items-center gap-1.5">
                <input type="number" min={1} max={168} value={prazoHoras}
                  onChange={(e) => setPrazoHoras(Math.max(1, Number(e.target.value) || 6))}
                  className="h-9 w-16 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
                <span className="text-xs text-gray-500">horas</span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1 min-w-0 flex-1 basis-full sm:basis-auto">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Área</label>
            <div className="flex items-center gap-1.5 h-9 overflow-x-auto">
              <Chip ativo={filtroAreas.size === 0} onClick={() => setFiltroAreas(new Set())}>Todas</Chip>
              {AREAS.map((a) => (
                <Chip key={a} ativo={filtroAreas.has(a)} onClick={() => toggleArea(a)}>{a}</Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto md:ml-auto justify-between">
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {activeRestaurant.nome} · {activeRestaurant.shortCode}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {podeAfastar && (
                <button type="button" onClick={() => setAfastamento({})}
                  className="h-9 px-3 text-sm font-semibold rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 inline-flex items-center gap-1.5 whitespace-nowrap">
                  🏖️ Afastamento/férias
                </button>
              )}
              <button type="button" onClick={() => void analisar()} disabled={carregando}
                className="h-9 px-5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200 dark:shadow-none disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap">
                {carregando ? "Analisando…" : <>🔍 Analisar período</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {erro && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>
      )}

      {tab === "inconsist" && resultado && (() => {
        const passaArea = (o: Ocorrencia) => {
          if (filtroAreas.size === 0) return true; // TODAS
          const a = areaPorEmpId(o.employeeId);
          if (!a) return filtroAreas.has("sem");
          return filtroAreas.has(a);
        };
        const filtradas = resultado.ocorrencias.filter(passaArea);

        // pendentes (tira os marcados "ciente") agrupados por empregado.
        const pendentes = filtradas.filter((o) => !cienteKeys.has(ocKey(o)));
        const saldoPorEmp = new Map<number, SaldoColaborador>();
        for (const s of resultado.saldos || []) saldoPorEmp.set(s.employeeId, s);
        const passaEmp = (eid: number) => {
          if (filtroAreas.size === 0) return true;
          const a = areaPorEmpId(eid);
          return a ? filtroAreas.has(a) : filtroAreas.has("sem");
        };
        const saldosVisiveis = (resultado.saldos || []).filter((s) => passaEmp(s.employeeId));
        const avaliadosVisiveis = avaliacoes.filter((a) =>
          filtroAreas.size === 0 ? true : (() => {
            const ar = areaPorEmpId(a.employeeId);
            return ar ? filtroAreas.has(ar) : filtroAreas.has("sem");
          })(),
        );
        const nCorrigir = pendentes.filter((o) => o.categoria === "CORRIGIR").length;
        const nAvaliar = pendentes.filter((o) => o.categoria === "AVALIAR").length;
        // Banner de aprovações (mesma tela): pendências do período filtradas por área.
        const aprovVisiveis = aprovacoes.filter((p) => passaEmp(p.employeeId));
        const selAprovVis = aprovVisiveis.filter((p) => selAprov.has(p.punchId));
        const todosAprovSel = aprovVisiveis.length > 0 && selAprovVis.length === aprovVisiveis.length;
        const toggleTodosAprov = () => setSelAprov(() => todosAprovSel ? new Set() : new Set(aprovVisiveis.map((p) => p.punchId)));

        return (
        <>
          {podeAprovar && aprovVisiveis.length > 0 && (
            <section className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-xl overflow-hidden">
              <header className="px-4 py-2.5 border-b border-blue-100 dark:border-blue-900/50">
                <div className="font-bold text-sm text-blue-900 dark:text-blue-200">⏳ Aprovações pendentes ({aprovVisiveis.length})</div>
                <p className="text-[11px] text-blue-700/80 dark:text-blue-300/70 mt-0.5">
                  O empregado ajustou no app de ponto dele e aguarda sua aprovação. Ao aprovar, o ajuste entra na base e a inconsistência some.
                </p>
              </header>
              <div className="px-4 py-2 border-b border-blue-100 dark:border-blue-900/50 flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={todosAprovSel} onChange={toggleTodosAprov} className="w-4 h-4 accent-indigo-600" />
                  Selecionar todos
                </label>
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button" disabled={selAprovVis.length === 0 || decidindoLote} onClick={() => void decidirLote(selAprovVis, "APPROVED")}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                    {decidindoLote ? "Processando…" : `✓ Aprovar${selAprovVis.length ? ` (${selAprovVis.length})` : ""}`}
                  </button>
                  <button type="button" disabled={selAprovVis.length === 0 || decidindoLote} onClick={() => void decidirLote(selAprovVis, "REPROVED")}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed">
                    ✗ Reprovar{selAprovVis.length ? ` (${selAprovVis.length})` : ""}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-blue-100 dark:divide-blue-900/40">
                {aprovVisiveis.map((p) => {
                  const area = areaPorEmpId(p.employeeId);
                  const dataTxt = p.date ? fmtBR(p.date) : fmtDataMs(p.dateIn);
                  return (
                    <div key={p.punchId} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <input type="checkbox" checked={selAprov.has(p.punchId)} onChange={() => toggleSelAprov(p.punchId)}
                          className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">
                            <span className="font-semibold text-gray-900 dark:text-gray-100">{p.employeeName}</span>
                            {area && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{area}</span>}
                          </div>
                          <div className="text-xs text-gray-500 tabular-nums">
                            {dataTxt} ·{" "}
                            <span className={p.editIn ? "text-red-600 dark:text-red-400 font-bold" : ""}>{fmtHoraMs(p.dateIn)}</span>
                            –
                            <span className={p.editOut ? "text-red-600 dark:text-red-400 font-bold" : ""}>{fmtHoraMs(p.dateOut)}</span>
                            {(p.editIn || p.editOut) && (
                              <span className="ml-1.5 text-[10px] text-red-600 dark:text-red-400">
                                ajustou {p.editIn && p.editOut ? "entrada e saída" : p.editIn ? "a entrada" : "a saída"}
                              </span>
                            )}
                          </div>
                          {p.motivo && <div className="text-xs text-indigo-700 dark:text-indigo-300">{p.motivo}</div>}
                          {p.observation && <div className="text-xs text-gray-500 italic">"{p.observation}"</div>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                        <button type="button" disabled={decidindo === p.punchId} onClick={() => void decidir(p, "APPROVED")}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">
                          ✓ Aprovar
                        </button>
                        <button type="button" disabled={decidindo === p.punchId} onClick={() => void decidir(p, "REPROVED")}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40">
                          ✗ Reprovar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Cartao titulo="A Corrigir" valor={nCorrigir} cor="text-red-600" />
            <Cartao titulo="A Avaliar" valor={nAvaliar} cor="text-amber-600" />
            <Cartao titulo="Total pendente" valor={pendentes.length} cor="text-gray-700 dark:text-gray-200" />
          </div>

          {(["CORRIGIR", "AVALIAR"] as Categoria[]).map((cat) => {
            const grupos = agrupar(pendentes.filter((o) => o.categoria === cat));
            const totalCat = grupos.reduce((s, g) => s + g.itens.length, 0);
            return (
              <section key={cat} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-900 dark:text-gray-100">
                  {cat === "CORRIGIR" ? "🔧" : "👀"} {CAT_LABEL[cat]} ({totalCat})
                </header>
                {grupos.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">Nada nesta categoria 🎉</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {grupos.map((g) => (
                      <GrupoEmp key={g.employeeId} grupo={g}
                        area={areaPorEmpId(g.employeeId)} tel={telPorEmpId(g.employeeId)}
                        saldo={saldoPorEmp.get(g.employeeId)}
                        sel={sel} toggleSel={toggleSel} solPorKey={solPorKey} now={now}
                        podeSolicitar={podeSolicitar} podeCorrigir={podeCorrigir} podeAfastar={podeAfastar}
                        onEnviar={(itens) => enviarCorrecao(g.colaborador, g.employeeId, itens)}
                        onCiencia={darCiencia}
                        onCorrigir={(o) => setBatidasDia({ employeeId: o.employeeId, colaborador: o.colaborador, data: o.data })}
                        onAfastar={(o) => setAfastamento({ employeeId: o.employeeId, colaborador: o.colaborador, data: o.data })} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {/* Avaliados (ciente / sem ação) */}
          {avaliadosVisiveis.length > 0 && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <button type="button" onClick={() => setMostrarAvaliados((v) => !v)}
                className="w-full px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                <span>✅ Avaliados — ciente / sem ação ({avaliadosVisiveis.length})</span>
                <span className="text-gray-400">{mostrarAvaliados ? "▲" : "▼"}</span>
              </button>
              {mostrarAvaliados && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {avaliadosVisiveis.map((a) => (
                    <div key={a.id} className="px-4 py-2 flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ ciente</span>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{a.colaborador}</span>
                        <span className="text-gray-400"> · {fmtBR(a.data)} · {ROTULOS[a.tipo]}</span>
                        {editObs?.id === a.id ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <input autoFocus type="text" value={editObs.text}
                              onChange={(e) => setEditObs({ id: a.id, text: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") void salvarObs(); if (e.key === "Escape") setEditObs(null); }}
                              placeholder="Observação (opcional)…"
                              className="flex-1 px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
                            <button type="button" onClick={() => void salvarObs()}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white">Salvar</button>
                            <button type="button" onClick={() => setEditObs(null)}
                              className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:text-gray-800">Cancelar</button>
                          </div>
                        ) : (
                          a.obs && <div className="text-xs text-gray-500 italic">"{a.obs}"</div>
                        )}
                        <div className="text-[11px] text-gray-400">por {a.por?.nome} · {fmtDataHora(a.em)}</div>
                      </div>
                      {podeSolicitar && editObs?.id !== a.id && (
                        <div className="shrink-0 flex items-center gap-1.5">
                          <button type="button" onClick={() => setEditObs({ id: a.id, text: a.obs || "" })}
                            className="text-[11px] font-medium px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400">
                            {a.obs ? "✏️ observação" : "+ observação"}
                          </button>
                          <button type="button" onClick={() => void reabrirAvaliacao(a)}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                            ↩︎ Reabrir
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Saldo de horas do período — todos os empregados (status, não apontamento) */}
          {saldosVisiveis.length > 0 && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <button type="button" onClick={() => setMostrarSaldos((v) => !v)}
                className="w-full px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                <span>📊 Saldo de horas do período — todos ({saldosVisiveis.length})</span>
                <span className="text-gray-400">{mostrarSaldos ? "▲" : "▼"}</span>
              </button>
              {mostrarSaldos && (
                <div className="p-3 flex flex-wrap gap-2">
                  {saldosVisiveis.map((s) => (
                    <span key={s.employeeId} title={s.detalhe}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                      {s.colaborador} <SaldoBadge saldo={s} />
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          <p className="text-[11px] text-gray-400">
            O saldo de horas vira o badge ao lado do nome (+ vermelho acima · 0 verde · − âmbar abaixo do previsto); passe o mouse pra ver o detalhe.
            O empregado corrige no app de ponto dele; depois você aprova (aba Aprovações).
            Correção manual só em exceção, na aba 🛠️{podeCorrigir ? "" : " (sem permissão)"}.
            FALTA depende do roster da Sólides (se a conta não retornar colaboradores, não aparece).
          </p>
        </>
        );
      })()}

      {tab === "inconsist" && !resultado && !carregando && !erro && (
        <div className="text-center text-sm text-gray-400 py-12">
          Escolha o período e clique em <strong>Analisar</strong>.
        </div>
      )}

      {batidasDia && activeRestaurant && (
        <BatidasDiaModal
          info={batidasDia}
          shortCode={activeRestaurant.shortCode || ""}
          restaurantId={rid}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          onClose={() => setBatidasDia(null)}
          onChanged={() => void analisar()}
        />
      )}

      {afastamento && activeRestaurant && (
        <AfastamentoModal
          prefill={afastamento}
          roster={roster}
          shortCode={activeRestaurant.shortCode || ""}
          restaurantId={rid}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          onClose={() => setAfastamento(null)}
          onDone={() => { setAfastamento(null); void analisar(); }}
        />
      )}
      </>}
    </div>
  );
}

// ─── Modal "Lançar afastamento / férias" ────────────────────────────────────
function AfastamentoModal({
  prefill, roster, shortCode, restaurantId, por, onClose, onDone,
}: {
  prefill: { employeeId?: number; colaborador?: string; data?: string };
  roster: PontoColaborador[];
  shortCode: string;
  restaurantId: string;
  por: { id: string; nome: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivos, setMotivos] = useState<MotivoAfastamento[]>([]);
  const [empId, setEmpId] = useState<number | "">(prefill.employeeId ?? "");
  const [motivoId, setMotivoId] = useState<number | "">("");
  const [inicio, setInicio] = useState(prefill.data || "");
  const [fim, setFim] = useState(prefill.data || "");
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetchMotivosAfastamento(shortCode)
      .then((ms) => { if (vivo) setMotivos(ms); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Falha ao carregar motivos."); });
    return () => { vivo = false; };
  }, [shortCode]);

  // Ao escolher o motivo, se ele for "dia inteiro" obrigatório, marca o checkbox.
  function escolherMotivo(id: number) {
    setMotivoId(id);
    const m = motivos.find((x) => x.id === id);
    if (m?.fullDay) setDiaInteiro(true);
  }

  const empNome = (id: number) => roster.find((r) => r.id === id)?.name || prefill.colaborador || "?";

  async function confirmar() {
    if (!empId) { setErro("Escolha o colaborador."); return; }
    if (!motivoId) { setErro("Escolha o motivo."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) { setErro("Informe o período (início e fim)."); return; }
    if (inicio > fim) { setErro("O início não pode ser depois do fim."); return; }
    const motivo = motivos.find((m) => m.id === motivoId);
    if (!window.confirm(`Lançar ${motivo?.description || "afastamento"} para ${empNome(Number(empId))}\nde ${fmtBR(inicio)} a ${fmtBR(fim)}?\n\nGrava na Sólides como APROVADO.`)) return;
    setErro(""); setSalvando(true);
    try {
      await lancarAfastamento(shortCode, {
        employeeId: Number(empId), adjustmentReasonId: Number(motivoId),
        startDate: inicio, endDate: fim, fullDay: diaInteiro,
      });
      try {
        await addDoc(collection(db, "pontoAuditoria"), {
          restaurantId, tipo: "afastamento",
          por: { id: por.id, nome: por.nome },
          employeeId: Number(empId), colaborador: empNome(Number(empId)),
          motivoId: Number(motivoId), motivo: motivo?.description || "",
          inicio, fim, diaInteiro, em: new Date().toISOString(),
        });
      } catch { /* auditoria não bloqueia */ }
      alert(`Afastamento lançado na Sólides ✓ (${motivo?.description || ""}, ${fmtBR(inicio)}–${fmtBR(fim)}). Reanalisando…`);
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lançar o afastamento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title="🏖️ Lançar afastamento / férias" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          O período inteiro é lançado de uma vez (a justificativa vale pra todos os dias). Entra como <strong>aprovado</strong> na Sólides.
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Colaborador</label>
          {prefill.employeeId ? (
            <div className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200">{prefill.colaborador}</div>
          ) : (
            <select value={empId} onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : "")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              <option value="">— escolha —</option>
              {[...roster].filter((r) => typeof r.id === "number" && !r.fired).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo</label>
          <select value={motivoId} onChange={(e) => escolherMotivo(Number(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            <option value="">{motivos.length ? "— escolha —" : "— carregando —"}</option>
            {motivos.map((m) => <option key={m.id} value={m.id}>{m.description}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Início</label>
            <input type="date" value={inicio} max={fim || undefined} onChange={(e) => setInicio(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fim</label>
            <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Dia inteiro
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={salvando}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">Cancelar</button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
            {salvando ? "Lançando…" : "Lançar afastamento"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Badge do saldo de horas: + (acima) vermelho · 0 verde · − (abaixo) âmbar.
function SaldoBadge({ saldo }: { saldo: SaldoColaborador }) {
  const s = saldo.saldoSeg;
  const abs = Math.abs(s);
  const hh = Math.floor(abs / 3600);
  const mm = Math.floor((abs % 3600) / 60);
  const val = s === 0 ? "0" : `${s > 0 ? "+" : "−"}${pad(hh)}:${pad(mm)}`;
  const cls = s > 0
    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    : s < 0
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  return (
    <span title={saldo.detalhe}
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums cursor-help ${cls}`}>
      {val}
    </span>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        ativo
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400"
      }`}>
      {children}
    </button>
  );
}

function Cartao({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{titulo}</div>
    </div>
  );
}

// ─── Grupo de um empregado: cabeçalho (nome + relógio + enviar) + itens ───────
function GrupoEmp({
  grupo, area, tel, saldo, sel, toggleSel, solPorKey, now, podeSolicitar, podeCorrigir, podeAfastar, onEnviar, onCiencia, onCorrigir, onAfastar,
}: {
  grupo: { employeeId: number; colaborador: string; itens: Ocorrencia[] };
  area?: Area;
  tel: string;
  saldo?: SaldoColaborador;
  sel: Set<string>;
  toggleSel: (k: string) => void;
  solPorKey: Map<string, Solicitacao>;
  now: number;
  podeSolicitar: boolean;
  podeCorrigir: boolean;
  podeAfastar: boolean;
  onEnviar: (itens: Ocorrencia[]) => void;
  onCiencia: (itens: Ocorrencia[]) => void;
  onCorrigir: (o: Ocorrencia) => void;
  onAfastar: (o: Ocorrencia) => void;
}) {
  const selecionados = grupo.itens.filter((o) => sel.has(ocKey(o)));
  // Relógio do empregado = solicitação ativa mais urgente entre os itens visíveis.
  const ativas = grupo.itens.map((o) => solPorKey.get(ocKey(o))).filter(Boolean) as Solicitacao[];
  const maisUrgente = ativas.length
    ? ativas.reduce((a, b) => (new Date(a.prazoEm) < new Date(b.prazoEm) ? a : b))
    : null;
  const rel = maisUrgente ? relogio(maisUrgente.prazoEm, now) : null;
  const semNumero = !tel;
  const todosSel = grupo.itens.every((o) => sel.has(ocKey(o)));
  const toggleTodos = () => grupo.itens.forEach((o) => {
    const k = ocKey(o);
    if (todosSel ? sel.has(k) : !sel.has(k)) toggleSel(k);
  });

  return (
    <div className="px-3 py-2.5">
      {/* Cabeçalho do empregado */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        {podeSolicitar && (
          <input type="checkbox" checked={todosSel} onChange={toggleTodos}
            className="w-4 h-4 accent-indigo-600 cursor-pointer" title="Selecionar todos" />
        )}
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{grupo.colaborador}</span>
        {saldo && <SaldoBadge saldo={saldo} />}
        {area && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{area}</span>}
        <span className="text-[11px] text-gray-400">({grupo.itens.length})</span>
        {rel && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
            rel.vencido ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            ⏱ {rel.txt}
          </span>
        )}
        {podeSolicitar && (
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" disabled={selecionados.length === 0}
              onClick={() => onCiencia(selecionados)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
              ✓ Dar ciência{selecionados.length > 0 ? ` (${selecionados.length})` : ""}
            </button>
            {semNumero ? (
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed" title="Empregado sem WhatsApp cadastrado no planejamento.app">
                sem número cadastrado
              </span>
            ) : (
              <button type="button" disabled={selecionados.length === 0}
                onClick={() => onEnviar(selecionados)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
                💬 Enviar p/ correção{selecionados.length > 0 ? ` (${selecionados.length})` : ""}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Itens do empregado */}
      <div className="space-y-1 pl-0.5">
        {grupo.itens.map((o, i) => {
          const k = ocKey(o);
          const sol = solPorKey.get(k);
          const enviado = !!sol;
          const rel = sol ? relogio(sol.prazoEm, now) : null;
          const pend = o.tipo === "AJUSTE_PENDENTE";
          // Cor da linha por status: azul=aguardando aprovação · vermelho=prazo
          // vencido · âmbar=enviado p/ correção · neutro=aberto.
          const rowCls = pend
            ? "bg-blue-50/70 dark:bg-blue-950/25"
            : rel?.vencido
              ? "bg-red-50/70 dark:bg-red-950/20"
              : enviado
                ? "bg-amber-50/70 dark:bg-amber-950/20"
                : "";
          const podeManual = podeCorrigir && !pend && o.employeeId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(o.data);
          return (
            <div key={i} className={`flex items-start gap-2.5 rounded-lg px-2 py-1 ${rowCls}`}>
              {podeSolicitar && (
                <input type="checkbox" checked={sel.has(k)} onChange={() => toggleSel(k)}
                  className="mt-1 w-4 h-4 accent-indigo-600 cursor-pointer shrink-0" />
              )}
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_COR[o.severidade]}`} title={o.severidade} />
              <div className="min-w-0 flex-1">
                <div className="text-xs">
                  <span className="text-gray-500">{fmtBR(o.data)}{o.diaSemana !== "período" ? ` (${o.diaSemana})` : ""}</span>
                  <span className="ml-1.5 text-indigo-700 dark:text-indigo-300 font-medium">{ROTULOS[o.tipo]}</span>
                  {pend && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">aguardando aprovação</span>}
                  {!pend && enviado && (
                    <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${rel?.vencido ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                      {rel?.vencido ? `⏱ venceu ${rel.txt}` : `enviado · ⏱ ${rel?.txt ?? ""}`}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">{o.detalhe}</div>
                {o.marcacoes.length > 0 && (
                  <div className="text-[11px] text-gray-400 tabular-nums">{o.marcacoes.join("  ·  ")}</div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {podeAfastar && o.tipo === "FALTA" && (
                  <button type="button" onClick={() => onAfastar(o)}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400"
                    title="Lançar afastamento (atestado/folga/férias…) neste dia">
                    🏖️
                  </button>
                )}
                {podeManual && (
                  <button type="button" onClick={() => onCorrigir(o)}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400"
                    title="Corrigir manual (batidas do dia)">
                    🛠️
                  </button>
                )}
                {podeSolicitar && (
                  <button type="button" onClick={() => onCiencia([o])}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400"
                    title="Ciente / sem ação">
                    ✓ ciente
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─── Modal "Batidas do dia": edita/exclui blocos direto na Sólides ──────────
function BatidasDiaModal({
  info, shortCode, restaurantId, por, onClose, onChanged,
}: {
  info: { employeeId: number; colaborador: string; data: string };
  shortCode: string;
  restaurantId: string;
  por: { id: string; nome: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [punches, setPunches] = useState<SolidesPunch[]>([]);
  const [edits, setEdits] = useState<Record<number, { in: string; out: string }>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [justId, setJustId] = useState<number | null>(null);
  const [novaHora, setNovaHora] = useState("");
  const [adicionando, setAdicionando] = useState(false);

  const msToInput = (ms?: number | null) => {
    if (!ms) return "";
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const inputToMs = (origMs: number, hhmm: string) => {
    const d = new Date(origMs);
    const [h, m] = hhmm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const temSaida = (p: SolidesPunch) => typeof p.dateOut === "number" && p.dateOut > p.dateIn;

  async function recarregar() {
    setCarregando(true);
    try {
      const r = await fetchPunches(info.data, info.data, shortCode);
      const blocos = r.punches
        .filter((p) => p.employeeId === info.employeeId && p.date === info.data)
        .sort((a, b) => a.dateIn - b.dateIn);
      setPunches(blocos);
      const e: Record<number, { in: string; out: string }> = {};
      for (const p of blocos) e[p.id] = { in: msToInput(p.dateIn), out: temSaida(p) ? msToInput(p.dateOut) : "" };
      setEdits(e);
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao carregar as batidas do dia.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shortCode, info.employeeId, info.data]);

  useEffect(() => {
    let vivo = true;
    fetchJustificativas(shortCode)
      .then((js) => { if (vivo) { setJusts(js); if (js[0]) setJustId(js[0].id); } })
      .catch(() => { /* sem justificativas → bloqueia o adicionar */ });
    return () => { vivo = false; };
  }, [shortCode]);

  async function audit(tipo: string, extra: Record<string, unknown>) {
    try {
      await addDoc(collection(db, "pontoAuditoria"), {
        restaurantId, tipo, por: { id: por.id, nome: por.nome },
        employeeId: info.employeeId, colaborador: info.colaborador, data: info.data,
        ...extra, em: new Date().toISOString(),
      });
    } catch { /* auditoria não bloqueia */ }
  }

  async function salvarBloco(p: SolidesPunch) {
    const e = edits[p.id]; if (!e) return;
    const curIn = msToInput(p.dateIn);
    const curOut = temSaida(p) ? msToInput(p.dateOut) : "";
    const mudouIn = /^\d{2}:\d{2}$/.test(e.in) && e.in !== curIn;
    const mudouOut = curOut && /^\d{2}:\d{2}$/.test(e.out) && e.out !== curOut;
    if (!mudouIn && !mudouOut) { setErro("Nenhuma alteração nessa batida."); return; }
    if (!window.confirm(`Editar batida de ${info.colaborador} em ${fmtBR(info.data)}?\n${mudouIn ? `Entrada ${curIn} → ${e.in}\n` : ""}${mudouOut ? `Saída ${curOut} → ${e.out}\n` : ""}\nGrava na Sólides (dado trabalhista).`)) return;
    setErro(""); setSalvando(p.id);
    try {
      if (mudouIn) {
        await editarBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, oldMs: p.dateIn, newMs: inputToMs(p.dateIn, e.in) });
        await audit("editar_batida", { punchId: p.id, campo: "entrada", de: curIn, para: e.in });
      }
      if (mudouOut) {
        await editarBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, oldMs: p.dateOut, newMs: inputToMs(p.dateOut, e.out) });
        await audit("editar_batida", { punchId: p.id, campo: "saida", de: curOut, para: e.out });
      }
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao editar a batida.");
    } finally {
      setSalvando(null);
    }
  }

  async function adicionarBatida() {
    if (!/^\d{2}:\d{2}$/.test(novaHora)) { setErro("Informe a hora da batida (HH:MM)."); return; }
    if (!justId) { setErro("Escolha uma justificativa."); return; }
    const dataHoraIso = `${info.data}T${novaHora}:00.000-0300`;
    if (!window.confirm(`Adicionar batida ${novaHora} para ${info.colaborador} em ${fmtBR(info.data)}?\n\nGrava na Sólides (a Sólides decide se é entrada ou saída e pareia).`)) return;
    setErro(""); setAdicionando(true);
    try {
      await corrigirPontoAtraso(shortCode, { employeeId: info.employeeId, dataHoraIso, justificativaId: justId });
      await audit("adicionar_batida", { hora: novaHora, justificativaId: justId });
      setNovaHora("");
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao adicionar a batida.");
    } finally {
      setAdicionando(false);
    }
  }

  async function excluirBloco(p: SolidesPunch) {
    if (!window.confirm(`Excluir a batida ${msToInput(p.dateIn)}${temSaida(p) ? `–${msToInput(p.dateOut)}` : ""} de ${info.colaborador} em ${fmtBR(info.data)}?\n\nRemove na Sólides (dado trabalhista).`)) return;
    setErro(""); setSalvando(p.id);
    try {
      await excluirBatida(shortCode, { employeeId: info.employeeId, punchId: p.id, dateIn: p.dateIn, dateOut: temSaida(p) ? p.dateOut : undefined });
      await audit("excluir_batida", { punchId: p.id, entrada: msToInput(p.dateIn), saida: temSaida(p) ? msToInput(p.dateOut) : "" });
      await recarregar();
      onChanged();
    } catch (ex) {
      setErro(ex instanceof Error ? ex.message : "Falha ao excluir a batida.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Modal title={`🛠️ Batidas do dia — ${info.colaborador}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {fmtBR(info.data)}. Edite a hora e clique em <strong>Salvar</strong>, ou <strong>Excluir</strong> o bloco. Grava direto na Sólides.
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}

        {carregando ? (
          <div className="py-6 text-center text-sm text-gray-400">Carregando batidas…</div>
        ) : punches.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">Nenhuma batida nesse dia. Use “Lançar ponto” pra adicionar.</div>
        ) : (
          <div className="space-y-2">
            {punches.map((p) => {
              const e = edits[p.id] || { in: "", out: "" };
              const busy = salvando === p.id;
              return (
                <div key={p.id} className="flex flex-wrap items-end gap-2 border border-gray-200 dark:border-gray-800 rounded-lg p-2.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500">Entrada</label>
                    <input type="time" value={e.in} disabled={busy}
                      onChange={(ev) => setEdits((c) => ({ ...c, [p.id]: { ...c[p.id], in: ev.target.value } }))}
                      className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500">Saída</label>
                    <input type="time" value={e.out} disabled={busy || !temSaida(p)}
                      onChange={(ev) => setEdits((c) => ({ ...c, [p.id]: { ...c[p.id], out: ev.target.value } }))}
                      className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]" />
                  </div>
                  {!temSaida(p) && <span className="text-[10px] text-amber-600 mb-2">em aberto</span>}
                  <div className="ml-auto flex items-center gap-1.5 mb-0.5">
                    <button type="button" disabled={busy} onClick={() => void salvarBloco(p)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
                      {busy ? "…" : "Salvar"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void excluirBloco(p)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Adicionar batida (lança ponto em atraso; a Sólides decide entrada/saída) */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">➕ Adicionar batida</div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">Hora</label>
              <input type="time" value={novaHora} disabled={adicionando} onChange={(ev) => setNovaHora(ev.target.value)}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-[10px] font-semibold text-gray-500">Justificativa</label>
              <select value={justId ?? ""} disabled={adicionando} onChange={(ev) => setJustId(Number(ev.target.value))}
                className="px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
                {justs.length === 0 && <option value="">— carregando —</option>}
                {justs.map((j) => <option key={j.id} value={j.id}>{j.description}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => void adicionarBatida()} disabled={adicionando}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              {adicionando ? "Adicionando…" : "Adicionar"}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">A Sólides decide se é entrada ou saída e pareia com as batidas existentes.</p>
        </div>
      </div>
    </Modal>
  );
}
