import { useMemo, useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { HorarioModal } from "./HorarioModal";
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
// Mostra os 3 estados visuais distintos:
//   📅 AGENDADO (data futura, sem entrada)
//   🟡 ABERTO   (com entrada, sem saída — turno rolando)
//   ✅ FECHADO  (entrada+saída — aguarda DP precificar na aba Fechamento)
// Edição de horário só via modal (Iniciar / Fechar / Editar).
export function LancamentoTab({
  restaurantId, shifts, empregados, pessoas, podeOperar,
}: Props) {
  const [filtro, setFiltro] = useState<FiltroData>("todos");
  const [showNovo, setShowNovo] = useState(false);

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
            <Button size="sm" onClick={() => setShowNovo(true)}>+ Novo turno</Button>
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
        <div className="space-y-5">
          {porData.map(([date, list]) => (
            <div key={date}>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1">
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

      {showNovo && (
        <NovoTurnoModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={() => setShowNovo(false)}
          onSaved={() => setShowNovo(false)}
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

type EstadoCard = "agendado" | "aberto" | "fechado_ops";

function inferirEstado(s: FreelaShift): EstadoCard {
  if (s.status === "agendado") return "agendado";
  if (s.entrada && s.saida)    return "fechado_ops";
  return "aberto";
}

// ── Card único que se adapta ao estado ────────────────────────────────────
function ShiftCard({ shift, podeOperar }: { shift: FreelaShift; podeOperar: boolean }) {
  const { pessoa: me } = useAuth();
  const [horarioMode, setHorarioMode] = useState<"iniciar" | "fechar" | "editar" | "lancar" | null>(null);
  const [saving, setSaving] = useState(false);

  const estado = inferirEstado(shift);
  const horas = calcHoras(shift.entrada, shift.saida, shift.intervalo);

  async function naoCompareceu() {
    if (!me) return;
    if (!confirm(`Marcar ${shift.nomeSnapshot} como NÃO COMPARECEU?\nEsse turno não gera pagamento.`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "freelaShifts", shift.id), {
        status: "nao_compareceu",
        noShowEm: new Date().toISOString(),
        noShowPor: me.id,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!confirm(`Excluir turno de ${shift.nomeSnapshot} em ${shift.date}?\nEssa ação não pode ser desfeita.`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "freelaShifts", shift.id));
    } finally {
      setSaving(false);
    }
  }

  // Estilos por estado
  const estilo =
    estado === "agendado"     ? "border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-900/10" :
    estado === "aberto"       ? "border-amber-300 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/15" :
                                "border-emerald-300 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-900/15";

  const badge =
    estado === "agendado"   ? { txt: "📅 AGENDADO", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" } :
    estado === "aberto"     ? { txt: "🟡 ABERTO",   cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" } :
                              { txt: "✅ FECHADO",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };

  return (
    <>
      <div className={`rounded-xl border ${estilo} p-3`}>
        {/* Header — nome + badges */}
        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900 dark:text-gray-100">
              {shift.nomeSnapshot}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.cls}`}>
                {badge.txt}
              </span>
              {shift.empregadoId && (
                <span className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                  Empregado
                </span>
              )}
              {shift.area && (
                <span className="text-[11px] text-gray-600 dark:text-gray-400">· {shift.area}</span>
              )}
            </div>
          </div>
        </div>

        {/* Observação */}
        {shift.observacao && (
          <div className="text-[11px] text-gray-600 dark:text-gray-400 italic mb-2">
            "{shift.observacao}"
          </div>
        )}

        {/* Bloco principal — varia por estado */}
        {estado === "agendado" && (
          <div className="mb-3 text-sm text-gray-700 dark:text-gray-300">
            {shift.entrada ? (
              <>⏰ Hora prevista: <strong>{shift.entrada}</strong></>
            ) : (
              <span className="text-gray-500">Sem hora prevista. Marque ao iniciar.</span>
            )}
          </div>
        )}

        {estado === "aberto" && (
          <div className="mb-3 text-sm text-gray-800 dark:text-gray-100">
            ⏰ Iniciou às <strong className="text-base">{shift.entrada}</strong>
          </div>
        )}

        {estado === "fechado_ops" && (
          <div className="mb-3">
            <div className="text-sm text-gray-800 dark:text-gray-100">
              ⏰ <strong>{shift.entrada}</strong> → <strong>{shift.saida}</strong>
              {shift.intervalo ? <span className="text-gray-500"> (intervalo {shift.intervalo}min)</span> : null}
              {" "}= <strong className="text-emerald-700 dark:text-emerald-400">{fmtHoras(horas)}</strong>
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Aguardando DP precificar
            </div>
          </div>
        )}

        {/* CTA primário + ações secundárias */}
        {podeOperar && (
          <>
            {estado === "agendado" && (
              <Button onClick={() => setHorarioMode("lancar")} disabled={saving} className="w-full">
                🟢 Lançar turno
              </Button>
            )}
            {estado === "aberto" && (
              <Button onClick={() => setHorarioMode("fechar")} disabled={saving} className="w-full">
                🔴 Fechar turno
              </Button>
            )}

            <div className="flex flex-wrap gap-3 justify-end mt-2 text-[11px]">
              {estado === "fechado_ops" && (
                <button type="button" disabled={saving} onClick={() => setHorarioMode("editar")} className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                  ✏️ Editar horário
                </button>
              )}
              {estado !== "fechado_ops" && (
                <button type="button" disabled={saving} onClick={naoCompareceu} className="text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50">
                  🚫 Não compareceu
                </button>
              )}
              <button type="button" disabled={saving} onClick={excluir} className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
                🗑 Excluir
              </button>
            </div>
          </>
        )}
      </div>

      {horarioMode && (
        <HorarioModal
          shift={shift}
          mode={horarioMode}
          onClose={() => setHorarioMode(null)}
          onSaved={() => setHorarioMode(null)}
        />
      )}
    </>
  );
}

function formatDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  const date = new Date(parseInt(a, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return date.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
}
