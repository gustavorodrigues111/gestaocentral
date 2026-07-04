// PDF da ficha de PRODUÇÃO (modo trabalho) — sem custo. Layout simples de
// cozinha: título, alvo, ingredientes e bases aninhadas indentadas.
import type { jsPDF as JsPDFType } from "jspdf";
import { labelUnidade } from "./unidades";
import type { ProdNode } from "./producao";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");

export async function gerarFichaProducaoPDF(node: ProdNode): Promise<JsPDFType> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MX = 14;
  let y = 18;
  const quebra = (h: number) => { if (y + h > pageH - 14) { doc.addPage(); y = 18; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(31, 41, 55);
  doc.text(UP(node.nome), MX, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(90, 90, 90);
  doc.text(`Produzir: ${fmtQtd(node.alvoQtd)} ${labelUnidade(node.alvoUnidade)}`, MX, y); y += 4;
  doc.setDrawColor(220, 220, 220); doc.line(MX, y, pageW - MX, y); y += 6;

  const render = (n: ProdNode, nivel: number) => {
    const ind = MX + nivel * 6;
    if (nivel > 0) {
      quebra(8);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(107, 33, 168);
      doc.text(`[BASE] ${UP(n.nome)} — ${fmtQtd(n.alvoQtd)} ${labelUnidade(n.alvoUnidade)}`, ind, y); y += 5;
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
    for (const i of n.ingredientes) {
      quebra(5.5);
      const qtd = i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`;
      doc.text(`• ${UP(i.nome)}`, ind + 2, y);
      doc.text(qtd, pageW - MX, y, { align: "right" });
      y += 5;
    }
    for (const i of n.subprodutos) {
      quebra(5.5);
      const qtd = i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`;
      doc.setTextColor(180, 83, 9);
      doc.text(`  ↳ ${UP(i.nome)}`, ind + 2, y);
      doc.text(qtd, pageW - MX, y, { align: "right" });
      doc.setTextColor(40, 40, 40);
      y += 5;
    }
    for (const b of n.bases) render(b, nivel + 1);
    if (n.modoPreparo && n.modoPreparo.trim()) {
      doc.setFontSize(9); doc.setTextColor(110, 110, 110);
      const linhas = doc.splitTextToSize(`Preparo: ${n.modoPreparo}`, pageW - MX - ind - 2) as string[];
      for (const l of linhas) { quebra(4.5); doc.text(l, ind + 2, y); y += 4.2; }
      doc.setFontSize(10); doc.setTextColor(40, 40, 40); y += 1.5;
    }
    y += 2;
  };
  render(node, 0);
  return doc;
}
