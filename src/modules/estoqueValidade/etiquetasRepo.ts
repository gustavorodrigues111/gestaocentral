// Etiquetas de validade emitidas (Tipo A): gravação, baixa e classificação.
// 1 doc por ETIQUETA FÍSICA: cópias de uma mesma emissão compartilham o lote,
// mas cada uma tem o seu QR, para a baixa ser pote a pote.
import { collection, doc, getDocs, limit, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";

export type StatusEtiqueta = "ativa" | "consumida" | "descartada";
export const MOTIVOS_DESCARTE = ["Vencida", "Estragada", "Sobra de serviço", "Erro de etiqueta", "Outro"] as const;

export type EtiquetaEmitida = {
  id: string;
  tipo: "producao";
  restaurantId: string;
  produtoId: string; produtoNome: string;
  conservacao: string; conservacaoLabel: string; diasValidade: number;
  localId?: string | null; localNome?: string | null;   // local de estoque escolhido na emissão
  manipuladorUid: string | null; manipuladorNome: string;
  impressaoTs: string;          // ISO
  validade: string;             // YYYY-MM-DD
  lote: string;                 // compartilhado entre as cópias da emissão
  copia: number; totalCopias: number;
  qrToken: string;              // único por etiqueta
  status: StatusEtiqueta;
  baixaTs?: string | null; baixaDia?: string | null; baixaPorUid?: string | null; baixaPorNome?: string | null; baixaMotivo?: string | null;
  via?: "sunmi" | "navegador" | "fila-caixa";
  criadoEm: string;
};

export const urlEtiqueta = (token: string) => `https://planejamento.app/e/${encodeURIComponent(token)}`;
export const tokenDaCopia = (lote: string, copia: number) => `et_${lote}-${copia}`;

/** Aceita a URL do QR ou o token puro; devolve o token da etiqueta ou null. */
export function tokenDoQr(lido: string): string | null {
  const t = (lido || "").trim();
  const m = t.match(/(?:\/e\/)?(et_[A-Za-z0-9-]+)\s*$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Dias corridos entre hoje (fuso de São Paulo) e a validade (YYYY-MM-DD). */
export function diasAteValidade(validadeYmd: string, hojeYmd: string): number {
  const a = new Date(validadeYmd + "T12:00:00Z").getTime();
  const b = new Date(hojeYmd + "T12:00:00Z").getTime();
  return Math.round((a - b) / 86400000);
}

export type Faixa = "vencida" | "hoje" | "amanha" | "semana" | "depois";
export const FAIXAS: { id: Faixa; label: string }[] = [
  { id: "vencida", label: "Vencidas" }, { id: "hoje", label: "Vencem hoje" }, { id: "amanha", label: "Amanhã" },
  { id: "semana", label: "Até 7 dias" }, { id: "depois", label: "Depois" },
];
export function faixaDe(dias: number): Faixa {
  if (dias < 0) return "vencida";
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanha";
  if (dias <= 7) return "semana";
  return "depois";
}

export function textoPrazo(dias: number): string {
  if (dias < -1) return `venceu há ${-dias} dias`;
  if (dias === -1) return "venceu ontem";
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `vence em ${dias} dias`;
}

/**
 * Grava as N etiquetas de uma emissão numa única operação. Devolve os docs na
 * hora (os ids nascem no cliente) e a confirmação do servidor à parte: sem
 * internet a cozinha imprime assim mesmo e o registro sobe quando a rede volta.
 */
export function gravarEmissao(base: Omit<EtiquetaEmitida, "id" | "copia" | "qrToken" | "status" | "criadoEm">): { docs: EtiquetaEmitida[]; confirmacao: Promise<void> } {
  const batch = writeBatch(db);
  const criadoEm = new Date().toISOString();
  const docs: EtiquetaEmitida[] = [];
  for (let i = 1; i <= base.totalCopias; i++) {
    const ref = doc(collection(db, "etiquetas"));
    const dados: Omit<EtiquetaEmitida, "id"> = { ...base, copia: i, qrToken: tokenDaCopia(base.lote, i), status: "ativa", criadoEm };
    batch.set(ref, dados);
    docs.push({ ...dados, id: ref.id });
  }
  return { docs, confirmacao: batch.commit() };
}

/** Hoje no fuso de São Paulo (UTC-3), YYYY-MM-DD. */
export const hojeSP = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Últimos N dias (inclui hoje), YYYY-MM-DD — para consultar o histórico de baixas. */
export function ultimosDias(n: number, hoje = hojeSP()): string[] {
  const base = new Date(hoje + "T12:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => new Date(base - i * 86400000).toISOString().slice(0, 10));
}

export async function darBaixaEtiqueta(id: string, status: "consumida" | "descartada", por: { uid?: string | null; nome?: string | null }, motivo?: string | null) {
  await updateDoc(doc(db, "etiquetas", id), {
    status, baixaTs: new Date().toISOString(), baixaDia: hojeSP(), baixaPorUid: por.uid || null, baixaPorNome: por.nome || null,
    baixaMotivo: status === "descartada" ? (motivo || "Outro") : null,
  });
}

/** Desfaz uma baixa feita por engano (volta a ativa). */
export async function reativarEtiqueta(id: string) {
  await updateDoc(doc(db, "etiquetas", id), { status: "ativa", baixaTs: null, baixaDia: null, baixaPorUid: null, baixaPorNome: null, baixaMotivo: null });
}

/** Busca uma etiqueta pelo token do QR (inclusive já baixada). */
export async function buscarPorToken(restaurantId: string, token: string): Promise<EtiquetaEmitida | null> {
  const s = await getDocs(query(collection(db, "etiquetas"), where("restaurantId", "==", restaurantId), where("qrToken", "==", token), limit(1)));
  const d = s.docs[0];
  return d ? ({ id: d.id, ...d.data() } as EtiquetaEmitida) : null;
}
