// PDF do Pagamento de benefícios (módulo novo). jsPDF + autoTable lazy-loaded.
import { nomeMes, pad2 } from "../../core/utils/date";
import type { BeneficioPagLinha, BeneficioAjusteLote } from "../../core/types";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (ymd: string) => (ymd ? ymd.split("-").reverse().slice(0, 2).join("/") : "—");

export async function gerarPagamentoPDF(params: {
  linhas: BeneficioPagLinha[];
  restaurantNome: string;
  ano: number;
  mes: number;
  usaVR: boolean;
  totais: { totalVt: number; totalVr: number; totalAjuste?: number; totalGeral: number };
  ajustes?: BeneficioAjusteLote[];
}): Promise<void> {
  const { linhas, restaurantNome, ano, mes, usaVR, totais, ajustes = [] } = params;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 10;

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(30, 41, 59);
  doc.text(`Benefícios — Pagamento ${nomeMes(mes)}/${ano}`, M, 14);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome, M, 20);
  const ag = new Date();
  doc.setFontSize(8);
  doc.text(`Gerado em ${pad2(ag.getDate())}/${pad2(ag.getMonth() + 1)}/${ag.getFullYear()} ${pad2(ag.getHours())}:${pad2(ag.getMinutes())}`, pageW - M, 14, { align: "right" });

  const formaLbl = (l: BeneficioPagLinha) => (l.forma === "pix" ? "Pix" : "Caju");
  const temAjuste = linhas.some((l) => (l.ajuste || 0) !== 0);
  const cols = ["Empregado", "Forma", "Dias", "VT", ...(usaVR ? ["VR"] : []), ...(temAjuste ? ["Ajuste"] : []), "Total"];
  const rowOf = (l: BeneficioPagLinha) => [l.empregadoNome, formaLbl(l), String(l.diasTrabalhados), fmt(l.vtTotal),
    ...(usaVR ? [fmt(l.vrTotal)] : []), ...(temAjuste ? [l.ajuste ? fmt(l.ajuste) : "—"] : []), fmt(l.total)];
  const footRow = ["Total", "", "", fmt(totais.totalVt), ...(usaVR ? [fmt(totais.totalVr)] : []),
    ...(temAjuste ? [fmt(totais.totalAjuste || 0)] : []), fmt(totais.totalGeral)];
  const rightFrom = 3;   // colunas numéricas alinhadas à direita a partir de VT
  const colStyles: Record<number, object> = { 2: { halign: "center" } };
  for (let i = rightFrom; i < cols.length; i++) colStyles[i] = { halign: "right" };

  autoTable(doc, {
    startY: 26, head: [cols], body: linhas.map(rowOf), foot: [footRow],
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: "bold" },
    columnStyles: colStyles,
  });

  // ── Descritivo dos ajustes por empregado (dias descontados/adicionados) ──
  const linhasAjuste = ajustes.flatMap((a) => a.linhas.map((l) => ({ ...l, ref: `${nomeMes(a.mes)}/${a.ano}` })));
  if (linhasAjuste.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
    doc.text("Descontos / créditos — detalhe por empregado", M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(60, 60, 60);
    y += 5;
    const pageH = doc.internal.pageSize.getHeight();
    for (const l of linhasAjuste) {
      if (y > pageH - 12) { doc.addPage(); y = 14; }
      const desc = (l.diasDesconto || []).map(brDate);
      const cred = (l.diasCredito || []).map(brDate);
      const partes: string[] = [];
      if (desc.length) partes.push(`descontados ${desc.join(", ")} (−${desc.length}d)`);
      if (cred.length) partes.push(`adicionados ${cred.join(", ")} (+${cred.length}d)`);
      const txt = `${l.empregadoNome} — ref. ${l.ref}: ${partes.join("; ") || "sem diferença"} = ${fmt(l.ajusteTotal)}`;
      const wrapped = doc.splitTextToSize(txt, pageW - 2 * M);
      doc.text(wrapped, M, y);
      y += wrapped.length * 4 + 1;
    }
  }

  doc.save(`beneficios-${nomeMes(mes).toLowerCase()}-${ano}.pdf`);
}
