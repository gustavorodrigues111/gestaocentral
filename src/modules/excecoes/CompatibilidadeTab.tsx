// ════════════════════════════════════════════════════════════════════════════
//  Aba "Compatibilidade de Cadastros" — compara, por empregado, o quadro de
//  horários cadastrado na Sólides (workSchedule do empregado lá) com o
//  cadastrado no Planejamento (`empregado.workSchedules` atual).
//
//  Saída: pra cada empregado que bate ponto, marca ✓ (idêntico), ⚠ (diverge)
//  ou — (cadastro incompleto em algum dos lados). Expansível mostra tabela
//  dia-a-dia com diff destacado.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { fetchSolidesSchedules } from "../../core/excecoes/solidesScheduleClient";
import { onlyDigits } from "../../core/excecoes/dayMetrics";
import { todayYmd } from "../../core/utils/date";
import { empregadoBatePonto } from "../../core/types";
import type { Cargo, Empregado, HorarioDia, WorkSchedule } from "../../core/types";

type Props = { rid: string };

// Formato normalizado dos dois lados — facilita a comparação.
type DiaNorm =
  | { active: true; in: string; out: string; break: number }
  | { active: false };

type QuadroNorm = {
  byDay: Record<number, DiaNorm>;
};

type DiaComparacao = {
  dow: number;
  plan: DiaNorm | null;
  sol: DiaNorm | null;
  diff: Array<"active" | "in" | "out" | "break">;
};

type ResultadoEmpregado = {
  empregado: Empregado;
  status: "ok" | "diverge" | "sem_cpf" | "sem_match" | "sem_quadro_sol" | "sem_quadro_plan";
  dias: DiaComparacao[];
  totalDiffs: number;
  alternating?: boolean;
};

const DOW_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Pega o WorkSchedule atual do empregado: último validFrom ≤ hoje (asc no array).
// Se for `alternating`, devolve a semana A como aproximação (não compara A vs B).
function quadroAtualDoEmpregado(emp: Empregado): { norm: QuadroNorm | null; alternating: boolean } {
  const arr = emp.workSchedules || [];
  if (arr.length === 0) return { norm: null, alternating: false };
  const hoje = todayYmd();
  const validos = arr
    .filter(w => (w.validFrom || "") <= hoje)
    .sort((a, b) => (a.validFrom || "").localeCompare(b.validFrom || ""));
  const ws: WorkSchedule | undefined = validos[validos.length - 1] || arr[arr.length - 1];
  if (!ws) return { norm: null, alternating: false };
  const alternating = ws.type === "alternating";
  const days = alternating ? ws.weeks?.A?.days : ws.days;
  if (!days) return { norm: null, alternating };
  const byDay: Record<number, DiaNorm> = {} as Record<number, DiaNorm>;
  for (let d = 0; d < 7; d++) {
    const h: HorarioDia | undefined = days[d];
    if (!h || !h.active) {
      byDay[d] = { active: false };
    } else {
      byDay[d] = {
        active: true,
        in: (h.in || "").slice(0, 5),
        out: (h.out || "").slice(0, 5),
        break: typeof h.break === "number" ? h.break : 0,
      };
    }
  }
  return { norm: { byDay }, alternating };
}

function comparaDia(plan: DiaNorm | null, sol: DiaNorm | null): DiaComparacao["diff"] {
  const diff: DiaComparacao["diff"] = [];
  if (!plan || !sol) return diff;
  if (plan.active !== sol.active) {
    diff.push("active");
    return diff;
  }
  if (plan.active && sol.active) {
    if (plan.in !== sol.in) diff.push("in");
    if (plan.out !== sol.out) diff.push("out");
    if (plan.break !== sol.break) diff.push("break");
  }
  return diff;
}

