// Gerador de PDF do termo de entrega de uniformes / EPIs.
// Baseado no template Sororoca (uma vez por entrega — uniforme OU EPI,
// não mistura). jsPDF + autotable, lazy-loaded.

import type { jsPDF as JsPDFType } from "jspdf";
import type {
  EntregaUniforme, Restaurant, TermoUniformesConfig,
} from "../../core/types";

const MARGIN = 14;
const COR_TITULO: [number, number, number] = [42, 26, 14];
const COR_BORDA:  [number, number, number] = [120, 120, 120];
const COR_VERDE:  [number, number, number] = [200, 230, 201];
const COR_VERM:   [number, number, number] = [255, 205, 210];
const COR_HEADER: [number, number, number] = [225, 235, 245];

// Texto legal default — Sororoca (NR1/NR6 só pra EPI)
const TEXTO_LEGAL_EPI_DEFAULT =
  "TERMO DE RESPONSABILIDADE: Declaro para devidos fins, que recebi na data acima o Equipamento de Proteção " +
  "Individual acima descrito, gratuitamente, fui treinado quanto ao uso e conservação do mesmo, e que estou " +
  "ciente ser de uso obrigatório durante a realização de minhas atividades e de minha inteira responsabilidade. " +
  "Declaro ainda ter ciência que: a) Os EPI's deverão ser utilizados unicamente para a finalidade a qual se " +
  "destinam; b) Qualquer alteração que os tornem parcial ou totalmente inadequado para uso deverá ser por mim " +
  "comunicado imediatamente a meu superior; c) A falta do uso, por mim, dos EPI's fornecidos constitui um ato " +
  "faltoso sujeito a sanções disciplinares previstas no regulamento interno, inclusive demissão por justa causa; " +
  "d) Entendo que sou responsável pela guarda e conservação do EPI, em caso de perda, extravio ou inutilização " +
  "proposital, me comprometo a ressarcir a empresa, conforme previsto no parágrafo 1º do artigo 462 da CLT. Em " +
  "caso de desligamento desta empresa, estou ciente que devo devolver os EPI's a mim entregues e que perda ou " +
  "dano acarretarão em desconto do valor do mesmo em meu salário ou rescisão.\n\n" +
  "*Bases legais: NR1 E NR6";

const TEXTO_LEGAL_UNIFORME_DEFAULT =
  "TERMO DE RESPONSABILIDADE: Declaro para devidos fins, que recebi na data acima os uniformes acima descritos. " +
  "Estou ciente que sou responsável pela guarda e conservação dos mesmos. Em caso de desligamento desta empresa, " +
  "estou ciente que devo devolver os uniformes a mim entregues e que perda ou dano acarretarão em desconto do " +
  "valor dos mesmos em meu salário ou rescisão.";

export type TermoPDFParams = {
  entrega: EntregaUniforme;
  restaurant: Restaurant;
  candidatoNome: string;
  candidatoCpf: string;
  funcao?: string;
  // Override por restaurante (textos + meta do cabeçalho)
  config?: TermoUniformesConfig | null;
};

