// ════════════════════════════════════════════════════════════════════════════
//  /api/audio-transcrever — transcreve um ARQUIVO de áudio (ex.: áudio do
//  WhatsApp) em texto, via Google Cloud Speech-to-Text (REST, por API key).
//  Recebe base64 + mimeType. Exige Firebase ID token.
//
//  Ativação: setar GOOGLE_STT_KEY nas env vars da Vercel (API key com a
//  Cloud Speech-to-Text API habilitada). Sem ela, retorna erro claro.
//  Limite do recognize síncrono: ~1 min de áudio / 10 MB.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };
const STT_URL = "https://speech.googleapis.com/v1/speech:recognize";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

// Mapeia o mime/extensão pro encoding + sample rate que o Google espera.
function encodingDe(mime: string): { encoding?: string; sampleRateHertz?: number } {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return { encoding: "OGG_OPUS", sampleRateHertz: 48000 };
  if (m.includes("webm")) return { encoding: "WEBM_OPUS", sampleRateHertz: 48000 };
  if (m.includes("mpeg") || m.includes("mp3")) return { encoding: "MP3", sampleRateHertz: 44100 };
  if (m.includes("wav") || m.includes("x-wav") || m.includes("linear")) return { encoding: "LINEAR16", sampleRateHertz: 16000 };
  if (m.includes("flac")) return { encoding: "FLAC" };
  if (m.includes("amr")) return { encoding: "AMR", sampleRateHertz: 8000 };
  // m4a/aac e afins: o recognize síncrono não suporta bem — tenta OGG_OPUS como fallback.
  return { encoding: "OGG_OPUS", sampleRateHertz: 48000 };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.GOOGLE_STT_KEY;
  if (!key) { res.status(503).json({ error: "Transcrição de áudio ainda não ativada: falta GOOGLE_STT_KEY nas env vars da Vercel (API key com a Cloud Speech-to-Text API habilitada)." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { audioBase64?: string; mimeType?: string } | null;
  const audioBase64 = (body?.audioBase64 || "").toString();
  const mimeType = (body?.mimeType || "").toString();
  if (!audioBase64 || audioBase64.length < 20) { res.status(400).json({ error: "Áudio vazio." }); return; }
  if (audioBase64.length > 14 * 1024 * 1024) { res.status(413).json({ error: "Áudio muito grande (máx ~10 MB). Use um trecho menor." }); return; }

  const enc = encodingDe(mimeType);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = {
      config: {
        languageCode: "pt-BR",
        enableAutomaticPunctuation: true,
        ...(enc.encoding ? { encoding: enc.encoding } : {}),
        ...(enc.sampleRateHertz ? { sampleRateHertz: enc.sampleRateHertz } : {}),
      },
      audio: { content: audioBase64 },
    };
    const resp = await fetch(`${STT_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Google STT HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    const texto = (json.results || []).map((r) => r.alternatives?.[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim();
    if (!texto) { res.status(200).json({ texto: "", aviso: "Não consegui entender o áudio. Tente um áudio mais claro ou digite." }); return; }
    res.status(200).json({ texto });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao transcrever.` : (e instanceof Error ? e.message : "Falha ao transcrever o áudio.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
