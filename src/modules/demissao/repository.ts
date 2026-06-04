// Repository do módulo Demissão.
// Coleção: /processosDemissao/{id}

import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot,
  setDoc, addDoc, updateDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ProcessoDemissao, DemissaoIniciativa, SubtarefaDemissaoInstance,
} from "../../core/types";
import {
  SUBTAREFAS_DEMISSAO_DEFAULT, subtarefasParaIniciativa,
} from "./template";

const COL = "processosDemissao";

// ─── CRUD ─────────────────────────────────────────────────────────────

export function ouvirProcessos(
  restaurantId: string,
  cb: (lista: ProcessoDemissao[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL), where("restaurantId", "==", restaurantId)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProcessoDemissao)))
  );
}

export async function getProcesso(id: string): Promise<ProcessoDemissao | null> {
  const s = await getDoc(doc(db, COL, id));
  return s.exists() ? ({ id: s.id, ...s.data() } as ProcessoDemissao) : null;
}

// Verifica se já existe processo NÃO concluído/cancelado pra esse empregado
export async function processoAtivoDoEmpregado(empregadoId: string): Promise<ProcessoDemissao | null> {
  const snap = await getDocs(query(collection(db, COL), where("empregadoId", "==", empregadoId)));
  const ativo = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as ProcessoDemissao))
    .find(p => p.status !== "concluido" && p.status !== "cancelado");
  return ativo || null;
}

// ─── Iniciação ────────────────────────────────────────────────────────

export type IniciarProcessoInput = {
  restaurantId: string;
  empregadoId: string;
  empregadoNomeSnapshot: string;
  cargoSnapshot?: string;
  pessoaId?: string;
  iniciativa: DemissaoIniciativa;
  dataAlvo?: string;
  avisoPrevio?: "trabalhado" | "indenizado";
  motivoIniciacao?: string;
  iniciadoPor: { id: string; nome: string };
};

export async function iniciarProcesso(input: IniciarProcessoInput): Promise<string> {
  // Bloqueia se já existe processo ativo
  const ativo = await processoAtivoDoEmpregado(input.empregadoId);
  if (ativo) throw new Error(`Já existe processo de demissão em andamento (id ${ativo.id}, status: ${ativo.status})`);

  const now = new Date().toISOString();
  // Filtra template pela iniciativa
  const schemaUsado = subtarefasParaIniciativa(SUBTAREFAS_DEMISSAO_DEFAULT, input.iniciativa);
  const subtarefas: SubtarefaDemissaoInstance[] = schemaUsado.map(t => ({ ...t, feita: false }));

  // Backup do estado anterior da pessoa pra reverter se cancelar
  let pessoaAtivaAnterior: boolean | undefined;
  if (input.pessoaId) {
    try {
      const ps = await getDoc(doc(db, "pessoas", input.pessoaId));
      if (ps.exists()) {
        pessoaAtivaAnterior = (ps.data() as { ativa?: boolean }).ativa !== false;
      }
    } catch (e) {
      console.warn("[demissao] falha ao ler pessoa pra backup:", e);
    }
  }

  const data: Omit<ProcessoDemissao, "id"> = {
    restaurantId: input.restaurantId,
    empregadoId: input.empregadoId,
    empregadoNomeSnapshot: input.empregadoNomeSnapshot,
    cargoSnapshot: input.cargoSnapshot,
    pessoaId: input.pessoaId,
    iniciativa: input.iniciativa,
    status: "iniciado",
    kanbanColunaId: "col_iniciado",
    iniciadoEm: now,
    iniciadoPor: input.iniciadoPor,
    motivoIniciacao: input.motivoIniciacao,
    dataAlvo: input.dataAlvo,
    avisoPrevio: input.avisoPrevio,
    pessoaAtivaAnterior,
    examesIdsDesativados: [],
    tarefasIdsCanceladas: [],
    schemaUsado,
    subtarefas,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, COL), sanitizeForFirestore(data));

  // Bloqueio imediato pra Empregado/Acordo (Empresa bloqueia depois,
  // ao marcar subtarefa ehBloqueioAcesso=true ou via botão manual)
  if (input.iniciativa !== "empresa" && input.pessoaId) {
    await bloquearAcesso(ref.id, input.iniciadoPor);
  }

  return ref.id;
}

// ─── Bloqueio de acesso ────────────────────────────────────────────────

