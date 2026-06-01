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
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { fetchSolidesSchedules } from "../../core/excecoes/solidesScheduleClient";
import { onlyDigits } from "../../core/excecoes/dayMetrics";
import { todayYmd } from "../../core/utils/date";
import { empregadoBatePonto } from "../../core/types";
import { validateWorkScheduleDays } from "../../core/escala/horarios";
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
  sidSolides?: number; // employeeId na Sólides (pra sondagem do PUT)
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
  const { pessoa } = useAuth();
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [resultados, setResultados] = useState<ResultadoEmpregado[] | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  // Modal de "Copiar Sólides → Planejamento" — empregado escolhido pra
  // sobrescrever o quadro do Planejamento com o que veio da Sólides.
  const [copiarParaPlanejamento, setCopiarParaPlanejamento] = useState<ResultadoEmpregado | null>(null);

  // Sondagem PUT na API Sólides (master only). Estado do probe ativo.
  type ProbeResult = {
    ok: boolean;
    step: "get" | "put";
    getStatus: number;
    getBodyPreview: string;
    putStatus?: number;
    putBodyPreview?: string;
    putHeaders?: Record<string, string>;
    echoBytes?: number;
    diagnostic: string;
  };
  const [probandoSid, setProbandoSid] = useState<number | null>(null);
  const [probeAlvo, setProbeAlvo] = useState<{ empregado: Empregado; sid: number } | null>(null);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeErro, setProbeErro] = useState("");

  async function sondarPut(emp: Empregado, sid: number) {
    setProbandoSid(sid);
    setProbeAlvo({ empregado: emp, sid });
    setProbeResult(null);
    setProbeErro("");
    try {
      const shortCode = activeRestaurant?.shortCode || "";
      const params = new URLSearchParams({ restaurant: shortCode, employeeId: String(sid) });
      const resp = await fetch(`/api/solides-probe-schedule-write?${params.toString()}`, {
        method: "POST",
      });
      const text = await resp.text();
      let json: unknown = {};
      if (text) {
        try { json = JSON.parse(text); } catch { /* keep empty */ }
      }
      if (!resp.ok) {
        const msg = (json as { error?: string }).error || `HTTP ${resp.status}`;
        setProbeErro(msg);
      } else {
        setProbeResult(json as ProbeResult);
      }
    } catch (e) {
      setProbeErro(e instanceof Error ? e.message : String(e));
    } finally {
      setProbandoSid(null);
    }
  }

  function fecharProbe() {
    setProbeAlvo(null);
    setProbeResult(null);
    setProbeErro("");
  }

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
          out.push({ empregado: emp, status: "sem_quadro_sol", dias: [], totalDiffs: 0, sidSolides: sid });
          continue;
        }
        const solNorm: QuadroNorm = { byDay: solRaw.byDay as Record<number, DiaNorm> };
        if (!planNorm) {
          const dias: DiaComparacao[] = [];
          for (let d = 0; d < 7; d++) {
            dias.push({ dow: d, plan: null, sol: solNorm.byDay[d] ?? { active: false }, diff: [] });
          }
          out.push({ empregado: emp, status: "sem_quadro_plan", dias, totalDiffs: 0, alternating, sidSolides: sid });
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
          sidSolides: sid,
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

  // Limites de carga semanal do restaurante (default CLT padrão 43:55–44:00).
  const cargaMinMin = activeRestaurant?.horarioConfig?.cargaSemanalMinMin ?? 2635;
  const cargaMaxMin = activeRestaurant?.horarioConfig?.cargaSemanalMaxMin ?? 2640;

  // Aplica o quadro vindo da Sólides como NOVA versão do WorkSchedule do
  // empregado no Planejamento, com `validFrom` informado. O array é
  // versionado por data, então o quadro antigo continua válido até a
  // véspera da nova vigência.
  async function salvarSolidesNoPlanejamento(
    emp: Empregado,
    solByDay: Record<number, DiaNorm>,
    validFrom: string,
    motivo: string,
  ) {
    if (!pessoa?.id) {
      alert("Sem usuário logado.");
      return;
    }
    const days: { [key: number]: HorarioDia } = {};
    for (let d = 0; d < 7; d++) {
      const x = solByDay[d];
      if (!x || !x.active) {
        days[d] = { active: false };
      } else {
        days[d] = { active: true, in: x.in, out: x.out, break: x.break };
      }
    }
    // totalContract com limites REAIS do restaurante. Errors da CLT são
    // tratados na UI do modal (bloqueia "Confirmar" sem o opt-out).
    const { totalContract } = validateWorkScheduleDays(days, cargaMinMin, cargaMaxMin);

    const novo: WorkSchedule = {
      validFrom,
      type: "single",
      totalContract,
      days,
      registradoEm: new Date().toISOString(),
      registradoPor: pessoa.id,
      ...(motivo ? { motivo } : {}),
    };

    const arr = emp.workSchedules || [];
    // Se já existe uma entrada com o MESMO validFrom, sobrescreve em vez de
    // duplicar (evita histórico sujo com 2 quadros pra mesma data).
    const idxExistente = arr.findIndex((w) => w.validFrom === validFrom);
    const novoArr = idxExistente >= 0
      ? arr.map((w, i) => (i === idxExistente ? novo : w))
      : [...arr, novo].sort((a, b) => (a.validFrom || "").localeCompare(b.validFrom || ""));

    await updateDoc(doc(db, "empregados", emp.id), {
      workSchedules: novoArr,
    });
    // Atualiza state local pra refletir já sem precisar re-comparar
    setEmpregados((prev) => prev.map((e) => (e.id === emp.id ? { ...e, workSchedules: novoArr } : e)));
    setResultados((prev) => prev ? prev.map((r) => r.empregado.id === emp.id ? { ...r, status: "ok" as const, totalDiffs: 0 } : r) : null);
    setCopiarParaPlanejamento(null);
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
              onCopiarSolPraPlan={() => setCopiarParaPlanejamento(r)}
              isMaster={!!pessoa?.isMaster}
              probandoSid={probandoSid}
              onSondarPut={(emp, sid) => void sondarPut(emp, sid)}
            />
          ))}
        </div>
      )}

      {probeAlvo && (
        <ProbeResultadoModal
          empregado={probeAlvo.empregado}
          sid={probeAlvo.sid}
          rodando={probandoSid === probeAlvo.sid}
          erro={probeErro}
          resultado={probeResult}
          onClose={fecharProbe}
        />
      )}

      {copiarParaPlanejamento && (
        <CopiarSolidesParaPlanejamentoModal
          resultado={copiarParaPlanejamento}
          cargaMinMin={cargaMinMin}
          cargaMaxMin={cargaMaxMin}
          onClose={() => setCopiarParaPlanejamento(null)}
          onConfirm={(validFrom, motivo) => {
            const solByDay: Record<number, DiaNorm> = {};
            for (const d of copiarParaPlanejamento.dias) {
              solByDay[d.dow] = d.sol ?? { active: false };
            }
            return salvarSolidesNoPlanejamento(
              copiarParaPlanejamento.empregado,
              solByDay,
              validFrom,
              motivo,
            );
          }}
        />
      )}
    </div>
  );
}

