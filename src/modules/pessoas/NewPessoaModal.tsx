import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import type { ModuleId, ModulePermission } from "../../core/types";

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function NewPessoaModal({ onClose, onCreated }: Props) {
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const modulosAtivos = activeRestaurant?.modulosAtivos || [];

  const [form, setForm] = useState({
    email: "",
    nome: "",
    cpf: "",
    whatsapp: "",
  });
  const [perms, setPerms] = useState<Record<string, ModulePermission>>(() => {
    const init: Record<string, ModulePermission> = {};
    modulosAtivos.forEach(m => { init[m] = { ver: false, configurar: false }; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function togglePerm(moduleId: ModuleId, kind: "ver" | "configurar") {
    setPerms(p => ({
      ...p,
      [moduleId]: { ...p[moduleId], [kind]: !p[moduleId]?.[kind] },
    }));
  }

  async function salvar() {
    if (!form.email.trim() || !form.nome.trim()) {
      setError("Email e nome são obrigatórios");
      return;
    }
    if (!rid || !me) return;
    setError("");
    setSaving(true);
    try {
      // Filtra só perms que tem ver ou configurar marcado
      const permissionsRid: Record<string, ModulePermission> = {};
      Object.entries(perms).forEach(([k, v]) => {
        if (v.ver || v.configurar) permissionsRid[k] = v;
      });

      await addDoc(collection(db, "pessoas"), {
        email: form.email.trim().toLowerCase(),
        nome: form.nome.trim(),
        cpf: form.cpf.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        isMaster: false,
        restaurantIds: [rid],
        permissions: { [rid]: permissionsRid },
        ativa: true,
        createdAt: new Date().toISOString(),
        createdBy: me.id,
      });
      onCreated();
      onClose();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Erro ao criar pessoa");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="+ Nova Pessoa" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Email * (ela vai usar pra logar)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="pessoa@exemplo.com"
            autoFocus
          />
          <Input
            label="Nome completo *"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
          <Input
            label="CPF"
            value={form.cpf}
            onChange={(e) => setForm({ ...form, cpf: e.target.value })}
            placeholder="000.000.000-00"
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="(11) 99999-9999"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 block">
            Permissões em {activeRestaurant?.nome}
          </label>
          {modulosAtivos.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg">
              Nenhum módulo ativo. Adicione módulos em Configurações antes.
            </p>
          ) : (
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400">
                <div>Módulo</div>
                <div className="w-12 text-center">Ver</div>
                <div className="w-16 text-center">Configurar</div>
              </div>
              {modulosAtivos.map(m => {
                const p = perms[m] || { ver: false, configurar: false };
                return (
                  <div
                    key={m}
                    className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm"
                  >
                    <div className="text-gray-800 dark:text-gray-200">{m}</div>
                    <div className="w-12 text-center">
                      <input
                        type="checkbox"
                        checked={p.ver}
                        onChange={() => togglePerm(m, "ver")}
                      />
                    </div>
                    <div className="w-16 text-center">
                      <input
                        type="checkbox"
                        checked={p.configurar}
                        onChange={() => togglePerm(m, "configurar")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            <strong>Ver</strong>: pode visualizar e usar o módulo. <strong>Configurar</strong>: pode editar configurações
            (configurar implica ver). Marcar os 2 = controle total.
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-2 text-sm text-blue-900 dark:text-blue-300">
          📩 Após criar, peça pra pessoa acessar a URL do app e clicar em <strong>"Criar conta"</strong>. Ela vai criar uma senha com o mesmo email — e o sistema vincula automaticamente.
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || !form.email || !form.nome}>
            {saving ? "Criando..." : "Criar pessoa"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
