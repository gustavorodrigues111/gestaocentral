// ════════════════════════════════════════════════════════════════════════════
//  Export da tabela de recebimentos — XLSX e PDF.
//  Lazy-load das libs (jspdf/jspdf-autotable/xlsx) pra não pesar o bundle.
// ════════════════════════════════════════════════════════════════════════════
import type { RecebimentoNota } from "../../core/types";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDataBR = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "";
const brl = (v?: number) => v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const COLUNAS = ["Recebido em", "Emissão", "Nº NF", "Emissor", "CNPJ", "Valor total", "Recebeu", "Conforme?", "Divergência", "Faturas (venc.)", "Semana"];

function linhaDe(n: RecebimentoNota): (string | number)[] {
  const faturas = (n.duplicatas || [])
    .map((d) => `${fmtDataBR(d.vencimento) || "?"} ${brl(d.valor)}`.trim())
    .join(" | ");
  return [
    fmtDataHora(n.recebidoEm),
    fmtDataBR(n.dataEmissao),
    `${n.numeroNota || ""}${n.serieNota ? "/" + n.serieNota : ""}`,
    n.emissor || "",
    n.cnpjEmissor || "",
    n.valorTotal ?? "",
    n.recebidoPor?.nome || "",
    n.conforme ? "Sim" : "Não",
    n.conforme ? "" : (n.divergencia || ""),
    faturas,
    n.semanaLabel || "",
  ];
}

function nomeArquivo(restaurantNome: string, ext: string): string {
  const agora = new Date();
  const slug = restaurantNome.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "recebimentos";
  return `Recebimentos_${slug}_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}.${ext}`;
}

export async function exportarRecebimentosXLSX(notas: RecebimentoNota[], restaurantNome: string): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const rows = notas.map(linhaDe);
  const ws = XLSX.utils.aoa_to_sheet([COLUNAS, ...rows]);
  // Largura das colunas (aprox.)
  ws["!cols"] = [16, 11, 12, 34, 18, 13, 18, 10, 30, 24, 18].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "Recebimentos");
  XLSX.writeFile(wb, nomeArquivo(restaurantNome, "xlsx"));
}

export async function exportarRecebimentosPDF(notas: RecebimentoNota[], restaurantNome: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 30, 30);
  doc.text("Recebimentos de produtos", MARGIN_X, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome, MARGIN_X, 17);

  const agora = new Date();
  doc.setFontSize(8);
  doc.text(`Gerado em ${fmtDataHora(agora.toISOString())}  ·  ${notas.length} recebimento(s)`, pageW - MARGIN_X, 12, { align: "right" });

  const total = notas.reduce((s, n) => s + (n.valorTotal || 0), 0);

  autoTable(doc, {
    startY: 22,
    head: [COLUNAS],
    body: notas.map((n) => linhaDe(n).map((c, i) => i === 5 ? brl(typeof c === "number" ? c : undefined) : String(c))),
    foot: [[{ content: "TOTAL", colSpan: 5, styles: { halign: "right", fontStyle: "bold" } }, { content: brl(total), styles: { halign: "right", fontStyle: "bold" } }, "", "", "", "", ""]],
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30], overflow: "ellipsize" },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: {
      0: { cellWidth: 26 }, 1: { cellWidth: 18 }, 2: { cellWidth: 18 },
      3: { cellWidth: 48 }, 4: { cellWidth: 30 }, 5: { halign: "right", cellWidth: 22 },
      6: { cellWidth: 28 }, 7: { halign: "center", cellWidth: 16 }, 8: { cellWidth: 36 },
      9: { cellWidth: 34 }, 10: { cellWidth: 22 },
    },
  });

  doc.save(nomeArquivo(restaurantNome, "pdf"));
}
