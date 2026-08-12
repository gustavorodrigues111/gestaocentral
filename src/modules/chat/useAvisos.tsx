// ════════════════════════════════════════════════════════════════════════════
//  useAvisos — cálculo central dos avisos da Central de Avisos (Chat)
//
//  Reúne TODAS as fontes de aviso derivadas das coleções dos módulos,
//  filtradas pela permissão `receberAvisos` de cada módulo (transversal a
//  todos os restaurantes do usuário). Exposto via contexto pra Sidebar (badge)
//  e ChatPage (feed) consumirem o MESMO resultado — badge sempre bate com a
//  lista, sem duplicar listeners.
//
//  Dois formatos de card:
//   • Por item (ação individual, baixo volume): escala, Fale com DP.
//   • Agregado (1 card por módulo/restaurante com contador): os demais —
//     evita inundar o feed quando há muitos itens pendentes.
// ════════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, onSnapshot, query, setDoc, where, orderBy, limit } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { canAcao, resolverPerfil } from "../../core/auth/permissions";
import { SETORES } from "../../core/wiki/setores";
import { useAvisoSource, type AvisoDoc } from "./useAvisoSource";
import type { AvisoDirecionado, FaleDpMensagem, Rotina, RotinaConclusao, WikiProcesso, FalhaLog, Prazo } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE, PRAZO_TIPO_LABEL } from "../../core/types";
import { noRadar, diasAte } from "../prazos/logic";
import { pendentesParaPessoa } from "../rotinas/repository";
import { recorrenciaLabel } from "../rotinas/rotinasEngine";
import { deepLinkRotina } from "../rotinas/subDestinos";
import { configTipoDoCard } from "../rotinas/avisosCatalogo";

export type Aviso = {
  id: string;
  tipo: string;
  icone: string;
  titulo: string;
  descricao: string;
  em: string;                 // ISO — ordenação
  restauranteId: string;
  restauranteNome: string;
  cta: string;
  href?: string;              // navegação
  faleDp?: FaleDpMensagem;    // payload do modal (avisos de Fale com DP)
  rotina?: { rotina: Rotina; ocorrenciaData: string; atrasada: boolean }; // rotina pendente
  categoria: string;          // rótulo do módulo — agrupa o Histórico
  categoriaIcone: string;     // ícone do módulo (não do item)
};

