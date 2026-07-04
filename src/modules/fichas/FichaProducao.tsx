// Visualização de PRODUÇÃO (modo trabalho): lista agrupada por categoria (sem
// custo) e um modal só-leitura em TABELA que escala a receita, expandindo as
// bases, com pré-visualização e exportação de PDF. Zero custo/preço.
import { useMemo, useState } from "react";
import type { FtCategoria, FtFicha, FtInsumo } from "../../core/types";
import type { jsPDF as JsPDFType } from "jspdf";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { labelUnidade } from "./unidades";
import { montarProducao, type ProdNode } from "./producao";
import { normalizarNome } from "./dedup";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const round3 = (n: number) => Math.round((n || 0) * 1000) / 1000;

function catsDoGrupo(categorias: FtCategoria[], grupo: "finais" | "bases"): FtCategoria[] {
  const tipo = grupo === "bases" ? "subficha" : "ficha";
  const alfabetico = tipo !== "ficha";
  return categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === tipo)
    .sort((a, b) => alfabetico ? a.nome.localeCompare(b.nome) : ((a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome)));
}

// ─── Lista de produção (tabela agrupada por categoria, sem custo) ──────────
export function ProducaoView({ fichas, insumos, categorias }: { fichas: FtFicha[]; insumos: FtInsumo[]; categorias: FtCategoria[] }) {
  const [grupo, setGrupo] = useState<"finais" | "bases">("finais");
  const [busca, setBusca] = useState("");
  const [abrir, setAbrir] = useState<FtFicha | null>(null);
  const bn = normalizarNome(busca);
  const lista = useMemo(() => fichas
    .filter(f => f.ativo !== false && (grupo === "bases" ? f.ehSubficha : !f.ehSubficha))
    .filter(f => (f.ingredientes || []).length > 0)
    .filter(f => !bn || normalizarNome(f.nome).includes(bn))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [fichas, grupo, bn]);
  const grupos = useMemo(() => {
    const cats = catsDoGrupo(categorias, grupo);
    const ids = new Set(cats.map(c => c.id));
    return [
      ...cats.map(c => ({ nome: UP(c.nome), itens: lista.filter(f => f.categoriaId === c.id) })),
      { nome: "SEM CATEGORIA", itens: lista.filter(f => !f.categoriaId || !ids.has(f.categoriaId)) },
    ].filter(g => g.itens.length > 0);
  }, [lista, categorias, grupo]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {([["finais", "🍽️ Pratos finais"], ["bases", "🧩 Bases"]] as const).map(([g, l]) => (
            <button key={g} type="button" onClick={() => setGrupo(g)} className={`px-4 py-1.5 text-xs font-medium rounded-md ${grupo === g ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔎</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…" className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
          {busca && <button type="button" onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm">✕</button>}
        </div>
      </div>
      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma ficha montada nesse grupo.</div>
      ) : (
        <div className="space-y-5">
          {grupos.map(g => (
            <div key={g.nome}>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{g.nome} <span className="text-gray-400 font-normal normal-case">· {g.itens.length}</span></div>
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                {g.itens.map(f => (
                  <button key={f.id} type="button" onClick={() => setAbrir(f)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                    <span className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-sm shrink-0">{f.ehSubficha ? "🧩" : "🍽️"}</span>
                    <span className="flex-1 min-w-0 font-medium text-gray-900 dark:text-gray-100 truncate">{UP(f.nome)}</span>
                    <span className="text-xs text-gray-500 shrink-0 tabular-nums">{f.ehSubficha ? `${fmtQtd(f.rendimento.qtd)} ${labelUnidade(f.rendimento.unidade)}` : `${fmtQtd(f.producaoPadrao || f.rendimento.qtd)} porções`}</span>
                    <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Abrir →</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {abrir && <FichaProducaoModal ficha={abrir} fichas={fichas} insumos={insumos} onClose={() => setAbrir(null)} />}
    </div>
  );
}

// ─── Modal de produção (tabela, escala + expande bases, sem custo) ─────────
function FichaProducaoModal({ ficha, fichas, insumos, onClose }: { ficha: FtFicha; fichas: FtFicha[]; insumos: FtInsumo[]; onClose: () => void }) {
  const padrao = ficha.ehSubficha ? ficha.rendimento.qtd : (ficha.producaoPadrao || ficha.rendimento.qtd || 1);
  const [alvo, setAlvo] = useState<number>(padrao);
  const [txt, setTxt] = useState(fmtQtd(padrao));
  const [pdf, setPdf] = useState<{ url: string; doc: JsPDFType } | null>(null);
  const [gerando, setGerando] = useState(false);
  const node = useMemo(() => montarProducao(ficha, alvo, ficha.rendimento.unidade, fichas, insumos), [ficha, alvo, fichas, insumos]);
  function commitTxt(v: string) { const raw = v.replace(/[^0-9.,]/g, ""); setTxt(raw); const n = Number(raw.replace(",", ".")); if (n > 0) setAlvo(round3(n)); }
  function passo(d: number) { const n = Math.max(round3(alvo + d), 0.001); setAlvo(n); setTxt(fmtQtd(n)); }
  async function preview() {
    setGerando(true);
    try {
      const { gerarFichaProducaoPDF } = await import("./gerarFichaProducaoPDF");
      const doc = await gerarFichaProducaoPDF(node);
      setPdf({ url: doc.output("bloburl") as unknown as string, doc });
    } catch (e) { alert("Erro ao gerar PDF: " + (e instanceof Error ? e.message : String(e))); }
    finally { setGerando(false); }
  }
  return (
    <Modal title={`👩‍🍳 Produção — ${UP(ficha.nome)}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-3">
          <span className="text-sm text-indigo-800 dark:text-indigo-200 font-medium">Produzir</span>
          <div className="inline-flex items-center h-9 rounded-full border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-900 px-1 shadow-sm">
            <button type="button" onClick={() => passo(alvo >= 10 ? -5 : -1)} className="w-7 h-7 rounded-full text-gray-500 hover:text-indigo-600 text-lg leading-none">−</button>
            <input value={txt} onChange={e => commitTxt(e.target.value)} onBlur={() => setTxt(fmtQtd(alvo))} inputMode="decimal" className="w-16 text-center bg-transparent text-sm outline-none dark:text-gray-100" />
            <button type="button" onClick={() => passo(alvo >= 10 ? 5 : 1)} className="w-7 h-7 rounded-full text-gray-500 hover:text-indigo-600 text-lg leading-none">+</button>
          </div>
          <span className="text-sm text-indigo-800 dark:text-indigo-200">{ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções"}</span>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={() => void preview()} disabled={gerando}>{gerando ? "Gerando…" : "🖨️ Exportar PDF"}</Button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto pr-1 space-y-3">
          <TabelaNode node={node} raiz />
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
      </div>
      {pdf && (
        <Modal title="Pré-visualização do PDF" onClose={() => setPdf(null)} maxWidth="max-w-4xl">
          <div className="space-y-3">
            <iframe title="pdf" src={pdf.url} className="w-full h-[68vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPdf(null)}>Fechar</Button>
              <Button onClick={() => pdf.doc.save(`producao-${normalizarNome(ficha.nome).replace(/\s+/g, "-")}.pdf`)}>⬇️ Baixar PDF</Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// Um nível da produção, em tabela.
function TabelaNode({ node, raiz }: { node: ProdNode; raiz?: boolean }) {
  return (
    <div className={raiz ? "" : "border-l-2 border-purple-200 dark:border-purple-800 pl-3"}>
      <div className="flex items-baseline gap-2 mb-1">
        {raiz
          ? <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">ficha</span>
          : <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 shrink-0">base</span>}
        <span className={`font-bold text-gray-900 dark:text-gray-100 ${raiz ? "text-base" : "text-sm"}`}>{UP(node.nome)}</span>
        <span className="text-xs text-gray-500">— produzir <strong className="text-gray-700 dark:text-gray-200">{fmtQtd(node.alvoQtd)} {labelUnidade(node.alvoUnidade)}</strong></span>
      </div>
      {(node.ingredientes.length > 0 || node.subprodutos.length > 0) && (
        <table className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="text-left font-semibold px-3 py-1.5">Ingrediente</th>
              <th className="text-right font-semibold px-3 py-1.5 w-32">Quantidade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {node.ingredientes.map((i, k) => (
              <tr key={"i" + k}>
                <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">{UP(i.nome)}</td>
                <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`}</td>
              </tr>
            ))}
            {node.subprodutos.map((i, k) => (
              <tr key={"s" + k} className="bg-orange-50/40 dark:bg-orange-900/10">
                <td className="px-3 py-1.5 text-orange-700 dark:text-orange-300">↳ {UP(i.nome)}</td>
                <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-300 tabular-nums">{i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {node.modoPreparo && node.modoPreparo.trim() && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap"><span className="font-semibold">Preparo:</span> {node.modoPreparo}</div>
      )}
      {node.bases.length > 0 && <div className="mt-3 space-y-3">{node.bases.map(b => <TabelaNode key={b.id} node={b} />)}</div>}
    </div>
  );
}
