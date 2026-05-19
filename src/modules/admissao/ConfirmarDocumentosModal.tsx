// ════════════════════════════════════════════════════════════════════════════
//  Modal de confirmação de recebimento dos documentos. Checklist por item
//  (recebido / pendente) + observação opcional. Permite salvar com
//  pendências — fica registrado no doc da admissão pra revisar depois.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { CHECKLIST_DOCUMENTOS_DEFAULT } from "../../core/admissao/formTemplate";

export type ChecklistItem = {
  id: string;
  nome: string;
  recebido: boolean;
  observacao?: string;
};

type Props = {
  candidatoNome: string;
  // Itens prévios — quando reabrindo pra revisar pendências, vem o estado salvo
  itensIniciais?: ChecklistItem[];
  onClose: () => void;
  onConfirm: (itens: ChecklistItem[]) => Promise<void>;
};

export function ConfirmarDocumentosModal({
  candidatoNome,
  itensIniciais,
  onClose,
  onConfirm,
}: Props) {
  // Estado inicial: merge dos defaults com o que tiver salvo (preserva
  // observações e marcações anteriores).
  const [itens, setItens] = useState<ChecklistItem[]>(() => {
    const salvosById = new Map((itensIniciais || []).map((i) => [i.id, i]));
    return CHECKLIST_DOCUMENTOS_DEFAULT.map((d) => {
      const salvo = salvosById.get(d.id);
      return {
        id: d.id,
        nome: d.nome,
        recebido: salvo?.recebido || false,
        observacao: salvo?.observacao,
      };
    });
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function toggle(id: string) {
    setItens((cur) => cur.map((i) => (i.id === id ? { ...i, recebido: !i.recebido } : i)));
  }
  function setObs(id: string, observacao: string) {
    setItens((cur) => cur.map((i) => (i.id === id ? { ...i, observacao } : i)));
  }
  function marcarTodos(recebido: boolean) {
    setItens((cur) => cur.map((i) => ({ ...i, recebido })));
  }

  async function confirmar() {
    setErro("");
    setSalvando(true);
    try {
      await onConfirm(itens);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  const recebidos = itens.filter((i) => i.recebido).length;
  const pendentes = itens.length - recebidos;

  return (
    <Modal
      title={`Checklist de documentos — ${candidatoNome}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Marque cada documento que você recebeu via WhatsApp. Pode salvar com
          pendências — o que faltar fica registrado pra cobrar depois.
        </p>

        {/* Resumo + ações rápidas */}
        <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
          <div className="text-xs">
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              {recebidos} recebido(s)
            </span>
            {" · "}
            <span className={pendentes > 0 ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-gray-500"}>
              {pendentes} pendente(s)
            </span>
            {" / "}
            {itens.length} no total
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => marcarTodos(true)}
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              marcar todos
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={() => marcarTodos(false)}
              className="text-gray-600 dark:text-gray-400 hover:underline"
            >
              desmarcar todos
            </button>
          </div>
        </div>

        {/* Lista de itens */}
        <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {itens.map((i) => (
            <li
              key={i.id}
              className={`border rounded-lg p-2 transition-colors ${
                i.recebido
                  ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={i.recebido}
                  onChange={() => toggle(i.id)}
                  className="mt-1 accent-emerald-600"
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${i.recebido ? "text-emerald-900 dark:text-emerald-200 font-medium" : "text-gray-800 dark:text-gray-200"}`}>
                    {i.nome}
                  </div>
                  {!i.recebido && (
                    <input
                      type="text"
                      value={i.observacao || ""}
                      onChange={(e) => setObs(i.id, e.target.value)}
                      placeholder="Observação opcional (ex: 'foto cortou parte', 'pedi por outro canal')"
                      className="mt-1 w-full text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                      onClick={(e) => e.preventDefault()}
                    />
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando
              ? "Salvando…"
              : pendentes > 0
              ? `Salvar (${recebidos} recebidos, ${pendentes} pendentes)`
              : `✓ Todos os ${recebidos} docs recebidos`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
