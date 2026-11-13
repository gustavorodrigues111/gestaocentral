// ════════════════════════════════════════════════════════════════════════════
//  Etiqueta térmica desenhada em canvas
//
//  A cabeça de impressão das maquininhas de 58 mm (Sunmi V2s Label, mini
//  térmicas) imprime 48 mm úteis = 384 pontos (203 dpi = 8 pontos/mm).
//  A etiqueta é montada como IMAGEM (preto puro no branco: térmica não tem
//  cinza) e enviada pronta para a impressora. Assim o layout é o mesmo na
//  prévia, no navegador e na Sunmi, sem depender de comandos do equipamento.
//
//  Linguagem visual: tipografia faz a hierarquia (sem faixas pretas), rótulos
//  pequenos em caixa alta espaçada, fios finos separando as áreas e rodapé
//  ancorado embaixo, para todas as etiquetas terem o mesmo desenho.
// ════════════════════════════════════════════════════════════════════════════
import QRCode from "qrcode";

export const PONTOS_POR_MM = 8;
export const LARGURA_UTIL_PX = 384; // 48 mm

export type Bobina = { larguraMm: number; alturaMm: number };
export const BOBINA_PADRAO: Bobina = { larguraMm: 58, alturaMm: 40 };

export type Coluna = { rotulo: string; valor: string; sub?: string; destaque?: boolean };

export type BlocoEtiqueta =
  | { tipo: "rotulo"; texto: string; direita?: string }   // linha pequena em caixa alta (ex.: REFRIGERADO)
  | { tipo: "titulo"; texto: string }                      // nome do produto, até 2 linhas
  | { tipo: "linha"; texto: string; negrito?: boolean; tam?: number }
  | { tipo: "fio" }                                        // separador fino
  | { tipo: "colunas"; colunas: Coluna[] }                 // ex.: Validade | Manipulado
  | { tipo: "codigo"; texto: string }                      // código curto grande (baixa manual)
  | { tipo: "rodapeQr"; qr: string; linhas: string[] };    // ancorado embaixo; 1ª linha em negrito

const FONTE = "'Inter', 'Roboto', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const MARGEM_Y = 6;   // respiro de cada lado da etiqueta (pontos)
const FIO = 2;        // espessura dos fios (0,25 mm)

