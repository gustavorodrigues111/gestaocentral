import { useMemo, useState } from "react";
import { ChevronRight, CalendarClock, CheckCircle2 } from "lucide-react";
import { AREAS, segAreaCor } from "../../core/types";
import type { Area, ChecklistFrequencia, ChecklistRun, ChecklistTemplate } from "../../core/types";
import { fmtBR } from "../../core/utils/date";

// ════════════════════════════════════════════════════════════════════════════
//  Dashboard de CONSISTÊNCIA do Histórico de Checklists.
//  Mede, por área, se os checklists foram preenchidos no DIA certo (diasSemana)
//  e dentro do HORÁRIO de referência. Matriz checklist × dia-da-semana colorida
//  por conformidade. Diários entram na matriz; semanais/mensais aparecem numa
//  lista simples (não mapeiam pra dia da semana).
// ════════════════════════════════════════════════════════════════════════════

const GRACA_MIN = 30; // tolerância de atraso pro horário de referência (min)
const DOW_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DOW_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];
const CINZA_SEM_AREA = { bg: "bg-gray-50 dark:bg-gray-900", fg: "text-gray-500 dark:text-gray-400", dot: "#9ca3af" };
function corDaArea(area: Area | null) { return area ? segAreaCor(area) : CINZA_SEM_AREA; }

type Stat = { esperado: number; feito: number; noPrazo: number };
function statVazio(): Stat { return { esperado: 0, feito: 0, noPrazo: 0 }; }
function somaStat(a: Stat, b: Stat): Stat { return { esperado: a.esperado + b.esperado, feito: a.feito + b.feito, noPrazo: a.noPrazo + b.noPrazo }; }

type LinhaTemplate = {
  id: string; nome: string; freq: ChecklistFrequencia; horario?: string;
  celulas: (Stat | null)[]; // 7 posições (0=Dom..6=Sáb); null = não agendado nesse dia
  total: Stat;
};
type BlocoArea = {
  area: Area | null;
  total: Stat;
  porDow: Stat[];           // 7
  diarios: LinhaTemplate[];
  outras: { id: string; nome: string; freq: ChecklistFrequencia; completos: number; ultima?: string }[];
};

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function minutosDoDia(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}
function minutosRef(hhmm?: string): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return null;
  return h * 60 + (m || 0);
}
// Run completa e dentro do horário de referência (+ graça). Sem horário definido
// → completa já conta como "no prazo".
function noPrazo(run: ChecklistRun, t: ChecklistTemplate): boolean {
  if (run.status !== "completo") return false;
  const ref = minutosRef(t.horarioReferencia);
  if (ref == null) return true;
  const fin = minutosDoDia(run.finalizadoEm) ?? minutosDoDia(run.iniciadoEm);
  return fin != null && fin <= ref + GRACA_MIN;
}

function computa(templates: ChecklistTemplate[], runs: ChecklistRun[], dias: number): BlocoArea[] {
  // Datas do período: ontem pra trás (hoje é excluído — ainda pode estar em curso).
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const datas: { ymd: string; dow: number }[] = [];
  for (let i = 1; i <= dias; i++) { const d = new Date(hoje); d.setDate(d.getDate() - i); datas.push({ ymd: ymdLocal(d), dow: d.getDay() }); }

  // Índice de runs: templateId → (ymd → melhor run do dia, preferindo completa).
  const idx = new Map<string, Map<string, ChecklistRun>>();
  for (const r of runs) {
    if (!idx.has(r.templateId)) idx.set(r.templateId, new Map());
    const m = idx.get(r.templateId)!;
    const ex = m.get(r.data);
    if (!ex || (r.status === "completo" && ex.status !== "completo")) m.set(r.data, r);
  }

  const areasOrd: (Area | null)[] = [...AREAS, null];
  const blocos: BlocoArea[] = [];

  for (const area of areasOrd) {
    const tsArea = templates.filter(t => (area === null ? !t.area : t.area === area) && t.ativo);
    if (tsArea.length === 0) continue;

    const diarios: LinhaTemplate[] = [];
    const outras: BlocoArea["outras"] = [];
    const porDow: Stat[] = Array.from({ length: 7 }, statVazio);
    let total = statVazio();

    for (const t of tsArea) {
      const criadoYmd = (t.criadoEm || "").slice(0, 10);
      if (t.frequencia === "diaria") {
        const celulas: (Stat | null)[] = Array.from({ length: 7 }, () => null);
        const linhaTotal = statVazio();
        for (const { ymd, dow } of datas) {
          if (criadoYmd && ymd < criadoYmd) continue;
          const agendado = !t.diasSemana || t.diasSemana.length === 0 || t.diasSemana.includes(dow);
          if (!agendado) continue;
          if (!celulas[dow]) celulas[dow] = statVazio();
          const cel = celulas[dow]!;
          cel.esperado++; linhaTotal.esperado++; porDow[dow].esperado++;
          const run = idx.get(t.id)?.get(ymd);
          if (run && run.status === "completo") {
            cel.feito++; linhaTotal.feito++; porDow[dow].feito++;
            if (noPrazo(run, t)) { cel.noPrazo++; linhaTotal.noPrazo++; porDow[dow].noPrazo++; }
          }
        }
        if (linhaTotal.esperado > 0) {
          diarios.push({ id: t.id, nome: t.nome, freq: t.frequencia, horario: t.horarioReferencia, celulas, total: linhaTotal });
          total = somaStat(total, linhaTotal);
        }
      } else {
        // semanal / mensal / avulsa — sem mapeamento por dia da semana.
        const runsT = runs.filter(r => r.templateId === t.id && datas.some(d => d.ymd === r.data));
        const completos = runsT.filter(r => r.status === "completo").length;
        const ultima = runsT.map(r => r.data).sort().slice(-1)[0];
        outras.push({ id: t.id, nome: t.nome, freq: t.frequencia, completos, ultima });
      }
    }

    diarios.sort((a, b) => a.nome.localeCompare(b.nome));
    outras.sort((a, b) => a.nome.localeCompare(b.nome));
    if (diarios.length || outras.length) blocos.push({ area, total, porDow, diarios, outras });
  }
  return blocos;
}

