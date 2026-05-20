// ════════════════════════════════════════════════════════════════════════════
//  Helpers de admissão — CRUD + ações de fluxo (envio do link, reenvio,
//  expirar, cancelar, aprovar). Lógica server-safe (não toca em UI).
// ════════════════════════════════════════════════════════════════════════════

import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  Admissao, AdmissaoStatus, AutoTriggerSubtarefa, Empregado, EmpregadoPeriodo,
  FormField, MotivoCancelamento,
  Pessoa, Restaurant, SubtarefaAdmissao, SubtarefaTemplate,
} from "../types";
import {
  TEMPLATE_ADMISSAO_DEFAULT, KANBAN_COLUNAS_DEFAULT,
  SUBTAREFAS_TEMPLATE_DEFAULT, EMAIL_CLINICA_EXAMES_DEFAULT,
  CLINICA_EXAMES_NOME_DEFAULT, CLINICA_EXAMES_ENDERECO_DEFAULT,
  CLINICA_EXAMES_TELEFONE_DEFAULT,
  WHATSAPP_FINANCEIRO_DEFAULT, PRAZO_CONTA_ITAU_DIAS,
  DEPRECATED_SUBTAREFAS_IDS,
  CONTATO_CLINICA_DEFAULT, CONTATO_CONTABILIDADE_DEFAULT,
  CONTATO_FINANCEIRO_DEFAULT,
} from "./formTemplate";
import type { ContatoExterno } from "../types";

// ─── Token + URL ───────────────────────────────────────────────────────────

function gerarToken(): string {
  // randomUUID disponível em browser e Node 19+
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (não deveria precisar)
  return `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

// URL pública do formulário. Prioridade:
//   1. subdomain do restaurante → `https://<sub>.planejamento.app/admissao/:token`
//   2. fallback: origin atual (admin/preview/localhost)
//
// Usar o subdomínio do restaurante reforça pro candidato que o link é da
// empresa específica e não da plataforma genérica.
export function urlPublicaAdmissao(token: string, subdomain?: string): string {
  if (subdomain && subdomain.trim()) {
    return `https://${subdomain.trim()}.planejamento.app/admissao/${token}`;
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "https://admin.planejamento.app";
  return `${origin}/admissao/${token}`;
}

// ─── stripUndefined (Firestore não aceita undefined) ──────────────────────

function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripUndefined(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = stripUndefined(val);
    }
    return out as T;
  }
  return v;
}

// ─── Configs por restaurante (com fallback pro default) ────────────────────

export function getPrazoDias(rest: Restaurant | null | undefined): number {
  const d = rest?.admissaoPrazoDias;
  if (typeof d === "number" && d >= 1 && d <= 7) return d;
  return 1; // default conservador — força urgência
}

export function getSchemaAdmissao(rest: Restaurant | null | undefined): FormField[] {
  return rest?.admissaoFormSchema || TEMPLATE_ADMISSAO_DEFAULT;
}

export function getKanbanColunas(rest: Restaurant | null | undefined) {
  return rest?.admissaoKanbanColunas || KANBAN_COLUNAS_DEFAULT;
}

export function getWhatsappDP(rest: Restaurant | null | undefined): string | undefined {
  return rest?.whatsappDP || undefined;
}

// Default usado pelas empresas que ainda não sobrescreveram o campo.
// É só pra pré-preencher destinatário do Gmail compose — config segue editável.
export const EMAIL_CONTABILIDADE_DEFAULT = "dpessoal@senadorcontabil.com.br";

export function getEmailContabilidade(rest: Restaurant | null | undefined): string | undefined {
  return rest?.emailContabilidade?.trim() || EMAIL_CONTABILIDADE_DEFAULT;
}

export function getEmailClinicaExames(rest: Restaurant | null | undefined): string {
  return rest?.emailClinicaExames?.trim() || EMAIL_CLINICA_EXAMES_DEFAULT;
}

export function getClinicaInfo(rest: Restaurant | null | undefined): {
  nome: string; endereco: string; telefone: string;
} {
  return {
    nome:     rest?.clinicaExamesNome?.trim()     || CLINICA_EXAMES_NOME_DEFAULT,
    endereco: rest?.clinicaExamesEndereco?.trim() || CLINICA_EXAMES_ENDERECO_DEFAULT,
    telefone: rest?.clinicaExamesTelefone?.trim() || CLINICA_EXAMES_TELEFONE_DEFAULT,
  };
}

export function getSubtarefasTemplate(rest: Restaurant | null | undefined): SubtarefaTemplate[] {
  return rest?.admissaoSubtarefasTemplate || SUBTAREFAS_TEMPLATE_DEFAULT;
}

// ─── Contatos externos (admissão) ──────────────────────────────────────────
// Resolve cada contato com prioridade:
//   1. contatosAdmissao.<chave> (config nova explícita)
//   2. Default global (formTemplate.ts)
//
// Migração suave de legados: ainda lemos emailContabilidade /
// emailClinicaExames / clinicaExames* como fallback se contatosAdmissao
// estiver vazio. Quando o restaurante salvar Config nova, contatosAdmissao
// passa a ser fonte de verdade.

function migrarContatoClinicaLegacy(rest: Restaurant | null | undefined): ContatoExterno | null {
  if (!rest) return null;
  if (!rest.emailClinicaExames && !rest.clinicaExamesNome && !rest.clinicaExamesEndereco && !rest.clinicaExamesTelefone) {
    return null;
  }
  return {
    ...CONTATO_CLINICA_DEFAULT,
    nome:     rest.clinicaExamesNome?.trim()     || CONTATO_CLINICA_DEFAULT.nome,
    email:    rest.emailClinicaExames?.trim()    || CONTATO_CLINICA_DEFAULT.email,
    endereco: rest.clinicaExamesEndereco?.trim() || CONTATO_CLINICA_DEFAULT.endereco,
    telefone: rest.clinicaExamesTelefone?.trim() || CONTATO_CLINICA_DEFAULT.telefone,
  };
}

