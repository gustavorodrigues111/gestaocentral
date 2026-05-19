// ════════════════════════════════════════════════════════════════════════════
//  Status da semana — workflow líder → gerente. Persiste em /excecoesStatusSemana.
// ════════════════════════════════════════════════════════════════════════════

import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  ApontamentoEscala, ApontamentoFuncionario, ApontamentoStatus, ExcecaoHistoricoEntry,
  ExcecaoStatusSemana, ExcecaoStatusValor, NotaInterna, Pessoa, RelatorioSnapshot,
} from "../types";

export function statusDocId(restaurantId: string, weekStart: string): string {
  return `${restaurantId}_${weekStart}`;
}

export async function carregarStatusSemana(
  restaurantId: string,
  weekStart: string,
): Promise<ExcecaoStatusSemana | null> {
  const id = statusDocId(restaurantId, weekStart);
  const snap = await getDoc(doc(db, "excecoesStatusSemana", id));
  if (!snap.exists()) return null;
  return { id, ...snap.data() } as ExcecaoStatusSemana;
}

// Lista todas as semanas do restaurante com status registrado. Usado pela
// aba "Ajustes de escala".
export async function listarStatusDoRestaurante(
  restaurantId: string,
): Promise<ExcecaoStatusSemana[]> {
  const q = query(
    collection(db, "excecoesStatusSemana"),
    where("restaurantId", "==", restaurantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExcecaoStatusSemana));
}

// Valida se a pessoa pode aplicar a transição de status, considerando o
// estado ATUAL (pra permitir reverter respeitando hierarquia):
//   - `ver` (líder)        → pode marcar/reverter entre aberto/em_tratamento/
//                            tratado_lider, MAS não mexe se já tá
//                            conferido_gerente
//   - `configurar` (gerente) → mesmas regras do líder + pode marcar
//                              conferido_gerente E reverter a conferência
//   - master               → tudo
export function podeMarcarStatus(
  pessoa: Pessoa | null,
  restaurantId: string,
  novoStatus: ExcecaoStatusValor,
  statusAtual?: ExcecaoStatusValor,
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  const p = pessoa.permissions?.[restaurantId]?.excecoes;
  if (!p) return false;
  const podeOperar = p.ver === true || p.configurar === true; // líder OU gerente
  const podeConferir = p.configurar === true;                  // só gerente

  // Se a semana já foi conferida, só gerente pode mexer (descer pra tratado_lider).
  if (statusAtual === "conferido_gerente") {
    return podeConferir;
  }

  // Marcar conferida: só gerente
  if (novoStatus === "conferido_gerente") return podeConferir;

  // Restante (aberto/em_tratamento/tratado_lider): qualquer um com ver/configurar
  return podeOperar;
}

export async function marcarStatus(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  novoStatus: ExcecaoStatusValor,
  pessoa: Pessoa,
  observacao?: string,
): Promise<ExcecaoStatusSemana> {
  const id = statusDocId(restaurantId, weekStart);
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const entry: ExcecaoHistoricoEntry = {
    status: novoStatus,
    em: now,
    por: pessoa.id,
    porNome: pessoa.nome,
    ...(observacao ? { observacao } : {}),
  };
  const next: ExcecaoStatusSemana = {
    id,
    restaurantId,
    weekStart,
    weekEnd,
    status: novoStatus,
    historico: [...(existing?.historico || []), entry],
    ...(existing?.apontamentos ? { apontamentos: existing.apontamentos } : {}),
    updatedAt: now,
  };
  await setDoc(doc(db, "excecoesStatusSemana", id), next);
  return next;
}

// ─── Apontamentos por empregado dentro da semana ────────────────────────────
//
// Quando o status da semana ainda não existe (1ª anotação antes de "marcar
// em tratamento"), criamos o doc com status="em_tratamento" e o apontamento.
// Isso mantém um único doc por semana com todo o tracking junto.

