// Gera PDF do lote de Vale Refeição — pra conferência/impressão.
// Mesmo modelo do VT: lista por área, forma de pagamento (Caju/PIX) colorida
// por empregado, subtotais por área e total geral. jsPDF + autoTable lazy.
//
// Uso: const doc = await gerarVRPDF({ ... }); doc.save("vr.pdf")

import type { jsPDF as JsPDFType } from "jspdf";
import { nomeMes, pad2 } from "../../core/utils/date";
import { AREAS } from "../../core/types";
import type { Area, VRLoteLinha } from "../../core/types";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const COR_CAJU: [number, number, number] = [194, 65, 12];   // orange-700
const COR_PIX: [number, number, number] = [29, 78, 216];    // blue-700
const COR_CINZA: [number, number, number] = [156, 163, 175];
const COR_ROSA: [number, number, number] = [190, 18, 60];
const COR_VERDE: [number, number, number] = [4, 120, 87];

export type VRPDFLinha = VRLoteLinha & { recebePeloCaju: boolean };

export type VRPDFParams = {
  ano: number;
  mes: number;
  restaurantNome: string;
  statusLabel?: string;
  linhas: VRPDFLinha[];
};

function brl(n: number): string {
  return `R$ ${(n || 0).toFixed(2).replace(".", ",")}`;
}

export async function gerarVRPDF({
  ano, mes, restaurantNome, statusLabel, linhas,
}: VRPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TXT_DARK);
  doc.text(`Vale Refeição — ${nomeMes(mes)}/${ano}`, MARGIN_X, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome + (statusLabel ? `  ·  ${statusLabel}` : ""), MARGIN_X, 17);

  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.setFontSize(8);
  doc.text(stamp, pageW - MARGIN_X, 12, { align: "right" });

  type Cell = string | { content: string; styles?: object; colSpan?: number };
  const head: Cell[] = [
    { content: "Empregado", styles: { halign: "left" } },
    { content: "Pgto", styles: { halign: "center" } },
    { content: "Cargo", styles: { halign: "left" } },
    { content: "Aux. fixo", styles: { halign: "right" } },
    { content: "Valor/dia", styles: { halign: "right" } },
    { content: "Dias", styles: { halign: "right" } },
    { content: "Desc. sug.", styles: { halign: "right" } },
    { content: "Desconto", styles: { halign: "right" } },
    { content: "Aux. pont.", styles: { halign: "right" } },
    { content: "Total", styles: { halign: "right" } },
  ];

  const body: Cell[][] = [];
  let totalGeral = 0;

  for (const area of AREAS) {
    const daArea = linhas
      .filter(l => l.area === area)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    if (daArea.length === 0) continue;

    body.push([{
      content: (area as Area).toUpperCase(),
      colSpan: 10,
      styles: { fillColor: [240, 240, 240], textColor: TXT_DARK, fontStyle: "bold", halign: "left", fontSize: 8 },
    }]);

    let subtotal = 0;
    for (const l of daArea) {
      subtotal += l.total || 0;
      const temAlgo = (l.total || 0) > 0 || (l.vrBase || 0) > 0 || (l.auxFixoMensal || 0) > 0;
      const descSug = l.descontoSugeridoAtivo ? (l.descontoSugerido || 0) : 0;
      body.push([
        l.nome,
        temAlgo
          ? { content: l.recebePeloCaju ? "Caju" : "PIX", styles: { halign: "center", fontStyle: "bold", textColor: l.recebePeloCaju ? COR_CAJU : COR_PIX } }
          : { content: "—", styles: { halign: "center", textColor: COR_CINZA } },
        l.cargoNome || "—",
        { content: (l.auxFixoMensal || 0) > 0 ? brl(l.auxFixoMensal) : "—", styles: { halign: "right" } },
        { content: (l.valorDiario || 0) > 0 ? brl(l.valorDiario) : "—", styles: { halign: "right" } },
        { content: String(l.diasTrabalhados || 0), styles: { halign: "right" } },
        { content: descSug > 0 ? `-${brl(descSug)}` : "—", styles: { halign: "right", textColor: descSug > 0 ? COR_ROSA : COR_CINZA } },
        { content: (l.descontoManual || 0) > 0 ? `-${brl(l.descontoManual)}` : "—", styles: { halign: "right", textColor: (l.descontoManual || 0) > 0 ? COR_ROSA : COR_CINZA } },
        { content: (l.auxPontual || 0) > 0 ? `+${brl(l.auxPontual)}` : "—", styles: { halign: "right", textColor: (l.auxPontual || 0) > 0 ? COR_VERDE : COR_CINZA } },
        { content: brl(l.total), styles: { halign: "right", fontStyle: "bold" } },
      ]);
    }
    totalGeral += subtotal;

    body.push([
      { content: `Subtotal ${(area as Area)}`, colSpan: 9, styles: { halign: "right", fontStyle: "bold", textColor: TXT_DARK, fillColor: [248, 248, 248] } },
      { content: brl(subtotal), styles: { halign: "right", fontStyle: "bold", fillColor: [248, 248, 248] } },
    ]);
  }

  body.push([
    { content: "TOTAL GERAL", colSpan: 9, styles: { halign: "right", fontStyle: "bold", fillColor: [233, 226, 209], textColor: TXT_DARK, fontSize: 9 } },
    { content: brl(totalGeral), styles: { halign: "right", fontStyle: "bold", fillColor: [233, 226, 209], fontSize: 9 } },
  ]);

  autoTable(doc, {
    startY: 22,
    head: [head],
    body,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: {
      fontSize: 8,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
      lineWidth: 0.15,
      lineColor: [200, 200, 200],
      valign: "middle",
      textColor: TXT_DARK,
    },
    headStyles: {
      fillColor: [233, 226, 209],
      textColor: TXT_DARK,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      0: { halign: "left", cellWidth: 52 },
      1: { halign: "center", cellWidth: 16 },
      2: { halign: "left", cellWidth: 48 },
    },
  });

  return doc;
}
