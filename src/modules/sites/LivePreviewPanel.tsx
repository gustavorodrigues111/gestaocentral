// Painel de preview ao vivo — fica ao LADO do editor (aba Geral) em telas
// largas. Reusa o /site-preview/:rid num iframe e recarrega quando o config
// muda (updatedAt). Toggle desktop/mobile. Sticky pra acompanhar o scroll.
import { useState } from "react";
import { Monitor, Smartphone, ExternalLink } from "lucide-react";
import { useSiteConfig } from "./useSiteConfig";

export function LivePreviewPanel({ rid, nomeRestaurante }: { rid: string; nomeRestaurante: string }) {
  const { config } = useSiteConfig(rid, nomeRestaurante);
  const [vp, setVp] = useState<"desktop" | "mobile">("mobile");
  const previewUrl = `/site-preview/${rid}`;

  return (
    <div className="sticky top-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Preview ao vivo</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setVp("mobile")} className={`px-2.5 py-1 text-[11px] rounded ${vp === "mobile" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}><span className="inline-flex items-center gap-1"><Smartphone size={12} /> Mobile</span></button>
          <button onClick={() => setVp("desktop")} className={`px-2.5 py-1 text-[11px] rounded ${vp === "desktop" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}><span className="inline-flex items-center gap-1"><Monitor size={12} /> Desktop</span></button>
          <a href={previewUrl} target="_blank" rel="noreferrer" className="ml-1 text-gray-400 hover:text-indigo-600" title="Abrir em nova aba"><ExternalLink size={14} /></a>
        </div>
      </div>
      <div className="rounded-xl border-2 border-gray-300 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-900">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-400">
          <div className="flex gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400" /><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="w-2 h-2 rounded-full bg-emerald-400" /></div>
          <span className="font-mono ml-1 truncate">{config?.slug || rid}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", background: "#e5e7eb", padding: vp === "mobile" ? 14 : 0 }}>
          <iframe
            key={config?.updatedAt}
            src={previewUrl}
            title="Preview ao vivo"
            style={{ width: vp === "mobile" ? 320 : "100%", height: "72vh", border: "none", background: "#fff", borderRadius: vp === "mobile" ? 12 : 0, boxShadow: vp === "mobile" ? "0 4px 16px rgba(0,0,0,.15)" : "none" }}
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Atualiza alguns segundos depois de salvar.</p>
    </div>
  );
}