function migrarContatoContabilidadeLegacy(rest: Restaurant | null | undefined): ContatoExterno | null {
  if (!rest?.emailContabilidade) return null;
  return {
    ...CONTATO_CONTABILIDADE_DEFAULT,
    email: rest.emailContabilidade.trim() || CONTATO_CONTABILIDADE_DEFAULT.email,
  };
}

export function getContatoClinica(rest: Restaurant | null | undefined): ContatoExterno {
  return rest?.contatosAdmissao?.clinicaExames
    || migrarContatoClinicaLegacy(rest)
    || CONTATO_CLINICA_DEFAULT;
}

export function getContatoContabilidade(rest: Restaurant | null | undefined): ContatoExterno {
  return rest?.contatosAdmissao?.contabilidade
    || migrarContatoContabilidadeLegacy(rest)
    || CONTATO_CONTABILIDADE_DEFAULT;
}

export function getContatoFinanceiro(rest: Restaurant | null | undefined): ContatoExterno {
  return rest?.contatosAdmissao?.financeiroBanco || CONTATO_FINANCEIRO_DEFAULT;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

export type IniciarAdmissaoInput = {
  restaurantId: string;
  restaurantSnapshot: { nome: string; whatsappDP?: string; prazoDias: number };
  candidato: { nome: string; cpf: string; email: string; whatsapp: string };
  cargoId: string;
  horariosCadastrados?: Record<string, unknown>;
  salario?: number;
  dataAdmissao?: string;
  cargoConfianca?: boolean;
  schemaUsado: FormField[];                  // passa snapshot já resolvido
  pessoaIdVinculada?: string;                // se o CPF já existia em /pessoas
  subtarefasTemplate?: SubtarefaTemplate[];  // snapshot do template do restaurante
};

export async function iniciarAdmissao(
  input: IniciarAdmissaoInput,
  pessoa: Pessoa,
): Promise<Admissao> {
  const now = new Date().toISOString();
  const subtarefas = instanciarSubtarefas(
    input.subtarefasTemplate || SUBTAREFAS_TEMPLATE_DEFAULT,
  );
  // Aplica auto-triggers que já ocorreram: a criação da admissão.
  aplicarAutoTrigger(subtarefas, "iniciar_admissao", pessoa, now);
  // Se dados finais já vieram completos no momento de iniciar, marca também.
  if (input.cargoId && input.dataAdmissao && typeof input.salario === "number") {
    const h = input.horariosCadastrados;
    const algumAtivo = h && Object.values(h).some(
      (d) => typeof d === "object" && d != null && (d as { active?: boolean }).active === true,
    );
    if (algumAtivo) aplicarAutoTrigger(subtarefas, "dados_finais_completos", pessoa, now);
  }
  const novo: Omit<Admissao, "id"> = {
    restaurantId: input.restaurantId,
    status: "formulario_enviado",
    iniciadoPor: { id: pessoa.id, nome: pessoa.nome },
    iniciadoEm: now,
    candidato: input.candidato,
    cargoId: input.cargoId,
    horariosCadastrados: input.horariosCadastrados as Admissao["horariosCadastrados"],
    salario: input.salario,
    dataAdmissao: input.dataAdmissao,
    cargoConfianca: input.cargoConfianca,
    token: gerarToken(),
    schemaUsado: input.schemaUsado,
    restaurantSnapshot: input.restaurantSnapshot,
    pessoaIdVinculada: input.pessoaIdVinculada,
    subtarefas,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, "admissoes"), stripUndefined(novo));
  return { id: ref.id, ...novo } as Admissao;
}

// Marca o envio do link: define enviadoEm + expiraEm baseado no prazo do rest.
// É essa ação que dispara o timer pro candidato. Auto-marca subtarefa de
// "Solicitação de documentos + abertura conta Itaú".
export async function marcarLinkEnviado(
  admissao: Admissao,
  prazoDias: number,
  pessoa: Pessoa,
): Promise<{ enviadoEm: string; expiraEm: string }> {
  const enviadoEm = new Date().toISOString();
  const expiraEm = new Date(Date.now() + prazoDias * 86400000).toISOString();
  const subtarefas = [...(admissao.subtarefas || [])];
  aplicarAutoTrigger(subtarefas, "link_enviado", pessoa, enviadoEm);
  await updateDoc(doc(db, "admissoes", admissao.id), stripUndefined({
    enviadoEm,
    expiraEm,
    subtarefas: subtarefas.length > 0 ? subtarefas : undefined,
    updatedAt: enviadoEm,
  }));
  return { enviadoEm, expiraEm };
}

// Reenvia: gera novo token, novo enviadoEm/expiraEm, mantém todos os dados
// (preenchimento parcial + tudo mais).
export async function reenviarAdmissao(
  admissao: Admissao,
  prazoDias: number,
  pessoa: Pessoa,
): Promise<{ token: string; enviadoEm: string; expiraEm: string }> {
  const enviadoEm = new Date().toISOString();
  const expiraEm = new Date(Date.now() + prazoDias * 86400000).toISOString();
  const token = gerarToken();
  const reenvios = [
    ...(admissao.reenvios || []),
    { em: enviadoEm, por: pessoa.id, porNome: pessoa.nome },
  ];
  await updateDoc(doc(db, "admissoes", admissao.id), {
    token,
    enviadoEm,
    expiraEm,
    reenvios,
    // se estava expirada, volta pra enviado
    status: admissao.status === "expirada" ? "formulario_enviado" : admissao.status,
    updatedAt: enviadoEm,
  });
  return { token, enviadoEm, expiraEm };
}

// Busca pessoa por email (qualquer restaurante). Email é o identity provider
// futuro (vira login), então precisa ser único no sistema. Comparação
// case-insensitive — normaliza pra lowercase.
export async function buscarPessoaPorEmail(
  email: string,
): Promise<{ id: string; nome: string; cpf?: string; restaurantIds: string[] } | null> {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  const q = query(collection(db, "pessoas"), where("email", "==", e));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as { nome?: string; cpf?: string; restaurantIds?: string[] };
  return {
    id: d.id,
    nome: data.nome || "",
    cpf: data.cpf,
    restaurantIds: data.restaurantIds || [],
  };
}

