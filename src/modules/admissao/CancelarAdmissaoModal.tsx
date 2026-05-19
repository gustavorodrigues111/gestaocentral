// ════════════════════════════════════════════════════════════════════════════
//  Modal de cancelamento — RH escolhe motivos (multi-select cumulativo) +
//  texto livre opcional. Motivos viram badges no card no Kanban.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import {
  MOTIVO_CANCELAMENTO_LABEL,
  type MotivoCancelamento,
} from "../../core/types";

const MOTIVOS: MotivoCancelamento[] = [
  "cancelado_empresa",
  "expirado_sem_envio",
  "expirado_sem_resposta",
  "desistencia_candidato",
];

type Props = {
  candidatoNome: string;
  onClose: () => void;
  onConfirm: (motivos: MotivoCancelamento[], texto: string) => Promise<void>;
};

export function CancelarAdmissaoModal({ candidatoNome, onClose, onConfirm }: Props) {
  const [motivosSet, setMotivosSet] = useState<Set<MotivoCancelamento>>(new Set());
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function toggle(m: MotivoCancelamento) {
    setMotivosSet((cur) => {
      const next = new Set(cur);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  async function confirmar() {
    setErro("");
    if (motivosSet.size === 0) {
      setErro("Selecione pelo menos um motivo.");
      return;
    }
    setSalvando(true);
    try {
      await onConfirm(Array.from(motivosSet), texto.trim());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao cancelar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title={`Cancelar admissão de ${candidatoNome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Selecione os motivos (cumulativos) — aparecem como badges no card.
        </p>

        <div className="space-y-1.5">
          {MOTIVOS.map((m) => {
            const ativo = motivosSet.has(m);
            return (
              <label
                key={m}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  ativo
                    ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={() => toggle(m)}
                  className="accent-rose-600"
                />
                <span className="text-sm">{MOTIVO_CANCELAMENTO_LABEL[m]}</span>
              </label>
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Detalhe (opcional)
          </label>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Observação livre…"
            rows={2}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando ? "Cancelando…" : "Confirmar cancelamento"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
