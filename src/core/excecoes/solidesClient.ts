// ════════════════════════════════════════════════════════════════════════════
//  solidesClient — wrapper de front-end pra chamar a Vercel API Route
//  /api/solides-punches. O token NUNCA passa por aqui (fica no servidor).
// ════════════════════════════════════════════════════════════════════════════

import type { SolidesPunch } from "./types";

export type FetchPunchesResult = {
  punches: SolidesPunch[];
  totalElements: number;
};

// Busca todas as marcações de ponto no intervalo [startDate, endDate].
// Datas no formato YYYY-MM-DD. A paginação acontece no servidor.
// `restaurantKey` (shortCode do restaurante) seleciona o token Sólides daquela
// conta no servidor — cada restaurante tem a sua.
export async function fetchPunches(
  startDate: string,
  endDate: string,
  restaurantKey?: string,
): Promise<FetchPunchesResult> {
  const params = new URLSearchParams({ startDate, endDate });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const url = `/api/solides-punches?${params.toString()}`;

  let resp: Response;
  try {
    resp = await fetch(url, { method: "GET" });
  } catch (e) {
    throw new Error(
      `Não consegui falar com o servidor (/api/solides-punches). ` +
        `${e instanceof Error ? e.message : ""}`.trim(),
    );
  }

  const text = await resp.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Resposta inválida do servidor (HTTP ${resp.status}). ` +
          `Confira se a API Route /api/solides-punches está deployada na Vercel.`,
      );
    }
  }

  if (!resp.ok) {
    const msg = (json as { error?: string }).error || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }

  const data = json as { punches?: unknown; totalElements?: number };
  const punches = Array.isArray(data.punches) ? (data.punches as SolidesPunch[]) : [];
  return {
    punches,
    totalElements: typeof data.totalElements === "number" ? data.totalElements : punches.length,
  };
}
