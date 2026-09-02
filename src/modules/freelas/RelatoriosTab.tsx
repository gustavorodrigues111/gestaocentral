// ════════════════════════════════════════════════════════════════════════════
//  Relatórios de Freelas — por período, agrupado por ÁREA → FREELA → TURNOS.
//  Cada nível soma Diária (totalCalc) + Gorjeta (fatia da divisão do dia, quando
//  o turno participou). Exporta em PDF resumido (áreas + freelas) ou expandido
//  (com todos os turnos).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import type {
  Area, Cargo, Empregado, EscalaMes, FreelaShift, Gorjeta, SplitVersion, Unidade,
} from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "../gorjetas/calc";
import { getActiveSplitVersion } from "../gorjetas/splitRules";
import { fmtBR, fmtHoras, calcHoras, intervaloTotalDoShift } from "./helpers";

type Props = {
  restaurantId: string;
  restaurantNome: string;
  unidades: Unidade[];
  shifts: FreelaShift[];
};

type TurnoLinha = { id: string; date: string; entrada?: string; saida?: string; horas: number; diaria: number; gorjeta: number };
type FreelaLinha = { key: string; nome: string; turnos: TurnoLinha[]; diaria: number; gorjeta: number; qtd: number };
type AreaLinha = { area: string; freelas: FreelaLinha[]; diaria: number; gorjeta: number; qtd: number };

const STATUS_TRABALHADO = new Set(["aberto", "fechamento", "pago"]);
const primeiroDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

