// Setores responsáveis por etapa da Wiki de Processos (vocabulário operacional,
// universal a todas as empresas). Uma etapa referencia SETORES (não perfis de
// acesso). Quem é cada setor por empresa resolve por: (a) mapa manual em
// wikiConfig/{rid}, e (b) perfis de acesso marcados com o setor (AccessProfile
// .wikiSetores). Assim a etapa nunca aponta pra um perfil — a correlação vive
// no perfil.
export type SetorMeta = { id: string; label: string; icon: string; cls: string };

export const SETORES: SetorMeta[] = [
  { id: "lideranca",  label: "Liderança de área",        icon: "🧑‍✈️", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  { id: "area",       label: "Equipe da área",           icon: "👥",   cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  { id: "dp",         label: "Departamento de Pessoas",  icon: "🧑‍⚖️", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  { id: "financeiro", label: "Financeiro",               icon: "💰",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  { id: "socios",     label: "Sócios",                   icon: "👔",   cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
  { id: "compras",    label: "Compras / Estoque",        icon: "📦",   cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
];

export const setorMeta = (id?: string): SetorMeta | undefined => (id ? SETORES.find(s => s.id === id) : undefined);
