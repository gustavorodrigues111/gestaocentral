// Etiquetas da Produção SISP em PDF (100×150 mm, 1 etiqueta por página) —
// versão hardware-free: gera o PDF e abre numa aba (imprimir/salvar pelo
// navegador). Quando a ponte da estação (LP01/Elgin, TSPL) estiver pronta,
// troca-se o sink por envio de comando cru; o layout e os dados ficam.
//
//   [E4] SISP oficial  — nível LOTE, 1 por pacote (produto, lote, fab/val,
//                        conservação, nº SISP, QR do lote). SEM peso — o peso
//                        vive na etiqueta de varejo, pesado na loja.
//   [E5] Master        — saco master do romaneio (destino, peso total, qtd,
//                        lote) p/ conferência de entrada.
//   [E6] Varejo        — nível PACOTE ÚNICO, nasce na entrada da loja ao pesar
//                        (nome vulgar+científico, peso, lote, validade, QR da peça).
import QRCode from "qrcode";
import type { jsPDF as JsPDFType } from "jspdf";

// Dimensões da mídia (térmica 100×150 mm).
const W = 100, H = 150, MX = 6;
const dataBR = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

// URL pública do rastreio (QR). F5 serve essa rota ao consumidor; por ora é só
// o payload do QR, legível e único.
export function urlLote(codigo: string) { return `https://planejamento.app/sisp/l/${encodeURIComponent(codigo)}`; }
export function urlPeca(id: string) { return `https://planejamento.app/sisp/p/${encodeURIComponent(id)}`; }

async function qr(texto: string, px = 320): Promise<string> {
  try { return await QRCode.toDataURL(texto, { margin: 0, width: px, errorCorrectionLevel: "M" }); }
  catch { return ""; }
}

async function novoDoc(): Promise<{ jsPDF: typeof import("jspdf").jsPDF; doc: JsPDFType }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [W, H] });
  return { jsPDF, doc };
}

