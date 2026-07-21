// Fotos das não-conformidades — armazenadas no Google Drive (subpasta por data).
// Mobile-first: o botão abre a CÂMERA. Miniatura mostrada in-app (bytes baixados
// do Drive); clicar abre um modal DENTRO do app (não navega pro Drive).
import { useEffect, useRef, useState } from "react";
import type { SegurancaFoto } from "../../core/types";
import { subirFotoSeguranca, carregarFotoDataUrl } from "./driveFoto";

const MAX_MB = 15;

export function SegurancaFotos({ rootFolderId, data, fotos, onChange, disabled }: {
  rootFolderId?: string;
  data: string;
  fotos: SegurancaFoto[];
  onChange: (fotos: SegurancaFoto[]) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<SegurancaFoto | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setErro("");
    if (!file.type.startsWith("image/")) { setErro("Precisa ser imagem."); return; }
    if (file.size / (1024 * 1024) > MAX_MB) { setErro(`Máx ${MAX_MB} MB.`); return; }
    if (!rootFolderId) { setErro("Configure a pasta do Drive primeiro."); return; }
    setUploading(true);
    try {
      const foto = await subirFotoSeguranca(rootFolderId, data, file);
      onChange([...fotos, foto]);
    } catch (e) {
      setErro("Falha ao enviar pro Drive: " + (e instanceof Error ? e.message : "?"));
    } finally { setUploading(false); }
  }
  function remover(f: SegurancaFoto) { onChange(fotos.filter((x) => x.driveId !== f.driveId)); }

  return (
    <div className="flex flex-wrap gap-2">
      {fotos.map((f) => (
        <div key={f.driveId} className="relative">
          <button type="button" onClick={() => setAberta(f)} className="block">
            <Miniatura foto={f} />
          </button>
          {!disabled && (
            <button type="button" onClick={() => remover(f)} aria-label="remover foto"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 text-xs leading-none flex items-center justify-center">×</button>
          )}
        </div>
      ))}
      {!disabled && (
        <>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <button type="button" disabled={uploading || !rootFolderId} onClick={() => inputRef.current?.click()}
            title={rootFolderId ? "" : "Configure a pasta do Drive nas configurações do módulo"}
            className="w-16 h-16 rounded-xl border border-dashed border-indigo-400/70 text-indigo-600 dark:text-indigo-300 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 active:scale-95 transition-transform">
            <span className="text-xl leading-none">📷</span>
            <span className="text-[10px] font-semibold">{uploading ? "enviando…" : "foto"}</span>
          </button>
        </>
      )}
      {erro && <span className="text-[10px] text-rose-600 self-center max-w-[160px]">{erro}</span>}
      {aberta && <FotoModal foto={aberta} onClose={() => setAberta(null)} />}
    </div>
  );
}

// Miniatura: baixa o data URL do Drive uma vez (cache) e mostra.
function Miniatura({ foto }: { foto: SegurancaFoto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    carregarFotoDataUrl(foto.driveId).then((u) => { if (vivo) setUrl(u); }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [foto.driveId]);
  if (erro) return <div className="w-16 h-16 rounded-xl border border-gray-200 dark:border-gray-700 grid place-items-center text-lg bg-gray-50 dark:bg-gray-800 text-gray-400">🖼️</div>;
  if (!url) return <div className="w-16 h-16 rounded-xl border border-gray-200 dark:border-gray-700 grid place-items-center bg-gray-50 dark:bg-gray-800 animate-pulse text-gray-300 text-xs">…</div>;
  return <img src={url} alt={foto.nome} className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" />;
}

// Modal in-app da foto (não sai do planejamento.app).
function FotoModal({ foto, onClose }: { foto: SegurancaFoto; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    carregarFotoDataUrl(foto.driveId).then((u) => { if (vivo) setUrl(u); }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [foto.driveId]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-2xl w-full bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{foto.nome}</span>
          <div className="flex items-center gap-3 shrink-0">
            {foto.webViewLink && <a href={foto.webViewLink} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">abrir no Drive ↗</a>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-950 grid place-items-center min-h-[280px] max-h-[75vh] overflow-auto">
          {erro ? <span className="text-sm text-gray-400 py-16">Não foi possível carregar a foto.</span>
            : url ? <img src={url} alt={foto.nome} className="max-w-full max-h-[75vh] object-contain" />
            : <span className="text-sm text-gray-400 py-16 animate-pulse">Carregando do Drive…</span>}
        </div>
      </div>
    </div>
  );
}
