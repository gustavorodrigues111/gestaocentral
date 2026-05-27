// Tab "🛍️ Itens" — catálogo de itens (uniformes + EPIs) com variações.

import { useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import type { ItemUniforme, Pessoa } from "../../core/types";
import { deletarItem } from "../../core/uniformes/uniformesHelpers";
import { ItemEditarModal } from "./ItemEditarModal";

type Props = {
  itens: ItemUniforme[];
  podeConfig: boolean;
  pessoa: Pessoa;
  restaurantId: string;
};

type Filtro = "todos" | "uniforme" | "epi" | "inativos";

export function ItensTab({ itens, podeConfig, pessoa, restaurantId }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<ItemUniforme | "novo" | null>(null);

  const itensFiltrados = useMemo(() => {
    let r = itens;
    if (filtro === "uniforme") r = r.filter(i => i.tipo === "uniforme" && i.ativo);
    else if (filtro === "epi") r = r.filter(i => i.tipo === "epi" && i.ativo);
    else if (filtro === "inativos") r = r.filter(i => !i.ativo);
    else r = r.filter(i => i.ativo);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      r = r.filter(i => i.nome.toLowerCase().includes(q));
    }
    return r.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [itens, filtro, busca]);

  async function excluir(item: ItemUniforme) {
    if (!podeConfig) return;
    const tem = item.variacoes.some(v => v.estoque > 0);
    const aviso = tem
      ? `${item.nome} tem estoque > 0 em alguma variação. Excluir mesmo assim?`
      : `Excluir o item "${item.nome}"?`;
    if (!confirm(aviso)) return;
    try {
      await deletarItem(item.id);
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : "?"));
    }
  }

  return (
    <div className="space-y-3">
      {/* Header com filtros + busca + botão novo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([
            ["todos", "Todos"], ["uniforme", "🦺 Uniformes"], ["epi", "🛡️ EPIs"], ["inativos", "Inativos"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                filtro === id
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome…"
          className="flex-1 max-w-xs px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        {podeConfig && (
          <Button size="sm" onClick={() => setEditando("novo")} className="ml-auto">
            + Novo item
          </Button>
        )}
      </div>

      {/* Lista */}
      {itensFiltrados.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 italic">
          {itens.length === 0
            ? "Nenhum item cadastrado. Clica em \"+ Novo item\" pra começar."
            : "Nenhum item bate com o filtro."}
        </div>
      ) : (
        <div className="space-y-1.5">
          {itensFiltrados.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              podeConfig={podeConfig}
              onEditar={() => setEditando(item)}
              onExcluir={() => excluir(item)}
            />
          ))}
        </div>
      )}

      {editando && (
        <ItemEditarModal
          item={editando === "novo" ? null : editando}
          pessoa={pessoa}
          restaurantId={restaurantId}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function ItemRow({
  item, podeConfig, onEditar, onExcluir,
}: {
  item: ItemUniforme;
  podeConfig: boolean;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const estoqueTotal = item.variacoes.reduce((s, v) => s + (v.estoque || 0), 0);
  const algumBaixo = item.variacoes.some(v =>
    v.estoqueMinimo != null && v.estoque < v.estoqueMinimo
  );

  return (
    <div className={`rounded-lg border ${
      item.ativo
        ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40"
        : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20 opacity-60"
    } p-3 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl flex-shrink-0">
          {item.tipo === "epi" ? "🛡️" : "🦺"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {item.nome}
            {item.tipo === "epi" && item.caEpi && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
                CA {item.caEpi}
              </span>
            )}
            {algumBaixo && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded">
                ⚠ estoque baixo
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            R$ {item.custoUnit.toFixed(2)} ·
            {item.validadeDias > 0
              ? ` validade ${item.validadeDias} dia${item.validadeDias > 1 ? "s" : ""}`
              : " sem validade"}
            {" · "}estoque total: <strong>{estoqueTotal}</strong>
          </div>
          {item.variacoes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.variacoes.map(v => (
                <span
                  key={v.id}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    v.estoqueMinimo != null && v.estoque < v.estoqueMinimo
                      ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300"
                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300"
                  }`}
                  title={v.estoqueMinimo != null ? `mín: ${v.estoqueMinimo}` : ""}
                >
                  {v.tamanho}: <strong>{v.estoque}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        {podeConfig && (
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={onEditar}
              className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              ✏️ editar
            </button>
            <button
              type="button"
              onClick={onExcluir}
              className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline"
            >
              🗑️ excluir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
