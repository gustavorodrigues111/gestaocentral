// ════════════════════════════════════════════════════════════════════════════
//  Propostas comerciais — modelo de dados (master).
//  Uma proposta vira um doc em `propostas/<slug>`; a página pública
//  proposta.planejamento.app/<slug> lê esse doc e monta a proposta.
// ════════════════════════════════════════════════════════════════════════════

export type PropostaCard = { n: string; titulo: string; desc: string };
export type PropostaGrupoModulos = { titulo: string; itens: string[] };
export type PropostaFase = { when: string; titulo: string; desc: string };
export type PropostaComposicao = { item: string; valor: string };
export type PropostaTerceiro = { servico: string; oque: string; estimativa: string };
export type PropostaPlano = { titulo: string; desc: string; valor?: string; nota?: string };
export type PropostaTermo = { t: string; d: string };

export type Proposta = {
  id: string;
  slug: string;               // URL: proposta.planejamento.app/<slug>
  ativo: boolean;             // false = não publica (404 na página)
  clienteNome: string;
  logo: "jojo" | "none";      // logomarca do cliente embutida
  senha: string;              // palavra-chave (vazio = sem trava)
  emissao: string;            // YYYY-MM-DD
  validadeDias: number;       // prazo de validade
  apresentadoPor: string;

  // Capa
  eyebrow: string;
  titulo: string;
  lead: string;
  pill: string;               // faixa "early buyer…" (vazio = esconde)

  // Seções
  oquee: { eyebrow: string; titulo: string; paragrafos: string[] };
  frentes: { eyebrow: string; titulo: string; cards: PropostaCard[] };
  modulos: { eyebrow: string; titulo: string; nota: string; grupos: PropostaGrupoModulos[] };
  fases: { eyebrow: string; titulo: string; callout: string; itens: PropostaFase[] };
  entregaveis: { eyebrow: string; titulo: string; recebe: string[]; cliente: string[] };
  investimento: {
    eyebrow: string; titulo: string; callout: string;
    total: string; totalNota: string; parcelas: string; parcelasNota: string;
    composicao: PropostaComposicao[]; rodape: string;
  };
  terceiros: { eyebrow: string; titulo: string; intro: string; linhas: PropostaTerceiro[]; nota: string };
  continuidade: { eyebrow: string; titulo: string; planos: PropostaPlano[]; nota: string };
  termos: { eyebrow: string; titulo: string; itens: PropostaTermo[] };

  criadoEm?: string;
  atualizadoEm?: string;
};

