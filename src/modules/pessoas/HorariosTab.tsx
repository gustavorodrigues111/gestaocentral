import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import {
  WEEKDAYS, calcDayHours, fmtHHMM, getActiveWorkSchedule,
  emptyDays, validateWorkScheduleDays, isSunday,
} from "../../core/escala/horarios";
import type {
  Empregado, HorarioDia, SundayCycle, WorkSchedule,
} from "../../core/types";
import type { ValidacaoIssue, ValidacaoResultado } from "../../core/escala/horarios";

type Props = {
  empregado: Empregado;
  restaurantId: string;
  exigeValidacao: boolean;
};

type Versao = "single" | "alternating";

export function HorariosTab({ empregado, restaurantId, exigeValidacao }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find(r => r.id === restaurantId);

  const cargaMinMin = restaurant?.horarioConfig?.cargaSemanalMinMin ?? 2635;
  const cargaMaxMin = restaurant?.horarioConfig?.cargaSemanalMaxMin ?? 2640;

  const vigenteHoje = useMemo(
    () => getActiveWorkSchedule(empregado.workSchedules, todayYmd()),
    [empregado.workSchedules],
  );

  // ── State ──
  const [tipo, setTipo] = useState<Versao>(vigenteHoje?.type === "alternating" ? "alternating" : "single");
  // Single: 1 conjunto de days + 1 cycle
  const [daysSingle, setDaysSingle] = useState<{ [k: number]: HorarioDia }>(
    () => (vigenteHoje?.type !== "alternating" && vigenteHoje?.days) || emptyDays(),
  );
  const [cicloSingle, setCicloSingle] = useState<SundayCycle | null>(
    vigenteHoje?.type !== "alternating" ? (vigenteHoje?.sundayCycle ?? null) : null,
  );
  // Alternating: A e B + anchor
  const [daysA, setDaysA] = useState<{ [k: number]: HorarioDia }>(
    () => (vigenteHoje?.type === "alternating" && vigenteHoje?.weeks?.A?.days) || emptyDays(),
  );
  const [daysB, setDaysB] = useState<{ [k: number]: HorarioDia }>(
    () => (vigenteHoje?.type === "alternating" && vigenteHoje?.weeks?.B?.days) || emptyDays(),
  );
  const [cicloA, setCicloA] = useState<SundayCycle | null>(
    (vigenteHoje?.type === "alternating" ? vigenteHoje?.weeks?.A?.sundayCycle : null) ?? null,
  );
  const [cicloB, setCicloB] = useState<SundayCycle | null>(
    (vigenteHoje?.type === "alternating" ? vigenteHoje?.weeks?.B?.sundayCycle : null) ?? null,
  );
  const [anchor, setAnchor] = useState<{ date: string; week: "A" | "B" }>(
    vigenteHoje?.anchor || { date: todayYmd(), week: "A" },
  );
  const [editWeek, setEditWeek] = useState<"A" | "B">("A");

  const [validFrom, setValidFrom] = useState(todayYmd());
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showImportar, setShowImportar] = useState(false);

  // Re-sincroniza quando muda empregado
  useEffect(() => {
    if (!vigenteHoje) {
      setTipo("single");
      setDaysSingle(emptyDays());
      setDaysA(emptyDays());
      setDaysB(emptyDays());
      setCicloSingle(null);
      setCicloA(null);
      setCicloB(null);
      return;
    }
    if (vigenteHoje.type === "alternating") {
      setTipo("alternating");
      setDaysA(vigenteHoje.weeks?.A?.days || emptyDays());
      setDaysB(vigenteHoje.weeks?.B?.days || emptyDays());
      setCicloA(vigenteHoje.weeks?.A?.sundayCycle ?? null);
      setCicloB(vigenteHoje.weeks?.B?.sundayCycle ?? null);
      if (vigenteHoje.anchor) setAnchor(vigenteHoje.anchor);
    } else {
      setTipo("single");
      setDaysSingle(vigenteHoje.days || emptyDays());
      setCicloSingle(vigenteHoje.sundayCycle ?? null);
    }
  }, [vigenteHoje]);

  // Validações por semana/single
  const validSingle = useMemo(
    () => validateWorkScheduleDays(daysSingle, cargaMinMin, cargaMaxMin),
    [daysSingle, cargaMinMin, cargaMaxMin],
  );
  const validA = useMemo(
    () => validateWorkScheduleDays(daysA, cargaMinMin, cargaMaxMin),
    [daysA, cargaMinMin, cargaMaxMin],
  );
  const validB = useMemo(
    () => validateWorkScheduleDays(daysB, cargaMinMin, cargaMaxMin),
    [daysB, cargaMinMin, cargaMaxMin],
  );

  const errors = tipo === "single" ? validSingle.errors : [...validA.errors, ...validB.errors];

  // ── Helpers ──
  function days(): { [k: number]: HorarioDia } {
    if (tipo === "single") return daysSingle;
    return editWeek === "A" ? daysA : daysB;
  }
  function setDays(updater: (d: { [k: number]: HorarioDia }) => { [k: number]: HorarioDia }) {
    if (tipo === "single") setDaysSingle(updater);
    else if (editWeek === "A") setDaysA(updater);
    else setDaysB(updater);
  }
  function patchDia(idx: number, patch: Partial<HorarioDia>) {
    setDays(d => ({ ...d, [idx]: { ...d[idx], ...patch } }));
  }
  function copiarDe(idxFonte: number, idxDestino: number) {
    setDays(d => ({ ...d, [idxDestino]: { ...d[idxFonte] } }));
  }
  function limparDia(idx: number) {
    setDays(d => ({ ...d, [idx]: { active: false } }));
  }
  function ciclo(): SundayCycle | null {
    if (tipo === "single") return cicloSingle;
    return editWeek === "A" ? cicloA : cicloB;
  }
  function setCiclo(c: SundayCycle | null) {
    if (tipo === "single") setCicloSingle(c);
    else if (editWeek === "A") setCicloA(c);
    else setCicloB(c);
  }

  function importarDeOutroEmpregado(outroSchedule: WorkSchedule) {
    if (outroSchedule.type === "alternating") {
      setTipo("alternating");
      setDaysA(outroSchedule.weeks?.A?.days || emptyDays());
      setDaysB(outroSchedule.weeks?.B?.days || emptyDays());
      setCicloA(outroSchedule.weeks?.A?.sundayCycle ?? null);
      setCicloB(outroSchedule.weeks?.B?.sundayCycle ?? null);
      if (outroSchedule.anchor) setAnchor(outroSchedule.anchor);
    } else {
      setTipo("single");
      setDaysSingle(outroSchedule.days || emptyDays());
      setCicloSingle(outroSchedule.sundayCycle ?? null);
    }
  }

  async function salvar() {
    if (!me) return;
    if (exigeValidacao && errors.length > 0) {
      setErrMsg("Resolva os erros CLT antes de salvar.");
      return;
    }
    if (!validFrom) { setErrMsg("Data de vigência obrigatória"); return; }
    if (tipo === "alternating" && !anchor.date) {
      setErrMsg("Data de referência (anchor) é obrigatória pra escala alternada");
      return;
    }
    setErrMsg("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const motivoLimpo = motivo.trim();
      let novaVersao: WorkSchedule;
      if (tipo === "single") {
        novaVersao = {
          validFrom,
          type: "single",
          totalContract: validSingle.totalContract,
          days: daysSingle,
          sundayCycle: cicloSingle ?? null,
          registradoEm: now,
          registradoPor: me.id,
          ...(motivoLimpo ? { motivo: motivoLimpo } : {}),
        };
      } else {
        novaVersao = {
          validFrom,
          type: "alternating",
          totalContract: Math.round((validA.totalContract + validB.totalContract) / 2),
          weeks: {
            A: { days: daysA, sundayCycle: cicloA ?? null, totalContract: validA.totalContract },
            B: { days: daysB, sundayCycle: cicloB ?? null, totalContract: validB.totalContract },
          },
          anchor,
          registradoEm: now,
          registradoPor: me.id,
          ...(motivoLimpo ? { motivo: motivoLimpo } : {}),
        };
      }
      const lista = [...(empregado.workSchedules || [])].filter(s => s.validFrom !== validFrom);
      lista.push(novaVersao);
      lista.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      // Firestore rejeita undefined — sanitiza recursivamente antes de gravar
      await updateDoc(doc(db, "empregados", empregado.id), {
        workSchedules: sanitizeForFirestore(lista),
      });
      await logAudit({
        entityType: "empregado",
        entityId: empregado.id,
        restaurantId,
        acao: "alterado",
        diff: {
          workSchedules: { antes: empregado.workSchedules?.length || 0, depois: lista.length },
          validFrom: { antes: null, depois: validFrom },
          tipo: { antes: vigenteHoje?.type, depois: tipo },
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

  const totalSemanal = tipo === "single"
    ? validSingle.totalContract
    : Math.round((validA.totalContract + validB.totalContract) / 2);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Limite: <strong>{fmtHHMM(cargaMinMin)} a {fmtHHMM(cargaMaxMin)}</strong> por semana.
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowImportar(true)}>
          📥 Importar de outro empregado
        </Button>
      </div>

      {/* Toggle Single / Alternating */}
      <div className="inline-flex items-center bg-gray-100 dark:bg-gray-800/60 p-0.5 rounded-lg">
        <button
          type="button"
          onClick={() => setTipo("single")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tipo === "single"
              ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
          }`}
        >
          📋 Horário único
        </button>
        <button
          type="button"
          onClick={() => setTipo("alternating")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tipo === "alternating"
              ? "bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
          }`}
        >
          🔄 Alternada A/B
        </button>
      </div>

      {/* Anchor + sub-tabs A/B */}
      {tipo === "alternating" && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-3">
          <div className="text-xs text-blue-800 dark:text-blue-300">
            🔄 <strong>Escala alternada A/B.</strong> Define qual semana é A; a próxima é B; alterna.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Semana de referência (qualquer data) *"
              type="date"
              value={anchor.date}
              onChange={(e) => setAnchor(a => ({ ...a, date: e.target.value }))}
            />
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Essa semana é tipo</label>
              <select
                value={anchor.week}
                onChange={(e) => setAnchor(a => ({ ...a, week: e.target.value as "A" | "B" }))}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="A">Semana A</option>
                <option value="B">Semana B</option>
              </select>
            </div>
          </div>

          <div className="inline-flex items-center bg-white dark:bg-gray-900 p-0.5 rounded-lg border border-blue-300 dark:border-blue-700">
            <button
              type="button"
              onClick={() => setEditWeek("A")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                editWeek === "A" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-400"
              }`}
            >
              ✏️ Editando Semana A {validA.errors.length > 0 && `(${validA.errors.length} erro)`}
            </button>
            <button
              type="button"
              onClick={() => setEditWeek("B")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                editWeek === "B" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-400"
              }`}
            >
              ✏️ Editando Semana B {validB.errors.length > 0 && `(${validB.errors.length} erro)`}
            </button>
          </div>
        </div>
      )}

      {/* Tabela de dias */}
      <DiasTabela
        days={days()}
        onPatch={patchDia}
        onCopiar={copiarDe}
        onLimpar={limparDia}
      />

      {/* Ciclo de domingo (se domingo está ativo na semana atual) */}
      {days()[0]?.active && (
        <CicloDomingoEditor
          ciclo={ciclo()}
          onChange={setCiclo}
        />
      )}

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <ResumoCard label={tipo === "alternating" ? `Dias na ${editWeek}` : "Dias ativos"}
          value={`${tipo === "single" ? validSingle.diasAtivos : (editWeek === "A" ? validA.diasAtivos : validB.diasAtivos)}`}
        />
        <ResumoCard label={tipo === "alternating" ? "Carga média" : "Carga semanal"} value={fmtHHMM(totalSemanal)} />
        <ResumoCard
          label="Status"
          value={errors.length === 0 ? "✓ OK" : `⚠ ${errors.length} erro(s)`}
          variant={errors.length === 0 ? "ok" : "warn"}
        />
      </div>

      {/* Erros agrupados */}
      {errors.length > 0 && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
            ⚠ Violações CLT — bloqueia salvar
          </div>
          {tipo === "single" && validSingle.errors.map((er, i) => <ErrorRow key={`s${i}`} er={er} />)}
          {tipo === "alternating" && validA.errors.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 mt-1">Semana A</div>
              {validA.errors.map((er, i) => <ErrorRow key={`a${i}`} er={er} />)}
            </div>
          )}
          {tipo === "alternating" && validB.errors.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 mt-1">Semana B</div>
              {validB.errors.map((er, i) => <ErrorRow key={`b${i}`} er={er} />)}
            </div>
          )}
        </div>
      )}

      {/* Vigência */}
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
        <Button onClick={salvar} disabled={saving || (exigeValidacao && errors.length > 0)}>
          {saving ? "Salvando..." : "Salvar nova versão"}
        </Button>
      </div>

      {/* Histórico */}
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
                    A partir de {ws.validFrom} · {ws.type === "alternating" ? "Alternada A/B" : "Único"} · {fmtHHMM(ws.totalContract)} semanais
                    {ws.motivo && ` · "${ws.motivo}"`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {showImportar && (
        <ImportarHorarioModal
          empregadoAtual={empregado}
          restaurantId={restaurantId}
          onPick={(s) => { importarDeOutroEmpregado(s); setShowImportar(false); }}
          onClose={() => setShowImportar(false)}
        />
      )}
    </div>
  );
}

