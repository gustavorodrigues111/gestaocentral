// Etiquetas de validade de produção (Fase 4). Uma etiqueta por ficha produzida,
// em grade 2 colunas numa folha A4, pra recortar e colar no recipiente.
// Conteúdo: produto, quantidade, produzido em, validade (dia + dias), responsável.
import type { jsPDF as JsPDFType } from "jspdf";

export type EtiquetaItem = {
  nome: string;
  qtd: string;          // já formatada com unidade (ex: "3,5 kg")
  produzidoEm: string;  // dd/mm/aaaa
  validadeEm: string;   // dd/mm/aaaa ou "" (sem validade definida)
  responsavel?: string;
};

const UP = (s: string) => (s || "").trim().toUpperCase();

export async function gerarEtiquetasPDF(
  restauranteNome: string, itens: EtiquetaItem[], copiasPorItem = 1,
): Promise<JsPDFType> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 8, gap = 4, cols = 2;
  const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const cardH = 46;
  const rowsPerPage = Math.floor((pageH - margin * 2 + gap) / (cardH + gap));
  const perPage = cols * rowsPerPage;

  // Expande cópias.
  const todas: EtiquetaItem[] = [];
  for (const it of itens) for (let c = 0; c < Math.max(1, copiasPorItem); c++) todas.push(it);

  todas.forEach((it, idx) => {
    const posNaPagina = idx % perPage;
    if (idx > 0 && posNaPagina === 0) doc.addPage();
    const col = posNaPagina % cols;
    const row = Math.floor(posNaPagina / cols);
    const x = margin + col * (cardW + gap);
    const y = margin + row * (cardH + gap);

    // Moldura tracejada.
    doc.setDrawColor(180); doc.setLineWidth(0.2);
    if (typeof (doc as unknown as { setLineDashPattern?: (p: number[], ph: number) => void }).setLineDashPattern === "function") {
      (doc as unknown as { setLineDashPattern: (p: number[], ph: number) => void }).setLineDashPattern([1, 1], 0);
    }
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "S");
    if (typeof (doc as unknown as { setLineDashPattern?: (p: number[], ph: number) => void }).setLineDashPattern === "function") {
      (doc as unknown as { setLineDashPattern: (p: number[], ph: number) => void }).setLineDashPattern([], 0);
    }

    const pad = 4;
    let cy = y + pad + 2;

    // Restaurante (topo pequeno).
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(140);
    doc.text(UP(restauranteNome || ""), x + pad, cy);
    cy += 5;

    // Nome do produto (destaque, quebra em 2 linhas se preciso).
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(20);
    const nomeLinhas = doc.splitTextToSize(UP(it.nome), cardW - pad * 2) as string[];
    doc.text(nomeLinhas.slice(0, 2), x + pad, cy);
    cy += nomeLinhas.length > 1 ? 11 : 6;

    // Quantidade.
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60);
    doc.text(`Qtd: ${it.qtd}`, x + pad, cy);
    cy += 6;

    // Produzido / validade (validade em destaque).
    doc.setFontSize(9); doc.setTextColor(60);
    doc.text(`Produzido: ${it.produzidoEm}`, x + pad, cy);
    cy += 6;
    if (it.validadeEm) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(180, 30, 30);
      doc.text(`VALIDADE: ${it.validadeEm}`, x + pad, cy);
    } else {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(150);
      doc.text("Validade: — (definir)", x + pad, cy);
    }

    // Responsável (rodapé).
    if (it.responsavel) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(140);
      doc.text(`Resp.: ${it.responsavel}`, x + pad, y + cardH - pad);
    }
  });

  if (todas.length === 0) {
    doc.setFontSize(12); doc.setTextColor(120);
    doc.text("Nenhuma ficha no plano.", pageW / 2, pageH / 2, { align: "center" });
  }
  return doc;
}
