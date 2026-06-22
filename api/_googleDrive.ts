// ════════════════════════════════════════════════════════════════════════════
//  Google Drive pela CONTA CENTRAL (server-side) — sem o navegador do operador.
//
//  Usa um refresh token de UMA conta Google (Workspace) guardado em env var pra
//  mintar access tokens e arquivar as notas de recebimento. Assim qualquer
//  operador com permissão "receber" sobe nota sem conectar o próprio Drive.
//
//  Os BYTES dos arquivos NÃO passam por aqui (limite de 4,5 MB da Vercel): o
//  backend só inicia uma sessão de upload "resumable" e devolve a URL; o
//  navegador faz o PUT direto no Google. Credenciais ficam 100% no servidor.
//
//  Env vars necessárias (Vercel):
//    GOOGLE_OAUTH_CLIENT_ID      — client id de um OAuth Web client
//    GOOGLE_OAUTH_CLIENT_SECRET  — client secret desse client
//    GOOGLE_DRIVE_REFRESH_TOKEN  — refresh token da conta central (scope drive)
//    GOOGLE_DRIVE_RECEBIMENTOS_ROOT (opcional) — id da pasta/Shared Drive raiz
//
//  Prefixo "_" → a Vercel não expõe como rota.
// ════════════════════════════════════════════════════════════════════════════

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
// supportsAllDrives cobre My Drive e Shared Drives (Workspace).
const ALL_DRIVES = "supportsAllDrives=true";

export function isCentralConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
}

// Cache do access token em memória do lambda (vale enquanto o container vive).
let tokenCache: { token: string; exp: number } | null = null;

export async function getCentralAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "",
    grant_type: "refresh_token",
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Falha ao renovar token do Drive central (HTTP ${resp.status}). ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Resposta do Google sem access_token.");
  tokenCache = { token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function driveFetch(url: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let msg = `Erro do Google Drive (HTTP ${res.status}).`;
    try { const j = (await res.json()) as { error?: { message?: string } }; if (j?.error?.message) msg = j.error.message; } catch { /* ignora */ }
    throw new Error(msg);
  }
  return res;
}

// Acha (ou cria) uma subpasta por nome dentro de um pai. Idempotente.
export async function ensureSubfolder(parentId: string, name: string, token: string): Promise<{ id: string }> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id)&includeItemsFromAllDrives=true&${ALL_DRIVES}`,
    { method: "GET" }, token,
  );
  const data = (await found.json()) as { files?: { id: string }[] };
  if (data.files && data.files.length > 0) return { id: data.files[0].id };
  const meta: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] };
  const created = await driveFetch(
    `${DRIVE_API}/files?fields=id&${ALL_DRIVES}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) }, token,
  );
  return { id: ((await created.json()) as { id: string }).id };
}

// Pasta de topo (dentro do ROOT opcional ou My Drive). Genérico — usado pra
// "Recebimentos — X" e "Empregados Ativos — X".
export async function ensureTopFolder(name: string, token: string): Promise<{ id: string; url: string }> {
  const root = process.env.GOOGLE_DRIVE_RECEBIMENTOS_ROOT;
  const parentId = root || "root";
  const { id } = await ensureSubfolder(parentId, name.trim(), token);
  return { id, url: `https://drive.google.com/drive/folders/${id}` };
}

// Baixa um arquivo como base64 (pra reenviar a outro serviço, ex: Clicksign).
export async function downloadFileBase64(fileId: string, token: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`, { method: "GET" }, token);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

// Lista arquivos (não-pasta, não-lixeira) dentro de uma pasta.
export async function listFolder(folderId: string, token: string): Promise<Array<{ id: string; name: string; webViewLink?: string }>> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,webViewLink)&orderBy=name&includeItemsFromAllDrives=true&${ALL_DRIVES}`,
    { method: "GET" }, token,
  );
  const data = (await res.json()) as { files?: Array<{ id: string; name: string; webViewLink?: string }> };
  return data.files ?? [];
}

// Inicia um upload resumable e devolve a URL de sessão (pro browser dar PUT).
export async function initResumableUpload(parentId: string, name: string, mimeType: string, token: string): Promise<string> {
  const meta = { name, parents: [parentId] };
  const resp = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,webViewLink&${ALL_DRIVES}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(meta),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha ao iniciar upload (HTTP ${resp.status}). ${txt.slice(0, 200)}`);
  }
  const location = resp.headers.get("location") || resp.headers.get("Location");
  if (!location) throw new Error("Google não devolveu a URL de upload (location).");
  return location;
}
