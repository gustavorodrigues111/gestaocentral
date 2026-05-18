import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Empregado, EscalaMes, SundaySwap, ScheduleStatus } from "../../core/types";
import { daysInMonth, pad2, parseYmd, shiftMonth } from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";

type Props = {
  restaurantId: string;
  ano: number;
  mes: number;
  empregados: Empregado[];
  escala: EscalaMes | null;       // escala do mês visível (pra status do date1)
  meId: string;
  meNome: string;
  isMaster: boolean;
  onClose: () => void;
};

// Wizard de 4 passos pra registrar inversão informal de domingo entre 2 empregados.
// 1. Escolhe Domingo 1 (do mês atual)
// 2. Escolhe Empregado B (quem ESTÁ folgando em date1)
// 3. Escolhe Empregado A (quem ESTÁ trabalhando em date1)
// 4. Escolhe Domingo 2 (recíproca) — sistema escaneia 3 meses procurando
//    domingos em que A folga; marca "perfeito" quando B também trabalha lá.
//
// Cria 1 doc em /sundaySwaps. NÃO mexe na escala — só audita a combinação.
export function InversaoDomingoModal({
  restaurantId, ano, mes, empregados, escala, meId, meNome, isMaster, onClose,
}: Props) {
  const [aba, setAba] = useState<"novo" | "historico">("novo");
  const [date1, setDate1] = useState<string>("");
  const [empBId, setEmpBId] = useState<string>("");
  const [empAId, setEmpAId] = useState<string>("");
  const [date2, setDate2] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Histórico de swaps do restaurante (todas as inversões já registradas)
  const [swaps, setSwaps] = useState<SundaySwap[]>([]);
  useEffect(() => {
    const q = query(collection(db, "sundaySwaps"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as SundaySwap);
      list.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setSwaps(list);
    });
    return () => unsub();
  }, [restaurantId]);

  async function excluirSwap(swap: SundaySwap) {
    const podeExcluir = isMaster || swap.criadoPor === meId;
    if (!podeExcluir) {
      alert("Só o master ou quem criou pode excluir esta inversão.");
      return;
    }
    if (!confirm(`Excluir registro de inversão entre ${swap.empANome} ↔ ${swap.empBNome}?`)) return;
    await deleteDoc(doc(db, "sundaySwaps", swap.id));
  }

  // Step atual
  const step: 1 | 2 | 3 | 4 | 5 =
    !date1 ? 1 : !empBId ? 2 : !empAId ? 3 : !date2 ? 4 : 5;

  // Lista de domingos do mês atual
  const domingosDoMes = useMemo(() => {
    const arr: { date: string; dia: number }[] = [];
    const lastDay = daysInMonth(ano, mes);
    for (let d = 1; d <= lastDay; d++) {
      const dt = `${ano}-${pad2(mes)}-${pad2(d)}`;
      if (parseYmd(dt).getDay() === 0) arr.push({ date: dt, dia: d });
    }
    return arr;
  }, [ano, mes]);

  // Helper: status de um empregado num dia (override > derived)
  function getStatus(empId: string, date: string): ScheduleStatus | undefined {
    const realOverride = escala?.real?.[empId]?.[date];
    if (realOverride) return realOverride;
    const prevOverride = escala?.prevista?.[empId]?.[date];
    if (prevOverride) return prevOverride;
    const emp = empregados.find(e => e.id === empId);
    if (!emp) return undefined;
    const derived = derivedScheduleForEmpregado(emp, ano, mes);
    return derived[date]?.status;
  }

  // Empregados FOLGANDO em date1
  const empsFolgando = useMemo(() => {
    if (!date1) return [];
    return empregados
      .filter(e => {
        const st = getStatus(e.id, date1);
        return st === "folga" || st === "comp";
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date1, empregados]);

  // Empregados TRABALHANDO em date1 (excluindo empB)
  const empsTrabalhando = useMemo(() => {
    if (!date1) return [];
    return empregados
      .filter(e => {
        if (e.id === empBId) return false;
        const st = getStatus(e.id, date1);
        // "trabalho" ou sem status (assume trabalho implícito) ou comp_trab
        return st === "trabalho" || st === "comp_trab" || st === undefined;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date1, empBId, empregados]);

  // Candidatos pra date2: domingos em 3 meses (anterior + atual + próximo)
  // onde A folga; marca "perfect" se B também trabalha lá.
  const reciprocaCandidatos = useMemo(() => {
    if (!empAId) return [];
    const mesesPraScanear = [
      shiftMonth(ano, mes, -1),
      { ano, mes },
      shiftMonth(ano, mes, +1),
    ];
    const result: { date: string; label: string; perfect: boolean }[] = [];
    const empA = empregados.find(e => e.id === empAId);
    const empB = empregados.find(e => e.id === empBId);
    if (!empA) return [];
    const derivedA = empA ? mesesPraScanear.flatMap(({ ano: ay, mes: am }) =>
      Object.entries(derivedScheduleForEmpregado(empA, ay, am)).map(([dt, d]) => ({ dt, status: d.status }))
    ) : [];
    const derivedB = empB ? mesesPraScanear.flatMap(({ ano: ay, mes: am }) =>
      Object.entries(derivedScheduleForEmpregado(empB, ay, am)).map(([dt, d]) => ({ dt, status: d.status }))
    ) : [];
    const derivedAMap = Object.fromEntries(derivedA.map(x => [x.dt, x.status]));
    const derivedBMap = Object.fromEntries(derivedB.map(x => [x.dt, x.status]));

    for (const { ano: ay, mes: am } of mesesPraScanear) {
      const lastDay = daysInMonth(ay, am);
      const monthLabel =
        ay === ano && am === mes ? "Este mês"
        : (new Date(ay, am, 1) < new Date(ano, mes - 1, 1)) ? "Mês anterior"
        : "Próximo mês";
      for (let d = 1; d <= lastDay; d++) {
        const dt = `${ay}-${pad2(am)}-${pad2(d)}`;
        if (parseYmd(dt).getDay() !== 0) continue;
        if (dt === date1) continue;
        // Status de A (override > derived)
        const aStatus = escala?.real?.[empAId]?.[dt]
          ?? escala?.prevista?.[empAId]?.[dt]
          ?? derivedAMap[dt];
        const aIsOff = aStatus === "folga" || aStatus === "comp";
        if (!aIsOff) continue;
        // Status de B
        const bStatus = empBId
          ? (escala?.real?.[empBId]?.[dt] ?? escala?.prevista?.[empBId]?.[dt] ?? derivedBMap[dt])
          : undefined;
        const bIsWork = bStatus === "trabalho" || bStatus === "comp_trab" || bStatus === undefined;
        result.push({ date: dt, label: monthLabel, perfect: bIsWork });
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [empAId, empBId, escala, empregados, ano, mes, date1]);

  async function salvar() {
    if (!date1 || !empAId || !empBId || !date2) {
      setErr("Faltam campos obrigatórios.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const empA = empregados.find(e => e.id === empAId);
      const empB = empregados.find(e => e.id === empBId);
      const payload: Omit<SundaySwap, "id"> = {
        restaurantId,
        empAId,
        empANome: empA?.nome || "",
        empBId,
        empBNome: empB?.nome || "",
        date1,
        date2,
        motivo: motivo.trim() || undefined,
        criadoEm: new Date().toISOString(),
        criadoPor: meId,
        criadoPorNome: meNome,
      };
      await addDoc(collection(db, "sundaySwaps"), payload);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function fmtData(dt: string) {
    const d = parseYmd(dt);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  }

  return (
    <Modal title="↔️ Inversões de domingo" onClose={onClose} maxWidth="max-w-lg">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Registro de auditoria — escala, gorjeta e VT NÃO são afetados.
        Só documenta a combinação entre dois empregados.
      </p>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 -mx-2 px-2">
        <button
          type="button"
          onClick={() => setAba("novo")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === "novo"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          ↔️ Nova
        </button>
        <button
          type="button"
          onClick={() => setAba("historico")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            aba === "historico"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          📋 Histórico ({swaps.length})
        </button>
      </div>

      {aba === "historico" ? (
        <div>
          {swaps.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500">
              Nenhuma inversão registrada ainda.
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-2">
              {swaps.map(s => {
                const podeExcluir = isMaster || s.criadoPor === meId;
                return (
                  <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {s.empANome} ↔ {s.empBNome}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          📅 <strong>{fmtData(s.date1)}</strong>: {s.empANome.split(" ")[0]} trabalhou, {s.empBNome.split(" ")[0]} folgou
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          ↩️ <strong>{fmtData(s.date2)}</strong>: recíproca
                        </div>
                        {s.motivo && (
                          <div className="text-[11px] italic text-gray-500 dark:text-gray-400 mt-1">
                            "{s.motivo}"
                          </div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-1">
                          Registrado por {s.criadoPorNome || "?"} em {new Date(s.criadoEm).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      {podeExcluir && (
                        <button
                          type="button"
                          onClick={() => excluirSwap(s)}
                          className="text-gray-400 hover:text-rose-600 text-sm px-1"
                          title="Excluir registro"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-[11px] font-mono text-gray-500 flex-wrap">
        <Crumb active={step === 1} done={!!date1} label="1·Domingo" value={date1 ? fmtData(date1) : ""} />
        <span>›</span>
        <Crumb active={step === 2} done={!!empBId} label="2·Folga" value={empBId ? empregados.find(e => e.id === empBId)?.nome.split(" ")[0] : ""} />
        <span>›</span>
        <Crumb active={step === 3} done={!!empAId} label="3·Trab" value={empAId ? empregados.find(e => e.id === empAId)?.nome.split(" ")[0] : ""} />
        <span>›</span>
        <Crumb active={step === 4} done={!!date2} label="4·Recíproca" value={date2 ? fmtData(date2) : ""} />
      </div>

      {/* Step 1: Domingo */}
      {step === 1 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Escolha o domingo da troca:</div>
          <div className="flex flex-wrap gap-2">
            {domingosDoMes.map(d => (
              <button
                key={d.date}
                type="button"
                onClick={() => setDate1(d.date)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300"
              >
                {pad2(d.dia)}/{pad2(mes)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Empregado B (folgando) */}
      {step === 2 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Empregado <strong>folgando</strong> em {fmtData(date1)} (vai vir trabalhar):
          </div>
          {empsFolgando.length === 0 ? (
            <p className="text-xs text-gray-500">Ninguém está folgando nesse domingo na escala atual.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {empsFolgando.map(e => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEmpBId(e.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  {e.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Empregado A (trabalhando) */}
      {step === 3 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Empregado <strong>trabalhando</strong> em {fmtData(date1)} (vai folgar):
          </div>
          {empsTrabalhando.length === 0 ? (
            <p className="text-xs text-gray-500">Ninguém está trabalhando nesse domingo na escala atual.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {empsTrabalhando.map(e => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEmpAId(e.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  {e.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Domingo da recíproca */}
      {step === 4 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Domingo em que <strong>{empregados.find(e => e.id === empAId)?.nome.split(" ")[0]}</strong> folga (recíproca):
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Sistema escaneia mês anterior + atual + próximo procurando domingos em que A folga.
            ✨ "Perfeito" = B também trabalha nesse domingo.
          </p>
          {reciprocaCandidatos.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma data encontrada nos próximos 3 meses.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {reciprocaCandidatos.map(c => (
                <button
                  key={c.date}
                  type="button"
                  onClick={() => setDate2(c.date)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${c.perfect ? "bg-emerald-50/60 dark:bg-emerald-900/10" : ""}`}
                >
                  <span className="font-mono">{fmtData(c.date)}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-2">{c.label}</span>
                  {c.perfect && <span className="ml-2 text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">✨ perfeito</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 5: Confirmação */}
      {step === 5 && (
        <div className="space-y-3">
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-sm">
            <div className="font-bold text-indigo-900 dark:text-indigo-100 mb-2">📋 Resumo da inversão</div>
            <div className="space-y-1 text-xs text-indigo-800 dark:text-indigo-200">
              <div>📅 <strong>{fmtData(date1)}</strong>: {empregados.find(e => e.id === empAId)?.nome} (era trab) ↔ {empregados.find(e => e.id === empBId)?.nome} (era folga)</div>
              <div>↩️ <strong>{fmtData(date2)}</strong>: troca recíproca</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
              Motivo (opcional)
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ex: trocaram pra B ir num casamento"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </div>

          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
      )}

      {/* Footer com navegação */}
      <div className="flex justify-between gap-2 mt-5 pt-3 border-t border-gray-200 dark:border-gray-800">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // Volta um passo: zera o campo atual e os posteriores
            if (step === 5) setDate2("");
            else if (step === 4) setEmpAId("");
            else if (step === 3) setEmpBId("");
            else if (step === 2) setDate1("");
            else onClose();
          }}
        >
          {step === 1 ? "Cancelar" : "← Voltar"}
        </Button>
        {step === 5 && (
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : "✓ Registrar inversão"}
          </Button>
        )}
      </div>
      </>
      )}
    </Modal>
  );
}

function Crumb({ active, done, label, value }: { active: boolean; done: boolean; label: string; value?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={active ? "font-bold text-indigo-700 dark:text-indigo-400" : done ? "text-gray-500" : "text-gray-400"}>
        {label}
      </span>
      {value && <span className="text-gray-600 dark:text-gray-300 font-semibold">{value}</span>}
    </span>
  );
}
