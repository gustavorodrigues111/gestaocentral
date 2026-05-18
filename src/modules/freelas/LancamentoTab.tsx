import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { AgendarFreelaModal } from "./AgendarFreelaModal";
import { calcHoras, calcTotal, fmtBR, fmtHoras } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  podeEditar: boolean;
};

// Tab "Lançamento": gestor escolhe a data e lança/edita os turnos daquele dia.
// Card de cada turno tem edição inline (entrada/saida/intervalo/valor).
// Botões: "✅ Confirmar" (→ fechamento), "🚫 Não compareceu" (→ nao_compareceu).
// Agendado vira "aberto" automaticamente quando o dia chega — mas pra simplificar
// mostramos qualquer agendado da data selecionada como "aberto" pra edição.
export function LancamentoTab({ restaurantId, shifts, empregados, pessoas, podeEditar }: Props) {
  const [dia, setDia] = useState(todayYmd());
  const [showModal, setShowModal] = useState(false);

  const doDia = useMemo(
    () => shifts
      .filter((s) => s.date === dia && s.status !== "pago" && s.status !== "nao_compareceu")
      .sort((a, b) => a.nomeSnapshot.localeCompare(b.nomeSnapshot)),
    [shifts, dia],
  );

  const totalDia = doDia.reduce((acc, s) => acc + (s.totalCalc || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Data</label>
          <input
            type="date"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => setDia(todayYmd())}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Hoje
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {doDia.length} turno(s) · <strong>{fmtBR(totalDia)}</strong>
          </span>
          {podeEditar && (
            <Button size="sm" onClick={() => setShowModal(true)}>+ Lançar turno</Button>
          )}
        </div>
      </div>

      {doDia.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum turno de freela na data selecionada.
        </div>
      ) : (
        <div className="space-y-2">
          {doDia.map((s) => (
            <ShiftCard
              key={s.id}
              shift={s}
              podeEditar={podeEditar}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AgendarFreelaModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          initialDate={dia}
          modoLancamento
          onClose={() => setShowModal(false)}
          onSaved={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

type CardProps = {
  shift: FreelaShift;
  podeEditar: boolean;
};

function ShiftCard({ shift, podeEditar }: CardProps) {
  const { pessoa: me } = useAuth();
  // Estado local sincronizado com o snapshot Firestore (não rebobina valores
  // enquanto o user está digitando)
  const [entrada, setEntrada] = useState(shift.entrada || "");
  const [saida, setSaida] = useState(shift.saida || "");
  const [intervalo, setIntervalo] = useState<number>(shift.intervalo || 0);
  const [valorTipo, setValorTipo] = useState<"hora" | "diaria">(shift.valorTipo || "hora");
  const [valorUnit, setValorUnit] = useState<number>(shift.valorUnit || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEntrada(shift.entrada || "");
    setSaida(shift.saida || "");
    setIntervalo(shift.intervalo || 0);
    setValorTipo(shift.valorTipo || "hora");
    setValorUnit(shift.valorUnit || 0);
  }, [shift.id, shift.entrada, shift.saida, shift.intervalo, shift.valorTipo, shift.valorUnit]);

  const horas = calcHoras(entrada, saida, intervalo);
  const total = calcTotal(valorTipo, valorUnit, horas);

  const editavel = podeEditar && (shift.status === "agendado" || shift.status === "aberto" || shift.status === "fechamento");

  async function persistir(updates: Partial<FreelaShift>) {
    setSaving(true);
    try {
      const ref = doc(db, "freelaShifts", shift.id);
      await updateDoc(ref, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onBlurSalvarHoras() {
    if (!editavel) return;
    await persistir({
      entrada: entrada || undefined,
      saida: saida || undefined,
      intervalo,
      horas,
      totalCalc: total,
      // Se tava agendado e agora bateu hora/saída, sobe pra "aberto"
      ...(shift.status === "agendado" ? { status: "aberto" } : {}),
    });
  }

  async function onBlurSalvarValor() {
    if (!editavel) return;
    await persistir({
      valorTipo,
      valorUnit,
      horas,
      totalCalc: total,
      ...(shift.status === "agendado" ? { status: "aberto" } : {}),
    });
  }

  async function confirmar() {
    if (!me) return;
    if (!entrada || !saida || !valorUnit) {
      alert("Preencha entrada, saída e valor antes de confirmar.");
      return;
    }
    if (!confirm(`Confirmar turno de ${shift.nomeSnapshot}? Total: ${fmtBR(total)}.`)) return;
    await persistir({
      entrada, saida, intervalo, horas, valorTipo, valorUnit, totalCalc: total,
      status: "fechamento",
      confirmadoEm: new Date().toISOString(),
      confirmadoPor: me.id,
    });
  }

  async function reabrir() {
    if (shift.status !== "fechamento") return;
    if (!confirm("Reabrir o turno pra edição? Ele sai de Fechamento e volta pra Aberto.")) return;
    await persistir({ status: "aberto" });
  }

  async function naoCompareceu() {
    if (!me) return;
    if (!confirm(`Marcar ${shift.nomeSnapshot} como NÃO COMPARECEU? Esse turno não gera pagamento.`)) return;
    await persistir({
      status: "nao_compareceu",
      noShowEm: new Date().toISOString(),
      noShowPor: me.id,
    });
  }

  async function excluir() {
    if (!confirm(`Excluir turno de ${shift.nomeSnapshot} em ${shift.date}? Essa ação não pode ser desfeita.`)) return;
    await deleteDoc(doc(db, "freelaShifts", shift.id));
  }

  const statusBadge =
    shift.status === "agendado"   ? { label: "Agendado",   c: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" } :
    shift.status === "aberto"     ? { label: "Aberto",     c: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" } :
                                    { label: "Em fechamento", c: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-gray-800 dark:text-gray-100 truncate">
            {shift.nomeSnapshot}
            <span className={`ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${statusBadge.c}`}>
              {statusBadge.label}
            </span>
            {shift.empregadoId && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                Empregado
              </span>
            )}
          </div>
          {(shift.area || shift.observacao) && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {shift.area && <span className="mr-2">{shift.area}</span>}
              {shift.observacao && <span className="italic">"{shift.observacao}"</span>}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {fmtBR(total)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {fmtHoras(horas)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
        <Field label="Entrada">
          <input
            type="time"
            value={entrada}
            disabled={!editavel || saving}
            onChange={(e) => setEntrada(e.target.value)}
            onBlur={onBlurSalvarHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        </Field>
        <Field label="Saída">
          <input
            type="time"
            value={saida}
            disabled={!editavel || saving}
            onChange={(e) => setSaida(e.target.value)}
            onBlur={onBlurSalvarHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        </Field>
        <Field label="Intervalo (min)">
          <input
            type="number"
            min={0}
            value={intervalo || ""}
            disabled={!editavel || saving}
            onChange={(e) => setIntervalo(parseInt(e.target.value, 10) || 0)}
            onBlur={onBlurSalvarHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
            placeholder="0"
          />
        </Field>
        <Field label="Tipo valor">
          <select
            value={valorTipo}
            disabled={!editavel || saving}
            onChange={(e) => setValorTipo(e.target.value as "hora" | "diaria")}
            onBlur={onBlurSalvarValor}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          >
            <option value="hora">R$/hora</option>
            <option value="diaria">Diária</option>
          </select>
        </Field>
        <Field label="Valor (R$)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={valorUnit || ""}
            disabled={!editavel || saving}
            onChange={(e) => setValorUnit(parseFloat(e.target.value) || 0)}
            onBlur={onBlurSalvarValor}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
            placeholder="0,00"
          />
        </Field>
      </div>

      {podeEditar && (
        <div className="flex flex-wrap gap-2 justify-end">
          {shift.status !== "fechamento" && (
            <Button size="sm" variant="secondary" onClick={naoCompareceu} disabled={saving}>
              🚫 Não compareceu
            </Button>
          )}
          {shift.status === "fechamento" ? (
            <Button size="sm" variant="secondary" onClick={reabrir} disabled={saving}>
              ↩ Reabrir
            </Button>
          ) : (
            <Button size="sm" onClick={confirmar} disabled={saving}>
              ✅ Confirmar
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={excluir} disabled={saving}>
            🗑 Excluir
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}
