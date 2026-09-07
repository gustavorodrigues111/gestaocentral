// ════════════════════════════════════════════════════════════════════════════
//  PTRP · Conferência / Apuração (prévia). Cruza as batidas sincronizadas
//  (ptrpBatidas, por shortCode = empresa) com o HORÁRIO PREVISTO do cadastro do
//  empregado (workSchedules — casado por CPF) e a CCT, e apura por colaborador
//  × dia. Não exige re-cadastro de turno: o previsto vem do vínculo/escala do
//  empregado (mesma fonte da Análise de Ponto). ptrpTurnos/ptrpEscalas ficam
//  como OVERRIDE opcional (fase seguinte). Valida contra o Sólides (Fase 1).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Empregado, HorarioDia } from "../../core/types";
import type { ParametrosCCT, PtrpTurno } from "../../core/ptrp/tipos";
import { cctVigenteEm } from "../../core/ptrp/tipos";
import { getActiveWorkSchedule, getEffectiveDays } from "../../core/escala/horarios";
import { apurarDia, minutoDoDiaBRT, type BatidaBloco } from "../../core/ptrp/apuracao";

type BatidaDoc = { id: string; empresaKey: string; cpf?: string | null; date?: string | null; dateIn?: number | null; dateOut?: number | null; excluded?: boolean; raw?: { employee?: { name?: string }; employeeName?: string } };

const compAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const hm = (min: number) => min <= 0 ? "0h00" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const hhmm = (ms?: number | null) => { if (ms == null) return "—"; const t = minutoDoDiaBRT(ms); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
const EXC_LABEL: Record<string, string> = { sem_batida: "sem batida", falta: "falta", fora_escala: "fora de escala", batida_impar: "batida ímpar", atraso: "atraso", intervalo_curto: "intervalo curto", jornada_longa: "jornada > limite", interjornada: "interjornada < mín." };

// Previsto do dia a partir do cadastro do empregado (workSchedules). null = folga.
function turnoPrevisto(emp: Empregado, date: string): { kind: "trabalho" | "folga" | "implicito"; turno: PtrpTurno | null } {
  const ws = getActiveWorkSchedule(emp.workSchedules, date);
  if (!ws) return { kind: "implicito", turno: null };
  const days = getEffectiveDays(ws, date) as Record<number, HorarioDia> | null;
  if (!days) return { kind: "implicito", turno: null };
  const dow = new Date(date + "T12:00:00").getDay();
  const hd = days[dow];
  if (!hd || !hd.active || !hd.in || !hd.out) return { kind: "folga", turno: null };
  const partido = !!(hd.intervalIn && hd.intervalOut);
  const janelas = partido ? [{ in: hd.in, out: hd.intervalIn! }, { in: hd.intervalOut!, out: hd.out }] : [{ in: hd.in, out: hd.out }];
  const turno: PtrpTurno = { id: "prev", empresaKey: "", nome: "previsto", janelas, intervaloMin: partido ? 0 : (hd.break || 0), toleranciaEntradaMin: 5, adicionalNoturno: false };
  return { kind: "trabalho", turno };
}

export function PtrpApuracaoTab() {
  const { pessoa: me } = useAuth();
  // Segue o restaurante ATIVO do sistema (seletor global), como a Análise de Ponto.
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id || "";
  const shortCode = (activeRestaurant as { shortCode?: string } | null)?.shortCode || "";
  const [comp, setComp] = useState(compAtual());
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<{ id: string; area?: string }[]>([]);
  const [batidas, setBatidas] = useState<BatidaDoc[]>([]);
  const [ccts, setCcts] = useState<ParametrosCCT[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => onSnapshot(collection(db, "parametrosCCT"), s => setCcts(s.docs.map(d => ({ id: d.id, ...d.data() }) as ParametrosCCT))), []);
  useEffect(() => {
    if (!rid) { setEmpregados([]); setCargos([]); return; }
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), s => setEmpregados(s.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const u2 = onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)), s => setCargos(s.docs.map(d => ({ id: d.id, ...(d.data() as { area?: string }) }))));
    return () => { u1(); u2(); };
  }, [rid]);
  useEffect(() => {
    if (!shortCode || !comp) { setBatidas([]); return; }
    const q = query(collection(db, "ptrpBatidas"), where("empresaKey", "==", shortCode), where("date", ">=", `${comp}-01`), where("date", "<=", `${comp}-99`));
    return onSnapshot(q, s => setBatidas(s.docs.map(d => ({ id: d.id, ...d.data() }) as BatidaDoc)), () => setBatidas([]));
  }, [shortCode, comp]);

  const cct = useMemo(() => cctVigenteEm(ccts, shortCode, `${comp}-15`), [ccts, shortCode, comp]);
  const [ano, mes] = comp.split("-").map(Number);
  const diasDoMes = new Date(ano, mes, 0).getDate();

  const areaDoCargo = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c.area || ""])), [cargos]);
  const areaDoEmp = (e: Empregado) => areaDoCargo[e.cargoId] || "";
  const empVis = useMemo(() => [...empregados].sort((a, b) => a.nome.localeCompare(b.nome)), [empregados]);

  // Batidas por CPF → dia.
  const batidasPorCpf = useMemo(() => {
    const m: Record<string, Record<string, BatidaDoc[]>> = {};
    for (const b of batidas) { const c = soDig(b.cpf); if (!c) continue; (m[c] = m[c] || {}); (m[c][b.date || ""] = m[c][b.date || ""] || []).push(b); }
    return m;
  }, [batidas]);

  function apurarColab(emp: Empregado) {
    const cpf = soDig(emp.cpf);
    const dias = batidasPorCpf[cpf] || {};
    const linhas: { data: string; bs: BatidaDoc[]; previstoTxt: string; trabalhado: number; extra: number; noturno: number; excecoes: string[] }[] = [];
    for (let d = 1; d <= diasDoMes; d++) {
      const data = `${comp}-${String(d).padStart(2, "0")}`;
      const bs = dias[data] || [];
      const prev = turnoPrevisto(emp, data);
      if (prev.kind === "folga" && bs.length === 0) continue;                 // folga tranquila — não polui
      if (prev.kind === "implicito" && bs.length === 0) continue;
      const blocos: BatidaBloco[] = bs.filter(b => !b.excluded).map(b => ({ dateIn: b.dateIn as number, dateOut: (b.dateOut ?? null) as number | null }));
      const ehDomingo = new Date(data + "T12:00:00").getDay() === 0;
      let trabalhado = 0, extra = 0, noturno = 0, excecoes: string[] = [], previstoTxt = "—";
      if (prev.kind === "trabalho" && prev.turno) previstoTxt = prev.turno.janelas.map(j => `${j.in}–${j.out}`).join(" ");
      else if (prev.kind === "folga") previstoTxt = "folga";
      else previstoTxt = "sem cadastro";
      if (cct && prev.kind !== "implicito") {
        const ap = apurarDia({ data, blocos, turno: prev.turno, cct, ehDomingo });
        trabalhado = ap.minutosTrabalhados; extra = ap.minutosExtras; noturno = ap.noturnoMin; excecoes = ap.excecoes;
      } else {
        trabalhado = blocos.reduce((s, b) => s + (b.dateOut != null ? Math.max(0, minutoDoDiaBRT(b.dateOut) - minutoDoDiaBRT(b.dateIn)) : 0), 0);
      }
      linhas.push({ data, bs, previstoTxt, trabalhado, extra, noturno, excecoes });
    }
    return { linhas, temCpf: !!cpf, totTrab: linhas.reduce((s, l) => s + l.trabalhado, 0), totExtra: linhas.reduce((s, l) => s + l.extra, 0), totNot: linhas.reduce((s, l) => s + l.noturno, 0), exc: linhas.reduce((s, l) => s + l.excecoes.length, 0) };
  }

  const cpfsComEmpregado = useMemo(() => new Set(empregados.map(e => soDig(e.cpf)).filter(Boolean)), [empregados]);
  const batidasSemCadastro = useMemo(() => Object.keys(batidasPorCpf).filter(c => !cpfsComEmpregado.has(c)), [batidasPorCpf, cpfsComEmpregado]);

  // Apura todo mundo e agrupa por ÁREA (colunas), como o Fechamento de ponto.
  const resultados = useMemo(() => empVis.map(emp => ({ emp, area: areaDoEmp(emp) || "Sem área", r: apurarColab(emp) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empVis, batidasPorCpf, cct, comp, areaDoCargo]);
  const porArea = useMemo(() => {
    const m = new Map<string, typeof resultados>();
    for (const x of resultados) { const a = m.get(x.area) || []; a.push(x); m.set(x.area, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [resultados]);
  const sel = resultados.find(x => x.emp.id === aberto) || null;

  if (!me?.isMaster) return <div className="p-8 text-center text-gray-500">🔒 Só o master.</div>;

  if (!shortCode) return <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">O restaurante ativo (<strong>{activeRestaurant?.nome || "—"}</strong>) não tem <strong>shortCode</strong> do Sólides configurado. Troque de restaurante no seletor do topo, ou configure o shortCode.</div>;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{activeRestaurant?.nome} · {shortCode}</span>
        <input type="month" value={comp} onChange={e => setComp(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
        {!cct && <span className="text-xs text-amber-600 dark:text-amber-400">⚠ Sem CCT — configure em Convenções (extras/noturno não calculam).</span>}
      </div>
      <div className="text-[12px] rounded-lg px-3 py-2 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
        Escolha um colaborador pelo chip. <span className="font-semibold text-emerald-700 dark:text-emerald-300">✓ verde</span> = sem exceções · <span className="font-semibold text-amber-700 dark:text-amber-300">● amarelo</span> = tem exceções a tratar · <span className="font-semibold text-gray-400">○ cinza</span> = sem batidas / sem CPF. Previsto vem do cadastro do empregado; prévia — validar contra o Sólides.
      </div>

      {empVis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhum empregado neste restaurante.</div>
      ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {porArea.map(([area, cols]) => {
            const comExc = cols.filter(c => c.r.exc > 0).length;
            return (
              <div key={area} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{area}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{comExc}/{cols.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {cols.map(({ emp, r }) => {
                    const st = !r.temCpf || r.linhas.length === 0 ? "sem" : r.exc > 0 ? "exc" : "ok";
                    const selado = emp.id === aberto;
                    const cls = st === "ok" ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800"
                      : st === "exc" ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
                      : "bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800/40 dark:border-gray-700";
                    const naoBate = (emp as { batePonto?: boolean }).batePonto === false;
                    const freela = !!(emp as { freelaMensalista?: boolean }).freelaMensalista;
                    return (
                      <button key={emp.id} type="button" onClick={() => setAberto(selado ? null : emp.id)}
                        title={st === "sem" ? "Sem batidas / sem CPF" : st === "exc" ? `${r.exc} exceção(ões)` : "Sem exceções"}
                        className={`text-left text-xs px-2 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors hover:brightness-95 ${cls} ${selado ? "ring-2 ring-indigo-500" : ""}`}>
                        <span className="shrink-0">{st === "ok" ? "✓" : st === "exc" ? "●" : "○"}</span>
                        <span className="truncate flex-1">{freela ? "🗓️ " : naoBate ? "🎩 " : ""}{emp.nome}</span>
                        {r.exc > 0 && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 tabular-nums">{r.exc}</span>}
                        {(naoBate || freela) && <span className="shrink-0 text-[9px] font-bold px-1 rounded bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200">{freela ? "FREELA" : "S/ PONTO"}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {sel && (
          <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{sel.emp.nome} <span className="text-[11px] font-normal text-gray-500">· {sel.area}</span></div>
              <div className="text-[11px] text-gray-500 shrink-0">trab. {hm(sel.r.totTrab)}{sel.r.totExtra ? ` · extra ${hm(sel.r.totExtra)}` : ""}{sel.r.totNot ? ` · not. ${hm(sel.r.totNot)}` : ""}</div>
            </div>
            <div className="px-3 py-2 overflow-x-auto">
              {sel.r.linhas.length === 0 ? <div className="text-sm text-gray-400 py-4 text-center">Sem batidas nem dias previstos de trabalho em {comp}.</div> : (
              <table className="w-full text-[12px] min-w-[620px]">
                <thead><tr className="text-gray-400 text-left"><th className="py-1 font-medium">Dia</th><th className="font-medium">Previsto</th><th className="font-medium">Batidas</th><th className="font-medium text-right">Trab.</th><th className="font-medium text-right">Extra</th><th className="font-medium text-right">Not.</th><th className="font-medium">Exceções</th></tr></thead>
                <tbody>
                  {sel.r.linhas.map(l => (
                    <tr key={l.data} className={`border-t border-gray-50 dark:border-gray-800/50 ${l.excecoes.includes("falta") ? "bg-rose-50/40 dark:bg-rose-900/10" : ""}`}>
                      <td className="py-1 tabular-nums text-gray-600 dark:text-gray-300">{l.data.slice(-2)}/{l.data.slice(5, 7)}</td>
                      <td className="text-gray-500">{l.previstoTxt}</td>
                      <td className="text-gray-700 dark:text-gray-200">{l.bs.length ? l.bs.map((b, i) => <span key={i} className={b.excluded ? "line-through text-gray-400" : ""}>{i > 0 ? " · " : ""}{hhmm(b.dateIn)}–{hhmm(b.dateOut)}</span>) : <span className="text-gray-400">—</span>}</td>
                      <td className="text-right tabular-nums">{hm(l.trabalhado)}</td>
                      <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{l.extra ? hm(l.extra) : ""}</td>
                      <td className="text-right tabular-nums text-indigo-500">{l.noturno ? hm(l.noturno) : ""}</td>
                      <td>{l.excecoes.map(e => <span key={e} className="inline-block mr-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{EXC_LABEL[e] || e}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>)}
            </div>
          </div>
        )}
        {batidasSemCadastro.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10 p-3 text-[12px] text-amber-800 dark:text-amber-300">
            ⚠ {batidasSemCadastro.length} pessoa(s) com batida mas <strong>sem empregado cadastrado</strong> neste restaurante (CPF não casou).
          </div>
        )}
        </>
      )}
    </div>
  );
}
