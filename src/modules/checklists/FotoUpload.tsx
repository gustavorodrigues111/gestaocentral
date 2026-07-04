// Upload de foto compacto pros checklists (foto-guia do template e foto-prova
// da execução). Sobe pro Storage em checklists/{rid}/... e devolve a URL.
import { useRef, useState } from "react";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";

const MAX_MB = 10;

export function FotoUpload({ rid, pathPrefix, url, onChange, disabled, label = "foto" }: {
  rid: string; pathPrefix: string; url?: string | null;
  onChange: (url: string | null) => void; disabled?: boolean; label?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [prog, setProg] = useState(0);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File) {
    setErro("");
    if (!file.type.startsWith("image/")) { setErro("Precisa ser imagem."); return; }
    if (file.size / (1024 * 1024) > MAX_MB) { setErro(`Máx ${MAX_MB} MB.`); return; }
    setUploading(true); setProg(0);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `checklists/${rid}/${pathPrefix}_${Date.now()}.${ext}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });
    task.on("state_changed",
      (s) => setProg(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      (e) => { setErro(e.message.includes("unauthorized") ? "Sem permissão no Storage (deploy das regras?)." : e.message); setUploading(false); },
      async () => { const u = await getDownloadURL(task.snapshot.ref); onChange(u); setUploading(false); },
    );
  }
  async function remover() {
    const u = url;
    onChange(null);
    if (u && u.includes("firebasestorage")) { try { await deleteObject(storageRef(storage, u)); } catch { /* já foi */ } }
  }

  if (url) {
    return (
      <div className="inline-flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} className="w-12 h-12 rounded-lg object-cover border border-gray-200 dark:border-gray-700" /></a>
        {!disabled && <button type="button" onClick={() => void remover()} className="text-[11px] text-gray-400 hover:text-rose-600 underline">remover {label}</button>}
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" disabled={disabled || uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} className="text-[11px] px-2 py-1 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">{uploading ? `enviando… ${prog}%` : `📷 ${label}`}</button>
      {erro && <span className="text-[10px] text-rose-600">{erro}</span>}
    </div>
  );
}
