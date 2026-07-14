// Repository do Gestor de Tarefas — CRUD básico + helpers de log e soft delete.
// Padrão: Firestore SDK direto, sanitizeForFirestore antes de qualquer write.

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot,
  setDoc, updateDoc, addDoc, deleteDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Tarefa, TarefaProjeto, TarefaSubprojeto, TarefaStatus, TarefaLogEntry,
  Subtarefa, TarefaComentario, TarefaVisibilidade,
  TarefaAutomacao, ModuloOrigemTarefa,
} from "../../core/types";

const COL_PROJETOS = "tarefaProjetos";
const COL_SUBPROJETOS = "tarefaSubprojetos";
const COL_TAREFAS = "tarefas";
const COL_AUTOMACOES = "tarefaAutomacoes";

// ─── PROJETOS ─────────────────────────────────────────────────────────────

export async function listarProjetos(): Promise<TarefaProjeto[]> {
  const snap = await getDocs(query(collection(db, COL_PROJETOS), orderBy("ordem")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaProjeto)
    .filter(p => !p.deletadoEm);
}

export function ouvirProjetos(cb: (projetos: TarefaProjeto[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, COL_PROJETOS), orderBy("ordem")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaProjeto)
      .filter(p => !p.deletadoEm);
    cb(list);
  });
}

export async function salvarProjeto(p: TarefaProjeto): Promise<void> {
  await setDoc(doc(db, COL_PROJETOS, p.id), sanitizeForFirestore(p));
}

// ─── SUBPROJETOS ──────────────────────────────────────────────────────────

export async function listarSubprojetos(projetoId?: string): Promise<TarefaSubprojeto[]> {
  const q = projetoId
    ? query(collection(db, COL_SUBPROJETOS), where("projetoId", "==", projetoId), orderBy("ordem"))
    : query(collection(db, COL_SUBPROJETOS), orderBy("ordem"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaSubprojeto)
    .filter(s => !s.deletadoEm);
}

export function ouvirSubprojetos(cb: (subs: TarefaSubprojeto[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, COL_SUBPROJETOS), orderBy("ordem")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaSubprojeto)
      .filter(s => !s.deletadoEm);
    cb(list);
  });
}

export async function salvarSubprojeto(s: TarefaSubprojeto): Promise<void> {
  await setDoc(doc(db, COL_SUBPROJETOS, s.id), sanitizeForFirestore(s));
}

// Conta quantas tarefas existentes apontam pra esse subprojeto — usado pra
// avisar o admin antes de mover o subprojeto pra outro projeto.
export async function contarTarefasDoSubprojeto(subId: string): Promise<number> {
  const s = await getDocs(query(collection(db, COL_TAREFAS), where("subprojetoId", "==", subId)));
  return s.size;
}

// Move um subprojeto pra outro projeto e cascateia: atualiza projetoId +
// corHerdada de TODAS as tarefas que pertenciam ao subprojeto. Mantém o
// subprojetoId (mesma referência) — só re-aponta o projeto pai.
export async function moverSubprojetoParaProjeto(
  sub: TarefaSubprojeto,
  novoProjetoId: string,
  novoProjetoCor: string | undefined,
  pessoaId: string,
): Promise<{ tarefasAfetadas: number }> {
  // 1) Atualiza o subprojeto
  await setDoc(doc(db, COL_SUBPROJETOS, sub.id), sanitizeForFirestore({
    ...sub,
    projetoId: novoProjetoId,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: pessoaId,
  }));
  // 2) Re-aponta projetoId/corHerdada nas tarefas com esse subprojetoId
  const snap = await getDocs(query(collection(db, COL_TAREFAS), where("subprojetoId", "==", sub.id)));
  let count = 0;
  await Promise.all(snap.docs.map(d => {
    count += 1;
    return setDoc(doc(db, COL_TAREFAS, d.id), sanitizeForFirestore({
      ...d.data(),
      projetoId: novoProjetoId,
      corHerdada: novoProjetoCor,
    }));
  }));
  return { tarefasAfetadas: count };
}

// ─── TAREFAS ──────────────────────────────────────────────────────────────

