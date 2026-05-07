import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd } from "../../core/utils/date";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo } from "../../core/types";
import { InsumoModal } from "./InsumoModal";
import { LancarContagensTab } from "./LancarContagensTab";

type Tab = "lancar" | "visao" | "config";

export function ContagensPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "contagens");
  const podeConfig = canConfigurar(me, rid, "contagens");

  const [tab, setTab] = useState<Tab>("lancar");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Insumo | "new" | null>(null);
  const [searchConfig, setSearchConfig] = useState("");

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo);
      list.sort((a, b) =>
        (a.categoria || "ZZ").localeCompare(b.categoria || "ZZ") ||
        a.nome.localeCompare(b.nome)
      );
      setInsumos(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "contagens"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contagem);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.registradoEm || "").localeCompare(a.registradoEm || ""));
      setContagens(list);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fornecedores"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor));
    });
    return () => unsub();
  }, [rid]);

  // Última contagem por insumo (mais recente)
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) {
      if (!m[c.insumoId]) m[c.insumoId] = c;  // contagens já vem ordenado desc
    }
    return m;
  }, [contagens]);

  // Insumos com alerta de estoque mínimo
  const alertasMinStock = useMemo(() => {
    return insumos.filter(i => {
      if (!i.ativo || !i.minStock) return false;
      const c = ultimaContagem[i.id];
      const qtd = c?.qty ?? 0;
      return qtd < i.minStock;
    });
  }, [insumos, ultimaContagem]);

  const insumosFiltradosConfig = useMemo(() => {
    if (!searchConfig.trim()) return insumos;
    const s = searchConfig.toLowerCase();
    return insumos.filter(i =>
      i.nome.toLowerCase().includes(s) ||
      (i.categoria || "").toLowerCase().includes(s)
    );
  }, [insumos, searchConfig]);

  // Agrupado por categoria
  const insumosConfigPorCat = useMemo(() => {
    const m: Record<string, Insumo[]> = {};
    for (const i of insumosFiltradosConfig) {
      const c = i.categoria || "(sem categoria)";
      if (!m[c]) m[c] = [];
      m[c].push(i);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [insumosFiltradosConfig]);

  async function excluirInsumo(i: Insumo) {
    if (!confirm(`Excluir "${i.nome}"? Contagens passadas preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "insumos", i.id));
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const fornecedorMap = Object.fromEntries(fornecedores.map(f => [f.id, f]));

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">📦 Contagens</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{restaurant.nome}</p>
        </div>
        {podeConfig && tab === "config" && (
          <Button onClick={() => setEditing("new")}>+ Novo insumo</Button>
        )}
      </div>

      {alertasMinStock.length > 0 && tab !== "config" && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
          ⚠ <strong>{alertasMinStock.length}</strong> insumo(s) abaixo do estoque mínimo. Veja na aba "Visão atual".
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["lancar", "✏️ Lançar contagem"],
          ["visao",  `📊 Visão atual${alertasMinStock.length > 0 ? ` (${alertasMinStock.length}⚠)` : ""}`],
          ["config", `⚙️ Config (${insumos.filter(i => i.ativo).length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB LANÇAR */}
      {tab === "lancar" && (
        <LancarContagensTab
          insumos={insumos.filter(i => i.ativo)}
          ultimaContagem={ultimaContagem}
          restaurantId={rid}
          podeConfig={podeConfig}
        />
      )}

      {/* TAB VISÃO ATUAL */}
      {tab === "visao" && (
        <div className="space-y-2">
          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : insumos.filter(i => i.ativo).length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem insumos cadastrados</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Cadastre na aba "Config" pra começar.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Insumo</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Qtd atual</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Mín</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Falta</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Última</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {insumos.filter(i => i.ativo).map(i => {
                    const c = ultimaContagem[i.id];
                    const qtd = c?.qty;
                    const min = i.minStock || 0;
                    const falta = min > 0 && (qtd ?? 0) < min ? min - (qtd ?? 0) : 0;
                    const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
                    return (
                      <tr key={i.id} className={`border-b border-gray-100 dark:border-gray-800/50 ${
                        falta > 0 ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
                      }`}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</div>
                          <div className="text-[10px] text-gray-500">{i.categoria || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {qtd != null ? (
                            <span className={`font-semibold ${falta > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-900 dark:text-gray-100"}`}>
                              {qtd} {UNIDADES_LABEL[i.unidade].slice(0, 3).toLowerCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">sem contagem</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">
                          {i.minStock || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {falta > 0 ? (
                            <span className="text-amber-700 dark:text-amber-400 font-bold">{falta}</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                          {c ? new Date(c.data + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                          {c?.registradoNome && <div className="text-[10px] text-gray-500">{c.registradoNome}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                          {forn?.nome || <span className="italic text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB CONFIG */}
      {tab === "config" && (
        <div className="space-y-3">
          <Input
            placeholder="🔍 Buscar por nome ou categoria..."
            value={searchConfig}
            onChange={(e) => setSearchConfig(e.target.value)}
          />

          {insumos.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum insumo cadastrado</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Cadastre clicando em "+ Novo insumo"</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {insumosConfigPorCat.map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {cat} <span className="text-gray-400 font-normal">({list.length})</span>
                  </h3>
                  <div className="space-y-1">
                    {list.map(i => {
                      const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
                      return (
                        <div
                          key={i.id}
                          className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 ${!i.ativo ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</h4>
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                  {i.unidade === "outro" ? (i.unidadeOutroLabel || "outro") : UNIDADES_LABEL[i.unidade]}
                                </span>
                                {!i.ativo && <span className="text-[10px] uppercase text-gray-500">Inativo</span>}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 flex gap-3 flex-wrap">
                                {i.minStock != null && <span>Mín: <strong>{i.minStock}</strong></span>}
                                {i.fatorCompra && i.fatorCompra > 1 && <span>Fator compra: <strong>{i.fatorCompra}</strong></span>}
                                {i.precoEstimado != null && <span>R$ {i.precoEstimado.toFixed(2)}/un</span>}
                                {forn && <span>📞 {forn.nome}</span>}
                              </div>
                            </div>
                            {podeConfig && (
                              <div className="flex gap-1">
                                <Button variant="secondary" size="sm" onClick={() => setEditing(i)}>Editar</Button>
                                <Button variant="danger" size="sm" onClick={() => excluirInsumo(i)}>×</Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <InsumoModal
          insumo={editing === "new" ? null : editing}
          fornecedores={fornecedores.filter(f => f.ativo)}
          restaurantId={rid}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );

  // unused, just to silence ts warning if user removes today
  void todayYmd;
}
