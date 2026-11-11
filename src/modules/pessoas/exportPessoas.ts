// ════════════════════════════════════════════════════════════════════════════
//  Export da lista de pessoas — XLSX e PDF (respeita os filtros aplicados).
//  Libs (xlsx, jspdf) carregadas lazy.
// ════════════════════════════════════════════════════════════════════════════

export type PessoaExportRow = {
  nome: string;
  vinculo: string;
  cargo: string;
  area: string;
  email: string;
  cpf: string;
  acesso: string;
  situacao: string;
};

const slug = (s: string) => (s || "restaurante").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hoje = () => new Date().toISOString().slice(0, 10);

export async function exportarPessoasXLSX(rows: PessoaExportRow[], restaurante: string): Promise<void> {
  const XLSX = await import("xlsx");
  const head = ["Nome", "Vínculo", "Cargo", "Área", "E-mail", "CPF", "Acesso", "Situação"];
  const body = rows.map((r) => [r.nome, r.vinculo, r.cargo, r.area, r.email, r.cpf, r.acesso, r.situacao]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 26 }, { wch: 16 }, { wch: 20 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pessoas");
  XLSX.writeFile(wb, `pessoas-${slug(restaurante)}-${hoje()}.xlsx`);
}

export async function exportarPessoasPDF(rows: PessoaExportRow[], restaurante: string): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14); doc.text(`Pessoas — ${restaurante}`, 14, 15);
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`${rows.length} pessoa(s) · gerado em ${new Date().toLocaleDateString("pt-BR")}`, 14, 21);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 26,
    head: [["Nome", "Vínculo", "Cargo", "Área", "E-mail", "CPF", "Acesso", "Situação"]],
    body: rows.map((r) => [r.nome, r.vinculo, r.cargo, r.area, r.email, r.cpf, r.acesso, r.situacao]),
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 247, 250] },
  });
  doc.save(`pessoas-${slug(restaurante)}-${hoje()}.pdf`);
}
