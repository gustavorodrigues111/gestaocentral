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
// `icon` = nome do ícone lucide em kebab-case (ex: "calendar-check"). Emojis
// legados ainda funcionam (fallback do <ModuleIcon>), mas o padrão agora é
// lucide — o mesmo ícone aparece no Menu lateral, no grid de Módulos e em
// Perfis de Acesso.
//
// `oculto: true` = fora do menu (não pronto ou em transição).
export const MODULES: ModuleDef[] = [
  // ═══ 🏠 MINHAS INFORMAÇÕES ═══
  { id: "chat",        area: "minhas", subarea: "Minhas Informações", label: "Dashboard", icon: "layout-dashboard", status: "ativo", etapa: "em_desenvolvimento", desc: "Tela de abertura de cada usuário: calendário da semana que reúne, por dia, tudo que é seu — avisos, tarefas, prazos, fechamento e checklists — derivado ao vivo dos módulos. Botões de ação por permissão.", dependsOn: ["pessoas"] },

  // ═══ 🍽️ OPERAÇÃO ═══

  // ── Atendimento ao Cliente ───────────────────────────────────────
  { id: "reservas",    area: "ops", subarea: "Atendimento ao Cliente", label: "Reservas + CRM",  icon: "calendar-check", status: "ativo", etapa: "beta", desc: "Reservas de mesa e base de clientes", dependsOn: ["pessoas"] },
  { id: "eventos",     area: "ops", subarea: "Atendimento ao Cliente", label: "Eventos",         icon: "party-popper", status: "ativo", etapa: "beta", desc: "Captação, propostas e BEO de eventos privados", dependsOn: ["pessoas"] },
  { id: "whatsapp",    area: "ops", subarea: "Atendimento ao Cliente", label: "WhatsApp",        icon: "messages-square", status: "ativo", etapa: "beta", desc: "Atendimento pelos números de WhatsApp conectados (device-link): inbox compartilhado por número + configuração dos números (criar, conectar, atribuir usuários)." },

  // ── Rotinas da Operação ──────────────────────────────────────────
  { id: "checklists",  area: "ops", subarea: "Rotinas da Operação",    label: "Checklists",      icon: "list-checks", status: "ativo", etapa: "beta", desc: "Checklists operacionais", dependsOn: ["pessoas"] },
  { id: "contagens",   area: "ops", subarea: "Rotinas da Operação",    label: "Contagens",       icon: "boxes", status: "ativo", etapa: "em_desenvolvimento", desc: "Contagens de estoque", dependsOn: ["pessoas"] },
  { id: "recebimento", area: "ops", subarea: "Rotinas da Operação",    label: "Recebimento",     icon: "package-check", status: "ativo", etapa: "beta", desc: "Conferência e recebimento de produtos: digitaliza a nota fiscal (OCR), registra conformidade/divergência e arquiva no Drive por semana" },
  { id: "fechamentoCaixa", area: "ops", subarea: "Rotinas da Operação", label: "Fechamento de Caixa", icon: "wallet", status: "ativo", etapa: "beta", desc: "Fechamento de caixa por turno: anexos no Drive (dia/turno) e email aos sócios" },
  { id: "fichas",      area: "ops", subarea: "Rotinas da Operação",    label: "Fichas Técnicas", icon: "clipboard-list", status: "ativo", etapa: "beta", desc: "Fichas técnicas de pratos e drinques: subfichas, custo em tempo real, produção do dia (escala + requisição) e CMV do cardápio" },

  // ── Equipe de Operação ───────────────────────────────────────────
  { id: "ocorrencias", area: "ops", subarea: "Equipe de Operação",     label: "Ocorrências",     icon: "triangle-alert", status: "ativo", etapa: "beta", desc: "Log de ocorrências do dia-a-dia", dependsOn: ["pessoas"] },
  { id: "ideias",      area: "ops", subarea: "Equipe de Operação",     label: "Banco de Ideias", icon: "lightbulb", status: "ativo", etapa: "beta", desc: "Ideias para discutir em reuniões", dependsOn: ["reunioes"] },
  { id: "reunioes",    area: "ops", subarea: "Equipe de Operação",     label: "Reuniões",        icon: "presentation", status: "ativo", etapa: "beta", desc: "Reuniões de líderes e equipe", dependsOn: ["pessoas"] },
  { id: "freelas",     area: "ops", subarea: "Equipe de Operação",     label: "Freelas",         icon: "user-plus", status: "ativo", etapa: "beta", desc: "Cadastro, agendamento, lançamento e pagamento de freelas", dependsOn: ["pessoas", "escala"] },

  // ── Segurança Sanitária ──────────────────────────────────────────
  { id: "estoqueValidade", area: "ops", subarea: "Segurança Sanitária", label: "Controles de Validades", icon: "calendar-clock", status: "ativo", etapa: "em_desenvolvimento", desc: "Etiquetas de validade (cozinha) + gestão de estoque por lote (locais, entrada por NF, baixa por QR, giro PVPS/PEPS). Multi-loja.", dependsOn: ["pessoas"] },
  { id: "seguranca",   area: "ops", subarea: "Segurança Sanitária",   label: "Checklist Sanitário", icon: "shield-check", status: "ativo", etapa: "em_desenvolvimento", desc: "Avaliação de boas práticas (RDC 216) preenchida pela nutricionista, por área. Não-conformes viram plano de ação para a operação; histórico e gráficos de performance.", dependsOn: ["pessoas", "planoDeAcao"] },

  // ── Informações Básicas ──────────────────────────────────────────
  { id: "sites",       area: "ops", subarea: "Informações Básicas",   label: "Sites",           icon: "globe", status: "ativo", etapa: "beta", desc: "Site público do restaurante: história, horário, cardápio, forms" },
  { id: "cardapio",    area: "ops", subarea: "Informações Básicas",   label: "Cardápio",        icon: "book-open", status: "ativo", etapa: "beta", desc: "Elaboração dos cardápios do restaurante (comidas, bebidas, vinhos): edita aqui e o site puxa" },
  { id: "horarios",    area: "ops", subarea: "Informações Básicas",   label: "Funcionamento",   icon: "store", status: "ativo", etapa: "beta", desc: "Horário de funcionamento + datas especiais + janelas de reserva" },

  // ── ocultos (operação) ───────────────────────────────────────────
  { id: "temperaturas", area: "ops", label: "Temperaturas",      icon: "thermometer", status: "planejado", etapa: "em_desenvolvimento", desc: "Monitoramento e alertas", oculto: true },
  { id: "whatsappInbox", area: "ops", label: "WhatsApp (inbox legado)", icon: "message-circle", status: "ativo", etapa: "em_desenvolvimento", desc: "Caixa de entrada do WhatsApp do planejamento.app — agora dentro da Central de Avisos › WhatsApp", oculto: true },

  // ═══ 👥 PESSOAS & DP ═══

  // ── Cadastros e Documentos ───────────────────────────────────────
  { id: "pessoas",     area: "dp", subarea: "Cadastros e Documentos", label: "Pessoas",         icon: "users", status: "ativo", desc: "Pessoas, empregados, cargos e templates de permissão" },
  { id: "documentos",  area: "dp", subarea: "Cadastros e Documentos", label: "Gerador de Documentos", icon: "file-text", status: "ativo", etapa: "beta", desc: "Fábrica de documentos trabalhistas: escolhe o modelo do escritório, puxa empresa (cadastro) e empregado (Pessoas), a IA redige os textos livres e entrega o DOCX preenchido pra assinatura.", dependsOn: ["pessoas"] },

  // ── Processos do DP ──────────────────────────────────────────────
  { id: "processoSeletivo", area: "dp", subarea: "Processos do DP",   label: "Seletivo",        icon: "user-search", status: "ativo", etapa: "beta", desc: "Vagas com perguntas próprias + candidaturas (avulsas/por vaga) em kanban; aprovado vira admissão", dependsOn: ["pessoas"] },
  { id: "admissao",    area: "dp", subarea: "Processos do DP",        label: "Admissão",        icon: "user-round-plus", status: "ativo", etapa: "beta", desc: "Processo de admissão: formulário compartilhável + kanban", dependsOn: ["pessoas"] },
  { id: "demissao",    area: "dp", subarea: "Processos do DP",        label: "Demissão",        icon: "user-round-minus", status: "ativo", etapa: "beta", desc: "Processo de demissão com kanban, fluxo de subtarefas e cascata de inativação (acesso, exames, tarefas)", dependsOn: ["pessoas"] },

  // ── Ciclo do Empregado ───────────────────────────────────────────
  { id: "trilha",      area: "dp", subarea: "Ciclo do Empregado",     label: "Trilha do Empregado", icon: "route", status: "ativo", etapa: "em_desenvolvimento", desc: "Histórico cronológico completo do empregado (admissão, demissão, férias, exames, advertências, ponto, promoções). Sensível — só perfis autorizados acessam.", dependsOn: ["pessoas"] },

  // ── Comunicação ──────────────────────────────────────────────────
  { id: "comunicados", area: "dp", subarea: "Comunicação",            label: "Enviar Comunicados", icon: "send", status: "ativo", etapa: "em_desenvolvimento", desc: "Avisos e comunicados pra equipe", dependsOn: ["pessoas"] },

  // ── Ponto & Jornada ──────────────────────────────────────────────
  { id: "escala",      area: "dp", subarea: "Ponto & Jornada",        label: "Escala Mensal",   icon: "calendar-range", status: "ativo", etapa: "beta", desc: "Planejamento de escalas mensais", dependsOn: ["pessoas"] },
  { id: "ptrp",        area: "dp", subarea: "Ponto & Jornada",        label: "Ponto (PTRP)",    icon: "fingerprint", status: "ativo", etapa: "beta", desc: "Programa de Tratamento de Registro de Ponto (Portaria 671): conferência/apuração, banco de horas, sincronização das batidas do Sólides, regras (CCT), espelho de ponto e AEJ.", dependsOn: ["escala", "pessoas"] },
  { id: "analise-ponto", area: "dp", subarea: "Ponto & Jornada",      label: "Análise de Ponto", icon: "chart-column", status: "ativo", etapa: "beta", desc: "Análise de inconsistências de ponto (Sólides) — A Corrigir × A Avaliar, jornada flexível. Substitui Exceções quando estável.", dependsOn: [] },
  { id: "excecoes",    area: "dp", subarea: "Ponto & Jornada",        label: "Registros de Ponto", icon: "clock", status: "ativo", etapa: "beta", desc: "Cruzamento de ponto (Sólides) com Planejamento", dependsOn: ["escala", "pessoas"], oculto: true, descontinuado: true },

  // ── Folha de Pagamento ───────────────────────────────────────────
  { id: "beneficios2", area: "dp", subarea: "Folha de Pagamento",     label: "Benefícios",      icon: "gift", status: "ativo", etapa: "beta", desc: "Módulo único de benefícios: VT + VR + auxílio fixo por lote, valor diário × dias da escala, Caju/Pix. Substitui VT, VR e o Benefícios antigo.", dependsOn: ["pessoas", "escala"] },
  { id: "gorjetas",    area: "dp", subarea: "Folha de Pagamento",     label: "Gorjetas",        icon: "coins", status: "ativo", etapa: "beta", desc: "Lançamento e divisão de gorjetas", dependsOn: ["pessoas", "escala"] },
  { id: "folhas",      area: "dp", subarea: "Folha de Pagamento",     label: "Conferência de Folhas", icon: "receipt-text", status: "ativo", etapa: "em_desenvolvimento", desc: "Agente auditor: sobe os espelhos da folha (Senador), a IA extrai e o motor de regras confere contra gorjeta, adiantamento (verba 953) e integridade. Reporta só os erros (P0/P1/P2), não o que está certo.", dependsOn: ["pessoas", "gorjetas"] },
  { id: "beneficios",  area: "dp", subarea: "Folha de Pagamento",     label: "Benefícios (antigo)", icon: "gift", status: "ativo", etapa: "beta", oculto: true, desc: "Legado — substituído pelo módulo Benefícios. Oculto; histórico preservado.", dependsOn: ["pessoas", "escala"] },
  { id: "vt",          area: "dp", subarea: "Folha de Pagamento",     label: "Vale Transporte", icon: "bus", status: "ativo", etapa: "beta", oculto: true, desc: "Legado — VT agora vive dentro do módulo Benefícios. Oculto; histórico preservado.", dependsOn: ["pessoas", "escala"] },
  { id: "vr",          area: "dp", subarea: "Folha de Pagamento",     label: "Vale Refeição",   icon: "utensils", status: "ativo", etapa: "beta", oculto: true, desc: "Legado — VR agora vive dentro do módulo Benefícios. Oculto; histórico preservado.", dependsOn: ["pessoas", "escala"] },

  // ── Saúde & Equipamentos ─────────────────────────────────────────
  { id: "exames",      area: "dp", subarea: "Saúde & Equipamentos",   label: "Exames Médicos",  icon: "stethoscope", status: "ativo", etapa: "beta", desc: "Exames periódicos dos empregados (Clínico, Coprocultura) com fluxo de agendamento, acompanhamento e baixa", dependsOn: ["pessoas"] },
  { id: "uniformes",   area: "dp", subarea: "Saúde & Equipamentos",   label: "Uniformes & EPIs", icon: "shirt", status: "ativo", etapa: "beta", desc: "Catálogo, estoque, entregas e termos de uniformes e EPIs", dependsOn: ["pessoas"] },

  // ── ocultos (dp) ─────────────────────────────────────────────────
  { id: "fechamentoEscala", area: "dp", label: "Fechamento Escala", icon: "lock", status: "planejado", etapa: "em_desenvolvimento", desc: "Não é módulo — já é função dentro da Escala", dependsOn: ["escala", "gorjetas"], oculto: true },
  { id: "faleDp",      area: "dp", label: "Fale com DP",         icon: "message-circle", status: "planejado", etapa: "em_desenvolvimento", desc: "Canal anônimo / suporte ao funcionário", dependsOn: ["pessoas"], oculto: true },

  // ═══ 💼 ADMINISTRATIVO ═══

  // ── Tarefas e Prazos ─────────────────────────────────────────────
  { id: "tarefas",     area: "planejamento", subarea: "Tarefas e Prazos", label: "Tarefas", icon: "list-todo", status: "ativo", etapa: "beta", desc: "Gestor de Tarefas: rotinas e demandas, caixa por usuário, cascatas dos cadastros mestres" },
  { id: "prazos",      area: "planejamento", subarea: "Tarefas e Prazos", label: "Prazos", icon: "alarm-clock", status: "ativo", etapa: "beta", desc: "Agenda única do que vence: contas, técnicos (com laudo no Drive), trabalhistas e avulsos. Recorrência flexível, agendamento e histórico de realizados. Fonte única — substitui Contas Fixas, Manutenções e Prazos Trabalhistas.", dependsOn: ["pessoas"] },
  // Modo SIMPLIFICADO do item "Tarefas" (perfil planoDeAcao) — segue oculto do menu.
  { id: "planoDeAcao", area: "planejamento", subarea: "Tarefas e Prazos", label: "Tarefas (simplificado)", icon: "✅", status: "ativo", etapa: "beta", desc: "Modo simplificado do Gestor de Tarefas — a lista simples e mobile de quem executa na operação. É o que abre no item 'Tarefas' pra quem tem este perfil. Concluir com um toque + andamento; líder vê as da equipe.", dependsOn: ["pessoas"], oculto: true },

  // ── Relatórios Financeiros ───────────────────────────────────────
  { id: "fechamentoFin", area: "planejamento", subarea: "Relatórios Financeiros", label: "Checklist DRE", icon: "calculator", status: "ativo", etapa: "em_desenvolvimento", desc: "Fechamento financeiro mensal: matriz item × empresa (tarefa, prazo, responsável e check por empresa ativa), com links pra arquivos externos ou módulos internos. Nasce zerado a cada competência." },

  // ── Compras ──────────────────────────────────────────────────────
  { id: "compras",     area: "planejamento", subarea: "Compras",      label: "Solicitações de Compras", icon: "shopping-cart", status: "ativo", etapa: "em_desenvolvimento", desc: "Pedidos baseados em contagens e padrões", dependsOn: ["contagens"] },

  // ── Processos & Rotinas ──────────────────────────────────────────
  { id: "wikiProcessos", area: "planejamento", subarea: "Processos & Rotinas", label: "Wiki de Processos", icon: "book-marked", status: "ativo", etapa: "em_desenvolvimento", desc: "Guias de funcionamento por área (Pessoas, Financeiro, Compras, Eventos) — um guia HTML por área + um assistente de IA que responde as dúvidas da equipe a partir do guia da área." },
  { id: "rotinas",     area: "planejamento", subarea: "Processos & Rotinas", label: "Rotinas", icon: "repeat", status: "ativo", etapa: "beta", desc: "Lembretes recorrentes atribuídos a pessoas — aparecem na Central de Avisos no dia devido. Os canais (email/WhatsApp) se configuram na Central de Avisos › Configurações", dependsOn: ["pessoas"] },

  // ── Acessos ──────────────────────────────────────────────────────
  { id: "ferramentasCredenciais", area: "planejamento", subarea: "Acessos", label: "Credenciais", icon: "key-round", status: "ativo", etapa: "beta", desc: "Catálogo de acessos a sistemas externos (iFood, Lalamove, fornecedores). Atribuição granular por usuário. Não armazena senhas — só link pro Bitwarden.", dependsOn: ["pessoas"] },

  // ── Vendas & Permutas ────────────────────────────────────────────
  { id: "vendas",      area: "planejamento", subarea: "Vendas & Permutas", label: "Emissor de Vendas", icon: "receipt", status: "ativo", etapa: "beta", desc: "Registro de vendas fora do sistema fiscal (entre empresas, permutas, sem margem). Cobrança via WhatsApp, quitação e permuta recíproca." },
  { id: "relatoriosVendas", area: "planejamento", subarea: "Vendas & Permutas", label: "Relatórios Altec", icon: "chart-line", status: "ativo", etapa: "beta", desc: "Relatórios do PDV Altec/Riser (caixa encerrado): produtos vendidos detalhados (qtd, faturamento bruto/líquido, curva ABC) e faturamento por turno (Almoço × Noite). Fonte oficial 'Vendas por Produto', completa (não só o top-10 do dia)." },

  // ── Cartões ──────────────────────────────────────────────────────
  { id: "faturas",     area: "planejamento", subarea: "Cartões",      label: "Conciliação de Faturas", icon: "credit-card", status: "ativo", etapa: "em_desenvolvimento", desc: "Faturas de cartão: sobe o PDF, a IA extrai e você classifica os gastos por categoria/empresa. Gastos atribuídos a outra empresa viram reembolso na Central de Avisos dela." },

  // ── IA ───────────────────────────────────────────────────────────
  { id: "agentes",     area: "planejamento", subarea: "IA",           label: "Agentes de IA",   icon: "bot", status: "ativo", etapa: "em_desenvolvimento", desc: "Agentes de IA (DP e Financeiro) que consultam e — com confirmação — alteram dados dentro da plataforma. Acesso controlado herdado de Pessoas; futuramente respondem no WhatsApp em números autorizados." },

  // ═══ ⚙️ CONFIGURAÇÕES ═══
  // Guarda-chuva antigo — some do menu; agora dividido em "Dados da empresa"
  // e "Módulos" (links dedicados em Configurações). Rota /configuracoes segue viva.
  { id: "configuracoes", area: "inst", subarea: "Configuração",       label: "Configurações",   icon: "settings", status: "ativo", desc: "Configurações do restaurante", oculto: true },
  { id: "conectores",  area: "inst", subarea: "Configuração",         label: "Conectores",      icon: "plug", status: "ativo", etapa: "em_desenvolvimento", desc: "Hub de plataformas externas (GetIn, Altec/Riser, iFood…) que abastecem o app: reservas, vendas/faturamento. Status do último sync por restaurante + forçar sync." },
  // ocultos (configurações)
  { id: "recursos",    area: "inst", label: "Biblioteca",     icon: "book-open", status: "planejado", etapa: "em_desenvolvimento", desc: "Documentos e wiki interna", oculto: true },

  // ═══ 🛡️ MASTER ═══
  { id: "iaGovernanca", area: "master", subarea: "Master",            label: "Governança de IA", icon: "shield-alert", status: "ativo", etapa: "beta", desc: "Diretrizes do que a IA pode responder, registro jurídico das interações e alertas de uso fora do escopo (LGPD). Só master." },
];

export const AREA_INFO = {
  minhas: { label: "Minhas Informações",   color: "#0d9488", icon: "house",     desc: "Sua área pessoal: painel, escala, gorjetas e comunicados" },
  ops:  { label: "Operação",               color: "#d4a017", icon: "chef-hat",  desc: "Quem toca o restaurante no dia a dia" },
  dp:   { label: "Pessoas & DP",           color: "#3b82f6", icon: "users",     desc: "RH, admissão, escala e desenvolvimento" },
  planejamento: { label: "Administrativo", color: "#0ea5e9", icon: "briefcase", desc: "Tarefas, prazos, financeiro, vendas, compras e IA" },
  inst: { label: "Configurações",          color: "#8b5cf6", icon: "settings",  desc: "Dados da empresa, módulos, perfis e conectores" },
  master: { label: "Master",               color: "#6b7280", icon: "crown",     desc: "Ferramentas pessoais do dono — ligue/desligue quando quiser" },
} as const;

// Helpers
export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find(m => m.id === id);
}
export function modulesByArea(area: ModuleArea): ModuleDef[] {
  return MODULES.filter(m => m.area === area);
}
