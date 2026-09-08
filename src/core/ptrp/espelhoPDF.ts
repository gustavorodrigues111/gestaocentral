// ════════════════════════════════════════════════════════════════════════════
//  Espelho de Ponto (PDF) — módulo PTRP, no espírito do leiaute da Portaria
//  MTP 671/2021 (documento de conferência/assinatura do empregado).
//
//  Gera 1 página por colaborador a partir do SNAPSHOT congelado do fechamento
//  (PtrpApuracaoColab). Cabeçalho com empregador/empregado/período, tabela dia a
//  dia (previsto × marcações × trabalhado/extra/noturno/falta + exceções),
//  totais e campo de assinatura. jsPDF + autoTable lazy-loaded.
// ════════════════════════════════════════════════════════════════════════════
import type { jsPDF as JsPDFType } from "jspdf";
import type { PtrpApuracaoColab } from "./tipos";

const TXT_DARK: [number, number, number] = [31, 41, 55];
const CINZA: [number, number, number] = [100, 116, 139];
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type EspelhoMeta = {
  empresaNome: string;
  empresaCnpj?: string | null;
  cctNome?: string | null;
  compLabel: string;          // "Setembro/2026"
  geradoPor?: string | null;
};

const hm = (min: number): string => { const m = Math.max(0, Math.round(min || 0)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const fmtBR = (ymd: string): string => ymd.split("-").reverse().join("/");
const dow = (ymd: string): string => DOW[new Date(ymd + "T12:00:00").getDay()];

export async function gerarEspelhoPDF(colabs: PtrpApuracaoColab[], meta: EspelhoMeta): Promise<JsPDFType> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const MX = 12;

  colabs.forEach((c, idx) => {
    if (idx > 0) doc.addPage();

    // ── Cabeçalho ────────────────────────────────────────────────────────
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...TXT_DARK);
    doc.text("Espelho de Ponto", MX, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...CINZA);
    doc.text(`Competência ${meta.compLabel}`, pageW - MX, 14, { align: "right" });

    doc.setDrawColor(226, 232, 240); doc.line(MX, 17, pageW - MX, 17);

    doc.setFontSize(9.5); doc.setTextColor(...TXT_DARK);
    let y = 23;
    const linha = (label: string, val: string) => { doc.setFont("helvetica", "bold"); doc.text(label, MX, y); doc.setFont("helvetica", "normal"); doc.text(val || "—", MX + 32, y); y += 5; };
    linha("Empregador:", meta.empresaNome + (meta.empresaCnpj ? `  ·  CNPJ ${meta.empresaCnpj}` : ""));
    linha("Empregado:", `${c.nome}   ·   CPF ${c.cpf || "—"}`);
    linha("Cargo:", `${c.cargo || "—"}${c.admissao ? `     Admissão: ${fmtBR(c.admissao)}` : ""}`);
    if (meta.cctNome) linha("Convenção:", meta.cctNome);

    // ── Tabela dia a dia ─────────────────────────────────────────────────
    const body = c.dias.map(d => {
      const marc = d.marcacoes.length ? d.marcacoes.map(m => `${m.in || "—"}–${m.out || "—"}${m.pendente ? " (pend.)" : ""}`).join("  ") : "—";
      const obs: string[] = [...d.excecoes];
      for (const a of d.ajustes) obs.push(a.tipo + (a.in ? ` ${a.in}–${a.out}` : ""));
      return [
        `${d.data.slice(-2)}/${d.data.slice(5, 7)}`,
        dow(d.data),
        d.feriado ? "feriado" : d.previstoTxt === "folga" ? "folga" : (d.previstoTxt.includes("–") ? d.previstoTxt : (d.previstoMin ? hm(d.previstoMin) : "—")),
        marc,
        d.trabalhadoMin ? hm(d.trabalhadoMin) : "—",
        d.extraMin ? hm(d.extraMin) : "",
        d.noturnoMin ? hm(d.noturnoMin) : "",
        d.faltaMin ? hm(d.faltaMin) : "",
        obs.join(", "),
      ];
    });

    autoTable(doc, {
      startY: y + 2,
      head: [["Dia", "Sem", "Previsto", "Marcações", "Trab.", "Extra", "Not.", "Falta", "Ocorrências"]],
      body,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.3, textColor: TXT_DARK, lineColor: [226, 232, 240] },
      headStyles: { fillColor: [241, 245, 249], textColor: TXT_DARK, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" }, 1: { cellWidth: 10, halign: "center" },
        2: { cellWidth: 24 }, 3: { cellWidth: 42 },
        4: { cellWidth: 13, halign: "right" }, 5: { cellWidth: 13, halign: "right" },
        6: { cellWidth: 13, halign: "right" }, 7: { cellWidth: 13, halign: "right" },
        8: { cellWidth: "auto" },
      },
      margin: { left: MX, right: MX },
    });

    // ── Totais ───────────────────────────────────────────────────────────
    const afterY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y + 40;
    let ty = afterY + 7;
    doc.setFontSize(9.5); doc.setTextColor(...TXT_DARK);
    const sinal = c.saldoMin < 0 ? "−" : "+";
    const totais = `Previsto: ${hm(c.totalPrevistoMin)}    Trabalhado: ${hm(c.totalTrabalhadoMin)}    Extra: ${hm(c.totalExtraMin)}    Noturno: ${hm(c.totalNoturnoMin)}    Atraso: ${hm(c.totalAtrasoMin)}    Saldo: ${sinal}${hm(Math.abs(c.saldoMin))}`;
    doc.setFont("helvetica", "bold"); doc.text(totais, MX, ty);
    ty += 14;

    // ── Assinatura + rodapé ──────────────────────────────────────────────
    doc.setDrawColor(120, 130, 145); doc.line(MX, ty, MX + 80, ty);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...CINZA);
    doc.text(`Assinatura — ${c.nome}`, MX, ty + 4);
    doc.text("Declaro conferidas as marcações e ocorrências acima.", MX, ty + 8);

    const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    doc.setFontSize(7); doc.setTextColor(150, 160, 175);
    doc.text(`Programa de Tratamento de Registro de Ponto (Portaria MTP 671/2021) · gerado em ${stamp}${meta.geradoPor ? ` por ${meta.geradoPor}` : ""}`, MX, doc.internal.pageSize.getHeight() - 8);
  });

  return doc;
}
