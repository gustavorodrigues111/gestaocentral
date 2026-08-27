// Gera PDF das escalas cadastradas — Sólides × planejamento.app — de todos os
// colaboradores, pra imprimir/compartilhar. Segue o mesmo padrão da tela: por
// pessoa, um banner (vínculo · CARGO DE CONFIANÇA · CICLO DE DOMINGOS · carga)
// seguido de uma tabela com colunas Dia | Sólides | planejamento.app. Dias
// divergentes ficam destacados na coluna do planejamento.app.
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
  cargaSol: number; // minutos
  cargaApp: number; // minutos
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
const comCarga = (label: string, ativo: boolean, carga: number) => (ativo ? `${label}   ·   ${fmtH(carga)}` : label);

export async function gerarEscalasPDF({ restaurantNome, linhas }: EscalaPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TXT_DARK);
  doc.text("Escalas cadastradas — Sólides × planejamento.app", MARGIN_X, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome, MARGIN_X, 18);

  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.setFontSize(8);
  doc.text(stamp, pageW - MARGIN_X, 13, { align: "right" });

  type Cell = string | { content: string; styles?: object; colSpan?: number };
  const head: Cell[] = [
    { content: "Dia", styles: { halign: "center" } },
    { content: "Sólides", styles: { halign: "left" } },
    { content: "planejamento.app", styles: { halign: "left" } },
  ];

  const body: Cell[][] = [];
  for (const l of linhas) {
    // Banner da pessoa (colSpan 3): nome · vínculo · confiança · ciclo · carga.
    const partes: string[] = [l.nome];
    if (l.vinculo) partes.push(l.vinculo);
    if (l.confianca) partes.push("🔒 CARGO DE CONFIANÇA (não bate ponto)");
    partes.push(`Domingos (planejamento.app): ${l.ciclo}`);
    partes.push(`Carga sem. — Sólides: ${fmtH(l.totalSol)}${l.temApp ? ` · planejamento.app: ${fmtH(l.totalApp)}` : ""}`);
    body.push([{
      content: partes.join("   ·   "),
      colSpan: 3,
      styles: {
        fillColor: l.confianca ? ROXO_BG : [242, 242, 242],
        textColor: TXT_DARK, fontStyle: "bold", halign: "left", fontSize: 8.5,
      },
    }]);

    // Um dia por linha: Dia | Sólides | planejamento.app.
    for (let wd = 0; wd < 7; wd++) {
      const d = l.dias[wd];
      const diverge = l.temApp && d.diverge;
      body.push([
        { content: DIAS[wd], styles: { halign: "center", fontStyle: "bold", textColor: diverge ? VERM_TX : CINZA, fontSize: 8 } },
        { content: comCarga(d.sol, d.solAtivo, d.cargaSol), styles: { halign: "left", textColor: d.solAtivo ? TXT_DARK : CINZA } },
        l.temApp
          ? { content: comCarga(d.app, d.appAtivo, d.cargaApp), styles: diverge
              ? { halign: "left", fillColor: VERM_BG, textColor: VERM_TX, fontStyle: "bold" }
              : { halign: "left", textColor: d.appAtivo ? TXT_DARK : CINZA } }
          : { content: "—", styles: { halign: "left", textColor: CINZA } },
      ]);
    }

    // Espaço entre pessoas.
    body.push([{ content: "", colSpan: 3, styles: { fillColor: [255, 255, 255], lineWidth: 0, minCellHeight: 2 } }]);
  }

  autoTable(doc, {
    startY: 23,
    head: [head],
    body,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: {
      fontSize: 9,
      cellPadding: { top: 1.4, bottom: 1.4, left: 2.5, right: 2.5 },
      lineWidth: 0.15,
      lineColor: [210, 210, 210],
      valign: "middle",
      textColor: TXT_DARK,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: AREIA, textColor: TXT_DARK, fontStyle: "bold", fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 16, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: "auto" },
    },
  });

  return doc;
}
