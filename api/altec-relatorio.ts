// ════════════════════════════════════════════════════════════════════════════
//  /api/altec-relatorio — Relatório oficial "Vendas por Produto" do Altec/Riser.
//
//  Diferente do /api/altec-sync (que grava o AGREGADO do dia via
//  dashboardData.php, cujo ranking de produtos é só o TOP-10 → subconta), este
//  puxa o relatório oficial "Vendas por Produto" (relVendGroupProd2.php), que
//  devolve TODOS os produtos do período numa resposta só, com Fat. Bruto/Líquido
//  e curva ABC — a fonte correta e completa.
//
//  O relatório é HTML server-rendered (não JSON): a gente loga headless
//  (mesma sessão por cookie do sync), faz POST no endpoint com os filtros do
//  form e parseia a <table> dentro da própria página (DOMParser).
//
//  Dois modos:
//   • AO VIVO (UI): ?rid=<id>&di=YYYY-MM-DD&df=YYYY-MM-DD[&status=E|C|*]
//       → devolve { produtos, horas, meta } na hora; grava snapshot se for 1 mês.
//   • SNAPSHOT/CRON/BACKFILL: sem di/df → varre as casas Altec (ou só ?rid=)
//       e grava vendasProdutoAltec/{rid}_{YYYY-MM} do mês atual + (meses-1)
//       anteriores (?meses=N, default 1). Um login por casa, N POSTs.
//
//  status = E (Encerrado = caixa fechado, default) | C (Cancelado) | * (todos)
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { firestoreDisponivel, firestoreListar, firestoreAtualizar } from "./_firestoreRest.js";
import { requireUser } from "./_auth.js";

export const config = { maxDuration: 300 };

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;

// Fallback enquanto restaurants/{id}.altec não é semeado (igual altec-sync).
const BUILTIN: Array<{ match: RegExp; host: string; credKey: string }> = [
  { match: /puba.*bel|bel.*puba/i, host: "pubabar.r3.riser.com.br", credKey: "PUBA" },
];

const ddmmaaaa = (iso: string): string => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

type ProdutoRel = {
  id: string; produto: string; categoria: string; qtd: number;
  valorTabela: number; descProd: number; descGlobal: number;
  fatBruto: number; fatLiquido: number; pctTotal: number; pctAcum: number; curva: string;
};
type HoraRel = { hora: string; qtd: number; fatBruto: number; fatLiquido: number; pctTotal: number; nAtend: number; nClientes: number; tkmAtend: number; tkmCliente: number };

// Login no Riser: form Altec = [Container (pré-preenchido, NÃO mexer), Usuário, Senha].
async function loginRiser(page: Page, host: string, user: string, pass: string): Promise<void> {
  await page.goto(`https://${host}/`, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="password"]', { timeout: 25000 });
  const texts = await page.$$('input[type="text"], input[type="email"]');
  let userFilled = false;
  for (const el of texts) {
    const v = (await el.evaluate((n) => (n as HTMLInputElement).value || "").catch(() => "")) as string;
    if (!v.trim()) { await el.type(user, { delay: 25 }); userFilled = true; break; }
  }
  if (!userFilled && texts.length) await texts[texts.length - 1].type(user, { delay: 25 });
  await page.type('input[type="password"]', pass, { delay: 25 });
  await Promise.all([
    page.click('button[type="submit"], input[type="submit"], .btn-primary, button.btn').catch(() => {}),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
  ]);
}