function quebrar(ctx: CanvasRenderingContext2D, texto: string, largura: number): string[] {
  const palavras = (texto || "").split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(teste).width <= largura || !atual) atual = teste;
    else { linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/**
 * Largura de desenho em pontos. Na maquininha a cabeça só imprime 48 mm (384
 * pontos); numa impressora escolhida no navegador usa a largura da etiqueta
 * menos 2 mm de margem de cada lado.
 */
export function larguraPx(bobina: Bobina, limitar384: boolean): number {
  const px = Math.round((bobina.larguraMm - 4) * PONTOS_POR_MM);
  return limitar384 ? Math.min(LARGURA_UTIL_PX, px) : px;
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/** Desenha a etiqueta num canvas com a altura da bobina (8 pontos por mm). */
export async function desenharEtiqueta(blocos: BlocoEtiqueta[], bobina: Bobina = BOBINA_PADRAO, largura: number = LARGURA_UTIL_PX): Promise<HTMLCanvasElement> {
  const W = largura;
  const H = Math.round(bobina.alturaMm * PONTOS_POR_MM) - 2 * MARGEM_Y;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")! as Ctx;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.textBaseline = "top";

  const fonte = (px: number, peso: 400 | 500 | 600 | 700 | 800 = 400, espaco = 0) => {
    ctx.font = `${peso} ${px}px ${FONTE}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${espaco}px`;
  };
  const fio = (yy: number) => ctx.fillRect(0, yy, W, FIO);

  // Respiro no topo: além de evitar que acentos de maiúsculas (Á, Ã, Ç) sejam
  // cortados, dá uma margem confortável pra primeira linha não colar na borda.
  let y = 18;

  for (const b of blocos) {
    if (b.tipo === "rotulo") {
      fonte(16, 700, 1.2);
      ctx.fillText(b.texto.toUpperCase(), 0, y);
      if (b.direita) {
        const t = b.direita.toUpperCase();
        ctx.fillText(t, W - ctx.measureText(t).width, y);
      }
      y += 26;
    } else if (b.tipo === "titulo") {
      // Nome inteiro em até 2 linhas: reduz a fonte antes de cortar.
      let px = 31;
      let linhas: string[] = [];
      for (px of [31, 28, 24, 20]) {
        fonte(px, 700, -0.3);
        linhas = quebrar(ctx, b.texto, W);
        if (linhas.length <= 2) break;
      }
      for (const l of linhas.slice(0, 2)) { ctx.fillText(l, 0, y); y += Math.round(px * 1.15); }
      y += 10;
    } else if (b.tipo === "linha") {
      const px = b.tam ?? 18;
      fonte(px, b.negrito ? 700 : 600); // térmica: 400 sai falhada, 600 fica cheio
      for (const l of quebrar(ctx, b.texto, W)) { ctx.fillText(l, 0, y); y += px + 4; }
    } else if (b.tipo === "codigo") {
      // Rótulo pequeno "Nº" + código grande, pra leitura/digitação a olho.
      fonte(15, 700, 1.2); ctx.fillText("Nº", 0, y + 10);
      const lx = ctx.measureText("Nº").width + 8;
      fonte(30, 800, 1); ctx.fillText(b.texto, lx, y);
      y += 38;
    } else if (b.tipo === "fio") {
      fio(y);
      y += FIO + 10;
    } else if (b.tipo === "colunas") {
      // Colunas com largura proporcional ao peso: a de destaque fica com mais espaço.
      const pesos = b.colunas.map((c) => (c.destaque ? 1.25 : 1));
      const total = pesos.reduce((a, p) => a + p, 0);
      let x = 0;
      let alturaMax = 0;
      b.colunas.forEach((c, i) => {
        const w = (W * pesos[i]) / total;
        let yy = y;
        fonte(15, 700, 1.2); ctx.fillText(c.rotulo.toUpperCase(), x, yy); yy += 23;
        const pv = c.destaque ? 46 : 28;
        fonte(pv, c.destaque ? 800 : 700, c.destaque ? -1 : 0); ctx.fillText(c.valor, x, yy); yy += Math.round(pv * 1.1);
        if (c.sub) { fonte(18, 600); ctx.fillText(c.sub, x, yy); yy += 24; }
        alturaMax = Math.max(alturaMax, yy - y);
        if (i > 0) ctx.fillRect(x - 12, y + 2, FIO, alturaMax - 4); // fio vertical entre colunas
        x += w;
      });
      y += alturaMax + 6;
    } else if (b.tipo === "rodapeQr") {
      // Rodapé ancorado no fim da etiqueta; QR com respiro, textos à esquerda.
      const lado = Math.round(Math.max(88, Math.min(132, H * 0.34)));
      const topo = Math.max(y, H - lado - 8);   // respiro do fundo: o QR não cola na borda
      fio(topo - 10);
      const qrUrl = await QRCode.toDataURL(b.qr, { margin: 0, width: lado, errorCorrectionLevel: "M" });
      const img = await carregarImagem(qrUrl);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, W - lado, topo, lado, lado);
      const larguraTexto = W - lado - 14;
      let yy = topo + 2;
      b.linhas.filter(Boolean).forEach((t, i) => {
        if (i === 0) fonte(19, 700); else fonte(16, 600);
        for (const l of quebrar(ctx, t, larguraTexto).slice(0, 2)) { ctx.fillText(l, 0, yy); yy += i === 0 ? 25 : 20; }
      });
      y = H;
    }
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  return canvas;
}

/** PNG em base64 (sem o prefixo data:) — formato que a ponte da Sunmi recebe. */
export function canvasParaBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1] || "";
}
