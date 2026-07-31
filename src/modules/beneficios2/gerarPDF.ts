// PDF do Pagamento de benefícios (módulo novo). jsPDF + autoTable lazy-loaded.
import { nomeMes, pad2 } from "../../core/utils/date";
import type { BeneficioPagLinha } from "../../core/types";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function gerarPagamentoPDF(params: {
  linhas: BeneficioPagLinha[];
  restaurantNome: string;
  ano: number;
  mes: number;
  usaVR: boolean;
  totais: { totalVt: number; totalVr: number; totalGeral: number };
}): Promise<void> {
  const { linhas, restaurantNome, ano, mes, usaVR, totais } = params;
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
  const head = usaVR ? [["Empregado", "Forma", "Dias", "VT", "VR", "Total"]] : [["Empregado", "Forma", "Dias", "VT", "Total"]];
  const body = linhas.map((l) => usaVR
    ? [l.empregadoNome, formaLbl(l), String(l.diasTrabalhados), fmt(l.vtTotal), fmt(l.vrTotal), fmt(l.total)]
    : [l.empregadoNome, formaLbl(l), String(l.diasTrabalhados), fmt(l.vtTotal), fmt(l.total)]);
  const foot = usaVR
    ? [["Total", "", "", fmt(totais.totalVt), fmt(totais.totalVr), fmt(totais.totalGeral)]]
    : [["Total", "", "", fmt(totais.totalVt), fmt(totais.totalGeral)]];

  autoTable(doc, {
    startY: 26, head, body, foot,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: "bold" },
    columnStyles: usaVR
      ? { 2: { halign: "center" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
      : { 2: { halign: "center" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });

  doc.save(`beneficios-${nomeMes(mes).toLowerCase()}-${ano}.pdf`);
}
