// Repositório do módulo Segurança Sanitária.
// Coleções: `segurancaModelos` (o checklist-modelo) e `segurancaAvaliacoes`
// (as auditorias). Ambas por restaurantId. Preenchimento grava item-a-item ao
// vivo (updateDoc por field-path), igual ao Checklists.
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField,
  onSnapshot, query, where, type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  SegurancaModelo, SegurancaAvaliacao, SegurancaResultadoItem, SegurancaItem, SegurancaFaixa,
} from "../../core/types";
import { segurancaFaixaDe } from "../../core/types";
import { SEED_BLOCOS, SEED_ITENS, SEED_FAIXAS, SEED_AREAS } from "./seed";

const COL_MODELOS = "segurancaModelos";
const COL_AVALIACOES = "segurancaAvaliacoes";

const uid = () => Math.random().toString(36).slice(2, 11);
const nowIso = () => new Date().toISOString();

// ── Modelos ────────────────────────────────────────────────────────────────
export function ouvirModelos(rid: string, cb: (m: SegurancaModelo[]) => void): Unsubscribe {
  const q = query(collection(db, COL_MODELOS), where("restaurantId", "==", rid));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SegurancaModelo)),
    () => cb([]));
}

// Botão provisório: cria o modelo-semente (checklist da Amanda) pra este
// restaurante. Idempotente por conveniência — se já houver modelo ativo, não
// duplica.
// Cria um template a partir da lista-base (semente). Sempre cria um NOVO —
// são templates, dá pra ter vários.
export async function criarModeloSemente(rid: string, por?: string | null, nome = "Avaliação de boas práticas"): Promise<string> {
  const modelo: Omit<SegurancaModelo, "id"> = {
    restaurantId: rid, nome,
    areas: [...SEED_AREAS], blocos: SEED_BLOCOS, itens: SEED_ITENS, faixas: SEED_FAIXAS,
    ativo: true, criadoEm: nowIso(), criadoPor: por ?? null,
  };
  const ref = await addDoc(collection(db, COL_MODELOS), sanitizeForFirestore(modelo));
  return ref.id;
}

// Cria um template EM BRANCO (áreas, blocos e faixas padrão; sem itens).
export async function criarModeloVazio(rid: string, nome: string, por?: string | null): Promise<string> {
  const modelo: Omit<SegurancaModelo, "id"> = {
    restaurantId: rid, nome: nome.trim() || "Novo checklist",
    areas: [...SEED_AREAS], blocos: SEED_BLOCOS, itens: [], faixas: SEED_FAIXAS,
    ativo: true, criadoEm: nowIso(), criadoPor: por ?? null,
  };
  const ref = await addDoc(collection(db, COL_MODELOS), sanitizeForFirestore(modelo));
  return ref.id;
}

// Duplica um template (novo id, nome + " (cópia)").
export async function duplicarModelo(m: SegurancaModelo, por?: string | null): Promise<string> {
  const { id: _id, ...resto } = m;
  void _id;
  const modelo: Omit<SegurancaModelo, "id"> = {
    ...resto, nome: `${m.nome} (cópia)`, ativo: true, criadoEm: nowIso(), criadoPor: por ?? null, atualizadoEm: undefined,
  };
  const ref = await addDoc(collection(db, COL_MODELOS), sanitizeForFirestore(modelo));
  return ref.id;
}

export async function salvarModelo(m: SegurancaModelo): Promise<void> {
  await setDoc(doc(db, COL_MODELOS, m.id), sanitizeForFirestore({ ...m, atualizadoEm: nowIso() }), { merge: true });
}

export async function excluirModelo(id: string): Promise<void> {
  await deleteDoc(doc(db, COL_MODELOS, id));
}

// ── Avaliações ───────────────────────────────────────────────────────────────
export function ouvirAvaliacoes(rid: string, cb: (a: SegurancaAvaliacao[]) => void): Unsubscribe {
  const q = query(collection(db, COL_AVALIACOES), where("restaurantId", "==", rid));
  return onSnapshot(q, (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as SegurancaAvaliacao);
    list.sort((a, b) => (b.iniciadoEm || "").localeCompare(a.iniciadoEm || ""));
    cb(list);
  }, () => cb([]));
}

