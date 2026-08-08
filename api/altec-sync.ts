// ════════════════════════════════════════════════════════════════════════════
//  /api/altec-sync — CONECTOR Altec/Riser (PDV/vendas) → planejamento.app
//
//  O Riser (pubabar.r3.riser.com.br) é um painel PHP com sessão por cookie (sem
//  API pública). A gente FAZ LOGIN HEADLESS (puppeteer) com a credencial do
//  restaurante (secret), e chama o endpoint interno do dashboard gerencial:
//    /php/painel/dashboardData.php?mode=data_gerencial&period=d&date=DD/MM/AAAA&rank_by=q
//  que devolve JSON com faturamento, itens, ticket, ranking de produtos, por
//  hora, formas de pagamento e categorias. Roda por cron (faturamento ao vivo).
//
//  Vínculo por restaurante:
//    • credenciais (secrets Vercel): ALTEC_<credKey>_USER / ALTEC_<credKey>_PASS
//    • host + credKey: em restaurants/{id}.altec = { ativo, host, credKey }
//      (fallback BUILTIN por nome enquanto não semeado).
//
//  Grava em vendasAltec/{rid}_{YYYY-MM-DD} (upsert). Status em altecSyncStatus/{rid}.
//  Abastece Fechamento de Caixa/Conciliação, Gorjetas (valorBruto) e o agente
//  de vendas. Puxa o dia atual + alguns dias pra trás por execução.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { firestoreDisponivel, firestoreListar, firestoreLer, firestoreAtualizar } from "./_firestoreRest.js";
import { requireUser } from "./_auth.js";

export const config = { maxDuration: 300 };

// Fallback enquanto restaurants/{id}.altec não é semeado.
const BUILTIN: Array<{ match: RegExp; host: string; credKey: string }> = [
  { match: /puba/i, host: "pubabar.r3.riser.com.br", credKey: "PUBA" },
];

const DIAS_SYNC = 3;   // hoje + 2 dias atrás por execução (ao vivo + recentes)

// "23.229,00" → 23229.00 ; "0,00" → 0 ; número → número.
function moneyBR(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}
const intBR = (v: unknown): number => { const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10); return isFinite(n) ? n : 0; };

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const ddmmaaaa = (d: Date): string => { const [y, m, dd] = ymd(d).split("-"); return `${dd}/${m}/${y}`; };

type Rank = { col1?: string; col2?: string; col3?: string; col4?: string };
type Gerencial = {
  vend_fat?: string; vend_fat_liq?: string; ticket_med?: string; ticket_pessoa?: string;
  vend_open?: string; num_cupons?: string; num_pessoas?: string; itens_vend?: string | number;
  pag_cre?: string; pag_deb?: string; pag_din?: string; pag_out?: string;
  rank_vend?: Rank[]; vend_catg?: Array<{ name?: string; value?: number }>;
  top_10_catg?: { name?: string[]; value?: number[] };
  forms_pag?: Array<{ name?: string; value?: number }>;
  canal_vend?: { name?: string[]; value?: number[] };
  vend_h?: number[];
};

// Login headless no Riser + busca o dashboard gerencial de N dias. Reusa a
// sessão (cookie PHP) via fetch dentro da própria página.
async function puxarAltec(host: string, user: string, pass: string, dias: string[]): Promise<{ ok: boolean; erro?: string; dados: Record<string, Gerencial> }> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true, defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.goto(`https://${host}/`, { waitUntil: "networkidle2", timeout: 45000 });
    // Form de login (SmartAdmin/Riser): 1º input de texto = usuário, input password = senha.
    await page.waitForSelector('input[type="password"]', { timeout: 25000 });
    const userSel = 'input[type="text"], input[type="email"], input[name*="login" i], input[name*="usuario" i], input[name*="user" i]';
    await page.type(userSel, user, { delay: 25 });
    await page.type('input[type="password"]', pass, { delay: 25 });
    await Promise.all([
      page.click('button[type="submit"], input[type="submit"], .btn-primary, button.btn').catch(() => {}),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    ]);
    // Confirma login: o endpoint responde JSON só logado.
    const dados: Record<string, Gerencial> = {};
    for (const iso of dias) {
      const [y, m, d] = iso.split("-");
      const dataParam = `${d}/${m}/${y}`;
      const j = await page.evaluate(async (dt) => {
        try {
          const r = await fetch(`/php/painel/dashboardData.php?mode=data_gerencial&period=d&date=${encodeURIComponent(dt)}&rank_by=q`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
          if (!r.ok) return { __erro: `HTTP ${r.status}` };
          const txt = await r.text();
          try { return JSON.parse(txt); } catch { return { __erro: "não-JSON (login falhou?): " + txt.slice(0, 80) }; }
        } catch (e) { return { __erro: String(e) }; }
      }, dataParam) as Gerencial & { __erro?: string };
      if (j && j.__erro) return { ok: false, erro: j.__erro, dados };
      dados[iso] = j;
    }
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), dados: {} };
  } finally { if (browser) await browser.close().catch(() => {}); }
}

