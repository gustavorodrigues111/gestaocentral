// Helper pra buscar feriados nacionais via BrasilAPI.
// Endpoint: https://brasilapi.com.br/api/feriados/v1/{ano}
// Sem auth, sem cota — usado pra sugerir feriados ao admin.
//
// Cache em memória + localStorage (TTL 24h) pra evitar refetch ao reabrir a aba.

export type FeriadoBR = {
  date: string;      // "YYYY-MM-DD"
  name: string;      // "Confraternização Universal"
  type: string;      // "national" | "regional"
};

const CACHE_PREFIX = "feriadosBR_v1_";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CacheEntry = { ts: number; data: FeriadoBR[] };

export async function buscarFeriadosBR(ano: number): Promise<FeriadoBR[]> {
  const key = CACHE_PREFIX + ano;
  // Tenta cache
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw) as CacheEntry;
      if (Date.now() - c.ts < CACHE_TTL_MS) return c.data;
    }
  } catch { /* ignore — cache corrompido */ }

  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
  if (!res.ok) throw new Error(`Erro BrasilAPI: ${res.status}`);
  const list = (await res.json()) as FeriadoBR[];
  // Persiste no cache
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: list } as CacheEntry));
  } catch { /* localStorage cheio — ok, segue sem cache */ }
  return list;
}

// Busca ano atual + próximo ano (relevante quando perto do fim do ano)
export async function buscarFeriadosProximos12Meses(): Promise<FeriadoBR[]> {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const proximoAno = anoAtual + 1;
  const [a, b] = await Promise.all([
    buscarFeriadosBR(anoAtual).catch(() => [] as FeriadoBR[]),
    buscarFeriadosBR(proximoAno).catch(() => [] as FeriadoBR[]),
  ]);
  // Filtra feriados que já passaram (mais de 30 dias atrás).
  const corte = new Date(hoje);
  corte.setDate(corte.getDate() - 30);
  const corteIso = corte.toISOString().slice(0, 10);
  return [...a, ...b]
    .filter(f => f.date >= corteIso)
    .sort((x, y) => x.date.localeCompare(y.date));
}
