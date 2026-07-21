// Captura de fotos das não-conformidades. Mobile-first: o botão abre a CÂMERA
// do aparelho (capture=environment). Múltiplas fotos por item. Sobe pro Storage
// em seguranca/{rid}/... e devolve o array de URLs.
import { useRef, useState } from "react";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";

const MAX_MB = 12;

export function SegurancaFotos({ rid, urls, onChange, disabled }: {
  rid: string; urls: string[]; onChange: (urls: string[]) => void; disabled?: boolean;
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
    const path = `seguranca/${rid}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });
    task.on("state_changed",
      (s) => setProg(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      (e) => { setErro(e.message.includes("unauthorized") ? "Sem permissão no Storage (deploy das regras?)." : e.message); setUploading(false); },
      async () => { const u = await getDownloadURL(task.snapshot.ref); onChange([...urls, u]); setUploading(false); },
    );
  }
  async function remover(u: string) {
    onChange(urls.filter((x) => x !== u));
    if (u.includes("firebasestorage")) { try { await deleteObject(storageRef(storage, u)); } catch { /* já foi */ } }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u) => (
        <div key={u} className="relative">
          <a href={u} target="_blank" rel="noreferrer">
            <img src={u} alt="foto" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" />
          </a>
          {!disabled && (
            <button type="button" onClick={() => void remover(u)} aria-label="remover foto"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 text-xs leading-none flex items-center justify-center">×</button>
          )}
        </div>
      ))}
      {!disabled && (
        <>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}
            className="w-16 h-16 rounded-xl border border-dashed border-teal-400/70 text-teal-600 dark:text-teal-300 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 active:scale-95 transition-transform">
            <span className="text-xl leading-none">📷</span>
            <span className="text-[10px] font-semibold">{uploading ? `${prog}%` : "foto"}</span>
          </button>
        </>
      )}
      {erro && <span className="text-[10px] text-rose-600 self-center">{erro}</span>}
    </div>
  );
}
