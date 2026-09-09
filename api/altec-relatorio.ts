// ════════════════════════════════════════════════════════════════════════════
//  /api/altec-relatorio — Relatórios Gerenciais do Altec/Riser (AO VIVO).
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
//  Params: ?rid=<id>&di=YYYY-MM-DD&df=YYYY-MM-DD[&status=E|C|*][&snapshot=1]
//    • status = E (Encerrado = caixa fechado, default) | C (Cancelado) | * (todos)
//    • quando di/df cobrem exatamente 1 mês, grava snapshot
//      vendasProdutoAltec/{rid}_{YYYY-MM} (pro agente e telas lerem barato).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { firestoreDisponivel, firestoreListar, firestoreAtualizar } from "./_firestoreRest.js";
import { requireUser } from "./_auth.js";

export const config = { maxDuration: 300 };

// Fallback enquanto restaurants/{id}.altec não é semeado (igual altec-sync).
const BUILTIN: Array<{ match: RegExp; host: string; credKey: string }> = [
  { match: /puba.*bel|bel.*puba/i, host: "pubabar.r3.riser.com.br", credKey: "PUBA" },
];

const ddmmaaaa = (iso: string): string => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

type ProdutoRel = {
  id: string; produto: string; categoria: string; qtd: number;
  valorTabela: number; descProd: number; descGlobal: number;
  fatBruto: number; fatLiquido: number; pctTotal: number; pctAcum: number; curva: string;
};
type HoraRel = { hora: string; qtd: number; fatBruto: number; fatLiquido: number; pctTotal: number; nAtend: number; nClientes: number; tkmAtend: number; tkmCliente: number };

// Faz login no Riser e roda o fetch dos relatórios DENTRO da página logada.
async function puxarRelatorio(
  host: string, user: string, pass: string,
  di: string, df: string, status: string,
): Promise<{ ok: boolean; erro?: string; produtos: ProdutoRel[]; horas: HoraRel[] }> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true, defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.goto(`https://${host}/`, { waitUntil: "networkidle2", timeout: 45000 });
    // Login: form Altec = [Container (pré-preenchido, NÃO mexer), Usuário, Senha].
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

    const diBR = ddmmaaaa(di), dfBR = ddmmaaaa(df);
    const resultado = await page.evaluate(async (diBR, dfBR, status) => {
      // pt-BR → número. "26.730,00" → 26730 ; "242,000" → 242 ; "" → 0.
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
      // Horas: Hora, Qtde, Fat.Líquido, %Total, Fat.Bruto, NºAtend, NºClientes, TKM/Atend, TKM/Cliente
      const linH = await tabela("../../php/rlt/fcx/relVendaHora.php", form({}));
      const horas = linH.filter((c) => c.length >= 9 && /^\d{1,2}:\d{2}/.test(c[0])).map((c) => ({
        hora: c[0], qtd: num(c[1]), fatLiquido: num(c[2]), pctTotal: num(c[3]), fatBruto: num(c[4]),
        nAtend: num(c[5]), nClientes: num(c[6]), tkmAtend: num(c[7]), tkmCliente: num(c[8]),
      }));
      return { produtos, horas };
    }, diBR, dfBR, status);

    // Sanidade: se veio 0 produto e 0 hora, provavelmente o login caiu.
    if (!resultado.produtos.length && !resultado.horas.length) {
      return { ok: false, erro: "relatório vazio (login pode ter falhado ou período sem venda)", produtos: [], horas: [] };
    }
    return { ok: true, produtos: resultado.produtos, horas: resultado.horas };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), produtos: [], horas: [] };
  } finally { if (browser) await browser.close().catch(() => {}); }
}

// di/df cobrem exatamente um mês-calendário? → devolve "YYYY-MM", senão "".
function competenciaSeMesInteiro(di: string, df: string): string {
  const [ay, am, ad] = di.split("-").map(Number);
  const [by, bm, bd] = df.split("-").map(Number);
  if (ay !== by || am !== bm || ad !== 1) return "";
  const ultimoDia = new Date(by, bm, 0).getDate();
  if (bd !== ultimoDia) return "";
  return `${ay}-${String(am).padStart(2, "0")}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  let autorizado = !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!autorizado) { try { await requireUser(req); autorizado = true; } catch { /* não é usuário */ } }
  if (!autorizado) { res.status(401).json({ error: "não autorizado" }); return; }
  if (!firestoreDisponivel()) { res.status(503).json({ error: "Firestore indisponível." }); return; }

  const rid = typeof req.query.rid === "string" ? req.query.rid : "";
  const di = typeof req.query.di === "string" ? req.query.di : "";
  const df = typeof req.query.df === "string" ? req.query.df : "";
  const status = (typeof req.query.status === "string" && ["E", "C", "*"].includes(req.query.status)) ? req.query.status : "E";
  if (!rid || !/^\d{4}-\d{2}-\d{2}$/.test(di) || !/^\d{4}-\d{2}-\d{2}$/.test(df)) {
    res.status(400).json({ error: "params obrigatórios: rid, di=YYYY-MM-DD, df=YYYY-MM-DD" }); return;
  }

  try {
    // Resolve host/credKey do restaurante (igual altec-sync).
    const restaurantes = await firestoreListar("restaurants");
    const r = restaurantes.find((x) => String(x.id || "") === rid);
    if (!r) { res.status(404).json({ error: "restaurante não encontrado" }); return; }
    const nome = String((r as { nome?: unknown }).nome || "");
    const g = (r as { altec?: { ativo?: boolean; host?: string; credKey?: string } }).altec;
    let host = "", credKey = "";
    if (g && g.ativo && g.host && g.credKey) { host = String(g.host); credKey = String(g.credKey); }
    else { const b = BUILTIN.find((x) => x.match.test(nome)); if (b) { host = b.host; credKey = b.credKey; } }
    if (!host || !credKey) { res.status(400).json({ error: "restaurante sem Altec configurado" }); return; }

    const user = process.env[`ALTEC_${credKey}_USER`];
    const pass = process.env[`ALTEC_${credKey}_PASS`];
    if (!user || !pass) { res.status(400).json({ error: `faltam secrets ALTEC_${credKey}_USER / _PASS` }); return; }

    const out = await puxarRelatorio(host, user, pass, di, df, status);
    if (!out.ok) { res.status(502).json({ error: out.erro || "falha no relatório" }); return; }

    const totBruto = out.produtos.reduce((s, p) => s + p.fatBruto, 0);
    const totLiquido = out.produtos.reduce((s, p) => s + p.fatLiquido, 0);
    const totQtd = out.produtos.reduce((s, p) => s + p.qtd, 0);
    const meta = { rid, nome, di, df, status, totalProdutos: out.produtos.length, totalQtd: totQtd, totalFatBruto: totBruto, totalFatLiquido: totLiquido, geradoEm: new Date().toISOString() };

    // Snapshot mensal (só quando o período é 1 mês fechado) — pro agente/telas.
    const comp = competenciaSeMesInteiro(di, df);
    if (comp) {
      await firestoreAtualizar("vendasProdutoAltec", `${rid}_${comp}`, {
        id: `${rid}_${comp}`, restaurantId: rid, competencia: comp, ...meta, produtos: out.produtos,
      }).catch(() => {});
    }

    res.status(200).json({ ok: true, meta, produtos: out.produtos, horas: out.horas });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha no relatório" });
  }
}
