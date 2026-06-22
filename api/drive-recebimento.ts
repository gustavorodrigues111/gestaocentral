// ════════════════════════════════════════════════════════════════════════════
//  /api/drive-recebimento — arquiva notas de recebimento pela CONTA CENTRAL.
//
//  Ações (POST { action, ... }):
//    status     → { configured }  (o front decide central × navegador)
//    ensureRoot → { folderId, folderUrl }   (pasta do restaurante)
//    ensureWeek → { subfolderId }            (subpasta da semana)
//    initUpload → { uploadUrl }              (sessão resumable p/ o browser)
//
//  Exige usuário logado (Firebase ID token). Bytes não passam por aqui.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";
import { isCentralConfigured, getCentralAccessToken, ensureRestaurantFolder, ensureSubfolder, initResumableUpload } from "./_googleDrive.js";

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const body = (req.body || {}) as { action?: string; nome?: string; parentId?: string; weekLabel?: string; name?: string; mimeType?: string };
  const action = String(body.action || "");

  // status não exige config — serve justamente pra avisar que falta.
  if (action === "status") { res.status(200).json({ configured: isCentralConfigured() }); return; }

  if (!isCentralConfigured()) {
    res.status(503).json({ error: "Conta central do Drive não configurada (faltam env vars na Vercel).", configured: false });
    return;
  }

  try {
    const token = await getCentralAccessToken();
    if (action === "ensureRoot") {
      const r = await ensureRestaurantFolder(String(body.nome || "Restaurante"), token);
      res.status(200).json({ folderId: r.id, folderUrl: r.url });
      return;
    }
    if (action === "ensureWeek") {
      if (!body.parentId || !body.weekLabel) { res.status(400).json({ error: "Faltam parentId/weekLabel." }); return; }
      const sub = await ensureSubfolder(body.parentId, body.weekLabel, token);
      res.status(200).json({ subfolderId: sub.id });
      return;
    }
    if (action === "initUpload") {
      if (!body.parentId || !body.name) { res.status(400).json({ error: "Faltam parentId/name." }); return; }
      const uploadUrl = await initResumableUpload(body.parentId, body.name, String(body.mimeType || "application/octet-stream"), token);
      res.status(200).json({ uploadUrl });
      return;
    }
    res.status(400).json({ error: `Ação desconhecida: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro no Drive central." });
  }
}
