// Gera PDF da escala (prevista ou praticada) — pra imprimir e colar no vestiário.
// Layout: A4 paisagem, tabela colorida por status, agrupada por área,
// legenda no rodapé. jsPDF + autoTable lazy-loaded (corta ~250KB do bundle).
//
// Uso: `const doc = await gerarEscalaPDF({ ... }); doc.save("escala.pdf")`

import type { jsPDF as JsPDFType } from "jspdf";
import type { Cargo, Empregado, ScheduleStatus } from "../../core/types";
import { AREAS } from "../../core/types";
import { daysInMonth, dowShort, nomeMes, pad2 } from "../../core/utils/date";

// Cores RGB equivalentes às Tailwind usadas no STATUS_INFO da EscalaPage.
// Mantém o visual coerente entre tela e impresso.
const STATUS_COR: Record<ScheduleStatus, [number, number, number]> = {
  trabalho:  [16, 185, 129],   // emerald-500
  folga:     [209, 213, 219],  // gray-300
  freela:    [168, 85, 247],   // purple-500
  comp:      [107, 114, 128],  // gray-500
  comp_trab: [6, 95, 70],      // emerald-800
  ferias:    [14, 165, 233],   // sky-500
  falta_j:   [253, 164, 175],  // rose-300
  falta_i:   [225, 29, 72],    // rose-600
};

const STATUS_SHORT: Record<ScheduleStatus, string> = {
  trabalho:  "T",
  folga:     "F",
  freela:    "FR",
  comp:      "C",
  comp_trab: "CT",
  ferias:    "FE",
  falta_j:   "FJ",
  falta_i:   "FI",
};

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  trabalho:  "Trabalho",
  folga:     "Folga",
  freela:    "Freela",
  comp:      "Compensar",
  comp_trab: "Comp. trabalhada",
  ferias:    "Férias",
  falta_j:   "Falta justificada",
  falta_i:   "Falta injustificada",
};

// Cor usada nos textos escuros sobre fundos claros (folga, falta_j) — preto
// suave pra não competir com o fundo branco/cinza.
const TXT_DARK: [number, number, number]  = [26, 22, 18];
const TXT_LIGHT: [number, number, number] = [255, 255, 255];

function corTextoSobre(fundo: [number, number, number]): [number, number, number] {
  // Luminância simples; se claro demais, usa texto escuro.
  const [r, g, b] = fundo;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? TXT_DARK : TXT_LIGHT;
}

export type EscalaPDFParams = {
  ano: number;
  mes: number; // 1..12
  restaurantNome: string;
  empregados: Empregado[]; // ativos do mês, ordem desejada na tabela
  cargos: Cargo[];
  prevista: { [empregadoId: string]: { [date: string]: ScheduleStatus | undefined } };
  versao?: "prevista" | "real"; // título: "Prevista" ou "Praticada"
  subtitulo?: string; // ex: "Cidade Velha · Cozinha" — recorte exportado
};