export function ouvirAvaliacao(id: string, cb: (a: SegurancaAvaliacao | null) => void): Unsubscribe {
  return onSnapshot(doc(db, COL_AVALIACOES, id), (s) => cb(s.exists() ? ({ id: s.id, ...s.data() } as SegurancaAvaliacao) : null),
    () => cb(null));
}

// Inicia uma nova avaliação (rascunho) a partir do modelo ativo. Congela os
// snapshots do questionário pra o relatório não mudar se o modelo for editado.
export async function criarAvaliacao(
  rid: string,
  modelo: SegurancaModelo,
  avaliador: { id: string; nome: string },
): Promise<string> {
  const nova: Omit<SegurancaAvaliacao, "id"> = {
    restaurantId: rid,
    modeloId: modelo.id,
    modeloNomeSnapshot: modelo.nome,
    itensSnapshot: modelo.itens,
    blocosSnapshot: modelo.blocos,
    faixasSnapshot: modelo.faixas,
    areasSnapshot: modelo.areas || [],
    data: nowIso().slice(0, 10),
    avaliadorId: avaliador.id,
    avaliadorNome: avaliador.nome,
    resultado: {},
    status: "rascunho",
    iniciadoEm: nowIso(),
    log: [{ id: uid(), acao: "iniciada", autorId: avaliador.id, autorNome: avaliador.nome, em: nowIso() }],
  };
  const ref = await addDoc(collection(db, COL_AVALIACOES), sanitizeForFirestore(nova));
  return ref.id;
}

// Grava a resposta de UM item ao vivo. key = itemId (cada item é de uma área).
export async function salvarResultado(avaliacaoId: string, key: string, r: SegurancaResultadoItem): Promise<void> {
  await updateDoc(doc(db, COL_AVALIACOES, avaliacaoId), { [`resultado.${key}`]: sanitizeForFirestore(r) });
}
export async function limparResultado(avaliacaoId: string, key: string): Promise<void> {
  await updateDoc(doc(db, COL_AVALIACOES, avaliacaoId), { [`resultado.${key}`]: deleteField() });
}

// Cálculo puro da nota: % de conformes entre os itens PONTUÁVEIS respondidos.
// A chave do `resultado` é o próprio itemId.
export function calcularScore(
  resultado: Record<string, SegurancaResultadoItem>,
  itens: SegurancaItem[],
): { score: number; conformes: number; naoConformes: number; respondidos: number } {
  const pontua = new Set(itens.filter((i) => i.pontua).map((i) => i.id));
  let conf = 0, nc = 0;
  for (const [itemId, r] of Object.entries(resultado || {})) {
    if (!pontua.has(itemId)) continue;
    if (r.resposta === "conforme") conf++;
    else if (r.resposta === "nao_conforme") nc++;
  }
  const denom = conf + nc;
  return { score: denom ? Math.round((conf / denom) * 100) : 0, conformes: conf, naoConformes: nc, respondidos: denom };
}

export async function finalizarAvaliacao(
  a: SegurancaAvaliacao,
  por: { id: string; nome: string },
): Promise<void> {
  const itens = a.itensSnapshot || [];
  const faixas: SegurancaFaixa[] = a.faixasSnapshot || SEED_FAIXAS;
  const { score } = calcularScore(a.resultado || {}, itens);
  const faixa = segurancaFaixaDe(score, faixas);
  await updateDoc(doc(db, COL_AVALIACOES, a.id), sanitizeForFirestore({
    status: "finalizada",
    score,
    faixaLabel: faixa?.label ?? null,
    finalizadoEm: nowIso(),
    log: [...(a.log || []), { id: uid(), acao: "finalizada", detalhe: `${score}% · ${faixa?.label ?? ""}`, autorId: por.id, autorNome: por.nome, em: nowIso() }],
  }));
}

export async function reabrirAvaliacao(a: SegurancaAvaliacao, por: { id: string; nome: string }): Promise<void> {
  await updateDoc(doc(db, COL_AVALIACOES, a.id), sanitizeForFirestore({
    status: "rascunho",
    finalizadoEm: null,
    log: [...(a.log || []), { id: uid(), acao: "reaberta", autorId: por.id, autorNome: por.nome, em: nowIso() }],
  }));
}

export async function excluirAvaliacao(id: string): Promise<void> {
  await deleteDoc(doc(db, COL_AVALIACOES, id));
}
