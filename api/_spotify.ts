// ════════════════════════════════════════════════════════════════════════════
//  Helper do módulo Spotify — OAuth (Authorization Code) + chamadas à Web API,
//  com refresh automático. Tokens ficam no servidor (coleção spotifyContas/{rid}),
//  NUNCA no front: o cliente fala só com /api/spotify-control.
//  Device alvo = AudioCast M5 (Spotify Connect). Requer Spotify Premium.
// ════════════════════════════════════════════════════════════════════════════
import { firestoreLer, firestoreCriar, firestorePatchCampos } from "./_firestoreRest.js";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const REDIRECT = process.env.SPOTIFY_REDIRECT_URI || "";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

export function spotifyConfigurado(): boolean { return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT); }

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, scope: SPOTIFY_SCOPES,
    redirect_uri: REDIRECT, state, show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

function basicAuth(): string { return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"); }

type TokenResp = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

export async function trocarCodigo(code: string): Promise<TokenResp> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()) as TokenResp;
}

async function refreshAccess(refresh: string): Promise<TokenResp> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`refresh ${r.status}: ${await r.text()}`);
  return (await r.json()) as TokenResp;
}

export type SpotifyConta = {
  rid: string; accessToken: string; refreshToken: string; expiraEm: number;
  displayName?: string | null; spotifyUserId?: string | null; scope?: string | null;
};

export async function getConta(rid: string): Promise<SpotifyConta | null> {
  const d = await firestoreLer("spotifyContas", rid);
  if (!d || !d.refreshToken) return null;
  return d as unknown as SpotifyConta;
}

// Grava a conta no 1º connect (doc completo). perfil = dados do /me.
export async function salvarConta(rid: string, tok: TokenResp, perfil: { id?: string; display_name?: string }): Promise<void> {
  const expiraEm = Date.now() + Number(tok.expires_in || 3600) * 1000 - 60000;
  await firestoreCriar("spotifyContas", rid, {
    rid, accessToken: tok.access_token, refreshToken: tok.refresh_token || "", expiraEm,
    scope: tok.scope || null, spotifyUserId: perfil.id || null, displayName: perfil.display_name || null,
    conectadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
  });
}

export async function desconectar(rid: string): Promise<void> {
  await firestorePatchCampos("spotifyContas", rid, { accessToken: "", refreshToken: "", expiraEm: 0, desconectadoEm: new Date().toISOString() });
}

// Access token válido (renova se faltar <0). Devolve null se não há conta.
async function accessValido(rid: string): Promise<string | null> {
  const c = await getConta(rid);
  if (!c) return null;
  if (c.accessToken && Date.now() < Number(c.expiraEm || 0)) return c.accessToken;
  const tok = await refreshAccess(c.refreshToken);
  const expiraEm = Date.now() + Number(tok.expires_in || 3600) * 1000 - 60000;
  await firestorePatchCampos("spotifyContas", rid, { accessToken: tok.access_token, expiraEm, atualizadoEm: new Date().toISOString() });
  return tok.access_token;
}

// Chamada à Web API do Spotify com Bearer + retry 1x em 401.
export async function spotifyFetch(rid: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: unknown }> {
  let token = await accessValido(rid);
  if (!token) throw new Error("sem_conta");
  const doFetch = (t: string) => fetch(`https://api.spotify.com/v1${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });
  let r = await doFetch(token);
  if (r.status === 401) { // token revogado no meio → força refresh
    const c = await getConta(rid);
    if (c?.refreshToken) {
      const tok = await refreshAccess(c.refreshToken);
      token = tok.access_token;
      await firestorePatchCampos("spotifyContas", rid, { accessToken: token, expiraEm: Date.now() + Number(tok.expires_in || 3600) * 1000 - 60000 });
      r = await doFetch(token);
    }
  }
  const txt = await r.text();
  let data: unknown = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: r.status, data };
}
