// Gera o PDF de impressão do cardápio estruturado (A4, 2 colunas, auto-flow —
// redistribui pra caber bem na página). Template limpo usando a cor do tema.
// jsPDF carregado sob demanda (não pesa o bundle).
import type { SecaoCardapio } from "../../../core/types";

function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  const h = (hex || "").replace("#", "");
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  return { r: 26, g: 92, b: 42 }; // verde default
}

export async function gerarCardapioPdf(opts: {
  secoes: SecaoCardapio[];
  titulo: string;
  corPrimaria?: string;
  idioma?: "pt" | "en";
  nomeArquivo?: string;
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 44, gutter = 30;
  const colW = (W - margin * 2 - gutter) / 2;
  const colX = [margin, margin + colW + gutter];
  const topY = margin, bottomY = H - margin;
  const cor = hexToRgb(opts.corPrimaria);
  const en = opts.idioma === "en";
  const nomeSec = (s: SecaoCardapio) => (en && s.nomeEn) || s.nome;
  const obsSec = (s: SecaoCardapio) => (en && s.obsEn) || s.obs;
  const tit = (p: { titulo: string; tituloEn?: string }) => (en && p.tituloEn) || p.titulo;
  const sub = (p: { subtitulo?: string; subtituloEn?: string }) => (en && p.subtituloEn) || p.subtitulo;

  // Título centralizado no topo da página 1 (serifa).
  doc.setFont("times", "bold"); doc.setFontSize(26); doc.setTextColor(cor.r, cor.g, cor.b);
  doc.text((opts.titulo || "Cardápio").toUpperCase(), W / 2, topY + 20, { align: "center" });
  const yInicioColunas = topY + 52; // colunas começam abaixo do título (só na pág 1)

  let col = 0;
  let pagina = 1;
  let y = yInicioColunas;
  const colTop = () => (pagina === 1 ? yInicioColunas : topY);
  const avancaColuna = () => {
    if (col === 0) { col = 1; y = colTop(); }
    else { doc.addPage(); pagina++; col = 0; y = colTop(); }
  };
  const garantir = (h: number) => { if (y + h > bottomY) avancaColuna(); };

  for (const s of opts.secoes) {
    const nome = nomeSec(s); const obs = obsSec(s);
    garantir(58); // cabeçalho + 1 prato
    // Cabeçalho de seção: serifa, centralizado, com filete dos dois lados.
    doc.setFont("times", "bold"); doc.setFontSize(15); doc.setTextColor(cor.r, cor.g, cor.b);
    const cx = colX[col] + colW / 2;
    doc.text((nome || "").toUpperCase(), cx, y + 4, { align: "center" });
    const tw = doc.getTextWidth((nome || "").toUpperCase());
    doc.setDrawColor(cor.r, cor.g, cor.b); doc.setLineWidth(0.6);
    const lineY = y; const pad = 10;
    if (colW / 2 - tw / 2 - pad > 6) {
      doc.line(colX[col], lineY, cx - tw / 2 - pad, lineY);
      doc.line(cx + tw / 2 + pad, lineY, colX[col] + colW, lineY);
    }
    y += 17;
    if (obs) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
      const lines = doc.splitTextToSize(obs, colW) as string[];
      garantir(lines.length * 11 + 4);
      doc.text(lines, colX[col], y); y += lines.length * 11 + 4;
    }
    for (const p of s.pratos) {
      const titulo = tit(p); if (!titulo) continue;
      const subt = sub(p);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      const precoW = p.preco ? doc.getTextWidth(p.preco) + 10 : 0;
      const tituloLines = doc.splitTextToSize(titulo, colW - precoW) as string[];
      let subLines: string[] = [];
      if (subt) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); subLines = doc.splitTextToSize(subt, colW) as string[]; }
      const h = tituloLines.length * 13 + subLines.length * 11 + 9;
      garantir(h);
      // título
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(28, 28, 28);
      doc.text(tituloLines, colX[col], y);
      if (p.preco) { doc.setTextColor(cor.r, cor.g, cor.b); doc.text(p.preco, colX[col] + colW, y, { align: "right" }); }
      y += tituloLines.length * 13;
      // subtítulo
      if (subLines.length) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
        doc.text(subLines, colX[col], y); y += subLines.length * 11;
      }
      y += 9;
    }
    y += 12;
  }

  doc.save(opts.nomeArquivo || "cardapio.pdf");
}
