// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-healthcheck — cron (Vercel) que vigia a saúde da EVOLUTION
//  (o servidor do WhatsApp device-link). Alimenta o Monitor de Falhas:
//
//   • Servidor fora do ar (host não responde /instance/fetchInstances) →
//     grava 1 falha "Evolution fora do ar" + email pro master.
//   • Número (instância) desconectado (estado ≠ "open") → grava 1 falha
//     "Número WhatsApp X desconectado" + email.
//
//  Anti-spam: guarda o último estado em monitorEstado/evolution e só re-alerta
//  a cada REALERT_MS enquanto seguir com problema. Quando VOLTA ao normal,
//  marca a falha correspondente como resolvida (some da Central sozinha).
//
//  Roda a cada 15 min (vercel.json). Escreve no Firestore via usuário de
//  serviço (ver _firestoreRest). Protegido por CRON_SECRET (o Vercel Cron
//  manda o header Authorization: Bearer <secret> automaticamente).
//
//  Env: EVOLUTION_API_URL, EVOLUTION_API_KEY, CRON_SECRET (opcional),
//       RESEND_API_KEY + RESEND_FROM_DEFAULT (email), ALERT_EMAIL (destino).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreLer, firestoreCriar, firestoreAtualizar } from "./_firestoreRest.js";

export const config = { maxDuration: 30 };

const REQ_TIMEOUT_MS = 15_000;
const REALERT_MS = 6 * 60 * 60 * 1000; // re-alerta no máximo de 6 em 6h enquanto seguir com problema
const RESEND_API = "https://api.resend.com/emails";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "gustavo@quibebe.com.br";
const ESTADO_DOC = "evolution";

type ProblemaEstado = { alertadoEm?: string; falhaId?: string; estado?: string };
type MonitorEstado = {
  host?: { ok?: boolean } & ProblemaEstado;
  instancias?: Record<string, { ok?: boolean } & ProblemaEstado>;
  checadoEm?: string;
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

// Dispara 1 falha (Central + email) e devolve o id pra gravar no estado.
async function abrirFalha(modulo: string, mensagem: string, codigo: string): Promise<string> {
  const criadoEm = new Date().toISOString();
  const id = `falha_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await firestoreCriar("falhasLog", id, { modulo, mensagem, codigo, criadoEm });
  } catch (e) { console.error("healthcheck: gravar falha", e); }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_DEFAULT || "onboarding@resend.dev";
  if (apiKey) {
    try {
      const html =
        `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">` +
        `<h2 style="margin:0 0 10px">🚨 ${esc(modulo)}</h2>` +
        `<p style="margin:0 0 8px"><b>${esc(mensagem)}</b></p>` +
        `<p style="color:#666;margin:0">Código: ${esc(codigo)} · ${esc(criadoEm)}</p>` +
        `<p style="color:#999;margin-top:14px;font-size:12px">Monitor de Falhas · planejamento.app</p></div>`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      await fetch(RESEND_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [ALERT_EMAIL], subject: `🚨 ${modulo}`, html }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
    } catch (e) { console.error("healthcheck: emailar", e); }
  }
  return id;
}

// Marca a falha como resolvida quando o problema some (Central limpa sozinha).
async function resolverFalha(falhaId?: string): Promise<void> {
  if (!falhaId) return;
  try { await firestoreAtualizar("falhasLog", falhaId, { resolvidoEm: new Date().toISOString() }); }
  catch (e) { console.error("healthcheck: resolver falha", e); }
}

