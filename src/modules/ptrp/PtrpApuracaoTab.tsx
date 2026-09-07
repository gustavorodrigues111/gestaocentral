// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Conferência / Apuração (prévia). Cruza as batidas sincronizadas
//  (ptrpBatidas) com o turno previsto (Escala, quando existir) e a CCT da
//  empresa, e mostra por colaborador × dia: batidas, trabalhado, extras,
//  noturno, atraso e exceções. Serve pra validar contra o Sólides (Fase 1).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import type { ParametrosCCT, PtrpTurno, PtrpEscalaMes, PtrpCelulaEscala } from "../../core/ptrp/tipos";
import { cctVigenteEm } from "../../core/ptrp/tipos";
import { apurarDia, minutoDoDiaBRT, type BatidaBloco } from "../../core/ptrp/apuracao";

type BatidaDoc = { id: string; empresaKey: string; employeeId?: string | null; cpf?: string | null; date?: string | null; dateIn?: number | null; dateOut?: number | null; excluded?: boolean; raw?: { employee?: { name?: string }; employeeName?: string; name?: string } };

const compAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const hm = (min: number) => min <= 0 ? "0h00" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const hhmm = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const nomeDe = (b: BatidaDoc) => b.raw?.employee?.name || b.raw?.employeeName || b.raw?.name || b.cpf || b.employeeId || "—";
const EXC_LABEL: Record<string, string> = { sem_batida: "sem batida", falta: "falta", fora_escala: "fora de escala", batida_impar: "batida ímpar", atraso: "atraso", intervalo_curto: "intervalo curto", jornada_longa: "jornada > limite", interjornada: "interjornada < mín." };

