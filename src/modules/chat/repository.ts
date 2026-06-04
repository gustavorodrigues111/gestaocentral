// ════════════════════════════════════════════════════════════════════════════
//  Chat — Repository (Firestore)
//
//  CRUD das coleções /conversations, /chatMessages, /contatosExternos,
//  /linhasWhatsapp.
//
//  Decisões de schema:
//   - chatMessages é top-level (não subcoleção), indexada por conversationId.
//     Simplifica as rules nesta fase e alinha com o pattern do projeto.
//   - As assinaturas usam `subscribe...` retornando unsubscribe, igual ao
//     resto do app (onSnapshot).
//   - Helpers para conversa direta entre 2 pessoas dedup pelo par de
//     pessoaIds — não cria 2 conversas pra mesmo par.
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, doc, deleteDoc, onSnapshot, query, where,
  setDoc, updateDoc, orderBy, limit, getDocs,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Conversation, ChatMessage, ContatoChat, LinhaWhatsapp,
  ChatCanal, ConversationTipo,
} from "../../core/types";

// ─── Conversations ─────────────────────────────────────────────────────────

/**
 * Stream de conversas. Como `restaurantId` pode ser null (transversal — DP,
 * FIN, Compras), aceitamos `null` pra escutar TODAS — filtragem por
 * participante / operador da linha fica client-side.
 *
 * Em prod, a UI passa o `restaurantId` ativo + null pra trazer transversais.
 */
export function subscribeConversations(
  restaurantId: string | null,
  onUpdate: (conversations: Conversation[]) => void,
): () => void {
  // Como o filtro por restaurantId precisa contemplar `null` (transversais)
  // E `rid` específico, fazemos 2 streams e mergeamos. Simples e correto.
  let mergeBuffer: { rid: Conversation[]; transversal: Conversation[] } = {
    rid: [], transversal: [],
  };

  function emit() {
    const all = [...mergeBuffer.rid, ...mergeBuffer.transversal];
    // Mais recente primeiro
    all.sort((a, b) => (b.atualizadoEm || "").localeCompare(a.atualizadoEm || ""));
    onUpdate(all);
  }

  const unsubRid = restaurantId
    ? onSnapshot(
        query(collection(db, "conversations"), where("restaurantId", "==", restaurantId)),
        (snap) => {
          mergeBuffer.rid = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, "id">) }));
          emit();
        },
      )
    : () => {};

  const unsubTransversal = onSnapshot(
    query(collection(db, "conversations"), where("restaurantId", "==", null)),
    (snap) => {
      mergeBuffer.transversal = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, "id">) }));
      emit();
    },
  );

  return () => {
    unsubRid();
    unsubTransversal();
  };
}

/** Cria uma nova conversa. ID gerado deterministicamente quando possível
 *  (caso direta entre 2 pessoas: ordenar pessoaIds + restaurantId, evita
 *  duplicação se 2 clientes clicam "iniciar conversa" simultâneo). */