export async function bloquearAcesso(
  processoId: string,
  por: { id: string; nome: string },
): Promise<void> {
  const proc = await getProcesso(processoId);
  if (!proc || !proc.pessoaId) return;
  if (proc.acessoBloqueadoEm) return; // idempotente

  const now = new Date().toISOString();
  // Marca pessoa como inativa (bloqueia próximo login em ≤30s)
  await updateDoc(doc(db, "pessoas", proc.pessoaId), sanitizeForFirestore({
    ativa: false,
    inativadaEm: now,
    inativadaPor: por.id,
    motivoInativacao: `Demissão em andamento — ${proc.id}`,
  }));
  // Marca processo
  await updateDoc(doc(db, COL, processoId), sanitizeForFirestore({
    acessoBloqueadoEm: now,
    acessoBloqueadoPor: por,
    updatedAt: now,
  }));
}

// ─── Cancelamento ─────────────────────────────────────────────────────

export async function cancelarProcesso(
  processoId: string,
  por: { id: string; nome: string },
  motivo: string,
): Promise<void> {
  const proc = await getProcesso(processoId);
  if (!proc) throw new Error("Processo não encontrado");
  if (proc.status === "concluido") throw new Error("Não dá pra cancelar processo concluído (use readmissão)");
  if (proc.status === "cancelado") return;

  const now = new Date().toISOString();

  // Reativa pessoa se estava bloqueada por causa da demissão
  if (proc.pessoaId && proc.pessoaAtivaAnterior) {
    try {
      await updateDoc(doc(db, "pessoas", proc.pessoaId), sanitizeForFirestore({
        ativa: true,
        inativadaEm: null,
        inativadaPor: null,
        motivoInativacao: null,
      }));
    } catch (e) {
      console.warn("[demissao] falha ao reativar pessoa:", e);
    }
  }

  // Reativa exames desativados durante o processo
  if (proc.examesIdsDesativados && proc.examesIdsDesativados.length > 0) {
    try {
      const { reativarExame } = await import("../exames/repository");
      for (const id of proc.examesIdsDesativados) {
        await reativarExame(id);
      }
    } catch (e) {
      console.warn("[demissao] falha ao reativar exames:", e);
    }
  }

  // Marca processo como cancelado
  await updateDoc(doc(db, COL, processoId), sanitizeForFirestore({
    status: "cancelado",
    kanbanColunaId: "col_cancelado",
    canceladoEm: now,
    canceladoPor: por,
    motivoCancelamento: motivo,
    updatedAt: now,
  }));
}

// ─── Conclusão ────────────────────────────────────────────────────────

