// Tab "📦 Estoque" — visão consolidada do estoque por variação + histórico.

import { useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import type { ItemUniforme, MovEstoqueUniforme, Pessoa } from "../../core/types";
import { ajustarEstoque } from "../../core/uniformes/uniformesHelpers";
import { IntervaloStepper } from "../freelas/IntervaloStepper";

type Props = {
  itens: ItemUniforme[];
  movs: MovEstoqueUniforme[];
  podeConfig: boolean;
  pessoa: Pessoa;
};

type Linha = {
  item: ItemUniforme;
  variacaoId: string;
  tamanho: string;
  estoque: number;
  estoqueMinimo?: number;
  baixo: boolean;
};

const MOTIVO_LABEL: Record<MovEstoqueUniforme["motivo"], string> = {
  compra:    "compra",
  entrega:   "entrega",
  troca:     "troca",
  devolucao: "devolução",
  ajuste:    "ajuste manual",
  descarte:  "descarte",
};

export function EstoqueTab({ itens, movs, podeConfig, pessoa }: Props) {
  const [busca, setBusca] = useState("");
  const [soBaixos, setSoBaixos] = useState(false);
  const [ajustando, setAjustando] = useState<Linha | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);

  const linhas: Linha[] = useMemo(() => {
    const r: Linha[] = [];
    for (const item of itens) {
      if (!item.ativo) continue;
      for (const v of item.variacoes) {
        const baixo = v.estoqueMinimo != null && v.estoque < v.estoqueMinimo;
        r.push({
          item,
          variacaoId: v.id,
          tamanho: v.tamanho,
          estoque: v.estoque,
          estoqueMinimo: v.estoqueMinimo,
          baixo,
        });
      }
    }
    let f = r;
    if (busca.trim()) {
      const q = busca.toLowerCase();
      f = f.filter(l => l.item.nome.toLowerCase().includes(q) || l.tamanho.toLowerCase().includes(q));
    }
    if (soBaixos) f = f.filter(l => l.baixo);
    return f.sort((a, b) => a.item.nome.localeCompare(b.item.nome, "pt-BR") || a.tamanho.localeCompare(b.tamanho));
  }, [itens, busca, soBaixos]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar…"
          className="flex-1 max-w-xs px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={soBaixos}
            onChange={(e) => setSoBaixos(e.target.checked)}
            className="w-4 h-4 accent-indigo-600"
          />
          só estoque baixo
        </label>
        <button
          type="button"
          onClick={() => setVerHistorico(v => !v)}
          className="ml-auto text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {verHistorico ? "× fechar histórico" : "📜 ver histórico de movimentações"}
        </button>
      </div>

      {/* Lista */}
      {linhas.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400 italic">
          Nenhuma variação cadastrada ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60">
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Tamanho</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Mín.</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={`${l.item.id}__${l.variacaoId}`} className={l.baixo ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}>
                  <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
                    <span className="mr-1">{l.item.tipo === "epi" ? "🛡️" : "🦺"}</span>
                    {l.item.nome}
                  </td>
                  <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                    {l.tamanho}
                  </td>
                  <td className={`px-3 py-2 border-t border-gray-100 dark:border-gray-800 text-right tabular-nums font-semibold ${l.baixo ? "text-amber-700 dark:text-amber-400" : ""}`}>
                    {l.estoque}
                  </td>
                  <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 text-right tabular-nums text-gray-500">
                    {l.estoqueMinimo ?? "—"}
                  </td>
                  <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 text-right">
                    {podeConfig && (
                      <button
                        type="button"
                        onClick={() => setAjustando(l)}
                        className="text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        ± ajustar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Histórico */}
      {verHistorico && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <h3 className="text-sm font-semibold mb-2">Histórico de movimentações</h3>
          {movs.length === 0 ? (
            <div className="text-xs text-gray-500 italic py-2">Nenhuma movimentação.</div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {[...movs].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 100).map(m => {
                const item = itens.find(i => i.id === m.itemId);
                const variacao = item?.variacoes.find(v => v.id === m.variacaoId);
                return (
                  <div key={m.id} className="text-xs flex items-baseline gap-2 py-1 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-gray-400 tabular-nums whitespace-nowrap">
                      {new Date(m.criadoEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="flex-1 truncate">
                      {item?.nome || m.itemId} ({variacao?.tamanho || m.variacaoId}) — {MOTIVO_LABEL[m.motivo]}
                      {m.observacao && <span className="text-gray-400 italic"> · "{m.observacao}"</span>}
                    </span>
                    <span className={`font-bold tabular-nums whitespace-nowrap ${m.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {m.delta > 0 ? "+" : ""}{m.delta}
                    </span>
                    <span className="text-gray-400 text-[10px] whitespace-nowrap">
                      {m.criadoPor.nome}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {ajustando && (
        <AjusteEstoqueModal
          linha={ajustando}
          pessoa={pessoa}
          onClose={() => setAjustando(null)}
        />
      )}
    </div>
  );
}

function AjusteEstoqueModal({
  linha, pessoa, onClose,
}: {
  linha: Linha;
  pessoa: Pessoa;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState(0);
  const [motivo, setMotivo] = useState<MovEstoqueUniforme["motivo"]>("ajuste");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Limite negativo: não pode baixar pra menos que o saldo atual
  const minDelta = -linha.estoque;

  async function salvar() {
    setErro("");
    if (delta === 0) { setErro("Use + ou − pra ajustar (não pode ficar em 0)."); return; }
    setSalvando(true);
    try {
      await ajustarEstoque({
        item: linha.item,
        variacaoId: linha.variacaoId,
        delta,
        motivo,
        observacao: observacao.trim() || undefined,
        pessoa,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao ajustar.");
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-md w-full p-4 space-y-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Ajuste de estoque</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {linha.item.nome} · tamanho {linha.tamanho} · saldo atual: <strong>{linha.estoque}</strong>
          </p>
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MovEstoqueUniforme["motivo"])}
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="compra">Compra (entrada)</option>
            <option value="ajuste">Ajuste manual (inventário)</option>
            <option value="descarte">Descarte (saída)</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider block text-center">
            Delta
          </label>
          <IntervaloStepper
            value={delta}
            onChange={setDelta}
            step={1}
            min={minDelta}
            max={9999}
            label="unidades"
            showSign
          />
          {delta !== 0 && (
            <p className="text-[10px] text-gray-500 mt-1 text-center">
              Saldo após: <strong>{linha.estoque + delta}</strong>
            </p>
          )}
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
            Observação (opcional)
          </label>
          <input
            type="text"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex: NF 12345, contagem física, item danificado"
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Aplicar ajuste"}
          </Button>
        </div>
      </div>
    </div>
  );
}
