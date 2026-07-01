// ════════════════════════════════════════════════════════════════════════════
//  ComparacaoTab — compara a gorjeta líquida por empregado entre DOIS meses.
//
//  Sempre 2 meses: escolhe mês A e mês B; a tabela mostra o líquido de cada
//  empregado nos dois e a variação (R$ + %) do mês MAIS RECENTE em relação ao
//  mais antigo (queda vermelha, aumento verde).
//
//  Cálculo por empregado: reaproveita a mesma lógica da Divisão do mês —
//  usa o snapshot congelado quando a gorjeta foi publicada; senão recalcula
//  com a escala do mês. Assina TODAS as gorjetas do restaurante (1 query) e
//  filtra os dois meses no cliente + carrega a escala de cada mês.
// ════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { nomeMes } from "../../core/utils/date";
import { getActiveSplitVersion } from "./splitRules";
// Label "Junho/2026" a partir de "2026-06" (o util nomeMes só dá o nome do mês).
const labelMes = (ym: string) => { const [y, m] = ym.split("-"); return `${nomeMes(Number(m))}/${y}`; };
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { gerarComparacaoPDF } from "./gerarComparacaoPDF";
import type { Cargo, DivisaoItem, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  rid: string;
  restaurantNome: string;
  empregados: Empregado[];
  cargos: Cargo[];
  splitVersions: SplitVersion[];
  unidades: Unidade[];
};

type LinhaEmp = { nome: string; cargoNome: string; area: string; liquido: number };

