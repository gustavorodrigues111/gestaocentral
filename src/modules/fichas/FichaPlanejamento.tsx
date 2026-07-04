// Fase 3 — Planejamento de produção (lote). Um plano junta várias fichas (com
// quanto de cada), atribui responsável e dia, e gera a lista consolidada de
// insumos (compras) + o que produzir. Export PDF. Sem custo.
import { useMemo, useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import type { jsPDF as JsPDFType } from "jspdf";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { FtFicha, FtInsumo, FtPlanoProducao } from "../../core/types";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { labelUnidade } from "./unidades";
import { explodirLote } from "./producao";
import { normalizarNome } from "./dedup";
import { fmtBR } from "../../core/utils/date";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const round3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const STATUS: Record<FtPlanoProducao["status"], { label: string; cls: string }> = {
  rascunho: { label: "rascunho", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  planejado: { label: "planejado", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  concluido: { label: "concluído", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

export function PlanejamentoView({ rid, planos, fichas, insumos, meId, meNome }: { rid: string; planos: FtPlanoProducao[]; fichas: FtFicha[]; insumos: FtInsumo[]; meId?: string; meNome?: string }) {
  const [editar, setEditar] = useState<FtPlanoProducao | null>(null);
  function novo() {
    setEditar({ id: uid("plano"), restaurantId: rid, nome: "", data: new Date().toISOString().slice(0, 10), status: "rascunho", itens: [], ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome });
  }
  if (editar) return <PlanoEditor plano={editar} fichas={fichas} insumos={insumos} onClose={() => setEditar(null)} />;
  const lista = planos.filter(p => p.ativo !== false).sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={novo}>+ Novo plano</Button></div>
      {lista.length === 0 ? (
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

function PlanoEditor({ plano, fichas, insumos, onClose }: { plano: FtPlanoProducao; fichas: FtFicha[]; insumos: FtInsumo[]; onClose: () => void }) {
  const [p, setP] = useState<FtPlanoProducao>(plano);
  const [salvando, setSalvando] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; doc: JsPDFType } | null>(null);
  const [gerando, setGerando] = useState(false);
  const itensFicha = useMemo(() => p.itens.map(it => ({ it, ficha: fichas.find(f => f.id === it.fichaId && f.ativo !== false) })).filter(x => x.ficha) as { it: FtPlanoProducao["itens"][number]; ficha: FtFicha }[], [p.itens, fichas]);
  const explosao = useMemo(() => explodirLote(itensFicha.map(x => ({ ficha: x.ficha, qtd: x.it.qtd })), fichas, insumos), [itensFicha, fichas, insumos]);
  function patchItem(id: string, patch: Partial<FtPlanoProducao["itens"][number]>) { setP(prev => ({ ...prev, itens: prev.itens.map(i => i.id === id ? { ...i, ...patch } : i) })); }
  function removeItem(id: string) { setP(prev => ({ ...prev, itens: prev.itens.filter(i => i.id !== id) })); }
  function addFicha(f: FtFicha) { setP(prev => ({ ...prev, itens: [...prev.itens, { id: uid("pi"), fichaId: f.id, qtd: f.ehSubficha ? (f.rendimento.qtd || 1) : (f.producaoPadrao || 1) }] })); }
  async function salvar() {
    setSalvando(true);
    try { await setDoc(doc(db, "ftPlanosProducao", p.id), sanitizeForFirestore({ ...p, nome: p.nome.trim() || `Plano ${fmtBR(p.data)}` })); onClose(); }
    catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }
  async function excluir() { if (confirm("Excluir este plano?")) { await updateDoc(doc(db, "ftPlanosProducao", p.id), { ativo: false }); onClose(); } }
  async function preview() {
    setGerando(true);
    try {
      const { gerarPlanoProducaoPDF } = await import("./gerarPlanoProducaoPDF");
      const doc = await gerarPlanoProducaoPDF(p, itensFicha, explosao);
      setPdf({ url: doc.output("bloburl") as unknown as string, doc });
    } catch (e) { alert("Erro no PDF: " + (e instanceof Error ? e.message : String(e))); }
    finally { setGerando(false); }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Voltar</button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void preview()} disabled={gerando || itensFicha.length === 0}>{gerando ? "Gerando…" : "🖨️ Exportar PDF"}</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>

      {/* Cabeçalho do plano */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <Input label="Nome do plano" value={p.nome} onChange={e => setP({ ...p, nome: e.target.value })} placeholder="ex: Produção terça" />
        <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Dia de produção</span>
          <input type="date" value={p.data} onChange={e => setP({ ...p, data: e.target.value })} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" /></div>
        <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Status</span>
          <select value={p.status} onChange={e => setP({ ...p, status: e.target.value as FtPlanoProducao["status"] })} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100">
            <option value="rascunho">rascunho</option><option value="planejado">planejado</option><option value="concluido">concluído</option>
          </select></div>
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
            <input value={it.responsavel || ""} onChange={e => patchItem(it.id, { responsavel: e.target.value })} placeholder="responsável" className="h-8 w-32 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            <button type="button" onClick={() => removeItem(it.id)} className="text-gray-400 hover:text-red-600 text-base px-1 shrink-0">✕</button>
          </div>
        ))}
        <FichaPicker fichas={fichas} jaTem={new Set(p.itens.map(i => i.fichaId))} onAdd={addFicha} />
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
    </div>
  );
}

function FichaPicker({ fichas, jaTem, onAdd }: { fichas: FtFicha[]; jaTem: Set<string>; onAdd: (f: FtFicha) => void }) {
  const [busca, setBusca] = useState("");
  const bn = normalizarNome(busca);
  const sug = useMemo(() => !bn ? [] : fichas.filter(f => f.ativo !== false && (f.ingredientes || []).length > 0 && !jaTem.has(f.id) && normalizarNome(f.nome).includes(bn)).sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 8), [fichas, bn, jaTem]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900">
        <span className="text-gray-400 text-sm">🔎</span>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="+ adicionar ficha ou base ao plano" className="w-full py-2 bg-transparent text-sm outline-none dark:text-gray-100" />
      </div>
      {sug.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {sug.map(f => (
            <button key={f.id} type="button" onClick={() => { onAdd(f); setBusca(""); }} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{f.ehSubficha ? "base" : "prato"}</span>
              <span className="text-sm flex-1 truncate dark:text-gray-100">{UP(f.nome)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