export async function gerarEscalaPDF({
  ano, mes, restaurantNome, empregados, cargos, prevista, versao = "prevista", subtitulo,
}: EscalaPDFParams): Promise<JsPDFType> {
  // Lazy load — só carrega quando o user clica em exportar.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 297mm
  const pageH = doc.internal.pageSize.getHeight();  // 210mm
  const MARGIN_X = 8;

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  // Monta lista de dias do mês.
  const last = daysInMonth(ano, mes);
  const dias: { day: number; date: string; dow: string; weekend: boolean }[] = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(ano, mes - 1, d);
    const dowIdx = dt.getDay();
    dias.push({
      day: d,
      date: `${ano}-${pad2(mes)}-${pad2(d)}`,
      dow: dowShort(dt),
      weekend: dowIdx === 0 || dowIdx === 6,
    });
  }

  // ── Header textual no topo da página ───────────────────────────────────
  const titulo = versao === "real" ? "Escala Praticada" : "Escala Prevista";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TXT_DARK);
  doc.text(`${titulo} — ${nomeMes(mes)}/${ano}`, MARGIN_X, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(restaurantNome + (subtitulo ? `  ·  ${subtitulo}` : ""), MARGIN_X, 17);

  // Carimbo de geração no canto direito
  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.setFontSize(8);
  doc.text(stamp, pageW - MARGIN_X, 12, { align: "right" });

  // ── Tabela ─────────────────────────────────────────────────────────────
  // Coluna 0: nome do empregado + cargo (40mm)
  // Demais: 1 coluna por dia do mês (~7.5mm cada com 31 dias em A4 landscape)

  // Header da tabela: 2 linhas (DOW + número)
  const headRow1: (string | { content: string; styles?: object })[] = [
    { content: "Empregado", styles: { halign: "left" } },
    ...dias.map(d => ({
      content: d.dow,
      styles: {
        fillColor: d.weekend ? [254, 243, 199] : [233, 226, 209],
        textColor: TXT_DARK,
      },
    })),
  ];
  const headRow2: (string | { content: string; styles?: object })[] = [
    { content: "Cargo", styles: { halign: "left", fontStyle: "normal" } },
    ...dias.map(d => ({
      content: pad2(d.day),
      styles: {
        fillColor: d.weekend ? [254, 243, 199] : [233, 226, 209],
        textColor: TXT_DARK,
      },
    })),
  ];

  // Body agrupado por área: linha-separadora bold por área + linhas dos empregados.
  // Tipo permite tanto string solta quanto objeto com content + estilos + colSpan
  // (autoTable suporta tudo isso na sua CellInput).
  type Cell = string | { content: string; styles?: object; colSpan?: number };
  type Row = Cell[];
  const body: Row[] = [];

  for (const area of AREAS) {
    const empsArea = empregados
      .filter(e => {
        const c = cargoMap[e.cargoId];
        return c?.area === area;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));

    if (empsArea.length === 0) continue;

    // Linha-separadora de área (full-row colSpan)
    body.push([
      {
        content: area.toUpperCase(),
        colSpan: dias.length + 1,
        styles: {
          fillColor: [240, 240, 240] as [number, number, number],
          textColor: TXT_DARK,
          fontStyle: "bold",
          halign: "left",
          fontSize: 9,
        },
      },
    ]);

    for (const emp of empsArea) {
      const cargo = cargoMap[emp.cargoId];
      const cargoNome = cargo?.nome || "";
      const row: Row = [
        {
          content: cargoNome ? `${emp.nome}\n${cargoNome}` : emp.nome,
          styles: { halign: "left", fontStyle: "bold", fontSize: 7 },
        },
        ...dias.map(d => {
          const status = prevista[emp.id]?.[d.date];
          if (!status) {
            // Sem status — fundo branco (fim de semana fica âmbar suave)
            return {
              content: "",
              styles: d.weekend
                ? { fillColor: [254, 243, 199] as [number, number, number] }
                : {},
            };
          }
          const cor = STATUS_COR[status];
          return {
            content: STATUS_SHORT[status],
            styles: {
              fillColor: cor,
              textColor: corTextoSobre(cor),
              fontStyle: "bold",
            },
          };
        }),
      ];
      body.push(row);
    }
  }

  // Larguras: nome 38mm, cada dia ocupa o que sobra de forma uniforme.
  const usefulW = pageW - 2 * MARGIN_X;
  const nomeW = 38;
  const diaW = (usefulW - nomeW) / dias.length;

  autoTable(doc, {
    startY: 22,
    head: [headRow1, headRow2],
    body,
    theme: "grid",
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: {
      fontSize: 7,
      cellPadding: { top: 1, bottom: 1, left: 1, right: 1 },
      lineWidth: 0.15,
      lineColor: [180, 180, 180],
      valign: "middle",
      halign: "center",
      overflow: "hidden",
    },
    headStyles: {
      fillColor: [233, 226, 209],
      textColor: TXT_DARK,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 1, bottom: 1, left: 1, right: 1 },
    },
    columnStyles: {
      0: { cellWidth: nomeW, halign: "left" },
    },
    // Largura dos dias dinâmica
    didParseCell: (data) => {
      if (data.column.index > 0) {
        data.cell.styles.cellWidth = diaW;
      }
    },
  });

  // ── Legenda no rodapé ──────────────────────────────────────────────────
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
  let yLeg = finalY + 6;
  if (yLeg > pageH - 18) {
    doc.addPage();
    yLeg = 12;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...TXT_DARK);
  doc.text("Legenda", MARGIN_X, yLeg);

  // Itens da legenda em linha — cada item: quadradinho colorido + sigla + descrição
  yLeg += 4;
  const itensLeg: { short: string; label: string; cor: [number, number, number] }[] =
    (Object.keys(STATUS_LABEL) as ScheduleStatus[]).map(k => ({
      short: STATUS_SHORT[k],
      label: STATUS_LABEL[k],
      cor: STATUS_COR[k],
    }));

  let x = MARGIN_X;
  const itemW = 36; // largura por item da legenda
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  for (const it of itensLeg) {
    if (x + itemW > pageW - MARGIN_X) {
      x = MARGIN_X;
      yLeg += 6;
    }
    // Quadrado colorido
    doc.setFillColor(...it.cor);
    doc.rect(x, yLeg - 3, 4, 4, "F");
    // Sigla em bold
    doc.setFont("helvetica", "bold");
    doc.text(it.short, x + 5, yLeg);
    // Label
    doc.setFont("helvetica", "normal");
    doc.text(it.label, x + 5 + 5, yLeg);
    x += itemW;
  }

  return doc;
}
