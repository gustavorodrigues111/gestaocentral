// Seletor de fonte (dropdown com cada opção na própria fonte) + modal de adicionar
// qualquer família do Google. Usado na aba Configurações do Cardápio. Carrega as
// fontes do catálogo só enquanto está em uso (config aberta), não no designer.
import { useEffect, useRef, useState } from "react";
import { opcoesFonte, resolverFonte, urlsCss2, fonteCustom, FONTES_GOOGLE_POPULARES } from "./cardapioFontes";

// Carrega no <head> só as 2 famílias selecionadas (título + corpo). Rápido —
// é o que o preview do PDF precisa. Use no host do módulo pra já deixar em cache.
export function carregarFontesCardapio(fonteTitulos: string | undefined, fonteCorpo: string | undefined, custom: string[] = []): () => void {
  const fams = [resolverFonte(fonteTitulos, custom), resolverFonte(fonteCorpo, custom)];
  const links = urlsCss2(fams).map((href) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.dataset.fonteCardapio = "1";
    document.head.appendChild(l);
    return l;
  });
  return () => links.forEach((l) => l.remove());
}

// ─── Dropdown de fonte: cada opção renderizada na sua própria fonte ──────────
export function FontePicker({ label, value, custom, onChange, onAdicionar }: {
  label: string; value: string; custom: string[]; onChange: (id: string) => void; onAdicionar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opcoes = opcoesFonte(custom);
  const atual = resolverFonte(value, custom);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <button type="button" onClick={() => setAberto((v) => !v)}
        className="w-full text-left px-2.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 flex items-center justify-between gap-2">
        <span style={{ fontFamily: atual.cssFamily }} className="truncate">{atual.nome}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {aberto && (
        <div className="absolute z-10 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {opcoes.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setAberto(false); }}
              className={`block w-full text-left px-3 py-2 text-[15px] hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${o.id === value ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}
              style={{ fontFamily: o.cssFamily }}>
              {o.nome}
            </button>
          ))}
          <button type="button" onClick={() => { setAberto(false); onAdicionar(); }}
            className="block w-full text-left px-3 py-2 text-[13px] font-semibold text-indigo-600 border-t border-gray-100 dark:border-gray-800">
            + Adicionar fonte do Google
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Modal: adicionar qualquer fonte do Google ───────────────────────────────
export function AdicionarFonteModal({ onClose, onAdd }: { onClose: () => void; onAdd: (family: string) => void }) {
  const [busca, setBusca] = useState("");
  const q = busca.trim().toLowerCase();
  const digitada = busca.trim();

  // Filtra a lista embutida (sem rede). Sempre mostra algo: sem busca = lista toda.
  const filtradas = (q.length === 0 ? FONTES_GOOGLE_POPULARES : FONTES_GOOGLE_POPULARES.filter((f) => f.toLowerCase().includes(q))).slice(0, 80);
  // Permite adicionar uma família digitada que não está na lista (qualquer fonte do Google).
  const mostrarDigitada = digitada.length >= 2 && !FONTES_GOOGLE_POPULARES.some((f) => f.toLowerCase() === digitada.toLowerCase());
  const visiveis = [...(mostrarDigitada ? [digitada] : []), ...filtradas];

  // Carrega as fontes visíveis (cada linha renderiza na própria fonte). Recarrega
  // num pequeno debounce conforme o usuário digita.
  useEffect(() => {
    if (!visiveis.length) return;
    const t = window.setTimeout(() => {
      urlsCss2(visiveis.slice(0, 60).map(fonteCustom)).forEach((href) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.fontePreview = "1";
        document.head.appendChild(link);
      });
    }, 250);
    return () => {
      clearTimeout(t);
      document.head.querySelectorAll('link[data-fonte-preview="1"]').forEach((l) => l.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3 flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 dark:text-gray-100">Adicionar fonte do Google</h3>
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquise a fonte (ex: Bebas Neue, Playfair…)"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        <p className="text-[11px] text-gray-400">Clique numa fonte pra adicioná-la. A prévia aparece na própria fonte.</p>
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {mostrarDigitada && (
            <button type="button" onClick={() => onAdd(digitada)}
              className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
              <span style={{ fontFamily: `'${digitada}', sans-serif`, fontSize: 20 }} className="truncate text-gray-900 dark:text-gray-100">{digitada}</span>
              <span className="text-[11px] text-indigo-600 shrink-0">usar esta ↵</span>
            </button>
          )}
          {filtradas.map((f) => (
            <button key={f} type="button" onClick={() => onAdd(f)}
              className="flex items-center justify-between gap-3 w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
              <span style={{ fontFamily: `'${f}', sans-serif`, fontSize: 20 }} className="truncate text-gray-900 dark:text-gray-100">{f}</span>
              <span className="text-[11px] text-gray-400 shrink-0">{f}</span>
            </button>
          ))}
          {!visiveis.length && <div className="px-3 py-6 text-center text-[13px] text-gray-400">Nenhuma fonte encontrada. Digite o nome exato pra adicionar mesmo assim.</div>}
        </div>
        <div className="flex justify-between items-center gap-2">
          <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="text-[11px] text-gray-400 hover:underline">ver no Google Fonts ↗</a>
          <button type="button" onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Fechar</button>
        </div>
      </div>
    </div>
  );
}
