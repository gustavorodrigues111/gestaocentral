// Baixa um arquivo — ou, no mobile, abre a folha de compartilhamento nativa.
//
// PORQUÊ: no iOS/Safari o truque clássico `<a download>` (e o `jsPDF.save()`,
// que faz o mesmo por baixo) é IGNORADO — o navegador só abre o PDF num viewer
// e o usuário fica preso, sem conseguir salvar/enviar. O Web Share API com
// `files` resolve: abre o menu do sistema (WhatsApp, Mail, Arquivos…).
//
// Estratégia: se o navegador sabe compartilhar ARQUIVOS, usa share; senão cai
// no download clássico (desktop e Androids antigos).

export type ResultadoSaida = "compartilhado" | "baixado";

export async function baixarOuCompartilhar(
  blob: Blob,
  nomeArquivo: string,
  opts: { titulo?: string; texto?: string } = {},
): Promise<ResultadoSaida> {
  const tipo = blob.type || "application/octet-stream";
  const nav = navigator as Navigator & {
    canShare?: (data: unknown) => boolean;
    share?: (data: unknown) => Promise<void>;
  };

  // Caminho mobile: compartilhar o arquivo.
  try {
    const file = new File([blob], nomeArquivo, { type: tipo });
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: opts.titulo, text: opts.texto });
      return "compartilhado";
    }
  } catch (e) {
    // Usuário cancelou a folha de share → NÃO cair no download (evita baixar sem querer).
    if ((e as { name?: string })?.name === "AbortError") return "compartilhado";
    // Qualquer outro erro do share → segue pro download clássico.
  }

  // Fallback: download clássico.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "baixado";
}

// Alguns navegadores mobile suportam navigator.share mas NÃO share de arquivos.
// Útil pra decidir o rótulo do botão ("Enviar/Baixar" vs "Baixar").
export function podeCompartilharArquivo(nomeArquivo = "a.pdf", tipo = "application/pdf"): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (data: unknown) => boolean; share?: unknown };
    return !!nav.share && !!nav.canShare && nav.canShare({ files: [new File([new Blob()], nomeArquivo, { type: tipo })] });
  } catch { return false; }
}