export function ouvirTarefasDeUsuario(pessoaId: string, cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  // "Minhas Tarefas" = responsável, co-responsável, observador, ou
  // responsável de alguma subtarefa (denormalizado em
  // subtarefaResponsaveisIds). Firestore não tem OR composto em queries
  // simples; fazemos 4 listeners.
  const unsubResp = onSnapshot(
    query(collection(db, COL_TAREFAS), where("responsavelId", "==", pessoaId)),
    () => recarregar(),
  );
  const unsubCo = onSnapshot(
    query(collection(db, COL_TAREFAS), where("coResponsaveis", "array-contains", pessoaId)),
    () => recarregar(),
  );
  const unsubObs = onSnapshot(
    query(collection(db, COL_TAREFAS), where("observadoresIds", "array-contains", pessoaId)),
    () => recarregar(),
  );
  const unsubSub = onSnapshot(
    query(collection(db, COL_TAREFAS), where("subtarefaResponsaveisIds", "array-contains", pessoaId)),
    () => recarregar(),
  );

  async function recarregar() {
    const [respSnap, coSnap, obsSnap, subSnap] = await Promise.all([
      getDocs(query(collection(db, COL_TAREFAS), where("responsavelId", "==", pessoaId))),
      getDocs(query(collection(db, COL_TAREFAS), where("coResponsaveis", "array-contains", pessoaId))),
      getDocs(query(collection(db, COL_TAREFAS), where("observadoresIds", "array-contains", pessoaId))),
      getDocs(query(collection(db, COL_TAREFAS), where("subtarefaResponsaveisIds", "array-contains", pessoaId))),
    ]);
    const respData = respSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    const coData = coSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    const obsData = obsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    const subData = subSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    // Mescla deduplicando por id
    const map = new Map<string, Tarefa>();
    [...respData, ...coData, ...obsData, ...subData].forEach(t => { if (!t.deletadoEm) map.set(t.id, t); });
    cb(Array.from(map.values()));
  }
  recarregar();

  return () => { unsubResp(); unsubCo(); unsubObs(); unsubSub(); };
}

export function ouvirTarefasDeProjeto(projetoId: string, cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL_TAREFAS), where("projetoId", "==", projetoId)),
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa)
        .filter(t => !t.deletadoEm);
      cb(list);
    },
  );
}

export function ouvirLixeira(cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  return onSnapshot(collection(db, COL_TAREFAS), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa)
      .filter(t => !!t.deletadoEm);
    cb(list);
  });
}

// TODAS as tarefas ativas (não deletadas) — visão master "Todas".
export function ouvirTodasTarefas(cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  return onSnapshot(collection(db, COL_TAREFAS), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa).filter(t => !t.deletadoEm));
  });
}

export async function getTarefa(id: string): Promise<Tarefa | null> {
  const s = await getDoc(doc(db, COL_TAREFAS, id));
  return s.exists() ? ({ id: s.id, ...s.data() } as Tarefa) : null;
}

export async function criarTarefa(t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm">): Promise<string> {
  const now = new Date().toISOString();
  // Denormaliza visibilidadeEfetiva pra rules: se há override, usa ele;
  // senão, busca a do projeto.
  const visEfetiva = t.visibilidadeOverride || await resolverVisibilidadeProjeto(t.projetoId);
  const ref = await addDoc(collection(db, COL_TAREFAS), sanitizeForFirestore({
    ...t,
    visibilidadeEfetiva: visEfetiva,
    criadoEm: now,
    atualizadoEm: now,
    log: [
      {
        id: cryptoId(),
        acao: "criada" as const,
        autorId: t.criadoPor,
        autorNome: t.criadoPorNome || "—",
        em: now,
      },
    ],
  }));
  return ref.id;
}

async function resolverVisibilidadeProjeto(projetoId: string): Promise<TarefaVisibilidade> {
  try {
    const s = await getDoc(doc(db, COL_PROJETOS, projetoId));
    if (s.exists()) return ((s.data() as { visibilidade?: TarefaVisibilidade }).visibilidade || "escritorio");
  } catch {}
  return "escritorio";
}

