// Módulo Fichas Técnicas — Fase 1: Insumos + Fichas + custo em tempo real.
// Escopo por empresa. Base portada do AppMise, melhorada (unidade com dimensão,
// dedup de insumo, subproduto). Produção e Cardápio/CMV vêm nas próximas fases.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Select } from "../../core/ui/Select";
import { Modal } from "../../core/ui/Modal";
import type {
  FtDimensao, FtFicha, FtFichaTipo, FtIngrediente, FtInsumo, FtSubficha,
} from "../../core/types";
import { FT_FICHA_TIPO_LABEL } from "../../core/types";
import { DIMENSAO_LABEL, dimensaoDeUnidade, labelUnidade, unidadesDaDimensao, unidadesRendimento, UNIDADES } from "./unidades";
import { calcularCusto } from "./custo";
import { normalizarNome, sugerirInsumos } from "./dedup";

// ─── util moeda ───────────────────────────────────────────────────────────
function maskMoeda(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  return (parseInt(d, 10) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseMoeda(m: string): number { const d = (m || "").replace(/\D/g, ""); return d ? parseInt(d, 10) / 100 : 0; }
function fmtMoeda(n: number): string { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

type Tab = "fichas" | "insumos";

export function FichasPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const { can } = useCanAcao(rid || "");
  const [tab, setTab] = useState<Tab>("fichas");
  const [insumos, setInsumos] = useState<FtInsumo[]>([]);
  const [fichas, setFichas] = useState<FtFicha[]>([]);
  const [editando, setEditando] = useState<FtFicha | null>(null);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "ftInsumos"), where("restaurantId", "==", rid)),
      s => setInsumos(s.docs.map(d => ({ id: d.id, ...d.data() } as FtInsumo))));
    const u2 = onSnapshot(query(collection(db, "ftFichas"), where("restaurantId", "==", rid)),
      s => setFichas(s.docs.map(d => ({ id: d.id, ...d.data() } as FtFicha))));
    return () => { u1(); u2(); };
  }, [rid]);

  if (!rid) return <div className="text-center py-12 text-gray-500">Selecione uma empresa.</div>;
  if (!can("fichas", "ver")) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Fichas Técnicas.</div>;
  const podeEditar = can("fichas", "editarFicha");
  const podeInsumo = can("fichas", "insumos");

  if (editando) {
    return (
      <FichaEditor
        rid={rid} fichaInicial={editando} insumos={insumos} fichas={fichas}
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
          <Button className="w-full sm:w-auto" onClick={() => setEditando(novaFicha(rid, pessoa?.id, pessoa?.nome))}>+ Nova ficha</Button>
        )}
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        <TabBtn ativo={tab === "fichas"} onClick={() => setTab("fichas")}>Fichas ({fichas.filter(f => f.ativo !== false).length})</TabBtn>
        {podeInsumo && <TabBtn ativo={tab === "insumos"} onClick={() => setTab("insumos")}>Insumos ({insumos.filter(i => i.ativo !== false).length})</TabBtn>}
      </nav>

      {tab === "fichas" && (
        <ListaFichas fichas={fichas} insumos={insumos} onEditar={setEditando} podeEditar={podeEditar} />
      )}
      {tab === "insumos" && podeInsumo && (
        <CadastroInsumos rid={rid} insumos={insumos} fichas={fichas} meId={pessoa?.id} />
      )}
    </div>
  );
}

function novaFicha(rid: string, meId?: string, meNome?: string): FtFicha {
  return {
    id: uid("fic"), restaurantId: rid, nome: "", nomeNormalizado: "", tipo: "prato",
    rendimentoFinal: { qtd: 1, unidade: "porção" },
    subfichas: [{ id: uid("sf"), nome: "Preparo", rendimento: { qtd: 1, unidade: "porção" }, ingredientes: [] }],
    ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId, criadoPorNome: meNome,
  };
}

