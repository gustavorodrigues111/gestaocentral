// Página de gestão de Perfis de Acesso. Só master entra aqui.
// Lista perfis (built-in + custom) + editor inline com UI subtrativa.

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { CATALOGO, type CatalogoModulo } from "../../core/auth/actionCatalog";
import { SETORES } from "../../core/wiki/setores";
import { MODULES, AREA_INFO } from "../../config/modules";
import type { ModuleArea, Pessoa } from "../../core/types";
import { BUILTIN_GERENTE_RESTAURANTE } from "../../core/auth/builtinProfiles";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import type { AccessProfile, PermissoesPerfil } from "../../core/types";

export function PerfisAcessoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { perfis, perfisCustomDb, loading, erro, salvar, deletar } = useAccessProfiles();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa)));
    return () => u();
  }, []);

  // Migração: o Gerente de Restaurante deixou de ser built-in. Materializa ele
  // como perfil CUSTOM no Firestore (mesmo id → não quebra vínculos), 1 vez.
  useEffect(() => {
    if (loading || !me?.isMaster) return;
    const gid = BUILTIN_GERENTE_RESTAURANTE.id;
    const existente = perfisCustomDb.find(p => p.id === gid);
    if (!existente) {
      void setDoc(doc(db, "accessProfiles", gid), sanitizeForFirestore({ ...BUILTIN_GERENTE_RESTAURANTE, builtin: false })).catch(() => {});
    } else if (existente.builtin) {
      void updateDoc(doc(db, "accessProfiles", gid), { builtin: false }).catch(() => {});
    }
  }, [loading, perfisCustomDb, me]);

  // Estado: id do perfil em edição, ou "new" pra criar, ou null pra lista.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  // Perfil-semente pra "novo a partir de duplicação" (pré-preenche o editor).
  const [seed, setSeed] = useState<AccessProfile | null>(null);
  const fecharEditor = () => { setEditing(null); setSeed(null); };
  const duplicarPerfil = (p: AccessProfile) => {
    setSeed({ ...p, id: "", nome: `${p.nome} (cópia)`, builtin: false, criadoEm: new Date().toISOString(), permissions: structuredClone(p.permissions) });
    setEditing("new");
  };

  if (!me) return null;
  if (!me.isMaster) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Só master gerencia Perfis de Acesso
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-gray-500 py-8 text-center">Carregando perfis...</div>;
  }
  if (erro) {
    return <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;
  }

  // Modo de edição
  if (editing) {
    const perfilEditando = editing === "new"
      ? (seed || criarPerfilVazio())
      : perfis.find(p => p.id === editing);
    if (!perfilEditando) {
      return (
        <div className="max-w-2xl mx-auto py-8">
          <p className="text-gray-600">Perfil não encontrado.</p>
          <Button onClick={() => setEditing(null)} className="mt-3">Voltar</Button>
        </div>
      );
    }
    return (
      <PerfilEditor
        perfil={perfilEditando}
        isNew={editing === "new"}
        restaurantes={restaurants}
        pessoas={pessoas}
        perfis={perfis}
        onCancelar={fecharEditor}
        onSalvar={async (p) => {
          await salvar(p, me);
          fecharEditor();
        }}
        onDeletar={editing !== "new" && !perfilEditando.builtin
          ? async () => {
              if (!confirm(`Deletar perfil "${perfilEditando.nome}"? Não tem volta.`)) return;
              await deletar(perfilEditando.id);
              fecharEditor();
            }
          : undefined
        }
      />
    );
  }

  // Modo lista
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div />
        <Button onClick={() => setEditing("new")}>+ Novo perfil</Button>
      </div>

      <ListaPerfis
        perfis={perfis}
        restaurantes={restaurants}
        onEditar={(id) => setEditing(id)}
        onDuplicar={duplicarPerfil}
      />
    </div>
  );
}

// ─── LISTA ──────────────────────────────────────────────────────────────

