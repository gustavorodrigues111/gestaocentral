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

// Move uma pasta pra dentro de outro pai (id não muda). name opcional renomeia.
export async function centralMoveFolder(folderId: string, newParentId: string, name?: string): Promise<void> {
  await post("moveFolder", { folderId, newParentId, ...(name ? { name } : {}) });
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

// File → base64 (sem prefixo data:).
function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

// Prepara o arquivo p/ subir pelo backend: imagens são redimensionadas (canvas)
// pra caber no limite de payload da serverless (~4,5 MB) mantendo legibilidade.
// PDFs vão como estão (com aviso se muito grandes).
async function prepararArquivo(file: File): Promise<{ data: string; mimeType: string }> {
  if (file.type.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxLado = 2200; // legível pra arquivo da nota e leve o suficiente
      const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * escala));
      const h = Math.max(1, Math.round(bitmap.height * escala));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const b64 = dataUrl.split(",")[1] || "";
        if (b64) return { data: b64, mimeType: "image/jpeg" };
      }
    } catch { /* fallback abaixo */ }
  }
  const data = await fileToBase64(file);
  // ~4,5 MB de payload; base64 infla ~33%. Avisa se passar do limite seguro.
  if (data.length > 5_600_000) {
    throw new Error("Arquivo grande demais pra subir (máx ~4 MB). Reduza o PDF ou envie como foto.");
  }
  return { data, mimeType: file.type || "application/octet-stream" };
}

// Sobe um arquivo pela conta central (via backend, multipart — sem CORS).
export async function centralUpload(parentId: string, file: File): Promise<{ id: string; webViewLink?: string; name: string }> {
  const { data, mimeType } = await prepararArquivo(file);
  const j = await post<{ id: string; name?: string; webViewLink?: string }>("uploadFile", {
    parentId, name: file.name, mimeType, data,
  });
  return { id: j.id, name: j.name || file.name, ...(j.webViewLink ? { webViewLink: j.webViewLink } : {}) };
}
