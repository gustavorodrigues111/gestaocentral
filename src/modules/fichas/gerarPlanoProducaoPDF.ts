// PDF do plano de produção:
//  · Página 1 — resumo: o que produzir (com responsável) + lista de insumos.
//  · Uma página POR FICHA — ficha de produção (ingredientes escalados + bases +
//    modo de preparo). Cada ficha cabe SEMPRE em UMA página (fonte auto-ajustada
//    ao volume) e nunca divide/junta com outra. Sem custo. jsPDF + autoTable.
import type { jsPDF as JsPDFType } from "jspdf";
import type { FtFicha, FtPlanoProducao } from "../../core/types";
import type { PlanoExplosao, ProdNode } from "./producao";
import { labelUnidade } from "./unidades";
import { fmtBR } from "../../core/utils/date";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const DARK: [number, number, number] = [31, 41, 55];
const GRAY: [number, number, number] = [110, 110, 110];
const PURPLE: [number, number, number] = [107, 33, 168];

type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };

// Fonte que faz o conteúdo caber numa página só, conforme o nº de linhas.
function fitFont(linhas: number): number {
  if (linhas <= 22) return 11;
  if (linhas <= 30) return 10;
  if (linhas <= 38) return 9;
  if (linhas <= 48) return 8;
  if (linhas <= 62) return 7;
  return 6;
}

// Achata a ficha (ingredientes + bases aninhadas + modo de preparo) em linhas de
// tabela e conta as linhas aproximadas (pra escolher a fonte).
function coletarRows(node: ProdNode, nivel: number, rows: Cell[][], estado: { linhas: number }): void {
  const ind = "   ".repeat(nivel);
  for (const i of node.ingredientes) {
    rows.push([{ content: ind + UP(i.nome) }, { content: i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`, styles: { halign: "right" } }]);
    estado.linhas += 1;
  }
  for (const s of node.subprodutos) {
    rows.push([{ content: `${ind}↳ ${UP(s.nome)}` }, { content: s.qb ? "q.b." : `${fmtQtd(s.qtd)} ${labelUnidade(s.unidade)}`, styles: { halign: "right" } }]);
    estado.linhas += 1;
  }
  if (node.modoPreparo && node.modoPreparo.trim()) {
    const t = `Preparo${nivel > 0 ? ` (${UP(node.nome)})` : ""}: ${node.modoPreparo.trim()}`;
    rows.push([{ content: t, colSpan: 2, styles: { fontStyle: "italic", textColor: GRAY, fontSize: 8 } }]);
    estado.linhas += Math.ceil(t.length / 90) + 0.5;
  }
  for (const b of node.bases) {
    rows.push([{ content: `BASE · ${UP(b.nome)} — produzir ${fmtQtd(b.alvoQtd)} ${labelUnidade(b.alvoUnidade)}`, colSpan: 2, styles: { fontStyle: "bold", fillColor: [237, 233, 254], textColor: PURPLE } }]);
    estado.linhas += 1;
    coletarRows(b, nivel + 1, rows, estado);
  }
}

export async function gerarPlanoProducaoPDF(
  plano: FtPlanoProducao,
  itens: { it: FtPlanoProducao["itens"][number]; ficha: FtFicha }[],
  explosao: PlanoExplosao,
  restauranteNome?: string,
): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MX = 14;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── Página 1: resumo do plano ──────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text(UP(plano.nome || "PLANO DE PRODUÇÃO"), MX, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...GRAY);
  doc.text(`${restauranteNome ? restauranteNome + " · " : ""}Dia: ${plano.data ? fmtBR(plano.data) : "—"}`, MX, 24);

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

  // ── Uma página por ficha (na ordem do plano) ───────────────────────────────
  itens.forEach(({ it, ficha }, idx) => {
    const node = explosao.nodes[idx];
    if (!node) return;
    doc.addPage();
    let yy = 18;
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...DARK);
    for (const l of (doc.splitTextToSize(UP(ficha.nome), pageW - 2 * MX) as string[]).slice(0, 2)) { doc.text(l, MX, yy); yy += 7; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...GRAY);
    const un = ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções";
    doc.text(`Produzir: ${fmtQtd(it.qtd)} ${un}${it.responsavel ? `   ·   Responsável: ${it.responsavel}` : ""}   ·   ${plano.data ? fmtBR(plano.data) : ""}`, MX, yy); yy += 3;
    doc.setDrawColor(210, 210, 210); doc.line(MX, yy, pageW - MX, yy); yy += 5;

    const rows: Cell[][] = [];
    const estado = { linhas: 0 };
    coletarRows(node, 0, rows, estado);
    const fs = fitFont(estado.linhas);
    const cp = fs >= 9 ? 1.6 : fs >= 7 ? 1.2 : 1.0;
    if (rows.length > 0) {
      autoTable(doc, {
        startY: yy,
        head: [["Ingrediente", "Quantidade"]],
        body: rows as unknown as Cell[][],
        theme: "grid",
        margin: { left: MX, right: MX, bottom: 12 },
        pageBreak: "avoid",
        rowPageBreak: "avoid",
        styles: { fontSize: fs, cellPadding: cp, textColor: DARK, lineColor: [228, 228, 228], overflow: "linebreak" },
        headStyles: { fillColor: [243, 244, 246], textColor: GRAY, fontStyle: "bold", fontSize: Math.max(7, fs - 1) },
        columnStyles: { 1: { halign: "right", cellWidth: 36 } },
      });
    } else {
      doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.setTextColor(...GRAY);
      doc.text("(sem ingredientes cadastrados)", MX, yy + 4);
    }
  });

  return doc;
}
