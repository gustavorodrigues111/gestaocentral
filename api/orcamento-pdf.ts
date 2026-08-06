// ════════════════════════════════════════════════════════════════════════════
//  /api/orcamento-pdf — gera o PDF do ORÇAMENTO de evento (cliente-facing) via
//  navegador headless (puppeteer-core + @sparticuz/chromium). O HTML é montado
//  aqui a partir dos dados da proposta (enviados pelo app), no visual do Lobozó
//  (Fraunces/Inter). Sobe no Storage e devolve a URL.
//
//  Body: { rid, dados } — `dados` é o orçamento já composto pelo app.
// ════════════════════════════════════════════════════════════════════════════
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { subirStorage } from "./_firestoreRest.js";

export const config = { maxDuration: 90 };

type VercelReq = { method?: string; body?: unknown };
type VercelRes = { status: (c: number) => VercelRes; json: (b: unknown) => void };
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

type LinhaOrc = { descricao: string; valor: string };   // já formatado "R$ 1.500"
type OrcamentoDados = {
  restauranteNome?: string;
  endereco?: string[];          // linhas do cabeçalho (rua, bairro/cidade)
  logoUrl?: string;
  clienteNome?: string;
  dataEvento?: string;          // "dd/mm/aaaa (sáb)"
  horario?: string;
  numConvidados?: number | string;
  espaco?: string;
  formato?: string;
  linhas?: LinhaOrc[];          // itens do valor
  totalLabel?: string;          // "Total do evento"
  total?: string;               // "R$ 12.340"
  precoPorPessoa?: string;      // "R$ 260 / pessoa" (opcional)
  condicoes?: string[];         // bullets (validade, pagamento, política)
  inclusos?: string[];
  observacoes?: string;
  geradoEm?: string;            // "21 de agosto de 2026, 14:03"
  // Detalhamento (pacote do site): cardápio do menu + bebidas inclusas.
  cardapio?: { titulo: string; tagline?: string; blocos: { label: string; itens: string[] }[] };
  bebidas?: { soft: { title: string; items: string[] }; alcohol?: { title: string; tagline?: string; items: string[] }; note?: string };
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

function buildOrcamentoHtml(d: OrcamentoDados): string {
  const linhas = (d.linhas || []).map((l) => `<tr><td>${esc(l.descricao)}</td><td class="v">${esc(l.valor)}</td></tr>`).join("");
  const dados = [
    d.dataEvento ? ["Data", d.dataEvento] : null,
    d.horario ? ["Horário", d.horario] : null,
    d.numConvidados != null ? ["Convidados", String(d.numConvidados)] : null,
    d.espaco ? ["Espaço", d.espaco] : null,
    d.formato ? ["Formato", d.formato] : null,
  ].filter(Boolean).map((r) => `<div class="row"><span class="label">${esc((r as string[])[0])}</span><span class="value">${esc((r as string[])[1])}</span></div>`).join("");
  const inclusos = (d.inclusos || []).length ? `<div class="pdf-section"><h2>Incluso</h2><ul class="pdf-list">${(d.inclusos || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : "";
  const cond = (d.condicoes || []).length ? `<div class="pdf-conditions"><div class="pdf-conditions-title">Condições</div><ul>${(d.condicoes || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "";
  const obs = d.observacoes ? `<div class="pdf-section"><h2>Observações</h2><p style="font-family:'Fraunces',serif;font-size:13px;line-height:1.55;color:#0A0A0A">${esc(d.observacoes)}</p></div>` : "";
  const header = d.logoUrl
    ? `<img src="${esc(d.logoUrl)}" alt="${esc(d.restauranteNome)}" />`
    : `<div style="font-family:'Fraunces',serif;font-weight:600;font-size:24px">${esc(d.restauranteNome || "")}</div>`;

  const bloco = (label: string, itens: string[], tagline?: string) =>
    `<div class="pdf-bloco"><div class="pdf-bloco-label">${esc(label)}</div>${tagline ? `<div class="pdf-bloco-tag">${esc(tagline)}</div>` : ""}<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
  const cardapioSec = d.cardapio
    ? `<div class="pdf-section"><h2>${esc(d.cardapio.titulo)}</h2>${d.cardapio.tagline ? `<p class="pdf-tagline">${esc(d.cardapio.tagline)}</p>` : ""}${d.cardapio.blocos.map((b) => bloco(b.label, b.itens)).join("")}</div>`
    : "";
  const bebidasSec = d.bebidas
    ? `<div class="pdf-section"><h2>Bebidas incluídas</h2>${bloco(d.bebidas.soft.title, d.bebidas.soft.items)}${d.bebidas.alcohol ? bloco(d.bebidas.alcohol.title, d.bebidas.alcohol.items, d.bebidas.alcohol.tagline) : ""}${d.bebidas.note ? `<div class="pdf-conditions" style="margin-top:8px"><div class="pdf-conditions-title">Fora do pacote</div><div style="font-family:'Fraunces',serif;font-size:13px">${esc(d.bebidas.note)}</div></div>` : ""}</div>`
    : "";

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Fraunces', serif; color: #0A0A0A; background: #fff; margin: 0; padding: 0; font-size: 14px; line-height: 1.55; }
  .pdf-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0A0A0A; padding-bottom: 16px; margin-bottom: 24px; }
  .pdf-header img { height: 46px; width: auto; }
  .pdf-header-meta { text-align: right; font-family: 'Inter', sans-serif; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #4A4A4A; line-height: 1.7; }
  h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 32px; letter-spacing: -0.02em; margin: 0 0 8px 0; }
  h1 em { color: #782827; font-style: italic; }
  h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; letter-spacing: -0.015em; margin: 0 0 12px 0; }
  .pdf-cliente-header { font-family: 'Fraunces', serif; font-size: 14px; font-style: italic; color: #4A4A4A; margin: 0 0 24px 0; padding-bottom: 12px; border-bottom: 1px dotted rgba(10,10,10,.2); }
  .pdf-cliente-header strong { font-style: normal; font-weight: 600; color: #0A0A0A; }
  .pdf-section { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(10,10,10,.1); }
  .pdf-section:last-of-type { border-bottom: none; }
  .pdf-dados { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .pdf-dados .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted rgba(10,10,10,.15); }
  .pdf-dados .label { font-family: 'Inter', sans-serif; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #4A4A4A; }
  .pdf-dados .value { font-family: 'Fraunces', serif; font-weight: 500; color: #0A0A0A; text-align: right; }
  .pdf-values { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .pdf-values td { padding: 10px 4px; border-bottom: 1px solid rgba(10,10,10,.1); font-family: 'Fraunces', serif; }
  .pdf-values td.v { text-align: right; font-family: 'Inter', sans-serif; font-weight: 500; white-space: nowrap; }
  .pdf-values tr.total td { border-top: 2px solid #0A0A0A; border-bottom: none; padding-top: 14px; font-weight: 600; font-size: 16px; }
  .pdf-values tr.total td.v { color: #782827; }
  .pdf-pp { text-align: right; font-family: 'Inter', sans-serif; font-size: 11px; color: #4A4A4A; letter-spacing: .04em; }
  .pdf-list { margin: 0; padding-left: 18px; font-family: 'Fraunces', serif; font-size: 13px; }
  .pdf-list li { padding: 2px 0; }
  .pdf-tagline { font-family: 'Fraunces', serif; font-style: italic; font-size: 14px; color: #4A4A4A; margin: -4px 0 12px 0; }
  .pdf-bloco { margin-bottom: 12px; }
  .pdf-bloco-label { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #782827; margin-bottom: 6px; }
  .pdf-bloco-tag { font-family: 'Fraunces', serif; font-style: italic; font-size: 12px; color: #4A4A4A; margin-bottom: 6px; }
  .pdf-bloco ul { margin: 0; padding-left: 16px; }
  .pdf-bloco li { font-family: 'Fraunces', serif; font-size: 13px; line-height: 1.5; padding: 1px 0; }
  .pdf-conditions { background: rgba(120,40,39,.05); border-left: 2px solid #782827; padding: 12px 14px; margin-top: 8px; }
  .pdf-conditions-title { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #782827; margin-bottom: 6px; }
  .pdf-conditions ul { margin: 0; padding-left: 18px; font-family: 'Fraunces', serif; font-size: 13px; }
  .pdf-conditions li { padding: 2px 0; }
  .pdf-foot { margin-top: 26px; font-family: 'Inter', sans-serif; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #9a9a9a; text-align: center; }
</style></head><body>
  <div class="pdf-header">
    ${header}
    <div class="pdf-header-meta">${(d.endereco || []).map((e) => `<div>${esc(e)}</div>`).join("")}</div>
  </div>
  <h1>Orçamento · <em>Evento</em></h1>
  <div class="pdf-cliente-header">Para <strong>${esc(d.clienteNome || "—")}</strong>${d.geradoEm ? ` · ${esc(d.geradoEm)}` : ""}</div>
  <div class="pdf-section"><h2>O evento</h2><div class="pdf-dados">${dados}</div></div>
  ${cardapioSec}
  ${bebidasSec}
  <div class="pdf-section">
    <h2>Valores</h2>
    <table class="pdf-values"><tbody>
      ${linhas}
      <tr class="total"><td>${esc(d.totalLabel || "Total do evento")}</td><td class="v">${esc(d.total || "—")}</td></tr>
    </tbody></table>
    ${d.precoPorPessoa ? `<div class="pdf-pp">${esc(d.precoPorPessoa)}</div>` : ""}
    ${cond}
  </div>
  ${inclusos}
  ${obs}
  <div class="pdf-foot">${esc(d.restauranteNome || "")} · orçamento sujeito a confirmação de disponibilidade</div>
</body></html>`;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { rid?: string; dados?: OrcamentoDados } | null;
  const rid = (body?.rid || "").toString().trim();
  const dados = body?.dados;
  if (!rid || !dados) { res.status(400).json({ error: "rid e dados são obrigatórios." }); return; }

  const html = buildOrcamentoHtml(dados);
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
    const path = `eventos/${rid}/orcamento_${Date.now()}.pdf`;
    const link = await subirStorage(path, base64, "application/pdf");
    if (!link) { res.status(502).json({ error: "PDF gerado mas o upload falhou." }); return; }
    res.status(200).json({ pdfUrl: link });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao gerar o PDF." });
  } finally {
    try { await browser?.close(); } catch { /* ok */ }
  }
}
