// Relatórios de Vendas (PDV Altec/Riser) — dois relatórios:
//   • Produtos vendidos: relatório oficial "Vendas por Produto" (via
//     /api/altec-relatorio, ao vivo) — TODOS os produtos do período, com
//     Fat. Bruto/Líquido e curva ABC. Fonte correta (o feed diário do
//     dashboard só traz o top-10 do dia).
//   • Faturamento por turno: sai dos docs vendasAltec já sincronizados
//     (vendasPorHora = faturamento faturado/encerrado por hora), agrupado
//     em Almoço × Noite por um horário de corte configurável.
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { ymd, todayYmd } from "../../core/utils/date";

const money = (v: number) => (isFinite(v) ? v : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtdFmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 }));
const dBR = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

type Produto = { id: string; produto: string; categoria: string; qtd: number; fatBruto: number; fatLiquido: number; pctTotal: number; curva: string };
type Meta = { di: string; df: string; totalProdutos: number; totalQtd: number; totalFatBruto: number; totalFatLiquido: number };
type DiaHora = { data: string; fat: number; porHora: number[] };

// Primeiro e último dia do mês atual (default do período).
function mesAtual(): { di: string; df: string } {
  const now = new Date();
  const di = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const df = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { di, df };
}
function mesPassado(): { di: string; df: string } {
  const now = new Date();
  const di = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const df = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
  return { di, df };
}

type Ordem = { col: keyof Produto; dir: 1 | -1 };