export function PtrpApuracaoTab() {
  const { pessoa: me } = useAuth();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [comp, setComp] = useState(compAtual());
  const [batidas, setBatidas] = useState<BatidaDoc[]>([]);
  const [turnos, setTurnos] = useState<PtrpTurno[]>([]);
  const [escala, setEscala] = useState<PtrpEscalaMes | null>(null);
  const [ccts, setCcts] = useState<ParametrosCCT[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => onSnapshot(collection(db, "ptrpSyncState"), s => { const ks = s.docs.map(d => d.id).sort(); setEmpresas(ks); setEmpresa(e => e || ks[0] || ""); }), []);
  useEffect(() => onSnapshot(collection(db, "parametrosCCT"), s => setCcts(s.docs.map(d => ({ id: d.id, ...d.data() }) as ParametrosCCT))), []);
  useEffect(() => { if (!empresa) return; return onSnapshot(collection(db, "ptrpTurnos"), s => setTurnos(s.docs.map(d => ({ id: d.id, ...d.data() }) as PtrpTurno).filter(t => t.empresaKey === empresa))); }, [empresa]);
  useEffect(() => { if (!empresa || !comp) return; return onSnapshot(doc(db, "ptrpEscalas", `${empresa}_${comp}`), d => setEscala(d.exists() ? ({ id: d.id, ...d.data() } as PtrpEscalaMes) : null)); }, [empresa, comp]);
  useEffect(() => {
    if (!empresa || !comp) { setBatidas([]); return; }
    const q = query(collection(db, "ptrpBatidas"), where("empresaKey", "==", empresa), where("date", ">=", `${comp}-01`), where("date", "<=", `${comp}-99`));
    return onSnapshot(q, s => setBatidas(s.docs.map(d => ({ id: d.id, ...d.data() }) as BatidaDoc)), () => setBatidas([]));
  }, [empresa, comp]);

  const turnoById = useMemo(() => Object.fromEntries(turnos.map(t => [t.id, t])), [turnos]);
  const cct = useMemo(() => cctVigenteEm(ccts, empresa, `${comp}-15`), [ccts, empresa, comp]);

  // Agrupa por colaborador → dia → batidas, e apura.
  const porColab = useMemo(() => {
    const m: Record<string, { nome: string; dias: Record<string, BatidaDoc[]> }> = {};
    for (const b of batidas) {
      const k = String(b.employeeId || b.cpf || b.id);
      if (!m[k]) m[k] = { nome: nomeDe(b), dias: {} };
      const d = b.date || "";
      (m[k].dias[d] = m[k].dias[d] || []).push(b);
    }
    return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [batidas]);

  function apurarColab(colabId: string, dias: Record<string, BatidaDoc[]>) {
    const linhas = Object.entries(dias).sort(([a], [b]) => a.localeCompare(b)).map(([data, bs]) => {
      const dia = data.slice(-2);
      const cel = escala?.grade?.[colabId]?.[dia] as PtrpCelulaEscala | undefined;
      const turno = cel && "turnoId" in cel ? (turnoById[cel.turnoId] || null) : null;
      const temEscala = !!cel;
      const blocos: BatidaBloco[] = bs.filter(b => !b.excluded).map(b => ({ dateIn: b.dateIn as number, dateOut: (b.dateOut ?? null) as number | null }));
      const ehDomingo = new Date(`${data}T12:00:00`).getDay() === 0;
      const ap = cct ? apurarDia({ data, blocos, turno, cct, ehDomingo }) : null;
      // Sem CCT ou sem escala: mostra ao menos o trabalhado bruto.
      const trabalhado = blocos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      return { data, bs, ap, temEscala, trabalhado };
    });
    const totExtra = linhas.reduce((s, l) => s + (l.ap?.minutosExtras || 0), 0);
    const totTrab = linhas.reduce((s, l) => s + (l.ap?.minutosTrabalhados || l.trabalhado), 0);
    const totNot = linhas.reduce((s, l) => s + (l.ap?.noturnoMin || 0), 0);
    const exc = linhas.reduce((s, l) => s + (l.ap?.excecoes.length || 0), 0);
    return { linhas, totExtra, totTrab, totNot, exc };
  }

  if (!me?.isMaster) return <div className="p-8 text-center text-gray-500">🔒 Só o master.</div>;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={empresa} onChange={e => setEmpresa(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
          {empresas.length === 0 && <option value="">— sem empresas —</option>}
          {empresas.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="month" value={comp} onChange={e => setComp(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
        {!cct && <span className="text-xs text-amber-600 dark:text-amber-400">⚠ Sem CCT p/ esta empresa — configure na aba Convenções (extras/noturno não calculam).</span>}
        {!escala && <span className="text-xs text-gray-400">Sem escala p/ {comp} — mostra o trabalhado bruto (defina a escala pra calcular folga/falta/extra).</span>}
      </div>

      {porColab.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhuma batida sincronizada em {comp} para <strong>{empresa || "—"}</strong>. Rode o sync (aba Sincronização) — use "Rebuscar desde" se precisar de um mês antigo.</div>
      ) : (
        <div className="space-y-2">
          {porColab.map(c => {
            const r = apurarColab(c.id, c.dias);
            const on = aberto === c.id;
            return (
              <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <button type="button" onClick={() => setAberto(on ? null : c.id)} className="w-full flex items-center justify-between gap-2 p-3 text-left">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{c.nome}</div>
                    <div className="text-[11px] text-gray-500">{Object.keys(c.dias).length} dias · trabalhado {hm(r.totTrab)}{r.totExtra ? ` · extra ${hm(r.totExtra)}` : ""}{r.totNot ? ` · noturno ${hm(r.totNot)}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.exc > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{r.exc} exceç.</span>}
                    <span className="text-gray-400 text-xs">{on ? "▲" : "▼"}</span>
                  </div>
                </button>
                {on && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 overflow-x-auto">
                    <table className="w-full text-[12px] min-w-[520px]">
                      <thead><tr className="text-gray-400 text-left"><th className="py-1 font-medium">Dia</th><th className="font-medium">Batidas</th><th className="font-medium text-right">Trab.</th><th className="font-medium text-right">Extra</th><th className="font-medium text-right">Not.</th><th className="font-medium">Exceções</th></tr></thead>
                      <tbody>
                        {r.linhas.map(l => (
                          <tr key={l.data} className="border-t border-gray-50 dark:border-gray-800/50">
                            <td className="py-1 tabular-nums text-gray-600 dark:text-gray-300">{l.data.slice(-2)}/{l.data.slice(5, 7)}</td>
                            <td className="text-gray-700 dark:text-gray-200">{l.bs.map((b, i) => <span key={i} className={b.excluded ? "line-through text-gray-400" : ""}>{i > 0 ? " · " : ""}{hhmm(b.dateIn)}–{hhmm(b.dateOut)}</span>)}</td>
                            <td className="text-right tabular-nums">{hm(l.ap?.minutosTrabalhados ?? l.trabalhado)}</td>
                            <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{l.ap?.minutosExtras ? hm(l.ap.minutosExtras) : ""}</td>
                            <td className="text-right tabular-nums text-indigo-500">{l.ap?.noturnoMin ? hm(l.ap.noturnoMin) : ""}</td>
                            <td>{(l.ap?.excecoes || []).map(e => <span key={e} className="inline-block mr-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{EXC_LABEL[e] || e}</span>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.linhas.some(l => l.ap) && <p className="text-[10px] text-gray-400 mt-1.5">Extras por faixa e adicionais seguem a CCT {cct?.cctNome}. Prévia — validar contra o Sólides antes de oficializar.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
