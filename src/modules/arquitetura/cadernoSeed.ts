// Semente do Caderno — PENDÊNCIAS conhecidas por módulo (do histórico de trabalho).
// Só pendências (o que já foi feito não entra). A IA adiciona novas aqui conforme
// a gente trabalha; o estado (feito/pendente) e itens manuais vivem no Firestore.
// responsavel: "gustavo" (você) · "ia" (Claude) · ou nome livre.
import type { CadernoItem } from "../../core/types";

type Seed = { modulo: string; titulo: string; resp: "gustavo" | "ia" | string; descricao?: string };

const SEED: Seed[] = [
  // ── Geral / infra ──
  { modulo: "geral", resp: "gustavo", titulo: "Configurar credenciais do WhatsApp Cloud API na Vercel (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_WABA_ID)", descricao: "Sem isso, disparo automático e templates ficam inertes." },
  { modulo: "geral", resp: "ia", titulo: "Padronizar layout/botões dos módulos no core/ui (design system) — executar no gatilho 'bora unificação', piloto Análise de Ponto" },

  // ── Segurança Sanitária ──
  { modulo: "seguranca", resp: "gustavo", titulo: "Criar o template da lista-base, atribuir áreas dos itens e apagar as avaliações de teste antigas" },
  { modulo: "seguranca", resp: "gustavo", titulo: "Aprovar o template 'acesso_inicial' na Meta pra o disparo automático (hoje funciona pelo fallback manual)" },

  // ── Pessoas / onboarding ──
  { modulo: "pessoas", resp: "ia", titulo: "P3 do redesenho de Pessoas: fundir o EmpregadoModal no cadastro" },
  { modulo: "pessoas", resp: "ia", titulo: "Escalas nomeadas — Parte B: alternância de escala no empregado (Parte A/catálogo já feita)" },
  { modulo: "pessoas", resp: "gustavo", titulo: "Corrigir admissões placeholder (~30 empregados com admissão fake 01/04/2026) via CSV pra os prazos 45/90 baterem" },

  // ── WhatsApp ──
  { modulo: "whatsapp", resp: "ia", titulo: "Aplicar o Storage no ENVIO de mídia grande (hoje só o recebimento sobe pro Storage)" },
  { modulo: "whatsapp", resp: "ia", titulo: "Spam: pular a resposta automática/bot de triagem no webhook para contatos marcados como spam" },
  { modulo: "whatsapp", resp: "gustavo", titulo: "Travar o host da Evolution (device-link) antes do primeiro cliente" },

  // ── Prazos / aposentadoria dos módulos antigos ──
  { modulo: "prazos", resp: "gustavo", titulo: "Confirmar migração e então apagar as coleções legadas contasFixas/manutencoes do Firestore" },
  { modulo: "prazos", resp: "ia", titulo: "Aposentar o Planner (desacoplar ContaFixaForm/ManutencaoForm) e deletar as páginas legadas ContasFixas/Manutenções" },
  { modulo: "prazos", resp: "ia", titulo: "Remover no-op/dead code do módulo Admissão: gerarCascataAdmissao e recalcularPrazosExperiencia" },

  // ── Cardápio ──
  { modulo: "cardapio", resp: "ia", titulo: "Render do cardápio no site público + PDF de impressão + tradução EN por IA" },

  // ── Vendas ──
  { modulo: "vendas", resp: "ia", titulo: "Editar/excluir venda + PDF de cobrança" },

  // ── Recebimento ──
  { modulo: "recebimento", resp: "ia", titulo: "Fase 2: OCR (Haiku) da nota + export PDF/XLSX" },

  // ── Fichas Técnicas ──
  { modulo: "fichas", resp: "gustavo", titulo: "Definir as 5 decisões pendentes antes de codar a evolução das Fichas Técnicas" },

  // ── Fechamento de Caixa ──
  { modulo: "fechamentoCaixa", resp: "gustavo", titulo: "Configurar a pasta do Drive (agora sob a raiz) e os emails dos sócios" },

  // ── Agentes de IA ──
  { modulo: "agentes", resp: "ia", titulo: "F1b: motor api/agente + chat (F1a de gestão já no ar)" },

  // ── Reservas / Concierge ──
  { modulo: "reservas", resp: "ia", titulo: "Concierge IA no WhatsApp: ligar no webhook + cron + booking agent (Fase 1 de config no ar)" },

  // ── Escala ──
  { modulo: "escala", resp: "ia", titulo: "Solicitação de ajuste de escala: notificar o empregado quando aprovado/aplicado" },

  // ── Análise de ponto ──
  { modulo: "analise-ponto", resp: "ia", titulo: "Fechamento de ponto cockpit — Fase 2 (aba Inconsistências) e Fase 3 (correção in-app pelo empregado)" },
];

export const CADERNO_SEED: CadernoItem[] = SEED.map((s, i) => ({
  id: `seed_${s.modulo}_${i}`,
  moduloId: s.modulo,
  titulo: s.titulo,
  descricao: s.descricao,
  status: "pendente",
  responsavel: s.resp,
  criadoEm: "2026-07-21T00:00:00.000Z",
  ordem: i,
  origem: "seed",
}));
