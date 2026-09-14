// ════════════════════════════════════════════════════════════════════════════
//  ListaPrazos — render dos PRAZOS dentro do módulo "Tarefas e Prazos" (visão
//  lista). Componente isolado: não mexe no views.tsx das tarefas. Agrupa por
//  vencido/semana/próximo/futuro (mesma régua do PrazosPage) e respeita a
//  permissão por categoria (podeVerTipo). Clicar abre via onAbrir.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { AlarmClock } from "lucide-react";
import type { Prazo, PrazoTipo, Restaurant } from "../../core/types";
import { PRAZO_TIPO_LABEL } from "../../core/types";
import { ymdExibicao, diaSemanaCurto, grupoAgenda, hojeYmd, type GrupoAgenda } from "../prazos/logic";

const GRUPO_LABEL: Record<GrupoAgenda, string> = { vencido: "Vencidos", semana: "Esta semana", proximo: "Próximos", futuro: "Mais pra frente" };
const GRUPO_ORDEM: GrupoAgenda[] = ["vencido", "semana", "proximo", "futuro"];
const TIPO_COR: Record<PrazoTipo, string> = {
  conta: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  tecnico: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  trabalhista: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  avulso: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};
const brl = (n?: number) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "");

export function ListaPrazos({ prazos, restaurants, podeVerTipo, onAbrir }: {
  prazos: Prazo[];
  restaurants: Restaurant[];
  podeVerTipo: (t: PrazoTipo) => boolean;
  onAbrir: (p: Prazo) => void;
}) {
  const hoje = hojeYmd();
  const nomeEmpresa = (id: string) => restaurants.find((r) => r.id === id)?.nome || "";
  const grupos = useMemo(() => {
    const visiveis = prazos.filter((p) => p.status !== "resolvido" && podeVerTipo(p.tipo));
    const m: Record<GrupoAgenda, Prazo[]> = { vencido: [], semana: [], proximo: [], futuro: [] };
    for (const p of visiveis) m[grupoAgenda(p, hoje)].push(p);
    for (const g of GRUPO_ORDEM) m[g].sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prazos, hoje]);

  const total = GRUPO_ORDEM.reduce((s, g) => s + grupos[g].length, 0);
  if (total === 0) return (
    <div className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">
      <AlarmClock size={16} className="inline align-[-3px] mr-1.5" />Nenhum prazo em aberto.
    </div>
  );

  return (
    <div className="space-y-4">
      {GRUPO_ORDEM.filter((g) => grupos[g].length > 0).map((g) => (
        <div key={g}>
          <div className={`text-[11px] font-bold uppercase tracking-wide mb-1.5 ${g === "vencido" ? "text-rose-600 dark:text-rose-400" : "text-gray-400 dark:text-gray-500"}`}>
            {GRUPO_LABEL[g]} <span className="font-normal">({grupos[g].length})</span>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {grupos[g].map((p) => {
              const exib = ymdExibicao(p.vencimento);
              const desloc = exib !== p.vencimento;   // vencimento caiu no fim de semana → exibido na sexta
              const valor = p.tipo === "conta" ? p.dados?.valor : undefined;
              return (
                <button key={p.id} type="button" onClick={() => onAbrir(p)}
                  className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <AlarmClock size={15} className={g === "vencido" ? "text-rose-500 shrink-0" : "text-gray-400 shrink-0"} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800 dark:text-gray-100 truncate">{p.titulo}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded-full font-semibold ${TIPO_COR[p.tipo]}`}>{PRAZO_TIPO_LABEL[p.tipo]}</span>
                      {(p.restaurantIds || []).map(nomeEmpresa).filter(Boolean).slice(0, 3).join(" · ")}
                      {p.status === "agendado" && <span className="text-indigo-500">· agendado</span>}
                    </div>
                  </div>
                  {valor != null && <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 shrink-0">{brl(valor)}</span>}
                  <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 shrink-0 text-right">
                    {exib.slice(8, 10)}/{exib.slice(5, 7)} <span className="text-gray-400">{diaSemanaCurto(exib)}</span>
                    {desloc && <span title="Vence no fim de semana — exibido na sexta" className="text-amber-500"> ↩</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
