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
  // VT/VR = só a parte diária; auxílio fixo mensal vira coluna AUX própria.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const vtBase = (l: BeneficioPagLinha) => r2((l.vtTotal || 0) - (l.vtAuxFixo || 0));
  const vrBase = (l: BeneficioPagLinha) => r2((l.vrTotal || 0) - (l.vrAuxFixo || 0));
  const auxDe = (l: BeneficioPagLinha) => r2((l.vtAuxFixo || 0) + (l.vrAuxFixo || 0));
  const temVR = usaVR && linhas.some((l) => vrBase(l) > 0);
  const temAux = linhas.some((l) => auxDe(l) > 0);
  const temAjuste = linhas.some((l) => (l.ajuste || 0) !== 0);
  const totalVtBase = r2(linhas.reduce((s, l) => s + vtBase(l), 0));
  const totalVrBase = r2(linhas.reduce((s, l) => s + vrBase(l), 0));
  const totalAux = r2(linhas.reduce((s, l) => s + auxDe(l), 0));
  const dash = (n: number) => (n > 0 ? fmt(n) : "—");
  const cols = ["Empregado", "Forma", "Dias", "VT", ...(temVR ? ["VR"] : []), ...(temAux ? ["Aux."] : []), ...(temAjuste ? ["Ajuste"] : []), "Total"];
  const rowOf = (l: BeneficioPagLinha) => [l.empregadoNome, formaLbl(l), String(l.diasTrabalhados), dash(vtBase(l)),
    ...(temVR ? [dash(vrBase(l))] : []), ...(temAux ? [dash(auxDe(l))] : []), ...(temAjuste ? [l.ajuste ? fmt(l.ajuste) : "—"] : []), fmt(l.total)];
  const footRow = ["Total", "", "", fmt(totalVtBase), ...(temVR ? [fmt(totalVrBase)] : []), ...(temAux ? [fmt(totalAux)] : []),
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

  // ── Descritivo dos ajustes por empregado — um BOX por empregado ──
  const linhasAjuste = ajustes.flatMap((a) => a.linhas.map((l) => ({ ...l, ref: `${nomeMes(a.mes)}/${a.ano}` })));
  if (linhasAjuste.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 10;
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
    doc.text("Descontos / créditos — detalhe por empregado", M, y);
    y += 6;

    const boxW = pageW - 2 * M;
    const padX = 3.5, lineH = 4, innerW = boxW - 2 * padX;
    const headTop = 5.2, bodyTop = 10;   // offsets do topo do box até a baseline

    for (const l of linhasAjuste) {
      const desc = (l.diasDesconto || []).map(brDate);
      const cred = (l.diasCredito || []).map(brDate);
      const partes: string[] = [];
      if (desc.length) partes.push(`Descontados (${desc.length}d): ${desc.join(", ")}`);
      if (cred.length) partes.push(`Adicionados (+${cred.length}d): ${cred.join(", ")}`);
      const aux = (l.ajusteAuxVt || 0) + (l.ajusteAuxVr || 0);
      if (aux) partes.push(`Auxílio proporcional${l.demissao ? " (÷30, rescisão)" : " (÷dias previstos)"}: ${fmt(aux)}`);
      if (partes.length === 0) partes.push("Sem diferença de dias.");

      // Quebra de linha de cada parte dentro da largura do box.
      const body: string[] = [];
      for (const p of partes) body.push(...(doc.splitTextToSize(p, innerW) as string[]));
      const boxH = bodyTop + body.length * lineH + 1;

      if (y + boxH > pageH - 10) { doc.addPage(); y = 14; }

      // Moldura
      doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
      doc.roundedRect(M, y, boxW, boxH, 1.6, 1.6, "FD");

      // Cabeçalho: nome (esq.) + total (dir., colorido)
      const isDesc = l.ajusteTotal < 0;
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(30, 41, 59);
      const nome = l.empregadoNome + (l.demissao ? "  •  demissão (acerto do mês inteiro)" : "");
      doc.text((doc.splitTextToSize(nome, innerW - 40) as string[])[0], M + padX, y + headTop);
      const rgb: [number, number, number] = isDesc ? [190, 18, 60] : [4, 120, 87];
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(`${fmt(l.ajusteTotal)}  ·  ref. ${l.ref}`, M + boxW - padX, y + headTop, { align: "right" });

      // Corpo
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
      let by = y + bodyTop;
      for (const bl of body) { doc.text(bl, M + padX, by); by += lineH; }

      y += boxH + 3;
    }
  }

  doc.save(`beneficios-${nomeMes(mes).toLowerCase()}-${ano}.pdf`);
}