function uidApont(): string {
  return `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function upsertSemana(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  patch: Partial<ExcecaoStatusSemana>,
): Promise<ExcecaoStatusSemana> {
  const id = statusDocId(restaurantId, weekStart);
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const next: ExcecaoStatusSemana = {
    id,
    restaurantId,
    weekStart,
    weekEnd,
    status: existing?.status || "em_tratamento",
    historico: existing?.historico || [],
    ...(existing?.apontamentos ? { apontamentos: existing.apontamentos } : {}),
    ...(existing?.notasInternas ? { notasInternas: existing.notasInternas } : {}),
    ...(existing?.relatorioCache ? { relatorioCache: existing.relatorioCache } : {}),
    ...(existing?.apontamentosEscala ? { apontamentosEscala: existing.apontamentosEscala } : {}),
    ...patch,
    updatedAt: now,
  };
  // Firestore rejeita `undefined` em qualquer campo. Limpamos antes de gravar.
  await setDoc(doc(db, "excecoesStatusSemana", id), stripUndefined(next));
  return next;
}

export async function adicionarApontamento(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  base: Omit<
    ApontamentoFuncionario,
    "id" | "criadoEm" | "criadoPor" | "criadoPorNome" | "status" | "enviar"
  >,
  pessoa: Pessoa,
  status: ApontamentoStatus = "pendente",
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const novo: ApontamentoFuncionario = {
    ...base,
    id: uidApont(),
    status,
    ...(status === "ciencia" ? { cienciaEm: now, cienciaPor: pessoa.id, cienciaPorNome: pessoa.nome } : {}),
    criadoEm: now,
    criadoPor: pessoa.id,
    criadoPorNome: pessoa.nome,
  };
  const apontamentos = [...(existing?.apontamentos || []), novo];
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentos });
}

export async function atualizarApontamento(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoId: string,
  patch: Partial<Pick<ApontamentoFuncionario, "texto" | "status" | "enviadoEm" | "cienciaEm">>,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const apontamentos = (existing?.apontamentos || []).map((a) =>
    a.id === apontamentoId ? { ...a, ...patch } : a,
  );
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentos });
}

export async function removerApontamento(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoId: string,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const apontamentos = (existing?.apontamentos || []).filter((a) => a.id !== apontamentoId);
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentos });
}

// Marca os IDs informados como "enviado" (status + enviadoEm). Usado quando o
// líder dispara o WhatsApp do empregado.
export async function marcarApontamentosEnviados(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoIds: string[],
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const set = new Set(apontamentoIds);
  const apontamentos = (existing?.apontamentos || []).map((a) =>
    set.has(a.id) ? { ...a, status: "enviado" as ApontamentoStatus, enviadoEm: now } : a,
  );
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentos });
}

// Marca apontamento como "ciencia" (não vai pro WhatsApp, fica registrado).
// Usado pra apontamentos não-tratáveis (ex: intervalo a menos que já passou).
export async function marcarApontamentoCiencia(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoId: string,
  pessoa: Pessoa,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const apontamentos = (existing?.apontamentos || []).map((a) =>
    a.id === apontamentoId
      ? {
          ...a,
          status: "ciencia" as ApontamentoStatus,
          cienciaEm: now,
          cienciaPor: pessoa.id,
          cienciaPorNome: pessoa.nome,
        }
      : a,
  );
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentos });
}

// ─── Notas internas (não visíveis pro empregado) ────────────────────────────

function uidNota(): string {
  return `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function adicionarNotaInterna(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  base: Omit<NotaInterna, "id" | "criadoEm" | "criadoPor" | "criadoPorNome">,
  pessoa: Pessoa,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const nova: NotaInterna = {
    ...base,
    id: uidNota(),
    criadoEm: new Date().toISOString(),
    criadoPor: pessoa.id,
    criadoPorNome: pessoa.nome,
  };
  const notasInternas = [...(existing?.notasInternas || []), nova];
  return upsertSemana(restaurantId, weekStart, weekEnd, { notasInternas });
}

// Salva o snapshot do último relatório gerado no doc da semana. Usado quando
// o líder está em tratamento e quer manter memória entre sessões.
//
// `upsertSemana` aplica stripUndefined antes de gravar — Firestore rejeita
// `undefined` em qualquer campo, e ExceptionRecord.detail é opcional.
export async function salvarRelatorioCache(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  relatorio: RelatorioSnapshot,
): Promise<ExcecaoStatusSemana> {
  return upsertSemana(restaurantId, weekStart, weekEnd, { relatorioCache: relatorio });
}

// Remove recursivamente chaves com valor `undefined` — necessário pro
// Firestore não rejeitar o objeto. Array é mapeado; primitivos passam direto.
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.map((x) => stripUndefined(x)) as unknown as T;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = stripUndefined(val);
    }
    return out as T;
  }
  return v;
}

