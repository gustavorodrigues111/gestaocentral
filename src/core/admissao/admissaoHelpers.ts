// ════════════════════════════════════════════════════════════════════════════
//  Helpers de admissão — CRUD + ações de fluxo (envio do link, reenvio,
//  expirar, cancelar, aprovar). Lógica server-safe (não toca em UI).
// ════════════════════════════════════════════════════════════════════════════

import {
  addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  Admissao, AdmissaoStatus, FormField, Pessoa, Restaurant,
} from "../types";
import { TEMPLATE_ADMISSAO_DEFAULT, KANBAN_COLUNAS_DEFAULT } from "./formTemplate";

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
  schemaUsado: FormField[];   // passa snapshot já resolvido
};

export async function iniciarAdmissao(
  input: IniciarAdmissaoInput,
  pessoa: Pessoa,
): Promise<Admissao> {
  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, "admissoes"), stripUndefined(novo));
  return { id: ref.id, ...novo } as Admissao;
}

// Marca o envio do link: define enviadoEm + expiraEm baseado no prazo do rest.
// É essa ação que dispara o timer pro candidato.
export async function marcarLinkEnviado(
  admissaoId: string,
  prazoDias: number,
): Promise<{ enviadoEm: string; expiraEm: string }> {
  const enviadoEm = new Date().toISOString();
  const expiraEm = new Date(Date.now() + prazoDias * 86400000).toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), {
    enviadoEm,
    expiraEm,
    updatedAt: enviadoEm,
  });
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

export async function cancelarAdmissao(
  admissaoId: string,
  motivo: string,
  pessoa: Pessoa,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), stripUndefined({
    status: "cancelada",
    canceladoPor: { id: pessoa.id, nome: pessoa.nome },
    canceladoEm: now,
    motivoCancelamento: motivo,
    updatedAt: now,
  }));
}

export async function marcarDocumentosRecebidos(
  admissaoId: string,
  pessoa: Pessoa,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "admissoes", admissaoId), {
    status: "documentos_recebidos",
    documentosRecebidosEm: now,
    documentosRecebidosPor: { id: pessoa.id, nome: pessoa.nome },
    updatedAt: now,
  });
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

// Atualiza o schema/prazo/whatsapp DP de um restaurante.
export async function salvarConfigAdmissao(
  restaurantId: string,
  patch: Partial<Pick<Restaurant, "admissaoPrazoDias" | "whatsappDP" | "admissaoFormSchema" | "admissaoKanbanColunas">>,
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
    `Você tem ${prazoDias === 1 ? "24 horas" : `${prazoDias} dias`} pra preencher. Depois desse prazo o link expira e precisa pedir um novo.`,
    "",
    "Qualquer dúvida, me avisa por aqui!",
  ].join("\n");
}

// Link wa.me pra o candidato mandar os documentos pro WhatsApp do DP.
// Usado dentro da página pública (botão "Enviar documentos via WhatsApp").
export function linkWhatsAppDP(
  whatsappDP: string,
  candidatoNome: string,
  candidatoCpf: string,
  restNome: string,
): string | null {
  const num = (whatsappDP || "").replace(/\D/g, "");
  if (!num) return null;
  const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
  if (numCompleto.length < 12) return null;
  const cpfFmt = candidatoCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const msg = [
    `Olá! Estou enviando os documentos pra minha admissão no ${restNome}.`,
    `Nome: ${candidatoNome}`,
    `CPF: ${cpfFmt}`,
    "",
    "Vou enviar as fotos a seguir.",
  ].join("\n");
  return `https://wa.me/${numCompleto}?text=${encodeURIComponent(msg)}`;
}

// Link wa.me pra mandar o link da admissão pro candidato.
export function linkWhatsAppCandidato(
  whatsapp: string,
  texto: string,
): string | null {
  const num = (whatsapp || "").replace(/\D/g, "");
  if (!num) return null;
  const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
  if (numCompleto.length < 12) return null;
  return `https://wa.me/${numCompleto}?text=${encodeURIComponent(texto)}`;
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