export async function atualizarTarefa(id: string, patch: Partial<Tarefa>, autor: { id: string; nome: string }, logEntry?: Partial<TarefaLogEntry>): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, COL_TAREFAS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  // Se mudou projetoId ou visibilidadeOverride, recalcula visibilidadeEfetiva
  if ("projetoId" in patch || "visibilidadeOverride" in patch) {
    const projetoIdFinal = patch.projetoId || atual.projetoId;
    const overrideFinal = patch.visibilidadeOverride ?? atual.visibilidadeOverride;
    patch.visibilidadeEfetiva = overrideFinal || await resolverVisibilidadeProjeto(projetoIdFinal);
  }
  const newLog: TarefaLogEntry[] = [
    ...(atual.log || []),
    ...(logEntry
      ? [{
          id: cryptoId(),
          acao: (logEntry.acao || "editada") as TarefaLogEntry["acao"],
          detalhe: logEntry.detalhe,
          campo: logEntry.campo,
          valorAntes: logEntry.valorAntes,
          valorDepois: logEntry.valorDepois,
          autorId: autor.id,
          autorNome: autor.nome,
          em: now,
        }]
      : []),
  ];
  await updateDoc(ref, sanitizeForFirestore({
    ...patch,
    atualizadoEm: now,
    log: newLog,
  } as Partial<Tarefa>));
}

export class CamposObrigatoriosFaltantesError extends Error {
  faltantes: string[];
  constructor(faltantes: string[]) {
    super(`Campos obrigatórios não preenchidos: ${faltantes.join(", ")}`);
    this.faltantes = faltantes;
    this.name = "CamposObrigatoriosFaltantesError";
  }
}

