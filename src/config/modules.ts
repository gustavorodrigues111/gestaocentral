import type { ModuleDef, ModuleArea } from "../core/types";

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
// Organização por PERSONA (quem usa): Operação · Pessoas & DP · Financeiro ·
// Institucional. A ordem do array define a ordem no menu dentro de cada grupo.
// `oculto: true` = fora do menu (não pronto ou em transição pro Benefícios).
export const MODULES: ModuleDef[] = [
  // ═══ 🍽️ OPERAÇÃO ═══
  { id: "reservas",    area: "ops", label: "Reservas + CRM",     icon: "🎫", status: "ativo", etapa: "beta",               desc: "Reservas de mesa e base de clientes", dependsOn: ["pessoas"] },
  { id: "eventos",     area: "ops", label: "Eventos",            icon: "🎉", status: "ativo", etapa: "em_desenvolvimento", desc: "Captação, propostas e BEO de eventos privados", dependsOn: ["pessoas"] },
  { id: "checklists",  area: "ops", label: "Checklists",         icon: "✅", status: "ativo", etapa: "em_desenvolvimento", desc: "Checklists operacionais", dependsOn: ["pessoas"] },
  { id: "contagens",   area: "ops", label: "Contagens",          icon: "📦", status: "ativo", etapa: "em_desenvolvimento", desc: "Contagens de estoque", dependsOn: ["pessoas"] },
  { id: "compras",     area: "ops", label: "Compras",            icon: "🛒", status: "ativo", etapa: "em_desenvolvimento", desc: "Pedidos baseados em contagens e padrões", dependsOn: ["contagens"] },
  { id: "ocorrencias", area: "ops", label: "Ocorrências",        icon: "🚨", status: "ativo", etapa: "em_desenvolvimento", desc: "Log de ocorrências do dia-a-dia", dependsOn: ["pessoas"] },
  { id: "horarios",    area: "ops", label: "Horários",           icon: "🕒", status: "ativo", etapa: "beta",               desc: "Horário semanal + datas especiais + janelas de reserva" },
  { id: "reunioes",    area: "ops", label: "Reuniões",           icon: "🗣️", status: "ativo", etapa: "em_desenvolvimento", desc: "Reuniões de líderes e equipe", dependsOn: ["pessoas"] },
  { id: "ideias",      area: "ops", label: "Banco de Ideias",    icon: "💡", status: "ativo", etapa: "em_desenvolvimento", desc: "Ideias para discutir em reuniões", dependsOn: ["reunioes"] },
  { id: "freelas",     area: "ops", label: "Freelas",            icon: "🎒", status: "ativo", etapa: "beta",               desc: "Cadastro, agendamento, lançamento e pagamento de freelas", dependsOn: ["pessoas", "escala"] },
  // não prontos (operação) — fora do menu
  { id: "temperaturas", area: "ops", label: "Temperaturas",      icon: "🌡️", status: "planejado", etapa: "em_desenvolvimento", desc: "Monitoramento e alertas", oculto: true },
  { id: "fichas",       area: "ops", label: "Fichas Técnicas",   icon: "📋", status: "planejado", etapa: "em_desenvolvimento", desc: "Receitas e custo de pratos", dependsOn: ["compras"], oculto: true },

  // ═══ 👥 PESSOAS & DP ═══
  { id: "pessoas",     area: "dp", label: "Pessoas",             icon: "👤", status: "ativo", desc: "Pessoas, empregados, cargos e templates de permissão" },
  { id: "admissao",    area: "dp", label: "Admissão",            icon: "🪪", status: "ativo", etapa: "beta",               desc: "Processo de admissão: formulário compartilhável + kanban", dependsOn: ["pessoas"] },
  { id: "escala",      area: "dp", label: "Escala",              icon: "📅", status: "ativo", etapa: "beta",               desc: "Planejamento de escalas mensais", dependsOn: ["pessoas"] },
  { id: "uniformes",   area: "dp", label: "Uniformes & EPIs",    icon: "🦺", status: "ativo", etapa: "em_desenvolvimento", desc: "Catálogo, estoque, entregas e termos de uniformes e EPIs", dependsOn: ["pessoas"] },
  { id: "exames",      area: "dp", label: "Exames Médicos",      icon: "🩺", status: "ativo", etapa: "beta",               desc: "Exames periódicos dos empregados (Clínico, Complementar, Coprocultura) com fluxo de agendamento, acompanhamento e baixa", dependsOn: ["pessoas"] },
  { id: "comunicados", area: "dp", label: "Comunicados",         icon: "📣", status: "ativo", etapa: "em_desenvolvimento", desc: "Avisos e comunicados pra equipe", dependsOn: ["pessoas"] },
  { id: "trilha",      area: "dp", label: "Trilha do Empregado", icon: "🎯", status: "ativo", etapa: "em_desenvolvimento", desc: "Desenvolvimento e histórico", dependsOn: ["pessoas"] },
  { id: "excecoes",    area: "dp", label: "Registros de Ponto",  icon: "🕐", status: "ativo", etapa: "beta",               desc: "Cruzamento de ponto (Sólides) com Planejamento", dependsOn: ["escala", "pessoas"] },
  // não prontos / não-módulo (dp) — fora do menu
  { id: "fechamentoEscala", area: "dp", label: "Fechamento Escala", icon: "🔒", status: "planejado", etapa: "em_desenvolvimento", desc: "Não é módulo — já é função dentro da Escala (fechar prevista/praticada)", dependsOn: ["escala", "gorjetas"], oculto: true },
  { id: "faleDp",      area: "dp", label: "Fale com DP",         icon: "💬", status: "planejado", etapa: "em_desenvolvimento", desc: "Canal anônimo / suporte ao funcionário", dependsOn: ["pessoas"], oculto: true },

  // ═══ 💰 FINANCEIRO ═══
  { id: "beneficios",  area: "fin", label: "Benefícios",         icon: "🎁", status: "ativo", etapa: "beta", desc: "Lote único de VT (Mobilidade) + VR (Refeição) + auxílio fixo, com 1 CSV pro Caju. Vigente de junho/2026.", dependsOn: ["pessoas", "escala"] },
  { id: "gorjetas",    area: "fin", label: "Gorjetas",           icon: "💸", status: "ativo", etapa: "beta", desc: "Lançamento e divisão de gorjetas", dependsOn: ["pessoas", "escala"] },
  // VT e VR: visíveis até o cutover de Benefícios (Fase 4 — permissões + parida-
  // de + histórico). Não escondi ainda pra não cortar acesso de não-master nem
  // ao histórico pré-junho. Vão virar `oculto: true` no cutover.
  { id: "vt",          area: "fin", label: "Vale Transporte",    icon: "🚌", status: "ativo", etapa: "beta", desc: "VT por empregado (migrando pra Benefícios)", dependsOn: ["pessoas", "escala"] },
  { id: "vr",          area: "fin", label: "Vale Refeição",      icon: "🍱", status: "ativo", etapa: "beta", desc: "VR diário (migrando pra Benefícios)", dependsOn: ["pessoas", "escala"] },

  // ═══ 📋 GESTOR DE TAREFAS + CADASTROS MESTRES ═══
  // Tarefas é cross-area (operação + DP + financeiro + diretoria todos usam).
  // Pertence visualmente a "ops" pra ficar no topo da sidebar como item-pivô.
  // Contas Fixas e Manutenções moram em "fin" — são módulos financeiros que
  // GERAM tarefas. A tarefa só visualiza/executa.
  { id: "tarefas",     area: "ops", label: "Tarefas",            icon: "📋", status: "ativo", etapa: "beta", desc: "Gestor de Tarefas: rotinas e demandas, caixa por usuário, cascatas dos cadastros mestres" },
  { id: "contasFixas", area: "fin", label: "Contas Fixas",       icon: "💵", status: "ativo", etapa: "beta", desc: "Cadastro mestre de pagamentos recorrentes (aluguel, sistemas, impostos). Gera lembretes no Gestor de Tarefas." },
  { id: "manutencoes", area: "ops", label: "Manutenções & Licenças", icon: "🛠️", status: "ativo", etapa: "beta", desc: "Cadastro mestre de manutenções e licenças (potabilidade, dedetização, CLCB, alvarás). Gera lembretes no Gestor de Tarefas." },

  // ═══ 🌐 INSTITUCIONAL / CONFIG ═══
  { id: "sites",          area: "inst", label: "Sites",          icon: "🌐", status: "ativo", etapa: "beta", desc: "Site público do restaurante: história, horário, cardápio, forms" },
  { id: "configuracoes",  area: "inst", label: "Configurações",  icon: "⚙️", status: "ativo", desc: "Configurações do restaurante" },
  // não pronto (institucional) — fora do menu
  { id: "recursos",       area: "inst", label: "Biblioteca",     icon: "📚", status: "planejado", etapa: "em_desenvolvimento", desc: "Documentos e wiki interna", oculto: true },
];

export const AREA_INFO = {
  ops:  { label: "Operação",               color: "#d4a017", desc: "Quem toca o restaurante no dia a dia" },
  dp:   { label: "Pessoas & DP",           color: "#3b82f6", desc: "RH, admissão, escala e desenvolvimento" },
  fin:  { label: "Financeiro",             color: "#10b981", desc: "Benefícios, gorjetas e pagamentos" },
  inst: { label: "Institucional / Config", color: "#8b5cf6", desc: "Site público e configurações" },
} as const;

// Helpers
export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find(m => m.id === id);
}
export function modulesByArea(area: ModuleArea): ModuleDef[] {
  return MODULES.filter(m => m.area === area);
}
