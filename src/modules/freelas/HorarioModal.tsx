import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import type { FreelaIntervalo, FreelaShift } from "../../core/types";
import { calcHoras, calcTotal, fmtHoras, somaIntervalos } from "./helpers";
import { IntervalosEditor } from "./IntervalosEditor";

// Execução do turno por BOTÃO (conceito fixo, separado do planejamento):
//   abrir     → confirma a ENTRADA real (chegada). Vira aberto.
//   intervalo → registra/atualiza as PAUSAS sem fechar. Turno segue aberto.
//   fechar    → confirma SAÍDA real + INTERVALOS realizados. Vira realizado.
//   editar    → corrige um turno já realizado (entrada + saída + intervalos).
// Os campos previstos (entradaPrevista/saidaPrevista/intervalosPrevistos) só
// PRÉ-PREENCHEM os reais — nunca são gravados aqui.
type Mode = "abrir" | "fechar" | "editar" | "intervalo";

type Props = {
  shift: FreelaShift;
  mode: Mode;
  onClose: () => void;
  onSaved: () => void;
};

const TITULOS: Record<Mode, string> = {
  abrir:     "🟢 Abrir turno",
  fechar:    "🔴 Fechar turno",
  editar:    "✏️ Editar turno",
  intervalo: "⏸️ Registrar intervalo",
};
const BOTOES: Record<Mode, string> = {
  abrir:     "Abrir turno",
  fechar:    "Fechar turno",
  editar:    "Salvar",
  intervalo: "Salvar intervalo",
};

export function HorarioModal({ shift, mode, onClose, onSaved }: Props) {
  // Pré-preenche os reais a partir do que já existe e, na falta, do previsto.
  const [data, setData] = useState(shift.date || "");
  const [entrada, setEntrada] = useState(shift.entrada || shift.entradaPrevista || "");
  const [saida, setSaida] = useState(shift.saida || shift.saidaPrevista || "");
  const [intervalos, setIntervalos] = useState<FreelaIntervalo[]>(
    shift.intervalos && shift.intervalos.length > 0
      ? shift.intervalos
      : shift.intervalosPrevistos && shift.intervalosPrevistos.length > 0
        ? shift.intervalosPrevistos
        : shift.intervalo
          ? [{ min: shift.intervalo }]
          : [],
  );
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const intervaloTotal = somaIntervalos(intervalos);
  const horas = calcHoras(entrada, saida, intervaloTotal);
  const horarioValido = (h: string) => /^\d{2}:\d{2}$/.test(h);

  async function salvar() {
    setErr("");
    if (mode === "abrir") {
      if (!horarioValido(entrada)) { setErr("Confirme a hora de entrada — use HH:MM."); return; }
    } else if (mode === "fechar") {
      if (!horarioValido(saida)) { setErr("Confirme a hora de saída — use HH:MM."); return; }
    } else if (mode === "intervalo") {
      // Só registra a(s) pausa(s) — não exige saída. Turno segue aberto.
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { setErr("Informe o dia do turno."); return; }
      if (entrada && !horarioValido(entrada)) { setErr("Hora de entrada inválida."); return; }
      if (saida && !horarioValido(saida)) { setErr("Hora de saída inválida."); return; }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const total = calcTotal(shift.valorTipo, shift.valorUnit, horas);
      const updates: Record<string, unknown> = { updatedAt: now };

      if (mode === "abrir") {
        // Só registra a chegada e abre. Não toca saída/intervalos.
        updates.entrada = entrada;
        updates.status = "aberto";
      } else if (mode === "intervalo") {
        // Salva só as pausas — turno continua aberto, sem saída/horas.
        updates.intervalos = intervalos;
        updates.intervalo = intervaloTotal;
      } else {
        // fechar / editar: grava saída + intervalos reais + horas.
        if (mode === "editar" && data && data !== shift.date) updates.date = data;
        if (entrada) updates.entrada = entrada;
        updates.saida = saida;
        updates.intervalos = intervalos;
        updates.intervalo = intervaloTotal;
        updates.horas = horas;
        if (shift.valorUnit) updates.totalCalc = total;
      }

      await updateDoc(doc(db, "freelaShifts", shift.id), updates);
      onSaved();
    } catch (e) {
      console.error(e);
      setErr(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  return (
    <Modal title={`${TITULOS[mode]} — ${shift.nomeSnapshot}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        {/* Contexto */}
        {mode === "abrir" && shift.entradaPrevista && (
          <div className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-2">
            🕒 Chegada prevista no plano: <strong>{shift.entradaPrevista}</strong>. Confirme a hora real que a pessoa chegou.
          </div>
        )}
        {mode === "fechar" && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
            {shift.entrada && <>Turno aberto às <strong>{shift.entrada}</strong>. </>}
            Confirme a saída e os intervalos realizados pra fechar.
          </div>
        )}
        {mode === "intervalo" && (
          <div className="text-xs text-gray-700 dark:text-gray-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded p-2">
            ⏸️ Registre os intervalos agora. O turno continua <strong>aberto</strong> — você fecha depois com a hora de saída.
          </div>
        )}

        {/* Dia do turno — só na edição */}
        {mode === "editar" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Dia do turno *
            </label>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]"
            />
            {data !== shift.date && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Mudando de {shift.date.split("-").reverse().join("/")} para {data ? data.split("-").reverse().join("/") : "—"}.
              </span>
            )}
          </div>
        )}

        {/* Entrada — abrir e editar */}
        {(mode === "abrir" || mode === "editar") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Hora de entrada (chegada) *
            </label>
            <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
          </div>
        )}

        {/* Saída — fechar e editar */}
        {(mode === "fechar" || mode === "editar") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Hora de saída *
            </label>
            <TimeInput value={saida} onChange={setSaida} placeholder="HH:MM" />
          </div>
        )}

        {/* Intervalos realizados — fechar, editar e intervalo */}
        {(mode === "fechar" || mode === "editar" || mode === "intervalo") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Intervalos realizados — pode ter mais de um
            </label>
            <IntervalosEditor value={intervalos} onChange={setIntervalos} />
          </div>
        )}

        {/* Total calculado */}
        {(mode === "fechar" || mode === "editar") && horas > 0 && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400">
              Horas trabalhadas
            </div>
            <div className="text-lg font-bold text-emerald-900 dark:text-emerald-200">
              {fmtHoras(horas)}
            </div>
          </div>
        )}

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando…" : BOTOES[mode]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
