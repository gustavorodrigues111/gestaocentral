// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-instancia — gerencia a INSTÂNCIA (número) na Evolution direto
//  do planejamento.app, sem abrir o Evolution Manager. Ações:
//    create  → cria a instância (Baileys), aponta o webhook e devolve o QR.
//    connect → (re)gera o QR pra conectar (número desconectado).
//    status  → estado da conexão (open|connecting|close).
//    delete  → apaga a instância na Evolution.
//  Exige Firebase ID token. Env: EVOLUTION_API_URL, EVOLUTION_API_KEY,
//  EVOLUTION_WEBHOOK_TOKEN, APP_URL (opcional, default admin.planejamento.app).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(503).json({ error: "Evolution ainda não configurada (faltam EVOLUTION_API_URL / EVOLUTION_API_KEY nas env vars).", naoConfigurado: true }); return; }
  const webhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN || "";
  const appUrl = (process.env.APP_URL || "https://admin.planejamento.app").replace(/\/+$/, "");

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { acao?: string; instancia?: string } | null;
  const acao = (body?.acao || "").toString();
  const instancia = (body?.instancia || "").toString().trim();
  if (!instancia) { res.status(400).json({ error: "Informe a instância." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  const H = { apikey: key, "Content-Type": "application/json" };
  const call = async (path: string, method: string, payload?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: H, body: payload ? JSON.stringify(payload) : undefined, signal: ctrl.signal });
    const t = await r.text();
    return { ok: r.ok, status: r.status, json: safeParse(t), raw: t };
  };
  const setWebhook = () => call(`/webhook/set/${encodeURIComponent(instancia)}`, "POST", {
    webhook: { enabled: true, url: `${appUrl}/api/evolution-webhook?token=${encodeURIComponent(webhookToken)}`, webhookByEvents: false, webhookBase64: false, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"] },
  });

  try {
    if (acao === "create") {
      const r = await call("/instance/create", "POST", { instanceName: instancia, qrcode: true, integration: "WHATSAPP-BAILEYS" });
      if (!r.ok && r.status !== 403 && r.status !== 409) { res.status(502).json({ error: `Evolution HTTP ${r.status}. ${String(r.raw).slice(0, 300)}` }); return; }
      await setWebhook().catch(() => {});
      const j = r.json as { qrcode?: { base64?: string; code?: string } } | null;
      let qr = j?.qrcode?.base64 || null;
      if (!qr) { const c = await call(`/instance/connect/${encodeURIComponent(instancia)}`, "GET"); qr = (c.json as { base64?: string })?.base64 || null; }
      res.status(200).json({ ok: true, qr, jaExistia: r.status === 403 || r.status === 409 });
      return;
    }
    if (acao === "connect") {
      await setWebhook().catch(() => {});
      const c = await call(`/instance/connect/${encodeURIComponent(instancia)}`, "GET");
      const qr = (c.json as { base64?: string })?.base64 || null;
      res.status(200).json({ ok: true, qr });
      return;
    }
    if (acao === "webhook") {   // só reaponta o webhook (recebimento), sem mexer na sessão
      const w = await setWebhook();
      res.status(w.ok ? 200 : 502).json({ ok: w.ok, ...(w.ok ? {} : { error: `Evolution HTTP ${w.status}. ${String(w.raw).slice(0, 200)}` }) });
      return;
    }
    if (acao === "restart") {   // reinicia o socket (reconecta com a sessão salva, SEM novo QR) + reaponta webhook
      await setWebhook().catch(() => {});
      const r = await call(`/instance/restart/${encodeURIComponent(instancia)}`, "POST");
      const c = await call(`/instance/connectionState/${encodeURIComponent(instancia)}`, "GET");
      const estado = (c.json as { instance?: { state?: string }; state?: string })?.instance?.state || (c.json as { state?: string })?.state || "unknown";
      res.status(200).json({ ok: r.ok, estado });
      return;
    }
    if (acao === "status") {
      const c = await call(`/instance/connectionState/${encodeURIComponent(instancia)}`, "GET");
      const estado = (c.json as { instance?: { state?: string }; state?: string })?.instance?.state || (c.json as { state?: string })?.state || "unknown";
      res.status(200).json({ ok: true, estado });
      return;
    }
    if (acao === "logout") {   // desconecta o WhatsApp mas mantém a instância
      const d = await call(`/instance/logout/${encodeURIComponent(instancia)}`, "DELETE");
      res.status(200).json({ ok: d.ok });
      return;
    }
    if (acao === "delete") {
      await call(`/instance/logout/${encodeURIComponent(instancia)}`, "DELETE").catch(() => {});
      const d = await call(`/instance/delete/${encodeURIComponent(instancia)}`, "DELETE");
      res.status(200).json({ ok: d.ok });
      return;
    }
    res.status(400).json({ error: "Ação inválida." });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao falar com a Evolution." : (e instanceof Error ? e.message : "Falha.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
