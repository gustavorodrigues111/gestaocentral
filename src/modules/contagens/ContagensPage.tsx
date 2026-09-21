import { useEffect, useMemo, useState } from "react";
import { Pencil, BarChart3, Lock, TriangleAlert, Package, Truck } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo } from "../../core/types";
import { LancarContagensTab } from "./LancarContagensTab";
import { InsumosManager } from "./InsumosManager";
import { PageContainer } from "../../core/ui/PageContainer";
import { canConfigurar } from "../../core/auth/permissions";

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

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo);
      list.sort((a, b) => (a.categoria || "ZZ").localeCompare(b.categoria || "ZZ") || (a.nome || "").localeCompare(b.nome || ""));
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
    const unsub = onSnapshot(q, (snap) => setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor)));
    return () => unsub();
  }, [rid]);

  // Última contagem por insumo (mais recente)
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) if (!m[c.insumoId]) m[c.insumoId] = c;   // contagens já vem ordenado desc
    return m;
  }, [contagens]);

  // Sessões de contagem recentes (data · turno · quem · horário · nº itens)
  const sessoes = useMemo(() => {
    const m = new Map<string, { sessaoId: string; data: string; turno?: string; nome?: string; registradoEm: string; itens: number }>();
    for (const c of contagens) {
      if (!c.sessaoId) continue;
      const cur = m.get(c.sessaoId);
      if (cur) { cur.itens++; if (c.registradoEm > cur.registradoEm) cur.registradoEm = c.registradoEm; }
      else m.set(c.sessaoId, { sessaoId: c.sessaoId, data: c.data, turno: c.turno, nome: c.registradoNome, registradoEm: c.registradoEm, itens: 1 });
    }
    return [...m.values()].sort((a, b) => b.registradoEm.localeCompare(a.registradoEm)).slice(0, 8);
  }, [contagens]);

  const alertasMinStock = useMemo(() => insumos.filter(i => {
    if (!i.ativo || !i.minStock) return false;
    const c = ultimaContagem[i.id];
    return (c?.qty ?? 0) < i.minStock;
  }), [insumos, ultimaContagem]);

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const fornecedorMap = Object.fromEntries(fornecedores.map(f => [f.id, f]));

  return (
    <PageContainer>
      {alertasMinStock.length > 0 && tab !== "config" && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
          <span className="inline-flex items-center gap-1"><TriangleAlert size={14} className="shrink-0" /> <strong>{alertasMinStock.length}</strong> insumo(s) abaixo do estoque mínimo. Veja na aba "Visão atual".</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["lancar", "Lançar contagem", Pencil],
          ["visao",  <span className="inline-flex items-center gap-1">Visão atual{alertasMinStock.length > 0 ? <> ({alertasMinStock.length}<TriangleAlert size={11} />)</> : null}</span>, BarChart3],
          ["config", `Insumos (${insumos.filter(i => i.ativo).length})`, Package],
        ] as const).map(([id, label, Ico]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}>
            <Ico size={15} /> {label}
          </button>
        ))}
        {canVer(me, rid, "compras") && (
          <Link to={`/r/${rid}/compras`} className="ml-auto self-center px-3 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
            <Truck size={13} /> Ir para Compras →
          </Link>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-4">
        {tab === "lancar" && "Conte o estoque: percorra os insumos e digite a quantidade que tem hoje."}
        {tab === "visao" && "Resultado da última contagem de cada insumo, com alerta de quem está abaixo do mínimo."}
        {tab === "config" && "Cadastro dos insumos (nome, categoria, unidade, estoque mínimo, fornecedor). É a base pra contar e pra sugestão de compra."}
      </p>

      {/* TAB LANÇAR */}
      {tab === "lancar" && (
        <LancarContagensTab insumos={insumos.filter(i => i.ativo)} ultimaContagem={ultimaContagem} restaurantId={rid} podeConfig={podeConfig} />
      )}

      {/* TAB VISÃO ATUAL */}
      {tab === "visao" && (
        <div className="space-y-2">
          {sessoes.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Sessões de contagem recentes</div>
              <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
                {sessoes.map(s => (
                  <div key={s.sessaoId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{new Date(s.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                      {s.turno && <span className="ml-2 text-[11px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{s.turno}</span>}
                      {s.nome && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">· {s.nome}</span>}
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {new Date(s.registradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      <span className="ml-2 font-semibold text-gray-700 dark:text-gray-300">{s.itens} {s.itens === 1 ? "item" : "itens"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : insumos.filter(i => i.ativo).length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem insumos cadastrados</p>
              {podeConfig && <p className="text-sm text-gray-500 mt-2">Cadastre na aba "Insumos" pra começar.</p>}
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
                      <tr key={i.id} className={`border-b border-gray-100 dark:border-gray-800/50 ${falta > 0 ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</div>
                          <div className="text-[10px] text-gray-500">{i.categoria || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {qtd != null ? (
                            <span className={`font-semibold ${falta > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-900 dark:text-gray-100"}`}>
                              {qtd} {(UNIDADES_LABEL[i.unidade] || i.unidade).slice(0, 3).toLowerCase()}
                            </span>
                          ) : <span className="text-xs text-gray-400 italic">sem contagem</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">{i.minStock || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {falta > 0 ? <span className="text-amber-700 dark:text-amber-400 font-bold">{falta}</span> : <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                          {c ? new Date(c.data + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                          {c?.registradoNome && <div className="text-[10px] text-gray-500">{c.registradoNome}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{forn?.nome || <span className="italic text-gray-400">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB INSUMOS — tela única, igual à de Compras */}
      {tab === "config" && <InsumosManager rid={rid} podeConfig={podeConfig} />}
    </PageContainer>
  );
}