export async function createConversation(
  data: Omit<Conversation, "id" | "criadoEm" | "atualizadoEm">,
  pessoaIdCriador: string,
): Promise<string> {
  const now = new Date().toISOString();

  // ID determinístico pra diretas internas (evita race em "iniciar conversa").
  let id: string;
  if (data.tipo === "direta" && data.participantes.length === 2) {
    const sorted = [...data.participantes].sort();
    id = `conv_d_${data.restaurantId || "g"}_${sorted[0]}_${sorted[1]}`;
  } else {
    id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const conv: Conversation = {
    arquivado: false,
    ...data,
    // Campos que sobrescrevem o spread — sempre vêm do servidor / param.
    id,
    criadoEm: now,
    atualizadoEm: now,
    criadoPor: data.criadoPor || pessoaIdCriador,
  };
  await setDoc(doc(db, "conversations", id), sanitizeForFirestore(conv));
  return id;
}

export async function updateConversation(
  conversationId: string,
  patch: Partial<Conversation>,
): Promise<void> {
  await updateDoc(doc(db, "conversations", conversationId), sanitizeForFirestore({
    ...patch,
    atualizadoEm: new Date().toISOString(),
  }));
}

export async function archiveConversation(conversationId: string): Promise<void> {
  await updateConversation(conversationId, { arquivado: true });
}

/** Master only — rule trava delete pra outros. */
export async function deleteConversation(conversationId: string): Promise<void> {
  await deleteDoc(doc(db, "conversations", conversationId));
}

/** Helper: marca conversa como lida pela pessoa. Zera contador. */
export async function marcarConversaLida(
  conversationId: string,
  pessoaId: string,
): Promise<void> {
  await updateConversation(conversationId, {
    naoLidoPor: { [pessoaId]: 0 },
  });
}

// ─── Chat Messages ────────────────────────────────────────────────────────

/** Stream das últimas N mensagens de uma conversa. Ordem cronológica
 *  ascendente (mais antiga primeiro) — UI faz scroll-to-bottom no mount. */
export function subscribeMessages(
  conversationId: string,
  onUpdate: (messages: ChatMessage[]) => void,
  maxMessages: number = 100,
): () => void {
  const q = query(
    collection(db, "chatMessages"),
    where("conversationId", "==", conversationId),
    orderBy("enviadoEm", "desc"),
    limit(maxMessages),
  );
  return onSnapshot(q, (snap) => {
    const arr: ChatMessage[] = snap.docs.map((d) => ({
      id: d.id, ...(d.data() as Omit<ChatMessage, "id">),
    }));
    // Inverter pra ordem ascendente (mais antiga em cima).
    arr.reverse();
    onUpdate(arr);
  });
}

export async function sendMessage(
  conversationId: string,
  data: Omit<ChatMessage, "id" | "enviadoEm" | "conversationId">,
  pessoaIdSender: string,
): Promise<string> {
  const now = new Date().toISOString();
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const msg: ChatMessage = {
    id,
    conversationId,
    enviadoEm: now,
    ...data,
  };
  await setDoc(doc(db, "chatMessages", id), sanitizeForFirestore(msg));

  // Atualiza snapshot da última mensagem na conversa.
  await updateConversation(conversationId, {
    ultimaMensagem: {
      texto: msg.texto.slice(0, 120),
      autorId: msg.autorId,
      autorNome: msg.autorNome,
      em: now,
      canal: msg.canal,
    },
    atualizadoEm: now,
  });
  void pessoaIdSender; // reservado pra incrementar naoLidoPor dos outros em C2
  return id;
}

export async function editMessage(
  messageId: string,
  novoTexto: string,
  pessoaId: string,
): Promise<void> {
  await updateDoc(doc(db, "chatMessages", messageId), sanitizeForFirestore({
    texto: novoTexto,
    editadoEm: new Date().toISOString(),
  }));
  void pessoaId; // reservado pra auditoria futura
}

/** Soft delete — preserva pra histórico de master. */
export async function softDeleteMessage(
  messageId: string,
  pessoaId: string,
): Promise<void> {
  await updateDoc(doc(db, "chatMessages", messageId), sanitizeForFirestore({
    removidoEm: new Date().toISOString(),
    removidoPor: pessoaId,
    texto: "[mensagem removida]",
  }));
}

/** Hard delete — master only. */
export async function hardDeleteMessage(messageId: string): Promise<void> {
  await deleteDoc(doc(db, "chatMessages", messageId));
}

// ─── Contatos Externos ────────────────────────────────────────────────────

export function subscribeContatosExternos(
  restaurantId: string | null,
  onUpdate: (contatos: ContatoChat[]) => void,
): () => void {
  // Mesma lógica do subscribeConversations: stream rid específico + globais.
  let mergeBuffer = { rid: [] as ContatoChat[], transversal: [] as ContatoChat[] };

  function emit() {
    const all = [...mergeBuffer.rid, ...mergeBuffer.transversal];
    all.sort((a, b) => a.nome.localeCompare(b.nome));
    onUpdate(all);
  }

  const unsubRid = restaurantId
    ? onSnapshot(
        query(collection(db, "contatosExternos"), where("restaurantId", "==", restaurantId)),
        (snap) => {
          mergeBuffer.rid = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContatoChat, "id">) }));
          emit();
        },
      )
    : () => {};

  const unsubTransversal = onSnapshot(
    query(collection(db, "contatosExternos"), where("restaurantId", "==", null)),
    (snap) => {
      mergeBuffer.transversal = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContatoChat, "id">) }));
      emit();
    },
  );

  return () => {
    unsubRid();
    unsubTransversal();
  };
}

