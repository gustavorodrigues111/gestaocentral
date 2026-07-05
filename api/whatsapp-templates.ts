// ════════════════════════════════════════════════════════════════════════════
//  /api/whatsapp-templates — gerencia os modelos (templates) do WhatsApp pela
//  API da Meta, pra ter uma tela no app em vez de depender do WhatsApp Manager.
//
//   GET               → lista os templates (nome, status, categoria, corpo)
//   POST {name,...}    → cria/submete um template novo (categoria UTILITY/MARKETING)
//   DELETE ?name=…     → exclui um template
//
//  Só usuário logado (requireUser). Env: WHATSAPP_TOKEN, WHATSAPP_WABA_ID,
//  WHATSAPP_API_VERSION (default v21.0).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

type Req = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (c: number) => Res; json: (b: unknown) => void };

const VER = process.env.WHATSAPP_API_VERSION || "v21.0";
const WABA = process.env.WHATSAPP_WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const base = () => `https://graph.facebook.com/${VER}/${WABA}/message_templates`;

export default async function handler(req: Req, res: Res): Promise<void> {
  try { await requireUser(req); } catch (e) { const st = e instanceof AuthError ? e.status : 401; res.status(st).json({ error: (e as Error).message }); return; }
  if (!WABA || !TOKEN) { res.status(503).json({ naoConfigurado: true, error: "WhatsApp não configurado (WABA/token)." }); return; }

  try {
    // ── Listar ──
    if (req.method === "GET") {
      const url = `${base()}?fields=name,status,category,language,components,quality_score,rejected_reason&limit=200&access_token=${TOKEN}`;
      const r = await fetch(url);
      const j = (await r.json()) as { data?: unknown[]; error?: { message?: string } };
      if (!r.ok) { res.status(502).json({ error: j.error?.message || "Falha ao listar." }); return; }
      res.status(200).json({ templates: j.data || [] });
      return;
    }

    // ── Criar ──
    if (req.method === "POST") {
      const b = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as
        { name?: string; category?: string; language?: string; bodyText?: string; examples?: string[] } | null;
      const name = (b?.name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const bodyText = (b?.bodyText || "").trim();
      if (!name) { res.status(400).json({ error: "Informe um nome." }); return; }
      if (!bodyText) { res.status(400).json({ error: "Informe o corpo da mensagem." }); return; }
      const nVars = (bodyText.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
      const examples = Array.isArray(b?.examples) ? b!.examples!.slice(0, nVars).map(x => String(x || "exemplo")) : [];
      while (examples.length < nVars) examples.push("exemplo");
      const bodyComp: Record<string, unknown> = { type: "BODY", text: bodyText };
      if (nVars > 0) bodyComp.example = { body_text: [examples] };
      const payload = { name, language: b?.language || "pt_BR", category: (b?.category || "UTILITY").toUpperCase(), components: [bodyComp] };
      const r = await fetch(`${base()}?access_token=${TOKEN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = (await r.json()) as { id?: string; status?: string; error?: { error_user_msg?: string; message?: string } };
      if (!r.ok || !j.id) { res.status(400).json({ error: j.error?.error_user_msg || j.error?.message || "Falha ao criar template." }); return; }
      res.status(200).json({ ok: true, id: j.id, status: j.status });
      return;
    }

    // ── Excluir ──
    if (req.method === "DELETE") {
      const name = String(req.query?.name || "");
      if (!name) { res.status(400).json({ error: "Informe name." }); return; }
      const r = await fetch(`${base()}?name=${encodeURIComponent(name)}&access_token=${TOKEN}`, { method: "DELETE" });
      const j = (await r.json()) as { success?: boolean; error?: { message?: string } };
      if (!r.ok) { res.status(400).json({ error: j.error?.message || "Falha ao excluir." }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Método não suportado." });
  } catch (e) {
    res.status(500).json({ error: (e as Error)?.message || "Erro." });
  }
}