// Busca a última admissão aprovada (com pessoaIdCriada/Vinculada apontando
// pra essa Pessoa) — usado pelo form público pra pré-popular dados quando
// a Pessoa já passou por uma admissão antes (mudança de restaurante,
// freela virando fixo, etc.). Ignora a admissão atual.
export async function buscarUltimaAdmissaoAprovadaDaPessoa(
  pessoaId: string,
  excluirAdmissaoId: string,
): Promise<Admissao | null> {
  // Procura via pessoaIdCriada OU pessoaIdVinculada — uma admissão antiga
  // pode ter qualquer um dos dois apontando pra essa Pessoa.
  const refColl = collection(db, "admissoes");
  const [q1, q2] = await Promise.all([
    getDocs(query(refColl, where("pessoaIdCriada", "==", pessoaId))),
    getDocs(query(refColl, where("pessoaIdVinculada", "==", pessoaId))),
  ]);
  const candidatas: Admissao[] = [];
  for (const d of q1.docs) candidatas.push({ id: d.id, ...d.data() } as Admissao);
  for (const d of q2.docs) {
    if (q1.docs.some((x) => x.id === d.id)) continue; // dedupe
    candidatas.push({ id: d.id, ...d.data() } as Admissao);
  }
  // Filtra: ignora a admissão atual + só aprovadas (= tem aprovadoEm OU
  // status admitido) com dadosPreenchidos
  const elegiveis = candidatas.filter(
    (a) => a.id !== excluirAdmissaoId
      && a.aprovadoEm
      && a.dadosPreenchidos
      && Object.keys(a.dadosPreenchidos as object).length > 0,
  );
  if (elegiveis.length === 0) return null;
  // Mais recente primeiro
  elegiveis.sort((a, b) => (b.aprovadoEm || "").localeCompare(a.aprovadoEm || ""));
  return elegiveis[0] || null;
}

// Busca pessoa por CPF (qualquer restaurante). Retorna a 1ª que casar.
// Usado pra detectar duplicação no momento de iniciar admissão e oferecer
// reusar dados existentes (ex: ex-freela virando empregado registrado).
export async function buscarPessoaPorCpf(
  cpfDigits: string,
): Promise<{ id: string; nome: string; email: string; whatsapp?: string; restaurantIds: string[] } | null> {
  if (!cpfDigits || cpfDigits.length !== 11) return null;
  const q = query(collection(db, "pessoas"), where("cpf", "==", cpfDigits));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as { nome?: string; email?: string; whatsapp?: string; restaurantIds?: string[] };
  return {
    id: d.id,
    nome: data.nome || "",
    email: data.email || "",
    whatsapp: data.whatsapp,
    restaurantIds: data.restaurantIds || [],
  };
}

export async function listarAdmissoes(restaurantId: string): Promise<Admissao[]> {
  const q = query(collection(db, "admissoes"), where("restaurantId", "==", restaurantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Admissao));
}

export async function carregarAdmissao(id: string): Promise<Admissao | null> {
  const snap = await getDoc(doc(db, "admissoes", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Admissao;
}

// Exclui definitivamente uma admissão do Firestore. Operação irreversível —
// só master deve poder chamar. O caller deve verificar isso na UI; a regra
// Firestore exige authed() (qualquer usuário logado pode delete via API, mas
// a UI só expõe o botão pra master).
export async function excluirAdmissaoDefinitivamente(id: string): Promise<void> {
  await deleteDoc(doc(db, "admissoes", id));
}

// Estende o prazo de preenchimento somando `horas` em `expiraEm`. Usado
// quando candidato pediu mais tempo. Reaproveita o token atual (não gera
// novo). Registra em `extensoesPrazo` pra auditoria.
export async function estenderPrazoAdmissao(
  admissao: Admissao,
  horas: number,
  pessoa: Pessoa,
): Promise<string> {
  if (!admissao.expiraEm) throw new Error("Admissão ainda não foi enviada.");
  const base = new Date(admissao.expiraEm).getTime();
  const novo = new Date(base + horas * 3600_000).toISOString();
  const now = new Date().toISOString();
  const extensoes = [
    ...(admissao.extensoesPrazo || []),
    { em: now, por: pessoa.id, porNome: pessoa.nome, horas },
  ];
  await updateDoc(doc(db, "admissoes", admissao.id), {
    expiraEm: novo,
    extensoesPrazo: extensoes,
    // Se estava expirada, volta pra "formulario_enviado" pra liberar o candidato.
    status: admissao.status === "expirada" ? "formulario_enviado" : admissao.status,
    updatedAt: now,
  });
  return novo;
}

// Reabre uma admissão em estado terminal (admitido/cancelada/expirada),
// devolvendo-a pra "Pronto pra admitir". Limpa flags de cancelamento e de
// admissão pra que o card volte ao fluxo normal. Operação master-only —
// pra casos extremos: admissão criada por engano, candidato voltou atrás,
// admissão duplicada, etc.
// Apaga os campos `admissaoKanbanColunas` e `admissaoSubtarefasTemplate`
// do restaurante — força a UI a voltar pros defaults globais do template.
// Útil quando o template global muda e o restaurante tinha um snapshot
// antigo salvo (que se sobrepõe ao default). Master-only.
export async function resetarLayoutKanban(restaurantId: string): Promise<void> {
  await updateDoc(doc(db, "restaurants", restaurantId), {
    admissaoKanbanColunas:      deleteField(),
    admissaoSubtarefasTemplate: deleteField(),
  });
}

export async function reabrirAdmissao(admissaoId: string, pessoa: Pessoa): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), {
    status: "pronto_admissao",
    canceladoEm:           deleteField(),
    canceladoPor:          deleteField(),
    motivoCancelamento:    deleteField(),
    motivosCancelamento:   deleteField(),
    aprovadoEm:            deleteField(),
    aprovadoPor:           deleteField(),
    pessoaIdCriada:        deleteField(),
    empregadoIdCriado:     deleteField(),
    reabertaEm:            now,
    reabertaPor:           { id: pessoa.id, nome: pessoa.nome },
    updatedAt:             now,
  });
}

