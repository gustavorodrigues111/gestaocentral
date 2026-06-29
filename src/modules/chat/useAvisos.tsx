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

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { useAvisoSource, type AvisoDoc } from "./useAvisoSource";
import type { FaleDpMensagem } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE } from "../../core/types";

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

const AvisosCtx = createContext<Aviso[]>([]);
export const useAvisos = () => useContext(AvisosCtx);

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

  const avisos = useMemo<Aviso[]>(() => {
    const out: Aviso[] = [];
    const hoje = new Date().toISOString().slice(0, 10);
    const limite30 = addDiasYmd(hoje, 30);

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
    nomePorRid, escala, faleDp, fechamento, gorjetas, vt, vr, beneficios,
    ocorrencias, eventos, recebimento, compras, ideias, admissoes, demissoes, exames, uniformes,
  ]);

  return <AvisosCtx.Provider value={avisos}>{children}</AvisosCtx.Provider>;
}
