// Transcreve um arquivo de áudio (ex.: áudio do WhatsApp) via /api/audio-transcrever
// (Google Speech-to-Text server-side). Devolve o texto. Lança em erro.
import { authHeader } from "../firebase/idToken";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(file);
  });
}

export async function transcreverAudio(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Áudio muito grande (máx ~20 MB). Use um trecho menor.");
  const audioBase64 = await fileToBase64(file);
  const r = await fetch("/api/audio-transcrever", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ audioBase64, mimeType: file.type || "" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return String(d.texto || "");
}
