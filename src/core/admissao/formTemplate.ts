// ════════════════════════════════════════════════════════════════════════════
//  Template default do formulário de admissão — baseado na ficha Senador
//  Contábil. Cada restaurante começa com esse schema; pode editar livremente.
// ════════════════════════════════════════════════════════════════════════════

import type { ContatoExterno, FormField, SubtarefaTemplate } from "../types";

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
  f("nacionalidade",   "Nacionalidade",       "select",   G_PESSOAL, true, {
    opcoes: [
      "Brasileira", "Argentina", "Boliviana", "Chilena", "Colombiana",
      "Cubana", "Equatoriana", "Espanhola", "Francesa", "Haitiana",
      "Italiana", "Japonesa", "Mexicana", "Norte-americana", "Paraguaia",
      "Peruana", "Portuguesa", "Senegalesa", "Uruguaia", "Venezuelana",
      "Angolana", "Cabo-verdiana", "Guineense", "Moçambicana",
      "Sul-coreana", "Chinesa", "Libanesa", "Marroquina",
      "Britânica", "Alemã", "Outra",
    ],
  }),
  f("naturalidade",    "Naturalidade", "naturalidade", G_PESSOAL, true, {
    ajuda: "Estado e cidade onde você nasceu (se nasceu no Brasil).",
  }),
  f("sexo",            "Sexo",                "select",   G_PESSOAL, true, { opcoes: ["Masculino", "Feminino", "Outro"] }),
  f("cor",             "Cor/Raça",            "select",   G_PESSOAL, false, { opcoes: ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"] }),
  f("escolaridade",    "Escolaridade",        "select",   G_PESSOAL, false, {
    opcoes: ["Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação"],
  }),
  f("estado_civil",    "Estado civil",        "select",   G_PESSOAL, true, { opcoes: ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"] }),
  f("num_filhos",      "Número de filhos",    "numero",   G_PESSOAL, false),
  f("tem_dependentes_legais", "Algum filho seu é dependente legal (declaração de IR, plano de saúde, pensão, etc)?", "boolean", G_PESSOAL, false, {
    ajuda: "Marque sim se você tem filhos que devem ser cadastrados como dependentes. Se todos os filhos forem maiores de idade e independentes, deixe desmarcado.",
  }),
  f("nome_pai",        "Nome do pai",         "text",     G_PESSOAL, false),
  f("nome_mae",        "Nome da mãe",         "text",     G_PESSOAL, true),

  // ─── Contato ───
  // `whatsapp` é pré-preenchido pela página pública (vem do cadastro do RH)
  f("whatsapp",        "WhatsApp",            "telefone", G_CONTATO, true),
  f("tel_residencial", "Telefone residencial", "telefone", G_CONTATO, false),
  f("tel_emergencia",  "Telefone de emergência", "telefone", G_CONTATO, true),
  f("contato_emergencia_nome", "Nome do contato de emergência", "text", G_CONTATO, true),

  // ─── Endereço — CEP primeiro, auto-preenche os demais via ViaCEP ───
  f("endereco_cep",         "CEP",         "text", G_END, true,  { placeholder: "00000-000", ajuda: "Ao preencher, completa rua, bairro, cidade e estado automaticamente." }),
  f("endereco_logradouro",  "Rua",         "text", G_END, true),
  f("endereco_numero",      "Número",      "text", G_END, true),
  f("endereco_complemento", "Complemento", "text", G_END, false, { placeholder: "Apto, bloco, fundos…" }),
  f("endereco_bairro",      "Bairro",      "text", G_END, true),
  f("endereco_cidade",      "Cidade",      "text", G_END, true),
  f("endereco_estado",      "Estado (UF)", "text", G_END, true,  { placeholder: "SP" }),

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
  // banco_tipo controla o fluxo da conta Itaú:
  //   - "Itaú já tenho": agência/conta são da Itaú, popula dadosBancariosItau
  //     automaticamente, e a mensagem de instruções pula o bloco 2 (abertura).
  //   - "Outro banco": pede texto livre em banco_nome_outro. Candidato terá
  //     que abrir Itaú depois (mensagem inclui o bloco 2 padrão).
  f("banco_tipo",      "Conta bancária",      "select",   G_BANCO, true, {
    opcoes: ["Já tenho conta no Itaú", "Tenho conta em outro banco"],
    ajuda: "Se você já tem conta no Itaú (corrente ou salário), preenche os dados aqui e facilita o processo — não precisa abrir conta nova depois.",
  }),
  f("banco_nome_outro","Nome do banco (se não for Itaú)", "text", G_BANCO, false, {
    placeholder: "Bradesco, Caixa, Nubank…",
    ajuda: "Só preencha se você selecionou 'Outro banco' acima.",
  }),
  f("banco_agencia",   "Agência",             "text",     G_BANCO, true),
  f("banco_conta",     "Conta",               "text",     G_BANCO, true),
  f("pix",             "Chave PIX",           "text",     G_BANCO, true,  { placeholder: "CPF, e-mail, telefone ou chave aleatória" }),
  f("email_recibo",    "E-mail para recibo de pagamento", "email", G_BANCO, true),

  // ─── Dependentes (lista repetível) ───
  f("dependentes",     "Dependentes",         "lista_dependentes", G_DEPS, false, {
    ajuda: "Adicione filhos, cônjuge ou outros dependentes. CPF obrigatório pra dependente de IR.",
  }),

  // ─── Transporte ───
  f("vt_nao_utiliza",  "Não utilizo transporte público (vou a pé, de carro, moto, bicicleta etc — abro mão do VT)", "boolean", G_TRANS, false),
  f("transporte",      "Vale-transporte",     "lista_transporte", G_TRANS, false, {
    ajuda: "Adicione cada trecho (ida/volta separadas se necessário). Pule este bloco se você marcou que não utiliza transporte público acima.",
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

// Lista padrão de documentos pra checklist de recebimento via WhatsApp.
// Itens "comuns" pra admissão CLT. Cada restaurante pode customizar depois.
export const CHECKLIST_DOCUMENTOS_DEFAULT = [
  { id: "rg_frente",     nome: "RG (frente)" },
  { id: "rg_verso",      nome: "RG (verso)" },
  { id: "cpf",           nome: "CPF" },
  { id: "comprovante_residencia", nome: "Comprovante de residência" },
  { id: "foto_3x4",      nome: "Foto 3x4" },
  { id: "ctps_rosto",    nome: "CTPS (página de rosto)" },
  { id: "ctps_qualif",   nome: "CTPS (qualificação civil)" },
  { id: "titulo_eleitor",nome: "Título de eleitor" },
  { id: "comprovante_pis", nome: "Comprovante de PIS/PASEP" },
  { id: "reservista",    nome: "Certificado de reservista (homens)" },
  { id: "comprovante_escolaridade", nome: "Comprovante de escolaridade" },
  { id: "dependentes_certidao", nome: "Certidão de nascimento dos dependentes (se houver)" },
];

// Colunas default do Kanban — fluxo completo da admissão. 6 funcionais + 1
// terminal. Cada coluna tem 1:1 com um AdmissaoStatus, exceto "terminados"
// que cobre cancelada + expirada. Kanban tem drag-drop + botões ◀▶ no card —
// movimentação é manual em todos os casos (form submetido não move auto).
export const KANBAN_COLUNAS_DEFAULT = [
  { id: "col_a_admitir",      nome: "Pessoas a admitir",          ordem: 1, statusAuto: "a_admitir" as const,                 cor: "64748b" },
  { id: "col_enviado",        nome: "Aguardando preenchimento e Solicitação de Exames e Conta", ordem: 2, statusAuto: "formulario_enviado" as const, cor: "94a3b8" },
  { id: "col_preenchido",     nome: "Exames, conta e dados internos", ordem: 3, statusAuto: "formulario_preenchido" as const, cor: "f59e0b" },
  { id: "col_contabilidade",  nome: "Contabilidade & contratos",  ordem: 4, statusAuto: "solicitacao_contabilidade" as const, cor: "8b5cf6" },
  { id: "col_pronto",         nome: "Pronto pra admitir",         ordem: 5, statusAuto: "pronto_admissao" as const,           cor: "6366f1" },
  { id: "col_admitido",       nome: "Admitido e Onboarding",      ordem: 6, statusAuto: "admitido" as const,                  cor: "0ea5e9" },
  { id: "col_terminados",     nome: "Cancelados e Expirados",     ordem: 7, statusAuto: ["cancelada", "expirada"] as ("cancelada" | "expirada")[], cor: "ef4444" },
];

// Default do e-mail da clínica de exames admissionais. Restaurante pode
// sobrescrever em `emailClinicaExames`. Será trocado em breve quando o
// escritório migrar de fornecedor.
export const EMAIL_CLINICA_EXAMES_DEFAULT = "atendimento@triagem.com";

// Dados de contato da clínica de exames — usados nas mensagens de WhatsApp
// pro candidato. Configuráveis em Restaurant.clinicaExames* pra quando o
// escritório migrar de fornecedor.
export const CLINICA_EXAMES_NOME_DEFAULT     = "Triagem Medicina do Trabalho";
export const CLINICA_EXAMES_ENDERECO_DEFAULT = "Rua Paulistânia, 273 — metrô Vila Madalena, São Paulo - SP, 05440-000";
export const CLINICA_EXAMES_TELEFONE_DEFAULT = "(11) 3801-3363";

// Telefone do financeiro do escritório — destinatário da mensagem de
// cadastrar empregado no banco interno. Hardcoded por agora.
export const WHATSAPP_FINANCEIRO_DEFAULT = "5511917560073";

// ─── Contatos externos default (admissão) ──────────────────────────────────
// Defaults pré-configurados — restaurante pode sobrescrever em
// Restaurant.contatosAdmissao. Sem gravação hard: os valores ficam no
// código, mas restaurante pode editar tudo na tela de Config.
export const CONTATO_CLINICA_DEFAULT: ContatoExterno = {
  nome: CLINICA_EXAMES_NOME_DEFAULT,
  email: EMAIL_CLINICA_EXAMES_DEFAULT,
  whatsapp: "",
  telefone: CLINICA_EXAMES_TELEFONE_DEFAULT,
  endereco: CLINICA_EXAMES_ENDERECO_DEFAULT,
  // Triagem só agenda por telefone. Restaurante pode trocar se for outra
  // clínica que faz por email.
  canalPreferido: "telefone",
};

export const CONTATO_CONTABILIDADE_DEFAULT: ContatoExterno = {
  nome: "Senador Contábil",
  email: "dpessoal@senadorcontabil.com.br",
  whatsapp: "",
  telefone: "",
  canalPreferido: "email",
};

export const CONTATO_FINANCEIRO_DEFAULT: ContatoExterno = {
  nome: "Financeiro (escritório)",
  email: "",
  whatsapp: WHATSAPP_FINANCEIRO_DEFAULT,
  telefone: "",
  canalPreferido: "whatsapp",
};

// Dias pra abrir a conta no Itaú a partir do envio do form (hardcoded).
// Usado tanto na mensagem de instruções quanto no box do form público.
export const PRAZO_CONTA_ITAU_DIAS = 7;

// IDs de subtarefas que foram removidos do template ao longo da evolução —
// são filtradas como "lixo" no momento de sincronizar admissões antigas
// pra não aparecerem como órfãs no drawer.
export const DEPRECATED_SUBTAREFAS_IDS = new Set<string>([
  "st_contato_emergencia",        // virou parte da mensagem única de instruções
  "st_avisar_exame_candidato",    // 2026-05: removido na refatoração do Kanban (RH conduz instruções fora do checklist)
  "st_coleta_assinatura",         // 2026-05: virou parte do novo fluxo de Assinaturas
  "st_envio_regulamento",         // 2026-05: virou parte do novo fluxo de Assinaturas
  // 2026-05 (segunda iteração): termos individuais consolidados num único item
  // "st_termos_assinatura" com botão de checklist (modal). Os 6 termos
  // anteriores agora vivem como itens DENTRO desse modal.
  "st_termo_contrato_clt",
  "st_termo_confidencialidade",
  "st_termo_uniformes_epis",
  "st_termo_regulamento_interno",
  "st_termo_lgpd",
  "st_assinatura_outros",
  // 2026-05 (Uniformes Fase 3): item único de entrega de uniformes/EPIs
  // foi separado em 2 subtarefas (st_entrega_uniformes + st_entrega_epis)
  // pra cada uma gerar termo próprio.
  "st_uniformes_epis",
  // 2026-05 (Uniformes Fase 4): geração de termo (uniforme + EPI) MIGROU
  // pra dentro do ChecklistTermosModal de col_contabilidade. Na col_pronto
  // ficou só "st_entrega_fisica_uniforme_epi" (checkbox da entrega física).
  "st_entrega_uniformes",
  "st_entrega_epis",
  // 2026-05 (Clicksign API): o envio pro Clicksign agora é feito DENTRO do kit
  // de documentos (botão "Enviar pro Clicksign"). A subtarefa de "Abrir
  // Clicksign" virou redundante.
  "st_envio_kit_clicksign",
]);

// ════════════════════════════════════════════════════════════════════════════
//  Template de subtarefas — checklist interno do processo de admissão.
//
//  Cada admissão é instanciada com uma cópia desse template. Subtarefas com
//  autoTrigger são marcadas pelo sistema quando o evento correspondente
//  ocorre (ver `aplicarAutoTrigger` em admissaoHelpers.ts). Obrigatórias
//  pendentes bloqueiam o avanço pra próxima coluna do Kanban.
// ════════════════════════════════════════════════════════════════════════════

function st(
  id: string,
  nome: string,
  colunaId: string,
  checklistId: string,
  checklistNome: string,
  obrigatoria: boolean = true,
  extra: Partial<SubtarefaTemplate> = {},
): SubtarefaTemplate {
  return { id, nome, colunaId, checklistId, checklistNome, obrigatoria, ordem: 0, ...extra };
}

// IDs e nomes de checklists — declarados como constantes pra evitar typos.
const CK_DADOS_BASICOS  = { id: "ck_dados_basicos",  nome: "📝 Dados básicos" };
const CK_ENVIO_LINK     = { id: "ck_envio_link",     nome: "📨 Envio do link" };
const CK_EXAMES         = { id: "ck_exames",         nome: "🏥 Exames médicos" };
const CK_DADOS_INTERNOS = { id: "ck_dados_internos", nome: "📋 Dados internos" };
const CK_CONTABILIDADE  = { id: "ck_contabilidade",  nome: "📤 Contabilidade" };
const CK_ASSINATURAS    = { id: "ck_assinaturas",    nome: "📃 Assinaturas" };
const CK_CADASTROS_EXT  = { id: "ck_cadastros_ext",  nome: "🏦 Cadastros externos" };
const CK_RESULT_EXAMES  = { id: "ck_resultados",     nome: "🏥 Resultados de exames" };
const CK_ULTIMA_MILHA   = { id: "ck_ultima_milha",   nome: "🏁 Última milha" };
const CK_ONBOARDING_D1  = { id: "ck_onboarding_d1",  nome: "🚀 Onboarding (D1)" };
const CK_CADASTROS_POS  = { id: "ck_cadastros_pos",  nome: "📝 Cadastros pós-admissão" };

// ════════════════════════════════════════════════════════════════════════════
//  Quase tudo é manual (botão de ação no drawer + checkbox). A ÚNICA exceção é
//  "st_candidato_preencheu", que tem autoTrigger "form_preenchido" e se marca
//  sozinha quando o candidato envia o formulário. O checkbox continua marcável
//  à mão (rede de segurança se o auto falhar).
// ════════════════════════════════════════════════════════════════════════════
const RAW_SUBTAREFAS: SubtarefaTemplate[] = [
  // ─── Col 1: Pessoas a admitir ───
  st("st_dados_candidato", "Preencher dados básicos do candidato (gera o link do formulário)",
     "col_a_admitir", CK_DADOS_BASICOS.id, CK_DADOS_BASICOS.nome, true,
     { atalho: { tipo: "editar_dados_basicos" } }),
  st("st_dados_vaga", "Preencher dados básicos da vaga (cargo, horário, empresa)",
     "col_a_admitir", CK_DADOS_BASICOS.id, CK_DADOS_BASICOS.nome, true,
     { atalho: { tipo: "editar_dados_finais" } }),
  st("st_criar_pasta_drive", "Criar pasta do empregado no Drive",
     "col_a_admitir", CK_DADOS_BASICOS.id, CK_DADOS_BASICOS.nome, false,
     { atalho: { tipo: "criar_pasta_drive" } }),

  // ─── Col 2: Aguardando preenchimento e Solicitação de Exames e Conta ───
  // Auto-marca quando o candidato envia o formulário (autoTrigger "form_preenchido").
  // É obrigatória → enquanto o candidato não preenche, a coluna NÃO fica 100%
  // (mostra "aguardando candidato") e avançar à mão alerta a pendência.
  st("st_candidato_preencheu", "Candidato preencheu o formulário",
     "col_enviado", CK_ENVIO_LINK.id, CK_ENVIO_LINK.nome, true,
     { autoTrigger: "form_preenchido" }),
  st("st_solicitar_info", "Preencher informações internas de admissão (cargo, horário, empresa)",
     "col_enviado", CK_ENVIO_LINK.id, CK_ENVIO_LINK.nome, true,
     { atalho: { tipo: "editar_dados_finais" } }),
  st("st_solicitar_docs", "Solicitação de documentos + abertura de conta Itaú via link",
     "col_enviado", CK_ENVIO_LINK.id, CK_ENVIO_LINK.nome, true,
     { atalho: { tipo: "enviar_link_form" } }),
  st("st_dados_finais", "Preencher dados finais (cargo, salário, horário, data)",
     "col_enviado", CK_ENVIO_LINK.id, CK_ENVIO_LINK.nome, true,
     { atalho: { tipo: "editar_dados_finais" } }),

  // ─── Col 3: Exames, conta e dados internos ───
  // 🏥 Exames PRIMEIRO: agenda com a clínica → depois avisa o candidato (data +
  // local + instruções), gated na data do exame.
  st("st_agendar_exames", "Agendar exames médicos (clínico + manipulador de alimentos) com a clínica",
     "col_preenchido", CK_EXAMES.id, CK_EXAMES.nome, true,
     { atalho: { tipo: "contato_clinica" } }),
  st("st_avisar_exame", "Avisar o candidato sobre o exame (data, local e instruções)",
     "col_preenchido", CK_EXAMES.id, CK_EXAMES.nome, true,
     { pedeDataHora: true, atalho: { tipo: "whatsapp_instrucoes_candidato" } }),
  st("st_conferir_docs", "Conferir recebimento dos documentos enviados pelo candidato",
     "col_preenchido", CK_DADOS_INTERNOS.id, CK_DADOS_INTERNOS.nome, true,
     { atalho: { tipo: "checklist_docs_whatsapp" } }),
  st("st_dados_bancarios", "Conferir recebimento de dados bancários Itaú (tipo, agência e conta)",
     "col_preenchido", CK_DADOS_INTERNOS.id, CK_DADOS_INTERNOS.nome, true,
     { pedeDadosBancarios: true }),
  st("st_cadastro_banco", "Solicitar cadastro empregado no Banco",
     "col_preenchido", CK_DADOS_INTERNOS.id, CK_DADOS_INTERNOS.nome, true,
     { atalho: { tipo: "contato_financeiro" } }),

  // ─── Col 4: Contabilidade & contratos ───
  st("st_envio_contabilidade", "Envio de dados de admissão para contabilidade",
     "col_contabilidade", CK_CONTABILIDADE.id, CK_CONTABILIDADE.nome, true,
     { atalho: { tipo: "contato_contabilidade" } }),
  // ─── 📃 Assinaturas ───
  st("st_receber_contrato", "Recebimento do contrato para assinatura",
     "col_contabilidade", CK_ASSINATURAS.id, CK_ASSINATURAS.nome, true,
     { pedeLink: true }),
  st("st_termos_assinatura", "Kit de documentos para assinatura",
     "col_contabilidade", CK_ASSINATURAS.id, CK_ASSINATURAS.nome, true,
     { atalho: { tipo: "checklist_termos_assinar" } }),
  st("st_avisar_kit_assinatura", "Avisar candidato que mandamos o kit para assinatura por email",
     "col_contabilidade", CK_ASSINATURAS.id, CK_ASSINATURAS.nome, true,
     { atalho: { tipo: "whatsapp_kit_assinatura" } }),
  st("st_instruir_cursos", "Instruir cursos obrigatórios e definir prazo",
     "col_contabilidade", CK_CADASTROS_EXT.id, CK_CADASTROS_EXT.nome, true),
  st("st_cadastro_vt", "Cadastro no Caju Benefícios",
     "col_contabilidade", CK_CADASTROS_EXT.id, CK_CADASTROS_EXT.nome, true),
  st("st_cadastro_tangerino", "Cadastro no Sólides Controle de Ponto",
     "col_contabilidade", CK_CADASTROS_EXT.id, CK_CADASTROS_EXT.nome, true),

  // ─── Col 5: Pronto pra admitir ───
  st("st_receber_aso", "Recebimento do ASO",
     "col_pronto", CK_RESULT_EXAMES.id, CK_RESULT_EXAMES.nome, true,
     { pedeLink: true }),
  st("st_receber_cert_manip", "Recebimento do Exame Parasitológico",
     "col_pronto", CK_RESULT_EXAMES.id, CK_RESULT_EXAMES.nome, true,
     { pedeLink: true }),
  st("st_certificados_cursos", "Receber certificados dos cursos obrigatórios",
     "col_pronto", CK_ULTIMA_MILHA.id, CK_ULTIMA_MILHA.nome, true,
     { pedeLink: true }),
  st("st_calculo_primeiro_vt", "Realizar cálculo do primeiro Vale Transporte",
     "col_pronto", CK_ULTIMA_MILHA.id, CK_ULTIMA_MILHA.nome, true),
  st("st_solicitar_pgto_vt", "Solicitar pagamento primeiro Vale Transporte para o setor financeiro",
     "col_pronto", CK_ULTIMA_MILHA.id, CK_ULTIMA_MILHA.nome, true),
  // Entrega FÍSICA dos uniformes + EPIs. O termo já foi gerado/assinado em
  // col_contabilidade (dentro do "📃 Termos a assinar" — botão "📦 Gerar
  // termo"). Aqui é só pra marcar quando o empregado realmente recebeu os
  // itens em mãos.
  st("st_entrega_fisica_uniforme_epi", "Realizar a entrega de uniformes e EPIs",
     "col_pronto", CK_ULTIMA_MILHA.id, CK_ULTIMA_MILHA.nome, true),

  // ─── Col 6: Admitido e Onboarding ───
  st("st_envio_videos_treinamento", "Envio de vídeos de treinamento inicial",
     "col_admitido", CK_ONBOARDING_D1.id, CK_ONBOARDING_D1.nome, true),
  st("st_onboarding_treinamento", "Onboarding e treinamento inicial",
     "col_admitido", CK_ONBOARDING_D1.id, CK_ONBOARDING_D1.nome, true),
  st("st_grupo_avisos", "Inclusão no grupo de Avisos Gerais",
     "col_admitido", CK_ONBOARDING_D1.id, CK_ONBOARDING_D1.nome, true),
  st("st_matricula_esocial", "Informe matrícula e-social junto a Triagem",
     "col_admitido", CK_CADASTROS_POS.id, CK_CADASTROS_POS.nome, true),
  st("st_pasta_drive", "Abrir pasta do empregado no Drive e subir todos os documentos",
     "col_admitido", CK_CADASTROS_POS.id, CK_CADASTROS_POS.nome, true,
     { pedeLink: true }),
  st("st_fim_experiencia", "Adicionar fim dos períodos de experiência (45 e 90 dias) no Asana",
     "col_admitido", CK_CADASTROS_POS.id, CK_CADASTROS_POS.nome, true),
];

export const SUBTAREFAS_TEMPLATE_DEFAULT: SubtarefaTemplate[] = RAW_SUBTAREFAS.map((s, i) => ({ ...s, ordem: i + 1 }));
