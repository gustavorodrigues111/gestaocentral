// Biblioteca embutida de ícones de bebida (SVG inline — renderiza no editor, no
// site e no PDF via html2canvas sem problema de CORS). Cada ícone é uma SILHUETA
// PREENCHIDA, 24x24. Pra logos de marca, usar upload (iconeUrl).
import { useState, type CSSProperties } from "react";

export type IconeCardapio = { id: string; nome: string; paths: string };

// Silhuetas PREENCHIDAS (fill), normalizadas na caixa 24x24 e centradas, pra
// ficarem uniformes e alinhadas (estilo de cardápio impresso). Subpaths internos
// (ex: cubo de gelo do copo baixo) viram "furo" via fill-rule evenodd.
export const ICONES_CARDAPIO: IconeCardapio[] = [
  { id: "taca",     nome: "Taça de vinho", paths: "M6.5 3H17.5C17.5 8.5 15 11.5 12 11.5S6.5 8.5 6.5 3ZM11 11.2H13V19H16V21H8V19H11Z" },
  { id: "martini",  nome: "Martini",       paths: "M4.5 4H19.5L12 13ZM11 12H13V19H16V21H8V19H11Z" },
  { id: "cerveja",  nome: "Caneca",        paths: "M6 5H15.5V20.5H6ZM15.5 8.5H17.3A3 3 0 0 1 17.3 13.7H15.5V12.1H17.1A1.4 1.4 0 0 0 17.1 10.5H15.5Z" },
  { id: "long",     nome: "Long drink",    paths: "M8 3H16L15.2 21H8.8Z" },
  { id: "short",    nome: "Copo baixo",    paths: "M7 8H17L16 20H8ZM10.4 11H14V14.6H10.4Z" },
  { id: "garrafa",  nome: "Garrafa",       paths: "M10 2.5H14V5.5L15 8.5V20A1.2 1.2 0 0 1 13.8 21.2H10.2A1.2 1.2 0 0 1 9 20V8.5L10 5.5Z" },
  { id: "coco",     nome: "Coco",          paths: "M4.5 11A7.5 7.5 0 0 0 19.5 11ZM13.5 11L16.5 3L18 3.6L15 11Z" },
  { id: "cafe",     nome: "Café",          paths: "M6 8.5H16V12.5A4.5 4.5 0 0 1 11.5 17H10.5A4.5 4.5 0 0 1 6 12.5ZM16 9.6H17.6A2.3 2.3 0 0 1 17.6 14.2H16V12.7H17.4A0.9 0.9 0 0 0 17.4 10.9H16ZM5 19H18V20.5H5Z" },
  { id: "lata",     nome: "Lata",          paths: "M8 4H16A2 2 0 0 1 18 6V18A2 2 0 0 1 16 20H8A2 2 0 0 1 6 18V6A2 2 0 0 1 8 4ZM8.5 7.5H15.5V8.6H8.5Z" },
  { id: "espumante",nome: "Espumante",     paths: "M9.5 3H14.5L13.3 12A1.3 1.3 0 0 1 10.7 12ZM11 11.5H13V19H16V21H8V19H11Z" },
  { id: "limao",    nome: "Cítrico",       paths: "M4 12A8 8 0 1 0 20 12A8 8 0 1 0 4 12Z" },
  { id: "folha",    nome: "Herbal",        paths: "M5 19C5 10.5 10.5 5 19 5C19 13.5 13.5 19 5 19Z" },
];

export function IconeCardapioView({ id, size = 22, color = "#1d3c4b", style }: { id: string; size?: number; color?: string; style?: CSSProperties }) {
  const ic = ICONES_CARDAPIO.find((i) => i.id === id);
  if (!ic) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" style={style}>
      <path d={ic.paths} fillRule="evenodd" clipRule="evenodd" />
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
