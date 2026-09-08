// ════════════════════════════════════════════════════════════════════════════
//  /api/ptrp-punch-sync — SYNC INCREMENTAL das batidas do Sólides → Firestore.
//
//  Módulo PTRP (tratamento de ponto). A batida oficial do REGISTRADOR (Sólides)
//  é espelhada numa coleção IMUTÁVEL `ptrpBatidas` — a partir dela a apuração do
//  planejamento.app roda de forma determinística e recalculável. Nenhuma tela
//  escreve/edita batida: só esta rotina, e SÓ com create (nunca update/delete),
//  garantindo a integridade exigida pela Portaria MTP 671/2021.
//
//  Multi-empresa: uma conta/token Sólides por empresa em SOLIDES_TOKENS (JSON
//  {"SHORTCODE":"tokenBasic"}). Roda por cron (Vercel), janela deslizante com
//  overlap pra pegar batidas que chegaram atrasadas; backfill em passos.
//
//    ptrpBatidas/{empresaKey}_{punchId}  — 1 doc por batida (create-only)
//    ptrpSyncState/{empresaKey}          — cursor + status do último sync
//
//  Params (opcionais, p/ backfill/manual): ?empresa=KEY  ?desde=YYYY-MM-DD
//  ?ate=YYYY-MM-DD  ?key=<CRON_SECRET>. Auth: x-vercel-cron | CRON_SECRET |
//  usuário logado (botão "sincronizar agora"). A pasta /api roda fora do tsconfig.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreLer, firestoreCriarSeAusente, firestoreAtualizar } from "./_firestoreRest.js";
import { requireUser } from "./_auth.js";

export const config = { maxDuration: 300 };

const PUNCH_API = "https://api.tangerino.com.br/api/punch/";
const PAGE_SIZE = 200;
const MAX_PAGES = 50;          // 50×200 = 10k batidas por janela por empresa
const REQ_TIMEOUT_MS = 20_000;
const STEP_DIAS = 10;          // avanço do cursor por execução (backfill em passos)
const OVERLAP_DIAS = 2;        // re-varre os últimos dias (pega batida atrasada)
const BACKFILL_DIAS = 45;      // 1ª execução: quanto puxar pra trás (≈1,5 fechamento)

// Data BRT (Sólides/Brasil = America/Sao_Paulo, UTC-3 sem horário de verão).
const ymdBRT = (ms: number): string => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const hojeBRT = (): string => ymdBRT(Date.now());
const somaDias = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const minYmd = (a: string, b: string): string => (a <= b ? a : b);
function ymdToMs(ymd: string, fim: boolean): number {
  const [y, m, d] = ymd.split("-").map(Number);
  // meia-noite BRT = 03:00 UTC; fim do dia BRT = 02:59:59 UTC do dia seguinte.
  return Date.UTC(y, m - 1, d, fim ? 23 + 3 : 0 + 3, fim ? 59 : 0, fim ? 59 : 0);
}

function empresasDeTokens(): Record<string, string> {
  const raw = process.env.SOLIDES_TOKENS;
  if (raw) { try { return JSON.parse(raw) as Record<string, string>; } catch { /* json inválido */ } }
  const single = process.env.SOLIDES_TOKEN;
  return single ? { DEFAULT: single } : {};
}

type Punch = { id?: number | string; date?: string; employeeId?: number | string; dateIn?: number; dateOut?: number; workScheduleId?: number | string; adjustmentReason?: unknown; excluded?: boolean; edited?: boolean; status?: string; employee?: { cpf?: string } };
type Page = { content?: Punch[]; last?: boolean };

async function fetchPage(token: string, startMs: number, endMs: number, page: number): Promise<Page> {
  const url = `${PUNCH_API}?startDate=${startMs}&endDate=${endMs}&page=${page}&size=${PAGE_SIZE}&showFired=true`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: "GET", headers: { Authorization: `Basic ${token}`, Accept: "application/json" }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`Sólides HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 160)}`);
    return (await resp.json()) as Page;
  } finally { clearTimeout(timer); }
}

// Busca TODAS as páginas do range e devolve as batidas deduplicadas por id e
// filtradas ao range (a Sólides vaza dias vizinhos por timezone, e às vezes
// repete a 1ª página — mesmo tratamento do endpoint /api/solides-punches).
async function buscarBatidas(token: string, desde: string, ate: string): Promise<Punch[]> {
  const startMs = ymdToMs(desde, false);
  const endMs = ymdToMs(ate, true);
  const acc: Punch[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(token, startMs, endMs, page);
    const content = Array.isArray(data.content) ? data.content : [];
    acc.push(...content);
    if (data.last === true || content.length < PAGE_SIZE) break;
  }
  const porId = new Map<string, Punch>();
  for (const p of acc) {
    if (p?.id == null) continue;
    const k = String(p.id);
    if (!porId.has(k)) porId.set(k, p);
  }
  return [...porId.values()].filter(p => typeof p.date === "string" && p.date >= desde && p.date <= ate);
}

