import type { jsPDF as JsPDFType } from "jspdf";
import type {
  FreelaPagamento, FreelaShift, Restaurant,
} from "../../core/types";
import { fmtBR, fmtHoras } from "./helpers";

const MARGIN = 18;
const ACCENT: [number, number, number] = [99, 102, 241];
const TEXT: [number, number, number]   = [28, 23, 16];
const TEXT2: [number, number, number]  = [100, 116, 139];

export type LotePDFParams = {
  lote: FreelaPagamento;
  shifts: FreelaShift[];       // shifts do lote
  restaurant: Restaurant;
};

export async function gerarLotePDF({ lote, shifts, restaurant }: LotePDFParams): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const mensalistas = lote.mensalistas || [];

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

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TEXT);
  doc.text("LOTE DE PAGAMENTO — FREELAS", pageW / 2, 45, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT2);
  doc.text(lote.numero, pageW / 2, 52, { align: "center" });
  doc.text(`Gerado em ${fmtDate(lote.criadoEm)} por ${lote.criadoPorNome}`, pageW / 2, 57, { align: "center" });
  if (lote.status === "pago" && lote.pagoEm) {
    doc.setTextColor(34, 197, 94);
    doc.text(`✓ PAGO em ${fmtDate(lote.pagoEm)}${lote.formaPagamento ? ` (${lote.formaPagamento})` : ""}`, pageW / 2, 63, { align: "center" });
    doc.setTextColor(...TEXT2);
  }

  let y = 72;
  if (lote.observacao) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT2);
    const lines = doc.splitTextToSize(`Obs.: ${lote.observacao}`, pageW - 2 * MARGIN);
    lines.forEach((l: string) => { doc.text(l, MARGIN, y); y += 4; });
    y += 2;
  }

  // ─── Resumo por pessoa ───
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT);
  doc.text("RESUMO POR PESSOA", MARGIN, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Nome", "PIX", "Turnos", "Horas", "Total"]],
    body: [
      ...lote.pessoasResumo.map((p) => [
        p.nome,
        p.pix || "—",
        String(p.qtdShifts),
        fmtHoras(p.totalHoras),
        fmtBR(p.totalValor),
      ]),
      // Mensalistas: 1 linha por pessoa com nome + PIX + total (sem turnos/horas).
      ...mensalistas.map((l) => [
        l.nome,
        l.pix || "—",
        "mensal.",
        "—",
        fmtBR(l.total),
      ]),
    ],
    foot: [[
      { content: `Total ${lote.qtdPessoas} pessoa(s)`, colSpan: 2 },
      String(lote.qtdShifts),
      fmtHoras(lote.pessoasResumo.reduce((a, p) => a + p.totalHoras, 0)),
      fmtBR(lote.totalGeral),
    ]],
    styles: { fontSize: 9, cellPadding: 1.5 },
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [241, 245, 249], textColor: TEXT, fontStyle: "bold" },
    columnStyles: {
      2: { halign: "center" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-expect-error autoTable adds lastAutoTable
  y = (doc.lastAutoTable?.finalY || y) + 8;

  // ─── Detalhe por turno (só se houver turnos) ───
  if (shifts.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ACCENT);
    doc.text("DETALHE DOS TURNOS", MARGIN, y);
    y += 4;

    const detalheBody = shifts
      .sort((a, b) => a.nomeSnapshot.localeCompare(b.nomeSnapshot) || a.date.localeCompare(b.date))
      .map((s) => [
        s.nomeSnapshot,
        fmtDateBR(s.date),
        s.area || "—",
        s.entrada && s.saida ? `${s.entrada}–${s.saida}` : "—",
        fmtHoras(s.horas || 0),
        s.valorTipo === "diaria" ? `${fmtBR(s.valorUnit || 0)} (diária)` : `${fmtBR(s.valorUnit || 0)}/h`,
        fmtBR(s.totalCalc || 0),
      ]);

    autoTable(doc, {
      startY: y,
      head: [["Pessoa", "Data", "Área", "Horário", "Horas", "Tarifa", "Total"]],
      body: detalheBody,
      styles: { fontSize: 8, cellPadding: 1.2 },
      headStyles: { fillColor: [241, 245, 249], textColor: TEXT, fontStyle: "bold" },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
    // @ts-expect-error autoTable adds lastAutoTable
    y = (doc.lastAutoTable?.finalY || y) + 8;
  }

  // ─── Detalhe dos mensalistas (só se houver) ───
  if (mensalistas.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ACCENT);
    doc.text("DETALHE DOS MENSALISTAS", MARGIN, y);
    y += 4;

    const mensBody = mensalistas
      .slice()
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.competencia.localeCompare(b.competencia))
      .map((l) => {
        const dias = l.diasCobertos ?? l.diasTrabalhados;
        const diasTxt = (l.faltasInjust || 0) > 0
          ? `${l.diasTrabalhados}/${l.diasNoMes} (${dias}−${l.faltasInjust} falta inj.)`
          : `${l.diasTrabalhados}/${l.diasNoMes}`;
        return [
          l.nome,
          competenciaRange(l.competencia),
          diasTxt,
          fmtBR(l.remuneracaoProporcional),
          `${fmtBR(l.gorjetaAplicada)} (${l.gorjetaModo === "bruto" ? "bruto" : "líq."})`,
          l.desconto > 0 ? `− ${fmtBR(l.desconto)}` : "—",
          l.acrescimo > 0 ? `+ ${fmtBR(l.acrescimo)}` : "—",
          fmtBR(l.total),
        ];
      });

    autoTable(doc, {
      startY: y,
      head: [["Pessoa", "Período", "Dias", "Remuneração", "Gorjeta", "Desc.", "Acrésc.", "Total"]],
      body: mensBody,
      styles: { fontSize: 8, cellPadding: 1.2 },
      headStyles: { fillColor: [241, 245, 249], textColor: TEXT, fontStyle: "bold" },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right", fontStyle: "bold" },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
  }

  return doc;
}

// "YYYY-MM" → "01/06/2026 – 30/06/2026" (período de referência da competência).
function competenciaRange(comp: string): string {
  const m = comp.match(/^(\d{4})-(\d{2})/);
  if (!m) return comp;
  const ano = Number(m[1]), mes = Number(m[2]);
  const ultimo = new Date(ano, mes, 0).getDate();
  return `01/${m[2]}/${m[1]} – ${String(ultimo).padStart(2, "0")}/${m[2]}/${m[1]}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Data do turno vem como "YYYY-MM-DD" — converter sem instanciar Date
// pra não cair em fuso (Date parsing UTC dá um dia a menos no Brasil).
function fmtDateBR(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
