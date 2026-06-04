// ════════════════════════════════════════════════════════════════════════════
//  Repository — CRUD da coleção `tools` no Firestore.
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, doc, deleteDoc, onSnapshot, query, where, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Tool } from "../../core/types";

export function subscribeToolsByRestaurant(
  restaurantId: string,
  onUpdate: (tools: Tool[]) => void,
): () => void {
  const q = query(collection(db, "tools"), where("restaurantId", "==", restaurantId));
  return onSnapshot(q, (snap) => {
    const arr: Tool[] = [];
    snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as Omit<Tool, "id">) }));
    arr.sort((a, b) => a.nome.localeCompare(b.nome));
    onUpdate(arr);
  });
}

export async function createTool(
  rid: string,
  data: Omit<Tool, "id" | "criadoEm" | "criadoPor" | "restaurantId">,
  pessoaId: string,
): Promise<string> {
  const now = new Date().toISOString();
  const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tool: Tool = {
    id,
    restaurantId: rid,
    criadoEm: now,
    criadoPor: pessoaId,
    ...data,
  };
  await setDoc(doc(db, "tools", id), sanitizeForFirestore(tool));
  return id;
}

export async function updateTool(
  toolId: string,
  patch: Partial<Tool>,
  pessoaId: string,
): Promise<void> {
  await updateDoc(doc(db, "tools", toolId), sanitizeForFirestore({
    ...patch,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: pessoaId,
  }));
}

export async function deleteTool(toolId: string): Promise<void> {
  await deleteDoc(doc(db, "tools", toolId));
}

// Remove o pessoaId de TODAS as tools onde ela está autorizada (usado no
// fluxo de demissão pra revogar acessos automaticamente).
export async function revogarAcessosDaPessoa(
  rid: string,
  pessoaId: string,
  todasTools: Tool[],
): Promise<{ removidaDe: string[]; aRotacionar: { id: string; nome: string; metodoAcesso: string }[] }> {
  const removidaDe: string[] = [];
  const aRotacionar: { id: string; nome: string; metodoAcesso: string }[] = [];
  const promessas: Promise<void>[] = [];
  for (const t of todasTools) {
    if (t.restaurantId !== rid) continue;
    if (!t.usuariosAutorizados.includes(pessoaId)) continue;
    const novos = t.usuariosAutorizados.filter(u => u !== pessoaId);
    promessas.push(updateDoc(doc(db, "tools", t.id), sanitizeForFirestore({
      usuariosAutorizados: novos,
      atualizadoEm: new Date().toISOString(),
    })));
    removidaDe.push(t.nome);
    // Senhas compartilhadas/ocultas precisam ser ROTACIONADAS no Bitwarden
    // pelo gestor (não dá pra fazer pela API por design — senha sai do app).
    if (t.metodoAcesso === "senha_compartilhada" || t.metodoAcesso === "senha_oculta") {
      aRotacionar.push({ id: t.id, nome: t.nome, metodoAcesso: t.metodoAcesso });
    }
  }
  await Promise.all(promessas);
  return { removidaDe, aRotacionar };
}
