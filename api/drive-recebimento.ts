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
import { isCentralConfigured, getCentralAccessToken, ensureTopFolder, ensureSubfolder, initResumableUpload, uploadMultipart, downloadFileBase64, listFolder, moveFolder } from "./_googleDrive.js";

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

// Upload multipart de vários MB + chamadas ao Google Drive levam mais que o
// default da Vercel (~15s) — sem isto a função morria e o save "travava".
export const config = { maxDuration: 60 };

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const body = (req.body || {}) as { action?: string; nome?: string; topName?: string; parentId?: string; weekLabel?: string; name?: string; mimeType?: string; data?: string; fileId?: string; folderId?: string; newParentId?: string };
  const action = String(body.action || "");

  // status não exige config — serve justamente pra avisar que falta.
  if (action === "status") { res.status(200).json({ configured: isCentralConfigured() }); return; }

  if (!isCentralConfigured()) {
    res.status(503).json({ error: "Conta central do Drive não configurada (faltam env vars na Vercel).", configured: false });
    return;
  }

  try {
    const token = await getCentralAccessToken();
    // ensureRoot: pasta de topo do recebimento ("Recebimentos — <nome>").
    if (action === "ensureRoot") {
      const r = await ensureTopFolder(`Recebimentos — ${String(body.nome || "Restaurante")}`, token);
      res.status(200).json({ folderId: r.id, folderUrl: r.url });
      return;
    }
    // ensureTopFolder: pasta de topo genérica (ex: "Empregados Ativos — <nome>").
    if (action === "ensureTopFolder") {
      if (!body.topName) { res.status(400).json({ error: "Falta topName." }); return; }
      const r = await ensureTopFolder(String(body.topName), token);
      res.status(200).json({ folderId: r.id, folderUrl: r.url });
      return;
    }
    // ensureWeek / ensureFolder: subpasta por nome dentro de um pai.
    if (action === "ensureWeek" || action === "ensureFolder") {
      const nome = body.weekLabel || body.name;
      if (!body.parentId || !nome) { res.status(400).json({ error: "Faltam parentId/nome." }); return; }
      const sub = await ensureSubfolder(body.parentId, String(nome), token);
      res.status(200).json({ subfolderId: sub.id, folderId: sub.id });
      return;
    }
    if (action === "initUpload") {
      if (!body.parentId || !body.name) { res.status(400).json({ error: "Faltam parentId/name." }); return; }
      const uploadUrl = await initResumableUpload(body.parentId, body.name, String(body.mimeType || "application/octet-stream"), token);
      res.status(200).json({ uploadUrl });
      return;
    }
    if (action === "uploadFile") {
      if (!body.parentId || !body.name || !body.data) { res.status(400).json({ error: "Faltam parentId/name/data." }); return; }
      const f = await uploadMultipart(body.parentId, body.name, String(body.mimeType || "application/octet-stream"), body.data, token);
      res.status(200).json(f);
      return;
    }
    if (action === "download") {
      if (!body.fileId) { res.status(400).json({ error: "Falta fileId." }); return; }
      const base64 = await downloadFileBase64(String(body.fileId), token);
      res.status(200).json({ base64 });
      return;
    }
    if (action === "listFolder") {
      if (!body.folderId) { res.status(400).json({ error: "Falta folderId." }); return; }
      const files = await listFolder(String(body.folderId), token);
      res.status(200).json({ files });
      return;
    }
    if (action === "moveFolder") {
      if (!body.folderId || !body.newParentId) { res.status(400).json({ error: "Faltam folderId/newParentId." }); return; }
      await moveFolder(String(body.folderId), String(body.newParentId), token, body.name ? String(body.name) : undefined);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: `Ação desconhecida: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro no Drive central." });
  }
}
