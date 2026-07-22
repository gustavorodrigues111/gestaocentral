// Organização única do Drive por restaurante. A nutricionista/master indica UMA
// pasta-raiz do restaurante (Restaurant.driveRootFolderId); o sistema cria
// "planejamento.app" dentro dela e, abaixo, uma pasta por módulo. Cada módulo
// cuida da sua organização interna a partir do id que este helper devolve.
//
// Usa o fluxo do NAVEGADOR (driveClient) — a pasta-raiz é do Drive pessoal de
// quem configurou, então as operações vão com o token OAuth dele.
import { findOrCreateSubfolder } from "./driveClient";

export const APP_FOLDER = "planejamento.app";

// Garante {root}/planejamento.app/{modulo} e devolve o id da pasta do módulo.
export async function ensureModuloFolder(rootFolderId: string, modulo: string): Promise<string> {
  const appId = await findOrCreateSubfolder(rootFolderId, APP_FOLDER);
  return findOrCreateSubfolder(appId, modulo);
}
