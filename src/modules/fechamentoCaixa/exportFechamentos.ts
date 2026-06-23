// Export da tabela de fechamentos de caixa — XLSX e PDF (lazy-load das libs).
import type { FechamentoCaixa, TurnoCaixa } from "../../core/types";
import { TURNO_CAIXA_LABEL } from "../../core/types";

export type ComandaLinhaExport = { data: string; turno: TurnoCaixa; numero: string; nome?: string; valor?: number };

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtData = (s?: string) => s ? s.split("-").reverse().join("/") : "";
const brl = (v?: number) => v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const COLS = ["Fechado em", "Data", "Turno", "Total vendas", "Dinheiro", "PIX", "Crédito", "Débito", "Fundo caixa", "Nº lacre", "Fechou", "Observação"];

function linha(f: FechamentoCaixa, brlValor: boolean): (string | number)[] {
  const v = (n?: number) => brlValor ? brl(n) : (n ?? "");
  return [
    fmtDataHora(f.fechadoEm),
    fmtData(f.data),
    TURNO_CAIXA_LABEL[f.turno],
    v(f.totalVendas),
    v(f.dinheiro),
    v(f.pix),
    v(f.credito),
    v(f.debito),
    v(f.fundoCaixa),
    f.numeroLacre || "",
    f.fechadoPor?.nome || "",
    f.observacao || "",
  ];
}

function nomeArquivo(restaurantNome: string, ext: string): string {
  const agora = new Date();
  const slug = restaurantNome.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "fechamentos";
  return `Fechamentos_${slug}_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}.${ext}`;
}

export async function exportarFechamentosXLSX(itens: FechamentoCaixa[], restaurantNome: string): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([COLS, ...itens.map((f) => linha(f, false))]);
  ws["!cols"] = COLS.map((c) => ({ wch: c === "Observação" ? 32 : c === "Fechado em" ? 16 : c === "Fechou" ? 18 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Fechamentos");
  XLSX.writeFile(wb, nomeArquivo(restaurantNome, "xlsx"));
}

export async function exportarFechamentosPDF(itens: FechamentoCaixa[], restaurantNome: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(30, 30, 30);
  doc.text("Fechamentos de Caixa", MARGIN_X, 12);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome, MARGIN_X, 17);
  const agora = new Date();
  doc.setFontSize(8);
  doc.text(`Gerado em ${fmtDataHora(agora.toISOString())}  ·  ${itens.length} fechamento(s)`, pageW - MARGIN_X, 12, { align: "right" });
  const total = itens.reduce((s, f) => s + (f.totalVendas || 0), 0);
  autoTable(doc, {
    startY: 22,
    head: [COLS],
    body: itens.map((f) => linha(f, true).map(String)),
    foot: [[{ content: "TOTAL", colSpan: 3, styles: { halign: "right" as const, fontStyle: "bold" as const } }, { content: brl(total), styles: { halign: "right" as const, fontStyle: "bold" as const } }, ...Array.from({ length: COLS.length - 4 }, () => "")]],
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30], overflow: "ellipsize" },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
  });
  doc.save(nomeArquivo(restaurantNome, "pdf"));
}

// ─── Export de comandas/cortesias ───────────────────────────────────────────
const COLS_CMD = ["Data", "Turno", "Comanda", "Nº", "Valor"];

function linhaCmd(l: ComandaLinhaExport, brlValor: boolean): (string | number)[] {
  return [fmtData(l.data), TURNO_CAIXA_LABEL[l.turno], l.nome || "—", l.numero, brlValor ? brl(l.valor) : (l.valor ?? "")];
}

function nomeArquivoCmd(restaurantNome: string, ext: string): string {
  const agora = new Date();
  const slug = restaurantNome.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "comandas";
  return `Comandas_${slug}_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}.${ext}`;
}

export async function exportarComandasXLSX(linhas: ComandaLinhaExport[], restaurantNome: string): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([COLS_CMD, ...linhas.map((l) => linhaCmd(l, false))]);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 8 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comandas");
  XLSX.writeFile(wb, nomeArquivoCmd(restaurantNome, "xlsx"));
}

export async function exportarComandasPDF(linhas: ComandaLinhaExport[], restaurantNome: string, periodoLabel?: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(30, 30, 30);
  doc.text("Cortesias / Comandas", MARGIN_X, 14);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome + (periodoLabel ? `  ·  ${periodoLabel}` : ""), MARGIN_X, 19);
  const agora = new Date();
  doc.setFontSize(8);
  doc.text(`Gerado em ${fmtDataHora(agora.toISOString())}  ·  ${linhas.length} lançamento(s)`, pageW - MARGIN_X, 14, { align: "right" });
  const total = linhas.reduce((s, l) => s + (l.valor || 0), 0);
  autoTable(doc, {
    startY: 24,
    head: [COLS_CMD],
    body: linhas.map((l) => linhaCmd(l, true).map(String)),
    foot: [[{ content: "TOTAL", colSpan: 4, styles: { halign: "right" as const, fontStyle: "bold" as const } }, { content: brl(total), styles: { halign: "right" as const, fontStyle: "bold" as const } }]],
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 9, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30] },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold" },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: { 4: { halign: "right" } },
  });
  doc.save(nomeArquivoCmd(restaurantNome, "pdf"));
}