export async function cancelarAdmissao(
  admissaoId: string,
  motivosTags: MotivoCancelamento[],
  motivoTexto: string,
  pessoa: Pessoa,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), stripUndefined({
    status: "cancelada",
    canceladoPor: { id: pessoa.id, nome: pessoa.nome },
    canceladoEm: now,
    motivoCancelamento: motivoTexto || undefined,
    motivosCancelamento: motivosTags.length > 0 ? motivosTags : undefined,
    updatedAt: now,
  }));
}

// Avança o status pra a próxima etapa do fluxo. Validação básica: não permite
// pular múltiplas etapas. Sucessor: status → próximo status.
const ORDEM_FLUXO: AdmissaoStatus[] = [
  "formulario_enviado",
  "formulario_preenchido",
  "solicitacao_contabilidade",
  "pronto_admissao",
  "admitido",
];

// Mapeia status legados (de admissões criadas antes da reestruturação) pros
// status atuais. Usado no carregamento das admissões pra evitar quebrar UI
// quando o doc tem um status que saiu do enum.
function normalizarStatusLegacy(s: string): AdmissaoStatus {
  if (s === "documentos_recebidos" || s === "assinando_documentos") {
    // documentos_recebidos virou parte de formulario_preenchido (col 2).
    // assinando_documentos virou parte de solicitacao_contabilidade (col 3).
    return s === "documentos_recebidos" ? "formulario_preenchido" : "solicitacao_contabilidade";
  }
  if (s === "onboarding") return "admitido";
  return s as AdmissaoStatus;
}

export function normalizarAdmissao(adm: Admissao): Admissao {
  return { ...adm, status: normalizarStatusLegacy(adm.status as string) };
}

export function proximoStatus(s: AdmissaoStatus): AdmissaoStatus | null {
  const i = ORDEM_FLUXO.indexOf(s);
  if (i < 0 || i >= ORDEM_FLUXO.length - 1) return null;
  return ORDEM_FLUXO[i + 1];
}

export async function avancarStatus(
  admissaoId: string,
  novoStatus: AdmissaoStatus,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), {
    status: novoStatus,
    updatedAt: now,
  });
}

// Avança status + aplica auto-trigger nas subtarefas em uma única gravação.
// Usar quando a ação do RH no UI corresponde a um evento monitorado
// (ex: clicar "Enviar pra contabilidade" → trigger envio_contabilidade).
export async function avancarStatusComTrigger(
  admissao: Admissao,
  novoStatus: AdmissaoStatus,
  trigger: AutoTriggerSubtarefa,
  pessoa: Pessoa,
): Promise<void> {
  const now = new Date().toISOString();
  const subtarefas = [...(admissao.subtarefas || [])];
  const mutou = aplicarAutoTrigger(subtarefas, trigger, pessoa, now);
  await updateDoc(doc(db, "admissoes", admissao.id), stripUndefined({
    status: novoStatus,
    ...(mutou ? { subtarefas } : {}),
    updatedAt: now,
  }));
}

// Valida se a admissão tem todos os dados finais preenchidos (pelo RH no
// momento de Iniciar Admissão ou em edição posterior). Necessário pra avançar
// pra Solicitação Contabilidade.
export function temDadosFinaisCompletos(adm: Admissao): boolean {
  if (!adm.cargoId) return false;
  if (!adm.dataAdmissao) return false;
  if (typeof adm.salario !== "number") return false;
  const h = adm.horariosCadastrados;
  if (!h || Object.keys(h).length === 0) return false;
  // Pelo menos 1 dia ativo no horário (validação leve — RH pode revisar
  // depois). Aceita estrutura HorarioDia ({ active, in, out, break }).
  const algumAtivo = Object.values(h).some((d) => {
    if (typeof d !== "object" || d == null) return false;
    return (d as { active?: boolean }).active === true;
  });
  return algumAtivo;
}

// Atualiza o checklist de 12 docs WhatsApp. NÃO muda status (admissão fica
// em formulario_preenchido — col 2 — enquanto RH conferir docs). Se todos
// recebidos, dispara o auto-trigger pra marcar a subtarefa "Conferir
// recebimento de docs".
export async function marcarDocumentosRecebidos(
  admissao: Admissao,
  pessoa: Pessoa,
  checklistItens: { id: string; nome: string; recebido: boolean; observacao?: string }[],
): Promise<void> {
  const now = new Date().toISOString();
  const todosRecebidos = checklistItens.length > 0 && checklistItens.every((i) => i.recebido);
  const subtarefas = [...(admissao.subtarefas || [])];
  let mutouSubtarefas = false;
  if (todosRecebidos) {
    mutouSubtarefas = aplicarAutoTrigger(subtarefas, "checklist_docs_completo", pessoa, now);
  }
  await updateDoc(doc(db, "admissoes", admissao.id), stripUndefined({
    documentosRecebidosEm: now,
    documentosRecebidosPor: { id: pessoa.id, nome: pessoa.nome },
    checklistDocumentos: {
      itens: checklistItens,
      atualizadoEm: now,
      atualizadoPor: { id: pessoa.id, nome: pessoa.nome },
    },
    ...(mutouSubtarefas ? { subtarefas } : {}),
    updatedAt: now,
  }));
}

// Atualiza só o checklist (sem mudar status). Usado pra revisar pendências
// depois de já ter marcado docs recebidos.
export async function atualizarChecklistDocumentos(
  admissaoId: string,
  pessoa: Pessoa,
  checklistItens: { id: string; nome: string; recebido: boolean; observacao?: string }[],
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), stripUndefined({
    checklistDocumentos: {
      itens: checklistItens,
      atualizadoEm: now,
      atualizadoPor: { id: pessoa.id, nome: pessoa.nome },
    },
    updatedAt: now,
  }));
}

