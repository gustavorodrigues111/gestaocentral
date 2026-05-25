// Página de gestão de Perfis de Acesso. Só master entra aqui.
// Lista perfis (built-in + custom) + editor inline com UI subtrativa.

import { useMemo, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { CATALOGO, AREA_INFO, type CatalogoModulo } from "../../core/auth/actionCatalog";
import { isBuiltinProfileId } from "../../core/auth/builtinProfiles";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { AccessProfile, PermissoesPerfil } from "../../core/types";

export function PerfisAcessoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { perfis, perfisCustomDb, loading, erro, salvar, deletar } = useAccessProfiles();

  // Estado: id do perfil em edição, ou "new" pra criar, ou null pra lista.
  const [editing, setEditing] = useState<string | "new" | null>(null);

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
      ? criarPerfilVazio()
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
        onCancelar={() => setEditing(null)}
        onSalvar={async (p) => {
          await salvar(p, me);
          setEditing(null);
        }}
        onDeletar={editing !== "new" && !isBuiltinProfileId(perfilEditando.id)
          ? async () => {
              if (!confirm(`Deletar perfil "${perfilEditando.nome}"? Não tem volta.`)) return;
              await deletar(perfilEditando.id);
              setEditing(null);
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
        <div>
          <h1 className="text-xl font-bold">🛡️ Perfis de Acesso</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Defina o que cada perfil pode fazer. Atribua perfis às pessoas em Pessoas.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>+ Novo perfil</Button>
      </div>

      <ListaPerfis
        perfis={perfis}
        perfisCustomDb={perfisCustomDb}
        restaurantes={restaurants}
        onEditar={(id) => setEditing(id)}
      />
    </div>
  );
}

// ─── LISTA ──────────────────────────────────────────────────────────────

function ListaPerfis({ perfis, perfisCustomDb, restaurantes, onEditar }: {
  perfis: AccessProfile[];
  perfisCustomDb: AccessProfile[];
  restaurantes: { id: string; nome: string }[];
  onEditar: (id: string) => void;
}) {
  const builtins = perfis.filter(p => p.builtin);
  const customs = perfis.filter(p => !p.builtin);
  const overrideIds = new Set(perfisCustomDb.map(p => p.id).filter(id => isBuiltinProfileId(id)));

  function nomeRestaurante(rid: string | null) {
    if (rid === null) return "Global";
    return restaurantes.find(r => r.id === rid)?.nome || rid;
  }

  return (
    <div className="space-y-4">
      <Section titulo="Built-in (vem com o sistema)" cor="indigo">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {builtins.map(p => (
            <CardPerfil
              key={p.id}
              perfil={p}
              tipoLabel={overrideIds.has(p.id) ? "Built-in (modificado)" : "Built-in"}
              escopo={nomeRestaurante(p.restaurantId)}
              onEditar={() => onEditar(p.id)}
            />
          ))}
        </div>
      </Section>

      <Section titulo="Custom (criados por você)" cor="emerald">
        {customs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 px-3 py-4 text-center">
            Nenhum perfil custom ainda. Clique "+ Novo perfil" pra criar.
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {customs.map(p => (
              <CardPerfil
                key={p.id}
                perfil={p}
                tipoLabel="Custom"
                escopo={nomeRestaurante(p.restaurantId)}
                onEditar={() => onEditar(p.id)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ titulo, cor, children }: {
  titulo: string;
  cor: "indigo" | "emerald";
  children: React.ReactNode;
}) {
  const corClasse = cor === "indigo"
    ? "text-indigo-600 dark:text-indigo-400"
    : "text-emerald-600 dark:text-emerald-400";
  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className={`px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-xs font-bold uppercase tracking-wider ${corClasse}`}>
        {titulo}
      </div>
      {children}
    </section>
  );
}

function CardPerfil({ perfil, tipoLabel, escopo, onEditar }: {
  perfil: AccessProfile;
  tipoLabel: string;
  escopo: string;
  onEditar: () => void;
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
          <span>{tipoLabel}</span>
          <span>·</span>
          <span>📍 {escopo}</span>
          <span>·</span>
          <span>{totalAcoes} ações habilitadas</span>
        </div>
      </div>
      <button
        onClick={onEditar}
        className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0"
      >
        Editar
      </button>
    </div>
  );
}

// ─── EDITOR ──────────────────────────────────────────────────────────────

function PerfilEditor({ perfil, isNew, restaurantes, onSalvar, onCancelar, onDeletar }: {
  perfil: AccessProfile;
  isNew: boolean;
  restaurantes: { id: string; nome: string }[];
  onSalvar: (p: AccessProfile) => Promise<void>;
  onCancelar: () => void;
  onDeletar?: () => Promise<void>;
}) {
  const [form, setForm] = useState<AccessProfile>(perfil);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const isBuiltin = isBuiltinProfileId(perfil.id);

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
  const porArea = useMemo(() => {
    const grupos: Record<string, CatalogoModulo[]> = {};
    for (const mod of CATALOGO) {
      if (!grupos[mod.area]) grupos[mod.area] = [];
      grupos[mod.area].push(mod);
    }
    return grupos;
  }, []);

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

      {/* Áreas + módulos */}
      {Object.entries(porArea).map(([area, mods]) => (
        <div key={area} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {AREA_INFO[area as keyof typeof AREA_INFO].icon} {AREA_INFO[area as keyof typeof AREA_INFO].label}
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
      ))}
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
  const [aberto, setAberto] = useState(true);

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
