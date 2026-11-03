// /api/spotify-callback?code&state → troca o code por tokens, busca o perfil,
// grava em spotifyContas/{rid} e redireciona de volta pro módulo.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { trocarCodigo, salvarConta, spotifyConfigurado } from "./_spotify.js";

const APP = "https://admin.planejamento.app";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const erro = String(req.query.error || "");
  const rid = state.split("::")[0] || "";
  const volta = (q: string) => res.redirect(302, `${APP}/r/${rid}/musicaAmbiente?${q}`);

  if (erro) { volta(`sp=erro&m=${encodeURIComponent(erro)}`); return; }
  if (!code || !rid) { volta("sp=erro&m=faltou_code"); return; }
  if (!spotifyConfigurado()) { res.status(500).send("Spotify não configurado."); return; }

  try {
    const tok = await trocarCodigo(code);
    // perfil (nome + id) pra mostrar quem está conectado
    let perfil: { id?: string; display_name?: string } = {};
    try {
      const r = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (r.ok) perfil = (await r.json()) as { id?: string; display_name?: string };
    } catch { /* ignora */ }
    await salvarConta(rid, tok, perfil);
    volta("sp=ok");
  } catch (e) {
    volta(`sp=erro&m=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
}
