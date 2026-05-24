// Helper pra buscar feriados nacionais + estaduais.
//
// Nacionais: BrasilAPI — https://brasilapi.com.br/api/feriados/v1/{ano}
// Estaduais: tabela curada local (BrasilAPI não cobre).
// Municipais: ficam manuais — inviável manter pros 5.500+ municípios.
//
// Cache em memória + localStorage (TTL 24h) pra evitar refetch ao reabrir a aba.

export type FeriadoBR = {
  date: string;      // "YYYY-MM-DD"
  name: string;      // "Confraternização Universal"
  type: "nacional" | "estadual" | "municipal";
  uf?: string;       // só pros estaduais
};

const CACHE_PREFIX = "feriadosBR_v2_";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CacheEntry = { ts: number; data: FeriadoBR[] };

// ─── BrasilAPI: feriados nacionais ───────────────────────────────────

async function buscarNacionais(ano: number): Promise<FeriadoBR[]> {
  const key = CACHE_PREFIX + "nac_" + ano;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw) as CacheEntry;
      if (Date.now() - c.ts < CACHE_TTL_MS) return c.data;
    }
  } catch { /* cache corrompido */ }

  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
  if (!res.ok) throw new Error(`BrasilAPI: ${res.status}`);
  const raw = (await res.json()) as Array<{ date: string; name: string; type: string }>;
  const list: FeriadoBR[] = raw.map(r => ({ date: r.date, name: r.name, type: "nacional" }));
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: list }));
  } catch { /* localStorage cheio */ }
  return list;
}

// ─── Tabela curada de feriados estaduais ─────────────────────────────
//
// Mês/dia fixos por UF. Gerada manualmente — fonte: leis estaduais. Vai
// crescendo conforme aparecem clientes em novas UFs. Datas móveis (ex:
// Sexta-feira santa) já vêm via BrasilAPI no feriado nacional.

type FeriadoFixo = { mes: number; dia: number; nome: string };

const FERIADOS_ESTADUAIS: Record<string, FeriadoFixo[]> = {
  SP: [
    { mes: 7, dia: 9,  nome: "Revolução Constitucionalista" },
  ],
  RJ: [
    { mes: 4, dia: 23, nome: "São Jorge" },
    { mes: 11, dia: 20, nome: "Consciência Negra" },
  ],
  MG: [
    { mes: 4, dia: 21, nome: "Tiradentes (data municipal Ouro Preto)" },
  ],
  BA: [
    { mes: 7, dia: 2,  nome: "Independência da Bahia" },
  ],
  PE: [
    { mes: 3, dia: 6,  nome: "Revolução Pernambucana" },
  ],
  CE: [
    { mes: 3, dia: 25, nome: "Data Magna do Ceará" },
  ],
  RS: [
    { mes: 9, dia: 20, nome: "Revolução Farroupilha" },
  ],
  PR: [
    { mes: 12, dia: 19, nome: "Emancipação Política do Paraná" },
  ],
  AM: [
    { mes: 9, dia: 5,  nome: "Elevação do Amazonas a Província" },
  ],
  GO: [
    { mes: 10, dia: 28, nome: "Dia do Servidor Público (estadual GO)" },
  ],
  DF: [
    { mes: 4, dia: 21, nome: "Fundação de Brasília" },
    { mes: 11, dia: 30, nome: "Dia do Evangélico (DF)" },
  ],
  // Demais UFs: adicionar conforme demanda.
};

function feriadosEstaduais(ano: number, uf?: string): FeriadoBR[] {
  if (!uf) return [];
  const lista = FERIADOS_ESTADUAIS[uf.toUpperCase()];
  if (!lista) return [];
  return lista.map(f => ({
    date: `${ano}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`,
    name: f.nome,
    type: "estadual" as const,
    uf: uf.toUpperCase(),
  }));
}

// ─── API pública ────────────────────────────────────────────────────

// Busca feriados nacionais + estaduais (pela UF do restaurante), filtrando
// pra próximos 6 meses a partir de hoje.
export async function buscarFeriadosProximos(uf?: string, mesesAFrente = 6): Promise<FeriadoBR[]> {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const proximoAno = anoAtual + 1;

  const [nacAtuais, nacProximo] = await Promise.all([
    buscarNacionais(anoAtual).catch(() => [] as FeriadoBR[]),
    buscarNacionais(proximoAno).catch(() => [] as FeriadoBR[]),
  ]);
  const estaduais = [
    ...feriadosEstaduais(anoAtual, uf),
    ...feriadosEstaduais(proximoAno, uf),
  ];

  const limite = new Date(hoje);
  limite.setMonth(limite.getMonth() + mesesAFrente);
  const limiteIso = limite.toISOString().slice(0, 10);
  const hojeIso = hoje.toISOString().slice(0, 10);

  return [...nacAtuais, ...nacProximo, ...estaduais]
    .filter(f => f.date >= hojeIso && f.date <= limiteIso)
    // Dedupe por (date + name)
    .filter((f, i, arr) => arr.findIndex(x => x.date === f.date && x.name === f.name) === i)
    .sort((x, y) => x.date.localeCompare(y.date));
}
