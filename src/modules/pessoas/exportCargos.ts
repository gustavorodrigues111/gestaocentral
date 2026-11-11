// ════════════════════════════════════════════════════════════════════════════
//  Export da tabela de cargos — XLSX e PDF. Libs (xlsx, jspdf) carregadas lazy.
// ════════════════════════════════════════════════════════════════════════════
import type { Cargo } from "../../core/types";
import { TIPO_VINCULO_LABEL, defaultBatePontoPorVinculo } from "../../core/types";

const ehConfianca = (c: Cargo) => !(c.batePonto ?? defaultBatePontoPorVinculo(c.tipoVinculo));
const brl = (v?: number | null) => (v == null ? "" : "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
const slug = (s: string) => (s || "restaurante").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hoje = () => new Date().toISOString().slice(0, 10);

type Linha = { cargo: Cargo; nomes: string[] };
function linhas(cargos: Cargo[], nomesPorCargo: Record<string, string[]>): Linha[] {
  return cargos.map((c) => ({ cargo: c, nomes: nomesPorCargo[c.id] || [] }));
}

export async function exportarCargosXLSX(cargos: Cargo[], nomesPorCargo: Record<string, string[]>, restaurante: string): Promise<void> {
  const XLSX = await import("xlsx");
  const head = ["Área", "Cargo", "Vínculo", "Pontos", "Recebe produção", "Cargo de confiança", "Sem gorjeta", "Salário base", "Empregados ativos", "Nomes", "Situação"];
  const rows = linhas(cargos, nomesPorCargo).map(({ cargo: c, nomes }) => [
    c.area,
    c.nome,
    TIPO_VINCULO_LABEL[c.tipoVinculo],
    c.semGorjeta ? "" : (c.pontos ?? 0),
    c.recebeProducao ? "Sim" : "Não",
    ehConfianca(c) ? "Sim" : "Não",
    c.semGorjeta ? "Sim" : "Não",
    c.salarioBase != null ? Number(c.salarioBase) : "",
    nomes.length,
    nomes.join(", "),
    c.ativo ? "Ativo" : "Inativo",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = [{ wch: 10 }, { wch: 26 }, { wch: 16 }, { wch: 8 }, { wch: 15 }, { wch: 16 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 40 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cargos");
  XLSX.writeFile(wb, `cargos-${slug(restaurante)}-${hoje()}.xlsx`);
}

export async function exportarCargosPDF(cargos: Cargo[], nomesPorCargo: Record<string, string[]>, restaurante: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14); doc.text(`Cargos — ${restaurante}`, 14, 15);
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`${cargos.length} cargo(s) · gerado em ${new Date().toLocaleDateString("pt-BR")}`, 14, 21);
  doc.setTextColor(0);

  const body = linhas(cargos, nomesPorCargo).map(({ cargo: c, nomes }) => [
    c.area,
    c.nome + (c.ativo ? "" : " (inativo)"),
    TIPO_VINCULO_LABEL[c.tipoVinculo].split(" ")[0],
    c.semGorjeta ? "Sem gorj." : String(c.pontos ?? 0),
    c.recebeProducao ? "Sim" : "—",
    ehConfianca(c) ? "Sim" : "—",
    c.salarioBase != null ? brl(c.salarioBase) : "—",
    String(nomes.length),
  ]);
  autoTable(doc, {
    startY: 26,
    head: [["Área", "Cargo", "Vínculo", "Pontos", "Produção", "Confiança", "Salário", "Empreg."]],
    body,
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      3: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" },
    },
    alternateRowStyles: { fillColor: [247, 247, 250] },
  });
  doc.save(`cargos-${slug(restaurante)}-${hoje()}.pdf`);
}
