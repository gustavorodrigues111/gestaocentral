import { useMemo, useState } from "react";
import { Search, Plus, Package, Building2, TriangleAlert, AlertCircle } from "lucide-react";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { UNIDADES_LABEL } from "../../core/types";
import type { Fornecedor, Insumo } from "../../core/types";
import { InsumoModal } from "../contagens/InsumoModal";

type Props = {
  insumos: Insumo[];
  fornecedores: Fornecedor[];
  restaurantId: string;
  podeConfig: boolean;
};

type Filtro = "todos" | "sem_min" | "sem_forn";

const undLabel = (i: Insumo) =>
  i.unidade === "outro" ? (i.unidadeOutroLabel || "?") : (UNIDADES_LABEL[i.unidade]?.slice(0, 3) ?? String(i.unidade || "?").slice(0, 3));

export function ProdutosTab({ insumos, fornecedores, restaurantId, podeConfig }: Props) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [editando, setEditando] = useState<Insumo | "new" | null>(null);

  const fornById = useMemo(() => new Map(fornecedores.map(f => [f.id, f])), [fornecedores]);
  const categoriasExistentes = useMemo(() => [...new Set(insumos.map(i => i.categoria).filter(Boolean) as string[])], [insumos]);
  const unidadesCustom = useMemo(() => [...new Set(insumos.map(i => i.unidadeOutroLabel).filter(Boolean) as string[])], [insumos]);

  const semMin = (i: Insumo) => !i.minStock || i.minStock <= 0;
  const semForn = (i: Insumo) => !i.fornecedorPreferredId || !fornById.get(i.fornecedorPreferredId);

  const contadores = useMemo(() => ({
    semMin: insumos.filter(i => i.ativo && semMin(i)).length,
    semForn: insumos.filter(i => i.ativo && semForn(i)).length,
  }), [insumos, fornById]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return insumos
      .filter(i => i.ativo)
      .filter(i => !b || i.nome.toLowerCase().includes(b) || (i.categoria || "").toLowerCase().includes(b))
      .filter(i => filtro === "todos" ? true : filtro === "sem_min" ? semMin(i) : semForn(i))
      .sort((a, b2) => (a.nome || "").localeCompare(b2.nome || "", "pt-BR"));
  }, [insumos, busca, filtro, fornById]);

  async function excluir(i: Insumo) {
    if (!confirm(`Excluir o produto "${i.nome}"?`)) return;
    try { await deleteDoc(doc(db, "insumos", i.id)); setEditando(null); }
    catch (e) { alert(e instanceof Error ? e.message : "Erro ao excluir"); }
  }

  const chip = (id: Filtro, label: string, n?: number) => (
    <button type="button" onClick={() => setFiltro(id)}
      className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors ${filtro === id
        ? "bg-indigo-600 border-indigo-600 text-white"
        : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
      {label}{n != null && n > 0 && <span className={`ml-1 ${filtro === id ? "text-white/80" : "text-amber-600 dark:text-amber-400"}`}>({n})</span>}
    </button>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Os mesmos produtos das Contagens/Recebimento. Configure aqui o <strong>estoque mínimo</strong>, o <strong>fornecedor preferencial</strong>, o <strong>pacote</strong> e o <strong>pedido mínimo</strong> — é o que alimenta a sugestão de pedido.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        </div>
        {podeConfig && (
          <button type="button" onClick={() => setEditando("new")}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            <Plus size={15} /> Novo produto
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {chip("todos", "Todos")}
        {chip("sem_min", "Sem estoque mínimo", contadores.semMin)}
        {chip("sem_forn", "Sem fornecedor", contadores.semForn)}
      </div>

      {(contadores.semMin > 0 || contadores.semForn > 0) && filtro === "todos" && (
        <div className="text-[12px] inline-flex items-start gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Produto <strong>sem estoque mínimo</strong> não entra na sugestão; <strong>sem fornecedor</strong> não é agrupado num pedido. Use os filtros acima pra completar.</span>
        </div>
      )}

      <div className="space-y-1.5">
        {lista.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">Nenhum produto {busca ? "encontrado" : "cadastrado"}.</div>}
        {lista.map(i => {
          const forn = i.fornecedorPreferredId ? fornById.get(i.fornecedorPreferredId) : null;
          return (
            <button key={i.id} type="button" onClick={() => setEditando(i)}
              className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 hover:border-indigo-300 dark:hover:border-indigo-800 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                    {i.nome} <span className="text-[11px] font-normal text-gray-400">{undLabel(i)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                    {i.categoria && <span>{i.categoria}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Building2 size={11} />
                      {forn ? forn.nome : <span className="text-amber-600 dark:text-amber-400">sem fornecedor</span>}
                    </span>
                    {i.fatorCompra && i.fatorCompra > 1 && <span className="inline-flex items-center gap-1"><Package size={11} /> pacote {i.fatorCompra}×</span>}
                    {i.minPedido != null && i.minPedido > 0 && <span>mín/item {i.minPedido}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Estoque mín.</div>
                  {semMin(i)
                    ? <div className="text-[12px] font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"><TriangleAlert size={12} /> definir</div>
                    : <div className="text-sm font-bold text-gray-800 dark:text-gray-100 tabular-nums">{i.minStock}</div>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {editando && (
        <InsumoModal
          insumo={editando === "new" ? null : editando}
          fornecedores={fornecedores}
          restaurantId={restaurantId}
          categoriasExistentes={categoriasExistentes}
          unidadesCustom={unidadesCustom}
          onExcluir={podeConfig ? excluir : undefined}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}
