// ════════════════════════════════════════════════════════════════════════════
//  Export da tabela de recebimentos — XLSX e PDF.
//  Lazy-load das libs (jspdf/jspdf-autotable/xlsx) pra não pesar o bundle.
// ════════════════════════════════════════════════════════════════════════════
import type { RecebimentoNota } from "../../core/types";
import { FORMA_PAGAMENTO_LABEL } from "../../core/types";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDataHora = (iso: string) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDataBR = (ymd?: string) => ymd ? ymd.split("-").reverse().join("/") : "";
const brl = (v?: number) => v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const COLS_BASE = ["Recebido em", "Emissão", "Nº NF", "Emissor", "CNPJ", "Valor total", "Recebeu", "Forma pgto", "Conforme?", "Divergência"];
const COL_SEMANA = "Semana";

// Vencimentos ordenados (mais cedo primeiro), só as datas.
function vencimentosDe(n: RecebimentoNota): string[] {
  return [...(n.duplicatas || [])]
    .filter((d) => d.vencimento)
    .sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""))
    .map((d) => fmtDataBR(d.vencimento));
}

// Rótulos das colunas de vencimento conforme o máximo encontrado.
function colsVencimento(maxVenc: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= maxVenc; i++) out.push(i === 1 ? "Vencimento" : `${i}º vencimento`);
  return out;
}

function colunas(maxVenc: number): string[] {
  return [...COLS_BASE, ...colsVencimento(maxVenc), COL_SEMANA];
}

// Linha com valor total como NÚMERO (xlsx) ou já formatado (pdf via `brlValor`).
function linhaDe(n: RecebimentoNota, maxVenc: number, brlValor: boolean): (string | number)[] {
  const vencs = vencimentosDe(n);
  const colsVenc: string[] = [];
  for (let i = 0; i < maxVenc; i++) colsVenc.push(vencs[i] || "");
  return [
    fmtDataHora(n.recebidoEm),
    fmtDataBR(n.dataEmissao),
    `${n.numeroNota || ""}${n.serieNota ? "/" + n.serieNota : ""}`,
    n.emissor || "",
    n.cnpjEmissor || "",
    brlValor ? brl(n.valorTotal) : (n.valorTotal ?? ""),
    n.recebidoPor?.nome || "",
    n.formaPagamento ? FORMA_PAGAMENTO_LABEL[n.formaPagamento] : "",
    n.conforme ? "Sim" : "Não",
    n.conforme ? "" : (n.divergencia || ""),
    ...colsVenc,
    n.semanaLabel || "",
  ];
}

function maxVencimentos(notas: RecebimentoNota[]): number {
  return notas.reduce((m, n) => Math.max(m, vencimentosDe(n).length), 0);
}

function nomeArquivo(restaurantNome: string, ext: string): string {
  const agora = new Date();
  const slug = restaurantNome.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "recebimentos";
  return `Recebimentos_${slug}_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}.${ext}`;
}

export async function exportarRecebimentosXLSX(notas: RecebimentoNota[], restaurantNome: string): Promise<void> {
  const XLSX = await import("xlsx");
  const maxVenc = maxVencimentos(notas);
  const head = colunas(maxVenc);
  const rows = notas.map((n) => linhaDe(n, maxVenc, false));
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = head.map((c) => ({ wch: c === "Emissor" ? 34 : c === "CNPJ" ? 18 : c === "Divergência" ? 30 : c === "Semana" ? 18 : (c === "Vencimento" || c.includes("vencimento")) ? 13 : 15 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recebimentos");
  XLSX.writeFile(wb, nomeArquivo(restaurantNome, "xlsx"));
}

export async function exportarRecebimentosPDF(notas: RecebimentoNota[], restaurantNome: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const maxVenc = maxVencimentos(notas);
  const head = colunas(maxVenc);
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
  // Rodapé: "TOTAL" ocupando até a coluna Valor (índice 5), com o valor em 5 e o resto vazio.
  const colsRestantes = head.length - 6;
  const foot = [[
    { content: "TOTAL", colSpan: 5, styles: { halign: "right" as const, fontStyle: "bold" as const } },
    { content: brl(total), styles: { halign: "right" as const, fontStyle: "bold" as const } },
    ...Array.from({ length: colsRestantes }, () => ""),
  ]];

  autoTable(doc, {
    startY: 22,
    head: [head],
    body: notas.map((n) => linhaDe(n, maxVenc, true).map(String)),
    foot,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 }, lineWidth: 0.1, lineColor: [200, 200, 200], valign: "middle", textColor: [30, 30, 30], overflow: "ellipsize" },
    headStyles: { fillColor: [233, 226, 209], textColor: [30, 30, 30], fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [248, 248, 248], textColor: [30, 30, 30] },
    columnStyles: { 5: { halign: "right" }, 8: { halign: "center" } },
  });

  doc.save(nomeArquivo(restaurantNome, "pdf"));
}
