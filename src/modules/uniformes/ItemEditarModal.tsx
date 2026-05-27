// Modal — Editar/criar item do catálogo (uniforme ou EPI).
//
// Permite cadastrar:
//   - Tipo (uniforme | EPI)
//   - Nome
//   - Custo unitário (base)
//   - Validade em dias (0 = sem validade)
//   - CA (só EPI)
//   - Variações: array de { tamanho, estoque inicial, estoque mínimo? }
//
// Pra editar variações de item já existente, o usuário pode adicionar/remover.
// AVISO: editar `estoque` aqui é tratado como AJUSTE manual (grava 1 entry
// em movEstoqueUniforme com motivo "ajuste").

import { useEffect, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { ItemUniforme, Pessoa, TipoItemUniforme, VariacaoItem } from "../../core/types";
import {
  ajustarEstoque, atualizarItem, criarItem, novaVariacaoId,
} from "../../core/uniformes/uniformesHelpers";

type Props = {
  item: ItemUniforme | null;        // null = novo
  pessoa: Pessoa;
  restaurantId: string;
  onClose: () => void;
};

export function ItemEditarModal({ item, pessoa, restaurantId, onClose }: Props) {
  const novo = item === null;
  const [tipo, setTipo] = useState<TipoItemUniforme>(item?.tipo || "uniforme");
  const [nome, setNome] = useState(item?.nome || "");
  const [custoUnit, setCustoUnit] = useState(item ? String(item.custoUnit) : "");
  const [validadeDias, setValidadeDias] = useState(item ? String(item.validadeDias) : "0");
  const [caEpi, setCaEpi] = useState(item?.caEpi || "");
  const [variacoes, setVariacoes] = useState<VariacaoItem[]>(
    () => item?.variacoes
      ? structuredClone(item.variacoes)
      : [{ id: novaVariacaoId(), tamanho: "Único", estoque: 0 }],
  );
  const [ativo, setAtivo] = useState(item?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Estoque original pra detectar ajuste manual
  const [estoqueOriginal] = useState<Record<string, number>>(
    () => Object.fromEntries((item?.variacoes || []).map(v => [v.id, v.estoque])),
  );

  useEffect(() => { setErro(""); }, [tipo, nome, custoUnit, validadeDias, caEpi, variacoes, ativo]);

  function addVariacao() {
    setVariacoes(prev => [...prev, { id: novaVariacaoId(), tamanho: "", estoque: 0 }]);
  }
  function removerVariacao(id: string) {
    if (variacoes.length === 1) {
      setErro("Pelo menos 1 variação é obrigatória.");
      return;
    }
    if (estoqueOriginal[id] && estoqueOriginal[id] > 0) {
      if (!confirm("Essa variação tem estoque. Remover mesmo assim? O saldo será descartado.")) return;
    }
    setVariacoes(prev => prev.filter(v => v.id !== id));
  }
  function atualizarVar(id: string, patch: Partial<VariacaoItem>) {
    setVariacoes(prev => prev.map(v => v.id === id ? { ...v, ...patch } : v));
  }

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Nome é obrigatório."); return; }
    const custo = parseFloat(custoUnit.replace(",", "."));
    if (!isFinite(custo) || custo < 0) { setErro("Custo unitário inválido."); return; }
    const dias = parseInt(validadeDias, 10);
    if (!isFinite(dias) || dias < 0) { setErro("Validade inválida (use 0 pra sem validade)."); return; }
    if (variacoes.length === 0) { setErro("Adicione pelo menos 1 variação."); return; }
    for (const v of variacoes) {
      if (!v.tamanho.trim()) { setErro("Cada variação precisa de um tamanho."); return; }
      if (!isFinite(v.estoque) || v.estoque < 0) { setErro(`Estoque inválido na variação "${v.tamanho}".`); return; }
    }

    setSalvando(true);
    try {
      if (novo) {
        await criarItem({
          restaurantId,
          tipo,
          nome: nome.trim(),
          custoUnit: custo,
          validadeDias: dias,
          caEpi: tipo === "epi" ? caEpi.trim() || undefined : undefined,
          variacoes,
          ativo,
          criadoPor: pessoa.id,
        });
      } else if (item) {
        // Atualiza campos básicos
        await atualizarItem(item.id, {
          tipo,
          nome: nome.trim(),
          custoUnit: custo,
          validadeDias: dias,
          caEpi: tipo === "epi" ? caEpi.trim() || undefined : undefined,
          variacoes,
          ativo,
        });
        // Loga ajuste de estoque pra variações que mudaram
        const novosPorId = Object.fromEntries(variacoes.map(v => [v.id, v.estoque]));
        for (const [vId, estoqueAntes] of Object.entries(estoqueOriginal)) {
          const estoqueDepois = novosPorId[vId];
          if (estoqueDepois == null) continue; // variação removida — não loga
          const delta = estoqueDepois - estoqueAntes;
          if (delta !== 0) {
            await ajustarEstoque({
              item: { ...item, variacoes },
              variacaoId: vId,
              delta,
              motivo: "ajuste",
              observacao: "Edição manual via cadastro de item",
              pessoa,
            }).catch(() => undefined);
          }
        }
      }
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal title={novo ? "Novo item" : `Editar: ${item?.nome}`} onClose={onClose} maxWidth="max-w-xl">
      <div className="p-4 space-y-4">
        {/* Tipo */}
        <div>
          <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Tipo *</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTipo("uniforme")}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                tipo === "uniforme"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              }`}
            >
              🦺 Uniforme
            </button>
            <button
              type="button"
              onClick={() => setTipo("epi")}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                tipo === "epi"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              }`}
            >
              🛡️ EPI
            </button>
          </div>
        </div>

        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Camiseta polo Sororoca, Sapato de segurança…"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Custo unitário (R$) *"
            type="number"
            min="0"
            step="0.01"
            value={custoUnit}
            onChange={(e) => setCustoUnit(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Validade (dias) *"
            type="number"
            min="0"
            value={validadeDias}
            onChange={(e) => setValidadeDias(e.target.value)}
            placeholder="0 = sem validade"
          />
        </div>

        {tipo === "epi" && (
          <Input
            label="CA — Certificado de Aprovação"
            value={caEpi}
            onChange={(e) => setCaEpi(e.target.value)}
            placeholder="27921"
          />
        )}

        {/* Variações */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Variações *
            </label>
            <button
              type="button"
              onClick={addVariacao}
              className="text-[11px] px-2 py-1 rounded border border-dashed border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
            >
              + variação
            </button>
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
            Cada variação tem estoque próprio. Use "Único" se o item não tem tamanhos
            (ex: avental, brinde).
          </p>
          <div className="space-y-1.5">
            {variacoes.map((v) => (
              <div key={v.id} className="grid grid-cols-[1fr_80px_80px_30px] gap-1.5 items-center">
                <input
                  type="text"
                  value={v.tamanho}
                  onChange={(e) => atualizarVar(v.id, { tamanho: e.target.value })}
                  placeholder="P / M / G / 42"
                  className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                <input
                  type="number"
                  min="0"
                  value={v.estoque}
                  onChange={(e) => atualizarVar(v.id, { estoque: parseInt(e.target.value, 10) || 0 })}
                  placeholder="Estoque"
                  title="Estoque atual"
                  className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums"
                />
                <input
                  type="number"
                  min="0"
                  value={v.estoqueMinimo ?? ""}
                  onChange={(e) => atualizarVar(v.id, {
                    estoqueMinimo: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })}
                  placeholder="Mín."
                  title="Estoque mínimo (alerta)"
                  className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => removerVariacao(v.id)}
                  title="Remover variação"
                  className="text-rose-500 hover:text-rose-700 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="w-4 h-4 accent-indigo-600"
          />
          <span>Item ativo (aparece nas listas de seleção)</span>
        </label>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : (novo ? "Criar item" : "Salvar")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
