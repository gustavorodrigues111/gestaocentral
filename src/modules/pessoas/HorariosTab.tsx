import { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import { todayYmd } from "../../core/utils/date";
import {
  WEEKDAYS, calcDayHours, fmtHHMM, getActiveWorkSchedule,
  emptyDays, validateWorkScheduleDays,
} from "../../core/escala/horarios";
import type { Empregado, HorarioDia, WorkSchedule } from "../../core/types";

type Props = {
  empregado: Empregado;
  restaurantId: string;
  // Quando cargo do empregado é "registrado" ou "estagiario", validações são exigidas
  // (caso contrário, pode salvar mesmo com erros — útil pra freela informativo)
  exigeValidacao: boolean;
};

export function HorariosTab({ empregado, restaurantId, exigeValidacao }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === restaurantId);

  // Limites do restaurante (default 43:55–44:00)
  const cargaMinMin = restaurant?.horarioConfig?.cargaSemanalMinMin ?? 2635;
  const cargaMaxMin = restaurant?.horarioConfig?.cargaSemanalMaxMin ?? 2640;

  // Pega o horário vigente HOJE (último com validFrom <= hoje)
  const vigenteHoje = useMemo(
    () => getActiveWorkSchedule(empregado.workSchedules, todayYmd()),
    [empregado.workSchedules],
  );

  // State editável (espelha o vigente; user altera e salva como nova versão)
  const [days, setDays] = useState<{ [k: number]: HorarioDia }>(
    () => vigenteHoje?.days || emptyDays(),
  );
  const [validFrom, setValidFrom] = useState(todayYmd());
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [savedAt, setSavedAt] = useState("");

  // Re-sincroniza quando muda empregado
  useEffect(() => {
    setDays(vigenteHoje?.days || emptyDays());
  }, [vigenteHoje]);

  // Validação em tempo real
  const { errors, totalContract, diasAtivos } = useMemo(
    () => validateWorkScheduleDays(days, cargaMinMin, cargaMaxMin),
    [days, cargaMinMin, cargaMaxMin],
  );

  // Helpers de edição
  function patchDia(idx: number, patch: Partial<HorarioDia>) {
    setDays(d => ({ ...d, [idx]: { ...d[idx], ...patch } }));
  }
  function copiarDe(idxFonte: number, idxDestino: number) {
    setDays(d => ({ ...d, [idxDestino]: { ...d[idxFonte] } }));
  }
  function limparDia(idx: number) {
    setDays(d => ({ ...d, [idx]: { active: false } }));
  }

  async function salvar() {
    if (!me) return;
    if (exigeValidacao && errors.length > 0) {
      setErrMsg("Resolva os erros CLT antes de salvar.");
      return;
    }
    if (!validFrom) {
      setErrMsg("Data de vigência obrigatória");
      return;
    }
    setErrMsg("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const novaVersao: WorkSchedule = {
        validFrom,
        type: "single",
        totalContract,
        days,
        registradoEm: now,
        registradoPor: me.id,
        motivo: motivo.trim() || undefined,
      };
      // Mantém histórico: anexa nova versão (substitui se mesma data)
      const lista = [...(empregado.workSchedules || [])].filter(s => s.validFrom !== validFrom);
      lista.push(novaVersao);
      lista.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      await updateDoc(doc(db, "empregados", empregado.id), { workSchedules: lista });
      await logAudit({
        entityType: "empregado",
        entityId: empregado.id,
        restaurantId,
        acao: "alterado",
        diff: {
          workSchedules: { antes: empregado.workSchedules?.length || 0, depois: lista.length },
          validFrom: { antes: null, depois: validFrom },
        },
        motivo: motivo.trim() || undefined,
        registradoPor: me.id,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      setErrMsg(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Horário SINGLE (1 padrão semanal). Escala alternada A/B vem na próxima fase.
        Limite do restaurante: <strong>{fmtHHMM(cargaMinMin)} a {fmtHHMM(cargaMaxMin)}</strong> por semana.
      </div>

      {/* Tabela de dias */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <div className="grid grid-cols-[80px_60px_90px_90px_80px_80px_60px] gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          <div>Dia</div>
          <div className="text-center">Ativo</div>
          <div className="text-center">Entrada</div>
          <div className="text-center">Saída</div>
          <div className="text-right">Intervalo</div>
          <div className="text-right">Contratada</div>
          <div className="text-center">Copiar</div>
        </div>
        {WEEKDAYS.map(wd => {
          const d = days[wd.idx] || { active: false };
          const calc = d.active ? calcDayHours(d.in, d.out, d.break || 0) : null;
          return (
            <div
              key={wd.idx}
              className="grid grid-cols-[80px_60px_90px_90px_80px_80px_60px] gap-1 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm"
            >
              <div className="font-medium text-gray-700 dark:text-gray-300">{wd.short}</div>
              <div className="text-center">
                <input
                  type="checkbox"
                  checked={!!d.active}
                  onChange={(e) => patchDia(wd.idx, { active: e.target.checked })}
                />
              </div>
              <div>
                <input
                  type="time"
                  disabled={!d.active}
                  value={d.in || ""}
                  onChange={(e) => patchDia(wd.idx, { in: e.target.value })}
                  className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50"
                />
              </div>
              <div>
                <input
                  type="time"
                  disabled={!d.active}
                  value={d.out || ""}
                  onChange={(e) => patchDia(wd.idx, { out: e.target.value })}
                  className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50"
                />
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  max="240"
                  step="15"
                  disabled={!d.active}
                  value={d.break ?? ""}
                  onChange={(e) => patchDia(wd.idx, { break: parseInt(e.target.value, 10) || 0 })}
                  placeholder="min"
                  className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right disabled:opacity-50"
                />
              </div>
              <div className="text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                {calc ? fmtHHMM(calc.totalContract) : "—"}
              </div>
              <div className="text-center">
                {d.active ? (
                  <button
                    type="button"
                    onClick={() => limparDia(wd.idx)}
                    title="Limpar"
                    className="text-xs text-gray-400 hover:text-rose-600"
                  >
                    ✕
                  </button>
                ) : (
                  <CopiarDeMenu
                    daysAtivos={WEEKDAYS.filter(w => w.idx !== wd.idx && days[w.idx]?.active)}
                    onPick={(srcIdx) => copiarDe(srcIdx, wd.idx)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <ResumoCard label="Dias ativos" value={`${diasAtivos}`} />
        <ResumoCard label="Carga semanal" value={fmtHHMM(totalContract)} />
        <ResumoCard
          label="Status"
          value={errors.length === 0 ? "✓ OK" : `⚠ ${errors.length} erro(s)`}
          variant={errors.length === 0 ? "ok" : "warn"}
        />
      </div>

      {/* Erros CLT */}
      {errors.length > 0 && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
            ⚠ Violações CLT — bloqueia salvar
          </div>
          {errors.map((er, i) => (
            <div key={i} className="text-xs text-rose-800 dark:text-rose-300">
              • {er.mensagem} <span className="opacity-60">({er.artigo})</span>
            </div>
          ))}
        </div>
      )}

      {/* Vigência + motivo */}
      <div className="border-t border-gray-200 dark:border-gray-800 pt-3 grid grid-cols-2 gap-3">
        <Input
          label="Vigente a partir de *"
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
        <Input
          label="Motivo (opcional)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="ex: ajuste de horário"
        />
      </div>

      {errMsg && <div className="text-sm text-rose-600">{errMsg}</div>}

      <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
        <div className="text-xs text-emerald-600 dark:text-emerald-400">
          {savedAt && `✓ Salvo às ${savedAt}`}
        </div>
        <Button
          onClick={salvar}
          disabled={saving || (exigeValidacao && errors.length > 0)}
        >
          {saving ? "Salvando..." : "Salvar nova versão"}
        </Button>
      </div>

      {/* Histórico de versões */}
      {empregado.workSchedules && empregado.workSchedules.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            Histórico ({empregado.workSchedules.length} versão{empregado.workSchedules.length > 1 ? "ões" : ""})
          </div>
          <div className="space-y-1 text-xs">
            {[...empregado.workSchedules]
              .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
              .map((ws, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">
                  <span className="text-gray-700 dark:text-gray-300">
                    {i === 0 && <strong>Vigente · </strong>}
                    A partir de {ws.validFrom} · {fmtHHMM(ws.totalContract)} semanais
                    {ws.motivo && ` · "${ws.motivo}"`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoCard({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok" ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-2 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CopiarDeMenu({
  daysAtivos, onPick,
}: { daysAtivos: typeof WEEKDAYS; onPick: (idx: number) => void }) {
  const [open, setOpen] = useState(false);
  if (daysAtivos.length === 0) return <span className="text-xs text-gray-300">—</span>;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Copiar de outro dia"
        className="text-xs text-gray-400 hover:text-indigo-600"
      >
        📋
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
            {daysAtivos.map(d => (
              <button
                key={d.idx}
                type="button"
                onClick={() => { onPick(d.idx); setOpen(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
              >
                Copiar de {d.short}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
