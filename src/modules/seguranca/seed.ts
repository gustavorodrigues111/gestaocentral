// Checklist-modelo SEMENTE — lista real da nutricionista (Amanda), já REFINADA
// pelo Gustavo no restaurante Sororoca: cada pergunta com suas áreas e a
// quantidade de perguntas reduzida (37 itens). É o que o botão "Criar modelo
// inicial / Novo da lista-base" gera pra qualquer restaurante. UMA pergunta pode
// valer pra várias áreas — no preenchimento recebe um Conforme/Não conforme POR
// ÁREA. Editável no ⚙ Configurações.
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

// 37 itens — extraídos do modelo refinado do Sororoca (áreas por pergunta).
export const SEED_ITENS: SegurancaItem[] = [
  it("s01", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Ausência de alimentos e bebidas fora do prazo de validade?"),
  it("s02", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Ausência de alimentos e bebidas fora do padrão de qualidade?"),
  it("s03", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Existem alimentos e bebidas próximos ao vencimento?", false),
  it("s04", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Ausência de alimentos e bebidas sem identificação correta conforme a T° de conservação?"),
  it("s05", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Ausência de alimentos e bebidas sem proteção / com embalagem íntegra?"),
  it("s06", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Produtos para troca corretamente identificados e separados?"),
  it("s07", "b_recebimento", ["Cozinha", "Bar", "Salão"], "Tempo de espera do recebimento/armazenamento adequado (alimentos e bebidas não ficam em T° de risco)?"),
  it("s08", "b_bpf", ["Cozinha", "Bar", "Salão"], "Alimentos e bebidas armazenados com método de organização PVPS ou PEPS?"),
  it("s09", "b_bpf", ["Cozinha", "Bar"], "Ausência de alimentos fora de acondicionamento correto / T° de conservação?"),
  it("s10", "b_bpf", ["Cozinha", "Bar", "Salão"], "Ausência de produtos diretamente no chão?"),
  it("s11", "b_bpf", ["Cozinha", "Bar", "Salão"], "Ausência de materiais proibidos (pano de algodão/madeira/papelão/esponja imersa em água/itens em desuso)?"),
  it("s12", "b_bpf", ["Cozinha", "Bar"], "O descongelamento está sendo realizado de forma adequada?"),
  it("s13", "b_bpf", ["Cozinha"], "Bombona de óleo limpa, sob estrado ou prateleira e devidamente fechada?"),
  it("s14", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Manipulação sendo feita de forma que não ocorra contaminação?"),
  it("s15", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Ausência de itens pessoais (chave, carteira, celular) na área de manipulação/armazenamento?"),
  it("s16", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Manipuladores devidamente uniformizados (uniforme completo e limpo)?"),
  it("s17", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Manipuladores utilizam EPI / EPC de forma correta?"),
  it("s18", "b_manipuladores", ["Cozinha", "Bar"], "EPI / EPC em boas condições, limpos e em quantidade suficiente?"),
  it("s19", "b_manipuladores", ["Cozinha", "Bar", "Salão"], "Ausência de manipuladores com barba/bigode / sem touca / com adorno?"),
  it("s20", "b_manipuladores", ["Cozinha", "Bar"], "Lavagem de mãos frequente e pias abastecidas (papel não reciclável, álcool 70%, sabonete líquido sem odor, antisséptico)?"),
  it("s21", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("s22", "b_higiene", ["Cozinha", "Bar", "Limpeza"], "Ralos com sistema abre e fecha funcionante, devidamente fechados e limpos?"),
  it("s23", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Equipamentos limpos e organizados?"),
  it("s24", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Utensílios limpos / armazenados de forma correta / em bom estado de conservação?"),
  it("s25", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Móveis e bancadas limpos e organizados?"),
  it("s26", "b_higiene", ["Cozinha", "Bar", "Salão"], "Equipamentos de refrigeração com temperatura adequada?"),
  it("s27", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Ausência de vestígios de pragas ou pragas?"),
  it("s28", "b_documentacao", ["Cozinha", "Bar", "Salão"], "Planilha de T° dos equipamentos de refrigeração preenchida diariamente nos dois turnos?"),
  it("s29", "b_documentacao", ["Cozinha", "Bar", "Salão"], "Planilha de recebimento dos alimentos perecíveis feita de forma correta e frequente?"),
  it("s30", "b_qualidade", ["Cozinha", "Bar", "Salão"], "Ausência de bebidas/insumos sem proteção (ex.: gelo protegido, não solto na gaveta)?"),
  it("s31", "b_qualidade", ["Salão"], "Alimentos/bebidas expostos ao consumo devidamente protegidos (quando houver exposição)?", false),
  it("s32", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Lixeiras limpas / com abertura por pedal em bom estado / manejo de lixo correto?"),
  it("s33", "b_higiene", ["Cozinha", "Bar", "Salão", "Limpeza"], "Louças e talheres limpos / armazenados de forma correta / em bom estado?"),
  it("s34", "b_higiene", ["Limpeza"], "Banheiros limpos, higienizados e abastecidos (papel, sabonete, papel toalha)?"),
  it("s35", "b_higiene", ["Limpeza"], "Itens de limpeza armazenados de forma correta (rodo, vassoura e pá de lixo)?"),
  it("s36", "b_higiene", ["Limpeza"], "Produtos de limpeza dentro do prazo de validade e devidamente identificados?"),
  it("s37", "b_higiene", ["Limpeza"], "Depósito de material de limpeza (DML) e áreas de circulação limpos e organizados?"),
];
