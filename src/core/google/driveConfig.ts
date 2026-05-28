// ════════════════════════════════════════════════════════════════════════════
//  Config da integração com o Google Drive (fluxo browser / GIS token client)
//
//  Usa o Google Identity Services (GIS) NO NAVEGADOR com o escopo `drive.file`
//  — o app só enxerga arquivos/pastas que ele mesmo cria. Vantagens:
//    • não precisa de Client Secret (fica tudo no browser);
//    • não precisa de endpoint server-side;
//    • o token vive em memória e expira em ~1h (o usuário reconecta quando
//      precisar, via popup do Google).
//
//  O CLIENT_ID do OAuth NÃO é segredo — ele aparece no fluxo de login dentro
//  do próprio navegador. Por isso pode ficar versionado aqui como fallback.
//  Pode ser sobrescrito por VITE_GOOGLE_CLIENT_ID (ex: outro projeto em
//  staging) sem recompilar a lógica.
// ════════════════════════════════════════════════════════════════════════════

// Client ID público do cliente OAuth "planejamento.app - Google Drive"
// (projeto gestaocentral-85b13). Identificador público → seguro versionar.
const FALLBACK_CLIENT_ID =
  "777358299957-gt4i8n0q6ohkee4jrbddeugem7od0u1q.apps.googleusercontent.com";

export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ||
  FALLBACK_CLIENT_ID;

// Escopo mínimo: acesso só aos arquivos/pastas criados por este app.
// Não dá acesso ao resto do Drive da pessoa.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// True se temos um Client ID com cara de válido. Usado pra "gate" a UI:
// se não estiver configurado, os botões de Drive nem aparecem.
export function isDriveConfigured(): boolean {
  return (
    !!GOOGLE_CLIENT_ID &&
    GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com")
  );
}

// URL pública da pasta no Drive (pra abrir no navegador / colar no Clicksign).
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
