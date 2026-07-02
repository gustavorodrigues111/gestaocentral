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
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { useAvisoSource, type AvisoDoc } from "./useAvisoSource";
import type { FaleDpMensagem, Rotina, RotinaConclusao } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE } from "../../core/types";
import { pendentesParaPessoa } from "../rotinas/repository";
import { recorrenciaLabel } from "../rotinas/rotinasEngine";
import { deepLinkRotina } from "../rotinas/subDestinos";

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
  const [, m, d] = String(ymd).split("-");
  return d ? `${d}/${m}` : String(ymd);
};
function addDiasYmd(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

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

  // ── Fontes agregadas — Pessoas & DP ──
  const ideias = useAvisoSource({ ...base,
    gates: [["ideias", "receberAvisos"]], collectionName: "ideias", filtros: [["status", "==", "aberta"]] });
  const admissoes = useAvisoSource({ ...base,
    gates: [["admissao", "receberAvisos"]], collectionName: "admissoes" });
  const demissoes = useAvisoSource({ ...base,
    gates: [["demissao", "receberAvisos"]], collectionName: "processosDemissao" });
  const exames = useAvisoSource({ ...base,
    gates: [["exames", "receberAvisos"]], collectionName: "examesEmpregado", filtros: [["ativo", "==", true]] });
  const uniformes = useAvisoSource({ ...base,
    gates: [["uniformes", "receberAvisos"]], collectionName: "entregasUniforme" });

  const todos = useMemo<Aviso[]>(() => {
    const out: Aviso[] = [];
    const hoje = new Date().toISOString().slice(0, 10);
    const limite30 = addDiasYmd(hoje, 30);

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

    out.sort((a, b) => (b.em || "").localeCompare(a.em || ""));
    return out;
  }, [
    nomePorRid, rotinas, conclusoesIds, pid,
    escala, faleDp, fechamento, gorjetas, vt, vr, beneficios,
    ocorrencias, eventos, recebimento, compras, ideias, admissoes, demissoes, exames, uniformes,
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
    const estaLido = (a: Aviso) => {
      if (a.tipo === "rotina") return false; // rotina some só quando concluída
      const snap = lidos[a.id];
      return snap != null && (a.em || "") <= snap;
    };
    const inbox = todos.filter((a) => !estaLido(a));
    const historico = todos.filter((a) => estaLido(a));

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
      todos, inbox, historico,
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
  }, [todos, lidos, pessoaId]);

  return <AvisosCtx.Provider value={api}>{children}</AvisosCtx.Provider>;
}
