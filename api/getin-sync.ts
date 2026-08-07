// ════════════════════════════════════════════════════════════════════════════
//  /api/getin-sync — CONECTOR GetIn → planejamento.app (reservas)
//
//  O GetIn (comprado pelo iFood) não tem API pública nem webhook. Mas o painel
//  operacional.getin.app usa uma API interna que dá pra consumir. Como não há
//  fluxo de credencial de máquina, a gente FAZ LOGIN HEADLESS (puppeteer) com a
//  credencial do restaurante (secret), pega o token de sessão e chama a API de
//  reservas. Roda por cron.
//
//  Vínculo por restaurante:
//    • credenciais (secrets Vercel): GETIN_<credKey>_EMAIL / GETIN_<credKey>_PASSWORD
//    • unitId + credKey: no doc restaurants/{id}.getin = { ativo, unitId, credKey }
//      (com fallback built-in enquanto a config não é semeada no Firestore).
//
//  Grava em /reservas (sem PII) + /reservasPII (nome/telefone/email), dedup por
//  docId determinístico `getin_<idDoGetIn>`. Aparece no módulo Reservas com o
//  botão de WhatsApp interno. NÃO sobrescreve o status que a equipe já mexeu —
//  só propaga cancelamento vindo do GetIn.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { firestoreDisponivel, firestoreListar, firestoreLer, firestoreAtualizar } from "./_firestoreRest.js";
import { requireUser } from "./_auth.js";

export const config = { maxDuration: 300 };

// Fallback enquanto restaurants/{id}.getin não é semeado. credKey → secrets.
// unitId opcional: se não informado, é derivado do claim `units` do JWT no login.
const BUILTIN: Array<{ match: RegExp; unitId?: string; credKey: string }> = [
  { match: /sororoca/i, unitId: "VPBoya1m", credKey: "SOROROCA" },
  { match: /lobo/i, credKey: "LOBOZO" },   // unitId derivado do token
];

const API_BASE = "https://agent.getinapis.com";

type GetinReserva = {
  id: string; sector?: { name?: string }; name?: string; mobile?: string; email?: string;
  people?: number; date?: string; time?: string; info?: string; occasion?: string;
  status?: string; source?: string; created_at?: string; updated_at?: string;
};

// GetIn status → nosso ReservaStatus.
function mapStatus(s?: string): string {
  const x = (s || "").toLowerCase();
  if (x.includes("cancel")) return "cancelada";
  if (x.includes("no-show") || x.includes("noshow") || x.includes("no_show")) return "no_show";
  if (x.includes("seat") || x.includes("arriv") || x.includes("checkin") || x.includes("check-in") || x.includes("present")) return "chegou";
  if (x.includes("confirm")) return "confirmada";
  return "pendente";
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

// unitId a partir do claim `units` do JWT (quando não veio na config). Assim,
// pra ligar um restaurante novo basta os secrets — não precisa saber o unitId.
function unitIdDoToken(token: string): string {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { units?: unknown };
    const u = Array.isArray(p.units) ? p.units[0] : null;
    return typeof u === "string" ? u : "";
  } catch { return ""; }
}

// Lê o token de sessão da página (sessionStorage ou persist:root). null se não achou.
async function lerToken(page: import("puppeteer-core").Page): Promise<string | null> {
  try {
    const h = await page.waitForFunction(() => {
      const s = sessionStorage.getItem("access_token");
      if (s) return s;
      try { const r = JSON.parse(localStorage.getItem("persist:root") || "{}"); const a = JSON.parse(r.auth || "{}"); return a.token || null; } catch { return null; }
    }, { timeout: 20000 });
    const v = await h.jsonValue();
    return typeof v === "string" && v ? v : null;
  } catch { return null; }
}

