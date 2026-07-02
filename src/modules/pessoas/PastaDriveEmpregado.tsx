// Bloco no cadastro do empregado pra criar/vincular a pasta dele no Google
// Drive. A pasta é a base pro upload de exames (e futuros documentos). Escreve
// direto no doc do empregado (ação imediata, fora do save do formulário).
import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { isDriveConnected, createEmployeeFolderTree } from "../../core/google/driveClient";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { driveFolderUrl } from "../../core/google/driveConfig";
import type { Empregado, Restaurant } from "../../core/types";

export function PastaDriveEmpregado({ empregado, restaurant }: { empregado: Empregado; restaurant: Restaurant }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const temPasta = !!empregado.driveFolderId;
  const url = empregado.driveFolderUrl || (empregado.driveFolderId ? driveFolderUrl(empregado.driveFolderId) : "");

  async function persistir(folderId: string, folderUrl: string) {
    await updateDoc(doc(db, "empregados", empregado.id), {
      driveFolderId: folderId,
      driveFolderUrl: folderUrl,
      // zera o cache da subpasta de exames — será recriado sob a nova pasta
      driveExamesFolderId: null,
      atualizadoEm: new Date().toISOString(),
    });
  }

  async function criar() {
    setErro("");
    if (!restaurant.driveEmpregadosAtivosFolderId) {
      setErro("Configure a pasta 'Empregados Ativos' desta empresa em Admissão → Configurações antes.");
      return;
    }
    setSalvando(true);
    try {
      const tree = await createEmployeeFolderTree(restaurant.driveEmpregadosAtivosFolderId, empregado.nome);
      await persistir(tree.folderId, tree.folderUrl);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function vincular() {
    setErro("");
    setSalvando(true);
    try {
      const f = await pickDriveFolder("Selecione a pasta do empregado", restaurant.driveEmpregadosAtivosFolderId);
      if (f) await persistir(f.id, driveFolderUrl(f.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">📁 Pasta do Drive</div>
      {!isDriveConnected() ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Conecte o Google Drive (em Admissão → Configurações) pra criar/vincular a pasta do empregado.
        </p>
      ) : temPasta ? (
        <div className="flex items-center gap-2 flex-wrap">
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 dark:text-indigo-400 underline">📁 Abrir pasta</a>
          <Button size="sm" variant="secondary" onClick={vincular} disabled={salvando}>{salvando ? "…" : "Trocar pasta"}</Button>
          <span className="text-[11px] text-gray-400">Exames sobem em "Exames Médicos" aqui dentro.</span>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap items-center">
          <Button size="sm" onClick={criar} disabled={salvando}>{salvando ? "Criando…" : "Criar pasta"}</Button>
          <Button size="sm" variant="secondary" onClick={vincular} disabled={salvando}>Vincular existente</Button>
        </div>
      )}
      {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{erro}</p>}
    </div>
  );
}
