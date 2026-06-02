// Gera PDF consolidado de TODOS os lotes de ajuste pendentes — uma seção
// por empregado, com a tabela de apontamentos (data + regra + detalhe +
// batidas) e o status de envio do lote (enviado em / reenviado em).
// jsPDF + autoTable lazy-loaded (mesmo padrão de gerarVTPDF/gerarVRPDF).
//
// Uso típico: o líder cliciuma vez por dia o botão "Gerar PDF" pra ter um
// resumo impresso/PDF dos pedidos abertos, pra cobrar pessoalmente quem
// não respondeu.

import type { jsPDF as JsPDFType } from "jspdf";
import type { LoteRascunhoDoc } from "../../core/excecoes/loteRascunho";
import { RULES_META } from "../../core/excecoes/rules";
import { pad2 } from "../../core/utils/date";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const TXT_MUTED: [number, number, number] = [100, 116, 139];
const COR_AMBAR: [number, number, number] = [180, 83, 9]; // amber-700

export type LotePDFApontamento = {
  date: string;       // YYYY-MM-DD
  ruleId: string;
  description: string;
  detail?: string;
  batidas?: string;
};

export type LotePDFEmpregado = {
  empregadoId: string;
  nome: string;
  cpf?: string;
  apontamentos: LotePDFApontamento[];
  // Status do envio do lote
  lote?: LoteRascunhoDoc;
};

export type GerarLotesPDFParams = {
  ano: number;
  mes: number;        // 1..12
  restaurantNome: string;
  empregados: LotePDFEmpregado[];
};

function fmtData(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function fmtCpf(d: string | undefined): string {
  const x = (d || "").replace(/\D/g, "");
  if (x.length !== 11) return d || "";
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function fmtDataHoraIso(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export async function gerarLotesPDF({
  ano, mes, restaurantNome, empregados,
}: GerarLotesPDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_X = 12;

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TXT_DARK);
  doc.text(`Pedidos de ajuste em aberto — ${NOMES_MES[mes - 1]}/${ano}`, MARGIN_X, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TXT_MUTED);
  doc.text(restaurantNome, MARGIN_X, 19);

  const agora = new Date();
  const stamp =
    `Gerado em ${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ` +
    `${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
  doc.setFontSize(8);
  doc.text(stamp, pageW - MARGIN_X, 14, { align: "right" });

  const totalApontamentos = empregados.reduce((s, e) => s + e.apontamentos.length, 0);
  doc.setFontSize(9);
  doc.text(
    `${empregados.length} empregado(s) · ${totalApontamentos} apontamento(s) pendente(s)`,
    pageW - MARGIN_X, 19, { align: "right" },
  );

  let yCursor = 28;

  // ── Uma seção por empregado ───────────────────────────────────────────
  for (let i = 0; i < empregados.length; i++) {
    const emp = empregados[i];

    // Quebra de página se restar pouco espaço (cabeçalho + 1-2 linhas).
    if (yCursor > 250) {
      doc.addPage();
      yCursor = 18;
    }

    // Nome + CPF
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...TXT_DARK);
    doc.text(emp.nome, MARGIN_X, yCursor);
    if (emp.cpf) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TXT_MUTED);
      doc.text(`CPF ${fmtCpf(emp.cpf)}`, MARGIN_X, yCursor + 4.5);
    }
    yCursor += emp.cpf ? 8 : 5;

    // Status do envio do lote
    if (emp.lote?.enviadoEm) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COR_AMBAR);
      const tipo = emp.lote.enviadoTipo === "presencial" ? "presencial" : "WhatsApp";
      doc.text(
        `Enviado em ${fmtDataHoraIso(emp.lote.enviadoEm)} (${tipo})`,
        MARGIN_X, yCursor,
      );
      yCursor += 4;
      for (const r of emp.lote.reenvios || []) {
        const t = r.tipo === "presencial" ? "presencial" : "WhatsApp";
        doc.text(
          `Reenviado em ${fmtDataHoraIso(r.em)} (${t})`,
          MARGIN_X, yCursor,
        );
        yCursor += 4;
      }
    } else if (emp.lote) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(...TXT_MUTED);
      doc.text("Ainda não enviado", MARGIN_X, yCursor);
      yCursor += 4;
    }
    yCursor += 1;

    // Tabela de apontamentos
    autoTable(doc, {
      startY: yCursor,
      margin: { left: MARGIN_X, right: MARGIN_X },
      head: [["Data", "Regra", "Detalhe", "Batidas"]],
      body: emp.apontamentos.map((a) => {
        const label = RULES_META[a.ruleId as keyof typeof RULES_META]?.label || a.ruleId;
        return [
          fmtData(a.date),
          label,
          a.detail || a.description || "",
          a.batidas || "—",
        ];
      }),
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
        textColor: TXT_DARK,
        lineColor: [229, 231, 235],
        lineWidth: 0.1,
      },
      headStyles: {
        fontStyle: "bold",
        fillColor: [254, 243, 199],   // amber-100
        textColor: [120, 53, 15],     // amber-900
        lineColor: [252, 211, 77],
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 38 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 56 },
      },
      didDrawPage: () => {
        // Mantém a margem em páginas extras
      },
    });

    // Posiciona o cursor após a tabela
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    yCursor = (typeof lastY === "number" ? lastY : yCursor) + 8;
  }

  if (empregados.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...TXT_MUTED);
    doc.text("Nenhum lote em aberto.", MARGIN_X, yCursor + 5);
  }

  return doc;
}
