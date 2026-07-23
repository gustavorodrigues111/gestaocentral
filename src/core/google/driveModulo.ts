// Organização única do Drive por restaurante. A nutricionista/master indica UMA
// pasta-raiz do restaurante (Restaurant.driveRootFolderId); o sistema cria
// "planejamento.app" dentro dela e, abaixo, uma pasta por módulo. Cada módulo
// cuida da sua organização interna a partir do id que este helper devolve.
//
// Central-aware: se a conta central do Drive estiver configurada (env do
// backend), as pastas são criadas por ela (o operador NÃO loga Google);
// senão cai no fluxo do navegador. Ver driveShared.
import { findOrCreateSubfolder } from "./driveShared";

export const APP_FOLDER = "planejamento.app";

// Garante {root}/planejamento.app/{modulo} e devolve o id da pasta do módulo.
export async function ensureModuloFolder(rootFolderId: string, modulo: string): Promise<string> {
  const appId = await findOrCreateSubfolder(rootFolderId, APP_FOLDER);
  return findOrCreateSubfolder(appId, modulo);
}
