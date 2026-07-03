// Dedup de insumos: normaliza o nome e busca similares pra sugerir o existente
// em vez de duplicar ("sal refi nado" ≈ "Sal refinado").
import type { FtInsumo } from "../../core/types";

const ACENTOS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizarNome(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(ACENTOS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Distância de edição (Levenshtein) — pra pegar erro de digitação.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export type SugestaoInsumo = { insumo: FtInsumo; motivo: "igual" | "contem" | "parecido" };

// Busca sugestões de insumos existentes pro termo digitado. Ordena por
// relevância; usada tanto no autocomplete quanto no aviso de duplicado.
export function sugerirInsumos(termo: string, insumos: FtInsumo[], limite = 6): SugestaoInsumo[] {
  const n = normalizarNome(termo);
  if (!n) return [];
  const ativos = insumos.filter(i => i.ativo !== false);
  const out: (SugestaoInsumo & { score: number })[] = [];
  for (const ins of ativos) {
    const alvo = ins.nomeNormalizado || normalizarNome(ins.nome);
    const candidatos = [alvo, ...(ins.aliases || []).map(normalizarNome)];
    let melhor: { motivo: SugestaoInsumo["motivo"]; score: number } | null = null;
    for (const c of candidatos) {
      if (!c) continue;
      if (c === n) { melhor = { motivo: "igual", score: 0 }; break; }
      if (c.includes(n) || n.includes(c)) { if (!melhor || 1 < melhor.score) melhor = { motivo: "contem", score: 1 }; continue; }
      const dist = levenshtein(c, n);
      const lim = Math.max(2, Math.floor(Math.max(c.length, n.length) * 0.3)); // ~30% de tolerância
      if (dist <= lim) { const sc = 2 + dist; if (!melhor || sc < melhor.score) melhor = { motivo: "parecido", score: sc }; }
    }
    if (melhor) out.push({ insumo: ins, motivo: melhor.motivo, score: melhor.score });
  }
  out.sort((a, b) => a.score - b.score || a.insumo.nome.localeCompare(b.insumo.nome));
  return out.slice(0, limite).map(({ insumo, motivo }) => ({ insumo, motivo }));
}
