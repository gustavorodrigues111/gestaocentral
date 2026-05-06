// ─── TIPOS BASE ───

export type ModuleArea = "operacao" | "time" | "escritorio";

export type ModuleId =
  // Operação
  | "ocorrencias" | "reservas" | "checklists" | "contagens" | "temperaturas" | "fichas"
  // Time
  | "escala" | "freelas" | "reunioes" | "trilha" | "ideias"
  // Escritório
  | "fechamentoEscala" | "gorjetas" | "vt" | "compras" | "recursos" | "faleDp"
  | "pessoas" | "configuracoes";

// ─── PERMISSÕES ───

export type ModulePermission = {
  ver: boolean;        // pode visualizar o módulo (read)
  configurar: boolean; // pode configurar / editar (write)
};

export type RestaurantPermissions = {
  [moduleId: string]: ModulePermission;
};

// Permissões "transversais" da pessoa em um restaurante (não por módulo)
export type PessoaSpecialPermissions = {
  pessoasExcluir?: boolean;   // pode excluir pessoas DEFINITIVAMENTE
};

export type ModuleDef = {
  id: ModuleId;
  area: ModuleArea;
  label: string;
  icon: string;
  desc?: string;
  status: "ativo" | "em-breve" | "planejado";
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

  // Contatos
  email?: string | null;
  telefone?: string | null;
  emergenciaNome?: string | null;
  emergenciaTelefone?: string | null;

  createdAt: string;
  createdBy: string;
};

// Status do dia na escala
export type ScheduleStatus =
  | "trabalho" | "folga" | "freela"
  | "comp" | "comp_trab"
  | "ferias" | "falta_j" | "falta_i";

// Escala mensal — armazenada como /escalas/{rid}_{yyyy-mm}
// Tem 2 versões: prevista (planejamento) e real (após o mês passar)
export type EscalaMes = {
  id: string;
  restaurantId: string;
  ano: number;
  mes: number;

  // PREVISTA: planejamento que vai pra cálculo de VT antecipado
  prevista: { [empregadoId: string]: { [date: string]: ScheduleStatus } };
  // REAL: o que de fato aconteceu (faltas, atestados, etc)
  real:     { [empregadoId: string]: { [date: string]: ScheduleStatus } };

  vtPagoEm?: string | null;       // ISO — congela "prevista" após pagamento
  vtPagoPor?: string | null;
  fechadoEm?: string | null;      // ISO — congela "real" no fechamento total
  fechadoPor?: string | null;

  updatedAt: string;
};

// ─── ENTIDADES PRINCIPAIS ───

export type Restaurant = {
  id: string;
  nome: string;
  shortCode: string;
  cnpj?: string;
  razaoSocial?: string;
  codigoContabil?: string;
  endereco?: string;
  whatsappFinanceiro?: string;
  whatsappOperacional?: string;
  serviceStartDate?: string;
  modulosAtivos: ModuleId[];

  // Portal do Empregado: o que aparece pra empregado registrado deste restaurante
  portalEmpregado?: {
    escala?: boolean;          // default true
    gorjetas?: boolean;        // default true
    comunicados?: boolean;     // default true
  };

  // Configs internas de módulos (alteráveis via ⚙️ do módulo)
  taxRate?: number;            // % retenção da gorjeta

  ativo: boolean;
  createdAt: string;
  createdBy: string;
};

export type Pessoa = {
  id: string;                  // = uid Firebase Auth
  email: string;
  nome: string;
  cpf?: string;
  whatsapp?: string;
  isMaster: boolean;
  restaurantIds: string[];
  permissions: { [restaurantId: string]: RestaurantPermissions };
  specialPermissions?: { [restaurantId: string]: PessoaSpecialPermissions };

  // Status de acesso
  ativa: boolean;              // false = bloqueio imediato (polling 30s detecta)
  inativadaEm?: string | null; // ISO
  inativadaPor?: string | null;
  motivoInativacao?: string;

  createdAt: string;
};

// ─── GORJETAS ───

export type Gorjeta = {
  id: string;                   // `${restaurantId}_${date}`
  restaurantId: string;
  date: string;
  valorBruto: number;
  taxRate: number;              // snapshot
  valorLiquido: number;
  observacao?: string;
  paidAt?: string | null;
  paidBy?: string | null;
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

// ─── TEMPLATES DE PERMISSÃO ───

export type PermissionTemplate = {
  id: string;
  restaurantId: string;          // por restaurante (cada um tem seu vocabulário)
  nome: string;                  // ex: "Líder de Salão", "DP Sororoca"
  descricao?: string;
  permissions: RestaurantPermissions;  // o conjunto que aplica ao marcar o template
  specialPermissions?: PessoaSpecialPermissions;
  ordem?: number;
  ativo: boolean;
  createdAt: string;
  createdBy: string;
};

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
