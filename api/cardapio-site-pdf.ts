// ════════════════════════════════════════════════════════════════════════════
//  /api/cardapio-site-pdf — renderiza o cardápio do MÓDULO em PDF via navegador
//  headless (puppeteer-core + @sparticuz/chromium). Abre a rota pública
//  /cardapio-pdf/:rid?headless=1 (que roda o MESMO render do módulo e expõe o
//  PDF em window.__CARDAPIO_PDF__), pega o base64, sobe no Storage e devolve a
//  URL. Chamado pela tool gerar_pdf_site do agente. maxDuration alto + memória
//  1024MB (config no vercel.json).
// ════════════════════════════════════════════════════════════════════════════
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { firestoreLer, subirStorage } from "./_firestoreRest.js";

export const config = { maxDuration: 90 };

type VercelReq = { method?: string; body?: unknown };
type VercelRes = { status: (c: number) => VercelRes; json: (b: unknown) => void };
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { rid?: string; menu?: string } | null;
  const rid = (body?.rid || "").toString().trim();
  const menu = (body?.menu || "").toString().trim();
  if (!rid) { res.status(400).json({ error: "rid é obrigatório." }); return; }

  // Guard: só gera se o cardápio existir (evita abrir Chromium à toa).
  const est = await firestoreLer("cardapioEstruturado", rid);
  if (!est) { res.status(404).json({ error: "Cardápio não encontrado para este restaurante." }); return; }
  const rest = (await firestoreLer("restaurants", rid)) as { nome?: string } | null;
  const nome = (rest?.nome || "").toString();

  const origin = process.env.APP_ORIGIN || "https://admin.planejamento.app";
  const url = `${origin}/cardapio-pdf/${encodeURIComponent(rid)}?headless=1&menu=${encodeURIComponent(menu)}&nome=${encodeURIComponent(nome)}`;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 900, height: 1400, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Espera o render terminar e expor o base64 (ou o erro).
    await page.waitForFunction(
      "!!window.__CARDAPIO_PDF__ || !!window.__CARDAPIO_PDF_ERR__",
      { timeout: 50000, polling: 500 },
    );
    const out = (await page.evaluate(
      "({ pdf: window.__CARDAPIO_PDF__ || null, err: window.__CARDAPIO_PDF_ERR__ || null })",
    )) as { pdf: string | null; err: string | null };
    if (!out.pdf) { res.status(502).json({ error: "Render do cardápio falhou: " + (out.err || "sem PDF") }); return; }

    const path = `cardapios/${rid}/agente_${(menu || "cardapio").toLowerCase().replace(/[^a-z0-9]/g, "")}_${Date.now()}.pdf`;
    const link = await subirStorage(path, out.pdf, "application/pdf");
    if (!link) { res.status(502).json({ error: "PDF gerado mas o upload falhou." }); return; }
    res.status(200).json({ pdfUrl: link });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao gerar o PDF." });
  } finally {
    try { await browser?.close(); } catch { /* ok */ }
  }
}