// API exposta pela Central de Avisos: caixa de entrada (não lidos), histórico
// (lidos), e ações de leitura. Estado de leitura é um overlay persistido por
// pessoa (avisos são derivados ao vivo — não têm doc próprio pra marcar).
export type AvisosApi = {
  todos: Aviso[];
  inbox: Aviso[];
  historico: Aviso[];
  marcarLido: (a: Aviso) => void;
  marcarNaoLido: (a: Aviso) => void;
  marcarTodosLidos: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  trabalho: "trabalho", folga: "folga", freela: "freela",
  comp: "folga por compensação", comp_trab: "trabalho por compensação",
  ferias: "férias", falta_j: "falta justificada", falta_i: "falta injustificada",
};
const statusLabel = (s?: unknown) => (s ? STATUS_LABEL[String(s)] || String(s) : "—");
const fmtDataCurta = (ymd?: unknown) => {
  if (!ymd) return "";
  const [a, m, d] = String(ymd).split("-");
  return d ? `${d}/${m}/${a}` : String(ymd);
};
function addDiasYmd(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ── Fechamento Financeiro: item do template + resolução do prazo por competência ──
type FechFinItem = { id: string; titulo: string; responsavelId?: string | null; prazoRef?: { tipo: string; n: number } | null; aplica?: string[]; geral?: boolean };
const ultimoDiaMes = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
function resolverPrazoFech(ref: { tipo: string; n: number } | null | undefined, comp: string): string {
  if (!ref) return "";
  const [y, m] = comp.split("-").map(Number); const m0 = m - 1;
  let d: Date;
  if (ref.tipo === "diaMes") d = new Date(y, m0, Math.min(ref.n, ultimoDiaMes(y, m0)));
  else if (ref.tipo === "diaSeguinte") { const ny = m0 === 11 ? y + 1 : y, nm0 = (m0 + 1) % 12; d = new Date(ny, nm0, Math.min(ref.n, ultimoDiaMes(ny, nm0))); }
  else { d = new Date(y, m0, ultimoDiaMes(y, m0)); d.setDate(d.getDate() + ref.n); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const compDelta = (delta: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const MES_LB = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const compLb = (c: string) => { const [y, m] = c.split("-"); return `${MES_LB[Number(m) - 1] || "?"}/${y.slice(2)}`; };

const AvisosCtx = createContext<AvisosApi>({
  todos: [], inbox: [], historico: [],
  marcarLido: () => {}, marcarNaoLido: () => {}, marcarTodosLidos: () => {},
});
// API completa (ChatPage). Sentinela de data "alta" pra avisos sem `em`: uma vez
// lidos, ficam lidos (não ressurgem por não terem timestamp de atividade).
const EM_ALTO = "9999-99-99";
export const useAvisosCentral = () => useContext(AvisosCtx);
// Retrocompat: quem só quer a contagem/lista da caixa de entrada (badge da
// sidebar) continua chamando useAvisos() e recebe o inbox (não lidos).
export const useAvisos = (): Aviso[] => useContext(AvisosCtx).inbox;

export function AvisosProvider({ children }: { children: ReactNode }) {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const { perfis } = useAccessProfiles();
  const base = { restaurants, pessoa, perfis };

  const nomePorRid = useMemo(() => {
    const m: Record<string, string> = {};
    restaurants.forEach((r) => { m[r.id] = r.nome; });
    return m;
  }, [restaurants]);

  // ── Rotinas do usuário (transversal): onde ele é responsável + suas conclusões ──
  const pid = pessoa?.id || "";
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [conclusoesIds, setConclusoesIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!pid) { setRotinas([]); return; }
    const unsub = onSnapshot(
      query(collection(db, "rotinas"), where("responsaveis", "array-contains", pid)),
      (snap) => setRotinas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Rotina)),
      () => setRotinas([]),
    );
    return () => unsub();
  }, [pid]);
  useEffect(() => {
    if (!pid) { setConclusoesIds(new Set()); return; }
    const unsub = onSnapshot(
      query(collection(db, "rotinaConclusoes"), where("pessoaId", "==", pid)),
      (snap) => setConclusoesIds(new Set(snap.docs.map((d) => ((d.data() as RotinaConclusao).id) || d.id))),
      () => setConclusoesIds(new Set()),
    );
    return () => unsub();
  }, [pid]);

  // ── Cobranças internas: vendas de OUTRA empresa em que MEU restaurante é o
  //    cliente vinculado + já teve cobrança gerada (status cobranca_enviada). ──
  const ridsKeyAll = restaurants.map((r) => r.id).join(",");
  const [cobrancasInt, setCobrancasInt] = useState<Array<{ id: string; restaurantId?: string; clienteRestauranteVinculadoId?: string | null; valorTotal?: number; saldo?: number; status?: string; criadoEm?: string }>>([]);
  useEffect(() => {
    const rids = ridsKeyAll ? ridsKeyAll.split(",").slice(0, 10) : [];
    if (!rids.length) { setCobrancasInt([]); return; }
    const unsub = onSnapshot(
      query(collection(db, "vendas"), where("clienteRestauranteVinculadoId", "in", rids)),
      (snap) => setCobrancasInt(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; status?: string }).filter((v) => v.status === "cobranca_enviada")),
      () => setCobrancasInt([]),
    );
    return () => unsub();
  }, [ridsKeyAll]);

  // ── Reembolsos de cartão: lançamentos atribuídos ao MEU restaurante (sou o
  //    pagador) e lançamentos MEUS já marcados como pagos (sou o solicitante). ──
  type ReembParte = { empresaId: string; percentual: number; valor: number; status?: string; pagoEm?: string | null; pagoPorNome?: string | null };
  type ReembLanc = { id: string; restaurantId: string; publicado?: boolean; rateio?: ReembParte[]; empresasRateadas?: string[]; reembolsoDataPagamento?: string | null; criadoEm?: string };
  const [reembReceber, setReembReceber] = useState<ReembLanc[]>([]);
  const [reembPagos, setReembPagos] = useState<ReembLanc[]>([]);
  useEffect(() => {
    const rids = ridsKeyAll ? ridsKeyAll.split(",").slice(0, 10) : [];
    if (!rids.length) { setReembReceber([]); setReembPagos([]); return; }
    // Só faturas FECHADAS (publicado=true) geram aviso; rascunho não vaza pras outras.
    const u1 = onSnapshot(
      query(collection(db, "cartaoLancamentos"), where("empresasRateadas", "array-contains-any", rids)),
      (snap) => setReembReceber(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReembLanc).filter((l) => l.publicado)),
      () => setReembReceber([]),
    );
    const u2 = onSnapshot(
      query(collection(db, "cartaoLancamentos"), where("restaurantId", "in", rids)),
      (snap) => setReembPagos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReembLanc).filter((l) => l.publicado && Array.isArray(l.rateio) && l.rateio.some((p) => p.status === "pago"))),
      () => setReembPagos([]),
    );
    return () => { u1(); u2(); };
  }, [ridsKeyAll]);

  // ── Prazos (módulo novo unificado): vencidos + a vencer dentro da antecedência ──
  const [prazosAv, setPrazosAv] = useState<Prazo[]>([]);
  useEffect(() => {
    const rids = ridsKeyAll ? ridsKeyAll.split(",").slice(0, 10) : [];
    if (!rids.length) { setPrazosAv([]); return; }
    const u = onSnapshot(
      query(collection(db, "prazos"), where("restaurantIds", "array-contains-any", rids)),
      (s) => setPrazosAv(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Prazo).filter((p) => !p.deletadoEm && p.status !== "resolvido")),
      () => setPrazosAv([]),
    );
    return () => u();
  }, [ridsKeyAll]);

  // ── Config de canais por notificação (gating in-app da Central) ──
  const [notifConfigs, setNotifConfigs] = useState<Record<string, { inApp?: boolean }>>({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "notificacaoConfigs"), (snap) => {
      const m: Record<string, { inApp?: boolean }> = {};
      snap.docs.forEach((d) => { const c = d.data() as { restaurantId?: string; tipo?: string; inApp?: boolean }; if (c.restaurantId && c.tipo) m[`${c.restaurantId}_${c.tipo}`] = { inApp: c.inApp }; });
      setNotifConfigs(m);
    }, () => setNotifConfigs({}));
    return () => unsub();
  }, []);

  // ── Fontes por-item ──
  const escala = useAvisoSource({ ...base,
    gates: [["escala", "receberAvisos"], ["escala", "aprovarSolicitacoes"]],
    collectionName: "escalaSolicitacoes", filtros: [["status", "==", "pendente"]] });
  const faleDp = useAvisoSource({ ...base,
    gates: [["portalEmpregado", "receberFaleDp"]],
    collectionName: "faleDpMensagens", filtros: [["status", "==", "nova"]] });

  // ── Fontes agregadas — Financeiro ──
  const fechamento = useAvisoSource({ ...base,
    gates: [["fechamentoCaixa", "receberAvisos"]], collectionName: "fechamentosCaixa" });
  const gorjetas = useAvisoSource({ ...base,
    gates: [["gorjetas", "receberAvisos"]], collectionName: "gorjetas", filtros: [["publicada", "==", true]] });
  const vt = useAvisoSource({ ...base,
    gates: [["vt", "receberAvisos"]], collectionName: "vtLotes", filtros: [["status", "==", "rascunho"]] });
  const vr = useAvisoSource({ ...base,
    gates: [["vr", "receberAvisos"]], collectionName: "vrLotes", filtros: [["status", "==", "rascunho"]] });
  // Benefícios (VT+VR unificado) não tem permissão própria — herda de VT/VR.
  const beneficios = useAvisoSource({ ...base,
    gates: [["vt", "receberAvisos"], ["vr", "receberAvisos"]], collectionName: "beneficiosLotes", filtros: [["status", "==", "rascunho"]] });

  // ── Fontes agregadas — Operação ──
  const ocorrencias = useAvisoSource({ ...base,
    gates: [["ocorrencias", "receberAvisos"]], collectionName: "ocorrencias", filtros: [["status", "in", ["aberta", "em_apuracao"]]] });
  const eventos = useAvisoSource({ ...base,
    gates: [["eventos", "receberAvisos"]], collectionName: "leadsEvento", filtros: [["status", "==", "novo"]] });
  const recebimento = useAvisoSource({ ...base,
    gates: [["recebimento", "receberAvisos"]], collectionName: "recebimentos" });
  const compras = useAvisoSource({ ...base,
    gates: [["compras", "receberAvisos"]], collectionName: "pedidos", filtros: [["status", "in", ["rascunho", "aprovado", "enviado"]]] });

  // ── Checklists: os atribuídos a mim, pendentes hoje ──
  const checklistTpl = useAvisoSource({ ...base,
    gates: [["checklists", "receberAvisos"]], collectionName: "checklistTemplates", filtros: [["ativo", "==", true]] });
  const checklistRun = useAvisoSource({ ...base,
    gates: [["checklists", "receberAvisos"]], collectionName: "checklistRuns" });

  // ── Tarefas (lente enxuta): minhas tarefas operacionais em aberto ──
  // Unificado: lê da coleção `tarefas` (projeto Operação — Demandas), por
  // restaurante. Listener próprio porque tarefa usa restaurantIds (array).
  // Duas fontes: tarefas onde sou responsável E onde sou co-responsável (uma
  // ação pode ter vários responsáveis). Agrupadas por restaurante e unidas
  // (dedupe por id). A query de co-resp usa só array-contains (sem exigir índice
  // composto) e filtra o projeto no cliente.
  const [minhaAcaoResp, setMinhaAcaoResp] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [minhaAcaoCo, setMinhaAcaoCo] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const agruparTarefas = (docs: Array<{ id: string; data: () => Record<string, unknown> }>) => {
    const m: Record<string, Array<Record<string, unknown>>> = {};
    for (const d of docs) {
      const t = { id: d.id, ...d.data() } as Record<string, unknown>;
      if (t.deletadoEm) continue;
      if (t.projetoId !== "proj-operacao-dem") continue;
      const rid = (Array.isArray(t.restaurantIds) && (t.restaurantIds as string[])[0]) || "";
      if (!rid) continue;
      if (!m[rid]) m[rid] = [];
      m[rid].push(t);
    }
    return m;
  };
  useEffect(() => {
    if (!pid) { setMinhaAcaoResp({}); setMinhaAcaoCo({}); return; }
    const u1 = onSnapshot(
      query(collection(db, "tarefas"), where("responsavelId", "==", pid), where("projetoId", "==", "proj-operacao-dem")),
      (snap) => setMinhaAcaoResp(agruparTarefas(snap.docs)), () => setMinhaAcaoResp({}),
    );
    const u2 = onSnapshot(
      query(collection(db, "tarefas"), where("coResponsaveis", "array-contains", pid)),
      (snap) => setMinhaAcaoCo(agruparTarefas(snap.docs)), () => setMinhaAcaoCo({}),
    );
    return () => { u1(); u2(); };
  }, [pid]);
  const minhaAcao = useMemo(() => {
    const m: Record<string, Array<Record<string, unknown>>> = {};
    for (const src of [minhaAcaoResp, minhaAcaoCo]) {
      for (const [rid, arr] of Object.entries(src)) {
        if (!m[rid]) m[rid] = [];
        for (const t of arr) if (!m[rid].some((x) => x.id === t.id)) m[rid].push(t);
      }
    }
    return m;
  }, [minhaAcaoResp, minhaAcaoCo]);
  const minhaProducao = useAvisoSource({ ...base,
    gates: [["planoDeAcao", "receberAvisos"]], collectionName: "ftPlanosProducao" });

  // ── Fontes agregadas — Pessoas & DP ──
  const ideias = useAvisoSource({ ...base,
    gates: [["ideias", "receberAvisos"]], collectionName: "ideias", filtros: [["status", "==", "aberta"]] });
  const admissoes = useAvisoSource({ ...base,
    gates: [["admissao", "receberAvisos"]], collectionName: "admissoes" });
  const candidaturasNovas = useAvisoSource({ ...base,
    gates: [["processoSeletivo", "receberCandidaturas"]], collectionName: "candidaturasTrabalhe", filtros: [["status", "==", "nova"]] });
  // Aprovados direcionados pra admissão → avisa quem tem acesso ao módulo Admissão.
  const candidaturasAdmissao = useAvisoSource({ ...base,
    gates: [["admissao", "receberAvisos"]], collectionName: "candidaturasTrabalhe", filtros: [["etapa", "==", "admissao"]] });
  const demissoes = useAvisoSource({ ...base,
    gates: [["demissao", "receberAvisos"]], collectionName: "processosDemissao" });
  const exames = useAvisoSource({ ...base,
    gates: [["exames", "receberAvisos"]], collectionName: "examesEmpregado", filtros: [["ativo", "==", true]] });
  const uniformes = useAvisoSource({ ...base,
    gates: [["uniformes", "receberAvisos"]], collectionName: "entregasUniforme" });

  // ── Governança de IA: perguntas fora do escopo (uma por interação flagada) ──
  const iaAlertas = useAvisoSource({ ...base,
    gates: [["iaGovernanca", "receberAlertas"]], collectionName: "iaInteracoes", filtros: [["foraDeEscopo", "==", true]] });

  // ── Wiki de Processos: minhas etapas (responsável via setor) ──
  // Wiki usa restaurantIds[] (não restaurantId), então carrega tudo e filtra.
  const [wikiProcs, setWikiProcs] = useState<WikiProcesso[]>([]);
  const [wikiCfgs, setWikiCfgs] = useState<Record<string, Record<string, string[]>>>({});
  useEffect(() => {
    const u1 = onSnapshot(collection(db, "wikiProcessos"), (s) => setWikiProcs(s.docs.map(d => ({ id: d.id, ...d.data() }) as WikiProcesso).filter(p => !p.deletadoEm && p.ativo !== false)), () => setWikiProcs([]));
    const u2 = onSnapshot(collection(db, "wikiConfig"), (s) => { const m: Record<string, Record<string, string[]>> = {}; s.docs.forEach(d => { const c = d.data() as { setoresResponsaveis?: Record<string, string[]> }; m[d.id] = c.setoresResponsaveis || {}; }); setWikiCfgs(m); }, () => setWikiCfgs({}));
    return () => { u1(); u2(); };
  }, []);

  // ── Fechamento Financeiro: template de itens + estado dos meses (todos) ──
  const [fechFinItens, setFechFinItens] = useState<FechFinItem[]>([]);
  const [fechFinAtivas, setFechFinAtivas] = useState<string[]>([]);
  const [fechFinMeses, setFechFinMeses] = useState<Record<string, Record<string, { status?: string }>>>({});
  useEffect(() => {
    const u1 = onSnapshot(doc(db, "fechamentoConfig", "config"), (s) => {
      const d = s.exists() ? (s.data() as { itens?: FechFinItem[]; empresasAtivas?: string[] }) : null;
      setFechFinItens(d?.itens || []); setFechFinAtivas(d?.empresasAtivas || []);
    }, () => { setFechFinItens([]); setFechFinAtivas([]); });
    const u2 = onSnapshot(collection(db, "fechamentoMes"), (s) => {
      const m: Record<string, Record<string, { status?: string }>> = {};
      s.docs.forEach((d) => { const v = d.data() as { competencia?: string; celulas?: Record<string, { status?: string }> }; if (v.competencia) m[v.competencia] = v.celulas || {}; });
      setFechFinMeses(m);
    }, () => setFechFinMeses({}));
    return () => { u1(); u2(); };
  }, []);

  // ── Avisos direcionados a mim (genérico: BEO, relatórios…) ──
  const [avisosDir, setAvisosDir] = useState<AvisoDirecionado[]>([]);
  useEffect(() => {
    if (!pid) { setAvisosDir([]); return; }
    const u = onSnapshot(
      query(collection(db, "avisosDirecionados"), where("destinatarioIds", "array-contains", pid)),
      (s) => setAvisosDir(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AvisoDirecionado)),
      () => setAvisosDir([]),
    );
    return () => u();
  }, [pid]);

  // ── Monitor de falhas: só o master vê. Últimas falhas não resolvidas. ──
  const ehMaster = !!pessoa?.isMaster;
  const [falhas, setFalhas] = useState<FalhaLog[]>([]);
  useEffect(() => {
    if (!ehMaster) { setFalhas([]); return; }
    const u = onSnapshot(
      query(collection(db, "falhasLog"), orderBy("criadoEm", "desc"), limit(40)),
      (s) => setFalhas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as FalhaLog).filter((f) => !f.resolvidoEm)),
      () => setFalhas([]),
    );
    return () => u();
  }, [ehMaster]);

  const todos = useMemo<Aviso[]>(() => {
    const out: Aviso[] = [];
    const hoje = new Date().toISOString().slice(0, 10);

    // ── Monitor de falhas (master) ──
    for (const f of falhas) {
      out.push({
        id: `falha_${f.id}`,
        tipo: "falha", icone: "🚨",
        titulo: `Erro em ${f.modulo}`,
        descricao: `${f.mensagem}${f.codigo ? ` (${f.codigo})` : ""}${f.pessoaNome ? ` · ${f.pessoaNome}` : ""}${f.contexto ? ` · ${f.contexto}` : ""}`,
        em: f.criadoEm,
        restauranteId: f.restaurantId || "",
        restauranteNome: f.restauranteNome || nomePorRid[f.restaurantId || ""] || "—",
        cta: f.url ? "Abrir onde ocorreu" : "Ver detalhe", href: f.url || undefined,
        categoria: "Monitor de falhas", categoriaIcone: "🚨",
      });
    }
    const limite30 = addDiasYmd(hoje, 30);

    // ── Avisos direcionados a mim ──
    for (const a of avisosDir) {
      out.push({
        id: `dir_${a.id}`,
        tipo: "direcionado",
        icone: a.icone || "📩",
        titulo: a.titulo,
        descricao: a.texto || (a.anexoNome ? `Anexo: ${a.anexoNome}` : ""),
        em: a.criadoEm || hoje,
        restauranteId: a.restaurantId,
        restauranteNome: nomePorRid[a.restaurantId] || "—",
        cta: a.anexoUrl ? "Abrir PDF" : "Ver",
        href: a.href || a.anexoUrl,
        categoria: a.categoria || "Enviados a você",
        categoriaIcone: a.icone || "📩",
      });
    }

    // ── Rotinas pendentes do usuário (vencem hoje ou atrasadas e não feitas) ──
    for (const p of pendentesParaPessoa(rotinas, conclusoesIds, pid, hoje)) {
      const r = p.rotina;
      out.push({
        id: `rot_${r.id}`,
        tipo: "rotina",
        icone: p.atrasada ? "⏰" : "🔁",
        titulo: r.titulo,
        descricao: `${p.atrasada ? "Atrasada · " : ""}${recorrenciaLabel(r.recorrencia)}${r.descricao ? ` · ${r.descricao}` : ""}`,
        em: p.ocorrenciaData,
        restauranteId: r.restaurantId,
        restauranteNome: nomePorRid[r.restaurantId] || "Restaurante",
        cta: r.moduloAlvo ? "Fazer agora" : "Marcar feito",
        href: deepLinkRotina(r.restaurantId, r.moduloAlvo, r.subAlvo),
        rotina: { rotina: r, ocorrenciaData: p.ocorrenciaData, atrasada: p.atrasada },
        categoria: "Rotinas",
        categoriaIcone: "🔁",
      });
    }

    // ── Cobranças internas recebidas (agrupadas por empresa vendedora) ──
    const cobrGrp = new Map<string, { buyerRid: string; sellerRid: string; n: number; total: number; em: string }>();
    for (const v of cobrancasInt) {
      const buyerRid = v.clienteRestauranteVinculadoId || "";
      if (!buyerRid) continue;
      const sellerRid = v.restaurantId || "";
      const key = `${buyerRid}_${sellerRid}`;
      const g = cobrGrp.get(key) || { buyerRid, sellerRid, n: 0, total: 0, em: "" };
      g.n++; g.total += (v.saldo ?? v.valorTotal ?? 0);
      const t = String(v.criadoEm || ""); if (t > g.em) g.em = t;
      cobrGrp.set(key, g);
    }
    for (const g of cobrGrp.values()) {
      out.push({
        id: `cobrint_${g.buyerRid}_${g.sellerRid}`,
        tipo: "cobranca_interna", icone: "💰",
        titulo: "Cobrança recebida",
        descricao: `${g.n} ${g.n === 1 ? "cobrança" : "cobranças"} de ${nomePorRid[g.sellerRid] || "outra empresa"} · ${(g.total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        em: g.em,
        restauranteId: g.buyerRid,
        restauranteNome: nomePorRid[g.buyerRid] || "Restaurante",
        cta: "Ver no Vendas", href: `/r/${g.buyerRid}/vendas`,
        categoria: "Vendas", categoriaIcone: "🧾",
      });
    }

    // ── Reembolsos de cartão a pagar (sou o pagador) — agrupado por empresa a
    //    quem devo o reembolso (o dono do cartão). ──
    const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const meusRids = new Set(Object.keys(nomePorRid));
    const pagarGrp = new Map<string, { pagadorRid: string; donoRid: string; n: number; total: number; venc: string; em: string }>();
    for (const l of reembReceber) {
      const donoRid = l.restaurantId || "";
      for (const p of l.rateio || []) {
        if (!meusRids.has(p.empresaId) || p.status === "pago") continue;   // só minhas fatias, ainda não pagas
        const pagadorRid = p.empresaId;
        const key = `${pagadorRid}_${donoRid}`;
        const g = pagarGrp.get(key) || { pagadorRid, donoRid, n: 0, total: 0, venc: "", em: "" };
        g.n++; g.total += (p.valor || 0);
        const t = String(l.criadoEm || ""); if (t > g.em) g.em = t;
        const v = String(l.reembolsoDataPagamento || ""); if (v && (!g.venc || v < g.venc)) g.venc = v;
        pagarGrp.set(key, g);
      }
    }
    for (const g of pagarGrp.values()) {
      const vencido = g.venc && g.venc < hoje;
      out.push({
        id: `reembpagar_${g.pagadorRid}_${g.donoRid}`,
        tipo: "reembolso_pagar", icone: vencido ? "⏰" : "💳",
        titulo: "Reembolso a pagar",
        descricao: `${g.n} ${g.n === 1 ? "gasto" : "gastos"} de ${nomePorRid[g.donoRid] || "outra empresa"} · ${brl(g.total)}${g.venc ? ` · pagar até ${fmtDataCurta(g.venc)}` : ""}`,
        em: g.em,
        restauranteId: g.pagadorRid,
        restauranteNome: nomePorRid[g.pagadorRid] || "Restaurante",
        cta: "Ver reembolsos", href: `/r/${g.pagadorRid}/faturas`,
        categoria: "Faturas", categoriaIcone: "💳",
      });
    }

    // ── Reembolsos pagos (sou o solicitante/dono do cartão) — agrupado por
    //    empresa que me pagou. Some do inbox quando eu marco lido. ──
    const pagoGrp = new Map<string, { donoRid: string; pagadorRid: string; n: number; total: number; em: string; quem: string }>();
    for (const l of reembPagos) {
      const donoRid = l.restaurantId || "";
      if (!meusRids.has(donoRid)) continue;   // sou o dono do cartão
      for (const p of l.rateio || []) {
        if (p.status !== "pago") continue;
        const pagadorRid = p.empresaId;
        const key = `${donoRid}_${pagadorRid}`;
        const g = pagoGrp.get(key) || { donoRid, pagadorRid, n: 0, total: 0, em: "", quem: "" };
        g.n++; g.total += (p.valor || 0);
        const t = String(p.pagoEm || ""); if (t > g.em) g.em = t;
        if (p.pagoPorNome) g.quem = p.pagoPorNome;
        pagoGrp.set(key, g);
      }
    }
    for (const g of pagoGrp.values()) {
      out.push({
        id: `reembpago_${g.donoRid}_${g.pagadorRid}`,
        tipo: "reembolso_pago", icone: "✅",
        titulo: "Reembolso pago",
        descricao: `${nomePorRid[g.pagadorRid] || "Uma empresa"} pagou ${brl(g.total)}${g.quem ? ` (${g.quem})` : ""} de ${g.n} ${g.n === 1 ? "gasto" : "gastos"}`,
        em: g.em,
        restauranteId: g.donoRid,
        restauranteNome: nomePorRid[g.donoRid] || "Restaurante",
        cta: "Ver no Faturas", href: `/r/${g.donoRid}/faturas`,
        categoria: "Faturas", categoriaIcone: "💳",
      });
    }

    // ── Prazos (módulo novo): 1 card por prazo no radar (vencido ou a vencer).
    //    Só das categorias que a pessoa PODE VER (granular) + receberAvisos. ──
    const SUF_CAT_AV: Record<string, string> = { conta: "Conta", tecnico: "Tecnico", trabalhista: "Trabalhista", avulso: "Avulso" };
    for (const p of prazosAv) {
      if (!noRadar(p, hoje)) continue;
      const suf = SUF_CAT_AV[p.tipo] || "";
      const r = (p.restaurantIds || []).find((x) => meusRids.has(x) && pessoa
        && canAcao(pessoa, x, "prazos", "receberAvisos", perfis)
        && canAcao(pessoa, x, "prazos", `ver${suf}`, perfis));
      if (!r) continue;
      const dias = diasAte(hoje, p.vencimento);
      const vencido = dias < 0;
      out.push({
        id: `prazo_${p.id}`,
        tipo: "prazo", icone: vencido ? "⚠️" : "📅",
        titulo: `Prazo ${vencido ? "vencido" : "a vencer"} · ${PRAZO_TIPO_LABEL[p.tipo]}`,
        descricao: `${p.titulo} — ${vencido ? `venceu há ${-dias} dia(s)` : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`}${p.exigeLaudo && !p.laudo ? " · exige laudo" : ""}`,
        em: p.vencimento,
        restauranteId: r, restauranteNome: nomePorRid[r] || "Restaurante",
        cta: "Abrir Prazos", href: `/r/${r}/prazos`,
        categoria: "Prazos", categoriaIcone: "📅",
      });
    }

    // Helper agregado: 1 card por restaurante com contador.
    const agg = (
      porRid: Record<string, AvisoDoc[]>,
      cfg: {
        tipo: string; icone: string; modulo: string; label: string;
        sing: string; plural: string; campoData?: string;
        pending?: (d: AvisoDoc) => boolean;
      },
    ) => {
      for (const rid of Object.keys(porRid)) {
        const docs = (porRid[rid] || []).filter(cfg.pending || (() => true));
        if (docs.length === 0) continue;
        const n = docs.length;
        const campo = cfg.campoData || "criadoEm";
        const em = docs.reduce((mx, d) => {
          const t = String(d[campo] || "");
          return t > mx ? t : mx;
        }, "");
        out.push({
          id: `${cfg.tipo}_${rid}`,
          tipo: cfg.tipo,
          icone: cfg.icone,
          titulo: cfg.label,
          descricao: `${n} ${n === 1 ? cfg.sing : cfg.plural}`,
          em,
          restauranteId: rid,
          restauranteNome: nomePorRid[rid] || "Restaurante",
          cta: `Abrir ${cfg.label}`,
          href: `/r/${rid}/${cfg.modulo}`,
          categoria: cfg.label,
          categoriaIcone: cfg.icone,
        });
      }
    };

    // ── Por item: escala ──
    for (const rid of Object.keys(escala)) {
      for (const d of escala[rid] || []) {
        const s = d as unknown as {
          empregadoNome?: string; tipo?: string; motivo?: string;
          data?: string; statusAtual?: string; statusSolicitado?: string; criadoEm?: string;
        };
        const quem = s.empregadoNome || "Empregado";
        const ehHorario = s.tipo === "horario";
        out.push({
          id: `esc_${d.id}`,
          tipo: "escala_solicitacao",
          icone: "📅",
          titulo: ehHorario ? `${quem} pediu ajuste de horário` : `${quem} pediu ajuste de escala`,
          descricao: ehHorario
            ? `Acha que a jornada contratual dele não bate. "${(s.motivo || "").slice(0, 140)}"`
            : `Dia ${fmtDataCurta(s.data)}: de ${statusLabel(s.statusAtual)} → ${statusLabel(s.statusSolicitado)}. "${(s.motivo || "").slice(0, 140)}"`,
          em: s.criadoEm || "",
          restauranteId: d.restaurantId,
          restauranteNome: nomePorRid[d.restaurantId] || "Restaurante",
          cta: "Analisar na Escala",
          href: `/r/${d.restaurantId}/escala?aba=ajustes`,
          categoria: "Escala",
          categoriaIcone: "📅",
        });
      }
    }

    // ── Por item: Fale com DP ──
    for (const rid of Object.keys(faleDp)) {
      for (const d of faleDp[rid] || []) {
        const m = d as unknown as FaleDpMensagem;
        const cat = FALE_DP_CATEGORIA_LABEL[m.categoria] || "Mensagem";
        const remetente = m.anonimo ? "Anônimo" : (m.autorNome || "Identificado");
        out.push({
          id: `fdp_${d.id}`,
          tipo: "fale_dp",
          icone: FALE_DP_CATEGORIA_ICONE[m.categoria] || "🗣️",
          titulo: `Fale com DP · ${cat}`,
          descricao: `${remetente}: "${(m.texto || "").slice(0, 140)}"`,
          em: m.criadoEm || "",
          restauranteId: d.restaurantId,
          restauranteNome: nomePorRid[d.restaurantId] || "Restaurante",
          cta: "Ler mensagem",
          faleDp: m,
          categoria: "Fale com DP",
          categoriaIcone: "🗣️",
        });
      }
    }

    // ── Agregados ──
    agg(fechamento, { tipo: "fechamento", icone: "💰", modulo: "fechamentoCaixa", label: "Fechamento de Caixa",
      sing: "fechamento aguardando conferência", plural: "fechamentos aguardando conferência",
      pending: (d) => !d.conferidoEm && !d.excluidoEm });
    agg(gorjetas, { tipo: "gorjetas", icone: "💸", modulo: "gorjetas", label: "Gorjetas", campoData: "createdAt",
      sing: "dia de gorjeta publicado a pagar", plural: "dias de gorjeta publicados a pagar",
      pending: (d) => d.paga !== true });
    agg(vt, { tipo: "vt", icone: "🚌", modulo: "vt", label: "Vale Transporte",
      sing: "lote aguardando pagamento", plural: "lotes aguardando pagamento" });
    agg(vr, { tipo: "vr", icone: "🍽️", modulo: "vr", label: "Vale Refeição",
      sing: "lote aguardando pagamento", plural: "lotes aguardando pagamento" });
    agg(beneficios, { tipo: "beneficios", icone: "🎁", modulo: "beneficios", label: "Benefícios",
      sing: "lote aguardando pagamento", plural: "lotes aguardando pagamento" });

    agg(ocorrencias, { tipo: "ocorrencias", icone: "⚠️", modulo: "ocorrencias", label: "Ocorrências",
      sing: "ocorrência em aberto", plural: "ocorrências em aberto" });
    agg(eventos, { tipo: "eventos", icone: "🎉", modulo: "eventos", label: "Eventos", campoData: "createdAt",
      sing: "novo lead de evento", plural: "novos leads de evento" });
    agg(recebimento, { tipo: "recebimento", icone: "📦", modulo: "recebimento", label: "Recebimento", campoData: "recebidoEm",
      sing: "nota aguardando conferência", plural: "notas aguardando conferência",
      pending: (d) => !d.conferidoEm && !d.excluidoEm });
    agg(compras, { tipo: "compras", icone: "🛒", modulo: "compras", label: "Compras",
      sing: "pedido em aberto", plural: "pedidos em aberto" });

    // ── Checklists atribuídos a mim, pendentes hoje (agregado por restaurante) ──
    const dowHoje = new Date(hoje + "T12:00:00").getDay();
    for (const rid of Object.keys(checklistTpl)) {
      const runs = (checklistRun[rid] || []) as Array<{ templateId?: string; data?: string; status?: string }>;
      const ultimo = (tid: string) => runs.filter(r => r.templateId === tid).sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];
      let n = 0;
      for (const t of (checklistTpl[rid] || []) as Array<Record<string, unknown>>) {
        const resp = Array.isArray(t.responsaveisIds) ? (t.responsaveisIds as string[]) : [];
        if (!resp.includes(pid)) continue;                       // só os atribuídos a mim
        const freq = t.frequencia;
        let due = false;
        if (freq === "diaria") { const ds = Array.isArray(t.diasSemana) ? (t.diasSemana as number[]) : []; due = ds.length === 0 || ds.includes(dowHoje); }
        else if (freq === "semanal") { const u = ultimo(t.id as string); due = !u || (new Date(hoje).getTime() - new Date(String(u.data) + "T00:00:00").getTime()) / 864e5 >= 7; }
        else if (freq === "mensal") { const u = ultimo(t.id as string); due = !u || String(u.data).slice(0, 7) !== hoje.slice(0, 7); }
        if (!due) continue;
        const feitoHoje = runs.some(r => r.templateId === t.id && r.data === hoje && r.status === "completo");
        if (freq === "diaria" && feitoHoje) continue;
        n++;
      }
      if (n === 0) continue;
      out.push({
        id: `checklists_${rid}`, tipo: "checklists", icone: "✅", titulo: "Checklists do dia",
        descricao: `${n} ${n === 1 ? "checklist atribuído a você" : "checklists atribuídos a você"}`,
        em: hoje, restauranteId: rid, restauranteNome: nomePorRid[rid] || "Restaurante",
        cta: "Abrir checklists", href: `/r/${rid}/checklists`, categoria: "Checklists", categoriaIcone: "✅",
      });
    }

    // ── Tarefas (lente enxuta): minhas tarefas operacionais em aberto ──
    for (const rid of Object.keys(minhaAcao)) {
      const abertas = (minhaAcao[rid] || []).filter(d => d.status === "a_fazer" || d.status === "em_andamento");
      if (abertas.length === 0) continue;
      const atrasadas = abertas.filter(d => d.prazo && String(d.prazo) < hoje).length;
      const em = abertas.reduce((mx, d) => { const t = String(d.criadoEm || ""); return t > mx ? t : mx; }, "");
      out.push({
        id: `acoes_${rid}`, tipo: "acoes", icone: atrasadas ? "⏰" : "✅", titulo: "Tarefas",
        descricao: `${abertas.length} ${abertas.length === 1 ? "tarefa sua em aberto" : "tarefas suas em aberto"}${atrasadas ? ` · ${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}` : ""}`,
        em, restauranteId: rid, restauranteNome: nomePorRid[rid] || "Restaurante",
        cta: "Abrir Tarefas", href: `/r/${rid}/planoDeAcao`, categoria: "Tarefas", categoriaIcone: "✅",
      });
    }
    // ── Plano de Ação: produções atribuídas a mim e não produzidas ──
    for (const rid of Object.keys(minhaProducao)) {
      let n = 0; let ultima = "";
      for (const d of minhaProducao[rid] || []) {
        if (d.status === "concluido") continue;
        const itens = Array.isArray(d.itens) ? (d.itens as Array<{ responsavelId?: string; produzidoEm?: string }>) : [];
        for (const it of itens) if (it.responsavelId === pid && !it.produzidoEm) { n++; const t = String(d.data || d.criadoEm || ""); if (t > ultima) ultima = t; }
      }
      if (n === 0) continue;
      out.push({
        id: `producao_${rid}`, tipo: "producao_atribuida", icone: "🍳", titulo: "Produção atribuída",
        descricao: `${n} ${n === 1 ? "produção pra você fazer" : "produções pra você fazer"}`,
        em: ultima, restauranteId: rid, restauranteNome: nomePorRid[rid] || "Restaurante",
        cta: "Ver no Plano de Ação", href: `/r/${rid}/planoDeAcao`, categoria: "Plano de Ação", categoriaIcone: "🎯",
      });
    }

    agg(ideias, { tipo: "ideias", icone: "💡", modulo: "ideias", label: "Ideias",
      sing: "ideia nova pra avaliar", plural: "ideias novas pra avaliar" });
    agg(admissoes, { tipo: "admissao", icone: "🧳", modulo: "admissao", label: "Admissão", campoData: "iniciadoEm",
      sing: "admissão em andamento", plural: "admissões em andamento",
      pending: (d) => !d.finalizadoEm && d.status !== "cancelada" && d.status !== "expirada" });
    agg(demissoes, { tipo: "demissao", icone: "👋", modulo: "demissao", label: "Demissão", campoData: "iniciadoEm",
      sing: "processo em andamento", plural: "processos em andamento",
      pending: (d) => d.status !== "concluido" && d.status !== "cancelado" });
    agg(exames, { tipo: "exames", icone: "🩺", modulo: "exames", label: "Exames médicos",
      sing: "exame vencendo/vencido", plural: "exames vencendo/vencidos",
      pending: (d) => !!d.proximoVencimento && String(d.proximoVencimento) <= limite30 });
    agg(uniformes, { tipo: "uniformes", icone: "👕", modulo: "uniformes", label: "Uniformes & EPIs", campoData: "entregueEm",
      sing: "item vencendo/vencido", plural: "itens vencendo/vencidos",
      pending: (d) => Array.isArray(d.itens) && (d.itens as Array<{ validadeAte?: string }>).some(
        (it) => !!it.validadeAte && String(it.validadeAte) <= limite30) });

    // ── Candidaturas novas: 1 aviso por candidato, roteado pelo responsável ──
    // (se tem responsável, só cai pra ele; sem responsável, cai pra quem tem
    // a permissão de receber candidaturas na empresa).
    for (const c of Object.values(candidaturasNovas).flat()) {
      const resps = ((c as { responsavelIds?: string[] }).responsavelIds) || ((c as { responsavelId?: string }).responsavelId ? [(c as { responsavelId?: string }).responsavelId as string] : []);
      if (resps.length > 0 && !resps.includes(pid)) continue;
      const nome = String((c as { nome?: string }).nome || "Candidato");
      const area = String((c as { areaInteresse?: string }).areaInteresse || "");
      out.push({
        id: `cand_${c.id}`, tipo: "candidatura", icone: "💼",
        titulo: `Nova candidatura: ${nome}`,
        descricao: `Trabalhe conosco${area ? ` · ${area}` : ""}`,
        em: String((c as { createdAt?: string }).createdAt || ""),
        restauranteId: c.restaurantId, restauranteNome: nomePorRid[c.restaurantId] || "Restaurante",
        cta: "Ver candidatura", href: `/r/${c.restaurantId}/processoSeletivo`,
        categoria: "Candidaturas", categoriaIcone: "💼",
      });
    }

    // ── Candidatos aprovados aguardando admissão (só os sem admissão iniciada) ──
    for (const c of Object.values(candidaturasAdmissao).flat()) {
      if ((c as { admissaoId?: string }).admissaoId) continue;
      const nome = String((c as { nome?: string }).nome || "Candidato");
      out.push({
        id: `candadm_${c.id}`, tipo: "candidatura_admissao", icone: "🪪",
        titulo: `Iniciar admissão: ${nome}`,
        descricao: `Aprovado no processo seletivo${(c as { vagaTitulo?: string }).vagaTitulo ? ` · ${(c as { vagaTitulo?: string }).vagaTitulo}` : ""} — pronto pra admissão.`,
        em: String((c as { direcionadoAdmissaoEm?: string; createdAt?: string }).direcionadoAdmissaoEm || (c as { createdAt?: string }).createdAt || hoje),
        restauranteId: c.restaurantId, restauranteNome: nomePorRid[c.restaurantId] || "Restaurante",
        cta: "Ir pra admissão", href: `/r/${c.restaurantId}/processoSeletivo`,
        categoria: "Admissão", categoriaIcone: "🪪",
      });
    }

    // ── Governança de IA: cada pergunta fora do escopo vira um alerta ──
    for (const i of Object.values(iaAlertas).flat()) {
      const perg = String((i as { pergunta?: string }).pergunta || "");
      const motivo = String((i as { motivo?: string }).motivo || "");
      const nome = String((i as { pessoaNome?: string }).pessoaNome || "Alguém");
      const sev = String((i as { severidade?: string }).severidade || "baixa");
      const sevIcone = sev === "alta" ? "🔴" : sev === "media" ? "🟠" : "⚠️";
      out.push({
        id: `ia_${i.id}`, tipo: "ia_fora_escopo", icone: sevIcone,
        titulo: `Pergunta fora do escopo na IA${sev === "alta" ? " (alta)" : ""}`,
        descricao: `${nome} perguntou algo fora do escopo${motivo ? ` · ${motivo}` : ""}: “${perg.slice(0, 90)}${perg.length > 90 ? "…" : ""}”`,
        em: String((i as { createdAt?: string }).createdAt || ""),
        restauranteId: i.restaurantId, restauranteNome: nomePorRid[i.restaurantId] || "Restaurante",
        cta: "Ver registros", href: `/r/${i.restaurantId}/iaGovernanca`,
        categoria: "Governança de IA", categoriaIcone: "🛡️",
      });
    }

    // ── Wiki: minhas etapas por empresa (1 aviso por rid com etapas minhas) ──
    if (pessoa) {
      const resps = (x: { responsaveis?: string[]; responsavel?: string }) => x.responsaveis?.length ? x.responsaveis : (x.responsavel ? [x.responsavel] : []);
      for (const rid of pessoa.restaurantIds || []) {
        if (!canAcao(pessoa, rid, "wikiProcessos", "ver", perfis)) continue;
        const mapa = wikiCfgs[rid] || {};
        const manual = SETORES.filter(s => (mapa[s.id] || []).includes(pid)).map(s => s.id);
        const perfil = resolverPerfil((pessoa.profileIds as Record<string, string> | undefined)?.[rid], perfis);
        const meus = new Set<string>([...manual, ...(perfil?.wikiSetores || [])]);
        if (meus.size === 0) continue;
        let n = 0;
        for (const p of wikiProcs) {
          if (!(p.restaurantIds || []).includes(rid)) continue;
          for (const s of p.passos || []) if (resps(s).some(r => meus.has(r))) n++;
          for (const it of p.itens || []) if (resps(it).some(r => meus.has(r))) n++;
        }
        if (n === 0) continue;
        out.push({
          id: `wikietapas_${rid}_${n}`, tipo: "wiki_minhas_etapas", icone: "🙋",
          titulo: "Suas etapas na Wiki",
          descricao: `${n} ${n === 1 ? "etapa sob sua responsabilidade" : "etapas sob sua responsabilidade"} nos processos documentados`,
          em: EM_ALTO,
          restauranteId: rid, restauranteNome: nomePorRid[rid] || "Restaurante",
          cta: "Ver minhas etapas", href: `/r/${rid}/wikiProcessos`,
          categoria: "Wiki de Processos", categoriaIcone: "📚",
        });
      }
    }

    // ── Fechamento Financeiro: 1 card por item onde EU sou o responsável, na
    //    competência anterior/corrente, com pendência e data resolvida. ──
    if (pid && fechFinItens.length) {
      const meusRidsSet = new Set(restaurants.map((r) => r.id));
      for (const comp of [compDelta(-1), compDelta(0)]) {
        const cels = fechFinMeses[comp] || {};
        for (const it of fechFinItens) {
          if (it.responsavelId !== pid) continue;
          let pend = 0, total = 0;
          if (it.geral) { total = 1; if ((cels[`${it.id}__geral`]?.status) !== "recebido") pend = 1; }
          else {
            for (const e of fechFinAtivas) {
              if (it.aplica && it.aplica.length && !it.aplica.includes(e)) continue;
              total++; if ((cels[`${it.id}__${e}`]?.status) !== "recebido") pend++;
            }
          }
          if (total === 0 || pend === 0) continue;
          const em = resolverPrazoFech(it.prazoRef, comp);
          const restId = restaurants.find((r) => fechFinAtivas.includes(r.id) && (!it.aplica?.length || it.aplica.includes(r.id)))?.id
            || restaurants.find((r) => meusRidsSet.has(r.id))?.id || restaurants[0]?.id || "";
          if (!restId) continue;
          out.push({
            id: `fechfin_${comp}_${it.id}`,
            tipo: "fechamentoFin", icone: "🧮",
            titulo: `Fechamento · ${it.titulo}`,
            descricao: `${compLb(comp)} — ${it.geral ? "pendente" : `${pend} de ${total} empresa(s) pendente(s)`}`,
            em: em || "9999-99-99",
            restauranteId: restId, restauranteNome: nomePorRid[restId] || "—",
            cta: "Abrir Fechamento", href: `/r/${restId}/fechamentoFin`,
            categoria: "Fechamento Financeiro", categoriaIcone: "🧮",
          });
        }
      }
    }

    out.sort((a, b) => (b.em || "").localeCompare(a.em || ""));
    return out;
  }, [
    nomePorRid, restaurants, rotinas, conclusoesIds, pid, pessoa, perfis, wikiProcs, wikiCfgs,
    escala, faleDp, fechamento, gorjetas, vt, vr, beneficios,
    ocorrencias, eventos, recebimento, compras, ideias, admissoes, candidaturasNovas, demissoes, exames, uniformes,
    minhaAcao, minhaProducao, checklistTpl, checklistRun, cobrancasInt,
    reembReceber, reembPagos,
    iaAlertas, avisosDir, candidaturasAdmissao,
    falhas, prazosAv, fechFinItens, fechFinAtivas, fechFinMeses,
  ]);

  // ── Estado de leitura (overlay persistido por pessoa) ──
  // avisosLidos/{pessoaId} = { itens: { [avisoId]: emSnapshot } }.
  // Lido = existe snapshot E o aviso não teve atividade mais nova que ele
  // (agregado que ganha item novo → em avança → ressurge pra caixa de entrada).
  const [lidos, setLidos] = useState<Record<string, string>>({});
  const pessoaId = pessoa?.id || "";

  useEffect(() => {
    if (!pessoaId) { setLidos({}); return; }
    const ref = doc(db, "avisosLidos", pessoaId);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { itens?: Record<string, string> } | undefined;
        setLidos(data?.itens || {});
      },
      () => setLidos({}),
    );
  }, [pessoaId]);

  const api = useMemo<AvisosApi>(() => {
    // Gating in-app: some se a config do tipo desligou o canal in-app.
    // Rotinas (tipo "rotina") nunca são gated — são lembretes próprios da pessoa.
    const visivel = (a: Aviso) => {
      if (a.tipo === "rotina") return true;
      const key = `${a.restauranteId}_${configTipoDoCard(a.tipo)}`;
      return notifConfigs[key]?.inApp !== false;
    };
    const visiveis = todos.filter(visivel);
    const estaLido = (a: Aviso) => {
      if (a.tipo === "rotina") return false; // rotina some só quando concluída
      const snap = lidos[a.id];
      return snap != null && (a.em || "") <= snap;
    };
    const inbox = visiveis.filter((a) => !estaLido(a));
    const historico = visiveis.filter((a) => estaLido(a));

    const persistir = (next: Record<string, string>) => {
      setLidos(next); // otimista
      if (!pessoaId) return;
      void setDoc(
        doc(db, "avisosLidos", pessoaId),
        { pessoaId, itens: next, atualizadoEm: new Date().toISOString() },
        { merge: true },
      ).catch((e) => console.error("avisosLidos:", e));
    };

    return {
      todos: visiveis, inbox, historico,
      marcarLido: (a) => persistir({ ...lidos, [a.id]: a.em || EM_ALTO }),
      marcarNaoLido: (a) => {
        const next = { ...lidos };
        delete next[a.id];
        persistir(next);
      },
      marcarTodosLidos: () => {
        const next = { ...lidos };
        for (const a of inbox) next[a.id] = a.em || EM_ALTO;
        persistir(next);
      },
    };
  }, [todos, lidos, pessoaId, notifConfigs]);

  return <AvisosCtx.Provider value={api}>{children}</AvisosCtx.Provider>;
}
