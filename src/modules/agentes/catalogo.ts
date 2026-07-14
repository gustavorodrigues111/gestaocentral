// Catálogo de ferramentas dos Agentes de IA — fonte ÚNICA de verdade.
// Usado pela tela de configuração (liga/desliga por agente) e, no F1b, pelo
// backend (api/agente.ts) pra montar os tools do Claude e executar as funções.
//
// tipo "read"  → consulta (liberada dentro do escopo/permissão da pessoa).
// tipo "write" → altera dados. SEMPRE em modo confirmação: o agente PROPÕE,
//                um humano aprova antes de executar (decisão do produto).
// `permissao`  → chave de módulo que a pessoa precisa ter (herda da matriz de
//                Pessoas). Se a pessoa não tem, a ferramenta some pro agente.

export type AgenteDominio = "dp" | "financeiro";

export type FerramentaDef = {
  key: string;
  label: string;
  tipo: "read" | "write";
  permissao: string;   // módulo/chave exigida na matriz de Pessoas
  desc: string;
};

export const CATALOGO: Record<AgenteDominio, FerramentaDef[]> = {
  dp: [
    { key: "ler_escala",            label: "Ler escalas",              tipo: "read",  permissao: "escala",            desc: "Escalas planejadas por pessoa/período" },
    { key: "ler_ponto",             label: "Ler ponto / folha",        tipo: "read",  permissao: "analise-ponto",     desc: "Marcações e folha de ponto (Sólides)" },
    { key: "ler_admissoes",         label: "Ler admissões",            tipo: "read",  permissao: "admissao",          desc: "Processos de admissão em andamento" },
    { key: "ler_demissoes",         label: "Ler demissões",            tipo: "read",  permissao: "demissao",          desc: "Processos de demissão em andamento" },
    { key: "ler_prazos_trab",       label: "Ler prazos trabalhistas",  tipo: "read",  permissao: "prazosTrabalhistas",desc: "Experiência (45/90), exames, uniformes" },
    { key: "ler_proc_seletivo",     label: "Ler processo seletivo",    tipo: "read",  permissao: "processoSeletivo",  desc: "Vagas abertas e candidaturas" },
    { key: "ler_gorjetas",          label: "Ler gorjetas",             tipo: "read",  permissao: "gorjetas",          desc: "Gorjetas por período/pessoa" },
    { key: "registrar_ajuste_ponto",label: "Registrar ajuste de ponto",tipo: "write", permissao: "analise-ponto",     desc: "Propõe correção de ponto (confirmação)" },
    { key: "mover_candidatura",     label: "Mover candidatura",        tipo: "write", permissao: "processoSeletivo",  desc: "Muda etapa no kanban (confirmação)" },
    { key: "prorrogar_experiencia", label: "Prorrogar experiência",    tipo: "write", permissao: "prazosTrabalhistas",desc: "Renova contrato de experiência (confirmação)" },
  ],
  financeiro: [
    { key: "ler_contas_fixas",      label: "Ler contas fixas",         tipo: "read",  permissao: "contasFixas",       desc: "Prazos, vencimentos e status de pagamento" },
    { key: "ler_gorjetas",          label: "Ler gorjetas",             tipo: "read",  permissao: "gorjetas",          desc: "Gorjetas por período" },
    { key: "ler_fechamento_caixa",  label: "Ler fechamentos de caixa", tipo: "read",  permissao: "fechamentoCaixa",   desc: "Fechamentos por dia/turno" },
    { key: "ler_vendas",            label: "Ler vendas",               tipo: "read",  permissao: "vendas",            desc: "Vendas e permutas registradas" },
    { key: "ler_recebimentos",      label: "Ler recebimentos",         tipo: "read",  permissao: "recebimento",       desc: "Recebimentos de produtos / notas" },
    { key: "ler_faturas",           label: "Ler faturas de cartão",    tipo: "read",  permissao: "faturas",           desc: "Faturas, lançamentos e reembolsos" },
    { key: "marcar_conta_paga",     label: "Marcar conta paga",        tipo: "write", permissao: "contasFixas",       desc: "Dá baixa numa conta fixa (confirmação)" },
    { key: "marcar_reembolso_pago", label: "Marcar reembolso pago",    tipo: "write", permissao: "faturas",           desc: "Quita reembolso de fatura (confirmação)" },
  ],
};

export const DOMINIO_META: Record<AgenteDominio, { label: string; icon: string; promptPadrao: string }> = {
  dp: {
    label: "Departamento de Pessoas",
    icon: "🧑‍💼",
    promptPadrao:
      "Você é o assistente de Departamento de Pessoas do planejamento.app. Ajuda gestores a consultar escalas, ponto, admissões, demissões, prazos trabalhistas, processo seletivo e gorjetas. Seja objetivo e cite números e datas. Para QUALQUER alteração, você PROPÕE a ação e pede confirmação explícita antes — nunca altera sozinho. Nunca invente dados: se não achar, diga que não encontrou.",
  },
  financeiro: {
    label: "Financeiro",
    icon: "💰",
    promptPadrao:
      "Você é o assistente Financeiro do planejamento.app. Ajuda a consultar contas fixas e seus prazos, gorjetas, fechamentos de caixa, vendas, recebimentos de produtos e faturas de cartão. Seja preciso com valores (R$) e datas em dd/mm/aaaa. Para QUALQUER alteração (marcar conta paga, quitar reembolso), você PROPÕE e pede confirmação explícita antes — nunca movimenta nada sozinho. Nunca invente valores; se não achar, diga que não encontrou.",
  },
};