function ResultadoCard({
  resultado, expandido, onToggle, onCopiarSolPraPlan,
  isMaster, probandoSid, onSondarPut,
}: {
  resultado: ResultadoEmpregado;
  expandido: boolean;
  onToggle: () => void;
  onCopiarSolPraPlan: () => void;
  isMaster: boolean;
  probandoSid: number | null;
  onSondarPut: (emp: Empregado, sid: number) => void;
}) {
  const { empregado, status, dias, totalDiffs, alternating, sidSolides } = resultado;
  // sem_quadro_plan também é expansível pra mostrar o que vem da Sólides
  // e oferecer o "Trazer cadastro da Sólides".
  const podeExpandir = status === "ok" || status === "diverge" || status === "sem_quadro_plan";
  // Permite copiar de Sólides → Planejamento quando:
  // - há divergência (diverge) OU
  // - Planejamento está sem quadro (sem_quadro_plan) E Sólides tem
  const podeCopiarSolPraPlan = status === "diverge" || status === "sem_quadro_plan";

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
        <>
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
          {status === "diverge" && (
            <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/20 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onCopiarSolPraPlan}
                disabled={!podeCopiarSolPraPlan}
                className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                title="Sobrescreve o quadro do Planejamento usando o que está cadastrado na Sólides (cria nova versão com a data de vigência que você escolher)."
              >
                ↓ Copiar Sólides → Planejamento
              </button>
              <button
                type="button"
                disabled
                className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                title="Em validação. Vai sobrescrever o quadro da Sólides com o do Planejamento, mas precisa confirmar primeiro se a API aceita escrita (POC com 1 empregado pendente)."
              >
                ↑ Copiar Planejamento → Sólides
              </button>
            </div>
          )}
          {status === "sem_quadro_plan" && (
            <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/20">
              <button
                type="button"
                onClick={onCopiarSolPraPlan}
                disabled={!podeCopiarSolPraPlan}
                className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                title="Cria o cadastro de horários no Planejamento usando o que está na Sólides."
              >
                ↓ Trazer cadastro da Sólides
              </button>
            </div>
          )}
          {/* Painel master: sondagem do PUT na API Sólides (Fase 0).
              Não modifica dados — reenvia o body do GET como PUT pra ver se
              o token aceita escrita. Master only. */}
          {isMaster && sidSolides != null && (
            <div className="px-4 py-2 border-t border-dashed border-amber-300/60 dark:border-amber-700/40 bg-amber-50/30 dark:bg-amber-900/10 text-[10px] text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
              <span>🔬 <strong>master:</strong> sondar se a API Sólides aceita PUT (não altera dados — usa payload idêntico do GET)</span>
              <button
                type="button"
                onClick={() => onSondarPut(empregado, sidSolides)}
                disabled={probandoSid === sidSolides}
                className="text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full bg-amber-600 hover:bg-amber-700 text-white shadow-sm disabled:opacity-50"
              >
                {probandoSid === sidSolides ? "⏳ sondando…" : "🧪 Sondar PUT"}
              </button>
            </div>
          )}
        </>
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

