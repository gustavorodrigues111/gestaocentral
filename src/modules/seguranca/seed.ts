// Checklist-modelo SEMENTE — lista real da nutricionista (Amanda) já DISTRIBUÍDA
// por área. Um checklist só; cada item pertence a uma área (Cozinha/Bar/Salão/
// Limpeza). Perguntas de "alimentos e bebidas" foram separadas (alimentos→Cozinha,
// bebidas→Bar); itens de ambiente foram duplicados por área; lixeiras, louças,
// banheiros e material de limpeza ficam em Limpeza. Editável no ⚙ Configurações.
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
const it = (id: string, bloco: string, area: string, texto: string, pontua = true): SegurancaItem =>
  ({ id, texto, blocoId: bloco, area, ordem: ++_ord, pontua });

export const SEED_ITENS: SegurancaItem[] = [
  // ═══ COZINHA ═══
  it("coz_q1", "b_qualidade", "Cozinha", "Ausência de alimentos fora do prazo de validade?"),
  it("coz_q2", "b_qualidade", "Cozinha", "Ausência de alimentos fora do padrão de qualidade?"),
  it("coz_q3", "b_qualidade", "Cozinha", "Existem alimentos próximos ao vencimento?", false),
  it("coz_q4", "b_qualidade", "Cozinha", "Ausência de alimentos sem identificação correta conforme a T° de conservação?"),
  it("coz_q5", "b_qualidade", "Cozinha", "Ausência de alimentos sem proteção / com embalagem íntegra?"),
  it("coz_q6", "b_qualidade", "Cozinha", "Produtos para troca (alimentos) corretamente identificados e separados?"),
  it("coz_r1", "b_recebimento", "Cozinha", "Tempo de espera do recebimento/armazenamento adequado (alimentos não ficam em T° de risco)?"),
  it("coz_f1", "b_bpf", "Cozinha", "Alimentos armazenados com método de organização PVPS ou PEPS?"),
  it("coz_f2", "b_bpf", "Cozinha", "Ausência de alimentos fora de acondicionamento correto / T° de conservação?"),
  it("coz_f3", "b_bpf", "Cozinha", "Ausência de produtos diretamente no chão?"),
  it("coz_f4", "b_bpf", "Cozinha", "Ausência de materiais proibidos (pano de algodão/madeira/papelão/esponja imersa em água/itens em desuso)?"),
  it("coz_f5", "b_bpf", "Cozinha", "O descongelamento está sendo realizado de forma adequada?"),
  it("coz_f6", "b_bpf", "Cozinha", "Bombona de óleo limpa, sob estrado ou prateleira e devidamente fechada?"),
  it("coz_m1", "b_manipuladores", "Cozinha", "Manipulação sendo feita de forma que não ocorra contaminação?"),
  it("coz_m2", "b_manipuladores", "Cozinha", "Ausência de itens pessoais (chave, carteira, celular) na área de manipulação/armazenamento?"),
  it("coz_m3", "b_manipuladores", "Cozinha", "Manipuladores devidamente uniformizados (uniforme completo e limpo)?"),
  it("coz_m4", "b_manipuladores", "Cozinha", "Manipuladores utilizam EPI / EPC de forma correta?"),
  it("coz_m5", "b_manipuladores", "Cozinha", "EPI / EPC em boas condições, limpos e em quantidade suficiente?"),
  it("coz_m6", "b_manipuladores", "Cozinha", "Ausência de manipuladores com barba/bigode / sem touca / com adorno?"),
  it("coz_m7", "b_manipuladores", "Cozinha", "Lavagem de mãos frequente e pias abastecidas (papel não reciclável, álcool 70%, sabonete líquido sem odor, antisséptico)?"),
  it("coz_h1", "b_higiene", "Cozinha", "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("coz_h2", "b_higiene", "Cozinha", "Ralos com sistema abre e fecha funcionante, devidamente fechados e limpos?"),
  it("coz_h3", "b_higiene", "Cozinha", "Equipamentos limpos e organizados?"),
  it("coz_h4", "b_higiene", "Cozinha", "Utensílios limpos / armazenados de forma correta / em bom estado de conservação?"),
  it("coz_h5", "b_higiene", "Cozinha", "Móveis e bancadas limpos e organizados?"),
  it("coz_h6", "b_higiene", "Cozinha", "Equipamentos de refrigeração com temperatura adequada?"),
  it("coz_h7", "b_higiene", "Cozinha", "Ausência de vestígios de pragas ou pragas?"),
  it("coz_d1", "b_documentacao", "Cozinha", "Planilha de T° dos equipamentos de refrigeração preenchida diariamente nos dois turnos?"),
  it("coz_d2", "b_documentacao", "Cozinha", "Planilha de recebimento dos alimentos perecíveis feita de forma correta e frequente?"),

  // ═══ BAR ═══
  it("bar_q1", "b_qualidade", "Bar", "Ausência de bebidas fora do prazo de validade?"),
  it("bar_q2", "b_qualidade", "Bar", "Ausência de bebidas fora do padrão de qualidade?"),
  it("bar_q3", "b_qualidade", "Bar", "Existem bebidas próximas ao vencimento?", false),
  it("bar_q4", "b_qualidade", "Bar", "Ausência de bebidas sem identificação correta conforme a T° de conservação?"),
  it("bar_q5", "b_qualidade", "Bar", "Ausência de bebidas/insumos sem proteção (ex.: gelo protegido, não solto na gaveta)?"),
  it("bar_q6", "b_qualidade", "Bar", "Produtos para troca (bebidas) corretamente identificados e separados?"),
  it("bar_r1", "b_recebimento", "Bar", "Tempo de espera do recebimento/armazenamento de bebidas e insumos adequado?"),
  it("bar_f1", "b_bpf", "Bar", "Bebidas/insumos armazenados com método de organização PVPS ou PEPS?"),
  it("bar_f2", "b_bpf", "Bar", "Ausência de bebidas/insumos fora de acondicionamento correto / T° de conservação?"),
  it("bar_f3", "b_bpf", "Bar", "Ausência de produtos diretamente no chão?"),
  it("bar_f4", "b_bpf", "Bar", "Ausência de materiais proibidos (pano de algodão/madeira/papelão/esponja imersa em água/itens em desuso)?"),
  it("bar_m1", "b_manipuladores", "Bar", "Preparo (drinks) sendo feito de forma que não ocorra contaminação?"),
  it("bar_m2", "b_manipuladores", "Bar", "Ausência de itens pessoais (chave, carteira, celular) na área de manipulação do bar?"),
  it("bar_m3", "b_manipuladores", "Bar", "Bartenders devidamente uniformizados (uniforme completo e limpo)?"),
  it("bar_m4", "b_manipuladores", "Bar", "Uso correto de EPI / EPC?"),
  it("bar_m5", "b_manipuladores", "Bar", "EPI / EPC em boas condições, limpos e em quantidade suficiente?"),
  it("bar_m6", "b_manipuladores", "Bar", "Ausência de manipuladores com barba/bigode / sem touca / com adorno?"),
  it("bar_m7", "b_manipuladores", "Bar", "Lavagem de mãos frequente e pia do bar abastecida (papel, álcool 70%, sabonete, antisséptico)?"),
  it("bar_h1", "b_higiene", "Bar", "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("bar_h2", "b_higiene", "Bar", "Ralos com sistema abre e fecha funcionante, devidamente fechados e limpos?"),
  it("bar_h3", "b_higiene", "Bar", "Equipamentos limpos e organizados (liquidificador, frigobar, máquina de gelo, etc.)?"),
  it("bar_h4", "b_higiene", "Bar", "Utensílios limpos / armazenados de forma correta / em bom estado?"),
  it("bar_h5", "b_higiene", "Bar", "Móveis e balcão do bar limpos e organizados?"),
  it("bar_h6", "b_higiene", "Bar", "Frigobar/refrigeração do bar com temperatura adequada?"),
  it("bar_h7", "b_higiene", "Bar", "Ausência de vestígios de pragas ou pragas?"),
  it("bar_d1", "b_documentacao", "Bar", "Planilha de T° do frigobar/refrigeração do bar preenchida diariamente nos dois turnos?"),

  // ═══ SALÃO ═══
  it("sal_h1", "b_higiene", "Salão", "Áreas limpas e organizadas (teto, parede, piso, rodapé)?"),
  it("sal_h2", "b_higiene", "Salão", "Móveis limpos e organizados (mesas, cadeiras, aparadores)?"),
  it("sal_h3", "b_higiene", "Salão", "Ausência de vestígios de pragas ou pragas?"),
  it("sal_m1", "b_manipuladores", "Salão", "Equipe de salão com boa apresentação e higiene (uniforme limpo, mãos higienizadas)?"),
  it("sal_q1", "b_qualidade", "Salão", "Alimentos/bebidas expostos ao consumo devidamente protegidos (quando houver exposição)?", false),

  // ═══ LIMPEZA ═══
  it("lmp_h1", "b_higiene", "Limpeza", "Lixeiras limpas / com abertura por pedal em bom estado / manejo de lixo correto?"),
  it("lmp_h2", "b_higiene", "Limpeza", "Louças e talheres limpos / armazenados de forma correta / em bom estado?"),
  it("lmp_h3", "b_higiene", "Limpeza", "Banheiros limpos, higienizados e abastecidos (papel, sabonete, papel toalha)?"),
  it("lmp_h4", "b_higiene", "Limpeza", "Itens de limpeza armazenados de forma correta (rodo, vassoura e pá de lixo)?"),
  it("lmp_h5", "b_higiene", "Limpeza", "Produtos de limpeza dentro do prazo de validade e devidamente identificados?"),
  it("lmp_h6", "b_higiene", "Limpeza", "Depósito de material de limpeza (DML) e áreas de circulação limpos e organizados?"),
];
