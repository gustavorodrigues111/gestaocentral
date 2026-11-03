// /api/spotify-control — POST { rid, action, ... }. Todas as operações do módulo
// Música Ambiente passam por aqui; os tokens ficam no servidor (nunca no front).
// Ações: status, devices, state, transfer, play, pause, next, previous, volume,
//        playlists, search, disconnect.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getConta, spotifyFetch, desconectar, spotifyConfigurado, getPrefs, setDevicePreferido, toggleFavPlaylist, type FavPlaylist } from "./_spotify.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, erro: "method" }); return; }
  if (!spotifyConfigurado()) { res.status(200).json({ ok: false, erro: "nao_configurado" }); return; }
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  const rid = String(body.rid || "").trim();
  const action = String(body.action || "").trim();
  if (!rid || !action) { res.status(400).json({ ok: false, erro: "bad_request" }); return; }

  try {
    const conta = await getConta(rid);
    if (action === "status") {
      const prefs = conta ? await getPrefs(rid) : { devicePreferidoId: null, devicePreferidoNome: null, playlistsPreferidas: [] };
      res.status(200).json({ ok: true, conectado: !!conta, displayName: conta?.displayName || null, ...prefs });
      return;
    }
    if (!conta) { res.status(200).json({ ok: false, erro: "sem_conta" }); return; }

    if (action === "disconnect") { await desconectar(rid); res.status(200).json({ ok: true }); return; }
    if (action === "setPrefDevice") { await setDevicePreferido(rid, String(body.deviceId || ""), String(body.deviceNome || "")); res.status(200).json({ ok: true }); return; }
    if (action === "toggleFav") { const lista = await toggleFavPlaylist(rid, body.playlist as FavPlaylist); res.status(200).json({ ok: true, playlistsPreferidas: lista }); return; }
    if (action === "queue") { const r = await spotifyFetch(rid, "/me/player/queue"); res.status(200).json({ ok: r.status < 300, status: r.status, ...(r.status === 200 ? (r.data as object) : {}) }); return; }

    if (action === "devices") {
      const r = await spotifyFetch(rid, "/me/player/devices");
      res.status(200).json({ ok: r.status < 300, status: r.status, ...(r.data as object) });
      return;
    }
    if (action === "state") {
      const r = await spotifyFetch(rid, "/me/player");
      res.status(200).json({ ok: true, status: r.status, player: r.status === 204 ? null : r.data });
      return;
    }
    if (action === "playlists") {
      const r = await spotifyFetch(rid, "/me/playlists?limit=50");
      res.status(200).json({ ok: r.status < 300, ...(r.data as object) });
      return;
    }
    if (action === "search") {
      const q = encodeURIComponent(String(body.q || ""));
      const types = String(body.types || "playlist,track");
      const r = await spotifyFetch(rid, `/search?q=${q}&type=${types}&market=from_token&limit=20`);
      const ok = r.status < 300;
      res.status(200).json({ ok, status: r.status, ...(ok ? (r.data as object) : { erroApi: r.data }) });
      return;
    }
    if (action === "transfer") {
      const deviceId = String(body.deviceId || "");
      const r = await spotifyFetch(rid, "/me/player", { method: "PUT", body: { device_ids: [deviceId], play: !!body.play } });
      res.status(200).json({ ok: r.status < 300, status: r.status });
      return;
    }
    if (action === "play") {
      const deviceId = String(body.deviceId || "");
      const qs = deviceId ? `?device_id=${deviceId}` : "";
      const payload: Record<string, unknown> = {};
      if (body.contextUri) payload.context_uri = body.contextUri;      // playlist/álbum
      if (Array.isArray(body.uris)) payload.uris = body.uris;          // faixas avulsas
      if (body.offset != null) payload.offset = { position: Number(body.offset) };
      const r = await spotifyFetch(rid, `/me/player/play${qs}`, { method: "PUT", body: Object.keys(payload).length ? payload : undefined });
      res.status(200).json({ ok: r.status < 300, status: r.status, data: r.data });
      return;
    }
    if (action === "pause") {
      const r = await spotifyFetch(rid, "/me/player/pause", { method: "PUT" });
      res.status(200).json({ ok: r.status < 300, status: r.status });
      return;
    }
    if (action === "next" || action === "previous") {
      const r = await spotifyFetch(rid, `/me/player/${action}`, { method: "POST" });
      res.status(200).json({ ok: r.status < 300, status: r.status });
      return;
    }
    if (action === "seek") {
      const pos = Math.max(0, Math.round(Number(body.positionMs) || 0));
      const deviceId = String(body.deviceId || "");
      const qs = deviceId ? `&device_id=${deviceId}` : "";
      const r = await spotifyFetch(rid, `/me/player/seek?position_ms=${pos}${qs}`, { method: "PUT" });
      res.status(200).json({ ok: r.status < 300, status: r.status });
      return;
    }
    if (action === "volume") {
      const vol = Math.max(0, Math.min(100, Math.round(Number(body.volume) || 0)));
      const deviceId = String(body.deviceId || "");
      const qs = deviceId ? `&device_id=${deviceId}` : "";
      const r = await spotifyFetch(rid, `/me/player/volume?volume_percent=${vol}${qs}`, { method: "PUT" });
      res.status(200).json({ ok: r.status < 300, status: r.status });
      return;
    }
    res.status(400).json({ ok: false, erro: "acao_invalida" });
  } catch (e) {
    res.status(200).json({ ok: false, erro: e instanceof Error ? e.message : "falha" });
  }
}
