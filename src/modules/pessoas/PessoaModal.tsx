import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canExcluirPessoa } from "../../core/auth/permissions";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { EmpregadoModal } from "./EmpregadoModal";
import { InativarModal } from "./InativarModal";
import { ReativarModal } from "./ReativarModal";
import { ExcluirModal } from "./ExcluirModal";
import { getModule } from "../../config/modules";
import { logAudit } from "../../core/audit/versionedChange";
import type { Cargo, Empregado, ModuleId, ModulePermission, PermissionTemplate, Pessoa } from "../../core/types";
import { TIPO_VINCULO_LABEL } from "../../core/types";

type Tab = "identidade" | "vinculos" | "permissoes";

type Props = {
  pessoa: Pessoa | null;          // null = criar nova
  restaurantId: string;
  onClose: () => void;
};

export function PessoaModal({ pessoa, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !pessoa;
  const [tab, setTab] = useState<Tab>("identidade");

  if (!me) return null;

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: "identidade", label: "📇 Identidade" },
    { id: "vinculos",   label: "🤝 Vínculos",   disabled: isNew },
    { id: "permissoes", label: "🔐 Permissões", disabled: isNew },
  ];

  return (
    <Modal
      title={isNew ? "+ Nova pessoa" : `Editar — ${pessoa.nome}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="flex border-b border-gray-200 dark:border-gray-800 -mx-6 -mt-2 px-6 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : t.disabled
                ? "border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isNew && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Crie a pessoa primeiro. Depois você vai poder adicionar vínculos de equipe e permissões.
        </p>
      )}

      {tab === "identidade" && <TabIdentidade pessoa={pessoa} restaurantId={restaurantId} onCreated={onClose} onClose={onClose} />}
      {tab === "vinculos"   && pessoa && <TabVinculos pessoa={pessoa} restaurantId={restaurantId} />}
      {tab === "permissoes" && pessoa && <TabPermissoes pessoa={pessoa} restaurantId={restaurantId} />}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1: IDENTIDADE
// ════════════════════════════════════════════════════════════════

function TabIdentidade({
  pessoa, restaurantId, onCreated, onClose,
}: {
  pessoa: Pessoa | null;
  restaurantId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isNew = !pessoa;
  const isInativa = !!pessoa && pessoa.ativa === false;

  const [form, setForm] = useState({
    nome: pessoa?.nome || "",
    email: pessoa?.email || "",
    cpf: pessoa?.cpf || "",
    whatsapp: pessoa?.whatsapp || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [showInativar, setShowInativar] = useState(false);
  const [showReativar, setShowReativar] = useState(false);
  const [showExcluir, setShowExcluir] = useState(false);

  const podeExcluir = canExcluirPessoa(me, restaurantId);

  async function salvar() {
    if (!form.nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (isNew) {
        const ref = await addDoc(collection(db, "pessoas"), {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: form.cpf.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          isMaster: false,
          restaurantIds: [restaurantId],
          permissions: { [restaurantId]: {} },
          ativa: true,
          createdAt: now,
        });
        await logAudit({
          entityType: "pessoa",
          entityId: ref.id,
          restaurantId,
          acao: "criado",
          registradoPor: me.id,
        });
        onCreated();
      } else {
        const update: Record<string, unknown> = {
          email: form.email.trim().toLowerCase(),
          nome: form.nome.trim(),
          cpf: form.cpf.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
        };
        await updateDoc(doc(db, "pessoas", pessoa.id), update);
        await logAudit({
          entityType: "pessoa",
          entityId: pessoa.id,
          restaurantId,
          acao: "alterado",
          registradoPor: me.id,
        });
        setSavedAt(new Date().toLocaleTimeString("pt-BR"));
      }
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {isInativa && (
        <div className="rounded-lg bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
          <span className="text-gray-700 dark:text-gray-300">○ Pessoa inativa</span>
          {pessoa?.motivoInativacao && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              · {pessoa.motivoInativacao}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Nome completo *"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          autoFocus
        />
        <Input
          label="Email (login)"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="pessoa@exemplo.com"
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

      {!isNew && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 flex flex-wrap gap-2">
          {!isInativa ? (
            <Button variant="danger" size="sm" onClick={() => setShowInativar(true)}>
              🚫 Inativar pessoa
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setShowReativar(true)}>
                ✓ Reativar pessoa
              </Button>
              {podeExcluir && (
                <Button variant="danger" size="sm" onClick={() => setShowExcluir(true)}>
                  🗑 Excluir definitivamente
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {isNew && (
        <p className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2">
          📩 Após criar com email, peça pra pessoa acessar e clicar em <strong>"Criar conta"</strong> com a mesma senha.
          O sistema vincula automaticamente.
        </p>
      )}

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
        <div className="text-xs text-emerald-600">
          {savedAt && `✓ Salvo às ${savedAt}`}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>{isNew ? "Cancelar" : "Fechar"}</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar pessoa" : "Salvar"}</Button>
        </div>
      </div>

      {showInativar && pessoa && (
        <InativarModal
          pessoa={pessoa}
          onClose={() => { setShowInativar(false); onClose(); }}
        />
      )}
      {showReativar && pessoa && (
        <ReativarModal
          pessoa={pessoa}
          onClose={() => { setShowReativar(false); onClose(); }}
        />
      )}
      {showExcluir && pessoa && (
        <ExcluirModal
          pessoa={pessoa}
          onClose={() => { setShowExcluir(false); onClose(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 2: VÍNCULOS (empregado em cada restaurante)
// ════════════════════════════════════════════════════════════════

function TabVinculos({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const [empregado, setEmpregado] = useState<Empregado | null>(null);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [showEmpModal, setShowEmpModal] = useState(false);

  // Empregado vinculado a essa pessoa neste restaurante
  useEffect(() => {
    if (!restaurantId || !pessoa.id) return;
    const q = query(
      collection(db, "empregados"),
      where("restaurantId", "==", restaurantId),
      where("pessoaId", "==", pessoa.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      setEmpregado(list[0] || null);
    });
    return () => unsub();
  }, [restaurantId, pessoa.id]);

  // Cargos do restaurante (pra escolha no sub-modal)
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const cargo = empregado ? cargoMap[empregado.cargoId] : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Vínculo de equipe = essa pessoa é empregada em algum restaurante. Aparece na escala, gorjeta, VT.
      </p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
          Restaurante atual
        </div>
        {!empregado ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              {pessoa.nome} <strong>não é empregada</strong> deste restaurante.
            </p>
            <Button onClick={() => setShowEmpModal(true)}>+ Vincular como empregado</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cargo?.nome || "Cargo desconhecido"}
                  {cargo && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-bold">
                      {TIPO_VINCULO_LABEL[cargo.tipoVinculo].split(" ")[0]}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Admissão: {empregado.admissaoAtual || "—"}
                  {empregado.vtAtivo && ` · VT R$ ${empregado.vtValorPassagem ?? 0}/passagem × ${empregado.vtPassagensPorDia ?? 0}`}
                </div>
                {empregado.periodos && empregado.periodos.length > 1 && (
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-1">
                    🔁 Trilha: {empregado.periodos.length} período(s) — readmissão preserva histórico
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowEmpModal(true)}>
                Editar
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        ℹ️ Vínculos em outros restaurantes que essa pessoa acessa virão na próxima iteração da Fase 2.
        Demitir/inativar vínculo vem na Fase 5 (com fluxo completo de data efetiva e log).
      </p>

      {showEmpModal && (
        <EmpregadoModal
          empregado={empregado}
          pessoa={pessoa}
          restaurantId={restaurantId}
          cargos={cargos}
          onClose={() => setShowEmpModal(false)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 3: PERMISSÕES
// ════════════════════════════════════════════════════════════════

function TabPermissoes({ pessoa, restaurantId }: { pessoa: Pessoa; restaurantId: string }) {
  const { restaurants } = useRestaurant();
  const activeRestaurant = restaurants.find(r => r.id === restaurantId);
  // Filtra módulos: só os IDs que existem no registry (ignora resíduos como "equipe" antigo)
  const modulosAtivos = useMemo(
    () => (activeRestaurant?.modulosAtivos || []).filter(id => getModule(id)),
    [activeRestaurant?.modulosAtivos],
  );

  const [perms, setPerms] = useState<Record<string, ModulePermission>>(
    (pessoa.permissions?.[restaurantId] as Record<string, ModulePermission>) || {}
  );
  const [pessoasExcluir, setPessoasExcluir] = useState<boolean>(
    pessoa.specialPermissions?.[restaurantId]?.pessoasExcluir === true
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");

  // Templates do restaurante (pra o seletor "Aplicar template")
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(
      collection(db, "permissionTemplates"),
      where("restaurantId", "==", restaurantId),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PermissionTemplate);
      setTemplates(list.filter(t => t.ativo).sort((a, b) =>
        (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome)
      ));
    });
    return () => unsub();
  }, [restaurantId]);

  function togglePerm(moduleId: string, kind: "ver" | "configurar") {
    setPerms(p => {
      const cur = p[moduleId] || { ver: false, configurar: false };
      const next = { ...cur, [kind]: !cur[kind] };
      if (kind === "configurar" && next.configurar && !next.ver) next.ver = true;
      if (kind === "ver" && !next.ver) next.configurar = false;
      return { ...p, [moduleId]: next };
    });
  }

  function aplicarTemplate(templateId: string) {
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    if (!confirm(`Aplicar template "${t.nome}"? Isso SOBRESCREVE as permissões atuais.`)) return;
    setPerms(t.permissions || {});
    setPessoasExcluir(!!t.specialPermissions?.pessoasExcluir);
  }

  async function salvar() {
    setSaving(true);
    try {
      const limpo: Record<string, ModulePermission> = {};
      Object.entries(perms).forEach(([k, v]) => {
        if (v.ver || v.configurar) limpo[k] = v;
      });
      const newPermissions = { ...(pessoa.permissions || {}), [restaurantId]: limpo };
      const newSpecial = {
        ...(pessoa.specialPermissions || {}),
        [restaurantId]: { pessoasExcluir },
      };
      await setDoc(doc(db, "pessoas", pessoa.id), {
        permissions: newPermissions,
        specialPermissions: newSpecial,
      }, { merge: true });
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } finally {
      setSaving(false);
    }
  }

  if (modulosAtivos.length === 0) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg">
        Nenhum módulo ativo neste restaurante. Ative módulos em Configurações antes de definir permissões.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Marca o que essa pessoa pode neste restaurante. <strong>Configurar</strong> implica <strong>Ver</strong>.
        Sem nenhum check em todos = sem acesso a esse módulo.
      </p>

      {templates.length > 0 && (
        <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">🎯 Aplicar template:</span>
          <select
            onChange={(e) => { if (e.target.value) { aplicarTemplate(e.target.value); e.target.value = ""; } }}
            value=""
            className="text-xs px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900"
          >
            <option value="">— escolher —</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
          <span className="text-[10px] text-indigo-600 dark:text-indigo-400">sobrescreve o que tá marcado</span>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <div className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400">
          <div>Módulo</div>
          <div className="text-center">Ver</div>
          <div className="text-center">Configurar</div>
        </div>
        {modulosAtivos.map(m => {
          const mod = getModule(m as ModuleId);
          if (!mod) return null;
          const p = perms[m] || { ver: false, configurar: false };
          return (
            <div key={m} className="grid grid-cols-[1fr_60px_80px] gap-2 px-3 py-2 items-center border-t border-gray-100 dark:border-gray-800 text-sm">
              <div className="text-gray-800 dark:text-gray-200 flex items-center gap-2">
                <span className="text-base">{mod.icon}</span>
                <span>{mod.label}</span>
              </div>
              <div className="text-center">
                <input type="checkbox" checked={p.ver} onChange={() => togglePerm(m, "ver")} />
              </div>
              <div className="text-center">
                <input type="checkbox" checked={p.configurar} onChange={() => togglePerm(m, "configurar")} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-rose-50/30 dark:bg-rose-900/10">
        <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-2">
          Permissões especiais
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pessoasExcluir}
            onChange={(e) => setPessoasExcluir(e.target.checked)}
          />
          <span>Pode <strong>excluir definitivamente</strong> pessoas</span>
          <span className="text-xs text-gray-500">(perigoso — só pra usuários muito confiáveis)</span>
        </label>
      </div>

      <div className="flex justify-end gap-3 items-center pt-3 border-t border-gray-200 dark:border-gray-800">
        <span className="text-xs text-emerald-600">{savedAt && `✓ Salvo às ${savedAt}`}</span>
        <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar permissões"}</Button>
      </div>
    </div>
  );
}

