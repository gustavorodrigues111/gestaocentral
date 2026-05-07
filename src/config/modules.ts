import type { ModuleDef } from "../core/types";

// Registry de todos os módulos do sistema.
// `status` indica em qual sprint estamos:
//   "ativo"    → implementado e usável
//   "em-breve" → próximo sprint
//   "planejado"→ depois
export const MODULES: ModuleDef[] = [
  // ═══ ESCRITÓRIO (cinza) ═══
  // "Pessoas" agora unifica usuários do sistema + empregados (com filtros)
  // Cadastro de Cargos vive como sub-tab dentro de Pessoas
  { id: "pessoas",          area: "escritorio", label: "Pessoas",          icon: "👤", status: "ativo",     desc: "Pessoas, empregados, cargos e templates de permissão" },
  { id: "configuracoes",    area: "escritorio", label: "Configurações",    icon: "⚙️", status: "ativo",     desc: "Configurações do restaurante" },
  { id: "gorjetas",         area: "escritorio", label: "Gorjetas",         icon: "💸", status: "ativo",     desc: "Lançamento e divisão de gorjetas",       dependsOn: ["pessoas", "escala"] },
  { id: "vt",               area: "escritorio", label: "Vale Transporte",  icon: "🚌", status: "ativo",     desc: "Cálculo e pagamento de VT",              dependsOn: ["pessoas", "escala"] },
  { id: "fechamentoEscala", area: "escritorio", label: "Fechamento Escala",icon: "🔒", status: "planejado", desc: "Fechar escala mensal e ajustes",         dependsOn: ["escala", "gorjetas", "vt"] },
  { id: "compras",          area: "escritorio", label: "Compras",          icon: "🛒", status: "planejado", desc: "Pedidos baseados em contagens e padrões", dependsOn: ["contagens"] },
  { id: "comunicados",      area: "escritorio", label: "Comunicados",      icon: "📣", status: "ativo",     desc: "Avisos e comunicados pra equipe", dependsOn: ["pessoas"] },
  { id: "recursos",         area: "escritorio", label: "Biblioteca",       icon: "📚", status: "planejado", desc: "Documentos e wiki interna" },
  { id: "faleDp",           area: "escritorio", label: "Fale com DP",      icon: "💬", status: "planejado", desc: "Canal anônimo / suporte ao funcionário", dependsOn: ["pessoas"] },

  // ═══ TIME (azul) ═══
  { id: "escala",           area: "time", label: "Escala",                icon: "📅", status: "ativo",     desc: "Planejamento de escalas mensais",       dependsOn: ["pessoas"] },
  { id: "freelas",          area: "time", label: "Freelas",                icon: "🎒", status: "planejado", desc: "Controle de freelas",                   dependsOn: ["pessoas", "escala"] },
  { id: "reunioes",         area: "time", label: "Reuniões",               icon: "🗣️", status: "ativo",     desc: "Reuniões de líderes e equipe",          dependsOn: ["pessoas"] },
  { id: "trilha",           area: "time", label: "Trilha do Empregado",    icon: "🎯", status: "ativo",     desc: "Desenvolvimento e histórico",            dependsOn: ["pessoas"] },
  { id: "ideias",           area: "time", label: "Banco de Ideias",        icon: "💡", status: "ativo",     desc: "Ideias para discutir em reuniões",       dependsOn: ["reunioes"] },

  // ═══ OPERAÇÃO (laranja) ═══
  { id: "ocorrencias",      area: "operacao", label: "Ocorrências",        icon: "🚨", status: "ativo",     desc: "Log de ocorrências do dia-a-dia",       dependsOn: ["pessoas"] },
  { id: "reservas",         area: "operacao", label: "Reservas + CRM",     icon: "🎫", status: "planejado", desc: "Reservas de mesa e base de clientes",    dependsOn: ["pessoas"] },
  { id: "checklists",       area: "operacao", label: "Checklists",         icon: "✅", status: "ativo",     desc: "Checklists operacionais",                dependsOn: ["pessoas"] },
  { id: "contagens",        area: "operacao", label: "Contagens",          icon: "📦", status: "planejado", desc: "Contagens de estoque",                   dependsOn: ["pessoas"] },
  { id: "temperaturas",     area: "operacao", label: "Temperaturas",       icon: "🌡️", status: "planejado", desc: "Monitoramento e alertas" },
  { id: "fichas",           area: "operacao", label: "Fichas Técnicas",    icon: "📋", status: "planejado", desc: "Receitas e custo de pratos",             dependsOn: ["compras"] },
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
