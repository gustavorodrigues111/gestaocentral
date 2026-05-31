// ════════════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE AÇÕES — fonte da verdade do que cada módulo expõe pro sistema
//  de Perfis de Acesso.
//
//  Cada ação tem id (estável, usado em código) + label (mostrado no editor).
//  Mexer em label = só UX. Mexer em id = breaking change (precisa migrar
//  perfis existentes que referenciam o id antigo).
//
//  Este catálogo é gerado a partir da revisão manual do master (rascunho em
//  /permissoes-rascunho.html, exportada em 2026-05-25).
//
//  Self-service NÃO entra aqui. As ações automáticas pra qualquer pessoa
//  (sua escala, sua gorjeta, FAQ, fale com DP, reuniões agendadas) são
//  baseline universal, não passam pelo sistema de perfil.
// ════════════════════════════════════════════════════════════════════════════

export type CatalogoModulo = {
  id: string;                       // = ModuleId (mantemos string solta aqui pra
                                    //  acomodar módulos novos sem mexer em types/index)
  icon: string;
  label: string;
  desc: string;
  area: "operacao" | "appmise" | "time" | "gestao";
  acoes: CatalogoAcao[];
};

export type CatalogoAcao = {
  id: string;                       // estável, usado em PermissoesPerfil
  label: string;
  /**
   * Se true, marca a ação como "sensível" (LGPD / dados pessoais). UI do
   * editor exibe um 🔒 do lado. Útil pra alertar o master que essa ação
   * dá acesso a PII de cliente, dados de funcionário, financeiro, etc.
   */
  sensivel?: boolean;
};

// ─── CATÁLOGO ──────────────────────────────────────────────────────────────

