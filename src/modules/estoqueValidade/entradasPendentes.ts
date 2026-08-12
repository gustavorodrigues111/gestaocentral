// Rascunhos de entrada de estoque gerados a partir dos itens de uma NF recebida.
// O módulo Recebimento chama isto ao salvar a nota; a aba Entrada do Estoques e
// Validades lista os pendentes pra o usuário casar com o produto, informar a
// validade e confirmar (vira um lote ativo). Idempotente: id determinístico por
// recebimento + índice do item.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { ItemNota } from "../../core/types";

export type EntradaPendente = {
  id: string;
  restaurantId: string;
  recebimentoId: string;
  itemIndex: number;
  descricaoNota: string;
  quantidade?: number | null;
  unidade?: string | null;
  valorUnitario?: number | null;
  fornecedor?: string | null;
  produtoId?: string | null;
  status: "pendente" | "confirmada" | "descartada";
  criadoEm: string;
  loteId?: string | null;
};

export async function criarPendentesEntrada(restaurantId: string, recebimentoId: string, fornecedor: string, itens: ItemNota[] | undefined): Promise<void> {
  if (!restaurantId || !recebimentoId || !itens?.length) return;
  const nowIso = new Date().toISOString();
  await Promise.all(itens.map(async (it, i) => {
    const descricaoNota = (it.descricao || "").trim();
    if (!descricaoNota) return;
    const id = `${recebimentoId}_${i}`;
    // Não recria/reseta um pendente que já foi confirmado ou descartado.
    try {
      const snap = await getDoc(doc(db, "entradasPendentes", id));
      if (snap.exists() && (snap.data() as EntradaPendente).status !== "pendente") return;
    } catch { /* segue e tenta gravar */ }
    await setDoc(doc(db, "entradasPendentes", id), {
      id, restaurantId, recebimentoId, itemIndex: i, descricaoNota,
      quantidade: it.quantidade ?? null, unidade: it.unidade || null, valorUnitario: it.valorUnitario ?? null,
      fornecedor: fornecedor || null, produtoId: null, status: "pendente", criadoEm: nowIso,
    }, { merge: true });
  }));
}
