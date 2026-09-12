// Catálogo das notificações de SISTEMA (avisos derivados de condição) que o
// painel "Rotinas e Avisos" controla. Cada tipo vira uma linha configurável.
//
// `email`/`whatsapp` = estado do canal: "live" (disparo já implementado) ou
// "soon" (configurável, mas o disparo entra na Fase 3). In-app é sempre live.
import { CheckSquare, Target, CalendarDays, TriangleAlert, PartyPopper, Package, ShoppingCart, Stethoscope, Shirt, UserRoundPlus, UserRoundMinus, Lightbulb, MessagesSquare, Coins, Bus, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ModuleId } from "../../core/types";

export type CanalEstado = "live" | "soon";
export type AvisoCatalogoItem = {
  tipo: string;            // chave de config (id = `${rid}_${tipo}`)
  label: string;
  modulo: ModuleId;        // pra só mostrar se o módulo está ativo no restaurante
  quando: string;          // texto curto "quando existe"
  email: CanalEstado;
  whatsapp: CanalEstado;
};

export const AVISO_CATALOGO: AvisoCatalogoItem[] = [
  { tipo: "checklists",     label: "Checklists do dia",   modulo: "checklists",     quando: "Checklist do turno pendente hoje",   email: "soon", whatsapp: "soon" },
  { tipo: "planoDeAcao",    label: "Plano de Ação",       modulo: "planoDeAcao",    quando: "Ação sua aberta / produção atribuída", email: "soon", whatsapp: "soon" },
  { tipo: "escala",         label: "Escala",              modulo: "escala",         quando: "Ajuste solicitado pelo empregado",    email: "soon", whatsapp: "soon" },
  { tipo: "ocorrencias",    label: "Ocorrências",         modulo: "ocorrencias",    quando: "Ocorrência em aberto",                email: "soon", whatsapp: "soon" },
  { tipo: "eventos",        label: "Eventos",             modulo: "eventos",        quando: "Novo lead de evento",                 email: "soon", whatsapp: "soon" },
  { tipo: "recebimento",    label: "Recebimento",         modulo: "recebimento",    quando: "Nota aguardando conferência",         email: "soon", whatsapp: "soon" },
  { tipo: "compras",        label: "Compras",             modulo: "compras",        quando: "Pedido em aberto",                    email: "soon", whatsapp: "soon" },
  { tipo: "exames",         label: "Exames médicos",      modulo: "exames",         quando: "Exame vencendo/vencido",              email: "soon", whatsapp: "soon" },
  { tipo: "uniformes",      label: "Uniformes & EPIs",    modulo: "uniformes",      quando: "Item vencendo/vencido",               email: "soon", whatsapp: "soon" },
  { tipo: "admissao",       label: "Admissão",            modulo: "admissao",       quando: "Admissão em andamento",               email: "soon", whatsapp: "soon" },
  { tipo: "demissao",       label: "Demissão",            modulo: "demissao",       quando: "Processo em andamento",               email: "soon", whatsapp: "soon" },
  { tipo: "ideias",         label: "Ideias",              modulo: "ideias",         quando: "Ideia nova pra avaliar",              email: "soon", whatsapp: "soon" },
  { tipo: "faleDp",         label: "Fale com DP",         modulo: "portalEmpregado", quando: "Mensagem nova ao DP",                 email: "soon", whatsapp: "soon" },
  { tipo: "gorjetas",       label: "Gorjetas",            modulo: "gorjetas",       quando: "Dia publicado a pagar",               email: "soon", whatsapp: "soon" },
  { tipo: "vt",             label: "Vale Transporte",     modulo: "vt",             quando: "Lote aguardando pagamento",           email: "soon", whatsapp: "soon" },
  { tipo: "vr",             label: "Vale Refeição",       modulo: "vr",             quando: "Lote aguardando pagamento",           email: "soon", whatsapp: "soon" },
];

// Ícone lucide por tipo de aviso (render como <Icone/>). Mapa paralelo — sem JSX no .ts.
export const AVISO_ICON: Record<string, LucideIcon> = {
  checklists: CheckSquare, planoDeAcao: Target, escala: CalendarDays, ocorrencias: TriangleAlert,
  eventos: PartyPopper, recebimento: Package, compras: ShoppingCart, exames: Stethoscope,
  uniformes: Shirt, admissao: UserRoundPlus, demissao: UserRoundMinus, ideias: Lightbulb,
  faleDp: MessagesSquare, gorjetas: Coins, vt: Bus, vr: UtensilsCrossed,
};

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