// Decide se deve alertar: primeira vez com problema, ou passou a janela de re-alerta.
function deveAlertar(prev: ProblemaEstado | undefined, agora: number): boolean {
  if (!prev?.alertadoEm) return true;
  return agora - new Date(prev.alertadoEm).getTime() > REALERT_MS;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) { res.status(401).json({ error: "Unauthorized" }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(200).json({ ok: true, skip: "Evolution não configurada" }); return; }
  if (!firestoreDisponivel()) { res.status(200).json({ ok: true, skip: "Firestore (serviço) indisponível" }); return; }

  const agora = Date.now();
  const nowIso = new Date().toISOString();
  const estado = ((await firestoreLer("monitorEstado", ESTADO_DOC)) as MonitorEstado | null) || {};
  const prevHost = estado.host || {};
  const prevInst = estado.instancias || {};
  const novoInst: Record<string, { ok?: boolean } & ProblemaEstado> = {};

  // ── 1) O servidor responde? (host up/down — o caso mais crítico) ──
  let instancias: unknown[] | null = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/instance/fetchInstances`, {
      headers: { apikey: key, "Content-Type": "application/json" }, signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = safeParse(await r.text());
    instancias = Array.isArray(j) ? j : (Array.isArray((j as { instances?: unknown[] })?.instances) ? (j as { instances: unknown[] }).instances : []);
  } catch (e) {
    instancias = null;
    const motivo = e instanceof Error && e.name === "AbortError" ? "sem resposta (timeout)" : (e instanceof Error ? e.message : "erro");
    let host = { ...prevHost, ok: false, estado: motivo };
    if (deveAlertar(prevHost, agora)) {
      const falhaId = await abrirFalha("WhatsApp — servidor fora do ar", `O servidor da Evolution não respondeu (${motivo}). O WhatsApp não recebe nem envia mensagens enquanto isso.`, "evolution_host_down");
      host = { ok: false, estado: motivo, alertadoEm: nowIso, falhaId };
    }
    await firestoreAtualizar("monitorEstado", ESTADO_DOC, { ...estado, host, checadoEm: nowIso }).catch(() => firestoreCriar("monitorEstado", ESTADO_DOC, { host, instancias: prevInst, checadoEm: nowIso }));
    clearTimeout(timer);
    res.status(200).json({ ok: true, hostDown: true, motivo });
    return;
  } finally { clearTimeout(timer); }

  // Host voltou/está de pé → resolve o alerta de host se havia.
  let host: { ok?: boolean } & ProblemaEstado = { ok: true };
  if (prevHost.ok === false) await resolverFalha(prevHost.falhaId);

  // ── 2) Cada número (instância): estado "open" = conectado; resto = problema ──
  const problemas: string[] = [];
  for (const el of instancias) {
    const o = (el || {}) as Record<string, unknown>;
    const inner = (o.instance || {}) as Record<string, unknown>;
    const nome = String(o.name || o.instanceName || inner.instanceName || inner.name || "").trim();
    if (!nome) continue;
    const st = String(o.connectionStatus || o.connectionState || o.state || inner.state || inner.status || inner.connectionStatus || "unknown");
    const prev = prevInst[nome] || {};

    if (st === "open") {
      if (prev.ok === false) await resolverFalha(prev.falhaId); // reconectou → limpa
      novoInst[nome] = { ok: true, estado: st };
    } else {
      problemas.push(`${nome} (${st})`);
      if (deveAlertar(prev, agora)) {
        const falhaId = await abrirFalha("WhatsApp — número desconectado", `O número "${nome}" está desconectado (estado: ${st}). Reescaneie o QR na tela do WhatsApp pra reconectar.`, `evolution_offline_${nome}`);
        novoInst[nome] = { ok: false, estado: st, alertadoEm: nowIso, falhaId };
      } else {
        novoInst[nome] = { ok: false, estado: st, alertadoEm: prev.alertadoEm, falhaId: prev.falhaId };
      }
    }
  }

  await firestoreAtualizar("monitorEstado", ESTADO_DOC, { host, instancias: novoInst, checadoEm: nowIso })
    .catch(() => firestoreCriar("monitorEstado", ESTADO_DOC, { host, instancias: novoInst, checadoEm: nowIso }));

  res.status(200).json({ ok: true, instancias: instancias.length, problemas });
}
