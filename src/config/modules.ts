import type { ModuleDef } from "../core/types";

// Registry de todos os módulos do sistema.
// `status` indica em qual sprint estamos:
//   "ativo"    → implementado e usável
//   "em-breve" → próximo sprint
//   "planejado"→ depois
// `etapa` marca maturidade visual (badge ao lado do nome):
//   undefined        → estável, sem badge
//   "beta"           → funcional, ainda recebendo ajustes
//   "em_desenvolvimento" → pode mudar bastante / bugs esperados
//
// Pra "promover" um módulo a estável, apague a `etapa` dele. Pra rebaixar,
// adicione. Esse campo NÃO controla acesso — só visual.
export const MODULES: ModuleDef[] = [
  // ═══ ESCRITÓRIO (cinza) ═══
  // "Pessoas" agora unifica usuários do sistema + empregados (com filtros)
  // Cadastro de Cargos vive como sub-tab dentro de Pessoas
  { id: "pessoas",          area: "escritorio", label: "Pessoas",          icon: "👤", status: "ativo",     desc: "Pessoas, empregados, cargos e templates de permissão" },
  { id: "admissao",         area: "escritorio", label: "Admissão",         icon: "🪪", status: "ativo",     etapa: "beta",               desc: "Processo de admissão: formulário compartilhável + kanban", dependsOn: ["pessoas"] },
  { id: "uniformes",        area: "escritorio", label: "Uniformes & EPIs", icon: "🦺", status: "ativo",     etapa: "em_desenvolvimento", desc: "Catálogo, estoque, entregas e termos de uniformes e EPIs", dependsOn: ["pessoas"] },
  { id: "configuracoes",    area: "escritorio", label: "Configurações",    icon: "⚙️", status: "ativo",     desc: "Configurações do restaurante" },
  { id: "gorjetas",         area: "escritorio", label: "Gorjetas",         icon: "💸", status: "ativo",     etapa: "beta",               desc: "Lançamento e divisão de gorjetas",       dependsOn: ["pessoas", "escala"] },
  { id: "vt",               area: "escritorio", label: "Vale Transporte",  icon: "🚌", status: "ativo",     etapa: "beta",               desc: "VT, auxílios fixos e benefícios pontuais por empregado",              dependsOn: ["pessoas", "escala"] },
  { id: "vr",               area: "escritorio", label: "Vale Refeição",    icon: "🍱", status: "ativo",     etapa: "beta",               desc: "Vale Refeição diário — habilitar em modulosAtivos do restaurante que usa", dependsOn: ["pessoas", "escala"] },
  { id: "excecoes",         area: "escritorio", label: "Registros de Ponto",    icon: "🕐", status: "ativo",     etapa: "beta",               desc: "Cruzamento de ponto (Sólides) com Planejamento: inconformidades + compatibilidade de cadastros", dependsOn: ["escala", "pessoas"] },
  { id: "fechamentoEscala", area: "escritorio", label: "Fechamento Escala",icon: "🔒", status: "planejado", etapa: "em_desenvolvimento", desc: "Fechar escala mensal e ajustes",         dependsOn: ["escala", "gorjetas", "vt"] },
  { id: "compras",          area: "escritorio", label: "Compras",          icon: "🛒", status: "ativo",     etapa: "em_desenvolvimento", desc: "Pedidos baseados em contagens e padrões", dependsOn: ["contagens"] },
  { id: "comunicados",      area: "escritorio", label: "Comunicados",      icon: "📣", status: "ativo",     etapa: "em_desenvolvimento", desc: "Avisos e comunicados pra equipe", dependsOn: ["pessoas"] },
  { id: "sites",            area: "escritorio", label: "Sites",            icon: "🌐", status: "ativo",     etapa: "beta",               desc: "Site público do restaurante: história, horário, cardápio, forms" },
  { id: "recursos",         area: "escritorio", label: "Biblioteca",       icon: "📚", status: "planejado", etapa: "em_desenvolvimento", desc: "Documentos e wiki interna" },
  { id: "faleDp",           area: "escritorio", label: "Fale com DP",      icon: "💬", status: "planejado", etapa: "em_desenvolvimento", desc: "Canal anônimo / suporte ao funcionário", dependsOn: ["pessoas"] },

  // ═══ TIME (azul) ═══
  { id: "escala",           area: "time", label: "Escala",                icon: "📅", status: "ativo",     etapa: "beta",               desc: "Planejamento de escalas mensais",       dependsOn: ["pessoas"] },
  { id: "freelas",          area: "time", label: "Freelas",                icon: "🎒", status: "ativo",     etapa: "beta",               desc: "Cadastro, agendamento, lançamento e pagamento de freelas", dependsOn: ["pessoas", "escala"] },
  { id: "reunioes",         area: "time", label: "Reuniões",               icon: "🗣️", status: "ativo",     etapa: "em_desenvolvimento", desc: "Reuniões de líderes e equipe",          dependsOn: ["pessoas"] },
  { id: "trilha",           area: "time", label: "Trilha do Empregado",    icon: "🎯", status: "ativo",     etapa: "em_desenvolvimento", desc: "Desenvolvimento e histórico",            dependsOn: ["pessoas"] },
  { id: "ideias",           area: "time", label: "Banco de Ideias",        icon: "💡", status: "ativo",     etapa: "em_desenvolvimento", desc: "Ideias para discutir em reuniões",       dependsOn: ["reunioes"] },

  // ═══ OPERAÇÃO (laranja) ═══
  { id: "ocorrencias",      area: "operacao", label: "Ocorrências",        icon: "🚨", status: "ativo",     etapa: "em_desenvolvimento", desc: "Log de ocorrências do dia-a-dia",       dependsOn: ["pessoas"] },
  { id: "reservas",         area: "operacao", label: "Reservas + CRM",     icon: "🎫", status: "ativo",     etapa: "beta",               desc: "Reservas de mesa e base de clientes",    dependsOn: ["pessoas"] },
  { id: "horarios",         area: "operacao", label: "Horários",           icon: "🕒", status: "ativo",     etapa: "beta",               desc: "Horário semanal + datas especiais + janelas de reserva — fonte da verdade pro site e reservas" },
  { id: "eventos",          area: "operacao", label: "Eventos",            icon: "🎉", status: "ativo",     etapa: "em_desenvolvimento", desc: "Captação, propostas e BEO de eventos privados", dependsOn: ["pessoas"] },
  { id: "checklists",       area: "operacao", label: "Checklists",         icon: "✅", status: "ativo",     etapa: "em_desenvolvimento", desc: "Checklists operacionais",                dependsOn: ["pessoas"] },
  { id: "contagens",        area: "operacao", label: "Contagens",          icon: "📦", status: "ativo",     etapa: "em_desenvolvimento", desc: "Contagens de estoque",                   dependsOn: ["pessoas"] },
  { id: "temperaturas",     area: "operacao", label: "Temperaturas",       icon: "🌡️", status: "planejado", etapa: "em_desenvolvimento", desc: "Monitoramento e alertas" },
  { id: "fichas",           area: "operacao", label: "Fichas Técnicas",    icon: "📋", status: "planejado", etapa: "em_desenvolvimento", desc: "Receitas e custo de pratos",             dependsOn: ["compras"] },
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
