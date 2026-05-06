import type { ModuleDef } from "../core/types";

// Registry de todos os módulos do sistema.
// `status` indica em qual sprint estamos:
//   "ativo"    → implementado e usável
//   "em-breve" → próximo sprint
//   "planejado"→ depois
export const MODULES: ModuleDef[] = [
  // ═══ ESCRITÓRIO (cinza) ═══
  { id: "pessoas",          area: "escritorio", label: "Pessoas",          icon: "👤", status: "ativo",     desc: "Cadastro de pessoas, vínculos e permissões" },
  { id: "configuracoes",    area: "escritorio", label: "Configurações",    icon: "⚙️", status: "ativo",     desc: "Configurações do restaurante" },
  { id: "gorjetas",         area: "escritorio", label: "Gorjetas",         icon: "💸", status: "em-breve",  desc: "Lançamento e divisão de gorjetas" },
  { id: "vt",               area: "escritorio", label: "Vale Transporte",  icon: "🚌", status: "em-breve",  desc: "Cálculo e pagamento de VT" },
  { id: "fechamentoEscala", area: "escritorio", label: "Fechamento Escala",icon: "🔒", status: "planejado", desc: "Fechar escala mensal e ajustes" },
  { id: "compras",          area: "escritorio", label: "Compras",          icon: "🛒", status: "planejado", desc: "Pedidos baseados em contagens e padrões" },
  { id: "recursos",         area: "escritorio", label: "Biblioteca",       icon: "📚", status: "planejado", desc: "Documentos e wiki interna" },
  { id: "faleDp",           area: "escritorio", label: "Fale com DP",      icon: "💬", status: "planejado", desc: "Canal anônimo / suporte ao funcionário" },

  // ═══ TIME (azul) ═══
  { id: "escala",           area: "time", label: "Escala",                icon: "📅", status: "planejado", desc: "Planejamento de escalas" },
  { id: "freelas",          area: "time", label: "Freelas",                icon: "🎒", status: "planejado", desc: "Controle de freelas" },
  { id: "reunioes",         area: "time", label: "Reuniões",               icon: "🗣️", status: "planejado", desc: "Reuniões de líderes e equipe" },
  { id: "trilha",           area: "time", label: "Trilha do Empregado",    icon: "🎯", status: "planejado", desc: "Desenvolvimento e histórico" },
  { id: "ideias",           area: "time", label: "Banco de Ideias",        icon: "💡", status: "planejado", desc: "Ideias para discutir em reuniões" },

  // ═══ OPERAÇÃO (laranja) ═══
  { id: "ocorrencias",      area: "operacao", label: "Ocorrências",        icon: "🚨", status: "planejado", desc: "Log de ocorrências do dia-a-dia" },
  { id: "reservas",         area: "operacao", label: "Reservas + CRM",     icon: "🎫", status: "planejado", desc: "Reservas de mesa e base de clientes" },
  { id: "checklists",       area: "operacao", label: "Checklists",         icon: "✅", status: "planejado", desc: "Checklists operacionais" },
  { id: "contagens",        area: "operacao", label: "Contagens",          icon: "📦", status: "planejado", desc: "Contagens de estoque" },
  { id: "temperaturas",     area: "operacao", label: "Temperaturas",       icon: "🌡️", status: "planejado", desc: "Monitoramento e alertas" },
  { id: "fichas",           area: "operacao", label: "Fichas Técnicas",    icon: "📋", status: "planejado", desc: "Receitas e custo de pratos" },
];

export const AREA_INFO = {
  operacao:   { label: "Operação",   color: "#d4a017", desc: "Atividade ao vivo no restaurante" },
  time:       { label: "Time",        color: "#3b82f6", desc: "Gestão de pessoas e desenvolvimento" },
  escritorio: { label: "Escritório",  color: "#64748b", desc: "Administração, financeiro, configuração" },
} as const;

// Helpers
export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find(m => m.id === id);
}
export function modulesByArea(area: "operacao" | "time" | "escritorio"): ModuleDef[] {
  return MODULES.filter(m => m.area === area);
}
