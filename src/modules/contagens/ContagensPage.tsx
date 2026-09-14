import { useEffect, useMemo, useState } from "react";
import { Pencil, BarChart3, Settings, Lock, TriangleAlert, Package, Phone, Plus, Sparkles, Truck } from "lucide-react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo, RecebimentoNota } from "../../core/types";
import { InsumoModal } from "./InsumoModal";
import { LancarContagensTab } from "./LancarContagensTab";
import { agruparSugestoes, normalizar, type SugestaoInsumo } from "./sugestoesRecebimento";
import { PageContainer } from "../../core/ui/PageContainer";

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
  const [preset, setPreset] = useState<Partial<Insumo> | null>(null);
  const [searchConfig, setSearchConfig] = useState("");
  const [recebimentos, setRecebimentos] = useState<RecebimentoNota[]>([]);
  const [soRecorrentes, setSoRecorrentes] = useState(true);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);

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

  // Notas de recebimento — só quem configura (pra sugerir insumos). Leitura
  // pontual só quando pode configurar, pra não pesar em quem só lança contagem.
  useEffect(() => {
    if (!rid || !podeConfig) { setRecebimentos([]); return; }
    const q = query(collection(db, "recebimentos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setRecebimentos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RecebimentoNota).filter(n => !n.excluidoEm));
    }, () => setRecebimentos([]));
    return () => unsub();
  }, [rid, podeConfig]);

  // Sugestões agrupadas do recebimento (não cadastradas + filtro de recorrência).
  const sugestoes = useMemo(() => agruparSugestoes(recebimentos, insumos, fornecedores), [recebimentos, insumos, fornecedores]);
  const sugestoesNovas = useMemo(() => sugestoes.filter(s => !s.jaCadastrado && (!soRecorrentes || s.ocorrencias >= 2)), [sugestoes, soRecorrentes]);

  // Casa um fornecedor pelo nome (normalizado) ou cria um novo; devolve o id.
  async function garantirFornecedor(nome: string): Promise<string | undefined> {
    const alvo = normalizar(nome);
    if (!alvo) return undefined;
    const existente = fornecedores.find(f => normalizar(f.nome) === alvo);
    if (existente) return existente.id;
    if (!me) return undefined;
    const ref = await addDoc(collection(db, "fornecedores"), sanitizeForFirestore({
      restaurantId: rid, nome: nome.trim(), ativo: true, criadoEm: new Date().toISOString(), criadoPor: me.id,
    }));
    return ref.id;
  }

  // Abre o InsumoModal já preenchido a partir de uma sugestão do recebimento.
  async function cadastrarDaSugestao(s: SugestaoInsumo) {
    const forId = s.fornecedores[0]?.nome ? await garantirFornecedor(s.fornecedores[0].nome) : undefined;
    setPreset({
      nome: s.nome,
      unidade: s.unidade,
      unidadeOutroLabel: s.unidadeOutroLabel,
      precoEstimado: s.precoEstimado,
      fornecedorPreferredId: forId || null,
    });
    setEditing("new");
  }

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
          ["config", `Config (${insumos.filter(i => i.ativo).length})`, Settings],
        ] as const).map(([id, label, Ico]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            <Ico size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Explicação curta da aba ativa — desfaz a confusão entre elas. */}
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-4">
        {tab === "lancar" && "Conte o estoque: percorra os insumos e digite a quantidade que tem hoje."}
        {tab === "visao" && "Resultado da última contagem de cada insumo, com alerta de quem está abaixo do mínimo."}
        {tab === "config" && "Cadastro dos insumos (nome, categoria, unidade, estoque mínimo, fornecedor). É a base pra contar."}
      </p>

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
              <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
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

          {/* Novo insumo — agora é o 1º item da lista (saiu do topo da página). */}
          {podeConfig && (
            <button
              type="button"
              onClick={() => { setPreset(null); setEditing("new"); }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 py-2.5 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Plus size={16} /> Novo insumo
            </button>
          )}

          {/* Sugeridos do recebimento — produtos das notas ainda não cadastrados. */}
          {podeConfig && sugestoesNovas.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 overflow-hidden">
              <button type="button" onClick={() => setSugestoesAbertas(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                <Sparkles size={15} className="text-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">Sugeridos do recebimento ({sugestoesNovas.length})</span>
                <span className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400">{sugestoesAbertas ? "ocultar" : "ver"}</span>
              </button>
              {sugestoesAbertas && (
                <div className="px-3 pb-3 space-y-2">
                  <label className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300 cursor-pointer">
                    <input type="checkbox" checked={soRecorrentes} onChange={e => setSoRecorrentes(e.target.checked)} /> só recorrentes (2+ notas)
                  </label>
                  {sugestoesNovas.map(s => (
                    <div key={s.chave} className="rounded-lg border border-amber-200/70 dark:border-amber-900/40 bg-white dark:bg-gray-900 p-2.5 flex items-center gap-2 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{s.nome}</div>
                        <div className="text-[11px] text-gray-500 flex gap-2 flex-wrap mt-0.5">
                          <span className="uppercase">{s.unidade === "outro" ? (s.unidadeOutroLabel || "outro") : UNIDADES_LABEL[s.unidade]}</span>
                          <span>{s.ocorrencias} nota(s)</span>
                          {s.precoEstimado != null && <span>R$ {s.precoEstimado.toFixed(2)}/un</span>}
                          {s.fornecedores[0] && <span className="inline-flex items-center gap-1"><Truck size={11} /> {s.fornecedores[0].nome}{s.fornecedores.length > 1 ? ` +${s.fornecedores.length - 1}` : ""}</span>}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => void cadastrarDaSugestao(s)}><span className="inline-flex items-center gap-1"><Plus size={13} /> Cadastrar</span></Button>
                    </div>
                  ))}
                  <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60">Categoria e estoque mínimo não vêm da nota — você completa ao cadastrar. Fornecedor primário = o mais frequente nas notas.</p>
                </div>
              )}
            </div>
          )}

          {insumos.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum insumo cadastrado</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Use o botão <strong>+ Novo insumo</strong> acima{sugestoesNovas.length > 0 ? " — ou puxe dos sugeridos do recebimento" : ""}.</p>
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
                                {forn && <span className="inline-flex items-center gap-1"><Phone size={12} /> {forn.nome}</span>}
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
          preset={editing === "new" ? preset : null}
          fornecedores={fornecedores.filter(f => f.ativo)}
          restaurantId={rid}
          onClose={() => { setEditing(null); setPreset(null); }}
        />
      )}
    </PageContainer>
  );
}
