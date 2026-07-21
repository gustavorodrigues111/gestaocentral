// Fotos das não-conformidades no Google Drive. A pasta-raiz é escolhida pela
// nutricionista/master (por restaurante); dentro dela criamos uma SUBPASTA por
// data da avaliação. Exibição é in-app: baixamos os bytes (base64) e mostramos
// como data URL, sem sair do planejamento.app.
import { findOrCreateSubfolder, uploadFileToFolder, downloadDriveFileBase64 } from "../../core/google/driveShared";
import type { SegurancaFoto } from "../../core/types";

// dd-mm-aaaa → nome da subpasta da data.
const nomePastaData = (ymd: string) => (ymd || "sem-data").split("-").reverse().join("-");

export async function subirFotoSeguranca(rootFolderId: string, data: string, file: File): Promise<SegurancaFoto> {
  const subId = await findOrCreateSubfolder(rootFolderId, nomePastaData(data));
  const f = await uploadFileToFolder(subId, file);
  return { driveId: f.id, nome: f.name, ...(f.webViewLink ? { webViewLink: f.webViewLink } : {}) };
}

// Cache de data URLs por driveId (evita rebaixar a mesma foto a cada render).
const cache = new Map<string, string>();
export async function carregarFotoDataUrl(driveId: string): Promise<string> {
  const hit = cache.get(driveId);
  if (hit) return hit;
  const b64 = await downloadDriveFileBase64(driveId);
  const url = `data:image/jpeg;base64,${b64}`;
  cache.set(driveId, url);
  return url;
}
