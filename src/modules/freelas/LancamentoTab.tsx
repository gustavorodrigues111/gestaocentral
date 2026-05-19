import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { calcHoras, calcTotal, fmtBR, fmtHoras } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  // Operacional: pode criar turno, editar entrada/saída/intervalo, marcar no-show
  podeOperar: boolean;
  // DP: tudo do operacional + valor (tipo/unit) + confirmar fechamento
  podeDp: boolean;
};

type FiltroData = "todos" | "futuros" | "hoje" | "passado";

// Tab única: "Lançamentos". Lista agendados + abertos + em fechamento.
// Lançamento e agendamento são o mesmo ato — a data define o status:
//   data > hoje  → agendado
//   data ≤ hoje  → aberto
// Quem cria/edita HORÁRIO: operacional (canVer).
// Quem precifica + confirma: DP (canConfigurar).
export function LancamentoTab({
  restaurantId, shifts, empregados, pessoas, podeOperar, podeDp,
}: Props) {
  const [filtro, setFiltro] = useState<FiltroData>("todos");
  const [showModal, setShowModal] = useState(false);

  const hoje = todayYmd();
  const abertos = useMemo(() => {
    const base = shifts.filter((s) =>
      s.status === "agendado" || s.status === "aberto" || s.status === "fechamento"
    );
    const filtrado = base.filter((s) => {
      if (filtro === "todos")    return true;
      if (filtro === "futuros")  return s.date > hoje;
      if (filtro === "hoje")     return s.date === hoje;
      if (filtro === "passado")  return s.date < hoje;
      return true;
    });
    return filtrado.sort(
      (a, b) => a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot),
    );
  }, [shifts, filtro, hoje]);

  // Agrupa por data
  const porData = useMemo(() => {
    const m = new Map<string, FreelaShift[]>();
    for (const s of abertos) {
      const arr = m.get(s.date) || [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return Array.from(m.entries());
  }, [abertos]);

  const totalAberto = abertos.reduce((acc, s) => acc + (s.totalCalc || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FiltroBtn ativo={filtro === "todos"}   onClick={() => setFiltro("todos")}>Todos</FiltroBtn>
          <FiltroBtn ativo={filtro === "futuros"} onClick={() => setFiltro("futuros")}>📅 Agendados</FiltroBtn>
          <FiltroBtn ativo={filtro === "hoje"}    onClick={() => setFiltro("hoje")}>Hoje</FiltroBtn>
          <FiltroBtn ativo={filtro === "passado"} onClick={() => setFiltro("passado")}>Passado</FiltroBtn>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {abertos.length} turno(s){podeDp && (
              <> · <strong>{fmtBR(totalAberto)}</strong></>
            )}
          </span>
          {podeOperar && (
            <Button size="sm" onClick={() => setShowModal(true)}>+ Novo turno</Button>
          )}
        </div>
      </div>

      {porData.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum turno {filtro !== "todos" ? "nesse filtro" : "em aberto"}.
          {podeOperar && (
            <> Clique em <strong>+ Novo turno</strong> pra criar.</>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {porData.map(([date, list]) => (
            <div key={date}>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5 px-1">
                {formatDataBR(date)}
                {date === hoje && (
                  <span className="ml-2 text-indigo-600 dark:text-indigo-400">· hoje</span>
                )}
                {date > hoje && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">· futuro</span>
                )}
              </div>
              <div className="space-y-2">
                {list.map((s) => (
                  <ShiftCard
                    key={s.id}
                    shift={s}
                    podeOperar={podeOperar}
                    podeDp={podeDp}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <NovoTurnoModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={() => setShowModal(false)}
          onSaved={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function FiltroBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
        ativo
          ? "bg-indigo-600 text-white"
          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

type CardProps = {
  shift: FreelaShift;
  podeOperar: boolean;
  podeDp: boolean;
};

function ShiftCard({ shift, podeOperar, podeDp }: CardProps) {
  const { pessoa: me } = useAuth();
  const [entrada, setEntrada]     = useState(shift.entrada || "");
  const [saida, setSaida]         = useState(shift.saida || "");
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

  // "fechamento" = trava entrada/saída pra todos (só DP pode reabrir).
  // "agendado"/"aberto" = operacional edita entrada/saída/intervalo livremente.
  const editavelOps = podeOperar && shift.status !== "fechamento";
  const editavelDp  = podeDp && shift.status !== "fechamento";

  async function persistir(updates: Partial<FreelaShift>) {
    setSaving(true);
    try {
      await updateDoc(doc(db, "freelaShifts", shift.id), {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onBlurHoras() {
    if (!editavelOps) return;
    // Se editou horário em turno "agendado" passado → vira "aberto"
    const novoStatus = (shift.status === "agendado" && entrada) ? { status: "aberto" as const } : {};
    await persistir({
      entrada: entrada || undefined,
      saida: saida || undefined,
      intervalo,
      horas,
      totalCalc: total,
      ...novoStatus,
    });
  }

  async function onBlurValor() {
    if (!editavelDp) return;
    await persistir({
      valorTipo,
      valorUnit,
      horas,
      totalCalc: total,
    });
  }

  async function confirmar() {
    if (!me) return;
    if (!podeDp) {
      alert("Só o DP pode confirmar o fechamento — falta precificar.");
      return;
    }
    if (!entrada || !saida) {
      alert("Preencha entrada e saída antes de confirmar.");
      return;
    }
    if (!valorUnit) {
      alert("Preencha o valor (R$/h ou diária) antes de confirmar.");
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
    if (!podeDp) {
      alert("Só o DP pode reabrir um turno em fechamento.");
      return;
    }
    if (!confirm("Reabrir o turno pra edição? Volta pra Aberto.")) return;
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

  const semPrecificar = !valorUnit && shift.status !== "agendado" && (entrada || saida);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="min-w-0 flex-1">
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
            {semPrecificar && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded">
                Sem precificar
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
          {podeDp && (
            <div className="text-sm font-bold text-gray-800 dark:text-gray-100">
              {fmtBR(total)}
            </div>
          )}
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {fmtHoras(horas)}
          </div>
        </div>
      </div>

      {/* Bloco OPERACIONAL — entrada/saída/intervalo */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Field label="Entrada">
          <input
            type="time"
            value={entrada}
            disabled={!editavelOps || saving}
            onChange={(e) => setEntrada(e.target.value)}
            onBlur={onBlurHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        </Field>
        <Field label="Saída">
          <input
            type="time"
            value={saida}
            disabled={!editavelOps || saving}
            onChange={(e) => setSaida(e.target.value)}
            onBlur={onBlurHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        </Field>
        <Field label="Intervalo (min)">
          <input
            type="number"
            min={0}
            value={intervalo || ""}
            disabled={!editavelOps || saving}
            onChange={(e) => setIntervalo(parseInt(e.target.value, 10) || 0)}
            onBlur={onBlurHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
            placeholder="0"
          />
        </Field>
      </div>

      {/* Bloco DP — tipo + valor. Só DP vê e edita. */}
      {podeDp && (
        <div className="grid grid-cols-2 gap-2 mb-3 pt-2 border-t border-dashed border-gray-200 dark:border-gray-800">
          <Field label="Tipo (DP)">
            <select
              value={valorTipo}
              disabled={!editavelDp || saving}
              onChange={(e) => setValorTipo(e.target.value as "hora" | "diaria")}
              onBlur={onBlurValor}
              className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
            >
              <option value="hora">R$/hora</option>
              <option value="diaria">Diária</option>
            </select>
          </Field>
          <Field label="Valor (DP)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={valorUnit || ""}
              disabled={!editavelDp || saving}
              onChange={(e) => setValorUnit(parseFloat(e.target.value) || 0)}
              onBlur={onBlurValor}
              className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
              placeholder="0,00"
            />
          </Field>
        </div>
      )}

      {/* Botões */}
      <div className="flex flex-wrap gap-2 justify-end">
        {podeOperar && shift.status !== "fechamento" && (
          <Button size="sm" variant="secondary" onClick={naoCompareceu} disabled={saving}>
            🚫 Não compareceu
          </Button>
        )}
        {shift.status === "fechamento" && podeDp && (
          <Button size="sm" variant="secondary" onClick={reabrir} disabled={saving}>
            ↩ Reabrir
          </Button>
        )}
        {shift.status !== "fechamento" && podeDp && (
          <Button size="sm" onClick={confirmar} disabled={saving}>
            ✅ Confirmar
          </Button>
        )}
        {podeOperar && (
          <Button size="sm" variant="danger" onClick={excluir} disabled={saving}>
            🗑 Excluir
          </Button>
        )}
      </div>
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

function formatDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  const date = new Date(parseInt(a, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return date.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
}
