// ════════════════════════════════════════════════════════════════════════════
//  Gera o PDF da comparação de gorjetas entre DOIS meses.
//
//  Layout A4 retrato: cabeçalho + 3 cards (total mês base, total mês comparado,
//  variação colorida) + tabela por empregado (base × comparado × variação), com
//  a variação colorida (verde ↑, vermelho ↓, azul = zero) e rodapé de total.
// ════════════════════════════════════════════════════════════════════════════

import type { jsPDF as JsPDFType } from "jspdf";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type ComparacaoPDFLinha = {
  nome: string; cargoNome: string; area: string; uni?: string;
  liqBase: number; liqComp: number; delta: number; pct: number | null;
};

export type ComparacaoPDFParams = {
  restaurantNome: string;
  labelBase: string;   // ex: "Maio/2026"
  labelComp: string;   // ex: "Junho/2026"
  subtitulo: string;   // ex: "Todas as unidades"
  linhas: ComparacaoPDFLinha[];
  totBase: number; totComp: number; totDelta: number; totPct: number | null;
};

const VERDE: [number, number, number] = [21, 128, 61];
const VERMELHO: [number, number, number] = [190, 18, 60];
const AZUL: [number, number, number] = [37, 99, 235];
const corDelta = (delta: number): [number, number, number] =>
  delta > 0.005 ? VERDE : delta < -0.005 ? VERMELHO : AZUL;
const txtVariacao = (delta: number, pct: number | null): string => {
  const seta = delta > 0.005 ? "+" : delta < -0.005 ? "-" : "=";
  const pctTxt = pct === null ? (delta > 0.005 ? " (novo)" : "") : ` (${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%)`;
  return `${seta}${fmtBR(Math.abs(delta))}${pctTxt}`;
};

export async function gerarComparacaoPDF(p: ComparacaoPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MX = 14;

  const PRIM: [number, number, number] = [16, 122, 64];
  const ESCURO: [number, number, number] = [31, 41, 55];
  const MEDIO: [number, number, number] = [107, 114, 128];
  const BORDA: [number, number, number] = [229, 231, 235];

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...PRIM);
  doc.text("Comparação de Gorjetas", MX, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...ESCURO);
  doc.text(`${p.restaurantNome} — ${p.labelComp} vs ${p.labelBase}`, MX, 25);
  doc.setFontSize(9); doc.setTextColor(...MEDIO);
  doc.text(p.subtitulo, MX, 30.5);
  const agora = new Date();
  const dt = `${String(agora.getDate()).padStart(2, "0")}/${String(agora.getMonth() + 1).padStart(2, "0")}/${agora.getFullYear()} ${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  doc.text(`Emitido em ${dt}`, pageW - MX, 30.5, { align: "right" });
  doc.setDrawColor(...BORDA); doc.setLineWidth(0.3); doc.line(MX, 34, pageW - MX, 34);

  // Cards
  const yC = 40, cardW = (pageW - MX * 2 - 6) / 3, cardH = 22;
  function card(x: number, label: string, valor: string, valorCor: [number, number, number], fill: [number, number, number]) {
    doc.setFillColor(...fill); doc.roundedRect(x, yC, cardW, cardH, 2, 2, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MEDIO);
    doc.text(label.toUpperCase(), x + 4, yC + 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...valorCor);
    doc.text(valor, x + 4, yC + 16);
  }
  card(MX, p.labelBase, fmtBR(p.totBase), ESCURO, [243, 244, 246]);
  card(MX + cardW + 3, p.labelComp, fmtBR(p.totComp), ESCURO, [219, 234, 254]);
  card(MX + cardW * 2 + 6, "Variação", txtVariacao(p.totDelta, p.totPct), corDelta(p.totDelta),
    p.totDelta > 0.005 ? [220, 252, 231] : p.totDelta < -0.005 ? [254, 226, 226] : [219, 234, 254]);

  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MEDIO);
  doc.text(`${p.linhas.length} empregado(s)`, MX, yC + cardH + 6);

  // Tabela (agrupada por área)
  type Cell = string | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: Cell[][] = [];
  let uniPrev: string | null = null;
  let areaPrev: string | null = null;
  let subBase = 0, subComp = 0, temSub = false;
  const pushSubtotal = () => {
    if (!temSub) return;
    const d = Math.round((subComp - subBase) * 100) / 100;
    const pct = subBase > 0 ? (d / subBase) * 100 : null;
    body.push([
      { content: `Subtotal ${areaPrev || "sem área"}`, styles: { fontStyle: "italic", textColor: [107, 114, 128], fontSize: 8 } },
      { content: fmtBR(subBase), styles: { halign: "right", textColor: [107, 114, 128], fontSize: 8 } },
      { content: fmtBR(subComp), styles: { halign: "right", fontStyle: "bold", textColor: [107, 114, 128], fontSize: 8 } },
      { content: txtVariacao(d, pct), styles: { halign: "right", textColor: corDelta(d), fontStyle: "bold", fontSize: 8 } },
    ]);
    subBase = 0; subComp = 0; temSub = false;
  };
  for (const l of p.linhas) {
    const uni = l.uni || "";
    if (uni && uni !== uniPrev) {
      pushSubtotal();
      body.push([{ content: uni.toUpperCase(), colSpan: 4, styles: { fillColor: [224, 231, 255], textColor: [55, 48, 163], fontStyle: "bold", fontSize: 9 } }]);
      uniPrev = uni; areaPrev = null;
    }
    if (l.area !== areaPrev) {
      pushSubtotal();
      body.push([{ content: l.area || "Sem área", colSpan: 4, styles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: "bold", fontSize: 9 } }]);
      areaPrev = l.area;
    }
    body.push([
      l.cargoNome ? `${l.nome}\n${l.cargoNome}` : l.nome,
      fmtBR(l.liqBase),
      fmtBR(l.liqComp),
      { content: txtVariacao(l.delta, l.pct), styles: { textColor: corDelta(l.delta), fontStyle: "bold", halign: "right" } },
    ]);
    subBase += l.liqBase; subComp += l.liqComp; temSub = true;
  }
  pushSubtotal();

  autoTable(doc, {
    startY: yC + cardH + 12,
    head: [["Empregado", p.labelBase, p.labelComp, "Variação"]],
    body: body as unknown as (string | number)[][],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2, lineColor: BORDA, lineWidth: 0.1, textColor: ESCURO },
    headStyles: { fillColor: PRIM, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 34 },
      2: { halign: "right", cellWidth: 34 },
      3: { halign: "right", cellWidth: 42 },
    },
    foot: [[
      "Total",
      fmtBR(p.totBase),
      fmtBR(p.totComp),
      { content: txtVariacao(p.totDelta, p.totPct), styles: { textColor: corDelta(p.totDelta), halign: "right" } } as unknown as string,
    ]],
    footStyles: { fillColor: [243, 244, 246], textColor: ESCURO, fontStyle: "bold" },
    margin: { left: MX, right: MX },
  });

  return doc;
}