// Grava as batidas novas (create-only = imutável). Retorna quantas criou.
async function gravarBatidas(empresaKey: string, batidas: Punch[]): Promise<number> {
  let criadas = 0;
  for (const p of batidas) {
    const punchId = String(p.id);
    const doc = {
      empresaKey, punchId,
      employeeId: p.employeeId != null ? String(p.employeeId) : null,
      cpf: (p.employee?.cpf || "").replace(/\D/g, "") || null,
      date: p.date || null,
      dateIn: typeof p.dateIn === "number" ? p.dateIn : null,
      dateOut: typeof p.dateOut === "number" ? p.dateOut : null,
      workScheduleId: p.workScheduleId != null ? String(p.workScheduleId) : null,
      excluded: p.excluded === true,
      edited: p.edited === true,
      status: p.status || null,
      temAjuste: p.adjustmentReason != null,
      raw: p,                       // payload bruto (fidelidade p/ espelho/AEJ)
      origem: "solides",
      syncedAt: new Date().toISOString(),
    };
    // create-only: 409 (já existe) → não sobrescreve (imutável) e não conta.
    const novo = await firestoreCriarSeAusente("ptrpBatidas", `${empresaKey}_${punchId}`, doc);
    if (novo) criadas++;
  }
  return criadas;
}

async function sincronizarEmpresa(empresaKey: string, token: string, desdeOverride?: string, ateOverride?: string): Promise<Record<string, unknown>> {
  const estado = await firestoreLer("ptrpSyncState", empresaKey) as { cursor?: string; primeiroDia?: string } | null;
  const hoje = hojeBRT();
  // Sem cursor → backfill inicial. Com cursor → janela [cursor-overlap, cursor+step].
  const baseDesde = desdeOverride || (estado?.cursor ? somaDias(estado.cursor, -OVERLAP_DIAS) : somaDias(hoje, -BACKFILL_DIAS));
  // "desde" manual → busca até HOJE (rebusca cheia do período escolhido pelo
  // usuário). Automático → avança em passos (backfill) ou fica na janela recente.
  const ate = minYmd(ateOverride || (desdeOverride ? hoje : (estado?.cursor ? somaDias(estado.cursor, STEP_DIAS) : hoje)), hoje);
  const desde = minYmd(baseDesde, ate);

  const batidas = await buscarBatidas(token, desde, ate);
  const criadas = await gravarBatidas(empresaKey, batidas);

  const novoCursor = ate;
  // Menor data já sincronizada (1ª batida coberta ever) — pra a UI mostrar desde quando há dados.
  const primeiroDia = estado?.primeiroDia ? minYmd(estado.primeiroDia, desde) : desde;
  await firestoreAtualizar("ptrpSyncState", empresaKey, {
    cursor: novoCursor,
    primeiroDia,
    ultimaSync: new Date().toISOString(),
    ok: true,
    erro: null,
    ultimaJanela: { desde, ate },
    lidasUltima: batidas.length,
    criadasUltima: criadas,
    atrasado: novoCursor < hoje,   // ainda em backfill?
  });
  return { empresaKey, desde, ate, lidas: batidas.length, criadas, cursor: novoCursor, atrasado: novoCursor < hoje };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Auth: cron do Vercel | CRON_SECRET | usuário logado (botão manual).
  const secret = process.env.CRON_SECRET;
  const ehCron = !!req.headers["x-vercel-cron"];
  let autorizado = ehCron || !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!autorizado) { try { await requireUser(req); autorizado = true; } catch { /* não é usuário */ } }
  if (!autorizado) { res.status(401).json({ error: "Não autorizado." }); return; }

  if (!firestoreDisponivel()) { res.status(503).json({ error: "Firestore de serviço não configurado (WEBHOOK_FB_EMAIL/PASSWORD)." }); return; }

  const empresas = empresasDeTokens();
  const soEmpresa = typeof req.query.empresa === "string" ? req.query.empresa : "";
  const desde = typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde) ? req.query.desde : undefined;
  const ate = typeof req.query.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate) ? req.query.ate : undefined;

  const chaves = Object.keys(empresas).filter(k => !soEmpresa || k === soEmpresa);
  if (chaves.length === 0) { res.status(400).json({ error: soEmpresa ? `Empresa "${soEmpresa}" não está em SOLIDES_TOKENS.` : "Nenhuma empresa em SOLIDES_TOKENS." }); return; }

  const resultado: Record<string, unknown> = {};
  for (const empresaKey of chaves) {
    try {
      resultado[empresaKey] = await sincronizarEmpresa(empresaKey, empresas[empresaKey], desde, ate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultado[empresaKey] = { erro: msg };
      await firestoreAtualizar("ptrpSyncState", empresaKey, { ok: false, erro: msg, ultimaSync: new Date().toISOString() }).catch(() => {});
    }
  }
  res.status(200).json({ ok: true, resultado });
}
