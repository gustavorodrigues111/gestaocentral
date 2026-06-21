// ════════════════════════════════════════════════════════════════════════════
//  Fechamento de folha — Passo 1: REVISÃO (sem gravar na escala ainda).
//
//  Mostra o espelho do mês por empregado, com status sugerido (cruza ponto +
//  prevista), editável dia a dia, e permite VISUALIZAR o PDF do espelho (Sólides).
//  O "Fechar folha do empregado" (gravar na praticada) entra no Passo 2.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Empregado, EscalaMes, Restaurant, ScheduleStatus } from "../../core/types";
import { fetchRoster, fetchEspelhoPdf } from "../../core/ponto/solidesPontoClient";
import type { PontoColaborador } from "../../core/ponto/analise";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import type { SolidesPunch } from "../../core/excecoes/types";
import { Modal } from "../../core/ui/Modal";

const STATUS_OPCOES: Array<{ id: ScheduleStatus; label: string }> = [
  { id: "trabalho", label: "Trabalho" },
  { id: "folga", label: "Folga" },
  { id: "freela", label: "Freela" },
  { id: "comp", label: "Folga por compensação" },
  { id: "comp_trab", label: "Trabalho por compensação" },
  { id: "ferias", label: "Férias" },
  { id: "falta_j", label: "Falta justificada" },
  { id: "falta_i", label: "Falta injustificada" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPCOES.map((o) => [o.id, o.label]));

const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
const DIAS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const fmtH = (ms?: number) => { if (!ms) return ""; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function diasDoMes(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const out: string[] = [];
  const total = new Date(y, m, 0).getDate();
  for (let d = 1; d <= total; d++) out.push(`${ym}-${pad(d)}`);
  return out;
}
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function mapMotivo(txt?: string): ScheduleStatus {
  const t = (txt || "").toLowerCase();
  if (/féri|feri/.test(t)) return "ferias";
  if (/atestado|justif/.test(t)) return "falta_j";
  return "folga";
}
function descAfast(p: SolidesPunch): string | undefined {
  const ar = (p as { adjustmentReason?: unknown }).adjustmentReason;
  if (typeof ar === "string") return ar || undefined;
  if (ar && typeof ar === "object") return (ar as { description?: string }).description || undefined;
  const j = (p as { justification?: unknown }).justification;
  if (typeof j === "string") return j || undefined;
  if (j && typeof j === "object") return (j as { description?: string }).description || undefined;
  return undefined;
}

type DiaEspelho = {
  date: string;
  worked: boolean;
  marks: string;        // "08:00-12:00 · 13:00-17:00"
  afastamento?: string; // descrição do afastamento, se houver
  prevista?: ScheduleStatus;
  sugerido: ScheduleStatus;
};

export function FechamentoTab({
  rid, activeRestaurant, empregados, mesInicial,
}: {
  rid: string;
  activeRestaurant: Restaurant;
  empregados: Empregado[];
  mesInicial: string; // YYYY-MM
}) {
  const [mes, setMes] = useState(mesInicial);
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [punches, setPunches] = useState<SolidesPunch[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [selEmp, setSelEmp] = useState<number | "">("");
  const [edits, setEdits] = useState<Record<number, Record<string, ScheduleStatus>>>({});
  const [pdf, setPdf] = useState<{ url: string; nome: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const shortCode = activeRestaurant.shortCode || "";
  const empAppPorCpf = useMemo(() => {
    const m = new Map<string, Empregado>();
    for (const e of empregados) { const c = soDigitos(e.cpf); if (c) m.set(c, e); }
    return m;
  }, [empregados]);

  async function carregar() {
    if (!shortCode) { setErro("Restaurante sem shortCode."); return; }
    setErro(""); setCarregando(true); setEdits({});
    const dias = diasDoMes(mes);
    const ini = dias[0]; const fim = dias[dias.length - 1];
    try {
      const [ros, pun, escSnap] = await Promise.all([
        fetchRoster(shortCode).catch(() => []),
        fetchPunches(ini, fim, shortCode).then((r) => r.punches).catch(() => []),
        getDoc(doc(db, "escalas", `${rid}_${mes}`)),
      ]);
      setRoster(ros);
      setPunches(pun);
      setEscala(escSnap.exists() ? ({ id: escSnap.id, ...escSnap.data() } as EscalaMes) : null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o mês.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes, shortCode, rid]);

  // Colaboradores ativos do roster (Sólides) que casam com empregado do app.
  const colaboradores = useMemo(() => {
    return roster
      .filter((r) => typeof r.id === "number" && !r.fired)
      .map((r) => ({ solId: r.id as number, nome: r.name || "?", emp: empAppPorCpf.get(soDigitos(r.cpf)) }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [roster, empAppPorCpf]);

  // Espelho do empregado selecionado: 1 linha por dia do mês.
  const espelho = useMemo<DiaEspelho[]>(() => {
    if (!selEmp) return [];
    const col = colaboradores.find((c) => c.solId === selEmp);
    const appId = col?.emp?.id;
    const prevista = appId ? escala?.prevista?.[appId] : undefined;
    const porDia = new Map<string, SolidesPunch[]>();
    for (const p of punches) {
      if (p.employeeId !== selEmp || (p as { excluded?: boolean }).excluded) continue;
      const arr = porDia.get(p.date) || []; arr.push(p); porDia.set(p.date, arr);
    }
    return diasDoMes(mes).map((date) => {
      const ps = (porDia.get(date) || []).sort((a, b) => a.dateIn - b.dateIn);
      const trabalho = ps.filter((p) => !(p as { allowance?: boolean }).allowance && p.dateIn);
      const afastP = ps.find((p) => (p as { allowance?: boolean }).allowance) || ps.find((p) => descAfast(p));
      const worked = trabalho.length > 0;
      const marks = trabalho.map((p) => p.dateOut && p.dateOut > p.dateIn ? `${fmtH(p.dateIn)}-${fmtH(p.dateOut)}` : `${fmtH(p.dateIn)}-?`).join(" · ");
      const afastamento = !worked ? descAfast(afastP || ({} as SolidesPunch)) : undefined;
      const prev = prevista?.[date];
      let sugerido: ScheduleStatus;
      if (worked) sugerido = prev === "folga" ? "comp_trab" : prev === "freela" ? "freela" : "trabalho";
      else if (afastamento) sugerido = mapMotivo(afastamento);
      else if (prev === "freela") sugerido = "freela";
      else if (prev === "trabalho") sugerido = "falta_i";
      else sugerido = prev || "folga";
      return { date, worked, marks, afastamento, prevista: prev, sugerido };
    });
  }, [selEmp, colaboradores, escala, punches, mes]);

  const statusDe = (date: string): ScheduleStatus | undefined => {
    if (!selEmp) return undefined;
    const ed = edits[selEmp]?.[date];
    if (ed) return ed;
    return espelho.find((d) => d.date === date)?.sugerido;
  };
  const setStatus = (date: string, s: ScheduleStatus) => {
    if (!selEmp) return;
    setEdits((cur) => ({ ...cur, [selEmp]: { ...(cur[selEmp] || {}), [date]: s } }));
  };

  async function verPdf() {
    if (!selEmp) return;
    setErro(""); setPdfLoading(true);
    const dias = diasDoMes(mes);
    try {
      const r = await fetchEspelhoPdf(shortCode, selEmp, dias[0], dias[dias.length - 1]);
      const bytes = atob(r.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      setPdf({ url, nome: r.fileName || "espelho.pdf" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o PDF do espelho.");
    } finally {
      setPdfLoading(false);
    }
  }
  function fecharPdf() {
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf(null);
  }

  const colSel = colaboradores.find((c) => c.solId === selEmp);

  return (
    <div className="space-y-4">
      {/* Barra */}
      <div className="bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900 border border-indigo-100 dark:border-indigo-900/40 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Mês</label>
            <input type="month" value={mes} onChange={(e) => { setSelEmp(""); setMes(e.target.value); }}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Colaborador</label>
            <select value={selEmp} onChange={(e) => setSelEmp(e.target.value ? Number(e.target.value) : "")}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
              <option value="">{colaboradores.length ? "— escolha —" : "— carregando —"}</option>
              {colaboradores.map((c) => (
                <option key={c.solId} value={c.solId}>{c.nome}{c.emp ? "" : " (sem vínculo no app)"}</option>
              ))}
            </select>
          </div>
          {selEmp !== "" && (
            <button type="button" onClick={() => void verPdf()} disabled={pdfLoading}
              className="h-9 px-4 text-sm font-semibold rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 whitespace-nowrap">
              {pdfLoading ? "Gerando…" : "👁 Visualizar espelho (PDF)"}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          <strong>Passo 1 (revisão):</strong> o status sugerido vem do ponto + prevista; edite o que precisar. Ainda <strong>não grava</strong> na escala — o "Fechar folha" entra no próximo passo.
        </p>
      </div>

      {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>}

      {carregando ? (
        <div className="text-center text-sm text-gray-400 py-12">Carregando o mês…</div>
      ) : selEmp === "" ? (
        <div className="text-center text-sm text-gray-400 py-12">Escolha um colaborador pra revisar o espelho.</div>
      ) : (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-900 dark:text-gray-100">
            {colSel?.nome} — {mes.split("-").reverse().join("/")}
            {!colSel?.emp && <span className="ml-2 text-[10px] text-amber-600">sem empregado vinculado no app (prevista não aparece)</span>}
          </header>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {espelho.map((d) => {
              const dataBR = d.date.split("-").reverse().join("/");
              const wd = DIAS_PT[weekdayOf(d.date)];
              const editado = edits[selEmp]?.[d.date] && edits[selEmp][d.date] !== d.sugerido;
              return (
                <div key={d.date} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <div className="w-28 shrink-0 text-gray-500 tabular-nums">{dataBR} <span className="text-gray-400">({wd})</span></div>
                  <div className="min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-300">
                    {d.worked ? <span className="tabular-nums">{d.marks}</span>
                      : d.afastamento ? <span className="text-indigo-700 dark:text-indigo-300">{d.afastamento}</span>
                      : <span className="text-gray-400">sem batida</span>}
                    {d.prevista && <span className="ml-2 text-[10px] text-gray-400">prev: {STATUS_LABEL[d.prevista] || d.prevista}</span>}
                  </div>
                  <select value={statusDe(d.date) || ""} onChange={(e) => setStatus(d.date, e.target.value as ScheduleStatus)}
                    className={`h-8 px-2 text-xs rounded-md border bg-white dark:bg-gray-900 dark:text-gray-100 shrink-0 ${editado ? "border-indigo-400 ring-1 ring-indigo-300" : "border-gray-300 dark:border-gray-700"}`}>
                    {STATUS_OPCOES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pdf && (
        <Modal title="👁 Espelho de ponto" onClose={fecharPdf} maxWidth="max-w-4xl">
          <div className="space-y-2">
            <iframe title="espelho" src={pdf.url} className="w-full h-[70vh] rounded-lg border border-gray-200 dark:border-gray-700" />
            <div className="flex justify-end">
              <a href={pdf.url} download={pdf.nome}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">⬇ Baixar PDF</a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