function fmtCpf(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  if (d.length !== 11) return s || "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export async function gerarTermoUniformesPDF(params: TermoPDFParams): Promise<JsPDFType> {
  const { entrega, restaurant, candidatoNome, candidatoCpf, funcao, config } = params;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const ehEpi = entrega.tipo === "epi";
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // ─── Cabeçalho ───
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, MARGIN, pageW - MARGIN * 2, 22);

  // Linha vertical separando título da meta direita
  const COL_TITULO_W = pageW - MARGIN * 2 - 50;
  doc.line(MARGIN + COL_TITULO_W, MARGIN, MARGIN + COL_TITULO_W, MARGIN + 22);

  // Título central
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COR_TITULO);
  const titulo = ehEpi
    ? "REGISTRO DE ENTREGA DE EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL (EPI)"
    : "REGISTRO DE ENTREGA DE UNIFORME";
  doc.text(titulo, MARGIN + COL_TITULO_W / 2, MARGIN + 10, { align: "center" });
  doc.setFontSize(13);
  doc.text(restaurant.nome.toUpperCase(), MARGIN + COL_TITULO_W / 2, MARGIN + 17, { align: "center" });

  // Meta direita
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const metaX = MARGIN + COL_TITULO_W + 3;
  const elaboradoEm = config?.elaboradoEm || "—";
  const codDoc = config?.codDoc || "—";
  const revisao = config?.revisao || "0";
  doc.text(`ELAB: ${elaboradoEm}`, metaX, MARGIN + 6);
  doc.text(`CÓD: ${codDoc}`,       metaX, MARGIN + 12);
  doc.text(`REVISÃO: ${revisao}`,  metaX, MARGIN + 18);

  // ─── Dados do colaborador ───
  const yColab = MARGIN + 26;
  doc.setDrawColor(...COR_BORDA);
  doc.rect(MARGIN, yColab, pageW - MARGIN * 2, 8);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COR_TITULO);
  doc.text(`Colaborador: `, MARGIN + 2, yColab + 5);
  doc.setFont("helvetica", "normal");
  doc.text(candidatoNome, MARGIN + 25, yColab + 5);
  doc.setFont("helvetica", "bold");
  doc.text(`CPF: `, MARGIN + 120, yColab + 5);
  doc.setFont("helvetica", "normal");
  doc.text(fmtCpf(candidatoCpf), MARGIN + 130, yColab + 5);
  if (funcao) {
    doc.setFont("helvetica", "bold");
    doc.text(`FUNÇÃO: `, MARGIN + 180, yColab + 5);
    doc.setFont("helvetica", "normal");
    doc.text(funcao, MARGIN + 195, yColab + 5);
  }

  // ─── Tabela de itens ───
  const dataEntrega = new Date(entrega.entregueEm).toLocaleDateString("pt-BR");
  const linhas = entrega.itens.map(i => [
    i.nome,
    `R$ ${i.custoUnit.toFixed(2)}`,
    String(i.qtd),
    i.tamanho || "—",
    ehEpi ? (i.caEpi || "—") : "",   // CA só pra EPI
    dataEntrega,
    "",                              // assinatura colaborador
    "",                              // data devolução
    "",                              // assinatura recebedor
  ]);

  const head = ehEpi
    ? [["DESCRIÇÃO EPI", "VALOR UNIT.", "QTD", "TAMANHO", "C.A.", "DATA ENTREGA", "ASS. COLABORADOR", "DATA DEVOLUÇÃO", "ASS. RECEBEDOR"]]
    : [["DESCRIÇÃO UNIFORME", "VALOR UNIT.", "QTD", "TAMANHO", "DATA ENTREGA", "ASS. COLABORADOR", "DATA DEVOLUÇÃO", "ASS. RECEBEDOR"]];

  // Pra uniforme remove a coluna C.A.
  const linhasFinal = ehEpi ? linhas : linhas.map(r => [r[0], r[1], r[2], r[3], r[5], r[6], r[7], r[8]]);

  autoTable(doc, {
    head,
    body: linhasFinal,
    startY: yColab + 9,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: COR_BORDA,
      textColor: COR_TITULO,
    },
    headStyles: {
      fillColor: COR_HEADER,
      textColor: COR_TITULO,
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: ehEpi ? {
      0: { cellWidth: "auto", halign: "left" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center", fillColor: COR_VERDE },
      6: { cellWidth: 35 },
      7: { halign: "center", fillColor: COR_VERM },
      8: { cellWidth: 35 },
    } : {
      0: { cellWidth: "auto", halign: "left" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center", fillColor: COR_VERDE },
      5: { cellWidth: 38 },
      6: { halign: "center", fillColor: COR_VERM },
      7: { cellWidth: 38 },
    },
    // Mínimo 6 linhas vazias pra futuras entregas (padrão Sororoca)
    didDrawPage: () => {
      // header repetido se quebrar página — já default do autotable
    },
  });

  // ─── Termo de responsabilidade ───
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const textoLegal = ehEpi
    ? (config?.textoLegalEpi || TEXTO_LEGAL_EPI_DEFAULT)
    : (config?.textoLegalUniforme || TEXTO_LEGAL_UNIFORME_DEFAULT);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COR_TITULO);
  const splitText = doc.splitTextToSize(textoLegal, pageW - MARGIN * 2);
  doc.text(splitText, MARGIN, finalY + 6);

  return doc;
}

/** Baixa o PDF no navegador. */
export async function baixarTermoUniformesPDF(params: TermoPDFParams): Promise<void> {
  const doc = await gerarTermoUniformesPDF(params);
  const safeName = params.candidatoNome
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const tipo = params.entrega.tipo;
  doc.save(`termo-${tipo}-${safeName}.pdf`);
}
