// ════════════════════════════════════════════════════════════════════════════
//  Cliente da CONTA CENTRAL do Drive (via /api/drive-recebimento).
//
//  Quando configurada (env vars na Vercel), os arquivos de recebimento sobem
//  pela conta central — o operador NÃO conecta o próprio Drive. O backend
//  inicia a sessão de upload e o navegador faz o PUT direto no Google (sem
//  passar pelo limite de payload da serverless).
//
//  Se não estiver configurada, `centralConfigured()` devolve false e o módulo
//  cai no fluxo antigo (OAuth no navegador).
// ════════════════════════════════════════════════════════════════════════════
import { authHeader } from "../firebase/idToken";

async function post<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const resp = await fetch("/api/drive-recebimento", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action, ...extra }),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((j as { error?: string }).error || `Falha no Drive central (HTTP ${resp.status}).`);
  return j as T;
}

let statusCache: boolean | null = null;
export async function centralConfigured(): Promise<boolean> {
  if (statusCache !== null) return statusCache;
  try {
    const { configured } = await post<{ configured: boolean }>("status");
    statusCache = !!configured;
  } catch {
    statusCache = false;
  }
  return statusCache;
}

export async function centralEnsureRoot(nome: string): Promise<{ folderId: string; folderUrl: string }> {
  return post("ensureRoot", { nome });
}

// Pasta de topo genérica (ex: "Empregados Ativos — X").
export async function centralEnsureTopFolder(topName: string): Promise<{ folderId: string; folderUrl: string }> {
  return post("ensureTopFolder", { topName });
}

export async function centralEnsureWeek(parentId: string, weekLabel: string): Promise<string> {
  const { subfolderId } = await post<{ subfolderId: string }>("ensureWeek", { parentId, weekLabel });
  return subfolderId;
}

// Subpasta por nome dentro de um pai (genérico).
export async function centralEnsureFolder(parentId: string, name: string): Promise<string> {
  const { folderId } = await post<{ folderId: string }>("ensureFolder", { parentId, name });
  return folderId;
}

// Baixa um arquivo (base64) pela conta central — pra reenviar a outro serviço.
export async function centralDownloadBase64(fileId: string): Promise<string> {
  const { base64 } = await post<{ base64: string }>("download", { fileId });
  return base64;
}

// Lista arquivos de uma pasta pela conta central.
export async function centralListFolder(folderId: string): Promise<Array<{ id: string; name: string; webViewLink?: string }>> {
  const { files } = await post<{ files: Array<{ id: string; name: string; webViewLink?: string }> }>("listFolder", { folderId });
  return files;
}

// Move uma pasta pra dentro de outro pai (id não muda).
export async function centralMoveFolder(folderId: string, newParentId: string): Promise<void> {
  await post("moveFolder", { folderId, newParentId });
}

// Extrai o id de uma pasta a partir de um link do Drive ou de um id cru.
export function parseDriveFolderId(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\/folders\/([-\w]{10,})/) || s.match(/[?&]id=([-\w]{10,})/);
  if (m) return m[1];
  if (/^[-\w]{10,}$/.test(s)) return s; // já é um id
  return null;
}

// Sobe um arquivo pela conta central: inicia a sessão resumable no backend e
// faz o PUT dos bytes direto no Google. Devolve id + link do arquivo.
export async function centralUpload(parentId: string, file: File): Promise<{ id: string; webViewLink?: string; name: string }> {
  const { uploadUrl } = await post<{ uploadUrl: string }>("initUpload", {
    parentId, name: file.name, mimeType: file.type || "application/octet-stream",
  });
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) {
    const txt = await put.text().catch(() => "");
    throw new Error(`Falha ao enviar o arquivo pro Drive (HTTP ${put.status}). ${txt.slice(0, 200)}`);
  }
  const j = (await put.json()) as { id: string; name?: string; webViewLink?: string };
  return { id: j.id, name: j.name || file.name, ...(j.webViewLink ? { webViewLink: j.webViewLink } : {}) };
}
