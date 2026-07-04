// PDF da ficha de PRODUÇÃO (modo trabalho) — sem custo. Tabelas por nível
// (ficha e cada base), com título, rendimento-alvo e ingredientes. jsPDF +
// autoTable, lazy-loaded.
import type { jsPDF as JsPDFType } from "jspdf";
import { labelUnidade } from "./unidades";
import type { ProdNode } from "./producao";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");

const INDIGO: [number, number, number] = [67, 56, 202];
const PURPLE: [number, number, number] = [107, 33, 168];
const DARK: [number, number, number] = [31, 41, 55];
const GRAY: [number, number, number] = [110, 110, 110];

export async function gerarFichaProducaoPDF(node: ProdNode): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MX = 14;
  let y = 18;
  const quebra = (h: number) => { if (y + h > pageH - 14) { doc.addPage(); y = 18; } };

  // Cabeçalho da ficha
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text(UP(node.nome), MX, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...INDIGO);
  doc.text(`Produzir: ${fmtQtd(node.alvoQtd)} ${labelUnidade(node.alvoUnidade)}`, MX, y); y += 4;
  doc.setDrawColor(210, 210, 210); doc.line(MX, y, pageW - MX, y); y += 6;

  const render = (n: ProdNode, nivel: number) => {
    const ind = MX + nivel * 5;
    if (nivel > 0) {
      quebra(10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...PURPLE);
      doc.text(`BASE · ${UP(n.nome)}`, ind, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
      doc.text(`produzir ${fmtQtd(n.alvoQtd)} ${labelUnidade(n.alvoUnidade)}`, pageW - MX, y, { align: "right" });
      y += 4;
    }
    const body = [
      ...n.ingredientes.map(i => [UP(i.nome), i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`]),
      ...n.subprodutos.map(i => [`↳ ${UP(i.nome)}`, i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`]),
    ];
    if (body.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [["Ingrediente", "Quantidade"]],
        body,
        theme: "grid",
        margin: { left: ind, right: MX },
        styles: { fontSize: 9, cellPadding: 1.6, textColor: DARK, lineColor: [225, 225, 225] },
        headStyles: { fillColor: [243, 244, 246], textColor: GRAY, fontStyle: "bold", fontSize: 8 },
        columnStyles: { 1: { halign: "right", cellWidth: 34 } },
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 3;
    }
    if (n.modoPreparo && n.modoPreparo.trim()) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...GRAY);
      const linhas = doc.splitTextToSize(`Preparo: ${n.modoPreparo}`, pageW - MX - ind) as string[];
      for (const l of linhas) { quebra(4.5); doc.text(l, ind, y); y += 4.2; }
      doc.setFont("helvetica", "normal"); y += 1;
    }
    y += 2;
    for (const b of n.bases) render(b, nivel + 1);
  };
  render(node, 0);
  return doc;
}