export async function mudarStatus(id: string, status: TarefaStatus, autor: { id: string; nome: string }): Promise<void> {
  const ref = doc(db, COL_TAREFAS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = { id: snap.id, ...snap.data() } as Tarefa;
  if (atual.status === status) return;

  // Validação: ao concluir, exigir custom fields marcados como obrigatórios.
  if (status === "concluida") {
    const subSnap = await getDoc(doc(db, COL_SUBPROJETOS, atual.subprojetoId));
    if (subSnap.exists()) {
      const sub = subSnap.data() as TarefaSubprojeto;
      const defs = sub.customFieldsDef || [];
      const valores = atual.customFields || {};
      const faltantes = defs
        .filter(d => d.obrigatorio)
        .filter(d => {
          const v = valores[d.id];
          if (d.tipo === "checkbox") return v !== true; // exige check
          return v === undefined || v === null || v === "";
        })
        .map(d => d.nome);
      if (faltantes.length > 0) {
        throw new CamposObrigatoriosFaltantesError(faltantes);
      }
    }
  }

  await atualizarTarefa(id, { status }, autor, {
    acao: "status_mudou",
    campo: "status",
    valorAntes: atual.status,
    valorDepois: status,
  });

  // Auto-clone: se concluiu uma rotina recorrente, agenda próxima ocorrência.
  // Import dinâmico pra evitar ciclo de imports (generator depende de repository).
  if (status === "concluida") {
    try {
      const { tentarAgendarProximaRecorrencia } = await import("./generator");
      await tentarAgendarProximaRecorrencia(atual, autor);
    } catch (e) {
      console.warn("[repository] auto-clone falhou:", e);
    }
  }
}


export async function marcarSubtarefa(tarefaId: string, subId: string, feito: boolean, autor: { id: string; nome: string }): Promise<void> {
  const ref = doc(db, COL_TAREFAS, tarefaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  const subs = (atual.subtarefas || []).map<Subtarefa>(s =>
    s.id === subId
      ? { ...s, feito, feitoEm: feito ? new Date().toISOString() : null, feitoPor: feito ? autor.id : null, feitoPorNome: feito ? autor.nome : null }
      : s
  );
  await atualizarTarefa(tarefaId, { subtarefas: subs }, autor, {
    acao: feito ? "subtarefa_marcada" : "subtarefa_desmarcada",
    detalhe: subs.find(s => s.id === subId)?.texto,
  });
}

export async function adicionarComentario(
  tarefaId: string,
  texto: string,
  autor: { id: string; nome: string },
  mencionados?: string[],
): Promise<void> {
  const ref = doc(db, COL_TAREFAS, tarefaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  const novo: TarefaComentario = {
    id: cryptoId(),
    texto,
    autorId: autor.id,
    autorNome: autor.nome,
    mencionados: mencionados && mencionados.length > 0 ? mencionados : undefined,
    criadoEm: new Date().toISOString(),
  };
  await atualizarTarefa(tarefaId, {
    comentarios: [...(atual.comentarios || []), novo],
  }, autor, { acao: "comentario_adicionado", detalhe: texto.slice(0, 80) });
}

// Soft delete — vai pra lixeira.
export async function softDeleteTarefa(id: string, autor: { id: string; nome: string }, motivo?: string): Promise<void> {
  await atualizarTarefa(id, {
    deletadoEm: new Date().toISOString(),
    deletadoPor: autor.id,
    motivoDelete: motivo,
  }, autor, { acao: "deletada", detalhe: motivo });
}

export async function restaurarTarefa(id: string, autor: { id: string; nome: string }): Promise<void> {
  await atualizarTarefa(id, {
    deletadoEm: null,
    deletadoPor: null,
    motivoDelete: undefined,
  }, autor, { acao: "restaurada" });
}

// Hard delete — só master.
export async function hardDeleteTarefa(id: string): Promise<void> {
  await deleteDoc(doc(db, COL_TAREFAS, id));
}

// Migração: converte docs legados com visibilidade `grupo_*` em `privado`.
// Idempotente — pode rodar várias vezes sem efeito colateral.
export async function migrarGruposParaPrivadoLegado(): Promise<{ projetos: number; tarefas: number }> {
  let projetosFix = 0;
  let tarefasFix = 0;

  const projSnap = await getDocs(collection(db, COL_PROJETOS));
  for (const d of projSnap.docs) {
    const data = d.data() as TarefaProjeto;
    const v = data.visibilidade as string | undefined;
    if (typeof v === "string" && v.startsWith("grupo_")) {
      await updateDoc(doc(db, COL_PROJETOS, d.id), sanitizeForFirestore({ visibilidade: "privado" }));
      projetosFix++;
    }
  }

  const tSnap = await getDocs(collection(db, COL_TAREFAS));
  for (const d of tSnap.docs) {
    const data = d.data() as Tarefa;
    const patch: Record<string, string> = {};
    const ov = data.visibilidadeOverride as string | undefined;
    const ef = data.visibilidadeEfetiva as string | undefined;
    if (typeof ov === "string" && ov.startsWith("grupo_")) patch.visibilidadeOverride = "privado";
    if (typeof ef === "string" && ef.startsWith("grupo_")) patch.visibilidadeEfetiva = "privado";
    if (Object.keys(patch).length) {
      await updateDoc(doc(db, COL_TAREFAS, d.id), sanitizeForFirestore(patch));
      tarefasFix++;
    }
  }

  return { projetos: projetosFix, tarefas: tarefasFix };
}

// Migração: soft-deleta o projeto "Caixa Pessoal" (proj-pessoal) — removido
// em favor da integração Banco de Ideias → Tarefas.
// Idempotente. Retorna info pro master saber se tinha conteúdo.
export async function aposentarCaixaPessoal(): Promise<{
  removido: boolean;
  tarefasMexidas: number;
}> {
  const refProj = doc(db, COL_PROJETOS, "proj-pessoal");
  const snap = await getDoc(refProj);
  if (!snap.exists()) return { removido: false, tarefasMexidas: 0 };
  const data = snap.data() as TarefaProjeto;
  if (data.deletadoEm) return { removido: false, tarefasMexidas: 0 };

  // Conta tarefas vivas que apontavam pra esse projeto
  const tSnap = await getDocs(query(collection(db, COL_TAREFAS), where("projetoId", "==", "proj-pessoal")));
  const vivas = tSnap.docs.filter(d => {
    const t = d.data() as Tarefa;
    return !t.deletadoEm;
  });

  const now = new Date().toISOString();
  await updateDoc(refProj, sanitizeForFirestore({
    deletadoEm: now,
    deletadoPor: "system",
    atualizadoEm: now,
  }));

  return { removido: true, tarefasMexidas: vivas.length };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function cryptoId(): string {
  // ID curto pra subtarefa/comentário/log — não precisa de garantias globais.
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

export { cryptoId };

// ─── AUTOMAÇÕES (config de tarefas auto por módulo) ──────────────────────

// Listen das configs de automação do restaurante atual. Uma config por
// (restaurantId, módulo). Sem doc = sem config (cai pra fallback do hook).
export function ouvirAutomacoes(rid: string, cb: (lista: TarefaAutomacao[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL_AUTOMACOES), where("restaurantId", "==", rid)),
    snap => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaAutomacao));
    },
  );
}

// Lê 1 config sob demanda (pra usar nos hooks de criação automática).
export async function lerAutomacao(rid: string, moduloId: ModuloOrigemTarefa): Promise<TarefaAutomacao | null> {
  const ref = doc(db, COL_AUTOMACOES, `${rid}_${moduloId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as TarefaAutomacao;
}

export async function salvarAutomacao(a: TarefaAutomacao): Promise<void> {
  await setDoc(doc(db, COL_AUTOMACOES, a.id), sanitizeForFirestore(a));
}

// Decora o payload de uma tarefa que vai ser criada por hook automático
// com a TarefaAutomacao configurada pra esse módulo (se houver).
// Estratégia: config explícita VENCE o fallback do hook — admin definiu.
// Quando o campo da config está vazio (ex: sem co-resp), mantém o que
// o hook passou.
export async function aplicarAutomacaoNoPayload<T extends {
  responsavelId?: string;
  responsavelNome?: string;
  coResponsaveis?: string[];
  coResponsaveisNomes?: string[];
  observadoresIds?: string[];
  observadoresNomes?: string[];
}>(payload: T, rid: string, moduloId: ModuloOrigemTarefa): Promise<T> {
  if (!rid) return payload;
  let cfg: TarefaAutomacao | null;
  try {
    cfg = await lerAutomacao(rid, moduloId);
  } catch {
    return payload; // falha de leitura não bloqueia geração
  }
  if (!cfg) return payload;
  const usaResp = !!cfg.responsavelId;
  const usaCo = (cfg.coResponsaveisIds?.length || 0) > 0;
  const usaObs = (cfg.observadoresIds?.length || 0) > 0;
  return {
    ...payload,
    responsavelId: usaResp ? cfg.responsavelId : payload.responsavelId,
    responsavelNome: usaResp ? (cfg.responsavelNome || "") : payload.responsavelNome,
    coResponsaveis: usaCo ? cfg.coResponsaveisIds : payload.coResponsaveis,
    coResponsaveisNomes: usaCo ? cfg.coResponsaveisNomes : payload.coResponsaveisNomes,
    observadoresIds: usaObs ? cfg.observadoresIds : payload.observadoresIds,
    observadoresNomes: usaObs ? cfg.observadoresNomes : payload.observadoresNomes,
  };
}

// Propaga a config nas tarefas EM ABERTO (a_fazer / em_andamento) do mesmo
// módulo + restaurante. Não toca em concluídas/canceladas pra não revisitar
// história. Retorna quantas foram afetadas pra confirmar no modal.
//
// Estratégia: itera tarefas, monta patch só com os campos da automação
// (responsavel / co / observadores). Mantém log de mudança no autor passado.
export async function propagarAutomacaoEmAbertas(
  a: TarefaAutomacao,
  autor: { id: string; nome: string },
): Promise<{ afetadas: number }> {
  const snap = await getDocs(query(
    collection(db, COL_TAREFAS),
    where("restaurantId", "==", a.restaurantId),
    where("origem", "==", a.moduloId),
  ));
  let afetadas = 0;
  await Promise.all(snap.docs.map(async d => {
    const t = d.data() as Tarefa;
    if (t.status === "concluida" || t.status === "cancelada" || t.deletadoEm) return;
    const patch: Partial<Tarefa> = {};
    if (a.responsavelId && t.responsavelId !== a.responsavelId) {
      patch.responsavelId = a.responsavelId;
      patch.responsavelNome = a.responsavelNome || "";
    }
    if (a.coResponsaveisIds && a.coResponsaveisIds.length > 0) {
      patch.coResponsaveis = a.coResponsaveisIds;
      patch.coResponsaveisNomes = a.coResponsaveisNomes || [];
    }
    if (a.observadoresIds && a.observadoresIds.length > 0) {
      patch.observadoresIds = a.observadoresIds;
      patch.observadoresNomes = a.observadoresNomes || [];
    }
    if (Object.keys(patch).length === 0) return;
    afetadas += 1;
    await atualizarTarefa(d.id, patch, autor, {
      acao: "editada",
      campo: "automação",
      detalhe: `propagado de "Config Automações ${a.moduloId}"`,
    });
  }));
  return { afetadas };
}
