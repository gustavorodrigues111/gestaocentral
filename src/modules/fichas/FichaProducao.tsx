// Visualização de PRODUÇÃO (modo trabalho): lista de fichas sem custo e um modal
// só-leitura que escala a receita pro alvo desejado, expandindo as bases, com
// Exportar PDF. Zero custo/preço — pensado pra cozinha.
import { useMemo, useState } from "react";
import type { FtFicha, FtInsumo } from "../../core/types";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { labelUnidade } from "./unidades";
import { montarProducao, type ProdNode } from "./producao";
import { normalizarNome } from "./dedup";

const UP = (s: string) => (s || "").trim().toUpperCase();
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
const round3 = (n: number) => Math.round((n || 0) * 1000) / 1000;

// ─── Lista de produção (cards sem custo) ───────────────────────────────────
export function ProducaoView({ fichas, insumos }: { fichas: FtFicha[]; insumos: FtInsumo[] }) {
  const [grupo, setGrupo] = useState<"finais" | "bases">("finais");
  const [busca, setBusca] = useState("");
  const [abrir, setAbrir] = useState<FtFicha | null>(null);
  const bn = normalizarNome(busca);
  const lista = useMemo(() => fichas
    .filter(f => f.ativo !== false && (grupo === "bases" ? f.ehSubficha : !f.ehSubficha))
    .filter(f => (f.ingredientes || []).length > 0)
    .filter(f => !bn || normalizarNome(f.nome).includes(bn))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [fichas, grupo, bn]);
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
      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">Nenhuma ficha montada nesse grupo.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map(f => (
            <button key={f.id} type="button" onClick={() => setAbrir(f)} className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 hover:border-indigo-400 transition-colors">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{UP(f.nome)}</div>
              <div className="text-xs text-gray-500 mt-1">{f.ehSubficha ? `produz ${fmtQtd(f.rendimento.qtd)} ${labelUnidade(f.rendimento.unidade)}` : `padrão: ${fmtQtd(f.producaoPadrao || f.rendimento.qtd)} porções`}</div>
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-2">Abrir ficha de produção →</div>
            </button>
          ))}
        </div>
      )}
      {abrir && <FichaProducaoModal ficha={abrir} fichas={fichas} insumos={insumos} onClose={() => setAbrir(null)} />}
    </div>
  );
}

// ─── Modal de produção (escala + expande bases, sem custo) ─────────────────
function FichaProducaoModal({ ficha, fichas, insumos, onClose }: { ficha: FtFicha; fichas: FtFicha[]; insumos: FtInsumo[]; onClose: () => void }) {
  const padrao = ficha.ehSubficha ? ficha.rendimento.qtd : (ficha.producaoPadrao || ficha.rendimento.qtd || 1);
  const [alvo, setAlvo] = useState<number>(padrao);
  const node = useMemo(() => montarProducao(ficha, alvo, ficha.rendimento.unidade, fichas, insumos), [ficha, alvo, fichas, insumos]);
  const [txt, setTxt] = useState(fmtQtd(padrao));
  function commitTxt(v: string) { const raw = v.replace(/[^0-9.,]/g, ""); setTxt(raw); const n = Number(raw.replace(",", ".")); if (n > 0) setAlvo(round3(n)); }
  async function exportarPDF() {
    const { gerarFichaProducaoPDF } = await import("./gerarFichaProducaoPDF");
    const doc = await gerarFichaProducaoPDF(node);
    doc.save(`producao-${normalizarNome(ficha.nome).replace(/\s+/g, "-")}.pdf`);
  }
  return (
    <Modal title={`👩‍🍳 Produção — ${UP(ficha.nome)}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-3">
          <span className="text-sm text-indigo-800 dark:text-indigo-200 font-medium">Produzir</span>
          <div className="inline-flex items-center h-9 rounded-full border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-900 px-1 shadow-sm">
            <button type="button" onClick={() => { const n = Math.max(round3(alvo - (alvo >= 10 ? 5 : 1)), 0.001); setAlvo(n); setTxt(fmtQtd(n)); }} className="w-7 h-7 rounded-full text-gray-500 hover:text-indigo-600 text-lg leading-none">−</button>
            <input value={txt} onChange={e => commitTxt(e.target.value)} onBlur={() => setTxt(fmtQtd(alvo))} inputMode="decimal" className="w-16 text-center bg-transparent text-sm outline-none dark:text-gray-100" />
            <button type="button" onClick={() => { const n = round3(alvo + (alvo >= 10 ? 5 : 1)); setAlvo(n); setTxt(fmtQtd(n)); }} className="w-7 h-7 rounded-full text-gray-500 hover:text-indigo-600 text-lg leading-none">+</button>
          </div>
          <span className="text-sm text-indigo-800 dark:text-indigo-200">{ficha.ehSubficha ? labelUnidade(ficha.rendimento.unidade) : "porções"}</span>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={() => void exportarPDF()}>🖨️ Exportar PDF</Button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto pr-1">
          <RenderNode node={node} nivel={0} raiz />
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
      </div>
    </Modal>
  );
}

function RenderNode({ node, nivel, raiz }: { node: ProdNode; nivel: number; raiz?: boolean }) {
  return (
    <div className={nivel > 0 ? "mt-2 border-l-2 border-purple-200 dark:border-purple-800 pl-3" : ""}>
      <div className="flex items-baseline gap-2">
        {!raiz && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 shrink-0">base</span>}
        <span className="font-semibold text-gray-900 dark:text-gray-100">{UP(node.nome)}</span>
        <span className="text-xs text-gray-500">— produzir {fmtQtd(node.alvoQtd)} {labelUnidade(node.alvoUnidade)}</span>
      </div>
      {node.ingredientes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {node.ingredientes.map((i, k) => (
            <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-700 dark:text-gray-200 truncate">{UP(i.nome)}</span>
              <span className="text-gray-500 tabular-nums shrink-0">{i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {node.subprodutos.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {node.subprodutos.map((i, k) => (
            <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-orange-700 dark:text-orange-300 truncate">↳ {UP(i.nome)}</span>
              <span className="text-gray-500 tabular-nums shrink-0">{i.qb ? "q.b." : `${fmtQtd(i.qtd)} ${labelUnidade(i.unidade)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {node.bases.map(b => <RenderNode key={b.id} node={b} nivel={nivel + 1} />)}
      {node.modoPreparo && node.modoPreparo.trim() && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap"><span className="font-semibold">Preparo:</span> {node.modoPreparo}</div>
      )}
    </div>
  );
}