export function ComparacaoTab({ rid, restaurantNome, empregados, cargos, splitVersions, unidades }: Props) {
  // Opções de mês: últimos 18 meses (YYYY-MM).
  const mesesOpcoes = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 18; i++) {
      const y = d.getFullYear(); const m = d.getMonth() + 1;
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);
  const [mesA, setMesA] = useState(mesesOpcoes[1] || mesesOpcoes[0]); // mês anterior
  const [mesB, setMesB] = useState(mesesOpcoes[0]);                   // mês atual

  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [escalaA, setEscalaA] = useState<EscalaMes | null>(null);
  const [escalaB, setEscalaB] = useState<EscalaMes | null>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "gorjetas"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      setGorjetas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gorjeta));
    });
  }, [rid]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(doc(db, "escalas", `${rid}_${mesA}`), (s) => setEscalaA(s.exists() ? ({ id: s.id, ...s.data() } as EscalaMes) : null));
  }, [rid, mesA]);
  useEffect(() => {
    if (!rid) return;
    return onSnapshot(doc(db, "escalas", `${rid}_${mesB}`), (s) => setEscalaB(s.exists() ? ({ id: s.id, ...s.data() } as EscalaMes) : null));
  }, [rid, mesB]);

  // Agrega o líquido por empregado num mês.
  const liquidoPorEmp = useMemo(() => (ym: string, escala: EscalaMes | null): Map<string, LinhaEmp> => {
    const acc = new Map<string, LinhaEmp>();
    for (const g of gorjetas) {
      if (g.date.slice(0, 7) !== ym || g.semGorjeta || !g.valorBruto) continue;
      const sv = getActiveSplitVersion(splitVersions, g.date);
      let itens: DivisaoItem[];
      if (g.publicada && g.divisaoSnapshot) {
        itens = g.divisaoSnapshot;
      } else {
        const liq = calcularValorLiquido(g.valorBruto, sv?.taxRate ?? 0);
        itens = calcularDivisaoDia(g.date, liq, empregados, cargos, escala, sv, g.unidadeId || null, unidades).itens;
      }
      for (const it of itens) {
        const cur = acc.get(it.empregadoId) || { nome: it.empregadoNome, cargoNome: it.cargoNome, area: it.area, liquido: 0 };
        cur.liquido += it.valor;
        acc.set(it.empregadoId, cur);
      }
    }
    for (const v of acc.values()) v.liquido = Math.round(v.liquido * 100) / 100;
    return acc;
  }, [gorjetas, splitVersions, empregados, cargos, unidades]);

  // Ordena cronologicamente: base = mais antigo, comparado = mais recente.
  const [base, comparado] = mesA <= mesB ? [mesA, mesB] : [mesB, mesA];
  const escalaBase = base === mesA ? escalaA : escalaB;
  const escalaComp = comparado === mesA ? escalaA : escalaB;

  // Unidade padrão de cada empregado (pra agrupar). Só agrupa por unidade
  // quando o restaurante tem 2+ unidades ativas.
  const usaMultiUni = unidades.filter((u) => u.ativa).length > 1;
  const uniNomePorEmp = useMemo(() => {
    const byId = Object.fromEntries(unidades.map((u) => [u.id, u.nome]));
    const m: Record<string, string> = {};
    for (const e of empregados) if (e.unidadePadraoId && byId[e.unidadePadraoId]) m[e.id] = byId[e.unidadePadraoId];
    return m;
  }, [empregados, unidades]);

  const linhas = useMemo(() => {
    const mapBase = liquidoPorEmp(base, escalaBase);
    const mapComp = liquidoPorEmp(comparado, escalaComp);
    const ids = new Set([...mapBase.keys(), ...mapComp.keys()]);
    const out = [...ids].map((id) => {
      const b = mapBase.get(id);
      const c = mapComp.get(id);
      const liqBase = b?.liquido || 0;
      const liqComp = c?.liquido || 0;
      const delta = Math.round((liqComp - liqBase) * 100) / 100;
      const pct = liqBase > 0 ? (delta / liqBase) * 100 : null; // null = sem base pra %
      return {
        id,
        nome: (c || b)?.nome || "—",
        cargoNome: (c || b)?.cargoNome || "",
        area: (c || b)?.area || "",
        uni: usaMultiUni ? (uniNomePorEmp[id] || "Sem unidade") : "",
        liqBase, liqComp, delta, pct,
      };
    });
    return out.sort((a, b) =>
      (a.uni || "").localeCompare(b.uni || "")
      || (a.area || "").localeCompare(b.area || "")
      || a.nome.localeCompare(b.nome),
    );
  }, [liquidoPorEmp, base, comparado, escalaBase, escalaComp, usaMultiUni, uniNomePorEmp]);

  type Linha = (typeof linhas)[number];
  // Agrupa em unidade → área, com subtotais por (unidade, área).
  const grupos = useMemo(() => {
    const out: { uni: string; area: string; rows: Linha[]; base: number; comp: number }[] = [];
    for (const l of linhas) {
      let g = out[out.length - 1];
      if (!g || g.uni !== l.uni || g.area !== l.area) { g = { uni: l.uni, area: l.area, rows: [], base: 0, comp: 0 }; out.push(g); }
      g.rows.push(l); g.base += l.liqBase; g.comp += l.liqComp;
    }
    return out;
  }, [linhas]);

  const totBase = linhas.reduce((s, l) => s + l.liqBase, 0);
  const totComp = linhas.reduce((s, l) => s + l.liqComp, 0);
  const totDelta = Math.round((totComp - totBase) * 100) / 100;
  const totPct = totBase > 0 ? (totDelta / totBase) * 100 : null;

  // Chip da variação: verde (aumento) · vermelho (queda) · azul (exatamente zero).
  const DeltaChip = ({ delta, pct }: { delta: number; pct: number | null }) => {
    const up = delta > 0.005, down = delta < -0.005;
    const cls = up
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : down
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    const seta = up ? "▲" : down ? "▼" : "→";
    const pctTxt = pct === null ? (up ? "novo" : "—") : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums whitespace-nowrap ${cls}`}>
        {seta} {delta >= 0 ? "+" : "−"}{fmtBR(Math.abs(delta))} · {pctTxt}
      </span>
    );
  };

  const [exportando, setExportando] = useState(false);
  async function exportarPDF() {
    setExportando(true);
    try {
      const doc = await gerarComparacaoPDF({
        restaurantNome,
        labelBase: labelMes(base),
        labelComp: labelMes(comparado),
        subtitulo: "Todas as unidades",
        linhas: linhas.map((l) => ({ nome: l.nome, cargoNome: l.cargoNome, area: l.area, uni: l.uni, liqBase: l.liqBase, liqComp: l.liqComp, delta: l.delta, pct: l.pct })),
        totBase, totComp, totDelta, totPct,
      });
      doc.save(`comparacao-gorjetas-${base}-vs-${comparado}.pdf`);
    } catch (e) {
      alert(`Erro ao gerar o PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Seletores de mês */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Mês A</label>
          <select value={mesA} onChange={(e) => setMesA(e.target.value)}
            className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            {mesesOpcoes.map((ym) => <option key={ym} value={ym}>{labelMes(ym)}</option>)}
          </select>
        </div>
        <span className="pb-2 text-gray-400">×</span>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Mês B</label>
          <select value={mesB} onChange={(e) => setMesB(e.target.value)}
            className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            {mesesOpcoes.map((ym) => <option key={ym} value={ym}>{labelMes(ym)}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 pb-1 hidden sm:block">
            Variação = <strong>{labelMes(comparado)}</strong> em relação a <strong>{labelMes(base)}</strong>.
          </div>
          {linhas.length > 0 && mesA !== mesB && (
            <button type="button" onClick={() => void exportarPDF()} disabled={exportando}
              className="h-9 px-3 text-sm font-semibold rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 whitespace-nowrap">
              {exportando ? "Gerando…" : "📄 Exportar PDF"}
            </button>
          )}
        </div>
      </div>

      {/* Cards de total: mês base × mês comparado × variação */}
      {mesA !== mesB && linhas.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Total {labelMes(base)}</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtBR(totBase)}</div>
          </div>
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Total {labelMes(comparado)}</div>
            <div className="text-xl font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">{fmtBR(totComp)}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Variação total</div>
            <DeltaChip delta={totDelta} pct={totPct} />
          </div>
        </div>
      )}

      {mesA === mesB ? (
        <div className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          Escolha dois meses <strong>diferentes</strong> pra comparar.
        </div>
      ) : linhas.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          Sem gorjeta lançada nesses meses pra comparar.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Empregado</th>
                  <th className="text-right px-3 py-2">{labelMes(base)}</th>
                  <th className="text-right px-3 py-2">{labelMes(comparado)}</th>
                  <th className="text-right px-3 py-2">Variação</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g, gi) => {
                  const uniHeader = usaMultiUni && (gi === 0 || grupos[gi - 1].uni !== g.uni);
                  const subDelta = Math.round((g.comp - g.base) * 100) / 100;
                  const subPct = g.base > 0 ? (subDelta / g.base) * 100 : null;
                  return (
                    <Fragment key={`${g.uni}|${g.area}`}>
                      {uniHeader && (
                        <tr className="bg-indigo-50 dark:bg-indigo-900/20">
                          <td colSpan={4} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                            🏠 {g.uni}
                          </td>
                        </tr>
                      )}
                      <tr className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={4} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          {g.area || "Sem área"}
                        </td>
                      </tr>
                      {g.rows.map((l) => (
                        <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2 pl-5">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{l.nome}</div>
                            {l.cargoNome && <div className="text-xs text-gray-500">{l.cargoNome}</div>}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.liqBase)}</td>
                          <td className="text-right px-3 py-2 tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtBR(l.liqComp)}</td>
                          <td className="text-right px-3 py-2 whitespace-nowrap"><DeltaChip delta={l.delta} pct={l.pct} /></td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                        <td className="px-3 py-1.5 pl-5 text-[11px] font-semibold">Subtotal {g.area || "sem área"}</td>
                        <td className="text-right px-3 py-1.5 tabular-nums text-[12px]">{fmtBR(g.base)}</td>
                        <td className="text-right px-3 py-1.5 tabular-nums text-[12px] font-semibold">{fmtBR(g.comp)}</td>
                        <td className="text-right px-3 py-1.5 whitespace-nowrap"><DeltaChip delta={subDelta} pct={subPct} /></td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="text-right px-3 py-2 tabular-nums">{fmtBR(totBase)}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{fmtBR(totComp)}</td>
                  <td className="text-right px-3 py-2 whitespace-nowrap"><DeltaChip delta={totDelta} pct={totPct} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
