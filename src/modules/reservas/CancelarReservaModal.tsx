// Modal de cancelamento de reserva — pergunta o MOTIVO (chips + detalhe livre)
// antes de cancelar. O motivo vira `reserva.motivoCancelamento`.
import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Reserva } from "../../core/types";

const MOTIVOS = [
  "Cliente desmarcou",
  "Cliente não confirmou",
  "Cliente não respondeu",
  "Sem mesa / lotado",
  "Cliente remarcou",
  "Outro",
];

export function CancelarReservaModal({ reserva, onClose, onConfirmar }: {
  reserva: Reserva;
  onClose: () => void;
  onConfirmar: (motivo: string) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState<string>("");
  const [detalhe, setDetalhe] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    if (!motivo) return;
    const texto = motivo === "Outro"
      ? (detalhe.trim() || "Outro")
      : (detalhe.trim() ? `${motivo} — ${detalhe.trim()}` : motivo);
    setSalvando(true);
    try { await onConfirmar(texto); } finally { setSalvando(false); }
  }

  return (
    <Modal title={`Cancelar reserva — ${reserva.clienteNomeSnapshot}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {new Date(reserva.data + "T12:00:00").toLocaleDateString("pt-BR")} · ⏰ {reserva.horario} · 👥 {reserva.pessoas}
        </p>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500">Motivo do cancelamento *</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" onClick={() => setMotivo(m)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  motivo === m
                    ? "bg-rose-600 border-rose-600 text-white"
                    : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-rose-400"
                }`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500">
            {motivo === "Outro" ? "Qual o motivo? *" : "Detalhe (opcional)"}
          </label>
          <textarea value={detalhe} onChange={(e) => setDetalhe(e.target.value)} rows={2}
            placeholder={motivo === "Outro" ? "Descreve o motivo…" : "Ex.: avisou por telefone, remarcou pra sábado…"}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Voltar</Button>
          <Button
            onClick={() => void confirmar()}
            disabled={salvando || !motivo || (motivo === "Outro" && !detalhe.trim())}
            className="!bg-rose-600 hover:!bg-rose-700"
          >
            {salvando ? "Cancelando…" : "✕ Cancelar reserva"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
