// Gera o PDF do BEO (ordem do evento pra cozinha) a partir do BEOEvento + lead.
import type { BEOEvento, LeadEvento } from "../../core/types";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function dataBR(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  const dia = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} (${dia})`;
}

export async function gerarBeoPDF(b: BEOEvento, lead: LeadEvento, restaurantNome: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const MX = 14;
  const W = 210;
  let y = 18;

  const titulo = (t: string) => { doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(79, 70, 229); doc.text(t, MX, y); y += 6; };
  const linha = (label: string, valor: string) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(55, 65, 81); doc.text(label, MX, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(31, 41, 55);
    const linhas = doc.splitTextToSize(valor || "—", W - MX - 45);
    doc.text(linhas, MX + 42, y);
    y += Math.max(6, linhas.length * 5);
  };
  const bloco = (label: string, texto: string) => {
    if (!texto) return;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(55, 65, 81); doc.text(label, MX, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setTextColor(31, 41, 55);
    const linhas = doc.splitTextToSize(texto, W - MX * 2);
    doc.text(linhas, MX, y); y += linhas.length * 5 + 3;
  };
  const espaco = (px = 3) => { y += px; };
  const check = () => { if (y > 275) { doc.addPage(); y = 18; } };

  // Cabeçalho
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(31, 41, 55);
  doc.text("📋 BEO — Ordem do Evento", MX, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
  doc.text(`${restaurantNome} · ${lead.cliente.nome} · v${b.versao}`, MX, y); y += 8;
  doc.setDrawColor(229, 231, 235); doc.line(MX, y, W - MX, y); y += 7;

  titulo("Evento");
  linha("Data", dataBR(b.dataEvento));
  linha("Convidados", String(b.numConvidados));
  if (b.horaChegadaEquipe) linha("Chegada equipe", b.horaChegadaEquipe);
  linha("Início serviço", b.horaInicioServico || "—");
  linha("Encerramento", b.horaEncerramento || "—");
  linha("Contato no dia", `${b.contatoNoDia?.nome || "—"}${b.contatoNoDia?.whatsapp ? ` · ${b.contatoNoDia.whatsapp}` : ""}`);
  espaco(2); check();

  if (b.restricoesAlimentares && b.restricoesAlimentares.length > 0) {
    titulo("Restrições alimentares");
    bloco("", b.restricoesAlimentares.map((r) => `• ${r}`).join("\n"));
    check();
  }
  if (b.setup) { titulo("Setup (mesas, decoração, AV)"); bloco("", b.setup); check(); }
  if (b.observacoes) { titulo("Observações"); bloco("", b.observacoes); check(); }

  if (b.cardapios && b.cardapios.length > 0) {
    titulo("Cardápios do evento");
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(31, 41, 55);
    for (const c of b.cardapios) {
      doc.text(`• ${c.nome}`, MX, y);
      if (c.url) { doc.setTextColor(37, 99, 235); doc.textWithLink("abrir", MX + 60, y, { url: c.url }); doc.setTextColor(31, 41, 55); }
      y += 6; check();
    }
  }

  doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(156, 163, 175);
  doc.text(`Gerado por ${b.geradoPorNome || "—"} · ${new Date(b.geradoEm).toLocaleString("pt-BR")}`, MX, 288);

  return doc.output("blob");
}
