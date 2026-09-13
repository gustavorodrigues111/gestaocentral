// Relatórios de Vendas (PDV Altec/Riser) — dois relatórios:
//   • Produtos vendidos: relatório oficial "Vendas por Produto" (via
//     /api/altec-relatorio, ao vivo) — TODOS os produtos do mês, com Fat.
//     Bruto/Líquido e curva ABC. Cada extração vira um SNAPSHOT salvo
//     (vendasProdutoAltec/{rid}_{YYYY-MM}); a tela lista os meses já extraídos.
//   • Faturamento por turno: sai dos docs vendasAltec já sincronizados
//     (vendasPorHora = faturamento faturado/encerrado por hora), agrupado
//     em Almoço × Noite por um horário de corte configurável.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Hourglass, UtensilsCrossed, Moon } from "lucide-react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { ymd, todayYmd } from "../../core/utils/date";
import { PageContainer } from "../../core/ui/PageContainer";

const money = (v: number) => (isFinite(v) ? v : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtdFmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 }));
const dBR = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const dtBR = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeComp = (comp: string) => { const [y, m] = comp.split("-"); return `${MESES_PT[Number(m) - 1] || m} de ${y}`; };
// Início/fim (ISO) de uma competência YYYY-MM; fim limitado a hoje (mês corrente).
function rangeDoComp(comp: string): { di: string; df: string } {
  const [y, m] = comp.split("-").map(Number);
  const di = ymd(new Date(y, m - 1, 1));
  let df = ymd(new Date(y, m, 0));
  const hoje = todayYmd();
  if (df > hoje) df = hoje;
  return { di, df };
}

type Produto = { id: string; produto: string; categoria: string; qtd: number; fatBruto: number; fatLiquido: number; pctTotal: number; curva: string };
type Meta = { totalProdutos: number; totalQtd: number; totalFatBruto: number; totalFatLiquido: number; geradoEm?: string };
type MesExtraido = { comp: string; geradoEm?: string; totalProdutos: number; totalQtd: number; totalFatBruto: number; totalFatLiquido: number };
type DiaHora = { data: string; fat: number; porHora: number[] };
type Ordem = { col: keyof Produto; dir: 1 | -1 };

