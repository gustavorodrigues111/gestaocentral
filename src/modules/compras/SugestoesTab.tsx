import { useMemo, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo, Pedido, PedidoItem } from "../../core/types";

type Props = {
  insumos: Insumo[];
  ultimaContagem: Record<string, Contagem>;
  fornecedores: Fornecedor[];
  insumosComFalta: Insumo[];
  restaurantId: string;
  podeConfig: boolean;
  onPedidoCriado?: () => void;
};

type LinhaSugestao = {
  insumo: Insumo;
  qtdAtual: number;
  qtdSugerida: number;     // calculada considerando fator
  qtdAjustada: number;     // editável pelo usuário
  precoUnit?: number;
};

export function SugestoesTab({
  insumos, ultimaContagem, fornecedores, insumosComFalta,
  restaurantId, podeConfig, onPedidoCriado,
}: Props) {
  const { pessoa: me } = useAuth();
  const [savingFornId, setSavingFornId] = useState<string | null>(null);

  // Calcula sugestão de qtd
  function calcSugestao(i: Insumo, qtdAtual: number): number {
    const min = i.minStock || 0;
    const necessidade = Math.max(0, min - qtdAtual);
    if (necessidade === 0) return 0;
    const fator = i.fatorCompra && i.fatorCompra > 0 ? i.fatorCompra : 1;
    return Math.ceil(necessidade / fator) * fator;
  }

  // Agrupa por fornecedor
  const porFornecedor = useMemo(() => {
    const m: Record<string, LinhaSugestao[]> = {};
    const semFornecedor: LinhaSugestao[] = [];

    for (const i of insumosComFalta) {
      const c = ultimaContagem[i.id];
      const qtdAtual = c?.qty ?? 0;
      const qtdSugerida = calcSugestao(i, qtdAtual);
      const linha: LinhaSugestao = {
        insumo: i,
        qtdAtual,
        qtdSugerida,
        qtdAjustada: qtdSugerida,
        precoUnit: i.precoEstimado,
      };
      if (i.fornecedorPreferredId) {
        if (!m[i.fornecedorPreferredId]) m[i.fornecedorPreferredId] = [];
        m[i.fornecedorPreferredId].push(linha);
      } else {
        semFornecedor.push(linha);
      }
    }
    return { m, semFornecedor };
  }, [insumosComFalta, ultimaContagem]);

  // State pra ajustar quantidades por insumo
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  // checkbox: incluir esse insumo no pedido
  const [incluir, setIncluir] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const i of insumosComFalta) m[i.id] = true; // default: incluído
    return m;
  });

  function getQtdAjustada(linha: LinhaSugestao): number {
    const v = ajustes[linha.insumo.id];
    if (v == null || v === "") return linha.qtdSugerida;
    const n = parseFloat(v);
    return isNaN(n) ? linha.qtdSugerida : n;
  }

  function totalLinha(linha: LinhaSugestao): number {
    if (linha.precoUnit == null) return 0;
    return getQtdAjustada(linha) * linha.precoUnit;
  }

  async function gerarPedido(fornId: string, linhas: LinhaSugestao[]) {
    if (!me) return;
    const forn = fornecedores.find(f => f.id === fornId);
    if (!forn) { alert("Fornecedor não encontrado"); return; }
    const linhasIncluidas = linhas.filter(l => incluir[l.insumo.id] !== false && getQtdAjustada(l) > 0);
    if (linhasIncluidas.length === 0) {
      alert("Nenhum item selecionado pra esse fornecedor.");
      return;
    }
    setSavingFornId(fornId);
    try {
      const itens: PedidoItem[] = linhasIncluidas.map(l => ({
        insumoId: l.insumo.id,
        insumoNomeSnapshot: l.insumo.nome,
        unidadeSnapshot: l.insumo.unidade,
        qtdPedida: getQtdAjustada(l),
        qtdRecebida: null,
        precoUnit: l.precoUnit,
      }));
      const totalEstimado = itens.reduce((s, it) => s + ((it.precoUnit || 0) * it.qtdPedida), 0);
      const now = new Date().toISOString();
      const pedido: Omit<Pedido, "id"> = {
        restaurantId,
        fornecedorId: forn.id,
        fornecedorNomeSnapshot: forn.nome,
        fornecedorWhatsappSnapshot: forn.whatsapp,
        itens,
        totalEstimado: totalEstimado > 0 ? totalEstimado : undefined,
        status: "rascunho",
        criadoEm: now,
        criadoPor: me.id,
        atualizadoEm: now,
      };
      await addDoc(collection(db, "pedidos"), sanitizeForFirestore(pedido));
      // Tira essas linhas da seleção (já viraram pedido)
      const novosIncluir = { ...incluir };
      for (const l of linhasIncluidas) novosIncluir[l.insumo.id] = false;
      setIncluir(novosIncluir);
      onPedidoCriado?.();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Erro ao criar pedido");
    } finally {
      setSavingFornId(null);
    }
  }

  if (insumosComFalta.length === 0) {
    return null; // ComprasPage já mostra o "tudo em ordem"
  }

  void insumos;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Sugestões automáticas baseadas em <strong>estoque atual &lt; mínimo</strong>. Quantidades arredondadas pelo fator de compra.
      </p>

      {Object.entries(porFornecedor.m).map(([fornId, linhas]) => {
        const forn = fornecedores.find(f => f.id === fornId);
        if (!forn) return null;
        const totalFornecedor = linhas
          .filter(l => incluir[l.insumo.id] !== false)
          .reduce((s, l) => s + totalLinha(l), 0);
        const itensIncluidos = linhas.filter(l => incluir[l.insumo.id] !== false).length;
        return (
          <div key={fornId} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">🏢 {forn.nome}</h3>
                {forn.whatsapp && <div className="text-xs text-gray-500">📱 {forn.whatsapp}</div>}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <strong>{itensIncluidos}</strong> item(ns) ·
                  {totalFornecedor > 0 && <> total estimado: <strong>R$ {totalFornecedor.toFixed(2)}</strong></>}
                </div>
                {podeConfig && (
                  <Button
                    onClick={() => gerarPedido(fornId, linhas)}
                    disabled={savingFornId === fornId || itensIncluidos === 0}
                  >
                    {savingFornId === fornId ? "..." : `📋 Gerar pedido (${itensIncluidos})`}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              {linhas.map(l => {
                const total = totalLinha(l);
                const inc = incluir[l.insumo.id] !== false;
                return (
                  <div
                    key={l.insumo.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                      inc
                        ? "bg-amber-50/40 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
                        : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={inc}
                      onChange={(e) => setIncluir(s => ({ ...s, [l.insumo.id]: e.target.checked }))}
                      disabled={!podeConfig}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{l.insumo.nome}</div>
                      <div className="text-[10px] text-gray-500">
                        atual: <strong>{l.qtdAtual}</strong> · mín: <strong>{l.insumo.minStock}</strong>
                        {l.insumo.fatorCompra && l.insumo.fatorCompra > 1 && <> · fator: <strong>{l.insumo.fatorCompra}</strong></>}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={l.insumo.fatorCompra || "any"}
                      value={ajustes[l.insumo.id] ?? String(l.qtdSugerida)}
                      onChange={(e) => setAjustes(s => ({ ...s, [l.insumo.id]: e.target.value }))}
                      disabled={!podeConfig || !inc}
                      className="w-20 px-2 py-1 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50"
                    />
                    <span className="text-xs text-gray-500 w-12">
                      {l.insumo.unidade === "outro" ? (l.insumo.unidadeOutroLabel || "?") : UNIDADES_LABEL[l.insumo.unidade].slice(0, 3)}
                    </span>
                    {l.precoUnit != null && (
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-20 text-right">
                        R$ {total.toFixed(2)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Sem fornecedor */}
      {porFornecedor.semFornecedor.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <h3 className="font-bold text-amber-900 dark:text-amber-300 mb-2">
            ⚠ Insumos sem fornecedor preferencial ({porFornecedor.semFornecedor.length})
          </h3>
          <p className="text-xs text-amber-800 dark:text-amber-400 mb-2">
            Vincule um fornecedor preferencial a cada insumo (no módulo Contagens) pra que apareçam agrupados aqui.
          </p>
          <ul className="text-sm text-amber-900 dark:text-amber-300 space-y-0.5">
            {porFornecedor.semFornecedor.map(l => (
              <li key={l.insumo.id}>
                • <strong>{l.insumo.nome}</strong> (atual: {l.qtdAtual}, mín: {l.insumo.minStock}, falta: {l.qtdSugerida})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
