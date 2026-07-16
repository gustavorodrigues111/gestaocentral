// ════════════════════════════════════════════════════════════════════════════
//  /api/reportar-falha — Monitor de falhas. Recebe um erro (de página pública
//  anônima OU de ação interna crítica), (1) grava em falhasLog via usuário de
//  serviço (não precisa abrir escrita anônima nas rules) e (2) dispara um email
//  de alerta pro master. Best-effort: nunca derruba o fluxo de quem reportou.
//
//  POST /api/reportar-falha
//    body: { modulo, mensagem, codigo?, url?, userAgent?, restaurantId?,
//            restauranteNome?, contexto?, pessoaNome? }
//    → 200 { ok: true, id }
//
//  Env: RESEND_API_KEY, RESEND_FROM_DEFAULT (email); ALERT_EMAIL (destino do
//  alerta, fallback gustavo@quibebe.com.br); credenciais do _firestoreRest.
// ════════════════════════════════════════════════════════════════════════════
import { firestoreCriar, firestoreDisponivel } from "./_firestoreRest.js";

export const config = { maxDuration: 15 };

const RESEND_API = "https://api.resend.com/emails";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "gustavo@quibebe.com.br";

type VercelReq = { method?: string; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "Body ausente." }); return; }

  const modulo = clip(body.modulo, 80) || "desconhecido";
  const mensagem = clip(body.mensagem, 800) || "erro sem mensagem";
  const codigo = clip(body.codigo, 120);
  const url = clip(body.url, 500);
  const userAgent = clip(body.userAgent, 400);
  const restaurantId = clip(body.restaurantId, 120);
  const restauranteNome = clip(body.restauranteNome, 160);
  const contexto = clip(body.contexto, 1500);
  const pessoaNome = clip(body.pessoaNome, 160);
  const criadoEm = new Date().toISOString();
  const id = `falha_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // (1) Persiste no Firestore (best-effort — se creds do serviço faltarem, só pula)
  let gravou = false;
  if (firestoreDisponivel()) {
    try {
      await firestoreCriar("falhasLog", id, {
        modulo, mensagem, codigo: codigo || undefined, url: url || undefined,
        userAgent: userAgent || undefined, restaurantId: restaurantId || undefined,
        restauranteNome: restauranteNome || undefined, contexto: contexto || undefined,
        pessoaNome: pessoaNome || undefined, criadoEm,
      });
      gravou = true;
    } catch (e) { console.error("reportar-falha: falha ao gravar", e); }
  }

  // (2) Email de alerta (best-effort)
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_DEFAULT || "onboarding@resend.dev";
  if (apiKey) {
    try {
      const linhas = [
        ["Módulo", modulo], ["Mensagem", mensagem], ["Código", codigo],
        ["Onde", restauranteNome || restaurantId], ["Quem", pessoaNome],
        ["URL", url], ["Contexto", contexto], ["Quando", criadoEm], ["Navegador", userAgent],
      ].filter(([, v]) => v);
      const html =
        `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">` +
        `<h2 style="margin:0 0 12px">🚨 Falha em ${esc(modulo)}</h2>` +
        `<table style="border-collapse:collapse">${linhas.map(([k, v]) =>
          `<tr><td style="padding:3px 10px 3px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
          `<td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>` +
        `<p style="color:#999;margin-top:14px;font-size:12px">Alerta automático do Monitor de Falhas · planejamento.app</p></div>`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      await fetch(RESEND_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [ALERT_EMAIL], subject: `🚨 Falha em ${modulo}${codigo ? ` (${codigo})` : ""}`, html }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
    } catch (e) { console.error("reportar-falha: falha ao emailar", e); }
  }

  res.status(200).json({ ok: true, id, gravou });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
