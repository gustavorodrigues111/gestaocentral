// Camada 1 (código, instantânea) do vínculo NF ⇄ pedido: filtra os pedidos que
// podem ter originado esta nota e os ranqueia por fornecedor, janela de tempo,
// itens em comum e proximidade de valor. O topo vira a sugestão; a IA (camada 2)
// só confere item-a-item o pedido escolhido.
import type { Fornecedor, Pedido, RecebimentoNota } from "../../core/types";

const norm = (s?: string) => (s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const soDigitos = (s?: string) => (s || "").replace(/\D/g, "");
const STOP = new Set(["de", "da", "do", "com", "sem", "kg", "g", "ml", "l", "cx", "un", "pct", "und", "caixa", "pacote", "fardo", "lata", "garrafa", "tipo", "para"]);
const tokens = (s?: string) => norm(s).split(" ").filter(t => t.length >= 3 && !STOP.has(t));

// nº de dias entre duas datas (YYYY-MM-DD ou ISO); positivo = a depois de b.
function diasEntre(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const da = new Date(a.length <= 10 ? a + "T00:00:00" : a).getTime();
  const db = new Date(b.length <= 10 ? b + "T00:00:00" : b).getTime();
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((da - db) / 86400000);
}

export type CandidatoPedido = { pedido: Pedido; score: number; forte: boolean; motivos: string[] };

const CANDIDATAVEL = new Set(["enviado", "aprovado"]);

export function montarCandidatos(nota: RecebimentoNota, pedidos: Pedido[], fornecedores: Fornecedor[]): CandidatoPedido[] {
  const fornById: Record<string, Fornecedor> = {};
  for (const f of fornecedores) fornById[f.id] = f;

  const cnpjNota = soDigitos(nota.cnpjEmissor);
  const emissorTk = tokens(nota.emissor);
  const notaItensTk = (nota.itens || []).map(it => new Set(tokens(it.descricao)));
  const dataNota = nota.dataEmissao || (nota.recebidoEm ? nota.recebidoEm.slice(0, 10) : undefined);
  const valorNota = nota.valorProdutos ?? nota.valorTotal;

  // Pedidos ainda abertos (aguardando recebimento) e não vinculados a OUTRA nota.
  const abertos = pedidos.filter(p =>
    CANDIDATAVEL.has(p.status) &&
    (!p.recebimentoNotaId || p.recebimentoNotaId === nota.id));

  // Quantos pedidos abertos por fornecedor (pra marcar "único → forte").
  const abertosPorForn: Record<string, number> = {};
  for (const p of abertos) abertosPorForn[p.fornecedorId] = (abertosPorForn[p.fornecedorId] || 0) + 1;

  const cands = abertos.map(p => {
    const motivos: string[] = [];
    let score = 0;
    const forn = fornById[p.fornecedorId];

    // ── Fornecedor (sinal mais forte) ──
    let fornBate = false;
    const cnpjForn = soDigitos(forn?.cnpj);
    if (cnpjNota && cnpjForn && cnpjNota === cnpjForn) { score += 50; fornBate = true; motivos.push("CNPJ bate"); }
    else {
      const nomeForn = norm(forn?.nome || p.fornecedorNomeSnapshot);
      const nomeNota = norm(nota.emissor);
      if (nomeForn && nomeNota && (nomeForn === nomeNota || nomeForn.includes(nomeNota) || nomeNota.includes(nomeForn))) { score += 35; fornBate = true; motivos.push("mesmo fornecedor"); }
      else {
        const fornTk = new Set(tokens(forn?.nome || p.fornecedorNomeSnapshot));
        const comum = emissorTk.filter(t => fornTk.has(t)).length;
        if (comum > 0) { score += 15; motivos.push("fornecedor parecido"); }
      }
    }

    // ── Janela de tempo ──
    const dias = diasEntre(dataNota, p.enviadoEm || p.criadoEm);   // nota depois do pedido = positivo
    if (dias != null) {
      if (dias >= 0 && dias <= 15) { score += Math.round(20 * (1 - dias / 15)); if (dias <= 7) motivos.push(`pedido de ${dias}d atrás`); }
      else if (dias > 15 && dias <= 30) score += 5;
      else if (dias < 0) score -= 10;   // pedido posterior à nota: improvável
    }

    // ── Itens em comum ──
    let itensComuns = 0;
    for (const it of p.itens) {
      const tk = new Set(tokens(it.insumoNomeSnapshot));
      if (tk.size === 0) continue;
      const casou = notaItensTk.some(nt => { for (const t of tk) if (nt.has(t)) return true; return false; });
      if (casou) itensComuns++;
    }
    if (itensComuns > 0) { score += Math.min(itensComuns * 4, 24); motivos.push(`${itensComuns} item(ns) em comum`); }

    // ── Proximidade de valor (fraco) ──
    if (valorNota != null && p.totalEstimado != null && p.totalEstimado > 0) {
      const rel = Math.abs(valorNota - p.totalEstimado) / Math.max(valorNota, p.totalEstimado);
      if (rel <= 0.3) { score += Math.round(10 * (1 - rel / 0.3)); }
    }

    const forte = fornBate && (abertosPorForn[p.fornecedorId] === 1);
    return { pedido: p, score, forte, motivos };
  });

  cands.sort((a, b) => b.score - a.score || (b.pedido.enviadoEm || "").localeCompare(a.pedido.enviadoEm || ""));
  return cands;
}
