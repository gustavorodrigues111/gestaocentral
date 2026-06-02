// ════════════════════════════════════════════════════════════════════════════
//  Gera o PDF de divisão de gorjetas do mês.
//
//  Layout: A4 retrato com cabeçalho (restaurante + mês + recorte de filtro),
//  3 boxes de totais (Bruto / Retenção / Líquido), tabela com 1 linha por
//  empregado e rodapé com totais. Empregados são agrupados por área via
//  linhas separadoras (mesmo padrão da escala). Lazy loads jspdf + autotable
//  só quando chamado.
// ════════════════════════════════════════════════════════════════════════════

import type { jsPDF as JsPDFType } from "jspdf";
import { nomeMes } from "../../core/utils/date";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type GorjetasPDFLinha = {
  nome: string;
  cargoNome: string;
  area: string;
  bruto: number;
  retencao: number;
  liquido: number;
  diasComRecebimento: number;
  demitidoEm?: string | null;   // YYYY-MM-DD (primeiro dia FORA) — vira badge na linha
};

// `demitidoEm` é o primeiro dia FORA. Pra exibir, mostra o último dia
// trabalhado (= demitidoEm − 1).
function fmtDataSaida(demitidoEm: string): string {
  const [y, m, d] = demitidoEm.split("-").map(Number);
  if (!y || !m || !d) return demitidoEm;
  const dt = new Date(y, m - 1, d - 1);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

export type GorjetasPDFParams = {
  ano: number;
  mes: number;
  restaurantNome: string;
  subtitulo: string;            // ex: "Cidade Velha · Salão"
  linhas: GorjetasPDFLinha[];
  totais: { bruto: number; retencao: number; liquido: number; distribuido: number };
  diasLancados: number;
};

export async function gerarGorjetasPDF({
  ano, mes, restaurantNome, subtitulo, linhas, totais, diasLancados,
}: GorjetasPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 210mm
  const MARGIN_X = 14;

  // Paleta — verde "dinheiro" pro título, neutros pros cards.
  const COR_PRIMARIA: [number, number, number] = [16, 122, 64];   // verde escuro
  const COR_BRUTO: [number, number, number] = [253, 230, 138];    // amarelo bem suave
  const COR_RETENCAO: [number, number, number] = [254, 215, 215]; // rosa suave
  const COR_LIQUIDO: [number, number, number] = [187, 247, 208];  // verde suave
  const COR_TEXTO_ESCURO: [number, number, number] = [31, 41, 55]; // gray-800
  const COR_TEXTO_MEDIO: [number, number, number] = [107, 114, 128]; // gray-500
  const COR_BORDA: [number, number, number] = [229, 231, 235];    // gray-200

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COR_PRIMARIA);
  doc.text("Divisão de Gorjetas", MARGIN_X, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...COR_TEXTO_ESCURO);
  doc.text(`${restaurantNome} — ${nomeMes(mes)} de ${ano}`, MARGIN_X, 25);

  doc.setFontSize(9);
  doc.setTextColor(...COR_TEXTO_MEDIO);
  doc.text(subtitulo, MARGIN_X, 30.5);

  // Data de emissão (canto direito)
  const agora = new Date();
  const dataEmissao = `${String(agora.getDate()).padStart(2, "0")}/${String(agora.getMonth() + 1).padStart(2, "0")}/${agora.getFullYear()} ${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  doc.text(`Emitido em ${dataEmissao}`, pageW - MARGIN_X, 30.5, { align: "right" });

  // Linha divisória sutil
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, 34, pageW - MARGIN_X, 34);

  // ── Cards de totais ──────────────────────────────────────────────────────
  const yCards = 40;
  const cardW = (pageW - MARGIN_X * 2 - 6) / 3;
  const cardH = 22;

  function drawCard(x: number, label: string, valor: string, cor: [number, number, number]) {
    doc.setFillColor(...cor);
    doc.roundedRect(x, yCards, cardW, cardH, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COR_TEXTO_MEDIO);
    doc.text(label.toUpperCase(), x + 4, yCards + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...COR_TEXTO_ESCURO);
    doc.text(valor, x + 4, yCards + 16);
  }

  drawCard(MARGIN_X, "Bruto do mês", fmtBR(totais.bruto), COR_BRUTO);
  drawCard(MARGIN_X + cardW + 3, "Retenção", fmtBR(totais.retencao), COR_RETENCAO);
  drawCard(MARGIN_X + cardW * 2 + 6, "Líquido distribuído", fmtBR(totais.distribuido), COR_LIQUIDO);

  // Info abaixo dos cards
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COR_TEXTO_MEDIO);
  doc.text(
    `${linhas.length} empregado(s) · ${diasLancados} dia(s) lançado(s)`,
    MARGIN_X,
    yCards + cardH + 6,
  );

  // ── Tabela ───────────────────────────────────────────────────────────────
  // Linhas agrupadas por área — insere linhas "separadoras" com a área
  // toda vez que muda. autoTable não tem rowSpan trivial, então simulamos
  // com colSpan + estilo de cabeçalho.
  type Body = (string | number)[];
  const body: Body[] = [];
  let areaPrev: string | null = null;
  for (const l of linhas) {
    if (l.area !== areaPrev) {
      body.push([{
        content: l.area || "Sem área",
        colSpan: 6,
        // Marker pra estilizar via didParseCell.
        styles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: "bold", fontSize: 9 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any]);
      areaPrev = l.area;
    }
    // Demitido: célula multi-linha — nome + "Demitido em DD/MM/AAAA" em
    // segunda linha. autoTable suporta \n e quebra naturalmente.
    const nomeCel = l.demitidoEm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? { content: `${l.nome}\nDemitido em ${fmtDataSaida(l.demitidoEm)}`, styles: { textColor: [127, 29, 29] } } as any
      : l.nome;
    body.push([
      nomeCel,
      l.cargoNome,
      l.diasComRecebimento,
      fmtBR(l.bruto),
      fmtBR(l.retencao),
      fmtBR(l.liquido),
    ]);
  }

  // Rodapé com totais
  const totalLinhas: Body = [{
    content: "TOTAL",
    colSpan: 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    styles: { fontStyle: "bold", halign: "right", fillColor: [243, 244, 246] } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
    linhas.reduce((s, l) => s + l.diasComRecebimento, 0),
    fmtBR(linhas.reduce((s, l) => s + l.bruto, 0)),
    fmtBR(linhas.reduce((s, l) => s + l.retencao, 0)),
    fmtBR(linhas.reduce((s, l) => s + l.liquido, 0)),
  ];
  body.push(totalLinhas);

  autoTable(doc, {
    startY: yCards + cardH + 12,
    head: [["Empregado", "Cargo", "Dias", "Bruto", "Retenção", "Líquido"]],
    body,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
      lineColor: COR_BORDA,
      lineWidth: 0.1,
      textColor: COR_TEXTO_ESCURO,
    },
    headStyles: {
      fillColor: COR_PRIMARIA,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 38 },
      2: { halign: "right", cellWidth: 14 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 26 },
      5: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    didDrawPage: (data) => {
      // Footer com número da página
      const pageNum = doc.getNumberOfPages();
      const totalPages = doc.getNumberOfPages();
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COR_TEXTO_MEDIO);
      doc.text(
        `Página ${data.pageNumber} de ${totalPages}`,
        pageW / 2,
        pageH - 6,
        { align: "center" },
      );
      // Marca d'água sutil
      doc.text("planejamento.app", pageW - MARGIN_X, pageH - 6, { align: "right" });
      // Evita warning de pageNum não usado
      void pageNum;
    },
  });

  return doc;
}
