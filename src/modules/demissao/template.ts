// Template default de colunas + subtarefas do processo de Demissão.
// Baseado nos 23 itens do esqueleto que o usuário tinha no Asana.
//
// Cada subtarefa tem `iniciativaAplicavel` pra filtrar por iniciativa
// (Empresa/Empregado/Acordo). Vazio = aplica a todas.

import type {
  KanbanColunaDemissao, SubtarefaDemissaoTemplate,
} from "../../core/types";

export const COLUNAS_DEMISSAO_DEFAULT: KanbanColunaDemissao[] = [
  { id: "col_iniciado",      nome: "Iniciado",                ordem: 1, statusAuto: "iniciado", cor: "94a3b8" },
  { id: "col_previa",        nome: "Aguardando prévia",       ordem: 2, statusAuto: ["previa_solicitada", "aguardando_decisao"], cor: "f59e0b" },
  { id: "col_decisao",       nome: "Decisão tomada",          ordem: 3, statusAuto: "decidido_realizar", cor: "3b82f6" },
  { id: "col_comunicacao",   nome: "Comunicação & agendamentos", ordem: 4, statusAuto: "comunicado", cor: "8b5cf6" },
  { id: "col_execucao",      nome: "Execução (assinatura + pagamento)", ordem: 5, statusAuto: ["em_andamento", "aviso_em_curso"], cor: "ec4899" },
  { id: "col_encerramento",  nome: "Encerramento (descadastros)", ordem: 6, statusAuto: "em_andamento", cor: "f97316" },
  { id: "col_concluido",     nome: "Concluído",               ordem: 7, statusAuto: "concluido", cor: "10b981" },
  { id: "col_cancelado",     nome: "Cancelado",               ordem: 8, statusAuto: "cancelado", cor: "ef4444" },
];

// Sub-grupos visuais dentro das colunas
const CK_INICIO     = { id: "ck_inicio",     nome: "🎬 Início do processo" };
const CK_PREVIA     = { id: "ck_previa",     nome: "📊 Prévia & decisão" };
const CK_INFORME    = { id: "ck_informe",    nome: "📣 Informes" };
const CK_AGENDAS    = { id: "ck_agendas",    nome: "📅 Agendamentos" };
const CK_ASSINATURA = { id: "ck_assinatura", nome: "📃 Assinatura & pagamento" };
const CK_ANEXOS     = { id: "ck_anexos",     nome: "📎 Anexos no Drive" };
const CK_DESCAD     = { id: "ck_descad",     nome: "🗑️ Descadastros externos" };
const CK_FINAL      = { id: "ck_final",      nome: "✅ Finalização" };

function st(
  id: string,
  nome: string,
  colunaId: string,
  checklist: { id: string; nome: string },
  ordem: number,
  extras: Partial<SubtarefaDemissaoTemplate> = {},
): SubtarefaDemissaoTemplate {
  return {
    id, nome, colunaId,
    checklistId: checklist.id, checklistNome: checklist.nome,
    obrigatoria: true, ordem,
    ...extras,
  };
}

