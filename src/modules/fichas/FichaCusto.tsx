// Visualização de CUSTO & CMV (financeiro). Lista os pratos finais com custo,
// preço de venda (vinculado ao cardápio ao vivo, ou manual), CMV% e margem.
// Preço nunca é copiado: vem do cardápio por vínculo e atualiza sozinho.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { CardapioEstruturado, FtCategoria, FtFicha, FtInsumo } from "../../core/types";
import { calcularCusto, cmvPct, custoPorIngrediente, insumosComMedia, markup } from "./custo";
import { normalizarNome } from "./dedup";
import { labelUnidade } from "./unidades";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtMoeda = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const fmtDataCurta = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR"); };

export type CardItem = { id: string; titulo: string; preco: string; secao: string };

// Achata o doc do cardápio em itens (estruturados + os extraídos por IA do PDF).
export function flatCardapio(d: CardapioEstruturado | null): CardItem[] {
  if (!d) return [];
  const out: CardItem[] = [];
  for (const menu of d.cardapios || []) for (const sec of menu.secoes || []) for (const p of sec.pratos || []) {
    if (p.tipo === "imagem" || !p.titulo?.trim()) continue;
    out.push({ id: p.id, titulo: p.titulo, preco: p.preco || "", secao: sec.nome });
  }
  for (const it of d.cardapioPdfItens || []) if (it.titulo?.trim()) out.push({ id: it.id, titulo: it.titulo, preco: it.preco || "", secao: it.secao?.trim() || "PDF" });
  return out;
}

// Parse do preço (texto livre no cardápio): "R$ 45,00" / "45" / "1.234,50".
export function parsePreco(s?: string): number | null {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/\d[\d.]*,?\d*/);
  if (!m) return null;
  let n = m[0];
  if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
  else if ((n.match(/\./g) || []).length > 1) n = n.replace(/\./g, ""); // 1.234 milhar
  const v = Number(n);
  return isNaN(v) || v <= 0 ? null : v;
}

type FontePreco = "cardapio" | "manual" | "quebrado" | "nenhum";
function precoDe(f: FtFicha, itens: Map<string, CardItem>): { preco: number | null; fonte: FontePreco; item?: CardItem } {
  if (f.cardapioItemId) {
    const it = itens.get(f.cardapioItemId);
    if (it) return { preco: parsePreco(it.preco), fonte: "cardapio", item: it };
    return { preco: null, fonte: "quebrado" };
  }
  if (f.precoVendaManual != null) return { preco: f.precoVendaManual, fonte: "manual" };
  return { preco: null, fonte: "nenhum" };
}