// Atualiza dados básicos da vaga (cargo, salário, data admissão, horários).
// Pode ser chamado em qualquer etapa pra completar/corrigir dados. Não mexe
// no status — RH avança manualmente quando estiver tudo preenchido. Se o
// patch deixar a admissão com dados finais completos, dispara o auto-trigger.
export async function atualizarDadosBasicos(
  admissao: Admissao,
  patch: {
    cargoId?: string;
    salario?: number;
    dataAdmissao?: string;
    cargoConfianca?: boolean;
    horariosCadastrados?: Record<string, unknown>;
  },
  pessoa: Pessoa,
): Promise<void> {
  const now = new Date().toISOString();
  const merged: Admissao = {
    ...admissao,
    ...patch,
    horariosCadastrados: (patch.horariosCadastrados as Admissao["horariosCadastrados"]) ?? admissao.horariosCadastrados,
  };
  const subtarefas = [...(admissao.subtarefas || [])];
  let mutouSubtarefas = false;
  if (temDadosFinaisCompletos(merged)) {
    mutouSubtarefas = aplicarAutoTrigger(subtarefas, "dados_finais_completos", pessoa, now);
  }
  await updateDoc(doc(db, "admissoes", admissao.id), stripUndefined({
    ...patch,
    ...(mutouSubtarefas ? { subtarefas } : {}),
    updatedAt: now,
  }));
}

// Move manual no Kanban (não muda status).
export async function moverColunaKanban(
  admissaoId: string,
  colunaId: string,
): Promise<void> {
  await updateDoc(doc(db, "admissoes", admissaoId), {
    kanbanColunaId: colunaId,
    updatedAt: new Date().toISOString(),
  });
}

// Atualiza o schema/prazo/whatsapp DP/contatos/template de um restaurante.
export async function salvarConfigAdmissao(
  restaurantId: string,
  patch: Partial<Pick<
    Restaurant,
    | "admissaoPrazoDias"
    | "whatsappDP"
    | "contatosAdmissao"
    | "emailContabilidade"
    | "emailClinicaExames"
    | "clinicaExamesNome"
    | "clinicaExamesEndereco"
    | "clinicaExamesTelefone"
    | "admissaoFormSchema"
    | "admissaoKanbanColunas"
    | "admissaoSubtarefasTemplate"
  >>,
): Promise<void> {
  await setDoc(
    doc(db, "restaurants", restaurantId),
    stripUndefined(patch),
    { merge: true },
  );
}

// ─── Mensagens prontas WhatsApp ────────────────────────────────────────────

// Mensagem que o RH manda pro candidato com o link do formulário.
export function montarMensagemEnvioLink(
  candidatoNome: string,
  restNome: string,
  url: string,
  prazoDias: number,
): string {
  const primeiroNome = candidatoNome.split(" ")[0] || candidatoNome;
  return [
    `Olá, ${primeiroNome}! Tudo bem?`,
    "",
    `Aqui é da equipe do ${restNome}. Estamos com tudo pronto pra sua admissão — só precisamos que você preencha a ficha cadastral abaixo:`,
    "",
    url,
    "",
    `Você tem ${prazoDias === 1 ? "24 horas" : `${prazoDias} dias`} pra preencher. Depois desse prazo o link expira automaticamente.`,
    "",
    "Para acessar, vai ser solicitado o e-mail que você me informou.",
    "",
    "Qualquer dúvida, me avisa por aqui!",
  ].join("\n");
}

// Monta URL canonical do WhatsApp pra abrir o chat de um número com texto
// pré-preenchido. Usa api.whatsapp.com/send (em vez de wa.me) porque o
// redirect do wa.me às vezes mexe na codificação UTF-8 do texto e quebra
// emojis em alguns clients.
function montarLinkWhatsApp(numero: string, texto: string): string | null {
  const num = (numero || "").replace(/\D/g, "");
  if (!num) return null;
  const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
  if (numCompleto.length < 12) return null;
  return `https://api.whatsapp.com/send?phone=${numCompleto}&text=${encodeURIComponent(texto)}`;
}

// Link pro candidato mandar os documentos pro WhatsApp do DP.
// Usado dentro da página pública (botão "Enviar documentos via WhatsApp").
export function linkWhatsAppDP(
  whatsappDP: string,
  candidatoNome: string,
  candidatoCpf: string,
  restNome: string,
): string | null {
  const cpfFmt = candidatoCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const msg = [
    `Olá! Estou enviando os documentos pra minha admissão no ${restNome}.`,
    `Nome: ${candidatoNome}`,
    `CPF: ${cpfFmt}`,
    "",
    "Vou enviar as fotos a seguir.",
  ].join("\n");
  return montarLinkWhatsApp(whatsappDP, msg);
}

// Link pra mandar o link da admissão pro candidato.
export function linkWhatsAppCandidato(
  whatsapp: string,
  texto: string,
): string | null {
  return montarLinkWhatsApp(whatsapp, texto);
}

// ─── Status helpers ────────────────────────────────────────────────────────

export function statusEstaExpirada(adm: Admissao, now: number = Date.now()): boolean {
  if (adm.status !== "formulario_enviado") return false;
  if (!adm.expiraEm) return false;
  return new Date(adm.expiraEm).getTime() < now;
}

// Atualiza o status localmente (sem persistir) pra UI mostrar "expirada"
// mesmo se o doc ainda tem o valor antigo.
export function statusEfetivo(adm: Admissao, now: number = Date.now()): AdmissaoStatus {
  if (statusEstaExpirada(adm, now)) return "expirada";
  return adm.status;
}

// ─── Subtarefas ────────────────────────────────────────────────────────────

// Cria SubtarefaAdmissao[] a partir de um template, todas como `feita: false`.
export function instanciarSubtarefas(template: SubtarefaTemplate[]): SubtarefaAdmissao[] {
  return template
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((t) => ({ ...t, feita: false }));
}

