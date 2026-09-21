import { useMemo, useState } from "react";
import { Building2, Smartphone, ClipboardList, TriangleAlert, ChevronDown, ChevronRight } from "lucide-react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo, Pedido, PedidoItem } from "../../core/types";
import { montarSugestao, type LinhaSugestao, type GrupoFornecedor } from "./sugestao";

type Props = {
  ultimaContagem: Record<string, Contagem>;
  fornecedores: Fornecedor[];
  insumos: Insumo[];
  restaurantId: string;
  podeConfig: boolean;
  onPedidoCriado?: () => void;
};

const undLabel = (i: Insumo) => i.unidade === "outro" ? (i.unidadeOutroLabel || "?") : UNIDADES_LABEL[i.unidade].slice(0, 3);
const fmtR$ = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function SugestoesTab({ ultimaContagem, fornecedores, insumos, restaurantId, podeConfig, onPedidoCriado }: Props) {
  const { pessoa: me } = useAuth();
  const [savingFornId, setSavingFornId] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState<Record<string, string>>({});     // qtd editada por insumo
  const [incluir, setIncluir] = useState<Record<string, boolean>>({});     // override do "incluir no pedido"
  const [okAberto, setOkAberto] = useState<Record<string, boolean>>({});   // seção "itens OK" expandida por fornecedor

  const grupos = useMemo(() => montarSugestao(insumos, ultimaContagem, fornecedores), [insumos, ultimaContagem, fornecedores]);

  const qtd = (l: LinhaSugestao): number => {
    const v = ajustes[l.insumo.id];
    if (v == null || v === "") return l.qtdSugerida;
    const n = parseFloat(v.replace(",", "."));
    return isNaN(n) ? l.qtdSugerida : n;
  };
  // OK começa NÃO incluído (opaco); item que precisa começa incluído.
  const isIncluido = (l: LinhaSugestao): boolean => incluir[l.insumo.id] ?? l.precisaPedido;
  const totalLinha = (l: LinhaSugestao): number => (l.precoUnit || 0) * qtd(l);

  const totalGrupo = (g: GrupoFornecedor): number =>
    [...g.precisam, ...g.ok].filter(isIncluido).reduce((s, l) => s + totalLinha(l), 0);
  const itensIncluidos = (g: GrupoFornecedor): LinhaSugestao[] =>
    [...g.precisam, ...g.ok].filter(l => isIncluido(l) && qtd(l) > 0);

  async function gerarPedido(g: GrupoFornecedor) {
    if (!me || !g.fornecedor) return;
    const inclui = itensIncluidos(g);
    if (!inclui.length) { alert("Nenhum item selecionado pra esse fornecedor."); return; }
    setSavingFornId(g.fornecedorId!);
    try {
      const itens: PedidoItem[] = inclui.map(l => ({
        insumoId: l.insumo.id,
        insumoNomeSnapshot: l.insumo.nome,
        unidadeSnapshot: l.insumo.unidade,
        qtdPedida: qtd(l),
        qtdRecebida: null,
        precoUnit: l.precoUnit,
        qtdSugeridaIA: l.qtdSugerida,
        contagemSnapshot: l.temContagem ? l.contagem : null,
        minStockSnapshot: l.minStock || null,
        fatorCompraSnapshot: l.fator > 1 ? l.fator : null,
        precisaPedido: l.precisaPedido,
        incluido: true,
      }));
      const totalEstimado = itens.reduce((s, it) => s + ((it.precoUnit || 0) * it.qtdPedida), 0);
      const now = new Date().toISOString();
      const pedido: Omit<Pedido, "id"> = {
        restaurantId,
        fornecedorId: g.fornecedor.id,
        fornecedorNomeSnapshot: g.fornecedor.nome,
        fornecedorWhatsappSnapshot: g.fornecedor.whatsapp,
        itens,
        totalEstimado: totalEstimado > 0 ? totalEstimado : undefined,
        status: "rascunho",
        iaEspelho: itens.map(it => ({ ...it })),
        criadoEm: now,
        criadoPor: me.id,
        atualizadoEm: now,
      };
      await addDoc(collection(db, "pedidos"), sanitizeForFirestore(pedido));
      // limpa os ajustes/inclusões desse fornecedor
      setIncluir(s => { const n = { ...s }; for (const l of inclui) delete n[l.insumo.id]; return n; });
      setAjustes(s => { const n = { ...s }; for (const l of inclui) delete n[l.insumo.id]; return n; });
      onPedidoCriado?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao criar pedido");
    } finally {
      setSavingFornId(null);
    }
  }

  const semFornecedor = grupos.find(g => g.fornecedorId === null);
  const comFornecedor = grupos.filter(g => g.fornecedorId !== null);
  const nadaPrecisa = comFornecedor.every(g => g.precisam.length === 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Sugestão baseada em <strong>contagem × estoque mínimo</strong>, arredondada pelo pacote e pelo pedido mínimo do item.
        Itens já OK aparecem no rodapé de cada fornecedor — dá pra <strong>adicionar</strong> se quiser antecipar.
      </p>
      {nadaPrecisa && comFornecedor.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center text-sm text-emerald-800 dark:text-emerald-300">
          ✓ Nenhum insumo abaixo do estoque mínimo. Tudo em ordem! (dá pra adicionar itens OK abaixo, se quiser)
        </div>
      )}

      {comFornecedor.map(g => {
        const forn = g.fornecedor!;
        const inclui = itensIncluidos(g);
        const total = totalGrupo(g);
        const faltaMin = g.pedidoMinimoValor != null && total > 0 && total < g.pedidoMinimoValor ? g.pedidoMinimoValor - total : 0;
        const okVisiveis = g.ok;
        const okOpen = okAberto[forn.id] ?? false;
        return (
          <div key={forn.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            {/* header fornecedor */}
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Building2 size={16} /> {forn.nome}</h3>
                {forn.whatsapp && <div className="text-xs text-gray-500 inline-flex items-center gap-1"><Smartphone size={12} /> {forn.whatsapp}</div>}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <strong>{inclui.length}</strong> item(ns){total > 0 && <> · <strong>{fmtR$(total)}</strong></>}
                </div>
                {podeConfig && (
                  <Button onClick={() => gerarPedido(g)} disabled={savingFornId === forn.id || inclui.length === 0}>
                    {savingFornId === forn.id ? "..." : <span className="inline-flex items-center gap-1.5"><ClipboardList size={14} /> Gerar pedido ({inclui.length})</span>}
                  </Button>
                )}
              </div>
            </div>

            {faltaMin > 0 && (
              <div className="mb-2 text-[12px] inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1">
                <TriangleAlert size={13} /> Faltam <strong>{fmtR$(faltaMin)}</strong> pra atingir o pedido mínimo ({fmtR$(g.pedidoMinimoValor!)}).
              </div>
            )}

            {/* cabeçalho das 3 colunas */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 font-semibold border-b border-gray-100 dark:border-gray-800">
              <span>Item</span>
              <span className="w-16 text-right">Contagem</span>
              <span className="w-16 text-right">Mínimo</span>
              <span className="w-24 text-right">Sugestão</span>
            </div>

            {/* itens que PRECISAM */}
            <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
              {g.precisam.length === 0 && <div className="text-[12px] text-gray-400 px-2 py-2">Nenhum item abaixo do mínimo.</div>}
              {g.precisam.map(l => <LinhaItem key={l.insumo.id} l={l} incluido={isIncluido(l)} podeConfig={podeConfig}
                valor={ajustes[l.insumo.id] ?? String(l.qtdSugerida)}
                onQtd={v => setAjustes(s => ({ ...s, [l.insumo.id]: v }))}
                onToggle={v => setIncluir(s => ({ ...s, [l.insumo.id]: v }))} />)}
            </div>

            {/* itens OK (opacos, adicionáveis) */}
            {okVisiveis.length > 0 && (
              <div className="mt-1.5 border-t border-dashed border-gray-200 dark:border-gray-800 pt-1.5">
                <button type="button" onClick={() => setOkAberto(s => ({ ...s, [forn.id]: !okOpen }))}
                  className="text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center gap-1">
                  {okOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Itens em dia ({okVisiveis.length}) — adicionar ao pedido
                </button>
                {okOpen && (
                  <div className="divide-y divide-gray-50 dark:divide-gray-800/50 mt-1">
                    {okVisiveis.map(l => <LinhaItem key={l.insumo.id} l={l} incluido={isIncluido(l)} podeConfig={podeConfig} opaco
                      valor={ajustes[l.insumo.id] ?? String(qtdInicialOk(l))}
                      onQtd={v => setAjustes(s => ({ ...s, [l.insumo.id]: v }))}
                      onToggle={v => setIncluir(s => ({ ...s, [l.insumo.id]: v }))} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* sem fornecedor preferencial */}
      {semFornecedor && (semFornecedor.precisam.length > 0 || semFornecedor.ok.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <h3 className="font-bold text-amber-900 dark:text-amber-300 mb-1 inline-flex items-center gap-1.5"><TriangleAlert size={15} /> Sem fornecedor preferencial ({semFornecedor.precisam.length + semFornecedor.ok.length})</h3>
          <p className="text-xs text-amber-800 dark:text-amber-400 mb-2">Vincule um fornecedor preferencial a cada insumo (aba Fornecedores no insumo) pra agrupar aqui e gerar pedido.</p>
          <ul className="text-sm text-amber-900 dark:text-amber-300 space-y-0.5">
            {semFornecedor.precisam.map(l => (
              <li key={l.insumo.id}>• <strong>{l.insumo.nome}</strong> — contagem {l.contagem}, mín {l.minStock}, pedir <strong>{l.qtdSugerida} {undLabel(l.insumo)}</strong></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Quando um item OK é adicionado, começa sugerindo 1 pacote (fator) ou 1.
function qtdInicialOk(l: LinhaSugestao): number {
  return l.fator > 1 ? l.fator : (l.minPedido > 0 ? l.minPedido : 1);
}

function LinhaItem({ l, incluido, podeConfig, opaco, valor, onQtd, onToggle }: {
  l: LinhaSugestao; incluido: boolean; podeConfig: boolean; opaco?: boolean;
  valor: string; onQtd: (v: string) => void; onToggle: (v: boolean) => void;
}) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-2 py-1.5 ${opaco && !incluido ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <input type="checkbox" checked={incluido} onChange={e => onToggle(e.target.checked)} disabled={!podeConfig}
          className="shrink-0 w-4 h-4 accent-indigo-600" title={incluido ? "No pedido" : "Adicionar ao pedido"} />
        <div className="min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{l.insumo.nome}</div>
          <div className="text-[10px] text-gray-500">
            {l.fator > 1 && <>pacote {l.fator}× </>}
            {l.minPedido > 0 && <>· mín/item {l.minPedido} </>}
            {l.precoUnit != null && <>· {fmtR$(l.precoUnit)}/{undLabel(l.insumo)}</>}
          </div>
        </div>
      </div>
      <span className={`w-16 text-right tabular-nums text-sm ${l.temContagem ? "text-gray-700 dark:text-gray-200" : "text-gray-300 dark:text-gray-600"}`}>
        {l.temContagem ? l.contagem : "—"}
      </span>
      <span className="w-16 text-right tabular-nums text-sm text-gray-500">{l.minStock || "—"}</span>
      <div className="w-24 flex items-center justify-end gap-1">
        <input type="number" min={0} step={l.fator || "any"} value={valor} onChange={e => onQtd(e.target.value)}
          disabled={!podeConfig || !incluido}
          className="w-16 px-2 py-1 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50 tabular-nums" />
        <span className="text-[10px] text-gray-400 w-6">{undLabel(l.insumo)}</span>
      </div>
    </div>
  );
}