function pct(n: number, d: number): number { return d > 0 ? Math.round((n / d) * 100) : 0; }

// Cor da célula por taxa de conformidade (noPrazo / esperado).
function corCelula(s: Stat | null): { cls: string; texto: string } {
  if (!s || s.esperado === 0) return { cls: "bg-gray-100 dark:bg-gray-800/60 text-transparent", texto: "" };
  const taxa = s.noPrazo / s.esperado;
  const label = `${s.noPrazo}/${s.esperado}`;
  if (taxa >= 0.9) return { cls: "bg-emerald-500 text-white", texto: label };
  if (taxa >= 0.6) return { cls: "bg-amber-400 text-amber-950", texto: label };
  if (taxa > 0) return { cls: "bg-red-400 text-white", texto: label };
  return { cls: "bg-red-500 text-white", texto: label };
}

function BarraMini({ n, d, cor }: { n: number; d: number; cor: string }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct(n, d)}%`, background: cor }} />
    </div>
  );
}

export function ChecklistHistoricoDash({ templates, runs }: { templates: ChecklistTemplate[]; runs: ChecklistRun[] }) {
  const [dias, setDias] = useState(30);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});
  const blocos = useMemo(() => computa(templates, runs, dias), [templates, runs, dias]);

  const geral = useMemo(() => blocos.reduce((acc, b) => somaStat(acc, b.total), statVazio()), [blocos]);

  return (
    <div className="space-y-4">
      {/* Seletor de período + resumo geral */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold inline-flex items-center gap-1"><CalendarClock size={13} /> Período:</span>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                dias === d ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >{d} dias</button>
          ))}
        </div>
        <div className="text-xs text-gray-500">
          Conformidade geral: <span className="font-bold text-gray-800 dark:text-gray-200">{pct(geral.noPrazo, geral.esperado)}%</span>
          <span className="text-gray-400"> · {geral.noPrazo}/{geral.esperado} no prazo</span>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-gray-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> ≥90% no prazo</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400" /> 60–89%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400" /> &lt;60%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500" /> nunca feito</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-200 dark:bg-gray-800" /> não agendado</span>
        <span className="text-gray-400">· célula = nº no prazo / esperado · hoje não conta</span>
      </div>

      {blocos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">Sem dados no período</p>
          <p className="text-sm text-gray-500 mt-1">Ajuste o período ou registre execuções.</p>
        </div>
      ) : blocos.map(b => {
        const cor = corDaArea(b.area);
        const key = b.area || "sem";
        const exp = aberta[key];
        const taxa = pct(b.total.noPrazo, b.total.esperado);
        const corBarra = taxa >= 90 ? "#10b981" : taxa >= 60 ? "#f59e0b" : "#ef4444";
        return (
          <div key={key} className={`rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden ${cor.bg}`} style={{ borderLeftWidth: 5, borderLeftColor: cor.dot }}>
            {/* Cabeçalho clicável */}
            <button type="button" onClick={() => setAberta(s => ({ ...s, [key]: !s[key] }))} className="w-full flex items-center gap-3 p-4 text-left">
              <ChevronRight size={18} className={`shrink-0 text-gray-400 transition-transform ${exp ? "rotate-90" : ""}`} />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cor.dot }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={`font-bold uppercase tracking-wider text-sm ${cor.fg}`}>{b.area || "Sem área"}</h3>
                  <span className="text-[11px] text-gray-500">{b.diarios.length} diário(s){b.outras.length ? ` · ${b.outras.length} outro(s)` : ""}</span>
                </div>
                <div className="mt-1.5 max-w-xs"><BarraMini n={b.total.noPrazo} d={b.total.esperado} cor={corBarra} /></div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold" style={{ color: corBarra }}>{taxa}%</div>
                <div className="text-[10px] text-gray-500">{b.total.noPrazo}/{b.total.esperado} no prazo</div>
              </div>
            </button>

            {exp && (
              <div className="px-4 pb-4 space-y-4 bg-white/60 dark:bg-gray-950/30 border-t border-gray-200/70 dark:border-gray-800">
                {/* Matriz checklist × dia da semana */}
                {b.diarios.length > 0 && (
                  <div className="pt-3 overflow-x-auto">
                    <div className="min-w-[340px]">
                      {/* Cabeçalho de dias */}
                      <div className="grid items-center gap-1 mb-1" style={{ gridTemplateColumns: "minmax(0,1fr) repeat(7, 30px) 46px" }}>
                        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Checklist</div>
                        {DOW_CURTO.map((d, i) => (
                          <div key={i} className="text-[10px] text-center font-semibold text-gray-400" title={DOW_LABEL[i]}>{d}</div>
                        ))}
                        <div className="text-[10px] text-center font-semibold text-gray-400">%</div>
                      </div>
                      {b.diarios.map(l => {
                        const t = pct(l.total.noPrazo, l.total.esperado);
                        return (
                          <div key={l.id} className="grid items-center gap-1 mb-1" style={{ gridTemplateColumns: "minmax(0,1fr) repeat(7, 30px) 46px" }}>
                            <div className="min-w-0 pr-2">
                              <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate" title={l.nome}>{l.nome}</div>
                              {l.horario && <div className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><CalendarClock size={9} /> {l.horario}</div>}
                            </div>
                            {l.celulas.map((c, i) => {
                              const cc = corCelula(c);
                              const tit = c && c.esperado > 0
                                ? `${DOW_LABEL[i]} · ${l.nome}: ${c.noPrazo}/${c.esperado} no prazo (feito ${c.feito}/${c.esperado})`
                                : `${DOW_LABEL[i]}: não agendado`;
                              return (
                                <div key={i} title={tit} className={`h-7 rounded flex items-center justify-center text-[9px] font-semibold ${cc.cls}`}>{cc.texto}</div>
                              );
                            })}
                            <div className={`text-center text-xs font-bold ${t >= 90 ? "text-emerald-600 dark:text-emerald-400" : t >= 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{t}%</div>
                          </div>
                        );
                      })}
                      {/* Rodapé: agregado por dia da semana */}
                      <div className="grid items-center gap-1 mt-2 pt-2 border-t border-gray-200 dark:border-gray-800" style={{ gridTemplateColumns: "minmax(0,1fr) repeat(7, 30px) 46px" }}>
                        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Por dia</div>
                        {b.porDow.map((s, i) => {
                          const p = pct(s.noPrazo, s.esperado);
                          return (
                            <div key={i} title={s.esperado ? `${DOW_LABEL[i]}: ${p}% (${s.noPrazo}/${s.esperado})` : `${DOW_LABEL[i]}: —`}
                              className={`text-center text-[9px] font-bold ${s.esperado === 0 ? "text-gray-300 dark:text-gray-700" : p >= 90 ? "text-emerald-600 dark:text-emerald-400" : p >= 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                              {s.esperado ? `${p}%` : "—"}
                            </div>
                          );
                        })}
                        <div className="text-center text-[9px] font-bold text-gray-500">{taxa}%</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Semanais / mensais / avulsos */}
                {b.outras.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Semanais / mensais / avulsos</div>
                    <div className="space-y-1">
                      {b.outras.map(o => (
                        <div key={o.id} className="flex items-center justify-between gap-2 text-xs bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-800">
                          <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{o.nome}</span>
                          <span className="text-gray-500 shrink-0 inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" /> {o.completos} no período</span>
                            {o.ultima && <span className="text-gray-400">· última {fmtBR(o.ultima)}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
