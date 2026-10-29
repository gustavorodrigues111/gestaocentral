// Cron diário — Bot Planejamento.app avisa no grupo as parcelas que vencem
// AMANHÃ (D-1). Varre os monitores ativos com a skill "investimentos", acha as
// parcelas em aberto com vencimento amanhã e posta um resumo no grupo.
//
// Server-side via REST admin (firestore*) — não precisa de pessoa autenticada.
// Dedup por grupo+dia (botAvisosParcela/{waId_YYYYMMDD}) pra não repetir se o
// endpoint for chamado 2x no mesmo dia.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreListar, firestoreLer, firestoreCriar } from "./_firestoreRest.js";
import { enviarTexto } from "./_botMonitor.js";

const fmtV = (n: number) => Number(n).toFixed(2).replace(".", ",");

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${expected}`) { res.status(401).json({ error: "Unauthorized" }); return; }
  }

  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const alvoData = amanha.toISOString().slice(0, 10);               // YYYY-MM-DD
  const alvoBR = alvoData.split("-").reverse().join("/");
  const diaKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  let monitores: Record<string, unknown>[] = [];
  let lancs: Record<string, unknown>[] = [];
  try { monitores = await firestoreListar("whatsappMonitores"); } catch { /* vazio */ }
  try { lancs = await firestoreListar("investLancamentos"); } catch { /* vazio */ }

  let gruposAvisados = 0;
  for (const mon of monitores) {
    if (mon.ativo === false) continue;
    const skills = Array.isArray(mon.skills) ? mon.skills.map(String) : [];
    if (!skills.includes("investimentos")) continue;
    const numeroId = String(mon.numeroId || "");
    const waId = String(mon.waId || "");
    const rid = String(mon.restaurantId || "");
    const projetoId = mon.projetoId ? String(mon.projetoId) : null;
    if (!numeroId || !waId || !projetoId) continue;

    const guardId = `${waId}_${diaKey}`;
    const ja = await firestoreLer("botAvisosParcela", guardId).catch(() => null);
    if (ja) continue;                                              // já avisou hoje

    const linhas: string[] = [];
    for (const l of lancs) {
      if (l.restaurantId !== rid || l.projetoId !== projetoId || l.excluido || !l.parcelado) continue;
      const parc = Array.isArray(l.parcelas) ? l.parcelas as Array<Record<string, unknown>> : [];
      for (const p of parc) {
        if (!p.pago && String(p.data) === alvoData && Number(p.valor) > 0) {
          linhas.push(`• ${l.estabelecimento || "—"}${l.seq != null ? ` (#${l.seq})` : ""} — parcela ${p.n}/${parc.length} — R$ ${fmtV(Number(p.valor))}`);
        }
      }
    }

    if (linhas.length) {
      const jid = waId.startsWith("g:") ? `${waId.slice(2)}@g.us` : waId;
      const msg = `⏰ *Vence amanhã* (${alvoBR}):\n${linhas.join("\n")}`;
      await enviarTexto(numeroId, jid, msg).catch(() => {});
      gruposAvisados++;
    }
    await firestoreCriar("botAvisosParcela", guardId, { id: guardId, waId, dia: diaKey, enviadas: linhas.length, criadoEm: new Date().toISOString() }).catch(() => {});
  }

  res.status(200).json({ ok: true, data: alvoData, gruposAvisados });
}
