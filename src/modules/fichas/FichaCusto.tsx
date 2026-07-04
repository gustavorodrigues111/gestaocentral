// Visualização de CUSTO & CMV (financeiro). Lista os pratos finais com custo,
// preço de venda (vinculado ao cardápio ao vivo, ou manual), CMV% e margem.
// Preço nunca é copiado: vem do cardápio por vínculo e atualiza sozinho.
import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { CardapioEstruturado, FtCategoria, FtFicha, FtInsumo } from "../../core/types";
import { calcularCusto, cmvPct, insumosComMedia, markup } from "./custo";
import { normalizarNome } from "./dedup";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtMoeda = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type CardItem = { id: string; titulo: string; preco: string; secao: string };

// Achata o doc do cardápio em itens (só os "item" com título).
export function flatCardapio(d: CardapioEstruturado | null): CardItem[] {
  if (!d) return [];
  const out: CardItem[] = [];
  for (const menu of d.cardapios || []) for (const sec of menu.secoes || []) for (const p of sec.pratos || []) {
    if (p.tipo === "imagem" || !p.titulo?.trim()) continue;
    out.push({ id: p.id, titulo: p.titulo, preco: p.preco || "", secao: sec.nome });
  }
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

export function CustoCmvView({ fichas, insumos, categorias, cardapio }: { fichas: FtFicha[]; insumos: FtInsumo[]; categorias: FtCategoria[]; cardapio: CardItem[] }) {
  const [busca, setBusca] = useState("");
  const [precoModo, setPrecoModo] = useState<"ultimo" | "media">("ultimo");
  const hoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const insumosCalc = useMemo(() => precoModo === "media" ? insumosComMedia(insumos, hoje) : insumos, [precoModo, insumos, hoje]);
  const itensMap = useMemo(() => new Map(cardapio.map(i => [i.id, i])), [cardapio]);
  const cardOrdenado = useMemo(() => [...cardapio].sort((a, b) => a.titulo.localeCompare(b.titulo)), [cardapio]);
  const catsFicha = categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === "ficha").sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome));
  const bn = normalizarNome(busca);
  const finais = fichas.filter(f => f.ativo !== false && !f.ehSubficha).filter(f => !bn || normalizarNome(f.nome).includes(bn));
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
      </div>
      {cardapio.length === 0 && <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">Nenhum item de cardápio encontrado — os preços de venda só poderão ser manuais até o cardápio ser montado no módulo de Sites/Cardápio.</div>}
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
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100 font-medium">{UP(f.nome)}{c.insumosSemCusto.length > 0 && <span className="ml-1.5 text-[10px] text-amber-600" title={`Faltam preços: ${c.insumosSemCusto.slice(0, 5).join(", ")}`}>⚠</span>}</td>
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
    </div>
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
    return <div className="flex items-center gap-1.5"><span className="text-gray-800 dark:text-gray-100 font-medium tabular-nums">{preco != null ? fmtMoeda(preco) : "—"}</span><span className="text-[10px] text-emerald-600 dark:text-emerald-400" title={`Do cardápio: ${item?.titulo}`}>🔗 cardápio</span><button type="button" onClick={onDesvincular} className="text-[10px] text-gray-400 hover:text-red-600 underline">trocar</button></div>;
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
