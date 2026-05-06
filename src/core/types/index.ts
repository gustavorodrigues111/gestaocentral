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
  ativo: boolean;
  createdAt: string;
  createdBy: string;
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
