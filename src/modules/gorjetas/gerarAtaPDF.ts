// Gera PDF da Ata de Assembleia da regra de divisão de gorjeta.
// Versão simplificada — pode evoluir depois pra layout do AppTip.
//
// jsPDF + jspdf-autotable são lazy loaded (carga só quando o user clica
// em "Gerar PDF") — corta ~250KB do bundle inicial.

import type { jsPDF as JsPDFType } from "jspdf";
import type { Cargo, Empregado, Restaurant, SplitVersion } from "../../core/types";
import { AREAS } from "../../core/types";
import { computeAreaPercentages, countEmpregadosRegistradosNaArea } from "./splitRules";

export type AtaParams = {
  splitVersion: SplitVersion;
  restaurant: Restaurant;
  cargos: Cargo[];
  empregados: Empregado[];          // todos os do restaurante (filtra registrados ativos)
  empregadosAssinantesIds: string[]; // selecionados pra assinar
};

const MARGIN = 20;
const ACCENT: [number, number, number] = [99, 102, 241];      // indigo
const TEXT: [number, number, number] = [28, 23, 16];
const TEXT2: [number, number, number] = [100, 116, 139];

export async function gerarAtaPDF({
  splitVersion, restaurant, cargos, empregados, empregadosAssinantesIds,
}: AtaParams): Promise<JsPDFType> {
  // Lazy load — só carrega jsPDF quando o user de fato vai gerar o PDF.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  // Helper: garante espaço, paginar
  function ensure(needed: number) {
    if (y + needed > pageH - 18) {
      doc.addPage();
      y = 15;
    }
  }
  function texto(text: string, opts: {
    fontSize?: number; lineHeight?: number; x?: number; maxWidth?: number;
    color?: [number, number, number]; bold?: boolean; gap?: number;
  } = {}) {
    const fontSize = opts.fontSize || 10;
    const lh = opts.lineHeight || (fontSize * 0.45);
    const x = opts.x || MARGIN;
    const maxW = opts.maxWidth || (pageW - 2 * MARGIN);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...(opts.color || TEXT));
    const lines = doc.splitTextToSize(text, maxW);
    lines.forEach((line: string) => {
      ensure(lh + 1);
      doc.text(line, x, y);
      y += lh;
    });
    if (opts.gap) y += opts.gap;
  }
  function titulo(t: string) {
    ensure(14);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ACCENT);
    doc.text(t.toUpperCase(), MARGIN, y);
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y + 1.5, pageW - MARGIN, y + 1.5);
    y += 8;
  }

  // ─── Cabeçalho ───
  doc.setFillColor(...ACCENT);
  doc.rect(15, 15, 4, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT);
  doc.text(restaurant.nome, 22, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT2);
  const meta: string[] = [];
  if (restaurant.cnpj) meta.push(`CNPJ: ${restaurant.cnpj}`);
  if (restaurant.endereco) meta.push(restaurant.endereco);
  if (meta.length > 0) doc.text(meta.join(" · "), 22, 28);

  // ─── Título ───
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TEXT);
  doc.text("ATA DE ASSEMBLEIA", pageW / 2, 45, { align: "center" });
  doc.setFontSize(11);
  doc.text("Regra de Divisão de Gorjetas", pageW / 2, 52, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT2);
  const meetDate = splitVersion.ata?.meetingDate || splitVersion.effectiveFrom;
  doc.text(`Data: ${fmtDate(meetDate)}`, pageW / 2, 60, { align: "center" });
  if (splitVersion.ata?.meetingLocation) {
    doc.text(`Local: ${splitVersion.ata.meetingLocation}`, pageW / 2, 65, { align: "center" });
  }
  y = 75;

  // ─── Introdução ───
  texto(
    `Aos ${dataLonga(meetDate)}, reuniram-se na sede do estabelecimento ${restaurant.nome} ` +
    `os colaboradores listados ao final desta ata, em assembleia convocada pela direção, ` +
    `com o objetivo de deliberar e formalizar a regra de divisão das gorjetas recebidas. ` +
    `A regra abaixo entra em vigor a partir de ${fmtDate(splitVersion.effectiveFrom)} e ` +
    `substitui qualquer regra anterior aplicável a este estabelecimento.`,
    { fontSize: 10, lineHeight: 5, gap: 4 }
  );

  // ─── Modo ───
  titulo("1. Modo de Divisão");
  const modoLabel = splitVersion.mode === "global_points" ? "Pontos Globais" : "Por Área + Pontos";
  texto(`Modo adotado: ${modoLabel}`, { bold: true, fontSize: 11, lineHeight: 6 });
  if (splitVersion.mode === "global_points") {
    texto(
      "Todo o pool líquido de gorjetas é distribuído entre os empregados que efetivamente " +
      "trabalharam no dia, proporcionalmente aos pontos do cargo de cada um. Não há separação por área.",
      { fontSize: 10, lineHeight: 5, gap: 3 }
    );
  } else {
    texto(
      "O pool líquido é distribuído primeiro entre as áreas (Bar, Cozinha, Salão, Limpeza) " +
      "conforme percentuais detalhados na seção seguinte. Dentro de cada área, o valor é " +
      "distribuído entre os empregados ativos da área proporcionalmente aos pontos do cargo.",
      { fontSize: 10, lineHeight: 5, gap: 3 }
    );
  }

  // ─── Imposto ───
  titulo("2. Retenção de Imposto");
  texto(
    `Sobre o valor bruto da gorjeta arrecadada em cada dia, será descontado o imposto de ` +
    `${splitVersion.taxRate.toFixed(2)}% antes da divisão. O saldo líquido ` +
    `(${(100 - splitVersion.taxRate).toFixed(2)}% do bruto) é o que efetivamente vai pra ` +
    `divisão entre os colaboradores.`,
    { fontSize: 10, lineHeight: 5, gap: 3 }
  );

  // ─── Áreas (modo área_points) ───
  if (splitVersion.mode === "area_points" && splitVersion.percentages) {
    titulo("3. Percentuais por Área");
    const cargoMap = Object.fromEntries(
      cargos.map(c => [c.id, { area: c.area, tipoVinculo: c.tipoVinculo }])
    );
    const empPorArea: Record<string, number> = {};
    AREAS.forEach(a => {
      empPorArea[a] = countEmpregadosRegistradosNaArea(empregados, cargoMap, a, meetDate);
    });
    const finalPct = computeAreaPercentages(splitVersion.percentages, empPorArea);

    const rows = AREAS.map(area => {
      const cfg = splitVersion.percentages![area];
      let tipo: string, valorConfig: string;
      if (cfg.type === "fixed") {
        tipo = "Fixo";
        valorConfig = `${cfg.value}%`;
      } else {
        tipo = "Variável (por empregado)";
        valorConfig = `${cfg.valuePerEmp}% × N`;
      }
      return [area, tipo, valorConfig, `${finalPct[area].toFixed(2)}%`];
    });
    autoTable(doc, {
      startY: y,
      head: [["Área", "Tipo", "Configuração", "% Efetivo (data)"]],
      body: rows,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2.5, textColor: TEXT, lineWidth: 0.2 },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as JsPDFType & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    const temVariavel = AREAS.some(a => splitVersion.percentages![a].type === "perEmployee");
    if (temVariavel) {
      texto(
        "Áreas marcadas como VARIÁVEL têm percentual flutuante: o cálculo é feito a cada dia " +
        "considerando a quantidade de empregados registrados ativos na área no dia. Áreas FIXAS " +
        "dividem o saldo restante (100% menos a soma das variáveis) proporcionalmente entre si.",
        { fontSize: 9, lineHeight: 4.5, color: TEXT2, gap: 3 }
      );
    }
  }

  // ─── Pontuação por Cargo ───
  const sectionNum = splitVersion.mode === "area_points" ? "4" : "3";
  titulo(`${sectionNum}. Pontuação por Cargo`);
  texto(
    "Cada cargo tem uma pontuação que define o peso do empregado na divisão dentro da sua área " +
    "(modo Por Área) ou no pool global (modo Pontos Globais). Quanto maior a pontuação, maior " +
    "a fração da gorjeta recebida.",
    { fontSize: 10, lineHeight: 5, gap: 3 }
  );

  const cargoRows = [...cargos]
    .filter(c => c.ativo && !c.semGorjeta)
    .sort((a, b) => (a.area || "z").localeCompare(b.area || "z") || a.nome.localeCompare(b.nome))
    .map(c => [c.nome, c.area, String(c.pontos), c.recebeProducao ? "Sim" : "—"]);

  if (cargoRows.length === 0) {
    texto("(Nenhum cargo com participação na gorjeta cadastrado.)", { fontSize: 10, color: TEXT2, gap: 4 });
  } else {
    autoTable(doc, {
      startY: y,
      head: [["Cargo", "Área", "Pontos", "Recebe Produção"]],
      body: cargoRows,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2.5, textColor: TEXT, lineWidth: 0.2 },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as JsPDFType & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // ─── Assinaturas ───
  doc.addPage();
  y = 20;
  titulo("Assinaturas dos Colaboradores");
  texto(
    "Os colaboradores listados abaixo, presentes na assembleia, manifestam ciência e concordância " +
    "com a regra de divisão de gorjetas formalizada nesta ata.",
    { fontSize: 10, lineHeight: 5, gap: 6 }
  );

  const assinantes = empregados
    .filter(e => empregadosAssinantesIds.includes(e.id))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  if (assinantes.length === 0) {
    texto("(Nenhum colaborador selecionado pra assinatura.)", { fontSize: 10, color: TEXT2 });
  } else {
    for (const emp of assinantes) {
      ensure(20);
      // Nome + CPF
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...TEXT);
      doc.text(emp.nome, MARGIN, y);
      if (emp.cpf) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...TEXT2);
        doc.text(`CPF: ${emp.cpf}`, MARGIN + 80, y);
      }
      y += 4;
      // Linha de assinatura
      doc.setDrawColor(...TEXT2);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + 6, MARGIN + 80, y + 6);
      doc.setFontSize(7);
      doc.text("Assinatura", MARGIN, y + 9);
      y += 14;
    }
  }

  // ─── Rodapé ───
  const totalPages = doc.internal.pages.length - 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...TEXT2);
    doc.text(`Página ${p} de ${totalPages}`, pageW - MARGIN, pageH - 10, { align: "right" });
    doc.text(`Gerada em ${new Date().toLocaleString("pt-BR")}`, MARGIN, pageH - 10);
  }

  return doc;
}

function fmtDate(ymd?: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function dataLonga(ymd?: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(n => parseInt(n, 10));
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}
