// Catálogo de ferramentas dos Agentes de IA — fonte ÚNICA de verdade.
// Usado pela tela de configuração (liga/desliga por agente) e, no F1b, pelo
// backend (api/agente.ts) pra montar os tools do Claude e executar as funções.
//
// tipo "read"  → consulta (liberada dentro do escopo/permissão da pessoa).
// tipo "write" → altera dados. SEMPRE em modo confirmação: o agente PROPÕE,
//                um humano aprova antes de executar (decisão do produto).
// `permissao`  → chave de módulo que a pessoa precisa ter (herda da matriz de
//                Pessoas). Se a pessoa não tem, a ferramenta some pro agente.

export type AgenteDominio = "dp" | "financeiro" | "cardapio" | "cardapio_site" | "vendas";

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
    { key: "ler_prazos_trab",       label: "Ler prazos trabalhistas",  tipo: "read",  permissao: "prazos",            desc: "Experiência (45/90), exames, uniformes (módulo Prazos)" },
    { key: "ler_proc_seletivo",     label: "Ler processo seletivo",    tipo: "read",  permissao: "processoSeletivo",  desc: "Vagas abertas e candidaturas" },
    { key: "ler_gorjetas",          label: "Ler gorjetas",             tipo: "read",  permissao: "gorjetas",          desc: "Gorjetas por período/pessoa" },
    { key: "registrar_ajuste_ponto",label: "Registrar ajuste de ponto",tipo: "write", permissao: "analise-ponto",     desc: "Propõe correção de ponto (confirmação)" },
    { key: "mover_candidatura",     label: "Mover candidatura",        tipo: "write", permissao: "processoSeletivo",  desc: "Muda etapa no kanban (confirmação)" },
    { key: "prorrogar_experiencia", label: "Prorrogar experiência",    tipo: "write", permissao: "prazos",            desc: "Renova contrato de experiência (confirmação)" },
  ],
  financeiro: [
    { key: "ler_contas_fixas",      label: "Ler contas a pagar",       tipo: "read",  permissao: "prazos",            desc: "Contas recorrentes: vencimentos e status (módulo Prazos)" },
    { key: "ler_gorjetas",          label: "Ler gorjetas",             tipo: "read",  permissao: "gorjetas",          desc: "Gorjetas por período" },
    { key: "ler_fechamento_caixa",  label: "Ler fechamentos de caixa", tipo: "read",  permissao: "fechamentoCaixa",   desc: "Fechamentos por dia/turno" },
    { key: "ler_vendas",            label: "Ler vendas",               tipo: "read",  permissao: "vendas",            desc: "Vendas e permutas registradas" },
    { key: "ler_recebimentos",      label: "Ler recebimentos",         tipo: "read",  permissao: "recebimento",       desc: "Recebimentos de produtos / notas" },
    { key: "ler_faturas",           label: "Ler faturas de cartão",    tipo: "read",  permissao: "faturas",           desc: "Faturas, lançamentos e reembolsos" },
    { key: "marcar_conta_paga",     label: "Marcar conta paga",        tipo: "write", permissao: "prazos",            desc: "Resolve um prazo de conta a pagar (confirmação)" },
    { key: "marcar_reembolso_pago", label: "Marcar reembolso pago",    tipo: "write", permissao: "faturas",           desc: "Quita reembolso de fatura (confirmação)" },
  ],
  vendas: [
    { key: "ler_vendas_altec",     label: "Ler vendas (PDV/Altec)",   tipo: "read", permissao: "fechamentoCaixa", desc: "Faturamento ao vivo, itens, ticket, ranking de produtos e por hora (PDV Altec)" },
    { key: "ler_fechamento_caixa", label: "Ler fechamentos de caixa", tipo: "read", permissao: "fechamentoCaixa", desc: "Fechamentos por dia/turno" },
    { key: "ler_gorjetas",         label: "Ler gorjetas",             tipo: "read", permissao: "gorjetas",        desc: "Gorjetas por período" },
  ],
  cardapio: [
    { key: "ler_cardapio",     label: "Ler cardápio",       tipo: "read",  permissao: "sites", desc: "Lê o cardápio atual do Puba (comidas, bebidas, vendinha)" },
    { key: "aplicar_cardapio", label: "Aplicar alterações", tipo: "write", permissao: "sites", desc: "Altera preço, adiciona/remove item, edita descrição (confirmação)." },
    { key: "gerar_pdf",        label: "Gerar PDF final",     tipo: "write", permissao: "sites", desc: "Renderiza a filipeta fiel e devolve o link (só no final)." },
  ],
  cardapio_site: [
    { key: "ler_cardapio_site",     label: "Ler cardápio (site)",   tipo: "read",  permissao: "sites", desc: "Lê o cardápio do módulo (Comidas/Bebidas/Vinhos) que está no site" },
    { key: "aplicar_cardapio_site", label: "Aplicar no site",       tipo: "write", permissao: "sites", desc: "Altera preço/prato/descrição/seção — reflete no site (confirmação)" },
    { key: "gerar_previa_site",     label: "Link do site (prévia)", tipo: "read",  permissao: "sites", desc: "Manda o link do cardápio no site pra conferir/aprovar" },
    { key: "gerar_pdf_site",        label: "Gerar PDF (módulo)",    tipo: "read",  permissao: "sites", desc: "PDF desenhado do cardápio (Comidas/Bebidas/Vinhos) via navegador headless" },
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
  vendas: {
    label: "Vendas / Faturamento (PDV)",
    icon: "📊",
    promptPadrao:
      "Você é o assistente de VENDAS/FATURAMENTO. Responde sobre o faturamento AO VIVO e o histórico do PDV (Altec): quanto vendemos hoje/ontem/no período, itens vendidos, ticket médio, ranking dos produtos mais vendidos, ritmo por hora e formas de pagamento. Use ler_vendas_altec (o dado atualiza a cada ~15 min; pra 'hoje' use a data de hoje). Seja direto e no tom WhatsApp: comece pelo número que importa (faturamento), depois top itens e um comparativo rápido se fizer sentido. Valores em R$, datas dd/mm/aaaa. Só consulta — não altera nada. Nunca invente números: se o dia ainda não tem venda ou não achou, diga isso.",
  },
  cardapio: {
    label: "Cardápio do Puba",
    icon: "🍽️",
    promptPadrao:
      "Você edita o cardápio impresso (filipeta) do Puba Bar Cidade Velha. Fale curto, em português, tom WhatsApp. SEMPRE use ler_cardapio antes de propor. NUNCA aplique sem confirmação: primeiro PROPONHA em texto (ex.: 'Entendi: Tostada 60→64, remover Sarnambi ao Curry Verde. Confirma?') e só chame aplicar_cardapio DEPOIS que o usuário responder 'confirma'. Preços inteiros em reais ('sessenta e quatro' = R$ 64). Se pedirem item que não existe no cardápio ou número estranho, PERGUNTE em vez de assumir. Nomes de item em CAIXA ALTA, descrições em minúsculas. Você NÃO gera o PDF nem inventa layout — só edita os itens; o PDF sai numa etapa seguinte.",
  },
  cardapio_site: {
    label: "Cardápio do site (módulo)",
    icon: "🍽️",
    promptPadrao:
      "Você edita o cardápio do módulo de Cardápios (Comidas, Bebidas, Vinhos) que fica publicado no SITE — o que o cliente vê. Toda alteração reflete no site na hora. Fale curto, em português, tom WhatsApp. SEMPRE use ler_cardapio_site antes de propor. NUNCA aplique sem confirmação: primeiro PROPONHA em texto (ex.: 'Entendi: Caipirinha 36→38, remover Soda da Casa. Confirma?') e só chame aplicar_cardapio_site DEPOIS que o usuário responder 'confirma'. Diga em qual cardápio (Comidas/Bebidas/Vinhos) e seção está mexendo. Preço é texto (ex.: '38', 'consulte'). Se pedirem prato que não existe, PERGUNTE. Pra o usuário conferir/aprovar, chame gerar_previa_site (manda o link do cardápio no site).",
  },
};
