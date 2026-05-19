import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { FreelaConfig } from "../../core/types";
import { fmtBR } from "./helpers";

type Props = {
  restaurantId: string;
  config: FreelaConfig | null;
  onClose: () => void;
  onSaved: () => void;
};

// Modal de configuração dos 2 valores padrão por hora E por diária.
// Tudo opcional — se DP só usa Hora, deixa Diária em branco e vice-versa.
export function ValoresPadraoModal({ restaurantId, config, onClose, onSaved }: Props) {
  const { pessoa: me } = useAuth();
  const [baseHora, setBaseHora]     = useState<number>(config?.baseHora ?? 0);
  const [plenoHora, setPlenoHora]   = useState<number>(config?.plenoHora ?? 0);
  const [baseDiaria, setBaseDiaria] = useState<number>(config?.baseDiaria ?? 0);
  const [plenoDiaria, setPlenoDiaria] = useState<number>(config?.plenoDiaria ?? 0);
  const [threshold, setThreshold]   = useState<number>(config?.thresholdTurnos ?? 3);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    setErr("");
    if (!me) return;
    if (!baseHora && !plenoHora && !baseDiaria && !plenoDiaria) {
      setErr("Preencha pelo menos 1 valor padrão.");
      return;
    }
    if (threshold < 1) {
      setErr("Threshold de turnos precisa ser pelo menos 1.");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: FreelaConfig = {
        id: restaurantId,
        restaurantId,
        ...(baseHora    ? { baseHora }    : {}),
        ...(plenoHora   ? { plenoHora }   : {}),
        ...(baseDiaria  ? { baseDiaria }  : {}),
        ...(plenoDiaria ? { plenoDiaria } : {}),
        thresholdTurnos: threshold,
        updatedAt: now,
        updatedBy: me.id,
      };
      await setDoc(doc(db, "freelaConfig", restaurantId), payload);
      onSaved();
    } catch (e) {
      console.error(e);
      setErr("Erro ao salvar. Tente de novo.");
      setSaving(false);
    }
  }

  function PreviewLinha({ label, base, pleno, unidade }: { label: string; base: number; pleno: number; unidade: string }) {
    if (!base && !pleno) return null;
    return (
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-500 dark:text-gray-400 w-16">{label}:</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
          Base {fmtBR(base)}{unidade}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium">
          Pleno {fmtBR(pleno)}{unidade}
        </span>
      </div>
    );
  }

  return (
    <Modal title="⚙️ Valores padrão de freela" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Define os 2 valores que cobrem 90% dos turnos. Ficam disponíveis como
          chips na hora de precificar — o DP pode usar "Outro" pra valores fora do padrão.
        </p>

        <section>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Por hora
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Base R$/h"
              type="number" min={0} step="0.01"
              value={baseHora || ""}
              onChange={(e) => setBaseHora(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
            <Input
              label="Pleno R$/h"
              type="number" min={0} step="0.01"
              value={plenoHora || ""}
              onChange={(e) => setPlenoHora(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Diária
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Base R$/diária"
              type="number" min={0} step="0.01"
              value={baseDiaria || ""}
              onChange={(e) => setBaseDiaria(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
            <Input
              label="Pleno R$/diária"
              type="number" min={0} step="0.01"
              value={plenoDiaria || ""}
              onChange={(e) => setPlenoDiaria(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Política
          </h3>
          <div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
            Após
            <input
              type="number" min={1} max={20} step={1}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 1)}
              className="w-16 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 text-center"
            />
            turno(s) o freela passa do <strong>base</strong> pro <strong>pleno</strong>.
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
            Não há aplicação automática — o sistema só mostra a contagem como
            informação no card pra DP decidir caso a caso.
          </p>
        </section>

        {(baseHora || plenoHora || baseDiaria || plenoDiaria) && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
              Prévia dos chips
            </div>
            <PreviewLinha label="Hora"   base={baseHora}   pleno={plenoHora}   unidade="/h" />
            <PreviewLinha label="Diária" base={baseDiaria} pleno={plenoDiaria} unidade="" />
          </div>
        )}

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
