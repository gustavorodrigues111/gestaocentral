// Ponte Prazos → Tarefas.
//
// "Agendar" um prazo cria uma Tarefa REAL no Gestor de Tarefas no dia da
// execução (não um card derivado), com back-ref ao prazo. Reagendar atualiza
// a data dessa tarefa; desagendar a remove (soft delete). A tarefa vive na
// área de sistema "Prazos" (proj-prazos, escondida dos chips de área), então
// aparece em "Minhas Tarefas"/calendário do responsável sem poluir a seleção.
//
// Ver [[project_gestor_redesign_2modulos]] (Fase 3 — a ponte entre os módulos).

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Prazo, Tarefa } from "../../core/types";
import { PRAZO_TIPO_LABEL } from "../../core/types";
import { criarTarefa, atualizarTarefa, softDeleteTarefa, getTarefa, mudarStatus } from "../tarefas/repository";
import { resolverPrazo, podeResolver } from "./logic";

// Área de sistema onde as tarefas de agendamento de prazo pousam.
const AREA_PRAZOS = "proj-prazos";

type Autor = { id: string; nome: string };

function tituloTarefa(p: Prazo): string {
  return `📅 ${p.titulo}`;
}

function descricaoTarefa(p: Prazo, vencimento: string): string {
  const partes = [
    `Agendamento do prazo "${p.titulo}" (${PRAZO_TIPO_LABEL[p.tipo]}).`,
    `Vencimento: ${brl(vencimento)}.`,
  ];
  if (p.exigeLaudo) partes.push("Este prazo exige laudo/comprovante — anexe no módulo Prazos ao concluir.");
  return partes.join("\n");
}

// dd/mm/aaaa a partir de YYYY-MM-DD (evita dep de utils só pra isso).
function brl(ymd?: string): string {
  if (!ymd) return "—";
  const [a, m, d] = ymd.split("-");
  return d ? `${d}/${m}/${a}` : ymd;
}

// Cria (ou reaproveita) a tarefa de execução de um prazo agendado.
// Retorna o id da tarefa pra gravar em Prazo.agendamento.tarefaId.
export async function criarOuAtualizarTarefaAgendamento(
  p: Prazo,
  dataExecucao: string,          // YYYY-MM-DD
  autor: Autor,
): Promise<string> {
  const tarefaIdExistente = p.agendamento?.tarefaId || null;

  // Reagendamento: se já existe uma tarefa viva, só move a data.
  if (tarefaIdExistente) {
    const existente = await getTarefa(tarefaIdExistente);
    if (existente && !existente.deletadoEm) {
      await atualizarTarefa(tarefaIdExistente, { prazo: dataExecucao }, autor, {
        acao: "editada",
        campo: "prazo",
        valorAntes: brl(existente.prazo || undefined),
        valorDepois: brl(dataExecucao),
        detalhe: "Reagendado a partir do módulo Prazos",
      });
      return tarefaIdExistente;
    }
  }

  // Caso novo (ou tarefa antiga foi apagada): cria do zero.
  const nova: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm"> = {
    projetoId: AREA_PRAZOS,
    subprojetoId: "",
    titulo: tituloTarefa(p),
    descricao: descricaoTarefa(p, p.vencimento),
    responsavelId: p.responsavelId || autor.id,
    responsavelNome: p.responsavelNome || autor.nome,
    restaurantIds: p.restaurantIds,
    prazo: dataExecucao,
    status: "a_fazer",
    prioridade: p.tipo === "trabalhista" ? "alta" : "normal",
    origem: "prazo",
    origemRefId: p.id,
    origemRefLabel: p.titulo,
    criadoPor: autor.id,
    criadoPorNome: autor.nome,
  };
  return criarTarefa(nova);
}

// Desagendar: remove a tarefa de execução (soft delete), se existir.
export async function removerTarefaAgendamento(p: Prazo, autor: Autor): Promise<void> {
  const tid = p.agendamento?.tarefaId;
  if (!tid) return;
  try {
    const t = await getTarefa(tid);
    if (t && !t.deletadoEm) {
      await softDeleteTarefa(tid, autor, "Prazo desagendado");
    }
  } catch {
    // best-effort — não bloqueia o desagendamento do prazo
  }
}

// Prazo realizado: conclui a tarefa de execução vinculada (se aberta).
export async function concluirTarefaAgendamento(p: Prazo, autor: Autor): Promise<void> {
  const tid = p.agendamento?.tarefaId;
  if (!tid) return;
  try {
    const t = await getTarefa(tid);
    if (t && !t.deletadoEm && t.status !== "concluida") {
      await mudarStatus(tid, "concluida", autor);
    }
  } catch {
    // best-effort — o prazo já foi resolvido; a tarefa é secundária
  }
}

export type ResolverDaTarefaResultado =
  | { ok: true; recorrente: boolean }
  | { ok: false; motivo: "nao_encontrado" | "ja_resolvido" | "precisa_laudo" };

// Direção inversa: concluir a tarefa de agendamento OFERECE resolver o prazo.
// Carrega o prazo pelo id, respeita a trava de laudo, e resolve (arquiva +
// avança se recorrente). Retorna o desfecho pra UI dar o feedback certo.
export async function resolverPrazoDaTarefa(prazoId: string, autor: Autor): Promise<ResolverDaTarefaResultado> {
  const ref = doc(db, "prazos", prazoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, motivo: "nao_encontrado" };
  const p = { id: snap.id, ...(snap.data() as Record<string, unknown>) } as Prazo;
  if (p.deletadoEm) return { ok: false, motivo: "nao_encontrado" };
  if (p.status === "resolvido") return { ok: false, motivo: "ja_resolvido" };
  if (!podeResolver(p)) return { ok: false, motivo: "precisa_laudo" };
  const atualizado = resolverPrazo(p, { em: new Date().toISOString(), por: autor.id, porNome: autor.nome });
  await setDoc(ref, sanitizeForFirestore({ ...atualizado, atualizadoEm: new Date().toISOString() }), { merge: true });
  return { ok: true, recorrente: !!p.recorrencia };
}
