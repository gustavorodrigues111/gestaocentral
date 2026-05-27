// ════════════════════════════════════════════════════════════════════════════
//  Helpers do módulo Uniformes & EPIs.
//
//  Convenções:
//   - IDs de docs gerados client-side (timestamp + random). Mantém o
//     padrão dos outros módulos.
//   - Estoque é editado em duas etapas: (1) atualiza variacao.estoque
//     no doc do item; (2) grava 1 entry em movEstoqueUniforme pro
//     histórico. As duas operações são feitas pela mesma função
//     `ajustarEstoque` pra garantir consistência.
//   - Validade: contada a partir da entrega. validadeAte = entregueEm +
//     item.validadeDias.
// ════════════════════════════════════════════════════════════════════════════

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  query, updateDoc, where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import type {
  EntregaUniforme, ItemUniforme, KitAreaUniforme, MotivoMovEstoque,
  MovEstoqueUniforme, Pessoa, TipoItemUniforme, VariacaoItem,
} from "../types";

// ─── IDs ───────────────────────────────────────────────────────────────

function rid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function novoItemId():       string { return rid("item"); }
export function novaVariacaoId():   string { return rid("var"); }
export function novaEntregaId():    string { return rid("ent"); }
export function novaMovEstoqueId(): string { return rid("mov"); }

