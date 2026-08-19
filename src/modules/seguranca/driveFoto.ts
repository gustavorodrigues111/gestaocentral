// Fotos das não-conformidades no Google Drive. Estrutura:
//   {pasta-raiz do restaurante}/planejamento.app/Segurança Sanitária/{data horário}/
// A pasta-raiz é única por restaurante (configurada em Configurações). Exibição
// in-app: baixamos os bytes (base64) e mostramos como data URL, sem sair do app.
import { findOrCreateSubfolder, uploadFileToFolder, downloadDriveFileBase64 } from "../../core/google/driveClient";
import { ensureModuloFolder } from "../../core/google/driveModulo";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";
import type { SegurancaFoto } from "../../core/types";

const MODULO = "Segurança Sanitária";

// ── Firebase Storage (padrão novo — sem login/pop-up do Drive) ──────────────
// Path: seguranca/{rid}/{pasta}/{timestamp}_{arquivo}. Usa a sessão Firebase já
// logada; exibe pela URL direta (getDownloadURL).
const slug = (s: string) => (s || "").replace(/[^\w.\-]+/g, "_").slice(0, 80);
export async function subirFotoSegurancaStorage(rid: string, pastaLabel: string, file: File): Promise<SegurancaFoto> {
  const nome = file.name || "foto.jpg";
  const path = `seguranca/${rid}/${slug(pastaLabel) || "sem-data"}/${Date.now()}_${slug(nome) || "foto.jpg"}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  const url = await getDownloadURL(r);
  return { nome, url, path };
}

// Remove a foto do Storage (só as novas, que têm path). Best-effort.
export async function removerFotoSegurancaStorage(foto: SegurancaFoto): Promise<void> {
  if (!foto.path) return;
  try { await deleteObject(storageRef(storage, foto.path)); } catch { /* já removida / sem permissão */ }
}

// pastaLabel = nome da pasta da avaliação (ex.: "20-07-2026 08h25"). Estável por
// avaliação (derivada do iniciadoEm), então findOrCreateSubfolder reaproveita.
export async function subirFotoSeguranca(rootFolderId: string, pastaLabel: string, file: File): Promise<SegurancaFoto> {
  const moduloId = await ensureModuloFolder(rootFolderId, MODULO);
  const formId = await findOrCreateSubfolder(moduloId, pastaLabel || "sem-data");
  const f = await uploadFileToFolder(formId, file);
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
