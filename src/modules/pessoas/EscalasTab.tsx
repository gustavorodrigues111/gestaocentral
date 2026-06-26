// Catálogo de escalas nomeadas (reutilizáveis). Cadastra-se uma vez aqui e
// depois atribui-se a vários empregados (a atribuição faz snapshot dos dias
// numa vigência de workSchedules — ver HorariosTab). Editar a escala aqui NÃO
// mexe em quem já está vinculado.
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { WEEKDAYS, calcDayHours, fmtHHMM, emptyDays, validateWorkScheduleDays, isSunday } from "../../core/escala/horarios";
import type { EscalaNomeada, HorarioDia, SundayCycle } from "../../core/types";

type Days = { [k: number]: HorarioDia };
const totalDias = (days: Days): number =>
  WEEKDAYS.reduce((s, wd) => { const d = days[wd.idx]; return d?.active ? s + calcDayHours(d.in, d.out, d.break || 0).totalContract : s; }, 0);
const algumDiaAtivo = (days: Days): boolean => WEEKDAYS.some((wd) => days[wd.idx]?.active);

export function EscalasTab({ restaurantId }: { restaurantId: string }) {
  const [escalas, setEscalas] = useState<EscalaNomeada[]>([]);
  const [editar, setEditar] = useState<EscalaNomeada | null>(null);
  const [nova, setNova] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "escalasNomeadas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => setEscalas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EscalaNomeada)));
    return () => unsub();
  }, [restaurantId]);

  const ativas = useMemo(() => escalas.filter((e) => e.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [escalas]);
  const arquivadas = useMemo(() => escalas.filter((e) => !e.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [escalas]);

  async function arquivar(e: EscalaNomeada, ativo: boolean) {
    try { await updateDoc(doc(db, "escalasNomeadas", e.id), { ativo, atualizadoEm: new Date().toISOString() }); }
    catch (err) { setErro(err instanceof Error ? err.message : "Falha ao arquivar."); }
  }
  async function excluir(e: EscalaNomeada) {
    if (!window.confirm(`Excluir a escala "${e.nome}"?\n\nEmpregados já vinculados NÃO são afetados (a vigência deles é um snapshot). Some só do catálogo.`)) return;
    try { await deleteDoc(doc(db, "escalasNomeadas", e.id)); }
    catch (err) { setErro(err instanceof Error ? err.message : "Falha ao excluir."); }
  }

  const Card = ({ e }: { e: EscalaNomeada }) => (
    <div className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${e.ativo ? "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800" : "bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800 opacity-80"}`}>
      <button type="button" onClick={() => setEditar(e)} className="min-w-0 text-left flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{e.nome}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{e.type === "alternating" ? "Alternada A·B" : "Fixa"}</span>
          <span className="text-[11px] text-gray-500 tabular-nums">{fmtHHMM(e.totalContract)}/sem</span>
        </div>
        {e.descricao && <div className="text-[11px] text-gray-400 truncate mt-0.5">{e.descricao}</div>}
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="secondary" onClick={() => setEditar(e)}>✏️ Editar</Button>
        <Button size="sm" variant="secondary" onClick={() => void arquivar(e, !e.ativo)}>{e.ativo ? "📦 Arquivar" : "↩ Reativar"}</Button>
        <button type="button" onClick={() => void excluir(e)} title="Excluir" className="text-gray-400 hover:text-rose-600 px-1">🗑</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Cadastre escalas reutilizáveis e depois atribua a vários empregados na aba <strong>Horários</strong> de cada um.</p>
        <Button size="sm" onClick={() => setNova(true)}>+ Nova escala</Button>
      </div>
      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {ativas.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">Nenhuma escala cadastrada ainda. Crie a primeira em "+ Nova escala".</div>
      ) : (
        <div className="space-y-2">{ativas.map((e) => <Card key={e.id} e={e} />)}</div>
      )}

      {arquivadas.length > 0 && (
        <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">📦 Arquivadas <span className="text-gray-400 font-normal">({arquivadas.length})</span></summary>
          <div className="px-3 pb-3 space-y-2">{arquivadas.map((e) => <Card key={e.id} e={e} />)}</div>
        </details>
      )}

      {(nova || editar) && (
        <EscalaModal
          restaurantId={restaurantId}
          escala={editar}
          onClose={() => { setNova(false); setEditar(null); }}
          onSaved={() => { setNova(false); setEditar(null); }}
        />
      )}
    </div>
  );
}

// ─── Modal: criar/editar escala nomeada ─────────────────────────────────────
function EscalaModal({ restaurantId, escala, onClose, onSaved }: {
  restaurantId: string;
  escala: EscalaNomeada | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(escala?.nome || "");
  const [descricao, setDescricao] = useState(escala?.descricao || "");
  const [tipo, setTipo] = useState<"single" | "alternating">(escala?.type || "single");
  const [daysSingle, setDaysSingle] = useState<Days>(() => (escala?.type !== "alternating" && escala?.days) || emptyDays());
  const [cicloSingle, setCicloSingle] = useState<SundayCycle | null>(escala?.type !== "alternating" ? (escala?.sundayCycle ?? null) : null);
  const [daysA, setDaysA] = useState<Days>(() => (escala?.type === "alternating" && escala?.weeks?.A?.days) || emptyDays());
  const [daysB, setDaysB] = useState<Days>(() => (escala?.type === "alternating" && escala?.weeks?.B?.days) || emptyDays());
  const [cicloA, setCicloA] = useState<SundayCycle | null>((escala?.type === "alternating" ? escala?.weeks?.A?.sundayCycle : null) ?? null);
  const [cicloB, setCicloB] = useState<SundayCycle | null>((escala?.type === "alternating" ? escala?.weeks?.B?.sundayCycle : null) ?? null);
  const [editWeek, setEditWeek] = useState<"A" | "B">("A");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const days = tipo === "single" ? daysSingle : (editWeek === "A" ? daysA : daysB);
  const setDays = (updater: (d: Days) => Days) => {
    if (tipo === "single") setDaysSingle(updater);
    else if (editWeek === "A") setDaysA(updater);
    else setDaysB(updater);
  };
  const patchDia = (idx: number, patch: Partial<HorarioDia>) => setDays((d) => ({ ...d, [idx]: { ...(d[idx] || { active: false }), ...patch } }));
  const limparDia = (idx: number) => setDays((d) => ({ ...d, [idx]: { active: false } }));

  const validSingle = useMemo(() => validateWorkScheduleDays(daysSingle, 0, 99999), [daysSingle]);
  const validA = useMemo(() => validateWorkScheduleDays(daysA, 0, 99999), [daysA]);
  const validB = useMemo(() => validateWorkScheduleDays(daysB, 0, 99999), [daysB]);
  const errosAtuais = tipo === "single" ? validSingle.errors : (editWeek === "A" ? validA.errors : validB.errors);

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pra escala."); return; }
    if (tipo === "single" && !algumDiaAtivo(daysSingle)) { setErro("Marque ao menos um dia ativo."); return; }
    if (tipo === "alternating" && (!algumDiaAtivo(daysA) || !algumDiaAtivo(daysB))) { setErro("As duas semanas (A e B) precisam de ao menos um dia ativo."); return; }
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      const base = {
        restaurantId, nome: nome.trim(), descricao: descricao.trim() || undefined,
        type: tipo, ativo: escala?.ativo ?? true,
        criadoEm: escala?.criadoEm || agora, criadoPor: escala?.criadoPor || me?.id || "", atualizadoEm: agora,
      };
      let payload: Omit<EscalaNomeada, "id">;
      if (tipo === "single") {
        payload = { ...base, totalContract: totalDias(daysSingle), days: daysSingle, sundayCycle: cicloSingle || undefined };
      } else {
        const tA = totalDias(daysA), tB = totalDias(daysB);
        payload = {
          ...base, totalContract: Math.round((tA + tB) / 2),
          weeks: {
            A: { days: daysA, sundayCycle: cicloA || undefined, totalContract: tA },
            B: { days: daysB, sundayCycle: cicloB || undefined, totalContract: tB },
          },
        };
      }
      const limpo = sanitizeForFirestore(payload);
      if (escala) await updateDoc(doc(db, "escalasNomeadas", escala.id), limpo as Record<string, unknown>);
      else await addDoc(collection(db, "escalasNomeadas"), limpo);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar a escala.");
    } finally { setSalvando(false); }
  }

  const cargaAtual = tipo === "single" ? totalDias(daysSingle) : (totalDias(daysA) + totalDias(daysB)) / 2;
  return (
    <Modal title={escala ? "✏️ Editar escala" : "📆 Nova escala"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome da escala *" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Comercial 8h–17h" />
          <Input label="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex: Cozinha — folga aos domingos" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Tipo</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setTipo("single")} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${tipo === "single" ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>Fixa (toda semana igual)</button>
            <button type="button" onClick={() => setTipo("alternating")} className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${tipo === "alternating" ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>Alternada (semana A / semana B)</button>
          </div>
        </div>

        {tipo === "alternating" && (
          <div className="flex gap-2">
            {(["A", "B"] as const).map((w) => (
              <button key={w} type="button" onClick={() => setEditWeek(w)} className={`px-4 py-1.5 text-sm font-semibold rounded-lg border ${editWeek === w ? "border-indigo-400 bg-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600"}`}>Semana {w} <span className="font-normal opacity-80">({fmtHHMM(totalDias(w === "A" ? daysA : daysB))})</span></button>
            ))}
          </div>
        )}

        <DiasGrid days={days} onPatch={patchDia} onLimpar={limparDia} />
        {errosAtuais.length > 0 && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">{errosAtuais.map((er, i) => <div key={i}>⚠ {er.mensagem} <span className="opacity-60">({er.artigo})</span></div>)}</div>
        )}

        <CicloDomingo
          ciclo={tipo === "single" ? cicloSingle : (editWeek === "A" ? cicloA : cicloB)}
          onChange={(c) => { if (tipo === "single") setCicloSingle(c); else if (editWeek === "A") setCicloA(c); else setCicloB(c); }}
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[12px] text-gray-500">Carga semanal: <strong className="tabular-nums">{fmtHHMM(Math.round(cargaAtual))}</strong></span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar escala"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Grid de dias (entrada/saída/intervalo por dia da semana) ───────────────
function DiasGrid({ days, onPatch, onLimpar }: { days: Days; onPatch: (idx: number, patch: Partial<HorarioDia>) => void; onLimpar: (idx: number) => void }) {
  const cols = "grid-cols-[70px_50px_1fr_1fr_70px_70px_40px]";
  const inp = "w-full px-1 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50";
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className={`grid ${cols} gap-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400`}>
        <div>Dia</div><div className="text-center">Ativo</div><div className="text-center">Entrada</div><div className="text-center">Saída</div><div className="text-right">Interv.</div><div className="text-right">Contr.</div><div></div>
      </div>
      {WEEKDAYS.map((wd) => {
        const d = days[wd.idx] || { active: false };
        const calc = d.active ? calcDayHours(d.in, d.out, d.break || 0) : null;
        return (
          <div key={wd.idx} className={`grid ${cols} gap-1 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm`}>
            <div className="font-medium text-gray-700 dark:text-gray-300">{wd.short}</div>
            <div className="text-center"><input type="checkbox" checked={!!d.active} onChange={(e) => onPatch(wd.idx, { active: e.target.checked })} /></div>
            <div><input type="time" disabled={!d.active} value={d.in || ""} onChange={(e) => onPatch(wd.idx, { in: e.target.value })} className={inp} /></div>
            <div><input type="time" disabled={!d.active} value={d.out || ""} onChange={(e) => onPatch(wd.idx, { out: e.target.value })} className={inp} /></div>
            <div><input type="number" min="0" max="240" step="15" disabled={!d.active} value={d.break ?? ""} onChange={(e) => onPatch(wd.idx, { break: parseInt(e.target.value, 10) || 0 })} placeholder="min" className={`${inp} text-right`} /></div>
            <div className="text-right text-xs text-gray-700 dark:text-gray-300 tabular-nums">{calc ? fmtHHMM(calc.totalContract) : "—"}</div>
            <div className="text-center">{d.active && <button type="button" onClick={() => onLimpar(wd.idx)} title="Limpar" className="text-xs text-gray-400 hover:text-rose-600">✕</button>}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Ciclo de domingos (folga 1 a cada N) ───────────────────────────────────
function CicloDomingo({ ciclo, onChange }: { ciclo: SundayCycle | null; onChange: (c: SundayCycle | null) => void }) {
  const ativo = !!ciclo;
  const workCount = ciclo?.workCount ?? 3;
  const refDate = ciclo?.refDate ?? "";
  const refValido = refDate && isSunday(refDate);
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={ativo} onChange={(e) => onChange(e.target.checked ? { workCount: 3, offCount: 1, refDate: "" } : null)} />
        <span className="font-medium text-amber-900 dark:text-amber-300">🔁 Folga em ciclo de domingos</span>
      </label>
      {ativo && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Trabalha N domingos seguidos *</label>
            <input type="number" min="0" step="1" value={workCount} onChange={(e) => onChange({ ...ciclo!, workCount: parseInt(e.target.value, 10) || 0 })} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <p className="text-[11px] text-gray-500 mt-1">Trabalha {workCount} domingos · folga 1</p>
          </div>
          <div>
            <Input label="Primeiro domingo de FOLGA *" type="date" value={refDate} onChange={(e) => onChange({ ...ciclo!, refDate: e.target.value })} />
            {refDate && !refValido && <p className="text-[11px] text-rose-600 mt-1">⚠ A data tem que ser um domingo</p>}
          </div>
        </div>
      )}
    </div>
  );
}