// Mescla template atual com subtarefas da admissão:
//   - Insere subtarefas que existem no template mas não na admissão (novas).
//   - Atualiza campos do template (nome, colunaId, obrigatoria, ordem,
//     autoTrigger, atalho, pedeLink, pedeDataHora) em subtarefas existentes
//     — preserva estado de execução (feita, feitaEm, feitaPor, observacao,
//     link, dataAgendada).
//   - Mantém subtarefas órfãs (existiam na admissão mas saíram do template)
//     pra não perder dados; ficam soltas no final.
// Idempotente — retorna o mesmo array por referência quando não há diferença.
export function sincronizarSubtarefasComTemplate(
  atuais: SubtarefaAdmissao[],
  template: SubtarefaTemplate[],
): { sincronizadas: SubtarefaAdmissao[]; adicionou: boolean } {
  const porIdAtual = new Map(atuais.map((s) => [s.id, s]));
  const idsTemplate = new Set(template.map((t) => t.id));
  let mudou = false;

  // Mescla cada item do template com o estado existente (se houver).
  const mescladas: SubtarefaAdmissao[] = template.map((t) => {
    const ex = porIdAtual.get(t.id);
    if (!ex) {
      mudou = true;
      return { ...t, feita: false };
    }
    // Compara campos do template — se algum mudou, atualiza
    const atualizou =
      ex.nome !== t.nome ||
      ex.colunaId !== t.colunaId ||
      ex.checklistId !== t.checklistId ||
      ex.checklistNome !== t.checklistNome ||
      ex.obrigatoria !== t.obrigatoria ||
      ex.ordem !== t.ordem ||
      ex.autoTrigger !== t.autoTrigger ||
      JSON.stringify(ex.atalho) !== JSON.stringify(t.atalho) ||
      !!ex.pedeLink !== !!t.pedeLink ||
      !!ex.pedeDataHora !== !!t.pedeDataHora ||
      !!ex.pedeDadosBancarios !== !!t.pedeDadosBancarios;
    if (!atualizou) return ex;
    mudou = true;
    return {
      ...t,                       // campos do template (atualizados)
      feita: ex.feita,            // preserva estado de execução
      feitaEm: ex.feitaEm,
      feitaPor: ex.feitaPor,
      observacao: ex.observacao,
      link: ex.link,
      dataAgendada: ex.dataAgendada,
    };
  });

  // Subtarefas órfãs (no admin mas não no template). IDs deprecados são
  // removidos silenciosamente (foram fundidos ou aposentados). Os demais
  // ficam preservados no fim por segurança.
  const orfasReais = atuais.filter(
    (s) => !idsTemplate.has(s.id) && !DEPRECATED_SUBTAREFAS_IDS.has(s.id),
  );
  const removeuDeprecated = atuais.some(
    (s) => !idsTemplate.has(s.id) && DEPRECATED_SUBTAREFAS_IDS.has(s.id),
  );
  if (removeuDeprecated) mudou = true;
  const orfas = orfasReais;

  if (!mudou) return { sincronizadas: atuais, adicionou: false };
  return {
    sincronizadas: [...mescladas, ...orfas].sort((a, b) => a.ordem - b.ordem),
    adicionou: true,
  };
}

// Marca todas as subtarefas com o autoTrigger correspondente como feitas
// (in-place). Retorna true se alguma mudou de estado. Idempotente — pular
// se já feita.
export function aplicarAutoTrigger(
  subtarefas: SubtarefaAdmissao[],
  trigger: AutoTriggerSubtarefa,
  pessoa: Pessoa | { id: string; nome: string },
  emISO: string = new Date().toISOString(),
): boolean {
  let mutou = false;
  for (let i = 0; i < subtarefas.length; i++) {
    const s = subtarefas[i];
    if (!s) continue;
    if (s.autoTrigger !== trigger) continue;
    if (s.feita) continue;
    subtarefas[i] = {
      ...s,
      feita: true,
      feitaEm: emISO,
      feitaPor: { id: pessoa.id, nome: pessoa.nome },
    };
    mutou = true;
  }
  return mutou;
}

// Marca/desmarca uma subtarefa específica e persiste. Aceita também update
// de link externo, observação e dataAgendada (sem mudar feita).
export async function atualizarSubtarefa(
  admissao: Admissao,
  subtarefaId: string,
  patch: { feita?: boolean; observacao?: string; link?: string; dataAgendada?: string },
  pessoa: Pessoa,
): Promise<void> {
  const subtarefas = (admissao.subtarefas || []).map((s) => {
    if (s.id !== subtarefaId) return s;
    const next: SubtarefaAdmissao = { ...s };
    if (typeof patch.feita === "boolean") {
      next.feita = patch.feita;
      if (patch.feita) {
        next.feitaEm = new Date().toISOString();
        next.feitaPor = { id: pessoa.id, nome: pessoa.nome };
      } else {
        next.feitaEm = undefined;
        next.feitaPor = undefined;
      }
    }
    if (typeof patch.observacao === "string") {
      next.observacao = patch.observacao || undefined;
    }
    if (typeof patch.link === "string") {
      next.link = patch.link || undefined;
    }
    if (typeof patch.dataAgendada === "string") {
      next.dataAgendada = patch.dataAgendada || undefined;
    }
    return next;
  });
  await updateDoc(doc(db, "admissoes", admissao.id), stripUndefined({
    subtarefas,
    updatedAt: new Date().toISOString(),
  }));
}

// Lista as subtarefas obrigatórias e ainda pendentes de uma coluna específica.
// Usado pra bloquear avanço de coluna no Kanban.
export function subtarefasPendentesObrigatorias(
  adm: Admissao,
  colunaId: string,
): SubtarefaAdmissao[] {
  return (adm.subtarefas || []).filter(
    (s) => s.colunaId === colunaId && s.obrigatoria && !s.feita,
  );
}

// True se nenhuma subtarefa obrigatória da coluna atual está pendente.
export function podeAvancarDeColuna(adm: Admissao, colunaId: string): boolean {
  return subtarefasPendentesObrigatorias(adm, colunaId).length === 0;
}

// Calcula progresso "X / Y" das subtarefas de uma coluna — pra badge no card.
export function progressoSubtarefasColuna(
  adm: Admissao,
  colunaId: string,
): { feitas: number; total: number; obrigatoriasPendentes: number } {
  const da = (adm.subtarefas || []).filter((s) => s.colunaId === colunaId);
  const feitas = da.filter((s) => s.feita).length;
  const obrig = da.filter((s) => s.obrigatoria && !s.feita).length;
  return { feitas, total: da.length, obrigatoriasPendentes: obrig };
}

