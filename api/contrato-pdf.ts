// ════════════════════════════════════════════════════════════════════════════
//  /api/contrato-pdf — renderiza o TEXTO do contrato de evento (markdown-ish)
//  em PDF A4 via navegador headless (puppeteer-core + @sparticuz/chromium).
//  Sobe no Storage (eventos/{rid}/contrato_*.pdf) e devolve a URL.
//  Body: { rid, texto, titulo? }
// ════════════════════════════════════════════════════════════════════════════
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { subirStorage } from "./_firestoreRest.js";

export const config = { maxDuration: 90 };

type VercelReq = { method?: string; body?: unknown };
type VercelRes = { status: (c: number) => VercelRes; json: (b: unknown) => void };
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
// **bold** inline → <strong>
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function textoParaHtml(texto: string): string {
  const linhas = (texto || "").split("\n");
  const out: string[] = [];
  for (const raw of linhas) {
    const l = raw.replace(/\s+$/, "");
    if (l.startsWith("# ")) out.push(`<h1>${inline(l.slice(2))}</h1>`);
    else if (l.startsWith("## ")) out.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (l.trim() === "") out.push('<div class="sp"></div>');
    else if (/^\s*•/.test(l)) out.push(`<p class="item">${inline(l.trim())}</p>`);
    else if (/^_{5,}/.test(l)) out.push(`<p class="sig">${inline(l)}</p>`);
    else out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("");
}

function buildHtml(texto: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; color: #1a1a1a; background: #fff; margin: 0; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 17px; font-weight: 700; text-align: center; margin: 0 0 16px; letter-spacing: .01em; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #782827; margin: 16px 0 4px; padding-bottom: 3px; border-bottom: 1px solid rgba(0,0,0,.15); }
  p { margin: 2px 0; text-align: justify; }
  p.item { margin: 1px 0 1px 14px; }
  p.sig { margin-top: 4px; white-space: pre; }
  .sp { height: 7px; }
</style></head><body>${textoParaHtml(texto)}</body></html>`;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { rid?: string; texto?: string } | null;
  const rid = (body?.rid || "").toString().trim();
  const texto = (body?.texto || "").toString();
  if (!rid || !texto.trim()) { res.status(400).json({ error: "rid e texto são obrigatórios." }); return; }

  const html = buildHtml(texto);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 900, height: 1400, deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45000 });
    try { await page.evaluate("document.fonts && document.fonts.ready"); } catch { /* ok */ }
    const pdfBuf = await page.pdf({ format: "a4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    const base64 = Buffer.from(pdfBuf).toString("base64");
    const path = `eventos/${rid}/contrato_${Date.now()}.pdf`;
    const link = await subirStorage(path, base64, "application/pdf");
    if (!link) { res.status(502).json({ error: "PDF gerado mas o upload falhou." }); return; }
    res.status(200).json({ pdfUrl: link });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao gerar o PDF." });
  } finally {
    try { await browser?.close(); } catch { /* ok */ }
  }
}
