// ════════════════════════════════════════════════════════════════════════════
//  Export dos lançamentos de fatura — XLSX e PDF. Lazy-load das libs.
// ════════════════════════════════════════════════════════════════════════════
import type { CartaoLancamento } from "../../core/types";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataBR = (ymd?: string) => (ymd ? ymd.split("-").reverse().join("/") : "");
const brl = (v?: number) => (v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

const COLS = ["Data", "Descrição", "Categoria", "Cartão", "Parcela", "Valor"];

function linhaDe(l: CartaoLancamento, catNome: (id?: string | null) => string, brlValor: boolean): (string | number)[] {
  return [
    l.dataOriginal || fmtDataBR(l.data),
    l.descricao || "",
    catNome(l.categoriaId),
    l.cartao || "",
    l.parcela || "",
    brlValor ? brl(l.valor) : (l.valor ?? 0),
  ];
}

function nomeArquivo(titulo: string, ext: string): string {
  const agora = new Date();
  const slug = titulo.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "faturas";
  return `${slug}_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}.${ext}`;
}

export async function exportarFaturasXLSX(lancs: CartaoLancamento[], catNome: (id?: string | null) => string, titulo: string): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = [...lancs].sort((a, b) => (a.data || "").localeCompare(b.data || "")).map((l) => linhaDe(l, catNome, false));
  const total = lancs.reduce((s, l) => s + (l.valor || 0), 0);
  const ws = XLSX.utils.aoa_to_sheet([COLS, ...rows, ["", "", "", "", "TOTAL", total]]);
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lançamentos");
  XLSX.writeFile(wb, nomeArquivo(titulo, "xlsx"));
}

export async function exportarFaturasPDF(lancs: CartaoLancamento[], catNome: (id?: string | null) => string, titulo: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(30, 30, 30);
  doc.text(titulo, MARGIN_X, 14);

  const agora = new Date();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Gerado em ${pad(agora.getDate())}/${pad(agora.getMonth() + 1)}/${agora.getFullYear()}  ·  ${lancs.length} lançamento(s)`, pageW - MARGIN_X, 14, { align: "right" });

  const total = lancs.reduce((s, l) => s + (l.valor || 0), 0);
  const rows = [...lancs].sort((a, b) => (a.data || "").localeCompare(b.data || ""));

  autoTable(doc, {
    startY: 20,
    head: [COLS],
    body: rows.map((l) => linhaDe(l, catNome, true).map(String)),
    foot: [[{ content: "TOTAL", colSpan: 5, styles: { halign: "right" as const, fontStyle: "bold" as const } }, { content: brl(total), styles: { halign: "right" as const, fontStyle: "bold" as const } }]],
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 8, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30], overflow: "ellipsize" },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold" },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: { 5: { halign: "right" } },
  });

  doc.save(nomeArquivo(titulo, "pdf"));
}