// Monta corpo de e-mail pra agendamento de exames admissionais com a clínica.
// Usado pelo botão "Gmail compose" da subtarefa de agendar exames. Inclui
// CPF e RG (se já preenchidos no form do candidato) pra clínica abrir o
// cadastro sem precisar pedir os números depois.
export function montarCorpoEmailClinica(
  admissao: Admissao,
  cargoNome: string | undefined,
  restNome: string,
): string {
  const c = admissao.candidato;
  const dataAdm = admissao.dataAdmissao
    ? admissao.dataAdmissao.split("-").reverse().join("/")
    : "(a confirmar)";
  const dados = (admissao.dadosPreenchidos as Record<string, unknown>) || {};
  const cpfFmt = c.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  const rgVal = typeof dados.rg === "string" ? dados.rg.trim() : "";
  const rgOrgao = typeof dados.rg_orgao === "string" ? dados.rg_orgao.trim() : "";
  const rgUf = typeof dados.rg_uf === "string" ? dados.rg_uf.trim() : "";
  const rgLinha = rgVal
    ? `RG: ${rgVal}${rgOrgao ? ` ${rgOrgao}` : ""}${rgUf ? `/${rgUf}` : ""}`
    : "RG: (será enviado pelo candidato)";
  return [
    "Olá,",
    "",
    "Preciso agendar exames admissionais (clínico + manipulador de alimentos) para o seguinte candidato:",
    "",
    `Empresa: ${restNome}`,
    `Nome: ${c.nome}`,
    `CPF: ${cpfFmt}`,
    rgLinha,
    `Cargo: ${cargoNome || "(a confirmar)"}`,
    `Data de admissão: ${dataAdm}`,
    "",
    "Aguardo retorno com horários disponíveis. Obrigado!",
  ].join("\n");
}

// Formata "YYYY-MM-DDTHH:MM" local (vindo de <input type="datetime-local">)
// pra "DD/MM/YYYY às HH:MM" exibível.
function fmtDataHoraLocal(s: string): string {
  if (!s) return "";
  const [d, h] = s.split("T");
  if (!d) return s;
  const [a, m, dia] = d.split("-");
  if (!a || !m || !dia) return s;
  return `${dia}/${m}/${a} às ${h || "--:--"}`;
}

// Lista de documentos que o candidato deve enviar por WhatsApp. Exportada
// pra ser usada tanto na mensagem de instruções quanto no box do form
// público (com botão "copiar lista").
export const LISTA_DOCS_WHATSAPP = [
  "RG (frente e verso)",
  "CPF",
  "Comprovante de residência",
  "Foto 3x4",
  "CTPS (página de rosto + qualificação civil)",
  "Título de eleitor",
  "Comprovante de PIS/PASEP",
  "Certificado de reservista (homens)",
  "Comprovante de escolaridade",
  "Certidão de nascimento dos dependentes (se houver)",
];

// Mensagem única de instruções. Tipicamente tem 3 blocos (exame + conta
// Itaú + docs); se o candidato já informou conta Itaú no form, o bloco 2
// é pulado e a intro vira "2 temas".
export function montarMensagemInstrucoesCandidato(
  admissao: Admissao,
  restNome: string,
  dataHoraExame: string,
  clinica: { nome: string; endereco: string; telefone: string },
  prazoDocsDias: number,
): string {
  const primeiroNome = admissao.candidato.nome.split(" ")[0] || admissao.candidato.nome;
  const quando = dataHoraExame ? fmtDataHoraLocal(dataHoraExame) : "(data a confirmar)";
  const docsLista = LISTA_DOCS_WHATSAPP.map((d) => `• ${d}`).join("\n");
  const jaTemItau = !!admissao.dadosBancariosItau?.agencia?.trim()
    && !!admissao.dadosBancariosItau?.conta?.trim();

  const partes: string[] = [];
  partes.push(
    `Olá, ${primeiroNome}!`,
    "",
    jaTemItau
      ? `Mensagem importante com 2 temas fundamentais pra sua admissão pela ${restNome}:`
      : `Mensagem importante com 3 temas fundamentais pra sua admissão pela ${restNome}:`,
    "",
    "*BLOCO 1 — EXAME MÉDICO*",
    "Seu exame admissional foi agendado:",
    `• Data: ${quando}`,
    `• Local: ${clinica.nome}`,
    `• Endereço: ${clinica.endereco}`,
    `• Telefone: ${clinica.telefone}`,
    "",
    "Favor comparecer no dia/horário marcados, levando documento com foto.",
    "",
    "Importante: no dia, você recebe também uma guia pra fazer o exame parasitológico — pra isso vai precisar de um potinho de coleta de fezes. Você pode:",
    "• Retirar conosco mediante agendamento no escritório; OU",
    "• Comprar em uma drogaria (Drogaria São Paulo, Raia ou Drogasil) e nos enviar a nota fiscal pra reembolso.",
    "",
  );
  // Bloco 2 (conta Itaú) só aparece quando candidato ainda não tem Itaú
  if (!jaTemItau) {
    partes.push(
      "*BLOCO 2 — CONTA BANCÁRIA ITAÚ*",
      `Você precisa abrir uma conta no Itaú (corrente ou salário) e nos enviar os dados (agência e conta) em até ${PRAZO_CONTA_ITAU_DIAS} dias. Dá pra fazer pelo app do banco, sem precisar ir na agência.`,
      "",
    );
  }
  // Bloco final é sempre o de docs — numeração ajusta automaticamente
  partes.push(
    jaTemItau ? "*BLOCO 2 — DOCUMENTOS PRA WHATSAPP*" : "*BLOCO 3 — DOCUMENTOS PRA WHATSAPP*",
    `Mande as fotos dos seguintes documentos por aqui em até ${prazoDocsDias === 1 ? "24 horas" : `${prazoDocsDias} dias`}:`,
    "",
    docsLista,
    "",
    "Qualquer dúvida, é só responder por aqui!",
  );
  return partes.join("\n");
}

// Mensagem padrão pra solicitar cadastro do empregado no banco interno —
// vai pro WhatsApp do financeiro do escritório.
export function montarMensagemBancoFinanceiro(admissao: Admissao): string {
  const c = admissao.candidato;
  const cpfFmt = c.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  const dados = admissao.dadosBancariosItau;
  return [
    "Olá! Segue solicitação de cadastro no banco interno:",
    "",
    `Nome: ${c.nome}`,
    `CPF: ${cpfFmt}`,
    "",
    "Conta Itaú:",
    `• Tipo: ${dados?.tipo === "salario" ? "salário" : dados?.tipo === "corrente" ? "corrente" : "(não informado)"}`,
    `• Agência: ${dados?.agencia || "(não informada)"}`,
    `• Conta: ${dados?.conta || "(não informada)"}`,
    "",
    "Obrigado!",
  ].join("\n");
}

