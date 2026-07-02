// Drive dos exames: garante a subpasta "Exames Médicos" dentro da pasta do
// empregado e sobe o PDF do resultado direto pra lá.
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { findOrCreateSubfolder, uploadFileToFolder } from "../../core/google/driveClient";
import type { Empregado } from "../../core/types";

const SUBPASTA = "Exames Médicos";

export async function garantirPastaExames(emp: Empregado): Promise<string> {
  if (!emp.driveFolderId) {
    throw new Error("Este empregado não tem pasta no Drive. Crie/vincule a pasta no cadastro dele primeiro.");
  }
  if (emp.driveExamesFolderId) return emp.driveExamesFolderId;
  const id = await findOrCreateSubfolder(emp.driveFolderId, SUBPASTA);
  await updateDoc(doc(db, "empregados", emp.id), {
    driveExamesFolderId: id,
    atualizadoEm: new Date().toISOString(),
  });
  return id;
}

export async function subirExameNoDrive(emp: Empregado, file: File): Promise<{ url: string; nome: string }> {
  const folderId = await garantirPastaExames(emp);
  const f = await uploadFileToFolder(folderId, file);
  return {
    url: f.webViewLink || `https://drive.google.com/open?id=${f.id}`,
    nome: f.name,
  };
}