export function CustoCmvView({ fichas, insumos, categorias, cardapio, cardapioPdfEm }: { fichas: FtFicha[]; insumos: FtInsumo[]; categorias: FtCategoria[]; cardapio: CardItem[]; cardapioPdfEm?: string }) {
  const [busca, setBusca] = useState("");
  const [abrir, setAbrir] = useState<FtFicha | null>(null);
  const [lote, setLote] = useState(false);
  const [precoModo, setPrecoModo] = useState<"ultimo" | "media">("ultimo");
  const hoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const insumosCalc = useMemo(() => precoModo === "media" ? insumosComMedia(insumos, hoje) : insumos, [precoModo, insumos, hoje]);
  const itensMap = useMemo(() => new Map(cardapio.map(i => [i.id, i])), [cardapio]);
  const cardOrdenado = useMemo(() => [...cardapio].sort((a, b) => a.titulo.localeCompare(b.titulo)), [cardapio]);
  const catsFicha = categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === "ficha").sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome));
  const bn = normalizarNome(busca);
  const finais = fichas.filter(f => f.ativo !== false && !f.ehSubficha).filter(f => !bn || normalizarNome(f.nome).includes(bn));

  // Auto-vínculo: quando o nome do prato bate EXATAMENTE (normalizado) com um item
  // do cardápio, vincula sozinho. Só match forte — nomes parecidos ficam de sugestão
  // no seletor pra você confirmar. Idempotente (não re-processa o mesmo id).
  const autoFeitos = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (cardapio.length === 0) return;
    const porNome = new Map<string, CardItem>();
    for (const i of cardapio) { const n = normalizarNome(i.titulo); if (n && !porNome.has(n)) porNome.set(n, i); }
    const paraLigar: { f: FtFicha; it: CardItem; chave: string }[] = [];
    for (const f of fichas) {
      if (f.ativo === false || f.ehSubficha) continue;
      const vinculoVivo = !!f.cardapioItemId && itensMap.has(f.cardapioItemId);
      const manual = f.precoVendaManual != null && !f.cardapioItemId;
      if (vinculoVivo || manual) continue; // já resolvido; quebrado (id morto) segue elegível → cura
      const it = porNome.get(normalizarNome(f.nome));
      if (!it || it.id === f.cardapioItemId) continue;
      const chave = `${f.id}:${it.id}`;              // permite re-vincular a um id novo (após reler PDF)
      if (autoFeitos.current.has(chave)) continue;
      paraLigar.push({ f, it, chave });
    }
    if (paraLigar.length === 0) return;
    for (const { chave } of paraLigar) autoFeitos.current.add(chave);
    const batch = writeBatch(db);
    for (const { f, it } of paraLigar) batch.update(doc(db, "ftFichas", f.id), sanitizeForFirestore({ cardapioItemId: it.id, precoVendaManual: null }));
    batch.commit().catch(() => {});
  }, [cardapio, fichas, itensMap]);

  const nVinculados = useMemo(() => fichas.filter(f => f.ativo !== false && !f.ehSubficha && f.cardapioItemId && itensMap.has(f.cardapioItemId)).length, [fichas, itensMap]);
  const grupos = useMemo(() => {
    const ids = new Set(catsFicha.map(c => c.id));
    return [
      ...catsFicha.map(c => ({ cat: c, itens: finais.filter(f => f.categoriaId === c.id) })),
      { cat: null as FtCategoria | null, itens: finais.filter(f => !f.categoriaId || !ids.has(f.categoriaId)) },
    ].filter(g => g.itens.length > 0);
  }, [finais, catsFicha]);

  async function vincular(f: FtFicha, itemId: string) { await updateDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore({ cardapioItemId: itemId, precoVendaManual: null })); }
  async function desvincular(f: FtFicha) { await updateDoc(doc(db, "ftFichas", f.id), { cardapioItemId: null }); }
  async function setManual(f: FtFicha, v: number | null) { await updateDoc(doc(db, "ftFichas", f.id), { cardapioItemId: null, precoVendaManual: v }); }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔎</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar prato…" className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
          {busca && <button type="button" onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm">✕</button>}
        </div>
        <span className="text-[11px] text-gray-400 hidden sm:inline">Custo por:</span>
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {([["ultimo", "Último preço"], ["media", "Média 3 meses"]] as const).map(([m, l]) => (
            <button key={m} type="button" onClick={() => setPrecoModo(m)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${precoModo === m ? "bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>
        {cardapio.length > 0 && <Button variant="secondary" size="sm" onClick={() => setLote(true)}>🔗 Vincular preços do cardápio</Button>}
      </div>
      {cardapio.length === 0 && <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">Nenhum item de cardápio encontrado — os preços de venda só poderão ser manuais até o cardápio ser montado no módulo de Cardápio.</div>}
      {nVinculados > 0 && (
        <div className="text-[12px] text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2 flex items-start gap-2">
          <span className="text-base leading-none">🔗</span>
          <span><b>{nVinculados} {nVinculados === 1 ? "preço vinculado" : "preços vinculados"}</b> a partir da leitura do cardápio{cardapioPdfEm ? <> (PDF lido em <b>{fmtDataCurta(cardapioPdfEm)}</b>)</> : ""}. Cada preço mostra o item de cardápio que foi identificado — confira e, se algum estiver errado, clique em <b>trocar</b>.</span>
        </div>
      )}
      {grupos.map(g => (
        <div key={g.cat?.id || "sem"}>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{g.cat ? UP(g.cat.nome) : "SEM CATEGORIA"} <span className="text-gray-400 font-normal normal-case">· {g.itens.length}{g.cat?.cmvAlvo != null ? ` · CMV alvo ${g.cat.cmvAlvo}%` : ""}</span></div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/40 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Prato</th>
                  <th className="text-right font-semibold px-3 py-2 w-24">Custo</th>
                  <th className="text-left font-semibold px-3 py-2 w-56">Preço de venda</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">CMV</th>
                  <th className="text-right font-semibold px-3 py-2 w-20">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {g.itens.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map(f => {
                  const c = calcularCusto(f, insumosCalc, fichas);
                  const custo = c.porRendimento;
                  const { preco, fonte, item } = precoDe(f, itensMap);
                  const cmv = preco ? cmvPct(custo, preco) : null;
                  const mk = preco ? markup(custo, preco) : null;
                  const alvo = g.cat?.cmvAlvo ?? null;
                  const cmvCor = cmv == null ? "text-gray-400" : (alvo != null && cmv > alvo) ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-emerald-600 dark:text-emerald-400";
                  return (
                    <tr key={f.id} className="align-middle">
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100 font-medium"><button type="button" onClick={() => setAbrir(f)} className="text-left hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">{UP(f.nome)}</button>{c.insumosSemCusto.length > 0 && <span className="ml-1.5 text-[10px] text-amber-600" title={`Faltam preços: ${c.insumosSemCusto.slice(0, 5).join(", ")}`}>⚠</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{custo > 0 ? fmtMoeda(custo) : "—"}</td>
                      <td className="px-3 py-2">
                        <PrecoCell f={f} fonte={fonte} preco={preco} item={item} cardapio={cardOrdenado}
                          onVincular={id => void vincular(f, id)} onDesvincular={() => void desvincular(f)} onManual={v => void setManual(f, v)} />
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${cmvCor}`}>{cmv != null ? `${cmv}%` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{mk != null ? `${mk}×` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {grupos.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhum prato final.</div>}
      {abrir && <FichaCustoModal ficha={abrir} insumos={insumosCalc} fichas={fichas} preco={precoDe(abrir, itensMap).preco} cmvAlvo={catsFicha.find(c => c.id === abrir.categoriaId)?.cmvAlvo ?? null} onClose={() => setAbrir(null)} />}
      {lote && <VincularLoteModal fichas={finais} cardapio={cardOrdenado} itensMap={itensMap} onClose={() => setLote(false)} />}
    </div>
  );
}

// Vincular preços do cardápio em lote: sugere o item por nome e você confirma.
function VincularLoteModal({ fichas, cardapio, itensMap, onClose }: { fichas: FtFicha[]; cardapio: CardItem[]; itensMap: Map<string, CardItem>; onClose: () => void }) {
  const pendentes = useMemo(() => fichas.filter(f => !f.cardapioItemId || !itensMap.has(f.cardapioItemId)).sort((a, b) => a.nome.localeCompare(b.nome)), [fichas, itensMap]);
  const sugestao = (f: FtFicha) => { const n = normalizarNome(f.nome); return cardapio.find(i => { const t = normalizarNome(i.titulo); return t === n || (t.length >= 4 && n.length >= 4 && (t.includes(n) || n.includes(t))); }); };
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries(pendentes.map(f => [f.id, sugestao(f)?.id || ""])));
  const [salvando, setSalvando] = useState(false);
  const nSel = Object.values(sel).filter(Boolean).length;
  async function vincular() {
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      for (const f of pendentes) { const id = sel[f.id]; if (id) batch.update(doc(db, "ftFichas", f.id), sanitizeForFirestore({ cardapioItemId: id, precoVendaManual: null })); }
      await batch.commit(); onClose();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }
  return (
    <Modal title="🔗 Vincular preços do cardápio" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Sugerimos o item do cardápio por nome. Confira, ajuste os que precisam, e vincule. O preço passa a vir do cardápio (ao vivo).</p>
        {pendentes.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">Todos os pratos já têm preço vinculado. 🎉</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {pendentes.map(f => (
              <div key={f.id} className="flex items-center gap-2 px-3 py-2 flex-wrap">
                <span className="flex-1 min-w-[140px] text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{UP(f.nome)}</span>
                <span className="text-gray-300">→</span>
                <select value={sel[f.id] || ""} onChange={e => setSel(s => ({ ...s, [f.id]: e.target.value }))} className={`h-8 text-xs px-2 rounded-lg border bg-white dark:bg-gray-900 max-w-[260px] ${sel[f.id] ? "border-emerald-300 dark:border-emerald-700 text-gray-700 dark:text-gray-200" : "border-dashed border-gray-300 dark:border-gray-600 text-gray-400"}`}>
                  <option value="">— pular —</option>
                  {cardapio.map(i => <option key={i.id} value={i.id}>{i.titulo}{i.preco ? ` · ${i.preco}` : ""}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-gray-400">{nSel} de {pendentes.length} selecionados</span>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={vincular} disabled={salvando || nSel === 0}>{salvando ? "Vinculando…" : `Vincular ${nSel}`}</Button></div>
        </div>
      </div>
    </Modal>
  );
}

// Ficha de custo (read-only): breakdown por ingrediente + CMV/margem.
function FichaCustoModal({ ficha, insumos, fichas, preco, cmvAlvo, onClose }: { ficha: FtFicha; insumos: FtInsumo[]; fichas: FtFicha[]; preco: number | null; cmvAlvo: number | null; onClose: () => void }) {
  const c = calcularCusto(ficha, insumos, fichas);
  const linhas = custoPorIngrediente(ficha, insumos, fichas);
  const custoPorc = c.porRendimento || c.total;
  const cmv = preco ? cmvPct(custoPorc, preco) : null;
  const mk = preco ? markup(custoPorc, preco) : null;
  const cmvCor = cmv == null ? "text-gray-400" : (cmvAlvo != null && cmv > cmvAlvo) ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <Modal title={`💰 Custo — ${UP(ficha.nome)}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[["Custo do preparo", fmtMoeda(c.total), "text-gray-900 dark:text-gray-100"],
            ["Custo por porção", custoPorc > 0 ? fmtMoeda(custoPorc) : "—", "text-gray-900 dark:text-gray-100"],
            ["Preço de venda", preco != null ? fmtMoeda(preco) : "—", "text-gray-900 dark:text-gray-100"],
            ["CMV", cmv != null ? `${cmv}%` : "—", cmvCor]].map(([lbl, val, cor], k) => (
            <div key={k} className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{lbl}</div>
              <div className={`text-lg font-bold tabular-nums ${cor}`}>{val}</div>
            </div>
          ))}
        </div>
        {mk != null && <div className="text-[11px] text-gray-500">Markup {mk}× · {cmvAlvo != null ? `CMV alvo da categoria ${cmvAlvo}%` : "sem CMV alvo na categoria"}</div>}
        <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="text-left font-semibold px-3 py-1.5">Ingrediente</th>
              <th className="text-right font-semibold px-3 py-1.5 w-28">Quantidade</th>
              <th className="text-right font-semibold px-3 py-1.5 w-24">Custo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {linhas.map((l, k) => (
              <tr key={k}>
                <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">{l.tipo === "ficha" ? "🧩 " : l.tipo === "subproduto" ? "🔄 " : ""}{UP(l.nome)}{l.semCusto && <span className="ml-1.5 text-[10px] text-amber-600">⚠ sem custo</span>}</td>
                <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{l.qb ? "q.b." : `${fmtQtd(l.qtd)} ${labelUnidade(l.unidade)}`}</td>
                <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 tabular-nums">{l.custo > 0 ? fmtMoeda(l.custo) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.subprodutos.length > 0 && (
          <div className="text-[11px] text-gray-500 space-y-0.5">
            <div className="font-semibold">Rateio dos subprodutos (saem deste custo):</div>
            {c.subprodutos.map(sp => <div key={sp.id} className="flex justify-between"><span>↳ {UP(sp.nome)} ({sp.percentual}%)</span><span className="tabular-nums">{fmtMoeda(sp.custo)}</span></div>)}
          </div>
        )}
        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
      </div>
    </Modal>
  );
}

// Célula de preço: vinculado (ao vivo), manual, quebrado ou vazio.
function PrecoCell({ f, fonte, preco, item, cardapio, onVincular, onDesvincular, onManual }: {
  f: FtFicha; fonte: FontePreco; preco: number | null; item?: CardItem; cardapio: CardItem[];
  onVincular: (id: string) => void; onDesvincular: () => void; onManual: (v: number | null) => void;
}) {
  const [editandoManual, setEditandoManual] = useState(false);
  const [txt, setTxt] = useState(preco != null ? String(preco).replace(".", ",") : "");
  const sug = useMemo(() => { const n = normalizarNome(f.nome); return cardapio.find(i => { const t = normalizarNome(i.titulo); return t === n || (t.length >= 4 && n.length >= 4 && (t.includes(n) || n.includes(t))); }); }, [f.nome, cardapio]);

  if (editandoManual) {
    return (
      <div className="flex items-center gap-1">
        <div className="inline-flex items-center h-8 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 gap-1"><span className="text-[10px] text-gray-400">R$</span>
          <input autoFocus value={txt} onChange={e => setTxt(e.target.value.replace(/[^0-9.,]/g, ""))} onKeyDown={e => { if (e.key === "Enter") { onManual(Number(txt.replace(",", ".")) || null); setEditandoManual(false); } }} className="w-16 text-right bg-transparent text-sm outline-none dark:text-gray-100" /></div>
        <button type="button" onClick={() => { onManual(Number(txt.replace(",", ".")) || null); setEditandoManual(false); }} className="text-xs text-indigo-600">ok</button>
        <button type="button" onClick={() => setEditandoManual(false)} className="text-xs text-gray-400">✕</button>
      </div>
    );
  }
  if (fonte === "cardapio") {
    return <div className="flex items-center gap-1.5 flex-wrap"><span className="text-gray-800 dark:text-gray-100 font-medium tabular-nums">{preco != null ? fmtMoeda(preco) : "—"}</span><span className="text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 max-w-[170px] truncate" title={`Identificado no cardápio como: ${item?.titulo || "—"}`}>🔗 {item?.titulo ? UP(item.titulo) : "cardápio"}</span><button type="button" onClick={onDesvincular} className="text-[10px] text-gray-400 hover:text-red-600 underline shrink-0">trocar</button></div>;
  }
  if (fonte === "manual") {
    return <div className="flex items-center gap-1.5"><span className="text-gray-800 dark:text-gray-100 font-medium tabular-nums">{preco != null ? fmtMoeda(preco) : "—"}</span><span className="text-[10px] text-gray-400">manual</span><button type="button" onClick={() => { setTxt(preco != null ? String(preco).replace(".", ",") : ""); setEditandoManual(true); }} className="text-[10px] text-gray-400 hover:text-indigo-600 underline">editar</button></div>;
  }
  // nenhum ou quebrado
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {fonte === "quebrado" && <span className="text-[10px] text-rose-600 dark:text-rose-400">⚠ vínculo quebrado</span>}
      <select value="" onChange={e => { const v = e.target.value; if (v === "__manual__") setEditandoManual(true); else if (v) onVincular(v); }} className="h-8 text-xs px-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-500 max-w-[190px]">
        <option value="">definir preço…</option>
        {sug && <optgroup label="sugerido do cardápio"><option value={sug.id}>✨ {sug.titulo}{sug.preco ? ` · ${sug.preco}` : ""}</option></optgroup>}
        <option value="__manual__">✏️ preço manual…</option>
        {cardapio.length > 0 && <optgroup label="vincular ao cardápio">{cardapio.map(i => <option key={i.id} value={i.id}>{i.titulo}{i.preco ? ` · ${i.preco}` : ""}</option>)}</optgroup>}
      </select>
    </div>
  );
}
