// Biblioteca embutida de ícones de bebida (SVG inline — renderiza no editor, no
// site e no PDF via html2canvas sem problema de CORS). Cada ícone é traço
// (currentColor), 24x24. Pra logos de marca, usar upload (iconeUrl).
import { useState, type CSSProperties } from "react";

export type IconeCardapio = { id: string; nome: string; paths: string };

// Desenhos simples de traço (line icons).
export const ICONES_CARDAPIO: IconeCardapio[] = [
  { id: "taca",     nome: "Taça de vinho", paths: "M8 3h8l-1 6a3 3 0 0 1-6 0L8 3zM12 12v6M9 21h6" },
  { id: "martini",  nome: "Martini",       paths: "M5 4h14l-7 8-7-8zM12 12v7M8 21h8" },
  { id: "cerveja",  nome: "Caneca",        paths: "M6 6h9v13H6zM15 9h3v6h-3M6 6l1-2h7l1 2" },
  { id: "long",     nome: "Long drink",    paths: "M8 3h8l-1 17H9L8 3zM8.5 9h7" },
  { id: "short",    nome: "Copo baixo",    paths: "M7 8h10l-1 11H8L7 8z" },
  { id: "garrafa",  nome: "Garrafa",       paths: "M10 3h4v3l1 3v11H9V9l1-3V3zM9 12h6" },
  { id: "coco",     nome: "Coco",          paths: "M4 11a8 8 0 0 0 16 0H4zM13 11l3-7M16 4l2-1" },
  { id: "cafe",     nome: "Café",          paths: "M5 8h12v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8zM17 9h2a2 2 0 0 1 0 4h-2M8 4v1M11 4v1M14 4v1" },
  { id: "lata",     nome: "Lata",          paths: "M7 5h10v14H7zM7 8h10M7 16h10" },
  { id: "espumante",nome: "Espumante",     paths: "M9 3h6l-1 7a2 2 0 0 1-4 0L9 3zM12 12v6M9 21h6M7 4l-1-1M17 4l1-1" },
  { id: "limao",    nome: "Cítrico",       paths: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 4v16M4 12h16M6 6l12 12M18 6L6 18" },
  { id: "folha",    nome: "Herbal",        paths: "M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7" },
];

export function IconeCardapioView({ id, size = 22, color = "#1d3c4b", style }: { id: string; size?: number; color?: string; style?: CSSProperties }) {
  const ic = ICONES_CARDAPIO.find((i) => i.id === id);
  if (!ic) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {ic.paths.split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
    </svg>
  );
}

// ─── Seletor de ícone (biblioteca embutida + upload de imagem) ───────────────
export function IconePickerModal({ rid, pratoId, value, onChange, onClose }: {
  rid: string;
  pratoId: string;
  value: { iconeId?: string; iconeUrl?: string };
  onChange: (v: { iconeId?: string; iconeUrl?: string }) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 dark:text-gray-100">Ícone do item</h3>
        <div className="grid grid-cols-6 gap-2">
          {ICONES_CARDAPIO.map((ic) => (
            <button key={ic.id} type="button" title={ic.nome} onClick={() => { onChange({ iconeId: ic.id }); onClose(); }}
              className={`flex items-center justify-center p-2 rounded-lg border ${value.iconeId === ic.id ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30" : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              <IconeCardapioView id={ic.id} size={22} />
            </button>
          ))}
        </div>
        <UploadIcone rid={rid} pratoId={pratoId} onUploaded={(url) => { onChange({ iconeUrl: url }); onClose(); }} />
        <div className="flex justify-between items-center pt-1">
          <button type="button" onClick={() => { onChange({}); onClose(); }} className="text-[12px] text-rose-600 hover:underline">remover ícone</button>
          <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Fechar</button>
        </div>
      </div>
    </div>
  );
}

function UploadIcone({ rid, pratoId, onUploaded }: { rid: string; pratoId: string; onUploaded: (url: string) => void }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <label className="block text-[12px] text-gray-600 dark:text-gray-400">
      Ou suba uma imagem (logo de marca, PNG):
      <input type="file" accept="image/*" disabled={enviando} className="block mt-1 text-[12px]"
        onChange={async (e) => {
          const f = e.target.files?.[0]; e.currentTarget.value = ""; if (!f) return;
          setEnviando(true);
          try {
            const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
            const { storage } = await import("../../core/firebase/config");
            const r = ref(storage, `cardapios/${rid}/icones/${pratoId}-${Date.now()}`);
            await uploadBytes(r, f, { contentType: f.type });
            onUploaded(await getDownloadURL(r));
          } catch { /* ignora */ }
          finally { setEnviando(false); }
        }} />
      {enviando && <span className="text-[11px] text-indigo-600"> enviando…</span>}
    </label>
  );
}
