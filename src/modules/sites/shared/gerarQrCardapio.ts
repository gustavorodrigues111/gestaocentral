// Gera um card 9:16 (1080×1920, formato story/Instagram) com a logo do
// restaurante em cima, o QR code do link do cardápio no meio e a legenda
// embaixo ("Cardápio" / "Menu"). Exporta JPEG e dispara o download — pra
// salvar no celular e mostrar pro cliente. Tudo no canvas (sem html2canvas):
// a logo é carregada com CORS; se falhar, o card sai sem logo (best-effort).
import QRCode from "qrcode";

function carregarImagem(src: string, comCors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (comCors) img.crossOrigin = "anonymous"; // onload só dispara se CORS ok → canvas não fica "tainted"
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function baixarDataUrl(dataUrl: string, nome: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function gerarQrCardapioJpeg(opts: {
  url: string;            // link que o QR aponta (ex: https://lobozo.com.br/cardapio)
  idioma: "pt" | "en";    // legenda
  logoUrl?: string;       // logo do restaurante (opcional)
  corTexto?: string;      // cor da legenda (tema do site)
  nomeArquivo: string;    // ex: "lobozo-cardapio.jpg"
}): Promise<void> {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador.");

  // Fundo branco (contraste do QR + impressão).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Logo no topo (best-effort), centralizada, mantendo proporção.
  if (opts.logoUrl) {
    const logo = await carregarImagem(opts.logoUrl, true);
    if (logo && logo.width && logo.height) {
      const maxW = 640, maxH = 380, topo = 150;
      const escala = Math.min(maxW / logo.width, maxH / logo.height);
      const lw = logo.width * escala, lh = logo.height * escala;
      ctx.drawImage(logo, (W - lw) / 2, topo + (maxH - lh) / 2, lw, lh);
    }
  }

  // QR no meio.
  const qrSize = 760;
  const qrDataUrl = await QRCode.toDataURL(opts.url, {
    width: qrSize, margin: 2, errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  const qrImg = await carregarImagem(qrDataUrl, false); // data URL = same-origin
  const qrX = (W - qrSize) / 2, qrY = 620;
  if (qrImg) ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // Legenda embaixo.
  const legenda = opts.idioma === "pt" ? "Cardápio" : "Menu";
  ctx.fillStyle = opts.corTexto || "#111111";
  ctx.textAlign = "center";
  ctx.font = "bold 104px Helvetica, Arial, sans-serif";
  ctx.fillText(legenda, W / 2, qrY + qrSize + 170);

  // Dica de uso (discreta).
  ctx.fillStyle = "#8a8a8a";
  ctx.font = "44px Helvetica, Arial, sans-serif";
  ctx.fillText("Aponte a câmera do celular", W / 2, qrY + qrSize + 250);

  const jpeg = canvas.toDataURL("image/jpeg", 0.92);
  baixarDataUrl(jpeg, opts.nomeArquivo);
}
