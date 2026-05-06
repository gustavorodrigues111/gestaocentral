import { useState } from "react";
import { useParams } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { AREA_INFO, modulesByArea } from "../../config/modules";
import type { ModuleArea, ModuleId } from "../../core/types";

export function ConfiguracoesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  // URL é source of truth — busca o restaurante pelo rid da rota, não do contexto
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeConfig = canConfig(me, rid, "configuracoes");

  const [form, setForm] = useState({
    nome: activeRestaurant?.nome || "",
    razaoSocial: activeRestaurant?.razaoSocial || "",
    codigoContabil: activeRestaurant?.codigoContabil || "",
    cnpj: activeRestaurant?.cnpj || "",
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeConfig) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Você não tem acesso pra editar configurações deste restaurante.</p>
      </div>
    );
  }

  const modulosAtivos = activeRestaurant.modulosAtivos || [];

  async function toggleModulo(moduleId: ModuleId) {
    if (!rid) return;
    const novos = modulosAtivos.includes(moduleId)
      ? modulosAtivos.filter(m => m !== moduleId)
      : [...modulosAtivos, moduleId];
    await updateDoc(doc(db, "restaurants", rid), { modulosAtivos: novos });
  }

  async function salvarBasico() {
    if (!rid) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "restaurants", rid), {
        nome: form.nome.trim(),
        razaoSocial: form.razaoSocial.trim() || null,
        codigoContabil: form.codigoContabil.trim() || null,
        cnpj: form.cnpj.trim() || null,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const areas: ModuleArea[] = ["operacao", "time", "escritorio"];

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">⚙️ Configurações — {activeRestaurant.nome}</h1>

      {/* Dados básicos */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 text-gray-900 dark:text-gray-100">Dados do restaurante</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <Input label="Razão social" value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} placeholder="ex: SOROROCA BAR LTDA" />
          <Input label="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
          <Input label="Código contábil" value={form.codigoContabil} onChange={(e) => setForm({ ...form, codigoContabil: e.target.value.replace(/\D/g, "") })} placeholder="ex: 2992" />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={salvarBasico} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          {savedAt && <span className="text-xs text-green-600 dark:text-green-400">✓ Salvo às {savedAt}</span>}
        </div>
      </section>

      {/* Módulos ativos */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-1 text-gray-900 dark:text-gray-100">Módulos ativos</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Escolha quais módulos esse restaurante usa. Apenas os ativos aparecem pra equipe.</p>
        <div className="space-y-5">
          {areas.map(area => {
            const mods = modulesByArea(area);
            const info = AREA_INFO[area];
            return (
              <div key={area}>
                <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: info.color }}>
                  {info.label}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {mods.map(m => {
                    const ativo = modulosAtivos.includes(m.id);
                    const disabled = m.status !== "ativo";
                    return (
                      <button
                        key={m.id}
                        onClick={() => !disabled && toggleModulo(m.id)}
                        disabled={disabled}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors
                          ${ativo
                            ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700"
                            : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"}
                          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                        `}
                      >
                        <span className="text-xl">{m.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.label}</div>
                          {disabled && <div className="text-[10px] text-gray-400 uppercase">{m.status === "em-breve" ? "em breve" : "próx. sprints"}</div>}
                        </div>
                        <input type="checkbox" checked={ativo} readOnly className="pointer-events-none" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