// ── Componentes auxiliares ──────────────────────────────────────────────────

function DiasTabela({
  days, onPatch, onCopiar, onLimpar,
}: {
  days: { [k: number]: HorarioDia };
  onPatch: (idx: number, patch: Partial<HorarioDia>) => void;
  onCopiar: (idxFonte: number, idxDestino: number) => void;
  onLimpar: (idx: number) => void;
}) {
  return (
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
              <input type="checkbox" checked={!!d.active}
                onChange={(e) => onPatch(wd.idx, { active: e.target.checked })} />
            </div>
            <div>
              <input type="time" disabled={!d.active} value={d.in || ""}
                onChange={(e) => onPatch(wd.idx, { in: e.target.value })}
                className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50" />
            </div>
            <div>
              <input type="time" disabled={!d.active} value={d.out || ""}
                onChange={(e) => onPatch(wd.idx, { out: e.target.value })}
                className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50" />
            </div>
            <div>
              <input type="number" min="0" max="240" step="15" disabled={!d.active}
                value={d.break ?? ""} onChange={(e) => onPatch(wd.idx, { break: parseInt(e.target.value, 10) || 0 })}
                placeholder="min"
                className="w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right disabled:opacity-50" />
            </div>
            <div className="text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">
              {calc ? fmtHHMM(calc.totalContract) : "—"}
            </div>
            <div className="text-center">
              {d.active ? (
                <button type="button" onClick={() => onLimpar(wd.idx)} title="Limpar"
                  className="text-xs text-gray-400 hover:text-rose-600">✕</button>
              ) : (
                <CopiarDeMenu
                  daysAtivos={WEEKDAYS.filter(w => w.idx !== wd.idx && days[w.idx]?.active)}
                  onPick={(srcIdx) => onCopiar(srcIdx, wd.idx)}
                  // Pros últimos 2 dias (Sex, Sáb), abre o dropdown PRA CIMA
                  // pra não ser cortado pelo final do modal
                  abrirParaCima={wd.idx >= 5}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CicloDomingoEditor({
  ciclo, onChange,
}: { ciclo: SundayCycle | null; onChange: (c: SundayCycle | null) => void }) {
  const ativo = !!ciclo;
  const workCount = ciclo?.workCount ?? 3;
  const refDate = ciclo?.refDate ?? "";
  const refDateValido = refDate && isSunday(refDate);

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={ativo}
          onChange={(e) => onChange(e.target.checked ? { workCount: 3, offCount: 1, refDate: "" } : null)} />
        <span className="font-medium text-amber-900 dark:text-amber-300">
          🔁 Folga em ciclo de domingos
        </span>
      </label>

      {ativo && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Trabalha N domingos seguidos *
              </label>
              <input type="number" min="0" step="1" value={workCount}
                onChange={(e) => onChange({ ...ciclo!, workCount: parseInt(e.target.value, 10) || 0 })}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              <p className="text-[11px] text-gray-500 mt-1">
                Trabalha {workCount} domingos · folga 1
              </p>
            </div>
            <div>
              <Input
                label="Primeiro domingo de FOLGA *"
                type="date"
                value={refDate}
                onChange={(e) => onChange({ ...ciclo!, refDate: e.target.value })}
              />
              {refDate && !refDateValido && (
                <p className="text-[11px] text-rose-600 mt-1">⚠ A data tem que ser um domingo</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorRow({ er }: { er: ValidacaoIssue }) {
  return (
    <div className="text-xs text-rose-800 dark:text-rose-300">
      • {er.mensagem} <span className="opacity-60">({er.artigo})</span>
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
  daysAtivos, onPick, abrirParaCima,
}: { daysAtivos: typeof WEEKDAYS; onPick: (idx: number) => void; abrirParaCima?: boolean }) {
  const [open, setOpen] = useState(false);
  if (daysAtivos.length === 0) return <span className="text-xs text-gray-300">—</span>;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)} title="Copiar de outro dia"
        className="text-xs text-gray-400 hover:text-indigo-600">📋</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 ${abrirParaCima ? "bottom-full mb-1" : "top-full mt-1"} z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden`}>
            {daysAtivos.map(d => (
              <button key={d.idx} type="button"
                onClick={() => { onPick(d.idx); setOpen(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap">
                Copiar de {d.short}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal: importar de outro empregado ─────────────────────────────────────

function ImportarHorarioModal({
  empregadoAtual, restaurantId, onPick, onClose,
}: {
  empregadoAtual: Empregado;
  restaurantId: string;
  onPick: (s: WorkSchedule) => void;
  onClose: () => void;
}) {
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      // Filtra: não o atual + tem workSchedules
      setEmpregados(list.filter(e => e.id !== empregadoAtual.id && (e.workSchedules?.length || 0) > 0));
      setLoading(false);
    });
    return () => unsub();
  }, [empregadoAtual.id, restaurantId]);

  return (
    <Modal title="Importar horário de outro empregado" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Copia o horário VIGENTE HOJE do empregado escolhido. Você ainda precisa ajustar a vigência e salvar.
        </p>
        {loading ? (
          <div className="text-sm text-gray-500">Carregando...</div>
        ) : empregados.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-2">🤷</div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Nenhum outro empregado com horário cadastrado.
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {empregados.map(emp => {
              const vigente = getActiveWorkSchedule(emp.workSchedules, todayYmd());
              if (!vigente) return null;
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => onPick(vigente)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 dark:hover:border-indigo-700 text-left transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{emp.nome}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {vigente.type === "alternating" ? "Alternada A/B" : "Horário único"} · {fmtHHMM(vigente.totalContract)} semanais
                    </div>
                  </div>
                  <span className="text-indigo-600 dark:text-indigo-400 text-sm">›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Type re-export pra não importar de horarios em outros lugares
export type { ValidacaoResultado };
