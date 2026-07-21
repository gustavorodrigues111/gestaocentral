// Checklist-modelo SEMENTE — a lista real que a nutricionista (Amanda) já aplica
// no Sororoca/Lobozó, extraída do PDF de auditoria. Usada pelo botão provisório
// "Criar modelo inicial". Todos os itens começam disponíveis nas 4 áreas
// (Cozinha/Bar/Salão/Limpeza); a nutricionista responde os que se aplicam em
// cada área e refina depois na configuração. Item "sem pontuação" → pontua:false.
import type { SegurancaBloco, SegurancaItem } from "../../core/types";
import { AREAS, SEGURANCA_FAIXAS_PADRAO } from "../../core/types";

export const SEED_FAIXAS = SEGURANCA_FAIXAS_PADRAO;

export const SEED_BLOCOS: SegurancaBloco[] = [
  { id: "b_qualidade", nome: "Qualidade dos alimentos", ordem: 1 },
  { id: "b_recebimento", nome: "Recebimento dos alimentos / bebidas / produtos", ordem: 2 },
  { id: "b_bpf", nome: "Boas práticas de fabricação", ordem: 3 },
  { id: "b_manipuladores", nome: "Manipuladores de alimentos", ordem: 4 },
  { id: "b_higiene", nome: "Higiene ambiental", ordem: 5 },
  { id: "b_documentacao", nome: "Documentação obrigatória", ordem: 6 },
];

// Helper: monta o item com áreas = todas e pontua = true (default).
const it = (id: string, blocoId: string, ordem: number, texto: string, pontua = true): SegurancaItem =>
  ({ id, texto, blocoId, ordem, pontua, areas: [...AREAS] });

export const SEED_ITENS: SegurancaItem[] = [
  // Qualidade dos alimentos
  it("q1", "b_qualidade", 1, "Ausência de alimentos e bebidas fora do prazo de validade?"),
  it("q2", "b_qualidade", 2, "Ausência de alimentos e bebidas fora do padrão da qualidade?"),
  it("q3", "b_qualidade", 3, "Existem alimentos/bebidas próximos ao vencimento?", false),
  it("q4", "b_qualidade", 4, "Ausência de alimentos e bebidas sem correta identificação de acordo com a T° de conservação?"),
  it("q5", "b_qualidade", 5, "Ausência de alimentos e bebidas sem proteção / com embalagem íntegra?"),
  it("q6", "b_qualidade", 6, "Produtos para troca corretamente identificados e separados?"),
  // Recebimento
  it("r1", "b_recebimento", 1, "Tempo de espera do recebimento e armazenamento está adequado, de forma que os alimentos não percam qualidade e/ou fiquem em T° de risco?"),
  // Boas práticas de fabricação
  it("f1", "b_bpf", 1, "Alimentos e bebidas devidamente armazenados com método de organização PVPS ou PEPS?"),
  it("f2", "b_bpf", 2, "Ausência de alimentos e bebidas fora de acondicionamento correto / T° de conservação?"),
  it("f3", "b_bpf", 3, "Ausência de produtos diretamente no chão?"),
  it("f4", "b_bpf", 4, "Ausência de materiais proibidos (pano de algodão / madeira / papelão / esponja imersa em água / itens em desuso)?"),
  it("f5", "b_bpf", 5, "O descongelamento está sendo realizado de forma adequada?"),
  it("f6", "b_bpf", 6, "Bombona de óleo limpa, sob estrado ou prateleira e devidamente fechada?"),
  // Manipuladores
  it("m1", "b_manipuladores", 1, "Manipulação sendo feita de forma que não ocorra contaminação?"),
  it("m2", "b_manipuladores", 2, "Ausência de itens pessoais (chave, carteira, celular) nas áreas de manipulação e armazenamento?"),
  it("m3", "b_manipuladores", 3, "Manipuladores devidamente uniformizados (uniforme completo e limpo)?"),
  it("m4", "b_manipuladores", 4, "Manipuladores utilizam EPI / EPC de forma correta?"),
  it("m5", "b_manipuladores", 5, "EPI / EPC em boas condições, limpos e em quantidade suficiente?"),
  it("m6", "b_manipuladores", 6, "Ausência de manipuladores com barba / bigode / sem touca / com adorno?"),
  it("m7", "b_manipuladores", 7, "Frequência de lavagem de mãos observada e pias abastecidas (papel não reciclável, álcool 70%, sabonete líquido sem odor e antisséptico)?"),
  // Higiene ambiental
  it("h1", "b_higiene", 1, "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("h2", "b_higiene", 2, "Ralos com sistema abre e fecha funcionante, devidamente fechados e limpos?"),
  it("h3", "b_higiene", 3, "Lixeiras limpas / com abertura por pedal em bom estado / manejo de lixo correto?"),
  it("h4", "b_higiene", 4, "Equipamentos limpos e organizados?"),
  it("h5", "b_higiene", 5, "Utensílios limpos / armazenados de forma correta / em bom estado de conservação?"),
  it("h6", "b_higiene", 6, "Móveis limpos e organizados?"),
  it("h7", "b_higiene", 7, "Equipamentos de refrigeração com temperatura adequada?"),
  it("h8", "b_higiene", 8, "Ausência de vestígios de pragas ou pragas?"),
  it("h9", "b_higiene", 9, "Itens de limpeza armazenados de forma correta (rodo / vassoura e pá de lixo)?"),
  it("h10", "b_higiene", 10, "Produtos de limpeza dentro do prazo de validade e devidamente identificados?"),
  // Documentação
  it("d1", "b_documentacao", 1, "Planilha de T° dos equipamentos de refrigeração sendo preenchida diariamente nos dois turnos?"),
  it("d2", "b_documentacao", 2, "Planilha de recebimento dos alimentos perecíveis sendo feita de forma correta e frequente?"),
];