export const CATALOGO: CatalogoModulo[] = [
  {
    id: "reservas",
    icon: "📅",
    label: "Reservas + CRM",
    desc: "Reservas do dia, CRM de clientes, salões/mesas, templates",
    area: "operacao",
    acoes: [
      { id: "verFuturas",     label: "Ver reservas (hoje em diante)" },
      { id: "verPassadas",    label: "Ver reservas passadas", sensivel: true },
      { id: "criar",          label: "Criar nova reserva" },
      { id: "editar",         label: "Editar reserva" },
      { id: "cancelar",       label: "Cancelar reserva" },
      { id: "chegou",         label: "Marcar 'chegou'" },
      { id: "whatsapp",       label: "Disparar WhatsApp de confirmação" },
      { id: "notaCliente",    label: "Adicionar nota ao cliente" },
      { id: "mesclar",        label: "Mesclar clientes duplicados" },
      { id: "verCRM",         label: "Ver tab Clientes (CRM completo)", sensivel: true },
      { id: "editarCliente",  label: "Editar dados cadastrais do cliente", sensivel: true },
      { id: "excluirCliente", label: "Excluir cliente", sensivel: true },
      { id: "configurar",     label: "Configurar salões / mesas / templates" },
    ],
  },
  {
    id: "horarios",
    icon: "🕐",
    label: "Horários",
    desc: "Horário regular semanal + exceções (feriados, datas especiais)",
    area: "operacao",
    acoes: [
      { id: "ver",                 label: "Ver horários" },
      { id: "editarRegular",       label: "Editar horário regular semanal" },
      { id: "gerenciarExcecoes",   label: "Adicionar/editar/remover exceções" },
      { id: "marcarSyncGoogle",    label: "Marcar sincronização com Google Business" },
      { id: "configurarUrlGoogle", label: "Configurar URL do Google Business (Geral)" },
    ],
  },
  {
    id: "sites",
    icon: "🌐",
    label: "Sites",
    desc: "Site público do restaurante (história, cardápio, contato, tema)",
    area: "operacao",
    acoes: [
      { id: "ver",            label: "Ver configuração do site" },
      { id: "editarTextos",   label: "Editar textos (história, hero, etc)" },
      { id: "editarContato",  label: "Editar contato (endereço, telefone, redes)" },
      { id: "editarTema",     label: "Editar tema (cores, fontes, escalas)" },
      { id: "uploadCardapio", label: "Trocar PDF do cardápio (PT/EN)" },
      { id: "uploadAssets",   label: "Trocar logo / favicon / hero" },
      { id: "publicar",       label: "Publicar / despublicar site" },
    ],
  },
  {
    id: "ocorrencias",
    icon: "🚨",
    label: "Ocorrências",
    desc: "Registros de incidentes, problemas, ações corretivas",
    area: "operacao",
    acoes: [
      { id: "criar",       label: "Criar ocorrência" },
      { id: "ver",         label: "Ver ocorrências" },
      { id: "editar",      label: "Editar / atualizar status" },
      { id: "estatistics", label: "Ver relatórios / estatísticas" },
    ],
  },
  {
    id: "eventos",
    icon: "🎉",
    label: "Eventos privados",
    desc: "Pedidos de evento na laje/espaço (em dev)",
    area: "operacao",
    acoes: [
      { id: "verLeads",   label: "Ver leads / pedidos pendentes" },
      { id: "editar",     label: "Editar pedido" },
      { id: "responder",  label: "Aprovar / rejeitar / responder" },
      { id: "configurar", label: "Configurar espaços, capacidades" },
    ],
  },

  // ─── AppMise (em dev) ────────────────────────────────────────────────────
  {
    id: "compras",
    icon: "🛒",
    label: "Compras (AppMise)",
    desc: "Ciclo de abastecimento: contagens → pedidos → recebimento",
    area: "appmise",
    acoes: [
      { id: "verPedidos",         label: "Ver pedidos" },
      { id: "criarPedido",        label: "Criar pedido / aprovar sugestão" },
      { id: "enviarWhatsapp",     label: "Enviar pedido via WhatsApp" },
      { id: "receber",            label: "Receber pedido (conferência)" },
      { id: "configurarFornecs",  label: "Configurar fornecedores" },
      { id: "configurarProdutos", label: "Configurar produtos e categorias" },
    ],
  },
  {
    id: "contagens",
    icon: "📦",
    label: "Contagens (AppMise)",
    desc: "Contagem de estoque ciclo a ciclo",
    area: "appmise",
    acoes: [
      { id: "lancar",           label: "Lançar contagem" },
      { id: "verCiclos",        label: "Ver ciclos atuais e passados" },
      { id: "abrirFecharCiclo", label: "Abrir / fechar ciclo" },
      { id: "configurar",       label: "Configurar itens, categorias, estoques" },
    ],
  },
  {
    id: "checklists",
    icon: "📋",
    label: "Checklists operacionais",
    desc: "Templates de checklist e execuções",
    area: "appmise",
    acoes: [
      { id: "executar",   label: "Executar checklist do dia" },
      { id: "verTime",    label: "Ver execuções de todos" },
      { id: "configurar", label: "Criar/editar templates" },
    ],
  },
  {
    id: "fichas",
    icon: "📚",
    label: "Fichas técnicas",
    desc: "Custo de pratos, ingredientes, equipamentos",
    area: "appmise",
    acoes: [
      { id: "ver",            label: "Ver fichas técnicas" },
      { id: "editar",         label: "Editar fichas" },
      { id: "configInsumos",  label: "Configurar insumos (preços, unidades)" },
      { id: "configEquips",   label: "Configurar equipamentos" },
    ],
  },

  // ─── TIME ─────────────────────────────────────────────────────────────────
  {
    id: "escala",
    icon: "📆",
    label: "Escala",
    desc: "Escala mensal do time, trocas, fechamento",
    area: "time",
    acoes: [
      { id: "verPropria",      label: "Ver sua escala (já no self-service)" },
      { id: "verTime",         label: "Ver escala de todos do time", sensivel: true },
      { id: "editar",          label: "Editar escala (mudar turnos)" },
      { id: "aprovarTrocas",   label: "Aprovar pedidos de troca" },
      { id: "publicar",        label: "Publicar mês pra time ver" },
      { id: "exportar",        label: "Exportar/imprimir escala" },
      { id: "planejarPrevista",label: "Planejar escala prevista" },
    ],
  },
  {
    id: "fechamentoEscala",
    icon: "🔒",
    label: "Fechamento de escala",
    desc: "Fechar mês de escala (passa a contar pra gorjeta)",
    area: "time",
    acoes: [
      { id: "ver",     label: "Ver fechamentos passados" },
      { id: "fechar",  label: "Fechar mês" },
      { id: "reabrir", label: "Reabrir mês fechado", sensivel: true },
    ],
  },
  {
    id: "gorjetas",
    icon: "💰",
    label: "Gorjetas",
    desc: "Cálculo e distribuição de gorjeta",
    area: "time",
    acoes: [
      { id: "verExtratoProprio", label: "Ver seu extrato (já no self-service)" },
      { id: "verTime",           label: "Ver gorjetas de todos do time", sensivel: true },
      { id: "lancar",            label: "Lançar valor recebido no dia" },
      { id: "configurarRegra",   label: "Editar regra de divisão (assembleia)", sensivel: true },
      { id: "exportar",          label: "Exportar/imprimir relatório", sensivel: true },
    ],
  },
  {
    id: "vt",
    icon: "🚌",
    label: "VT (Vale Transporte)",
    desc: "Cadastro e pagamento de VT por pessoa",
    area: "time",
    acoes: [
      { id: "verProprio",  label: "Ver seu VT (já no self-service?)" },
      { id: "verTime",     label: "Ver VT de todos", sensivel: true },
      { id: "configurar",  label: "Configurar VT por pessoa (valor, dias)" },
      { id: "registrarPg", label: "Registrar pagamento mensal", sensivel: true },
    ],
  },
  {
    id: "vr",
    icon: "🍱",
    label: "VR (Vale Refeição)",
    desc: "Cadastro e pagamento de VR diário por pessoa (só restaurantes que usam)",
    area: "time",
    acoes: [
      { id: "ver",         label: "Ver VR de todos", sensivel: true },
      { id: "configurar",  label: "Lançar lote, marcar pago, exportar pra Caju", sensivel: true },
    ],
  },
  {
    id: "freelas",
    icon: "👤",
    label: "Freelas",
    desc: "Vagas pontuais (cobrir um turno, etc) + ciclo de pagamento",
    area: "time",
    acoes: [
      { id: "verVagas",          label: "Ver vagas disponíveis" },
      { id: "candidatar",        label: "Candidatar-se" },
      { id: "criarVaga",         label: "Criar / publicar vaga" },
      { id: "atribuir",          label: "Atribuir vaga a alguém" },
      { id: "avaliar",           label: "Avaliar performance do freela" },
      { id: "lancarTurnos",      label: "Lançar turnos do freela" },
      { id: "atribuirValor",     label: "Atribuir valor de hora/diária do freela", sensivel: true },
      { id: "fecharLote",        label: "Fechar lote de freelas da semana", sensivel: true },
      { id: "acessarDados",      label: "Acessar dados do freela (CPF, contato)", sensivel: true },
      { id: "verRelatoriosLote", label: "Acessar relatórios de lotes passados", sensivel: true },
    ],
  },
  {
    id: "reunioes",
    icon: "🗣️",
    label: "Reuniões",
    desc: "Agenda de reuniões, pautas, atas",
    area: "time",
    acoes: [
      { id: "verPropria",  label: "Ver reuniões suas (já no self-service)" },
      { id: "verTodas",    label: "Ver agenda completa do restaurante" },
      { id: "criar",       label: "Agendar reunião" },
      { id: "editar",      label: "Editar (mudar data, participantes)" },
      { id: "pauta",       label: "Adicionar pauta / ações / decisões" },
      { id: "verPassadas", label: "Ver reuniões passadas" },
    ],
  },
  {
    id: "trilha",
    icon: "🎯",
    label: "Trilha do empregado",
    desc: "Histórico de carreira / eventos individuais (trilha própria fora do self-service)",
    area: "time",
    acoes: [
      { id: "verTime",    label: "Ver trilha de qualquer pessoa", sensivel: true },
      { id: "lancar",     label: "Lançar evento na trilha (promoção, etc)", sensivel: true },
      { id: "configurar", label: "Configurar tipos de evento, marcos" },
    ],
  },
  {
    id: "ideias",
    icon: "💡",
    label: "Banco de ideias",
    desc: "Sugestões do time pra melhorar a casa",
    area: "time",
    acoes: [
      { id: "submeter", label: "Submeter ideia" },
      { id: "ver",      label: "Ver ideias submetidas" },
      { id: "moderar",  label: "Aprovar / rejeitar / classificar" },
      { id: "executar", label: "Marcar como implementada" },
    ],
  },

  // ─── GESTÃO ──────────────────────────────────────────────────────────────
  {
    id: "comunicados",
    icon: "📢",
    label: "Comunicados",
    desc: "Anúncios da gestão pro time",
    area: "gestao",
    acoes: [
      { id: "ler",         label: "Ler comunicados (todos vêem por padrão)" },
      { id: "criar",       label: "Criar comunicado" },
      { id: "editar",      label: "Editar comunicado" },
      { id: "deletar",     label: "Apagar comunicado" },
      { id: "verLeituras", label: "Ver quem leu (acks)" },
    ],
  },
  {
    id: "admissao",
    icon: "👋",
    label: "Admissão",
    desc: "Triagem de candidatos + processo de admissão",
    area: "gestao",
    acoes: [
      { id: "verCandidaturas",  label: "Ver candidaturas (trabalhe-conosco)", sensivel: true },
      { id: "triar",            label: "Triar / classificar candidato" },
      { id: "iniciarAdmissao",  label: "Iniciar processo de admissão", sensivel: true },
      { id: "concluirAdmissao", label: "Concluir (vira pessoa do time)", sensivel: true },
      { id: "configurar",       label: "Configurar etapas do processo" },
    ],
  },
  {
    id: "recursos",
    icon: "🧰",
    label: "Recursos",
    desc: "Catálogo de itens emprestáveis (uniforme, ferramenta, etc)",
    area: "gestao",
    acoes: [
      { id: "verCatalogo", label: "Ver catálogo" },
      { id: "aprovar",     label: "Aprovar / negar solicitação" },
      { id: "configurar",  label: "Adicionar / editar itens do catálogo" },
    ],
  },
  {
    id: "excecoes",
    icon: "⚠️",
    label: "Exceções (Sólides)",
    desc: "Inconformidades, ajustes de ponto, compatibilidade com Sólides",
    area: "gestao",
    acoes: [
      { id: "verInconformidades", label: "Ver inconformidades", sensivel: true },
      { id: "ajustes",            label: "Aprovar / rejeitar ajustes de ponto", sensivel: true },
      { id: "compatibilidade",    label: "Ver tab Compatibilidade Sólides" },
      { id: "configurar",         label: "Configurar regras de exceção" },
    ],
  },
  {
    id: "pessoas",
    icon: "👥",
    label: "Pessoas",
    desc: "Cadastro do time, cargos, restaurantes vinculados",
    area: "gestao",
    acoes: [
      { id: "verLista",       label: "Ver lista de pessoas" },
      { id: "verDetalhes",    label: "Ver detalhes (CPF, endereço, contato)", sensivel: true },
      { id: "criar",          label: "Criar nova pessoa", sensivel: true },
      { id: "editarDados",    label: "Editar dados básicos (nome, contato)", sensivel: true },
      { id: "atribuirCargo",  label: "Atribuir / mudar cargo" },
      { id: "atribuirRest",   label: "Atribuir / remover restaurantes" },
      { id: "atribuirPerfil", label: "Atribuir perfil de acesso", sensivel: true },
      { id: "demitir",        label: "Demitir / desativar", sensivel: true },
      { id: "excluir",        label: "Excluir definitivamente", sensivel: true },
    ],
  },
  {
    id: "uniformes",
    icon: "🦺",
    label: "Uniformes & EPIs",
    desc: "Catálogo, estoque, entregas e termos de uniformes e EPIs",
    area: "gestao",
    acoes: [
      { id: "ver",              label: "Ver uniformes/EPIs (catálogo, estoque, entregas)" },
      { id: "gerenciarCatalogo", label: "Gerenciar catálogo (itens e kits por área)" },
      { id: "ajustarEstoque",   label: "Ajustar estoque (entradas/saídas)" },
      { id: "registrarEntrega", label: "Registrar entrega de uniforme/EPI" },
      { id: "cancelarEntrega",  label: "Cancelar / devolver entrega" },
      { id: "configurar",       label: "Configurar (template do termo, fornecedores)" },
    ],
  },
  {
    id: "configuracoes",
    icon: "⚙️",
    label: "Configurações gerais",
    desc: "Dados do restaurante, cargos, segurança",
    area: "gestao",
    acoes: [
      { id: "ver",             label: "Ver configurações" },
      { id: "editarRest",      label: "Editar dados do restaurante" },
      { id: "configCargos",    label: "Criar/editar cargos" },
      { id: "configSeguranca", label: "Configurar segurança (2FA, sessão)", sensivel: true },
    ],
  },
  // ─── GESTOR DE TAREFAS + CADASTROS MESTRES ───────────────────────────────
  {
    id: "tarefas",
    icon: "📋",
    label: "Tarefas",
    desc: "Gestor de Tarefas (Projeto > Subprojeto > Tarefa)",
    area: "gestao",
    acoes: [
      { id: "verProprias",       label: "Ver suas tarefas (Minhas Tarefas)" },
      { id: "verGrupoDP",        label: "Ver tarefas do grupo DP" },
      { id: "verGrupoFin",       label: "Ver tarefas do grupo Financeiro" },
      { id: "verGrupoDir",       label: "Ver tarefas do grupo Diretoria" },
      { id: "verGrupoOps",       label: "Ver tarefas do grupo Operação" },
      { id: "verEscritorio",     label: "Ver tarefas de todo o escritório" },
      { id: "criar",             label: "Criar tarefa avulsa" },
      { id: "editarProprias",    label: "Editar suas tarefas (responsável/co-resp)" },
      { id: "editarTodas",       label: "Editar qualquer tarefa visível" },
      { id: "deletar",           label: "Excluir tarefa (vai pra lixeira)" },
      { id: "adminProjetos",     label: "Gerenciar projetos e subprojetos" },
      { id: "verLixeira",        label: "Acessar lixeira e restaurar tarefas", sensivel: true },
      { id: "gerarRecorrencias", label: "Disparar geração manual de tarefas-lembrete" },
    ],
  },
  {
    id: "contasFixas",
    icon: "💵",
    label: "Contas Fixas",
    desc: "Cadastro mestre de pagamentos recorrentes (gera tarefas-lembrete)",
    area: "gestao",
    acoes: [
      { id: "ver",      label: "Ver contas fixas cadastradas" },
      { id: "criar",    label: "Cadastrar nova conta fixa", sensivel: true },
      { id: "editar",   label: "Editar conta fixa (valor, PIX, recorrência)", sensivel: true },
      { id: "deletar",  label: "Excluir conta fixa", sensivel: true },
    ],
  },
  {
    id: "manutencoes",
    icon: "🛠️",
    label: "Manutenções & Licenças",
    desc: "Cadastro mestre de manutenções e licenças (gera tarefas-lembrete)",
    area: "gestao",
    acoes: [
      { id: "ver",      label: "Ver manutenções e licenças cadastradas" },
      { id: "criar",    label: "Cadastrar nova manutenção/licença" },
      { id: "editar",   label: "Editar manutenção (fornecedor, periodicidade)" },
      { id: "deletar",  label: "Excluir manutenção" },
    ],
  },
  {
    id: "exames",
    icon: "🩺",
    label: "Exames Médicos",
    desc: "Gestão de exames periódicos dos empregados",
    area: "gestao",
    acoes: [
      { id: "ver",          label: "Ver exames dos empregados", sensivel: true },
      { id: "lancar",       label: "Lançar exame realizado / dar baixa", sensivel: true },
      { id: "anexarResult", label: "Anexar resultado (PDF da clínica)", sensivel: true },
      { id: "desativar",    label: "Desativar exame", sensivel: true },
      { id: "configurar",   label: "Configurar tipos de exame (master)" },
    ],
  },
  {
    id: "demissao",
    icon: "👋",
    label: "Demissão",
    desc: "Processo de demissão com kanban + cascata de inativação",
    area: "gestao",
    acoes: [
      { id: "ver",       label: "Ver processos de demissão", sensivel: true },
      { id: "iniciar",   label: "Iniciar processo de demissão", sensivel: true },
      { id: "processar", label: "Processar subtarefas + anexar docs", sensivel: true },
      { id: "bloquear",  label: "Bloquear acesso do empregado manualmente", sensivel: true },
      { id: "cancelar",  label: "Cancelar processo (reverte tudo)", sensivel: true },
      { id: "concluir",  label: "Finalizar demissão (inativa empregado)", sensivel: true },
    ],
  },
  {
    id: "perfisAcesso",
    icon: "🛡️",
    label: "Perfis de Acesso",
    desc: "Quem mexe nos perfis de acesso em si. Normalmente só master.",
    area: "gestao",
    acoes: [
      { id: "ver",      label: "Ver perfis existentes" },
      { id: "criar",    label: "Criar novo perfil", sensivel: true },
      { id: "editar",   label: "Editar perfil existente", sensivel: true },
      { id: "excluir",  label: "Excluir perfil", sensivel: true },
      { id: "atribuir", label: "Atribuir perfil a pessoas", sensivel: true },
    ],
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────

/** Lookup rápido por moduleId. */
export const CATALOGO_POR_MODULO: Record<string, CatalogoModulo> = Object.fromEntries(
  CATALOGO.map(m => [m.id, m])
);

/** Lista todos os ids "moduleId.actionId" (útil pra validação e debug). */
export function listarTodasAcoes(): string[] {
  const out: string[] = [];
  for (const mod of CATALOGO) {
    for (const a of mod.acoes) out.push(`${mod.id}.${a.id}`);
  }
  return out;
}

/** Verifica se um par moduleId+actionId existe no catálogo. */
export function acaoExiste(moduleId: string, actionId: string): boolean {
  return !!CATALOGO_POR_MODULO[moduleId]?.acoes.some(a => a.id === actionId);
}

// ─── INFO DAS ÁREAS (pra agrupar no editor) ──────────────────────────────

export const AREA_INFO: Record<CatalogoModulo["area"], { label: string; icon: string }> = {
  operacao: { label: "Operação", icon: "🍽️" },
  appmise:  { label: "AppMise (em dev)", icon: "📦" },
  time:     { label: "Time", icon: "👥" },
  gestao:   { label: "Gestão", icon: "🏢" },
};