// Puxa produtos (+ opcionalmente horas) de UM período, DENTRO da página logada.
async function puxarPeriodo(page: Page, di: string, df: string, status: string, comHoras: boolean): Promise<{ produtos: ProdutoRel[]; horas: HoraRel[] }> {
  const diBR = ddmmaaaa(di), dfBR = ddmmaaaa(df);
  return page.evaluate(async (diBR, dfBR, status, comHoras) => {
    const num = (s: string): number => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
    function form(extra: Record<string, string>): string {
      const fd = new URLSearchParams();
      fd.append("fcx13_dthsta#dh1", diBR); fd.append("fcx13_dthsta#dh2", "00:00:00");
      fd.append("fcx13_dthsta#dh3", dfBR); fd.append("fcx13_dthsta#dh4", "23:59:59");
      fd.append("fcx13_status", status); fd.append("type_dth", "1");
      fd.append("vend_origem", "*"); fd.append("fcx14_valsell", "0"); fd.append("fcx14_tprod", "V");
      for (const k in extra) fd.append(k, extra[k]);
      return fd.toString();
    }
    async function tabela(endpoint: string, body: string): Promise<string[][]> {
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body });
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim()));
    }
    // Produtos (type_rel=3 = Sintético por Produto): ID, Produto, Categoria,
    // Qtde, Vl.Tabela, Desc.Prod, Desc.Global, Fat.Bruto, Fat.Líquido, %Total, %Acum, Curva
    const linP = await tabela("../../php/rlt/fcx/relVendGroupProd2.php", form({ type_rel: "3" }));
    const produtos = linP.filter((c) => c.length >= 12 && c[1]).map((c) => ({
      id: c[0], produto: c[1], categoria: c[2], qtd: num(c[3]), valorTabela: num(c[4]),
      descProd: num(c[5]), descGlobal: num(c[6]), fatBruto: num(c[7]), fatLiquido: num(c[8]),
      pctTotal: num(c[9]), pctAcum: num(c[10]), curva: c[11] || "",
    }));
    let horas: Array<{ hora: string; qtd: number; fatBruto: number; fatLiquido: number; pctTotal: number; nAtend: number; nClientes: number; tkmAtend: number; tkmCliente: number }> = [];
    if (comHoras) {
      // Horas: Hora, Qtde, Fat.Líquido, %Total, Fat.Bruto, NºAtend, NºClientes, TKM/Atend, TKM/Cliente
      const linH = await tabela("../../php/rlt/fcx/relVendaHora.php", form({}));
      horas = linH.filter((c) => c.length >= 9 && /^\d{1,2}:\d{2}/.test(c[0])).map((c) => ({
        hora: c[0], qtd: num(c[1]), fatLiquido: num(c[2]), pctTotal: num(c[3]), fatBruto: num(c[4]),
        nAtend: num(c[5]), nClientes: num(c[6]), tkmAtend: num(c[7]), tkmCliente: num(c[8]),
      }));
    }
    return { produtos, horas };
  }, diBR, dfBR, status, comHoras);
}

async function comBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true, defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    return await fn(page);
  } finally { if (browser) await browser.close().catch(() => {}); }
}

function metaDe(rid: string, nome: string, di: string, df: string, status: string, produtos: ProdutoRel[]) {
  return {
    rid, nome, di, df, status, totalProdutos: produtos.length,
    totalQtd: produtos.reduce((s, p) => s + p.qtd, 0),
    totalFatBruto: produtos.reduce((s, p) => s + p.fatBruto, 0),
    totalFatLiquido: produtos.reduce((s, p) => s + p.fatLiquido, 0),
    geradoEm: new Date().toISOString(),
  };
}
async function gravarSnapshot(rid: string, comp: string, meta: ReturnType<typeof metaDe>, produtos: ProdutoRel[]): Promise<void> {
  await firestoreAtualizar("vendasProdutoAltec", `${rid}_${comp}`, {
    id: `${rid}_${comp}`, restaurantId: rid, competencia: comp, ...meta, produtos,
  }).catch(() => {});
}

// di/df cobrem exatamente um mês-calendário? → devolve "YYYY-MM", senão "".
function competenciaSeMesInteiro(di: string, df: string): string {
  const [ay, am, ad] = di.split("-").map(Number);
  const [by, bm, bd] = df.split("-").map(Number);
  if (ay !== by || am !== bm || ad !== 1) return "";
  if (bd !== new Date(by, bm, 0).getDate()) return "";
  return `${ay}-${String(am).padStart(2, "0")}`;
}

// Início/fim (ISO) de uma competência YYYY-MM; fim limitado a hoje.
function rangeComp(comp: string): { comp: string; di: string; df: string } {
  const [y, m] = comp.split("-").map(Number);
  const di = ymd(new Date(y, m - 1, 1));
  let df = ymd(new Date(y, m, 0));
  const hojeIso = ymd(new Date());
  if (df > hojeIso) df = hojeIso;
  return { comp, di, df };
}

// Mês atual + (n-1) anteriores → [{comp,di,df}], df limitado a hoje no mês corrente.
function mesesRecentes(n: number): Array<{ comp: string; di: string; df: string }> {
  const hoje = new Date();
  const hojeIso = ymd(hoje);
  const out: Array<{ comp: string; di: string; df: string }> = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const di = ymd(new Date(y, m, 1));
    let df = ymd(new Date(y, m + 1, 0));
    if (df > hojeIso) df = hojeIso; // mês corrente: até hoje
    out.push({ comp: `${y}-${String(m + 1).padStart(2, "0")}`, di, df });
  }
  return out;
}

