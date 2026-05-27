// Modal — Registrar devolução de itens de uma entrega.
// Pra cada item entregue, define status: devolvido / descartado / levado_pelo_empregado.
// Itens "devolvidos" voltam ao estoque automaticamente.

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type {
  DevolucaoStatus, EntregaUniforme, ItemUniforme, Pessoa,
} from "../../core/types";
import { registrarDevolucao } from "../../core/uniformes/uniformesHelpers";

type Props = {
  entrega: EntregaUniforme;
  itens: ItemUniforme[];
  pessoa: Pessoa;
  onClose: () => void;
};

type LinhaDevolucao = {
  itemId: string;
  variacaoId?: string;
  nome: string;
  tamanho?: string;
  qtdEntregue: number;
  qtdDevolver: number;
  status: DevolucaoStatus;
};

const STATUS_LABEL: Record<DevolucaoStatus, string> = {
  devolvido:               "↶ Devolvido (volta pro estoque)",
  descartado:              "🗑️ Descartado (não volta)",
  levado_pelo_empregado:   "🏃 Levado pelo empregado (não volta)",
};

export function DevolucaoModal({ entrega, itens, pessoa, onClose }: Props) {
  const [linhas, setLinhas] = useState<LinhaDevolucao[]>(() =>
    entrega.itens.map(i => ({
      itemId: i.itemId,
      variacaoId: i.variacaoId,
      nome: i.nome,
      tamanho: i.tamanho,
      qtdEntregue: i.qtd,
      qtdDevolver: i.qtd,
      status: "devolvido" as DevolucaoStatus,
    })),
  );
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function atualizar(idx: number, patch: Partial<LinhaDevolucao>) {
    setLinhas(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  async function salvar() {
    setErro("");
    // Valida quantidades
    for (const l of linhas) {
      if (l.qtdDevolver < 0 || l.qtdDevolver > l.qtdEntregue) {
        setErro(`Quantidade inválida em ${l.nome}.`);
        return;
      }
    }
    setSalvando(true);
    try {
      await registrarDevolucao({
        entrega,
        itens: linhas.map(l => ({
          itemId: l.itemId,
          variacaoId: l.variacaoId,
          qtd: l.qtdDevolver,
          status: l.status,
        })),
        observacao: observacao.trim() || undefined,
        pessoa,
        catalogo: itens,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="Registrar devolução" onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-4 space-y-4">
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Pra cada item entregue, marque quantos voltaram e o destino. Itens
          marcados como "Devolvido" voltam pro estoque automaticamente.
        </div>

        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {linhas.map((l, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_70px_1fr] gap-2 items-center p-2 rounded border border-gray-200 dark:border-gray-800">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {l.nome} {l.tamanho && <span className="text-gray-500">· {l.tamanho}</span>}
                </div>
                <div className="text-[10px] text-gray-500">
                  entregue: <strong>{l.qtdEntregue}</strong>
                </div>
              </div>
              <input
                type="number"
                min="0"
                max={l.qtdEntregue}
                value={l.qtdDevolver}
                onChange={(e) => atualizar(idx, { qtdDevolver: parseInt(e.target.value, 10) || 0 })}
                className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums text-center"
                title="Quantidade devolvida"
              />
              <select
                value={l.status}
                onChange={(e) => atualizar(idx, { status: e.target.value as DevolucaoStatus })}
                className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                {(Object.entries(STATUS_LABEL) as [DevolucaoStatus, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
            Observação
          </label>
          <input
            type="text"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex: demissão, demitido, troca"
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Confirmar devolução"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