export async function concluirProcesso(
  processoId: string,
  por: { id: string; nome: string },
): Promise<void> {
  const proc = await getProcesso(processoId);
  if (!proc) throw new Error("Processo não encontrado");
  if (proc.status === "concluido") return;
  if (proc.status === "cancelado") throw new Error("Não dá pra concluir processo cancelado");

  const now = new Date().toISOString();
  const ultimoDia = proc.ultimoDiaTrabalhado || proc.dataAlvo || now.slice(0, 10);

  // Inativa empregado (estaAtivo + período de demissão)
  try {
    const empSnap = await getDoc(doc(db, "empregados", proc.empregadoId));
    if (empSnap.exists()) {
      const emp = empSnap.data() as { periodos?: Array<{ admissao: string; demissao?: string | null; motivoDemissao?: string; registradoEm: string; registradoPor: string }> };
      const periodos = (emp.periodos || []).map((p, idx, arr) => {
        if (idx === arr.length - 1 && !p.demissao) {
          // demitidoEm = primeiro dia FORA = ultimoDia + 1
          const d = new Date(ultimoDia + "T00:00:00");
          d.setDate(d.getDate() + 1);
          return {
            ...p,
            demissao: d.toISOString().slice(0, 10),
            motivoDemissao: `${proc.iniciativa} — ${proc.motivoIniciacao || "Processo de demissão"}`,
          };
        }
        return p;
      });
      const demitidoEm = periodos[periodos.length - 1]?.demissao;
      await updateDoc(doc(db, "empregados", proc.empregadoId), sanitizeForFirestore({
        periodos,
        estaAtivo: false,
        demitidoEm,
      }));
    }
  } catch (e) {
    console.warn("[demissao] falha ao inativar empregado:", e);
  }

  // Garante pessoa.ativa = false
  if (proc.pessoaId) {
    try {
      await updateDoc(doc(db, "pessoas", proc.pessoaId), sanitizeForFirestore({
        ativa: false,
      }));
    } catch (e) {
      console.warn("[demissao] falha ao inativar pessoa:", e);
    }
  }

  // Desativa exames (idempotente — se já desativados, não duplica)
  try {
    const { desativarExamesPorDemissao } = await import("../exames/gerador");
    await desativarExamesPorDemissao(proc.empregadoId, por, `Demissão concluída (${proc.id})`);
  } catch (e) {
    console.warn("[demissao] falha ao desativar exames:", e);
  }

  // Revoga acessos a ferramentas (remove pessoaId de usuariosAutorizados
  // em todas as tools do restaurante). Senhas compartilhadas/ocultas
  // precisam ser ROTACIONADAS no Bitwarden pelo gestor — geramos uma
  // tarefa de checklist se houver.
  if (proc.pessoaId) {
    try {
      const { collection, query, where, getDocs } = await import("firebase/firestore");
      const { revogarAcessosDaPessoa } = await import("../ferramentasCredenciais/repository");
      const snap = await getDocs(query(
        collection(db, "tools"),
        where("restaurantId", "==", proc.restaurantId),
      ));
      const todasTools = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Parameters<typeof revogarAcessosDaPessoa>[2];
      const r = await revogarAcessosDaPessoa(proc.restaurantId, proc.pessoaId, todasTools);
      if (r.removidaDe.length > 0) {
        console.log(`[demissao] ferramentas revogadas: ${r.removidaDe.join(", ")}`);
      }
      if (r.aRotacionar.length > 0) {
        console.warn(
          `[demissao] AÇÃO MANUAL — rotacionar senhas no Bitwarden de: ${r.aRotacionar.map(t => t.nome).join(", ")}`,
        );
      }
    } catch (e) {
      console.warn("[demissao] falha ao revogar ferramentas:", e);
    }
  }

  // Evento de trilha
  try {
    const { registrarDemissao } = await import("../trilha/autoEventos");
    await registrarDemissao({
      restaurantId: proc.restaurantId,
      empregadoId: proc.empregadoId,
      empregadoNome: proc.empregadoNomeSnapshot,
      ultimoDia,
      motivo: `${proc.iniciativa} — ${proc.motivoIniciacao || ""}`,
      registradoPor: por.id,
    });
  } catch (e) {
    console.warn("[demissao] falha ao registrar trilha:", e);
  }

  await updateDoc(doc(db, COL, processoId), sanitizeForFirestore({
    status: "concluido",
    kanbanColunaId: "col_concluido",
    ultimoDiaTrabalhado: ultimoDia,
    concluidoEm: now,
    concluidoPor: por,
    updatedAt: now,
  }));
}

// ─── Subtarefas: marcar/desmarcar ─────────────────────────────────────

export async function atualizarSubtarefa(
  processoId: string,
  subId: string,
  patch: Partial<SubtarefaDemissaoInstance>,
  por: { id: string; nome: string },
): Promise<void> {
  const proc = await getProcesso(processoId);
  if (!proc) return;
  const subs = (proc.subtarefas || []).map(s =>
    s.id === subId ? { ...s, ...patch } : s
  );
  await updateDoc(doc(db, COL, processoId), sanitizeForFirestore({
    subtarefas: subs,
    updatedAt: new Date().toISOString(),
  }));

  // Triggers especiais
  const subAtualizada = subs.find(s => s.id === subId);
  if (!subAtualizada) return;
  // Marcou como feita
  if (subAtualizada.feita && (!patch.feita || patch.feita === true)) {
    // ehBloqueioAcesso → bloqueia
    if (subAtualizada.ehBloqueioAcesso) {
      await bloquearAcesso(processoId, por);
      await updateDoc(doc(db, COL, processoId), sanitizeForFirestore({
        status: "comunicado",
        kanbanColunaId: "col_comunicacao",
        comunicadoEmpregadoEm: new Date().toISOString(),
        comunicadoEmpregadoPor: por,
      }));
    }
    // ehInativacaoFinal → conclui
    if (subAtualizada.ehInativacaoFinal) {
      await concluirProcesso(processoId, por);
    }
  }
}

// ─── Update genérico ──────────────────────────────────────────────────

export async function atualizarProcesso(id: string, patch: Partial<ProcessoDemissao>): Promise<void> {
  await updateDoc(doc(db, COL, id), sanitizeForFirestore({
    ...patch,
    updatedAt: new Date().toISOString(),
  }));
}

// ─── Mover entre colunas ──────────────────────────────────────────────

export async function moverColunaProcesso(id: string, colunaId: string): Promise<void> {
  await updateDoc(doc(db, COL, id), sanitizeForFirestore({
    kanbanColunaId: colunaId,
    updatedAt: new Date().toISOString(),
  }));
}

void setDoc;