export function RelatoriosVendasPage() {
  const { activeId, activeRestaurant } = useRestaurant();
  const [aba, setAba] = useState<"produtos" | "turno">("produtos");
  const inicial = mesAtual();
  const [di, setDi] = useState(inicial.di);
  const [df, setDf] = useState(inicial.df);

  // ── Produtos ──────────────────────────────────────────────────────────
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string>("");
  const [ordem, setOrdem] = useState<Ordem>({ col: "fatBruto", dir: -1 });

  async function gerarProdutos() {
    if (!activeId || carregando) return;
    setCarregando(true); setErro(""); setProdutos([]); setMeta(null);
    try {
      const qs = new URLSearchParams({ rid: activeId, di, df, status: "E" });
      const r = await fetch(`/api/altec-relatorio?${qs.toString()}`, { method: "POST", headers: { ...(await authHeader()) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro((j as { error?: string }).error || `HTTP ${r.status}`); return; }
      setProdutos(((j as { produtos?: Produto[] }).produtos) || []);
      setMeta((j as { meta?: Meta }).meta || null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao gerar relatório");
    } finally { setCarregando(false); }
  }

  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.categoria))].sort(), [produtos]);
  const produtosVis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    let arr = produtos.filter((p) => (!catSel || p.categoria === catSel) && (!b || p.produto.toLowerCase().includes(b)));
    arr = [...arr].sort((a, z) => {
      const va = a[ordem.col], vz = z[ordem.col];
      if (typeof va === "number" && typeof vz === "number") return (va - vz) * ordem.dir;
      return String(va).localeCompare(String(vz)) * ordem.dir;
    });
    return arr;
  }, [produtos, busca, catSel, ordem]);

  const totVis = useMemo(() => produtosVis.reduce((s, p) => ({ qtd: s.qtd + p.qtd, bruto: s.bruto + p.fatBruto, liq: s.liq + p.fatLiquido }), { qtd: 0, bruto: 0, liq: 0 }), [produtosVis]);

  function toggleOrdem(col: keyof Produto) {
    setOrdem((o) => (o.col === col ? { col, dir: (o.dir === 1 ? -1 : 1) } : { col, dir: -1 }));
  }
  function exportarCSV() {
    const linhas = [["ID", "Produto", "Categoria", "Qtd", "Fat Bruto", "Fat Liquido", "% Total", "Curva"]];
    for (const p of produtosVis) linhas.push([p.id, p.produto, p.categoria, String(p.qtd).replace(".", ","), p.fatBruto.toFixed(2).replace(".", ","), p.fatLiquido.toFixed(2).replace(".", ","), p.pctTotal.toFixed(2).replace(".", ","), p.curva]);
    const csv = linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `vendas-produto_${di}_${df}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const setC = (col: keyof Produto, label: string, cls = "text-right") => (
    <th className={`px-2 py-1.5 ${cls} cursor-pointer select-none whitespace-nowrap`} onClick={() => toggleOrdem(col)}>
      {label}{ordem.col === col ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  // ── Turno (lê vendasAltec já sincronizado) ─────────────────────────────
  const [dias, setDias] = useState<DiaHora[]>([]);
  const [carregandoTurno, setCarregandoTurno] = useState(false);
  const [corte, setCorte] = useState(17); // horário de corte Almoço × Noite

  useEffect(() => {
    if (aba !== "turno" || !activeId) return;
    let cancelado = false;
    (async () => {
      setCarregandoTurno(true);
      const alvos: string[] = [];
      const d0 = new Date(`${di}T12:00:00`), d1 = new Date(`${df}T12:00:00`);
      for (let d = new Date(d0); d <= d1 && alvos.length < 92; d.setDate(d.getDate() + 1)) alvos.push(ymd(d));
      const snaps = await Promise.all(alvos.map((iso) => getDoc(doc(db, "vendasAltec", `${activeId}_${iso}`)).catch(() => null)));
      if (cancelado) return;
      const out: DiaHora[] = [];
      snaps.forEach((s, i) => {
        const data = s && s.exists() ? (s.data() as { faturamento?: number; vendasPorHora?: number[] }) : null;
        const porHora = Array.isArray(data?.vendasPorHora) ? (data!.vendasPorHora as number[]) : [];
        const fat = typeof data?.faturamento === "number" ? data.faturamento : porHora.reduce((a, b) => a + (b || 0), 0);
        if (fat > 0 || porHora.some((h) => h > 0)) out.push({ data: alvos[i], fat, porHora });
      });
      setDias(out);
      setCarregandoTurno(false);
    })();
    return () => { cancelado = true; };
  }, [aba, activeId, di, df]);

  const turno = useMemo(() => {
    const somaFaixa = (h: number[], lo: number, hi: number) => h.slice(lo, hi).reduce((a, b) => a + (b || 0), 0);
    const linhas = dias.map((d) => {
      const almoco = somaFaixa(d.porHora, 0, corte);
      const noite = d.fat - almoco; // resto do dia (inclui madrugada pós-meia-noite se houver)
      return { data: d.data, almoco, noite, total: d.fat };
    });
    const tot = linhas.reduce((s, l) => ({ almoco: s.almoco + l.almoco, noite: s.noite + l.noite, total: s.total + l.total }), { almoco: 0, noite: 0, total: 0 });
    return { linhas, tot };
  }, [dias, corte]);

  if (!activeId) return <div className="p-6 text-sm text-gray-500">Selecione um restaurante.</div>;

  const preset = (label: string, r: { di: string; df: string }) => (
    <button onClick={() => { setDi(r.di); setDf(r.df); }} className="text-xs px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">{label}</button>
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">📊 Relatórios de Vendas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {activeRestaurant?.nome} · direto do PDV Altec/Riser (caixa encerrado). Produtos vendidos e faturamento por turno.
        </p>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-3">
        {([["produtos", "Produtos vendidos"], ["turno", "Faturamento por turno"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${aba === id ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Início</label>
          <input type="date" value={di} onChange={(e) => setDi(e.target.value)} className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Fim</label>
          <input type="date" value={df} onChange={(e) => setDf(e.target.value)} max={todayYmd()} className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5" />
        </div>
        <div className="flex items-center gap-1.5 pb-1">
          {preset("Mês atual", mesAtual())}
          {preset("Mês passado", mesPassado())}
        </div>
        {aba === "produtos" && (
          <Button size="sm" onClick={() => void gerarProdutos()} disabled={carregando}>
            {carregando ? "Gerando…" : "Gerar relatório"}
          </Button>
        )}
      </div>

      {aba === "produtos" ? (
        <div>
          {carregando && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-sm text-gray-500 flex items-center gap-2">
              <span className="animate-spin">⏳</span> Consultando o Altec (login + relatório) — leva alguns segundos…
            </div>
          )}
          {erro && <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300">⚠ {erro}</div>}

          {!carregando && !erro && !meta && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
              Escolha o período e clique em <b>Gerar relatório</b>.
            </div>
          )}

          {meta && !carregando && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <Card titulo="Produtos" valor={String(meta.totalProdutos)} />
                <Card titulo="Itens vendidos" valor={qtdFmt(meta.totalQtd)} />
                <Card titulo="Fat. Bruto" valor={money(meta.totalFatBruto)} />
                <Card titulo="Fat. Líquido" valor={money(meta.totalFatLiquido)} />
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 flex-1 min-w-[160px]" />
                <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
                  <option value="">Todas categorias</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button size="sm" variant="secondary" onClick={exportarCSV}>⤓ CSV</Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 text-xs">
                    <tr>
                      {setC("produto", "Produto", "text-left")}
                      {setC("categoria", "Categoria", "text-left")}
                      {setC("qtd", "Qtd")}
                      {setC("fatBruto", "Fat. Bruto")}
                      {setC("fatLiquido", "Fat. Líquido")}
                      {setC("pctTotal", "% Total")}
                      {setC("curva", "Curva", "text-center")}
                    </tr>
                  </thead>
                  <tbody>
                    {produtosVis.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800/70 hover:bg-gray-50 dark:hover:bg-gray-900/40">
                        <td className="px-2 py-1.5">{p.produto}</td>
                        <td className="px-2 py-1.5 text-gray-500">{p.categoria}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qtdFmt(p.qtd)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(p.fatBruto)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(p.fatLiquido)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{p.pctTotal.toFixed(2)}%</td>
                        <td className="px-2 py-1.5 text-center">
                          <span className={`inline-block w-5 rounded text-xs font-bold ${p.curva === "A" ? "text-emerald-600" : p.curva === "B" ? "text-amber-600" : "text-gray-400"}`}>{p.curva}</span>
                        </td>
                      </tr>
                    ))}
                    {produtosVis.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-gray-400">Nenhum produto.</td></tr>}
                  </tbody>
                  {produtosVis.length > 0 && (
                    <tfoot className="bg-gray-50 dark:bg-gray-900/60 font-semibold text-gray-700 dark:text-gray-200 border-t-2 border-gray-200 dark:border-gray-700">
                      <tr>
                        <td className="px-2 py-1.5" colSpan={2}>Total ({produtosVis.length})</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qtdFmt(totVis.qtd)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(totVis.bruto)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(totVis.liq)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        // ── TURNO ──────────────────────────────────────────────────────────
        <div>
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-gray-500">Corte Almoço × Noite:</span>
            <select value={corte} onChange={(e) => setCorte(Number(e.target.value))} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1">
              {[15, 16, 17, 18].map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <span className="text-gray-400 text-xs">antes do corte = Almoço · resto do dia = Noite</span>
          </div>

          {carregandoTurno ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-sm text-gray-500">Carregando dias…</div>
          ) : dias.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
              Nenhum dia com venda sincronizada nesse período. (O turno usa o feed diário do PDV — se faltar histórico, rode o backfill em Conectores.)
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Card titulo="🍽 Almoço" valor={money(turno.tot.almoco)} sub={turno.tot.total ? `${((turno.tot.almoco / turno.tot.total) * 100).toFixed(0)}%` : ""} />
                <Card titulo="🌙 Noite" valor={money(turno.tot.noite)} sub={turno.tot.total ? `${((turno.tot.noite / turno.tot.total) * 100).toFixed(0)}%` : ""} />
                <Card titulo="Total" valor={money(turno.tot.total)} sub={`${dias.length} dias`} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 text-xs">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Dia</th>
                      <th className="px-2 py-1.5 text-right">🍽 Almoço</th>
                      <th className="px-2 py-1.5 text-right">🌙 Noite</th>
                      <th className="px-2 py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turno.linhas.map((l) => (
                      <tr key={l.data} className="border-t border-gray-100 dark:border-gray-800/70 hover:bg-gray-50 dark:hover:bg-gray-900/40">
                        <td className="px-2 py-1.5">{dBR(l.data)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(l.almoco)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(l.noite)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-900/60 font-semibold text-gray-700 dark:text-gray-200 border-t-2 border-gray-200 dark:border-gray-700">
                    <tr>
                      <td className="px-2 py-1.5">Total</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(turno.tot.almoco)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(turno.tot.noite)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(turno.tot.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{titulo}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