export { WHATSAPP_FINANCEIRO_DEFAULT, PRAZO_CONTA_ITAU_DIAS };

// Atualiza os dados bancários Itaú da admissão (campo top-level — não fica
// dentro de subtarefa). Usado pelo input `pedeDadosBancarios` do drawer.
export async function atualizarDadosBancariosItau(
  admissaoId: string,
  patch: Partial<{ tipo: "salario" | "corrente"; agencia: string; conta: string }>,
  dadosAtuais?: { tipo: "salario" | "corrente"; agencia: string; conta: string },
): Promise<void> {
  const merged = {
    tipo:     patch.tipo     ?? dadosAtuais?.tipo     ?? "salario",
    agencia:  patch.agencia  ?? dadosAtuais?.agencia  ?? "",
    conta:    patch.conta    ?? dadosAtuais?.conta    ?? "",
  };
  await updateDoc(doc(db, "admissoes", admissaoId), {
    dadosBancariosItau: merged,
    updatedAt: new Date().toISOString(),
  });
}

// ─── Aprovação final ───────────────────────────────────────────────────────
// Cria os registros de Pessoa + Empregado a partir da admissão concluída e
// fecha o ciclo. Reusa Pessoa pré-existente se a admissão foi vinculada
// via pessoaIdVinculada. Operação idempotente — se já tem pessoaIdCriada
// e empregadoIdCriado no doc, retorna esses IDs sem recriar.
export async function aprovarAdmissao(
  admissao: Admissao,
  aprovadoPor: Pessoa,
): Promise<{ pessoaId: string; empregadoId: string }> {
  // Idempotência: se já foi aprovada, retorna o que tem
  if (admissao.pessoaIdCriada && admissao.empregadoIdCriado) {
    return {
      pessoaId: admissao.pessoaIdCriada,
      empregadoId: admissao.empregadoIdCriado,
    };
  }

  const now = new Date().toISOString();
  const candidato = admissao.candidato;
  const dados = (admissao.dadosPreenchidos as Record<string, unknown>) || {};

  // ── 1. Resolve Pessoa: existente ou nova ──
  let pessoaId: string;
  if (admissao.pessoaIdVinculada) {
    // Vincula a Pessoa existente. Adiciona o rid à lista se ainda não tiver.
    pessoaId = admissao.pessoaIdVinculada;
    const pessoaRef = doc(db, "pessoas", pessoaId);
    const pessoaSnap = await getDoc(pessoaRef);
    if (!pessoaSnap.exists()) {
      throw new Error(`Pessoa vinculada (${pessoaId}) não existe mais. Apague o vínculo e tente de novo.`);
    }
    const p = pessoaSnap.data() as Pessoa;
    const rids = p.restaurantIds || [];
    if (!rids.includes(admissao.restaurantId)) {
      const novosConvites = [...(p.novosRestaurantes || []), admissao.restaurantId];
      await updateDoc(pessoaRef, {
        restaurantIds: [...rids, admissao.restaurantId],
        novosRestaurantes: novosConvites,
      });
    }
  } else {
    // Cria Pessoa nova. Email vira identidade — já bloqueamos duplicado no
    // IniciarAdmissaoModal, então aqui é seguro.
    const pixCandidato = typeof dados.pix === "string" ? dados.pix.trim() : "";
    const novaPessoa: Omit<Pessoa, "id"> = {
      email: candidato.email.toLowerCase(),
      nome: candidato.nome,
      cpf: candidato.cpf,
      whatsapp: candidato.whatsapp,
      pix: pixCandidato || undefined,
      isMaster: false,
      restaurantIds: [admissao.restaurantId],
      // Permissões iniciais vazias — RH configura depois no módulo Pessoas
      // (matriz de permissões). Banner "Você foi adicionado ao restaurante X"
      // aparece pra Pessoa graças ao novosRestaurantes.
      permissions: { [admissao.restaurantId]: {} as Pessoa["permissions"][string] },
      novosRestaurantes: [admissao.restaurantId],
      ativa: true,
      createdAt: now,
    };
    const ref = await addDoc(collection(db, "pessoas"), stripUndefined(novaPessoa));
    pessoaId = ref.id;
  }

  // ── 2. Cria Empregado novo ──
  // (Sempre cria — mesmo se Pessoa já existia em outro rest, esta é uma
  // admissão neste rest específico → empregado novo nesse rest.)
  const dataAdmissaoStr = admissao.dataAdmissao || now.slice(0, 10);
  const periodo: EmpregadoPeriodo = {
    admissao: dataAdmissaoStr,
    registradoEm: now,
    registradoPor: aprovadoPor.id,
  };
  const novoEmpregado: Omit<Empregado, "id"> = {
    restaurantId: admissao.restaurantId,
    pessoaId,
    nome: candidato.nome,
    cpf: candidato.cpf,
    cargoId: admissao.cargoId,
    periodos: [periodo],
    estaAtivo: true,
    admissaoAtual: dataAdmissaoStr,
    email: candidato.email,
    telefone: candidato.whatsapp,
    emergenciaNome: typeof dados.contato_emergencia_nome === "string"
      ? dados.contato_emergencia_nome
      : null,
    emergenciaTelefone: typeof dados.tel_emergencia === "string"
      ? dados.tel_emergencia
      : null,
    createdAt: now,
    createdBy: aprovadoPor.id,
  };
  const empregadoRef = await addDoc(collection(db, "empregados"), stripUndefined(novoEmpregado));
  const empregadoId = empregadoRef.id;

  // ── 3. Atualiza a admissão ──
  await updateDoc(doc(db, "admissoes", admissao.id), {
    aprovadoEm: now,
    aprovadoPor: { id: aprovadoPor.id, nome: aprovadoPor.nome },
    pessoaIdCriada: pessoaId,
    empregadoIdCriado: empregadoId,
    updatedAt: now,
  });

  return { pessoaId, empregadoId };
}
