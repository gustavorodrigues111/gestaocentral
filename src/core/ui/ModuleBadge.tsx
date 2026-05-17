import type { ModuleEtapa } from "../types";

// Badge visual da maturidade do módulo. Aparece na Sidebar, na tela inicial
// e na tela de permissões. Quando `etapa` for undefined, não renderiza nada.
export function ModuleBadge({ etapa, size = "sm" }: { etapa?: ModuleEtapa; size?: "xs" | "sm" }) {
  if (!etapa) return null;

  const isBeta = etapa === "beta";
  const cls = isBeta
    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-200 dark:border-amber-800"
    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700";

  const sizeCls = size === "xs"
    ? "text-[9px] px-1 py-[1px]"
    : "text-[10px] px-1.5 py-0.5";

  const label = isBeta ? "Beta" : "Em dev";
  const title = isBeta
    ? "Beta — funcionalidade já em uso, mas ainda recebendo ajustes"
    : "Em desenvolvimento — comportamento pode mudar, bugs esperados";

  return (
    <span
      className={`inline-flex items-center font-semibold rounded uppercase tracking-wide leading-none ${sizeCls} ${cls}`}
      title={title}
    >
      {label}
    </span>
  );
}
