// ─── PERFIL DE ACESSO ─────────────────────────────────────────────────────
// Sistema novo de permissões — substitui (gradualmente) o `permissions`
// baseado em ver/configurar. Master define perfis, atribui a pessoas.
//
// Estrutura:
//   - Coleção Firestore `/accessProfiles` (custom + meta de built-ins
//     editados localmente)
//   - Constantes em src/core/auth/builtinProfiles.ts pra os built-ins de
//     fábrica (Master implícito + Gerente de Restaurante por enquanto)
//   - Pessoa.profileIds[rid] aponta pro id do perfil que rege ela naquele
//     restaurante
//
// Catálogo de ações disponíveis em src/core/auth/actionCatalog.ts.

export type PermissoesPerfil = {
  // Mapa moduleId → actionId → boolean. Ações ausentes = false (negadas).
  // Ações presentes com true = permitidas. Mantemos a estrutura como mapa
  // (vs array) pra checks O(1) no canAcao().
  [moduleId: string]: { [actionId: string]: boolean };
};

export type AccessProfile = {
  id: string;
  nome: string;                       // "Gerente de Restaurante", etc.
  descricao?: string;
  builtin: boolean;                   // built-in vem do código, não pode deletar (mas pode editar)
  /**
   * Escopo de aplicação:
   *   null  → global (aparece no dropdown de todo restaurante)
   *   "X"   → exclusivo do restaurante X (só aparece nele)
   */
  restaurantId: string | null;
  permissions: PermissoesPerfil;
  criadoPor?: string;                 // pessoaId
  criadoEm: string;                   // ISO
  atualizadoPor?: string;
  atualizadoEm?: string;
};

// ─── TIPOS BASE ───

export type ModuleArea = "ops" | "dp" | "fin" | "planejamento" | "inst" | "master";

export type ModuleId =
  // Operação
  | "ocorrencias" | "reservas" | "checklists" | "contagens" | "temperaturas" | "fichas" | "eventos"
  | "horarios"
  // Time
  | "escala" | "freelas" | "reunioes" | "trilha" | "ideias" | "planoDeAcao" | "whatsappInbox"
  // Rotinas — lembretes recorrentes de tarefas do sistema (fechar ponto etc.)
  | "rotinas"
  // Escritório
  | "fechamentoEscala" | "gorjetas" | "vt" | "vr" | "beneficios" | "compras" | "recebimento" | "fechamentoCaixa" | "recursos" | "faleDp"
  | "pessoas" | "comunicados" | "configuracoes" | "excecoes" | "analise-ponto" | "admissao" | "sites" | "cardapio"
  | "uniformes"
  // Gestor de Tarefas + cadastros mestres
  | "tarefas" | "contasFixas" | "manutencoes"
  // Prazos Trabalhistas — agenda que agrega prazos de RH (experiências 45/90,
  // exames, uniformes/EPIs). Área AGENDA junto com Técnicos e Contas.
  | "prazosTrabalhistas"
  // Vendas — registro de vendas fora do sistema fiscal (entre empresas, permutas)
  | "vendas"
  // Faturas — faturas de cartão: subir, IA extrai/classifica, reembolso entre entidades
  | "faturas"
  // Exames médicos do empregado (Fase 7)
  | "exames"
  // Processo de Demissão (Fase 8)
  | "demissao"
  // Ferramentas e Credenciais — catálogo de acessos a sistemas externos
  // (iFood, Lalamove, BEES etc). Não armazena senhas, só metadado + link
  // pro Bitwarden.
  | "ferramentasCredenciais"
  // Chat — comunicação unificada (interno + WhatsApp externo).
  // Migra Comunicados, Fale com DP e notificações in-app pra mesma timeline.
  // WhatsApp via gateway plugável (Evolution / UAZAPI / Cloud API) em C4.
  | "chat"
  // Wiki de Processos — documentação viva dos processos internos por área.
  // Cada processo em texto/checklist/passo-a-passo + fotos; consulta da equipe.
  | "wikiProcessos"
  // Portal do Empregado — área pessoal do empregado (minha escala, meus
  // horários, minha gorjeta, futuro: minha folha de ponto, meus uniformes,
  // meus exames, meu VT, fale com DP). NÃO é item de sidebar (sidebar tem
  // o link "Meu Portal" separado); existe só pra o sistema de perfis decidir
  // o que cada empregado vê dentro da PortalPage.
  | "portalEmpregado"
  // Planner — agenda pessoal do dono (Google Calendar), single-user. Roteia em
  // /planner (fora do escopo de restaurante). Fica na seção "master".
  | "planner";

// ─── PLANO DE AÇÃO ───
// A Ação é a unidade executável do sistema. Nasce avulsa, ou a partir de uma
// ocorrência / ideia / reunião (origem). Tem responsável (pessoa), prazo, status
// e um log imutável de tratativas. Coleção `acoes`.
export type PlanoAcaoStatus = "aberta" | "em_andamento" | "concluida" | "cancelada";
export const ACAO_STATUS_LABEL: Record<PlanoAcaoStatus, string> = {
  aberta: "Aberta", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada",
};
export type AcaoPrioridade = "baixa" | "media" | "alta";
export type AcaoOrigemTipo = "ocorrencia" | "ideia" | "reuniao" | "avulsa";
export type AcaoLog = {
  id: string; em: string; autorId?: string | null; autorNome?: string;
  tipo: "criada" | "status" | "andamento" | "comentario"; texto: string;
};
export type Acao = {
  id: string;
  restaurantId: string;
  titulo: string;
  descricao?: string;
  responsavelId?: string | null;      // pessoaId
  responsavelNome?: string;           // snapshot
  prazo?: string | null;              // YYYY-MM-DD
  status: PlanoAcaoStatus;
  prioridade?: AcaoPrioridade;
  origem: { tipo: AcaoOrigemTipo; refId?: string | null; reuniaoId?: string | null; label?: string };
  log: AcaoLog[];
  criadoEm: string;
  criadoPor?: string;
  criadoPorNome?: string;
  atualizadoEm?: string;
  concluidoEm?: string | null;
  concluidoPor?: string | null;
  ativo: boolean;
};

// ─── PERMISSÕES ───

export type ModulePermission = {
  ver: boolean;        // pode visualizar o módulo (read)
  configurar: boolean; // pode configurar / editar (write)
  // Multi-unidades: escopo da permissão. undefined ou vazio = TODAS as unidades
  // (e qualquer dado sem unidade). Preenchido = só essas.
  unidades?: string[];
};

export type RestaurantPermissions = {
  [moduleId: string]: ModulePermission;
};

// Permissões "transversais" da pessoa em um restaurante (não por módulo)
export type PessoaSpecialPermissions = {
  pessoasExcluir?: boolean;             // pode excluir pessoas DEFINITIVAMENTE
  gorjetasConfigurarRegra?: boolean;    // pode mexer na regra de divisão de gorjeta (assembleia)
  escalaReabrir?: boolean;              // pode reabrir mês de escala fechado
  // Sites — granulares (módulo "sites" controla acesso base via canUse;
  // estas flags refinam o que a pessoa pode editar):
  sitesCardapio?: boolean;              // pode trocar o PDF do cardápio (PT/EN)
  sitesGeral?: boolean;                 // pode editar tudo o resto do site
                                        // (história, horários, contato, redes, flags, tema)
};

// Etapa de maturidade do módulo (independente de `status`).
// - undefined / null  → estável (sem badge)
// - "beta"            → funcional, mas em ajuste
// - "em_desenvolvimento" → pode mudar bastante, expectativa de bugs
export type ModuleEtapa = "beta" | "em_desenvolvimento";

export type ModuleDef = {
  id: ModuleId;
  area: ModuleArea;
  // Subárea opcional pra agrupar módulos relacionados dentro da área no
  // Sidebar. Vira um divider visual (Opção A). Vazio = sem agrupamento.
  // Ordem dos grupos = ordem do primeiro módulo de cada subárea no array.
  subarea?: string;
  label: string;
  icon: string;
  desc?: string;
  status: "ativo" | "em-breve" | "planejado";
  etapa?: ModuleEtapa;
  dependsOn?: ModuleId[];
  oculto?: boolean;   // não aparece no menu/início (não pronto ou em transição)
};

// ─── ESCALA / EQUIPE ───

export type Area = "Bar" | "Cozinha" | "Salão" | "Limpeza";
export const AREAS: Area[] = ["Bar", "Cozinha", "Salão", "Limpeza"];

// Tipo de vínculo do CARGO (define se quem tem esse cargo vê Portal do Empregado)
export type TipoVinculo = "registrado" | "provisorio" | "estagiario" | "terceirizado";
export const TIPOS_VINCULO: TipoVinculo[] = ["registrado", "provisorio", "estagiario", "terceirizado"];
export const TIPO_VINCULO_LABEL: Record<TipoVinculo, string> = {
  registrado: "Registrado (CLT)",
  provisorio: "Provisório / Freela",
  estagiario: "Estagiário",
  terceirizado: "Terceirizado",
};
// Quais tipos exigem que o empregado tenha Pessoa vinculada (login no sistema)
export const TIPOS_VINCULO_COM_PESSOA: TipoVinculo[] = ["registrado", "estagiario"];

export type Cargo = {
  id: string;
  restaurantId: string;
  nome: string;
  area: Area;

  tipoVinculo: TipoVinculo;
  pontos: number;          // pontos pra divisão de gorjeta (0 se sem gorjeta)
  semGorjeta: boolean;     // true → não recebe gorjeta (cobre sócio também)
  recebeProducao: boolean; // recebe gorjeta TODO dia (independente da escala) — ex: cozinha

  // Bate ponto na Sólides? Default por TipoVinculo (CLT=true, freela=false).
  // Override aqui se um cargo específico foge da regra (ex: gerente CLT que é
  // cargo de confiança → não bate). undefined = usa default por TipoVinculo.
  batePonto?: boolean;

  ativo: boolean;
  ordem: number;
  createdAt: string;

  // Mapeamento Sólides (Tangerino): id do cargo equivalente na conta da
  // Sólides do restaurante. Salvo automaticamente quando o nome casa
  // (case-insensitive sem acento) na aba Compatibilidade de cadastros.
  solidesId?: number;
};

// Default por TipoVinculo — base da cascata empregado→cargo→default.
export function defaultBatePontoPorVinculo(v: TipoVinculo): boolean {
  return v === "registrado" || v === "estagiario";
}

// Resolve se empregado bate ponto. Cascata: Empregado.batePonto > Cargo.batePonto > default por TipoVinculo.
// Empregados que NÃO batem ponto são suprimidos do relatório de inconformidades.
export function empregadoBatePonto(
  emp: { batePonto?: boolean } | null | undefined,
  cargo: { batePonto?: boolean; tipoVinculo: TipoVinculo } | null | undefined,
): boolean {
  if (!cargo) return true; // fallback seguro
  if (emp && typeof emp.batePonto === "boolean") return emp.batePonto;
  if (typeof cargo.batePonto === "boolean") return cargo.batePonto;
  return defaultBatePontoPorVinculo(cargo.tipoVinculo);
}

// Período de admissão / demissão. Empregado tem vários (trilha completa).
export type EmpregadoPeriodo = {
  admissao: string;              // YYYY-MM-DD
  demissao?: string | null;      // YYYY-MM-DD (null = vigente)
  motivoDemissao?: string;
  // Motivo da COBERTURA (freela mensalista): ex "cobertura de férias do Fulano".
  motivo?: string;
  registradoEm: string;          // ISO
  registradoPor: string;         // pessoaId
};

export type Empregado = {
  id: string;
  restaurantId: string;
  pessoaId?: string | null;      // só obrigatório pros tipos com Pessoa (registrado, estagiário)

  // Identidade básica (mesmo provisório/freela tem nome + às vezes CPF)
  nome: string;
  cpf?: string | null;

  cargoId: string;               // cargo VIGENTE HOJE (snapshot do histórico)
  empCode?: string | null;       // código interno
  codigoContabil?: string | null;
  // Override do "bate ponto" — quando definido, sobrescreve o default do
  // cargo. Use só pra casos atípicos (ex: estagiário sênior que não bate).
  // undefined = herda do cargo.
  batePonto?: boolean;
  // Link da pasta do empregado no Google Drive (criada na admissão). Pro DP
  // consultar contratos/documentos assinados depois.
  driveFolderUrl?: string | null;
  driveFolderId?: string | null;        // id da pasta [Nome] do empregado
  driveExamesFolderId?: string | null;  // subpasta "Exames Médicos" (cache)

  // Trilha de admissões/demissões
  periodos: EmpregadoPeriodo[];
  // Freela MENSALISTA: freela (provisório) que cobre um período (ex: férias de
  // um CLT) e, diferente do diarista, ENTRA NA GORJETA dos dias trabalhados.
  // Não bate ponto na Sólides — fecha a praticada pela prevista (Análise de
  // Ponto). O período de cobertura é o próprio `periodos` (admissão/demissão).
  // É só um marcador de clareza: a gorjeta já entra por cargo com pontos +
  // período ativo + escala; o fechamento entra por não bater ponto.
  freelaMensalista?: boolean;
  // Derivados pra performance (atualizados sempre que mexe em periodos)
  estaAtivo: boolean;            // true se último período sem demissão
  admissaoAtual?: string | null; // último período em aberto
  demitidoEm?: string | null;    // último período fechado (se inativo)

  // VT (qualquer empregado pode ter)
  vtAtivo?: boolean;
  vtPassagensPorDia?: number;
  vtValorPassagem?: number;
  // Auxílio fixo mensal (R$) — valor cheio adicionado ao VT do mês (não proporcional).
  // Independente de vtAtivo: pode haver empregado só com auxílio fixo (sem passagens).
  vtAuxilioFixoMensal?: number;
  // Default true (ausente ou true = recebe via Caju, vai no CSV).
  // Quando explicitamente false, a pessoa recebe VT por PIX direto ou outro
  // meio: continua no lote pra ser paga, mas fica fora do CSV exportado
  // pra Caju (aparece nas "ignoradas" com motivo claro).
  vtRecebePeloCaju?: boolean;

  // VR (Vale Refeição) — só usado quando Restaurant.usaVR = true.
  // Mesma lógica do VT mas com valor diário direto (sem "passagens por dia"),
  // e o desconto por absenteísmo NÃO conta falta justificada (regra de negócio).
  vrAtivo?: boolean;
  vrValorDiario?: number;       // R$ por dia trabalhado
  vrAuxilioFixoMensal?: number; // R$ — adicional fixo mensal (independente de vrAtivo)
  vrRecebePeloCaju?: boolean;   // mesmo conceito do vtRecebePeloCaju (default true)

  // Multi-unidades — só faz sentido quando restaurante.multiUnidades = true.
  // Ao marcar "Trabalho" na escala, vem pré-preenchido com essa unidade
  // (pode ser sobrescrito dia a dia).
  unidadePadraoId?: string | null;

  // Horários de trabalho — array versionado por validFrom (asc)
  workSchedules?: WorkSchedule[];

  // Contatos
  email?: string | null;
  telefone?: string | null;
  emergenciaNome?: string | null;
  emergenciaTelefone?: string | null;

  createdAt: string;
  createdBy: string;
};

// ─── HORÁRIO DE TRABALHO ────────────────────────────────────────────────────

// 1 dia da semana — usado em days[0..6] (0=Dom, 6=Sáb)
export type HorarioDia = {
  active: boolean;
  in?: string;       // "HH:MM" — entrada
  out?: string;      // "HH:MM" — saída (pode ser do dia seguinte se overnight)
  break?: number;    // intervalo intra-jornada em minutos (= duração da janela, quando há janela)
  // Janela do intervalo (entrada do intervalo / volta) — espelha a Sólides, que
  // fixa início E fim do intervalo. Quando presentes, `break` = intervalOut−intervalIn.
  // Opcionais p/ retrocompat: dados antigos têm só `break` (duração, sem janela).
  intervalIn?: string;   // "HH:MM" — início do intervalo
  intervalOut?: string;  // "HH:MM" — fim do intervalo (volta)
  // Multi-unidades: override de unidade pra esse dia. Vazio = usa
  // empregado.unidadePadraoId. Útil pra alternância semanal recorrente
  // (ex: toda quinta atua na Filial em vez da Matriz).
  unidadeId?: string;
};

// Ciclo de domingo (modelo: trabalha N domingos seguidos, depois folga 1)
export type SundayCycle = {
  workCount: number;   // N domingos trabalhados consecutivos
  offCount: number;    // M domingos folgados (na prática, sempre 1)
  refDate: string;     // YYYY-MM-DD — primeiro domingo de FOLGA da sequência
};

// Carga horária = soma dos totalContract de cada dia ativo (em minutos).
// Hora ficta noturna (Art. 73 CLT): 22h–05h conta como 52min30s = 1h pra contrato.
export type WorkSchedule = {
  validFrom: string;            // YYYY-MM-DD — vigência
  type: "single" | "alternating";
  totalContract: number;        // minutos somados (calculado e gravado pra performance)

  // Se type === "single":
  days?: { [key: number]: HorarioDia };  // 0..6
  sundayCycle?: SundayCycle | null;

  // Se type === "alternating":
  weeks?: {
    A: { days: { [key: number]: HorarioDia }; sundayCycle?: SundayCycle | null; totalContract: number };
    B: { days: { [key: number]: HorarioDia }; sundayCycle?: SundayCycle | null; totalContract: number };
  };
  anchor?: { date: string; week: "A" | "B" };  // qual semana é A/B na data informada

  registradoEm: string;         // ISO
  registradoPor: string;        // pessoaId
  motivo?: string;
  // Se a vigência veio de uma escala nomeada (snapshot dos dias na atribuição):
  escalaId?: string;            // id da EscalaNomeada de origem
  escalaNome?: string;          // nome no momento da atribuição (rótulo)
};

// Escala nomeada/reutilizável: UM padrão semanal cadastrado uma vez e atribuído
// a vários empregados. Mesma forma de dias do WorkSchedule. SEM alternância e SEM
// ciclo de domingo — pra alternar (inclusive folga de domingo) cadastra-se uma
// escala por padrão e compõe-se a alternância no cadastro do empregado.
// A atribuição faz SNAPSHOT dos dias numa vigência de `empregado.workSchedules[]`
// (editar a escala depois NÃO mexe em quem já está vinculado — nova vigência manual).
export type EscalaNomeada = {
  id: string;
  restaurantId: string;
  nome: string;
  descricao?: string;
  totalContract: number;        // minutos somados dos dias ativos
  days: { [key: number]: HorarioDia };  // 0..6
  ativo: boolean;               // false = arquivada (não aparece na seleção)
  criadoEm: string;             // ISO
  criadoPor: string;            // pessoaId
  atualizadoEm?: string;        // ISO
};

// Status do dia na escala
export type ScheduleStatus =
  | "trabalho" | "folga" | "freela"
  | "comp" | "comp_trab"
  | "ferias" | "falta_j" | "falta_i";

// Inversão informal de domingo entre dois empregados.
// Conceito: A trabalhou no domingo X (era pra folgar) e B folgou (era pra
// trabalhar); na recíproca, no domingo Y, A folga e B trabalha. Cálculos
// (escala/gorjeta/VT) NÃO são afetados — é só registro de auditoria pra
// reconhecer a combinação que rolou entre os empregados.
export type SundaySwap = {
  id: string;
  restaurantId: string;
  empAId: string;
  empANome: string;        // snapshot
  empBId: string;
  empBNome: string;        // snapshot
  date1: string;           // YYYY-MM-DD — domingo da troca (A trabalha, B folga)
  date2: string;           // YYYY-MM-DD — domingo da recíproca (A folga, B trabalha)
  motivo?: string;         // texto livre opcional
  criadoEm: string;
  criadoPor: string;       // pessoaId
  criadoPorNome?: string;  // snapshot
};

// Snapshot de uma versão antiga da escala (gravado ao fechar/reabrir)
export type EscalaSnapshot = {
  snapshotEm: string;             // ISO
  motivo: "fechamento" | "reabertura";
  motivoTexto?: string;
  prevista: { [empregadoId: string]: { [date: string]: ScheduleStatus } };
  real:     { [empregadoId: string]: { [date: string]: ScheduleStatus } };
  vtPagoEm?: string | null;
  fechadoEm?: string | null;
  fechadoPor?: string | null;
  registradoPor: string;
};

// Escala mensal — armazenada como /escalas/{rid}_{yyyy-mm}
//
// Tem 2 versões da mesma escala:
//   - PREVISTA  (planejamento; trava ao "fechar prevista")
//   - PRATICADA (= antiga "real"; o que de fato aconteceu)
//
// CICLO DE VIDA (lifecycle do mês):
//   1. "em_planejamento": prevista é derivada do horário cadastrado + overrides.
//      Pode editar livremente. VT NÃO pode ser lançado.
//   2. "prevista_fechada": fotografia tirada — materializa o derivado nas células
//      ainda vazias e grava previstaFechadaEm. VT pode ser lançado.
//      Praticada começa a ser editada por cima da prevista.
//   3. "vt_pago": após pagamento do lote VT (vtPagoEm). Prevista vira IMUTÁVEL
//      permanente (só admin reabre se nenhum lote VT pago; se já pago, só master
//      e cancela o lote junto).
//   4. "praticada_fechada": fim de mês (fechadoEm). Trava tudo.
//
// O campo `real` no DB mantém o nome legado pra retrocompat — UI mostra "Praticada".
export type EscalaMes = {
  id: string;
  restaurantId: string;
  ano: number;
  mes: number;

  // PREVISTA: planejamento que vai pra cálculo de VT antecipado
  prevista: { [empregadoId: string]: { [date: string]: ScheduleStatus } };
  // PRATICADA: o que de fato aconteceu (mantém nome `real` no DB)
  real:     { [empregadoId: string]: { [date: string]: ScheduleStatus } };

  // Multi-unidades: pra cada célula "trabalho", em qual unidade o
  // empregado atuou. Só presente quando o restaurante tem multiUnidades.
  // Mapas paralelos a prevista/real — mesma estrutura, valor = unidadeId.
  unidadesPrevistas?: { [empregadoId: string]: { [date: string]: string } };
  unidadesReais?:     { [empregadoId: string]: { [date: string]: string } };

  // ── Integração com Registros de Ponto ───────────────────────────────────
  // Metadata dos ajustes na PRATICADA — quem ajustou e por quê, pra fechar
  // o ciclo Ponto→Escala (origem do status, link com o apontamento que
  // gerou). Mapas paralelos a `real`. Só presente em células ajustadas.
  realAjustes?: {
    [empregadoId: string]: {
      [date: string]: AjusteEscalaMeta;
    };
  };
  // Marcadores de ATRASO (não mudam status — célula continua "trabalho",
  // mas ganha ícone 🕐). Detectados automaticamente pela regra
  // `atrasoEntrada` do módulo de Ponto (> 10min após previsto).
  // [legacy] Substituído por `apontamentos[].tipo === "atraso"`. Render
  // continua suportando ambos durante a transição — escrita nova vai no
  // schema novo.
  atrasos?: {
    [empregadoId: string]: {
      [date: string]: AtrasoEscalaMeta;
    };
  };
  // Apontamentos gerais na praticada (atraso, jornada longa, intrajornada
  // curta, trabalho em folga, batida extra). Array por dia — suporta
  // múltiplos no mesmo dia (ex: atraso + jornada longa).
  apontamentos?: {
    [empregadoId: string]: {
      [date: string]: ApontamentoEscalaMeta[];
    };
  };

  // ── Fase 2: PREVISTA FECHADA (snapshot) ──────────────────────────────────
  // Ao fechar a prevista, todas as células ainda vazias são materializadas com
  // o status derivado do horário cadastrado. Depois disso, edição da prevista
  // bloqueia (admin pode reabrir se nenhum lote VT pago; depois disso, master).
  previstaFechadaEm?: string | null;
  previstaFechadaPor?: string | null;
  previstaFechadaPorNome?: string | null;
  previstaFechadaMotivo?: string;
  previstaReabertaEm?: string | null;
  previstaReabertaPor?: string | null;
  previstaReabertaPorNome?: string | null;
  previstaReabertaMotivo?: string;

  // ── Fase 3: VT PAGO (consequência de marcar lote VT como pago) ────────────
  vtPagoEm?: string | null;       // ISO — congela "prevista" após pagamento
  vtPagoPor?: string | null;

  // ── Fase 4: PRATICADA FECHADA (mês 100% encerrado) ────────────────────────
  fechadoEm?: string | null;
  fechadoPor?: string | null;
  fechadoMotivo?: string;
  reabertoEm?: string | null;
  reabertoPor?: string | null;
  reabertoMotivo?: string;

  // Snapshots de versões anteriores (gravados ao fechar e ao reabrir)
  versoesAnteriores?: EscalaSnapshot[];

  updatedAt: string;
};

// ─── Integração Ponto × Escala ─────────────────────────────────────────────

// Motivos do ajuste manual da praticada (gerado pelo MotivoAjusteModal).
// Mapeia 1-pra-1 com ScheduleStatus.
export type AjusteEscalaMotivo =
  | "falta_i"      // 🚫 Falta injustificada
  | "falta_j"      // 📋 Falta justificada
  | "atestado"     // 🏥 Atestado médico (= falta_j + obs)
  | "ferias"       // 🏖️ Férias
  | "folga"        // 🌴 Folga (troca informal)
  | "comp"         // 🔄 Compensação (folgou pra compensar trabalho extra)
  | "comp_trab"    // ⚒️ Comp. trabalhado (trabalhou pra compensar folga futura)
  | "freela"       // 🎒 Freela (apareceu sem ser da casa)
  | "trabalho";    // ✓ Trabalho normal (pra marcacaoForaDaEscala)

export const AJUSTE_MOTIVO_LABEL: Record<AjusteEscalaMotivo, string> = {
  falta_i:   "🚫 Falta injustificada",
  falta_j:   "📋 Falta justificada",
  atestado:  "🏥 Atestado médico",
  ferias:    "🏖️ Férias",
  folga:     "🌴 Folga",
  comp:      "🔄 Folga por compensação",
  comp_trab: "⚒️ Trabalho por compensação",
  freela:    "🎒 Freela",
  trabalho:  "✓ Trabalho",
};

// Cada motivo aponta pro ScheduleStatus correspondente. "atestado" e
// "falta_j" ambos viram falta_j (observação carrega o sub-motivo).
export const AJUSTE_MOTIVO_PARA_STATUS: Record<AjusteEscalaMotivo, ScheduleStatus> = {
  falta_i:   "falta_i",
  falta_j:   "falta_j",
  atestado:  "falta_j",
  ferias:    "ferias",
  folga:     "folga",
  comp:      "comp",
  comp_trab: "comp_trab",
  freela:    "freela",
  trabalho:  "trabalho",
};

export type AjusteEscalaOrigem = "manual" | "ponto_auto" | "solides_sync";

export type AjusteEscalaMeta = {
  origem: AjusteEscalaOrigem;        // como chegou na praticada
  motivo?: AjusteEscalaMotivo;       // setado quando origem = "ponto_auto"
  observacao?: string;               // texto livre opcional (ex: nº do atestado)
  apontamentoId?: string;            // link com o apontamento de origem
  apontamentoRuleId?: string;        // ruleId pra exibir contexto
  ajustadoEm: string;                // ISO
  ajustadoPor: string;               // pessoaId
  ajustadoPorNome?: string;
  // Status anterior ao ajuste — pra undo/auditoria
  statusAnterior?: ScheduleStatus;
};

export type AtrasoEscalaMeta = {
  minutos: number;                   // qtd de minutos de atraso
  previsto?: string;                 // HH:MM previsto
  realizado?: string;                // HH:MM efetivo
  detectadoEm: string;               // ISO — quando o relatório detectou
  eventoTrilhaId?: string;           // link com EventoTrilha criado
};

// Pedido do EMPREGADO pra corrigir o status de um dia da escala dele. Vai pra
// aba "Ajustes solicitados" no módulo Escala; líder/DP aprova (aplica na
// praticada) ou recusa. Coleção: `escalaSolicitacoes`.
export type EscalaSolicitacaoStatus = "pendente" | "aprovado" | "recusado";
export type EscalaSolicitacao = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  empregadoNome?: string;
  tipo?: "dia" | "horario";          // "dia" (status de um dia) ou "horario" (jornada contratual). Default "dia".
  data?: string;                     // YYYY-MM-DD do dia (tipo "dia")
  anoMes?: string;                   // YYYY-MM (doc da escala = `${rid}_${anoMes}`)
  statusAtual?: ScheduleStatus | null;   // o que ele via no dia
  fonteAtual?: "real" | "prevista" | "derivado" | null;
  statusSolicitado?: ScheduleStatus; // o que ele acha que é o correto (tipo "dia")
  motivo: string;                    // explicação curta do empregado
  gorjetaPaga?: boolean;             // snapshot: o dia já tinha gorjeta publicada
  status: EscalaSolicitacaoStatus;
  criadoEm: string;                  // ISO
  criadoPor: string;                 // pessoaId
  respondidoEm?: string | null;
  respondidoPor?: string | null;
  respondidoPorNome?: string | null;
  respostaMotivo?: string | null;    // motivo da recusa (ou nota da aprovação)
};

// ─── FALE COM DP ──────────────────────────────────────────────────────────
// Canal do empregado pra falar com o DP/gestão. Enviado pelo Portal do
// Empregado (categoria + identificado/anônimo). Recebido na Central de Avisos
// (Chat) por quem tem a permissão portalEmpregado.receberFaleDp.
//
// LGPD: quando anônimo, NÃO gravamos autorId/autorNome — não rastreamos quem
// enviou. O texto do aviso de uso deixa isso explícito.
export type FaleDpCategoria = "elogio" | "reclamacao" | "denuncia" | "outros";
export type FaleDpStatus = "nova" | "tratada";

export const FALE_DP_CATEGORIA_LABEL: Record<FaleDpCategoria, string> = {
  elogio: "Elogio",
  reclamacao: "Reclamação",
  denuncia: "Denúncia",
  outros: "Outros",
};
export const FALE_DP_CATEGORIA_ICONE: Record<FaleDpCategoria, string> = {
  elogio: "👏",
  reclamacao: "😕",
  denuncia: "🚨",
  outros: "💬",
};

// Aviso de uso respeitoso mostrado antes de enviar (aprovado pelo dono).
export const FALE_DP_AVISO_USO =
  "Este canal é levado a sério. Mesmo mensagens anônimas devem ser " +
  "respeitosas — ofensas, xingamentos e linguagem de baixo calão não são " +
  "aceitos. Mensagens anônimas não registram quem enviou. Em caso de " +
  "ameaça, calúnia, injúria ou outras condutas ilícitas contra pessoas da " +
  "empresa, a empresa recomendará que os envolvidos busquem medidas legais " +
  "cabíveis, incluindo a identificação do autor pelas vias legais " +
  "apropriadas. Use este canal de boa-fé.";

export type FaleDpMensagem = {
  id: string;
  restaurantId: string;
  categoria: FaleDpCategoria;
  anonimo: boolean;
  autorId?: string | null;        // ausente quando anônimo
  autorNome?: string | null;      // ausente quando anônimo
  cargoNome?: string | null;      // ausente quando anônimo
  texto: string;
  status: FaleDpStatus;
  criadoEm: string;               // ISO
  tratadaEm?: string | null;
  tratadaPor?: string | null;     // pessoaId de quem marcou como tratada
  tratadaPorNome?: string | null;
  tratadaNota?: string | null;    // observação opcional ao tratar
};

// Apontamento na escala praticada — generalização do schema `atrasos` pra
// cobrir todos os fatos da apuração (atrasos, jornada > 10h, intrajornada
// curta, trabalho em folga, batidas extras). NÃO muda o status do dia
// (continua "trabalho", "folga" etc) — só adiciona um marcador com tooltip
// na grade. Ao fechar a praticada, cada apontamento aplicado vira evento
// na Trilha do Empregado.
export type ApontamentoTipoEscala =
  | "atraso"              // chegou tarde da entrada prevista
  | "jornada_longa"       // jornada total > 10h (CLT Art. 59)
  | "intrajornada_curta"  // intervalo < 55min com jornada > 6h (CLT Art. 71)
  | "trabalhou_folga"     // bateu ponto em dia de folga programada
  | "batida_extra"        // mais batidas do que o esperado (sobrou no dia)
  ;