export function RelatoriosTab({ restaurantId, restaurantNome, unidades, shifts }: Props) {
  const [de, setDe] = useState(primeiroDiaMes());
  const [ate, setAte] = useState(todayYmd());
  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [splitVersions, setSplitVersions] = useState<SplitVersion[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escalas, setEscalas] = useState<EscalaMes[]>([]);
  const [expArea, setExpArea] = useState<Set<string>>(new Set());
  const [expFreela, setExpFreela] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    const un = [
      onSnapshot(query(collection(db, "gorjetas"), where("restaurantId", "==", restaurantId)), s => setGorjetas(s.docs.map(d => ({ id: d.id, ...d.data() } as Gorjeta)))),
      onSnapshot(query(collection(db, "splitVersions"), where("restaurantId", "==", restaurantId)), s => setSplitVersions(s.docs.map(d => ({ id: d.id, ...d.data() } as SplitVersion)))),
      onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", restaurantId)), s => setEmpregados(s.docs.map(d => ({ id: d.id, ...d.data() } as Empregado)))),
      onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", restaurantId)), s => setCargos(s.docs.map(d => ({ id: d.id, ...d.data() } as Cargo)))),
      onSnapshot(query(collection(db, "escalas"), where("restaurantId", "==", restaurantId)), s => setEscalas(s.docs.map(d => ({ id: d.id, ...d.data() } as EscalaMes)))),
    ];
    return () => un.forEach(u => u());
  }, [restaurantId]);

  const cargoById = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos]);
  const escalaPorMes = useMemo(() => {
    const m: Record<string, EscalaMes> = {};
    escalas.forEach(e => { m[`${e.ano}-${String(e.mes).padStart(2, "0")}`] = e; });
    return m;
  }, [escalas]);

  // Unidade efetiva do turno (dobra unidade defasada/encerrada na que arrecadou).
  const unidadeEfetiva = useMemo(() => (date: string, shiftUnidadeId: string | null | undefined): string | null => {
    const doDia = gorjetas.filter(x => x.date === date && !x.semGorjeta && (x.valorBruto || 0) > 0);
    const u = shiftUnidadeId || null;
    if (u && doDia.some(x => (x.unidadeId || null) === u)) return u;
    const top = doDia.slice().sort((a, b) => (b.valorBruto || 0) - (a.valorBruto || 0))[0];
    return top ? (top.unidadeId || null) : null;
  }, [gorjetas]);

  const freelasDoDia = useMemo(() => (date: string, unidadeId: string | null) =>
    shifts.filter(f => f.date === date && f.gorjetaCargoId && f.status !== "cancelado" && f.status !== "nao_compareceu"
      && (!unidadeId || unidadeEfetiva(date, f.unidadeId) === unidadeId))
      .map(f => { const c = cargoById[f.gorjetaCargoId as string]; return { id: f.id, nome: f.nomeSnapshot, cargoId: f.gorjetaCargoId as string, pontos: c?.pontos || 0, area: (c?.area || f.area || "Salão") as Area }; })
      .filter(f => f.pontos > 0),
  [shifts, cargoById, unidadeEfetiva]);

  // Gorjeta (R$) que um turno recebeu — snapshot se publicada, senão prévia ao vivo.
  const gorjetaDoShift = useMemo(() => (s: FreelaShift): number => {
    if (!s.gorjetaCargoId) return 0;
    const doDia = gorjetas.filter(x => x.date === s.date && !x.semGorjeta && (x.valorBruto || 0) > 0);
    const eff = unidadeEfetiva(s.date, s.unidadeId);
    const g = doDia.find(x => (x.unidadeId || null) === eff);
    if (!g) return 0;
    if (g.publicada && g.divisaoSnapshot) {
      const it = g.divisaoSnapshot.find(i => i.freelaShiftId === s.id);
      return it ? Math.round((it.valor || 0) * 100) / 100 : 0;
    }
    const sv = getActiveSplitVersion(splitVersions, g.date);
    if (!sv) return 0;
    const liquido = calcularValorLiquido(g.valorBruto, sv.taxRate);
    const escala = escalaPorMes[g.date.slice(0, 7)] || null;
    const r = calcularDivisaoDia(g.date, liquido, empregados, cargos, escala, sv, g.unidadeId || null, unidades, freelasDoDia(g.date, g.unidadeId || null));
    const it = r.itens.find(i => i.freelaShiftId === s.id);
    return it ? Math.round((it.valor || 0) * 100) / 100 : 0;
  }, [gorjetas, splitVersions, empregados, cargos, escalaPorMes, unidades, freelasDoDia, unidadeEfetiva]);

  // Monta a árvore área → freela → turnos, no período.
  const { areas, totalDiaria, totalGorjeta } = useMemo(() => {
    const noPeriodo = shifts.filter(s => STATUS_TRABALHADO.has(s.status) && s.date >= de && s.date <= ate);
    const mapaArea = new Map<string, { freelas: Map<string, FreelaLinha> }>();
    for (const s of noPeriodo) {
      const area = s.area || cargoById[s.gorjetaCargoId || ""]?.area || "Sem área";
      const diaria = s.totalCalc || 0;
      const gorjeta = gorjetaDoShift(s);
      const fkey = s.pessoaId || s.empregadoId || `nome:${(s.nomeSnapshot || "").toLowerCase()}`;
      if (!mapaArea.has(area)) mapaArea.set(area, { freelas: new Map() });
      const areaEntry = mapaArea.get(area)!;
      if (!areaEntry.freelas.has(fkey)) areaEntry.freelas.set(fkey, { key: `${area}::${fkey}`, nome: s.nomeSnapshot || "—", turnos: [], diaria: 0, gorjeta: 0, qtd: 0 });
      const fl = areaEntry.freelas.get(fkey)!;
      fl.turnos.push({ id: s.id, date: s.date, entrada: s.entrada, saida: s.saida, horas: s.horas ?? calcHoras(s.entrada, s.saida, intervaloTotalDoShift(s)), diaria, gorjeta });
      fl.diaria += diaria; fl.gorjeta += gorjeta; fl.qtd += 1;
    }
    const areas: AreaLinha[] = [...mapaArea.entries()].map(([area, { freelas }]) => {
      const fl = [...freelas.values()].map(f => ({ ...f, turnos: f.turnos.sort((a, b) => a.date.localeCompare(b.date)) })).sort((a, b) => b.gorjeta + b.diaria - (a.gorjeta + a.diaria));
      return { area, freelas: fl, diaria: fl.reduce((x, f) => x + f.diaria, 0), gorjeta: fl.reduce((x, f) => x + f.gorjeta, 0), qtd: fl.reduce((x, f) => x + f.qtd, 0) };
    }).sort((a, b) => (b.diaria + b.gorjeta) - (a.diaria + a.gorjeta));
    return { areas, totalDiaria: areas.reduce((x, a) => x + a.diaria, 0), totalGorjeta: areas.reduce((x, a) => x + a.gorjeta, 0) };
  }, [shifts, de, ate, cargoById, gorjetaDoShift]);

  const temGorjeta = totalGorjeta > 0.005;
  const toggleArea = (a: string) => setExpArea(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n; });
  const toggleFreela = (k: string) => setExpFreela(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function exportarPDF(modo: "resumido" | "expandido") {
    setExportando(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      doc.setFontSize(15); doc.setTextColor(30);
      doc.text(`Relatório de Freelas — ${restaurantNome}`, 14, 16);
      doc.setFontSize(10); doc.setTextColor(110);
      doc.text(`Período ${fmtD(de)} a ${fmtD(ate)}  ·  ${modo === "resumido" ? "Resumido" : "Expandido"}`, 14, 22);
      const money = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Resumo por área
      autoTable(doc, {
        startY: 28,
        head: [temGorjeta ? ["Área", "Turnos", "Diária", "Gorjeta", "Total"] : ["Área", "Turnos", "Total"]],
        body: areas.map(a => temGorjeta
          ? [a.area, String(a.qtd), money(a.diaria), money(a.gorjeta), money(a.diaria + a.gorjeta)]
          : [a.area, String(a.qtd), money(a.diaria + a.gorjeta)]),
        foot: [temGorjeta
          ? ["TOTAL", String(areas.reduce((x, a) => x + a.qtd, 0)), money(totalDiaria), money(totalGorjeta), money(totalDiaria + totalGorjeta)]
          : ["TOTAL", String(areas.reduce((x, a) => x + a.qtd, 0)), money(totalDiaria + totalGorjeta)]],
        theme: "striped", styles: { fontSize: 9 }, headStyles: { fillColor: [99, 102, 241], textColor: 255 },
        footStyles: { fillColor: [238, 242, 255], textColor: 30, fontStyle: "bold" },
        columnStyles: temGorjeta ? { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } : { 2: { halign: "right" } },
      });

      // Detalhe por freela (e turnos, se expandido)
      for (const a of areas) {
        let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
        if (y > 260) { doc.addPage(); y = 16; }
        doc.setFontSize(11); doc.setTextColor(79, 70, 229);
        doc.text(`${a.area}  ·  ${money(a.diaria + a.gorjeta)}`, 14, y);
        autoTable(doc, {
          startY: y + 2,
          head: [temGorjeta ? ["Freela", "Turnos", "Diária", "Gorjeta", "Total"] : ["Freela", "Turnos", "Total"]],
          body: a.freelas.map(f => temGorjeta
            ? [f.nome, String(f.qtd), money(f.diaria), money(f.gorjeta), money(f.diaria + f.gorjeta)]
            : [f.nome, String(f.qtd), money(f.diaria + f.gorjeta)]),
          theme: "grid", styles: { fontSize: 8.5 }, headStyles: { fillColor: [229, 231, 235], textColor: 40 },
          columnStyles: temGorjeta ? { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } : { 2: { halign: "right" } },
        });
        if (modo === "expandido") {
          for (const f of a.freelas) {
            let yt = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
            if (yt > 258) { doc.addPage(); yt = 16; }
            doc.setFontSize(9); doc.setTextColor(90);
            doc.text(`  ${f.nome} — turnos`, 14, yt);
            autoTable(doc, {
              startY: yt + 1.5,
              head: [temGorjeta ? ["Data", "Horário", "Horas", "Diária", "Gorjeta"] : ["Data", "Horário", "Horas", "Diária"]],
              body: f.turnos.map(t => temGorjeta
                ? [fmtD(t.date), `${t.entrada || "—"}${t.saida ? "→" + t.saida : ""}`, fmtHoras(t.horas), money(t.diaria), money(t.gorjeta)]
                : [fmtD(t.date), `${t.entrada || "—"}${t.saida ? "→" + t.saida : ""}`, fmtHoras(t.horas), money(t.diaria)]),
              theme: "plain", styles: { fontSize: 8, textColor: 90 }, margin: { left: 18 },
              columnStyles: temGorjeta ? { 3: { halign: "right" }, 4: { halign: "right" } } : { 3: { halign: "right" } },
            });
          }
        }
      }
      const tp = doc.internal.pages.length - 1;
      for (let i = 1; i <= tp; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150); doc.text(`planejamento.app · gerado em ${new Date().toLocaleString("pt-BR")}`, 14, doc.internal.pageSize.getHeight() - 8); doc.text(`${i}/${tp}`, W - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" }); }
      doc.save(`Freelas ${restaurantNome} ${de} a ${ate} (${modo}).pdf`);
    } finally { setExportando(false); }
  }

  const inp = "px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  return (
    <div className="max-w-4xl">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-gray-600 dark:text-gray-400">De</label><input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)} className={inp} /></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Até</label><input type="date" value={ate} min={de} onChange={e => setAte(e.target.value)} className={inp} /></div>
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" size="sm" onClick={() => void exportarPDF("resumido")} disabled={exportando || areas.length === 0}>⬇ PDF resumido</Button>
          <Button size="sm" onClick={() => void exportarPDF("expandido")} disabled={exportando || areas.length === 0}>⬇ PDF expandido</Button>
        </div>
      </div>

      {/* Totais gerais */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"><div className="text-[11px] uppercase tracking-wide text-gray-400">Diárias</div><div className="text-lg font-bold tabular-nums">{fmtBR(totalDiaria)}</div></div>
        {temGorjeta && <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"><div className="text-[11px] uppercase tracking-wide text-gray-400">Gorjeta</div><div className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtBR(totalGorjeta)}</div></div>}
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3"><div className="text-[11px] uppercase tracking-wide text-indigo-500">Total</div><div className="text-lg font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmtBR(totalDiaria + totalGorjeta)}</div></div>
      </div>

      {areas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum turno de freela no período.</div>
      ) : (
        <div className="space-y-2">
          {areas.map(a => {
            const aberto = expArea.has(a.area);
            return (
              <div key={a.area} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                <button type="button" onClick={() => toggleArea(a.area)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 text-left">
                  <span className="text-gray-400 text-xs w-3">{aberto ? "▾" : "▸"}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100 flex-1">{a.area}</span>
                  <span className="text-[11px] text-gray-400">{a.qtd} turno{a.qtd === 1 ? "" : "s"}</span>
                  {temGorjeta && <span className="text-xs text-gray-500 tabular-nums w-24 text-right">{fmtBR(a.diaria)} <span className="text-gray-400">diária</span></span>}
                  {temGorjeta && <span className="text-xs text-emerald-700 dark:text-emerald-400 tabular-nums w-24 text-right">{fmtBR(a.gorjeta)} <span className="text-gray-400">gorj.</span></span>}
                  <span className="font-bold text-indigo-700 dark:text-indigo-300 tabular-nums w-28 text-right">{fmtBR(a.diaria + a.gorjeta)}</span>
                </button>
                {aberto && (
                  <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                    {a.freelas.map(f => {
                      const fab = expFreela.has(f.key);
                      return (
                        <div key={f.key}>
                          <button type="button" onClick={() => toggleFreela(f.key)} className="w-full flex items-center gap-3 pl-9 pr-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 text-left">
                            <span className="text-gray-400 text-[10px] w-3">{fab ? "▾" : "▸"}</span>
                            <span className="text-sm text-gray-800 dark:text-gray-200 flex-1 truncate">{f.nome}</span>
                            <span className="text-[11px] text-gray-400">{f.qtd}×</span>
                            {temGorjeta && <span className="text-[12px] text-gray-500 tabular-nums w-24 text-right">{fmtBR(f.diaria)}</span>}
                            {temGorjeta && <span className="text-[12px] text-emerald-700 dark:text-emerald-400 tabular-nums w-24 text-right">{fmtBR(f.gorjeta)}</span>}
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums w-28 text-right">{fmtBR(f.diaria + f.gorjeta)}</span>
                          </button>
                          {fab && (
                            <div className="pl-14 pr-4 pb-2 pt-1 space-y-1">
                              {f.turnos.map(t => (
                                <div key={t.id} className="flex items-center gap-3 text-[12px] text-gray-600 dark:text-gray-300">
                                  <span className="tabular-nums text-gray-500 w-16">{fmtD(t.date)}</span>
                                  <span className="text-gray-500 w-28">{t.entrada || "—"}{t.saida ? `→${t.saida}` : ""}</span>
                                  <span className="tabular-nums text-gray-400 w-14">{fmtHoras(t.horas)}</span>
                                  <span className="flex-1" />
                                  {temGorjeta && <span className="tabular-nums w-24 text-right">{fmtBR(t.diaria)}</span>}
                                  {temGorjeta && <span className="tabular-nums text-emerald-700 dark:text-emerald-400 w-24 text-right">{fmtBR(t.gorjeta)}</span>}
                                  <span className="tabular-nums font-medium w-28 text-right">{fmtBR(t.diaria + t.gorjeta)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

function fmtD(ymd: string): string { const [a, m, d] = ymd.split("-"); return `${d}/${m}/${a.slice(2)}`; }
