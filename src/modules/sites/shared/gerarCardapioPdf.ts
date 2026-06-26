// Gera o PDF de impressão do cardápio estruturado. Duas variantes:
//   - gerarCardapioPdf: genérico (A4, 2 colunas auto-flow, cor do tema).
//   - gerarCardapioPdfSororoca: branded (capa + layout fixo do Canva).
// Ambas RETORNAM { url, nomeArquivo } (blob) — quem chama mostra o preview e
// baixa. jsPDF carregado sob demanda (não pesa o bundle).
import type { SecaoCardapio } from "../../../core/types";

export type PdfResult = { url: string; nomeArquivo: string };

const norm = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
function carregarImagem(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  const h = (hex || "").replace("#", "");
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  return { r: 26, g: 92, b: 42 };
}
// Preço: número → "R$ 83"; texto (ex: "consulte na lousa") → como nota (itálico).
function formataPreco(preco?: string): { texto: string; ehNota: boolean } | null {
  const p = (preco || "").trim();
  if (!p) return null;
  if (/[a-zA-Z]/.test(p)) return { texto: p, ehNota: true };
  return { texto: "R$ " + p, ehNota: false };
}

export async function gerarCardapioPdf(opts: {
  secoes: SecaoCardapio[];
  titulo: string;
  corPrimaria?: string;
  idioma?: "pt" | "en";
  nomeArquivo?: string;
}): Promise<PdfResult> {
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

  doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(cor.r, cor.g, cor.b);
  doc.text((opts.titulo || "Cardápio").toUpperCase(), W / 2, topY + 20, { align: "center" });
  const yInicioColunas = topY + 52;

  let col = 0, pagina = 1, y = yInicioColunas;
  const colTop = () => (pagina === 1 ? yInicioColunas : topY);
  const avancaColuna = () => { if (col === 0) { col = 1; y = colTop(); } else { doc.addPage(); pagina++; col = 0; y = colTop(); } };
  const garantir = (h: number) => { if (y + h > bottomY) avancaColuna(); };

  for (const s of opts.secoes) {
    const nome = nomeSec(s); const obs = obsSec(s);
    garantir(58);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(cor.r, cor.g, cor.b);
    const cx = colX[col] + colW / 2;
    doc.text((nome || "").toUpperCase(), cx, y + 4, { align: "center" });
    y += 18;
    if (obs) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
      const lines = doc.splitTextToSize(obs, colW) as string[];
      garantir(lines.length * 11 + 4);
      doc.text(lines, cx, y, { align: "center" }); y += lines.length * 11 + 4;
    }
    for (const p of s.pratos) {
      const titulo = tit(p); if (!titulo) continue;
      const subt = sub(p);
      const pr = formataPreco(p.preco);
      doc.setFont("helvetica", pr?.ehNota ? "italic" : "bold"); doc.setFontSize(pr?.ehNota ? 9 : 11);
      const precoW = pr ? doc.getTextWidth(pr.texto) + 10 : 0;
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      const tituloLines = doc.splitTextToSize(titulo, colW - precoW) as string[];
      let subLines: string[] = [];
      if (subt) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); subLines = doc.splitTextToSize(subt, colW) as string[]; }
      garantir(tituloLines.length * 13 + subLines.length * 11 + 13);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(28, 28, 28);
      doc.text(tituloLines, colX[col], y);
      if (pr) {
        doc.setFont("helvetica", pr.ehNota ? "italic" : "bold"); doc.setFontSize(pr.ehNota ? 9 : 11);
        doc.setTextColor(cor.r, cor.g, cor.b);
        doc.text(pr.texto, colX[col] + colW, y, { align: "right" });
      }
      y += tituloLines.length * 13;
      if (subLines.length) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
        doc.text(subLines, colX[col], y); y += subLines.length * 11;
      }
      y += 13; // espaço entre pratos
    }
    y += 14;
  }

  return { url: URL.createObjectURL(doc.output("blob")), nomeArquivo: opts.nomeArquivo || "cardapio.pdf" };
}

// ─── PDF branded do Sororoca ─────────────────────────────────────────────────
// Pág 1: capa (logo+peixe, do PNG) + "COMIDAS" sob a logo + Sobremesas à esquerda.
// Pág 2: Frios→Quentes (esq) · Brasa→Acompanhamentos (dir), com as seções de
// baixo alinhadas ao mesmo topo. Texto vetorial nas cores da marca.
const TEAL = { r: 0x1d, g: 0x3c, b: 0x4b };
const CAPA_SOROROCA = "/cardapio-capa-sororoca.png";

