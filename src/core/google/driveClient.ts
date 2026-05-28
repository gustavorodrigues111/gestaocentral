// ════════════════════════════════════════════════════════════════════════════
//  Cliente do Google Drive (browser / Google Identity Services)
//
//  Fluxo: carrega o script do GIS sob demanda → pede um access token via popup
//  (escopo drive.file) → usa o token nas chamadas REST do Drive v3.
//
//  O token fica em memória (cachedToken) com expiração; reaproveitamos enquanto
//  válido e só reabrimos o popup quando expira. NÃO persistimos token em lugar
//  nenhum (sem refresh token, sem server) — é o trade-off do fluxo browser.
//
//  Todas as mensagens de erro são em PT-BR pra subir direto na UI.
// ════════════════════════════════════════════════════════════════════════════

import {
  GOOGLE_CLIENT_ID, DRIVE_SCOPE, driveFolderUrl,
  SUBPASTAS_EMPREGADO, PASTA_DOCS_ASSINADOS,
} from "./driveConfig";

// ─── Tipagem mínima do Google Identity Services (sem puxar @types) ──────────
type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};
type TokenClient = {
  callback: (resp: TokenResponse) => void;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};
type GoogleOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => TokenClient;
};
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

// ─── Loader do script GIS (idempotente) ─────────────────────────────────────
const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Google Drive só funciona no navegador."));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Falha ao carregar o Google Identity Services."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

// ─── Gestão do access token (1 request em voo por vez) ──────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms
let tokenClient: TokenClient | null = null;
let currentResolve: ((t: string) => void) | null = null;
let currentReject: ((e: Error) => void) | null = null;

function tokenAindaValido(): boolean {
  // margem de 60s pra não estourar no meio de um upload
  return !!cachedToken && Date.now() < tokenExpiresAt - 60_000;
}

function ensureClient(oauth2: GoogleOAuth2): void {
  if (tokenClient) return;
  tokenClient = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp: TokenResponse) => {
      if (resp.error || !resp.access_token) {
        currentReject?.(
          new Error(
            resp.error_description ||
              resp.error ||
              "Não foi possível obter autorização do Google.",
          ),
        );
      } else {
        cachedToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000;
        currentResolve?.(resp.access_token);
      }
      currentResolve = null;
      currentReject = null;
    },
    error_callback: (err) => {
      currentReject?.(
        new Error(
          err?.message ||
            "Autorização cancelada ou bloqueada (verifique se o popup foi permitido).",
        ),
      );
      currentResolve = null;
      currentReject = null;
    },
  });
}

// Pede (ou reaproveita) um access token do Drive. forceConsent reabre o popup
// pedindo consentimento explícito de novo (ex: trocar de conta).
export async function requestAccessToken(forceConsent = false): Promise<string> {
  if (!forceConsent && tokenAindaValido()) return cachedToken as string;
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services indisponível.");
  ensureClient(oauth2);
  return new Promise<string>((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    tokenClient!.requestAccessToken({ prompt: forceConsent ? "consent" : "" });
  });
}

// True se já temos um token válido em memória (UI mostra "conectado").
export function isDriveConnected(): boolean {
  return tokenAindaValido();
}

// ─── Chamadas REST do Drive v3 ──────────────────────────────────────────────
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export type DriveFile = { id: string; name: string; webViewLink?: string };

async function driveFetch(
  url: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // token provavelmente expirado/revogado — limpa pra forçar reconexão
      cachedToken = null;
      tokenExpiresAt = 0;
    }
    let msg = `Erro do Google Drive (HTTP ${res.status}).`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j?.error?.message) msg = j.error.message;
    } catch {
      /* corpo não-JSON — mantém msg padrão */
    }
    throw new Error(msg);
  }
  return res;
}

// Cria uma pasta no Drive da conta conectada (na raiz). Retorna id + URL.
export async function createDriveFolder(
  name: string,
): Promise<{ id: string; url: string }> {
  const token = await requestAccessToken();
  const res = await driveFetch(
    `${DRIVE_API}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
    token,
  );
  const data = (await res.json()) as { id: string };
  return { id: data.id, url: driveFolderUrl(data.id) };
}

// Sobe um arquivo pra dentro de uma pasta. Faz em 2 passos (metadata + media)
// porque é mais robusto que multipart/related montado na mão.
export async function uploadFileToFolder(
  folderId: string,
  file: File,
): Promise<DriveFile> {
  const token = await requestAccessToken();
  // 1) cria o arquivo (só metadata) dentro da pasta
  const metaRes = await driveFetch(
    `${DRIVE_API}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, parents: [folderId] }),
    },
    token,
  );
  const { id } = (await metaRes.json()) as { id: string };
  // 2) sobe o conteúdo (bytes) pro arquivo recém-criado
  const upRes = await driveFetch(
    `${DRIVE_UPLOAD}/files/${id}?uploadType=media&fields=id,name,webViewLink`,
    {
      method: "PATCH",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
    token,
  );
  return (await upRes.json()) as DriveFile;
}

// Acha (ou cria) uma subpasta por nome dentro de um pai. Como o pai foi
// criado/aberto pelo app (drive.file enxerga), a busca por filhos funciona.
// Evita duplicar a subpasta se o usuário rodar o fluxo duas vezes.
export async function findOrCreateSubfolder(
  parentId: string,
  name: string,
): Promise<string> {
  const token = await requestAccessToken();
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' ` +
      `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id)`,
    { method: "GET" },
    token,
  );
  const data = (await found.json()) as { files?: { id: string }[] };
  if (data.files && data.files.length > 0) return data.files[0].id;
  const created = await driveFetch(
    `${DRIVE_API}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
    token,
  );
  return ((await created.json()) as { id: string }).id;
}

// Cria (ou reaproveita) a árvore de pastas de um empregado dentro de
// "Empregados Ativos": pasta [Nome] + subpastas padrão (1- CONTRATOS,
// 2 - DOCUMENTOS, docs assinados). Retorna o id/URL da pasta do empregado
// e o id da subpasta "docs assinados" (onde sobem os termos assinados).
export async function createEmployeeFolderTree(
  empregadosAtivosFolderId: string,
  nomeCompleto: string,
): Promise<{ folderId: string; folderUrl: string; docsAssinadosFolderId: string }> {
  const folderId = await findOrCreateSubfolder(empregadosAtivosFolderId, nomeCompleto);
  let docsAssinadosFolderId = "";
  // Cria as subpastas em sequência (volume pequeno — 3 itens).
  for (const sub of SUBPASTAS_EMPREGADO) {
    const id = await findOrCreateSubfolder(folderId, sub);
    if (sub === PASTA_DOCS_ASSINADOS) docsAssinadosFolderId = id;
  }
  return { folderId, folderUrl: driveFolderUrl(folderId), docsAssinadosFolderId };
}

// Lista os arquivos (não-pasta, não-lixeira) dentro de uma pasta.
export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const token = await requestAccessToken();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,webViewLink)&orderBy=name`,
    { method: "GET" },
    token,
  );
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}
