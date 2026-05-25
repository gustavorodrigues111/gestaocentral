// Banner sticky no topo da UI quando master está visualizando como outra
// pessoa. Aviso visual sempre presente — não dá pra "esquecer" que tá
// impersonando.
//
// Mobile: 1 linha compacta só com nome + botão sair. Detalhes
// (você é X, aviso de auth real) ficam num popover expansível e em
// tooltips — pra não comer espaço da navegação principal.
// Desktop (sm+): expande na lateral, mostra "você é X (master)" inline.

import { useState } from "react";
import { useAuth } from "./AuthContext";

export function ImpersonationBanner() {
  const { isImpersonating, pessoa, pessoaReal, stopImpersonate } = useAuth();
  const [expandido, setExpandido] = useState(false);

  if (!isImpersonating || !pessoa || !pessoaReal) return null;

  return (
    <div
      className="sticky top-0 z-[60] bg-amber-500 text-white shadow-md"
      role="alert"
    >
      <div className="max-w-screen-2xl mx-auto px-2 sm:px-4 py-1 sm:py-1.5 flex items-center gap-2">
        <span className="text-base sm:text-lg shrink-0" aria-hidden>👁️</span>

        {/* Linha principal: nome + (desktop) "você é X" inline */}
        <div className="text-[12px] sm:text-sm min-w-0 flex-1 truncate">
          <span className="font-semibold">Visualizando como </span>
          <span className="font-bold">{pessoa.nome}</span>
          <span className="hidden sm:inline opacity-90 mx-1">·</span>
          <span className="hidden sm:inline opacity-90 text-xs">
            você é {pessoaReal.nome} (master)
          </span>
        </div>

        {/* "i" pra expandir detalhes em mobile — esconde em desktop (já mostra inline) */}
        <button
          type="button"
          onClick={() => setExpandido(e => !e)}
          aria-label={expandido ? "Esconder detalhes" : "Mostrar detalhes"}
          className="sm:hidden text-[11px] font-bold px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 shrink-0"
        >
          {expandido ? "−" : "ⓘ"}
        </button>

        <button
          type="button"
          onClick={stopImpersonate}
          className="text-[11px] sm:text-sm font-semibold px-2 sm:px-3 py-1 rounded bg-white/90 text-amber-700 hover:bg-white shrink-0"
        >
          <span className="sm:hidden">✕</span>
          <span className="hidden sm:inline">✕ Sair</span>
        </button>
      </div>

      {/* Detalhes expansíveis em mobile + sempre visível em desktop como sub-linha. */}
      {(expandido || typeof window === "undefined") && (
        <div className="sm:hidden max-w-screen-2xl mx-auto px-2 pb-1.5 text-[10px] opacity-95 leading-snug">
          <div>Você é <strong>{pessoaReal.nome}</strong> (master)</div>
          <div>⚠ Ações ficam registradas em seu nome (auth real)</div>
        </div>
      )}
      <div className="hidden sm:block max-w-screen-2xl mx-auto px-4 pb-1 text-[11px] opacity-90">
        ⚠ Ações que você fizer ainda são registradas em seu nome (auth real).
      </div>
    </div>
  );
}
