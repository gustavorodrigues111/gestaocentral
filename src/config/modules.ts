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
// `subarea` agrupa módulos relacionados dentro da área (dividers no Sidebar).
// A ordem das subáreas no menu segue a ordem do primeiro módulo de cada uma
// no array MODULES.
//
// `oculto: true` = fora do menu (não pronto ou em transição).
export const MODULES: ModuleDef[] = [
  // ═══ 🍽️ OPERAÇÃO ═══

  // ── Atendimento ao cliente ───────────────────────────────────────
  { id: "reservas",    area: "ops", subarea: "Atendimento ao Cliente", label: "Reservas + CRM",  icon: "🎫", status: "ativo", etapa: "beta",               desc: "Reservas de mesa e base de clientes", dependsOn: ["pessoas"] },
  { id: "horarios",    area: "ops", subarea: "Atendimento ao Cliente", label: "Funcionamento da casa", icon: "🏠", status: "ativo", etapa: "beta",        desc: "Horário de funcionamento + datas especiais + janelas de reserva" },
  { id: "eventos",     area: "ops", subarea: "Atendimento ao Cliente", label: "Eventos",         icon: "🎉", status: "ativo", etapa: "beta",               desc: "Captação, propostas e BEO de eventos privados", dependsOn: ["pessoas"] },

  // ── Produção & Estoque ───────────────────────────────────────────
  { id: "checklists",  area: "ops", subarea: "Produção & Estoque",     label: "Checklists",      icon: "✅", status: "ativo", etapa: "beta",               desc: "Checklists operacionais", dependsOn: ["pessoas"] },
  { id: "contagens",   area: "ops", subarea: "Produção & Estoque",     label: "Contagens",       icon: "📦", status: "ativo", etapa: "em_desenvolvimento", desc: "Contagens de estoque", dependsOn: ["pessoas"] },
  { id: "compras",     area: "ops", subarea: "Produção & Estoque",     label: "Compras",         icon: "🛒", status: "ativo", etapa: "em_desenvolvimento", desc: "Pedidos baseados em contagens e padrões", dependsOn: ["contagens"] },
  { id: "recebimento", area: "ops", subarea: "Produção & Estoque",     label: "Recebimento",     icon: "🧾", status: "ativo", etapa: "beta"               , desc: "Conferência e recebimento de produtos: digitaliza a nota fiscal (OCR), registra conformidade/divergência e arquiva no Drive por semana" },
  { id: "fechamentoCaixa", area: "ops", subarea: "Gestão da Operação", label: "Fechamento de Caixa", icon: "💵", status: "ativo", etapa: "beta"               , desc: "Fechamento de caixa por turno: anexos no Drive (dia/turno) e email aos sócios" },

  // ── Gestão da Operação ───────────────────────────────────────────
  { id: "ocorrencias", area: "ops", subarea: "Gestão da Operação",     label: "Ocorrências",     icon: "🚨", status: "ativo", etapa: "beta",               desc: "Log de ocorrências do dia-a-dia", dependsOn: ["pessoas"] },
  { id: "reunioes",    area: "ops", subarea: "Gestão da Operação",     label: "Reuniões",        icon: "🗣️", status: "ativo", etapa: "beta",               desc: "Reuniões de líderes e equipe", dependsOn: ["pessoas"] },
  { id: "ideias",      area: "ops", subarea: "Gestão da Operação",     label: "Banco de Ideias", icon: "💡", status: "ativo", etapa: "beta",               desc: "Ideias para discutir em reuniões", dependsOn: ["reunioes"] },
  { id: "rotinas",     area: "ops", subarea: "Gestão da Operação",     label: "Rotinas",         icon: "🔁", status: "ativo", etapa: "beta",               desc: "Lembretes recorrentes atribuídos a pessoas — aparecem na Central de Avisos no dia devido. Os canais (email/WhatsApp) se configuram na Central de Avisos › Configurações", dependsOn: ["pessoas"] },
  { id: "planoDeAcao", area: "ops", subarea: "Gestão da Operação",     label: "Plano de Ação",   icon: "🎯", status: "ativo", etapa: "beta",               desc: "Ações com responsável, prazo e status — nascem avulsas ou de ocorrências, ideias e reuniões; alimentam a Central de Avisos", dependsOn: ["pessoas"] },
  { id: "wikiProcessos", area: "ops", subarea: "Gestão da Operação",   label: "Wiki de Processos", icon: "📚", status: "ativo", etapa: "em_desenvolvimento", desc: "Documentação viva dos processos internos por área — texto, checklist ou passo-a-passo, com fotos. Consulta da equipe em caso de dúvida." },
  { id: "whatsappInbox", area: "dp", subarea: "Operação Diária",       label: "WhatsApp",        icon: "💬", status: "ativo", etapa: "em_desenvolvimento", desc: "Caixa de entrada do WhatsApp do planejamento.app — agora dentro da Central de Avisos › WhatsApp", oculto: true },

  // ── Tarefas (item-pivô global) — colocada no topo do Sidebar separadamente
  { id: "tarefas",     area: "planejamento", subarea: "Tarefas",       label: "Gestor de Tarefas", icon: "🗂️", status: "ativo", etapa: "beta",             desc: "Gestor de Tarefas: rotinas e demandas, caixa por usuário, cascatas dos cadastros mestres" },
  { id: "planner",     area: "master", subarea: "Master",              label: "Planner",           icon: "📅", status: "ativo", etapa: "beta",             desc: "Agenda pessoal integrada ao Google Calendar. Lança prazos de qualquer tipo (conta, técnico, trabalhista) que registram no módulo de origem." },

  // ── Pessoas Externas & Infra ─────────────────────────────────────
  { id: "freelas",     area: "ops", subarea: "Pessoas Externas & Infra", label: "Freelas",        icon: "🎒", status: "ativo", etapa: "beta",               desc: "Cadastro, agendamento, lançamento e pagamento de freelas", dependsOn: ["pessoas", "escala"] },
  { id: "prazosTrabalhistas", area: "planejamento", subarea: "Prazos", label: "Prazos Trabalhistas", icon: "🧑‍⚖️", status: "ativo", etapa: "em_desenvolvimento", desc: "Agenda de prazos de RH: fim de experiência (45/90), exames e uniformes/EPIs. Agrega os prazos que já vivem nos módulos de origem." },
  { id: "manutencoes", area: "planejamento", subarea: "Prazos", label: "Prazos Técnicos", icon: "🛠️", status: "ativo", etapa: "beta",         desc: "Prazos técnicos e operacionais: manutenções, licenças e certificados (potabilidade, dedetização, CLCB, alvarás). Gera lembretes na Central de Avisos." },

  // ── ocultos (operação) ───────────────────────────────────────────
  { id: "temperaturas", area: "ops", label: "Temperaturas",      icon: "🌡️", status: "planejado", etapa: "em_desenvolvimento", desc: "Monitoramento e alertas", oculto: true },
  { id: "fichas",       area: "ops", subarea: "Produção & Estoque", label: "Fichas Técnicas", icon: "📋", status: "ativo", etapa: "beta", desc: "Fichas técnicas de pratos e drinques: subfichas, custo em tempo real, produção do dia (escala + requisição) e CMV do cardápio" },

  // ═══ 👥 PESSOAS & DP ═══

  // ── Cadastros ────────────────────────────────────────────────────
  { id: "pessoas",     area: "dp", subarea: "Cadastros",               label: "Pessoas",         icon: "👤", status: "ativo", desc: "Pessoas, empregados, cargos e templates de permissão" },
  { id: "ferramentasCredenciais", area: "dp", subarea: "Cadastros",    label: "Ferramentas e Credenciais", icon: "🔑", status: "ativo", etapa: "beta", desc: "Catálogo de acessos a sistemas externos (iFood, Lalamove, fornecedores). Atribuição granular por usuário. Não armazena senhas — só link pro Bitwarden.", dependsOn: ["pessoas"] },

  // ── Ciclo de Vida do Empregado ───────────────────────────────────
  { id: "admissao",    area: "dp", subarea: "Ciclo de Vida do Empregado", label: "Admissão",    icon: "🪪", status: "ativo", etapa: "beta",               desc: "Processo de admissão: formulário compartilhável + kanban", dependsOn: ["pessoas"] },
  { id: "demissao",    area: "dp", subarea: "Ciclo de Vida do Empregado", label: "Demissão",    icon: "👋", status: "ativo", etapa: "beta",               desc: "Processo de demissão com kanban, fluxo de subtarefas e cascata de inativação (acesso, exames, tarefas)", dependsOn: ["pessoas"] },
  { id: "trilha",      area: "dp", subarea: "Ciclo de Vida do Empregado", label: "Trilha do Empregado", icon: "🛤️", status: "ativo", etapa: "em_desenvolvimento", desc: "Histórico cronológico completo do empregado (admissão, demissão, férias, exames, advertências, ponto, promoções). Sensível — só perfis autorizados acessam.", dependsOn: ["pessoas"] },

  // ── Operação Diária ──────────────────────────────────────────────
  { id: "escala",      area: "dp", subarea: "Operação Diária",         label: "Escala",          icon: "📅", status: "ativo", etapa: "beta",               desc: "Planejamento de escalas mensais", dependsOn: ["pessoas"] },
  { id: "excecoes",    area: "dp", subarea: "Operação Diária",         label: "Registros de Ponto", icon: "🕐", status: "ativo", etapa: "beta",            desc: "Cruzamento de ponto (Sólides) com Planejamento", dependsOn: ["escala", "pessoas"], oculto: true }, // descontinuado — substituído por Análise de Ponto; rota mantida mas fora do menu
  { id: "analise-ponto", area: "dp", subarea: "Operação Diária",       label: "Análise de Ponto", icon: "📊", status: "ativo", etapa: "beta"               , desc: "Análise de inconsistências de ponto (Sólides) — A Corrigir × A Avaliar, jornada flexível. Substitui Exceções quando estável.", dependsOn: [] },
  { id: "comunicados", area: "dp", subarea: "Operação Diária",         label: "Comunicados",     icon: "📣", status: "ativo", etapa: "em_desenvolvimento", desc: "Avisos e comunicados pra equipe", dependsOn: ["pessoas"] },
  { id: "chat",        area: "dp", subarea: "Operação Diária",         label: "Chat",            icon: "💬", status: "ativo", etapa: "em_desenvolvimento", desc: "Comunicação unificada: chat interno + WhatsApp externo (banco, contador, fornecedor). Plugável — gateway WhatsApp escolhido em fase futura.", dependsOn: ["pessoas"] },

  // ── Saúde & Equipamentos ─────────────────────────────────────────
  { id: "exames",      area: "dp", subarea: "Saúde & Equipamentos",    label: "Exames Médicos",  icon: "🩺", status: "ativo", etapa: "beta",               desc: "Exames periódicos dos empregados (Clínico, Coprocultura) com fluxo de agendamento, acompanhamento e baixa", dependsOn: ["pessoas"] },
  { id: "uniformes",   area: "dp", subarea: "Saúde & Equipamentos",    label: "Uniformes & EPIs", icon: "🦺", status: "ativo", etapa: "beta",               desc: "Catálogo, estoque, entregas e termos de uniformes e EPIs", dependsOn: ["pessoas"] },

  // ── ocultos (dp) ─────────────────────────────────────────────────
  { id: "fechamentoEscala", area: "dp", label: "Fechamento Escala", icon: "🔒", status: "planejado", etapa: "em_desenvolvimento", desc: "Não é módulo — já é função dentro da Escala", dependsOn: ["escala", "gorjetas"], oculto: true },
  { id: "faleDp",      area: "dp", label: "Fale com DP",         icon: "💬", status: "planejado", etapa: "em_desenvolvimento", desc: "Canal anônimo / suporte ao funcionário", dependsOn: ["pessoas"], oculto: true },

  // ═══ 💰 FINANCEIRO ═══

  // ── Equipe (benefícios + variáveis) ──────────────────────────────
  { id: "beneficios",  area: "fin", subarea: "Equipe (benefícios + variáveis)", label: "Benefícios", icon: "🎁", status: "ativo", etapa: "beta", desc: "Lote único de VT (Mobilidade) + VR (Refeição) + auxílio fixo, com 1 CSV pro Caju. Vigente de junho/2026.", dependsOn: ["pessoas", "escala"] },
  { id: "gorjetas",    area: "fin", subarea: "Equipe (benefícios + variáveis)", label: "Gorjetas",  icon: "💸", status: "ativo", etapa: "beta", desc: "Lançamento e divisão de gorjetas", dependsOn: ["pessoas", "escala"] },
  { id: "vt",          area: "fin", subarea: "Equipe (benefícios + variáveis)", label: "Vale Transporte", icon: "🚌", status: "ativo", etapa: "beta", desc: "VT por empregado (migrando pra Benefícios)", dependsOn: ["pessoas", "escala"] },
  { id: "vr",          area: "fin", subarea: "Equipe (benefícios + variáveis)", label: "Vale Refeição", icon: "🍱", status: "ativo", etapa: "beta", desc: "VR diário (migrando pra Benefícios)", dependsOn: ["pessoas", "escala"] },

  // ── Despesas ─────────────────────────────────────────────────────
  { id: "contasFixas", area: "planejamento", subarea: "Contas",             label: "Contas Fixas",    icon: "💵", status: "ativo", etapa: "beta", desc: "Cadastro mestre de pagamentos recorrentes (aluguel, sistemas, impostos). Gera lembretes no Gestor de Tarefas." },
  { id: "vendas",      area: "fin", subarea: "Vendas & Permutas",      label: "Vendas",          icon: "🧾", status: "ativo", etapa: "beta", desc: "Registro de vendas fora do sistema fiscal (entre empresas, permutas, sem margem). Cobrança via WhatsApp, quitação e permuta recíproca." },
  { id: "faturas",     area: "fin", subarea: "Cartões & Faturas",      label: "Faturas",         icon: "💳", status: "ativo", etapa: "em_desenvolvimento", desc: "Faturas de cartão: sobe o PDF, a IA extrai e você classifica os gastos por categoria/empresa. Gastos atribuídos a outra empresa viram reembolso na Central de Avisos dela." },

  // ═══ 🌐 INSTITUCIONAL / CONFIG ═══
  { id: "sites",          area: "inst", subarea: "Configuração", label: "Sites",          icon: "🌐", status: "ativo", etapa: "beta", desc: "Site público do restaurante: história, horário, cardápio, forms" },
  { id: "cardapio",       area: "inst", subarea: "Configuração", label: "Cardápio",       icon: "📋", status: "ativo", etapa: "beta", desc: "Elaboração dos cardápios do restaurante (comidas, bebidas, vinhos): edita aqui e o site puxa" },
  { id: "configuracoes",  area: "inst", subarea: "Configuração", label: "Configurações",  icon: "⚙️", status: "ativo", desc: "Configurações do restaurante" },
  // ocultos (institucional)
  { id: "recursos",       area: "inst", label: "Biblioteca",     icon: "📚", status: "planejado", etapa: "em_desenvolvimento", desc: "Documentos e wiki interna", oculto: true },
];

export const AREA_INFO = {
  ops:  { label: "Operação",               color: "#d4a017", desc: "Quem toca o restaurante no dia a dia" },
  dp:   { label: "Pessoas & DP",           color: "#3b82f6", desc: "RH, admissão, escala e desenvolvimento" },
  fin:  { label: "Financeiro",             color: "#10b981", desc: "Benefícios, gorjetas e pagamentos" },
  planejamento: { label: "Planejamento",   color: "#0ea5e9", desc: "Planner, prazos (trabalhistas/técnicos) e contas — o que vence e quando" },
  inst: { label: "Institucional / Config", color: "#8b5cf6", desc: "Site público e configurações" },
  master: { label: "Master",               color: "#6b7280", desc: "Ferramentas pessoais do dono — ligue/desligue quando quiser" },
} as const;

// Helpers
export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find(m => m.id === id);
}
export function modulesByArea(area: ModuleArea): ModuleDef[] {
  return MODULES.filter(m => m.area === area);
}
