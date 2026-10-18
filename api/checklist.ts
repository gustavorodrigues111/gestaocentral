// ════════════════════════════════════════════════════════════════════════════
//  /api/checklist — estado COMPARTILHADO de checklists de páginas públicas
//  (ex.: /paginas/jantar-soeta.html). Grava via USUÁRIO DE SERVIÇO
//  (_firestoreRest) — não precisa abrir escrita anônima nem ligar login Anônimo.
//  A página pública nunca toca no Firestore direto; sempre passa por aqui.
//
//  Doc: paginasChecklist/{id} = { checks: {<item>: bool}, atualizadoEm }
//
//    GET  /api/checklist?id=<slug>                 -> { checks: {...} }
//    POST /api/checklist  { id, item, checked }    -> marca/desmarca 1 item
//    POST /api/checklist  { id, clear: true }      -> desmarca tudo
//
//  Env: credenciais do _firestoreRest (WEBHOOK_FB_EMAIL/PASSWORD + API key web).
// ════════════════════════════════════════════════════════════════════════════
import { firestoreLer, firestorePatchCampos, firestoreDisponivel } from "./_firestoreRest.js";

export const config = { maxDuration: 10 };

type VercelReq = { method?: string; query?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (c: number) => VercelRes; setHeader: (k: string, v: string) => void; json: (b: unknown) => void };

const safeParse = (s: string): Record<string, unknown> | null => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; } };
// slug seguro da página e chave de item (espelha a sanitização do cliente).
const okId = (s: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
const chaveItem = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (!firestoreDisponivel()) { res.status(503).json({ error: "indisponivel" }); return; }

  if (req.method === "GET") {
    let id = req.query?.id; if (Array.isArray(id)) id = id[0];
    id = (id || "").toString();
    if (!okId(id)) { res.status(400).json({ error: "id invalido" }); return; }
    try {
      const doc = await firestoreLer("paginasChecklist", id);
      const checks = doc && typeof doc.checks === "object" && doc.checks ? doc.checks : {};
      res.status(200).json({ checks });
    } catch { res.status(200).json({ checks: {} }); }   // best-effort: não derruba a página
    return;
  }

  if (req.method === "POST") {
    const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as Record<string, unknown> | null;
    if (!body) { res.status(400).json({ error: "body ausente" }); return; }
    const id = String(body.id || "");
    if (!okId(id)) { res.status(400).json({ error: "id invalido" }); return; }
    const agora = new Date().toISOString();
    try {
      if (body.clear === true) {
        // Desmarca tudo: põe cada item existente em false numa só gravação.
        const doc = await firestoreLer("paginasChecklist", id);
        const checks = (doc && typeof doc.checks === "object" && doc.checks ? doc.checks : {}) as Record<string, unknown>;
        const updates: Record<string, unknown> = { atualizadoEm: agora };
        for (const k of Object.keys(checks)) updates["checks." + k] = false;
        await firestorePatchCampos("paginasChecklist", id, updates);
        res.status(200).json({ ok: true });
        return;
      }
      const item = chaveItem(String(body.item || ""));
      if (!item) { res.status(400).json({ error: "item invalido" }); return; }
      await firestorePatchCampos("paginasChecklist", id, { ["checks." + item]: body.checked === true, atualizadoEm: agora });
      res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: String((e as Error)?.message || e).slice(0, 160) }); }
    return;
  }

  res.status(405).json({ error: "metodo" });
}