type Alvo = { rid: string; nome: string; host: string; credKey: string };
function resolverAlvo(r: Record<string, unknown>): Alvo | null {
  const rid = String(r.id || "");
  const nome = String((r as { nome?: unknown }).nome || "");
  const g = (r as { altec?: { ativo?: boolean; host?: string; credKey?: string } }).altec;
  if (g && g.ativo && g.host && g.credKey) return { rid, nome, host: String(g.host), credKey: String(g.credKey) };
  const b = BUILTIN.find((x) => x.match.test(nome));
  if (b) return { rid, nome, host: b.host, credKey: b.credKey };
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const ehCron = !!req.headers["x-vercel-cron"];
  let autorizado = ehCron || !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!autorizado) { try { await requireUser(req); autorizado = true; } catch { /* não é usuário */ } }
  if (!autorizado) { res.status(401).json({ error: "não autorizado" }); return; }
  if (!firestoreDisponivel()) { res.status(503).json({ error: "Firestore indisponível." }); return; }

  const rid = typeof req.query.rid === "string" ? req.query.rid : "";
  const di = typeof req.query.di === "string" ? req.query.di : "";
  const df = typeof req.query.df === "string" ? req.query.df : "";
  const status = (typeof req.query.status === "string" && ["E", "C", "*"].includes(req.query.status)) ? req.query.status : "E";

  try {
    const restaurantes = await firestoreListar("restaurants");

    // ── MODO AO VIVO (UI): rid + di + df ──────────────────────────────────
    if (rid && /^\d{4}-\d{2}-\d{2}$/.test(di) && /^\d{4}-\d{2}-\d{2}$/.test(df)) {
      const r = restaurantes.find((x) => String(x.id || "") === rid);
      if (!r) { res.status(404).json({ error: "restaurante não encontrado" }); return; }
      const alvo = resolverAlvo(r);
      if (!alvo) { res.status(400).json({ error: "restaurante sem Altec configurado" }); return; }
      const user = process.env[`ALTEC_${alvo.credKey}_USER`], pass = process.env[`ALTEC_${alvo.credKey}_PASS`];
      if (!user || !pass) { res.status(400).json({ error: `faltam secrets ALTEC_${alvo.credKey}_USER / _PASS` }); return; }

      const out = await comBrowser(async (page) => {
        await loginRiser(page, alvo.host, user, pass);
        return puxarPeriodo(page, di, df, status, true);
      }).catch((e) => ({ erro: e instanceof Error ? e.message : String(e), produtos: [] as ProdutoRel[], horas: [] as HoraRel[] }));
      if ("erro" in out) { res.status(502).json({ error: out.erro }); return; }
      if (!out.produtos.length && !out.horas.length) { res.status(502).json({ error: "relatório vazio (login pode ter falhado ou período sem venda)" }); return; }

      const meta = metaDe(rid, alvo.nome, di, df, status, out.produtos);
      const comp = competenciaSeMesInteiro(di, df);
      if (comp) await gravarSnapshot(rid, comp, meta, out.produtos);
      res.status(200).json({ ok: true, meta, produtos: out.produtos, horas: out.horas });
      return;
    }

    // ── MODO SNAPSHOT/CRON/BACKFILL: sem di/df ────────────────────────────
    // ?comps=YYYY-MM,YYYY-MM (lista explícita) OU ?meses=N (mês atual + N-1 antes).
    const compsParam = typeof req.query.comps === "string" ? req.query.comps : "";
    const periodos = compsParam
      ? compsParam.split(",").map((s) => s.trim()).filter((c) => /^\d{4}-\d{2}$/.test(c)).slice(0, 24).map(rangeComp)
      : mesesRecentes(Math.min(Math.max(parseInt(String(req.query.meses || "1"), 10) || 1, 1), 18));
    let alvos = restaurantes.map(resolverAlvo).filter((a): a is Alvo => !!a);
    if (rid) alvos = alvos.filter((a) => a.rid === rid);
    if (!alvos.length) { res.status(200).json({ ok: true, aviso: "nenhuma casa com Altec configurado", resultado: [] }); return; }

    const resultado: Array<Record<string, unknown>> = [];
    for (const alvo of alvos) {
      const user = process.env[`ALTEC_${alvo.credKey}_USER`], pass = process.env[`ALTEC_${alvo.credKey}_PASS`];
      if (!user || !pass) { resultado.push({ rid: alvo.rid, nome: alvo.nome, erro: `faltam secrets ALTEC_${alvo.credKey}_*` }); continue; }
      try {
        const gravados = await comBrowser(async (page) => {
          await loginRiser(page, alvo.host, user, pass);
          const feitos: Array<{ comp: string; produtos: number; fatBruto: number }> = [];
          for (const p of periodos) {
            const { produtos } = await puxarPeriodo(page, p.di, p.df, status, false);
            if (!produtos.length) continue;
            const meta = metaDe(alvo.rid, alvo.nome, p.di, p.df, status, produtos);
            await gravarSnapshot(alvo.rid, p.comp, meta, produtos);
            feitos.push({ comp: p.comp, produtos: produtos.length, fatBruto: meta.totalFatBruto });
          }
          return feitos;
        });
        resultado.push({ rid: alvo.rid, nome: alvo.nome, meses: gravados });
      } catch (e) {
        resultado.push({ rid: alvo.rid, nome: alvo.nome, erro: e instanceof Error ? e.message : String(e) });
      }
    }
    res.status(200).json({ ok: true, backfill: periodos.length > 1, resultado });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha no relatório" });
  }
}