export function RelatoriosVendasPage() {
  const { activeId, activeRestaurant } = useRestaurant();
  const [aba, setAba] = useState<"produtos" | "turno">("produtos");

  // ── Produtos: lista de meses extraídos + mês selecionado ──────────────────
  const [meses, setMeses] = useState<MesExtraido[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set([todayYmd().slice(0, 7)])); // meses marcados p/ extrair
  const [selecionado, setSelecionado] = useState("");    // mês aberto na tabela
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [carregando, setCarregando] = useState(false);   // extraindo (login+PDV)
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState("");
  const [confirmar, setConfirmar] = useState<string[]>([]); // comps aguardando sobrescrever
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState("");
  const [ordem, setOrdem] = useState<Ordem>({ col: "fatBruto", dir: -1 });
  const [backfill, setBackfill] = useState("");

  // Lista os meses já extraídos (snapshots) do restaurante.
  async function carregarLista(rid: string) {
    setCarregandoLista(true);
    try {
      const snap = await getDocs(query(collection(db, "vendasProdutoAltec"), where("restaurantId", "==", rid)));
      const arr: MesExtraido[] = snap.docs.map((d) => {
        const x = d.data() as Partial<MesExtraido> & { competencia?: string };
        return {
          comp: x.competencia || d.id.split("_").pop() || "",
          geradoEm: x.geradoEm, totalProdutos: x.totalProdutos || 0, totalQtd: x.totalQtd || 0,
          totalFatBruto: x.totalFatBruto || 0, totalFatLiquido: x.totalFatLiquido || 0,
        };
      }).filter((m) => /^\d{4}-\d{2}$/.test(m.comp)).sort((a, z) => z.comp.localeCompare(a.comp));
      setMeses(arr);
    } catch { /* rules/rede */ } finally { setCarregandoLista(false); }
  }
  useEffect(() => { if (aba === "produtos" && activeId) void carregarLista(activeId); }, [aba, activeId]);

  // Abre um mês já extraído (mostra a tabela).
  async function abrirMes(comp: string) {
    if (!activeId) return;
    setErro(""); setBusca(""); setCatSel("");
    const s = await getDoc(doc(db, "vendasProdutoAltec", `${activeId}_${comp}`)).catch(() => null);
    if (!s || !s.exists()) { setErro("não consegui abrir esse mês salvo"); return; }
    const d = s.data() as { produtos?: Produto[] } & Partial<Meta>;
    setProdutos(Array.isArray(d.produtos) ? d.produtos : []);
    setMeta({ totalProdutos: d.totalProdutos || (d.produtos?.length || 0), totalQtd: d.totalQtd || 0, totalFatBruto: d.totalFatBruto || 0, totalFatLiquido: d.totalFatLiquido || 0, geradoEm: d.geradoEm });
    setSelecionado(comp);
  }

  // Extrai (ao vivo, login no PDV) e salva o snapshot de UM ou VÁRIOS meses.
  // Meses já extraídos pedem confirmação (sobrescrever) antes.
  async function extrair(comps: string[], sobrescrever = false) {
    if (!activeId || carregando) return;
    const alvo = [...new Set(comps.filter((c) => /^\d{4}-\d{2}$/.test(c)))].sort();
    if (!alvo.length) return;
    if (!sobrescrever && alvo.some((c) => extraidosMap.has(c))) { setConfirmar(alvo); return; }
    setConfirmar([]); setCarregando(true); setErro(""); setProgresso("");
    try {
      if (alvo.length === 1) {
        const { di, df } = rangeDoComp(alvo[0]);
        const qs = new URLSearchParams({ rid: activeId, di, df, status: "E" });
        const r = await fetch(`/api/altec-relatorio?${qs.toString()}`, { method: "POST", headers: { ...(await authHeader()) } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErro((j as { error?: string }).error || `HTTP ${r.status}`); return; }
        setProdutos(((j as { produtos?: Produto[] }).produtos) || []);
        setMeta((j as { meta?: Meta }).meta || null);
        setSelecionado(alvo[0]); setBusca(""); setCatSel("");
      } else {
        // Vários meses: um login só no backend (comps=), depois abre o mais recente.
        setProgresso(`Extraindo ${alvo.length} meses (login + relatórios)…`);
        const qs = new URLSearchParams({ rid: activeId, comps: alvo.join(","), status: "E" });
        const r = await fetch(`/api/altec-relatorio?${qs.toString()}`, { method: "POST", headers: { ...(await authHeader()) } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErro((j as { error?: string }).error || `HTTP ${r.status}`); return; }
        const casa = ((j as { resultado?: Array<{ meses?: unknown[]; erro?: string }> }).resultado || [])[0];
        if (casa?.erro) { setErro(casa.erro); return; }
        await abrirMes(alvo[alvo.length - 1]);
      }
      await carregarLista(activeId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao extrair");
    } finally { setCarregando(false); setProgresso(""); }
  }
  const toggleSel = (comp: string) => setSel((s) => { const n = new Set(s); n.has(comp) ? n.delete(comp) : n.add(comp); return n; });

  // Backfill em lote (12 meses) pro agente de IA.
  async function salvarProAgente() {
    if (!activeId || backfill === "rodando") return;
    setBackfill("rodando");
    try {
      const r = await fetch(`/api/altec-relatorio?rid=${encodeURIComponent(activeId)}&meses=12`, { method: "POST", headers: { ...(await authHeader()) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBackfill("erro: " + ((j as { error?: string }).error || `HTTP ${r.status}`)); return; }
      const casa = ((j as { resultado?: Array<{ meses?: unknown[] }> }).resultado || [])[0];
      setBackfill(`✓ ${Array.isArray(casa?.meses) ? casa!.meses!.length : 0} meses gravados`);
      await carregarLista(activeId);
    } catch (e) { setBackfill("erro: " + (e instanceof Error ? e.message : "?")); }
  }

  const extraidosMap = useMemo(() => new Map(meses.map((m) => [m.comp, m.geradoEm] as const)), [meses]);
  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.categoria))].sort(), [produtos]);
  const produtosVis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const arr = produtos.filter((p) => (!catSel || p.categoria === catSel) && (!b || p.produto.toLowerCase().includes(b)));
    return [...arr].sort((a, z) => {
      const va = a[ordem.col], vz = z[ordem.col];
      if (typeof va === "number" && typeof vz === "number") return (va - vz) * ordem.dir;
      return String(va).localeCompare(String(vz)) * ordem.dir;
    });
  }, [produtos, busca, catSel, ordem]);
  const totVis = useMemo(() => produtosVis.reduce((s, p) => ({ qtd: s.qtd + p.qtd, bruto: s.bruto + p.fatBruto, liq: s.liq + p.fatLiquido }), { qtd: 0, bruto: 0, liq: 0 }), [produtosVis]);

  const toggleOrdem = (col: keyof Produto) => setOrdem((o) => (o.col === col ? { col, dir: (o.dir === 1 ? -1 : 1) } : { col, dir: -1 }));
  function exportarCSV() {
    const linhas = [["ID", "Produto", "Categoria", "Qtd", "Fat Bruto", "Fat Liquido", "% Total", "Curva"]];
    for (const p of produtosVis) linhas.push([p.id, p.produto, p.categoria, String(p.qtd).replace(".", ","), p.fatBruto.toFixed(2).replace(".", ","), p.fatLiquido.toFixed(2).replace(".", ","), p.pctTotal.toFixed(2).replace(".", ","), p.curva]);
    const csv = linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `vendas-produto_${selecionado || "mes"}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const setC = (col: keyof Produto, label: string, cls = "text-right") => (
    <th className={`px-2 py-1.5 ${cls} cursor-pointer select-none whitespace-nowrap`} onClick={() => toggleOrdem(col)}>
      {label}{ordem.col === col ? (ordem.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  // ── Turno (lê vendasAltec já sincronizado) — mesmo seletor de mês ──────────
  const [mesTurno, setMesTurno] = useState(todayYmd().slice(0, 7));
  const [dias, setDias] = useState<DiaHora[]>([]);
  const [carregandoTurno, setCarregandoTurno] = useState(false);
  const [corte, setCorte] = useState(17);
  // Meses que TÊM venda sincronizada (pra marcar em verde no seletor do turno).
  const [mesesTurno, setMesesTurno] = useState<Map<string, string | undefined>>(new Map());
  const idxTurnoRef = useRef("");
  useEffect(() => {
    if (aba !== "turno" || !activeId || idxTurnoRef.current === activeId) return;
    idxTurnoRef.current = activeId;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "vendasAltec"), where("restaurantId", "==", activeId)));
        const m = new Map<string, string | undefined>();
        snap.docs.forEach((d) => { const data = String((d.data() as { data?: string }).data || d.id.split("_").pop() || ""); if (/^\d{4}-\d{2}/.test(data)) m.set(data.slice(0, 7), undefined); });
        setMesesTurno(m);
      } catch { /* rules/rede */ }
    })();
  }, [aba, activeId]);

  useEffect(() => {
    if (aba !== "turno" || !activeId) return;
    let cancelado = false;
    (async () => {
      setCarregandoTurno(true);
      const { di, df } = rangeDoComp(mesTurno);
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
      setDias(out); setCarregandoTurno(false);
    })();
    return () => { cancelado = true; };
  }, [aba, activeId, mesTurno]);

  const turno = useMemo(() => {
    const somaFaixa = (h: number[], lo: number, hi: number) => h.slice(lo, hi).reduce((a, b) => a + (b || 0), 0);
    const linhas = dias.map((d) => { const almoco = somaFaixa(d.porHora, 0, corte); return { data: d.data, almoco, noite: d.fat - almoco, total: d.fat }; });
    const tot = linhas.reduce((s, l) => ({ almoco: s.almoco + l.almoco, noite: s.noite + l.noite, total: s.total + l.total }), { almoco: 0, noite: 0, total: 0 });
    return { linhas, tot };
  }, [dias, corte]);

  if (!activeId) return <div className="p-6 text-sm text-gray-500">Selecione um restaurante.</div>;

  return (
    <PageContainer>
      <div className="mb-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {activeRestaurant?.nome} · direto do PDV Altec/Riser (caixa encerrado). Produtos vendidos e faturamento por turno.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-3">
        {([["produtos", "Produtos vendidos"], ["turno", "Faturamento por turno"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${aba === id ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === "produtos" ? (
        <div>
          {/* Extrair meses (pode marcar vários) */}
          <div className="mb-3">
            <label className="block text-[11px] text-gray-500 mb-1">Escolha os meses pra extrair (pode marcar vários)</label>
            <SeletorMesAno selected={sel} onPick={toggleSel} extraidos={extraidosMap} max={todayYmd().slice(0, 7)} />
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" onClick={() => void extrair([...sel])} disabled={carregando || sel.size === 0}>
                {carregando ? "Extraindo…" : `Extrair ${sel.size} ${sel.size === 1 ? "mês" : "meses"}`}
              </Button>
              {sel.size > 0 && !carregando && <button onClick={() => setSel(new Set())} className="text-xs text-gray-400 hover:underline">limpar seleção</button>}
              {progresso && <span className="text-xs text-gray-500">{progresso}</span>}
            </div>
          </div>

          <div className="mb-3 text-xs">
            <button onClick={() => void salvarProAgente()} disabled={backfill === "rodando"} className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-300 hover:underline disabled:opacity-50">
              {backfill === "rodando" ? <><Hourglass size={12} /> extraindo 12 meses…</> : "⤓ Extrair últimos 12 meses de uma vez (pro agente de IA)"}
            </button>
            {backfill && backfill !== "rodando" && <span className="ml-2 text-gray-500">{backfill}</span>}
          </div>

          {/* Confirmação de sobrescrita */}
          {confirmar.length > 0 && (() => {
            const ja = confirmar.filter((c) => extraidosMap.has(c));
            return (
              <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                <div className="text-sm text-amber-900 dark:text-amber-100">
                  {confirmar.length === 1
                    ? <><b>{nomeComp(confirmar[0]).replace(/^\w/, (c) => c.toUpperCase())}</b> já foi extraído{ja[0] && extraidosMap.get(ja[0]) ? ` em ${dtBR(extraidosMap.get(ja[0]))}` : ""}. Extrair de novo do PDV e <b>sobrescrever</b>?</>
                    : <><b>{confirmar.length} meses</b> selecionados — <b>{ja.length}</b> já extraído(s) serão <b>sobrescritos</b>. Extrair todos?</>}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="danger" onClick={() => void extrair(confirmar, true)}>{confirmar.length === 1 ? "Sobrescrever" : "Extrair todos"}</Button>
                  {confirmar.length === 1 && <Button size="sm" variant="secondary" onClick={() => { const c = confirmar[0]; setConfirmar([]); void abrirMes(c); }}>Ver o salvo</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmar([])}>Cancelar</Button>
                </div>
              </div>
            );
          })()}

          {carregando && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-sm text-gray-500 flex items-center gap-2">
              <Hourglass size={14} className="animate-spin" /> Consultando o Altec (login + relatório) — leva alguns segundos…
            </div>
          )}
          {erro && <div className="mb-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300">⚠ {erro}</div>}

          {/* Lista de meses extraídos */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden mb-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800">
              Meses extraídos {meses.length ? `(${meses.length})` : ""}
            </div>
            {carregandoLista ? (
              <div className="p-4 text-sm text-gray-500">Carregando…</div>
            ) : meses.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">Nenhum mês extraído ainda. Escolha um mês acima e clique em <b>Extrair do PDV</b>.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {meses.map((m) => (
                  <li key={m.comp} className={`flex items-center gap-3 px-3 py-2.5 ${selecionado === m.comp ? "bg-indigo-50/60 dark:bg-indigo-950/20" : "hover:bg-gray-50 dark:hover:bg-gray-900/40"}`}>
                    <button onClick={() => void abrirMes(m.comp)} className="flex-1 text-left">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-1"><CalendarDays size={14} /> {nomeComp(m.comp).replace(/^\w/, (c) => c.toUpperCase())}</div>
                      <div className="text-[11px] text-gray-500">
                        {m.totalProdutos} produtos · {money(m.totalFatBruto)} · extraído em {dtBR(m.geradoEm) || "—"}
                      </div>
                    </button>
                    <button onClick={() => void abrirMes(m.comp)} className="text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline">Ver</button>
                    <button onClick={() => void extrair([m.comp])} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:underline">Re-extrair</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Tabela do mês selecionado */}
          {selecionado && meta && (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{nomeComp(selecionado).replace(/^\w/, (c) => c.toUpperCase())}</h2>
                <span className="text-[11px] text-gray-400">extraído em {dtBR(meta.geradoEm) || "—"}</span>
              </div>
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
          <div className="flex flex-wrap items-start gap-3 mb-3">
            <div className="flex-1 min-w-[280px]">
              <label className="block text-[11px] text-gray-500 mb-1">Escolha o mês</label>
              <SeletorMesAno selected={new Set([mesTurno])} onPick={setMesTurno} extraidos={mesesTurno} rotuloVerde="com vendas" max={todayYmd().slice(0, 7)} />
            </div>
            <div className="pt-6">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{nomeComp(mesTurno).replace(/^\w/, (c) => c.toUpperCase())}</h2>
              <p className="text-[11px] text-gray-400">faturamento faturado (caixa encerrado) por turno</p>
            </div>
          </div>
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
                <Card titulo={<span className="inline-flex items-center gap-1"><UtensilsCrossed size={12} /> Almoço</span>} valor={money(turno.tot.almoco)} sub={turno.tot.total ? `${((turno.tot.almoco / turno.tot.total) * 100).toFixed(0)}%` : ""} />
                <Card titulo={<span className="inline-flex items-center gap-1"><Moon size={12} /> Noite</span>} valor={money(turno.tot.noite)} sub={turno.tot.total ? `${((turno.tot.noite / turno.tot.total) * 100).toFixed(0)}%` : ""} />
                <Card titulo="Total" valor={money(turno.tot.total)} sub={`${dias.length} dias`} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 text-xs">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Dia</th>
                      <th className="px-2 py-1.5 text-right"><span className="inline-flex items-center gap-1 justify-end"><UtensilsCrossed size={12} /> Almoço</span></th>
                      <th className="px-2 py-1.5 text-right"><span className="inline-flex items-center gap-1 justify-end"><Moon size={12} /> Noite</span></th>
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
    </PageContainer>
  );
}

// Seletor mês/ano HORIZONTAL, largura toda: ano em setas + 12 meses lado a lado.
// Multi-seleção (via Set `selected` + `onPick` que alterna). Marca os já
// extraídos (✓ verde) e bloqueia os futuros. `max` = "YYYY-MM" máximo.
function SeletorMesAno({ selected, onPick, extraidos, max, rotuloVerde = "extraído" }: { selected: Set<string>; onPick: (c: string) => void; extraidos?: Map<string, string | undefined>; max: string; rotuloVerde?: string }) {
  const anoMax = Number(max.slice(0, 4));
  const primeiroSel = [...selected][0];
  const [ano, setAno] = useState(Number((primeiroSel || max).slice(0, 4)) || anoMax);
  return (
    <div className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5">
      <div className="flex items-center gap-3 mb-2">
        <button type="button" onClick={() => setAno((a) => Math.max(2024, a - 1))} disabled={ano <= 2024}
          className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30">‹</button>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tabular-nums w-12 text-center">{ano}</span>
        <button type="button" onClick={() => setAno((a) => Math.min(anoMax, a + 1))} disabled={ano >= anoMax}
          className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30">›</button>
        {extraidos && (
          <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-400">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800" /> {rotuloVerde}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" /> selecionado</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
        {MESES_ABBR.map((lbl, i) => {
          const comp = `${ano}-${String(i + 1).padStart(2, "0")}`;
          const futuro = comp > max;
          const ext = extraidos?.has(comp) ?? false;
          const sel = selected.has(comp);
          return (
            <button key={comp} type="button" disabled={futuro} onClick={() => onPick(comp)}
              title={ext ? (extraidos?.get(comp) ? `extraído em ${dtBR(extraidos?.get(comp))}` : rotuloVerde) : futuro ? "mês futuro" : ""}
              className={`relative text-xs py-2 rounded-lg border capitalize transition-colors ${
                sel ? "border-indigo-600 bg-indigo-600 text-white font-semibold"
                : futuro ? "border-transparent text-gray-300 dark:text-gray-700 cursor-not-allowed"
                : ext ? "border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 hover:border-emerald-400"
                : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              {lbl}
              {ext && !sel && <span className="absolute top-0.5 right-0.5 text-[8px] text-emerald-600 dark:text-emerald-400">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Card({ titulo, valor, sub }: { titulo: ReactNode; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{titulo}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
