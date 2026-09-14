// ════════════════════════════════════════════════════════════════════════════
//  /api/hosted-page — serve o HTML de uma Página hospedada (coleção
//  hostedPages), validando o acesso NO SERVIDOR (o HTML nunca vaza pra quem não
//  pode). Público → devolve. Privado → exige senha correta (hash) OU um token
//  Firebase cujo e-mail esteja na allowlist. Chamado por pages.planejamento.app.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { firestoreConsultarUm } from "./_firestoreRest.js";

const API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, reason: "method" }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    const slug = String(body.slug || "").trim().toLowerCase();
    const idToken = body.idToken ? String(body.idToken) : "";
    const senha = body.senha ? String(body.senha) : "";
    if (!slug) { res.status(400).json({ ok: false, reason: "bad_request" }); return; }

    const doc = await firestoreConsultarUm("hostedPages", "slug", slug);
    if (!doc) { res.status(200).json({ ok: false, reason: "not_found" }); return; }
    const titulo = String(doc.titulo || "");
    if (!doc.ativo) { res.status(200).json({ ok: false, reason: "inactive", titulo }); return; }

    if (doc.visibilidade === "publico") {
      res.status(200).json({ ok: true, html: doc.html, titulo });
      return;
    }

    // Privado — precisa de senha correta OU e-mail autorizado (token válido).
    const emails = Array.isArray(doc.emailsAutorizados) ? doc.emailsAutorizados.map((e) => String(e).toLowerCase()) : [];
    const temSenha = !!doc.senhaHash;

    if (senha && temSenha) {
      const hash = crypto.createHash("sha256").update(`${slug}:${senha}`).digest("hex");
      if (hash === doc.senhaHash) { res.status(200).json({ ok: true, html: doc.html, titulo }); return; }
    }

    if (idToken && emails.length && API_KEY) {
      try {
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
        });
        const j = await r.json() as { users?: Array<{ email?: string }> };
        const email = j?.users?.[0]?.email?.toLowerCase();
        if (email && emails.includes(email)) { res.status(200).json({ ok: true, html: doc.html, titulo }); return; }
      } catch { /* cai no forbidden */ }
    }

    res.status(200).json({ ok: false, reason: "forbidden", titulo, precisa: { email: emails.length > 0, senha: temSenha } });
  } catch (e) {
    res.status(500).json({ ok: false, reason: "error", erro: e instanceof Error ? e.message : "?" });
  }
}
