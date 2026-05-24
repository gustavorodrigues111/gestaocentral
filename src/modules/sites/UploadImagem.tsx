// Componente reusável de upload de imagem pro Firebase Storage.
// Usado pra logo e hero do site.
// Storage path: sites/{rid}/{tipo}.{ext}
// Rules já permitem write authed + read público.

import { useRef, useState } from "react";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";
import { Input } from "../../core/ui/Input";

const TAMANHO_MAX_MB = 5;

type Props = {
  rid: string;
  tipo: "logo" | "hero" | "favicon";
  label: string;
  descricao: string;
  url: string;
  onChange: (url: string) => void;
  disabled?: boolean;
};

export function UploadImagem({ rid, tipo, label, descricao, url, onChange, disabled }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");
  const [acabouDeSalvar, setAcabouDeSalvar] = useState(false);
  const [mostrandoUrl, setMostrandoUrl] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function uploadFile(file: File) {
    setErro("");
    if (!file.type.startsWith("image/")) {
      setErro("Arquivo precisa ser imagem (PNG, JPG, WEBP, SVG).");
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > TAMANHO_MAX_MB) {
      setErro(`Arquivo muito grande (${mb.toFixed(1)} MB). Máximo: ${TAMANHO_MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    setProgresso(0);

    // Mantém extensão original
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `sites/${rid}/${tipo}.${ext}`;
    const ref = storageRef(storage, path);
    const task = uploadBytesResumable(ref, file, { contentType: file.type });

    task.on(
      "state_changed",
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        setProgresso(Math.max(5, Math.round(pct)));
      },
      (err) => {
        console.error("Storage upload error:", err);
        const cod = (err as { code?: string }).code || "";
        if (cod.includes("unauthorized") || cod.includes("permission")) {
          setErro(
            "Sem permissão pra subir arquivo. Storage rules não publicadas? " +
            "Rode: firebase deploy --only storage --project gestaocentral"
          );
        } else {
          setErro(err.message || "Erro ao fazer upload");
        }
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          onChange(downloadUrl);
          setProgresso(100);
          setAcabouDeSalvar(true);
          setTimeout(() => setAcabouDeSalvar(false), 4000);
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Erro ao salvar URL");
        } finally {
          setUploading(false);
          if (inputRef.current) inputRef.current.value = "";
        }
      },
    );
  }

  async function remover() {
    if (!confirm(`Remover ${label.toLowerCase()}?`)) return;
    setErro("");
    // Tenta apagar do Storage (não-bloqueante — se já não existe, ok)
    if (url && url.includes("firebasestorage")) {
      try {
        // Path = sites/{rid}/{tipo}.{ext}; pega o ext da própria URL
        const match = url.match(/\.([a-z]{3,4})(?:\?|$)/i);
        const ext = match?.[1] || "png";
        await deleteObject(storageRef(storage, `sites/${rid}/${tipo}.${ext}`));
      } catch (e) {
        console.warn("deleteObject:", e);
      }
    }
    onChange("");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{descricao}</p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => setMostrandoUrl(v => !v)}
            className="text-[11px] text-indigo-600 hover:underline"
          >
            {mostrandoUrl ? "↑ ocultar URL" : "↓ usar URL externa"}
          </button>
        )}
      </div>

      {/* Preview se houver URL */}
      {url && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 p-2 flex items-center gap-3">
          <img
            src={url}
            alt="Preview"
            style={{ height: tipo === "logo" ? 40 : 60, width: "auto", maxWidth: 200, objectFit: "contain" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-gray-400 truncate font-mono">{url}</div>
          </div>
          {!disabled && (
            <button onClick={remover} className="text-xs text-rose-600 hover:underline shrink-0">
              remover
            </button>
          )}
        </div>
      )}

      {/* Upload */}
      {!disabled && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
            }}
            disabled={uploading}
            className="block w-full text-sm text-gray-700 dark:text-gray-300
              file:mr-3 file:py-2 file:px-3 file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-indigo-50 dark:file:bg-indigo-900/30
              file:text-indigo-700 dark:file:text-indigo-300
              hover:file:bg-indigo-100 disabled:opacity-50"
          />
          {uploading && (
            <div className="mt-1 space-y-1">
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[11px] text-gray-500">Enviando... {progresso}%</p>
            </div>
          )}
          {acabouDeSalvar && !uploading && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mt-1">
              ✓ Salvo automaticamente — site atualizado.
            </p>
          )}
          {erro && <p className="text-xs text-rose-600 mt-1">⚠ {erro}</p>}
        </div>
      )}

      {/* URL externa (alternativa avançada) */}
      {mostrandoUrl && !disabled && (
        <div className="space-y-1">
          <Input
            label=""
            value={url}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://..."
          />
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            ⚠ Use só URLs públicas de imagem (terminam em .png, .jpg, .webp).
            Links do Google Drive, Dropbox ou Instagram NÃO funcionam direto —
            prefere subir o arquivo acima.
          </p>
        </div>
      )}
    </div>
  );
}