// ─── Lista de fichas ──────────────────────────────────────────────────────
function ListaFichas({ fichas, insumos, onEditar, podeEditar }: {
  fichas: FtFicha[]; insumos: FtInsumo[]; onEditar: (f: FtFicha) => void; podeEditar: boolean;
}) {
  const ativas = fichas.filter(f => f.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  if (ativas.length === 0) return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
      Nenhuma ficha ainda. Clique em "Nova ficha" pra começar.
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {ativas.map(f => {
        const c = calcularCusto(f, insumos, fichas);
        return (
          <button key={f.id} type="button" onClick={() => podeEditar && onEditar(f)}
            className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{f.nome || "(sem nome)"}</div>
                <div className="text-xs text-gray-500">{FT_FICHA_TIPO_LABEL[f.tipo]} · rende {f.rendimentoFinal.qtd} {labelUnidade(f.rendimentoFinal.unidade)}</div>
              </div>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 shrink-0">{f.subfichas.length} etapa(s)</span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-[11px] text-gray-500">Custo por {labelUnidade(f.rendimentoFinal.unidade)}</div>
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
  );
}

// ─── Editor de ficha ──────────────────────────────────────────────────────
function FichaEditor({ rid, fichaInicial, insumos, fichas, meId, podeInsumo, onClose }: {
  rid: string; fichaInicial: FtFicha; insumos: FtInsumo[]; fichas: FtFicha[];
  meId?: string; podeInsumo: boolean; onClose: () => void;
}) {
  const [f, setF] = useState<FtFicha>(fichaInicial);
  const [salvando, setSalvando] = useState(false);
  const custo = useMemo(() => calcularCusto({ ...f }, insumos, fichas), [f, insumos, fichas]);
  const subprodutos = useMemo(() => fichas.filter(x => x.tipo === "subproduto" && x.ativo !== false && x.id !== f.id), [fichas, f.id]);

  function patchSub(sfId: string, patch: Partial<FtSubficha>) {
    setF(prev => ({ ...prev, subfichas: prev.subfichas.map(sf => sf.id === sfId ? { ...sf, ...patch } : sf) }));
  }
  function addSub() {
    setF(prev => ({ ...prev, subfichas: [...prev.subfichas, { id: uid("sf"), nome: `Etapa ${prev.subfichas.length + 1}`, rendimento: { qtd: 1, unidade: "porção" }, ingredientes: [] }] }));
  }
  function removeSub(sfId: string) {
    setF(prev => ({ ...prev, subfichas: prev.subfichas.filter(sf => sf.id !== sfId) }));
  }

  async function salvar() {
    if (!f.nome.trim()) { alert("Dê um nome pra ficha."); return; }
    setSalvando(true);
    try {
      const limpa: FtFicha = { ...f, nome: f.nome.trim(), nomeNormalizado: normalizarNome(f.nome) };
      await setDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore(limpa));
      onClose();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  async function excluir() {
    if (!confirm(`Excluir a ficha "${f.nome}"?`)) return;
    await updateDoc(doc(db, "ftFichas", f.id), { ativo: false });
    onClose();
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Voltar</button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={excluir}>🗑️ Excluir</Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar ficha"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="space-y-4">
          {/* Cabeçalho da ficha */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-3">
            <Input label="Nome da ficha" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder="ex: Torta de limão" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Select label="Tipo" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as FtFichaTipo })}>
                {(["prato", "drinque", "subproduto"] as FtFichaTipo[]).map(t => <option key={t} value={t}>{FT_FICHA_TIPO_LABEL[t]}</option>)}
              </Select>
              <Input label="Rende (qtd)" type="number" value={f.rendimentoFinal.qtd} onChange={e => setF({ ...f, rendimentoFinal: { ...f.rendimentoFinal, qtd: Number(e.target.value) || 0 } })} />
              <Select label="Unidade" value={f.rendimentoFinal.unidade} onChange={e => setF({ ...f, rendimentoFinal: { ...f.rendimentoFinal, unidade: e.target.value } })}>
                {unidadesRendimento().map(u => <option key={u.unidade} value={u.unidade}>{u.label}</option>)}
              </Select>
              <Input label="Categoria" value={f.categoria || ""} onChange={e => setF({ ...f, categoria: e.target.value })} placeholder="opcional" />
            </div>
            {f.tipo === "subproduto" && <div className="text-[11px] text-indigo-600 dark:text-indigo-400">Esta ficha poderá ser usada como ingrediente de outras fichas.</div>}
          </div>

          {/* Subfichas */}
          {f.subfichas.map((sf, idx) => (
            <SubfichaCard
              key={sf.id} sf={sf} indice={idx + 1} isUltima={idx === f.subfichas.length - 1}
              custo={custo.subfichas.find(s => s.id === sf.id)?.custo || 0}
              insumos={insumos} subprodutos={subprodutos} subfichasDaFicha={f.subfichas}
              rid={rid} meId={meId} podeInsumo={podeInsumo}
              onPatch={p => patchSub(sf.id, p)} onRemove={() => removeSub(sf.id)}
            />
          ))}
          <Button variant="secondary" size="sm" onClick={addSub}>+ Adicionar etapa (subficha)</Button>
        </div>

        {/* Painel de custo */}
        <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/50 p-4 lg:sticky lg:top-4">
          <div className="text-[11px] text-gray-500">Custo total da ficha</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmtMoeda(custo.total)}</div>
          <div className="text-xs text-gray-500 mb-3">{fmtMoeda(custo.porRendimento)} por {labelUnidade(f.rendimentoFinal.unidade)}</div>
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2 space-y-1">
            {custo.subfichas.map(s => (
              <div key={s.id} className="flex justify-between text-xs text-gray-600 dark:text-gray-300"><span className="truncate">{s.nome}</span><span className="tabular-nums">{fmtMoeda(s.custo)}</span></div>
            ))}
          </div>
          {custo.insumosSemCusto.length > 0 && (
            <div className="mt-3 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
              ⚠ Sem custo: {custo.insumosSemCusto.slice(0, 5).join(", ")}{custo.insumosSemCusto.length > 5 ? "…" : ""}. Cadastre o custo na aba Insumos.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card de subficha (etapa) ─────────────────────────────────────────────
function SubfichaCard({ sf, indice, isUltima, custo, insumos, subprodutos, subfichasDaFicha, rid, meId, podeInsumo, onPatch, onRemove }: {
  sf: FtSubficha; indice: number; isUltima: boolean; custo: number;
  insumos: FtInsumo[]; subprodutos: FtFicha[]; subfichasDaFicha: FtSubficha[];
  rid: string; meId?: string; podeInsumo: boolean;
  onPatch: (p: Partial<FtSubficha>) => void; onRemove: () => void;
}) {
  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);

  function addIngrediente(ing: FtIngrediente) { onPatch({ ingredientes: [...sf.ingredientes, ing] }); }
  function patchIng(id: string, patch: Partial<FtIngrediente>) { onPatch({ ingredientes: sf.ingredientes.map(i => i.id === id ? { ...i, ...patch } : i) }); }
  function removeIng(id: string) { onPatch({ ingredientes: sf.ingredientes.filter(i => i.id !== id) }); }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 dark:border-gray-800">
        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">{indice}</span>
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <input value={sf.nome} onChange={e => onPatch({ nome: e.target.value })} placeholder="nome da etapa"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-indigo-500 px-0.5 py-0.5 dark:text-gray-100" />
          <span className="text-gray-300 dark:text-gray-600 text-xs shrink-0" aria-hidden="true">✎</span>
        </div>
        {isUltima && <span className="text-[10px] uppercase text-indigo-500 shrink-0">servido</span>}
        <span className="text-xs font-medium text-gray-500 tabular-nums shrink-0">{fmtMoeda(custo)}</span>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-600 text-xs shrink-0">✕</button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Rende</span>
          <QtyStepper qtd={sf.rendimento.qtd} unidade={sf.rendimento.unidade} unidades={unidadesRendimento().map(u => u.unidade)} unidadeTravada={false}
            onQtd={n => onPatch({ rendimento: { ...sf.rendimento, qtd: n } })}
            onUnidade={u => onPatch({ rendimento: { ...sf.rendimento, unidade: u } })} />
        </div>

        {sf.ingredientes.length > 0 && (
          <div className="space-y-1">
            {sf.ingredientes.map(ing => (
              <IngredienteRow key={ing.id} ing={ing} insumoById={insumoById} subfichasDaFicha={subfichasDaFicha} subprodutos={subprodutos}
                onPatch={p => patchIng(ing.id, p)} onRemove={() => removeIng(ing.id)} />
            ))}
          </div>
        )}

        <IngredientePicker
          insumos={insumos} subprodutos={subprodutos} subfichasDaFicha={subfichasDaFicha} sfAtualId={sf.id}
          rid={rid} meId={meId} podeInsumo={podeInsumo} onAdd={addIngrediente}
        />
      </div>
    </div>
  );
}

// Passo do stepper conforme a magnitude (mais prático em quantidades grandes).
function passoDe(v: number): number { return v >= 1000 ? 100 : v >= 100 ? 10 : v >= 10 ? 5 : 1; }
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// Stepper − [qtd] + com unidade acoplada (mesma altura, alinhado).
function QtyStepper({ qtd, unidade, unidades, unidadeTravada, onQtd, onUnidade }: {
  qtd: number; unidade: string; unidades: string[]; unidadeTravada: boolean;
  onQtd: (n: number) => void; onUnidade: (u: string) => void;
}) {
  return (
    <div className="inline-flex items-stretch h-9 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden shrink-0">
      <button type="button" onClick={() => onQtd(Math.max(0, round2(qtd - passoDe(qtd))))} className="px-2.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 text-base leading-none">−</button>
      <input type="number" value={qtd} onChange={e => onQtd(Number(e.target.value) || 0)} className="w-14 text-center bg-transparent text-sm outline-none border-x border-gray-200 dark:border-gray-700 dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" onClick={() => onQtd(round2(qtd + passoDe(qtd)))} className="px-2.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 text-base leading-none border-r border-gray-200 dark:border-gray-700">+</button>
      <select value={unidade} onChange={e => onUnidade(e.target.value)} disabled={unidadeTravada} className="px-2 bg-gray-50 dark:bg-gray-800/60 text-xs font-medium text-gray-600 dark:text-gray-300 outline-none appearance-none text-center disabled:opacity-80 cursor-pointer disabled:cursor-default">
        {unidades.map(u => <option key={u} value={u}>{labelUnidade(u)}</option>)}
      </select>
    </div>
  );
}

const CHIP_TIPO: Record<string, string> = {
  etapa: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  subproduto: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  insumo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

// ─── Linha de ingrediente já adicionado ───────────────────────────────────
function IngredienteRow({ ing, insumoById, subfichasDaFicha, subprodutos, onPatch, onRemove }: {
  ing: FtIngrediente; insumoById: Map<string, FtInsumo>; subfichasDaFicha: FtSubficha[]; subprodutos: FtFicha[];
  onPatch: (p: Partial<FtIngrediente>) => void; onRemove: () => void;
}) {
  let nome = ing.nomeSnapshot || "?";
  let unidadesOpc: string[] = [ing.unidade];
  let tipoTag: "insumo" | "etapa" | "subproduto" = "insumo";
  if (ing.tipo === "insumo") {
    const ins = insumoById.get(ing.refId);
    nome = ins?.nome || ing.nomeSnapshot || "(insumo removido)";
    unidadesOpc = ins ? unidadesDaDimensao(ins.dimensao).map(u => u.unidade) : [ing.unidade];
  } else if (ing.tipo === "subficha") {
    const sf = subfichasDaFicha.find(s => s.id === ing.refId);
    nome = sf?.nome || ing.nomeSnapshot || "(etapa)"; tipoTag = "etapa"; unidadesOpc = [sf?.rendimento.unidade || ing.unidade];
  } else {
    const sp = subprodutos.find(s => s.id === ing.refId);
    nome = sp?.nome || ing.nomeSnapshot || "(subproduto)"; tipoTag = "subproduto"; unidadesOpc = [sp?.rendimentoFinal.unidade || ing.unidade];
  }
  return (
    <div className="flex items-center gap-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 px-1 -mx-1">
      <span className={`w-2 h-2 rounded-full shrink-0 ${CHIP_TIPO[tipoTag]}`} aria-hidden="true"></span>
      <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">
        {nome}
        {tipoTag !== "insumo" && <span className={`ml-1.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${CHIP_TIPO[tipoTag]}`}>{tipoTag}</span>}
      </span>
      {ing.qb
        ? <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0">quanto baste</span>
        : <QtyStepper qtd={ing.qtd} unidade={ing.unidade} unidades={unidadesOpc} unidadeTravada={unidadesOpc.length <= 1} onQtd={n => onPatch({ qtd: n })} onUnidade={u => onPatch({ unidade: u })} />}
      <button type="button" onClick={() => onPatch({ qb: !ing.qb })} title="quanto baste (não pesa custo)" className={`text-[10px] font-bold px-2 py-1.5 rounded-lg shrink-0 transition-colors ${ing.qb ? "bg-amber-500 text-white" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>q.b.</button>
      <button type="button" onClick={onRemove} title="remover" className="text-gray-400 hover:text-red-600 text-sm shrink-0 px-1">✕</button>
    </div>
  );
}

// ─── Autocomplete de ingrediente (insumo / subficha / subproduto) ─────────
function IngredientePicker({ insumos, subprodutos, subfichasDaFicha, sfAtualId, rid, meId, podeInsumo, onAdd }: {
  insumos: FtInsumo[]; subprodutos: FtFicha[]; subfichasDaFicha: FtSubficha[]; sfAtualId: string;
  rid: string; meId?: string; podeInsumo: boolean; onAdd: (ing: FtIngrediente) => void;
}) {
  const [busca, setBusca] = useState("");
  const [criandoInsumo, setCriandoInsumo] = useState(false);
  const n = normalizarNome(busca);
  const sugInsumos = useMemo(() => sugerirInsumos(busca, insumos), [busca, insumos]);
  const sugSubfichas = useMemo(() => subfichasDaFicha.filter(s => s.id !== sfAtualId && normalizarNome(s.nome).includes(n) && n), [subfichasDaFicha, sfAtualId, n]);
  const sugSubprodutos = useMemo(() => subprodutos.filter(s => normalizarNome(s.nome).includes(n) && n), [subprodutos, n]);

  function pickInsumo(ins: FtInsumo) {
    onAdd({ id: uid("ing"), tipo: "insumo", refId: ins.id, nomeSnapshot: ins.nome, qtd: 1, unidade: unidadesDaDimensao(ins.dimensao)[0]?.unidade || ins.unidadeBase });
    setBusca("");
  }
  function pickSubficha(sf: FtSubficha) {
    onAdd({ id: uid("ing"), tipo: "subficha", refId: sf.id, nomeSnapshot: sf.nome, qtd: 1, unidade: sf.rendimento.unidade });
    setBusca("");
  }
  function pickSubproduto(sp: FtFicha) {
    onAdd({ id: uid("ing"), tipo: "subproduto", refId: sp.id, nomeSnapshot: sp.nome, qtd: 1, unidade: sp.rendimentoFinal.unidade });
    setBusca("");
  }

  const temAlgo = sugInsumos.length || sugSubfichas.length || sugSubprodutos.length;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !busca.trim()) return;
    e.preventDefault();
    if (sugInsumos[0]) pickInsumo(sugInsumos[0].insumo);
    else if (sugSubfichas[0]) pickSubficha(sugSubfichas[0]);
    else if (sugSubprodutos[0]) pickSubproduto(sugSubprodutos[0]);
    else if (podeInsumo) setCriandoInsumo(true);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900">
        <span className="text-gray-400 text-sm">🔎</span>
        <input value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={onKeyDown} placeholder="+ adicionar ingrediente — digite o nome do insumo, etapa ou subproduto" className="w-full py-2 bg-transparent text-sm outline-none dark:text-gray-100" />
        {busca && <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">Enter pra adicionar</span>}
      </div>
      {!busca && <div className="mt-1 text-[11px] text-gray-400">Comece a digitar e escolha na lista (ou aperte Enter). Insumo novo → "criar insumo".</div>}
      {busca && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {sugInsumos.map(({ insumo, motivo }) => (
            <button key={insumo.id} type="button" onClick={() => pickInsumo(insumo)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="text-sm flex-1 truncate">{insumo.nome} <span className="text-[11px] text-gray-400">· {DIMENSAO_LABEL[insumo.dimensao]} · {labelUnidade(insumo.unidadeBase)}</span></span>
              {motivo === "parecido" && <span className="text-[10px] text-amber-600">parecido</span>}
              {(!insumo.custo || insumo.custo <= 0) && <span className="text-[10px] text-amber-600">sem custo</span>}
            </button>
          ))}
          {sugSubfichas.map(sf => (
            <button key={sf.id} type="button" onClick={() => pickSubficha(sf)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="text-sm flex-1 truncate">{sf.nome}</span><span className="text-[10px] uppercase text-indigo-500">etapa</span>
            </button>
          ))}
          {sugSubprodutos.map(sp => (
            <button key={sp.id} type="button" onClick={() => pickSubproduto(sp)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="text-sm flex-1 truncate">{sp.nome}</span><span className="text-[10px] uppercase text-indigo-500">subproduto</span>
            </button>
          ))}
          {podeInsumo && (
            <button type="button" onClick={() => setCriandoInsumo(true)} className="w-full text-left flex items-center gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-indigo-600 dark:text-indigo-400">
              <span className="text-sm">+ Criar insumo "{busca.trim()}"</span>
            </button>
          )}
          {!temAlgo && !podeInsumo && <div className="px-3 py-2 text-xs text-gray-400">Nada encontrado.</div>}
        </div>
      )}
      {criandoInsumo && (
        <CriarInsumoModal rid={rid} nomeInicial={busca.trim()} insumos={insumos} meId={meId}
          onCriado={(ins) => { setCriandoInsumo(false); setBusca(""); pickInsumo(ins); }}
          onClose={() => setCriandoInsumo(false)} />
      )}
    </div>
  );
}

// ─── Modal: criar insumo (inline no editor) ───────────────────────────────
function CriarInsumoModal({ rid, nomeInicial, insumos, meId, onCriado, onClose }: {
  rid: string; nomeInicial: string; insumos: FtInsumo[]; meId?: string;
  onCriado: (ins: FtInsumo) => void; onClose: () => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [unidadeBase, setUnidadeBase] = useState("kg");
  const [custo, setCusto] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const similares = useMemo(() => sugerirInsumos(nome, insumos), [nome, insumos]);

  async function salvar() {
    if (!nome.trim()) return;
    const dim = dimensaoDeUnidade(unidadeBase) as FtDimensao;
    const id = uid("ins");
    const now = new Date().toISOString();
    const c = parseMoeda(custo);
    const ins: FtInsumo = {
      id, restaurantId: rid, nome: nome.trim(), nomeNormalizado: normalizarNome(nome),
      dimensao: dim, unidadeBase, custo: c,
      custoAtualizadoEm: c > 0 ? now : null,
      historicoCusto: c > 0 ? [{ custo: c, data: now, por: meId || null }] : [],
      fornecedorPadrao: fornecedor.trim() || null, reutilizavel: false, aliases: [], ativo: true,
    };
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore(ins));
    onCriado(ins);
  }

  return (
    <Modal title="Novo insumo" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Sal refinado" />
        {similares.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-200">
            Já existe algo parecido: {similares.slice(0, 3).map(s => s.insumo.nome).join(", ")}. Confira pra não duplicar — você pode cancelar e selecionar o existente.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Select label="Unidade base" value={unidadeBase} onChange={e => setUnidadeBase(e.target.value)}>
            {UNIDADES.filter(u => ["kg", "g", "L", "ml", "un"].includes(u.unidade)).map(u => <option key={u.unidade} value={u.unidade}>{u.label} ({DIMENSAO_LABEL[u.dimensao]})</option>)}
          </Select>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Custo por {unidadeBase}</span>
            <div className="flex items-center gap-1 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
              <span className="text-gray-400 text-xs">R$</span>
              <input value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} inputMode="numeric" placeholder="0,00" className="w-full py-2 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
            </div>
          </label>
        </div>
        <Input label="Fornecedor (opcional)" value={fornecedor} onChange={e => setFornecedor(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar}>Criar e usar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Aba Insumos ──────────────────────────────────────────────────────────
function CadastroInsumos({ rid, insumos, fichas, meId }: {
  rid: string; insumos: FtInsumo[]; fichas: FtFicha[]; meId?: string;
}) {
  const [nome, setNome] = useState("");
  const [unidadeBase, setUnidadeBase] = useState("kg");
  const [custo, setCusto] = useState("");
  const [editar, setEditar] = useState<FtInsumo | null>(null);
  const [mesclar, setMesclar] = useState<FtInsumo | null>(null);
  const similares = useMemo(() => sugerirInsumos(nome, insumos), [nome, insumos]);
  const ativos = insumos.filter(i => i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));

  async function add() {
    if (!nome.trim()) return;
    if (similares.some(s => s.motivo === "igual")) { if (!confirm("Já existe um insumo com esse nome. Cadastrar mesmo assim?")) return; }
    const dim = dimensaoDeUnidade(unidadeBase) as FtDimensao;
    const id = uid("ins"); const now = new Date().toISOString(); const c = parseMoeda(custo);
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore({
      id, restaurantId: rid, nome: nome.trim(), nomeNormalizado: normalizarNome(nome), dimensao: dim, unidadeBase,
      custo: c, custoAtualizadoEm: c > 0 ? now : null, historicoCusto: c > 0 ? [{ custo: c, data: now, por: meId || null }] : [],
      fornecedorPadrao: null, reutilizavel: false, aliases: [], ativo: true,
    } as FtInsumo));
    setNome(""); setCusto("");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">Novo insumo</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_150px_auto] gap-3 items-end">
          <Input label="Nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Sal refinado" />
          <Select label="Unidade base" value={unidadeBase} onChange={e => setUnidadeBase(e.target.value)}>
            {UNIDADES.filter(u => ["kg", "g", "L", "ml", "un"].includes(u.unidade)).map(u => <option key={u.unidade} value={u.unidade}>{u.label} ({DIMENSAO_LABEL[u.dimensao]})</option>)}
          </Select>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Custo por {unidadeBase}</span>
            <div className="flex items-center gap-1 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
              <span className="text-gray-400 text-xs">R$</span>
              <input value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} inputMode="numeric" placeholder="0,00" className="w-full py-2 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
            </div>
          </label>
          <Button onClick={add}>+ Adicionar</Button>
        </div>
        {similares.length > 0 && nome.trim() && (
          <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Parecido com: {similares.slice(0, 3).map(s => s.insumo.nome).join(", ")} — confira pra não duplicar.</div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
        {ativos.length === 0 ? <div className="p-8 text-sm text-gray-400 text-center">Nenhum insumo cadastrado.</div> : ativos.map(ins => (
          <div key={ins.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
            <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-base shrink-0">🧂</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ins.nome}</div>
              <div className="text-xs text-gray-500">{DIMENSAO_LABEL[ins.dimensao]} · base {labelUnidade(ins.unidadeBase)}{ins.fornecedorPadrao ? ` · ${ins.fornecedorPadrao}` : ""}</div>
            </div>
            {ins.custo > 0
              ? <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tabular-nums shrink-0">{fmtMoeda(ins.custo)}<span className="text-[10px] text-gray-400">/{labelUnidade(ins.unidadeBase)}</span></span>
              : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shrink-0">sem custo</span>}
            <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" onClick={() => setEditar(ins)} className="text-xs text-indigo-600 dark:text-indigo-400">Custo</button>
              <button type="button" onClick={() => setMesclar(ins)} className="text-xs text-gray-500">Mesclar</button>
              <button type="button" onClick={() => updateDoc(doc(db, "ftInsumos", ins.id), { ativo: false })} className="text-xs text-gray-400 hover:text-red-600">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {editar && <EditarCustoModal insumo={editar} meId={meId} onClose={() => setEditar(null)} />}
      {mesclar && <MesclarInsumoModal insumo={mesclar} insumos={insumos} fichas={fichas} onClose={() => setMesclar(null)} />}
    </div>
  );
}

function EditarCustoModal({ insumo, meId, onClose }: { insumo: FtInsumo; meId?: string; onClose: () => void }) {
  const [custo, setCusto] = useState(insumo.custo ? maskMoeda(String(Math.round(insumo.custo * 100))) : "");
  const [forn, setForn] = useState(insumo.fornecedorPadrao || "");
  const [reutil, setReutil] = useState(!!insumo.reutilizavel);
  async function salvar() {
    const c = parseMoeda(custo); const now = new Date().toISOString();
    const hist = [...(insumo.historicoCusto || [])];
    if (c > 0 && c !== insumo.custo) hist.push({ custo: c, data: now, por: meId || null });
    await updateDoc(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({
      custo: c, custoAtualizadoEm: c > 0 ? now : insumo.custoAtualizadoEm || null,
      historicoCusto: hist, fornecedorPadrao: forn.trim() || null, reutilizavel: reutil,
    }));
    onClose();
  }
  return (
    <Modal title={`Custo — ${insumo.nome}`} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Custo por {labelUnidade(insumo.unidadeBase)}</span>
          <div className="flex items-center gap-1 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
            <span className="text-gray-400 text-xs">R$</span>
            <input value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} inputMode="numeric" placeholder="0,00" className="w-full py-2 bg-transparent text-right text-sm outline-none dark:text-gray-100" />
          </div>
        </label>
        <Input label="Fornecedor" value={forn} onChange={e => setForn(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={reutil} onChange={e => setReutil(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Reutilizável (não pesa custo cheio na produção — ex: óleo de fritura)
        </label>
        {(insumo.historicoCusto?.length ?? 0) > 0 && (
          <div className="text-[11px] text-gray-500">Último ajuste: {insumo.custoAtualizadoEm ? new Date(insumo.custoAtualizadoEm).toLocaleDateString("pt-BR") : "—"} · {insumo.historicoCusto!.length} registro(s)</div>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

// Mescla um insumo em outro: reaponta todas as fichas e inativa o duplicado.
function MesclarInsumoModal({ insumo, insumos, fichas, onClose }: {
  insumo: FtInsumo; insumos: FtInsumo[]; fichas: FtFicha[]; onClose: () => void;
}) {
  const [alvoId, setAlvoId] = useState("");
  const candidatos = insumos.filter(i => i.ativo !== false && i.id !== insumo.id && i.dimensao === insumo.dimensao).sort((a, b) => a.nome.localeCompare(b.nome));
  const [salvando, setSalvando] = useState(false);
  async function mesclar() {
    const alvo = insumos.find(i => i.id === alvoId);
    if (!alvo) { alert("Escolha o insumo destino."); return; }
    if (!confirm(`Mesclar "${insumo.nome}" em "${alvo.nome}"? As fichas passam a usar "${alvo.nome}" e o duplicado é inativado.`)) return;
    setSalvando(true);
    try {
      for (const f of fichas) {
        let mudou = false;
        const subfichas = f.subfichas.map(sf => ({
          ...sf,
          ingredientes: sf.ingredientes.map(ing => {
            if (ing.tipo === "insumo" && ing.refId === insumo.id) { mudou = true; return { ...ing, refId: alvo.id, nomeSnapshot: alvo.nome }; }
            return ing;
          }),
        }));
        if (mudou) await updateDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore({ subfichas }));
      }
      const aliases = Array.from(new Set([...(alvo.aliases || []), insumo.nome]));
      await updateDoc(doc(db, "ftInsumos", alvo.id), sanitizeForFirestore({ aliases }));
      await updateDoc(doc(db, "ftInsumos", insumo.id), { ativo: false });
      onClose();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  return (
    <Modal title={`Mesclar "${insumo.nome}"`} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">Escolha o insumo correto (destino). As fichas que usam "{insumo.nome}" passam a apontar pra ele.</p>
        <Select label="Insumo destino" value={alvoId} onChange={e => setAlvoId(e.target.value)}>
          <option value="">Selecione…</option>
          {candidatos.map(i => <option key={i.id} value={i.id}>{i.nome} ({labelUnidade(i.unidadeBase)})</option>)}
        </Select>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={mesclar} disabled={salvando}>{salvando ? "Mesclando…" : "Mesclar"}</Button></div>
      </div>
    </Modal>
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
