// Checklist-modelo SEMENTE — lista real da nutricionista (Amanda), agora
// CONSOLIDADA: UMA pergunta pode valer pra VÁRIAS áreas (ex.: "alimentos e
// bebidas fora do prazo" → Cozinha+Bar). No preenchimento a pergunta aparece
// uma vez e recebe um Conforme/Não conforme POR ÁREA. Perguntas específicas de
// uma área (descongelamento, máquina de gelo, etc.) ficam com uma área só.
// Editável no ⚙ Configurações — a Amanda refina áreas e adiciona/remove.
import type { SegurancaBloco, SegurancaItem } from "../../core/types";
import { SEGURANCA_FAIXAS_PADRAO, SEG_AREAS_PADRAO } from "../../core/types";

export const SEED_FAIXAS = SEGURANCA_FAIXAS_PADRAO;
export const SEED_AREAS = SEG_AREAS_PADRAO; // ["Cozinha","Bar","Salão","Limpeza"]

export const SEED_BLOCOS: SegurancaBloco[] = [
  { id: "b_qualidade", nome: "Qualidade dos alimentos e bebidas", ordem: 1 },
  { id: "b_recebimento", nome: "Recebimento", ordem: 2 },
  { id: "b_bpf", nome: "Boas práticas de fabricação", ordem: 3 },
  { id: "b_manipuladores", nome: "Manipuladores / equipe", ordem: 4 },
  { id: "b_higiene", nome: "Higiene ambiental", ordem: 5 },
  { id: "b_documentacao", nome: "Documentação obrigatória", ordem: 6 },
];

let _ord = 0;
const it = (id: string, bloco: string, areas: string[], texto: string, pontua = true): SegurancaItem =>
  ({ id, texto, blocoId: bloco, areas, ordem: ++_ord, pontua });

const COZ_BAR = ["Cozinha", "Bar"];

export const SEED_ITENS: SegurancaItem[] = [
  // ═══ QUALIDADE ═══ (alimentos = Cozinha, bebidas = Bar → uma pergunta só)
  it("q_prazo", "b_qualidade", COZ_BAR, "Ausência de alimentos e bebidas fora do prazo de validade?"),
  it("q_padrao", "b_qualidade", COZ_BAR, "Ausência de alimentos e bebidas fora do padrão de qualidade?"),
  it("q_venc", "b_qualidade", COZ_BAR, "Existem alimentos ou bebidas próximos ao vencimento?", false),
  it("q_ident", "b_qualidade", COZ_BAR, "Ausência de itens sem identificação correta conforme a T° de conservação?"),
  it("q_prot", "b_qualidade", COZ_BAR, "Ausência de alimentos/bebidas sem proteção / com embalagem íntegra (ex.: gelo protegido)?"),
  it("q_troca", "b_qualidade", COZ_BAR, "Produtos para troca corretamente identificados e separados?"),
  it("q_expo", "b_qualidade", ["Salão"], "Alimentos/bebidas expostos ao consumo devidamente protegidos (quando houver exposição)?", false),

  // ═══ RECEBIMENTO ═══
  it("r_espera", "b_recebimento", COZ_BAR, "Tempo de espera do recebimento/armazenamento adequado (não fica em T° de risco)?"),

  // ═══ BOAS PRÁTICAS DE FABRICAÇÃO ═══
  it("f_peps", "b_bpf", COZ_BAR, "Itens armazenados com método de organização PVPS ou PEPS?"),
  it("f_acond", "b_bpf", COZ_BAR, "Ausência de itens fora de acondicionamento correto / T° de conservação?"),
  it("f_chao", "b_bpf", COZ_BAR, "Ausência de produtos diretamente no chão?"),
  it("f_proib", "b_bpf", COZ_BAR, "Ausência de materiais proibidos (pano de algodão/madeira/papelão/esponja imersa em água/itens em desuso)?"),
  it("f_desc", "b_bpf", ["Cozinha"], "O descongelamento está sendo realizado de forma adequada?"),
  it("f_oleo", "b_bpf", ["Cozinha"], "Bombona de óleo limpa, sob estrado ou prateleira e devidamente fechada?"),

  // ═══ MANIPULADORES / EQUIPE ═══
  it("m_contam", "b_manipuladores", COZ_BAR, "Manipulação/preparo sendo feito de forma que não ocorra contaminação?"),
  it("m_pessoal", "b_manipuladores", COZ_BAR, "Ausência de itens pessoais (chave, carteira, celular) na área de manipulação?"),
  it("m_unif", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Equipe devidamente uniformizada e com boa apresentação (uniforme completo e limpo)?"),
  it("m_epi", "b_manipuladores", COZ_BAR, "Uso correto de EPI / EPC?"),
  it("m_epi_cond", "b_manipuladores", COZ_BAR, "EPI / EPC em boas condições, limpos e em quantidade suficiente?"),
  it("m_adorno", "b_manipuladores", COZ_BAR, "Ausência de manipuladores com barba/bigode / sem touca / com adorno?"),
  it("m_maos", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Lavagem de mãos frequente e pias abastecidas (papel não reciclável, álcool 70%, sabonete líquido, antisséptico)?"),

  // ═══ HIGIENE AMBIENTAL ═══
  it("h_areas", "b_higiene", ["Cozinha", "Bar", "Salão"], "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("h_ralos", "b_higiene", COZ_BAR, "Ralos com sistema abre e fecha funcionante, devidamente fechados e limpos?"),
  it("h_equip", "b_higiene", COZ_BAR, "Equipamentos limpos e organizados?"),
  it("h_utens", "b_higiene", COZ_BAR, "Utensílios limpos / armazenados de forma correta / em bom estado de conservação?"),
  it("h_moveis", "b_higiene", ["Cozinha", "Bar", "Salão"], "Móveis, bancadas e balcões limpos e organizados?"),
  it("h_refri", "b_higiene", COZ_BAR, "Equipamentos de refrigeração com temperatura adequada?"),
  it("h_pragas", "b_higiene", ["Cozinha", "Bar", "Salão"], "Ausência de vestígios de pragas ou pragas?"),

  // ═══ DOCUMENTAÇÃO OBRIGATÓRIA ═══
  it("d_temp", "b_documentacao", COZ_BAR, "Planilha de T° dos equipamentos de refrigeração preenchida diariamente nos dois turnos?"),
  it("d_receb", "b_documentacao", ["Cozinha"], "Planilha de recebimento dos alimentos perecíveis feita de forma correta e frequente?"),

  // ═══ LIMPEZA (área própria) ═══
  it("l_lixo", "b_higiene", ["Limpeza"], "Lixeiras limpas / com abertura por pedal em bom estado / manejo de lixo correto?"),
  it("l_loucas", "b_higiene", ["Limpeza"], "Louças e talheres limpos / armazenados de forma correta / em bom estado?"),
  it("l_banheiro", "b_higiene", ["Limpeza"], "Banheiros limpos, higienizados e abastecidos (papel, sabonete, papel toalha)?"),
  it("l_mat", "b_higiene", ["Limpeza"], "Itens de limpeza armazenados de forma correta (rodo, vassoura e pá de lixo)?"),
  it("l_prazo", "b_higiene", ["Limpeza"], "Produtos de limpeza dentro do prazo de validade e devidamente identificados?"),
  it("l_dml", "b_higiene", ["Limpeza"], "Depósito de material de limpeza (DML) e áreas de circulação limpos e organizados?"),
];
