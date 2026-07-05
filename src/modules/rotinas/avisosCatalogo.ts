// Catálogo das notificações de SISTEMA (avisos derivados de condição) que o
// painel "Rotinas e Avisos" controla. Cada tipo vira uma linha configurável.
//
// `email`/`whatsapp` = estado do canal: "live" (disparo já implementado) ou
// "soon" (configurável, mas o disparo entra na Fase 3). In-app é sempre live.
import type { ModuleId } from "../../core/types";

export type CanalEstado = "live" | "soon";
export type AvisoCatalogoItem = {
  tipo: string;            // chave de config (id = `${rid}_${tipo}`)
  label: string;
  icone: string;
  modulo: ModuleId;        // pra só mostrar se o módulo está ativo no restaurante
  quando: string;          // texto curto "quando existe"
  email: CanalEstado;
  whatsapp: CanalEstado;
};

export const AVISO_CATALOGO: AvisoCatalogoItem[] = [
  { tipo: "checklists",     label: "Checklists do dia",   icone: "✅", modulo: "checklists",     quando: "Checklist do turno pendente hoje",   email: "soon", whatsapp: "soon" },
  { tipo: "planoDeAcao",    label: "Plano de Ação",       icone: "🎯", modulo: "planoDeAcao",    quando: "Ação sua aberta / produção atribuída", email: "soon", whatsapp: "soon" },
  { tipo: "escala",         label: "Escala",              icone: "📅", modulo: "escala",         quando: "Ajuste solicitado pelo empregado",    email: "soon", whatsapp: "soon" },
  { tipo: "ocorrencias",    label: "Ocorrências",         icone: "⚠️", modulo: "ocorrencias",    quando: "Ocorrência em aberto",                email: "soon", whatsapp: "soon" },
  { tipo: "eventos",        label: "Eventos",             icone: "🎉", modulo: "eventos",        quando: "Novo lead de evento",                 email: "soon", whatsapp: "soon" },
  { tipo: "recebimento",    label: "Recebimento",         icone: "📦", modulo: "recebimento",    quando: "Nota aguardando conferência",         email: "soon", whatsapp: "soon" },
  { tipo: "compras",        label: "Compras",             icone: "🛒", modulo: "compras",        quando: "Pedido em aberto",                    email: "soon", whatsapp: "soon" },
  { tipo: "exames",         label: "Exames médicos",      icone: "🩺", modulo: "exames",         quando: "Exame vencendo/vencido",              email: "soon", whatsapp: "soon" },
  { tipo: "uniformes",      label: "Uniformes & EPIs",    icone: "👕", modulo: "uniformes",      quando: "Item vencendo/vencido",               email: "soon", whatsapp: "soon" },
  { tipo: "admissao",       label: "Admissão",            icone: "🧳", modulo: "admissao",       quando: "Admissão em andamento",               email: "soon", whatsapp: "soon" },
  { tipo: "demissao",       label: "Demissão",            icone: "👋", modulo: "demissao",       quando: "Processo em andamento",               email: "soon", whatsapp: "soon" },
  { tipo: "ideias",         label: "Ideias",              icone: "💡", modulo: "ideias",         quando: "Ideia nova pra avaliar",              email: "soon", whatsapp: "soon" },
  { tipo: "faleDp",         label: "Fale com DP",         icone: "🗣️", modulo: "portalEmpregado", quando: "Mensagem nova ao DP",                 email: "soon", whatsapp: "soon" },
  { tipo: "gorjetas",       label: "Gorjetas",            icone: "💸", modulo: "gorjetas",       quando: "Dia publicado a pagar",               email: "soon", whatsapp: "soon" },
  { tipo: "vt",             label: "Vale Transporte",     icone: "🚌", modulo: "vt",             quando: "Lote aguardando pagamento",           email: "soon", whatsapp: "soon" },
  { tipo: "vr",             label: "Vale Refeição",       icone: "🍽️", modulo: "vr",             quando: "Lote aguardando pagamento",           email: "soon", whatsapp: "soon" },
];

// Mapeia o `tipo` do card da Central (useAvisos) → `tipo` de config.
// Cards que não constam aqui usam o próprio tipo.
const CARD_PARA_CONFIG: Record<string, string> = {
  escala_solicitacao: "escala",
  fale_dp: "faleDp",
  acoes: "planoDeAcao",
  producao_atribuida: "planoDeAcao",
  beneficios: "beneficios",
};
export const configTipoDoCard = (cardTipo: string): string => CARD_PARA_CONFIG[cardTipo] || cardTipo;