export function CompatibilidadeTab({ rid }: Props) {
  const { activeRestaurant } = useRestaurant();
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [resultados, setResultados] = useState<ResultadoEmpregado[] | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (snap) => setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)),
    );
    const u2 = onSnapshot(collection(db, "cargos"), (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => { u1(); u2(); };
  }, [rid]);

  const cargoById = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);

  async function comparar() {
    if (!rid) return;
    setLoading(true);
    setErro("");
    setResultados(null);
    try {
      const shortCode = activeRestaurant?.shortCode || "";
      const schedRes = await fetchSolidesSchedules([todayYmd()], shortCode);

      const sidByCpf = new Map<string, number>();
      for (const e of schedRes.employees) {
        if (e.cpf) sidByCpf.set(e.cpf, e.id);
      }

      const out: ResultadoEmpregado[] = [];
      for (const emp of empregados) {
        const cargo = cargoById.get(emp.cargoId);
        if (cargo && !empregadoBatePonto(emp, cargo)) continue;

        const cpf = onlyDigits(emp.cpf);
        const { norm: planNorm, alternating } = quadroAtualDoEmpregado(emp);

        if (!cpf) {
          out.push({ empregado: emp, status: "sem_cpf", dias: [], totalDiffs: 0 });
          continue;
        }
        const sid = sidByCpf.get(cpf);
        if (sid == null) {
          out.push({ empregado: emp, status: "sem_match", dias: [], totalDiffs: 0 });
          continue;
        }
        const solRaw = schedRes.schedules[String(sid)];
        if (!solRaw) {
          out.push({ empregado: emp, status: "sem_quadro_sol", dias: [], totalDiffs: 0 });
          continue;
        }
        const solNorm: QuadroNorm = { byDay: solRaw.byDay as Record<number, DiaNorm> };
        if (!planNorm) {
          out.push({ empregado: emp, status: "sem_quadro_plan", dias: [], totalDiffs: 0, alternating });
          continue;
        }

        const dias: DiaComparacao[] = [];
        let totalDiffs = 0;
        for (let d = 0; d < 7; d++) {
          const plan = planNorm.byDay[d] ?? { active: false };
          const sol = solNorm.byDay[d] ?? { active: false };
          const diff = comparaDia(plan, sol);
          dias.push({ dow: d, plan, sol, diff });
          totalDiffs += diff.length;
        }
        out.push({
          empregado: emp,
          status: totalDiffs === 0 ? "ok" : "diverge",
          dias,
          totalDiffs,
          alternating,
        });
      }
      const ord = (r: ResultadoEmpregado) =>
        r.status === "diverge" ? 0 :
        (r.status === "sem_cpf" || r.status === "sem_match" || r.status === "sem_quadro_sol" || r.status === "sem_quadro_plan") ? 1 :
        2;
      out.sort((a, b) => {
        const da = ord(a), db_ = ord(b);
        if (da !== db_) return da - db_;
        return a.empregado.nome.localeCompare(b.empregado.nome);
      });
      setResultados(out);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao comparar.");
    } finally {
      setLoading(false);
    }
  }

  function toggleExp(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const resumo = useMemo(() => {
    if (!resultados) return null;
    const r = { ok: 0, diverge: 0, semCadastro: 0, totalDiffs: 0 };
    for (const x of resultados) {
      if (x.status === "ok") r.ok += 1;
      else if (x.status === "diverge") { r.diverge += 1; r.totalDiffs += x.totalDiffs; }
      else r.semCadastro += 1;
    }
    return r;
  }, [resultados]);

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Compatibilidade de cadastros</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Compara o quadro de horários da Sólides com o cadastrado no Planejamento, por empregado.
            </p>
          </div>
          <button
            type="button"
            onClick={comparar}
            disabled={loading || empregados.length === 0}
            className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1.5 rounded-full transition-colors bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "⏳ comparando…" : "🔄 Comparar agora"}
          </button>
        </div>

        {erro && (
          <div className="mt-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg px-3 py-2">
            {erro}
          </div>
        )}

        {resumo && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">
              ✓ {resumo.ok} idêntico(s)
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.diverge > 0 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              ⚠ {resumo.diverge} divergente(s){resumo.diverge > 0 ? ` · ${resumo.totalDiffs} campo(s)` : ""}
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.semCadastro > 0 ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              — {resumo.semCadastro} sem cadastro completo
            </span>
          </div>
        )}
      </div>

      {resultados && resultados.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-center text-sm text-gray-500">
          Nenhum empregado que bate ponto neste restaurante.
        </div>
      )}

      {resultados && resultados.length > 0 && (
        <div className="space-y-2">
          {resultados.map((r) => (
            <ResultadoCard
              key={r.empregado.id}
              resultado={r}
              expandido={expandidos.has(r.empregado.id)}
              onToggle={() => toggleExp(r.empregado.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultadoCard({
  resultado, expandido, onToggle,
}: {
  resultado: ResultadoEmpregado;
  expandido: boolean;
  onToggle: () => void;
}) {
  const { empregado, status, dias, totalDiffs, alternating } = resultado;
  const podeExpandir = status === "ok" || status === "diverge";

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <header
        className={`px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap ${podeExpandir ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40" : ""}`}
        onClick={() => podeExpandir && onToggle()}
      >
        <div className="min-w-0 flex items-center gap-2">
          {podeExpandir && (
            <span className="text-gray-400">{expandido ? "▼" : "▶"}</span>
          )}
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{empregado.nome}</div>
            {empregado.cpf && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">CPF {empregado.cpf}</div>
            )}
          </div>
        </div>
        <div className="text-[11px] flex items-center gap-1.5 flex-wrap">
          {status === "ok" && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">✓ idêntico</span>
          )}
          {status === "diverge" && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-semibold">⚠ {totalDiffs} divergência(s)</span>
          )}
          {status === "sem_cpf" && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">— sem CPF no Planejamento</span>
          )}
          {status === "sem_match" && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">— CPF não casou na Sólides</span>
          )}
          {status === "sem_quadro_sol" && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">— sem quadro na Sólides</span>
          )}
          {status === "sem_quadro_plan" && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">— sem quadro no Planejamento</span>
          )}
          {alternating && (status === "ok" || status === "diverge") && (
            <span
              className="px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-semibold"
              title="Escala alternada A/B — comparou só a semana A. Diferenças entre A e B não aparecem aqui."
            >
              ↔ alternante
            </span>
          )}
        </div>
      </header>

      {expandido && podeExpandir && (
        <div className="border-t border-gray-200 dark:border-gray-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Dia</th>
                <th className="px-3 py-2 text-left font-semibold">Planejamento</th>
                <th className="px-3 py-2 text-left font-semibold">Sólides</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 dark:text-gray-300">
              {dias.map((d) => {
                const ok = d.diff.length === 0;
                return (
                  <tr key={d.dow} className={`border-t border-gray-100 dark:border-gray-800/60 ${ok ? "" : "bg-amber-50/40 dark:bg-amber-900/10"}`}>
                    <td className="px-3 py-2 font-medium">{DOW_LABEL[d.dow]}</td>
                    <td className="px-3 py-2 tabular-nums">{renderDia(d.plan)}</td>
                    <td className="px-3 py-2 tabular-nums">{renderDia(d.sol)}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {ok ? (
                        <span className="text-emerald-700 dark:text-emerald-400">✓</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-300">
                          {d.diff.map(c => labelCampo(c)).join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function renderDia(d: DiaNorm | null): ReactNode {
  if (!d) return <span className="text-gray-400">—</span>;
  if (!d.active) return <span className="text-gray-400 italic">folga</span>;
  return (
    <span>
      {d.in}–{d.out}
      {d.break > 0 && <span className="text-gray-500 ml-1">(int. {d.break}min)</span>}
    </span>
  );
}

function labelCampo(c: "active" | "in" | "out" | "break"): string {
  switch (c) {
    case "active": return "dia ativo";
    case "in": return "entrada";
    case "out": return "saída";
    case "break": return "intervalo";
  }
}
