// Modal — Cancelar entrega (empregado NÃO recebeu).
// Devolve 100% dos itens ao estoque. Motivo obrigatório.

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { EntregaUniforme, ItemUniforme, Pessoa } from "../../core/types";
import { cancelarEntrega } from "../../core/uniformes/uniformesHelpers";

type Props = {
  entrega: EntregaUniforme;
  itens: ItemUniforme[];
  pessoa: Pessoa;
  onClose: () => void;
};

export function CancelarEntregaModal({ entrega, itens, pessoa, onClose }: Props) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const totalQtd = entrega.itens.reduce((s, i) => s + i.qtd, 0);

  async function salvar() {
    setErro("");
    if (!motivo.trim()) { setErro("Motivo é obrigatório."); return; }
    setSalvando(true);
    try {
      await cancelarEntrega({
        entrega,
        motivo: motivo.trim(),
        pessoa,
        catalogo: itens,
      });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao cancelar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title="❌ Cancelar entrega" onClose={onClose} maxWidth="max-w-md">
      <div className="p-4 space-y-4">
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
          ⚠ Use cancelar quando a pessoa <strong>não chegou a receber</strong>.
          Todos os {totalQtd} item(ns) voltam ao estoque automaticamente.
          Pra registrar devolução parcial/total <em>após</em> recebimento,
          use "registrar devolução" (na entrega).
        </div>

        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
            Motivo do cancelamento *
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex: candidato desistiu antes da admissão, mudança de cargo, item errado, etc"
            rows={3}
            className="mt-1 w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-none"
          />
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Manter entrega</Button>
          <Button onClick={salvar} disabled={salvando || !motivo.trim()}>
            {salvando ? "Cancelando…" : "Confirmar cancelamento"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
