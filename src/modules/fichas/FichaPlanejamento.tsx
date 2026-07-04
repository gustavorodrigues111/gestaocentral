// Fase 3 — Planejamento de produção (lote). Um plano junta várias fichas (com
// quanto de cada), atribui responsável e dia, e gera a lista consolidada de
// insumos (compras) + o que produzir. Export PDF. Sem custo.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import type { jsPDF as JsPDFType } from "jspdf";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { FtConfig, FtFicha, FtInsumo, FtPlanoProducao, Pessoa } from "../../core/types";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { labelUnidade } from "./unidades";
import { explodirLote } from "./producao";
import { custoLoteFicha } from "./custo";
import { normalizarNome } from "./dedup";
import { fmtBR } from "../../core/utils/date";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const fmtMoeda = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const STATUS: Record<FtPlanoProducao["status"], { label: string; cls: string }> = {
  rascunho: { label: "rascunho", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  planejado: { label: "planejado", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  concluido: { label: "produção confirmada", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

// Nome automático do plano pelo dia de produção + sequência (02, 03…) quando há
// mais de um plano no mesmo dia. Ex.: "Produção de terça", "Produção de terça 02".
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function nomeAutoPlano(data: string, planos: FtPlanoProducao[], selfId: string): string {
  const d = new Date((data || "") + "T00:00:00");
  const base = isNaN(d.getTime()) ? "Produção" : `Produção de ${DIAS_SEMANA[d.getDay()]}`;
  const n = planos.filter(pp => pp.ativo !== false && pp.data === data && pp.id !== selfId).length;
  return n > 0 ? `${base} ${String(n + 1).padStart(2, "0")}` : base;
}

export function PlanejamentoView({ rid, planos, fichas, insumos, meId, meNome, restauranteNome }: { rid: string; planos: FtPlanoProducao[]; fichas: FtFicha[]; insumos: FtInsumo[]; meId?: string; meNome?: string; restauranteNome?: string }) {
  const [editar, setEditar] = useState<FtPlanoProducao | null>(null);
  const [vista, setVista] = useState<"lista" | "cal">("lista");
  const [equipeOpen, setEquipeOpen] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [produtoresIds, setProdutoresIds] = useState<string[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)), snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
    const u2 = onSnapshot(doc(db, "ftConfig", rid), snap => setProdutoresIds((snap.exists() ? (snap.data() as FtConfig).produtoresIds : []) || []));
    return () => { u1(); u2(); };
  }, [rid]);
  async function saveEquipe(ids: string[]) { await setDoc(doc(db, "ftConfig", rid), sanitizeForFirestore({ id: rid, restaurantId: rid, produtoresIds: ids }), { merge: true }); }
  function novo(data?: string) {
    setEditar({ id: uid("plano"), restaurantId: rid, nome: "", data: data || new Date().toISOString().slice(0, 10), status: "rascunho", itens: [], ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome });
  }
  if (editar) return <PlanoEditor plano={editar} planos={planos} fichas={fichas} insumos={insumos} restauranteNome={restauranteNome} pessoas={pessoas} produtoresIds={produtoresIds} onSaveEquipe={saveEquipe} onClose={() => setEditar(null)} />;
  const lista = planos.filter(p => p.ativo !== false).sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {([["lista", "📋 Lista"], ["cal", "📅 Calendário"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setVista(v)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${vista === v ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => setEquipeOpen(true)}>⚙️ Equipe de produção</Button>
        <Button onClick={() => novo()}>+ Novo plano</Button>
      </div>
      {equipeOpen && <EquipeProducaoModal pessoas={pessoas} produtoresIds={produtoresIds} onSave={saveEquipe} onClose={() => setEquipeOpen(false)} />}
      {vista === "cal" ? (
        <CalendarioPlanos planos={lista} onAbrir={setEditar} onNovo={novo} />
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhum plano de produção ainda. Crie um pra escalar várias fichas de uma vez e sair com a lista de insumos.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {lista.map(p => (
            <button key={p.id} type="button" onClick={() => setEditar(p)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
              <span className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-base shrink-0">📋</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome || "(sem nome)"} <span className={`ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span></div>
                <div className="text-xs text-gray-500">{p.data ? fmtBR(p.data) : "sem data"} · {p.itens.length} ficha{p.itens.length === 1 ? "" : "s"}</div>
              </div>
              <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Abrir →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Calendário mensal dos planos de produção (por dia). Clica no plano → abre;
// clica no "+" do dia → novo plano naquele dia.
function CalendarioPlanos({ planos, onAbrir, onNovo }: { planos: FtPlanoProducao[]; onAbrir: (p: FtPlanoProducao) => void; onNovo: (data: string) => void }) {
  const hojeIso = new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const primeiro = new Date(ym.y, ym.m, 1);
  const inicioSemana = primeiro.getDay();
  const diasNoMes = new Date(ym.y, ym.m + 1, 0).getDate();
  const celulas: (string | null)[] = [];
  for (let i = 0; i < inicioSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(`${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const porDia = useMemo(() => { const m = new Map<string, FtPlanoProducao[]>(); for (const p of planos) { if (!p.data) continue; const arr = m.get(p.data) || []; arr.push(p); m.set(p.data, arr); } return m; }, [planos]);
  const mesNome = primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  function nav(delta: number) { setYm(s => { const total = s.y * 12 + s.m + delta; return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }; }); }
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => nav(-1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 text-lg">‹</button>
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 capitalize">{mesNome}</div>
        <button type="button" onClick={() => nav(1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 text-lg">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-gray-400 mb-1">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((iso, i) => iso === null ? <div key={i} /> : (
          <div key={i} className={`group min-h-[70px] rounded-lg border p-1 ${iso === hojeIso ? "border-indigo-400 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/10" : "border-gray-200 dark:border-gray-800"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] ${iso === hojeIso ? "text-indigo-600 dark:text-indigo-300 font-bold" : "text-gray-400"}`}>{Number(iso.slice(8))}</span>
              <button type="button" onClick={() => onNovo(iso)} title="novo plano neste dia" className="text-[13px] leading-none text-gray-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">＋</button>
            </div>
            <div className="space-y-0.5 mt-0.5">
              {(porDia.get(iso) || []).slice(0, 3).map(p => (
                <button key={p.id} type="button" onClick={() => onAbrir(p)} title={`${p.nome || "(plano)"} · ${STATUS[p.status].label}`} className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate ${STATUS[p.status].cls}`}>{p.nome || "(plano)"}</button>
              ))}
              {(porDia.get(iso) || []).length > 3 && <div className="text-[9px] text-gray-400 pl-1">+{(porDia.get(iso) || []).length - 3} mais</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanoEditor({ plano, planos, fichas, insumos, restauranteNome, pessoas, produtoresIds, onSaveEquipe, onClose }: { plano: FtPlanoProducao; planos: FtPlanoProducao[]; fichas: FtFicha[]; insumos: FtInsumo[]; restauranteNome?: string; pessoas: Pessoa[]; produtoresIds: string[]; onSaveEquipe: (ids: string[]) => Promise<void>; onClose: () => void }) {
  const [p, setP] = useState<FtPlanoProducao>(plano);
  const [salvando, setSalvando] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; doc: JsPDFType } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [etiquetas, setEtiquetas] = useState(false);
  const [picker, setPicker] = useState(false);
  const [equipe, setEquipe] = useState(false);
  const [nomeEditado, setNomeEditado] = useState(!!plano.nome.trim());
  const produtores = useMemo(() => pessoas.filter(x => (produtoresIds || []).includes(x.id)).sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas, produtoresIds]);
  // Enquanto o usuário não editar o nome à mão, ele acompanha o dia de produção.
  useEffect(() => { if (!nomeEditado) setP(prev => ({ ...prev, nome: nomeAutoPlano(prev.data, planos, prev.id) })); }, [p.data, nomeEditado, planos]);
  const itensFicha = useMemo(() => p.itens.map(it => ({ it, ficha: fichas.find(f => f.id === it.fichaId && f.ativo !== false) })).filter(x => x.ficha) as { it: FtPlanoProducao["itens"][number]; ficha: FtFicha }[], [p.itens, fichas]);
  const explosao = useMemo(() => explodirLote(itensFicha.map(x => ({ ficha: x.ficha, qtd: x.it.qtd })), fichas, insumos), [itensFicha, fichas, insumos]);
  const custoItens = useMemo(() => itensFicha.map(({ it, ficha }) => {
    const custoLote = custoLoteFicha(ficha, it.qtd, insumos, fichas);
    const planejado = it.qtd || 0;
    const real = it.rendimentoReal != null && it.rendimentoReal > 0 ? it.rendimentoReal : planejado;
    return { it, ficha, custoLote, planejado, real,
      teoUnit: planejado > 0 ? custoLote / planejado : 0,
      realUnit: real > 0 ? custoLote / real : 0,
      perda: planejado > 0 ? Math.round(((planejado - real) / planejado) * 1000) / 10 : 0 };
  }), [itensFicha, insumos, fichas]);
  const custoTotalLote = useMemo(() => custoItens.reduce((s, x) => s + x.custoLote, 0), [custoItens]);
  // Confirmar produção: transforma o rascunho em produção real (persiste na hora).
  async function confirmarProducao() {
    const confirmado: FtPlanoProducao = { ...p, status: "concluido", concluidoEm: p.concluidoEm || new Date().toISOString(), nome: p.nome.trim() || nomeAutoPlano(p.data, planos, p.id), itens: p.itens.map(i => ({ ...i, rendimentoReal: i.rendimentoReal ?? i.qtd })) };
    setSalvando(true);
    try { await setDoc(doc(db, "ftPlanosProducao", confirmado.id), sanitizeForFirestore(confirmado)); setP(confirmado); }
    catch (e) { alert("Erro ao confirmar: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  function reabrir() { setP(prev => ({ ...prev, status: "rascunho" })); }
  function patchItem(id: string, patch: Partial<FtPlanoProducao["itens"][number]>) { setP(prev => ({ ...prev, itens: prev.itens.map(i => i.id === id ? { ...i, ...patch } : i) })); }
  function removeItem(id: string) { setP(prev => ({ ...prev, itens: prev.itens.filter(i => i.id !== id) })); }
  function removeByFicha(fid: string) { setP(prev => ({ ...prev, itens: prev.itens.filter(i => i.fichaId !== fid) })); }
  function addFicha(f: FtFicha) { setP(prev => ({ ...prev, itens: [...prev.itens, { id: uid("pi"), fichaId: f.id, qtd: f.ehSubficha ? (f.rendimento.qtd || 1) : (f.producaoPadrao || 1) }] })); }
  async function salvar() {
    setSalvando(true);
    try { await setDoc(doc(db, "ftPlanosProducao", p.id), sanitizeForFirestore({ ...p, nome: p.nome.trim() || nomeAutoPlano(p.data, planos, p.id) })); onClose(); }
    catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }
  async function excluir() { if (confirm("Excluir este plano?")) { await updateDoc(doc(db, "ftPlanosProducao", p.id), { ativo: false }); onClose(); } }
  async function preview() {
    setGerando(true);
    try {
      const { gerarPlanoProducaoPDF } = await import("./gerarPlanoProducaoPDF");
      const doc = await gerarPlanoProducaoPDF(p, itensFicha, explosao, restauranteNome);
      setPdf({ url: doc.output("bloburl") as unknown as string, doc });
    } catch (e) { alert("Erro no PDF: " + (e instanceof Error ? e.message : String(e))); }
    finally { setGerando(false); }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Voltar</button>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS[p.status].cls}`}>{p.status === "concluido" ? "✅ " : "📝 "}{STATUS[p.status].label}</span>
        <div className="ml-auto flex gap-2">
          {p.status !== "concluido"
            ? <Button size="sm" onClick={() => void confirmarProducao()} disabled={salvando || itensFicha.length === 0}>✅ Confirmar produção</Button>
            : <Button variant="ghost" size="sm" onClick={reabrir}>↩︎ Reabrir (rascunho)</Button>}
          <Button variant="secondary" size="sm" onClick={() => setEtiquetas(true)} disabled={itensFicha.length === 0}>🏷️ Etiquetas</Button>
          <Button variant="secondary" size="sm" onClick={() => void preview()} disabled={gerando || itensFicha.length === 0}>{gerando ? "Gerando…" : "🖨️ Exportar PDF"}</Button>
          <Button variant="secondary" size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar rascunho"}</Button>
        </div>
      </div>

      {/* Cabeçalho do plano */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
        <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Dia de produção</span>
          <input type="date" value={p.data} onChange={e => setP({ ...p, data: e.target.value })} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" /></div>
        <Input label="Nome do plano" value={p.nome} onChange={e => { setNomeEditado(true); setP({ ...p, nome: e.target.value }); }} placeholder="ex: Produção de terça" />
      </div>

      {/* O que produzir */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">O que produzir</div>
        {itensFicha.map(({ it, ficha }) => (
          <div key={it.id} className="flex items-center gap-2 flex-wrap py-1.5 border-t border-gray-100 dark:border-gray-800 first:border-0">
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{ficha.ehSubficha ? "base" : "prato"}</span>
            <span className="flex-1 min-w-[120px] text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{UP(ficha.nome)}</span>
            <div className="inline-flex items-center h-8 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1">
              <button type="button" onClick={() => patchItem(it.id, { qtd: Math.max(round3(it.qtd - (it.qtd >= 10 ? 5 : 1)), 0.001) })} className="w-6 h-6 text-gray-500 hover:text-indigo-600 text-lg leading-none">−</button>
              <input type="text" inputMode="decimal" value={fmtQtd(it.qtd)} onChange={e => patchItem(it.id, { qtd: Number(e.target.value.replace(/[^0-9.,]/g, "").replace(",", ".")) || 0 })} className="w-14 text-center bg-transparent text-sm outline-none dark:text-gray-100" />
              <button type="button" onClick={() => patchItem(it.id, { qtd: round3(it.qtd + (it.qtd >= 10 ? 5 : 1)) })} className="w-6 h-6 text-gray-500 hover:text-indigo-600 text-lg leading-none">+</button>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções"}</span>
            {produtores.length > 0 ? (
              <select value={it.responsavelId || ""} onChange={e => { const pid = e.target.value; patchItem(it.id, { responsavelId: pid || null, responsavel: produtores.find(x => x.id === pid)?.nome || null }); }} className="h-8 w-36 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
                <option value="">responsável…</option>
                {it.responsavelId && !produtores.some(x => x.id === it.responsavelId) && <option value={it.responsavelId}>{it.responsavel || "?"}</option>}
                {produtores.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => setEquipe(true)} title="Configure quem pode produzir" className="h-8 text-xs px-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-indigo-600 hover:border-indigo-400">+ definir equipe</button>
            )}
            <button type="button" onClick={() => removeItem(it.id)} className="text-gray-400 hover:text-red-600 text-base px-1 shrink-0">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setPicker(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10">
          <span>🔎</span> + adicionar ficha ou base ao plano
        </button>
      </div>

      {/* Lista de insumos (BOM) */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">🛒 Lista de insumos ({explosao.insumos.length})</div>
        {explosao.insumos.length === 0 ? <div className="text-xs text-gray-400 italic">Adicione fichas pra gerar a lista.</div> : (
          <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <thead><tr className="bg-gray-50 dark:bg-gray-800/40 text-[11px] uppercase tracking-wide text-gray-500"><th className="text-left font-semibold px-3 py-1.5">Insumo</th><th className="text-right font-semibold px-3 py-1.5 w-32">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {explosao.insumos.map((l, k) => <tr key={k}><td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">{UP(l.nome)}</td><td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{l.qb ? "q.b." : `${fmtQtd(l.qtd)} ${labelUnidade(l.unidade)}`}</td></tr>)}
            </tbody>
          </table>
        )}
        {explosao.subprodutos.length > 0 && <div className="text-[11px] text-gray-400">Usa também (sai de preparos): {explosao.subprodutos.map(s => `${UP(s.nome)}${s.qb ? "" : ` ${fmtQtd(s.qtd)} ${labelUnidade(s.unidade)}`}`).join(", ")}.</div>}
      </div>

      {/* Custo do lote & rendimento real (custo teórico × real) */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">💰 Custo do lote {custoTotalLote > 0 && <span className="text-gray-400 font-normal">· total {fmtMoeda(custoTotalLote)}</span>}</div>
          {p.status === "concluido" && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">✅ produzido{p.concluidoEm ? ` em ${fmtBR(p.concluidoEm.slice(0, 10))}` : ""}</span>}
        </div>
        {custoItens.length === 0 ? <div className="text-xs text-gray-400 italic">Adicione fichas pra ver o custo.</div> : custoTotalLote <= 0 ? (
          <div className="text-xs text-amber-600 dark:text-amber-400">Sem custo calculado — cadastre o preço dos insumos (em Cadastros → Insumos) pra ver o custo do lote.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden min-w-[560px]">
              <thead><tr className="bg-gray-50 dark:bg-gray-800/40 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold px-3 py-1.5">Ficha</th>
                <th className="text-right font-semibold px-3 py-1.5 w-28">Custo do lote</th>
                <th className="text-left font-semibold px-3 py-1.5 w-40">Rendimento real</th>
                <th className="text-right font-semibold px-3 py-1.5 w-28">Custo real/un</th>
                <th className="text-right font-semibold px-3 py-1.5 w-20">Perda</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {custoItens.map(x => {
                  const un = x.ficha.ehSubficha ? labelUnidade(x.ficha.rendimento.unidade) : "porções";
                  return (
                    <tr key={x.it.id}>
                      <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">{UP(x.ficha.nome)}<span className="text-[11px] text-gray-400"> · plano {fmtQtd(x.planejado)} {un}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{x.custoLote > 0 ? fmtMoeda(x.custoLote) : "—"}</td>
                      <td className="px-3 py-1.5">
                        <div className="inline-flex items-center gap-1">
                          <input type="text" inputMode="decimal" value={x.it.rendimentoReal != null ? fmtQtd(x.it.rendimentoReal) : ""} onChange={e => { const v = e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."); patchItem(x.it.id, { rendimentoReal: v === "" ? null : (Number(v) || 0) }); }} placeholder={fmtQtd(x.planejado)} className="w-20 h-8 text-right px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100 tabular-nums" />
                          <span className="text-[11px] text-gray-400">{un}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100 font-medium">{x.realUnit > 0 ? fmtMoeda(x.realUnit) : "—"}{x.realUnit > 0 && x.teoUnit > 0 && x.real !== x.planejado && <span className="block text-[10px] text-gray-400 font-normal">teórico {fmtMoeda(x.teoUnit)}</span>}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${x.perda > 0 ? "text-rose-600 dark:text-rose-400" : x.perda < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>{x.perda > 0 ? `−${x.perda}%` : x.perda < 0 ? `+${Math.abs(x.perda)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-gray-400">Custo real por unidade = custo do lote ÷ rendimento real. A diferença pro custo teórico é a perda de produção (quebra/sobra).</p>
      </div>

      <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
        <Button variant="ghost" size="sm" onClick={excluir}>🗑️ Excluir plano</Button>
        <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </div>

      {pdf && (
        <Modal title="Pré-visualização do PDF" onClose={() => setPdf(null)} maxWidth="max-w-4xl">
          <div className="space-y-3">
            <iframe title="pdf" src={pdf.url} className="w-full h-[68vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white" />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPdf(null)}>Fechar</Button><Button onClick={() => pdf.doc.save(`plano-${normalizarNome(p.nome || p.data).replace(/\s+/g, "-")}.pdf`)}>⬇️ Baixar PDF</Button></div>
          </div>
        </Modal>
      )}

      {etiquetas && <EtiquetasModal itensFicha={itensFicha} dataProducao={p.data} nomePlano={p.nome} restauranteNome={restauranteNome} onValidade={(id, dias) => patchItem(id, { validadeDias: dias })} onClose={() => setEtiquetas(false)} />}
      {picker && <FichaPickerModal fichas={fichas} jaTem={new Set(p.itens.map(i => i.fichaId))} onAdd={addFicha} onRemove={removeByFicha} onClose={() => setPicker(false)} />}
      {equipe && <EquipeProducaoModal pessoas={pessoas} produtoresIds={produtoresIds} onSave={onSaveEquipe} onClose={() => setEquipe(false)} />}
    </div>
  );
}

// Modal de seleção de ficha/base: escolhe o grupo, busca e clica no card.
// Card já no plano fica marcado (✓) e clicar remove.
function FichaPickerModal({ fichas, jaTem, onAdd, onRemove, onClose }: { fichas: FtFicha[]; jaTem: Set<string>; onAdd: (f: FtFicha) => void; onRemove: (fid: string) => void; onClose: () => void }) {
  const [grupo, setGrupo] = useState<"finais" | "bases">("finais");
  const [busca, setBusca] = useState("");
  const bn = normalizarNome(busca);
  const lista = useMemo(() => fichas
    .filter(f => f.ativo !== false && (grupo === "bases" ? f.ehSubficha : !f.ehSubficha))
    .filter(f => (f.ingredientes || []).length > 0)
    .filter(f => !bn || normalizarNome(f.nome).includes(bn))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [fichas, grupo, bn]);
  return (
    <Modal title="Adicionar ao plano" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {([["finais", "🍽️ Pratos finais"], ["bases", "🧩 Bases"]] as const).map(([g, l]) => (
              <button key={g} type="button" onClick={() => setGrupo(g)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${grupo === g ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔎</span>
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar ${grupo === "bases" ? "base" : "prato"}…`} className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          </div>
        </div>
        {lista.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-10">Nada encontrado.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[52vh] overflow-y-auto pr-0.5">
            {lista.map(f => { const tem = jaTem.has(f.id); return (
              <button key={f.id} type="button" onClick={() => tem ? onRemove(f.id) : onAdd(f)} className={`text-left rounded-xl border p-2.5 transition-colors ${tem ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20" : "border-gray-200 dark:border-gray-800 hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10"}`}>
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 leading-tight">{UP(f.nome)}</span>
                  {tem && <span className="text-emerald-600 text-sm shrink-0">✓</span>}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">{f.ehSubficha ? `rende ${fmtQtd(f.rendimento.qtd)} ${labelUnidade(f.rendimento.unidade)}` : "prato final"}</div>
              </button>
            ); })}
          </div>
        )}
        <div className="flex justify-between items-center pt-1">
          <span className="text-[11px] text-gray-400">Clique pra adicionar · ✓ = já no plano (clique remove)</span>
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Modal>
  );
}

// Configura a equipe de produção: pessoas que podem ser responsáveis por lotes.
function EquipeProducaoModal({ pessoas, produtoresIds, onSave, onClose }: { pessoas: Pessoa[]; produtoresIds: string[]; onSave: (ids: string[]) => Promise<void>; onClose: () => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(produtoresIds));
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const bn = normalizarNome(busca);
  const lista = useMemo(() => pessoas.slice().sort((a, b) => a.nome.localeCompare(b.nome)).filter(pp => !bn || normalizarNome(pp.nome).includes(bn)), [pessoas, bn]);
  function toggle(id: string) { setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  async function salvar() { setSalvando(true); try { await onSave([...sel]); onClose(); } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); } }
  return (
    <Modal title="⚙️ Equipe de produção" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Marque quem pode ser responsável por uma produção. Só essas pessoas aparecem no seletor de responsável dos planos.</p>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar pessoa…" className="w-full h-9 px-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">Nenhuma pessoa neste restaurante.</div> : lista.map(pp => (
            <label key={pp.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <input type="checkbox" checked={sel.has(pp.id)} onChange={() => toggle(pp.id)} className="accent-indigo-600 w-4 h-4" />
              <span className="text-sm text-gray-800 dark:text-gray-100">{pp.nome}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between items-center pt-1">
          <span className="text-[11px] text-gray-400">{sel.size} selecionada{sel.size === 1 ? "" : "s"}</span>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button></div>
        </div>
      </div>
    </Modal>
  );
}

// Etiquetas de validade: por ficha, define validade (dias) e imprime PDF pra
// colar no recipiente. Validade = dia de produção + dias.
function EtiquetasModal({ itensFicha, dataProducao, nomePlano, restauranteNome, onValidade, onClose }: {
  itensFicha: { it: FtPlanoProducao["itens"][number]; ficha: FtFicha }[];
  dataProducao: string; nomePlano: string; restauranteNome?: string;
  onValidade: (id: string, dias: number | null) => void; onClose: () => void;
}) {
  const [pdf, setPdf] = useState<{ url: string; doc: JsPDFType } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copias, setCopias] = useState(1);
  function validadeIso(dias?: number | null) {
    if (!dias || dias <= 0 || !dataProducao) return "";
    const d = new Date(dataProducao + "T00:00:00"); d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  async function gerar() {
    setGerando(true);
    try {
      const { gerarEtiquetasPDF } = await import("./gerarEtiquetasPDF");
      const itens = itensFicha.map(({ it, ficha }) => {
        const un = ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções";
        const q = it.rendimentoReal != null && it.rendimentoReal > 0 ? it.rendimentoReal : it.qtd;
        const vi = validadeIso(it.validadeDias);
        return { nome: ficha.nome, qtd: `${fmtQtd(q)} ${un}`, produzidoEm: dataProducao ? fmtBR(dataProducao) : "—", validadeEm: vi ? fmtBR(vi) : "", responsavel: it.responsavel || "" };
      });
      const doc = await gerarEtiquetasPDF(restauranteNome || "", itens, copias);
      setPdf({ url: doc.output("bloburl") as unknown as string, doc });
    } catch (e) { alert("Erro nas etiquetas: " + (e instanceof Error ? e.message : String(e))); }
    finally { setGerando(false); }
  }
  return (
    <Modal title="🏷️ Etiquetas de validade" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Defina a validade (em dias a partir do dia de produção) de cada ficha e imprima as etiquetas pra colar nos recipientes.</p>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-[52vh] overflow-y-auto">
          {itensFicha.map(({ it, ficha }) => {
            const vi = validadeIso(it.validadeDias);
            return (
              <div key={it.id} className="flex items-center gap-2 px-3 py-2 flex-wrap">
                <span className="flex-1 min-w-[140px] text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{UP(ficha.nome)}</span>
                <div className="inline-flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">validade</span>
                  <input type="text" inputMode="numeric" value={it.validadeDias != null ? String(it.validadeDias) : ""} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); onValidade(it.id, v === "" ? null : Number(v)); }} placeholder="—" className="w-14 h-8 text-center px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                  <span className="text-[11px] text-gray-400">dias</span>
                </div>
                <span className="text-[11px] w-28 text-right tabular-nums text-gray-500">{vi ? `→ ${fmtBR(vi)}` : "sem validade"}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">Cópias por ficha
            <input type="text" inputMode="numeric" value={String(copias)} onChange={e => setCopias(Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1))} className="w-14 h-8 text-center px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          </label>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => void gerar()} disabled={gerando || itensFicha.length === 0}>{gerando ? "Gerando…" : "🖨️ Gerar etiquetas"}</Button></div>
        </div>
        <p className="text-[11px] text-gray-400">{nomePlano ? `Plano: ${nomePlano} · ` : ""}Se um lote já foi produzido, a etiqueta usa o rendimento real informado.</p>
        {pdf && (
          <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <iframe title="etiquetas" src={pdf.url} className="w-full h-[52vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white" />
            <div className="flex justify-end"><Button onClick={() => pdf.doc.save(`etiquetas-${normalizarNome(nomePlano || dataProducao).replace(/\s+/g, "-")}.pdf`)}>⬇️ Baixar</Button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