export async function gerarCardapioPdfSororoca(opts: {
  secoes: SecaoCardapio[];
  idioma?: "pt" | "en";
  tipo?: string;            // rótulo sob a logo (default "COMIDAS")
  nomeArquivo?: string;
}): Promise<PdfResult> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 46, gutter = 26;
  const colW = (W - margin * 2 - gutter) / 2;
  const colX = [margin, margin + colW + gutter];
  const en = opts.idioma === "en";
  const tit = (p: { titulo: string; tituloEn?: string }) => (en && p.tituloEn) || p.titulo;
  const sub = (p: { subtitulo?: string; subtituloEn?: string }) => (en && p.subtituloEn) || p.subtitulo;
  const nomeSec = (s: SecaoCardapio) => (en && s.nomeEn) || s.nome;
  const obsSec = (s: SecaoCardapio) => (en && s.obsEn) || s.obs;
  const acharSec = (chave: string) => opts.secoes.find((s) => norm(s.nome).includes(chave));

  // Desenha seção (cabeçalho + pratos) numa coluna. Retorna o y final.
  function desenharSecao(s: SecaoCardapio, x: number, yIni: number): number {
    let y = yIni;
    const cx = x + colW / 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(TEAL.r, TEAL.g, TEAL.b);
    doc.text(nomeSec(s) || "", cx, y, { align: "center" });
    y += 8;
    doc.setDrawColor(TEAL.r, TEAL.g, TEAL.b); doc.setLineWidth(0.5);
    doc.line(x + colW * 0.34, y, x + colW * 0.66, y);
    y += 18;
    const obs = obsSec(s);
    if (obs) {
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(120, 120, 120);
      const ls = doc.splitTextToSize(obs, colW) as string[];
      doc.text(ls, cx, y, { align: "center" }); y += ls.length * 10 + 4;
    }
    for (const p of s.pratos) {
      const titulo = tit(p); if (!titulo) continue;
      const subt = sub(p);
      const pr = formataPreco(p.preco);
      doc.setFont("helvetica", pr?.ehNota ? "italic" : "bold"); doc.setFontSize(pr?.ehNota ? 8.5 : 10.5);
      const precoW = pr ? doc.getTextWidth(pr.texto) + 8 : 0;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(40, 40, 40);
      const tls = doc.splitTextToSize(titulo, colW - precoW) as string[];
      doc.text(tls, x, y);
      if (pr) {
        doc.setFont("helvetica", pr.ehNota ? "italic" : "bold"); doc.setFontSize(pr.ehNota ? 8.5 : 10.5);
        doc.setTextColor(TEAL.r, TEAL.g, TEAL.b);
        doc.text(pr.texto, x + colW, y, { align: "right" });
      }
      y += tls.length * 12;
      if (subt) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(115, 115, 115);
        const sls = doc.splitTextToSize(subt, colW) as string[];
        doc.text(sls, x, y); y += sls.length * 10;
      }
      y += 14; // espaço entre pratos (maior)
    }
    return y;
  }

  // ── Página 1: capa + "COMIDAS" + Sobremesas (esquerda) ──
  const capa = await carregarImagem(CAPA_SOROROCA);
  if (capa) { try { doc.addImage(capa, "PNG", 0, 0, W, H); } catch { /* segue sem capa */ } }
  // Rótulo do tipo de cardápio sob a logo (logo fica ~centro-direita, topo).
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(TEAL.r, TEAL.g, TEAL.b);
  doc.text((opts.tipo || "COMIDAS").toUpperCase(), W * 0.75, 188, { align: "center", charSpace: 3 });
  const sobremesas = acharSec("sobremesa");
  if (sobremesas) desenharSecao(sobremesas, colX[0], 150);

  // ── Página 2: Frios→Quentes (esq) · Brasa→Acompanhamentos (dir) ──
  doc.addPage();
  const topY2 = 72;
  const frios = acharSec("frio"), quentes = acharSec("quente"), brasa = acharSec("brasa"), acomp = acharSec("acompanhamento");
  const fimEsqTopo = frios ? desenharSecao(frios, colX[0], topY2) : topY2;
  const fimDirTopo = brasa ? desenharSecao(brasa, colX[1], topY2) : topY2;
  const inicioBaixo = Math.max(fimEsqTopo, fimDirTopo) + 26; // seções de baixo alinhadas ao mesmo topo
  if (quentes) desenharSecao(quentes, colX[0], inicioBaixo);
  if (acomp) desenharSecao(acomp, colX[1], inicioBaixo);

  return { url: URL.createObjectURL(doc.output("blob")), nomeArquivo: opts.nomeArquivo || "cardapio-sororoca.pdf" };
}
