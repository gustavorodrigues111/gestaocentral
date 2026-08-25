// ════════════════════════════════════════════════════════════════════════════
//  /api/admissao-submit — envio da ficha do candidato PELO SERVIDOR.
//  O candidato (sem login) manda { admissaoId, token, ... }. O servidor lê o doc,
//  CONFERE o token, sobe a foto pro Storage (não embute base64 no doc) e grava só
//  os campos permitidos via Firestore REST (ADC, bypassa as regras). Substitui a
//  gravação direta do navegador — que dependia de uma regra pública frágil.
// ════════════════════════════════════════════════════════════════════════════
import { firestoreLer, firestoreAtualizar, subirStorage, firestoreDisponivel } from "./_firestoreRest.js";

export const config = { maxDuration: 60 };

type VercelReq = { method?: string; body?: unknown };
type VercelRes = { status: (c: number) => VercelRes; json: (b: unknown) => void };
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  if (!firestoreDisponivel()) { res.status(500).json({ error: "Servidor sem credenciais Firestore (ADC)." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as {
    admissaoId?: string; token?: string; final?: boolean;
    dadosPreenchidos?: Record<string, unknown>; documentos?: unknown; subtarefas?: unknown[];
    dadosBancariosItau?: unknown; validacao?: Record<string, unknown>; selfieBase64?: string;
  } | null;

  const admissaoId = String(body?.admissaoId || "").trim();
  const token = String(body?.token || "").trim();
  const final = body?.final === true;
  if (!admissaoId || !token) { res.status(400).json({ error: "admissaoId e token são obrigatórios." }); return; }

  let adm: Record<string, unknown> | null;
  try { adm = await firestoreLer("admissoes", admissaoId); }
  catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao ler a admissão." }); return; }
  if (!adm) { res.status(404).json({ error: "Admissão não encontrada." }); return; }
  if (String(adm.token || "") !== token) { res.status(403).json({ error: "Token inválido." }); return; }
  const status = String(adm.status || "");
  if (status !== "formulario_enviado" && status !== "formulario_preenchido") {
    res.status(409).json({ error: "Este formulário não está mais aberto para envio. Fale com a equipe que cuida da sua admissão." });
    return;
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (body?.dadosPreenchidos && typeof body.dadosPreenchidos === "object") patch.dadosPreenchidos = body.dadosPreenchidos;

  let selfieUrl: string | null = null;
  if (final) {
    if (body?.documentos) patch.documentos = body.documentos;
    if (body?.dadosBancariosItau) patch.dadosBancariosItau = body.dadosBancariosItau;
    if (Array.isArray(body?.subtarefas)) patch.subtarefas = body.subtarefas;

    const val: Record<string, unknown> = { ...(body?.validacao && typeof body.validacao === "object" ? body.validacao : {}) };
    delete val.selfieDataUrl; // nunca embute base64 no doc
    const selfie = String(body?.selfieBase64 || "");
    if (selfie) {
      const m = selfie.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
      const mime = m ? m[1] : "image/jpeg";
      const raw = m ? m[2] : selfie;
      const rid = String(adm.restaurantId || "");
      const path = `admissoes/${rid}/${admissaoId}/selfie_${Date.now()}.jpg`;
      try { selfieUrl = await subirStorage(path, raw, mime); } catch { selfieUrl = null; }
      if (selfieUrl) { val.selfieUrl = selfieUrl; val.selfiePath = path; }
    }
    patch.validacao = val;
    patch.status = "formulario_preenchido";
    patch.preenchidoEm = now;
  }

  try { await firestoreAtualizar("admissoes", admissaoId, patch); }
  catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao salvar." }); return; }

  res.status(200).json({ ok: true, selfieUrl });
}
