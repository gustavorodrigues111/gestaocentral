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
import { createEmployeeFolderTree, ensureSubfoldersIn } from "./driveClient";
import { driveFolderUrl } from "./driveConfig";
import { salvarDriveFolder } from "../admissao/admissaoHelpers";

export type EmpregadoDriveTree = {
  folderId: string;
  folderUrl: string;
  documentos: string;
  aAssinar: string;
  assinados: string;
};

export async function ensureEmployeeDriveTree(
  admissao: Admissao,
  activeRestaurant: Restaurant,
): Promise<EmpregadoDriveTree> {
  // Já criada? devolve direto (sem nova chamada ao Drive).
  // documentosFolderId pode faltar em admissões antigas (criadas antes da
  // subpasta "Documentos do Empregado") — nesse caso recriamos as subpastas.
  if (
    admissao.driveFolderId &&
    admissao.driveDocumentosFolderId &&
    admissao.driveDocsAAssinarFolderId &&
    admissao.driveDocsAssinadosFolderId
  ) {
    return {
      folderId: admissao.driveFolderId,
      folderUrl: admissao.driveFolderUrl || driveFolderUrl(admissao.driveFolderId),
      documentos: admissao.driveDocumentosFolderId,
      aAssinar: admissao.driveDocsAAssinarFolderId,
      assinados: admissao.driveDocsAssinadosFolderId,
    };
  }
  // Pasta do empregado já existe mas faltam subpastas (ex: admissão antiga sem
  // "Documentos do Empregado") → garante as subpastas dentro dela.
  if (admissao.driveFolderId) {
    return vincularPastaExistente(admissao, admissao.driveFolderId);
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
    tree.docsAAssinarFolderId, tree.docsAssinadosFolderId, tree.documentosFolderId,
  );
  return {
    folderId: tree.folderId,
    folderUrl: tree.folderUrl,
    documentos: tree.documentosFolderId,
    aAssinar: tree.docsAAssinarFolderId,
    assinados: tree.docsAssinadosFolderId,
  };
}

// Vincula uma pasta JÁ EXISTENTE (selecionada pelo DP no Picker) como a pasta
// do empregado: garante as subpastas dentro dela e grava na admissão. Evita
// criar duplicata quando a pessoa já tinha pasta no Drive.
export async function vincularPastaExistente(
  admissao: Admissao,
  folderId: string,
): Promise<EmpregadoDriveTree> {
  const subs = await ensureSubfoldersIn(folderId);
  const url = driveFolderUrl(folderId);
  await salvarDriveFolder(
    admissao.id, folderId, url,
    subs.docsAAssinarFolderId, subs.docsAssinadosFolderId, subs.documentosFolderId,
  );
  return {
    folderId,
    folderUrl: url,
    documentos: subs.documentosFolderId,
    aAssinar: subs.docsAAssinarFolderId,
    assinados: subs.docsAssinadosFolderId,
  };
}