// ─── Apontamentos de Escala (gerados quando o gerente confere) ─────────────

// Regras de exceção que afetam ESCALA PRATICADA. Outras (intervalo curto,
// jornada >10h, ponto aberto, etc) não viram apontamento de escala — são
// problemas de ponto, não de escala.
const REGRAS_QUE_AFETAM_ESCALA = new Set<string>([
  "faltaSemAjuste",       // escalado pra trabalho mas não veio → lançar falta
  "marcacaoForaDaEscala", // veio em dia previsto pra folga → trocar pra trabalho
]);

function uidApEsc(): string {
  return `aes_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Gera os apontamentos de escala a partir do snapshot do relatório. Cada
// exceção que afeta escala vira 1 apontamento. PRESERVA o status (`ajustado`)
// de itens equivalentes que já existiam, identificados pela tripla
// (empregadoId, data, ruleId) — não reseta progresso quando o gerente reabre
// e re-confere a semana.
export async function gerarApontamentosEscala(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  if (!existing?.relatorioCache) {
    throw new Error("Sem snapshot do relatório — gere o relatório antes de conferir.");
  }
  // Mapa do que já estava ajustado pra preservar progresso
  const previous = new Map<string, ApontamentoEscala>();
  for (const a of existing.apontamentosEscala || []) {
    previous.set(`${a.empregadoId}_${a.data}_${a.ruleId}`, a);
  }
  const now = new Date().toISOString();
  const novos: ApontamentoEscala[] = [];
  type ExcSlim = {
    ruleId: string; date?: string; cpf?: string; employeeName?: string;
    description?: string; detail?: string;
  };
  for (const exc of (existing.relatorioCache.exceptions as ExcSlim[])) {
    if (!REGRAS_QUE_AFETAM_ESCALA.has(exc.ruleId)) continue;
    // empregadoId real só dá pra resolver do lado do client (precisa do mapa
    // CPF → emp.id). Aqui usamos o CPF como chave; o client preenche o resto.
    // Pra simplicidade desta versão, salvamos com cpf (não empregadoId) e o
    // client resolve no render. Mas como nossas chaves de comparação usam
    // empregadoId, vamos usar o CPF mesmo (atribuído ao campo empregadoId
    // temporariamente). Refinar depois quando o caller passar o mapa.
    const empregadoId = exc.cpf || "";
    const data = exc.date || "";
    const ruleId = exc.ruleId;
    const k = `${empregadoId}_${data}_${ruleId}`;
    const prev = previous.get(k);
    novos.push({
      id: prev?.id || uidApEsc(),
      empregadoId,
      empregadoNome: exc.employeeName || "",
      data,
      ruleId,
      texto: `${exc.description || ""}${exc.detail ? ` (${exc.detail})` : ""}`,
      status: prev?.status || "pendente",
      ...(prev?.ajustadoEm ? { ajustadoEm: prev.ajustadoEm } : {}),
      ...(prev?.ajustadoPor ? { ajustadoPor: prev.ajustadoPor } : {}),
      ...(prev?.ajustadoPorNome ? { ajustadoPorNome: prev.ajustadoPorNome } : {}),
      criadoEm: prev?.criadoEm || now,
    });
  }
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentosEscala: novos });
}

export async function marcarApontamentoEscalaAjustado(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoId: string,
  pessoa: Pessoa,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const apontamentosEscala = (existing?.apontamentosEscala || []).map((a) =>
    a.id === apontamentoId
      ? {
          ...a,
          status: "ajustado" as const,
          ajustadoEm: now,
          ajustadoPor: pessoa.id,
          ajustadoPorNome: pessoa.nome,
        }
      : a,
  );
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentosEscala });
}

export async function reabrirApontamentoEscala(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  apontamentoId: string,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const apontamentosEscala = (existing?.apontamentosEscala || []).map((a) =>
    a.id === apontamentoId
      ? { ...a, status: "pendente" as const, ajustadoEm: undefined, ajustadoPor: undefined, ajustadoPorNome: undefined }
      : a,
  );
  return upsertSemana(restaurantId, weekStart, weekEnd, { apontamentosEscala });
}

export async function removerNotaInterna(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  notaId: string,
): Promise<ExcecaoStatusSemana> {
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const notasInternas = (existing?.notasInternas || []).filter((n) => n.id !== notaId);
  return upsertSemana(restaurantId, weekStart, weekEnd, { notasInternas });
}
