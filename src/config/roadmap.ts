import type { ModuleId } from "../core/types";

export type SprintStatus = "completed" | "active" | "planned";

export type Sprint = {
  id: string;
  title: string;
  status: SprintStatus;
  modules?: ModuleId[];
  items: string[];
  notes?: string;
};

// Roadmap atualizado manualmente. É o "norte": olhe aqui antes de começar
// uma feature pra ver se ela já tá planejada e em qual sprint.
export const ROADMAP: Sprint[] = [
  {
    id: "sprint-prep",
    title: "Refatoração inicial — Modelo final",
    status: "active",
    modules: ["pessoas"],
    items: [
      "Wipe das collections de teste (cargos, empregados, escalas, gorjetas, vtFolhas)",
      "Tipos refeitos: Pessoa, Empregado (com periodos[]), Cargo (com tipoVinculo + recebeProducao)",
      "Permissões renomeadas: ver/configurar (eram use/config)",
      "Módulo Equipe sai do menu — vira filtro em Pessoas",
      "Polling real-time da pessoa: inativação imediata bloqueia acesso",
      "EscalaMes ganha versões prevista + real (refator de UI vem na Fase 7)",
    ],
    notes: "Fase 0 do plano de execução — prepara terreno pras fases seguintes.",
  },
  {
    id: "fase-1",
    title: "Fase 1 — Cargos novos",
    status: "planned",
    items: [
      "Tela Pessoas → sub-tab Cargos",
      "CRUD com tipoVinculo (registrado/provisório/estagiário/terceirizado)",
      "Flags: recebeProducao, semGorjeta, pontos",
      "Bloqueia inativar cargo se tem empregado ativo",
    ],
  },
  {
    id: "fase-2",
    title: "Fase 2 — Pessoas unificada",
    status: "planned",
    items: [
      "Tela com filtros: Equipe/Não · Ativa/Inativa",
      "Edição em 3 abas: Identidade · Vínculos · Permissões",
      "Aba Vínculos cadastra Empregado(s) — 1 ou mais restaurantes",
      "Validação: cargo registrado/estagiário exige email; provisório/terceirizado opcional",
    ],
  },
  {
    id: "fase-3",
    title: "Fase 3 — Templates de permissão",
    status: "planned",
    items: [
      "Sub-tab Pessoas → Templates",
      "CRUD por restaurante (cada restaurante tem seus templates)",
      "Botão 'Aplicar template' na aba Permissões da Pessoa",
    ],
  },
  {
    id: "fase-4",
    title: "Fase 4 — Histórico + Audit log + Mudanças agendadas",
    status: "planned",
    items: [
      "Coleções: historicos, auditLog, mudancasAgendadas",
      "Modal padrão 'Data de vigência + impacto' reutilizável",
      "Aplica nos campos: cargoId, vt*, pontos, taxRate, recebeProducao, semGorjeta, tipoVinculo",
      "Job de aplicação de mudanças agendadas (rodando ao abrir o app)",
    ],
  },
  {
    id: "fase-5",
    title: "Fase 5 — Inativação / Reativação / Exclusão",
    status: "planned",
    items: [
      "Inativar com motivo + data efetiva",
      "Reativar revisando dados antes",
      "Excluir definitivo (permissão pessoasExcluir)",
      "Readmissão preserva trilha (novo período no array periodos)",
    ],
  },
  {
    id: "fase-6",
    title: "Fase 6 — Portal do Empregado config",
    status: "planned",
    modules: ["configuracoes"],
    items: [
      "Aba em Configurações: Portal do Empregado",
      "Toggles: Escala / Gorjetas / Comunicados (default true)",
      "Vê na home só pra quem é equipe registrada/estagiária",
    ],
  },
  {
    id: "fase-7",
    title: "Fase 7 — Refator Escala (Prevista vs Real)",
    status: "planned",
    modules: ["escala"],
    items: [
      "Grade ganha modo prevista (planejamento) e real (após o mês)",
      "VT é pago em cima da prevista (congela snapshot)",
      "Versões anteriores arquivadas (restaurar versão como no AppTip)",
    ],
  },
  {
    id: "fase-8",
    title: "Fase 8 — Refator Gorjetas (snapshot + retroativo)",
    status: "planned",
    modules: ["gorjetas"],
    items: [
      "Snapshot completo no doc da gorjeta (cargo, pontos, etc.)",
      "Modal de retroativo quando muda taxRate",
      "Confirmação com diff antes de aplicar mudanças que alteram gorjetas fechadas",
    ],
  },
  {
    id: "fase-9",
    title: "Fase 9 — Refator VT + Tela de divergências",
    status: "planned",
    modules: ["vt"],
    items: [
      "Folha em cima da prevista; congela ao pagar",
      "Tela de divergências: 'a devolver' / 'a receber' baseado em real vs prevista",
    ],
  },
  {
    id: "fase-10",
    title: "Fase 10 — Atualiza ArquiteturaPage",
    status: "planned",
    items: [
      "Reflete novo modelo nas abas Dados/Roadmap/Permissões",
      "Adiciona aba 'Histórico' lendo audit log + mudancasAgendadas",
    ],
  },
];
