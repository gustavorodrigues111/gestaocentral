import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { calcHoras, fmtHoras } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  podeOperar: boolean;
};

type FiltroData = "todos" | "futuros" | "hoje" | "passado";

// Tab Lançamentos — exclusivamente OPERACIONAL.
// Cria turno e edita horário (entrada/saída/intervalo). Não vê nem mexe em
// valor / tipo / total — isso é responsabilidade do DP na aba Fechamento.
// Status pela data:
//   data > hoje  → agendado
//   data ≤ hoje  → aberto
export function LancamentoTab({
  restaurantId, shifts, empregados, pessoas, podeOperar,
}: Props) {
  const [filtro, setFiltro] = useState<FiltroData>("todos");
  const [showModal, setShowModal] = useState(false);

  const hoje = todayYmd();
  const abertos = useMemo(() => {
    const base = shifts.filter((s) =>
      s.status === "agendado" || s.status === "aberto"
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

  const porData = useMemo(() => {
    const m = new Map<string, FreelaShift[]>();
    for (const s of abertos) {
      const arr = m.get(s.date) || [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return Array.from(m.entries());
  }, [abertos]);

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
            {abertos.length} turno(s)
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
                  <ShiftCard key={s.id} shift={s} podeOperar={podeOperar} />
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

function ShiftCard({ shift, podeOperar }: { shift: FreelaShift; podeOperar: boolean }) {
  const { pessoa: me } = useAuth();
  const [entrada, setEntrada]     = useState(shift.entrada || "");
  const [saida, setSaida]         = useState(shift.saida || "");
  const [intervalo, setIntervalo] = useState<number>(shift.intervalo || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEntrada(shift.entrada || "");
    setSaida(shift.saida || "");
    setIntervalo(shift.intervalo || 0);
  }, [shift.id, shift.entrada, shift.saida, shift.intervalo]);

  const horas = calcHoras(entrada, saida, intervalo);

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
    if (!podeOperar) return;
    // Se editou horário em turno "agendado" passado → vira "aberto"
    const flip = (shift.status === "agendado" && entrada) ? { status: "aberto" as const } : {};
    await persistir({
      entrada: entrada || undefined,
      saida: saida || undefined,
      intervalo,
      horas,
      // recalcula total se já houver valor (preservar coerência caso DP já tenha precificado)
      ...(shift.valorUnit ? { totalCalc: shift.valorTipo === "diaria" ? shift.valorUnit : shift.valorUnit * horas } : {}),
      ...flip,
    });
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
    shift.status === "agendado"
      ? { label: "Agendado", c: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" }
      : { label: "Aberto",   c: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };

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
          </div>
          {(shift.area || shift.observacao) && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {shift.area && <span className="mr-2">{shift.area}</span>}
              {shift.observacao && <span className="italic">"{shift.observacao}"</span>}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {fmtHoras(horas)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="Entrada">
          <input
            type="time"
            value={entrada}
            disabled={!podeOperar || saving}
            onChange={(e) => setEntrada(e.target.value)}
            onBlur={onBlurHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
        </Field>
        <Field label="Saída">
          <input
            type="time"
            value={saida}
            disabled={!podeOperar || saving}
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
            disabled={!podeOperar || saving}
            onChange={(e) => setIntervalo(parseInt(e.target.value, 10) || 0)}
            onBlur={onBlurHoras}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 disabled:opacity-50"
            placeholder="0"
          />
        </Field>
      </div>

      {podeOperar && (
        <div className="flex flex-wrap gap-2 justify-end">
          <Button size="sm" variant="secondary" onClick={naoCompareceu} disabled={saving}>
            🚫 Não compareceu
          </Button>
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

function formatDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  const date = new Date(parseInt(a, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return date.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
}
