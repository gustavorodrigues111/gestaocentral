// ════════════════════════════════════════════════════════════════════════════
//  /api/pagina-estado — estado compartilhado de páginas hospedadas (checklists em
//  tempo real). A página hospedada roda em iframe ISOLADO, sem sessão Firebase;
//  então ela NÃO fala direto com o Firestore — fala com este endpoint, que grava
//  como usuário de serviço (via _firestoreRest). Assim NENHUMA regra do Firestore
//  é aberta: a coleção `paginasEstado` continua exigindo `authed()`, e o único que
//  escreve é o servidor. O endpoint só toca `paginasEstado` e valida o payload.
//
//  `token` é um portão leve contra bots (não é segredo forte — o HTML é
//  view-sourceable atrás da senha do módulo Páginas). Mesmo se vazar, o máximo que
//  se faz é rabiscar a listinha; nenhum outro dado do app é alcançável por aqui.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreLer, firestorePatchCampos } from "./_firestoreRest.js";

export const config = { maxDuration: 15 };

const COL = "paginasEstado";
const TOKEN = "rameh-pages-2026";
const idOk = (s: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);

type Extra = { id: string; o: "sp" | "bh"; g: string; n: string; d: string[]; novo: boolean };
function sanExtra(x: unknown): Extra | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const id = String(o.id || "");
  const nome = String(o.n || "").slice(0, 120);
  if (!idOk(id) || !nome) return null;
  const d = Array.isArray(o.d) ? o.d.map((k) => String(k)).filter(Boolean).slice(0, 10) : [];
  return { id, o: String(o.o) === "bh" ? "bh" : "sp", g: "Acrescentados", n: nome, d, novo: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    if (String(body.token || "") !== TOKEN) { res.status(403).json({ ok: false, erro: "token" }); return; }
    const evento = String(body.evento || "").trim().toLowerCase();
    if (!idOk(evento)) { res.status(400).json({ ok: false, erro: "evento" }); return; }
    const op = String(body.op || "");

    if (op === "get") {
      const d = await firestoreLer(COL, evento);
      res.status(200).json({
        ok: true,
        checks: (d && typeof d.checks === "object" && d.checks) || {},
        qtys: (d && typeof d.qtys === "object" && d.qtys) || {},
        extras: (d && Array.isArray(d.extras) && d.extras) || [],
      });
      return;
    }
    if (op === "check") {
      const id = String(body.id || ""); if (!idOk(id)) { res.status(400).json({ ok: false }); return; }
      await firestorePatchCampos(COL, evento, { ["checks." + id]: !!body.val });
      res.status(200).json({ ok: true }); return;
    }
    if (op === "qty") {
      const id = String(body.id || ""); if (!idOk(id)) { res.status(400).json({ ok: false }); return; }
      await firestorePatchCampos(COL, evento, { ["qtys." + id]: String(body.val || "").slice(0, 60) });
      res.status(200).json({ ok: true }); return;
    }
    if (op === "addExtra") {
      const ex = sanExtra(body.extra); if (!ex) { res.status(400).json({ ok: false }); return; }
      const d = await firestoreLer(COL, evento);
      const cur = (d && Array.isArray(d.extras) ? d.extras : []) as Extra[];
      if (!cur.some((e) => e && e.id === ex.id)) cur.push(ex);
      await firestorePatchCampos(COL, evento, { extras: cur.slice(0, 400) });
      res.status(200).json({ ok: true }); return;
    }
    if (op === "removeExtra") {
      const id = String(body.id || ""); if (!idOk(id)) { res.status(400).json({ ok: false }); return; }
      const d = await firestoreLer(COL, evento);
      const cur = (d && Array.isArray(d.extras) ? d.extras : []) as Extra[];
      await firestorePatchCampos(COL, evento, { extras: cur.filter((e) => e && e.id !== id), ["checks." + id]: undefined, ["qtys." + id]: undefined });
      res.status(200).json({ ok: true }); return;
    }
    if (op === "reset") {
      await firestorePatchCampos(COL, evento, { checks: {} });
      res.status(200).json({ ok: true }); return;
    }
    res.status(400).json({ ok: false, erro: "op" });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e instanceof Error ? e.message : "?" });
  }
}
