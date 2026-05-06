import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar } from "../../core/auth/permissions";
import { getModule } from "../../config/modules";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { ModuleId, ModulePermission, PermissionTemplate } from "../../core/types";

type Props = { restaurantId: string };

export function TemplatesTab({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PermissionTemplate | "new" | null>(null);
  const podeConfig = canConfigurar(me, restaurantId, "pessoas");

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    const q = query(
      collection(db, "permissionTemplates"),
      where("restaurantId", "==", restaurantId),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PermissionTemplate);
      setTemplates(list.sort((a, b) =>
        (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome)
      ));
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {templates.length} template(s)
        </p>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo template</Button>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Templates são conjuntos pré-definidos de permissões que você aplica em 1 clique
        ao editar uma pessoa. Ex: "Líder de Salão", "DP Operacional", "Contador".
        Após aplicar, as permissões ficam editáveis individualmente — o template é só atalho.
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : templates.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum template cadastrado</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Crie o primeiro pra agilizar a atribuição de permissões.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {templates.map((t, i) => (
            <TemplateRow
              key={t.id}
              template={t}
              isFirst={i === 0}
              podeConfig={podeConfig}
              onEdit={() => setEditing(t)}
            />
          ))}
        </div>
      )}

      {editing && (
        <TemplateModal
          template={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template, isFirst, podeConfig, onEdit,
}: {
  template: PermissionTemplate;
  isFirst: boolean;
  podeConfig: boolean;
  onEdit: () => void;
}) {
  const numModulos = Object.keys(template.permissions || {}).length;
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${isFirst ? "" : "border-t border-gray-100 dark:border-gray-800"} ${!template.ativo ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 dark:text-gray-100">{template.nome}</span>
          {!template.ativo && <span className="text-xs text-gray-400">(inativo)</span>}
        </div>
        {template.descricao && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.descricao}</p>
        )}
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          {numModulos} módulo(s) · {template.specialPermissions?.pessoasExcluir && "+ excluir pessoas"}
        </div>
      </div>
      {podeConfig && (
        <Button variant="secondary" size="sm" onClick={onEdit}>Editar</Button>
      )}
    </div>
  );
}

// ─── MODAL DE EDIÇÃO ────────────────────────────────────────────────────────

function TemplateModal({
  template, restaurantId, onClose,
}: {
  template: PermissionTemplate | null;
  restaurantId: string;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const activeRestaurant = restaurants.find(r => r.id === restaurantId);
  const modulosAtivos = useMemo(
    () => (activeRestaurant?.modulosAtivos || []).filter(id => getModule(id)),
    [activeRestaurant?.modulosAtivos],
  );

  const isNew = !template;
  const [nome, setNome] = useState(template?.nome || "");
  const [descricao, setDescricao] = useState(template?.descricao || "");
  const [ativo, setAtivo] = useState(template?.ativo ?? true);
  const [perms, setPerms] = useState<Record<string, ModulePermission>>(
    (template?.permissions as Record<string, ModulePermission>) || {}
  );
  const [pessoasExcluir, setPessoasExcluir] = useState<boolean>(
    template?.specialPermissions?.pessoasExcluir === true
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function togglePerm(moduleId: string, kind: "ver" | "configurar") {
    setPerms(p => {
      const cur = p[moduleId] || { ver: false, configurar: false };
      const next = { ...cur, [kind]: !cur[kind] };
      if (kind === "configurar" && next.configurar && !next.ver) next.ver = true;
      if (kind === "ver" && !next.ver) next.configurar = false;
      return { ...p, [moduleId]: next };
    });
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const limpo: Record<string, ModulePermission> = {};
      Object.entries(perms).forEach(([k, v]) => {
        if (v.ver || v.configurar) limpo[k] = v;
      });

      const data = {
        restaurantId,
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        permissions: limpo,
        specialPermissions: pessoasExcluir ? { pessoasExcluir: true } : {},
        ativo,
      };
      if (isNew) {
        await addDoc(collection(db, "permissionTemplates"), {
          ...data,
          ordem: 999,
          createdAt: new Date().toISOString(),
          createdBy: me.id,
        });
      } else {
        await updateDoc(doc(db, "permissionTemplates", template.id), data);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!template) return;
    if (!confirm(`Excluir o template "${template.nome}"? (pessoas que receberam esse template via "aplicar" mantêm as permissões — só some o template em si)`)) return;
    await deleteDoc(doc(db, "permissionTemplates", template.id));
    onClose();
  }

  if (modulosAtivos.length === 0) {
    return (
      <Modal title="Templates" onClose={onClose} maxWidth="max-w-md">
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg">
          Nenhum módulo ativo neste restaurante. Ative módulos em Configurações primeiro.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={isNew ? "+ Novo template" : `Editar — ${template.nome}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-3">
        <Input
          label="Nome do template *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Líder de Salão, DP Operacional"
          autoFocus
        />
        <Input
          label="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="quando usar este template"
        />

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
          </label>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span className="font-medium">Ativo</span>
            <span className="text-xs text-gray-500">(templates inativos não aparecem no seletor "Aplicar")</span>
          </label>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <div>
            {!isNew && (
              <Button variant="danger" size="sm" onClick={excluir}>Excluir template</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