// Vencimento (ms) = emissão + validadeDias (fim do dia, BRT −03:00).
export function vencimentoMs(p: Pick<Proposta, "emissao" | "validadeDias">): number {
  const base = new Date(`${p.emissao}T00:00:00-03:00`).getTime();
  const venc = base + (p.validadeDias || 0) * 86400000;
  // Fim do dia do vencimento.
  const d = new Date(venc);
  return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T23:59:59-03:00`).getTime();
}

export function propostaStatus(p: Proposta): { label: string; expirada: boolean; diasRestantes: number } {
  if (!p.ativo) return { label: "Inativa", expirada: false, diasRestantes: 0 };
  const ms = vencimentoMs(p) - Date.now();
  if (ms <= 0) return { label: "Expirada", expirada: true, diasRestantes: 0 };
  const dias = Math.ceil(ms / 86400000);
  return { label: `${dias} dia${dias === 1 ? "" : "s"} restante${dias === 1 ? "" : "s"}`, expirada: false, diasRestantes: dias };
}

export const URL_BASE_PROPOSTA = "https://proposta.planejamento.app";

// ─── Seed: a proposta do Jojo Ramen (a que construímos) ─────────────────────
export function propostaJojo(): Proposta {
  return {
    id: "jojo",
    slug: "jojo",
    ativo: true,
    clienteNome: "Jojo Ramen",
    logo: "jojo",
    senha: "borajojo",
    emissao: "2026-08-31",
    validadeDias: 7,
    apresentadoPor: "Gustavo Rodrigues · planejamento.app",
    eyebrow: "Consultoria + Sistema de operação",
    titulo: "Consultoria de gestão & implantação do seu sistema de operação",
    lead: "Um modelo de gestão de restaurantes desenhado e provado em operação real — entregue como consultoria, formulação de processos e a plataforma planejamento.app, com banco de dados exclusivo do seu negócio.",
    pill: "⚡ Condição early buyer — uma das 3 primeiras implantações · investimento detalhado adiante",
    oquee: {
      eyebrow: "O que é esta proposta",
      titulo: "Não é a venda de um software. É a implantação de um jeito de gerir.",
      paragrafos: [
        "A maioria das ferramentas entrega telas e deixa o dono descobrir sozinho como usá-las. Aqui é o contrário: primeiro entendemos e redesenhamos os processos do seu negócio — pessoas, financeiro, operação, compras, atendimento — e só então configuramos o sistema para sustentar esses processos no dia a dia.",
        "Você recebe um banco de dados e um ambiente exclusivos, com os dados sob sua propriedade, e o acompanhamento de quem construiu e roda esse modelo em operação real. Depois da implantação, a relação passa a ser de manutenção e evolução — o sistema continua vivo, e você não fica na mão.",
      ],
    },
    frentes: {
      eyebrow: "O que está incluído", titulo: "Quatro frentes, um único programa",
      cards: [
        { n: "A", titulo: "Consultoria & formulação de processos", desc: "Diagnóstico do negócio e desenho dos processos de DP, financeiro, operação, compras e atendimento — documentados e prontos para rodar." },
        { n: "B", titulo: "Implantação com banco de dados exclusivo", desc: "Ambiente e base de dados dedicados ao seu negócio, configurados conforme os processos definidos. Os dados são seus." },
        { n: "C", titulo: "Treinamento e acompanhamento da equipe", desc: "Capacitação por área, materiais de apoio e acompanhamento ao longo do programa até a rotina estar de pé." },
        { n: "D", titulo: "Suporte e manutenção da plataforma", desc: "Correções, ajustes e manutenções evolutivas da plataforma durante os 12 meses do programa." },
      ],
    },
    modulos: {
      eyebrow: "A plataforma", titulo: "Cobre o restaurante de ponta a ponta",
      nota: "Os módulos são ativados conforme o escopo definido no diagnóstico — você não paga por complexidade que não usa.",
      grupos: [
        { titulo: "Pessoas & DP", itens: ["Cadastro unificado de pessoas + permissões por perfil", "Admissão digital e processo seletivo", "Fábrica de documentos (contratos e termos)", "Uniformes & EPIs", "Prazos trabalhistas e análise de ponto"] },
        { titulo: "Financeiro", itens: ["Fechamento de caixa por turno", "Fechamento financeiro mensal", "Benefícios (VT / VR) e gorjetas"] },
        { titulo: "Operação & Estoque", itens: ["Escala e previsão", "Contagens, compras e recebimento de NF", "Fichas técnicas e CMV", "Checklists operacionais e segurança sanitária"] },
        { titulo: "Atendimento, Vendas & IA", itens: ["Reservas + CRM e eventos", "Inbox de WhatsApp para atendimento", "Cardápio digital", "Agentes de IA (DP, financeiro, vendas) e wiki de processos"] },
      ],
    },
    fases: {
      eyebrow: "Como acontece", titulo: "A implantação em seis fases",
      callout: "A modelagem dos processos é feita com você. Depende da participação ativa do cliente — pessoas-chave disponíveis, acesso às informações e decisões no tempo do cronograma. É o que garante processos que refletem o seu negócio, e não um modelo genérico.",
      itens: [
        { when: "Semanas 1–2", titulo: "Diagnóstico e mapeamento", desc: "Imersão na operação: como funciona hoje, gargalos e prioridades. Definição do escopo de módulos." },
        { when: "Semanas 2–6", titulo: "Formulação de processos", desc: "Desenho dos processos por área, com responsáveis e prazos. Entregue documentado — o alicerce da configuração." },
        { when: "Semanas 4–8", titulo: "Configuração + banco de dados", desc: "Ambiente dedicado provisionado e a plataforma configurada: empresas, cargos, permissões e módulos." },
        { when: "Semanas 6–9", titulo: "Migração e integrações", desc: "Carga dos cadastros e do histórico relevante; conexões com as ferramentas já usadas (ponto, benefícios) quando aplicável." },
        { when: "Semanas 9–11", titulo: "Treinamento e go-live", desc: "Capacitação por área e virada de chave assistida — a equipe começa a operar com suporte próximo." },
        { when: "Meses 3–12", titulo: "Acompanhamento e evolução", desc: "Ajustes finos, manutenção e acompanhamento dos indicadores até o modelo rodar sozinho." },
      ],
    },
    entregaveis: {
      eyebrow: "Entregáveis", titulo: "O que fica com você ao fim",
      recebe: ["Manual de processos por área, documentado", "Sistema configurado e em operação", "Banco de dados e ambiente exclusivos — dados seus", "Equipe treinada por área", "Materiais de apoio e wiki de processos", "12 meses de suporte e manutenção"],
      cliente: ["Assinaturas de IA, Firebase, hospedagem e serviços de terceiros (ponto, benefícios, WhatsApp oficial, e-mail)", "Desenvolvimento de módulos novos sob demanda (orçado à parte)", "Hardware, relógios de ponto e equipamentos", "Operação do negócio no dia a dia (a gestão é sua)"],
    },
    investimento: {
      eyebrow: "Investimento", titulo: "Valor e forma de pagamento",
      callout: "Desconto early buyer −25%. Aplica-se por você estar entre as 3 primeiras consultorias com implantação do sistema — incentivo a quem acredita no modelo e entende que estamos no momento de formatação final da consultoria, construindo o formato definitivo junto com os primeiros clientes. De R$ 84.000 por R$ 63.000.",
      total: "R$ 63.000", totalNota: "Tabela R$ 84.000 · early buyer −25% (−R$ 21.000)",
      parcelas: "12 × R$ 5.250", parcelasNota: "1ª parcela na assinatura · demais mensais",
      composicao: [
        { item: "Diagnóstico e mapeamento do negócio", valor: "R$ 8.000" },
        { item: "Formulação e redesenho de processos", valor: "R$ 18.000" },
        { item: "Implantação e configuração (ambiente + banco de dados)", valor: "R$ 20.000" },
        { item: "Migração de dados e integrações", valor: "R$ 8.000" },
        { item: "Treinamento da equipe", valor: "R$ 8.000" },
        { item: "Acompanhamento, suporte e manutenção (12 meses)", valor: "R$ 22.000" },
      ],
      rodape: "Contempla 144 horas de trabalho ao longo do contrato — reuniões, alinhamentos e confecção de processos —, distribuídas conforme melhor convier, com alinhamento prévio. Pagamento único, em 12 parcelas iguais.",
    },
    terceiros: {
      eyebrow: "Custos de terceiros", titulo: "Ferramentas pagas direto ao fornecedor",
      intro: "O sistema roda sobre serviços cobrados conforme o uso, pagos diretamente aos fornecedores em nome do cliente. Estimativas para uma operação típica:",
      linhas: [
        { servico: "Firebase", oque: "Banco de dados e sincronização em nuvem", estimativa: "grátis a ~R$ 80" },
        { servico: "Ferramentas de IA", oque: "Agentes, transcrição, leitura de documentos — opcional", estimativa: "R$ 0 *" },
        { servico: "API do WhatsApp", oque: "Atendimento pelo número; custo só em disparos oficiais em volume", estimativa: "grátis no uso padrão" },
        { servico: "Hospedagem", oque: "Onde o sistema fica no ar", estimativa: "grátis a ~R$ 130" },
      ],
      nota: "* IA opcional: só há custo se usar os recursos de inteligência artificial — depende da ferramenta escolhida, podendo ser gratuito. O framework do sistema é gratuito; o que se paga é a hospedagem.",
    },
    continuidade: {
      eyebrow: "Depois do programa", titulo: "Continuidade — três opções",
      planos: [
        { titulo: "1 · Uso + manutenção técnica", desc: "Uso do sistema e manutenção técnica, sem nova consultoria. Segue recebendo correções e ajustes.", valor: "R$ 399 /mês · anual", nota: "R$ 499 · early buyer −R$ 100" },
        { titulo: "2 · Renovação da consultoria", desc: "Renova o programa — que já inclui o sistema — com ajuste caso haja redução de escopo. Sujeito a atualização do orçamento e correção monetária." },
        { titulo: "3 · Compra do sistema formatado", desc: "Fica com o sistema já formatado, em pagamento único, sem mensalidade. Em contrapartida, sem continuidade de atualizações — permanece na versão entregue.", valor: "R$ 9.000 único" },
      ],
      nota: "Valores sujeitos a correção monetária anual (exceto a compra única). Não inclui as assinaturas de terceiros.",
    },
    termos: {
      eyebrow: "Condições comerciais", titulo: "Termos do programa",
      itens: [
        { t: "Pagamento", d: "12 parcelas mensais de R$ 5.250,00 (total R$ 63.000,00, já com o desconto early buyer de 25% sobre a tabela de R$ 84.000,00). 1ª parcela na assinatura; demais no mesmo dia dos meses seguintes." },
        { t: "Condição early buyer", d: "Desconto de 25% e valor reduzido de continuidade são condição de lançamento, para as 3 primeiras consultorias com implantação. Reconhece quem entra no momento de formatação final do modelo e participa da construção do formato definitivo." },
        { t: "Início", d: "Em até 10 dias úteis após o aceite e a confirmação da 1ª parcela." },
        { t: "Dedicação", d: "144 horas de trabalho ao longo do contrato, distribuídas conforme melhor convier às partes, com alinhamento prévio de agenda." },
        { t: "Participação do cliente", d: "A modelagem depende da participação ativa do cliente: pessoas-chave disponíveis, acesso às informações e decisões no prazo. Atrasos podem impactar a entrega." },
        { t: "Banco de dados", d: "Ambiente e base exclusivos do cliente. Os dados são de propriedade do cliente e podem ser exportados a qualquer tempo." },
        { t: "Após 12 meses", d: "Três opções: (1) uso + manutenção por R$ 399/mês no anual; (2) renovação da consultoria (já inclui o sistema); ou (3) compra do sistema formatado por R$ 9.000, sem mensalidade e sem atualizações. Sem continuidade, o sistema permanece funcional com os dados do cliente." },
        { t: "Por conta do cliente", d: "Assinaturas de terceiros (IA, Firebase, hospedagem, ponto, benefícios, WhatsApp oficial, e-mail). Novos módulos e equipamentos são orçados à parte." },
        { t: "Validade", d: "Esta proposta é válida por 7 dias a partir da data de emissão." },
      ],
    },
  };
}
