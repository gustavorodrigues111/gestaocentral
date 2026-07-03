// Módulo Fichas Técnicas — modelo: FICHA (produto final) × SUBFICHA (preparo
// reutilizável), ambas com CATEGORIA (criadas pelo usuário). Composição por
// mistura livre (insumos + subfichas) com aninhamento. Custo em tempo real.
// Escopo por empresa.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, deleteDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Select } from "../../core/ui/Select";
import { Modal } from "../../core/ui/Modal";
import type { FtCategoria, FtDimensao, FtFicha, FtHistoricoCusto, FtIngrediente, FtInsumo, FtInsumoVariacao, FtSubproduto, FtVinculoRecebimento, RecebimentoNota } from "../../core/types";
import { agruparProdutos, coletarPrecos, custoNaBase, fatorAutomatico, impactoNoCmv, precosPorFornecedor, reconciliar, type LinhaReconc } from "./recebimentoPrecos";
import { DIMENSAO_LABEL, dimensaoDeUnidade, labelUnidade, paraBase, unidadesDaDimensao, unidadesRendimento, UNIDADES } from "./unidades";
import { calcularCusto } from "./custo";
import { normalizarNome, sugerirInsumos } from "./dedup";
import { fmtBR } from "../../core/utils/date";
import { ImportarFichasModal } from "./ImportarFichasModal";

// ─── utils ──────────────────────────────────────────────────────────────
function maskMoeda(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  return (parseInt(d, 10) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseMoeda(m: string): number { const d = (m || "").replace(/\D/g, ""); return d ? parseInt(d, 10) / 100 : 0; }
function fmtMoeda(n: number): string { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
// Nomes de insumos/fichas 100% MAIÚSCULOS (padrão do módulo).
const UP = (s: string) => (s || "").trim().toUpperCase();
function passoDe(v: number): number { return v >= 1000 ? 100 : v >= 100 ? 10 : v >= 10 ? 5 : 1; }
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

type Tab = "fichas" | "insumos" | "categorias";
type FiltroTipo = "todas" | "finais" | "subfichas" | "pendentes" | "revisar";
// Ficha "pendente" = sem ingredientes (ex.: promovida no import, falta montar).
const fichaPendente = (f: FtFicha) => (f.ingredientes || []).length === 0;

export function FichasPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const { can } = useCanAcao(rid || "");
  const [tab, setTab] = useState<Tab>("fichas");
  const [insumos, setInsumos] = useState<FtInsumo[]>([]);
  const [fichas, setFichas] = useState<FtFicha[]>([]);
  const [categorias, setCategorias] = useState<FtCategoria[]>([]);
  const [recebimentos, setRecebimentos] = useState<RecebimentoNota[]>([]);
  const [vinculos, setVinculos] = useState<FtVinculoRecebimento[]>([]);
  const [editando, setEditando] = useState<FtFicha | null>(null);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "ftInsumos"), where("restaurantId", "==", rid)),
      s => setInsumos(s.docs.map(d => ({ id: d.id, ...d.data() } as FtInsumo))));
    const u2 = onSnapshot(query(collection(db, "ftFichas"), where("restaurantId", "==", rid)),
      s => setFichas(s.docs.map(d => normFicha({ id: d.id, ...d.data() } as FtFicha))));
    const u3 = onSnapshot(query(collection(db, "ftCategorias"), where("restaurantId", "==", rid)),
      s => setCategorias(s.docs.map(d => ({ id: d.id, ...d.data() } as FtCategoria))));
    const u4 = onSnapshot(query(collection(db, "recebimentos"), where("restaurantId", "==", rid)),
      s => setRecebimentos(s.docs.map(d => ({ id: d.id, ...d.data() } as RecebimentoNota))));
    const u5 = onSnapshot(query(collection(db, "ftVinculosRecebimento"), where("restaurantId", "==", rid)),
      s => setVinculos(s.docs.map(d => ({ id: d.id, ...d.data() } as FtVinculoRecebimento))));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [rid]);

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione uma empresa.</div>;
  if (!can("fichas", "ver")) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Fichas Técnicas.</div>;
  const podeEditar = can("fichas", "editarFicha");
  const podeInsumo = can("fichas", "insumos");

  if (editando) {
    return (
      <FichaEditor
        rid={rid} fichaInicial={editando} insumos={insumos} fichas={fichas} categorias={categorias}
        meId={pessoa?.id} podeInsumo={podeInsumo}
        onClose={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">📋 Fichas Técnicas</h1>
          <p className="text-xs text-gray-500">{activeRestaurant?.nome} · produção e custo em tempo real</p>
        </div>
        {tab === "fichas" && podeEditar && (
          <div className="flex gap-2 w-full sm:w-auto flex-wrap">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setImportando(true)}>✨ Importar receita</Button>
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setEditando(novaFicha(rid, true, pessoa?.id, pessoa?.nome))}>+ Subficha</Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setEditando(novaFicha(rid, false, pessoa?.id, pessoa?.nome))}>+ Nova ficha</Button>
          </div>
        )}
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        <TabBtn ativo={tab === "fichas"} onClick={() => setTab("fichas")}>Fichas ({fichas.filter(f => f.ativo !== false).length})</TabBtn>
        {podeInsumo && <TabBtn ativo={tab === "insumos"} onClick={() => setTab("insumos")}>Insumos ({insumos.filter(i => i.ativo !== false).length})</TabBtn>}
        {podeEditar && <TabBtn ativo={tab === "categorias"} onClick={() => setTab("categorias")}>Categorias ({categorias.filter(c => c.ativo !== false).length})</TabBtn>}
      </nav>

      {tab === "fichas" && <ListaFichas fichas={fichas} insumos={insumos} categorias={categorias} onEditar={setEditando} podeEditar={podeEditar} />}
      {tab === "insumos" && podeInsumo && <CadastroInsumos rid={rid} insumos={insumos} fichas={fichas} recebimentos={recebimentos} vinculos={vinculos} meId={pessoa?.id} />}
      {tab === "categorias" && podeEditar && <CadastroCategorias rid={rid} categorias={categorias} />}

      {importando && (
        <ImportarFichasModal rid={rid} insumos={insumos} categorias={categorias} meId={pessoa?.id} meNome={pessoa?.nome} onClose={() => setImportando(false)} />
      )}
    </div>
  );
}

// Normaliza/MIGRA docs do schema antigo (ingredientes dentro de `subfichas`,
// `rendimentoFinal`, `tipo`) pro modelo novo (ingredientes plano + ehSubficha).
function normFicha(f: FtFicha): FtFicha {
  const raw = f as unknown as Record<string, unknown>;
  const rendimentoFinal = raw.rendimentoFinal as { qtd?: number; unidade?: string } | undefined;
  const rendimento = f.rendimento && typeof f.rendimento.qtd === "number"
    ? f.rendimento
    : (rendimentoFinal && typeof rendimentoFinal.qtd === "number" ? (rendimentoFinal as { qtd: number; unidade: string }) : { qtd: 1, unidade: "porção" });

  let ingredientes: FtIngrediente[] = Array.isArray(f.ingredientes) ? f.ingredientes : [];
  if (ingredientes.length === 0 && Array.isArray(raw.subfichas)) {
    // Achata os ingredientes que estavam dentro das subfichas (etapas) antigas.
    ingredientes = (raw.subfichas as Array<{ ingredientes?: FtIngrediente[] }>).flatMap(sf =>
      (sf.ingredientes || []).map(ing => ({ ...ing, tipo: ing.tipo === "insumo" ? "insumo" : "ficha" })) as FtIngrediente[]);
  }
  const ehSubficha = f.ehSubficha != null ? !!f.ehSubficha : raw.tipo === "subproduto";

  const out = { ...f, ehSubficha, categoriaId: f.categoriaId ?? null, rendimento, ingredientes } as Record<string, unknown>;
  delete out.subfichas; delete out.rendimentoFinal; delete out.tipo;
  return out as unknown as FtFicha;
}

function novaFicha(rid: string, ehSubficha: boolean, meId?: string, meNome?: string): FtFicha {
  return {
    id: uid("fic"), restaurantId: rid, nome: "", nomeNormalizado: "", ehSubficha, categoriaId: null,
    rendimento: { qtd: 1, unidade: ehSubficha ? "kg" : "porção" },
    ingredientes: [], ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome,
  };
}