// Abre o PDF numa nova aba (no mobile cai no visualizador nativo → imprimir/salvar).
export function abrirPDF(doc: JsPDFType) {
  const url = URL.createObjectURL(doc.output("blob"));
  const w = window.open(url, "_blank");
  if (!w) { // popup bloqueado → força download
    const a = document.createElement("a");
    a.href = url; a.download = "etiquetas-sisp.pdf"; a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function linha(doc: JsPDFType, y: number) { doc.setDrawColor(150); doc.line(MX, y, W - MX, y); }

// ── [E4] SISP oficial (nível lote), 1 página por pacote ──────────────────────
export type EtqSispArgs = {
  razaoSocial?: string | null; registroSisp?: string | null; cnpj?: string | null;
  produto: string;             // espécie — corte
  especieCientifico?: string | null;
  codigoLote: string; fabricacaoISO: string; validadeISO?: string | null;
  conservacao: string;         // "Ultracongelado" | "Refrigerado"
  qtd: number;                 // nº de etiquetas (= nº de pacotes do lote)
};

export async function etiquetaSispPDF(a: EtqSispArgs): Promise<JsPDFType> {
  const { doc } = await novoDoc();
  const qrImg = await qr(urlLote(a.codigoLote));
  const n = Math.max(1, Math.round(a.qtd || 1));
  for (let i = 0; i < n; i++) {
    if (i > 0) doc.addPage([W, H], "portrait");
    let y = 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text((a.razaoSocial || "Produção SISP").toUpperCase(), MX, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`SISP nº ${a.registroSisp || "—"}${a.cnpj ? `   CNPJ ${a.cnpj}` : ""}`, MX, y); y += 3;
    linha(doc, y); y += 6;

    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.splitTextToSize(a.produto, W - 2 * MX).slice(0, 2).forEach((ln: string) => { doc.text(ln, MX, y); y += 6; });
    if (a.especieCientifico) { doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.text(a.especieCientifico, MX, y); y += 5; }

    y += 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`LOTE ${a.codigoLote}`, MX, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Fab.: ${dataBR(a.fabricacaoISO)}`, MX, y);
    doc.text(`Val.: ${dataBR(a.validadeISO)}`, W / 2, y); y += 6;
    doc.text(`Conservação: ${a.conservacao}`, MX, y); y += 6;
    doc.setFontSize(7); doc.setTextColor(90);
    doc.splitTextToSize("Peso líquido declarado na etiqueta de venda (pesado na loja). Produto sem glaciamento.", W - 2 * MX).forEach((ln: string) => { doc.text(ln, MX, y); y += 3.4; });
    doc.setTextColor(0);

    if (qrImg) doc.addImage(qrImg, "PNG", W - MX - 30, H - 36, 30, 30);
    doc.setFontSize(6); doc.setTextColor(120);
    doc.text(`${i + 1}/${n}`, MX, H - 6);
    doc.setTextColor(0);
  }
  return doc;
}

// ── [E5] Master do romaneio (saco por destino) ───────────────────────────────
export type EtqMasterArgs = {
  razaoSocial?: string | null;
  destino: string; tipo: string;        // "Transferência" | "Venda"
  produtoResumo: string;                // ex.: "Pescada — Filé c/ pele"
  lotes: string[];                      // códigos de lote no saco
  pesoTotalKg: number; qtdPacotes: number;
  romaneioId: string; expedidoISO: string;
};

export async function etiquetaMasterPDF(a: EtqMasterArgs): Promise<JsPDFType> {
  const { doc } = await novoDoc();
  const qrImg = await qr(a.romaneioId);
  let y = 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("SACO MASTER · EXPEDIÇÃO", MX, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text((a.razaoSocial || "Produção SISP"), MX, y); y += 3; linha(doc, y); y += 6;

  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`→ ${a.destino}`, MX, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`${a.tipo} · ${dataBR(a.expedidoISO)}`, MX, y); y += 7;

  doc.splitTextToSize(a.produtoResumo, W - 2 * MX).forEach((ln: string) => { doc.text(ln, MX, y); y += 5; });
  y += 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(`${a.qtdPacotes} pacotes`, MX, y); y += 7;
  doc.text(`${a.pesoTotalKg.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`, MX, y); y += 8;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(90);
  doc.text("Lotes:", MX, y); y += 3.4;
  doc.splitTextToSize(a.lotes.join(", ") || "—", W - 2 * MX).forEach((ln: string) => { doc.text(ln, MX, y); y += 3.4; });
  doc.setTextColor(0);

  if (qrImg) doc.addImage(qrImg, "PNG", W - MX - 28, H - 34, 28, 28);
  doc.setFontSize(6); doc.setTextColor(120);
  doc.text("Confira qtd e peso na entrada.", MX, H - 6); doc.setTextColor(0);
  return doc;
}

// ── [E6] Varejo (pacote único serializado), 1 página por peça ────────────────
export type EtqVarejoPeca = {
  id: string; produto: string; cientifico?: string | null;
  pesoKg: number; precoKg?: number | null;
  codigoLote: string; validadeISO?: string | null; conservacao: string;
};

export async function etiquetaVarejoPDF(razaoSocial: string | null, pecas: EtqVarejoPeca[]): Promise<JsPDFType> {
  const { doc } = await novoDoc();
  for (let i = 0; i < pecas.length; i++) {
    const p = pecas[i];
    if (i > 0) doc.addPage([W, H], "portrait");
    const qrImg = await qr(urlPeca(p.id));
    let y = 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text((razaoSocial || "Peixaria").toUpperCase(), MX, y); y += 4; linha(doc, y); y += 6;

    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.splitTextToSize(p.produto, W - 2 * MX).slice(0, 2).forEach((ln: string) => { doc.text(ln, MX, y); y += 6; });
    if (p.cientifico) { doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.text(p.cientifico, MX, y); y += 5; }

    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(22);
    doc.text(`${p.pesoKg.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`, MX, y); y += 9;
    if (p.precoKg != null) {
      doc.setFontSize(10);
      const total = p.pesoKg * p.precoKg;
      doc.text(`R$ ${p.precoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg   =   R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MX, y); y += 7;
    }

    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Lote ${p.codigoLote}`, MX, y); y += 4;
    doc.text(`Val.: ${dataBR(p.validadeISO)}   ·   ${p.conservacao}`, MX, y); y += 4;
    doc.setFontSize(6); doc.setTextColor(90);
    doc.text("Peso líquido sem glaciamento. Conservar conforme indicado.", MX, y);
    doc.setTextColor(0);

    if (qrImg) doc.addImage(qrImg, "PNG", W - MX - 30, H - 36, 30, 30);
  }
  return doc;
}
