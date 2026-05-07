import { useState } from "react";
import { Modal } from "./Modal";
import { Input } from "./Input";
import { Button } from "./Button";
import { todayYmd } from "../utils/date";

export type ChangedField = {
  campo: string;                  // ex: "pontos"
  label: string;                  // ex: "Pontos"
  valorAntes: string;             // formatado
  valorDepois: string;            // formatado
  rawValorAntes: unknown;
  rawValorDepois: unknown;
};

type Props = {
  titulo: string;                  // ex: "Confirmar mudança no cargo"
  changes: ChangedField[];
  impacto?: string;                // texto livre — ex: "Vai afetar gorjetas..."
  onConfirm: (vigencia: string, motivo: string) => Promise<void>;
  onClose: () => void;
};

export function VigenciaModal({ titulo, changes, impacto, onConfirm, onClose }: Props) {
  const [vigencia, setVigencia] = useState<string>(todayYmd());
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const today = todayYmd();
  const isFuture = vigencia > today;
  const isPast = vigencia < today;

  async function handleConfirm() {
    if (!vigencia) { setErr("Data obrigatória"); return; }
    setErr("");
    setSaving(true);
    try {
      await onConfirm(vigencia, motivo.trim());
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={titulo} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* Lista de mudanças */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            O que muda
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            {changes.map((c, i) => (
              <div
                key={c.campo}
                className={`grid grid-cols-[1fr_auto] gap-3 px-3 py-2 items-center text-sm ${
                  i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""
                }`}
              >
                <div className="font-medium text-gray-700 dark:text-gray-300">{c.label}</div>
                <div className="text-xs flex items-center gap-2">
                  <span className="text-gray-400 line-through">{c.valorAntes}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold">{c.valorDepois}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data de vigência */}
        <div>
          <Input
            label="A partir de quando essa mudança vale? *"
            type="date"
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value)}
          />
          <div className="text-[11px] mt-1 space-y-1">
            {isPast && (
              <div className="text-amber-700 dark:text-amber-400">
                ⚠ Vigência retroativa — pode afetar gorjetas/VT já fechados.
              </div>
            )}
            {isFuture && (
              <div className="text-blue-700 dark:text-blue-400">
                📅 Vigência futura — a mudança fica AGENDADA. O sistema aplica no dia {vigencia}.
              </div>
            )}
            {!isPast && !isFuture && (
              <div className="text-gray-500 dark:text-gray-400">
                Aplica imediatamente.
              </div>
            )}
          </div>
        </div>

        {/* Motivo */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo (opcional)</label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="ex: promoção, ajuste de cargo, reajuste de passagem"
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>

        {/* Aviso de impacto (opcional, vindo do caller) */}
        {impacto && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
            ⚠ {impacto}
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? "..." : isFuture ? "Agendar mudança" : "Confirmar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
