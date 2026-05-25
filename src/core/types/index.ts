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

export type ModuleArea = "operacao" | "time" | "escritorio";

export type ModuleId =
  // Operação
  | "ocorrencias" | "reservas" | "checklists" | "contagens" | "temperaturas" | "fichas" | "eventos"
  | "horarios"
  // Time
  | "escala" | "freelas" | "reunioes" | "trilha" | "ideias"
  // Escritório
  | "fechamentoEscala" | "gorjetas" | "vt" | "vr" | "compras" | "recursos" | "faleDp"
  | "pessoas" | "comunicados" | "configuracoes" | "excecoes" | "admissao" | "sites";

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
  label: string;
  icon: string;
  desc?: string;
  status: "ativo" | "em-breve" | "planejado";
  etapa?: ModuleEtapa;
  dependsOn?: ModuleId[];
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

  ativo: boolean;
  ordem: number;
  createdAt: string;
};

// Período de admissão / demissão. Empregado tem vários (trilha completa).
export type EmpregadoPeriodo = {
  admissao: string;              // YYYY-MM-DD
  demissao?: string | null;      // YYYY-MM-DD (null = vigente)
  motivoDemissao?: string;
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

  // Trilha de admissões/demissões
  periodos: EmpregadoPeriodo[];
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

  // VR (Vale Refeição) — só usado quando Restaurant.usaVR = true.
  // Mesma lógica do VT mas com valor diário direto (sem "passagens por dia"),
  // e o desconto por absenteísmo NÃO conta falta justificada (regra de negócio).
  vrAtivo?: boolean;
  vrValorDiario?: number;       // R$ por dia trabalhado
  vrAuxilioFixoMensal?: number; // R$ — adicional fixo mensal (independente de vrAtivo)

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
  break?: number;    // intervalo intra-jornada em minutos
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

  // Multi-unidades. Default false — restaurante single-unidade não vê nada
  // disso na UI e o sistema funciona como antes.
  multiUnidades?: boolean;
  unidades?: Unidade[];

  // Portal do Empregado: o que aparece pra empregado registrado deste restaurante
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

  // Limites de carga horária semanal (em minutos) usados nas validações de horário
  // Default: 43h55min a 44h00min (CLT padrão)
  horarioConfig?: {
    cargaSemanalMinMin?: number;  // default 2635 (43:55)
    cargaSemanalMaxMin?: number;  // default 2640 (44:00)
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

  // "Convite simplificado": quando a pessoa é vinculada a um restaurante novo,
  // o rid entra aqui pra virar um badge "📨 Você foi adicionada a X" no header
  // dela. Ela vê, clica em "ok, vi", e o rid sai dessa lista.
  novosRestaurantes?: string[];

  // Cadastro incompleto: importação trouxe pessoa sem CPF — admin precisa
  // completar antes de algum fluxo crítico (signup, login, etc).
  cadastroIncompleto?: boolean;

  // Status de acesso
  ativa: boolean;              // false = bloqueio imediato (polling 30s detecta)
  inativadaEm?: string | null; // ISO
  inativadaPor?: string | null;
  motivoInativacao?: string;

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
  taxRate: number;              // snapshot — usado só pra retrocompat de docs antigos
  valorLiquido: number;         // snapshot — idem
  observacao?: string;
  // Snapshot da divisão. Congelado no ato de publicar — a partir daí o cálculo
  // dessa gorjeta NÃO recalcula mesmo que a escala mude. Pra recalcular, é
  // necessário despublicar e publicar de novo.
  divisaoSnapshot?: DivisaoItem[];
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

export type IdeiaStatus = "aberta" | "em_pauta" | "discutida" | "descartada";

export type Ideia = {
  id: string;
  restaurantId: string;
  titulo: string;
  descricao?: string;
  categoria?: string;            // ex: "Operação", "Cardápio", "Cultura"
  status: IdeiaStatus;
  reuniaoId?: string | null;     // se em_pauta ou discutida → linkada a uma reunião
  criadoEm: string;
  criadoPor: string;             // pessoaId
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
  ordem: number;
  discutido: boolean;
  notas?: string;                // notas específicas do tópico
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
  criadoEm: string;
  criadoPor: string;
  atualizadoEm: string;
};

// ─── TRILHA DO EMPREGADO ───────────────────────────────────────────────────

export type EventoTrilhaTipo =
  | "admissao" | "demissao" | "readmissao"
  | "mudanca_cargo" | "promocao"
  | "treinamento" | "feedback_positivo" | "feedback_negativo"
  | "ocorrencia" | "premiacao" | "outro";

export const EVENTO_TRILHA_LABEL: Record<EventoTrilhaTipo, string> = {
  admissao:           "Admissão",
  demissao:           "Demissão",
  readmissao:         "Readmissão",
  mudanca_cargo:      "Mudança de cargo",
  promocao:           "Promoção",
  treinamento:        "Treinamento",
  feedback_positivo:  "Feedback positivo",
  feedback_negativo:  "Feedback negativo",
  ocorrencia:         "Ocorrência",
  premiacao:          "Premiação",
  outro:              "Outro",
};

export const EVENTO_TRILHA_ICON: Record<EventoTrilhaTipo, string> = {
  admissao:           "🎉",
  demissao:           "👋",
  readmissao:         "🔄",
  mudanca_cargo:      "🔁",
  promocao:           "🚀",
  treinamento:        "📚",
  feedback_positivo:  "👍",
  feedback_negativo:  "👎",
  ocorrencia:         "⚠️",
  premiacao:          "🏆",
  outro:              "📌",
};

export type EventoTrilha = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  tipo: EventoTrilhaTipo;
  data: string;                  // YYYY-MM-DD
  titulo: string;
  descricao?: string;
  fonte: "auto" | "manual";      // auto = gerado pelo sistema (admissão/cargo/etc)
  registradoEm: string;
  registradoPor: string;
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

export type OcorrenciaStatus = "aberta" | "em_apuracao" | "resolvida" | "arquivada";

export const OCORRENCIA_STATUS_LABEL: Record<OcorrenciaStatus, string> = {
  aberta:       "Aberta",
  em_apuracao:  "Em apuração",
  resolvida:    "Resolvida",
  arquivada:    "Arquivada",
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
  // Auditoria
  criadaEm: string;                      // ISO
  criadaPor: string;                     // pessoaId
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
  exigeFoto?: boolean;        // futuro: anexar foto (placeholder)
  exigeObs?: boolean;         // se true, run pede observação no item
};

export type ChecklistTemplate = {
  id: string;
  restaurantId: string;
  nome: string;
  descricao?: string;
  area?: Area;                      // opcional — pode ser geral
  frequencia: ChecklistFrequencia;
  // pra "diaria" — quais dias da semana (0=Dom..6=Sáb). Vazio = todos.
  diasSemana?: number[];
  // horário de referência (ex: "08:00" pra abertura). Pra dashboard.
  horarioReferencia?: string;
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
  marcadoEm?: string;               // ISO
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
  itens: ChecklistRunItemResultado[];
  totalItens: number;
  feitos: number;
  obrigatoriosFeitos: number;
  obrigatoriosTotal: number;
  status: ChecklistRunStatus;
  iniciadoEm: string;
  finalizadoEm?: string | null;
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
  | "nao_compareceu";

export const FREELA_SHIFT_STATUS_LABEL: Record<FreelaShiftStatus, string> = {
  agendado:       "Agendado",
  aberto:         "Aberto",
  fechamento:     "Em fechamento",
  pago:           "Pago",
  nao_compareceu: "Não compareceu",
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

  // Lançamento (preenchido a partir de "aberto")
  entrada?: string;                // "HH:MM"
  saida?: string;                  // "HH:MM" (pode ser do dia seguinte)
  intervalo?: number;              // minutos
  horas?: number;                  // total decimal de horas trabalhadas
  valorTipo?: "hora" | "diaria";   // como é cobrado
  valorUnit?: number;              // R$ por hora OU diária fixa
  totalCalc?: number;              // R$ total do turno (calculado)

  status: FreelaShiftStatus;
  lotePagamentoId?: string | null; // preenchido quando entra num FreelaPagamento

  observacao?: string;

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

// Resumo por pessoa dentro do lote (pra render rápido na lista + PDF)
export type FreelaPagamentoResumoPessoa = {
  pessoaId?: string | null;
  empregadoId?: string | null;
  nome: string;
  pix?: string;
  cpf?: string;
  whatsapp?: string;
  qtdShifts: number;
  totalHoras: number;
  totalValor: number;
};

export type FreelaPagamento = {
  id: string;
  restaurantId: string;
  numero: string;                  // ex: "LOTE-2026-05-001"
  observacao?: string;
  shiftIds: string[];              // FreelaShift.id contidos no lote
  pessoasResumo: FreelaPagamentoResumoPessoa[];
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
//   enviado → preenchido → contabilidade → pronto → admitido
// formulario_enviado auto-avança pra formulario_preenchido quando o candidato
// submete o form. Restante é manual via botão "▶ Avançar" na lista.
export type AdmissaoStatus =
  | "formulario_enviado"          // col 1 — link enviado, esperando candidato
  | "formulario_preenchido"       // col 2 — candidato submeteu, RH lidando com exames + conta + docs + dados internos
  | "solicitacao_contabilidade"   // col 3 — pedido enviado pra contabilidade, assinaturas + banco + cursos
  | "pronto_admissao"             // col 4 — tudo pronto, esperando D-day
  | "admitido"                    // col 5 — processo finalizado + onboarding D1 + cadastros pós
  | "cancelada"                   // qualquer motivo de cancelamento
  | "expirada";                   // token expirou sem preenchimento

export const ADMISSAO_STATUS_LABEL: Record<AdmissaoStatus, string> = {
  formulario_enviado:        "Aguardando preenchimento",
  formulario_preenchido:     "Exames, conta e dados internos",
  solicitacao_contabilidade: "Contabilidade & contratos",
  pronto_admissao:           "Pronto pra admitir",
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

  // ─── Kanban: override manual da coluna (default: derivado do status) ───
  // Mantido por retrocompat. O Kanban virou view-only — não há mais drag-drop.
  kanbanColunaId?: string;

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

  createdAt: string;
  updatedAt: string;
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
    // Atalhos legados — mantidos por retrocompat. Resolvidos pra contato_*
    // no drawer.
    | { tipo: "gmail_clinica" }
    | { tipo: "whatsapp_banco_financeiro" };
  pedeLink?: boolean;                // se true, mostra input de URL (Drive/Dropbox)
  pedeDataHora?: boolean;            // se true, mostra input datetime-local
  pedeDadosBancarios?: boolean;      // se true, mostra 3 campos (tipo + agência + conta) — atualizam adm.dadosBancariosItau
};

// Instância de subtarefa numa admissão concreta (state + dados).
export type SubtarefaAdmissao = SubtarefaTemplate & {
  feita: boolean;
  feitaEm?: string;                  // ISO
  feitaPor?: { id: string; nome: string };
  observacao?: string;
  link?: string;                     // URL externa (se pedeLink)
  dataAgendada?: string;             // "YYYY-MM-DDTHH:MM" local — se pedeDataHora
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

export type ItemCardapioEvento = {
  id: string;
  tipo: "couvert" | "entrada" | "principal" | "acompanhamento"
      | "sobremesa" | "bebida" | "extra";
  nome: string;
  descricao?: string;
  fichaTecnicaId?: string;           // link opcional pra Ficha Técnica do mise
  ordem: number;
};

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
  precoPorPessoa: number;            // R$
  capacidadeMin: number;
  capacidadeMax: number;
  cardapio: ItemCardapioEvento[];
  inclusos: string[];                // ["som ambiente", "decoração básica"]
  naoInclusos: string[];             // ["bolo", "DJ"]
  observacoes?: string;
  ativo: boolean;
  ordem: number;                     // ordenação na vitrine pública
  createdAt: string;
  updatedAt: string;
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
  // Atribuição interna
  responsavelId?: string;
  responsavelNome?: string;
  // Marcações operacionais
  duvidaPraGestor?: {
    pergunta: string;
    perguntadoEm: string;
    perguntadoPor: string;
    resposta?: string;
    respondidoEm?: string;
    respondidoPor?: string;
  };
  conflitaDataCom?: string[];
  // Auditoria
  origem: "publico" | "manual";
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  // Perda
  perdidoEm?: string;
  motivoPerda?: string;
};

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
  cardapio: ItemCardapioEvento[];
  inclusos: string[];
  naoInclusos: string[];
  ajustes: AjusteProposta[];
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
  cardapio: ItemCardapioEvento[];
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

export type LogMensagemEvento = {
  id: string;
  restaurantId: string;
  leadId: string;
  templateKey?: TemplateMensagemEventoKey;
  texto: string;                     // texto efetivo enviado (após substituir placeholders)
  enviadoEm: string;
  enviadoPor: string;
  enviadoPorNome: string;
  canal: "whatsapp_wame" | "whatsapp_api" | "email";
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
