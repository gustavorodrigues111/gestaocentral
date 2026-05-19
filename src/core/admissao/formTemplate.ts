// ════════════════════════════════════════════════════════════════════════════
//  Template default do formulário de admissão — baseado na ficha Senador
//  Contábil. Cada restaurante começa com esse schema; pode editar livremente.
// ════════════════════════════════════════════════════════════════════════════

import type { FormField } from "../types";

// Helper local pra reduzir verbosidade ao declarar 50+ campos.
function f(
  id: string,
  label: string,
  tipo: FormField["tipo"],
  grupo: string,
  obrigatorio: boolean = false,
  extra: Partial<FormField> = {},
): FormField {
  return {
    id,
    label,
    tipo,
    grupo,
    obrigatorio,
    ordem: 0, // setado em pós-processamento
    ativo: true,
    ...extra,
  };
}

const G_PESSOAL = "Dados pessoais";
const G_CONTATO = "Contato";
const G_END     = "Endereço";
const G_DOCS    = "Documentos";
const G_BANCO   = "Banco";
const G_DEPS    = "Dependentes";
const G_TRANS   = "Transporte";

// Lista declarada na ordem em que aparece no form. Pós-processamento atribui
// `ordem` (1, 2, 3, ...). RH pode reordenar depois via drag-drop.
const RAW: FormField[] = [
  // ─── Dados pessoais ───
  f("nome_completo",   "Nome completo",       "text",     G_PESSOAL, true),
  f("data_nascimento", "Data de nascimento",  "data",     G_PESSOAL, true),
  f("naturalidade",    "Naturalidade (Município/UF)", "text", G_PESSOAL, true),
  f("nacionalidade",   "Nacionalidade",       "text",     G_PESSOAL, true, { placeholder: "Brasileira" }),
  f("sexo",            "Sexo",                "select",   G_PESSOAL, true, { opcoes: ["Masculino", "Feminino", "Outro"] }),
  f("cor",             "Cor/Raça",            "select",   G_PESSOAL, false, { opcoes: ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"] }),
  f("escolaridade",    "Escolaridade",        "select",   G_PESSOAL, false, {
    opcoes: ["Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação"],
  }),
  f("estado_civil",    "Estado civil",        "select",   G_PESSOAL, true, { opcoes: ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"] }),
  f("num_filhos",      "Número de filhos",    "numero",   G_PESSOAL, false),
  f("nome_pai",        "Nome do pai",         "text",     G_PESSOAL, false),
  f("nome_mae",        "Nome da mãe",         "text",     G_PESSOAL, true),

  // ─── Contato ───
  // `whatsapp` é pré-preenchido pela página pública (vem do cadastro do RH)
  f("whatsapp",        "WhatsApp",            "telefone", G_CONTATO, true),
  f("tel_residencial", "Telefone residencial", "telefone", G_CONTATO, false),
  f("tel_emergencia",  "Telefone de emergência", "telefone", G_CONTATO, false),
  f("contato_emergencia_nome", "Nome do contato de emergência", "text", G_CONTATO, false),

  // ─── Endereço ───
  f("endereco_logradouro", "Endereço (rua, número)", "text", G_END, true),
  f("endereco_bairro",     "Bairro",          "text",     G_END, true),
  f("endereco_cidade",     "Cidade",          "text",     G_END, true),
  f("endereco_estado",     "Estado (UF)",     "text",     G_END, true, { placeholder: "SP" }),
  f("endereco_cep",        "CEP",             "text",     G_END, true, { placeholder: "00000-000" }),

  // ─── Documentos (números, não fotos — fotos vão por WhatsApp) ───
  f("rg",              "RG",                  "text",     G_DOCS, true),
  f("rg_orgao",        "Órgão expedidor",     "text",     G_DOCS, true, { placeholder: "SSP" }),
  f("rg_uf",           "UF do RG",            "text",     G_DOCS, true, { placeholder: "SP" }),
  f("rg_data_emissao", "Data de emissão do RG", "data",   G_DOCS, false),
  f("cpf",             "CPF",                 "cpf",      G_DOCS, true),
  f("ctps_numero",     "CTPS — número",       "text",     G_DOCS, true),
  f("ctps_serie",      "CTPS — série",        "text",     G_DOCS, true),
  f("ctps_data_emissao", "CTPS — data emissão", "data",   G_DOCS, false),
  f("pis",             "PIS/PASEP",           "text",     G_DOCS, true),
  f("titulo_eleitor",  "Título de eleitor",   "text",     G_DOCS, false),
  f("titulo_zona",     "Zona eleitoral",      "text",     G_DOCS, false),
  f("titulo_secao",    "Seção eleitoral",     "text",     G_DOCS, false),
  f("titulo_data_emissao", "Data emissão título", "data", G_DOCS, false),
  f("reservista",      "Reservista (nº)",     "text",     G_DOCS, false),
  f("cnh",             "CNH (nº)",            "text",     G_DOCS, false),
  f("cnh_categoria",   "Categoria CNH",       "select",   G_DOCS, false, { opcoes: ["A", "B", "AB", "C", "D", "E"] }),

  // ─── Banco ───
  f("banco_nome",      "Banco",               "text",     G_BANCO, true),
  f("banco_agencia",   "Agência",             "text",     G_BANCO, true),
  f("banco_conta",     "Conta",               "text",     G_BANCO, true),
  f("email_recibo",    "E-mail para recibo de pagamento", "email", G_BANCO, true),

  // ─── Dependentes (lista repetível) ───
  f("dependentes",     "Dependentes",         "lista_dependentes", G_DEPS, false, {
    ajuda: "Adicione filhos, cônjuge ou outros dependentes. CPF obrigatório pra dependente de IR.",
  }),

  // ─── Transporte ───
  f("transporte",      "Vale-transporte",     "lista_transporte", G_TRANS, false, {
    ajuda: "Adicione cada trecho (ida/volta separadas se necessário).",
  }),
];

// Atribui ordem (1, 2, 3, ...) na sequência declarada.
export const TEMPLATE_ADMISSAO_DEFAULT: FormField[] = RAW.map((f, i) => ({ ...f, ordem: i + 1 }));

// Grupos na ordem padrão de exibição.
export const GRUPOS_ADMISSAO_DEFAULT = [
  G_PESSOAL,
  G_CONTATO,
  G_END,
  G_DOCS,
  G_BANCO,
  G_DEPS,
  G_TRANS,
];

// Colunas default do Kanban — mapeamento default status→coluna pra automação.
export const KANBAN_COLUNAS_DEFAULT = [
  { id: "col_enviado",      nome: "Formulário enviado",      ordem: 1, statusAuto: "formulario_enviado" as const,    cor: "94a3b8" },
  { id: "col_preenchido",   nome: "Formulário preenchido",   ordem: 2, statusAuto: "formulario_preenchido" as const, cor: "f59e0b" },
  { id: "col_documentos",   nome: "Documentos recebidos",    ordem: 3, statusAuto: "documentos_recebidos" as const,  cor: "10b981" },
  { id: "col_admitido",     nome: "Admitido",                ordem: 4, statusAuto: "admitido" as const,              cor: "0ea5e9" },
];
