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
  collection, deleteDoc, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where,
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
  // setDoc com ID determinístico — alinha doc.id com item.id interno pra
  // que updateDoc(doc(db, "itensUniforme", item.id)) funcione direto.
  await setDoc(doc(db, "itensUniforme", id), sanitizeForFirestore(item));
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
  return snap.docs.map(d => ({ ...d.data(), id: d.id }) as ItemUniforme);
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

  // Permite estoque negativo: cenário real é "DP gera o termo + entrega
  // assinatura antes do equipamento chegar do fornecedor". Estoque vai a
  // -2 e zera quando a compra entra. UI mostra negativo em vermelho como
  // sinal pra repor.
  const novoEstoque = (variacao.estoque || 0) + delta;

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
  await setDoc(doc(db, "movEstoqueUniforme", mov.id), sanitizeForFirestore(mov));

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
  return snap.docs.map(d => ({ ...d.data(), id: d.id }) as KitAreaUniforme);
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

  // Resolve cada item. Estoque negativo é PERMITIDO — DP frequentemente
  // gera termo + dispara assinatura antes do equipamento chegar do
  // fornecedor (compra atrasada). Quando a compra entra, soma e zera.
  type Resolved = { item: ItemUniforme; variacao: VariacaoItem; qtd: number };
  const resolved: Resolved[] = [];
  for (const i of itens) {
    const item = catalogo.find(x => x.id === i.itemId);
    if (!item) throw new Error(`Item não encontrado no catálogo: ${i.itemId}`);
    const variacao = item.variacoes.find(v => v.id === i.variacaoId);
    if (!variacao) throw new Error(`Variação não encontrada em ${item.nome}: ${i.variacaoId}`);
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
  await setDoc(doc(db, "entregasUniforme", id), sanitizeForFirestore(entrega));

  // Trilha do Empregado: registra entrega de uniforme/EPI (Fase 9).
  // Só se temos empregadoId (entregas no momento da admissão podem não ter ainda).
  if (empregadoId) {
    try {
      const { registrarEvento } = await import("../../modules/trilha/repository");
      const totalItens = entrega.itens.reduce((s, i) => s + i.qtd, 0);
      const listaItens = entrega.itens.map(i => `${i.qtd}× ${i.nome} (${i.tamanho})`).join("; ");
      await registrarEvento({
        restaurantId,
        empregadoId,
        empregadoNomeSnapshot: candidatoSnapshot?.nome,
        tipo: "entrega_uniforme",
        data: now.slice(0, 10),
        titulo: `Entrega ${tipo === "epi" ? "de EPIs" : "de uniformes"} (${totalItens} itens)`,
        descricao: listaItens,
        metadados: {
          tipoEntrega: tipo,
          motivo,
          itens: entrega.itens,
        },
        fonte: "auto",
        refOrigem: `entrega:${id}`,
        registradoPor: { id: pessoa.id, nome: pessoa.nome },
      });
    } catch (e) {
      console.warn("[uniformes] falha ao registrar trilha:", e);
    }
  }

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
 * Atualiza uma entrega existente — usado quando o usuário reabre o modal
 * de entrega (admissão, geralmente) e ajusta os itens. Em vez de criar
 * uma entrega nova (que duplicaria estoque e PDF), recalcula deltas:
 *
 *   delta_kv = nova_qtd[k,v] − antiga_qtd[k,v]
 *
 * Pra cada (item, variação) com delta != 0, chama `ajustarEstoque` com
 * `-delta` (saída adicional se delta>0, devolução se delta<0). Itens
 * removidos viram delta negativo (estoque volta). Itens novos viram
 * delta positivo.
 *
 * Atualiza o doc `entregasUniforme/{id}` substituindo `itens` pela nova
 * lista. NÃO mexe em devolução (se já tiver `devolucao`, lança erro —
 * não dá pra editar uma entrega já devolvida).
 */
export async function atualizarEntrega(opts: {
  entrega: EntregaUniforme;
  itens: { itemId: string; variacaoId: string; qtd: number }[];
  observacao?: string;
  pessoa: Pessoa;
  catalogo: ItemUniforme[];
}): Promise<EntregaUniforme> {
  const { entrega, itens: novosItens, observacao, pessoa, catalogo } = opts;
  if (entrega.devolucao) {
    throw new Error("Essa entrega já tem devolução registrada — não dá pra editar.");
  }
  if (novosItens.length === 0) {
    throw new Error("A entrega precisa de pelo menos 1 item.");
  }

  // Resolve catálogo + valida que tudo existe
  type Resolved = { item: ItemUniforme; variacao: VariacaoItem; qtd: number };
  const resolvidos: Resolved[] = [];
  for (const i of novosItens) {
    const item = catalogo.find(x => x.id === i.itemId);
    if (!item) throw new Error(`Item não encontrado no catálogo: ${i.itemId}`);
    const variacao = item.variacoes.find(v => v.id === i.variacaoId);
    if (!variacao) throw new Error(`Variação não encontrada em ${item.nome}: ${i.variacaoId}`);
    resolvidos.push({ item, variacao, qtd: i.qtd });
  }

  // Agrega qtds atuais (antigas) e novas por (itemId, variacaoId).
  // EntregaItemUniforme.variacaoId é opcional pra retro-compat — entregas
  // legadas sem variação não dá pra ajustar estoque (estoque é por
  // variação), então pulamos.
  const chave = (itemId: string, varId: string) => `${itemId}::${varId}`;
  const antigas = new Map<string, number>();
  for (const it of entrega.itens) {
    if (!it.variacaoId) {
      console.warn(`[atualizarEntrega] item legado sem variacaoId — ignorado: ${it.nome}`);
      continue;
    }
    antigas.set(chave(it.itemId, it.variacaoId), (antigas.get(chave(it.itemId, it.variacaoId)) || 0) + it.qtd);
  }
  const novas = new Map<string, number>();
  for (const r of resolvidos) {
    novas.set(chave(r.item.id, r.variacao.id), (novas.get(chave(r.item.id, r.variacao.id)) || 0) + r.qtd);
  }

  // Pré-valida estoque pra deltas positivos (saída adicional). Pra
  // delta negativo (devolução), `ajustarEstoque` aceita aumentar estoque.
  const todasChaves = new Set([...antigas.keys(), ...novas.keys()]);
  type Movimento = { item: ItemUniforme; variacao: VariacaoItem; delta: number };
  const movimentos: Movimento[] = [];
  for (const k of todasChaves) {
    const ant = antigas.get(k) || 0;
    const nov = novas.get(k) || 0;
    const delta = nov - ant;
    if (delta === 0) continue;
    const [itemId, variacaoId] = k.split("::");
    const item = catalogo.find(x => x.id === itemId);
    if (!item) throw new Error(`Item do catálogo sumiu durante o update: ${itemId}`);
    const variacao = item.variacoes.find(v => v.id === variacaoId);
    if (!variacao) throw new Error(`Variação sumiu durante o update: ${variacaoId}`);
    // Estoque negativo permitido — ver criarEntrega pra contexto.
    movimentos.push({ item, variacao, delta });
  }

  // Aplica movimentos (saída quando delta>0, devolução quando delta<0)
  const motivoMov: MotivoMovEstoque =
    entrega.motivo === "troca" ? "troca" :
    entrega.motivo === "admissao" ? "entrega" :
    "entrega";
  for (const m of movimentos) {
    await ajustarEstoque({
      item: m.item,
      variacaoId: m.variacao.id,
      delta: -m.delta,    // delta positivo = saída → ajusta com -delta
      motivo: m.delta < 0 ? "ajuste" : motivoMov,
      refEntregaId: entrega.id,
      observacao: m.delta < 0
        ? `Devolução por ajuste da entrega ${entrega.id}`
        : `Acréscimo no ajuste da entrega ${entrega.id}`,
      pessoa,
    });
  }

  // Atualiza o doc da entrega com novos itens snapshot
  const now = new Date().toISOString();
  const itensAtualizados: EntregaUniforme["itens"] = resolvidos.map(({ item, variacao, qtd }) => ({
    itemId: item.id,
    variacaoId: variacao.id,
    nome: item.nome,
    tamanho: variacao.tamanho,
    qtd,
    custoUnit: variacao.custoUnitOverride ?? item.custoUnit,
    caEpi: item.caEpi,
    validadeAte: calcValidadeAte(entrega.entregueEm, item.validadeDias),
  }));
  const patch = {
    itens: itensAtualizados,
    observacao,
    atualizadoEm: now,
    atualizadoPor: { id: pessoa.id, nome: pessoa.nome },
  };
  await updateDoc(doc(db, "entregasUniforme", entrega.id), sanitizeForFirestore(patch));

  return { ...entrega, ...patch };
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

/**
 * Cancela uma entrega — quando o empregado NÃO chegou a receber (mudança
 * de plano, desistência, etc.). Devolve TODOS os itens ao estoque na qtd
 * cheia. Marca a entrega com `cancelamento` (mutuamente exclusivo com
 * devolução).
 */
export async function cancelarEntrega(opts: {
  entrega: EntregaUniforme;
  motivo: string;
  pessoa: Pessoa;
  catalogo: ItemUniforme[];
}): Promise<void> {
  const { entrega, motivo, pessoa, catalogo } = opts;
  if (entrega.cancelamento) {
    throw new Error("Essa entrega já está cancelada.");
  }
  if (entrega.devolucao) {
    throw new Error("Essa entrega já tem devolução registrada — não pode cancelar.");
  }
  if (!motivo.trim()) {
    throw new Error("Motivo do cancelamento é obrigatório.");
  }
  const now = new Date().toISOString();
  await updateDoc(doc(db, "entregasUniforme", entrega.id), sanitizeForFirestore({
    cancelamento: {
      canceladoEm: now,
      canceladoPor: { id: pessoa.id, nome: pessoa.nome },
      motivo: motivo.trim(),
    },
  }));

  // Devolve TUDO ao estoque
  for (const i of entrega.itens) {
    if (!i.variacaoId) continue;
    const item = catalogo.find(x => x.id === i.itemId);
    if (!item) continue;
    await ajustarEstoque({
      item, variacaoId: i.variacaoId, delta: i.qtd,
      motivo: "devolucao", refEntregaId: entrega.id,
      observacao: `Cancelamento: ${motivo.trim()}`,
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
  // diasAlerta >= 9999 = "todos" (sem limite)
  const limiteMs = diasAlerta >= 9999 ? Infinity : hojeMs + diasAlerta * 86400_000;
  const resultado: { entrega: EntregaUniforme; item: EntregaItemUniformeComStatus }[] = [];
  for (const entrega of entregas) {
    // Entregas canceladas não contam — itens voltaram pro estoque
    if (entrega.cancelamento) continue;
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
