// ════════════════════════════════════════════════════════════════════════════
//  Aba "Escalas" — compara a escala CADASTRADA no Sólides (currentWorkSchedule)
//  com a cadastrada no planejamento.app, por empregado (casado por CPF).
//
//  Mostra, por dia da semana, tanto o HORÁRIO cadastrado (entrada / intervalo /
//  saída) quanto a CARGA (minutos previstos) de cada fonte. Um seletor no topo
//  alterna entre ver só o Sólides, só o planejamento.app, ou comparar os dois.
//
//  Na comparação, três tipos de divergência são destacados por dia:
//    ⏰ horário diferente  (mesma carga pode ter horário distinto: 08–17 × 09–18)
//    ⏱ carga diferente     (total de minutos do dia difere)
//    ➖ só num lado         (um lado tem escala, o outro está de folga)
//
//  Cíclico (doubleBindEmployee / escala alternante A-B): a API do Sólides só
//  expõe o ciclo ATUAL, então a comparação é do estado vigente hoje.
//  Tudo vem do CADASTRO (Sólides + app), nunca das batidas.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Cargo, Empregado, HorarioDia, Restaurant, TipoVinculo, WorkSchedule } from "../../core/types";
import { defaultBatePontoPorVinculo, empregadoBatePonto } from "../../core/types";
import { fetchScheduleCatalog, fetchRoster } from "../../core/ponto/solidesPontoClient";
import type { PontoColaborador, PontoEscala } from "../../core/ponto/analise";
import { gerarEscalasPDF, type EscalaPDFLinha } from "./gerarEscalasPDF";
import { baixarOuCompartilhar } from "../../core/pdf/baixarOuCompartilhar";

