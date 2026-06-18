// ════════════════════════════════════════════════════════════════════════════
//  Aba "Escalas" — compara a escala CADASTRADA no Sólides (currentWorkSchedule)
//  com a cadastrada no planejamento.app, por empregado (casado por CPF).
//
//  Comparação por CARGA POR DIA DA SEMANA (minutos previstos), que é robusta a
//  diferenças de formato. Marca quem é cíclico (doubleBindEmployee) — nesses, a
//  API só expõe o ciclo ATUAL, então a comparação é do estado vigente (a config
//  completa do ciclo não vem na API; registrar no app fecha isso depois).
//
//  Tudo vem do CADASTRO (Sólides + app), nunca das batidas.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Area, Cargo, Empregado, HorarioDia, Restaurant, WorkSchedule } from "../../core/types";
import { fetchScheduleCatalog, fetchRoster } from "../../core/ponto/solidesPontoClient";
import type { PontoColaborador, PontoEscala } from "../../core/ponto/analise";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");
const fmtH = (min: number) => (min <= 0 ? "—" : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);
function timeToMin(s?: string): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

// Sólides currentWorkSchedule → minutos por dia da semana (idx 0=Dom..6=Sáb).
// O catálogo traz day 1=Dom..7=Sáb e turnos em ms desde a meia-noite.
function minutosSolides(sched: PontoEscala | undefined): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const tt of sched?.workScheduleTimetableList || []) {
    if (typeof tt.day !== "number") continue;
    const idx = tt.day - 1; // 1=Dom → 0
    if (idx < 0 || idx > 6) continue;
    for (const [a, b] of [["startShift1", "endShift1"], ["startShift2", "endShift2"]] as const) {
      const s = tt[a]; const e = tt[b];
      if (typeof s === "number" && typeof e === "number") out[idx] += Math.round((e - s) / 60000);
    }
  }
  return out;
}

// HorarioDia → minutos (trata virada de dia: out < in → +24h).
function minutosDia(d?: HorarioDia): number {
  if (!d?.active) return 0;
  const i = timeToMin(d.in); let o = timeToMin(d.out);
  if (i == null || o == null) return 0;
  if (o < i) o += 1440;
  return Math.max(0, o - i - (d.break || 0));
}

// Qual semana (A/B) está vigente hoje numa escala alternante (via anchor).
function semanaVigente(ws: WorkSchedule, hoje: Date): "A" | "B" | null {
  if (ws.type !== "alternating" || !ws.weeks || !ws.anchor) return null;
  const ref = new Date(ws.anchor.date + "T00:00:00");
  const semanas = Math.floor((hoje.getTime() - ref.getTime()) / (7 * 86400000));
  const ehAncora = semanas % 2 === 0;
  return ehAncora ? ws.anchor.week : (ws.anchor.week === "A" ? "B" : "A");
}

// App WorkSchedule → minutos por dia da semana (idx 0=Dom..6=Sáb), resolvendo
// a semana vigente hoje pra escalas alternadas (A/B via anchor).
function minutosApp(ws: WorkSchedule | undefined, hoje: Date): number[] {
  if (!ws) return [0, 0, 0, 0, 0, 0, 0];
  let days = ws.days;
  const semana = semanaVigente(ws, hoje);
  if (semana && ws.weeks) days = ws.weeks[semana]?.days;
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (let wd = 0; wd < 7; wd++) out[wd] = minutosDia(days?.[wd]);
  return out;
}

function escalaAppVigente(emp: Empregado, hoje: string): WorkSchedule | undefined {
  const arr = (emp.workSchedules || []).filter((w) => w.validFrom <= hoje);
  if (arr.length === 0) return emp.workSchedules?.[0];
  return arr.sort((a, b) => a.validFrom.localeCompare(b.validFrom))[arr.length - 1];
}

