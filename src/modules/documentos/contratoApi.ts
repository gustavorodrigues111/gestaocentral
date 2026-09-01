// Helpers compartilhados de contrato: gerar (chama /api/contrato-preencher) e
// baixar o DOCX. O histórico REGENERA o docx a partir do input salvo — assim
// não guardamos arquivo pesado no banco, só o {modelo, dados}.
import { authHeader } from "../../core/firebase/idToken";

export async function gerarContratoDocx(modelo: string, dados: Record<string, unknown>): Promise<{ docxBase64: string; filename: string }> {
  const r = await fetch("/api/contrato-preencher", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "gerar", modelo, dados }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Falha ao gerar o contrato.");
  return j;
}

export function baixarDocxBase64(base64: string, filename: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "contrato.docx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