// ────────────────────────────────────────────────────────────────────────────
//  Modal: resultado da sondagem do PUT na API Sólides (Fase 0)
// ────────────────────────────────────────────────────────────────────────────

type ProbeAttempt = {
  label: string;
  url: string;
  method: string;
  status?: number;
  bodyPreview?: string;
  headers?: Record<string, string>;
};

type ProbeOut = {
  ok: boolean;
  step: "get" | "put";
  getStatus: number;
  getBodyPreview: string;
  putStatus?: number;
  putBodyPreview?: string;
  putHeaders?: Record<string, string>;
  echoBytes?: number;
  attempts?: ProbeAttempt[];
  diagnostic: string;
};

function ProbeResultadoModal({
  empregado, sid, rodando, erro, resultado, onClose,
}: {
  empregado: Empregado;
  sid: number;
  rodando: boolean;
  erro: string;
  resultado: ProbeOut | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            🔬 Sondagem PUT — Sólides API
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Empregado: <strong>{empregado.nome}</strong> · sid Sólides: <strong className="font-mono">{sid}</strong>
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
            ⚠ A sondagem faz GET pra capturar o quadro atual e PUT com payload idêntico. Não há alteração de dados, mas a Sólides PODE registrar a chamada em log interno.
          </p>
        </header>

        <div className="px-5 py-4 space-y-3">
          {rodando && (
            <div className="text-sm text-gray-600 dark:text-gray-400">⏳ Sondando endpoint…</div>
          )}

          {erro && (
            <div className="border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-900/20 rounded-lg p-3 text-xs">
              <div className="font-semibold text-rose-800 dark:text-rose-200 mb-1">Falha:</div>
              <pre className="whitespace-pre-wrap break-words text-rose-700 dark:text-rose-300">{erro}</pre>
            </div>
          )}

          {resultado && (
            <>
              <div className={`rounded-lg p-3 text-xs ${resultado.ok ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200" : "bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-200"}`}>
                <div className="font-semibold mb-1">Diagnóstico</div>
                <div>{resultado.diagnostic}</div>
              </div>

              <div className="text-xs space-y-1">
                <div>
                  <span className="text-gray-500">GET</span>{" "}
                  <span className={`font-mono font-semibold ${resultado.getStatus >= 200 && resultado.getStatus < 300 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>HTTP {resultado.getStatus}</span>
                  {typeof resultado.echoBytes === "number" && (
                    <span className="text-gray-500"> · payload reenviado: <strong>{resultado.echoBytes} bytes</strong></span>
                  )}
                </div>
                {(resultado.attempts || []).map((a, i) => (
                  <div key={i}>
                    <span className="text-gray-500">{a.method} {new URL(a.url).pathname}</span>{" "}
                    <span className={`font-mono font-semibold ${a.status != null && a.status >= 200 && a.status < 300 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>HTTP {a.status ?? "?"}</span>
                  </div>
                ))}
              </div>

              <details className="border border-gray-200 dark:border-gray-800 rounded-lg">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  📄 Body do GET (preview 500c)
                </summary>
                <pre className="px-3 py-2 text-[10px] font-mono text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap break-words border-t border-gray-200 dark:border-gray-800 max-h-60 overflow-y-auto">
                  {resultado.getBodyPreview || "(vazio)"}
                </pre>
              </details>

              {(resultado.attempts || []).map((a, i) => (
                <details key={i} className="border border-gray-200 dark:border-gray-800 rounded-lg" open={i === (resultado.attempts?.length ?? 1) - 1}>
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    📄 {a.method} {new URL(a.url).pathname} · HTTP {a.status ?? "?"}
                  </summary>
                  <pre className="px-3 py-2 text-[10px] font-mono text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap break-words border-t border-gray-200 dark:border-gray-800 max-h-60 overflow-y-auto">
                    {a.bodyPreview || "(vazio)"}
                  </pre>
                  {a.headers && Object.keys(a.headers).length > 0 && (
                    <div className="px-3 py-2 text-[10px] font-mono text-gray-600 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800/60 space-y-0.5">
                      <div className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Headers:</div>
                      {Object.entries(a.headers).map(([k, v]) => (
                        <div key={k}><span className="text-gray-400">{k}:</span> {v}</div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Modal: confirmação pra copiar quadro Sólides → Planejamento
// ────────────────────────────────────────────────────────────────────────────

function CopiarSolidesParaPlanejamentoModal({
  resultado,
  cargaMinMin,
  cargaMaxMin,
  onClose,
  onConfirm,
}: {
  resultado: ResultadoEmpregado;
  cargaMinMin: number;
  cargaMaxMin: number;
  onClose: () => void;
  onConfirm: (validFrom: string, motivo: string, ignorarClt: boolean) => Promise<void>;
}) {
  const { empregado, dias } = resultado;
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const defaultValidFrom = `${yyyy}-${mm}-01`;
  const [validFrom, setValidFrom] = useState(defaultValidFrom);
  const [motivo, setMotivo] = useState("Sincronizado pela Sólides via aba Compatibilidade.");
  const [salvando, setSalvando] = useState(false);
  const [ignorarClt, setIgnorarClt] = useState(false);

  // Roda a validação CLT no quadro que veio da Sólides. Resultado vira o
  // bloqueio do botão "Confirmar e salvar" — mesma régua do cadastro manual
  // de horários.
  const validacao = useMemo(() => {
    const days: { [key: number]: HorarioDia } = {};
    for (const d of dias) {
      const x = d.sol;
      if (!x || !x.active) {
        days[d.dow] = { active: false };
      } else {
        days[d.dow] = { active: true, in: x.in, out: x.out, break: x.break };
      }
    }
    return validateWorkScheduleDays(days, cargaMinMin, cargaMaxMin);
  }, [dias, cargaMinMin, cargaMaxMin]);

  const temErroClt = validacao.errors.length > 0;
  const podeConfirmar = !temErroClt || ignorarClt;

  async function confirmar() {
    if (!validFrom) {
      alert("Informe a data de vigência.");
      return;
    }
    if (temErroClt && !ignorarClt) {
      alert("O quadro vindo da Sólides tem violações de CLT. Corrija lá ou marque a opção pra salvar mesmo assim.");
      return;
    }
    setSalvando(true);
    try {
      await onConfirm(validFrom, motivo.trim(), ignorarClt);
    } catch (e) {
      alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  }

  function fmtHora(totalMin: number): string {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Copiar Sólides → Planejamento
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Cria uma nova versão do cadastro de horários de <strong>{empregado.nome}</strong> no
            Planejamento, com base no quadro vinculado na Sólides. As versões anteriores ficam
            preservadas no histórico.
          </p>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Quadro que vai ser gravado */}
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">
              Quadro que vai ser gravado (da Sólides)
            </div>
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Dia</th>
                    <th className="px-3 py-2 text-left">Horário</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700 dark:text-gray-300">
                  {dias.map((d) => (
                    <tr key={d.dow} className="border-t border-gray-100 dark:border-gray-800/60">
                      <td className="px-3 py-1.5 font-medium">{DOW_LABEL[d.dow]}</td>
                      <td className="px-3 py-1.5 tabular-nums">{renderDia(d.sol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Validação CLT */}
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">
              Conferência CLT
            </div>
            {temErroClt ? (
              <div className="border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-900/20 rounded-lg p-3 text-xs">
                <div className="font-semibold text-rose-800 dark:text-rose-200 mb-1.5">
                  ⚠ {validacao.errors.length} violação(ões) de CLT detectada(s)
                </div>
                <ul className="space-y-1 text-rose-700 dark:text-rose-300 list-disc list-inside">
                  {validacao.errors.map((iss, i) => (
                    <li key={i}>
                      <span className="font-semibold">{iss.artigo}:</span> {iss.mensagem}
                    </li>
                  ))}
                </ul>
                <label className="mt-2.5 flex items-start gap-2 text-rose-800 dark:text-rose-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignorarClt}
                    onChange={(e) => setIgnorarClt(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[11px]">
                    Salvar mesmo assim. O quadro está cadastrado assim na Sólides — em geral conserta-se lá antes, mas se você precisa replicar pra cá pode marcar isso.
                  </span>
                </label>
              </div>
            ) : (
              <div className="border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-200">
                ✓ Quadro está dentro da CLT. Carga contratual semanal: <strong>{fmtHora(validacao.totalContract)}</strong> · {validacao.diasAtivos} dia(s) ativo(s).
              </div>
            )}
          </div>

          {/* Data de vigência */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Vigência a partir de
            </label>
            <input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              O quadro novo passa a valer dessa data em diante. Cadastros anteriores continuam
              valendo pras datas antes dessa.
            </p>
          </div>

          {/* Motivo */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: Sincronizado pela Sólides"
              className="mt-1.5 w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="text-xs font-semibold px-3 py-1.5 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando || !podeConfirmar}
            className="text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title={!podeConfirmar ? "Marque \"Salvar mesmo assim\" pra prosseguir com violações de CLT" : undefined}
          >
            {salvando ? "Salvando…" : "Confirmar e salvar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