export function EscalasComparacaoTab({ rid, activeRestaurant }: { rid: string; activeRestaurant: Restaurant }) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [catalogo, setCatalogo] = useState<PontoEscala[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [carregou, setCarregou] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)));
    const u2 = onSnapshot(collection(db, "cargos"),
      (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)));
    return () => { u1(); u2(); };
  }, [rid]);

  async function carregar() {
    const shortCode = activeRestaurant.shortCode || "";
    if (!shortCode) { setErro("Restaurante sem shortCode."); return; }
    setErro(""); setCarregando(true);
    try {
      const [cat, ros] = await Promise.all([fetchScheduleCatalog(shortCode), fetchRoster(shortCode)]);
      setCatalogo(cat); setRoster(ros); setCarregou(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar escalas.");
    } finally { setCarregando(false); }
  }

  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);
  const catById = useMemo(() => {
    const m = new Map<number, PontoEscala>();
    for (const c of catalogo) if (c.id != null) m.set(c.id, c);
    return m;
  }, [catalogo]);
  const cargoArea = useMemo(() => {
    const m = new Map<string, Area>();
    for (const c of cargos) m.set(c.id, c.area);
    return m;
  }, [cargos]);
  const empAppPorCpf = useMemo(() => {
    const m = new Map<string, Empregado>();
    for (const e of empregados) { const c = soDigitos(e.cpf); if (c) m.set(c, e); }
    return m;
  }, [empregados]);

  // Só colaboradores ATIVOS (não demitidos) entram na comparação.
  const linhas = useMemo(() => {
    return roster
      .filter((r) => !r.fired)
      .map((r) => {
        const solSched = catById.get(r.currentWorkSchedule?.id ?? -1);
        const minSol = minutosSolides(solSched);
        const appEmp = empAppPorCpf.get(soDigitos(r.cpf));
        const area = appEmp ? cargoArea.get(appEmp.cargoId) : undefined;
        const wsApp = appEmp ? escalaAppVigente(appEmp, hojeStr) : undefined;
        // A API do Sólides não expõe o ciclo. O cíclico é conhecido pelo CADASTRO
        // do app: escala alternante (A/B). (doubleBindEmployee fica como sinal extra.)
        const ciclico = wsApp?.type === "alternating" || !!r.doubleBindEmployee;
        const semanaCiclo = ciclico && wsApp?.type === "alternating" ? semanaVigente(wsApp, hoje) : null;
        const minApp = minutosApp(wsApp, hoje);
        const temApp = !!appEmp;
        const divergeDias = temApp ? DIAS.map((_, wd) => minSol[wd] !== minApp[wd]) : [];
        const totalSol = minSol.reduce((a, b) => a + b, 0);
        const totalApp = minApp.reduce((a, b) => a + b, 0);
        const bate = temApp && divergeDias.every((x) => !x);
        return { r, ciclico, semanaCiclo, solSched, minSol, appEmp, area, minApp, temApp, divergeDias, totalSol, totalApp, bate };
      })
      .sort((a, b) => (a.r.name || "").localeCompare(b.r.name || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, catById, empAppPorCpf, cargoArea, hojeStr]);

  if (!carregou && !carregando) {
    return (
      <div className="text-center py-12">
        <button type="button" onClick={() => void carregar()}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
          🗓️ Comparar escalas (Sólides × app)
        </button>
        <p className="text-[11px] text-gray-400 mt-2">Compara a escala cadastrada no Sólides com a do planejamento.app, por colaborador.</p>
      </div>
    );
  }
  if (carregando) return <div className="text-center text-sm text-gray-400 py-12">Carregando escalas…</div>;
  if (erro) return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>;

  const divergentes = linhas.filter((l) => l.temApp && !l.bate).length;
  const semApp = linhas.filter((l) => !l.temApp).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>{linhas.length} colaborador(es)</span>
        <span className="text-red-600">{divergentes} divergente(s)</span>
        <span className="text-amber-600">{semApp} sem vínculo no app</span>
        <button type="button" onClick={() => void carregar()} className="ml-auto text-indigo-600 hover:underline">↻ recarregar</button>
      </div>

      <div className="space-y-2">
        {linhas.map((l) => (
          <div key={l.r.id} className={`rounded-xl border p-3 ${l.temApp ? (l.bate ? "border-gray-200 dark:border-gray-800" : "border-red-200 dark:border-red-900/50") : "border-amber-200 dark:border-amber-900/50"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{l.r.name}</span>
              {l.area && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{l.area}</span>}
              {l.ciclico && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300" title="Escala alternante (cíclica) — comparando a semana vigente">🔁 cíclico{l.semanaCiclo ? ` · semana ${l.semanaCiclo}` : ""}</span>}
              {!l.temApp && <span className="text-[10px] text-amber-600 ml-auto">sem empregado vinculado no app (CPF)</span>}
              {l.temApp && (l.bate
                ? <span className="text-[11px] text-emerald-600 ml-auto">✓ batem</span>
                : <span className="text-[11px] text-red-600 ml-auto">⚠ divergem</span>)}
            </div>

            {/* Grade semanal: Sólides × app */}
            <div className="mt-2 grid grid-cols-8 gap-1 text-center text-[10px]">
              <div />
              {DIAS.map((d) => <div key={d} className="font-semibold text-gray-400">{d}</div>)}
              <div className="text-left text-[10px] text-gray-500 self-center">Sólides</div>
              {l.minSol.map((m, wd) => (
                <div key={`s${wd}`} className={`py-1 rounded ${l.temApp && l.divergeDias[wd] ? "bg-red-50 text-red-700 dark:bg-red-950/40" : "bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300"}`}>{fmtH(m)}</div>
              ))}
              <div className="text-left text-[10px] text-gray-500 self-center">app</div>
              {l.temApp
                ? l.minApp.map((m, wd) => (
                    <div key={`a${wd}`} className={`py-1 rounded ${l.divergeDias[wd] ? "bg-red-50 text-red-700 dark:bg-red-950/40" : "bg-gray-50 dark:bg-gray-800/40 text-gray-700 dark:text-gray-300"}`}>{fmtH(m)}</div>
                  ))
                : DIAS.map((_, wd) => <div key={`a${wd}`} className="py-1 rounded bg-gray-50 dark:bg-gray-800/40 text-gray-300">—</div>)}
            </div>
            <div className="mt-1 text-[10px] text-gray-400">
              Carga semanal — Sólides: {fmtH(l.totalSol)} {l.temApp ? `· app: ${fmtH(l.totalApp)}` : ""}
              {l.ciclico ? ` · cíclico: comparando a semana ${l.semanaCiclo ?? "vigente"} (a Sólides só expõe o ciclo atual; o ciclo completo está no cadastro alternante do app)` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
