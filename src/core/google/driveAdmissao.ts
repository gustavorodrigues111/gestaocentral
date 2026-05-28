// ════════════════════════════════════════════════════════════════════════════
//  Helper compartilhado: garante a árvore de pastas do empregado no Drive.
//
//  Usado por dois lugares:
//   - a subtarefa "Criar pasta do empregado no Drive" (DADOS BÁSICOS), e
//   - o kit de documentos (ChecklistTermosModal), como fallback.
//
//  Cria a pasta [Nome] dentro de "Empregados Ativos" da empresa (com as
//  subpastas) e grava os ids na admissão. Idempotente: se já existe, devolve.
// ════════════════════════════════════════════════════════════════════════════

import type { Admissao, Restaurant } from "../types";
import { createEmployeeFolderTree } from "./driveClient";
import { driveFolderUrl } from "./driveConfig";
import { salvarDriveFolder } from "../admissao/admissaoHelpers";

export type EmpregadoDriveTree = {
  folderId: string;
  folderUrl: string;
  aAssinar: string;
  assinados: string;
};

export async function ensureEmployeeDriveTree(
  admissao: Admissao,
  activeRestaurant: Restaurant,
): Promise<EmpregadoDriveTree> {
  // Já criada? devolve direto (sem nova chamada ao Drive).
  if (
    admissao.driveFolderId &&
    admissao.driveDocsAAssinarFolderId &&
    admissao.driveDocsAssinadosFolderId
  ) {
    return {
      folderId: admissao.driveFolderId,
      folderUrl: admissao.driveFolderUrl || driveFolderUrl(admissao.driveFolderId),
      aAssinar: admissao.driveDocsAAssinarFolderId,
      assinados: admissao.driveDocsAssinadosFolderId,
    };
  }
  const parentId = activeRestaurant.driveEmpregadosAtivosFolderId;
  if (!parentId) {
    throw new Error(
      "Configure a pasta 'Empregados Ativos' desta empresa em Admissão → Configurações antes de criar a pasta do empregado.",
    );
  }
  const tree = await createEmployeeFolderTree(parentId, admissao.candidato.nome);
  await salvarDriveFolder(
    admissao.id, tree.folderId, tree.folderUrl,
    tree.docsAAssinarFolderId, tree.docsAssinadosFolderId,
  );
  return {
    folderId: tree.folderId,
    folderUrl: tree.folderUrl,
    aAssinar: tree.docsAAssinarFolderId,
    assinados: tree.docsAssinadosFolderId,
  };
}
