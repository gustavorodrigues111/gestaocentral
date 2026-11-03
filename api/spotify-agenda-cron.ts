// /api/spotify-agenda-cron — roda a cada minuto. Pra cada conta Spotify conectada,
// verifica se o horário atual (America/Sao_Paulo) cai num slot da agenda; ao ENTRAR
// num slot, inicia a playlist no dispositivo preferencial com o volume definido.
// Ao sair do último slot (se "parar no fim"), pausa. Só age nas transições — não
// reinicia a música a cada minuto.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { spotifyConfigurado, listarContas, patchConta, spotifyFetch, getPrefs, type AgendaSlot } from "./_spotify.js";

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function agoraSP(): { dow: number; hhmm: string; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit",
    hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return { dow: DOW[g("weekday")] ?? 0, hhmm: `${hh}:${g("minute")}`, dateKey: `${g("year")}-${g("month")}-${g("day")}` };
}

function dentro(hhmm: string, ini: string, fim: string): boolean {
  if (!ini || !fim) return false;
  if (ini < fim) return hhmm >= ini && hhmm < fim;
  return hhmm >= ini || hhmm < fim; // cruza meia-noite
}

async function iniciarSlot(rid: string, slot: AgendaSlot): Promise<boolean> {
  // alvo: dispositivo preferencial se online, senão o ativo, senão o primeiro
  const dv = await spotifyFetch(rid, "/me/player/devices");
  const devices = (dv.data as { devices?: { id: string; is_active: boolean }[] })?.devices || [];
  if (!devices.length) return false;
  const prefs = await getPrefs(rid);
  const alvo = devices.find((d) => d.id === prefs.devicePreferidoId) || devices.find((d) => d.is_active) || devices[0];
  if (!alvo) return false;
  if (slot.volume != null) await spotifyFetch(rid, `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(slot.volume)))}&device_id=${alvo.id}`, { method: "PUT" }).catch(() => {});
  const r = await spotifyFetch(rid, `/me/player/play?device_id=${alvo.id}`, { method: "PUT", body: slot.playlistUri ? { context_uri: slot.playlistUri } : undefined });
  return r.status < 300;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!spotifyConfigurado()) { res.status(200).json({ ok: false, erro: "nao_configurado" }); return; }
  const now = agoraSP();
  const resultados: unknown[] = [];
  try {
    const contas = await listarContas();
    for (const c of contas) {
      const rid = String(c.rid || c.id || "");
      if (!rid || !c.refreshToken) continue;
      const agenda = (Array.isArray(c.agenda) ? c.agenda : []) as AgendaSlot[];
      const ultimo = (c.agendaUltimo as { key?: string; pararAoSair?: boolean } | null) || null;
      const ativo = agenda.find((s) => s.ativo && Array.isArray(s.dias) && s.dias.includes(now.dow) && dentro(now.hhmm, s.horaInicio, s.horaFim));
      if (ativo) {
        const key = `${ativo.id}|${now.dateKey}`;
        if (!ultimo || ultimo.key !== key) {
          const ok = await iniciarSlot(rid, ativo).catch(() => false);
          await patchConta(rid, { agendaUltimo: { key, slotId: ativo.id, pararAoSair: !!ativo.pararNoFim, em: new Date().toISOString() } });
          resultados.push({ rid, acao: "iniciar", slot: ativo.id, ok });
        }
      } else if (ultimo) {
        if (ultimo.pararAoSair) { await spotifyFetch(rid, "/me/player/pause", { method: "PUT" }).catch(() => {}); resultados.push({ rid, acao: "pausar" }); }
        await patchConta(rid, { agendaUltimo: null });
      }
    }
    res.status(200).json({ ok: true, now, resultados });
  } catch (e) {
    res.status(200).json({ ok: false, erro: e instanceof Error ? e.message : "falha", now });
  }
}