function ListaPerfis({ perfis, restaurantes, onEditar, onDuplicar }: {
  perfis: AccessProfile[];
  restaurantes: { id: string; nome: string }[];
  onEditar: (id: string) => void;
  onDuplicar: (p: AccessProfile) => void;
}) {
  const nomeRestaurante = (rid: string | null) => rid === null ? "Global" : (restaurantes.find(r => r.id === rid)?.nome || rid);
  const ordenados = [...perfis].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return ordenados.length === 0 ? (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
      Nenhum perfil ainda. Clique "+ Novo perfil" pra criar.
    </div>
  ) : (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
      {ordenados.map(p => (
        <CardPerfil
          key={p.id}
          perfil={p}
          tipoLabel={p.builtin ? "base do sistema" : ""}
          escopo={nomeRestaurante(p.restaurantId)}
          onEditar={() => onEditar(p.id)}
          onDuplicar={() => onDuplicar(p)}
        />
      ))}
    </div>
  );
}

function CardPerfil({ perfil, tipoLabel, escopo, onEditar, onDuplicar }: {
  perfil: AccessProfile;
  tipoLabel: string;
  escopo: string;
  onEditar: () => void;
  onDuplicar: () => void;
}) {
  const totalAcoes = Object.values(perfil.permissions).reduce(
    (sum, modulo) => sum + Object.values(modulo).filter(v => v === true).length,
    0
  );
  return (
    <div className="px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{perfil.nome}</div>
        {perfil.descricao && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{perfil.descricao}</div>
        )}
        <div className="text-[11px] text-gray-400 mt-1 flex gap-2 flex-wrap">
          {tipoLabel && <><span className="text-indigo-500/80 dark:text-indigo-400/80">🔒 {tipoLabel}</span><span>·</span></>}
          <span>📍 {escopo}</span>
          <span>·</span>
          <span>{totalAcoes} ações habilitadas</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onDuplicar}
          title="Criar um novo perfil a partir de uma cópia deste"
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Duplicar
        </button>
        <button
          onClick={onEditar}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Editar
        </button>
      </div>
    </div>
  );
}

