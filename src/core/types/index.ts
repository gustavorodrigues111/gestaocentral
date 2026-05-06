// ─── TIPOS BASE ───

export type ModuleArea = "operacao" | "time" | "escritorio";

export type ModuleId =
  // Operação
  | "ocorrencias" | "reservas" | "checklists" | "contagens" | "temperaturas" | "fichas"
  // Time
  | "escala" | "freelas" | "reunioes" | "trilha" | "ideias"
  // Escritório
  | "fechamentoEscala" | "gorjetas" | "vt" | "compras" | "recursos" | "faleDp"
  | "pessoas" | "equipe" | "configuracoes";

// ─── ESCALA / EQUIPE ───

export type Area = "Bar" | "Cozinha" | "Salão" | "Limpeza";
export const AREAS: Area[] = ["Bar", "Cozinha", "Salão", "Limpeza"];

export type Cargo = {
  id: string;
  restaurantId: string;
  nome: string;
  area: Area;
  pontos: number;       // pontos pra divisão de gorjeta
  semGorjeta: boolean;  // true = não recebe gorjeta
  ativo: boolean;
  ordem: number;
  createdAt: string;
};

export type Empregado = {
  id: string;
  restaurantId: string;
  nome: string;
  cpf?: string | null;
  cargoId: string;
  admissao: string;     // YYYY-MM-DD
  empCode?: string | null;       // código interno
  codigoContabil?: string | null; // código no escritório de contabilidade
  isFreela: boolean;
  isProducao: boolean;            // recebe gorjeta todos os dias (cozinha, etc)
  isProlaborista: boolean;        // sócio
  inativa: boolean;
  inativaFrom?: string | null;
  demitidoEm?: string | null;     // primeiro dia FORA = último dia trabalhado + 1
  email?: string | null;
  telefone?: string | null;
  emergenciaNome?: string | null;
  emergenciaTelefone?: string | null;
  pessoaId?: string | null;       // vínculo opcional com Pessoa (login)
  createdAt: string;
  createdBy: string;
};

export type ScheduleStatus =
  | "trabalho" | "folga" | "freela"
  | "comp" | "comp_trab"
  | "ferias" | "falta_j" | "falta_i";

// Escala mensal — armazenada como /escalas/{rid}_{yyyy-mm}
export type EscalaMes = {
  id: string;            // `${restaurantId}_${yyyy-mm}`
  restaurantId: string;
  ano: number;
  mes: number;            // 1-12
  empregados: {
    [empregadoId: string]: {
      [date: string]: ScheduleStatus;  // YYYY-MM-DD
    };
  };
  status: "open" | "closed";
  closedAt?: string | null;
  closedBy?: string | null;
  updatedAt: string;
};

export type ModuleDef = {
  id: ModuleId;
  area: ModuleArea;
  label: string;
  icon: string;
  desc?: string;
  // Sprint atual: módulo está implementado?
  status: "ativo" | "em-breve" | "planejado";
};

// Permissão por módulo dentro de um restaurante
export type ModulePermission = {
  use: boolean;     // pode usar o módulo no dia-a-dia
  config: boolean;  // pode mexer em configurações do módulo
};

// Permissões de uma pessoa em um restaurante
export type RestaurantPermissions = {
  // Por módulo: { gorjetas: { use: true, config: false }, ... }
  [moduleId: string]: ModulePermission;
};

// ─── ENTIDADES ───

export type Restaurant = {
  id: string;
  nome: string;
  shortCode: string;       // 3 letras, único
  cnpj?: string;
  razaoSocial?: string;
  codigoContabil?: string; // código no escritório de contabilidade
  endereco?: string;
  whatsappFinanceiro?: string;
  whatsappOperacional?: string;
  serviceStartDate?: string; // YYYY-MM-DD
  modulosAtivos: ModuleId[];  // quais módulos esse restaurante usa
  // Gorjetas
  taxRate?: number;           // % de retenção da gorjeta (ex: 33 = 33%). Default 0
  ativo: boolean;
  createdAt: string;
  createdBy: string;
};

// ─── GORJETAS ───

export type Gorjeta = {
  id: string;            // `${restaurantId}_${date}`
  restaurantId: string;
  date: string;          // YYYY-MM-DD
  valorBruto: number;    // total recebido na maquininha
  taxRate: number;       // % de retenção aplicada (snapshot do dia)
  valorLiquido: number;  // = valorBruto * (1 - taxRate/100)
  observacao?: string;
  paidAt?: string | null;     // quando foi distribuída efetivamente
  paidBy?: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

// Item da divisão de gorjeta (calculado, não armazenado)
export type DivisaoItem = {
  empregadoId: string;
  empregadoNome: string;
  cargoNome: string;
  area: Area;
  pontos: number;
  valor: number;       // valor que esse empregado recebe nesse dia
  motivo: "trabalho" | "freela" | "producao";
};

export type Pessoa = {
  id: string;                // = uid do Firebase Auth
  email: string;
  nome: string;
  cpf?: string;
  whatsapp?: string;
  isMaster: boolean;        // Owner do sistema (vê tudo)
  restaurantIds: string[];  // restaurantes que essa pessoa tem acesso
  permissions: {
    [restaurantId: string]: RestaurantPermissions;
  };
  // Vínculo opcional como funcionário (Sprint 1+)
  // Por enquanto vazio. Vai ter na próxima fase.
  ativa: boolean;
  createdAt: string;
};
