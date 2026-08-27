// Gera PDF das escalas cadastradas — Sólides × planejamento.app — de todos os
// colaboradores, pra imprimir/compartilhar. Um bloco por pessoa: banner com
// vínculo, marca de CARGO DE CONFIANÇA e o CICLO DE DOMINGOS (planejamento.app),
// seguido de duas linhas (Sólides / planejamento.app) com o horário de cada dia.
// Dias divergentes ficam destacados na linha do planejamento.app.
//
// Uso: const doc = await gerarEscalasPDF({ ... }); baixarOuCompartilhar(doc.output("blob"), ...)

import type { jsPDF as JsPDFType } from "jspdf";
import { pad2 } from "../../core/utils/date";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const AREIA: [number, number, number] = [233, 226, 209];
const CINZA: [number, number, number] = [120, 130, 145];
const VERM_BG: [number, number, number] = [254, 226, 226];
const VERM_TX: [number, number, number] = [153, 27, 27];
const ROXO_BG: [number, number, number] = [237, 233, 254];

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type EscalaPDFDia = {
  sol: string;      // horário Sólides ("08:00–17:00" | "folga")
  app: string;      // horário planejamento.app
  solAtivo: boolean;
  appAtivo: boolean;
  diverge: boolean;
};

export type EscalaPDFLinha = {
  nome: string;
  vinculo?: string;      // rótulo já amigável
  confianca: boolean;    // cargo de confiança (não bate ponto)
  ciclo: string;         // ciclo de domingos (planejamento.app)
  temApp: boolean;
  totalSol: number;      // minutos
  totalApp: number;      // minutos
  dias: EscalaPDFDia[];  // 7 posições (0=Dom..6=Sáb)
};

export type EscalaPDFParams = {
  restaurantNome: string;
  linhas: EscalaPDFLinha[];
};

const fmtH = (min: number) => (min <= 0 ? "—" : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);

export async function gerarEscalasPDF({ restaurantNome, linhas }: EscalaPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TXT_DARK);
  doc.text("Escalas cadastradas — Sólides × planejamento.app", MARGIN_X, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome, MARGIN_X, 17);

  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.setFontSize(8);
  doc.text(stamp, pageW - MARGIN_X, 12, { align: "right" });

  type Cell = string | { content: string; styles?: object; colSpan?: number };
  const head: Cell[] = [
    { content: "", styles: { halign: "left" } },
    ...DIAS.map((d) => ({ content: d, styles: { halign: "center" } })),
  ];

  const body: Cell[][] = [];
  for (const l of linhas) {
    // Banner da pessoa (colSpan 8): nome · vínculo · confiança · ciclo · carga.
    const partes: string[] = [l.nome];
    if (l.vinculo) partes.push(l.vinculo);
    if (l.confianca) partes.push("🔒 CARGO DE CONFIANÇA (não bate ponto)");
    partes.push(`Domingos (planejamento.app): ${l.ciclo}`);
    partes.push(`Carga sem. — Sólides: ${fmtH(l.totalSol)}${l.temApp ? ` · planejamento.app: ${fmtH(l.totalApp)}` : ""}`);
    body.push([{
      content: partes.join("   ·   "),
      colSpan: 8,
      styles: {
        fillColor: l.confianca ? ROXO_BG : [242, 242, 242],
        textColor: TXT_DARK, fontStyle: "bold", halign: "left", fontSize: 8,
      },
    }]);

    // Linha Sólides.
    body.push([
      { content: "Sólides", styles: { halign: "left", fontStyle: "bold", textColor: CINZA, fontSize: 7 } },
      ...l.dias.map((d) => ({
        content: d.sol,
        styles: { halign: "center", textColor: d.solAtivo ? TXT_DARK : CINZA },
      })),
    ]);

    // Linha planejamento.app (destaca divergências).
    body.push([
      { content: "planejamento.app", styles: { halign: "left", fontStyle: "bold", textColor: CINZA, fontSize: 7 } },
      ...l.dias.map((d) => ({
        content: l.temApp ? d.app : "—",
        styles: l.temApp && d.diverge
          ? { halign: "center", fillColor: VERM_BG, textColor: VERM_TX, fontStyle: "bold" }
          : { halign: "center", textColor: l.temApp && d.appAtivo ? TXT_DARK : CINZA },
      })),
    ]);

    // Espaço entre pessoas.
    body.push([{ content: "", colSpan: 8, styles: { fillColor: [255, 255, 255], lineWidth: 0, minCellHeight: 1.5 } }]);
  }

  autoTable(doc, {
    startY: 22,
    head: [head],
    body,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 },
      lineWidth: 0.15,
      lineColor: [210, 210, 210],
      valign: "middle",
      textColor: TXT_DARK,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: AREIA, textColor: TXT_DARK, fontStyle: "bold", fontSize: 8, halign: "center",
    },
    columnStyles: { 0: { cellWidth: 34, halign: "left" } },
  });

  return doc;
}
