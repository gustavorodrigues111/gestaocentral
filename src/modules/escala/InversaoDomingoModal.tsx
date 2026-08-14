import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Empregado, EscalaMes, SundaySwap, ScheduleStatus } from "../../core/types";
import { daysInMonth, fmtAnoMes, pad2, parseYmd, shiftMonth } from "../../core/utils/date";
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

// Modal de inversão de domingo — DOIS modos:
//  A) "informal" (reciproca) — troca entre 2 pessoas. Só auditoria: escala,
//     gorjeta e ponto NÃO mudam. (fluxo original)
//  B) "pontual" — 1 pessoa move a própria folga pra outro domingo do mês. Grava
//     override na PRATICADA (real): trabalha em date1, folga em date2 → a gorjeta
//     segue o dia trabalhado. NÃO toca no ciclo de domingos. Reversível.
//
// Fluxo: Domingo 1 → Pessoa (folga em date1, vai trabalhar) → Modo → Domingo 2.
export function InversaoDomingoModal({
  restaurantId, ano, mes, empregados, escala, meId, meNome, isMaster, onClose,
}: Props) {
  const [aba, setAba] = useState<"novo" | "historico">("novo");
  const [date1, setDate1] = useState<string>("");
  const [empBId, setEmpBId] = useState<string>("");   // pessoa folgando em date1 (vai trabalhar)
  const [modo, setModo] = useState<"" | "reciproca" | "pontual">("");
  const [empAId, setEmpAId] = useState<string>("");   // (reciproca) pessoa trabalhando em date1
  const [date2, setDate2] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Histórico de swaps do restaurante
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
    const ehPontual = swap.tipo === "pontual";
    const quem = ehPontual ? swap.empANome : `${swap.empANome} ↔ ${swap.empBNome}`;
    if (!confirm(ehPontual
      ? `Desfazer a troca pontual de ${swap.empANome}? Os dois domingos voltam ao estado anterior na praticada.`
      : `Excluir registro de inversão entre ${quem}?`)) return;

    // Pontual aplicada: reverte os overrides na praticada.
    if (ehPontual && swap.aplicadoNaEscala) {
      const escId = `${swap.restaurantId}_${swap.date1.slice(0, 7)}`;
      const ref = doc(db, "escalas", escId);
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      updates[`real.${swap.empAId}.${swap.date1}`] = swap.prevReal1 ?? deleteField();
      updates[`real.${swap.empAId}.${swap.date2}`] = swap.prevReal2 ?? deleteField();
      await updateDoc(ref, updates).catch(() => { /* doc pode não existir mais */ });
    }
    await deleteDoc(doc(db, "sundaySwaps", swap.id));
  }

  // Lista de domingos do mês visível
  const domingosDoMes = useMemo(() => {
    const arr: { date: string; dia: number }[] = [];
    const lastDay = daysInMonth(ano, mes);
    for (let d = 1; d <= lastDay; d++) {
      const dt = `${ano}-${pad2(mes)}-${pad2(d)}`;
      if (parseYmd(dt).getDay() === 0) arr.push({ date: dt, dia: d });
    }
    return arr;
  }, [ano, mes]);

  // Status de um empregado num dia (override real > prevista > derivado)
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
  const trabalhaNoStatus = (s?: ScheduleStatus) => s === "trabalho" || s === "comp_trab" || s === undefined;
  const folgaNoStatus = (s?: ScheduleStatus) => s === "folga" || s === "comp";

  // Empregados FOLGANDO em date1 (a pessoa que vai trabalhar / mover a folga)
  const empsFolgando = useMemo(() => {
    if (!date1) return [];
    return empregados
      .filter(e => folgaNoStatus(getStatus(e.id, date1)))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date1, empregados, escala]);

  // (reciproca) Empregados TRABALHANDO em date1 (a outra pessoa), excluindo empB
  const empsTrabalhando = useMemo(() => {
    if (!date1) return [];
    return empregados
      .filter(e => e.id !== empBId && trabalhaNoStatus(getStatus(e.id, date1)))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date1, empBId, empregados, escala]);

  // (pontual) Domingos do mês em que a pessoa TRABALHA (pra virar folga), ≠ date1
  const domingosPontual = useMemo(() => {
    if (!empBId) return [];
    return domingosDoMes
      .filter(d => d.date !== date1 && trabalhaNoStatus(getStatus(empBId, d.date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empBId, date1, domingosDoMes, escala]);

  // (reciproca) Candidatos pra date2: domingos em 3 meses onde A folga; perfect se B trabalha.
  const reciprocaCandidatos = useMemo(() => {
    if (!empAId) return [];
    const mesesPraScanear = [shiftMonth(ano, mes, -1), { ano, mes }, shiftMonth(ano, mes, +1)];
    const empA = empregados.find(e => e.id === empAId);
    const empB = empregados.find(e => e.id === empBId);
    if (!empA) return [];
    const derivedAMap = Object.fromEntries(mesesPraScanear.flatMap(({ ano: ay, mes: am }) =>
      Object.entries(derivedScheduleForEmpregado(empA, ay, am)).map(([dt, d]) => [dt, d.status])));
    const derivedBMap = empB ? Object.fromEntries(mesesPraScanear.flatMap(({ ano: ay, mes: am }) =>
      Object.entries(derivedScheduleForEmpregado(empB, ay, am)).map(([dt, d]) => [dt, d.status]))) : {};
    const result: { date: string; label: string; perfect: boolean }[] = [];
    for (const { ano: ay, mes: am } of mesesPraScanear) {
      const lastDay = daysInMonth(ay, am);
      const monthLabel = ay === ano && am === mes ? "Este mês"
        : (new Date(ay, am, 1) < new Date(ano, mes - 1, 1)) ? "Mês anterior" : "Próximo mês";
      for (let d = 1; d <= lastDay; d++) {
        const dt = `${ay}-${pad2(am)}-${pad2(d)}`;
        if (parseYmd(dt).getDay() !== 0 || dt === date1) continue;
        const aStatus = escala?.real?.[empAId]?.[dt] ?? escala?.prevista?.[empAId]?.[dt] ?? derivedAMap[dt];
        if (!folgaNoStatus(aStatus as ScheduleStatus)) continue;
        const bStatus = empBId ? (escala?.real?.[empBId]?.[dt] ?? escala?.prevista?.[empBId]?.[dt] ?? derivedBMap[dt]) : undefined;
        result.push({ date: dt, label: monthLabel, perfect: trabalhaNoStatus(bStatus as ScheduleStatus) });
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empAId, empBId, escala, empregados, ano, mes, date1]);

  const nome = (id: string) => empregados.find(e => e.id === id)?.nome || "";
  const primeiro = (id: string) => nome(id).split(" ")[0];

  async function salvarReciproca() {
    const empA = empregados.find(e => e.id === empAId);
    const empB = empregados.find(e => e.id === empBId);
    const motivoTrim = motivo.trim();
    const payload: Omit<SundaySwap, "id"> = {
      restaurantId, tipo: "reciproca",
      empAId, empANome: empA?.nome || "",
      empBId, empBNome: empB?.nome || "",
      date1, date2,
      criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome,
      ...(motivoTrim ? { motivo: motivoTrim } : {}),
    };
    await addDoc(collection(db, "sundaySwaps"), payload);
  }

  async function salvarPontual() {
    const pid = empBId;                       // a única pessoa
    const emp = empregados.find(e => e.id === pid);
    const escId = `${restaurantId}_${fmtAnoMes(ano, mes)}`;
    const ref = doc(db, "escalas", escId);
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as EscalaMes) : null;
    if (!snap.exists()) {
      await setDoc(ref, { id: escId, restaurantId, ano, mes, prevista: {}, real: {}, updatedAt: new Date().toISOString() });
    }
    const prevReal1 = prev?.real?.[pid]?.[date1] ?? null;
    const prevReal2 = prev?.real?.[pid]?.[date2] ?? null;
    // Grava a praticada: trabalha em date1, folga em date2 → gorjeta segue.
    await updateDoc(ref, {
      [`real.${pid}.${date1}`]: "trabalho",
      [`real.${pid}.${date2}`]: "folga",
      updatedAt: new Date().toISOString(),
    });
    const motivoTrim = motivo.trim();
    const payload: Omit<SundaySwap, "id"> = {
      restaurantId, tipo: "pontual",
      empAId: pid, empANome: emp?.nome || "",
      date1, date2,
      aplicadoNaEscala: true, prevReal1, prevReal2,
      criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome,
      ...(motivoTrim ? { motivo: motivoTrim } : {}),
    };
    await addDoc(collection(db, "sundaySwaps"), payload);
  }

  async function salvar() {
    setSaving(true); setErr("");
    try {
      if (modo === "pontual") {
        if (!date1 || !empBId || !date2) { setErr("Faltam campos."); setSaving(false); return; }
        await salvarPontual();
      } else {
        if (!date1 || !empAId || !empBId || !date2) { setErr("Faltam campos."); setSaving(false); return; }
        await salvarReciproca();
      }
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

  function voltar() {
    if (date2) setDate2("");
    else if (modo === "reciproca" && empAId) setEmpAId("");
    else if (modo) setModo("");
    else if (empBId) setEmpBId("");
    else if (date1) setDate1("");
    else onClose();
  }

  // Passos por condição
  const showDate1 = !date1;
  const showPessoa = !!date1 && !empBId;
  const showModo = !!date1 && !!empBId && !modo;
  const showEmpA = modo === "reciproca" && !!empBId && !empAId;
  const showDate2Recip = modo === "reciproca" && !!empAId && !date2;
  const showDate2Pont = modo === "pontual" && !!empBId && !date2;
  const showConfirm = !!date2 && (modo === "pontual" || (modo === "reciproca" && !!empAId));

  return (
    <Modal title="↔️ Inversão de domingo" onClose={onClose} maxWidth="max-w-lg">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 -mx-2 px-2">
        <button type="button" onClick={() => setAba("novo")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${aba === "novo" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
          ↔️ Nova
        </button>
        <button type="button" onClick={() => setAba("historico")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${aba === "historico" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
          📋 Histórico ({swaps.length})
        </button>
      </div>

      {aba === "historico" ? (
        <div>
          {swaps.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500">Nenhuma inversão registrada ainda.</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-2">
              {swaps.map(s => {
                const podeExcluir = isMaster || s.criadoPor === meId;
                const ehPontual = s.tipo === "pontual";
                return (
                  <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                          {ehPontual
                            ? <>🔄 {s.empANome} <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">pontual</span></>
                            : <>↔️ {s.empANome} ↔ {s.empBNome} <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-semibold">informal</span></>}
                        </div>
                        {ehPontual ? (
                          <>
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">🟢 <strong>{fmtData(s.date1)}</strong>: trabalha (recebe gorjeta)</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">⚪ <strong>{fmtData(s.date2)}</strong>: folga (não recebe)</div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">📅 <strong>{fmtData(s.date1)}</strong>: {(s.empANome || "").split(" ")[0]} trabalhou, {(s.empBNome || "").split(" ")[0]} folgou</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">↩️ <strong>{fmtData(s.date2)}</strong>: recíproca</div>
                          </>
                        )}
                        {s.motivo && <div className="text-[11px] italic text-gray-500 dark:text-gray-400 mt-1">"{s.motivo}"</div>}
                        <div className="text-[10px] text-gray-400 mt-1">Registrado por {s.criadoPorNome || "?"} em {new Date(s.criadoEm).toLocaleDateString("pt-BR")}</div>
                      </div>
                      {podeExcluir && (
                        <button type="button" onClick={() => excluirSwap(s)} className="text-gray-400 hover:text-rose-600 text-sm px-1" title={ehPontual ? "Desfazer (reverte a escala)" : "Excluir registro"}>🗑</button>
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
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {modo === "pontual"
              ? "Troca pontual: a pessoa move a folga pra outro domingo do mês. A gorjeta segue o dia trabalhado; o ciclo de domingos não muda."
              : modo === "reciproca"
                ? "Troca informal entre duas pessoas: registro de auditoria — escala, gorjeta e ponto NÃO mudam."
                : "Escolha o domingo, a pessoa e o modo. O efeito na gorjeta muda conforme o modo."}
          </p>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-4 text-[11px] font-mono text-gray-500 flex-wrap">
            <Crumb active={showDate1} done={!!date1} label="Domingo" value={date1 ? fmtData(date1) : ""} />
            <span>›</span>
            <Crumb active={showPessoa} done={!!empBId} label="Pessoa" value={empBId ? primeiro(empBId) : ""} />
            <span>›</span>
            <Crumb active={showModo} done={!!modo} label="Modo" value={modo === "pontual" ? "pontual" : modo === "reciproca" ? "informal" : ""} />
            <span>›</span>
            <Crumb active={showEmpA || showDate2Recip || showDate2Pont} done={!!date2} label={modo === "pontual" ? "Folga" : "Recíproca"} value={date2 ? fmtData(date2) : ""} />
          </div>

          {/* Step 1: Domingo */}
          {showDate1 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Escolha o domingo:</div>
              <div className="flex flex-wrap gap-2">
                {domingosDoMes.map(d => (
                  <button key={d.date} type="button" onClick={() => setDate1(d.date)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300">
                    {pad2(d.dia)}/{pad2(mes)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Pessoa folgando em date1 */}
          {showPessoa && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Pessoa <strong>folgando</strong> em {fmtData(date1)} (vai trabalhar / mover a folga):
              </div>
              {empsFolgando.length === 0 ? (
                <p className="text-xs text-gray-500">Ninguém está folgando nesse domingo na escala atual.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                  {empsFolgando.map(e => (
                    <button key={e.id} type="button" onClick={() => setEmpBId(e.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      {e.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Modo */}
          {showModo && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Como é a recíproca?</div>
              <button type="button" onClick={() => setModo("reciproca")}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 p-3 hover:border-indigo-400">
                <div className="font-semibold text-sm flex items-center gap-2">👥 Troca informal com outra pessoa
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold uppercase">só auditoria</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Alguém cobre {primeiro(empBId)} e ela cobre de volta noutro domingo. Gorjeta não muda.</div>
              </button>
              <button type="button" onClick={() => setModo("pontual")}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 p-3 hover:border-emerald-400">
                <div className="font-semibold text-sm flex items-center gap-2">🔄 Troca pontual — sem outra pessoa
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold uppercase">gorjeta segue</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{primeiro(empBId)} move a própria folga pra outro domingo deste mês. Recebe a gorjeta do dia que trabalhou.</div>
              </button>
            </div>
          )}

          {/* Step 4 (reciproca): Empregado A trabalhando */}
          {showEmpA && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Empregado <strong>trabalhando</strong> em {fmtData(date1)} (vai folgar):
              </div>
              {empsTrabalhando.length === 0 ? (
                <p className="text-xs text-gray-500">Ninguém está trabalhando nesse domingo na escala atual.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                  {empsTrabalhando.map(e => (
                    <button key={e.id} type="button" onClick={() => setEmpAId(e.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      {e.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 5 (reciproca): Domingo da recíproca */}
          {showDate2Recip && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Domingo em que <strong>{primeiro(empAId)}</strong> folga (recíproca):
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Escaneia mês anterior + atual + próximo. ✨ "Perfeito" = {primeiro(empBId)} também trabalha lá.</p>
              {reciprocaCandidatos.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhuma data encontrada nos próximos 3 meses.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                  {reciprocaCandidatos.map(c => (
                    <button key={c.date} type="button" onClick={() => setDate2(c.date)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${c.perfect ? "bg-emerald-50/60 dark:bg-emerald-900/10" : ""}`}>
                      <span className="font-mono">{fmtData(c.date)}</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-2">{c.label}</span>
                      {c.perfect && <span className="ml-2 text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">✨ perfeito</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4 (pontual): Domingo em que a pessoa vai folgar */}
          {showDate2Pont && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Domingo em que <strong>{primeiro(empBId)}</strong> vai <strong>folgar</strong> (era trabalho) — mesmo mês:
              </div>
              {domingosPontual.length === 0 ? (
                <p className="text-xs text-gray-500">Ela não trabalha em nenhum outro domingo deste mês.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {domingosPontual.map(d => (
                    <button key={d.date} type="button" onClick={() => setDate2(d.date)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-400">
                      {pad2(d.dia)}/{pad2(mes)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Confirmação */}
          {showConfirm && (
            <div className="space-y-3">
              {modo === "pontual" ? (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm">
                  <div className="font-bold text-emerald-900 dark:text-emerald-100 mb-2">🔄 Troca pontual — {nome(empBId)}</div>
                  <div className="space-y-1 text-xs text-emerald-800 dark:text-emerald-200">
                    <div>🟢 <strong>{fmtData(date1)}</strong>: trabalha → <strong>recebe gorjeta</strong> (era folga)</div>
                    <div>⚪ <strong>{fmtData(date2)}</strong>: folga → não recebe (era trabalho)</div>
                    <div>🔒 Ciclo de domingos: intacto · 🕐 Ponto no dia real trabalhado</div>
                    <div>↩︎ Reversível: desfazer no Histórico restaura os 2 dias</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-3 text-sm">
                  <div className="font-bold text-indigo-900 dark:text-indigo-100 mb-2">📋 Troca informal</div>
                  <div className="space-y-1 text-xs text-indigo-800 dark:text-indigo-200">
                    <div>📅 <strong>{fmtData(date1)}</strong>: {nome(empAId)} (era trab) ↔ {nome(empBId)} (era folga)</div>
                    <div>↩️ <strong>{fmtData(date2)}</strong>: troca recíproca</div>
                    <div>🚫 Gorjeta, escala e ponto não mudam</div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Motivo (opcional)</label>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                  placeholder={modo === "pontual" ? "Ex: pediu pra folgar no aniversário do filho" : "Ex: trocaram pra ir num casamento"}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              </div>
              {err && <div className="text-xs text-rose-600">{err}</div>}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-between gap-2 mt-5 pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" size="sm" onClick={voltar}>{showDate1 ? "Cancelar" : "← Voltar"}</Button>
            {showConfirm && (
              <Button onClick={salvar} disabled={saving}>
                {saving ? "Salvando..." : modo === "pontual" ? "✓ Registrar troca pontual" : "✓ Registrar troca informal"}
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
      <span className={active ? "font-bold text-indigo-700 dark:text-indigo-400" : done ? "text-gray-500" : "text-gray-400"}>{label}</span>
      {value && <span className="text-gray-600 dark:text-gray-300 font-semibold">{value}</span>}
    </span>
  );
}
