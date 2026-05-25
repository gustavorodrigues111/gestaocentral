// Banner sticky no topo da UI quando master está visualizando como outra
// pessoa. Aviso visual sempre presente — não dá pra "esquecer" que tá
// impersonando.

import { useAuth } from "./AuthContext";

export function ImpersonationBanner() {
  const { isImpersonating, pessoa, pessoaReal, stopImpersonate } = useAuth();

  if (!isImpersonating || !pessoa || !pessoaReal) return null;

  return (
    <div
      className="sticky top-0 z-[60] bg-amber-500 text-white shadow-lg"
      role="alert"
    >
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg" aria-hidden>👁️</span>
          <div className="text-sm min-w-0">
            <span className="font-semibold">Visualizando como </span>
            <span className="font-bold">{pessoa.nome}</span>
            <span className="opacity-90 mx-1">·</span>
            <span className="opacity-90 text-xs">você é {pessoaReal.nome} (master)</span>
          </div>
        </div>
        <button
          type="button"
          onClick={stopImpersonate}
          className="text-xs sm:text-sm font-semibold px-3 py-1 rounded bg-white/90 text-amber-700 hover:bg-white transition-colors shrink-0"
        >
          ✕ Sair do modo visualização
        </button>
      </div>
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 pb-1.5 text-[11px] sm:text-xs opacity-90">
        ⚠ Ações que você fizer ainda são registradas em seu nome (auth real).
        Esse modo é só pra ver o sistema pelos olhos de {pessoa.nome}.
      </div>
    </div>
  );
}
