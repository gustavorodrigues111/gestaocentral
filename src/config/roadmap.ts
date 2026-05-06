import type { ModuleId } from "../core/types";

export type SprintStatus = "completed" | "active" | "planned";

export type Sprint = {
  id: string;
  title: string;
  status: SprintStatus;
  modules?: ModuleId[];      // módulos que essa sprint entrega ou toca
  items: string[];           // bullets do que tem na sprint
  notes?: string;
};

// Roadmap atualizado manualmente. É o "norte": olhe aqui antes de começar
// uma feature pra ver se ela já tá planejada e em qual sprint.
export const ROADMAP: Sprint[] = [
  {
    id: "sprint-0",
    title: "Sprint 0 — Fundação",
    status: "completed",
    items: [
      "Setup: Vite + React + TS + Tailwind + Firebase",
      "Auth (Firebase Auth, email + senha)",
      "Tipos base: Pessoa, Restaurant, ModulePermission",
      "AppShell + seletor de restaurante (URL como source of truth)",
      "Pessoas: CRUD + matriz de permissões por módulo",
      "Configurações: dados básicos + módulos ativos do restaurante",
    ],
    modules: ["pessoas", "configuracoes"],
  },
  {
    id: "sprint-1a",
    title: "Sprint 1a — Equipe + Escala",
    status: "completed",
    modules: ["equipe", "escala"],
    items: [
      "Cargos: CRUD agrupado por área (Bar/Cozinha/Salão/Limpeza)",
      "Empregados: CRUD com flags isFreela/isProducao/isProlaborista",
      "Escala mensal: grade editável célula a célula",
      "8 status (trabalho, folga, freela, comp, comp_trab, férias, falta_j, falta_i)",
      "Filtra automaticamente demitidos/inativos antes do mês",
    ],
  },
  {
    id: "sprint-1b",
    title: "Sprint 1b — Gorjetas",
    status: "completed",
    modules: ["gorjetas"],
    items: [
      "Lançamento diário (1 doc por dia: gorjetas/{rid}_{data})",
      "Cálculo de divisão automático (escala + pontos do cargo + flags)",
      "Modal com bruto / retenção / líquido + painel de divisão em tempo real",
      "taxRate como config interna do módulo (engrenagem ⚙️)",
    ],
  },
  {
    id: "sprint-1c",
    title: "Sprint 1c — VT",
    status: "completed",
    modules: ["vt"],
    items: [
      "Folha mensal (vtFolhas/{rid}_{yyyy-mm})",
      "Cálculo: dias trabalhados × passagens/dia × valor",
      "VT 100% por empregado (sem default no restaurante)",
      "Marcação pago/pendente + 'pagar todos' em 1 clique",
    ],
  },
  {
    id: "sprint-2",
    title: "Sprint 2 — Fechamento + Histórico",
    status: "planned",
    modules: ["fechamentoEscala"],
    items: [
      "Fechar escala mensal (snapshot, status='closed')",
      "Histórico de Gorjetas (folha mensal arquivada)",
      "Export contábil (XLSX) de gorjetas + VT por empregado",
      "Reabrir mês fechado (perm especial)",
    ],
  },
  {
    id: "sprint-3",
    title: "Sprint 3 — Pessoa ↔ Empregado (login do empregado)",
    status: "planned",
    modules: ["pessoas", "equipe"],
    items: [
      "Vincular pessoa.id ↔ empregado.pessoaId",
      "Portal do Empregado: minha escala, minhas gorjetas, meu VT",
      "Permissão de visualização restrita (só dados próprios)",
    ],
  },
  {
    id: "sprint-4",
    title: "Sprint 4 — Reuniões + Trilha + Comunicação",
    status: "planned",
    modules: ["reunioes", "trilha", "ideias"],
    items: [
      "Reuniões: planejamento, agenda, ações, ocorrências",
      "Trilha do empregado: histórico de desenvolvimento",
      "Banco de ideias",
    ],
  },
  {
    id: "sprint-5",
    title: "Sprint 5 — Operação dia-a-dia",
    status: "planned",
    modules: ["reservas", "ocorrencias", "checklists", "contagens"],
    items: [
      "Reservas: configuração de salões/mesas + operação",
      "Ocorrências: log do dia",
      "Checklists operacionais",
      "Contagens de estoque",
    ],
  },
  {
    id: "sprint-6",
    title: "Sprint 6 — Compras + Fichas + Recursos + Fale com DP",
    status: "planned",
    modules: ["compras", "fichas", "recursos", "faleDp", "temperaturas"],
    items: [
      "Compras (pedidos baseados em contagens)",
      "Fichas técnicas (receitas + custo)",
      "Biblioteca interna",
      "Canal Fale com DP",
      "Monitoramento de temperaturas",
    ],
  },
];
