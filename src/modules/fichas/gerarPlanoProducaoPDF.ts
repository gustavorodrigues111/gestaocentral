// PDF do plano de produção: o que produzir (com responsável) + lista de insumos
// consolidada (compras). Sem custo. jsPDF + autoTable.
import type { jsPDF as JsPDFType } from "jspdf";
import type { FtFicha, FtPlanoProducao } from "../../core/types";
import type { PlanoExplosao } from "./producao";
import { labelUnidade } from "./unidades";
import { fmtBR } from "../../core/utils/date";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const DARK: [number, number, number] = [31, 41, 55];
const GRAY: [number, number, number] = [110, 110, 110];

export async function gerarPlanoProducaoPDF(
  plano: FtPlanoProducao,
  itens: { it: FtPlanoProducao["itens"][number]; ficha: FtFicha }[],
  explosao: PlanoExplosao,
): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MX = 14;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text(UP(plano.nome || "PLANO DE PRODUÇÃO"), MX, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...GRAY);
  doc.text(`Dia: ${plano.data ? fmtBR(plano.data) : "—"}`, MX, 24);

  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...DARK);
  doc.text("O que produzir", MX, 32);
  autoTable(doc, {
    startY: 35,
    head: [["Ficha", "Produzir", "Responsável"]],
    body: itens.map(({ it, ficha }) => [UP(ficha.nome), `${fmtQtd(it.qtd)} ${ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções"}`, it.responsavel || "—"]),
    theme: "grid",
    margin: { left: MX, right: MX },
    styles: { fontSize: 9, cellPadding: 1.8, textColor: DARK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: [243, 244, 246], textColor: GRAY, fontStyle: "bold", fontSize: 8 },
    columnStyles: { 1: { cellWidth: 34, halign: "right" }, 2: { cellWidth: 42 } },
  });

  let y = finalY() + 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...DARK);
  doc.text("Lista de insumos (compras)", MX, y); y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Insumo", "Total"]],
    body: explosao.insumos.map(l => [UP(l.nome), l.qb ? "q.b." : `${fmtQtd(l.qtd)} ${labelUnidade(l.unidade)}`]),
    theme: "grid",
    margin: { left: MX, right: MX },
    styles: { fontSize: 9, cellPadding: 1.8, textColor: DARK, lineColor: [225, 225, 225] },
    headStyles: { fillColor: [243, 244, 246], textColor: GRAY, fontStyle: "bold", fontSize: 8 },
    columnStyles: { 1: { cellWidth: 40, halign: "right" } },
  });

  if (explosao.subprodutos.length > 0) {
    y = finalY() + 5;
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    const t = "Usa também (sai de preparos): " + explosao.subprodutos.map(s => `${UP(s.nome)}${s.qb ? "" : ` ${fmtQtd(s.qtd)} ${labelUnidade(s.unidade)}`}`).join(", ");
    for (const l of doc.splitTextToSize(t, pageW - 2 * MX) as string[]) { doc.text(l, MX, y); y += 4; }
  }
  return doc;
}