export const APONTAMENTO_TIPO_LABEL: Record<ApontamentoTipoEscala, string> = {
  atraso:              "Atraso",
  jornada_longa:       "Jornada longa",
  intrajornada_curta:  "Intrajornada curta",
  trabalhou_folga:     "Trabalho em folga",
  batida_extra:        "Batida extra",
};

export const APONTAMENTO_TIPO_ICON: Record<ApontamentoTipoEscala, string> = {
  atraso:              "⏰",
  jornada_longa:       "⏱",
  intrajornada_curta:  "🍽",
  trabalhou_folga:     "⚠",
  batida_extra:        "📍",
};

export type ApontamentoEscalaMeta = {
  tipo: ApontamentoTipoEscala;
  detalhe: string;                   // texto pronto pro tooltip
  minutos?: number;                  // ex: 18 (atraso), 720 (12h de jornada)
  previsto?: string;                 // HH:MM previsto (atraso)
  realizado?: string;                // HH:MM efetivo
  detectadoEm: string;               // ISO
  aplicadoPor?: string;              // pessoaId que aplicou
  aplicadoPorNome?: string;
  eventoTrilhaId?: string;           // link com EventoTrilha (gerado ao fechar praticada)
};

// Status derivado do lifecycle pra UI
export type EscalaFase = "em_planejamento" | "prevista_fechada" | "vt_pago" | "praticada_fechada";

export const ESCALA_FASE_LABEL: Record<EscalaFase, string> = {
  em_planejamento:     "Em planejamento",
  prevista_fechada:    "Prevista fechada",
  vt_pago:             "VT lançado",
  praticada_fechada:   "Mês fechado",
};

export const ESCALA_FASE_ICON: Record<EscalaFase, string> = {
  em_planejamento:     "📋",
  prevista_fechada:    "🔒",
  vt_pago:             "💸",
  praticada_fechada:   "✅",
};

export function getEscalaFase(escala: { previstaFechadaEm?: string | null; vtPagoEm?: string | null; fechadoEm?: string | null } | null): EscalaFase {
  if (!escala) return "em_planejamento";
  if (escala.fechadoEm) return "praticada_fechada";
  if (escala.vtPagoEm) return "vt_pago";
  if (escala.previstaFechadaEm) return "prevista_fechada";
  return "em_planejamento";
}

// ─── ENTIDADES PRINCIPAIS ───

// Multi-unidades: restaurante pode operar em N endereços físicos (Matriz,
// Filial, Cozinha de Produção). Quando `multiUnidades=true`, escala/gorjeta
// passam a registrar em qual unidade o trabalho/arrecadação aconteceu.
//
// Tipos de unidade:
//   - "atendimento": arrecada gorjeta (Matriz, Filial)
//   - "producao":    NÃO arrecada — empregados que trabalham aqui entram
//                    na divisão de gorjeta de todas as unidades de atendimento
//                    do dia (se tiverem cargo com recebeProducao=true)

export type UnidadeTipo = "atendimento" | "producao";

export const UNIDADE_TIPO_LABEL: Record<UnidadeTipo, string> = {
  atendimento: "Atendimento",
  producao:    "Produção",
};

export type Unidade = {
  id: string;
  nome: string;                     // ex: "Matriz", "Filial", "Cozinha"
  tipo: UnidadeTipo;
  cnpj?: string;                    // opcional — pode compartilhar CNPJ com outras
  ordem: number;
  ativa: boolean;
};

// ─── ENDEREÇOS (cadastro compartilhado) ────────────────────────────────────
// Cada empresa tem 1+ endereços físicos. Fonte única usada por Contas Fixas e
// Manutenções/Licenças (um item amarra a 1+ endereços; N:N via referência de
// ID). `restaurantId` pode MUDAR = transferência de endereço entre empresas
// (leva o histórico junto, pois os itens referenciam o ID do endereço).
// Coleção Firestore: `enderecos`.
export type Endereco = {
  id: string;
  restaurantId: string;             // empresa dona (pode mudar = transferência)
  apelido: string;                  // curto, ex: "Harmonia 321", "Matriz"
  logradouro?: string;              // completo, ex: "Rua Harmonia, 321"
  ativo?: boolean;                  // default true; false = encerrado (só histórico)
  criadoEm?: string;
  criadoPor?: string | null;
};

// ─── CONTATOS EXTERNOS (admissão) ──────────────────────────────────────────
// Stakeholder externo do processo (clínica de exames, contabilidade,
// financeiro do escritório, etc) com seus canais possíveis e o preferido.
// Cada empresa atende de um jeito — Triagem só agenda por telefone, por
// exemplo. O atalho da subtarefa lê `canalPreferido` pra escolher o que
// abrir (Gmail, WhatsApp ou modal de telefone).
export type CanalContato = "email" | "whatsapp" | "telefone";

export type ContatoExterno = {
  nome: string;
  email?: string;
  whatsapp?: string;     // só dígitos (sem DDI). DDI 55 é adicionado pelo helper.
  telefone?: string;     // texto formatado, ex: "(11) 3801-3363"
  endereco?: string;     // opcional — útil pra clínica
  canalPreferido: CanalContato;
};

export type Restaurant = {
  id: string;
  nome: string;
  shortCode: string;
  // Subdomínio público (ex: "lobozo" → lobozo.planejamento.app)
  // Opcional. Lowercase, [a-z0-9-]. Único entre restaurantes.
  subdomain?: string;
  cnpj?: string;
  razaoSocial?: string;
  codigoContabil?: string;
  endereco?: string;
  whatsappFinanceiro?: string;
  whatsappOperacional?: string;
  serviceStartDate?: string;
  modulosAtivos: ModuleId[];

  // É um restaurante de fato? Default true (retrocompat: tudo que já existe é
  // restaurante). Desmarcar em entidades de gestão pessoal/escritório (ex:
  // Quibebe) — só rótulo/organização; os módulos continuam manuais.
  restaurante?: boolean;

  // Multi-unidades. Default false — restaurante single-unidade não vê nada
  // disso na UI e o sistema funciona como antes.
  multiUnidades?: boolean;
  unidades?: Unidade[];

  // Portal do Empregado: o que aparece pra empregado registrado deste restaurante
  //
  // @deprecated Substituído pelo sistema de Perfis de Acesso (ActionCatalog
  // module "portalEmpregado"). Cada empregado recebe um perfil que define
  // se vê escala/horários/gorjeta/etc. Mantido aqui só pra compat com docs
  // antigos no Firestore — código de leitura foi removido.
  portalEmpregado?: {
    escala?: boolean;          // default true
    gorjetas?: boolean;        // default true
    comunicados?: boolean;     // default true
  };

  // Configs internas de módulos (alteráveis via ⚙️ do módulo)
  taxRate?: number;            // % retenção da gorjeta

  // ─── Admissão (módulo Admissão) ───
  admissaoPrazoDias?: number;            // 1-7, default 1
  whatsappDP?: string;                   // só dígitos — pra candidato mandar docs
  // Contatos externos com canal preferido (email/whatsapp/telefone). Cada
  // restaurante pode customizar. Defaults em formTemplate.ts.
  contatosAdmissao?: {
    clinicaExames?: ContatoExterno;
    contabilidade?: ContatoExterno;
    financeiroBanco?: ContatoExterno;
  };
  // Templates de mensagem configuráveis pelo restaurante. Cada string
  // suporta placeholders {{nome}}. Defaults em formTemplate.ts —
  // restaurante pode editar e o sistema substitui as variáveis na hora
  // de gerar a mensagem.
  templatesAdmissao?: {
    envioLink?: string;             // WhatsApp inicial pro candidato com o link
    instrucoesCandidato?: string;   // mensagem única 3 blocos
    agendamentoClinica?: string;    // pra contato com a clínica
    envioContabilidade?: string;    // pra contato com contabilidade
    solicitacaoBanco?: string;      // pra contato com financeiro
  };
  // Campos legados — mantidos pra retrocompat até migração completa.
  // Novos lugares devem ler de contatosAdmissao.
  emailContabilidade?: string;
  emailClinicaExames?: string;
  clinicaExamesNome?: string;
  clinicaExamesEndereco?: string;
  clinicaExamesTelefone?: string;
  admissaoFormSchema?: FormField[];      // default = template ficha Senador (vide formTemplate.ts)
  admissaoKanbanColunas?: KanbanColuna[]; // default = 4 colunas padrão
  admissaoSubtarefasTemplate?: SubtarefaTemplate[]; // default = SUBTAREFAS_TEMPLATE_DEFAULT (formTemplate.ts)
  // Pasta "Empregados Ativos" desta empresa no Google Drive — apontada uma
  // vez via Picker nas Configurações de Admissão. A cada admissão, o app cria
  // a pasta [Nome do empregado] aqui dentro (com subpastas + "docs assinados").
  driveEmpregadosAtivosFolderId?: string;
  driveEmpregadosAtivosFolderNome?: string;
  // Fornecedores padrão de exames médicos (editável em Exames → Configuração).
  exameFornecedores?: string[];
  // Pasta raiz no Drive pras notas de recebimento de produtos. Dentro dela o
  // app cria subpastas por semana (segunda→domingo) nomeadas "dd.mm.aa a dd.mm.aa".
  recebimentoDriveFolderId?: string;
  recebimentoDriveFolderNome?: string;
  // Fechamento de caixa: pasta raiz no Drive (subpastas dia/turno) + sócios notificados.
  fechamentoDriveFolderId?: string;
  fechamentoDriveFolderNome?: string;
  manutencoesDriveFolderId?: string;       // pasta-raiz dos laudos de Manutenções no Drive
  manutencoesDriveFolderNome?: string;
  cartaoChavePixPadrao?: string;           // Pix padrão pra receber reembolsos de cartão (módulo Faturas)
  cartoesCadastrados?: string[];           // nomes dos cartões que sobem fatura aqui — a IA casa cada PDF com um deles
  fechamentoSociosEmails?: string[];
  fechamentoSociosWhatsapp?: string[];     // números (só dígitos) que recebem o aviso por WhatsApp
  fechamentoEmailRemetente?: string;       // remetente do email aos sócios (domínio verificado na Resend)
  fechamentoComandas?: ComandaCadastro[];  // comandas cadastradas (nº + finalidade)
  fechamentoTemIfood?: boolean;            // restaurante tem iFood → conciliação aceita planilha do iFood
  fechamentoPedirObsTurno?: boolean;       // pede observação do turno ao fechar (ancorada no movimento vs. média)
  // Signatário fixo da empresa no Clicksign (representante que assina os
  // contratos de admissão junto com o empregado). Configurado 1x por empresa.
  clicksignEmpresaNome?: string;
  clicksignEmpresaEmail?: string;
  // Assinatura Automática: a empresa assina sozinha ao gerar o envelope
  // (requer Termo de Assinatura Automática configurado no Clicksign).
  // Exige CPF + nascimento do representante batendo com o termo.
  clicksignEmpresaAssinaturaAuto?: boolean;
  clicksignEmpresaCpf?: string;
  clicksignEmpresaNascimento?: string;   // YYYY-MM-DD
  // Documentos PADRÃO por restaurante — mesmo PDF pra toda admissão. O DP
  // sobe uma vez no Drive e cola o link aqui; o checklist da admissão
  // pré-popula o termo correspondente automaticamente. Hoje só Regulamento
  // Interno tem esse comportamento; futuro pode expandir.
  regulamentoInternoUrl?: string;        // URL do PDF no Drive
  regulamentoInternoFileId?: string;     // fileId extraído (pra ir no Clicksign)

  // Lista de documentos que o candidato deve fornecer no form público (último
  // bloco). Se ausente, usa DOCUMENTOS_ADMISSAO_DEFAULT. Editável em
  // Admissão → Configurações → Documentos.
  documentosAdmissao?: DocumentoAdmissaoDef[];

  // Limites de carga horária semanal (em minutos) usados nas validações de horário
  // Default: 43h55min a 44h00min (CLT padrão)
  horarioConfig?: {
    cargaSemanalMinMin?: number;  // default 2635 (43:55)
    cargaSemanalMaxMin?: number;  // default 2640 (44:00)
  };

  // Config de Eventos — pessoas que podem aparecer nos pickers do
  // fechamento de evento (vendedor que captou, negociou, acompanhou).
  // Master/admin seleciona em Eventos → Configurações.
  eventosConfig?: {
    pessoasComerciaisIds?: string[];
    // Responsável padrão que recebe todos os leads novos do restaurante.
    // Aplicado automaticamente a leads públicos e manuais; alterável por evento.
    responsavelPadraoId?: string;
    responsavelPadraoNome?: string;
    // Percentuais de comissão (configuráveis) por classificação e atividade.
    // Aplicados sobre fechamento.faturamentoBrutoSemGorjeta.
    comissao?: {
      inbound: { negociacaoFechamento: number; acompanhamento: number };
      outbound: { captacao: number; negociacaoFechamento: number; acompanhamento: number };
    };
  };

  ativo: boolean;
  createdAt: string;
  createdBy: string;
};

export type Pessoa = {
  id: string;                  // = uid Firebase Auth (ou autoid em pré-cadastros)
  email: string;
  nome: string;
  cpf?: string;                // obrigatório na UI nova; opcional só pra docs migrados sem CPF
  whatsapp?: string;
  whatsappOptIn?: boolean;     // aceita receber avisos/lembretes pelo WhatsApp
  pix?: string;                // chave PIX (CPF, email, telefone ou chave aleatória) — obrigatório pra freelas
  isMaster: boolean;
  restaurantIds: string[];
  permissions: { [restaurantId: string]: RestaurantPermissions };
  specialPermissions?: { [restaurantId: string]: PessoaSpecialPermissions };

  // ── Perfis de Acesso (sistema novo, em transição) ────────────────────────
  // Map restaurantId → id do AccessProfile que rege essa pessoa nesse
  // restaurante. undefined ou ausente = só self-service. Master ignora isso
  // (sempre tem tudo).
  //
  // Convivência com `permissions` legado: o helper canAcao() checa primeiro
  // o profile; se a pessoa não tem profile pra esse rid, faz fallback no
  // mapeamento velho ver/configurar. Conforme as pages migram pra canAcao(),
  // o sistema antigo vai sendo aposentado.
  profileIds?: { [restaurantId: string]: string };

  // ── Vínculo lógico por restaurante (sistema novo, em transição) ─────────
  // Map restaurantId → vínculo lógico (clt | estagiario | freela |
  // prestadorAdm | diretoria). Define o comportamento da pessoa NAQUELE
  // restaurante (entra na escala? bate ponto? recebe gorjeta? etc) via
  // COMPORTAMENTO_POR_VINCULO em src/core/vinculos/comportamento.ts.
  //
  // null/ausente = vínculo não definido. Helper resolverVinculo() tenta
  // inferir de empregado.cargo.tipoVinculo (legacy) ou pessoa.isMaster
  // como fallback. Idealmente o admin preenche explicitamente.
  vinculos?: { [restaurantId: string]: "clt" | "estagiario" | "freela" | "prestadorAdm" | "diretoria" };

  // ── Toggles "depende da pessoa" (sistema de vínculos) ───────────────────
  // Pra atributos marcados como "pess" na matriz COMPORTAMENTO_POR_VINCULO,
  // o admin marca caso a caso. Por restaurante porque vínculo é por rid.
  // Ex: Freela "recebeVT" é "pess" — admin marca pessoaToggles[rid].recebeVT = true
  // se esse freela específico ganha VT.
  pessoaToggles?: {
    [restaurantId: string]: {
      apareceNaEscalaMensal?: boolean;
      temHorarioCadastrado?: boolean;
      recebeGorjeta?: boolean;
      recebeVT?: boolean;
      recebeVR?: boolean;
      temCargoAssociado?: boolean;
    };
  };

  // "Convite simplificado": quando a pessoa é vinculada a um restaurante novo,
  // o rid entra aqui pra virar um badge "📨 Você foi adicionada a X" no header
  // dela. Ela vê, clica em "ok, vi", e o rid sai dessa lista.
  novosRestaurantes?: string[];

  // Cadastro incompleto: importação trouxe pessoa sem CPF — admin precisa
  // completar antes de algum fluxo crítico (signup, login, etc).
  cadastroIncompleto?: boolean;

  // Status de acesso
  ativa: boolean;              // false = bloqueio imediato (polling 30s detecta)
  inativadaEm?: string | null; // ISO (momento da ação)
  inativadaPor?: string | null;
  inativadaUltimoDia?: string | null; // YYYY-MM-DD — último dia trabalhado informado na demissão
  motivoInativacao?: string;
  // Demissão espelhada na Sólides (integração). Presente = já demitido lá.
  solidesDemissao?: { em: string; data: string; motivo?: string; por?: string } | null;

  createdAt: string;
};

// ─── REGRA DE DIVISÃO DE GORJETA (versionada por restaurante) ───────────────
// Cada mudança nas regras de divisão cria nova SplitVersion com effectiveFrom.
// O cálculo de gorjeta usa a versão vigente no DIA da gorjeta (snapshot no doc).

export type SplitMode = "global_points" | "area_points";

// Tipo de configuração de uma área (modo "area_points")
export type AreaPercentConfig =
  | { type: "fixed"; value: number }                  // ex: { fixed, value: 40 } → 40%
  | { type: "perEmployee"; valuePerEmp: number };     // ex: { perEmployee, 2 } → 2% × N empregados ativos

export type AtaMeta = {
  meetingDate?: string;       // YYYY-MM-DD da assembleia
  meetingLocation?: string;
  motivo?: string;
};

export type SplitVersion = {
  id: string;
  restaurantId: string;
  effectiveFrom: string;       // YYYY-MM-DD — vigência
  // Preenchido AUTOMATICAMENTE quando uma nova versão sucede esta (= nova.from - 1).
  // null = vigente indefinidamente. Garante cobertura contínua (sem dia órfão).
  effectiveUntil?: string | null;
  mode: SplitMode;

  // Só preenchido se mode === "area_points"
  percentages?: {
    Bar:     AreaPercentConfig;
    Cozinha: AreaPercentConfig;
    Salão:   AreaPercentConfig;
    Limpeza: AreaPercentConfig;
  };

  taxRate: number;             // % retenção (0-100). Migrado de Restaurant.taxRate.

  ata?: AtaMeta;

  status: "active" | "draft" | "superseded";
  createdAt: string;
  createdBy: string;
};

// ─── GORJETAS ───

