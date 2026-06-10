import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import type { FreelaIntervalo, FreelaShift } from "../../core/types";
import { calcHoras, calcTotal, fmtHoras, somaIntervalos } from "./helpers";
import { IntervalosEditor } from "./IntervalosEditor";

type Mode = "iniciar" | "fechar" | "editar" | "lancar" | "intervalo";

type Props = {
  shift: FreelaShift;
  mode: Mode;
  onClose: () => void;
  onSaved: () => void;
};

const TITULOS: Record<Mode, string> = {
  iniciar:   "🟢 Iniciar turno",
  fechar:    "🔴 Fechar turno",
  editar:    "✏️ Editar horário",
  lancar:    "🟢 Lançar turno",
  intervalo: "⏸️ Intervalos do turno",
};

const BOTOES: Record<Mode, string> = {
  iniciar:   "Iniciar",
  fechar:    "Fechar turno",
  editar:    "Salvar",
  lancar:    "Lançar",
  intervalo: "Salvar intervalos",
};

// Modal único de horário. Modos:
//   iniciar  → 1 campo  (Entrada). Pra marcar o início agora.
//   fechar   → 2 campos (Saída + Intervalo); Entrada fixa em display.
//   editar   → 3 campos (correções num turno já fechado).
//   lancar   → 3 campos (turno agendado: lança entrada [→ ABERTO] ou
//              entrada+saída [→ FECHADO] num passo só).
export function HorarioModal({ shift, mode, onClose, onSaved }: Props) {
  const [entrada, setEntrada]     = useState(shift.entrada || "");
  const [saida, setSaida]         = useState(shift.saida || "");
  const [intervalos, setIntervalos] = useState<FreelaIntervalo[]>(
    shift.intervalos && shift.intervalos.length > 0
      ? shift.intervalos
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
    // Validações por modo
    if (mode === "iniciar") {
      if (!horarioValido(entrada)) { setErr("Hora de início inválida — use HH:MM."); return; }
    } else if (mode === "fechar") {
      if (!horarioValido(saida)) { setErr("Hora de saída inválida — use HH:MM."); return; }
    } else if (mode === "lancar") {
      if (!horarioValido(entrada)) { setErr("Hora de início é obrigatória — use HH:MM."); return; }
      if (saida && !horarioValido(saida)) { setErr("Hora de saída inválida."); return; }
    } else {
      if (entrada && !horarioValido(entrada)) { setErr("Hora de início inválida."); return; }
      if (saida && !horarioValido(saida))     { setErr("Hora de saída inválida."); return; }
    }

    setSaving(true);
    try {
      const total = calcTotal(shift.valorTipo, shift.valorUnit, horas);
      // Firestore não aceita `undefined` em valores — omite campos vazios.
      // Pra LIMPAR campos no doc (ex: ao reabrir um fechamento), use deleteField.
      const updates: Record<string, unknown> = {
        intervalo: intervaloTotal,
        intervalos,
        horas,
        updatedAt: new Date().toISOString(),
      };
      // No modo "intervalo" não tocamos nos horários nem no status — é só
      // edição da lista de intervalos (turno segue agendado/aberto como estava).
      if (mode !== "intervalo") {
        if (entrada) updates.entrada = entrada;
        if (saida) updates.saida = saida;
        // Flip de status agendado → aberto quando registra entrada
        if (shift.status === "agendado" && entrada) {
          updates.status = "aberto";
        }
      }
      if (shift.valorUnit) updates.totalCalc = total;
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
        {mode === "fechar" && shift.entrada && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
            Turno iniciou às <strong>{shift.entrada}</strong>.
          </div>
        )}

        {mode === "lancar" && (
          <div className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-2">
            💡 Preencha <strong>só a entrada</strong> se está abrindo o turno
            agora.<br />
            Preencha <strong>entrada + saída</strong> se o turno já aconteceu
            (vai direto pra fechado).
          </div>
        )}

        {mode === "intervalo" && (
          <div className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-2">
            ⏸️ Lance os intervalos do turno mesmo antes de fechar.
            {shift.entrada && <> Turno iniciou às <strong>{shift.entrada}</strong>.</>}
            {!shift.saida && <> As horas são recalculadas quando você fechar o turno.</>}
          </div>
        )}

        {/* Entrada */}
        {(mode === "iniciar" || mode === "editar" || mode === "lancar") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Hora de início *
            </label>
            <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
          </div>
        )}

        {/* Saída */}
        {(mode === "fechar" || mode === "editar" || mode === "lancar") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Hora de saída {mode === "fechar" ? "*" : "(opcional)"}
            </label>
            <TimeInput value={saida} onChange={setSaida} placeholder="HH:MM" />
          </div>
        )}

        {/* Intervalo(s) */}
        {(mode === "fechar" || mode === "editar" || mode === "lancar" || mode === "intervalo") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Intervalo (refeição, pausa) — pode ter mais de um
            </label>
            <IntervalosEditor value={intervalos} onChange={setIntervalos} />
          </div>
        )}

        {/* Total calculado — quando tem entrada+saída */}
        {(mode === "fechar" || mode === "editar" || mode === "lancar" || mode === "intervalo") && horas > 0 && (
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
