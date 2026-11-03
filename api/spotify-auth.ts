// /api/spotify-auth?rid=<rid> → redireciona pro login OAuth do Spotify.
// O state carrega o rid (+ nonce) e volta no callback.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { authorizeUrl, spotifyConfigurado } from "./_spotify.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = String(req.query.rid || "").trim();
  if (!rid) { res.status(400).send("rid ausente"); return; }
  if (!spotifyConfigurado()) { res.status(500).send("Spotify não configurado (defina SPOTIFY_CLIENT_ID/SECRET/REDIRECT_URI)."); return; }
  const nonce = crypto.randomBytes(8).toString("hex");
  const state = `${rid}::${nonce}`;
  res.setHeader("Set-Cookie", `sp_state=${encodeURIComponent(state)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
  res.redirect(302, authorizeUrl(state));
}