// ─── Lista de fichas ──────────────────────────────────────────────────────
function ListaFichas({ fichas, insumos, categorias, onEditar, podeEditar }: {
  fichas: FtFicha[]; insumos: FtInsumo[]; categorias: FtCategoria[]; onEditar: (f: FtFicha) => void; podeEditar: boolean;
}) {
  const [filtro, setFiltro] = useState<FiltroTipo>("todas");
  const [catFiltro, setCatFiltro] = useState<string>("");
  const catNome = (id?: string | null) => categorias.find(c => c.id === id)?.nome;
  const nPendentes = useMemo(() => fichas.filter(f => f.ativo !== false && fichaPendente(f)).length, [fichas]);
  const nRevisar = useMemo(() => fichas.filter(f => f.ativo !== false && f.revisar).length, [fichas]);
  const lista = useMemo(() => fichas
    .filter(f => f.ativo !== false)
    .filter(f => filtro === "todas" ? true : filtro === "pendentes" ? fichaPendente(f) : filtro === "revisar" ? !!f.revisar : filtro === "finais" ? !f.ehSubficha : f.ehSubficha)
    .filter(f => !catFiltro || f.categoriaId === catFiltro)
    .sort((a, b) => a.nome.localeCompare(b.nome)), [fichas, filtro, catFiltro]);

  if (fichas.filter(f => f.ativo !== false).length === 0) return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
      Nenhuma ficha ainda. Crie uma ficha, uma subficha, ou importe uma receita.
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {(["todas", "finais", "subfichas", "pendentes", "revisar"] as FiltroTipo[]).map(t => (
            <button key={t} type="button" onClick={() => setFiltro(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filtro === t ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"} ${t === "pendentes" && nPendentes > 0 && filtro !== t ? "text-amber-700 dark:text-amber-400" : ""} ${t === "revisar" && nRevisar > 0 && filtro !== t ? "text-rose-600 dark:text-rose-400" : ""}`}>
              {t === "todas" ? "Todas" : t === "finais" ? "Fichas finais" : t === "subfichas" ? "Subfichas" : t === "pendentes" ? `⏳ Pendentes${nPendentes > 0 ? ` (${nPendentes})` : ""}` : `⚑ Revisar${nRevisar > 0 ? ` (${nRevisar})` : ""}`}
            </button>
          ))}
        </div>
        {categorias.filter(c => c.ativo !== false).length > 0 && (
          <select value={catFiltro} onChange={e => setCatFiltro(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
            <option value="">Todas categorias</option>
            {categorias.filter(c => c.ativo !== false).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        )}
      </div>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nada nesse filtro.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {lista.map(f => {
            const c = calcularCusto(f, insumos, fichas);
            return (
              <button key={f.id} type="button" onClick={() => podeEditar && onEditar(f)}
                className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{f.nome || "(sem nome)"}</div>
                    <div className="text-xs text-gray-500">{catNome(f.categoriaId) ? `${catNome(f.categoriaId)} · ` : ""}rende {f.rendimento.qtd} {labelUnidade(f.rendimento.unidade)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {f.ehSubficha && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">subficha</span>}
                    {fichaPendente(f) && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Sem ingredientes — monte a receita">⏳ pendente</span>}
                    {f.revisar && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title={f.revisarMotivo || "Precisa de revisão"}>⚑ revisar</span>}
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="text-[11px] text-gray-500">Custo por {labelUnidade(f.rendimento.unidade)}</div>
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmtMoeda(c.porRendimento)}</div>
                  </div>
                  {c.insumosSemCusto.length > 0 && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{c.insumosSemCusto.length} sem custo</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Editor de ficha/subficha ──────────────────────────────────────────────
function FichaEditor({ rid, fichaInicial, insumos, fichas, categorias, meId, podeInsumo, onClose }: {
  rid: string; fichaInicial: FtFicha; insumos: FtInsumo[]; fichas: FtFicha[]; categorias: FtCategoria[];
  meId?: string; podeInsumo: boolean; onClose: () => void;
}) {
  const [f, setF] = useState<FtFicha>(fichaInicial);
  const [salvando, setSalvando] = useState(false);
  const custo = useMemo(() => calcularCusto(f, insumos, fichas), [f, insumos, fichas]);
  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);
  // Subfichas disponíveis como ingrediente (reutilizáveis, exceto a própria).
  const subfichasDisp = useMemo(() => fichas.filter(x => x.ehSubficha && x.ativo !== false && x.id !== f.id), [fichas, f.id]);
  // Subprodutos de OUTRAS fichas, disponíveis como ingrediente.
  const subprodutosDisp = useMemo(() => fichas.filter(x => x.ativo !== false && x.id !== f.id).flatMap(x => (x.subprodutos || []).map(sp => ({ ficha: x, sp }))), [fichas, f.id]);
  const catsAtivas = categorias.filter(c => c.ativo !== false);
  const somaPctSub = (f.subprodutos || []).reduce((s, sp) => s + (sp.percentualCusto || 0), 0);

  function addIngrediente(ing: FtIngrediente) { setF(p => ({ ...p, ingredientes: [...p.ingredientes, ing] })); }
  function patchIng(id: string, patch: Partial<FtIngrediente>) { setF(p => ({ ...p, ingredientes: p.ingredientes.map(i => i.id === id ? { ...i, ...patch } : i) })); }
  function removeIng(id: string) { setF(p => ({ ...p, ingredientes: p.ingredientes.filter(i => i.id !== id) })); }
  function addSubproduto() { setF(p => ({ ...p, subprodutos: [...(p.subprodutos || []), { id: uid("sp"), nome: "", nomeNormalizado: "", unidade: p.rendimento.unidade, rendimentoQtd: 1, percentualCusto: 0 }] })); }
  function patchSub(id: string, patch: Partial<FtSubproduto>) { setF(p => ({ ...p, subprodutos: (p.subprodutos || []).map(sp => sp.id === id ? { ...sp, ...patch } : sp) })); }
  function removeSub(id: string) { setF(p => ({ ...p, subprodutos: (p.subprodutos || []).filter(sp => sp.id !== id) })); }

  async function salvar() {
    if (!f.nome.trim()) { alert("Dê um nome pra receita."); return; }
    if (somaPctSub > 100) { alert("A soma dos % dos subprodutos passou de 100%."); return; }
    setSalvando(true);
    try {
      const subprodutos = (f.subprodutos || []).filter(sp => sp.nome.trim()).map(sp => ({ ...sp, nome: UP(sp.nome), nomeNormalizado: normalizarNome(sp.nome) }));
      await setDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore({ ...f, nome: UP(f.nome), nomeNormalizado: normalizarNome(f.nome), subprodutos }));
      onClose();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  async function excluir() {
    if (!confirm(`Excluir "${f.nome}"?`)) return;
    await updateDoc(doc(db, "ftFichas", f.id), { ativo: false });
    onClose();
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Voltar</button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={excluir}>🗑️ Excluir</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="space-y-4">
          {/* Cabeçalho */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-3">
            <Input label="Nome" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder={f.ehSubficha ? "ex: Molho de tomate" : "ex: Torta de limão"} />
            <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Rendimento</span>
                <QtyStepper qtd={f.rendimento.qtd} unidade={f.rendimento.unidade} unidades={unidadesRendimento().map(u => u.unidade)} unidadeTravada={false}
                  onQtd={n => setF({ ...f, rendimento: { ...f.rendimento, qtd: n } })}
                  onUnidade={u => setF({ ...f, rendimento: { ...f.rendimento, unidade: u } })} />
              </div>
              <Select label="Categoria" value={f.categoriaId || ""} onChange={e => setF({ ...f, categoriaId: e.target.value || null })}>
                <option value="">— sem categoria —</option>
                {catsAtivas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 pb-2 whitespace-nowrap">
                <input type="checkbox" checked={f.ehSubficha} onChange={e => setF({ ...f, ehSubficha: e.target.checked })} className="w-4 h-4 accent-indigo-600" />
                É subficha (reutilizável)
              </label>
            </div>
            {f.ehSubficha && <div className="text-[11px] text-purple-600 dark:text-purple-400">Subficha: pode ser usada como ingrediente de outras fichas.</div>}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={!!f.revisar} onChange={e => setF({ ...f, revisar: e.target.checked })} className="w-4 h-4 accent-rose-600" />
                <span className={f.revisar ? "text-rose-600 dark:text-rose-400 font-medium" : ""}>⚑ Precisa de revisão</span>
              </label>
              {f.revisar && <input value={f.revisarMotivo || ""} onChange={e => setF({ ...f, revisarMotivo: e.target.value })} placeholder="Por quê? (ex: rendimento errado, falta ingrediente…)" className="mt-1.5 w-full text-sm px-2 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-gray-900 dark:text-gray-100" />}
            </div>
          </div>

          {/* Ingredientes */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Ingredientes</div>
            {f.ingredientes.length > 0 && (
              <div className="space-y-1">
                {f.ingredientes.map(ing => (
                  <IngredienteRow key={ing.id} ing={ing} insumoById={insumoById} subfichas={subfichasDisp} subprodutos={subprodutosDisp}
                    onPatch={p => patchIng(ing.id, p)} onRemove={() => removeIng(ing.id)} />
                ))}
              </div>
            )}
            <IngredientePicker insumos={insumos} subfichas={subfichasDisp} subprodutos={subprodutosDisp} rid={rid} meId={meId} podeInsumo={podeInsumo} onAdd={addIngrediente} />
          </div>

          {/* Subprodutos (coprodutos) */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Subprodutos</div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${somaPctSub > 100 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>Principal fica com {Math.max(0, 100 - somaPctSub)}%</span>
            </div>
            <p className="text-[11px] text-gray-400">Coprodutos que este preparo também rende (ex.: carcaça, caldo do cozimento). Cada um leva um % do custo total; o resto fica no produto principal. Depois entram como ingrediente em outras fichas.</p>
            {(f.subprodutos || []).map(sp => {
              const r = custo.subprodutos.find(x => x.id === sp.id);
              const vinc = insumos.find(i => i.subprodutoDe && i.subprodutoDe.fichaId === f.id && i.subprodutoDe.subId === sp.id && i.ativo !== false);
              const pendentes = insumos.filter(i => i.ehSubproduto && !i.subprodutoDe && i.ativo !== false);
              return (
                <div key={sp.id} className="py-1 border-t border-gray-100 dark:border-gray-800 first:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input value={sp.nome} onChange={e => patchSub(sp.id, { nome: e.target.value.toUpperCase() })} placeholder="ex: CARCAÇA" className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                    <div className="flex items-center gap-1"><span className="text-[11px] text-gray-400">rende</span>
                      <input type="number" value={sp.rendimentoQtd} onChange={e => patchSub(sp.id, { rendimentoQtd: Number(e.target.value) || 0 })} className="w-14 px-1.5 py-1.5 text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                      <select value={sp.unidade} onChange={e => patchSub(sp.id, { unidade: e.target.value })} className="px-1.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100">{unidadesRendimento().map(u => <option key={u.unidade} value={u.unidade}>{labelUnidade(u.unidade)}</option>)}</select>
                    </div>
                    <div className="flex items-center gap-1"><input type="number" value={sp.percentualCusto} onChange={e => patchSub(sp.id, { percentualCusto: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="w-14 px-1.5 py-1.5 text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" /><span className="text-[11px] text-gray-400">% custo</span></div>
                    <span className="text-[11px] text-gray-500 w-20 text-right tabular-nums">{r ? fmtMoeda(r.custo) : "—"}</span>
                    <button type="button" onClick={() => removeSub(sp.id)} title="remover" className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
                  </div>
                  <div className="pl-1 mt-1 text-[11px]">
                    {vinc
                      ? <span className="text-orange-600 dark:text-orange-400">🔗 vinculado ao insumo “{vinc.nome}” <button type="button" onClick={() => updateDoc(doc(db, "ftInsumos", vinc.id), { subprodutoDe: null })} className="text-gray-400 hover:text-red-600 underline ml-1">desvincular</button></span>
                      : pendentes.length > 0
                        ? <span className="text-gray-500">Vincular insumo-subproduto pendente: <select value="" onChange={e => { if (e.target.value) updateDoc(doc(db, "ftInsumos", e.target.value), { subprodutoDe: { fichaId: f.id, subId: sp.id } }); }} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"><option value="">escolher…</option>{pendentes.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}</select> <span className="text-gray-400">(salve a ficha depois)</span></span>
                        : null}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addSubproduto} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ adicionar subproduto</button>
          </div>

          {/* Modo de preparo */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Modo de preparo</label>
            <textarea value={f.modoPreparo || ""} onChange={e => setF({ ...f, modoPreparo: e.target.value })} rows={4}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm" placeholder="opcional" />
          </div>
        </div>

        {/* Painel de custo */}
        <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 p-4 lg:sticky lg:top-4">
          <div className="text-[11px] text-gray-500">{custo.subprodutos.length > 0 ? "Custo do produto principal" : "Custo total"}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmtMoeda(custo.total)}</div>
          <div className="text-xs text-gray-500 mb-3">{fmtMoeda(custo.porRendimento)} por {labelUnidade(f.rendimento.unidade)}</div>
          {custo.subprodutos.length > 0 && (
            <div className="text-[11px] text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-2 mb-3 space-y-0.5">
              <div className="flex justify-between"><span>Custo do preparo</span><span className="tabular-nums">{fmtMoeda(custo.bruto)}</span></div>
              {custo.subprodutos.map(sp => (
                <div key={sp.id} className="flex justify-between text-gray-400"><span className="truncate">↳ {sp.nome || "subproduto"} ({sp.percentual}%)</span><span className="tabular-nums shrink-0">{fmtMoeda(sp.custo)}</span></div>
              ))}
            </div>
          )}
          {custo.insumosSemCusto.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
              ⚠ Sem custo: {custo.insumosSemCusto.slice(0, 6).join(", ")}{custo.insumosSemCusto.length > 6 ? "…" : ""}. Cadastre na aba Insumos.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stepper pílula ─────────────────────────────────────────────────────────
function QtyStepper({ qtd, unidade, unidades, unidadeTravada, onQtd, onUnidade }: {
  qtd: number; unidade: string; unidades: string[]; unidadeTravada: boolean;
  onQtd: (n: number) => void; onUnidade: (u: string) => void;
}) {
  return (
    <div className="inline-flex items-center h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_2px_8px_-3px_rgba(99,102,241,0.4)] dark:shadow-[0_2px_10px_-3px_rgba(99,102,241,0.55)] shrink-0 px-1">
      <button type="button" onClick={() => onQtd(Math.max(0, round2(qtd - passoDe(qtd))))} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-lg leading-none" aria-label="diminuir">−</button>
      <input type="number" value={qtd} onChange={e => onQtd(Number(e.target.value) || 0)} className="w-10 text-center bg-transparent text-sm outline-none dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      {unidadeTravada
        ? <span className="text-xs text-gray-400 min-w-[24px] text-center">{labelUnidade(unidade)}</span>
        : <select value={unidade} onChange={e => onUnidade(e.target.value)} className="bg-transparent text-xs font-medium text-gray-500 dark:text-gray-400 outline-none appearance-none text-center cursor-pointer pr-0.5">
            {unidades.map(u => <option key={u} value={u}>{labelUnidade(u)}</option>)}
          </select>}
      <button type="button" onClick={() => onQtd(round2(qtd + passoDe(qtd)))} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-lg leading-none" aria-label="aumentar">+</button>
    </div>
  );
}

// Stepper compacto (pílula −/+), sem as setinhas nativas do browser.
function MiniStepper({ value, onChange, sufixo }: { value: string; onChange: (v: string) => void; sufixo: string }) {
  const num = Number(value) || 0;
  const passo = num >= 10 ? 1 : num >= 1 ? 0.5 : 0.1;
  const set = (n: number) => onChange(String(Math.max(0, Math.round(n * 1000) / 1000)));
  return (
    <div className="inline-flex items-center h-8 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm px-1 shrink-0">
      <button type="button" onClick={() => set(num - passo)} className="w-6 h-6 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-base leading-none" aria-label="diminuir">−</button>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} className="w-12 text-center bg-transparent text-xs outline-none dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[10px] text-gray-400 pr-1">{sufixo}</span>
      <button type="button" onClick={() => set(num + passo)} className="w-6 h-6 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-base leading-none" aria-label="aumentar">+</button>
    </div>
  );
}

const CHIP_TIPO: Record<string, string> = {
  insumo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  subficha: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  subproduto: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

function IngredienteRow({ ing, insumoById, subfichas, subprodutos, onPatch, onRemove }: {
  ing: FtIngrediente; insumoById: Map<string, FtInsumo>; subfichas: FtFicha[]; subprodutos: { ficha: FtFicha; sp: FtSubproduto }[];
  onPatch: (p: Partial<FtIngrediente>) => void; onRemove: () => void;
}) {
  let nome = ing.nomeSnapshot || "?";
  let unidadesOpc: string[] = [ing.unidade];
  let travada = true;
  const ehSub = ing.tipo === "ficha";
  const ehSubprod = ing.tipo === "subproduto";
  let subprodPai = "";
  if (ing.tipo === "insumo") {
    const ins = insumoById.get(ing.refId);
    nome = ins?.nome || ing.nomeSnapshot || "(insumo removido)";
    if (ins) { unidadesOpc = unidadesDaDimensao(ins.dimensao).map(u => u.unidade); travada = unidadesOpc.length <= 1; }
  } else if (ehSubprod) {
    const hit = subprodutos.find(x => x.ficha.id === ing.refId && x.sp.id === ing.subId);
    nome = hit?.sp.nome || ing.nomeSnapshot || "(subproduto)";
    subprodPai = hit?.ficha.nome || "";
    unidadesOpc = [hit?.sp.unidade || ing.unidade];
  } else {
    const sf = subfichas.find(s => s.id === ing.refId);
    nome = sf?.nome || ing.nomeSnapshot || "(subficha)";
    unidadesOpc = [sf?.rendimento.unidade || ing.unidade];
  }
  return (
    <div className="flex items-center gap-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 px-1 -mx-1">
      <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_TIPO[ehSubprod ? "subproduto" : ehSub ? "subficha" : "insumo"]}`} aria-hidden="true"></span>
      <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">
        {nome}
        {ing.variacaoNome && <span className="ml-1.5 text-[11px] text-indigo-600 dark:text-indigo-400">↳ {ing.variacaoNome}{ing.fc && ing.fc !== 100 ? ` (${ing.fc}%)` : ""}</span>}
        {ehSub && <span className="ml-1.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">subficha</span>}
        {ehSubprod && <span className="ml-1.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" title={subprodPai ? `de ${subprodPai}` : ""}>subproduto</span>}
      </span>
      {ing.qb
        ? <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0">quanto baste</span>
        : <QtyStepper qtd={ing.qtd} unidade={ing.unidade} unidades={unidadesOpc} unidadeTravada={travada} onQtd={n => onPatch({ qtd: n })} onUnidade={u => onPatch({ unidade: u })} />}
      <button type="button" onClick={() => onPatch({ qb: !ing.qb })} title="quanto baste (não pesa custo)" className={`text-[10px] font-bold px-2 py-1.5 rounded-lg shrink-0 transition-colors ${ing.qb ? "bg-amber-500 text-white" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>q.b.</button>
      <button type="button" onClick={onRemove} title="remover" className="text-gray-400 hover:text-red-600 text-sm shrink-0 px-1">✕</button>
    </div>
  );
}

function IngredientePicker({ insumos, subfichas, subprodutos, rid, meId, podeInsumo, onAdd }: {
  insumos: FtInsumo[]; subfichas: FtFicha[]; subprodutos: { ficha: FtFicha; sp: FtSubproduto }[]; rid: string; meId?: string; podeInsumo: boolean; onAdd: (ing: FtIngrediente) => void;
}) {
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const n = normalizarNome(busca);
  const sugInsumos = useMemo(() => sugerirInsumos(busca, insumos), [busca, insumos]);
  const sugSubfichas = useMemo(() => subfichas.filter(s => n && normalizarNome(s.nome).includes(n)), [subfichas, n]);
  const sugSubprodutos = useMemo(() => subprodutos.filter(({ sp }) => n && normalizarNome(sp.nome).includes(n)), [subprodutos, n]);

  function pickInsumo(ins: FtInsumo, variacao?: FtInsumoVariacao) {
    onAdd({
      id: uid("ing"), tipo: "insumo", refId: ins.id, nomeSnapshot: ins.nome,
      qtd: 1, unidade: unidadesDaDimensao(ins.dimensao)[0]?.unidade || ins.unidadeBase,
      ...(variacao ? { variacaoNome: variacao.nome, fc: variacao.fc } : {}),
    });
    setBusca("");
  }
  function pickSubficha(sf: FtFicha) {
    onAdd({ id: uid("ing"), tipo: "ficha", refId: sf.id, nomeSnapshot: sf.nome, qtd: 1, unidade: sf.rendimento.unidade });
    setBusca("");
  }
  function pickSubproduto(ficha: FtFicha, sp: FtSubproduto) {
    onAdd({ id: uid("ing"), tipo: "subproduto", refId: ficha.id, subId: sp.id, nomeSnapshot: sp.nome, qtd: 1, unidade: sp.unidade });
    setBusca("");
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !busca.trim()) return;
    e.preventDefault();
    if (sugInsumos[0]) pickInsumo(sugInsumos[0].insumo);
    else if (sugSubfichas[0]) pickSubficha(sugSubfichas[0]);
    else if (sugSubprodutos[0]) pickSubproduto(sugSubprodutos[0].ficha, sugSubprodutos[0].sp);
    else if (podeInsumo) setCriando(true);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900">
        <span className="text-gray-400 text-sm">🔎</span>
        <input value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={onKeyDown} placeholder="+ adicionar ingrediente — insumo, subficha ou subproduto" className="w-full py-2 bg-transparent text-sm outline-none dark:text-gray-100" />
        {busca && <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">Enter pra adicionar</span>}
      </div>
      {!busca && <div className="mt-1 text-[11px] text-gray-400">Digite e escolha na lista. Insumo novo → "criar insumo".</div>}
      {busca && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {sugInsumos.map(({ insumo, motivo }) => (
            <div key={insumo.id}>
              <button type="button" onClick={() => pickInsumo(insumo)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                <span className="text-sm flex-1 truncate">{insumo.nome} <span className="text-[11px] text-gray-400">· {DIMENSAO_LABEL[insumo.dimensao]}{(insumo.variacoes?.length ?? 0) > 0 ? " · inteiro" : ""}</span></span>
                {motivo === "parecido" && <span className="text-[10px] text-amber-600">parecido</span>}
                {(!insumo.custo || insumo.custo <= 0) && <span className="text-[10px] text-amber-600">sem custo</span>}
              </button>
              {(insumo.variacoes || []).map(v => (
                <button key={v.id} type="button" onClick={() => pickInsumo(insumo, v)} className="w-full text-left flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                  <span className="text-indigo-500 text-xs shrink-0">↳</span>
                  <span className="text-sm flex-1 truncate text-indigo-700 dark:text-indigo-300">{v.nome} <span className="text-[10px] text-indigo-400">· {v.fc}% aprov.</span></span>
                </button>
              ))}
            </div>
          ))}
          {sugSubfichas.map(sf => (
            <button key={sf.id} type="button" onClick={() => pickSubficha(sf)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0"></span>
              <span className="text-sm flex-1 truncate">{sf.nome}</span><span className="text-[10px] uppercase text-purple-500">subficha</span>
            </button>
          ))}
          {sugSubprodutos.map(({ ficha, sp }) => (
            <button key={ficha.id + sp.id} type="button" onClick={() => pickSubproduto(ficha, sp)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0"></span>
              <span className="text-sm flex-1 truncate">{sp.nome} <span className="text-[11px] text-gray-400">· de {ficha.nome}</span></span><span className="text-[10px] uppercase text-orange-500">subproduto</span>
            </button>
          ))}
          {podeInsumo && (
            <button type="button" onClick={() => setCriando(true)} className="w-full text-left flex items-center gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-indigo-600 dark:text-indigo-400">
              <span className="text-sm">+ Criar insumo "{busca.trim()}"</span>
            </button>
          )}
        </div>
      )}
      {criando && (
        <CriarInsumoModal rid={rid} nomeInicial={busca.trim()} insumos={insumos} meId={meId}
          onCriado={(ins) => { setCriando(false); setBusca(""); pickInsumo(ins); }} onClose={() => setCriando(false)} />
      )}
    </div>
  );
}

function CriarInsumoModal({ rid, nomeInicial, insumos, meId, onCriado, onClose }: {
  rid: string; nomeInicial: string; insumos: FtInsumo[]; meId?: string; onCriado: (ins: FtInsumo) => void; onClose: () => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [unidadeBase, setUnidadeBase] = useState("kg");
  const [custo, setCusto] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const similares = useMemo(() => sugerirInsumos(nome, insumos), [nome, insumos]);
  async function salvar() {
    if (!nome.trim()) return;
    const dim = dimensaoDeUnidade(unidadeBase) as FtDimensao;
    const id = uid("ins"); const now = new Date().toISOString(); const c = parseMoeda(custo);
    const ins: FtInsumo = {
      id, restaurantId: rid, nome: UP(nome), nomeNormalizado: normalizarNome(nome), dimensao: dim, unidadeBase, custo: c,
      custoAtualizadoEm: c > 0 ? now : null, historicoCusto: c > 0 ? [{ custo: c, data: now, por: meId || null }] : [],
      fornecedorPadrao: fornecedor.trim() || null, reutilizavel: false, aliases: [], ativo: true,
    };
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore(ins));
    onCriado(ins);
  }
  return (
    <Modal title="Novo insumo" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Sal refinado" />
        {similares.length > 0 && <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-200">Já existe parecido: {similares.slice(0, 3).map(s => s.insumo.nome).join(", ")}. Confira pra não duplicar.</div>}
        <div className="grid grid-cols-2 gap-2">
          <Select label="Unidade base" value={unidadeBase} onChange={e => setUnidadeBase(e.target.value)}>
            {UNIDADES.filter(u => ["kg", "g", "L", "ml", "un"].includes(u.unidade)).map(u => <option key={u.unidade} value={u.unidade}>{u.label} ({DIMENSAO_LABEL[u.dimensao]})</option>)}
          </Select>
          <CampoMoeda label={`Custo por ${unidadeBase}`} value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} />
        </div>
        <Input label="Fornecedor (opcional)" value={fornecedor} onChange={e => setFornecedor(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Criar e usar</Button></div>
      </div>
    </Modal>
  );
}

// ─── Aba Insumos ──────────────────────────────────────────────────────────
function CadastroInsumos({ rid, insumos, fichas, recebimentos, vinculos, meId }: { rid: string; insumos: FtInsumo[]; fichas: FtFicha[]; recebimentos: RecebimentoNota[]; vinculos: FtVinculoRecebimento[]; meId?: string }) {
  const [nome, setNome] = useState(""); const [unidadeBase, setUnidadeBase] = useState("kg"); const [custo, setCusto] = useState("");
  const [editar, setEditar] = useState<FtInsumo | null>(null); const [mesclar, setMesclar] = useState<FtInsumo | null>(null);
  const [soPendentes, setSoPendentes] = useState(false); const [sincronizar, setSincronizar] = useState(false);
  const reconc = useMemo(() => reconciliar(agruparProdutos(coletarPrecos(recebimentos)), insumos, vinculos), [recebimentos, insumos, vinculos]);
  const nPrecoNovo = reconc.vinculados.filter(l => l.precoNovo).length;
  const nSugeridos = reconc.sugeridos.length;
  const similares = useMemo(() => sugerirInsumos(nome, insumos), [nome, insumos]);
  const pendentesSub = insumos.filter(i => i.ativo !== false && i.ehSubproduto && !i.subprodutoDe);
  const ativos = insumos.filter(i => i.ativo !== false).filter(i => !soPendentes || (i.ehSubproduto && !i.subprodutoDe)).sort((a, b) => a.nome.localeCompare(b.nome));
  async function add() {
    if (!nome.trim()) return;
    if (similares.some(s => s.motivo === "igual")) { if (!confirm("Já existe um insumo com esse nome. Cadastrar mesmo assim?")) return; }
    const dim = dimensaoDeUnidade(unidadeBase) as FtDimensao;
    const id = uid("ins"); const now = new Date().toISOString(); const c = parseMoeda(custo);
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore({
      id, restaurantId: rid, nome: UP(nome), nomeNormalizado: normalizarNome(nome), dimensao: dim, unidadeBase,
      custo: c, custoAtualizadoEm: c > 0 ? now : null, historicoCusto: c > 0 ? [{ custo: c, data: now, por: meId || null }] : [],
      fornecedorPadrao: null, reutilizavel: false, aliases: [], ativo: true,
    } as FtInsumo));
    setNome(""); setCusto("");
  }
  return (
    <div className="space-y-4">
      <FormCard titulo="Novo insumo">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_150px_auto] gap-3 items-end">
          <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Sal refinado" />
          <Select label="Unidade base" value={unidadeBase} onChange={e => setUnidadeBase(e.target.value)}>
            {UNIDADES.filter(u => ["kg", "g", "L", "ml", "un"].includes(u.unidade)).map(u => <option key={u.unidade} value={u.unidade}>{u.label} ({DIMENSAO_LABEL[u.dimensao]})</option>)}
          </Select>
          <CampoMoeda label={`Custo por ${unidadeBase}`} value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} />
          <Button onClick={add}>+ Adicionar</Button>
        </div>
        {similares.length > 0 && nome.trim() && <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Parecido com: {similares.slice(0, 3).map(s => s.insumo.nome).join(", ")} — confira pra não duplicar.</div>}
      </FormCard>
      {(nPrecoNovo > 0 || nSugeridos > 0) && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
          <span className="text-sm text-emerald-800 dark:text-emerald-200">🧾 {nPrecoNovo > 0 ? `${nPrecoNovo} preço(s) novo(s) recebido(s)` : "Recebimento"}{nSugeridos > 0 ? ` · ${nSugeridos} produto(s) pra vincular` : ""}.</span>
          <button type="button" onClick={() => setSincronizar(true)} className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Revisar preços</button>
        </div>
      )}
      {pendentesSub.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <span className="text-sm text-amber-800 dark:text-amber-200">⏳ {pendentesSub.length} subproduto(s) sem vínculo — vincule ao preparo que os gera (na tela da ficha).</span>
          <button type="button" onClick={() => setSoPendentes(s => !s)} className="ml-auto text-xs font-medium px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40">{soPendentes ? "Ver todos" : "Ver só pendentes"}</button>
        </div>
      )}
      <ListaCard vazio={ativos.length === 0} vazioTexto={soPendentes ? "Nenhum subproduto pendente." : "Nenhum insumo cadastrado."}>
        {ativos.map(ins => (
          <div key={ins.id} onClick={() => setEditar(ins)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 group cursor-pointer" title="Editar insumo">
            <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-base shrink-0">🧂</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ins.nome}
                {ins.ehSubproduto && <span className={`ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ins.subprodutoDe ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{ins.subprodutoDe ? "subproduto 🔗" : "subproduto ⏳ sem vínculo"}</span>}
              </div>
              <div className="text-xs text-gray-500">{DIMENSAO_LABEL[ins.dimensao]} · base {labelUnidade(ins.unidadeBase)}{ins.fornecedorPadrao ? ` · ${ins.fornecedorPadrao}` : ""}</div>
            </div>
            {ins.ehSubproduto
              ? <span className="text-[10px] text-gray-400 shrink-0">custo do preparo</span>
              : ins.custo > 0
              ? <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tabular-nums shrink-0">{fmtMoeda(ins.custo)}<span className="text-[10px] text-gray-400">/{labelUnidade(ins.unidadeBase)}</span></span>
              : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0">sem custo</span>}
            <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-xs text-indigo-600 dark:text-indigo-400">Editar</span>
              <button type="button" onClick={e => { e.stopPropagation(); setMesclar(ins); }} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Mesclar</button>
              <button type="button" onClick={e => { e.stopPropagation(); if (confirm(`Excluir "${ins.nome}"?`)) void updateDoc(doc(db, "ftInsumos", ins.id), { ativo: false }); }} className="text-xs text-gray-400 hover:text-red-600">Excluir</button>
            </div>
          </div>
        ))}
      </ListaCard>
      {editar && <EditarCustoModal insumo={editar} fichas={fichas} recebimentos={recebimentos} vinculos={vinculos} meId={meId} onClose={() => setEditar(null)} />}
      {mesclar && <MesclarInsumoModal insumo={mesclar} insumos={insumos} fichas={fichas} onClose={() => setMesclar(null)} />}
      {sincronizar && <SincronizarPrecosModal rid={rid} reconc={reconc} insumos={insumos} fichas={fichas} recebimentos={recebimentos} meId={meId} onClose={() => setSincronizar(false)} />}
    </div>
  );
}

function EditarCustoModal({ insumo, fichas, recebimentos, vinculos, meId, onClose }: { insumo: FtInsumo; fichas: FtFicha[]; recebimentos: RecebimentoNota[]; vinculos: FtVinculoRecebimento[]; meId?: string; onClose: () => void }) {
  const [nome, setNome] = useState(insumo.nome);
  const [custo, setCusto] = useState(insumo.custo ? maskMoeda(String(Math.round(insumo.custo * 100))) : "");
  const [forn, setForn] = useState(insumo.fornecedorPadrao || "");
  const [reutil, setReutil] = useState(!!insumo.reutilizavel);
  const [variacoes, setVariacoes] = useState<FtInsumoVariacao[]>(insumo.variacoes || []);
  const [unidadeBase, setUnidadeBase] = useState(insumo.unidadeBase);
  const cNum = parseMoeda(custo);
  const novaDim = (dimensaoDeUnidade(unidadeBase) || insumo.dimensao) as FtDimensao;
  const mudouUnidade = unidadeBase !== insumo.unidadeBase;
  const mudouDim = novaDim !== insumo.dimensao;
  // Fichas que usam este insumo diretamente (candidatas a afetadas pela mudança).
  const afetadas = useMemo(() => fichas.filter(f => f.ativo !== false && (f.ingredientes || []).some(ing => ing.tipo === "insumo" && ing.refId === insumo.id)), [fichas, insumo.id]);
  const [afetadasSel, setAfetadasSel] = useState<Set<string>>(() => new Set(afetadas.map(f => f.id)));
  // Trocar unidade: mesma dimensão → converte o custo exibido; outra dimensão → mantém.
  function trocarUnidade(nova: string) {
    const oldDim = dimensaoDeUnidade(unidadeBase), newDim = dimensaoDeUnidade(nova);
    if (oldDim && newDim && oldDim === newDim && cNum > 0) {
      const b1 = paraBase(1, nova), b0 = paraBase(1, unidadeBase);
      if (b1 && b0) setCusto(maskMoeda(String(Math.round(cNum * (b1 / b0) * 100))));
    }
    setUnidadeBase(nova);
  }
  const precoForn = useMemo(() => precosPorFornecedor(insumo.id, recebimentos, vinculos), [insumo.id, recebimentos, vinculos]);
  const serie = (insumo.historicoCusto || []).filter(h => h.custo > 0).map(h => h.custo);
  function addVar() { setVariacoes(v => [...v, { id: uid("var"), nome: "", fc: 100 }]); }
  function patchVar(id: string, patch: Partial<FtInsumoVariacao>) { setVariacoes(v => v.map(x => x.id === id ? { ...x, ...patch } : x)); }
  async function aplicarDoFornecedor(pf: { custoBase: number; data: string; fornecedor: string; notaId: string; notaNumero: string }) {
    const nova: FtHistoricoCusto = { custo: pf.custoBase, data: pf.data, por: meId || null, origem: "recebimento", fornecedor: pf.fornecedor || null, notaId: pf.notaId || null, notaNumero: pf.notaNumero || null };
    const hist = [...(insumo.historicoCusto || []), nova].slice(-20);
    await updateDoc(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ custo: pf.custoBase, custoAtualizadoEm: pf.data, historicoCusto: hist }));
    setCusto(maskMoeda(String(Math.round(pf.custoBase * 100))));
  }
  async function salvar() {
    const c = parseMoeda(custo); const now = new Date().toISOString();
    const hist = [...(insumo.historicoCusto || [])];
    if (c > 0 && c !== insumo.custo) hist.push({ custo: c, data: now, por: meId || null });
    const vars = variacoes.filter(v => v.nome.trim()).map(v => ({ id: v.id, nome: UP(v.nome), fc: v.fc > 0 ? v.fc : 100 }));
    if (!nome.trim()) { alert("O insumo precisa de um nome."); return; }
    const batch = writeBatch(db);
    batch.update(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ nome: UP(nome), nomeNormalizado: normalizarNome(nome), custo: c, custoAtualizadoEm: c > 0 ? now : insumo.custoAtualizadoEm || null, historicoCusto: hist, fornecedorPadrao: forn.trim() || null, reutilizavel: reutil, variacoes: vars, unidadeBase, dimensao: novaDim }));
    // Mudança de DIMENSÃO: ajusta a unidade do ingrediente nas fichas afetadas
    // (mantém a quantidade) e marca pra revisão — as quantidades precisam conferência.
    if (mudouUnidade && mudouDim) {
      for (const f of afetadas) {
        if (!afetadasSel.has(f.id)) continue; // você disse que esta NÃO é afetada
        const ingredientes = (f.ingredientes || []).map(ing => ing.tipo === "insumo" && ing.refId === insumo.id ? { ...ing, unidade: unidadeBase } : ing);
        batch.update(doc(db, "ftFichas", f.id), sanitizeForFirestore({ ingredientes, revisar: true, revisarMotivo: f.revisarMotivo || `Unidade de "${insumo.nome}" mudou p/ ${labelUnidade(unidadeBase)} — confira as quantidades` }));
      }
    }
    await batch.commit();
    onClose();
  }
  return (
    <Modal title="Editar insumo" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <CampoMoeda label={`Custo por ${labelUnidade(unidadeBase)} (inteiro)`} value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} />
          <Select label="Unidade base" value={unidadeBase} onChange={e => trocarUnidade(e.target.value)}>
            {UNIDADES.filter(u => ["kg", "g", "L", "ml", "un"].includes(u.unidade)).map(u => <option key={u.unidade} value={u.unidade}>{u.label} ({DIMENSAO_LABEL[u.dimensao]})</option>)}
          </Select>
        </div>
        {mudouUnidade && !mudouDim && (
          <div className="text-[11px] rounded-lg p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-200">Custo convertido pra R$/{labelUnidade(unidadeBase)} automaticamente.</div>
        )}
        {mudouUnidade && mudouDim && (
          <div className="text-[11px] rounded-lg p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 space-y-1.5">
            <div>⚠ Muda de <strong>{DIMENSAO_LABEL[insumo.dimensao]}</strong> para <strong>{DIMENSAO_LABEL[novaDim]}</strong>.</div>
            {afetadas.length === 0
              ? <div>Nenhuma ficha usa este insumo — só o insumo muda.</div>
              : <>
                  <div>Marque as fichas <strong>realmente</strong> afetadas: elas ficam com o ingrediente em {labelUnidade(unidadeBase)} e vão pra <strong>⚑ revisar</strong>. As desmarcadas não mudam.</div>
                  <div className="flex gap-3 text-indigo-600 dark:text-indigo-400">
                    <button type="button" onClick={() => setAfetadasSel(new Set(afetadas.map(f => f.id)))} className="hover:underline">marcar todas</button>
                    <button type="button" onClick={() => setAfetadasSel(new Set())} className="hover:underline">nenhuma</button>
                    <span className="text-amber-700 dark:text-amber-300">{afetadasSel.size}/{afetadas.length} afetadas</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-lg bg-white/60 dark:bg-gray-900/40 p-1.5">
                    {afetadas.map(f => (
                      <label key={f.id} className="flex items-center gap-2 cursor-pointer px-1 py-0.5">
                        <input type="checkbox" checked={afetadasSel.has(f.id)} onChange={ev => setAfetadasSel(s => { const n = new Set(s); if (ev.target.checked) n.add(f.id); else n.delete(f.id); return n; })} className="w-3.5 h-3.5 accent-amber-600" />
                        <span className="truncate text-gray-700 dark:text-gray-200">{f.nome}</span>
                      </label>
                    ))}
                  </div>
                </>}
          </div>
        )}
        <Input label="Fornecedor" value={forn} onChange={e => setForn(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={reutil} onChange={e => setReutil(e.target.checked)} className="w-4 h-4 accent-indigo-600" />Reutilizável (não pesa custo cheio — ex: óleo de fritura)</label>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Variações (fator de correção)</span>
            <button type="button" onClick={addVar} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ variação</button>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">% de aproveitamento em relação ao inteiro (ex: descascada 92%, brunoise 85%). O custo é ajustado sozinho.</p>
          {variacoes.length === 0 && <div className="text-xs text-gray-400 italic">Nenhuma variação. O insumo é usado inteiro (100%).</div>}
          <div className="space-y-1.5">
            {variacoes.map(v => (
              <div key={v.id} className="flex items-center gap-2">
                <input value={v.nome} onChange={e => patchVar(v.id, { nome: e.target.value.toUpperCase() })} placeholder="ex: descascada" className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
                <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
                  <input type="number" value={v.fc} onChange={e => patchVar(v.id, { fc: Number(e.target.value) || 0 })} className="w-12 py-1.5 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <span className="text-[11px] text-gray-400 w-20 text-right tabular-nums">{cNum > 0 && v.fc > 0 ? fmtMoeda(round2(cNum * 100 / v.fc)) : "—"}</span>
                <button type="button" onClick={() => setVariacoes(list => list.filter(x => x.id !== v.id))} className="text-gray-400 hover:text-red-600 text-sm">✕</button>
              </div>
            ))}
          </div>
        </div>

        {precoForn.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Preço por fornecedor <span className="font-normal text-gray-400">(último de cada · convertido pra {labelUnidade(insumo.unidadeBase)})</span></div>
            <div className="space-y-1">
              {precoForn.map((pf, i) => (
                <div key={pf.fornecedor + i} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 ${i === 0 ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{pf.fornecedor}{i === 0 && precoForn.length > 1 && <span className="ml-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">MELHOR</span>}</span>
                  <span className="text-[10px] text-gray-400">{fmtBR(pf.data)}</span>
                  <span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtMoeda(pf.custoBase)}</span>
                  <button type="button" onClick={() => void aplicarDoFornecedor(pf)} className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">usar</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {(insumo.historicoCusto || []).length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Histórico de preço</div>
              {serie.length > 1 && <Sparkline valores={serie} />}
            </div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {[...(insumo.historicoCusto || [])].reverse().slice(0, 10).map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="tabular-nums font-medium text-gray-800 dark:text-gray-200 w-20">{fmtMoeda(h.custo)}</span>
                  <span className="text-gray-400 w-20">{fmtBR(h.data)}</span>
                  <span className="text-gray-500 flex-1 truncate">{h.origem === "recebimento" ? `🧾 ${h.fornecedor || "recebimento"}${h.notaNumero ? ` · NF ${h.notaNumero}` : ""}` : "manual"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function MesclarInsumoModal({ insumo, insumos, fichas, onClose }: { insumo: FtInsumo; insumos: FtInsumo[]; fichas: FtFicha[]; onClose: () => void }) {
  const [alvoId, setAlvoId] = useState(""); const [salvando, setSalvando] = useState(false);
  const candidatos = insumos.filter(i => i.ativo !== false && i.id !== insumo.id && i.dimensao === insumo.dimensao).sort((a, b) => a.nome.localeCompare(b.nome));
  async function mesclar() {
    const alvo = insumos.find(i => i.id === alvoId);
    if (!alvo) { alert("Escolha o insumo destino."); return; }
    if (!confirm(`Mesclar "${insumo.nome}" em "${alvo.nome}"?`)) return;
    setSalvando(true);
    try {
      for (const f of fichas) {
        let mudou = false;
        const ingredientes = f.ingredientes.map(ing => {
          if (ing.tipo === "insumo" && ing.refId === insumo.id) { mudou = true; return { ...ing, refId: alvo.id, nomeSnapshot: alvo.nome }; }
          return ing;
        });
        if (mudou) await updateDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore({ ingredientes }));
      }
      await updateDoc(doc(db, "ftInsumos", alvo.id), sanitizeForFirestore({ aliases: Array.from(new Set([...(alvo.aliases || []), insumo.nome])) }));
      await updateDoc(doc(db, "ftInsumos", insumo.id), { ativo: false });
      onClose();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  return (
    <Modal title={`Mesclar "${insumo.nome}"`} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Escolha o insumo correto. As fichas que usam "{insumo.nome}" passam a apontar pra ele.</p>
        <Select label="Insumo destino" value={alvoId} onChange={e => setAlvoId(e.target.value)}>
          <option value="">Selecione…</option>
          {candidatos.map(i => <option key={i.id} value={i.id}>{i.nome} ({labelUnidade(i.unidadeBase)})</option>)}
        </Select>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={mesclar} disabled={salvando}>{salvando ? "Mesclando…" : "Mesclar"}</Button></div>
      </div>
    </Modal>
  );
}

// ─── Sincronizar preços do Recebimento ──────────────────────────────────────
function SincronizarPrecosModal({ rid, reconc, insumos, fichas, recebimentos, meId, onClose }: {
  rid: string; reconc: { vinculados: LinhaReconc[]; sugeridos: LinhaReconc[]; semInsumo: LinhaReconc[] };
  insumos: FtInsumo[]; fichas: FtFicha[]; recebimentos: RecebimentoNota[]; meId?: string; onClose: () => void;
}) {
  const notaById = useMemo(() => new Map(recebimentos.map(n => [n.id, n])), [recebimentos]);
  const notaUrl = (id: string): string | null => { const n = notaById.get(id); return n?.notaDriveUrl || n?.notaPaginas?.[0]?.driveUrl || null; };
  const VerNota = ({ notaId }: { notaId: string }) => { const url = notaUrl(notaId); return url ? <a href={url} target="_blank" rel="noreferrer" onClick={ev => ev.stopPropagation()} className="text-indigo-500 hover:underline">🧾 ver nota</a> : null; };
  const precosNovos = reconc.vinculados.filter(l => l.precoNovo);
  const [aplicar, setAplicar] = useState<Set<string>>(() => new Set(precosNovos.map(l => l.produto.chave)));
  const [precoEdit, setPrecoEdit] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { insumoId: string; fator: string }>>({});
  const custoEfetivo = (l: LinhaReconc) => { const v = precoEdit[l.produto.chave]; const n = v != null && v !== "" ? Number(v) : (l.custoBase ?? 0); return isNaN(n) ? (l.custoBase ?? 0) : n; };
  const [impacto, setImpacto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const insumosSel = insumos.filter(i => i.ativo !== false && !i.ehSubproduto).sort((a, b) => a.nome.localeCompare(b.nome));

  const defaultEdit = (l: LinhaReconc) => ({ insumoId: l.insumo?.id || "", fator: l.fatorParaBase != null ? String(l.fatorParaBase) : "" });
  const getEdit = (l: LinhaReconc) => edits[l.produto.chave] || defaultEdit(l);
  const setEdit = (l: LinhaReconc, patch: Partial<{ insumoId: string; fator: string }>) => setEdits(e => ({ ...e, [l.produto.chave]: { ...(e[l.produto.chave] || defaultEdit(l)), ...patch } }));
  // Escolher insumo → autopreenche o fator (conversão direta) se estiver vazio.
  const escolherInsumo = (l: LinhaReconc, insumoId: string) => {
    const ins = insumos.find(i => i.id === insumoId);
    const cur = getEdit(l);
    const autofat = ins ? fatorAutomatico(l.produto.unidade, ins) : null;
    setEdit(l, { insumoId, fator: cur.fator || (autofat != null ? String(autofat) : "") });
  };
  const linhaVinculo = (l: LinhaReconc, extra?: React.ReactNode) => {
    const e = getEdit(l); const ins = insumos.find(i => i.id === e.insumoId); const fatorNum = Number(e.fator);
    const preview = ins && fatorNum > 0 ? custoNaBase(l.produto.ultimo.valorUnitario, fatorNum) : null;
    return (
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <select value={e.insumoId} onChange={ev => escolherInsumo(l, ev.target.value)} className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 w-44 sm:w-52 shrink-0 shadow-sm"><option value="">— qual insumo? —</option>{insumosSel.map(i => <option key={i.id} value={i.id}>{i.nome} ({labelUnidade(i.unidadeBase)})</option>)}</select>
        <span className="text-[11px] text-gray-400 shrink-0 w-12 text-right">1 {l.produto.unidade || "un"} =</span>
        <MiniStepper value={e.fator} onChange={v => setEdit(l, { fator: v })} sufixo={ins ? labelUnidade(ins.unidadeBase) : "base"} />
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0 w-24">{preview != null ? `= ${fmtMoeda(preview)}/${ins ? labelUnidade(ins.unidadeBase) : ""}` : ""}</span>
        <div className="flex-1" />
        <button type="button" onClick={() => void aprovarVinculo(l)} disabled={!e.insumoId || !(fatorNum > 0)} className="h-8 text-xs font-medium px-3 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shrink-0 disabled:opacity-40">Vincular</button>
        {extra}
      </div>
    );
  };

  async function aplicarPreco(l: LinhaReconc) {
    const valor = custoEfetivo(l);
    if (!l.insumo || !(valor > 0)) return;
    const u = l.produto.ultimo;
    const nova: FtHistoricoCusto = { custo: valor, data: u.data, por: meId || null, origem: "recebimento", fornecedor: u.fornecedor || null, notaId: u.notaId || null, notaNumero: u.notaNumero || null };
    const hist: FtHistoricoCusto[] = [...(l.insumo.historicoCusto || []), nova].slice(-20);
    await updateDoc(doc(db, "ftInsumos", l.insumo.id), sanitizeForFirestore({ custo: valor, custoAtualizadoEm: u.data, historicoCusto: hist }));
  }
  async function aplicarSelecionados() {
    setSalvando(true);
    try { for (const l of precosNovos) if (aplicar.has(l.produto.chave)) await aplicarPreco(l); }
    finally { setSalvando(false); }
  }
  const vincId = (p: { chave: string }) => ("vrec_" + p.chave).replace(/[^a-zA-Z0-9_]/g, "_");
  async function gravarVinculo(p: LinhaReconc["produto"], patch: { insumoId: string | null; fatorParaBase: number; ignorar: boolean }) {
    const id = vincId(p);
    await setDoc(doc(db, "ftVinculosRecebimento", id), sanitizeForFirestore({
      id, restaurantId: rid, descricaoNorm: p.descricaoNorm, descricaoExemplo: p.descricaoExemplo, unidadeNota: p.unidade,
      fornecedor: p.fornecedor || null, aprovado: true, criadoEm: new Date().toISOString(), criadoPor: meId || null, ...patch,
    } as FtVinculoRecebimento));
  }
  async function aprovarVinculo(l: LinhaReconc) {
    const e = getEdit(l); const insumo = insumos.find(i => i.id === e.insumoId); const fator = Number(e.fator);
    if (!insumo || !(fator > 0)) { alert("Escolha o insumo e informe um fator válido (> 0)."); return; }
    await gravarVinculo(l.produto, { insumoId: insumo.id, fatorParaBase: fator, ignorar: false });
  }
  async function naoEEste(l: LinhaReconc) { await gravarVinculo(l.produto, { insumoId: null, fatorParaBase: 0, ignorar: false }); }
  async function desvincular(l: LinhaReconc) { if (l.vinculo) await deleteDoc(doc(db, "ftVinculosRecebimento", l.vinculo.id)); }
  async function ignorar(l: LinhaReconc) { await gravarVinculo(l.produto, { insumoId: null, fatorParaBase: 0, ignorar: true }); }
  async function criarInsumo(l: LinhaReconc) {
    const p = l.produto;
    const dim = (dimensaoDeUnidade(p.unidade) || "massa") as FtDimensao;
    const base = dim === "massa" ? "kg" : dim === "volume" ? "L" : "un";
    const fator = fatorAutomatico(p.unidade, { unidadeBase: base } as FtInsumo) ?? 1;
    const custo = custoNaBase(p.ultimo.valorUnitario, fator);
    const id = uid("ins");
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore({
      id, restaurantId: rid, nome: UP(p.descricaoExemplo), nomeNormalizado: normalizarNome(p.descricaoExemplo), dimensao: dim, unidadeBase: base,
      custo, custoAtualizadoEm: custo > 0 ? p.ultimo.data : null, historicoCusto: custo > 0 ? [{ custo, data: p.ultimo.data, por: meId || null, origem: "recebimento", fornecedor: p.fornecedor || null, notaId: p.ultimo.notaId, notaNumero: p.ultimo.notaNumero }] : [],
      fornecedorPadrao: p.fornecedor || null, reutilizavel: false, aliases: [], ativo: true,
    } as FtInsumo));
    await gravarVinculo(p, { insumoId: id, fatorParaBase: fator, ignorar: false });
  }

  const impactoLinha = (l: LinhaReconc) => l.insumo ? impactoNoCmv(l.insumo.id, custoEfetivo(l), insumos, fichas) : [];

  const Pill = ({ n, cor }: { n: number; cor: string }) => <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cor}`}>{n}</span>;

  return (
    <Modal title="🧾 Preços do recebimento" onClose={onClose} maxWidth="max-w-3xl">
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1 mb-3">Confira e aplique os preços que chegaram nas notas. Na dúvida sobre a unidade, abra a nota em <span className="text-indigo-500">🧾 ver nota</span>. Nada é aplicado sem você confirmar.</p>
      <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1 -mr-1">

        {/* Preços novos */}
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-emerald-50/60 dark:bg-emerald-900/15 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-800 dark:text-gray-100">💰 Preços novos</span><Pill n={precosNovos.length} cor="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" /></div>
            {precosNovos.length > 0 && <Button size="sm" onClick={() => void aplicarSelecionados()} disabled={salvando || aplicar.size === 0}>{salvando ? "Aplicando…" : `Aplicar ${aplicar.size}`}</Button>}
          </div>
          {precosNovos.length === 0
            ? <div className="px-4 py-4 text-xs text-gray-400 italic">Nenhum preço novo pra aplicar agora.</div>
            : <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {precosNovos.map(l => {
                const imp = impacto === l.produto.chave ? impactoLinha(l) : null;
                return (
                  <label key={l.produto.chave} className="block px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <input type="checkbox" checked={aplicar.has(l.produto.chave)} onChange={e => setAplicar(s => { const n = new Set(s); if (e.target.checked) n.add(l.produto.chave); else n.delete(l.produto.chave); return n; })} className="w-4 h-4 accent-emerald-600 shrink-0" />
                      <span className="text-sm font-medium flex-1 min-w-[120px] dark:text-gray-100">{l.insumo?.nome}</span>
                      <span className="text-xs tabular-nums text-gray-400">{fmtMoeda(l.insumo?.custo || 0)}</span>
                      <span className="text-gray-300">→</span>
                      <span className="inline-flex items-center h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 shrink-0" onClick={ev => ev.preventDefault()}>
                        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">R$</span>
                        <input value={precoEdit[l.produto.chave] ?? String(l.custoBase ?? 0)} onChange={ev => setPrecoEdit(p => ({ ...p, [l.produto.chave]: ev.target.value.replace(",", ".") }))} inputMode="decimal" className="w-14 bg-transparent text-xs font-bold text-emerald-700 dark:text-emerald-300 text-right outline-none tabular-nums" />
                        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">/{labelUnidade(l.insumo?.unidadeBase || "")}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-1 pl-6 text-[11px] text-gray-400">
                      <span className="text-gray-500 dark:text-gray-400">{l.produto.descricaoExemplo}</span>
                      <span>· {l.produto.unidade}</span>
                      {l.produto.fornecedor && <span>· {l.produto.fornecedor}</span>}
                      <span>· {fmtBR(l.produto.ultimo.data)}</span>
                      <VerNota notaId={l.produto.ultimo.notaId} />
                      <button type="button" onClick={ev => { ev.preventDefault(); setImpacto(impacto === l.produto.chave ? null : l.produto.chave); }} className="text-indigo-500 hover:underline">{impacto === l.produto.chave ? "ocultar impacto" : "impacto no CMV"}</button>
                      <button type="button" onClick={ev => { ev.preventDefault(); void desvincular(l); }} title="Desvincular — volta pra 'Vincular produtos'" className="text-gray-400 hover:text-amber-600">↩ desvincular</button>
                    </div>
                    {imp && (
                      <div className="mt-1.5 ml-6 rounded-lg bg-gray-50 dark:bg-gray-800/40 p-2 text-[11px] space-y-0.5">
                        {imp.length === 0 ? <span className="text-gray-400">Não afeta nenhuma ficha.</span> : imp.slice(0, 8).map(x => (
                          <div key={x.ficha.id} className="flex justify-between gap-2"><span className="truncate text-gray-600 dark:text-gray-300">{x.ficha.nome}</span><span className={`tabular-nums shrink-0 ${x.depois > x.antes ? "text-rose-600" : "text-emerald-600"}`}>{fmtMoeda(x.antes)} → {fmtMoeda(x.depois)}</span></div>
                        ))}
                        {imp.length > 8 && <span className="text-gray-400">+{imp.length - 8} fichas…</span>}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>}
        </section>

        {/* Vincular produtos */}
        {reconc.sugeridos.length > 0 && (
          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50/60 dark:bg-indigo-900/15 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">🔗 Vincular produtos</span><Pill n={reconc.sugeridos.length} cor="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {reconc.sugeridos.map(l => (
                <div key={l.produto.chave} className={`px-4 py-2.5 ${l.fornecedorNovo ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium flex-1 min-w-[120px] dark:text-gray-100">{l.produto.descricaoExemplo}</span>
                    <span className="text-[11px] text-gray-400">{l.produto.unidade} · {fmtMoeda(l.produto.ultimo.valorUnitario)}{l.produto.fornecedor ? ` · ${l.produto.fornecedor}` : ""}</span>
                    <VerNota notaId={l.produto.ultimo.notaId} />
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${l.fornecedorNovo ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "text-gray-400"}`}>{l.fornecedorNovo ? "novo fornecedor" : l.motivo}</span>
                  </div>
                  {l.fornecedorNovo && (l.vinculosOutros?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                      <span>Mesma embalagem de outro fornecedor?</span>
                      <select value="" onChange={ev => { const o = l.vinculosOutros![Number(ev.target.value)]; if (o) setEdit(l, { insumoId: o.insumoId, fator: String(o.fatorParaBase) }); }} className="text-[11px] px-1.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
                        <option value="">usar mesmo fator de…</option>
                        {l.vinculosOutros!.map((o, i) => <option key={i} value={i}>{o.fornecedor} · 1 {l.produto.unidade} = {o.fatorParaBase}</option>)}
                      </select>
                    </div>
                  )}
                  {linhaVinculo(l, <>
                    <button type="button" onClick={() => void naoEEste(l)} title="Não é este insumo — ainda não cadastrado (sai das sugestões, vai pra 'sem insumo')" className="text-xs text-gray-500 hover:text-amber-600 shrink-0">não é este</button>
                    <button type="button" onClick={() => void ignorar(l)} title="Não é insumo (descartável, limpeza…) — some de vez" className="text-xs text-gray-400 hover:text-red-600 shrink-0">ignorar</button>
                  </>)}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Sem insumo */}
        {reconc.semInsumo.length > 0 && (
          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">🆕 Produtos sem insumo</span><Pill n={reconc.semInsumo.length} cor="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {reconc.semInsumo.map(l => (
                <div key={l.produto.chave} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium flex-1 min-w-[120px] dark:text-gray-200">{l.produto.descricaoExemplo}</span>
                    <span className="text-[11px] text-gray-400">{l.produto.unidade} · {fmtMoeda(l.produto.ultimo.valorUnitario)}{l.produto.fornecedor ? ` · ${l.produto.fornecedor}` : ""}</span>
                    <VerNota notaId={l.produto.ultimo.notaId} />
                  </div>
                  {linhaVinculo(l, <>
                    <button type="button" onClick={() => void criarInsumo(l)} className="h-8 text-xs font-medium px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shrink-0">criar insumo</button>
                    <button type="button" onClick={() => void ignorar(l)} className="text-xs text-gray-400 hover:text-red-600 shrink-0">ignorar</button>
                  </>)}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="flex justify-end mt-3 pt-3 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Modal>
  );
}

// ─── Aba Categorias ────────────────────────────────────────────────────────
function CadastroCategorias({ rid, categorias }: { rid: string; categorias: FtCategoria[] }) {
  const [nome, setNome] = useState("");
  const ativas = categorias.filter(c => c.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome));
  async function add() {
    if (!nome.trim()) return;
    const id = uid("cat");
    await setDoc(doc(db, "ftCategorias", id), sanitizeForFirestore({ id, restaurantId: rid, nome: nome.trim(), ordem: ativas.length, ativo: true } as FtCategoria));
    setNome("");
  }
  return (
    <div className="space-y-4">
      <FormCard titulo="Nova categoria" nota="Ex: Drinks, Pratos principais, Entradas, Pratos frios, Molhos, Massas…">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Input label="Categoria" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Pratos principais" />
          <Button onClick={add}>+ Adicionar</Button>
        </div>
      </FormCard>
      <ListaCard vazio={ativas.length === 0} vazioTexto="Nenhuma categoria cadastrada.">
        {ativas.map(c => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm group">
            <span className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">🏷️</span>
            <span className="flex-1 text-gray-900 dark:text-gray-100">{c.nome}</span>
            <button type="button" onClick={() => deleteDoc(doc(db, "ftCategorias", c.id))} className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">Excluir</button>
          </div>
        ))}
      </ListaCard>
    </div>
  );
}

// ─── UI atoms ───────────────────────────────────────────────────────────────
function FormCard({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4">
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">{titulo}</div>
      {children}
      {nota && <div className="mt-2 text-[11px] text-gray-400">{nota}</div>}
    </div>
  );
}
function ListaCard({ vazio, vazioTexto, children }: { vazio: boolean; vazioTexto: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
      {vazio ? <div className="p-8 text-sm text-gray-400 text-center">{vazioTexto}</div> : children}
    </div>
  );
}
function CampoMoeda({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</label>
      <div className="flex items-center gap-1 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500">
        <span className="text-gray-400 text-xs">R$</span>
        <input value={value} onChange={onChange} inputMode="numeric" placeholder="0,00" className="w-full py-2 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
      </div>
    </div>
  );
}
function Sparkline({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const w = 110, h = 24, pad = 2;
  const min = Math.min(...valores), max = Math.max(...valores), range = max - min || 1;
  const pts = valores.map((v, i) => {
    const x = pad + (i / (valores.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cor = valores[valores.length - 1] >= valores[0] ? "#e11d48" : "#059669"; // subiu=rosa, caiu=verde
  return (
    <svg width={w} height={h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 sm:flex-none px-2 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors text-center ${ativo ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
      {children}
    </button>
  );
}
