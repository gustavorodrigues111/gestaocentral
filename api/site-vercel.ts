// ════════════════════════════════════════════════════════════════════════════
//  /api/site-vercel — adiciona/verifica domínio próprio no projeto do Vercel,
//  pela conta central (token no servidor). Assim conectar um site fica ~1 clique.
//
//  Ações (POST { action, domain }):
//    "status" → { configured }            (front decide auto × manual)
//    "add"    → { ok, added, jaExistia }  (adiciona domain no projeto)
//    "check"  → { verified, records }     (estado de verificação/DNS)
//
//  ⚠️ Segurança: VERCEL_TOKEN é uma credencial ampla (gerencia o projeto). Fica
//  100% no servidor. Use um token com escopo restrito ao time. Sem env → inerte.
//
//  Env (Vercel):
//    VERCEL_TOKEN       — token de acesso à API do Vercel
//    VERCEL_PROJECT_ID  — id (ou nome) do projeto
//    VERCEL_TEAM_ID     — (opcional) se o projeto está num time
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API = "https://api.vercel.com";

function cfg() {
  const token = process.env.VERCEL_TOKEN || "";
  const project = process.env.VERCEL_PROJECT_ID || "";
  const team = process.env.VERCEL_TEAM_ID || "";
  return { token, project, team, configured: !!(token && project) };
}
function teamQ(team: string) { return team ? `?teamId=${encodeURIComponent(team)}` : ""; }
function normalize(input: string): string | null {
  let s = (input || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    const idToken = String(body.idToken || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
    const fbKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
    if (!idToken || !fbKey) { res.status(401).json({ error: "não autorizado" }); return; }
    const chk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${fbKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!chk.ok) { res.status(401).json({ error: "sessão inválida" }); return; }

    const action = String(body.action || "status");
    const c = cfg();

    if (action === "status") { res.status(200).json({ configured: c.configured }); return; }
    if (!c.configured) { res.status(503).json({ error: "Automação do Vercel não configurada (falta VERCEL_TOKEN/VERCEL_PROJECT_ID).", configured: false }); return; }

    const domain = normalize(String(body.domain || ""));
    if (!domain) { res.status(400).json({ error: "Domínio inválido." }); return; }
    const auth = { Authorization: `Bearer ${c.token}` };

    if (action === "add") {
      const r = await fetch(`${API}/v10/projects/${encodeURIComponent(c.project)}/domains${teamQ(c.team)}`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ name: domain }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { res.status(200).json({ ok: true, added: true, domain }); return; }
      // 409 = já existe no projeto → tratamos como sucesso idempotente.
      const code = (j as { error?: { code?: string } })?.error?.code;
      if (r.status === 409 || code === "domain_already_in_use" || code === "domain_taken") { res.status(200).json({ ok: true, added: false, jaExistia: true, domain }); return; }
      res.status(502).json({ error: (j as { error?: { message?: string } })?.error?.message || `Falha ao adicionar no Vercel (HTTP ${r.status}).` });
      return;
    }

    if (action === "check") {
      const r = await fetch(`${API}/v9/projects/${encodeURIComponent(c.project)}/domains/${encodeURIComponent(domain)}${teamQ(c.team)}`, { headers: auth });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: (j as { error?: { message?: string } })?.error?.message || `Falha ao consultar (HTTP ${r.status}).` }); return; }
      const d = j as { verified?: boolean; verification?: Array<{ type: string; domain: string; value: string }> };
      res.status(200).json({ verified: !!d.verified, records: d.verification || [] });
      return;
    }

    res.status(400).json({ error: "ação desconhecida" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 30 };
