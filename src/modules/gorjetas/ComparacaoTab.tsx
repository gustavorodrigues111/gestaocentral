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

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { nomeMes } from "../../core/utils/date";
import { getActiveSplitVersion } from "./splitRules";
// Label "Junho/2026" a partir de "2026-06" (o util nomeMes só dá o nome do mês).
const labelMes = (ym: string) => { const [y, m] = ym.split("-"); return `${nomeMes(Number(m))}/${y}`; };
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import type { Cargo, DivisaoItem, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  rid: string;
  empregados: Empregado[];
  cargos: Cargo[];
  splitVersions: SplitVersion[];
  unidades: Unidade[];
};

type LinhaEmp = { nome: string; cargoNome: string; area: string; liquido: number };

export function ComparacaoTab({ rid, empregados, cargos, splitVersions, unidades }: Props) {
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
        liqBase, liqComp, delta, pct,
      };
    });
    return out.sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.nome.localeCompare(b.nome));
  }, [liquidoPorEmp, base, comparado, escalaBase, escalaComp]);

  const totBase = linhas.reduce((s, l) => s + l.liqBase, 0);
  const totComp = linhas.reduce((s, l) => s + l.liqComp, 0);
  const totDelta = Math.round((totComp - totBase) * 100) / 100;
  const totPct = totBase > 0 ? (totDelta / totBase) * 100 : null;

  const DeltaCell = ({ delta, pct }: { delta: number; pct: number | null }) => {
    const cor = delta > 0.005 ? "text-emerald-700 dark:text-emerald-400" : delta < -0.005 ? "text-rose-700 dark:text-rose-400" : "text-gray-400";
    const seta = delta > 0.005 ? "▲" : delta < -0.005 ? "▼" : "→";
    return (
      <span className={`tabular-nums font-semibold ${cor}`}>
        {seta} {delta >= 0 ? "+" : "−"}{fmtBR(Math.abs(delta))}
        <span className="ml-1 text-[11px] font-normal">
          {pct === null ? (delta > 0 ? "(novo)" : "") : `(${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)`}
        </span>
      </span>
    );
  };

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
        <div className="text-[11px] text-gray-500 dark:text-gray-400 pb-1">
          Variação = <strong>{labelMes(comparado)}</strong> em relação a <strong>{labelMes(base)}</strong>.
        </div>
      </div>

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
                {linhas.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{l.nome}</div>
                      <div className="text-xs text-gray-500">{l.area}{l.cargoNome ? ` · ${l.cargoNome}` : ""}</div>
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.liqBase)}</td>
                    <td className="text-right px-3 py-2 tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtBR(l.liqComp)}</td>
                    <td className="text-right px-3 py-2 whitespace-nowrap"><DeltaCell delta={l.delta} pct={l.pct} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="text-right px-3 py-2 tabular-nums">{fmtBR(totBase)}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{fmtBR(totComp)}</td>
                  <td className="text-right px-3 py-2 whitespace-nowrap"><DeltaCell delta={totDelta} pct={totPct} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