// Mapeia o JSON gerencial → nosso doc de vendas do dia.
function mapDia(rid: string, iso: string, g: Gerencial, nowIso: string): Record<string, unknown> {
  const rank = (g.rank_vend || []).map((r) => ({ nome: (r.col1 || "").trim(), qtd: intBR(r.col2), pct: moneyBR(r.col3), valor: moneyBR(r.col4) }));
  const cat = g.top_10_catg && Array.isArray(g.top_10_catg.name)
    ? g.top_10_catg.name.map((n, i) => ({ nome: n, valor: (g.top_10_catg!.value || [])[i] || 0 }))
    : (g.vend_catg || []).map((c) => ({ nome: c.name || "", valor: c.value || 0 }));
  return {
    id: `${rid}_${iso}`, restaurantId: rid, data: iso, origem: "altec",
    faturamento: moneyBR(g.vend_fat), faturamentoLiquido: moneyBR(g.vend_fat_liq),
    vendasAberto: moneyBR(g.vend_open),
    ticketMedio: moneyBR(g.ticket_med), ticketPorPessoa: moneyBR(g.ticket_pessoa),
    numCupons: intBR(g.num_cupons), numPessoas: intBR(g.num_pessoas), itensVendidos: intBR(g.itens_vend),
    pagCredito: moneyBR(g.pag_cre), pagDebito: moneyBR(g.pag_deb), pagDinheiro: moneyBR(g.pag_din), pagOutros: moneyBR(g.pag_out),
    formasPagamento: (g.forms_pag || []).map((f) => ({ nome: f.name || "", qtd: f.value || 0 })),
    canais: g.canal_vend && Array.isArray(g.canal_vend.name) ? g.canal_vend.name.map((n, i) => ({ nome: n, qtd: (g.canal_vend!.value || [])[i] || 0 })) : [],
    rankProdutos: rank, categorias: cat, vendasPorHora: Array.isArray(g.vend_h) ? g.vend_h : [],
    atualizadoEm: nowIso,
  };
}

async function sincronizarUm(a: { rid: string; nome: string; host: string; credKey: string }): Promise<Record<string, unknown>> {
  const user = process.env[`ALTEC_${a.credKey}_USER`];
  const pass = process.env[`ALTEC_${a.credKey}_PASS`];
  if (!user || !pass) return { rid: a.rid, nome: a.nome, erro: `faltam secrets ALTEC_${a.credKey}_USER / _PASS` };

  const hoje = new Date();
  const dias: string[] = [];
  for (let i = 0; i < DIAS_SYNC; i++) dias.push(ymd(new Date(hoje.getTime() - i * 86400000)));

  const r = await puxarAltec(a.host, user, pass, dias);
  if (!r.ok) return { rid: a.rid, nome: a.nome, erro: r.erro || "falha no login/consulta" };

  const nowIso = new Date().toISOString();
  let gravados = 0;
  for (const iso of dias) {
    const g = r.dados[iso];
    if (!g) continue;
    await firestoreAtualizar("vendasAltec", `${a.rid}_${iso}`, mapDia(a.rid, iso, g, nowIso)).catch(() => {});
    gravados++;
  }
  const hojeIso = ymd(hoje);
  const fatHoje = moneyBR(r.dados[hojeIso]?.vend_fat);
  return { rid: a.rid, nome: a.nome, dias: gravados, faturamentoHoje: fatHoje };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cron do Vercel (x-vercel-cron) | secret (?key) | usuário logado (botão forçar).
  const secret = process.env.CRON_SECRET;
  const ehCron = !!req.headers["x-vercel-cron"];
  let autorizado = ehCron || !secret || req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
  if (!autorizado) { try { await requireUser(req); autorizado = true; } catch { /* não é usuário */ } }
  if (!autorizado) { res.status(401).json({ error: "não autorizado" }); return; }
  if (!firestoreDisponivel()) { res.status(503).json({ error: "Firestore indisponível (faltam credenciais de service account)." }); return; }
  const soRid = typeof req.query.rid === "string" ? req.query.rid : "";

  try {
    const restaurantes = await firestoreListar("restaurants");
    const alvos: Array<{ rid: string; nome: string; host: string; credKey: string }> = [];
    for (const r of restaurantes) {
      const rid = String(r.id || "");
      const nome = String((r as { nome?: unknown }).nome || "");
      const g = (r as { altec?: { ativo?: boolean; host?: string; credKey?: string } }).altec;
      if (g && g.ativo && g.host && g.credKey) { alvos.push({ rid, nome, host: String(g.host), credKey: String(g.credKey) }); continue; }
      const b = BUILTIN.find((x) => x.match.test(nome));
      if (b) alvos.push({ rid, nome, host: b.host, credKey: b.credKey });
    }
    const alvosFiltrados = soRid ? alvos.filter((a) => a.rid === soRid) : alvos;
    if (!alvosFiltrados.length) { res.status(200).json({ ok: true, aviso: "nenhum restaurante com Altec configurado", resultado: [] }); return; }

    const resultado: Array<Record<string, unknown>> = [];
    for (const a of alvosFiltrados) {
      let r: Record<string, unknown>;
      try { r = await sincronizarUm(a); }
      catch (e) { r = { rid: a.rid, nome: a.nome, erro: e instanceof Error ? e.message : String(e) }; }
      await firestoreAtualizar("altecSyncStatus", a.rid, {
        id: a.rid, restaurantId: a.rid, nome: a.nome, atualizadoEm: new Date().toISOString(),
        dias: Number(r.dias || 0), faturamentoHoje: Number(r.faturamentoHoje || 0), ok: !r.erro, erro: r.erro ? String(r.erro) : "",
      }).catch(() => {});
      resultado.push(r);
    }
    res.status(200).json({ ok: true, resultado });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "falha no sync" });
  }
}
