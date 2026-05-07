import { useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Ideia } from "../../core/types";

type Props = {
  ideia: Ideia | null;
  restaurantId: string;
  onClose: () => void;
};

const CATEGORIAS_SUGERIDAS = ["Operação", "Cardápio", "Cultura", "Atendimento", "Custos", "Treinamento", "Outro"];

export function IdeiaModal({ ideia, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !ideia;

  const [titulo, setTitulo] = useState(ideia?.titulo || "");
  const [descricao, setDescricao] = useState(ideia?.descricao || "");
  const [categoria, setCategoria] = useState(ideia?.categoria || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const data: Omit<Ideia, "id"> = {
        restaurantId,
        titulo: titulo.trim(),
        descricao: descricao.trim() || undefined,
        categoria: categoria.trim() || undefined,
        status: ideia?.status || "aberta",
        reuniaoId: ideia?.reuniaoId ?? null,
        criadoEm: ideia?.criadoEm || now,
        criadoPor: ideia?.criadoPor || me.id,
        atualizadoEm: now,
      };
      if (isNew) {
        await addDoc(collection(db, "ideias"), sanitizeForFirestore(data));
      } else {
        await updateDoc(doc(db, "ideias", ideia.id), sanitizeForFirestore(data));
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
    <Modal title={isNew ? "+ Nova ideia" : `Editar — ${ideia.titulo}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ex: Reorganizar fluxo de saída do salão"
          autoFocus
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição</label>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={5}
            placeholder="Detalhes da ideia, contexto, possíveis ganhos..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Categoria</label>
          <div className="flex gap-2 flex-wrap mt-1 mb-1">
            {CATEGORIAS_SUGERIDAS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c === categoria ? "" : c)}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  categoria === c
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Input
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="ou digite outra"
          />
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Criar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
