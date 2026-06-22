// ════════════════════════════════════════════════════════════════════════════
//  Facade do Drive que escolhe em runtime: CONTA CENTRAL (backend) × NAVEGADOR.
//
//  Expõe as MESMAS funções do driveClient (mesmas assinaturas), mas decide o
//  caminho conforme `centralConfigured()`. Módulos que devem usar a conta
//  central (Recebimento, Admissão) importam DAQUI; Planner/Tarefas seguem
//  importando driveClient direto (navegador apenas).
//
//  - central ON  → backend sobe/baixa pela conta central (sem popup no operador)
//  - central OFF → fluxo OAuth do navegador (igual antes)
// ════════════════════════════════════════════════════════════════════════════
import * as browser from "./driveClient";
import type { DriveFile } from "./driveClient";
import {
  centralConfigured, centralEnsureFolder, centralUpload,
  centralDownloadBase64, centralListFolder,
} from "./driveCentral";
import {
  SUBPASTAS_EMPREGADO, PASTA_DOCS_A_ASSINAR, PASTA_DOCS_ASSINADOS,
  PASTA_DOCUMENTOS_EMPREGADO, driveFolderUrl,
} from "./driveConfig";

export type { DriveFile } from "./driveClient";

export async function findOrCreateSubfolder(parentId: string, name: string): Promise<string> {
  return (await centralConfigured()) ? centralEnsureFolder(parentId, name) : browser.findOrCreateSubfolder(parentId, name);
}

export async function uploadFileToFolder(folderId: string, file: File): Promise<DriveFile> {
  if (await centralConfigured()) {
    const s = await centralUpload(folderId, file);
    return { id: s.id, name: s.name, ...(s.webViewLink ? { webViewLink: s.webViewLink } : {}) };
  }
  return browser.uploadFileToFolder(folderId, file);
}

export async function downloadDriveFileBase64(fileId: string): Promise<string> {
  return (await centralConfigured()) ? centralDownloadBase64(fileId) : browser.downloadDriveFileBase64(fileId);
}

export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  return (await centralConfigured()) ? centralListFolder(folderId) : browser.listFolderFiles(folderId);
}

// Garante as subpastas padrão dentro de uma pasta de empregado.
export async function ensureSubfoldersIn(folderId: string): Promise<{
  documentosFolderId: string; docsAAssinarFolderId: string; docsAssinadosFolderId: string;
}> {
  if (!(await centralConfigured())) return browser.ensureSubfoldersIn(folderId);
  let documentosFolderId = "", docsAAssinarFolderId = "", docsAssinadosFolderId = "";
  for (const sub of SUBPASTAS_EMPREGADO) {
    const id = await centralEnsureFolder(folderId, sub);
    if (sub === PASTA_DOCUMENTOS_EMPREGADO) documentosFolderId = id;
    if (sub === PASTA_DOCS_A_ASSINAR) docsAAssinarFolderId = id;
    if (sub === PASTA_DOCS_ASSINADOS) docsAssinadosFolderId = id;
  }
  return { documentosFolderId, docsAAssinarFolderId, docsAssinadosFolderId };
}

// Cria (ou reaproveita) a pasta do empregado + subpastas padrão.
export async function createEmployeeFolderTree(parentId: string, nomeCompleto: string): Promise<{
  folderId: string; folderUrl: string;
  documentosFolderId: string; docsAAssinarFolderId: string; docsAssinadosFolderId: string;
}> {
  if (!(await centralConfigured())) return browser.createEmployeeFolderTree(parentId, nomeCompleto);
  const folderId = await centralEnsureFolder(parentId, nomeCompleto);
  const subs = await ensureSubfoldersIn(folderId);
  return { folderId, folderUrl: driveFolderUrl(folderId), ...subs };
}