export type Gorjeta = {
  id: string;                   // single-unidade: `${restaurantId}_${date}`
                                // multi-unidades: `${restaurantId}_${date}_${unidadeId}`
  restaurantId: string;
  date: string;
  // Multi-unidades: unidade que arrecadou. Vazio em rest single-unidade.
  // Só unidades de tipo "atendimento" podem arrecadar.
  unidadeId?: string | null;
  valorBruto: number;
  // Marca explicitamente "não houve gorjeta hoje". Diferente de "ainda não
  // lancei" (que é a ausência do doc). Quando true, valorBruto=0 e o dia é
  // ignorado em qualquer cálculo de divisão.
  semGorjeta?: boolean;
  // Visibilidade pro portal do empregado. False (default) = só escritório vê.
  // True = publicada → empregado vê na sua tela com a divisão CONGELADA.
  publicada?: boolean;
  publicadaEm?: string | null;
  publicadaPor?: string | null;
  publicadaPorNome?: string | null;
  // Pagamento: publicada ≠ paga. "paga" = a gorjeta do dia já foi quitada com o
  // time. Bloqueia pedido de ajuste de escala naquele dia. Pagar congela o
  // snapshot (publica se ainda não estava).
  paga?: boolean;
  pagaEm?: string | null;
  pagaPor?: string | null;
  pagaPorNome?: string | null;
  taxRate: number;              // snapshot — usado só pra retrocompat de docs antigos
  valorLiquido: number;         // snapshot — idem
  observacao?: string;
  // Snapshot da divisão. Congelado no ato de publicar — a partir daí o cálculo
  // dessa gorjeta NÃO recalcula mesmo que a escala mude. Pra recalcular, é
  // necessário despublicar e publicar de novo.
  divisaoSnapshot?: DivisaoItem[];
  // ISO da última vez que o divisaoSnapshot foi recalculado (mantendo a
  // publicação original). Usado pra detectar "escala mudou após a divisão":
  // a comparação é feita contra o MAIS RECENTE entre publicadaEm e este campo,
  // senão o banner de "escala alterada" nunca some depois do recálculo.
  divisaoRecalculadaEm?: string | null;
  paidAt?: string | null;       // DEPRECATED: pagamento agora é mensal
  paidBy?: string | null;       // idem
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type DivisaoItem = {
  empregadoId: string;
  empregadoNome: string;
  cargoNome: string;
  area: Area;
  pontos: number;
  valor: number;
  motivo: "trabalho" | "freela" | "producao";
};

// ─── VT (VALE TRANSPORTE) ───

export type VTFolhaItem = {
  diasTrabalhados: number;
  passagensPorDia: number;
  valorPassagem: number;
  total: number;
  paidAt?: string | null;
  paidBy?: string | null;
  observacao?: string;
};

export type VTFolha = {
  id: string;                    // `${restaurantId}_${yyyy-mm}`
  restaurantId: string;
  ano: number;
  mes: number;
  itens: { [empregadoId: string]: VTFolhaItem };
  updatedAt: string;
};

// ─── VT — LOTE DE PAGAMENTO (novo modelo) ───────────────────────────────────
// Substitui VTFolha. 1 lote = 1 fechamento de VT por restaurante/mês.
// Linhas são snapshots — depois de criado, valores não mudam mesmo se o
// empregado for editado ou a escala for ajustada.

export type VTLoteStatus = "rascunho" | "pago" | "cancelado";

export const VT_LOTE_STATUS_LABEL: Record<VTLoteStatus, string> = {
  rascunho:  "Aguardando pagamento",
  pago:      "Pago",
  cancelado: "Cancelado",
};

// Modo da linha dentro do lote.
//   - "integral": mês inteiro (default; vtBase = todos os dias trabalhados)
//   - "parcial":  cobre só um range de datas (periodoInicio / periodoFim);
//                 vtBase = dias trabalhados nesse range
//   - "ajuste":   linha de correção (lote.tipo === "ajuste"); valor manual,
//                 não respeita o cálculo automático
export type VTLoteLinhaModo = "integral" | "parcial" | "ajuste";

// 1 linha por empregado no lote. Tudo gravado por valor (snapshot).
export type VTLoteLinha = {
  empregadoId: string;
  nome: string;                  // snapshot
  cargoNome: string;             // snapshot
  area: Area;                    // snapshot (pra agrupar mesmo se mudar depois)

  // VT diário (snapshot do cadastro no momento da criação)
  passagensPorDia: number;
  valorPassagem: number;
  diasTrabalhados: number;       // contados da escala prevista do mês (range do `modo`)

  // Componentes do total
  auxFixoMensal: number;         // R$ — auxílio fixo (snapshot do cadastro)
  vtBase: number;                // dias × pass/dia × valor (snapshot, pré-desconto)

  // Desconto sugerido (calculado a partir do refMes = mês do lote − 2)
  descontoSugeridoAtivo: boolean;          // toggle por linha — default true
  descontoSugerido: number;                // R$ — sempre ≥ 0
  descontoSugeridoJustificativa?: string;  // ex: "2 ausências em mar/26: 12 (falta_j), 25 (falta_i)"
  descontoSugeridoRefMes?: string;         // "YYYY-MM" do mês de referência

  // Lançamentos manuais
  descontoManual: number;        // R$
  auxPontual: number;            // R$

  total: number;                 // calculado: auxFixo + vtBase − descontoSugerido(se ativo) − descontoManual + auxPontual

  // ── Modo da linha (novo — pra suporte a parcial + ajuste) ───────────────
  // Default "integral" pra retrocompat (lotes antigos sem esse campo).
  modo?: VTLoteLinhaModo;
  // Só pra modo "parcial" — range fechado de datas YYYY-MM-DD
  periodoInicio?: string;
  periodoFim?: string;
  // Snapshots do mês COMPLETO (pra mostrar quanto ainda resta pagar)
  totalMesCompleto?: number;
  diasMesCompleto?: number;
  // Pra modo "ajuste" — texto livre da justificativa
  justificativa?: string;
};

// Histórico de eventos do lote (criar → pago → cancelar → reabrir → ...)
export type VTLoteEvento = {
  acao: "criado" | "pago" | "reaberto" | "cancelado";
  em: string;                    // ISO
  por: string;                   // pessoaId
  porNome?: string;              // snapshot
  motivo?: string;
};

// Tipo do lote.
//   - "regular": fluxo normal — calcula automaticamente, valida overlap
//                contra outros lotes do mesmo mês (sem pagar duas vezes)
//   - "ajuste":  só linhas manuais (valores arbitrários, com justificativa).
//                NÃO valida overlap (é justamente pra corrigir diferenças).
//                Pode ter total positivo ou negativo.
export type VTLoteTipo = "regular" | "ajuste";

export type VTLote = {
  id: string;                    // auto-id Firestore
  restaurantId: string;
  ano: number;                   // mês de competência
  mes: number;
  status: VTLoteStatus;
  tipo?: VTLoteTipo;             // default "regular" pra retrocompat

  // Linhas snapshot
  linhas: VTLoteLinha[];

  // Totais snapshot
  totalGeral: number;
  totalPorArea: { [area: string]: number };

  // Timestamps + auditoria
  criadoEm: string;
  criadoPor: string;
  criadoPorNome?: string;
  pagoEm?: string | null;
  pagoPor?: string | null;
  pagoPorNome?: string | null;
  canceladoEm?: string | null;
  canceladoPor?: string | null;
  canceladoPorNome?: string | null;
  motivoCancelamento?: string;

  // Histórico completo
  historico: VTLoteEvento[];

  updatedAt: string;
};

// ─── VR (Vale Refeição) ─────────────────────────────────────────────────────
// Espelho simplificado do VT — só MVP por enquanto, sem parcial/ajuste/etc.
// Ativa restaurante a restaurante via `modulosAtivos` (adiciona "vr").

export type VRLoteStatus = "rascunho" | "pago" | "cancelado";

export type VRLoteLinha = {
  empregadoId: string;
  nome: string;                  // snapshot
  cargoNome: string;             // snapshot
  area: Area;                    // snapshot

  // Snapshot do cadastro no momento da criação
  valorDiario: number;           // R$ por dia trabalhado
  diasTrabalhados: number;       // contados da escala prevista do mês

  // Componentes do total
  auxFixoMensal: number;         // R$
  vrBase: number;                // dias × valorDiario

  // Desconto sugerido — REGRA VR: não conta falta_j (justificada).
  descontoSugeridoAtivo: boolean;
  descontoSugerido: number;
  descontoSugeridoJustificativa?: string;
  descontoSugeridoRefMes?: string; // "YYYY-MM"

  // Lançamentos manuais
  descontoManual: number;
  auxPontual: number;

  total: number;                 // auxFixo + vrBase − descontoSugerido(se ativo) − descontoManual + auxPontual
};

export type VRLoteEvento = {
  acao: "criado" | "pago" | "reaberto" | "cancelado";
  em: string;
  por: string;
  porNome?: string;
  motivo?: string;
};

export type VRLote = {
  id: string;
  restaurantId: string;
  ano: number;
  mes: number;
  status: VRLoteStatus;

  linhas: VRLoteLinha[];

  totalGeral: number;
  totalPorArea: { [area: string]: number };

  criadoEm: string;
  criadoPor: string;
  criadoPorNome?: string;
  pagoEm?: string | null;
  pagoPor?: string | null;
  pagoPorNome?: string | null;
  canceladoEm?: string | null;
  canceladoPor?: string | null;
  canceladoPorNome?: string | null;
  motivoCancelamento?: string;

  historico: VRLoteEvento[];
  updatedAt: string;
};

export const VR_LOTE_STATUS_LABEL: Record<VRLoteStatus, string> = {
  rascunho:  "Rascunho",
  pago:      "Pago",
  cancelado: "Cancelado",
};

// ─── BENEFÍCIOS (lote único VT + VR + auxílio fixo) ──────────────────────────
// A partir de junho/2026, VT e VR são lançados/pagos juntos num único lote e
// exportados num só CSV pro Caju (Mobilidade = VT + auxílio fixo; Refeição =
// VR). Cada linha aninha o snapshot do VT e do VR do empregado. Lotes antigos
// de vtLotes/vrLotes seguem como histórico read-only.

export type BeneficiosLoteStatus = "rascunho" | "pago" | "cancelado";

export type BeneficiosLoteLinha = {
  empregadoId: string;
  nome: string;                  // snapshot
  cargoNome: string;             // snapshot
  area: Area;                    // snapshot
  vt: VTLoteLinha;               // Mobilidade (total já inclui auxílio fixo)
  vr: VRLoteLinha;               // Refeição
  vtRecebePeloCaju: boolean;     // snapshot do cadastro
  vrRecebePeloCaju: boolean;     // snapshot do cadastro
  total: number;                 // vt.total + vr.total
};

export type BeneficiosLoteEvento = {
  acao: "criado" | "pago" | "reaberto" | "cancelado";
  em: string;
  por: string;
  porNome?: string;
  motivo?: string;
};

export type BeneficiosLote = {
  id: string;
  restaurantId: string;
  ano: number;
  mes: number;
  status: BeneficiosLoteStatus;

  linhas: BeneficiosLoteLinha[];

  totalGeral: number;
  totalMobilidade: number;       // soma dos vt.total (Caju Mobilidade)
  totalRefeicao: number;         // soma dos vr.total (Caju Refeição)
  totalPorArea: { [area: string]: number };

  criadoEm: string;
  criadoPor: string;
  criadoPorNome?: string;
  pagoEm?: string | null;
  pagoPor?: string | null;
  pagoPorNome?: string | null;
  canceladoEm?: string | null;
  canceladoPor?: string | null;
  canceladoPorNome?: string | null;
  motivoCancelamento?: string;

  historico: BeneficiosLoteEvento[];
  updatedAt: string;
};

export const BENEFICIOS_LOTE_STATUS_LABEL: Record<BeneficiosLoteStatus, string> = {
  rascunho:  "Rascunho",
  pago:      "Pago",
  cancelado: "Cancelado",
};

// Mês a partir do qual o lote único de Benefícios passa a valer. Antes disso,
// VT e VR ficam só no histórico (lotes separados antigos).
export const BENEFICIOS_INICIO = { ano: 2026, mes: 6 };

// ─── COMUNICADOS ────────────────────────────────────────────────────────────

export type ComunicadoPrioridade = "info" | "aviso" | "urgente";

export type ComunicadoDestinatarios =
  | { tipo: "todos" }
  | { tipo: "areas"; areas: Area[] }
  | { tipo: "empregados"; empregadoIds: string[] };

export type Comunicado = {
  id: string;
  restaurantId: string;
  titulo: string;
  corpo: string;                  // texto simples por enquanto
  prioridade: ComunicadoPrioridade;
  destinatarios: ComunicadoDestinatarios;
  validoAte?: string | null;      // YYYY-MM-DD — depois disso, comunicado some pro empregado
  ativo: boolean;                 // se desativado, não aparece (mas mantém histórico)
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export type ComunicadoLeitura = {
  id: string;                     // `${comunicadoId}_${pessoaId}`
  comunicadoId: string;
  pessoaId: string;
  restaurantId: string;
  lidoEm: string;                 // ISO
};

// ─── BANCO DE IDEIAS ────────────────────────────────────────────────────────

// Status no Kanban:
//   aberta          → recém-registrada
//   em_discussao    → alguém está tratando dela (entre 2 reuniões, sem decisão final)
//   gerada_reuniao  → foi gerada DENTRO de uma reunião (precisa de ação)
//   puxada_tarefa   → virou tarefa, encerra aqui no banco
//   descartada      → não vai virar nada
// Legados "em_pauta" e "discutida" são tratados como "em_discussao" pelo Kanban.
export type IdeiaStatus =
  | "aberta" | "em_discussao" | "gerada_reuniao" | "puxada_tarefa" | "descartada"
  | "em_pauta" | "discutida"; // legados — aceitos no read, não usados em writes novos

export const IDEIA_STATUS_LABEL: Record<IdeiaStatus, string> = {
  aberta:         "Nova",
  em_discussao:   "Em discussão",
  gerada_reuniao: "Gerada em reunião",
  puxada_tarefa:  "Puxada pra tarefa",
  descartada:     "Descartada",
  em_pauta:       "Em discussão",  // legado
  discutida:      "Em discussão",  // legado
};

export type Ideia = {
  id: string;
  restaurantId: string;
  titulo: string;
  descricao?: string;
  categoria?: string;            // ex: "Operação", "Cardápio", "Cultura"
  status: IdeiaStatus;
  reuniaoId?: string | null;     // legado — se em_pauta/discutida → linkada a uma reunião
  reuniaoIdOrigem?: string | null;   // reunião onde ela foi GERADA
  tarefaIdGerada?: string | null;    // tarefa pra onde ela foi puxada
  acaoIdGerada?: string | null;      // ação (Plano de Ação) gerada a partir dela
  log?: AcaoLog[];                   // tratativas (ex.: "virou ação em reunião X")
  puxadaEm?: string | null;
  puxadaPor?: string | null;
  puxadaPorNome?: string;
  criadoEm: string;
  criadoPor: string;             // pessoaId
  criadoPorNome?: string;
  atualizadoEm: string;
};

// ─── REUNIÕES ──────────────────────────────────────────────────────────────

export type ReuniaoTipo = "lideres" | "equipe" | "individual" | "outro";
export const REUNIAO_TIPO_LABEL: Record<ReuniaoTipo, string> = {
  lideres:    "Líderes",
  equipe:     "Equipe",
  individual: "Individual / 1:1",
  outro:      "Outro",
};

export type ReuniaoStatus = "planejada" | "realizada" | "cancelada";

export type PautaItem = {
  id: string;
  titulo: string;
  descricao?: string;
  ideiaId?: string | null;       // se importado do Banco de Ideias
  ocorrenciaId?: string | null;  // se importado do módulo Ocorrências
  ordem: number;
  discutido: boolean;
  notas?: string;                // notas específicas do tópico — vira "ata" implícita
  // Se o tópico foi convertido em tarefa formal no Gestor de Tarefas
  tarefaIdGerada?: string | null;
  acaoIdGerada?: string | null;  // ação gerada (Plano de Ação) a partir deste item
};

export type AcaoStatus = "pendente" | "feito" | "cancelado";

export type AcaoReuniao = {
  id: string;
  descricao: string;
  responsavelEmpregadoId?: string | null;
  responsavelNome?: string;      // snapshot pra exibir mesmo após mudança
  prazo?: string | null;         // YYYY-MM-DD
  status: AcaoStatus;
  concluidoEm?: string | null;
  observacao?: string;
  // Se a ação foi "virada em tarefa formal" no Gestor de Tarefas,
  // guarda o ID da tarefa criada (linka pra Tarefas, evita duplicação).
  tarefaIdGerada?: string | null;
};

export type ParticipanteReuniao = {
  empregadoId?: string;          // pode ter externo sem empregadoId
  nome: string;
};

export type Reuniao = {
  id: string;
  restaurantId: string;
  titulo: string;
  tipo: ReuniaoTipo;
  data: string;                  // YYYY-MM-DD
  horario?: string;              // HH:MM
  local?: string;
  participantes: ParticipanteReuniao[];
  pauta: PautaItem[];
  ata?: string;                  // texto livre
  acoes: AcaoReuniao[];
  status: ReuniaoStatus;
  // Modo "reunião ao vivo": marca quando o líder clicou "▶️ Iniciar".
  // Mostra cronômetro até virar realizada/cancelada. Status continua
  // "planejada" durante a execução; vira "realizada" quando finalizada.
  iniciadaEm?: string | null;    // ISO
  iniciadaPor?: string | null;   // pessoaId
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// ─── TRILHA DO EMPREGADO ───────────────────────────────────────────────────

export type EventoTrilhaTipo =
  | "admissao" | "demissao" | "readmissao"
  | "mudanca_cargo" | "promocao" | "promocao_salarial"
  | "treinamento" | "feedback_positivo" | "feedback_negativo"
  | "ocorrencia" | "premiacao" | "advertencia"
  | "ferias" | "exame_realizado" | "reuniao_individual"
  | "entrega_uniforme"
  | "ponto_atraso" | "ponto_falta_j" | "ponto_falta_i" | "ponto_compensacao"
  | "outro";

export const EVENTO_TRILHA_LABEL: Record<EventoTrilhaTipo, string> = {
  admissao:           "Admissão",
  demissao:           "Demissão",
  readmissao:         "Readmissão",
  mudanca_cargo:      "Mudança de cargo",
  promocao:           "Promoção",
  promocao_salarial:  "Promoção salarial (sem mudar cargo)",
  treinamento:        "Treinamento",
  feedback_positivo:  "Feedback positivo",
  feedback_negativo:  "Feedback negativo",
  ocorrencia:         "Ocorrência",
  premiacao:          "Premiação",
  advertencia:        "Advertência",
  ferias:             "Férias",
  exame_realizado:    "Exame realizado",
  reuniao_individual: "Reunião individual",
  entrega_uniforme:   "Entrega de uniforme/EPI",
  ponto_atraso:       "Atraso (ponto)",
  ponto_falta_j:      "Falta justificada",
  ponto_falta_i:      "Falta injustificada",
  ponto_compensacao:  "Compensação de horas",
  outro:              "Outro",
};

export const EVENTO_TRILHA_ICON: Record<EventoTrilhaTipo, string> = {
  admissao:           "🎉",
  demissao:           "👋",
  readmissao:         "🔄",
  mudanca_cargo:      "🔁",
  promocao:           "🚀",
  promocao_salarial:  "💰",
  treinamento:        "📚",
  feedback_positivo:  "👍",
  feedback_negativo:  "👎",
  ocorrencia:         "⚠️",
  premiacao:          "🏆",
  advertencia:        "📝",
  ferias:             "🏖️",
  exame_realizado:    "🩺",
  reuniao_individual: "🗣️",
  entrega_uniforme:   "🦺",
  ponto_atraso:       "⏰",
  ponto_falta_j:      "🟡",
  ponto_falta_i:      "🔴",
  ponto_compensacao:  "🔄",
  outro:              "📌",
};

export type EventoTrilha = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  empregadoNomeSnapshot?: string;     // snapshot pra UI mesmo se empregado for renomeado
  tipo: EventoTrilhaTipo;
  data: string;                       // YYYY-MM-DD
  titulo: string;
  descricao?: string;
  // Anexo Drive opcional (PDF advertência, foto entrega EPI, link laudo, etc)
  anexoUrl?: string;
  anexoNome?: string;
  // Metadados estruturados específicos por tipo (ex: advertencia: tipo/motivo;
  // promocao_salarial: valorAntes/depois; ferias: inicio/fim/dias).
  metadados?: Record<string, unknown>;
  fonte: "auto" | "manual";           // auto = gerado pelo sistema
  refOrigem?: string;                 // id do doc origem (ex: processoDemissao/exameEmpregado)
  registradoEm: string;
  registradoPor: string;
  registradoPorNome?: string;
  // ── Anulação (em vez de hard delete) ──
  // Eventos da trilha NÃO são apagados. Quando marcados como anulados,
  // continuam visíveis no histórico mas com tarja "ANULADO" + motivo.
  // Pra ter visualização limpa, UI pode filtrar por padrão.
  anulado?: boolean;
  anuladoEm?: string;
  anuladoPor?: string;
  anuladoPorNome?: string;
  motivoAnulacao?: string;
};

// Log de visualização de trilha — LGPD/auditoria.
// Toda vez que alguém abre a trilha de um empregado, grava-se aqui.
export type TrilhaVisualizacaoLog = {
  id: string;
  restaurantId: string;
  empregadoId: string;                // empregado cuja trilha foi vista
  empregadoNomeSnapshot?: string;
  visualizadoPor: string;             // pessoaId
  visualizadoPorNome?: string;
  visualizadoEm: string;              // ISO
  contexto: "lista" | "empregado" | "tipo" | "manual";
};

// ─── OCORRÊNCIAS ───────────────────────────────────────────────────────────

export type OcorrenciaGravidade = "elogio" | "leve" | "media" | "grave";

export const OCORRENCIA_GRAVIDADE_LABEL: Record<OcorrenciaGravidade, string> = {
  elogio: "Elogio",
  leve:   "Leve",
  media:  "Média",
  grave:  "Grave",
};

export const OCORRENCIA_GRAVIDADE_ICON: Record<OcorrenciaGravidade, string> = {
  elogio: "🌟",
  leve:   "ℹ️",
  media:  "⚠️",
  grave:  "🚨",
};

// Status no Kanban:
//   aberta          → recém-registrada
//   em_apuracao     → alguém está investigando
//   gerada_reuniao  → foi gerada DENTRO de uma reunião (precisa ação)
//   puxada_tarefa   → virou tarefa, encerra aqui no banco
//   resolvida       → resolvida sem virar tarefa
//   arquivada       → arquivada sem ação
export type OcorrenciaStatus =
  | "aberta" | "em_apuracao" | "gerada_reuniao" | "puxada_tarefa"
  | "resolvida" | "arquivada";

export const OCORRENCIA_STATUS_LABEL: Record<OcorrenciaStatus, string> = {
  aberta:         "Aberta",
  em_apuracao:    "Em apuração",
  gerada_reuniao: "Gerada em reunião",
  puxada_tarefa:  "Puxada pra tarefa",
  resolvida:      "Resolvida",
  arquivada:      "Arquivada",
};

export type Ocorrencia = {
  id: string;
  restaurantId: string;
  data: string;                          // YYYY-MM-DD
  hora?: string;                         // HH:MM
  titulo: string;
  descricao: string;
  gravidade: OcorrenciaGravidade;
  status: OcorrenciaStatus;
  categoria?: string;                    // ex: "Atendimento", "Cozinha", "Financeiro"
  // Envolvidos
  empregadosEnvolvidos: string[];        // empregadoIds
  clienteNome?: string;                  // externo (texto livre)
  // Resolução
  resolucao?: string;                    // texto da resolução
  resolvidaEm?: string | null;           // ISO
  resolvidaPor?: string | null;          // pessoaId
  // Refs cruzadas (fluxo Ideias/Reuniões/Tarefas)
  reuniaoIdOrigem?: string | null;       // reunião onde foi gerada
  tarefaIdGerada?: string | null;        // tarefa pra onde foi puxada
  acaoIdGerada?: string | null;          // ação (Plano de Ação) gerada a partir dela
  log?: AcaoLog[];                       // tratativas (ex.: "virou ação em reunião X")
  puxadaEm?: string | null;
  puxadaPor?: string | null;
  puxadaPorNome?: string;
  // Auditoria
  criadaEm: string;                      // ISO
  criadaPor: string;                     // pessoaId
  criadaPorNome?: string;
  atualizadaEm: string;
};

// ─── CHECKLISTS ─────────────────────────────────────────────────────────────

export type ChecklistFrequencia = "diaria" | "semanal" | "mensal" | "avulsa";

export const CHECKLIST_FREQ_LABEL: Record<ChecklistFrequencia, string> = {
  diaria:  "Diária",
  semanal: "Semanal",
  mensal:  "Mensal",
  avulsa:  "Avulsa",
};

export type ChecklistItemTemplate = {
  id: string;
  texto: string;
  ordem: number;
  obrigatorio: boolean;       // se true, run não fecha sem marcar
  exigeFoto?: boolean;        // se true, run exige foto de prova ao marcar feito
  exigeObs?: boolean;         // se true, run pede observação no item
  descricao?: string;         // instrução de "como fazer" este item
  fotoGuiaUrl?: string;       // foto de referência (como deve ficar) — Storage
};

// Turno do checklist (abertura / meio / fechamento). Ajuda a separar as rotinas
// de abertura das de fechamento no dia.
export type ChecklistTurno = "abertura" | "meio" | "fechamento";
export const CHECKLIST_TURNO_LABEL: Record<ChecklistTurno, string> = {
  abertura: "Abertura", meio: "Meio", fechamento: "Fechamento",
};

export type ChecklistTemplate = {
  id: string;
  restaurantId: string;
  nome: string;
  descricao?: string;
  area?: Area;                      // opcional — pode ser geral
  frequencia: ChecklistFrequencia;
  turno?: ChecklistTurno | null;    // abertura / meio / fechamento
  // pra "diaria" — quais dias da semana (0=Dom..6=Sáb). Vazio = todos.
  diasSemana?: number[];
  // horário de referência (ex: "08:00" pra abertura). Pra dashboard.
  horarioReferencia?: string;
  // Atribuição — quem é responsável por preencher (pessoas e/ou funções/áreas).
  // Vazio dos dois = qualquer pessoa com permissão.
  responsaveisIds?: string[];       // pessoaIds
  funcoes?: Area[];                 // áreas/funções responsáveis
  itens: ChecklistItemTemplate[];
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export type ChecklistRunItemResultado = {
  itemId: string;
  textoSnapshot: string;            // snapshot pra preservar mesmo após editar template
  feito: boolean;
  observacao?: string;
  fotoUrl?: string;                 // foto de prova anexada na execução — Storage
  marcadoEm?: string;               // ISO
  feitoPorId?: string | null;       // quem marcou (assinatura — multiusuário ao vivo)
  feitoPorNome?: string | null;
};

// Log de atividade da execução — quem fez o quê e quando (multiusuário).
export type ChecklistRunLogTipo = "iniciou" | "marcou" | "desmarcou" | "obs" | "removeu_obs" | "foto" | "finalizou";
export type ChecklistRunLog = {
  id: string; em: string;           // ISO
  autorId?: string | null; autorNome?: string;
  itemId?: string | null; tipo: ChecklistRunLogTipo; texto: string;
};

export type ChecklistRunStatus = "rascunho" | "completo" | "incompleto";

export type ChecklistRun = {
  id: string;
  restaurantId: string;
  templateId: string;
  templateNomeSnapshot: string;
  templateAreaSnapshot?: Area;
  data: string;                     // YYYY-MM-DD
  executorEmpregadoId?: string | null;
  executorNome: string;             // snapshot
  itens: ChecklistRunItemResultado[];   // snapshot/denormalizado (escrito na criação e no finalizar)
  resultado?: Record<string, ChecklistRunItemResultado>;  // fonte AO VIVO (por itemId) — escrita item a item p/ multiusuário
  log?: ChecklistRunLog[];              // trilha de atividade (quem marcou/desmarcou/observou)
  totalItens: number;
  feitos: number;
  obrigatoriosFeitos: number;
  obrigatoriosTotal: number;
  status: ChecklistRunStatus;
  iniciadoEm: string;
  finalizadoEm?: string | null;
  atualizadoEm?: string;
  observacaoGeral?: string;
};

// ─── RESERVAS + CRM ─────────────────────────────────────────────────────────

export type Cliente = {
  id: string;
  restaurantId: string;
  nome: string;
  telefone?: string;                  // formato livre
  email?: string;
  aniversario?: string | null;        // MM-DD (sem ano, opcional ano "YYYY-MM-DD")
  observacoes?: string;
  restricoesAlimentares?: string;     // texto livre (alergias, vegano, etc)
  tags?: string[];                    // ["VIP", "frequente", etc]
  // Stats derivados (atualizados ao criar reserva chegou/cancelada)
  totalReservas?: number;
  totalCompareceu?: number;
  totalNoShow?: number;
  ultimaVisita?: string | null;       // YYYY-MM-DD
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export type Mesa = {
  id: string;
  restaurantId: string;
  nome: string;                       // ex: "Mesa 4", "Bar 2", "Varanda 1"
  capacidade: number;                 // qtd máx de pessoas
  setor?: string;                     // LEGADO — substituído por salaoId
  // Salão ao qual a mesa pertence. Opcional pra retrocompat com mesas
  // criadas antes dessa relação existir (UI mostra "sem salão" pra elas
  // e oferece atribuir). Mesas novas criadas via UI exigem salaoId.
  salaoId?: string;
  ativa: boolean;
  ordem: number;
};

// ─── SALÕES (configuração de reservas) ───────────────────────────────────
// Restaurante pode ter um ou mais salões (varanda, jardim, salão principal,
// bar, etc). Cada salão decide como controla disponibilidade:
//
//   "por_capacidade"  → salão tem um total fixo de pessoas, mesas de tamanhos
//                       variados que se acomodam. Sistema soma reservas do
//                       slot e libera vagas até o limite.
//                       ex: 10 pax no salão, mesas de 2 a 5 pax
//
//   "por_mesas"       → salão tem N mesas com min/max pax cada. Cada reserva
//                       ocupa 1 mesa. Quando todas as mesas do slot estão
//                       ocupadas, esconde disponibilidade.
//                       ex: 6 mesas de 4 a 6 pax cada
export type ModeloCapacidadeSalao = "por_capacidade" | "por_mesas";

export type Salao = {
  id: string;
  restaurantId: string;
  nome: string;                       // ex: "Salão Principal", "Varanda"
  descricao?: string;                 // mostrada pro cliente no form de reserva
  ordem: number;
  ativo: boolean;
  modeloCapacidade: ModeloCapacidadeSalao;
  // ─ Modelo "por_capacidade"
  capacidadeMaxPax?: number;          // total de pessoas que cabem no salão
  paxMinPorMesaCap?: number;          // tamanho mínimo de mesa permitido (ex: 2)
  paxMaxPorMesaCap?: number;          // tamanho máximo de mesa permitido (ex: 5)
  // ─ Modelo "por_mesas"
  numMesas?: number;                  // qtd de mesas iguais no salão (ex: 6)
  paxMinPorMesa?: number;             // qtd mínima de pax que cada mesa aceita (ex: 4)
  paxMaxPorMesa?: number;             // qtd máxima de pax por mesa (ex: 6)
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export const MODELO_CAPACIDADE_LABEL: Record<ModeloCapacidadeSalao, string> = {
  por_capacidade: "Por capacidade do salão",
  por_mesas:      "Por mesas fixas",
};

// ─── JANELAS DE RESERVA ────────────────────────────────────────────────
// Restaurante define quais horários de reserva existem em cada dia da semana
// e quais salões estão ativos em cada horário (slot).
//
// Doc id = restaurantId (1:1 com restaurante).
//
// Ex: domingo só almoço 12h e 12:30h (apenas Salão); sexta 19h e 20h em
// Salão + Varanda; segunda fechado (sem slots).

export type SlotReserva = {
  horario: string;                    // "HH:MM"
  salaoIds: string[];                 // quais salões aceitam reserva nesse horário
};

export type JanelaDiaReserva = {
  dia: number;                        // 0=domingo, 6=sábado
  slots: SlotReserva[];               // ordenados por horário (sem slots = sem reservas)
};

// ─── EXCEÇÕES DE RESERVA POR DATA ──────────────────────────────────────
// Sobrescrevem o padrão semanal (`JanelaDiaReserva`) pra datas específicas.
// Cada documento representa UMA exceção e fica numa coleção `excecoesReserva`.
// Múltiplas exceções podem existir pra mesma data (ex: 2 bloqueios de slot
// diferentes + 1 janela extra). O helper `resolverDisponibilidadeDia` mescla
// todas e devolve a lista efetiva de slots do dia.
//
// Tipos:
//   bloqueio       — não aceita reservas (escopo=dia_inteiro ou slot)
//   personalizacao — slot do padrão semanal, mas com salões/pax override
//   janela_extra   — adiciona slot novo num dia que normalmente não tem
//                    aquele horário (ou no dia inteiro, se fechado no padrão)
export type EscopoExcecaoReserva  = "dia_inteiro" | "slot";
export type TipoExcecaoReserva    = "bloqueio" | "personalizacao" | "janela_extra";

export type ExcecaoReserva = {
  id: string;
  restaurantId: string;
  data: string;                       // "YYYY-MM-DD"
  escopo: EscopoExcecaoReserva;
  // Só preenchido quando escopo === "slot" (e obrigatório nesses casos)
  horario?: string;                   // "HH:MM"
  tipo: TipoExcecaoReserva;
  // Override de salões habilitados nesse slot. Só pra personalizacao e
  // janela_extra. Undefined em personalizacao = herda do padrão.
  salaoIds?: string[];
  // Teto de pax pra esse slot específico. Útil pra reduzir capacidade num
  // dia movimentado sem mexer no padrão. Undefined = sem limite extra.
  paxMaxOverride?: number;
  motivo?: string;                    // anotação interna (não mostrada ao cliente)
  criadoEm: string;
  criadoPor: string;
  criadoPorNome: string;
};

// Status resolvido de um slot na agenda. Usado pra UI colorida e pra o
// form público decidir o que mostrar.
//   normal         — slot do padrão semanal sem exceções
//   bloqueado      — exceção de bloqueio impede reserva
//   personalizado  — slot do padrão mas com override (salões/pax)
//   extra          — slot fora do padrão semanal (janela extra criada manualmente)
export type StatusSlotResolvido = "normal" | "bloqueado" | "personalizado" | "extra";

export type SlotResolvido = {
  horario: string;                    // "HH:MM"
  salaoIds: string[];                 // efetivos (após override)
  status: StatusSlotResolvido;
  paxMaxOverride?: number;
  // Ids das exceções que afetaram esse slot (auditoria / UI ações)
  excecoesIds: string[];
  motivos: string[];                  // motivos das exceções aplicadas (não vazio se status≠normal)
};

export type DiaResolvido = {
  data: string;                       // "YYYY-MM-DD"
  diaSemana: number;                  // 0-6
  // true se o dia inteiro está bloqueado (por exceção de escopo=dia_inteiro
  // OU por SiteConfig.excecoes com fechado=true OU sem padrão semanal +
  // sem janelas extras).
  diaBloqueado: boolean;
  motivoDiaBloqueado?: string;
  slots: SlotResolvido[];             // vazio se diaBloqueado=true
};

export type ConfiguracaoReservas = {
  id: string;                         // = restaurantId
  restaurantId: string;
  janelas: JanelaDiaReserva[];        // 7 entries (1 por dia da semana)
  duracaoSlotMin: number;             // duração da reserva em minutos (default 90)
  // Quantos dias à frente o cliente público pode reservar.
  // Default 90 (~3 meses). O form mostra 6 chips de datas disponíveis
  // dentro dessa janela + botão "Ver outra data" pra escolher qualquer
  // data dentro do range.
  janelaAntecedenciaDias?: number;
  // Template da mensagem de WhatsApp que admin manda pra confirmar reserva
  // antes do dia. Variáveis suportadas (substituídas no momento de mandar):
  //   {primeiro_nome} {nome} {restaurante} {data} {hora} {pax} {salao}
  // Se vazio/undefined, usa DEFAULT_TEMPLATE_CONFIRMACAO.
  templateConfirmacao?: string;
  atualizadoEm: string;
  atualizadoPor: string;
};

// Default da janela de antecedência (em dias) quando o restaurante
// não customizou. Usado pelo form público pra limitar o seletor de datas.
export const DEFAULT_JANELA_ANTECEDENCIA_DIAS = 90;

// Template padrão usado quando o restaurante ainda não customizou o seu.
// Variáveis viram literais no texto até serem substituídas.
export const DEFAULT_TEMPLATE_CONFIRMACAO =
  `Oi {primeiro_nome}! Aqui é do {restaurante} 👋\n` +
  `Confirmando sua reserva pra {data} às {hora}, mesa pra {pax} pessoas.\n` +
  `Você confirma que vem? 🙂`;

// Variáveis disponíveis pro template — exposto pra a UI do editor mostrar
// como "tags clicáveis" que inserem no textarea.
export const TEMPLATE_CONFIRMACAO_VARIAVEIS = [
  { tag: "{primeiro_nome}", desc: "Primeiro nome do cliente" },
  { tag: "{nome}",          desc: "Nome completo" },
  { tag: "{restaurante}",   desc: "Nome do restaurante" },
  { tag: "{data}",          desc: "Data formatada (ex: 25/05)" },
  { tag: "{hora}",          desc: "Horário (ex: 19:30)" },
  { tag: "{pax}",           desc: "Quantidade de pessoas" },
  { tag: "{salao}",         desc: "Nome do salão" },
] as const;

export type ReservaStatus =
  | "pendente"        // marcada mas ainda não confirmada
  | "confirmada"      // confirmada (cliente avisou que vem)
  | "chegou"          // cliente está/esteve no restaurante
  | "no_show"         // não compareceu
  | "cancelada";      // cancelada pelo cliente ou casa

export const RESERVA_STATUS_LABEL: Record<ReservaStatus, string> = {
  pendente:    "Pendente",
  confirmada:  "Confirmada",
  chegou:      "Chegou",
  no_show:     "Não veio",
  cancelada:   "Cancelada",
};

export const RESERVA_STATUS_ICON: Record<ReservaStatus, string> = {
  pendente:    "⏳",
  confirmada:  "✓",
  chegou:      "🪑",
  no_show:     "😶",
  cancelada:   "✕",
};

// Doc PRINCIPAL — sem PII. Read pode ser público (form usa pra contar
// disponibilidade sem expor dados pessoais). PII fica em ReservaPII abaixo.
//
// Campos clienteNomeSnapshot/clienteTelefoneSnapshot/clienteEmailSnapshot/
// observacoes/ocasiao são MARCADOS COMO OPCIONAIS pra compat. com reservas
// antigas (pré-refactor de segurança) — mas a partir da Fase 2 da Segurança,
// só são preenchidos via merge runtime (admin lê /reservas + /reservasPII e
// faz merge no client).
export type Reserva = {
  id: string;
  restaurantId: string;
  data: string;                       // YYYY-MM-DD
  horario: string;                    // HH:MM
  pessoas: number;                    // qtd
  // Salão escolhido — obrigatório no form público; admin pode deixar vazio
  // até confirmar (compat. com fluxo antigo).
  salaoId?: string | null;
  salaoNomeSnapshot?: string;
  mesaId?: string | null;             // opcional — pode confirmar mesa só na chegada
  mesaNomeSnapshot?: string;
  // Cliente: só ID (PII fica em /reservasPII e /clientes — auth-only)
  clienteId?: string | null;
  // PII (LEGADO): aparece em reservas antigas. Nas novas, mergeado a partir
  // de /reservasPII. NUNCA é gravado em /reservas na criação nova.
  clienteNomeSnapshot?: string;
  clienteTelefoneSnapshot?: string;
  clienteEmailSnapshot?: string;
  observacoes?: string;
  ocasiao?: string;
  status: ReservaStatus;
  // Origem: "interno" = criada no admin; "publico" = veio do form /reservas/:rid
  origem?: "interno" | "publico";
  // Auditoria de status
  confirmadaEm?: string | null;
  chegouEm?: string | null;
  canceladaEm?: string | null;
  motivoCancelamento?: string;
  registradoEm: string;
  registradoPor: string;              // pessoaId (ou "publico" se veio do form)
  atualizadoEm: string;
};

// Solicitação de exclusão de dados (LGPD Art. 18).
// Cliente pede pelo form público /r/excluir-dados/:rid; admin processa
// no módulo Reservas → tab "Solicitações de Exclusão" (futuro) ou pelo
// Firestore console.
export type SolicitacaoExclusao = {
  id: string;
  restaurantId: string;
  telefone: string;                   // E.164 — pra localizar cliente
  email?: string;
  nome?: string;
  motivo?: string;                    // texto livre, opcional
  status: "pendente" | "processada" | "rejeitada";
  criadoEm: string;
  processadoEm?: string;
  processadoPor?: string;             // pessoaId
  notaInterna?: string;               // o que foi feito (quais docs deletados, etc)
};

// Lookup público de cliente recorrente. Usado APENAS pelo form público de
// reservas pra pré-preencher nome/email quando a pessoa digita um WhatsApp
// já conhecido — UX de cliente recorrente sem expor /clientes (que tem
// aniversário, restrições, tags, etc).
//
// Doc ID determinístico: <restaurantId>_<telefoneE164 sem "+">. Rules
// permitem `get` público (lookup por ID exato) mas bloqueiam `list` —
// ninguém consegue enumerar clientes nem queryar a coleção. Mesmo nível
// de risco que perguntar "fulano é cliente de vocês?" pelo WhatsApp da
// casa.
export type ClientePublicLookup = {
  restaurantId: string;
  telefoneE164: string;
  nome: string;
  email?: string;
  clienteId: string;                  // ref pro doc completo em /clientes
  atualizadoEm: string;
};

// Nota de cliente — log cronológico de anotações que admin/hostess faz
// sobre o cliente. Ex: "gosta da mesa 19", "alérgico a camarão",
// "indicado pelo João Silva", "pediu mesa do canto, gostou muito".
//
// Pode ser criada de 3 lugares:
//   1. Modal "Cliente chegou" — junto com escolha de mesa
//   2. Card do cliente (aba Clientes) — botão "+ Nota"
//   3. Histórico do cliente — retroativo
//
// Histórico do cliente mostra como log cronológico (mais recente primeiro)
// com autor + data. Persiste pra sempre — só exclusão LGPD apaga.
export type NotaCliente = {
  id: string;
  restaurantId: string;
  clienteId: string;
  reservaId?: string;                 // se associada a uma reserva específica
  texto: string;
  criadoEm: string;
  criadoPor: string;                  // pessoaId
  criadoPorNome: string;              // snapshot pra exibir se a pessoa for renomeada
};

// Dados PII da reserva — vive em coleção paralela `/reservasPII` com read
// só pra authed (admin). Form público escreve mas não lê. Anonimização
// LGPD: deletar este doc preserva a estatística em /reservas sem PII.
export type ReservaPII = {
  id: string;                         // mesmo ID da reserva
  restaurantId: string;               // pra rules
  clienteNomeSnapshot: string;
  clienteTelefoneSnapshot?: string;
  clienteEmailSnapshot?: string;
  observacoes?: string;
  ocasiao?: string;                   // ex: "Aniversário"
  // Mantém timestamp pra auditoria
  registradoEm: string;
};

// ─── CONTAGENS + COMPRAS (estoque) ─────────────────────────────────────────

export type Fornecedor = {
  id: string;
  restaurantId: string;
  nome: string;
  whatsapp?: string;                  // só dígitos pra link wa.me
  email?: string;
  observacoes?: string;
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
};

// Unidade comum de medida
export type UnidadeMedida =
  | "un" | "kg" | "g" | "L" | "ml"
  | "cx" | "pct" | "fardo" | "garrafa" | "lata"
  | "outro";

export const UNIDADES_LABEL: Record<UnidadeMedida, string> = {
  un: "Unidade", kg: "Quilo", g: "Grama", L: "Litro", ml: "Mililitro",
  cx: "Caixa", pct: "Pacote", fardo: "Fardo", garrafa: "Garrafa", lata: "Lata",
  outro: "Outro",
};

export const UNIDADES_LISTA: UnidadeMedida[] = [
  "un", "kg", "g", "L", "ml", "cx", "pct", "fardo", "garrafa", "lata", "outro",
];

export type Insumo = {
  id: string;
  restaurantId: string;
  nome: string;
  categoria?: string;                 // ex: "Bebidas", "Carnes" (texto livre)
  unidade: UnidadeMedida;
  unidadeOutroLabel?: string;         // se unidade === "outro"
  minStock?: number;                  // estoque mínimo (gera alerta + sugestão)
  // Fornecedor preferencial pra reposição
  fornecedorPreferredId?: string | null;
  // Quanto comprar de cada vez (múltiplo). Ex: vinho vem caixa de 6 → fator=6
  fatorCompra?: number;
  precoEstimado?: number;             // R$ por unidade do insumo (info)
  ativo: boolean;
  ordem?: number;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export type Contagem = {
  id: string;
  restaurantId: string;
  insumoId: string;
  insumoNomeSnapshot: string;         // pra preservar histórico
  unidadeSnapshot: UnidadeMedida;
  qty: number;
  data: string;                       // YYYY-MM-DD
  observacao?: string;
  registradoEm: string;
  registradoPor: string;
  registradoNome?: string;            // snapshot
};

// Pedido / ordem de compra
export type PedidoStatus =
  | "rascunho"
  | "aprovado"
  | "enviado"           // mensagem WhatsApp já foi/marcada como enviada
  | "recebido_ok"       // recebido conforme
  | "recebido_div"      // recebido com divergência
  | "cancelado";

export const PEDIDO_STATUS_LABEL: Record<PedidoStatus, string> = {
  rascunho:     "Rascunho",
  aprovado:     "Aprovado",
  enviado:      "Enviado",
  recebido_ok:  "Recebido OK",
  recebido_div: "Recebido c/ diff",
  cancelado:    "Cancelado",
};

export const PEDIDO_STATUS_ICON: Record<PedidoStatus, string> = {
  rascunho:     "📝",
  aprovado:     "✓",
  enviado:      "📤",
  recebido_ok:  "📦",
  recebido_div: "⚠️",
  cancelado:    "✕",
};

export type PedidoItem = {
  insumoId: string;
  insumoNomeSnapshot: string;
  unidadeSnapshot: UnidadeMedida;
  qtdPedida: number;
  qtdRecebida?: number | null;        // preenchido no recebimento
  precoUnit?: number;                 // R$ por unidade (snapshot)
  observacao?: string;
};

export type Pedido = {
  id: string;
  restaurantId: string;
  fornecedorId: string;
  fornecedorNomeSnapshot: string;
  fornecedorWhatsappSnapshot?: string;
  itens: PedidoItem[];
  totalEstimado?: number;             // soma dos precos
  status: PedidoStatus;
  // Auditoria
  criadoEm: string;
  criadoPor: string;
  aprovadoEm?: string | null;
  aprovadoPor?: string | null;
  enviadoEm?: string | null;
  enviadoPor?: string | null;
  recebidoEm?: string | null;
  recebidoPor?: string | null;
  observacaoGeral?: string;
  observacaoRecebimento?: string;
  atualizadoEm: string;
};

// ─── TEMPLATES DE PERMISSÃO (REMOVIDO — Rodada 5) ───
// PermissionTemplate era o sistema antigo de presets de ver/configurar.
// Substituído por AccessProfile em /accessProfiles. Tipo removido.

// ─── HISTÓRICO E AUDIT LOG ───

// Histórico de versões de campos críticos. Cada doc tem 1 entidade + campo.
export type Historico = {
  id: string;                    // `${entityType}_${entityId}_${campo}`
  entityType: "empregado" | "cargo" | "restaurant" | "pessoa";
  entityId: string;
  campo: string;                 // ex: "cargoId", "vtValorPassagem", "pontos", "taxRate"
  versoes: HistoricoVersao[];
  updatedAt: string;
};

export type HistoricoVersao = {
  valor: unknown;                // o valor desse campo nesse período
  inicio: string;                // YYYY-MM-DD inclusivo
  fim?: string | null;           // YYYY-MM-DD exclusivo (null = vigente)
  motivo?: string;
  registradoEm: string;          // ISO
  registradoPor: string;         // pessoaId
};

// Audit log — toda mudança crítica gera 1 entrada
export type AuditAcao =
  | "criado" | "alterado" | "inativado" | "reativado"
  | "demitido" | "readmitido" | "excluido" | "agendado";

export type AuditLog = {
  id: string;
  restaurantId?: string;
  entityType: "empregado" | "cargo" | "restaurant" | "pessoa" | "gorjeta" | "vtFolha" | "permissionTemplate";
  entityId: string;
  acao: AuditAcao;
  diff?: { [campo: string]: { antes: unknown; depois: unknown } };
  vigenteApartir?: string;       // se a mudança tem data de vigência
  motivo?: string;
  registradoEm: string;
  registradoPor: string;
};

// Mudança AGENDADA (data futura) — aplicada quando o dia chega
export type MudancaAgendada = {
  id: string;
  entityType: "empregado" | "cargo" | "restaurant" | "pessoa";
  entityId: string;
  campo: string;
  valorNovo: unknown;
  aplicarEm: string;             // YYYY-MM-DD
  motivo?: string;
  registradoEm: string;
  registradoPor: string;
  aplicadoEm?: string | null;    // ISO quando foi aplicado (após chegar a data)
};

// ─── FREELAS ────────────────────────────────────────────────────────────────
// Freela = pessoa contratada pontualmente pra um turno (não-CLT, paga avulsa).
// Pode ser cadastrada por dentro do módulo (cadastro rápido) ou ser empregado
// existente cobrindo um turno extra.
//
// CICLO DE VIDA do turno (FreelaShift):
//   1. "agendado"       → agendado pra data futura, ainda não rolou
//   2. "aberto"         → dia chegou, freela compareceu; lançamento aberto
//                         (horas/valor podem ser editados até confirmar)
//   3. "fechamento"     → confirmado pelo gestor; pronto pra entrar em lote
//   4. "pago"           → incluído em FreelaPagamento.status="pago"
//   5. "nao_compareceu" → freela não veio; turno fica registrado pra histórico
//                         mas não gera pagamento

export type FreelaShiftStatus =
  | "agendado"
  | "aberto"
  | "fechamento"
  | "pago"
  | "nao_compareceu"
  | "cancelado";       // lançado errado — fica zerado, entra no lote só pra registro

export const FREELA_SHIFT_STATUS_LABEL: Record<FreelaShiftStatus, string> = {
  agendado:       "Agendado",
  aberto:         "Aberto",
  fechamento:     "Em fechamento",
  pago:           "Pago",
  nao_compareceu: "Não compareceu",
  cancelado:      "Cancelado",
};

// Um intervalo (pausa/refeição) dentro de um turno de freela. Duração em
// minutos (sempre múltiplo do passo do stepper). `planejado` marca os que
// foram pré-programados no agendamento — é só dica visual; conta igual no
// desconto de horas.
export type FreelaIntervalo = {
  min: number;
  planejado?: boolean;
};

export type FreelaShift = {
  id: string;
  restaurantId: string;
  unidadeId?: string | null;       // multi-unidades
  // Identificação do freela. Pode referenciar empregado existente, pessoa
  // existente (do app), ou só nome (cadastro só-nome legado). Sempre carrega
  // snapshot do nome pra exibição estável.
  empregadoId?: string | null;     // empregado que cobriu turno extra
  pessoaId?: string | null;        // pessoa cadastrada (com CPF/PIX/WhatsApp)
  nomeSnapshot: string;
  cpfSnapshot?: string;
  pixSnapshot?: string;
  whatsappSnapshot?: string;

  date: string;                    // YYYY-MM-DD — data efetiva (lançamento)
  scheduledDate?: string;          // YYYY-MM-DD — data originalmente agendada (== date se não trocou)
  area?: Area;                     // área de atuação naquele turno

  // ─── PLANEJADO (definido no "Planejar turnos") ───────────────────────────
  // O que se PRETENDE. Nunca é tocado pelo Abrir/Fechar — é só plano. O fluxo
  // de execução (Abrir confirma entrada; Fechar confirma saída+intervalos)
  // pré-preenche a partir destes, mas grava nos campos REAIS abaixo.
  entradaPrevista?: string;        // "HH:MM" — chegada prevista
  saidaPrevista?: string;          // "HH:MM" — saída prevista
  intervalosPrevistos?: FreelaIntervalo[]; // intervalos previstos

  // ─── REALIZADO (definido SÓ por botão) ───────────────────────────────────
  // entrada = confirmada no "Abrir turno"; saida + intervalos = confirmados no
  // "Fechar turno".
  entrada?: string;                // "HH:MM" — chegada REAL (Abrir)
  saida?: string;                  // "HH:MM" — saída REAL (Fechar; pode virar o dia)
  // Intervalo: `intervalo` (legado) é sempre a SOMA, em minutos, de todos os
  // intervalos — alimenta calcHoras sem mudança. `intervalos` é o detalhamento
  // (vários intervalos por turno, lançáveis desde a abertura). Quando
  // `intervalos` existe, `intervalo === soma(intervalos.min)`.
  intervalo?: number;              // minutos (TOTAL — soma de `intervalos`)
  intervalos?: FreelaIntervalo[];  // detalhamento (pode ter mais de um)
  horas?: number;                  // total decimal de horas trabalhadas
  valorTipo?: "hora" | "diaria";   // como é cobrado
  valorUnit?: number;              // R$ por hora OU diária fixa
  totalCalc?: number;              // R$ total do turno (calculado)

  status: FreelaShiftStatus;
  lotePagamentoId?: string | null; // preenchido quando entra num FreelaPagamento

  observacao?: string;

  // Cancelamento (turno lançado errado): fica com totalCalc 0, pode entrar
  // num lote só pra registro. Mostra o motivo na lista.
  motivoCancelamento?: string;
  canceladoEm?: string | null;
  canceladoPor?: string | null;
  canceladoPorNome?: string | null;

  // Auditoria
  lancadoPor: string;              // pessoaId
  lancadoPorNome: string;
  lancadoEm: string;               // ISO
  confirmadoEm?: string; confirmadoPor?: string;
  encerradoEm?: string; encerradoPor?: string;
  noShowEm?: string; noShowPor?: string;
  pagoEm?: string;
  updatedAt: string;
};

export type FreelaPagamentoStatus = "pendente" | "pago";

export const FREELA_PAGAMENTO_STATUS_LABEL: Record<FreelaPagamentoStatus, string> = {
  pendente: "Pendente",
  pago:     "Pago",
};

// Snapshot de um turno dentro do lote — congela os dados pra o histórico e o
// recibo ficarem estáveis mesmo se o turno original for editado/apagado depois.
export type FreelaTurnoSnapshot = {
  date: string;                    // YYYY-MM-DD
  area?: Area | null;
  entrada?: string | null;         // "HH:MM"
  saida?: string | null;           // "HH:MM"
  horas?: number | null;           // decimal
  valorTipo?: "hora" | "diaria" | null;
  valorUnit?: number | null;       // R$/h ou diária
  totalCalc?: number | null;       // R$ do turno
  cancelado?: boolean;             // turno cancelado (entrou zerado só pra registro)
};

// Resumo por pessoa dentro do lote (pra render rápido na lista + PDF)
export type FreelaPagamentoResumoPessoa = {
  pessoaId?: string | null;
  empregadoId?: string | null;
  nome: string;
  pix?: string | null;
  cpf?: string | null;
  whatsapp?: string | null;
  qtdShifts: number;
  totalHoras: number;
  totalValor: number;
  turnos?: FreelaTurnoSnapshot[];  // detalhe congelado (lotes novos); ausente nos antigos
};

// Linha de um freela MENSALISTA no lote de pagamento. Diferente do diarista
// (por turno): tem remuneração do mês (proporcional aos dias na escala) + a
// gorjeta do período (bruta OU líquida, escolha por pessoa) + ajustes.
export type FreelaMensalistaLinha = {
  empregadoId: string;
  nome: string;
  pix?: string | null;
  cpf?: string | null;
  competencia: string;             // "YYYY-MM"
  diasTrabalhados: number;         // dias EFETIVOS = corridos − faltas injustificadas
  diasCobertos?: number;           // dias corridos do período dela no mês
  faltasInjust?: number;           // faltas injustificadas descontadas
  diasNoMes: number;               // dias do mês-competência (base do rateio)
  remuneracaoMes: number;          // valor cheio de um mês
  remuneracaoProporcional: number; // remuneracaoMes × dias/diasNoMes
  gorjetaModo: "bruto" | "liquido";
  gorjetaLiquido: number;          // soma do período
  gorjetaBruto: number;            // soma do período
  gorjetaAplicada: number;         // = bruto ou liquido conforme o modo
  desconto: number;
  descontoDesc?: string;
  acrescimo: number;
  acrescimoDesc?: string;
  total: number;                   // proporcional + gorjetaAplicada + acréscimo − desconto
};

export type FreelaPagamento = {
  id: string;
  restaurantId: string;
  numero: string;                  // ex: "LOTE-2026-05-001"
  observacao?: string;
  shiftIds: string[];              // FreelaShift.id contidos no lote
  pessoasResumo: FreelaPagamentoResumoPessoa[];
  mensalistas?: FreelaMensalistaLinha[]; // freelas mensalistas no mesmo lote
  totalGeral: number;
  qtdShifts: number;
  qtdPessoas: number;
  status: FreelaPagamentoStatus;
  criadoEm: string;
  criadoPor: string;
  criadoPorNome: string;
  pagoEm?: string;
  pagoPor?: string;
  pagoPorNome?: string;
  formaPagamento?: string;
};

// ─── EXCEÇÕES — STATUS DA SEMANA ────────────────────────────────────────────
// Workflow de tratamento das exceções de ponto. 1 doc por (restaurante, semana).
//
// Fluxo:
//   "aberto" → líder de área puxa, identifica exceções
//   "em_tratamento" → líder de área pediu ajustes na Sólides, aguarda processamento
//   "tratado_lider" → líder confirma que ajustes foram feitos; aguarda conferência
//   "conferido_gerente" → gerente fez 2ª conferência, semana encerrada
//
// Permissões:
//   - `ver` (líder): pode marcar em_tratamento e tratado_lider
//   - `configurar` (gerente): pode marcar conferido_gerente (e tudo abaixo)
//   - master: tudo

export type ExcecaoStatusValor =
  | "aberto"
  | "em_tratamento"
  | "tratado_lider"
  | "conferido_gerente";

export const EXCECAO_STATUS_LABEL: Record<ExcecaoStatusValor, string> = {
  aberto:            "Aberto",
  em_tratamento:     "Em tratamento",
  tratado_lider:     "Conferido pelo líder",
  conferido_gerente: "Conferido pelo gerente",
};

export type ExcecaoHistoricoEntry = {
  // Status que a semana entrou após essa ação. Pra entradas do tipo
  // "atualizacao" (regerar relatório), repete o status atual.
  status: ExcecaoStatusValor;
  em: string;            // ISO
  por: string;           // pessoaId
  porNome: string;
  observacao?: string;
  // Tipo do evento. Default (undefined) = mudança de status (comportamento
  // legado). "atualizacao" = relatório foi regerado/atualizado pela Sólides.
  tipo?: "atualizacao";
};

// Apontamento de inconformidade pra o empregado — gerado quando o líder marca
// o checkbox de uma inconformidade ou clica "Ciência" no relatório.
//
// Status:
//   - "pendente": marcado pra ser enviado, ainda não saiu o WhatsApp
//   - "enviado":  já foi enviado pro empregado via WhatsApp (com enviadoEm)
//   - "ciencia":  apontamento não-tratável (ex: intervalo a menos que já
//                 passou) — fica registrado mas NÃO vai pro empregado
//
// Sempre é vinculado a uma inconformidade detectada (origem="inconformidade").
// Anotações livres (notas nossas sobre o empregado) vivem em `notasInternas`,
// não aqui — elas NÃO vão pro WhatsApp.
export type ApontamentoStatus = "pendente" | "enviado" | "ciencia";

export type ApontamentoFuncionario = {
  id: string;
  empregadoId: string;
  empregadoNome: string;
  cpf?: string;
  texto: string;
  data?: string;         // YYYY-MM-DD do fato
  origem: "inconformidade" | "manual";  // "manual" legado; novos apontamentos sempre "inconformidade"
  ruleId?: string;       // id da regra original (quando origem === "inconformidade")
  status: ApontamentoStatus;
  enviadoEm?: string;    // ISO — preenchido quando vai status pra "enviado"
  cienciaEm?: string;    // ISO — preenchido quando vai status pra "ciencia"
  cienciaPor?: string;
  cienciaPorNome?: string;
  /** @deprecated usado por docs antigos — sempre derivar de `status` daqui pra frente */
  enviar?: boolean;
  criadoEm: string;
  criadoPor: string;
  criadoPorNome: string;
};

// Nota interna sobre o empregado — INVISÍVEL pro empregado. Funciona como
// timeline do tratamento daquela semana. Pode ser:
//   - manual:          digitada pelo líder via "+ nota interna"
//   - envio_whatsapp:  auto-gerada quando o líder dispara o WhatsApp pro
//                      empregado com a lista de apontamentos
//   - ciencia:         auto-gerada quando o líder marca uma inconformidade
//                      como "ciência" (não-tratável retroativo)
export type NotaInterna = {
  id: string;
  empregadoId: string;
  empregadoNome: string;
  texto: string;
  origem: "manual" | "envio_whatsapp" | "ciencia";
  // Quando origem === "envio_whatsapp", guarda os IDs dos apontamentos avisados.
  // Quando origem === "ciencia", guarda o ID do apontamento marcado como ciência.
  apontamentoIds?: string[];
  // Quando preenchido, vincula a nota a UM apontamento específico no formato
  // "YYYY-MM-DD_ruleId". UI mostra a nota dentro do card daquele apontamento
  // (não na lista geral do empregado). Notas sem essa chave são "do empregado".
  apontamentoChave?: string;
  criadoEm: string;
  criadoPor: string;
  criadoPorNome: string;
};

// Apontamentos de Escala — relatório DERIVADO do snapshot do relatório,
// gerado quando o gerente confere a semana. Lista o que precisa ajuste na
// ESCALA PRATICADA do Planejamento (não no ponto Sólides):
//   - falta sem ajuste → lançar falta na praticada
//   - marcação fora da escala → trabalho em dia previsto pra folga
//
// Cada item é ajustado manualmente pelo líder na escala praticada e marcado
// como "ajustado" (ou "ok" — vira só histórico).
export type ApontamentoEscalaStatus = "pendente" | "ajustado";

export type ApontamentoEscala = {
  id: string;
  empregadoId: string;
  empregadoNome: string;
  data: string;             // YYYY-MM-DD do fato
  ruleId: string;           // origem (faltaSemAjuste, marcacaoForaDaEscala, ...)
  texto: string;            // descrição pronta pra exibir
  status: ApontamentoEscalaStatus;
  ajustadoEm?: string;      // ISO
  ajustadoPor?: string;
  ajustadoPorNome?: string;
  criadoEm: string;
};

// Snapshot do último relatório gerado, persistido pra manter memória do
// tratamento entre sessões — quando o líder sai da tela e volta, restaura
// o relatório anterior em vez de exigir nova geração. O conteúdo é
// estruturalmente o GenerateReportResult de core/excecoes/generateReport,
// mas tipamos como unknown[] aqui pra não criar ciclo de import.
export type RelatorioSnapshot = {
  geradoEm: string;       // ISO
  exceptions: unknown[];  // ExceptionRecord[]
  unmatched: unknown[];   // UnmatchedEntry[]
  diasAnalisados: number;
  // Mapa de dias efetivamente analisados POR EMPREGADO (cpf só dígitos → lista
  // de YYYY-MM-DD). Permite a UI de Inconformidades renderizar "✓ Sem
  // inconformidade" pros dias que foram avaliados mas não geraram exceção.
  // Opcional pra retrocompatibilidade — caches antigos não têm esse campo.
  diasAnalisadosPorCpf?: Record<string, string[]>;
  // Snapshot da escala EFETIVA (depois de aplicar ajustes Sólides) por CPF →
  // data → status. Permite a UI listar todos os dias do mês por empregado com
  // estado visual correto (trabalho/folga/ajuste aprovado/etc), não só dias
  // com exception. Inclui só empregados que batem ponto. Opcional pra
  // retrocompat — caches antigos não têm esse campo e a UI cai no modo antigo.
  escalaEfetivaPorCpf?: Record<string, Record<string, ScheduleStatus>>;
  // Batidas formatadas por CPF (só dígitos) → data → string
  // (ex: "E1 09:26 → S1 11:20 · E2 12:19 → S2 16:41"). Inclui todos os dias
  // com punches, mesmo os "Trabalhou normal". Opcional pra retrocompat.
  batidasPorCpfData?: Record<string, Record<string, string>>;
  // CPFs (só dígitos) que ainda constam no quadro do Sólides nesta geração.
  // Usado pra detectar demitidos-no-Planejamento que seguem ativos no Sólides
  // (apontamento `ativoNoSolidesAposDemissao`). Opcional pra retrocompat —
  // caches antigos não têm e o alerta simplesmente não aparece até regenerar.
  cpfsAtivosNoSolides?: string[];
};

export type ExcecaoStatusSemana = {
  id: string;            // = `${restaurantId}_${weekStart}` (weekStart YYYY-MM-DD)
  restaurantId: string;
  weekStart: string;     // segunda-feira da semana
  weekEnd: string;       // domingo
  status: ExcecaoStatusValor;
  historico: ExcecaoHistoricoEntry[];
  apontamentos?: ApontamentoFuncionario[];
  notasInternas?: NotaInterna[];
  relatorioCache?: RelatorioSnapshot;
  apontamentosEscala?: ApontamentoEscala[];
  updatedAt: string;
};

// ════════════════════════════════════════════════════════════════════════════
//  Módulo Admissão — fluxo de admissão de novos empregados.
//  Schema configurável por restaurante (FormField[]). Cada admissão tira um
//  snapshot do schema na criação pra preservar consistência se o schema mudar.
//  Token público + email confirmation pra candidato preencher sem login.
// ════════════════════════════════════════════════════════════════════════════

export type FormFieldTipo =
  | "text" | "email" | "telefone" | "cpf" | "data" | "numero"
  | "select" | "multiselect" | "textarea" | "boolean"
  | "lista_dependentes" | "lista_transporte"
  | "naturalidade";       // composto: UF (select) + cidade (select dinâmico via IBGE)

export type FormField = {
  id: string;                  // ex: "nome_completo" — gerado da label, único no schema
  label: string;
  tipo: FormFieldTipo;
  obrigatorio: boolean;
  opcoes?: string[];           // pra select/multiselect
  placeholder?: string;
  ajuda?: string;
  grupo: string;               // "Dados pessoais", "Endereço", etc — agrupa visualmente
  ordem: number;
  ativo: boolean;              // soft-delete (não quebra admissões antigas)
};

// Cada status corresponde 1:1 a uma coluna do Kanban — flow linear:
//   a_admitir → enviado → preenchido → contabilidade → pronto → admitido
// Movimentação é 100% manual (drag-drop no Kanban OU botões ◀▶ no card).
// O candidato preencher o form NÃO move automaticamente — só marca a
// subtarefa correspondente. Admin escolhe quando avançar.
export type AdmissaoStatus =
  | "a_admitir"                   // col 1 — card recém-criado, dados básicos pendentes ou em preenchimento
  | "formulario_enviado"          // col 2 — link gerado/enviado + dados finais sendo preenchidos
  | "formulario_preenchido"       // col 3 — exames + conta + docs + dados internos
  | "solicitacao_contabilidade"   // col 4 — contabilidade + assinaturas + cadastros externos
  | "pronto_admissao"             // col 5 — exames recebidos + última milha
  | "admitido"                    // col 6 — finalizado + onboarding D1 + cadastros pós
  | "cancelada"                   // qualquer motivo de cancelamento
  | "expirada";                   // token expirou sem preenchimento

export const ADMISSAO_STATUS_LABEL: Record<AdmissaoStatus, string> = {
  a_admitir:                 "Pessoas a admitir",
  formulario_enviado:        "Aguardando preenchimento e Solicitação de Exames e Conta",
  formulario_preenchido:     "Exames, conta e dados internos",
  solicitacao_contabilidade: "Contabilidade & contratos",
  pronto_admissao:           "Última milha",
  admitido:                  "Admitido e Onboarding",
  cancelada:                 "Cancelada",
  expirada:                  "Expirada",
};

// Motivos de cancelamento/expiração — podem ser cumulativos. Ex: empresa
// cancelou após o candidato desistir.
export type MotivoCancelamento =
  | "cancelado_empresa"          // empresa decidiu cancelar
  | "expirado_sem_envio"         // empresa não enviou link a tempo
  | "expirado_sem_resposta"      // candidato não preencheu no prazo
  | "desistencia_candidato";     // candidato avisou que desistiu

export const MOTIVO_CANCELAMENTO_LABEL: Record<MotivoCancelamento, string> = {
  cancelado_empresa:     "Cancelado pela empresa",
  expirado_sem_envio:    "Expirado antes do envio",
  expirado_sem_resposta: "Expirado sem resposta",
  desistencia_candidato: "Desistência do candidato",
};

export type AdmissaoReenvio = {
  em: string;            // ISO
  por: string;           // pessoaId
  porNome: string;
};

// ─── Documentos do candidato ────────────────────────────────────────────────
// Definição de UM documento que o candidato deve fornecer no form público.
// Configurável por restaurante (Admissão → Configurações → Documentos). O
// default vem de DOCUMENTOS_ADMISSAO_DEFAULT (admissaoHelpers).
export type DocumentoAdmissaoDef = {
  id: string;
  nome: string;                 // ex: "RG ou CNH"
  descricao?: string;           // dica pro candidato (ex: "frente e verso, legível")
  obrigatorio: boolean;         // se true, candidato precisa anexar OU justificar
  permiteNaoSeAplica: boolean;  // mostra a opção "não se aplica / não tenho"
  ativo: boolean;
};

// Um arquivo anexado pelo candidato (vive no Firebase Storage).
export type DocumentoAdmissaoArquivo = {
  nome: string;       // nome original do arquivo
  url: string;        // downloadURL do Storage (DP visualiza/baixa)
  path: string;       // caminho no Storage (pra baixar bytes / deletar)
  tipo: string;       // contentType (application/pdf, image/jpeg…)
  tamanho: number;    // bytes
  enviadoPeloDp?: boolean;  // true se o DP anexou manualmente (não veio do candidato)
  driveFileId?: string;     // id no Drive depois de subido (evita re-subir/duplicar)
  driveSubidoEm?: string;   // ISO — quando subiu pro Drive (base do prazo de expurgo)
  storageExpurgado?: boolean; // true depois que o original foi apagado do Storage
};

// Resolução do candidato para UM documento, submetida com o form. Depois o DP
// confere (conferido/observacaoDp) antes de subir pro Drive.
export type DocumentoAdmissaoEnvio = {
  docId: string;
  nome: string;       // snapshot do nome da def (caso a config mude depois)
  resolucao: "anexado" | "nao_se_aplica" | "nao_tenho";
  arquivos: DocumentoAdmissaoArquivo[];
  justificativa?: string;   // obrigatória quando resolucao != "anexado"
  // ─── Conferência do DP ───
  conferido?: boolean;
  conferidoEm?: string;
  conferidoPor?: { id: string; nome: string };
  observacaoDp?: string;
};

export type Admissao = {
  id: string;
  restaurantId: string;
  status: AdmissaoStatus;

  // ─── Etapa 1: RH inicia ───
  iniciadoPor: { id: string; nome: string };
  iniciadoEm: string;          // ISO
  candidato: {
    nome: string;
    cpf: string;               // só dígitos
    email: string;             // OBRIGATÓRIO — vira auth do form público
    whatsapp: string;          // só dígitos
  };
  cargoId: string;
  // Pessoa pré-existente vinculada (quando o CPF do candidato já estava em
  // /pessoas — ex: era freela e agora vira empregado registrado). Na hora
  // de criar o Empregado na admissão, reusa essa Pessoa em vez de
  // duplicar.
  pessoaIdVinculada?: string;

  // Opcionais na etapa 1
  horariosCadastrados?: Record<string, { in: string; out: string } | { folga: true }>;
  salario?: number;
  dataAdmissao?: string;       // YYYY-MM-DD
  cargoConfianca?: boolean;

  // ─── Token público ───
  token: string;               // UUID
  enviadoEm?: string;          // ISO — quando RH clicou "enviar WhatsApp" (timer inicia)
  expiraEm?: string;           // ISO — enviadoEm + prazoDias × 86400000 (+ extensões)
  reenvios?: AdmissaoReenvio[];
  // Extensões manuais do prazo pelo RH (sem regenerar token). Cada entrada
  // soma `horas` em expiraEm. Pra histórico/auditoria.
  extensoesPrazo?: { em: string; por: string; porNome: string; horas: number }[];

  // Snapshot do schema na hora da criação (congela)
  schemaUsado: FormField[];

  // Snapshot de dados do restaurante necessários na página pública. Evita
  // exigir leitura aberta de /restaurants. Atualizado a cada reenvio.
  restaurantSnapshot?: {
    nome: string;
    whatsappDP?: string;
    prazoDias: number;
    // Lista de documentos pedidos no form, congelada no momento da criação.
    // Ausente em admissões antigas → form usa DOCUMENTOS_ADMISSAO_DEFAULT.
    documentosAdmissao?: DocumentoAdmissaoDef[];
  };

  // ─── Etapa 2: candidato preenche ───
  dadosPreenchidos?: Record<string, unknown>;
  preenchidoEm?: string;       // ISO

  // Quando o RH preenche o formulário pelo candidato (canal alternativo:
  // papel, e-mail, WhatsApp). Mantém auditoria de que não foi o próprio
  // candidato pela página pública.
  preenchimentoManual?: { por: { id: string; nome: string } | null; em: string };

  // Quando o RH faz uma correção/revisão dos dados preenchidos pelo
  // candidato (ex: corrigir erro de digitação). Diferente de
  // preenchimentoManual — o candidato já tinha preenchido, RH só ajusta.
  dadosRevisadosEm?: string;
  dadosRevisadosPor?: { id: string; nome: string };

  // Declaração de veracidade + selfie + ciências obrigatórias do candidato.
  // Submetidas junto com o form. Tudo aceito = libera submit do form.
  validacao?: {
    selfieDataUrl?: string;    // base64 (JPEG comprimido, max ~250KB)
    declaracaoEm: string;      // ISO — quando o candidato marcou o checkbox
    declaracaoTexto: string;   // snapshot do texto da declaração (pra histórico jurídico)
    // Ciência sobre conta Itaú e envio de docs por WhatsApp — boxes mostrados
    // no fim do form. Bloqueiam submit se não marcados.
    ciencias?: {
      contaItau?: { aceita: boolean; em: string };
      documentosWhatsapp?: { aceita: boolean; em: string };
    };
  };

  // ─── Etapa 3: RH confirma recebimento dos docs via WhatsApp ───
  documentosRecebidosEm?: string;
  documentosRecebidosPor?: { id: string; nome: string };
  // Checklist por documento (recebido/pendente). RH marca no modal de
  // confirmação. Permite avançar com pendências — fica salvo pra depois.
  checklistDocumentos?: {
    itens: { id: string; nome: string; recebido: boolean; observacao?: string }[];
    atualizadoEm: string;
    atualizadoPor: { id: string; nome: string };
  };

  // ─── Etapa 4: aprovação ───
  aprovadoPor?: { id: string; nome: string };
  aprovadoEm?: string;
  pessoaIdCriada?: string;
  empregadoIdCriado?: string;

  // ─── Cancelamento / Expiração ───
  canceladoPor?: { id: string; nome: string };
  canceladoEm?: string;
  motivoCancelamento?: string;             // texto livre (legado)
  motivosCancelamento?: MotivoCancelamento[]; // tags cumulativas (cancelado_empresa, desistencia, etc)

  // ─── Finalização (arquivo) ───
  // Marca admissão como "arquivada" após onboarding completo. Sai do
  // Kanban ativo (aparece só em "Finalizados"), mas pode ser reativada.
  // Status continua "admitido" — só o flag finalizadoEm muda a visibilidade.
  finalizadoEm?: string;
  finalizadoPor?: { id: string; nome: string };
  // Snapshot do status que a admissão tinha ANTES de virar cancelada/expirada.
  // Usado pelo botão "↶ Reabrir" (master) pra restaurar a admissão pro ponto
  // exato onde ela estava no fluxo. Se ausente (admissões antigas), reabertura
  // cai no fallback "pronto_admissao".
  statusAntesCancelamento?: AdmissaoStatus;

  // ─── Kanban: override manual da coluna (default: derivado do status) ───
  // Reativado em 2026-05: Kanban tem drag-drop + botões ◀▶. kanbanColunaId
  // só é usado quando o usuário move pra uma coluna terminal (ou diferente
  // do status auto) — caso raro. Movimentação normal atualiza o `status`.
  kanbanColunaId?: string;

  // Etapas onde o usuário avançou MESMO com checklist obrigatório incompleto.
  // Cada entrada é o ID de uma coluna do Kanban (ex: "col_preenchido"). Usado
  // pra mostrar sinalizador "⚠️ etapa anterior em atraso" no card.
  // Limpa quando o usuário completa as obrigatórias daquela coluna.
  etapasComPendencias?: Record<string, boolean>;

  // ─── Dados bancários Itaú (preenchidos na col 3) ───
  // RH preenche depois que candidato envia agência + conta. Subtarefa de
  // cadastrar no banco usa estes dados pra montar a mensagem do financeiro.
  dadosBancariosItau?: {
    tipo: "salario" | "corrente";
    agencia: string;
    conta: string;
  };

  // ─── Checklist do fluxo de admissão ───
  // Subtarefas instanciadas do template do restaurante (ou do default global)
  // no momento do iniciarAdmissao. Cada subtarefa pertence a uma coluna do
  // Kanban; avanço de coluna bloqueia se obrigatórias da atual estão pendentes.
  subtarefas?: SubtarefaAdmissao[];

  // ─── Termos a assinar (sub-checklist de st_termos_assinatura) ───
  // Cada item representa um termo (Contrato CLT, Confidencialidade, etc.).
  // Botão "Abrir checklist de termos" na subtarefa st_termos_assinatura
  // abre modal que edita esse array. Default vem de getTermosAssinatura;
  // restaurante pode customizar termos.assinaturaDefault (não implementado
  // — V1 usa default hardcoded).
  termosAssinados?: TermoAssinado[];

  // ─── Pasta no Google Drive (kit de documentos para assinatura) ───
  // Criada pelo ChecklistTermosModal via integração browser (escopo
  // drive.file). Guardamos só id + URL; os PDFs assinados vivem no Drive
  // da conta conectada (DP cola a URL no Clicksign).
  driveFolderId?: string;       // pasta [Nome] do empregado (pra abrir/copiar link)
  driveFolderUrl?: string;
  // Proveniência da pasta: criada (nova) ou vinculada (existente, via Picker),
  // por quem e quando — pra UI deixar claro o que rolou.
  driveFolderModo?: "criada" | "vinculada";
  driveFolderEm?: string;
  driveFolderPor?: { id: string; nome: string };
  driveDocumentosFolderId?: string;    // subpasta "Documentos do Empregado" (docs do candidato)
  driveDocsAAssinarFolderId?: string;  // subpasta "docs a assinar" (termos gerados → Clicksign)
  driveDocsAssinadosFolderId?: string; // subpasta "Kit de Admissão Assinado" (PDFs que voltam assinados)

  // ─── Documentos enviados pelo candidato (último bloco do form público) ───
  // Cada item = 1 documento da lista configurada (restaurant.documentosAdmissao,
  // ou DOCUMENTOS_ADMISSAO_DEFAULT). O candidato resolve cada um: anexa
  // arquivo(s) OU declara "não se aplica"/"não tenho" com justificativa
  // obrigatória. O DP confere 1 a 1 e, quando todos conferidos, sobe os
  // arquivos pra subpasta "Documentos do Empregado" no Drive.
  documentos?: {
    itens: DocumentoAdmissaoEnvio[];
    enviadoEm?: string;                  // ISO — candidato submeteu o form
    subidoDriveEm?: string;              // ISO — última sincronização com o Drive
    subidoDrivePor?: { id: string; nome: string };
    selfieDriveFileId?: string;          // id da foto cadastral no Drive (evita duplicar)
  };

  // ─── Clicksign (envelope de assinatura) ───
  // Envelope criado via API v3. status: draft|running|closed|canceled.
  // O fluxo é por polling (cliente consulta o status); quando "closed", baixa
  // os PDFs assinados e sobe pra "docs assinados".
  clicksignEnvelopeId?: string;        // último envelope criado (atalho rápido)
  clicksignStatus?: string;            // status do último envelope
  clicksignEnviadoEm?: string;         // ISO do último envio
  clicksignSandbox?: boolean;          // sandbox (teste)
  // Histórico de TODOS os envios pro Clicksign — preserva log mesmo após
  // múltiplos envelopes. Usado pelo modal de seleção pra marcar arquivos
  // que já foram enviados em qualquer envelope (não só o último). Cada
  // envio corresponde a 1 envelope com 1+ documentos.
  clicksignHistorico?: ClicksignEnvioRef[];

  createdAt: string;
  updatedAt: string;
};

// Registro de UM envio pro Clicksign. Vive em admissao.clicksignHistorico
// como array — cada item representa um envelope que foi disparado.
export type ClicksignEnvioRef = {
  envelopeId: string;
  enviadoEm: string;             // ISO
  enviadoPor?: { id: string; nome: string };
  sandbox?: boolean;
  statusInicial?: string;        // snapshot do status no momento do envio
  // Arquivos que foram nesse envelope. fileId vem do Drive (quando
  // possível); filename é o nome usado no Clicksign (sempre presente).
  arquivos: { fileId?: string; filename: string }[];
};

export type TermoAssinado = {
  id: string;
  nome: string;
  obrigatorio: boolean;
  assinado: boolean;
  link?: string;                    // URL do PDF assinado (Drive/Clicksign)
  // ID do arquivo no Drive QUANDO o PDF foi subido pela pasta "docs a
  // assinar" via app (uploadFileToFolder). Pra esses, o envio pro Clicksign
  // pega automático. Pra termos com apenas `link` colado manualmente (Drive
  // de outra pasta, OneDrive, etc), `linkFileId` fica vazio — esses NÃO
  // vão pro Clicksign no envio automático.
  linkFileId?: string;
  assinadoEm?: string;              // ISO
  assinadoPor?: { id: string; nome: string };
  // Tipos especiais que disparam fluxo próprio no ChecklistTermosModal:
  //   "uniforme"    → botão "📦 Gerar termo de uniformes" que abre
  //     NovaEntregaModal em modo admissão (cria entrega + gera PDF +
  //     baixa estoque). Termo entra no kit do Clicksign.
  //   "epi"         → idem, mas pra EPIs (termo separado por exigência legal).
  //   "prorrogacao" → Termo de Prorrogação da experiência (45→90). DP
  //     recebe junto com o contrato e sobe o PDF na admissão pra deixar
  //     guardado, mas o termo NÃO PODE ser enviado pro Clicksign no envio
  //     inicial (senão a prorrogação ficaria automática). Só é enviado
  //     pelo botão "Prorrogar contrato" na tarefa de Decisão de Experiência
  //     (1ª etapa) — quando a renovação for de fato decidida.
  // Ausente = termo comum (só checkbox + link).
  tipoEspecial?: "uniforme" | "epi" | "prorrogacao";
  // ID da EntregaUniforme gerada (quando tipoEspecial existe + assinado=true).
  entregaIdGerada?: string;
  // Marcado pelo DP = este termo "não se aplica" a esta admissão → deixa de
  // ser obrigatório (não conta como pendente, não vai pro Clicksign).
  naoSeAplica?: boolean;
};

// Eventos que o sistema detecta automaticamente — usados pra auto-checar
// subtarefas sem o RH precisar marcar uma a uma.
export type AutoTriggerSubtarefa =
  | "iniciar_admissao"               // RH criou a admissão
  | "link_enviado"                   // RH clicou "Enviar via WhatsApp"
  | "form_preenchido"                // candidato submeteu o form
  | "dados_finais_completos"         // RH preencheu cargo/salário/horário/data
  | "checklist_docs_completo"        // RH marcou 12/12 docs no modal de WhatsApp
  | "dados_bancarios_itau_recebidos" // candidato informou dados Itaú no form
  | "envio_contabilidade"            // RH clicou "Enviar pra contabilidade"
  | "admitido";                      // RH clicou "Concluir admissão"

// Definição de uma subtarefa no template (sem state de execução).
export type SubtarefaTemplate = {
  id: string;
  nome: string;
  colunaId: string;                  // FK em KanbanColuna.id
  // Sub-agrupamento dentro da coluna — várias subtarefas com o mesmo
  // checklistId aparecem juntas no drawer sob o título checklistNome.
  checklistId: string;
  checklistNome: string;
  obrigatoria: boolean;              // bloqueia avanço de coluna se true e pendente
  ordem: number;
  autoTrigger?: AutoTriggerSubtarefa; // se setado, sistema auto-marca quando o evento ocorre
  // Atalhos disponíveis na UI do drawer. Os atalhos "contato_*" usam o
  // canalPreferido do contato configurado em Restaurant.contatosAdmissao
  // (email → Gmail compose; whatsapp → api.whatsapp.com; telefone → modal
  // com número + script). Templates de mensagem vêm de Restaurant.templatesAdmissao.
  atalho?:
    | { tipo: "contato_clinica" }                // contato com clínica de exames
    | { tipo: "contato_contabilidade" }          // contato com contabilidade
    | { tipo: "contato_financeiro" }             // contato com financeiro (cadastro banco)
    | { tipo: "whatsapp_instrucoes_candidato" }  // mensagem única pro candidato (3 blocos)
    | { tipo: "checklist_docs_whatsapp" }        // abre o modal de confirmar 12 docs
    | { tipo: "editar_dados_basicos" }           // abre modal pra editar nome/cpf/email/whatsapp do candidato
    | { tipo: "editar_dados_finais" }            // abre modal pra editar cargo/salário/horário/data
    | { tipo: "enviar_link_form" }               // gera link + abre WhatsApp pré-preenchido
    | { tipo: "checklist_termos_assinar" }       // abre modal com checklist de termos a assinar
    | { tipo: "abrir_clicksign" }                // abre app.clicksign.com em nova aba
    | { tipo: "whatsapp_kit_assinatura" }        // WhatsApp pro candidato avisando que mandamos kit por email
    | { tipo: "gerar_termo_uniformes" }          // abre modal de entrega de uniformes + gera PDF
    | { tipo: "gerar_termo_epis" }               // abre modal de entrega de EPIs + gera PDF
    | { tipo: "criar_pasta_drive" }              // cria a pasta do empregado no Google Drive
    // Atalhos legados — mantidos por retrocompat. Resolvidos pra contato_*
    // no drawer.
    | { tipo: "gmail_clinica" }
    | { tipo: "whatsapp_banco_financeiro" };
  pedeLink?: boolean;                // se true, mostra input de URL (Drive/Dropbox)
  pedeDataHora?: boolean;            // se true, mostra input datetime-local
  pedeDadosBancarios?: boolean;      // se true, mostra 3 campos (tipo + agência + conta) — atualizam adm.dadosBancariosItau
  pedeAnexoExame?: boolean;          // se true, mostra anexar arquivo → sobe pra subpasta "Exames Médicos" do Drive e salva o link
};

// Instância de subtarefa numa admissão concreta (state + dados).
export type SubtarefaAdmissao = SubtarefaTemplate & {
  feita: boolean;
  feitaEm?: string;                  // ISO
  feitaPor?: { id: string; nome: string };
  observacao?: string;
  link?: string;                     // URL externa (se pedeLink)
  dataAgendada?: string;             // "YYYY-MM-DDTHH:MM" local — se pedeDataHora
  // Registro de execuções da ação (atalho) — "o que foi feito, quando, por quem".
  // Cada clique no botão de ação registra aqui (audit + base do "↻ refazer").
  execucoes?: { tipo: string; em: string; por: { id: string; nome: string } }[];
};

export type KanbanColuna = {
  id: string;
  nome: string;
  ordem: number;
  // Status que automaticamente caem nessa coluna. Pode ser:
  //   - undefined         → só drop manual (sem regra)
  //   - "<status>"        → 1 status só (legado)
  //   - ["<status>", ...] → vários status (ex: Cancelada+Expirada juntas)
  // Manual drag sempre sobrescreve.
  statusAuto?: AdmissaoStatus | AdmissaoStatus[];
  cor?: string;                // hex sem # — pra header da coluna
};

// ─── EVENTOS ───────────────────────────────────────────────────────────────
// Módulo de gestão de eventos privados (Laje do Lobozó: aniversários,
// corporativos, jantares privê pra até 45 pax). Três entidades-base:
//   - EspacoEvento  → cadastro do espaço físico (capacidade, recursos, política)
//   - PacoteEvento  → template de evento (cardápio + duração + preço/pax)
//   - LeadEvento    → instância no funil (Kanban: novo → realizado)
// Mais 3 artefatos derivados de um lead:
//   - PropostaEvento (versionada)
//   - BEOEvento (banquet event order, gerado na confirmação)
//   - LogMensagemEvento (auditoria do que foi enviado pro cliente)

export type SlotEvento = "almoco" | "jantar" | "dia_inteiro";

export type FaixaCancelamento = {
  diasAntesMin: number;              // ex: 30 = "≥30 dias antes"
  percentDevolucao: number;          // 0..100
};

export type EspacoEvento = {
  id: string;
  restaurantId: string;
  nome: string;                      // "Laje do Lobozó"
  descricao?: string;
  capacidadeMin: number;             // 10
  capacidadeMax: number;             // 45
  permiteDoisEventosNoDia: boolean;  // false default; true valida 1 almoço + 1 jantar
  recursosInclusos: string[];        // ["caixa de som", "wifi"]
  recursosOpcionais: { nome: string; valor: number }[];
  politicaCancelamento: {
    faixas: FaixaCancelamento[];     // ordenadas desc por diasAntesMin
    noShowPercent: number;           // default 0
  };
  observacoes?: string;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
};

// Extra opcional dentro de um pacote — vendedor marca na hora de gerar
// a proposta. Cada marcado vira uma linha de AjusteProposta.
// Ex: "Hora extra" R$ 800 total, "Bolo personalizado" R$ 35/p, "DJ" R$ 1500.
export type AdicionalPacote = {
  id: string;
  nome: string;
  descricao?: string;
  precoModo: "por_pessoa" | "total_fixo";
  preco: number;
  ordem: number;
};

// PDF de cardápio anexado a um pacote (ex: "Comidas e bebidas", "Drinks especiais").
// Substituiu o modelo de itens estruturados — pra evento, cliente quer ver o cardápio
// montado/diagramado, não uma lista item-por-item.
export type CardapioPdf = {
  id: string;                        // único dentro do pacote
  nome: string;                      // "Comidas e bebidas", "Cardápio principal"
  url: string;                       // downloadURL do Firebase Storage
  uploadedAt: string;                // ISO timestamp
  uploadedBy?: string;               // pessoaId
  ordem: number;
};

// Modelo de cobrança do pacote.
//   "por_pessoa" → multiplica pelo número de convidados (ex: R$ 200/p × 30)
//   "total_fixo" → valor fechado independente do número (locação cheia,
//                  comprou-tudo-incluso fixo)
//   "personalizado" → não tem preço de tabela; vendedor monta proposta
export type PacotePrecoModo = "por_pessoa" | "total_fixo" | "personalizado";

export type PacoteEvento = {
  id: string;
  restaurantId: string;
  espacoId: string;
  nome: string;                      // "Pacote A"
  descricao: string;
  // "fixo" = template fechado pra cliente escolher direto
  // "personalizavel" = base vazia que o vendedor monta do zero
  tipo: "fixo" | "personalizavel";
  duracaoHoras: number;              // 4
  // Modelo de cobrança — default "por_pessoa" pra retrocompat.
  // Pacotes legacy só têm precoPorPessoa; novos podem ter total_fixo.
  precoModo?: PacotePrecoModo;
  precoPorPessoa: number;            // R$ (0 se modo "total_fixo")
  precoTotal?: number;               // R$ — só quando precoModo="total_fixo"
  capacidadeMin: number;
  capacidadeMax: number;
  // Até 3 PDFs de cardápio. Cliente recebe os links no WhatsApp e baixa cada
  // um — não geramos mais texto inline item-por-item.
  cardapios: CardapioPdf[];
  // Extras opcionais ofertados a partir desse pacote. Vendedor escolhe na
  // hora da proposta. Cada marcado vira linha em PropostaEvento.ajustes.
  adicionais?: AdicionalPacote[];
  inclusos: string[];                // ["som ambiente", "decoração básica"]
  naoInclusos: string[];             // ["bolo", "DJ"]
  observacoes?: string;
  ativo: boolean;
  // Pacote interno: aparece só pra equipe montar proposta (ex: cortesia,
  // locação com desconto). NÃO aparece na vitrine pública pro cliente pedir.
  interno?: boolean;
  ordem: number;                     // ordenação na vitrine pública
  createdAt: string;
  updatedAt: string;
};

// Helper: retorna valor total do pacote pra um dado nº de convidados.
// Cobre os 3 modos. Default seguro: 0 (vendedor preenche manual).
export function pacoteValorTotal(p: Pick<PacoteEvento, "precoModo" | "precoPorPessoa" | "precoTotal">, numConvidados: number): number {
  const modo = p.precoModo || "por_pessoa";
  if (modo === "total_fixo") return p.precoTotal || 0;
  if (modo === "personalizado") return 0;
  return (p.precoPorPessoa || 0) * numConvidados;
}

// Helper: label curto pra mostrar no card/vitrine ("R$ 200/p", "R$ 3.500 fixo").
export function pacotePrecoLabel(p: Pick<PacoteEvento, "precoModo" | "precoPorPessoa" | "precoTotal">): string {
  const modo = p.precoModo || "por_pessoa";
  if (modo === "total_fixo") {
    const v = (p.precoTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return `R$ ${v} (locação)`;
  }
  if (modo === "personalizado") return "Sob consulta";
  const v = (p.precoPorPessoa || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `R$ ${v}/p`;
}

// ─── ROTINAS ─────────────────────────────────────────────────────────────
// Lembretes recorrentes de tarefas do sistema (ex: "fechar o ponto da semana"
// na Análise de Ponto). Atribuídas a uma ou mais pessoas; surgem na Central de
// Avisos no dia devido. Não geram doc por ocorrência — o "vence hoje" é
// calculado do padrão de recorrência; conclusões ficam em rotinaConclusoes.
export type RotinaRecorrencia =
  | { tipo: "semanal"; diasSemana: number[] }              // 0=dom … 6=sáb
  | { tipo: "mensal_dia"; diaDoMes: number }               // 1..31 (31 = último dia)
  | { tipo: "mensal_posicao"; posicao: 1 | 2 | 3 | 4 | -1; diaSemana: number } // -1 = última
  | { tipo: "quinzenal"; dataBase: string };               // "YYYY-MM-DD" — a cada 14 dias

export type Rotina = {
  id: string;
  restaurantId: string;
  titulo: string;
  descricao?: string;
  moduloAlvo?: ModuleId;            // função do sistema (gera o deep-link)
  subAlvo?: string;                // sub-destino/aba dentro do módulo (ver subDestinos.ts)
  responsaveis: string[];          // pessoaIds
  responsaveisNomes?: Record<string, string>; // snapshot pra exibir
  recorrencia: RotinaRecorrencia;
  // Aviso por WhatsApp: no dia em que a rotina vence, o cron manda o template
  // lembrete_rotina pros responsáveis que ainda não concluíram.
  notificarWhatsapp?: boolean;
  whatsappHora?: string;           // "HH:MM" (horário de Brasília) — quando disparar
  respeitarFolga?: boolean;        // não avisar quem está de folga/férias na escala do dia
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
  criadoPorNome?: string;
  atualizadoEm?: string;
};

// Configuração de canais/destinatários de uma notificação (aviso de sistema ou
// rotina) por restaurante. id = `${restaurantId}_${tipo}`. Camada que rege a
// Central de Avisos + email + WhatsApp — controlada no módulo "Rotinas e Avisos".
export type NotificacaoDestinatarioModo = "permissao" | "pessoas" | "funcoes";
export type NotificacaoConfig = {
  id: string;
  restaurantId: string;
  tipo: string;                    // "checklists" | "fechamentoCaixa" | … (ver avisosCatalogo)
  inApp?: boolean;                 // aparece na Central (default true)
  email?: boolean;                 // dispara email
  whatsapp?: boolean;              // dispara WhatsApp
  horario?: string;                // "HH:MM" (Brasília) — canais disparados
  diasSemana?: number[];           // [] = todos
  respeitarFolga?: boolean;        // pula quem está de folga na escala
  destinatarios?: { modo: NotificacaoDestinatarioModo; pessoaIds?: string[]; funcoes?: string[] };
  atualizadoEm?: string;
  atualizadoPor?: string;
};

// Registro de que uma pessoa concluiu a ocorrência de uma rotina numa data.
// id determinístico = `${rotinaId}_${ocorrenciaData}_${pessoaId}` (idempotente).
export type RotinaConclusao = {
  id: string;
  restaurantId: string;
  rotinaId: string;
  ocorrenciaData: string;          // "YYYY-MM-DD" — a data devida que foi cumprida
  pessoaId: string;
  pessoaNome?: string;
  concluidoEm: string;             // ISO
};

export type LeadEventoStatus =
  | "novo"
  | "qualificado"
  | "proposta_enviada"
  | "sinal_recebido"
  | "confirmado"
  | "realizado"
  | "perdido";

export type OcasiaoEvento =
  | "aniversario"
  | "corporativo"
  | "encontro_amigos"
  | "outros";

export type ModeloEvento =
  | "locacao_consumo_livre"    // locação do espaço + comanda individual / consumo livre
  | "pacote_por_pessoa";       // pacote fechado de comidas/bebidas por pessoa

export type EscopoPacote =
  | "somente_comidas"
  | "comidas_bebidas_nao_alcoolicas"
  | "comidas_bebidas_alcoolicas"
  | "outro";

export type LeadEvento = {
  id: string;
  restaurantId: string;
  status: LeadEventoStatus;
  // Cliente
  pessoaId?: string;                 // vínculo com a base Pessoa unificada (CRM)
  cliente: {
    nome: string;
    whatsapp: string;
    email: string;                   // obrigatório agora
    tipoPessoa: "PF" | "PJ";
    cnpj?: string;                   // obrigatório se PJ
    razaoSocial?: string;            // buscada via CNPJ ou digitada
  };
  // Evento desejado
  dataDesejada: string;              // "YYYY-MM-DD"
  dataAlternativa?: string;          // até 1 alternativa
  slot: SlotEvento;                  // derivado da horaInicio (almoço/jantar)
  horaInicio: string;                // "HH:MM" — obrigatório
  horaFim: string;                   // "HH:MM" — obrigatório
  duracaoEstimadaHoras?: number;     // derivada de horaInicio/horaFim
  numConvidados: number;
  ocasiao: OcasiaoEvento;            // dropdown obrigatório
  ocasiaoOutros?: string;            // texto livre se ocasiao=="outros"
  modeloEvento: ModeloEvento;
  escopoPacote?: EscopoPacote;       // só preenchido se modelo=="pacote_por_pessoa"
  escopoPacoteOutro?: string;        // texto livre se escopoPacote=="outro"
  musicaAoVivo: boolean;
  decoracao: boolean;
  pacoteSugeridoId?: string;         // se cliente escolheu pacote no form
  observacoesCliente?: string;       // texto livre do form
  // Espaço físico do evento (default: único espaço ativo do restaurante).
  espacoId?: string;
  // Atribuição interna — responsável padrão vem de eventosConfig; alterável.
  responsavelId?: string;
  responsavelNome?: string;
  // Classificação de captação declarada na entrada do lead:
  //   publico  → inbound (cliente procurou)
  //   manual   → perguntado no cadastro (inbound = passiva / outbound = ativa)
  // Serve de default pro fechamento e pro cálculo de comissão.
  classificacaoPrevia?: "inbound" | "outbound";
  captadoPorPessoaId?: string;       // quem captou (se outbound)
  captadoPorNome?: string;
  // Conflito de agenda — usuário aceitou ter mais de um evento no mesmo dia.
  conflitoDiaAceito?: boolean;
  conflitaDataCom?: string[];        // legado (detecção antiga por data+slot)
  // Arquivamento mensal — setado ao "fechar o mês". Sai do board ativo.
  arquivadoEm?: string;              // ISO
  arquivadoMesRef?: string;          // "YYYY-MM"
  // Auditoria
  origem: "publico" | "manual";
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  // Perda
  perdidoEm?: string;
  motivoPerda?: string;
  // Fechamento do evento — preenchido quando o lead vira "realizado".
  // Dados pra apuração posterior de comissão por vendedor.
  fechamento?: {
    faturamentoBrutoSemGorjeta: number;   // R$
    classificacao: "inbound" | "outbound";
    captacaoAtiva: { ativo: boolean; pessoaId?: string; pessoaNome?: string };
    negociacaoPor: { pessoaId: string; pessoaNome: string };
    acompanhamentoPresencial: { ativo: boolean; pessoaId?: string; pessoaNome?: string };
    pagamentoConfirmado?: boolean;         // sinal+saldo quitados (finalizado)
    fechadoEm: string;                     // ISO
    fechadoPor: string;                    // pessoaId que fechou
    fechadoPorNome?: string;
  };
};

// Linha customizável da proposta. Substitui/estende os ajustes: cada linha é
// cobrada como valor FIXO (total) ou POR PESSOA (× numPessoas, que pode ser
// menor que o total de convidados — ex: bebida alcoólica só pros adultos).
export type LinhaProposta = {
  id: string;
  descricao: string;                 // "Locação", "Comidas", "Bebidas alcoólicas"
  tipo: "fixo" | "por_pessoa";
  valor: number;                     // fixo = total; por_pessoa = valor unitário
  numPessoas?: number;               // só quando tipo="por_pessoa"
};

// Total de uma linha, resolvendo fixo vs por_pessoa.
export function linhaPropostaTotal(l: Pick<LinhaProposta, "tipo" | "valor" | "numPessoas">): number {
  if (l.tipo === "fixo") return l.valor || 0;
  return (l.valor || 0) * (l.numPessoas || 0);
}

export type AjusteProposta = {
  descricao: string;                 // "Hora adicional", "Decoração premium"
  valor: number;                     // pode ser negativo (desconto)
};

export type ParcelaProposta = {
  ordem: number;
  descricao: string;                 // "Sinal 50%", "Saldo 50%"
  valor: number;
  vencimentoEm?: string;             // "YYYY-MM-DD"
  // Pagamento real
  pagaEm?: string;
  pagaPor?: string;                  // id da pessoa que registrou
  pagaPorNome?: string;
  comprovanteUrl?: string;
  observacao?: string;
};

export type PropostaEvento = {
  id: string;
  restaurantId: string;
  leadId: string;
  versao: number;                    // v1, v2... se renegociar
  pacoteBaseId?: string;             // pacote-base se houver
  // Snapshot do evento proposto
  dataEvento: string;
  slot: SlotEvento;
  horaInicio: string;
  duracaoHoras: number;
  numConvidados: number;
  // Snapshot dos PDFs do pacote no momento da proposta — congelado pra evitar
  // que cliente abra link que mudou depois.
  cardapios: CardapioPdf[];
  inclusos: string[];
  naoInclusos: string[];
  ajustes: AjusteProposta[];         // legado — mantido pra propostas antigas
  // Linhas customizáveis (locação fixa + itens por pessoa). Fonte do preço nas
  // propostas novas; quando presente, precoTotal = base pacote + Σ linhas.
  linhas?: LinhaProposta[];
  arredondamento?: number;           // ajuste manual (+/−) pra fechar valor redondo
  precoTotal: number;
  precoPorPessoa: number;
  // Pagamento
  parcelas: ParcelaProposta[];
  politicaCancelamentoTexto: string; // snapshot textual no momento da proposta
  observacoes?: string;
  // Auditoria
  pdfUrl?: string;
  enviadaEm?: string;
  enviadaPor?: string;
  enviadaPorNome?: string;
  createdAt: string;
  createdBy: string;
};

export type BEOEvento = {
  id: string;
  restaurantId: string;
  leadId: string;
  propostaId: string;                // proposta-fonte
  versao: number;
  // Cronograma
  dataEvento: string;
  slot: SlotEvento;
  horaChegadaEquipe: string;
  horaInicioServico: string;
  horaEncerramento: string;
  // Convidados
  numConvidados: number;
  contatoNoDia: { nome: string; whatsapp: string };
  // Operação
  cardapios: CardapioPdf[];
  restricoesAlimentares: string[];
  setup: string;                     // texto livre (mesas, decoração, AV)
  observacoes?: string;
  // Auditoria
  pdfUrl?: string;
  geradoEm: string;
  geradoPor: string;
  geradoPorNome: string;
};

export type TemplateMensagemEventoKey =
  | "lead_auto_resposta"             // disparado ao receber inquiry público
  | "primeiro_contato"               // vendedor abre conversa
  | "envio_proposta"
  | "lembrete_proposta"
  | "confirmacao_sinal"
  | "lembrete_saldo"
  | "evento_7_dias"
  | "evento_1_dia"
  | "pos_evento_obrigado";

export type TemplateMensagemEvento = {
  chave: TemplateMensagemEventoKey;
  titulo: string;
  texto: string;                     // com placeholders {{nome}}, {{data}}, {{pax}}, {{preco}}, {{pacote}}
};

export type ConfigTemplatesEvento = {
  id: string;                        // sempre = restaurantId
  restaurantId: string;
  templates: TemplateMensagemEvento[];
  updatedAt: string;
};

export type CanalTratativa =
  | "whatsapp_wame" | "whatsapp_api" | "whatsapp"
  | "email" | "telefone" | "presencial" | "sistema" | "outro";

export const CANAL_TRATATIVA_LABEL: Record<CanalTratativa, string> = {
  whatsapp_wame: "WhatsApp", whatsapp_api: "WhatsApp", whatsapp: "WhatsApp",
  email: "E-mail", telefone: "Telefone", presencial: "Presencial",
  sistema: "Sistema", outro: "Outro",
};
export const CANAL_TRATATIVA_ICONE: Record<CanalTratativa, string> = {
  whatsapp_wame: "💬", whatsapp_api: "💬", whatsapp: "💬",
  email: "📧", telefone: "📞", presencial: "🤝", sistema: "⚙️", outro: "•",
};

export type LogMensagemEvento = {
  id: string;
  restaurantId: string;
  leadId: string;
  templateKey?: TemplateMensagemEventoKey;
  texto: string;                     // texto efetivo enviado (após substituir placeholders)
  enviadoEm: string;
  enviadoPor: string;
  enviadoPorNome: string;
  canal: CanalTratativa;
  manual?: boolean;                  // true = tratativa lançada à mão pelo usuário
};

// ─── SITES ─────────────────────────────────────────────────────────────────
// Módulo "Sites" — gerencia o site público de cada restaurante (substitui Wix).
// 1 doc por restaurante em /sitesConfig, com id = restaurantId.
// Conteúdo é renderizado pelo app público (rota /site/:slug ou domínio próprio).

// Horário padrão semanal. Cada dia pode ter 0, 1 ou 2 turnos (ex: almoço + jantar).
export type HorarioFuncionamentoDia = {
  dia: number;                       // 0 = domingo, 6 = sábado
  fechado: boolean;                  // se true, ignora turnos
  turnos: { abre: string; fecha: string }[];  // "HH:MM" cada
};

// Exceção pontual (feriado, evento especial). Sobrescreve o horário padrão
// num dia específico OU range de dias. Compartilhado com módulo Reservas.
//
// Reservas nessa data:
//   - slotsReservaCustom undefined → herda janelas semanais (se fechado,
//     reservas desabilitadas; senão, slots normais do dia da semana)
//   - slotsReservaCustom = []      → sem reservas nessa data (mesmo aberto)
//   - slotsReservaCustom = [...]   → usa esses slots customizados
export type ExcecaoHorarioSite = {
  id: string;
  data: string;                      // YYYY-MM-DD
  fechado: boolean;
  turnos?: { abre: string; fecha: string }[];
  slotsReservaCustom?: SlotReserva[];
  motivo?: string;                   // "Feriado de Natal", "Réveillon especial"
  // Confirmação manual de que essa exceção foi refletida no Google Business.
  // true = admin marcou checkbox. false/undefined = pendente. Banner sticky
  // aparece quando qualquer exceção tem isso != true.
  // Quando admin edita a exceção com mudança real, isso é resetado pra false
  // automaticamente (precisa confirmar de novo no Google).
  googleSyncOk?: boolean;
  criadoEm: string;
  criadoPor: string;
};

export type TemaSite = {
  corPrimaria: string;               // "#1a5c2a"
  corSecundaria: string;             // "#d4af37"
  corFundo?: string;                 // "#fff" default
  corTexto?: string;                 // "#1a1a1a" default
  // Fontes — CSS font-family strings. Se preenchidas, sobrescrevem o
  // default do template. Carregadas dinamicamente do Google Fonts pelo
  // site público — referenciam IDs do catálogo em
  // src/modules/sites/templates/fontesDisponiveis.ts.
  fonteHeading?: string;             // títulos grandes (hero h1, section h2)
  fonteSubtitulo?: string;           // subtítulos / texto-destaque
  fonteCorpo?: string;               // texto regular
  // ── Escalas tipográficas (multiplicadores 0.85–1.40, default 1.0) ────
  // 5 categorias × 2 devices = 10 controles independentes. Permite
  // ajuste fino quando uma fonte fica pequena no desktop mas grande
  // demais em mobile (ou vice-versa). Cada categoria visual tem 1 par:
  //
  //   Hero      → Título grande do topo (h1)
  //   Titulos   → Cabeçalhos de seção (h2)
  //   Corpo     → Parágrafos + subtítulo do hero
  //   Menu      → Nav (desktop = NavLink, mobile = hamburguer)
  //   Botoes    → CTAs (Reservar, Solicitar, iFood, etc.)
  //
  // Backward compat (campos antigos):
  //   - `escalaTexto` (config v1) → fallback pra escalaCorpo[Desktop|Mobile]
  //   - `escalaPequenos` (config v2) → fallback pra Menu+Botões
  //   - `escalaHero|Titulos|Corpo|Botoes` (config v3, sem device split) →
  //     fallback pros pares Desktop/Mobile da MESMA categoria
  //   - `escalaMenuDesktop|Mobile` já eram device-specific desde v3 e
  //     ficam como estão (continuam sendo a fonte da verdade pra Menu).
  escalaHeroDesktop?: number;
  escalaHeroMobile?: number;
  escalaTitulosDesktop?: number;
  escalaTitulosMobile?: number;
  escalaCorpoDesktop?: number;
  escalaCorpoMobile?: number;
  escalaMenuDesktop?: number;
  escalaMenuMobile?: number;
  escalaBotoesDesktop?: number;
  escalaBotoesMobile?: number;
  /** @deprecated Use escalaHeroDesktop/Mobile */
  escalaHero?: number;
  /** @deprecated Use escalaTitulosDesktop/Mobile */
  escalaTitulos?: number;
  /** @deprecated Use escalaCorpoDesktop/Mobile */
  escalaCorpo?: number;
  /** @deprecated Use escalaBotoesDesktop/Mobile */
  escalaBotoes?: number;
  /** @deprecated Use os campos específicos de Menu+Botões */
  escalaPequenos?: number;
  /** @deprecated Use escalaCorpoDesktop/Mobile */
  escalaTexto?: number;
  raioBorda?: string;                // "8px"
};

export type RedeSocial = {
  tipo: "instagram" | "facebook" | "whatsapp" | "tiktok" | "youtube" | "outro";
  url: string;
  label?: string;                    // se outro
};

export type LinkDelivery = {
  plataforma: "ifood" | "rappi" | "uber" | "proprio" | "outro";
  url: string;
  label?: string;
};

// ── Cardápio estruturado (editor no app, doc /cardapioEstruturado/{rid}) ─────
// Seção → pratos. Cada prato: título (nome) + subtítulo (descrição) + preço
// (string pra aceitar "44 | 74", "Mkt", etc.). Campos *En = tradução por IA.
export type PratoCardapio = {
  id: string;
  titulo: string;
  subtitulo?: string;
  preco?: string;            // preço da garrafa (ou preço único)
  garrafaMl?: string;        // tamanho da garrafa em ml (ex: "375") — exibido "(375ml)" antes do preço
  taca?: boolean;            // servido também em taça
  precoTaca?: string;        // preço da taça (quando taca = true)
  tacaMl?: string;           // tamanho da taça em ml (ex: "120") — exibido "(120ml)" antes do preço
  tituloEn?: string;
  subtituloEn?: string;
  // Ícone à esquerda do item (coquetéis etc.): da biblioteca embutida (iconeId)
  // ou imagem própria (iconeUrl). tipo "imagem" = item que é só uma logo
  // centralizada (ex: logo de cerveja entre itens), sem nome/preço.
  iconeId?: string;
  iconeUrl?: string;
  tipo?: "item" | "imagem";
};
export type SecaoCardapio = {
  id: string;
  nome: string;
  nomeEn?: string;
  obs?: string;                      // ex: "consulte as opções do dia na lousa"
  obsEn?: string;
  pratos: PratoCardapio[];
  // Posicionamento no PDF (generalizado): página, coluna e topo (px no preview).
  pagina?: number;                   // 1..N
  coluna?: number;                   // 0 = esquerda, 1 = direita
  posTop?: number;                   // px na página de preview
  // Quebra de coluna: a partir do item `quebraIdx`, a seção continua em outra
  // coluna (colB) na posição posTopB — sem repetir o cabeçalho.
  quebraIdx?: number;                // índice do 1º item da parte 2 (1..len-1)
  pagB?: number;                     // página da parte 2 (default = mesma página)
  colB?: number;                     // coluna da parte 2
  posTopB?: number;                  // px da parte 2
};
// Um cardápio (ex: Comidas, Bebidas, Vinhos) dentro do restaurante.
export type CardapioMenu = {
  id: string;
  nome: string;                      // "Comidas"
  tituloCapa?: string;               // rótulo na capa ("COMIDAS")
  temCapa?: boolean;                 // usa a página de capa (arte)
  secoes: SecaoCardapio[];
  traduzidoEm?: string;
  traduzidoSig?: string;             // assinatura do conteúdo PT no momento da tradução
  mostrarGarrafa?: boolean;          // cardápio de vinhos → ícone de garrafa em TODOS os itens (tudo ou nada)
  // Formatação (fontes/tamanhos/espaçamentos/margens): por padrão usa o layout
  // COMPARTILHADO do restaurante. Se `layoutProprio`, usa o `layout` próprio abaixo.
  layoutProprio?: boolean;
  layout?: CardapioLayout;
};
// Ajustes visuais do PDF/preview do cardápio (fontes Google + espaçamentos).
export type CardapioLayout = {
  fonteTitulos?: string;   // id de FONTES_SITE (ou família custom)
  fonteCorpo?: string;     // id de FONTES_SITE (ou família custom)
  fontesCustom?: string[]; // famílias Google adicionadas pelo usuário
  espacoPratos?: number;   // px entre um prato e o próximo
  espacoDescricao?: number; // px entre o título do prato e a descrição
  espacoSecoes?: number;   // px entre seções (legado — seções agora têm posição absoluta)
  tamTitulo?: number;      // px do nome do prato
  tamDescricao?: number;   // px da descrição do prato
  tamSecao?: number;       // px do cabeçalho da seção
  // Título da capa (ex: "COMIDAS") — editável
  tituloCapa?: string;
  tamTituloCapa?: number;  // px
  offsetTituloCapa?: number; // deslocamento vertical em relação à logo (px, +desce)
  // Posição vertical (top, px na página de preview) por seção — chave normalizada
  // (sobremesa, frio, quente, brasa, acompanhamento). Layout Sororoca.
  secaoPos?: { [chave: string]: number };
  mostrarCifrao?: boolean;  // mostra "$" antes do preço numérico (default true)
  margemTopo?: number;      // px (na página de preview)
  margemBaixo?: number;     // px
  colGap?: number;          // px entre as colunas (gutter) — default 22
  // Arte do cardápio (PNG por restaurante). Capa = fundo da pág 1; miolo = fundo
  // das demais. Sem capa, a pág 1 vira página de conteúdo normal.
  capaUrl?: string;
  mioloUrl?: string;
  capaTitLeftPct?: number;  // posição horizontal do título da capa (% da largura) — default 54
  capaTitTopPct?: number;   // posição vertical do título da capa (% da altura) — default ~20
  // Colunas: padrão pra todas as páginas + override por página (1..3).
  colsPadrao?: number;
  colsPorPagina?: { [pagina: number]: number };
};
export type CardapioEstruturado = {
  id: string;                        // = restaurantId
  restaurantId: string;
  cardapios?: CardapioMenu[];        // múltiplos cardápios (Comidas/Bebidas/Vinhos)
  cardapiosSeedSororoca?: boolean;   // piloto: Bebidas/Vinhos já criados (não recriar)
  layout?: CardapioLayout;           // visual COMPARTILHADO entre os cardápios do restaurante
  secoes?: SecaoCardapio[];          // legado (1 cardápio) — migrado p/ cardapios na carga
  // Itens "sombra" extraídos por IA de um cardápio em PDF — só pra alimentar o
  // vínculo de preços das fichas técnicas (não vão pro site).
  cardapioPdfItens?: { id: string; titulo: string; preco: string; secao?: string }[];
  cardapioPdfItensEm?: string;       // ISO da última extração
  traduzidoEm?: string;
  traduzidoSig?: string;             // legado: assinatura PT da última tradução
  atualizadoEm: string;
  atualizadoPor?: string;
};

export type SiteConfig = {
  id: string;                        // = restaurantId
  restaurantId: string;
  // Conteúdo editorial
  slogan?: string;                   // tagline curta no hero
  historia: string;                  // texto longo, parágrafos
  // Hero
  heroImagemUrl?: string;            // Storage URL
  heroVideoUrl?: string;             // opcional
  // Contato
  endereco: {
    rua: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade: string;
    uf: string;
    cep?: string;
    googleMapsUrl?: string;          // se preenchido, vira link/embed
    latLng?: { lat: number; lng: number };  // pra Schema.org SEO
  };
  telefone?: string;
  emailContato?: string;
  // Horário
  horarios: HorarioFuncionamentoDia[];  // 7 entries (1 por dia da semana)
  excecoes: ExcecaoHorarioSite[];    // ordenadas por data
  // Cardápio (PDF — sempre)
  cardapioPdfPtUrl?: string;
  cardapioPdfPtAtualizadoEm?: string;
  cardapioPdfPtAtualizadoPor?: string;
  cardapioPdfEnUrl?: string;
  cardapioPdfEnAtualizadoEm?: string;
  cardapioPdfEnAtualizadoPor?: string;
  // Atalhos de URL do cardápio no domínio próprio (ex: lobozo.com.br/cardapio
  // → PDF PT, /menu → PDF EN). Editável por restaurante. Vazio = padrão
  // (cardapio→pt, menu→en). Resolvido em runtime → redireciona pro PDF.
  cardapioAtalhos?: { path: string; idioma: "pt" | "en" }[];
  // Modo do cardápio: "pdf" (sobe PDF, default) ou "editor" (monta no app,
  // doc em /cardapioEstruturado/{rid} — site renderiza ao vivo).
  cardapioModo?: "pdf" | "editor";
  // Reservas: "interno" (default) usa o módulo de Reservas do app (/reservas/:rid);
  // "externo" leva os CTAs de reserva pra um sistema externo (ex: Get In) via URL.
  reservasModo?: "interno" | "externo";
  reservasUrlExterna?: string;
  // Redes
  redes: RedeSocial[];
  // Features (controla seções no site)
  features: {
    hasDelivery: boolean;
    hasEventos: boolean;
    hasLaje: boolean;                // só Lobozó por enquanto — seção dedicada
    hasTrabalheConosco: boolean;
    hasReservas: boolean;
    hasGaleria: boolean;             // não usado por enquanto (Instagram serve)
  };
  delivery?: LinkDelivery[];          // só se hasDelivery
  // Tema
  tema: TemaSite;
  // Assets
  logoUrl?: string;
  faviconUrl?: string;
  ogImageUrl?: string;               // pra SEO/social share
  // Ordem das seções no site público. Hero e Footer ficam fixos (sempre
  // primeiro e último). As outras seções aparecem na ordem deste array.
  // IDs válidos: "historia" | "cardapio" | "horario" | "laje" | "eventos"
  //             | "reservas" | "delivery" | "trabalhe" | "contato".
  // Se não preenchido, usa ordem padrão do template.
  ordemSecoes?: string[];
  // Textos editáveis do site (sobrescrevem defaults do template).
  // Cada campo é opcional — se não preenchido, o template usa um default
  // adequado à marca dele. Útil pra ajustar copy sem mexer no código.
  textos?: {
    heroTitulo?: string;
    heroSubtitulo?: string;
    heroCtaLabel?: string;
    cardapioTitulo?: string;
    horarioTitulo?: string;
    horarioProximosAvisosLabel?: string;
    eventosTitulo?: string;
    eventosTexto?: string;
    eventosCtaLabel?: string;
    lajeTitulo?: string;
    lajeTexto?: string;
    lajeCtaLabel?: string;
    reservasTitulo?: string;
    reservasTexto?: string;
    reservasCtaLabel?: string;
    deliveryTitulo?: string;
    deliveryTexto?: string;
    trabalheTitulo?: string;
    trabalheTexto?: string;
    trabalheCtaLabel?: string;
    contatoTitulo?: string;
    historiaTitulo?: string;
    rodapeDireitos?: string;           // texto após "© ano —" no footer
  };
  // Slug (subdomínio temporário tipo lobozo-site.web.app, ou path /site/lobozo)
  slug: string;
  // Qual template visual usar pra renderizar o site público.
  // - "personalizado": template completo (header sticky, hero grande, todas
  //   as seções), pensado pra ser adaptado por cor/fonte/logo de cada marca.
  //   Defaults vêm com paleta verde+dourado + DM Serif Display — você
  //   sobrescreve tudo no admin.
  // - "default": template super-simples, layout minimalista.
  // Valor legado "lobozo" é aceito como alias de "personalizado".
  templateId: "personalizado" | "default" | "lobozo";
  // Status
  publicado: boolean;                // se false, site retorna 404 público
  // ── Google Business Profile (sync manual) ─────────────────────────────
  // URL do painel de edição do Google Business desse restaurante. Admin
  // cola uma vez (https://business.google.com/edit/l/<locationId> ou só
  // business.google.com/). Banner de "atualizar no Google" usa esse link.
  googleBusinessUrl?: string;
  // Confirmação manual de que o horário regular semanal está espelhado
  // no Google Business. true = admin marcou checkbox. false = mudou e
  // ainda não confirmou. undefined = nunca foi mexido (assume sincronizado
  // pra não exibir banner em sites pré-feature).
  // Confirmações das exceções vivem em cada item de `excecoes[]`
  // (ExcecaoHorarioSite.googleSyncOk).
  googleHorarioRegularOk?: boolean;
  // Auditoria
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

// ─── TRABALHE CONOSCO ──────────────────────────────────────────────────────
// Candidatura simples vinda do site público. Não é Admissão — é só
// "lead de candidato" pra você triar depois.

export type StatusCandidatura =
  | "nova"
  | "em_analise"
  | "aprovada_pra_admissao"       // movida pro módulo Admissão
  | "rejeitada"
  | "arquivada";

export type CandidaturaTrabalhe = {
  id: string;
  restaurantId: string;
  status: StatusCandidatura;
  // Dados do candidato
  nome: string;
  whatsapp: string;                  // E.164
  email: string;
  areaInteresse: string;             // texto livre ou lista
  experiencia?: string;              // descrição livre
  disponibilidade?: string;          // "imediato", "30 dias", etc
  curriculoUrl?: string;             // upload opcional
  // Atribuição
  responsavelId?: string;
  responsavelNome?: string;
  observacoesInternas?: string;
  // Auditoria
  origem: "publico" | "manual";
  createdAt: string;
  updatedAt: string;
  rejeitadaEm?: string;
  motivoRejeicao?: string;
};

// ════════════════════════════════════════════════════════════════════════════
//  UNIFORMES & EPIs
//
//  Modelo:
//   - `itensUniforme` — catálogo (1 doc por item, com array de variações)
//   - `kitsAreaUniforme` — kit padrão por área (cargo.area)
//   - `entregasUniforme` — registro de cada entrega ao empregado/pessoa
//   - `movEstoqueUniforme` — log de entradas/saídas de estoque
//   - `termoUniformesConfig` — override por restaurante do texto do PDF
//
//  Vinculo: `pessoaId` (cobre empregado CLT + freelancer fixo). `empregadoId`
//  opcional se aplicável.
//
//  Validade: contada a partir da entrega (entregueEm + item.validadeDias).
// ════════════════════════════════════════════════════════════════════════════

export type TipoItemUniforme = "uniforme" | "epi";

export type VariacaoItem = {
  id: string;                          // gerado client-side (timestamp + random)
  tamanho: string;                     // "P" | "42" | "único" — texto livre
  estoque: number;                     // saldo atual
  custoUnitOverride?: number;          // se variação tem preço diferente do item base
  estoqueMinimo?: number;              // alerta quando estoque chega aqui
};

export type ItemUniforme = {
  id: string;
  restaurantId: string;
  tipo: TipoItemUniforme;
  nome: string;                        // ex: "Camiseta polo Sororoca"
  custoUnit: number;                   // base — variação pode sobrescrever
  validadeDias: number;                // 0 = sem validade (ex: avental que não vence)
  caEpi?: string;                      // Certificado de Aprovação (só EPI)
  variacoes: VariacaoItem[];
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export type KitAreaUniforme = {
  id: string;                          // = `${restaurantId}_${area_slug}`
  restaurantId: string;
  area: string;                        // bate com cargo.area
  itens: { itemId: string; variacaoId?: string; quantidade: number }[];
  atualizadoEm: string;
  atualizadoPor: string;
};

export type EntregaItemUniforme = {
  itemId: string;
  variacaoId?: string;
  nome: string;                        // snapshot — não muda se item mudar nome depois
  tamanho?: string;                    // snapshot
  qtd: number;
  custoUnit: number;                   // snapshot
  caEpi?: string;                      // snapshot
  validadeAte?: string;                // YYYY-MM-DD, calc: entregueEm + validadeDias
};

export type DevolucaoStatus = "devolvido" | "descartado" | "levado_pelo_empregado";

export type EntregaUniforme = {
  id: string;
  restaurantId: string;
  // Vincula a uma pessoa real (empregado CLT ou freelancer fixo). Pode ficar
  // vazio quando a entrega é feita DURANTE a admissão e o cadastro de Pessoa
  // ainda não foi criado (criado só no fim da admissão). Nesse caso preencha
  // `candidatoSnapshot` + `admissaoId`. Quando admissão concluir, é possível
  // retroativo atualizar pessoaId aqui.
  pessoaId?: string;
  // Snapshot do candidato pra entregas feitas durante a admissão (sem pessoaId).
  // A UI usa o snapshot pra mostrar nome/CPF na lista. Após admissão concluir,
  // o pessoaId é preenchido e o snapshot vira histórico.
  candidatoSnapshot?: { nome: string; cpf: string; whatsapp?: string };
  empregadoId?: string;                // se aplicável
  admissaoId?: string;                 // se foi durante admissão
  tipo: TipoItemUniforme;              // termo separado: 1 entrega = 1 tipo
  motivo: "admissao" | "troca" | "reposicao" | "freelancer";
  itens: EntregaItemUniforme[];
  entregueEm: string;                  // ISO
  entreguePor: { id: string; nome: string };
  termoPdfUrl?: string;                // se subir PDF assinado depois (Drive/Clicksign)
  observacao?: string;
  // Devolução total ou parcial (na demissão ou em troca)
  devolucao?: {
    devolvidoEm: string;
    devolvidoPor: { id: string; nome: string };
    itens: {
      itemId: string;
      variacaoId?: string;
      qtd: number;
      status: DevolucaoStatus;
    }[];
    observacao?: string;
  };
  // Cancelamento — quando a entrega foi planejada/registrada mas o
  // empregado NÃO recebeu (mudança de plano, candidato desistiu, etc.).
  // Reverte 100% dos itens ao estoque. Mutuamente exclusivo com devolução.
  cancelamento?: {
    canceladoEm: string;
    canceladoPor: { id: string; nome: string };
    motivo: string;
  };
  // Última edição (via atualizarEntrega). Não confundir com entregueEm: a
  // data da entrega original não muda; isso é só audit do reajuste.
  atualizadoEm?: string;
  atualizadoPor?: { id: string; nome: string };
};

export type MotivoMovEstoque =
  | "compra"            // entrada — compra de novos itens
  | "entrega"           // saída — entrega pra empregado
  | "troca"             // saída — troca de item velho por novo
  | "devolucao"         // entrada — empregado devolveu
  | "ajuste"            // ±  — ajuste manual (inventário)
  | "descarte";         // saída — item descartado (vencido, danificado)

export type MovEstoqueUniforme = {
  id: string;
  restaurantId: string;
  itemId: string;
  variacaoId: string;
  delta: number;                       // positivo = entrada, negativo = saída
  motivo: MotivoMovEstoque;
  refEntregaId?: string;               // se motivo é entrega/troca/devolucao
  observacao?: string;
  criadoEm: string;
  criadoPor: { id: string; nome: string };
};

// ────────────────────────────────────────────────────────────────────────────
//  GESTOR DE TAREFAS + CADASTROS MESTRES (Contas Fixas, Manutenções)
//
//  Modelo: Projeto > Subprojeto > Tarefa. Caixa de tarefas é POR USUÁRIO
//  (não rest-bound). Cada tarefa carrega empresa(s) como CAMPO opcional.
//  Tarefas-lembrete podem vir de cadastros mestres (Conta Fixa, Manutenção,
//  Admissão) — campo `origem` indica a fonte e `origemRefId` linka de volta.
//
//  Soft delete: deletadoEm + deletadoPor (lixeira só master vê).
// ────────────────────────────────────────────────────────────────────────────

// Visibilidade do projeto — quem vê as tarefas dele.
// Modelo simplificado: privado (default, master + autorizados explícitos)
// | escritorio (todos autenticados) | publico (alias de escritorio).
// Os antigos grupo_* foram removidos — quando aparecerem em docs legados,
// são tratados como "privado" pelo podeVerTarefa.
export type TarefaVisibilidade = "privado" | "escritorio" | "publico";

export const TAREFA_VISIBILIDADE_LABEL: Record<TarefaVisibilidade, string> = {
  privado:    "Privado (só master + autorizados)",
  escritorio: "Todo o escritório",
  publico:    "Público (todo o sistema)",
};

// Origem da tarefa — de onde veio. Influencia comportamento e link de volta.
export type TarefaOrigem =
  | "manual" | "recorrencia" | "admissao" | "demissao" | "ferias"
  | "reuniao" | "conta_fixa" | "manutencao" | "evento" | "lote_financeiro"
  | "portal_empregado";

export const TAREFA_ORIGEM_LABEL: Record<TarefaOrigem, string> = {
  manual:           "Manual",
  recorrencia:      "Recorrência",
  admissao:         "Admissão",
  demissao:         "Demissão",
  ferias:           "Férias",
  reuniao:          "Reunião",
  conta_fixa:       "Conta Fixa",
  manutencao:       "Manutenção",
  evento:           "Evento",
  lote_financeiro:  "Lote Financeiro",
  portal_empregado: "Portal do Empregado",
};

// Config "Tarefas Automáticas" por (restaurantId, módulo origem). Define
// quem é o responsável padrão + co-responsáveis + observadores das tarefas
// que vêm dos hooks daquele módulo. Editável pela aba Automações no Admin
// Projetos. Quando alterada, oferece propagar nas tarefas em aberto.
//
// Módulos origem suportados (mesmo conjunto que TarefaOrigem, excluindo
// "manual" e "recorrencia" — esses não têm "config de geração automática"
// no sentido tradicional).
export type ModuloOrigemTarefa = Exclude<TarefaOrigem, "manual" | "recorrencia">;

export const MODULOS_ORIGEM_TAREFA: ModuloOrigemTarefa[] = [
  "admissao", "demissao", "ferias", "reuniao",
  "conta_fixa", "manutencao", "evento", "lote_financeiro", "portal_empregado",
];

export type TarefaAutomacao = {
  id: string;                          // `${restaurantId}_${moduloId}`
  restaurantId: string;
  moduloId: ModuloOrigemTarefa;
  responsavelId?: string;
  responsavelNome?: string;
  coResponsaveisIds?: string[];
  coResponsaveisNomes?: string[];
  observadoresIds?: string[];
  observadoresNomes?: string[];
  atualizadoEm: string;
  atualizadoPor: string;
};

export type TarefaStatus = "a_fazer" | "em_andamento" | "concluida" | "cancelada";

export const TAREFA_STATUS_LABEL: Record<TarefaStatus, string> = {
  a_fazer:      "A fazer",
  em_andamento: "Em andamento",
  concluida:    "Concluída",
  cancelada:    "Cancelada",
};

export type TarefaPrioridade = "baixa" | "normal" | "alta" | "urgente";

export const TAREFA_PRIORIDADE_LABEL: Record<TarefaPrioridade, string> = {
  baixa:   "Baixa",
  normal:  "Normal",
  alta:    "Alta",
  urgente: "Urgente",
};

// Projeto = nível superior. Tem cor (herdada como bg do card da tarefa).
export type TarefaProjeto = {
  id: string;
  nome: string;
  emoji?: string;
  cor: string;                  // hex
  dono: string;                 // pessoaId
  donoNome?: string;            // snapshot
  visibilidade: TarefaVisibilidade;
  // Lista explícita de pessoaIds com acesso, ADICIONAL às regras de
  // visibilidade. Útil pra projeto confidencial onde só X pessoas veem.
  // Combina por OR com visibilidade: o usuário vê se PODE pela visibilidade
  // OU se está nesta lista.
  usuariosAutorizados?: string[];
  tipo: "rotina" | "demanda" | "misto";
  ordem: number;
  ativo: boolean;
  deletadoEm?: string | null;
  deletadoPor?: string | null;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// Subprojeto = nível intermediário. Pode ser "auto" (sistema gera tarefas).
export type TarefaSubprojeto = {
  id: string;
  projetoId: string;
  nome: string;
  descricao?: string;
  auto: boolean;
  // Quando true, bloqueia criação manual de tarefas neste subprojeto —
  // ele só recebe tarefas vindas de hooks automáticos de outros módulos
  // (Admissão, Demissão, Exames, etc). Diferente de `auto`: um sub pode
  // ser bloqueado sem ser auto (subprojeto "Em construção", por ex.).
  // Quando bloqueado, o subprojeto também não pode ser excluído via UI.
  bloqueadoCriacaoManual?: boolean;
  // Texto livre descrevendo o gatilho da geração automática
  // (ex: "Nova admissão concluída no módulo Pessoas").
  gatilho?: string;
  // Rota relativa pra onde o usuário vai pra gerar tarefas deste sub
  // (ex: "/admissao", "/exames"). Mostrada como CTA no banner explicativo
  // quando o sub é bloqueado. Sem o `/r/{rid}` — calculado em runtime.
  moduloOrigemRota?: string;
  // Label do CTA, ex: "Ir pra Admissão". Se vazio, usa "Ir pra origem".
  moduloOrigemLabel?: string;
  // Restaurante de origem do módulo. Quando preenchido, o link do CTA do
  // banner trava aquele rest (`/r/{esseRest}/{rota}`). Quando vazio, usa
  // o rest atualmente selecionado (RestaurantContext). Use preenchido pra
  // sub específico de uma unidade (ex: "Eventos Laje Lobozó"); deixe
  // vazio pra sub compartilhado (ex: "Admissão" recebendo de todas).
  moduloOrigemRestaurantId?: string;
  campos?: string;              // texto livre — campos custom separados por ·
  pastaDriveTemplate?: string;
  // Templates de tarefa-filha (checklist) usados quando criar uma tarefa-pai
  // a partir deste subprojeto. Ex.: Fechamento Financeiro Mensal vira tarefa
  // com 15 subtarefas pré-definidas.
  tarefasTemplate?: TarefaTemplate[];
  // Definição de campos custom desse subprojeto. Cada tarefa do subprojeto
  // pode preencher e o valor fica em tarefa.customFields[fieldId].
  customFieldsDef?: TarefaCustomField[];
  // Responsável padrão pras tarefas criadas neste subprojeto. Se undefined,
  // cai pro criador da tarefa.
  responsavelPadraoId?: string;
  responsavelPadraoNome?: string;
  // Observadores padrão — toda tarefa criada neste subprojeto vem com
  // esses ids em observadoresIds (somam aos manualmente adicionados na
  // criação). Útil pra "líder de área sempre acompanha o que rola no
  // sub X". Filtrado pela visibilidade do projeto pai.
  observadoresPadraoIds?: string[];
  // Recorrência da tarefa-pai (rotinas). Quando setado + auto:true, sistema
  // pode gerar próxima ocorrência automaticamente ao concluir.
  recorrenciaTipo?: "nenhuma" | "mensal" | "semanal" | "anual" | "trimestral" | "semestral";
  recorrenciaDia?: number;      // 1-31 (mensal/anual/...) ou 0-6 (semanal)
  recorrenciaMes?: number;      // 1-12 (anual/trimestral/semestral)
  ordem: number;
  ativo: boolean;
  deletadoEm?: string | null;
  deletadoPor?: string | null;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

export const RECORRENCIA_TIPO_LABEL: Record<NonNullable<TarefaSubprojeto["recorrenciaTipo"]>, string> = {
  nenhuma:    "Sem recorrência",
  semanal:    "Semanal",
  mensal:     "Mensal",
  trimestral: "Trimestral (3 meses)",
  semestral:  "Semestral (6 meses)",
  anual:      "Anual",
};

// Template de tarefa (linha do esqueleto). Usado pelo gerador de recorrências.
export type TarefaTemplate = {
  titulo: string;
  responsavelHint?: string;
  // Offset relativo ao prazo da tarefa-pai: "D+5" / "D-2" / "dia 20".
  // O sistema resolve isso pra data real na hora de criar.
  prazoOffset?: string;
  origem?: TarefaOrigem;
};

// Definição de um campo custom dentro de um subprojeto. Cada tarefa do
// subprojeto pode preencher esses campos, e os valores ficam em
// tarefa.customFields[fieldId].
export type TarefaCustomFieldTipo = "texto" | "numero" | "data" | "select" | "checkbox";

export const TAREFA_CUSTOM_FIELD_TIPO_LABEL: Record<TarefaCustomFieldTipo, string> = {
  texto:    "Texto",
  numero:   "Número",
  data:     "Data",
  select:   "Seleção",
  checkbox: "Checkbox",
};

export type TarefaCustomField = {
  id: string;
  nome: string;
  tipo: TarefaCustomFieldTipo;
  opcoes?: string[];          // só pra tipo "select"
  obrigatorio?: boolean;
  ordem: number;
};

export type Subtarefa = {
  id: string;
  texto: string;
  feito: boolean;
  feitoEm?: string | null;
  feitoPor?: string | null;
  feitoPorNome?: string | null;
  // Prazo individual da subtarefa (opcional). Calculado a partir de
  // prazoOffset do template quando a tarefa-pai foi criada com checklist.
  prazo?: string | null;
  // Responsável opcional da subtarefa. Quando setado, a subtarefa aparece
  // em "Minhas Tarefas" do responsável (mesmo que ele não seja o
  // responsável da tarefa-pai). Quando ausente, fica restrita ao escopo
  // da tarefa-pai.
  responsavelId?: string | null;
  responsavelNome?: string | null;
  // Flags especiais propagados do ExameSubtarefaTemplate:
  // - ehBaixa: ao marcar, abre modal de baixa que atualiza ExameEmpregado
  // - ehAnexoResultado: ao marcar, abre Drive Picker e anexa
  ehBaixa?: boolean;
  ehAnexoResultado?: boolean;
  ordem: number;
};

export type TarefaComentario = {
  id: string;
  texto: string;
  autorId: string;
  autorNome: string;
  // pessoaIds mencionados via "@" no texto. ToastListener detecta menção
  // do usuário logado e dispara notificação.
  mencionados?: string[];
  criadoEm: string;
};

export type TarefaLogEntry = {
  id: string;
  acao:
    | "criada" | "editada" | "status_mudou" | "responsavel_mudou"
    | "co_resp_adicionado" | "co_resp_removido"
    | "subtarefa_adicionada" | "subtarefa_marcada" | "subtarefa_desmarcada" | "subtarefa_removida"
    | "comentario_adicionado" | "anexo_adicionado"
    | "deletada" | "restaurada";
  detalhe?: string;
  campo?: string;
  valorAntes?: string;
  valorDepois?: string;
  autorId: string;
  autorNome: string;
  em: string;
};

export type TarefaAnexo = {
  id: string;
  nome: string;
  url: string;
  tipo?: string;
  adicionadoEm: string;
  adicionadoPor: string;
};

// Tarefa — entidade central. Top-level pra facilitar query "minhas".
export type Tarefa = {
  id: string;
  projetoId: string;
  subprojetoId: string;
  titulo: string;
  descricao?: string;
  responsavelId: string;
  responsavelNome?: string;
  coResponsaveis?: string[];
  coResponsaveisNomes?: string[];
  // Observadores acompanham a tarefa (recebem notificações de mudanças e
  // menções) mas não podem editá-la. Diferente de coResponsaveis que têm
  // poder de ação.
  observadoresIds?: string[];
  observadoresNomes?: string[];
  // Denormalizado: união dos responsavelId de todas as subtarefas que têm
  // responsável atribuído. Permite query array-contains pra incluir essa
  // tarefa em "Minhas Tarefas" do responsável de qualquer subtarefa.
  subtarefaResponsaveisIds?: string[];
  restaurantIds?: string[];     // empresa(s) — multi-select opcional
  prazo?: string | null;
  inicio?: string | null;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  subtarefas?: Subtarefa[];
  comentarios?: TarefaComentario[];
  log?: TarefaLogEntry[];
  anexos?: TarefaAnexo[];
  origem: TarefaOrigem;
  origemRefId?: string;
  origemRefLabel?: string;
  recorrenciaKey?: string;      // pra idempotência do gerador
  // Valores dos campos custom definidos pelo subprojeto (customFieldsDef).
  // Chave = field.id, valor = string/number/boolean/Date conforme o tipo.
  // Mantém union flexível pra evolução do schema.
  customFields?: { [fieldId: string]: string | number | boolean | null };
  // Override de visibilidade — quando setado, ignora a visibilidade do
  // projeto. Útil pra restringir/abrir uma tarefa específica.
  visibilidadeOverride?: TarefaVisibilidade;
  // Lista explícita de pessoaIds com acesso a esta tarefa específica.
  // ADICIONAL às regras de visibilidade. Master/criador/responsável/co-resp
  // sempre vêem. Pessoas listadas aqui também.
  usuariosAutorizados?: string[];
  // DENORMALIZAÇÃO pras Firestore rules: a visibilidade efetiva já
  // calculada (override || visibilidade do projeto). Repository atualiza
  // este campo sempre que mexer em visibilidadeOverride ou projetoId.
  // Rules consultam só este campo (sem precisar de get() do projeto).
  visibilidadeEfetiva?: TarefaVisibilidade;
  // Marcador opcional: tarefa é uma decisão de Experiência. Ativa o
  // botão "Não renovar — iniciar demissão" no DetalheModal.
  ehDecisaoExperiencia?: "1a" | "2a";
  corHerdada?: string;
  deletadoEm?: string | null;
  deletadoPor?: string | null;
  motivoDelete?: string;
  criadoEm: string;
  criadoPor: string;
  criadoPorNome?: string;
  atualizadoEm: string;
};

// ─── CONTA FIXA (cadastro mestre) ─────────────────────────────────────────

export type ContaFixaCategoria =
  | "encargos_impostos" | "alugueis" | "utilidades" | "pessoal_recorrente"
  | "coletas" | "sistemas_saas" | "seguros_saude" | "assessorias"
  | "associacoes_mensalidades" | "fornecedores_recorrentes"
  | "locacoes_equipamento" | "bancos_cartao" | "redes_sociais_marketing"
  | "outros";

export const CONTA_FIXA_CATEGORIA_LABEL: Record<ContaFixaCategoria, string> = {
  encargos_impostos:        "Encargos & Impostos",
  alugueis:                 "Aluguéis",
  utilidades:               "Utilidades (luz, água, gás, internet)",
  pessoal_recorrente:       "Pessoal recorrente",
  coletas:                  "Coletas (lixo, vidro, óleo)",
  sistemas_saas:            "Sistemas / SaaS",
  seguros_saude:            "Seguros & Saúde",
  assessorias:              "Assessorias / Consultorias",
  associacoes_mensalidades: "Associações & Mensalidades",
  fornecedores_recorrentes: "Fornecedores recorrentes",
  locacoes_equipamento:     "Locações de equipamento",
  bancos_cartao:            "Bancos & Cartão",
  redes_sociais_marketing:  "Redes Sociais / Marketing",
  outros:                   "Outros",
};

export type ContaFixaRecorrencia =
  | "mensal" | "semanal" | "anual" | "trimestral" | "semestral";

export const CONTA_FIXA_RECORRENCIA_LABEL: Record<ContaFixaRecorrencia, string> = {
  mensal:     "Mensal",
  semanal:    "Semanal",
  anual:      "Anual",
  trimestral: "Trimestral",
  semestral:  "Semestral",
};

export type ContaFixa = {
  id: string;
  nome: string;
  fornecedor?: string;
  categoria: ContaFixaCategoria;
  restaurantIds: string[];      // empresa(s) pagadora(s)
  enderecoId?: string;          // opcional — vincula a um endereço (útil p/ aluguel e consumo)
  valorEstimado?: number;
  pix?: string;
  banco?: string;
  titular?: string;
  observacoes?: string;
  recorrencia: ContaFixaRecorrencia;
  diaDoMes?: number;            // 1-31
  diaDaSemana?: number;         // 0-6
  mesDoAno?: number;            // 1-12
  // Baixa de pagamento por competência ("YYYY-MM") — usada na aba Visualização.
  pagamentos?: { [competencia: string]: { pagoEm: string; pagoPor: string } };
  // Ajuste pontual da data de vencimento em UM mês (arrasto no calendário).
  // Chave = competência "YYYY-MM"; valor = data efetiva "YYYY-MM-DD". Não muda
  // o cadastro (diaDoMes) nem os outros meses.
  ajustesData?: { [competencia: string]: string };
  diasAntecedencia: number;     // gera tarefa X dias antes (default 3)
  responsavelPadraoId: string;
  responsavelPadraoNome?: string;
  projetoId: string;            // onde tarefa aparece
  subprojetoId: string;
  ultimaGeracaoChave?: string;  // ex: "2026-06-15"
  ativo: boolean;
  deletadoEm?: string | null;
  deletadoPor?: string | null;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// ─── MANUTENÇÃO / LICENÇA (cadastro mestre) ───────────────────────────────

export type ManutencaoLaudo = {
  id: string;
  nome: string;
  driveId?: string;
  url?: string;                  // webViewLink do Drive
  enderecoId?: string;           // endereço a que o laudo se refere
  enviadoEm: string;             // ISO
  enviadoPor?: string | null;
};

export const MANUTENCAO_STATUS_LABEL: Record<"pendente" | "agendado" | "realizado", string> = {
  pendente: "Pendente", agendado: "Agendado", realizado: "Realizado",
};

export type ManutencaoTipo =
  | "filtros_agua" | "potabilidade_agua" | "caixa_dagua" | "gelo"
  | "dedetizacao" | "coifa" | "estofado" | "ar_condicionado" | "termometro"
  | "coleta_oleo" | "destinacao_residuos" | "clcb_bombeiros" | "cmvs_vigilancia"
  | "alvara_funcionamento" | "pgr" | "pcmso" | "certificado_digital"
  | "licenciamento_integrado" | "outro";

export const MANUTENCAO_TIPO_LABEL: Record<ManutencaoTipo, string> = {
  filtros_agua:            "Filtros de água",
  potabilidade_agua:       "Potabilidade da água",
  caixa_dagua:             "Limpeza de Caixa d'água",
  gelo:                    "Laudo de Potabilidade do Gelo",
  dedetizacao:             "Dedetização",
  coifa:                   "Limpeza da Coifa",
  estofado:                "Limpeza do Estofado",
  ar_condicionado:         "Manutenção de Ar Condicionado",
  termometro:              "Calibração de Termômetro",
  coleta_oleo:             "Coleta de Óleo",
  destinacao_residuos:     "Destinação de Resíduos",
  clcb_bombeiros:          "Licença CLCB (Bombeiros)",
  cmvs_vigilancia:         "Licença CMVS (Vigilância Sanitária)",
  alvara_funcionamento:    "Alvará de Funcionamento",
  pgr:                     "PGR — Programa de Gestão de Riscos",
  pcmso:                   "PCMSO — Programa de Controle Médico",
  certificado_digital:     "Certificado Digital",
  licenciamento_integrado: "Licenciamento Integrado",
  outro:                   "Outro",
};

export type ManutencaoPeriodicidade =
  | "45_dias" | "trimestral" | "semestral" | "anual"
  | "bianual" | "trianual" | "custom";

export const MANUTENCAO_PERIODICIDADE_DIAS: Record<ManutencaoPeriodicidade, number> = {
  "45_dias":   45,
  trimestral:  90,
  semestral:   180,
  anual:       365,
  bianual:     730,
  trianual:    1095,
  custom:      0,
};

export const MANUTENCAO_PERIODICIDADE_LABEL: Record<ManutencaoPeriodicidade, string> = {
  "45_dias":   "45 dias",
  trimestral:  "Trimestral (3 meses)",
  semestral:   "Semestral (6 meses)",
  anual:       "Anual",
  bianual:     "A cada 2 anos",
  trianual:    "A cada 3 anos",
  custom:      "Customizado",
};

export type Manutencao = {
  id: string;
  tipo: ManutencaoTipo;
  fornecedor?: string;
  descricao?: string;
  restaurantIds: string[];              // derivado dos endereços (scoping/compat)
  enderecoIds?: string[];               // N:N — 1 item pode cobrir vários endereços
  obrigatorio?: boolean;                // true = gera laudo / prazo rígido; false = flexível
  permiteLaudo?: boolean;               // só flexíveis: liga o botão de subir laudo (obrigatório sempre permite)
  // Apontamento do ciclo atual (aba Visualização):
  statusCiclo?: "pendente" | "agendado" | "realizado";
  agendadoPara?: string | null;         // YYYY-MM-DD quando statusCiclo = "agendado"
  laudoPrevisto?: string | null;        // previsão de receber o laudo (realizado sem laudo ainda) → monitorado na Central
  laudos?: ManutencaoLaudo[];           // anexos subidos ao Drive (endereço → tipo → arquivo)
  periodicidade: ManutencaoPeriodicidade;
  periodicidadeCustomDias?: number;
  proximoVencimento: string;    // YYYY-MM-DD
  ultimaExecucao?: string | null;
  diasAntecedencia: number;     // default 30
  responsavelPadraoId: string;
  responsavelPadraoNome?: string;
  projetoId: string;
  subprojetoId: string;
  pastaDrive?: string;
  observacoes?: string;
  ultimaGeracaoChave?: string;
  ativo: boolean;
  deletadoEm?: string | null;
  deletadoPor?: string | null;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// ────────────────────────────────────────────────────────────────────────────
//  PROCESSO DE DEMISSÃO — Fase 8
//
//  Modelo análogo ao de Admissão: kanban próprio com colunas, subtarefas
//  template, cadastro mestre 1 por processo. Cobre as 3 iniciativas:
//  empresa, empregado, acordo.
//
//  Bloqueio de acesso:
//    - Empregado/Acordo → ao criar processo
//    - Empresa → ao marcar subtarefa com ehBloqueioAcesso=true (Informar
//                demissão pro empregado), ou botão manual no detalhe
//
//  Cancelamento: reverte pessoa.ativa, exames desativados durante o
//  processo, tarefas vivas do empregado. Tudo guardado em backup pra
//  reversão atômica.
// ────────────────────────────────────────────────────────────────────────────

export type DemissaoIniciativa = "empresa" | "empregado" | "acordo";

export const DEMISSAO_INICIATIVA_LABEL: Record<DemissaoIniciativa, string> = {
  empresa:   "Empresa",
  empregado: "Empregado (pediu)",
  acordo:    "Acordo (negociado)",
};

export type DemissaoStatus =
  | "iniciado"                  // recém-criado
  | "previa_solicitada"          // contabilidade respondendo
  | "aguardando_decisao"         // prévia recebida, esperando decisão
  | "decidido_realizar"          // empresa decidiu prosseguir
  | "comunicado"                 // empregado oficialmente avisado (= bloqueio empresa)
  | "em_andamento"               // execução das subtarefas
  | "aviso_em_curso"             // aviso prévio trabalhado
  | "concluido"                  // tudo pronto, empregado demitido
  | "cancelado";                 // não vai realizar (só Empresa pré-decisão)

export const DEMISSAO_STATUS_LABEL: Record<DemissaoStatus, string> = {
  iniciado:             "Iniciado",
  previa_solicitada:    "Prévia solicitada",
  aguardando_decisao:   "Aguardando decisão",
  decidido_realizar:    "Decidido — realizar",
  comunicado:           "Empregado comunicado",
  em_andamento:         "Em andamento",
  aviso_em_curso:       "Aviso prévio em curso",
  concluido:            "Concluído",
  cancelado:            "Cancelado",
};

// Template de subtarefa do processo de demissão.
export type SubtarefaDemissaoTemplate = {
  id: string;
  nome: string;
  colunaId: string;             // FK em KanbanColunaDemissao
  checklistId: string;          // sub-agrupamento dentro da coluna
  checklistNome: string;
  obrigatoria: boolean;
  ordem: number;
  // Filtra por iniciativa: só aparece se iniciativa da demissão está aqui.
  // Vazio = aparece pra todas.
  iniciativaAplicavel?: DemissaoIniciativa[];
  // Flags especiais que disparam ações ao marcar
  ehBloqueioAcesso?: boolean;   // ao marcar, bloqueia pessoa.ativa = false
  ehDecisaoRealizar?: boolean;  // ao marcar, abre prompt sim/não; "não" cancela
  ehInativacaoFinal?: boolean;  // ao marcar, finaliza processo (empregado.estaAtivo=false)
  pedeLink?: boolean;           // input URL Drive (pra anexar rescisão, exame)
  pedeData?: boolean;           // input date
  atalho?:
    | { tipo: "contato_contabilidade" }
    | { tipo: "contato_clinica" }
    | { tipo: "whatsapp_empregado" };
};

export type SubtarefaDemissaoInstance = SubtarefaDemissaoTemplate & {
  feita: boolean;
  feitaEm?: string;
  feitaPor?: { id: string; nome: string };
  observacao?: string;
  link?: string;
  dataInformada?: string;
};

export type KanbanColunaDemissao = {
  id: string;
  nome: string;
  ordem: number;
  statusAuto?: DemissaoStatus | DemissaoStatus[];
  cor?: string;
};

export type ProcessoDemissao = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  empregadoNomeSnapshot: string;
  cargoSnapshot?: string;
  pessoaId?: string;            // pra reverter pessoa.ativa se cancelar

  iniciativa: DemissaoIniciativa;
  status: DemissaoStatus;
  kanbanColunaId?: string;

  // Auditoria de início
  iniciadoEm: string;
  iniciadoPor: { id: string; nome: string };
  motivoIniciacao?: string;     // ex: "Não renovação experiência", texto livre

  // Datas-chave
  dataAlvo?: string;            // YYYY-MM-DD (alvo da demissão)
  previaSolicitadaEm?: string;
  previaRecebidaEm?: string;
  valorPrevia?: number;
  decisaoRealizarEm?: string;
  decisaoRealizarPor?: { id: string; nome: string };
  comunicadoEmpregadoEm?: string;
  comunicadoEmpregadoPor?: { id: string; nome: string };
  acessoBloqueadoEm?: string;
  acessoBloqueadoPor?: { id: string; nome: string };

  // Aviso prévio
  avisoPrevio?: "trabalhado" | "indenizado";
  ultimoDiaTrabalhado?: string;

  // Anexos finais
  rescisaoAssinadaUrl?: string;
  examedemissionalUrl?: string;
  pastaDriveDesligadosUrl?: string;

  // Cancelamento
  canceladoEm?: string;
  canceladoPor?: { id: string; nome: string };
  motivoCancelamento?: string;

  // Conclusão
  concluidoEm?: string;
  concluidoPor?: { id: string; nome: string };

  // Backup pra reversão de cancelamento
  pessoaAtivaAnterior?: boolean;
  examesIdsDesativados?: string[];
  tarefasIdsCanceladas?: string[];

  // Subtarefas (snapshot do template no momento da criação)
  schemaUsado?: SubtarefaDemissaoTemplate[];
  subtarefas?: SubtarefaDemissaoInstance[];

  // Link com Tarefa-pai no Gestor (opcional — pra visualização integrada)
  tarefaPaiId?: string;

  createdAt: string;
  updatedAt: string;
};

// ────────────────────────────────────────────────────────────────────────────
//  EXAMES MÉDICOS — Fase 7
//
//  Modelo: 2 entidades.
//    ExameTipoConfig — catálogo de tipos por restaurante (Clínico, Complementar,
//                      Coprocultura, custom). Define periodicidade, antecedência
//                      de lembrete, responsável padrão, template do fluxo.
//    ExameEmpregado — instância: 1 por empregado × tipo. Guarda último ciclo
//                      + histórico de execuções.
//
//  Fluxo:
//    1. Admissão concluída → cria ExameEmpregado pra cada ExameTipoConfig
//       aplicável (Coprocultura só se cargo Cozinha/Bar).
//    2. Generator diário varre ExameEmpregado.proximoVencimento. Quando
//       hoje >= venc - antecedência, cria tarefa-pai com subtarefas template.
//    3. DP processa: agenda → informa empregado → confirma realização →
//       recebe resultado → anexa Drive → dá baixa.
//    4. Baixa: atualiza ultimaRealizacao = hoje, proximoVencimento = hoje +
//       periodicidade, append historico, fecha tarefa-pai. Próximo ciclo
//       fica agendado automaticamente.
//    5. Demissão concluída → marca exames como ativo:false, cancela tarefas vivas.
// ────────────────────────────────────────────────────────────────────────────

// Template de subtarefa do fluxo de exame. Cada item vira uma Subtarefa
// da tarefa-pai gerada. prazoOffset é resolvido pelo prazoOffset.ts.
export type ExameSubtarefaTemplate = {
  id: string;
  texto: string;
  prazoOffset?: string;             // ex: "D-14", "D-9", "D-7", "D+0"
  ehBaixa?: boolean;                // se true, ao marcar dispara trigger de baixa
  ehAnexoResultado?: boolean;       // se true, abre Drive Picker pra anexar arquivo
  ordem: number;
};

// Default usado quando admin cria um tipo novo sem customizar fluxo.
export const EXAME_SUBTAREFAS_TEMPLATE_DEFAULT: Omit<ExameSubtarefaTemplate, "id">[] = [
  { texto: "Agendar na clínica", prazoOffset: "D-14", ordem: 1 },
  { texto: "Informar empregado da data marcada", prazoOffset: "D-14", ordem: 2 },
  { texto: "Confirmar realização do exame", prazoOffset: "D-9", ordem: 3 },
  { texto: "Remarcar se não realizou (prazo extra)", prazoOffset: "D-7", ordem: 4 },
  { texto: "Receber resultado da clínica", prazoOffset: "D+0", ordem: 5 },
  { texto: "Anexar resultado na pasta do empregado", ehAnexoResultado: true, ordem: 6 },
  { texto: "Dar baixa (criar próximo ciclo)", ehBaixa: true, ordem: 7 },
];

// Catálogo de tipo de exame — POR RESTAURANTE. Permite customizar
// periodicidade, antecedência, áreas aplicáveis, e até criar tipos
// novos (Audiometria, etc).
export type ExameTipoConfig = {
  id: string;
  restaurantId: string;
  nome: string;                      // ex: "Exame Clínico", "Coprocultura"
  descricao?: string;
  periodicidadeDias: number;         // ex: 365 (anual), 180 (semestral)
  diasAntecedencia: number;          // dias antes do vencimento pra criar tarefa (default 14)
  fornecedorPadrao?: string;         // ex: "Triagem", "Almed"
  // Áreas pra quais o tipo se aplica. Vazio = todas (ex: Clínico vale pra
  // qualquer empregado). Preenchido = só empregados em cargos com essa
  // área. Ex: Coprocultura = ["Cozinha", "Bar"]. Audiometria = ["Cozinha"].
  // Ao mudar o cargo do empregado, sistema reavalia e desativa exames
  // cuja área não se aplica mais. (LEGADO — substituído por cargosObrigatorios.)
  areasAplicaveis: Area[];
  // Cargos pros quais este exame é OBRIGATÓRIO. Fonte de verdade nova (por cargo,
  // não por área). Vazio/ausente = todos os cargos CLT (registrado/estagiário),
  // ex: Exame Clínico anual. Preenchido = só esses cargos, ex: Coprocultura →
  // cargos de cozinha. Tem precedência sobre areasAplicaveis.
  cargosObrigatorios?: string[];
  responsavelPadraoId: string;       // pessoaId — default DP do rest
  responsavelPadraoNome?: string;    // snapshot
  subtarefasTemplate: ExameSubtarefaTemplate[];
  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// Item do histórico de execuções do exame.
export type ExameHistoricoItem = {
  id: string;
  realizadoEm: string;               // YYYY-MM-DD
  fornecedor?: string;
  anexoUrl?: string;                 // link Drive do PDF do resultado
  anexoNome?: string;
  observacao?: string;
  registradoEm: string;              // ISO timestamp
  registradoPor: string;             // pessoaId
  registradoPorNome?: string;
};

// Instância — 1 por empregado × tipo. Vive em /examesEmpregado/{id}.
export type ExameEmpregado = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  empregadoNomeSnapshot: string;     // pra UI mesmo se empregado for renomeado
  cargoSnapshot?: string;            // snapshot do cargo na criação
  tipoId: string;                    // ref a ExameTipoConfig
  tipoNomeSnapshot: string;          // snapshot
  periodicidadeDias: number;         // snapshot (não muda mesmo se tipo mudar)
  diasAntecedencia: number;          // snapshot
  fornecedor?: string;
  ultimaRealizacao?: string | null;  // YYYY-MM-DD
  proximoVencimento: string;         // YYYY-MM-DD — calculado: ultima + periodicidade
  historico: ExameHistoricoItem[];
  // Chave do último ciclo gerado como tarefa, pra idempotência.
  // Formato: "exm-{exameId}-{proximoVencimento}".
  ultimoCicloGerado?: string;
  ativo: boolean;                    // false = empregado demitido ou exame descontinuado
  desativadoEm?: string | null;
  desativadoPor?: string | null;
  desativadoMotivo?: string;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// Override do template de PDF do termo (por restaurante).
// Se não preenchido, usa o default global (template Sororoca).
export type TermoUniformesConfig = {
  id: string;                          // = restaurantId
  restaurantId: string;
  // Texto do termo de responsabilidade (rodapé do PDF). Separado uniforme/EPI
  // porque NR1/NR6 só aplica a EPI.
  textoLegalUniforme?: string;
  textoLegalEpi?: string;
  // Meta opcional do cabeçalho (ELAB / CÓD / REVISÃO no template Sororoca)
  codDoc?: string;
  revisao?: string;
  elaboradoEm?: string;                // texto livre tipo "Junho/2025"
  atualizadoEm: string;
  atualizadoPor: string;
};

// ─── Ferramentas e Credenciais ──────────────────────────────────────────────
// Catálogo de acessos a sistemas externos (iFood, Lalamove, BEES etc).
// Princípio: NÃO armazena senha — só metadado + link pro Bitwarden.
// Permissão é granular: usuário vê uma ferramenta só se estiver em
// `usuariosAutorizados`. Master vê tudo.

export type FerramentaMetodoAcesso =
  | "login_proprio"        // cada um tem o próprio login (sem cofre)
  | "senha_compartilhada"  // login único compartilhado (link Bitwarden)
  | "senha_oculta"         // compartilhada com autofill sem revelar (link Bitwarden)
  | "fisico"               // cadeado, chave, combinação (mostra local)
  | "restrito"             // só master — fala com responsável
  | "delegado_sso"         // SSO/federated (sem senha)
  | "dormente";            // conta sem uso (visível só pra master)

export type FerramentaCategoria =
  | "delivery"
  | "fornecedores"
  | "operacao"
  | "financeiro"
  | "rh"
  | "infra"
  | "identidade"
  | "restrito";

export const FERRAMENTA_CATEGORIA_LABEL: Record<FerramentaCategoria, string> = {
  delivery:      "Delivery & entregas",
  fornecedores:  "Fornecedores",
  operacao:      "Operação da casa",
  financeiro:    "Financeiro",
  rh:            "RH / Pessoas",
  infra:         "Infraestrutura",
  identidade:    "Identidade / SSO",
  restrito:      "Acesso restrito",
};

export const FERRAMENTA_METODO_LABEL: Record<FerramentaMetodoAcesso, string> = {
  login_proprio:        "Login próprio",
  senha_compartilhada:  "Compartilhada",
  senha_oculta:         "Senha oculta",
  fisico:               "Físico",
  restrito:             "Restrito",
  delegado_sso:         "SSO",
  dormente:             "Dormente",
};

export type Tool = {
  id: string;
  restaurantId: string;
  nome: string;
  icone: string;                       // nome do ícone Tabler sem prefixo (ex: "motorbike")
  necessidade: string;                 // "pra que serve" em 1 linha
  tags: string[];                      // palavras-chave pra busca
  categoria: FerramentaCategoria;
  metodoAcesso: FerramentaMetodoAcesso;
  // Granularidade de permissão por usuário. Só quem tá no array vê a tool.
  // Master vê tudo independente disso.
  usuariosAutorizados: string[];
  // Dados específicos por método (todos opcionais — front renderiza só o
  // que faz sentido pro método)
  bitwardenItemUrl?: string | null;    // senha_compartilhada / senha_oculta
  bitwardenCollection?: string | null; // referência humana
  localFisico?: string | null;         // metodoAcesso = fisico
  instrucoesAcesso?: string | null;    // login_proprio: como solicitar
  responsavel?: string | null;         // pessoaId — pra metodoAcesso = restrito
  status: "ativo" | "dormente";
  criadoEm: string;                    // ISO
  criadoPor: string;                   // pessoaId
  atualizadoEm?: string;
  atualizadoPor?: string;
};

// ════════════════════════════════════════════════════════════════════════════
//  CHAT — comunicação unificada (interno + WhatsApp externo)
//
//  Visão geral:
//   - /conversations         — uma conversa por "thread"
//   - /chatMessages          — top-level (não subcoleção). Indexed por
//                              conversationId. Mais simples pras rules atuais
//                              e alinha com o pattern do resto do projeto.
//   - /contatosExternos      — contatos fora do quadro (banco, contador,
//                              fornecedor). Têm número WhatsApp + opt-in.
//   - /linhasWhatsapp        — número de WhatsApp configurado (DP, FIN,
//                              Compras, ou 1 por restaurante). Define quem
//                              opera e quais categorias de externos recebe.
//
//  Canal:
//   - "in_app"       — só dentro do planejamento.app (chat interno)
//   - "whatsapp"     — vai/vem do WhatsApp via gateway (Evolution/UAZAPI/...)
//   - "email"        — futuro (alertas + caixa controlada)
//   - "sistema"      — mensagem automática (notificação de tarefa, etc)
//
//  Em C1 só schema + rules. UI vem em C2, admin de linhas em C3, integração
//  com gateway em C4, migração Comunicados/Fale com DP em C5.
// ════════════════════════════════════════════════════════════════════════════

export type ChatCanal = "in_app" | "whatsapp" | "email" | "sistema";

export const CHAT_CANAL_LABEL: Record<ChatCanal, string> = {
  in_app:   "Chat interno",
  whatsapp: "WhatsApp",
  email:    "E-mail",
  sistema:  "Sistema",
};

// Tipo da conversa — define UX e regras de exibição.
export type ConversationTipo =
  | "direta"          // 1-pra-1 entre 2 pessoas internas
  | "grupo"           // múltiplas pessoas internas
  | "externa"         // interno ↔ contato externo (geralmente via WhatsApp)
  | "broadcast"       // 1-pra-N (substitui Comunicados em C5)
  | "dp_anonimo"      // Fale com DP, autor opcionalmente anônimo (C5)
  | "sistema_pessoa"; // alertas automáticos do sistema pra uma pessoa

export const CONVERSATION_TIPO_LABEL: Record<ConversationTipo, string> = {
  direta:         "Direta",
  grupo:          "Grupo",
  externa:        "Externa (WhatsApp)",
  broadcast:      "Comunicado",
  dp_anonimo:     "Fale com DP",
  sistema_pessoa: "Sistema",
};

// Categoria do contato externo — usada pra filtrar quais externos cada
// linha WhatsApp aceita receber/enviar.
export type ContatoChatCategoria =
  | "contabilidade"
  | "fornecedor"
  | "banco"
  | "advogado"
  | "manutencao"
  | "orgao_publico"
  | "outro";

export const CONTATO_CHAT_CATEGORIA_LABEL: Record<ContatoChatCategoria, string> = {
  contabilidade: "Contabilidade",
  fornecedor:    "Fornecedor",
  banco:         "Banco",
  advogado:      "Advogado",
  manutencao:    "Manutenção / técnico",
  orgao_publico: "Órgão público",
  outro:         "Outro",
};

// Status de uma mensagem WhatsApp (espelho do que o gateway reporta).
export type ChatWhatsappStatus =
  | "pending"    // ainda não saiu do nosso lado
  | "sent"       // gateway recebeu, mandou pra Meta
  | "delivered"  // chegou no aparelho do destinatário
  | "read"       // lido (✓✓ azul)
  | "failed";    // erro no envio

export const CHAT_WHATSAPP_STATUS_LABEL: Record<ChatWhatsappStatus, string> = {
  pending:   "Enviando…",
  sent:      "Enviada",
  delivered: "Entregue",
  read:      "Lida",
  failed:    "Falhou",
};

// Origem do device que enviou (só faz sentido pra canal whatsapp).
// "celular" = enviada do celular físico, "web" = do WhatsApp Web,
// "sistema" = enviada pelo planejamento.app (via gateway).
export type ChatWhatsappOrigem = "celular" | "web" | "sistema" | "desconhecido";

// ── Conversation ──────────────────────────────────────────────────────────
export type Conversation = {
  id: string;
  // null = transversal (DP, FIN, Compras não pertencem a 1 restaurante)
  restaurantId: string | null;
  // null = puramente interna. Senão, id da linha WhatsApp atrelada
  // (ex: "dp", "fin", "compras", "rest_<rid>")
  linhaId: string | null;
  tipo: ConversationTipo;
  titulo?: string;            // pra grupos / broadcasts (em diretas vem do
                              // nome do outro participante)
  // Pessoas internas (pessoaId). Pode ter operadores da linha + dialogantes.
  participantes: string[];
  // Snapshot pra exibir nomes sem N reads. Atualizado quando muda lista.
  participantesNomes?: { [pessoaId: string]: string };
  // Contatos externos (contatoExternoId). Em conversa "externa" geralmente é 1.
  participantesExternos?: string[];
  // Quais canais podem ser usados nessa conversa. Em "direta" interna
  // geralmente só ["in_app"]; em "externa" geralmente ["whatsapp"];
  // em conversa unificada, ambos.
  canaisAtivos: ChatCanal[];
  // Operadores da linha — denormalizado pra rules futuras saberem quem
  // pode ler sem precisar buscar /linhasWhatsapp. Atualiza junto.
  operadoresDaLinha?: string[];

  // Origem (se foi gerada por outro módulo)
  origemModulo?: "comunicados" | "fale_com_dp" | "tarefas" | "sistema" | "manual";
  origemRefId?: string;

  // Last-message snapshot pra lista lateral sem buscar /chatMessages.
  ultimaMensagem?: {
    texto: string;        // truncado em ~120 chars
    autorId: string;
    autorNome: string;
    em: string;           // ISO
    canal: ChatCanal;
  };

  // Contador de não-lidas por pessoa. Reset quando ela abre a conversa.
  naoLidoPor?: { [pessoaId: string]: number };

  // Anonimato (Fale com DP). Quando true, autor não é mostrado pros
  // operadores DP — só pra master e pra própria pessoa.
  flagAnonimo?: boolean;

  // ── WhatsApp ──
  // Janela 24h Meta (só faz sentido se gateway = Cloud API). Em Evolution/
  // UAZAPI ignora — mensagem livre sempre permitida.
  whatsappJanelaAbertaAte?: string | null;
  // Número E.164 do contato externo (cache pra envio rápido).
  whatsappContatoNumero?: string;

  arquivado?: boolean;
  criadoEm: string;
  criadoPor: string;          // pessoaId ou "sistema"
  atualizadoEm: string;
};

// ── ChatMessage ───────────────────────────────────────────────────────────
export type ChatMessage = {
  id: string;
  conversationId: string;
  restaurantId: string | null;

  // Quem mandou. "pessoa" = pessoaId, "externo" = contatoExternoId,
  // "sistema" = id "sistema".
  autorTipo: "pessoa" | "externo" | "sistema";
  autorId: string;
  autorNome: string;            // snapshot pra render sem joins

  texto: string;
  // Anexos (Drive Picker em C4+). Em C2 só texto.
  anexos?: ChatMessageAnexo[];

  canal: ChatCanal;
  // Em WhatsApp, direção da mensagem (recebida = do contato pro app,
  // enviada = do app pro contato).
  direcao?: "enviada" | "recebida";

  // ── WhatsApp specifics ──
  whatsappMessageId?: string;   // wamid (Meta) ou id interno do gateway
  whatsappStatus?: ChatWhatsappStatus;
  whatsappStatusEm?: string;
  whatsappOrigem?: ChatWhatsappOrigem;  // celular/web/sistema
  whatsappTemplateUsado?: string;       // só Cloud API (nome do template)

  // Lidas por quem (pessoa). Não-presença = não-lido.
  lidoPor?: { [pessoaId: string]: string };  // pessoaId → ISO

  enviadoEm: string;
  editadoEm?: string | null;
  removidoEm?: string | null;   // soft delete
  removidoPor?: string;
};

export type ChatMessageAnexo = {
  nome: string;
  url: string;                  // Drive URL ou storage URL
  tipo: "image" | "video" | "audio" | "document" | "outro";
  tamanho?: number;             // bytes (se conhecido)
  thumbnail?: string;
};

// ── ContatoChat ──────────────────────────────────────────────────────────
// Renomeado de `ContatoExterno` (que já existia no módulo Demissão como
// stakeholder de clínica/contabilidade) pra evitar colisão de nomes.
export type ContatoChat = {
  id: string;
  // null = global (atende todos os restaurantes). Senão é exclusivo do rid.
  restaurantId: string | null;

  nome: string;
  empresa?: string;
  numeroWhatsapp: string;       // E.164 sem "+" (ex: "5511999999999")
  email?: string | null;
  categoria: ContatoChatCategoria;
  notas?: string;

  // ── Opt-in WhatsApp (LGPD + Meta) ──
  // Marca o consentimento explícito pra receber mensagens. Sem isto
  // preenchido, /api/wa-send se recusa a enviar.
  optInWhatsappEm?: string | null;
  optInWhatsappFonte?: string | null;   // ex: "Contrato § 7 — drive://..."
  // Revogação. Quando setado, bloqueia envios mesmo com optInWhatsappEm.
  optOutWhatsappEm?: string | null;

  // Linhas onde esse contato é aceito (ids de /linhasWhatsapp).
  ativosNasLinhas: string[];

  ativo: boolean;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm?: string;
  atualizadoPor?: string;
};

// ── LinhaWhatsapp ─────────────────────────────────────────────────────────
// Configura cada número WhatsApp do app. Plano inicial:
//   - 3 transversais: "dp", "fin", "compras"
//   - 3 por restaurante: "rest_<rid>" (1 por casa)
export type LinhaWhatsapp = {
  id: string;
  // null = transversal (DP, FIN, Compras). Senão, "rest_<rid>".
  restaurantId: string | null;
  label: string;                // "DP", "Financeiro", "Compras", "Lobozó"
  icone: string;                // emoji
  numeroWhatsapp: string;       // E.164 sem "+"
  descricao?: string;

  // ── Gateway (preenchido em C4) ──
  // Tipo do gateway que opera essa linha. Plugável — adapter decide
  // como envia / recebe.
  gateway?: "evolution" | "uazapi" | "zapi" | "cloud_api" | "manual";
  gatewayInstanceId?: string;   // id da instância no gateway
  gatewayStatus?: "conectado" | "desconectado" | "qr_pendente" | "erro";
  gatewayStatusEm?: string;

  // ── Operação ──
  // Pessoas que podem ATENDER/RESPONDER nessa linha (admin + operadores).
  operadores: string[];         // pessoaIds
  // Master sempre vê — não precisa estar listado aqui.

  // Categorias de ContatoExterno que essa linha aceita.
  // Ex: linha "fin" aceita ["banco", "contabilidade", "fornecedor"];
  //     linha "dp" aceita ["contabilidade", "orgao_publico"].
  categoriasExternasAceitas: ContatoChatCategoria[];

  // Recebe/envia pra empregados (pessoas internas)?
  aceitaEmpregados: boolean;

  // ── Cloud API only ──
  // Templates aprovados pela Meta (cache local pra UI). Atualiza
  // periodicamente do gateway. Ignorado em Evolution/UAZAPI.
  templatesAprovados?: ChatWhatsappTemplate[];

  ativa: boolean;
  criadoEm: string;
  criadoPor: string;
  atualizadoEm?: string;
  atualizadoPor?: string;
};

// Template Cloud API — só preenchido quando gateway = "cloud_api".
export type ChatWhatsappTemplate = {
  nome: string;
  categoria: "utility" | "marketing" | "authentication";
  idioma: string;               // "pt_BR"
  body: string;                 // com placeholders {{1}}, {{2}}, etc
  status: "approved" | "pending" | "rejected";
  atualizadoEm: string;
};

// ── Helpers de exibição ───────────────────────────────────────────────────

/**
 * Decide se a conversa precisa ser tratada como "WhatsApp ativa" (tem
 * canal whatsapp na lista de canaisAtivos).
 */
export function isConversaWhatsapp(c: Pick<Conversation, "canaisAtivos">): boolean {
  return Array.isArray(c.canaisAtivos) && c.canaisAtivos.includes("whatsapp");
}

/**
 * Pessoa pode ver essa conversa? Lógica client-side (rules são auth-only
 * por enquanto — Fase futura aperta). Master vê tudo.
 */
export function podeVerConversa(
  c: Pick<Conversation, "participantes" | "operadoresDaLinha" | "tipo" | "flagAnonimo">,
  pessoaId: string,
  isMaster: boolean,
): boolean {
  if (isMaster) return true;
  if (c.participantes?.includes(pessoaId)) return true;
  if (c.operadoresDaLinha?.includes(pessoaId)) return true;
  // Broadcasts: qualquer pessoa ativa lê (filtro em UI). Mas defensivo aqui
  // só libera quem é participante (campo deve listar todo o público alvo).
  return false;
}

// ─── Recebimento de produtos (conferência de notas fiscais) ──────────────────
// Cada nota recebida vira um doc em `recebimentos`. O arquivo da nota (foto/PDF)
// e a foto de divergência sobem pro Drive, na subpasta da semana do recebimento.
export type ItemNota = {
  descricao?: string;
  quantidade?: number;
  unidade?: string;
  valorUnitario?: number;
  valorTotal?: number;
};
export type DuplicataNota = {
  numero?: string;
  valor?: number;
  vencimento?: string;                // YYYY-MM-DD
};
export type BoletoNota = {
  driveFileId: string;
  driveUrl?: string;
  nome: string;
};

// ─── Fechamento de Caixa ─────────────────────────────────────────────────────
export type TurnoCaixa = "almoco" | "jantar" | "dia";
export const TURNO_CAIXA_LABEL: Record<TurnoCaixa, string> = { almoco: "Almoço", jantar: "Jantar", dia: "Dia todo" };
// Grupos de anexo do fechamento (organização/rótulo).
export type GrupoAnexoFechamento = "comprovante" | "filipeta" | "comanda" | "dinheiro" | "outro";
export const GRUPO_ANEXO_LABEL: Record<GrupoAnexoFechamento, string> = {
  comprovante: "Comprovante + filipetas (IA lê os valores)",
  filipeta: "Filipetas das maquininhas",
  comanda: "Comandas (sócios / cortesia)",
  dinheiro: "Foto do dinheiro",
  outro: "Outros",
};
export type AnexoFechamento = {
  driveFileId: string;
  driveUrl?: string;
  nome: string;
  grupo: GrupoAnexoFechamento;
  rotulo?: string;              // p/ comandas: "Fulano (12)", "Cortesia (99)"…
};
// Comanda cadastrável (sócio, cortesia, perdas, treinamento…). nome = finalidade.
export type ComandaCadastro = { numero: string; nome: string };
// Quebra por maquininha lida do fechamento (OCR).
export type MaquininhaFechamento = { identificador?: string; credito?: number; debito?: number; pix?: number; total?: number };
// Consumo de uma comanda (sócio/cortesia) no turno.
export type ComandaConsumo = { numero: string; nome?: string; valor?: number };
export type FechamentoCaixa = {
  id: string;
  restaurantId: string;
  data: string;                 // YYYY-MM-DD do turno
  turno: TurnoCaixa;
  fechadoEm: string;            // ISO — quando foi registrado
  fechadoPor: { id: string; nome: string };
  totalVendas?: number;
  dinheiro?: number;
  pix?: number;
  credito?: number;
  debito?: number;
  maquininhas?: MaquininhaFechamento[];
  comandas?: ComandaConsumo[];  // consumos de cortesia/sócios do turno
  fundoCaixa?: number;
  numeroLacre?: string;         // nº do lacre do malote
  observacao?: string;
  // Percepção do turno (quando fechamentoPedirObsTurno): direção do movimento
  // vs. mediana do mesmo dia-da-semana/turno, e "sem ocorrência".
  movimentoTurno?: "abaixo" | "normal" | "acima";
  semOcorrencia?: boolean;
  anexos?: AnexoFechamento[];
  driveFolderUrl?: string;      // pasta do turno no Drive
  emailEnviadoPara?: string[];  // emails dos sócios notificados
  conferidoEm?: string;         // ISO — conferido pelo escritório (vai pro histórico de Conferidos, nunca apaga)
  conferidoPor?: { id: string; nome: string };
  excluidoEm?: string;          // ISO — soft delete (vai pra "Excluídos"; some sozinho em 60 dias)
  excluidoPor?: { id: string; nome: string };
};
export type TipoDocumento = "nota_fiscal" | "cupom_fiscal" | "conta_fixa" | "romaneio";
export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumento, string> = {
  nota_fiscal: "DANFE",
  cupom_fiscal: "Cupom fiscal",
  conta_fixa: "Conta fixa",
  romaneio: "Romaneio",
};
// Categorias sugeridas pra conta fixa (campo livre aceita outras).
export const CONTA_FIXA_CATEGORIAS = ["Água", "Luz", "Telefone", "Internet", "Gás", "Aluguel", "Outro"];
export type FormaPagamento = "boleto" | "cartao" | "dinheiro" | "pix";
export const FORMA_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  boleto: "Boleto",
  cartao: "Cartão de crédito",
  dinheiro: "Dinheiro",
  pix: "PIX",
};
export type RecebimentoNota = {
  id: string;
  restaurantId: string;
  recebidoEm: string;                 // ISO — data/hora do recebimento (chave de ordenação)
  recebidoPor: { id: string; nome: string };
  // Dados da nota (pré-preenchidos por OCR, confirmados pelo usuário)
  emissor?: string;
  cnpjEmissor?: string;
  numeroNota?: string;
  serieNota?: string;
  chaveAcesso?: string;               // 44 dígitos (NFe)
  valorProdutos?: number;             // subtotal dos produtos (antes de frete/desconto)
  valorTotal?: number;                // R$ — total da nota
  valorImpostos?: number;             // total de tributos
  dataEmissao?: string;               // YYYY-MM-DD
  itens?: ItemNota[];                 // produtos da nota
  duplicatas?: DuplicataNota[];       // faturas/parcelas (valor + vencimento)
  tipoDocumento?: TipoDocumento;      // nota fiscal | cupom fiscal | conta fixa
  contaCategoria?: string;            // quando conta fixa: água, luz, telefone…
  formaPagamento?: FormaPagamento;    // opcional — boleto auto ao anexar boleto
  // Conformidade
  conforme: boolean;                  // true = recebido tudo nos conformes
  divergencia?: string;               // descrição, quando !conforme
  // Arquivos no Drive
  notaDriveFileId?: string;           // 1ª página (retrocompat / link rápido)
  notaDriveUrl?: string;
  notaNome?: string;
  notaPaginas?: BoletoNota[];         // todas as páginas da nota (1+), arquivadas no Drive
  // Romaneio → DANFE: o fornecedor entrega com romaneio e manda a nota fiscal depois.
  // Ao incluir a DANFE, o tipo vira nota_fiscal/cupom_fiscal, as páginas da DANFE viram
  // `notaPaginas` e o romaneio original é preservado aqui pra auditoria.
  romaneioPaginas?: BoletoNota[];     // páginas do romaneio original (preservadas na conversão)
  romaneioConvertidoEm?: string;      // ISO — quando a DANFE foi incluída sobre o romaneio
  romaneioConvertidoPor?: { id: string; nome: string };
  fotoDivergenciaDriveFileId?: string;
  fotoDivergenciaUrl?: string;
  boletos?: BoletoNota[];             // boletos anexados (arquivados no Drive)
  comprovantes?: BoletoNota[];        // comprovantes de pagamento (ex: cartão) no Drive
  semanaLabel?: string;               // "dd.mm.aa a dd.mm.aa" (nome da subpasta)
  conferidoEm?: string;               // ISO — conferido pelo escritório (histórico de Conferidos, nunca apaga)
  conferidoPor?: { id: string; nome: string };
  excluidoEm?: string;                // ISO — soft delete (vai pra "Excluídos"; some sozinho em 60 dias)
  excluidoPor?: { id: string; nome: string };
};

// ═══════════════════════════════════════════════════════════════════════════
//  VENDAS — registro de vendas fora do sistema fiscal principal das empresas.
//  Casos de uso: vendas entre as próprias empresas (sem nota), permutas que se
//  quitam entre si, e vendas sem margem que só precisam de registro.
//  "Empresa" = restaurante. Cliente pode ser interno (outra empresa do sistema)
//  ou externo. Cadastros: produtos e clientes POR EMPRESA; formas de pagamento
//  GLOBAIS.
// ═══════════════════════════════════════════════════════════════════════════

export type VendaProduto = {
  id: string;
  restaurantId: string;                // por empresa
  nome: string;
  precoPadrao?: number | null;
  unidade?: string | null;             // "un", "kg", "cx"...
  ativo: boolean;
};

export type VendaClienteTipo = "interna" | "externa";
export type VendaCliente = {
  id: string;
  restaurantId: string;                // empresa que cadastrou
  nome: string;
  tipo: VendaClienteTipo;
  restauranteVinculadoId?: string | null; // se interna → id do outro restaurante
  whatsapp?: string | null;
  contato?: string | null;
  ativo: boolean;
};

export type VendaFormaPagamento = {
  id: string;
  nome: string;                        // GLOBAL (sem restaurantId)
  ativo: boolean;
};

export type VendaItem = {
  produtoId?: string | null;           // null = linha livre
  descricao: string;
  qtd: number;
  precoUnit: number;
  total: number;
};

export type VendaPagamentoTipo = "forma" | "permuta";
export type VendaPagamento = {
  id: string;
  tipo: VendaPagamentoTipo;
  valor: number;
  data: string;                        // YYYY-MM-DD
  // tipo "forma":
  formaId?: string | null;
  formaNome?: string | null;
  comprovanteUrl?: string | null;
  comprovanteNome?: string | null;
  infoRecebimento?: string | null;     // texto livre ("PIX recebido", etc)
  // tipo "permuta":
  permutaVendaId?: string | null;      // interna: id da venda recíproca quitada
  permutaVendaNumero?: string | null;
  permutaEmpresaNome?: string | null;
  permutaDescricao?: string | null;    // externa: texto livre identificando a compra
  registradoPor?: string;
  registradoPorNome?: string;
  registradoEm: string;                // ISO
};

export type VendaStatus = "aberta" | "cobranca_enviada" | "quitada";
export const VENDA_STATUS_LABEL: Record<VendaStatus, string> = {
  aberta: "Aberta",
  cobranca_enviada: "Cobrança enviada",
  quitada: "Quitada",
};

export type Venda = {
  id: string;
  restaurantId: string;                // empresa vendedora
  numero: string;                      // "VENDA-2026-001"
  data: string;                        // YYYY-MM-DD
  clienteId: string;
  clienteNomeSnapshot: string;
  clienteTipo: VendaClienteTipo;
  clienteWhatsappSnapshot?: string | null;
  clienteRestauranteVinculadoId?: string | null; // se interna
  itens: VendaItem[];
  valorTotal: number;
  status: VendaStatus;
  pagamentos: VendaPagamento[];
  valorPago: number;
  saldo: number;
  cobrancaId?: string | null;
  observacoes?: string | null;
  criadoEm: string;
  criadoPor?: string;
  criadoPorNome?: string;
  quitadoEm?: string | null;
};

export type VendaCobranca = {
  id: string;
  restaurantId: string;
  numero: string;                      // "COB-2026-001"
  clienteId: string;
  clienteNomeSnapshot: string;
  vendaIds: string[];
  valorTotal: number;
  criadoEm: string;
  criadoPor?: string;
  criadoPorNome?: string;
};

// ═══════════════════════════════════════════════════════════════════════════
//  FICHAS TÉCNICAS — produção (escalar por rendimento, custo em tempo real).
//  Base portada do AppMise, melhorada: unidade com DIMENSÃO (massa/volume/
//  unidade), dedup de insumo, subproduto (ficha que vira ingrediente de outra).
//  Escopo POR EMPRESA (restaurantId). Fase 1: Insumos + Fichas + custo.
// ═══════════════════════════════════════════════════════════════════════════

export type FtDimensao = "massa" | "volume" | "unidade";

export type FtHistoricoCusto = {
  custo: number; data: string; por?: string | null;
  origem?: "manual" | "recebimento";  // de onde veio o preço
  fornecedor?: string | null;          // emissor da nota (quando recebimento)
  notaId?: string | null;              // id do RecebimentoNota
  notaNumero?: string | null;          // nº da NF, pra referência
};

// Vínculo entre um produto de nota (descrição livre) e um insumo, com o fator de
// conversão pra unidade base. É POR FORNECEDOR: nova marca/fornecedor re-confirma
// (a embalagem — cx, fardo — muda de fornecedor pra fornecedor).
export type FtVinculoRecebimento = {
  id: string;
  restaurantId: string;
  insumoId: string | null;             // null + ignorar=true → "não é insumo"
  descricaoNorm: string;               // descricao da NF normalizada (chave de match)
  descricaoExemplo: string;            // descricao crua, pra exibir
  unidadeNota: string;                 // unidade como veio na NF ("cx","kg","fardo"…)
  fornecedor?: string | null;          // emissor; o fator vale por fornecedor
  fatorParaBase: number;               // unidades-base do insumo por 1 unidade-da-nota (custoBase = valorUnitario / fator)
  ignorar?: boolean;                   // marcado como "não é insumo" → some da varredura
  aprovado: boolean;                   // confirmado manualmente
  criadoEm: string;
  criadoPor?: string | null;
};

// Variação de um insumo com fator de correção (rendimento). `fc` é o % de
// APROVEITAMENTO em relação ao insumo inteiro (100 = inteiro, 92 = descascada,
// 85 = brunoise). Custo da variação = custo base × (100 / fc) — perda de limpeza.
export type FtInsumoVariacao = { id: string; nome: string; fc: number };

export type FtInsumo = {
  id: string;
  restaurantId: string;
  nome: string;
  nomeNormalizado: string;             // pra dedup/busca
  dimensao: FtDimensao;                // fixada pela unidadeBase
  unidadeBase: string;                 // "kg" | "g" | "L" | "ml" | "un" ...
  custo: number;                       // R$ por unidadeBase (do insumo INTEIRO)
  custoAtualizadoEm?: string | null;   // ISO
  historicoCusto?: FtHistoricoCusto[];
  fornecedorPadrao?: string | null;
  reutilizavel?: boolean;              // ex: óleo de fritura — não pesa custo cheio
  categoriaId?: string | null;         // categoria do insumo (hortifrúti, carnes…)
  variacoes?: FtInsumoVariacao[];      // cebola descascada, brunoise, julienne...
  aliases?: string[];
  ehSubproduto?: boolean;              // não é comprado — sai de um preparo (ex.: carcaça)
  subprodutoDe?: { fichaId: string; subId: string } | null; // vínculo: custo deriva do rateio do preparo
  ativo: boolean;
};

// Categoria criada pelo usuário. Escopo por GRUPO: "ficha" = fichas finais
// (divisão do cardápio, pro CMV) · "subficha" = bases (molhos, caldos…).
// Legado sem tipo é tratado como "ficha".
// Plano de produção em lote: várias fichas + quanto de cada, com responsável e
// dia. Gera a lista consolidada de insumos (compras) e o que produzir.
export type FtPlanoItem = {
  id: string; fichaId: string; qtd: number; responsavel?: string | null;
  responsavelId?: string | null;       // pessoa (produtor) responsável — pra tela do responsável no futuro
  rendimentoReal?: number | null;      // quanto REALMENTE saiu (custo real = custo do lote ÷ real)
  validadeDias?: number | null;        // shelf-life pra etiqueta (Fase 4)
  produzidoEm?: string | null;         // ISO — quando a pessoa marcou "produzi" (deriva no Plano de Ação)
  produzidoPorId?: string | null;      // pessoa que marcou como produzido
  produzidoPorNome?: string | null;
};

// Config do módulo Fichas Técnicas por restaurante (equipe de produção etc).
export type FtConfig = {
  id: string;                          // = restaurantId
  restaurantId: string;
  produtoresIds?: string[];            // pessoas que podem ser responsáveis por produção
};
export type FtPlanoProducao = {
  id: string;
  restaurantId: string;
  nome: string;
  data: string;                        // dia de produção (ISO yyyy-mm-dd)
  status: "rascunho" | "planejado" | "concluido";
  itens: FtPlanoItem[];
  obs?: string | null;
  ativo: boolean;
  concluidoEm?: string | null;         // ISO de quando foi marcado como produzido
  criadoEm: string;
  criadoPor?: string;
  criadoPorNome?: string;
};

export type FtCategoriaTipo = "ficha" | "subficha" | "insumo";
export type FtCategoria = {
  id: string;
  restaurantId: string;
  nome: string;
  tipo?: FtCategoriaTipo;
  ordem?: number;
  cmvAlvo?: number | null;   // % de CMV alvo da categoria (só fichas finais)
  ativo: boolean;
};

// Um ingrediente pode ser um INSUMO, uma SUBFICHA (outra receita reutilizável)
// ou um SUBPRODUTO (coproduto gerado por outro preparo — ex.: carcaça do frango
// assado, caldo do cozimento). Subproduto carrega parte do custo do preparo-pai.
export type FtIngredienteTipo = "insumo" | "ficha" | "subproduto";
export type FtIngrediente = {
  id: string;
  tipo: FtIngredienteTipo;
  refId: string;                       // insumoId | fichaId (subficha) | fichaId-pai (subproduto)
  subId?: string;                      // id do subproduto dentro da ficha-pai (tipo "subproduto")
  nomeSnapshot?: string;
  qtd: number;
  unidade: string;
  qb?: boolean;                        // quanto baste — não entra no custo/peso
  variacaoNome?: string | null;        // nome da variação escolhida (ex: "descascada")
  fc?: number;                         // % de aproveitamento da variação (100 = inteiro)
};

// Subproduto/coproduto de um preparo: além da saída principal, o preparo rende
// isto. Recebe `percentualCusto` do custo total do preparo (o principal fica com
// 100 − Σ dos subprodutos). Referenciável como ingrediente em outras fichas.
export type FtSubproduto = {
  id: string;
  nome: string;
  nomeNormalizado: string;
  unidade: string;
  rendimentoQtd: number;               // quanto o preparo rende deste subproduto
  percentualCusto: number;             // 0–100 do custo total do preparo
};

// Receita: uma FICHA (produto final, vai pro cardápio) OU uma SUBFICHA (preparo
// reutilizável que entra como ingrediente de outras). `ehSubficha` diferencia.
// Composição = lista PLANA de ingredientes (insumos e/ou subfichas), com
// aninhamento recursivo.
export type FtFicha = {
  id: string;
  restaurantId: string;
  nome: string;
  nomeNormalizado: string;
  ehSubficha: boolean;                 // true = componente reutilizável
  categoriaId?: string | null;
  rendimento: { qtd: number; unidade: string };
  producaoPadrao?: number | null;      // prato final: qtd de porções que a ficha de PRODUÇÃO abre por padrão
  foraDoCardapio?: boolean;            // prato final inativo no cardápio (não aparece na Visualização)
  cardapioItemId?: string | null;      // prato final: vínculo ao item do cardápio (preço de venda ao vivo)
  precoVendaManual?: number | null;    // preço de venda manual (quando não vinculado ao cardápio)
  ingredientes: FtIngrediente[];
  subprodutos?: FtSubproduto[];        // coprodutos gerados por este preparo
  modoPreparo?: string | null;
  fotoUrl?: string | null;
  observacoes?: string | null;
  markupAlvo?: number | null;
  cmvAlvo?: number | null;             // % alvo de CMV (só ficha final)
  revisar?: boolean;                   // marcada como "precisa revisão"
  revisarMotivo?: string | null;       // por quê precisa revisar
  semConverter?: boolean;              // usuário dispensou virar variação de ingrediente
  ativo: boolean;
  criadoEm: string;
  criadoPor?: string;
  criadoPorNome?: string;
};

// ── WhatsApp: catálogo de tags e metadados por conversa ─────────────────────
// A caixa de entrada do WhatsApp usa número ÚNICO da plataforma (não por
// restaurante). Cada conversa (waId) pode ser vinculada a um restaurante e a
// uma Pessoa, e receber tags. WhatsappContato guarda esses metadados.
export type WhatsappTag = {
  id: string;
  nome: string;
  cor?: string;        // hex (ex "#6366f1")
  criadoEm?: string;
};

// ── Módulo Faturas (cartão de crédito) ──────────────────────────────────────
// Categoria por entidade (cada empresa/pessoa tem a sua lista).
export type CartaoCategoria = {
  id: string;
  restaurantId: string;       // entidade dona da categoria
  nome: string;
  cor?: string;
  ordem?: number;
  ativo?: boolean;
  // Rateio percentual padrão: gastos desta categoria são reembolsados,
  // divididos em % entre empresas. Aplica-se sozinho ao classificar. Ex:
  // Telefonia → [{Lobozó,40},{Sororoca,30},{Puba,30}]. Soma pode ser <100
  // (a sobra fica como gasto próprio, não reembolsado).
  rateioPadrao?: { empresaId: string; percentual: number }[];
  criadoEm?: string;
};

// Uma fatia do rateio percentual de um lançamento (uma empresa reembolsa X%).
export type CartaoRateioParte = {
  empresaId: string;
  percentual: number;                 // 0–100
  valor: number;                      // valor da fatia = lancamento.valor * %/100
  status?: "pendente" | "pago";
  pagoEm?: string | null;
  pagoPor?: string | null;
  pagoPorNome?: string | null;
};

// Uma fatura subida (de um cartão, num mês).
export type CartaoFatura = {
  id: string;
  restaurantId: string;       // entidade dona do cartão
  cartao: string;             // "Master Itaú" | "Visa Itaú" | ...
  competencia: string;        // "YYYY-MM"
  vencimento?: string | null; // "YYYY-MM-DD" (extraído da fatura)
  totalFatura?: number | null;// total da fatura (extraído) — pra conferência
  arquivoPath?: string | null;// path no Storage do PDF
  // Ciclo: rascunho (editável, NÃO publica reembolsos) → fechada (publica).
  status?: "rascunho" | "fechada";
  fechadaEm?: string | null;  // ISO — quando foi fechada/publicada
  fechadaPor?: string | null; // pessoaId
  criadoEm: string;
  criadoPor?: string | null;
};

// Cada lançamento (gasto) de uma fatura.
export type CartaoLancamento = {
  id: string;
  restaurantId: string;       // entidade DONA do cartão
  faturaId?: string | null;
  cartao: string;
  data: string;               // "YYYY-MM-DD" (ou "DD/MM" original em `dataOriginal`)
  dataOriginal?: string;
  descricao: string;
  valor: number;              // negativo = estorno
  parcela?: string | null;    // "03/12"
  obs?: string | null;
  // Destino: própria entidade OU atribuído a outra empresa (reembolso).
  destinoTipo: "propria" | "empresa";
  empresaAtribuidaId?: string | null;   // legado (1 empresa a 100%); ainda gravado quando rateio tem 1 fatia
  categoriaId?: string | null;          // categoria (na lista do destino)
  // Rateio percentual: 1+ empresas reembolsam, cada uma sua %. Vazio/ausente
  // = gasto 100% próprio. Fonte de verdade do reembolso.
  rateio?: CartaoRateioParte[];
  empresasRateadas?: string[];          // ids das empresas no rateio (pra array-contains)
  // Ignorado = não conta na fatura (ex: pagamento da fatura anterior). Fica
  // salvo e visível (riscado), mas fora de totais/reembolso.
  ignorado?: boolean;
  // Publicado = a fatura pai foi FECHADA. Só publicado dispara reembolso/aviso
  // pra outra empresa. Enquanto rascunho, publicado=false (invisível pras outras).
  publicado?: boolean;
  // Reembolso (quando destinoTipo="empresa"): ciclo de pagamento.
  reembolsoStatus?: "pendente" | "pago" | null;
  reembolsoDataPagamento?: string | null;  // "YYYY-MM-DD" — até quando pagar
  reembolsoChavePix?: string | null;        // chave Pix do solicitante (dono)
  pagoEm?: string | null;                   // ISO — quando o pagador marcou pago
  pagoPor?: string | null;                  // pessoaId do pagador
  pagoPorNome?: string | null;              // nome do pagador (pra exibir no aviso)
  criadoEm: string;
  criadoPor?: string | null;
};

export type WhatsappContato = {
  id: string;                 // = waId (dígitos, com DDI)
  restaurantIds?: string[] | null;  // override manual (multi). null/ausente = herda da Pessoa
  restaurantId?: string | null;     // legado (single) — lido como fallback
  pessoaId?: string | null;       // Pessoa vinculada (auto ou manual)
  nomeManual?: string | null;     // nome sobrescrito manualmente
  tagIds?: string[];
  atualizadoEm?: string;
  atualizadoPor?: string;
};