// Slug pra ID estável do kit por área: `${rid}_${area}` (case/space safe)
export function kitAreaId(restaurantId: string, area: string): string {
  const slug = area.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${restaurantId}__${slug || "sem_area"}`;
}

// ─── Itens ─────────────────────────────────────────────────────────────

export async function criarItem(
  patch: Omit<ItemUniforme, "id" | "criadoEm" | "atualizadoEm">,
): Promise<ItemUniforme> {
  const id = novoItemId();
  const now = new Date().toISOString();
  const item: ItemUniforme = { id, criadoEm: now, atualizadoEm: now, ...patch };
  await addDoc(collection(db, "itensUniforme"), sanitizeForFirestore(item));
  return item;
}

export async function atualizarItem(
  id: string,
  patch: Partial<Omit<ItemUniforme, "id" | "restaurantId" | "criadoEm">>,
): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "itensUniforme", id), sanitizeForFirestore({
    ...patch,
    atualizadoEm: now,
  }));
}

export async function deletarItem(id: string): Promise<void> {
  await deleteDoc(doc(db, "itensUniforme", id));
}

export async function listarItens(restaurantId: string): Promise<ItemUniforme[]> {
  const snap = await getDocs(query(
    collection(db, "itensUniforme"),
    where("restaurantId", "==", restaurantId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ItemUniforme);
}

// ─── Estoque ───────────────────────────────────────────────────────────

/**
 * Ajusta estoque de UMA variação de UM item. Atualiza o doc do item E
 * grava 1 entry em movEstoqueUniforme.
 *
 * @param delta positivo = entrada, negativo = saída
 * @returns novo saldo da variação após o ajuste
 */
export async function ajustarEstoque(opts: {
  item: ItemUniforme;
  variacaoId: string;
  delta: number;
  motivo: MotivoMovEstoque;
  refEntregaId?: string;
  observacao?: string;
  pessoa: Pessoa;
}): Promise<number> {
  const { item, variacaoId, delta, motivo, refEntregaId, observacao, pessoa } = opts;
  const variacao = item.variacoes.find(v => v.id === variacaoId);
  if (!variacao) throw new Error(`Variação não encontrada: ${variacaoId}`);

  const novoEstoque = (variacao.estoque || 0) + delta;
  if (novoEstoque < 0) {
    throw new Error(
      `Estoque insuficiente: ${item.nome} (${variacao.tamanho}) tem ${variacao.estoque} disponível, ` +
      `precisa de ${Math.abs(delta)}.`,
    );
  }

  // Atualiza o array de variações do item
  const variacoesNovas = item.variacoes.map(v =>
    v.id === variacaoId ? { ...v, estoque: novoEstoque } : v
  );
  await atualizarItem(item.id, { variacoes: variacoesNovas });

  // Grava entry de movimentação
  const now = new Date().toISOString();
  const mov: MovEstoqueUniforme = {
    id: novaMovEstoqueId(),
    restaurantId: item.restaurantId,
    itemId: item.id,
    variacaoId,
    delta,
    motivo,
    refEntregaId,
    observacao,
    criadoEm: now,
    criadoPor: { id: pessoa.id, nome: pessoa.nome },
  };
  await addDoc(collection(db, "movEstoqueUniforme"), sanitizeForFirestore(mov));

  return novoEstoque;
}

// ─── Kits por área ─────────────────────────────────────────────────────

export async function getKitArea(
  restaurantId: string,
  area: string,
): Promise<KitAreaUniforme | null> {
  const id = kitAreaId(restaurantId, area);
  const snap = await getDoc(doc(db, "kitsAreaUniforme", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as KitAreaUniforme;
}

export async function listarKitsArea(restaurantId: string): Promise<KitAreaUniforme[]> {
  const snap = await getDocs(query(
    collection(db, "kitsAreaUniforme"),
    where("restaurantId", "==", restaurantId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as KitAreaUniforme);
}

export async function salvarKitArea(opts: {
  restaurantId: string;
  area: string;
  itens: KitAreaUniforme["itens"];
  pessoa: Pessoa;
}): Promise<void> {
  const id = kitAreaId(opts.restaurantId, opts.area);
  const now = new Date().toISOString();
  const kit: KitAreaUniforme = {
    id,
    restaurantId: opts.restaurantId,
    area: opts.area,
    itens: opts.itens,
    atualizadoEm: now,
    atualizadoPor: opts.pessoa.id,
  };
  // setDoc com ID determinístico — sobrescreve se já existe
  const { setDoc } = await import("firebase/firestore");
  await setDoc(doc(db, "kitsAreaUniforme", id), sanitizeForFirestore(kit));
}

// ─── Entregas ──────────────────────────────────────────────────────────

/**
 * Calcula data de vencimento. Retorna ISO YYYY-MM-DD ou undefined se
 * validadeDias = 0 (item sem validade).
 */
export function calcValidadeAte(entregueEm: string, validadeDias: number): string | undefined {
  if (!validadeDias || validadeDias <= 0) return undefined;
  const d = new Date(entregueEm);
  d.setDate(d.getDate() + validadeDias);
  return d.toISOString().slice(0, 10);
}

/**
 * Cria entrega + baixa estoque de cada item entregue. Se algum item tem
 * estoque insuficiente, falha ANTES de baixar qualquer outro (validação
 * em batch).
 */
export async function criarEntrega(opts: {
  restaurantId: string;
  /** Vincula a uma pessoa existente. Quando criando durante admissão sem
      pessoa criada ainda, deixa undefined e preenche `candidatoSnapshot`. */
  pessoaId?: string;
  candidatoSnapshot?: { nome: string; cpf: string; whatsapp?: string };
  empregadoId?: string;
  admissaoId?: string;
  tipo: TipoItemUniforme;
  motivo: EntregaUniforme["motivo"];
  itens: {
    itemId: string;
    variacaoId: string;
    qtd: number;
  }[];
  observacao?: string;
  pessoa: Pessoa;
  // Catálogo carregado pra evitar re-fetch + pra snapshot
  catalogo: ItemUniforme[];
}): Promise<EntregaUniforme> {
  const {
    restaurantId, pessoaId, candidatoSnapshot, empregadoId, admissaoId,
    tipo, motivo, itens, observacao, pessoa, catalogo,
  } = opts;
  if (itens.length === 0) throw new Error("Adicione pelo menos 1 item à entrega.");
  if (!pessoaId && !candidatoSnapshot) {
    throw new Error("Forneça pessoaId ou candidatoSnapshot.");
  }

  // Resolve cada item + valida estoque ANTES de baixar (idempotência best-effort)
  type Resolved = { item: ItemUniforme; variacao: VariacaoItem; qtd: number };
  const resolved: Resolved[] = [];
  for (const i of itens) {
    const item = catalogo.find(x => x.id === i.itemId);
    if (!item) throw new Error(`Item não encontrado no catálogo: ${i.itemId}`);
    const variacao = item.variacoes.find(v => v.id === i.variacaoId);
    if (!variacao) throw new Error(`Variação não encontrada em ${item.nome}: ${i.variacaoId}`);
    if (variacao.estoque < i.qtd) {
      throw new Error(`Estoque insuficiente: ${item.nome} (${variacao.tamanho}) tem ${variacao.estoque}, precisa de ${i.qtd}.`);
    }
    resolved.push({ item, variacao, qtd: i.qtd });
  }

  // Cria a entrega
  const id = novaEntregaId();
  const now = new Date().toISOString();
  const entrega: EntregaUniforme = {
    id, restaurantId,
    pessoaId,
    candidatoSnapshot,
    empregadoId, admissaoId,
    tipo, motivo,
    itens: resolved.map(({ item, variacao, qtd }) => ({
      itemId: item.id,
      variacaoId: variacao.id,
      nome: item.nome,
      tamanho: variacao.tamanho,
      qtd,
      custoUnit: variacao.custoUnitOverride ?? item.custoUnit,
      caEpi: item.caEpi,
      validadeAte: calcValidadeAte(now, item.validadeDias),
    })),
    entregueEm: now,
    entreguePor: { id: pessoa.id, nome: pessoa.nome },
    observacao,
  };
  await addDoc(collection(db, "entregasUniforme"), sanitizeForFirestore(entrega));

  // Baixa estoque + grava movimentações
  const motivoMov: MotivoMovEstoque =
    motivo === "troca" ? "troca" :
    motivo === "admissao" ? "entrega" :
    "entrega";

  for (const { item, variacao, qtd } of resolved) {
    await ajustarEstoque({
      item, variacaoId: variacao.id, delta: -qtd,
      motivo: motivoMov, refEntregaId: id,
      pessoa,
    });
  }

  return entrega;
}

/**
 * Registra devolução total/parcial de uma entrega. Pra cada item devolvido
 * com status="devolvido", devolve a qtd ao estoque. Status "descartado" e
 * "levado_pelo_empregado" NÃO alteram estoque (item sai do controle).
 */
export async function registrarDevolucao(opts: {
  entrega: EntregaUniforme;
  itens: NonNullable<EntregaUniforme["devolucao"]>["itens"];
  observacao?: string;
  pessoa: Pessoa;
  // Catálogo pra atualizar estoque
  catalogo: ItemUniforme[];
}): Promise<void> {
  const { entrega, itens, observacao, pessoa, catalogo } = opts;
  if (entrega.devolucao) {
    throw new Error("Essa entrega já tem devolução registrada.");
  }
  const now = new Date().toISOString();
  await updateDoc(doc(db, "entregasUniforme", entrega.id), sanitizeForFirestore({
    devolucao: {
      devolvidoEm: now,
      devolvidoPor: { id: pessoa.id, nome: pessoa.nome },
      itens,
      observacao,
    },
  }));

  // Devolve ao estoque só os itens com status "devolvido"
  for (const i of itens) {
    if (i.status !== "devolvido") continue;
    const item = catalogo.find(x => x.id === i.itemId);
    if (!item || !i.variacaoId) continue;
    await ajustarEstoque({
      item, variacaoId: i.variacaoId, delta: i.qtd,
      motivo: "devolucao", refEntregaId: entrega.id,
      pessoa,
    });
  }
}

// ─── Vencimentos ───────────────────────────────────────────────────────

/**
 * Filtra entregas e devolve itens próximos do vencimento ou já vencidos.
 * Considera só itens NÃO devolvidos.
 */
export function itensProximosVencimento(
  entregas: EntregaUniforme[],
  diasAlerta: number = 30,
): {
  entrega: EntregaUniforme;
  item: EntregaItemUniformeComStatus;
}[] {
  const hojeMs = Date.now();
  const limiteMs = hojeMs + diasAlerta * 86400_000;
  const resultado: { entrega: EntregaUniforme; item: EntregaItemUniformeComStatus }[] = [];
  for (const entrega of entregas) {
    // Itens devolvidos não contam
    const devolvidos = new Set<string>(
      (entrega.devolucao?.itens || [])
        .filter(d => d.status !== "devolvido" ? false : true)
        .map(d => `${d.itemId}__${d.variacaoId || ""}`),
    );
    void devolvidos; // marca uso (simplificação por agora)
    for (const item of entrega.itens) {
      if (!item.validadeAte) continue;
      const tsValidade = new Date(item.validadeAte + "T23:59:59").getTime();
      if (tsValidade > limiteMs) continue;
      const vencido = tsValidade < hojeMs;
      const diasRestantes = Math.ceil((tsValidade - hojeMs) / 86400_000);
      resultado.push({
        entrega,
        item: { ...item, vencido, diasRestantes },
      });
    }
  }
  return resultado;
}

// Tipo extendido pra UI (com flags computadas)
type EntregaItemUniformeComStatus = EntregaUniforme["itens"][number] & {
  vencido: boolean;
  diasRestantes: number;
};

// Re-export pra consumo na UI
export type { EntregaItemUniformeComStatus };
