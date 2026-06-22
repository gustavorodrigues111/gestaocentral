// Export da tabela de fechamentos de caixa — XLSX e PDF (lazy-load das libs).
import type { FechamentoCaixa } from "../../core/types";
import { TURNO_CAIXA_LABEL } from "../../core/types";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtData = (s?: string) => s ? s.split("-").reverse().join("/") : "";
const brl = (v?: number) => v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const COLS = ["Fechado em", "Data", "Turno", "Total vendas", "Dinheiro", "Fundo caixa", "Nº lacre", "Fechou", "Observação"];

function linha(f: FechamentoCaixa, brlValor: boolean): (string | number)[] {
  return [
    fmtDataHora(f.fechadoEm),
    fmtData(f.data),
    TURNO_CAIXA_LABEL[f.turno],
    brlValor ? brl(f.totalVendas) : (f.totalVendas ?? ""),
    brlValor ? brl(f.dinheiro) : (f.dinheiro ?? ""),
    brlValor ? brl(f.fundoCaixa) : (f.fundoCaixa ?? ""),
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
    foot: [[{ content: "TOTAL", colSpan: 3, styles: { halign: "right" as const, fontStyle: "bold" as const } }, { content: brl(total), styles: { halign: "right" as const, fontStyle: "bold" as const } }, "", "", "", "", ""]],
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30], overflow: "ellipsize" },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  });
  doc.save(nomeArquivo(restaurantNome, "pdf"));
}