const VINCULO_LABEL: Record<TipoVinculo, string> = {
  registrado: "CLT", provisorio: "provisório", estagiario: "estagiário", terceirizado: "terceirizado",
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");
const fmtH = (min: number) => (min <= 0 ? "—" : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);
const minToHHMM = (min: number) => {
  const m = (((Math.round(min) % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
function timeToMin(s?: string): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

type FonteSel = "comparar" | "solides" | "app";

// Horário de UM dia, de UMA fonte, já normalizado pra exibir e comparar.
type DiaFonte = {
  ativo: boolean;        // false = folga / sem escala
  label: string;         // "08:00–12:00 / 13:00–17:00" | "folga"
  entrada: number | null; // min desde a meia-noite (null = folga)
  saida: number | null;   // min (pode passar de 1440 no overnight do app)
  breakMin: number;       // intervalo em minutos
  carga: number;          // minutos trabalhados no dia
};

const FOLGA: DiaFonte = { ativo: false, label: "folga", entrada: null, saida: null, breakMin: 0, carga: 0 };

// Sólides: turno de um dia (ms desde a meia-noite) → DiaFonte.
// O catálogo traz day 1=Dom..7=Sáb e até 2 turnos (shift1 antes do intervalo,
// shift2 depois). O intervalo é o gap entre o fim do shift1 e o início do shift2.
function solidesDia(sched: PontoEscala | undefined, wd: number): DiaFonte {
  const tt = (sched?.workScheduleTimetableList || []).find((t) => t.day === wd + 1);
  if (!tt) return FOLGA;
  const seg: [number, number][] = [];
  for (const [a, b] of [["startShift1", "endShift1"], ["startShift2", "endShift2"]] as const) {
    const s = tt[a]; const e = tt[b];
    if (typeof s === "number" && typeof e === "number") seg.push([Math.round(s / 60000), Math.round(e / 60000)]);
  }
  if (!seg.length) return FOLGA;
  const entrada = seg[0][0];
  const saida = seg[seg.length - 1][1];
  const carga = seg.reduce((a, [x, y]) => a + Math.max(0, y - x), 0);
  const breakMin = seg.length > 1 ? Math.max(0, seg[1][0] - seg[0][1]) : 0;
  const label = seg.map(([x, y]) => `${minToHHMM(x)}–${minToHHMM(y)}`).join(" / ");
  return { ativo: true, label, entrada, saida, breakMin, carga };
}

// planejamento.app: HorarioDia → DiaFonte (trata virada de dia; usa os horários
// de intervalo quando existem, senão o break em minutos).
function appDia(d?: HorarioDia): DiaFonte {
  if (!d?.active) return FOLGA;
  const i = timeToMin(d.in);
  let o = timeToMin(d.out);
  if (i == null || o == null) return { ...FOLGA, label: "—" };
  if (o < i) o += 1440;
  const ii = timeToMin(d.intervalIn);
  const io = timeToMin(d.intervalOut);
  let breakMin = d.break || 0;
  let label: string;
  if (ii != null && io != null) {
    breakMin = Math.max(0, io - ii);
    label = `${d.in}–${d.intervalIn} / ${d.intervalOut}–${d.out}`;
  } else if (breakMin > 0) {
    label = `${d.in}–${d.out} · int ${breakMin}m`;
  } else {
    label = `${d.in}–${d.out}`;
  }
  const carga = Math.max(0, o - i - breakMin);
  return { ativo: true, label, entrada: i, saida: o, breakMin, carga };
}

// Qual semana (A/B) está vigente hoje numa escala alternante (via anchor).
function semanaVigente(ws: WorkSchedule, hoje: Date): "A" | "B" | null {
  if (ws.type !== "alternating" || !ws.weeks || !ws.anchor) return null;
  const ref = new Date(ws.anchor.date + "T00:00:00");
  const semanas = Math.floor((hoje.getTime() - ref.getTime()) / (7 * 86400000));
  const ehAncora = semanas % 2 === 0;
  return ehAncora ? ws.anchor.week : (ws.anchor.week === "A" ? "B" : "A");
}

// App WorkSchedule → HorarioDia por dia da semana (0=Dom..6=Sáb), resolvendo a
// semana vigente hoje pra escalas alternadas (A/B via anchor).
function appDiasVigentes(ws: WorkSchedule | undefined, hoje: Date): (HorarioDia | undefined)[] {
  if (!ws) return Array(7).fill(undefined);
  let days = ws.days;
  const semana = semanaVigente(ws, hoje);
  if (semana && ws.weeks) days = ws.weeks[semana]?.days;
  return Array.from({ length: 7 }, (_, wd) => days?.[wd]);
}

function escalaAppVigente(emp: Empregado, hoje: string): WorkSchedule | undefined {
  const arr = (emp.workSchedules || []).filter((w) => w.validFrom <= hoje);
  if (arr.length === 0) return emp.workSchedules?.[0];
  return arr.sort((a, b) => a.validFrom.localeCompare(b.validFrom))[arr.length - 1];
}

// Assinatura do horário de um dia (entrada|saída|intervalo em min) pra comparar
// horários independentemente do formato de origem.
const sig = (d: DiaFonte) => `${d.entrada}|${d.saida}|${d.breakMin}`;

// Ciclo de domingos no planejamento.app: escala alternante (A/B) pode dar folga
// de domingo só numa das semanas. Descreve o padrão + a semana vigente.
function cicloDomingos(ws: WorkSchedule | undefined, semanaVig: "A" | "B" | null): string {
  if (!ws) return "sem escala no planejamento.app";
  if (ws.type !== "alternating" || !ws.weeks) {
    return ws.days?.[0]?.active ? "trabalha todo domingo (sem ciclo)" : "folga todo domingo (sem ciclo)";
  }
  const a = !!ws.weeks.A?.days?.[0]?.active;
  const b = !!ws.weeks.B?.days?.[0]?.active;
  const st = (x: boolean) => (x ? "trabalha" : "folga");
  const vig = semanaVig ? ` · vigente: semana ${semanaVig}` : "";
  if (a === b) return `${st(a)} todos os domingos (escala alterna outros dias)${vig}`;
  return `alternado — semana A: ${st(a)} · semana B: ${st(b)}${vig}`;
}

export function EscalasComparacaoTab({ rid, activeRestaurant }: { rid: string; activeRestaurant: Restaurant }) {
  const [carregando, setCarregando] = useState(!!activeRestaurant.shortCode);
  const [erro, setErro] = useState("");
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [catalogo, setCatalogo] = useState<PontoEscala[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [fonte, setFonte] = useState<FonteSel>("comparar");
  const [busca, setBusca] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [gerando, setGerando] = useState(false);

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

  // Carrega sozinho ao abrir a aba (remonta no acesso → sempre atualizado).
  useEffect(() => {
    if (activeRestaurant.shortCode) void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRestaurant.shortCode]);

  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);
  const catById = useMemo(() => {
    const m = new Map<number, PontoEscala>();
    for (const c of catalogo) if (c.id != null) m.set(c.id, c);
    return m;
  }, [catalogo]);
  const cargoById = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
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
        const appEmp = empAppPorCpf.get(soDigitos(r.cpf));
        const cargo = appEmp ? cargoById.get(appEmp.cargoId) : undefined;
        const area = cargo?.area;
        const vinculo = cargo ? VINCULO_LABEL[cargo.tipoVinculo] : undefined;
        // Cargo de confiança = vínculo que normalmente bate ponto (CLT/estagiário)
        // mas está marcado como NÃO bate (override) — o gerente exempto.
        const ehConfianca = !!cargo && defaultBatePontoPorVinculo(cargo.tipoVinculo)
          && !empregadoBatePonto(appEmp, cargo);
        const wsApp = appEmp ? escalaAppVigente(appEmp, hojeStr) : undefined;
        const ciclico = wsApp?.type === "alternating" || !!r.doubleBindEmployee;
        const semanaCiclo = ciclico && wsApp?.type === "alternating" ? semanaVigente(wsApp, hoje) : null;
        const ciclo = cicloDomingos(wsApp, semanaCiclo);
        const temApp = !!appEmp;
        const appDs = appDiasVigentes(wsApp, hoje);

        const dias = DIAS.map((_, wd) => {
          const sol = solidesDia(solSched, wd);
          const app = appDia(appDs[wd]);
          const soUmLado = temApp && sol.ativo !== app.ativo;
          const cargaDiff = temApp && sol.carga !== app.carga;
          const horarioDiff = temApp && sol.ativo && app.ativo && sig(sol) !== sig(app);
          const diverge = soUmLado || cargaDiff || horarioDiff;
          return { wd, sol, app, soUmLado, cargaDiff, horarioDiff, diverge };
        });

        const totalSol = dias.reduce((a, d) => a + d.sol.carga, 0);
        const totalApp = dias.reduce((a, d) => a + d.app.carga, 0);
        const bate = temApp && dias.every((d) => !d.diverge);
        return { r, ciclico, semanaCiclo, ciclo, area, vinculo, ehConfianca, appEmp, temApp, dias, totalSol, totalApp, bate };
      })
      .sort((a, b) => (a.r.name || "").localeCompare(b.r.name || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, catById, empAppPorCpf, cargoById, hojeStr]);

  if (!carregou && !carregando) {
    return (
      <div className="text-center py-12">
        <button type="button" onClick={() => void carregar()}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
          🗓️ Comparar escalas (Sólides × planejamento.app)
        </button>
        <p className="text-[11px] text-gray-400 mt-2">Compara a escala cadastrada no Sólides com a do planejamento.app, por colaborador.</p>
      </div>
    );
  }
  if (carregando) return <div className="text-center text-sm text-gray-400 py-12">Carregando escalas…</div>;
  if (erro) return <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>;

  const divergentes = linhas.filter((l) => l.temApp && !l.bate).length;
  const semApp = linhas.filter((l) => !l.temApp).length;

  const buscaDig = soDigitos(busca);
  const linhasView = linhas.filter((l) => {
    if (fonte === "comparar" && soDivergentes && !(l.temApp && !l.bate)) return false;
    if (busca.trim()) {
      const nome = (l.r.name || "").toLowerCase();
      const cpf = soDigitos(l.r.cpf);
      if (!nome.includes(busca.trim().toLowerCase()) && !(buscaDig && cpf.includes(buscaDig))) return false;
    }
    return true;
  });

  const mostraSol = fonte === "comparar" || fonte === "solides";
  const mostraApp = fonte === "comparar" || fonte === "app";

  async function exportarPDF() {
    setGerando(true); setErro("");
    try {
      const pdfLinhas: EscalaPDFLinha[] = linhasView.map((l) => ({
        nome: l.r.name || "—",
        vinculo: l.vinculo,
        confianca: l.ehConfianca,
        ciclo: l.ciclo,
        temApp: l.temApp,
        totalSol: l.totalSol,
        totalApp: l.totalApp,
        dias: l.dias.map((d) => ({
          sol: d.sol.label, app: d.app.label,
          solAtivo: d.sol.ativo, appAtivo: d.app.ativo, diverge: d.diverge,
        })),
      }));
      const doc = await gerarEscalasPDF({ restaurantNome: activeRestaurant.nome, linhas: pdfLinhas });
      const nome = `escalas-${activeRestaurant.shortCode || "rest"}-${hojeStr}.pdf`;
      await baixarOuCompartilhar(doc.output("blob"), nome, { titulo: "Escalas cadastradas", texto: activeRestaurant.nome });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o PDF.");
    } finally { setGerando(false); }
  }

  const SEG: { id: FonteSel; label: string }[] = [
    { id: "comparar", label: "Comparar" },
    { id: "solides", label: "Só Sólides" },
    { id: "app", label: "Só Planejamento" },
  ];

  return (
    <div className="space-y-3">
      {/* Seletor de fonte */}
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-800 p-0.5 bg-gray-50 dark:bg-gray-900">
        {SEG.map((s) => (
          <button key={s.id} type="button" onClick={() => setFonte(s.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              fonte === s.id ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        <span>{linhas.length} colaborador(es)</span>
        {fonte === "comparar" && <span className="text-red-600">{divergentes} divergente(s)</span>}
        <span className="text-amber-600">{semApp} sem vínculo no planejamento.app</span>
        {fonte === "comparar" && (
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={soDivergentes} onChange={(e) => setSoDivergentes(e.target.checked)} className="accent-indigo-600" />
            só divergentes
          </label>
        )}
        <button type="button" onClick={() => void exportarPDF()} disabled={gerando || linhasView.length === 0}
          className="ml-auto px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold">
          {gerando ? "Gerando…" : "📄 Exportar PDF"}
        </button>
        <button type="button" onClick={() => void carregar()} className="text-indigo-600 hover:underline">↻ recarregar</button>
      </div>

      <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou CPF…"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />

      {fonte === "comparar" && (
        <div className="flex items-center gap-3 text-[10px] text-gray-400 flex-wrap">
          <span>⏰ horário diferente</span>
          <span>⏱ carga diferente</span>
          <span>➖ escala só num lado</span>
        </div>
      )}

      <div className="space-y-2">
        {linhasView.map((l) => {
          const borda = fonte !== "comparar"
            ? "border-gray-200 dark:border-gray-800"
            : l.temApp ? (l.bate ? "border-gray-200 dark:border-gray-800" : "border-red-200 dark:border-red-900/50")
              : "border-amber-200 dark:border-amber-900/50";
          return (
            <div key={l.r.id} className={`rounded-xl border p-3 ${borda}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{l.r.name}</span>
                {l.area && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{l.area}</span>}
                {l.ehConfianca && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title="Cargo de confiança — não bate ponto (isento de controle de jornada)">🔒 confiança</span>}
                {l.ciclico && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300" title="Escala alternante (cíclica) — comparando a semana vigente">🔁 cíclico{l.semanaCiclo ? ` · semana ${l.semanaCiclo}` : ""}</span>}
                {fonte === "comparar" && !l.temApp && <span className="text-[10px] text-amber-600 ml-auto">sem empregado vinculado (CPF)</span>}
                {fonte === "comparar" && l.temApp && (l.bate
                  ? <span className="text-[11px] text-emerald-600 ml-auto">✓ batem</span>
                  : <span className="text-[11px] text-red-600 ml-auto">⚠ divergem</span>)}
                {fonte === "solides" && <span className="text-[11px] text-gray-400 ml-auto">semana {fmtH(l.totalSol)}</span>}
                {fonte === "app" && (l.temApp
                  ? <span className="text-[11px] text-gray-400 ml-auto">semana {fmtH(l.totalApp)}</span>
                  : <span className="text-[10px] text-amber-600 ml-auto">sem vínculo (CPF)</span>)}
              </div>

              {/* Linhas por dia da semana */}
              <div className="mt-2 space-y-0.5">
                {l.dias.map((d) => {
                  const destaque = fonte === "comparar" && d.diverge;
                  return (
                    <div key={d.wd}
                      className={`grid items-start gap-2 rounded px-1.5 py-1 ${destaque ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                      style={{ gridTemplateColumns: "34px 1fr auto" }}>
                      <div className={`text-[11px] font-semibold pt-0.5 ${destaque ? "text-red-600" : "text-gray-400"}`}>{DIAS[d.wd]}</div>
                      <div className="min-w-0 space-y-0.5">
                        {mostraSol && (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[9px] uppercase tracking-wide text-gray-400 shrink-0 w-14">Sólides</span>
                            <span className={`text-[12px] tabular-nums ${d.sol.ativo ? "text-gray-800 dark:text-gray-200" : "text-gray-400"}`}>{d.sol.label}</span>
                            {d.sol.ativo && <span className="text-[10px] text-gray-400 shrink-0">· {fmtH(d.sol.carga)}</span>}
                          </div>
                        )}
                        {mostraApp && (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[9px] uppercase tracking-wide text-gray-400 shrink-0 w-14">Planej.</span>
                            <span className={`text-[12px] tabular-nums ${!l.temApp ? "text-gray-300" : d.app.ativo ? "text-gray-800 dark:text-gray-200" : "text-gray-400"}`}>{l.temApp ? d.app.label : "—"}</span>
                            {l.temApp && d.app.ativo && <span className="text-[10px] text-gray-400 shrink-0">· {fmtH(d.app.carga)}</span>}
                          </div>
                        )}
                      </div>
                      {destaque && (
                        <div className="flex gap-0.5 pt-0.5 text-[11px]">
                          {d.soUmLado && <span title="Escala só num lado (o outro está de folga)">➖</span>}
                          {d.horarioDiff && <span title="Horário cadastrado diferente entre as fontes">⏰</span>}
                          {d.cargaDiff && !d.horarioDiff && <span title="Carga horária do dia diferente">⏱</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800/60 text-[10px] text-gray-400">
                {fonte === "comparar" && <>Carga semanal — Sólides: {fmtH(l.totalSol)}{l.temApp ? ` · planejamento.app: ${fmtH(l.totalApp)}` : ""}</>}
                {fonte === "solides" && <>Carga semanal — Sólides: {fmtH(l.totalSol)}</>}
                {fonte === "app" && (l.temApp ? <>Carga semanal — planejamento.app: {fmtH(l.totalApp)}</> : <>Sem escala vinculada no planejamento.app.</>)}
                {l.ciclico ? ` · cíclico: semana ${l.semanaCiclo ?? "vigente"} (a Sólides só expõe o ciclo atual; o ciclo completo está no cadastro alternante do planejamento.app)` : ""}
              </div>
            </div>
          );
        })}
        {linhasView.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-8">Nenhum colaborador com esse filtro.</div>
        )}
      </div>
    </div>
  );
}
