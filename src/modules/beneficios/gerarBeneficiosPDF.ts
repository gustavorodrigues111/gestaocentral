// PDF do lote de Benefícios — Mobilidade (VT+aux) + Refeição (VR) por empregado,
// por área, com subtotais e total geral. Coluna "Pgto" mostra a forma (Caju/PIX
// / misto). jsPDF + autoTable lazy-loaded.

import type { jsPDF as JsPDFType } from "jspdf";
import { nomeMes, pad2 } from "../../core/utils/date";
import { AREAS } from "../../core/types";
import type { Area } from "../../core/types";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const COR_CAJU: [number, number, number] = [194, 65, 12];
const COR_PIX: [number, number, number] = [29, 78, 216];
const COR_CINZA: [number, number, number] = [156, 163, 175];

export type BeneficiosPDFLinha = {
  nome: string;
  cargoNome: string;
  area: Area;
  vt: { total: number };
  vr: { total: number };
  vtRecebePeloCaju: boolean;
  vrRecebePeloCaju: boolean;
  total: number;
};

export type BeneficiosPDFParams = {
  ano: number;
  mes: number;
  restaurantNome: string;
  statusLabel?: string;
  linhas: BeneficiosPDFLinha[];
};

function brl(n: number): string {
  return `R$ ${(n || 0).toFixed(2).replace(".", ",")}`;
}

// Forma de pagamento agregada da linha (considera só benefícios com valor).
function pgtoLabel(l: BeneficiosPDFLinha): { texto: string; cor: [number, number, number] } {
  const metodos = new Set<string>();
  if ((l.vt.total || 0) > 0) metodos.add(l.vtRecebePeloCaju ? "Caju" : "PIX");
  if ((l.vr.total || 0) > 0) metodos.add(l.vrRecebePeloCaju ? "Caju" : "PIX");
  if (metodos.size === 0) return { texto: "—", cor: COR_CINZA };
  if (metodos.size === 1) {
    const m = [...metodos][0];
    return { texto: m, cor: m === "Caju" ? COR_CAJU : COR_PIX };
  }
  return { texto: "Caju/PIX", cor: TXT_DARK };
}

export async function gerarBeneficiosPDF({
  ano, mes, restaurantNome, statusLabel, linhas,
}: BeneficiosPDFParams): Promise<JsPDFType> {
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
  doc.text(`Benefícios — ${nomeMes(mes)}/${ano}`, MARGIN_X, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome + (statusLabel ? `  ·  ${statusLabel}` : ""), MARGIN_X, 17);

  const agora = new Date();
  doc.setFontSize(8);
  doc.text(
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`,
    pageW - MARGIN_X, 12, { align: "right" },
  );

  type Cell = string | { content: string; styles?: object; colSpan?: number };
  const head: Cell[] = [
    { content: "Empregado", styles: { halign: "left" } },
    { content: "Pgto", styles: { halign: "center" } },
    { content: "Cargo", styles: { halign: "left" } },
    { content: "Mobilidade (VT)", styles: { halign: "right" } },
    { content: "Refeição (VR)", styles: { halign: "right" } },
    { content: "Total", styles: { halign: "right" } },
  ];

  const body: Cell[][] = [];
  let totGeral = 0, totMob = 0, totRef = 0;

  for (const area of AREAS) {
    const daArea = linhas.filter(l => l.area === area).sort((a, b) => a.nome.localeCompare(b.nome));
    if (daArea.length === 0) continue;

    body.push([{
      content: (area as Area).toUpperCase(),
      colSpan: 6,
      styles: { fillColor: [240, 240, 240], textColor: TXT_DARK, fontStyle: "bold", halign: "left", fontSize: 8 },
    }]);

    let sub = 0;
    for (const l of daArea) {
      sub += l.total || 0;
      totMob += l.vt.total || 0;
      totRef += l.vr.total || 0;
      const pg = pgtoLabel(l);
      body.push([
        l.nome,
        { content: pg.texto, styles: { halign: "center", fontStyle: "bold", textColor: pg.cor } },
        l.cargoNome || "—",
        { content: (l.vt.total || 0) > 0 ? brl(l.vt.total) : "—", styles: { halign: "right", textColor: (l.vt.total || 0) > 0 ? TXT_DARK : COR_CINZA } },
        { content: (l.vr.total || 0) > 0 ? brl(l.vr.total) : "—", styles: { halign: "right", textColor: (l.vr.total || 0) > 0 ? TXT_DARK : COR_CINZA } },
        { content: brl(l.total), styles: { halign: "right", fontStyle: "bold" } },
      ]);
    }
    totGeral += sub;
    body.push([
      { content: `Subtotal ${(area as Area)}`, colSpan: 5, styles: { halign: "right", fontStyle: "bold", fillColor: [248, 248, 248] } },
      { content: brl(sub), styles: { halign: "right", fontStyle: "bold", fillColor: [248, 248, 248] } },
    ]);
  }

  body.push([
    { content: `TOTAL — Mobilidade ${brl(totMob)} · Refeição ${brl(totRef)}`, colSpan: 5, styles: { halign: "right", fontStyle: "bold", fillColor: [233, 226, 209], fontSize: 9 } },
    { content: brl(totGeral), styles: { halign: "right", fontStyle: "bold", fillColor: [233, 226, 209], fontSize: 9 } },
  ]);

  autoTable(doc, {
    startY: 22,
    head: [head],
    body,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineWidth: 0.15, lineColor: [200, 200, 200], valign: "middle", textColor: TXT_DARK },
    headStyles: { fillColor: [233, 226, 209], textColor: TXT_DARK, fontStyle: "bold", fontSize: 8 },
    columnStyles: {
      0: { halign: "left", cellWidth: 60 },
      1: { halign: "center", cellWidth: 20 },
      2: { halign: "left", cellWidth: 55 },
    },
  });

  return doc;
}
