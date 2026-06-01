// ════════════════════════════════════════════════════════════════════════════
//  Cliente front-end pra as APIs de job-role (cargos) da Sólides.
//   - GET  /api/solides-job-roles?restaurant=<shortCode>
//   - POST /api/solides-create-job-role  { restaurant, name, externalId? }
//
//  Usado pela aba "Compatibilidade de cadastros" → sub-tab "Cargos".
// ════════════════════════════════════════════════════════════════════════════

export type SolidesJobRole = {
  id: number;
  name: string;
  externalId?: string;
};

async function parseJsonOrThrow(resp: Response): Promise<unknown> {
  const text = await resp.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${resp.status}).`);
    }
  }
  if (!resp.ok) {
    const msg = (json as { error?: string } | null)?.error || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function fetchSolidesJobRoles(restaurantKey: string): Promise<SolidesJobRole[]> {
  const params = new URLSearchParams({ restaurant: restaurantKey });
  const resp = await fetch(`/api/solides-job-roles?${params.toString()}`);
  const json = await parseJsonOrThrow(resp);
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: SolidesJobRole[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it as { id?: unknown; name?: unknown; externalId?: unknown };
    const id = typeof r.id === "number" ? r.id : Number(r.id);
    if (!Number.isFinite(id)) continue;
    out.push({
      id,
      name: typeof r.name === "string" ? r.name : "",
      externalId: r.externalId == null ? undefined : String(r.externalId),
    });
  }
  return out;
}

export async function createSolidesJobRole(input: {
  restaurantKey: string;
  name: string;
  externalId?: string;
}): Promise<SolidesJobRole> {
  const resp = await fetch("/api/solides-create-job-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurant: input.restaurantKey,
      name: input.name,
      externalId: input.externalId,
    }),
  });
  const json = await parseJsonOrThrow(resp);
  if (!json || typeof json !== "object") {
    throw new Error("Resposta inesperada da Sólides ao criar cargo.");
  }
  const r = json as { id?: unknown; name?: unknown; externalId?: unknown };
  const id = typeof r.id === "number" ? r.id : Number(r.id);
  if (!Number.isFinite(id)) {
    throw new Error("Sólides não devolveu id do cargo criado.");
  }
  return {
    id,
    name: typeof r.name === "string" ? r.name : input.name,
    externalId: r.externalId == null ? undefined : String(r.externalId),
  };
}