// Login headless no GetIn → devolve o JWT de sessão.
async function loginGetin(email: string, senha: string): Promise<string> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true, defaultViewport: { width: 900, height: 1200, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.goto("https://login.getin.app", { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector('input[type="password"]', { timeout: 25000 });
    // e-mail = 1º input de texto; senha = input password.
    await page.type('input[type="email"], input[type="text"]', email, { delay: 25 });
    await page.type('input[type="password"]', senha, { delay: 25 });
    await Promise.all([
      page.click('button[type="submit"]').catch(() => {}),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    ]);
    // Vai direto pro operacional (o cookie de sessão autoriza) e lê o token.
    await page.goto("https://operacional.getin.app/reservation?mode=1", { waitUntil: "networkidle2", timeout: 45000 });
    let token = await lerToken(page);
    // Fallback: se caiu no seletor de plataforma, clica em "Painel Operação".
    if (!token) {
      await page.goto("https://login.getin.app", { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await page.evaluate(() => {
        const alvo = Array.from(document.querySelectorAll<HTMLElement>("*")).find((e) => {
          const t = (e.textContent || "").trim();
          const h = e.getBoundingClientRect().height;
          return /painel opera/i.test(t) && t.length < 60 && h > 20 && h < 220;
        });
        (alvo?.closest("button,a,[role=button]") as HTMLElement | null || alvo)?.click();
      }).catch(() => {});
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      if (!/operacional\.getin/.test(page.url())) await page.goto("https://operacional.getin.app/reservation?mode=1", { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      token = await lerToken(page);
    }
    if (!token) throw new Error("login concluído mas não encontrei o token de sessão");
    return token;
  } finally { if (browser) await browser.close().catch(() => {}); }
}

// Sincroniza um restaurante: login → busca reservas → upsert.
async function sincronizarUm(a: { rid: string; nome: string; unitId?: string; credKey: string }): Promise<Record<string, unknown>> {
  const email = process.env[`GETIN_${a.credKey}_EMAIL`];
  const senha = process.env[`GETIN_${a.credKey}_PASSWORD`];
  if (!email || !senha) return { rid: a.rid, nome: a.nome, erro: `faltam secrets GETIN_${a.credKey}_EMAIL / _PASSWORD` };

  const token = await loginGetin(email, senha);
  const unitId = a.unitId || unitIdDoToken(token);
  if (!unitId) return { rid: a.rid, nome: a.nome, erro: "não encontrei o unitId (nem na config nem no token do GetIn)" };
  const hoje = new Date();
  const fim = new Date(hoje.getTime() + 180 * 86400000);   // hoje + ~6 meses
  // O GetIn pagina em 15 por padrão → busca TODAS as páginas (per_page 200).
  const lista: GetinReserva[] = [];
  for (let page = 1; page <= 60; page++) {
    const url = `${API_BASE}/reservation/v1/units/${unitId}/reservations?start_date=${ymd(hoje)}&end_date=${ymd(fim)}&per_page=200&page=${page}`;
    const rr = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (!rr.ok) { if (page === 1) return { rid: a.rid, nome: a.nome, erro: `GetIn API ${rr.status}: ${(await rr.text()).slice(0, 120)}` }; break; }
    const body = (await rr.json()) as { data?: GetinReserva[]; pagination?: { is_last_page?: boolean; last_page?: number } };
    const data = body.data || [];
    lista.push(...data);
    const pg = body.pagination || {};
    if (pg.is_last_page || !data.length || page >= (pg.last_page || 1)) break;
  }

  let novas = 0, atualizadas = 0;
  for (const gr of lista) {
    if (!gr.id) continue;
    const docId = `getin_${gr.id}`;
    const agora = new Date().toISOString();
    const existente = await firestoreLer("reservas", docId);
    // Fatos (sem PII) → /reservas
    const base: Record<string, unknown> = {
      id: docId, restaurantId: a.rid,
      data: gr.date || "", horario: gr.time || "", pessoas: Number(gr.people || 0),
      salaoNomeSnapshot: gr.sector?.name || "",
      origem: "getin", externoId: gr.id, getinStatus: gr.status || "",
      getinAtualizadoEm: gr.updated_at || agora, atualizadoEm: agora,
    };
    if (!existente) {
      base.status = mapStatus(gr.status);
      base.registradoEm = gr.created_at || agora;
      base.registradoPor = "getin";
      await firestoreAtualizar("reservas", docId, base);
      novas++;
    } else {
      // Não sobrescreve o status que a equipe mexeu — só propaga cancelamento.
      if (mapStatus(gr.status) === "cancelada" && String(existente.status || "") !== "cancelada") base.status = "cancelada";
      await firestoreAtualizar("reservas", docId, base);
      atualizadas++;
    }
    // PII → /reservasPII (nome/telefone/email). Telefone E.164 (mobile já vem c/ DDI).
    await firestoreAtualizar("reservasPII", docId, {
      id: docId, restaurantId: a.rid,
      clienteNomeSnapshot: gr.name || "",
      clienteTelefoneSnapshot: (gr.mobile || "").replace(/\D/g, ""),
      clienteEmailSnapshot: gr.email || "",
      observacoes: gr.info || "",
      ocasiao: gr.occasion || "",
      registradoEm: gr.created_at || agora,
    });
  }
  return { rid: a.rid, nome: a.nome, total: lista.length, novas, atualizadas };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Proteção: cron do Vercel (header x-vercel-cron) | secret (?key) | usuário
  // logado (botão "forçar sync" no app manda o ID token do Firebase).
  const secret = process.env.CRON_SECRET;
  const ehCron = !!req.headers["x-vercel-cron"];
  let autorizado = ehCron || !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!autorizado) { try { await requireUser(req); autorizado = true; } catch { /* não é usuário logado */ } }
  if (!autorizado) { res.status(401).json({ error: "não autorizado" }); return; }
  if (!firestoreDisponivel()) { res.status(503).json({ error: "Firestore indisponível (faltam credenciais de service account no ambiente)." }); return; }
  // Filtro opcional por restaurante (o botão "forçar" manda só o rid da tela).
  const soRid = typeof req.query.rid === "string" ? req.query.rid : "";

  try {
    const restaurantes = await firestoreListar("restaurants");
    const alvos: Array<{ rid: string; nome: string; unitId?: string; credKey: string }> = [];
    for (const r of restaurantes) {
      const rid = String(r.id || "");
      const nome = String((r as { nome?: unknown }).nome || "");
      const g = (r as { getin?: { ativo?: boolean; unitId?: string; credKey?: string } }).getin;
      if (g && g.ativo && g.credKey) { alvos.push({ rid, nome, unitId: g.unitId ? String(g.unitId) : undefined, credKey: String(g.credKey) }); continue; }
      const b = BUILTIN.find((x) => x.match.test(nome));
      if (b) alvos.push({ rid, nome, unitId: b.unitId, credKey: b.credKey });
    }
    const alvosFiltrados = soRid ? alvos.filter((a) => a.rid === soRid) : alvos;
    if (!alvosFiltrados.length) { res.status(200).json({ ok: true, aviso: "nenhum restaurante com GetIn configurado", resultado: [] }); return; }

    const resultado: Array<Record<string, unknown>> = [];
    for (const a of alvosFiltrados) {
      let r: Record<string, unknown>;
      try { r = await sincronizarUm(a); }
      catch (e) { r = { rid: a.rid, nome: a.nome, erro: e instanceof Error ? e.message : String(e) }; }
      // Status por restaurante (pro badge + botão de forçar na tela de Reservas).
      await firestoreAtualizar("getinSyncStatus", a.rid, {
        id: a.rid, restaurantId: a.rid, nome: a.nome, atualizadoEm: new Date().toISOString(),
        total: Number(r.total || 0), novas: Number(r.novas || 0), atualizadas: Number(r.atualizadas || 0),
        ok: !r.erro, erro: r.erro ? String(r.erro) : "",
      }).catch(() => {});
      resultado.push(r);
    }
    res.status(200).json({ ok: true, resultado });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha no sync" });
  }
}