// ─── VÍNCULOS (quem tem este perfil) ──────────────────────────────────────
// O vínculo pessoa↔perfil é por restaurante (pessoa.profileIds[rid]). Se o
// perfil é exclusivo de um restaurante, o contexto é fixo; se é global, dá pra
// escolher em qual restaurante gerenciar os vínculos.
function VinculosPerfil({ profile, pessoas, perfis, restaurantes }: {
  profile: AccessProfile; pessoas: Pessoa[]; perfis: AccessProfile[]; restaurantes: { id: string; nome: string }[];
}) {
  const [ctxRid, setCtxRid] = useState(profile.restaurantId || restaurantes[0]?.id || "");
  const [addOpen, setAddOpen] = useState(false);
  const perfilNome = (id?: string) => perfis.find(p => p.id === id)?.nome || "";
  const nomeRest = restaurantes.find(r => r.id === ctxRid)?.nome || "";
  const atribuidas = pessoas.filter(p => p.profileIds?.[ctxRid] === profile.id).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  async function setProfile(pessoa: Pessoa, profileId: string | null) {
    const profileIds = { ...(pessoa.profileIds || {}) };
    if (profileId) profileIds[ctxRid] = profileId; else delete profileIds[ctxRid];
    await updateDoc(doc(db, "pessoas", pessoa.id), { profileIds });
  }

  if (!ctxRid) return <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-xs text-gray-400">Sem restaurante pra gerenciar vínculos.</div>;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pessoas com este perfil {atribuidas.length > 0 && <span className="text-gray-400 font-normal normal-case">· {atribuidas.length}</span>}</div>
        <div className="flex items-center gap-2">
          {!profile.restaurantId && restaurantes.length > 1 && (
            <select value={ctxRid} onChange={e => setCtxRid(e.target.value)} title="Restaurante" className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              {restaurantes.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>+ Adicionar</Button>
        </div>
      </div>
      {atribuidas.length === 0 ? (
        <p className="text-xs text-gray-400">Ninguém com este perfil{profile.restaurantId ? "" : ` em ${nomeRest}`} ainda.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {atribuidas.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-sm text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
              <button type="button" onClick={() => { if (confirm(`Remover ${p.nome} deste perfil? Ela fica sem perfil neste restaurante.`)) void setProfile(p, null); }} className="text-[11px] text-gray-400 hover:text-rose-600 shrink-0">remover</button>
            </div>
          ))}
        </div>
      )}
      {addOpen && <AdicionarPessoaModal profile={profile} ctxRid={ctxRid} nomeRest={nomeRest} pessoas={pessoas} perfilNome={perfilNome} onAtribuir={setProfile} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AdicionarPessoaModal({ profile, ctxRid, nomeRest, pessoas, perfilNome, onAtribuir, onClose }: {
  profile: AccessProfile; ctxRid: string; nomeRest: string; pessoas: Pessoa[]; perfilNome: (id?: string) => string;
  onAtribuir: (p: Pessoa, profileId: string) => Promise<void>; onClose: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [confirmar, setConfirmar] = useState<Pessoa | null>(null);
  const candidatos = pessoas
    .filter(p => (p.restaurantIds || []).includes(ctxRid))
    .filter(p => p.profileIds?.[ctxRid] !== profile.id)
    .filter(p => { const q = busca.trim().toLowerCase(); return !q || p.nome.toLowerCase().includes(q); })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 80);

  async function escolher(p: Pessoa) {
    const atual = p.profileIds?.[ctxRid];
    if (atual) { setConfirmar(p); return; }   // já tem perfil → confirma a troca
    await onAtribuir(p, profile.id); onClose();
  }

  return (
    <Modal title={`Adicionar ao perfil "${profile.nome}"`} onClose={onClose} maxWidth="max-w-md">
      {confirmar ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-sm text-amber-900 dark:text-amber-200">
            <b>{confirmar.nome}</b> já tem o perfil <b>{perfilNome(confirmar.profileIds?.[ctxRid]) || "—"}</b>{nomeRest ? ` em ${nomeRest}` : ""}.<br />
            Trocar para <b>{profile.nome}</b>?
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmar(null)}>Voltar</Button>
            <Button onClick={async () => { await onAtribuir(confirmar, profile.id); onClose(); }}>Trocar perfil</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar pessoa…" className="w-full px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <p className="text-[11px] text-gray-400">Pessoas com acesso a {nomeRest || "este restaurante"}. Já vinculadas a este perfil não aparecem.</p>
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800">
            {candidatos.length === 0 ? <div className="px-3 py-4 text-sm text-gray-400 text-center">Ninguém encontrado.</div>
              : candidatos.map(p => {
                const atual = perfilNome(p.profileIds?.[ctxRid]);
                return (
                  <button key={p.id} type="button" onClick={() => void escolher(p)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{p.nome}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{atual ? `atual: ${atual}` : "sem perfil"}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── EDITOR ──────────────────────────────────────────────────────────────

function PerfilEditor({ perfil, isNew, restaurantes, pessoas, perfis, onSalvar, onCancelar, onDeletar }: {
  perfil: AccessProfile;
  isNew: boolean;
  restaurantes: { id: string; nome: string }[];
  pessoas: Pessoa[];
  perfis: AccessProfile[];
  onSalvar: (p: AccessProfile) => Promise<void>;
  onCancelar: () => void;
  onDeletar?: () => Promise<void>;
}) {
  const [form, setForm] = useState<AccessProfile>(perfil);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const isBuiltin = perfil.builtin === true;

  function setAcao(moduleId: string, actionId: string, valor: boolean) {
    setForm(prev => {
      const next: PermissoesPerfil = { ...prev.permissions };
      next[moduleId] = { ...(next[moduleId] || {}), [actionId]: valor };
      return { ...prev, permissions: next };
    });
  }

  function setTodasModulo(moduleId: string, valor: boolean) {
    setForm(prev => {
      const mod = CATALOGO.find(m => m.id === moduleId);
      if (!mod) return prev;
      const next: PermissoesPerfil = { ...prev.permissions };
      next[moduleId] = Object.fromEntries(mod.acoes.map(a => [a.id, valor]));
      return { ...prev, permissions: next };
    });
  }

  function setTodas(valor: boolean) {
    const next: PermissoesPerfil = {};
    for (const mod of CATALOGO) {
      next[mod.id] = Object.fromEntries(mod.acoes.map(a => [a.id, valor]));
    }
    setForm(prev => ({ ...prev, permissions: next }));
  }

  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) {
      setErro("Nome obrigatório.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const id = isNew
        ? "perf_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        : form.id;
      await onSalvar({ ...form, id, nome });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  // Conta totais pra header
  const totalAtivas = Object.values(form.permissions).reduce(
    (sum, m) => sum + Object.values(m).filter(v => v === true).length,
    0,
  );
  const totalAcoes = CATALOGO.reduce((s, m) => s + m.acoes.length, 0);

  // Agrupa módulos por área
  // Ordena/agrupa os módulos EXATAMENTE como o menu lateral: por área do
  // registro de módulos (config/modules) e, dentro de cada área, na ordem do
  // próprio registro. Módulos que só existem no catálogo de permissões (sem
  // item de menu — ex: Portal do Empregado, Perfis de Acesso) caem num grupo
  // final "Outros / Sistema".
  const menuOrder = useMemo(() => {
    const m: Record<string, { area: ModuleArea; idx: number }> = {};
    MODULES.forEach((mod, i) => { m[mod.id] = { area: mod.area, idx: i }; });
    return m;
  }, []);

  const porArea = useMemo(() => {
    const grupos: Record<string, CatalogoModulo[]> = {};
    for (const mod of CATALOGO) {
      const area = menuOrder[mod.id]?.area || "outros";
      (grupos[area] ||= []).push(mod);
    }
    for (const a of Object.keys(grupos)) {
      grupos[a].sort((x, y) => (menuOrder[x.id]?.idx ?? 9999) - (menuOrder[y.id]?.idx ?? 9999));
    }
    return grupos;
  }, [menuOrder]);

  // Ordem das áreas igual ao menu, com bucket final pros só-do-catálogo.
  const AREA_ORDER: (ModuleArea | "outros")[] = ["ops", "dp", "fin", "planejamento", "inst", "master", "outros"];
  const AREA_LABEL: Record<string, { label: string; color: string }> = {
    ...AREA_INFO,
    outros: { label: "Outros / Sistema", color: "#6b7280" },
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-20">
      {/* Header sticky com nome + ações */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-950 -mx-4 px-4 py-3 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={onCancelar} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            ← Voltar
          </button>
          <div className="flex items-center gap-2">
            {onDeletar && (
              <button
                onClick={onDeletar}
                className="text-xs px-3 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                🗑 Apagar perfil
              </button>
            )}
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar perfil"}
            </Button>
          </div>
        </div>
        {erro && <p className="text-xs text-rose-600 mt-2">⚠ {erro}</p>}
      </div>

      {/* Nome + descrição + escopo */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-3">
        <Input
          label="Nome do perfil"
          value={form.nome}
          onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))}
          placeholder="Ex: Recepcionista, Gerente de Salão"
          disabled={isBuiltin}
        />
        {isBuiltin && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Perfil built-in — nome não editável. Permissões podem ser ajustadas.
          </p>
        )}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Descrição (opcional)
          </label>
          <textarea
            value={form.descricao || ""}
            onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))}
            placeholder="Pra que serve esse perfil? Quem usa?"
            className="mt-1 w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={2}
          />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Escopo
          </label>
          <select
            value={form.restaurantId === null ? "_global" : form.restaurantId}
            onChange={(e) => {
              const v = e.target.value;
              setForm(f => ({ ...f, restaurantId: v === "_global" ? null : v }));
            }}
            className="mt-1 w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="_global">🌐 Global — disponível em qualquer restaurante</option>
            {restaurantes.map(r => (
              <option key={r.id} value={r.id}>📍 Exclusivo: {r.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {!isNew && <VinculosPerfil profile={perfil} pessoas={pessoas} perfis={perfis} restaurantes={restaurantes} />}

      {/* Bulk actions */}
      <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
        <div className="text-gray-500 dark:text-gray-400 font-medium">
          <strong className="text-gray-700 dark:text-gray-200">{totalAtivas}</strong> de {totalAcoes} ações habilitadas
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTodas(true)} className="text-emerald-600 hover:underline">
            Marcar TUDO
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={() => setTodas(false)} className="text-rose-600 hover:underline">
            Desmarcar TUDO
          </button>
        </div>
      </div>

      {/* Áreas + módulos — mesma ordem do menu lateral */}
      {AREA_ORDER.map((area) => {
        const mods = porArea[area];
        if (!mods || mods.length === 0) return null;
        const info = AREA_LABEL[area];
        return (
        <div key={area} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: info.color }}>
            {info.label}
          </h2>
          <div className="space-y-2">
            {mods.map(mod => (
              <ModuloEditor
                key={mod.id}
                modulo={mod}
                permissoes={form.permissions[mod.id] || {}}
                onToggle={(actionId, valor) => setAcao(mod.id, actionId, valor)}
                onTodas={(valor) => setTodasModulo(mod.id, valor)}
              />
            ))}
          </div>
        </div>
        );
      })}

      {/* Correlação com os SETORES da Wiki de Processos: quem tem este perfil
          É responsável pelas etapas marcadas com esses setores (vira "minhas
          etapas"). Vale pra qualquer perfil, inclusive de empregado. */}
      <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-900/10 p-3 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">🔗 Setores da Wiki que este perfil representa</div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Quem tiver este perfil vira responsável, na Wiki, pelas etapas marcadas com o(s) setor(es) abaixo (aparece o nome dele e entra em “minhas etapas”). Deixe vazio se este perfil não responde por nenhuma etapa.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SETORES.map(s => {
            const on = (form.wikiSetores || []).includes(s.id);
            return (
              <button key={s.id} type="button"
                onClick={() => setForm(f => { const cur = f.wikiSetores || []; return { ...f, wikiSetores: on ? cur.filter(x => x !== s.id) : [...cur, s.id] }; })}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${on ? `${s.cls} border-transparent` : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"}`}>
                {on ? "✓ " : ""}{s.icon} {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Escopo por categoria da Wiki de Processos — só quando o perfil tem
          alguma permissão de wikiProcessos habilitada. */}
      {form.permissions.wikiProcessos && Object.values(form.permissions.wikiProcessos).some(v => v === true) && (
        <WikiCategoriasEditor
          restauranteId={form.restaurantId}
          selecionadas={form.wikiCategorias || []}
          onChange={cats => setForm(f => ({ ...f, wikiCategorias: cats }))}
        />
      )}
    </div>
  );
}

// Escopo por categoria da Wiki: vazio = todas. Oferece as áreas já existentes
// (do restaurante do perfil, ou de todos se global) como checkboxes + campo livre.
function WikiCategoriasEditor({ restauranteId, selecionadas, onChange }: {
  restauranteId: string | null;
  selecionadas: string[];
  onChange: (cats: string[]) => void;
}) {
  const [areas, setAreas] = useState<string[]>([]);
  const [nova, setNova] = useState("");
  useEffect(() => {
    const u = onSnapshot(collection(db, "wikiProcessos"), snap => {
      const set = new Set<string>();
      snap.docs.forEach(d => {
        const p = d.data() as { area?: string; restaurantIds?: string[]; deletadoEm?: string | null };
        if (p.deletadoEm) return;
        if (restauranteId && !(p.restaurantIds || []).includes(restauranteId)) return;
        if (p.area && p.area.trim()) set.add(p.area.trim());
      });
      setAreas([...set].sort());
    });
    return () => u();
  }, [restauranteId]);

  const todas = [...new Set([...areas, ...selecionadas])].sort();
  const toggle = (a: string) => onChange(selecionadas.includes(a) ? selecionadas.filter(x => x !== a) : [...selecionadas, a]);
  const addNova = () => { const v = nova.trim(); if (v && !selecionadas.includes(v)) onChange([...selecionadas, v]); setNova(""); };

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-2">
      <div className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">📚 Wiki — categorias visíveis</div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Deixe <b>vazio</b> pra este perfil acessar <b>todas</b> as categorias. Marque categorias específicas pra limitar o que ele vê e onde pode cadastrar.
      </p>
      {todas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {todas.map(a => (
            <button key={a} type="button" onClick={() => toggle(a)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${selecionadas.includes(a) ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"}`}>
              {selecionadas.includes(a) ? "✓ " : ""}{a}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input value={nova} onChange={e => setNova(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNova(); } }}
          placeholder="Adicionar categoria manualmente…" className="flex-1 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-900" />
        <button type="button" onClick={addNova} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-white dark:hover:bg-gray-800">+ Add</button>
      </div>
      <div className="text-[11px] text-gray-400">{selecionadas.length === 0 ? "Todas as categorias (sem restrição)." : `${selecionadas.length} categoria(s) selecionada(s).`}</div>
    </div>
  );
}

function ModuloEditor({ modulo, permissoes, onToggle, onTodas }: {
  modulo: CatalogoModulo;
  permissoes: { [actionId: string]: boolean };
  onToggle: (actionId: string, valor: boolean) => void;
  onTodas: (valor: boolean) => void;
}) {
  const ativas = modulo.acoes.filter(a => permissoes[a.id] === true).length;
  const total = modulo.acoes.length;
  // Começa FECHADO — usuário expande o módulo que quer editar (igual ao menu).
  const [aberto, setAberto] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{modulo.icon}</span>
          <div className="min-w-0">
            <div className="font-medium text-sm">{modulo.label}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{modulo.desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-mono tabular-nums ${ativas === total ? "text-emerald-600" : ativas === 0 ? "text-gray-400" : "text-indigo-600"}`}>
            {ativas}/{total}
          </span>
          <span className="text-gray-400">{aberto ? "▾" : "▸"}</span>
        </div>
      </button>
      {aberto && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-end gap-2 text-[11px]">
            <button onClick={() => onTodas(true)} className="text-emerald-600 hover:underline">Tudo</button>
            <span className="text-gray-300">·</span>
            <button onClick={() => onTodas(false)} className="text-rose-600 hover:underline">Nada</button>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {modulo.acoes.map(acao => {
              const ativa = permissoes[acao.id] === true;
              return (
                <label
                  key={acao.id}
                  className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 select-none"
                >
                  <input
                    type="checkbox"
                    checked={ativa}
                    onChange={(e) => onToggle(acao.id, e.target.checked)}
                    className="mt-0.5 accent-emerald-600 shrink-0"
                  />
                  <div className="flex-1 min-w-0 text-sm">
                    {acao.label}
                    {acao.sensivel && (
                      <span
                        className="ml-1.5 text-amber-600 dark:text-amber-400"
                        title="Ação sensível — envolve LGPD, dados pessoais, financeiro ou atos terminais"
                      >🔒</span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

function criarPerfilVazio(): AccessProfile {
  // Default: TUDO desligado. Master começa do zero, marca o que quer.
  const permissions: PermissoesPerfil = {};
  for (const mod of CATALOGO) {
    permissions[mod.id] = Object.fromEntries(mod.acoes.map(a => [a.id, false]));
  }
  return {
    id: "",
    nome: "",
    descricao: "",
    builtin: false,
    restaurantId: null,
    permissions,
    criadoEm: new Date().toISOString(),
  };
}