export const SUBTAREFAS_DEMISSAO_DEFAULT: SubtarefaDemissaoTemplate[] = [
  // ─── Col 1: Iniciado ──────────────────────────────────────────────
  st("std_definir_data", "Definir data alvo da demissão",
     "col_iniciado", CK_INICIO, 1,
     { iniciativaAplicavel: ["empresa"], pedeData: true }),
  st("std_carta_punho", "Solicitar carta de próprio punho (pedido do empregado)",
     "col_iniciado", CK_INICIO, 2,
     { iniciativaAplicavel: ["empregado"], pedeLink: true }),
  st("std_aviso_previo", "Definir tipo de aviso prévio (trabalhado ou indenizado)",
     "col_iniciado", CK_INICIO, 3),

  // ─── Col 2: Aguardando prévia (só Empresa) ──────────────────────
  st("std_solic_previa", "Solicitar prévia da rescisão para contabilidade",
     "col_previa", CK_PREVIA, 1,
     { iniciativaAplicavel: ["empresa"], atalho: { tipo: "contato_contabilidade" } }),
  st("std_receber_previa", "Receber prévia + analisar custo + caixa",
     "col_previa", CK_PREVIA, 2,
     { iniciativaAplicavel: ["empresa"] }),

  // ─── Col 3: Decisão (só Empresa) ───────────────────────────────
  st("std_decisao_realizar", "Decidir: vai realizar a demissão?",
     "col_decisao", CK_PREVIA, 1,
     { iniciativaAplicavel: ["empresa"], ehDecisaoRealizar: true }),

  // ─── Col 4: Comunicação & agendamentos ─────────────────────────
  st("std_solic_aviso_contab", "Solicitar aviso de demissão para contabilidade",
     "col_comunicacao", CK_INFORME, 1,
     { iniciativaAplicavel: ["empresa", "acordo"], atalho: { tipo: "contato_contabilidade" } }),
  st("std_informar_contab_empregado", "Informar contabilidade (pedido do empregado)",
     "col_comunicacao", CK_INFORME, 2,
     { iniciativaAplicavel: ["empregado"], atalho: { tipo: "contato_contabilidade" } }),
  st("std_informar_empregado", "Informar demissão pro empregado (comunicação oficial)",
     "col_comunicacao", CK_INFORME, 3,
     { iniciativaAplicavel: ["empresa"], ehBloqueioAcesso: true, atalho: { tipo: "whatsapp_empregado" } }),
  st("std_telegrama", "Se não tiver retorno do informe, enviar telegrama",
     "col_comunicacao", CK_INFORME, 4,
     { iniciativaAplicavel: ["empresa"] }),
  st("std_reuniao_demissao", "Marcar reunião de demissão + devolução de uniformes/EPIs/chaves/aparelhos",
     "col_comunicacao", CK_AGENDAS, 5,
     { pedeData: true }),
  st("std_exame_demissional", "Marcar exame demissional na clínica",
     "col_comunicacao", CK_AGENDAS, 6,
     { atalho: { tipo: "contato_clinica" }, pedeData: true }),

  // ─── Col 5: Execução (assinatura + pagamento) ─────────────────
  st("std_calc_gorjeta", "Calcular gorjeta do último dia trabalhado",
     "col_execucao", CK_ASSINATURA, 1),
  st("std_assin_rescisao", "Marcar assinatura da rescisão + outros documentos + entrega do recibo de devolução",
     "col_execucao", CK_ASSINATURA, 2,
     { pedeData: true }),
  st("std_pagar_verbas", "Realizar pagamento das verbas rescisórias",
     "col_execucao", CK_ASSINATURA, 3),
  st("std_anexar_rescisao", "Anexar rescisão assinada no Drive",
     "col_execucao", CK_ANEXOS, 4,
     { pedeLink: true }),
  st("std_anexar_exame", "Anexar exame demissional no Drive",
     "col_execucao", CK_ANEXOS, 5,
     { pedeLink: true }),

  // ─── Col 6: Encerramento (descadastros) ───────────────────────
  st("std_pasta_desligados", "Mover pasta do empregado pra 'Empregados Desligados' no Drive",
     "col_encerramento", CK_DESCAD, 1),
  st("std_excluir_triagem", "Excluir da Triagem (clínica de exames)",
     "col_encerramento", CK_DESCAD, 2),
  st("std_excluir_solides", "Excluir da Sólides (controle de ponto)",
     "col_encerramento", CK_DESCAD, 3),
  st("std_excluir_banco", "Excluir conta do banco",
     "col_encerramento", CK_DESCAD, 4),
  st("std_excluir_caju", "Excluir do Caju (VT/VR)",
     "col_encerramento", CK_DESCAD, 5),
  st("std_excluir_seguro", "Excluir do seguro de empregados",
     "col_encerramento", CK_DESCAD, 6),
  st("std_remover_contatos", "Remover da planilha de contatos",
     "col_encerramento", CK_DESCAD, 7),
  st("std_remover_grupo", "Remover do grupo de Avisos Gerais (WhatsApp)",
     "col_encerramento", CK_DESCAD, 8),

  // ─── Col 7: Concluído ─────────────────────────────────────────
  st("std_finalizar", "Finalizar processo (inativa empregado, desativa exames)",
     "col_concluido", CK_FINAL, 1,
     { ehInativacaoFinal: true }),
];

// Helper: filtra subtarefas que se aplicam à iniciativa escolhida
export function subtarefasParaIniciativa(
  template: SubtarefaDemissaoTemplate[],
  iniciativa: import("../../core/types").DemissaoIniciativa,
): SubtarefaDemissaoTemplate[] {
  return template.filter(s =>
    !s.iniciativaAplicavel || s.iniciativaAplicavel.includes(iniciativa)
  );
}
