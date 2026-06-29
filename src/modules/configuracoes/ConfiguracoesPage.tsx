import { useState } from "react";
import { useParams } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { AREA_INFO, modulesByArea, getModule } from "../../config/modules";
import { UNIDADE_TIPO_LABEL } from "../../core/types";
import type { ModuleArea, ModuleId, Unidade, UnidadeTipo } from "../../core/types";
import { isValidSubdomain } from "../../core/restaurant/subdomain";

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
    subdomain: activeRestaurant?.subdomain || "",
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [err, setErr] = useState("");

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

  // Filtra IDs de módulos que NÃO existem mais no registry (ex: "equipe" antigo).
  // Checa existência direto no registry — independente de área (a reorg por
  // persona mudou as áreas; filtrar por área hardcoded zerava todos os checks).
  const modulosAtivos = (activeRestaurant.modulosAtivos || []).filter(id => !!getModule(id));

  async function toggleModulo(moduleId: ModuleId) {
    if (!rid) return;
    // Sempre persiste a versão LIMPA (sem IDs órfãos)
    const novos = modulosAtivos.includes(moduleId)
      ? modulosAtivos.filter(m => m !== moduleId)
      : [...modulosAtivos, moduleId];
    await updateDoc(doc(db, "restaurants", rid), { modulosAtivos: novos });
  }

  async function salvarBasico() {
    if (!rid) return;
    setErr("");
    // Valida subdomain
    const sub = form.subdomain.trim().toLowerCase();
    if (sub && !isValidSubdomain(sub)) {
      setErr("Subdomínio inválido. Use 3-30 caracteres, só letras minúsculas, números e hífen (ex: 'lobozo', 'bar-do-bicho').");
      return;
    }
    // Valida unicidade entre restaurantes
    if (sub && restaurants.some(r => r.id !== rid && (r.subdomain || "").toLowerCase() === sub)) {
      setErr(`O subdomínio "${sub}" já está em uso por outro restaurante.`);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "restaurants", rid), {
        nome: form.nome.trim(),
        razaoSocial: form.razaoSocial.trim() || null,
        codigoContabil: form.codigoContabil.trim() || null,
        cnpj: form.cnpj.trim() || null,
        subdomain: sub || null,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  // Área "master" (Tarefas + Planner) só aparece pro master ligar/desligar.
  const areas: ModuleArea[] = me?.isMaster
    ? ["ops", "dp", "fin", "inst", "master"]
    : ["ops", "dp", "fin", "inst"];

  return (
    <div className="max-w-3xl space-y-6">
      {/* Dados básicos */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-4 text-gray-900 dark:text-gray-100">Dados do restaurante</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <Input label="Razão social" value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} placeholder="ex: SOROROCA BAR LTDA" />
          <Input label="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
          <Input label="Código contábil" value={form.codigoContabil} onChange={(e) => setForm({ ...form, codigoContabil: e.target.value.replace(/\D/g, "") })} placeholder="ex: 2992" />
        </div>

        {/* Subdomain — porta de entrada brandada */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            🌐 Subdomínio público
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={form.subdomain}
              onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              placeholder="ex: lobozo"
              className="flex-1"
            />
            <span className="text-sm text-gray-500 whitespace-nowrap">.planejamento.app</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            Endereço próprio pra equipe acessar:{" "}
            {form.subdomain ? (
              <strong className="text-indigo-600 dark:text-indigo-400">
                {form.subdomain}.planejamento.app
              </strong>
            ) : (
              <em>(nenhum subdomínio configurado)</em>
            )}
            . 3-30 caracteres, letras minúsculas/números/hífen.
          </p>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          💡 Configurações específicas (gorjetas, VT, etc.) ficam dentro de cada módulo — clica no ⚙️ no canto superior direito.
        </p>
        {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={salvarBasico} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          {savedAt && <span className="text-xs text-green-600 dark:text-green-400">✓ Salvo às {savedAt}</span>}
        </div>
      </section>

      {/* Unidades */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-1 text-gray-900 dark:text-gray-100">🏢 Unidades</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Use múltiplas unidades quando seu restaurante tem mais de um endereço
          (matriz + filial, ou casa principal + cozinha de produção).
          Cada unidade vai aparecer na escala e gorjeta com seus próprios dados.
        </p>
        <UnidadesForm
          rid={rid}
          atual={{
            multiUnidades: activeRestaurant.multiUnidades || false,
            unidades: activeRestaurant.unidades || [],
          }}
        />
      </section>

      {/* Carga horária */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-1 text-gray-900 dark:text-gray-100">Horário de trabalho</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Limites de carga semanal aplicados nas validações CLT do horário de cada empregado.
          Padrão CLT é 43:55 a 44:00.
        </p>
        <CargaHorariaForm
          rid={rid}
          atual={activeRestaurant.horarioConfig || {}}
        />
      </section>

      {/* Portal do Empregado */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <h2 className="text-base font-semibold mb-1 text-gray-900 dark:text-gray-100">Portal do Empregado</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          O que TODOS os empregados deste restaurante veem ao logar.
          Aplica igual pra todos — sem customização individual.
        </p>
        <PortalEmpregadoToggles
          rid={rid}
          atual={activeRestaurant.portalEmpregado || {}}
        />
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

// ────────────────────────────────────────────────────────────────────────────
// Toggles do Portal do Empregado
// ────────────────────────────────────────────────────────────────────────────

type PortalConfig = NonNullable<ReturnType<() => { escala?: boolean; gorjetas?: boolean; comunicados?: boolean }>>;

const ITENS_PORTAL: { key: keyof PortalConfig; icon: string; label: string; desc: string }[] = [
  { key: "escala",      icon: "📅", label: "Minha escala",     desc: "Empregado vê só os dias dele no mês" },
  { key: "gorjetas",    icon: "💸", label: "Minhas gorjetas",  desc: "Extrato de gorjetas recebidas" },
  { key: "comunicados", icon: "📣", label: "Comunicados",      desc: "Avisos e comunicados do restaurante" },
];

function PortalEmpregadoToggles({ rid, atual }: { rid: string; atual: PortalConfig }) {
  const [config, setConfig] = useState<PortalConfig>({
    escala:      atual.escala      !== false,
    gorjetas:    atual.gorjetas    !== false,
    comunicados: atual.comunicados !== false,
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState("");

  async function toggle(key: keyof PortalConfig) {
    const next = { ...config, [key]: !config[key] };
    setConfig(next);
    setSavingKey(key);
    try {
      await updateDoc(doc(db, "restaurants", rid), { portalEmpregado: next });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      // Reverte em caso de erro
      setConfig(config);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-2">
      {ITENS_PORTAL.map(item => {
        const ativo = !!config[item.key];
        const isSaving = savingKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => toggle(item.key)}
            disabled={isSaving}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors
              ${ativo
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700"
                : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"}
              ${isSaving ? "opacity-60 cursor-wait" : "cursor-pointer"}
            `}
          >
            <span className="text-xl">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</div>
            </div>
            <input type="checkbox" checked={ativo} readOnly className="pointer-events-none" />
          </button>
        );
      })}
      {savedAt && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
          ✓ Atualizado às {savedAt}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Carga horária do restaurante (HH:MM mínima/máxima)
// ────────────────────────────────────────────────────────────────────────────

function CargaHorariaForm({ rid, atual }: {
  rid: string;
  atual: { cargaSemanalMinMin?: number; cargaSemanalMaxMin?: number };
}) {
  const minMin = atual.cargaSemanalMinMin ?? 2635; // 43:55
  const maxMin = atual.cargaSemanalMaxMin ?? 2640; // 44:00
  const [minStr, setMinStr] = useState(minToHHMM(minMin));
  const [maxStr, setMaxStr] = useState(minToHHMM(maxMin));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [err, setErr] = useState("");

  async function salvar() {
    const minM = hhmmToMin(minStr);
    const maxM = hhmmToMin(maxStr);
    if (minM === null || maxM === null) {
      setErr("Use formato HH:MM (ex: 43:55, 44:00)");
      return;
    }
    if (minM > maxM) {
      setErr("Mínimo não pode ser maior que máximo");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      await updateDoc(doc(db, "restaurants", rid), {
        horarioConfig: {
          cargaSemanalMinMin: minM,
          cargaSemanalMaxMin: maxM,
        },
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Carga semanal MÍNIMA (HH:MM)"
          value={minStr}
          onChange={(e) => setMinStr(e.target.value)}
          placeholder="43:55"
        />
        <Input
          label="Carga semanal MÁXIMA (HH:MM)"
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          placeholder="44:00"
        />
      </div>
      {err && <div className="text-sm text-rose-600 mt-2">{err}</div>}
      <div className="flex items-center gap-3 mt-3">
        <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        {savedAt && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Salvo às {savedAt}</span>}
      </div>
    </div>
  );
}

function minToHHMM(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "00:00";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMin(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ────────────────────────────────────────────────────────────────────────────
// Unidades — toggle + CRUD inline (Matriz, Filial, Produção, etc)
// ────────────────────────────────────────────────────────────────────────────

function UnidadesForm({ rid, atual }: {
  rid: string;
  atual: { multiUnidades: boolean; unidades: Unidade[] };
}) {
  const [multi, setMulti] = useState(atual.multiUnidades);
  const [unidades, setUnidades] = useState<Unidade[]>(atual.unidades || []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [err, setErr] = useState("");

  function addUnidade() {
    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setUnidades(s => [...s, {
      id,
      nome: "",
      tipo: "atendimento",
      cnpj: "",
      ordem: s.length + 1,
      ativa: true,
    }]);
  }

  function updateUnidade(id: string, patch: Partial<Unidade>) {
    setUnidades(s => s.map(u => u.id === id ? { ...u, ...patch } : u));
  }

  function removerUnidade(id: string) {
    if (!confirm("Remover essa unidade? Empregados/escalas com essa unidade ficam com o ID solto.")) return;
    setUnidades(s => s.filter(u => u.id !== id));
  }

  async function salvar() {
    setErr("");

    if (multi) {
      // Valida: pelo menos 2 unidades, sem nomes vazios, sem duplicatas
      if (unidades.length < 2) {
        setErr("Pra ativar múltiplas unidades, cadastre pelo menos 2.");
        return;
      }
      const semNome = unidades.find(u => !u.nome.trim());
      if (semNome) { setErr("Toda unidade precisa ter nome."); return; }
      const nomes = unidades.map(u => u.nome.trim().toLowerCase());
      if (new Set(nomes).size !== nomes.length) {
        setErr("Nomes de unidade duplicados — cada unidade precisa ter nome único.");
        return;
      }
    }

    setSaving(true);
    try {
      // Constrói cada unidade omitindo cnpj quando vazio (Firestore rejeita undefined).
      const unidadesPersist: Unidade[] = multi ? unidades.map(u => {
        const cnpjLimpo = (u.cnpj || "").trim();
        const out: Unidade = {
          id: u.id,
          nome: u.nome.trim(),
          tipo: u.tipo,
          ordem: u.ordem,
          ativa: u.ativa,
        };
        if (cnpjLimpo) out.cnpj = cnpjLimpo;
        return out;
      }) : [];
      await updateDoc(doc(db, "restaurants", rid), {
        multiUnidades: multi,
        unidades: unidadesPersist,
      });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={multi}
          onChange={(e) => setMulti(e.target.checked)}
        />
        <span className="font-medium">Esse restaurante tem múltiplas unidades</span>
      </label>

      {multi && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
          {unidades.length === 0 ? (
            <div className="text-sm text-gray-500 italic">
              Nenhuma unidade cadastrada. Clica em "+ Adicionar unidade" abaixo.
            </div>
          ) : (
            unidades.map(u => (
              <div
                key={u.id}
                className={`grid grid-cols-12 gap-2 p-2 rounded-lg border ${
                  u.ativa
                    ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                    : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 opacity-60"
                }`}
              >
                <input
                  type="text"
                  value={u.nome}
                  onChange={(e) => updateUnidade(u.id, { nome: e.target.value })}
                  placeholder="Nome (ex: Matriz)"
                  className="col-span-4 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                <select
                  value={u.tipo}
                  onChange={(e) => updateUnidade(u.id, { tipo: e.target.value as UnidadeTipo })}
                  className="col-span-3 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                >
                  <option value="atendimento">{UNIDADE_TIPO_LABEL.atendimento}</option>
                  <option value="producao">{UNIDADE_TIPO_LABEL.producao}</option>
                </select>
                <input
                  type="text"
                  value={u.cnpj || ""}
                  onChange={(e) => updateUnidade(u.id, { cnpj: e.target.value })}
                  placeholder="CNPJ (opcional)"
                  className="col-span-3 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
                <label className="col-span-1 flex items-center justify-center gap-1 text-xs cursor-pointer" title="Ativa">
                  <input
                    type="checkbox"
                    checked={u.ativa}
                    onChange={(e) => updateUnidade(u.id, { ativa: e.target.checked })}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removerUnidade(u.id)}
                  className="col-span-1 text-rose-600 hover:text-rose-700 text-sm"
                  title="Remover"
                >
                  ×
                </button>
              </div>
            ))
          )}

          <Button variant="secondary" size="sm" onClick={addUnidade}>
            + Adicionar unidade
          </Button>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 italic mt-2">
            🏪 <strong>Atendimento</strong> arrecada gorjeta dos clientes (ex: Matriz, Filial).<br />
            🍳 <strong>Produção</strong> só prepara — não arrecada. Empregados que trabalham
            aqui e têm cargo com "recebe produção" entram na divisão de gorjeta de todas
            as unidades de atendimento daquele dia.
          </p>
        </div>
      )}

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-800">
        <Button onClick={salvar} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {savedAt && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Salvo às {savedAt}</span>}
      </div>
    </div>
  );
}
