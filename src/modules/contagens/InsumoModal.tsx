import { useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL, UNIDADES_LISTA } from "../../core/types";
import type { Fornecedor, Insumo, UnidadeMedida } from "../../core/types";

type Props = {
  insumo: Insumo | null;
  fornecedores: Fornecedor[];
  restaurantId: string;
  onClose: () => void;
};

const CATEGORIAS_SUGERIDAS = [
  "Bebidas", "Vinhos", "Cervejas", "Destilados",
  "Carnes", "Aves", "Peixes", "Hortifrúti", "Laticínios",
  "Mercearia", "Limpeza", "Descartáveis", "Outros",
];

export function InsumoModal({ insumo, fornecedores, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !insumo;

  const [nome, setNome] = useState(insumo?.nome || "");
  const [categoria, setCategoria] = useState(insumo?.categoria || "");
  const [unidade, setUnidade] = useState<UnidadeMedida>(insumo?.unidade || "un");
  const [unidadeOutro, setUnidadeOutro] = useState(insumo?.unidadeOutroLabel || "");
  const [minStock, setMinStock] = useState(insumo?.minStock != null ? String(insumo.minStock) : "");
  const [fornecedorId, setFornecedorId] = useState<string>(insumo?.fornecedorPreferredId || "");
  const [fatorCompra, setFatorCompra] = useState(insumo?.fatorCompra != null ? String(insumo.fatorCompra) : "");
  const [precoEstimado, setPrecoEstimado] = useState(insumo?.precoEstimado != null ? String(insumo.precoEstimado) : "");
  const [ativo, setAtivo] = useState(insumo?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (unidade === "outro" && !unidadeOutro.trim()) { setErr("Descreva a unidade ('outro')"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const min = minStock.trim() ? parseFloat(minStock) : undefined;
      const fator = fatorCompra.trim() ? parseFloat(fatorCompra) : undefined;
      const preco = precoEstimado.trim() ? parseFloat(precoEstimado) : undefined;

      const payload: Omit<Insumo, "id"> = {
        restaurantId,
        nome: nome.trim(),
        categoria: categoria.trim() || undefined,
        unidade,
        unidadeOutroLabel: unidade === "outro" ? unidadeOutro.trim() : undefined,
        minStock: min !== undefined && !isNaN(min) ? min : undefined,
        fornecedorPreferredId: fornecedorId || null,
        fatorCompra: fator !== undefined && !isNaN(fator) && fator > 0 ? fator : undefined,
        precoEstimado: preco !== undefined && !isNaN(preco) ? preco : undefined,
        ativo,
        ordem: insumo?.ordem,
        criadoEm: insumo?.criadoEm || now,
        criadoPor: insumo?.criadoPor || me.id,
        atualizadoEm: now,
      };
      if (isNew) {
        await addDoc(collection(db, "insumos"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "insumos", insumo.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Novo insumo" : `Editar — ${insumo.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Vinho Malbec, Detergente, Filé Mignon"
          autoFocus
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Categoria</label>
          <div className="flex flex-wrap gap-1 mt-1 mb-1">
            {CATEGORIAS_SUGERIDAS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c === categoria ? "" : c)}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  categoria === c
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="ou digite outra" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Unidade *</label>
            <select
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as UnidadeMedida)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              {UNIDADES_LISTA.map(u => <option key={u} value={u}>{UNIDADES_LABEL[u]}</option>)}
            </select>
          </div>
          {unidade === "outro" && (
            <Input
              label="Descrição da unidade *"
              value={unidadeOutro}
              onChange={(e) => setUnidadeOutro(e.target.value)}
              placeholder="ex: bandeja, dúzia"
            />
          )}
          {unidade !== "outro" && (
            <Input
              label="Estoque mínimo"
              type="number"
              min={0}
              step="any"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              placeholder="0 = sem alerta"
            />
          )}
        </div>

        {unidade === "outro" && (
          <Input
            label="Estoque mínimo"
            type="number"
            min={0}
            step="any"
            value={minStock}
            onChange={(e) => setMinStock(e.target.value)}
            placeholder="0 = sem alerta"
          />
        )}

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Compra
          </label>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fornecedor preferencial</label>
              <select
                value={fornecedorId}
                onChange={(e) => setFornecedorId(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <option value="">— sem fornecedor preferencial —</option>
                {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              {fornecedores.length === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">Cadastre fornecedores no módulo Compras pra escolher aqui.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Fator de compra"
                type="number"
                min={1}
                step="any"
                value={fatorCompra}
                onChange={(e) => setFatorCompra(e.target.value)}
                placeholder="ex: 6 (cx de 6 garrafas)"
              />
              <Input
                label="Preço estimado (R$/un)"
                type="number"
                min={0}
                step="0.01"
                value={precoEstimado}
                onChange={(e) => setPrecoEstimado(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer pt-2 border-t border-gray-200 dark:border-gray-800">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Insumo ativo</span>
          <span className="text-xs text-gray-500">(inativo não aparece nas contagens nem nas sugestões)</span>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
