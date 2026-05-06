import { useState } from "react";
import { addDoc, collection, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { MODULES } from "../../config/modules";
import type { ModuleId } from "../../core/types";

type Props = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

export function NewRestaurantModal({ onClose, onCreated }: Props) {
  const { pessoa } = useAuth();
  const [form, setForm] = useState({
    nome: "",
    shortCode: "",
    cnpj: "",
    razaoSocial: "",
    codigoContabil: "",
  });
  // Por padrão ativa só os módulos ativos no sprint atual
  const ativosDefault = MODULES.filter(m => m.status === "ativo").map(m => m.id);
  const [modulosAtivos, setModulosAtivos] = useState<ModuleId[]>(ativosDefault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleModulo(id: ModuleId) {
    setModulosAtivos(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  }

  async function salvar() {
    if (!form.nome.trim() || form.shortCode.trim().length !== 3) {
      setError("Nome e shortCode (3 letras) obrigatórios");
      return;
    }
    if (!pessoa) return;
    setError("");
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "restaurants"), {
        nome: form.nome.trim(),
        shortCode: form.shortCode.trim().toUpperCase(),
        cnpj: form.cnpj.trim() || null,
        razaoSocial: form.razaoSocial.trim() || null,
        codigoContabil: form.codigoContabil.trim() || null,
        modulosAtivos,
        ativo: true,
        createdAt: new Date().toISOString(),
        createdBy: pessoa.id,
      });
      // Vincula no restaurantIds da pessoa que criou
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        restaurantIds: arrayUnion(ref.id),
      });
      onCreated(ref.id);
      onClose();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Erro ao criar restaurante");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="+ Novo Restaurante" onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Nome do restaurante *"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="ex: Lobozó"
            autoFocus
          />
          <Input
            label="Código curto (3 letras) *"
            value={form.shortCode}
            onChange={(e) => setForm({ ...form, shortCode: e.target.value.toUpperCase().slice(0, 3) })}
            placeholder="LOB"
            maxLength={3}
          />
          <Input
            label="CNPJ"
            value={form.cnpj}
            onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            placeholder="00.000.000/0000-00"
          />
          <Input
            label="Razão social"
            value={form.razaoSocial}
            onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
            placeholder="LOBOZÓ COZINHA E VENDA LTDA"
          />
          <Input
            label="Código contábil"
            value={form.codigoContabil}
            onChange={(e) => setForm({ ...form, codigoContabil: e.target.value.replace(/\D/g, "") })}
            placeholder="3107"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 block">
            Módulos ativos
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Escolha quais módulos esse restaurante usa. Pode mudar depois em Configurações.
          </p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {MODULES.map(m => {
              const ativo = modulosAtivos.includes(m.id);
              const disabled = m.status !== "ativo";
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer ${
                    ativo ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={ativo}
                    disabled={disabled}
                    onChange={() => !disabled && toggleModulo(m.id)}
                  />
                  <span className="text-base">{m.icon}</span>
                  <span className="text-sm text-gray-800 dark:text-gray-200">{m.label}</span>
                  {disabled && (
                    <span className="ml-auto text-[10px] text-gray-400 uppercase">
                      {m.status === "em-breve" ? "em breve" : "próx."}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || !form.nome || form.shortCode.length !== 3}>
            {saving ? "Criando..." : "Criar restaurante"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
