// ════════════════════════════════════════════════════════════════════════════
//  /api/audio-transcrever — transcreve um ARQUIVO de áudio (ex.: áudio do
//  WhatsApp) em texto, via Google Gemini (áudio nativo). Recebe base64 + mime.
//  Exige Firebase ID token.
//
//  Ativação: setar GEMINI_API_KEY nas env vars da Vercel (chave do Google AI
//  Studio — https://aistudio.google.com/apikey). Sem ela, retorna erro claro.
//  Vantagem sobre o Speech-to-Text síncrono: aceita áudios longos (minutos) e
//  mais formatos (ogg/opus do WhatsApp, m4a, mp3, wav…).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };
const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

// Normaliza o mime pro que o Gemini aceita em inline_data de áudio.
function mimeAudio(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("audio/")) {
    if (m.includes("ogg") || m.includes("opus")) return "audio/ogg";
    if (m.includes("mpeg") || m.includes("mp3")) return "audio/mp3";
    if (m.includes("wav") || m.includes("x-wav")) return "audio/wav";
    if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "audio/mp4";
    if (m.includes("flac")) return "audio/flac";
    if (m.includes("webm")) return "audio/webm";
    return m;
  }
  return "audio/ogg";
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(503).json({ error: "Transcrição de áudio ainda não ativada: falta GEMINI_API_KEY nas env vars da Vercel (chave do Google AI Studio)." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { audioBase64?: string; mimeType?: string } | null;
  const audioBase64 = (body?.audioBase64 || "").toString();
  const mimeType = mimeAudio((body?.mimeType || "").toString());
  if (!audioBase64 || audioBase64.length < 20) { res.status(400).json({ error: "Áudio vazio." }); return; }
  if (audioBase64.length > 27 * 1024 * 1024) { res.status(413).json({ error: "Áudio muito grande (máx ~20 MB). Use um trecho menor." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = {
      contents: [{ parts: [
        { text: "Transcreva EXATAMENTE o que é falado neste áudio, em português do Brasil. Responda SOMENTE a transcrição, sem comentários, sem aspas, sem rótulos." },
        { inline_data: { mime_type: mimeType, data: audioBase64 } },
      ] }],
      generationConfig: { temperature: 0 },
    };
    const resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Gemini HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const texto = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(" ").replace(/\s+/g, " ").trim();
    if (!texto) { res.status(200).json({ texto: "", aviso: "Não consegui entender o áudio. Tente um áudio mais claro ou digite." }); return; }
    res.status(200).json({ texto });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao transcrever.` : (e instanceof Error ? e.message : "Falha ao transcrever o áudio.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