export async function createContatoChat(
  data: Omit<ContatoChat, "id" | "criadoEm" | "criadoPor">,
  pessoaId: string,
): Promise<string> {
  const now = new Date().toISOString();
  const id = `cext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const contato: ContatoChat = { id, criadoEm: now, criadoPor: pessoaId, ...data };
  await setDoc(doc(db, "contatosExternos", id), sanitizeForFirestore(contato));
  return id;
}

export async function updateContatoChat(
  contatoId: string,
  patch: Partial<ContatoChat>,
  pessoaId: string,
): Promise<void> {
  await updateDoc(doc(db, "contatosExternos", contatoId), sanitizeForFirestore({
    ...patch,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: pessoaId,
  }));
}

/** Busca contato por número WhatsApp (usado pelo webhook do gateway pra
 *  vincular mensagem recebida ao contato cadastrado). */
export async function findContatoChatByNumero(
  numero: string,
): Promise<ContatoChat | null> {
  const q = query(collection(db, "contatosExternos"), where("numeroWhatsapp", "==", numero));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<ContatoChat, "id">) };
}

// ─── Linhas WhatsApp ──────────────────────────────────────────────────────

export function subscribeLinhasWhatsapp(
  onUpdate: (linhas: LinhaWhatsapp[]) => void,
): () => void {
  return onSnapshot(collection(db, "linhasWhatsapp"), (snap) => {
    const arr: LinhaWhatsapp[] = snap.docs.map((d) => ({
      id: d.id, ...(d.data() as Omit<LinhaWhatsapp, "id">),
    }));
    arr.sort((a, b) => a.label.localeCompare(b.label));
    onUpdate(arr);
  });
}

export async function upsertLinhaWhatsapp(
  linha: LinhaWhatsapp,
  pessoaId: string,
): Promise<void> {
  await setDoc(doc(db, "linhasWhatsapp", linha.id), sanitizeForFirestore({
    ...linha,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: pessoaId,
  }));
}

/** Master only (rule). */
export async function deleteLinhaWhatsapp(linhaId: string): Promise<void> {
  await deleteDoc(doc(db, "linhasWhatsapp", linhaId));
}

// ─── Helpers de criação rápida ────────────────────────────────────────────

/**
 * Cria (ou retorna existente) conversa direta entre 2 pessoas internas.
 * Idempotente por par de pessoaIds + restaurantId (ID determinístico).
 */
export async function ensureConversaDireta(
  pessoaIdA: string,
  pessoaIdB: string,
  pessoaNomeA: string,
  pessoaNomeB: string,
  restaurantId: string | null,
): Promise<string> {
  if (pessoaIdA === pessoaIdB) {
    throw new Error("Não pode criar conversa direta consigo mesmo.");
  }
  return createConversation({
    restaurantId,
    linhaId: null,
    tipo: "direta" as ConversationTipo,
    participantes: [pessoaIdA, pessoaIdB],
    participantesNomes: {
      [pessoaIdA]: pessoaNomeA,
      [pessoaIdB]: pessoaNomeB,
    },
    canaisAtivos: ["in_app"] as ChatCanal[],
    criadoPor: pessoaIdA,
    arquivado: false,
  } as Omit<Conversation, "id" | "criadoEm" | "atualizadoEm">, pessoaIdA);
}
