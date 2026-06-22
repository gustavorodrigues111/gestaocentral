// ════════════════════════════════════════════════════════════════════════════
//  Processamento de imagem no browser — compartilhado por Recebimento / Fechamento.
//   - paraOcrBlock: comprime imagem (≤1600px) pra caber no payload do OCR.
//   - carimbarImagem: filtro "scanner" (cinza alto contraste) opcional + carimbo
//     no rodapé (quem fez + data/hora). PDFs voltam sem alteração.
// ════════════════════════════════════════════════════════════════════════════

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

export async function paraOcrBlock(file: File): Promise<{ data: string; mediaType: string }> {
  if (!file.type.startsWith("image/")) {
    return { data: await fileToBase64(file), mediaType: file.type || "application/pdf" };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxLado = 1600;
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem contexto 2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const b64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1] || "";
    if (b64) return { data: b64, mediaType: "image/jpeg" };
  } catch { /* fallback abaixo */ }
  return { data: await fileToBase64(file), mediaType: file.type || "image/jpeg" };
}

export async function carimbarImagem(file: File, linhas: string[], scan = false): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (!linhas.length && !scan) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxLado = 2400;
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    if (scan) {
      try {
        const img = ctx.getImageData(0, 0, w, h);
        const px = img.data;
        const contraste = 1.7, brilho = 10;
        for (let i = 0; i < px.length; i += 4) {
          let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          g = (g - 128) * contraste + 128 + brilho;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(img, 0, 0);
      } catch { /* segue sem filtro */ }
    }
    if (linhas.length) {
      const fonte = Math.max(13, Math.round(w / 48));
      const pad = Math.round(fonte * 0.45);
      const alturaBox = (fonte + pad) * linhas.length + pad;
      ctx.fillStyle = "rgba(0,0,0,0.58)";
      ctx.fillRect(0, h - alturaBox, w, alturaBox);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fonte}px -apple-system, Helvetica, Arial, sans-serif`;
      ctx.textBaseline = "top";
      linhas.forEach((linha, i) => ctx.fillText(linha, pad, h - alturaBox + pad + i * (fonte + pad)));
    }
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", scan ? 0.82 : 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}
