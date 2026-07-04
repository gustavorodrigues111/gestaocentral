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
import type { FtCategoria, FtCategoriaTipo, FtDimensao, FtFicha, FtHistoricoCusto, FtIngrediente, FtInsumo, FtInsumoVariacao, FtSubproduto, FtVinculoRecebimento, RecebimentoNota } from "../../core/types";
import { agruparProdutos, coletarPrecos, custoNaBase, fatorAutomatico, impactoNoCmv, precosPorFornecedor, reconciliar, type LinhaReconc } from "./recebimentoPrecos";
import { DIMENSAO_LABEL, dimensaoDeUnidade, labelUnidade, paraBase, registrarUnidadesCustom, unidadeSugerida, unidadesBase, unidadesDaDimensao, unidadesRendimento } from "./unidades";
import { calcularCusto, insumosComMedia, precoMedio3m } from "./custo";
import { normalizarNome, sugerirInsumos } from "./dedup";
import { fmtBR, fmtBRDateTime } from "../../core/utils/date";
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

// Cria uma unidade de medida customizada (ex.: maço) e a registra pra uso imediato.
async function criarUnidadeMedida(rid: string): Promise<string | null> {
  const nome = window.prompt("Nova unidade de medida (ex: maço, cabeça, bandeja, pote):");
  const u = (nome || "").trim();
  if (!u) return null;
  const id = uid("und");
  await setDoc(doc(db, "ftUnidades", id), sanitizeForFirestore({ id, restaurantId: rid, unidade: u, label: u, ativo: true }));
  registrarUnidadesCustom([{ unidade: u, label: u }]);
  return u;
}

type Tab = "pratos" | "bases" | "insumos";
// Ficha "pendente" = sem ingredientes (ex.: promovida no import, falta montar).
const fichaPendente = (f: FtFicha) => (f.ingredientes || []).length === 0;

// Ordena categorias: PRATOS FINAIS (ficha) seguem a ordem manual do cardápio;
// BASES e INSUMOS são sempre alfabéticos. Assume lista de um tipo só.
function ordenarCats(cats: FtCategoria[]): FtCategoria[] {
  const alfabetico = cats.length > 0 && (cats[0].tipo || "ficha") !== "ficha";
  return [...cats].sort((a, b) => alfabetico ? a.nome.localeCompare(b.nome) : ((a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome)));
}

// Estado da ficha (mesma prioridade da cor do card): revisar → pendente →
// faltam preços → completa. Usado por filtros, contadores e selo do card.
type EstadoFicha = "revisar" | "pendente" | "faltam" | "completa";
function estadoDaFicha(f: FtFicha, insumosCalc: FtInsumo[], fichas: FtFicha[]): EstadoFicha {
  if (f.revisar) return "revisar";
  if (fichaPendente(f)) return "pendente";
  return calcularCusto(f, insumosCalc, fichas).insumosSemCusto.length > 0 ? "faltam" : "completa";
}
const ESTADO_UI: Record<EstadoFicha, { seal: string; cls: string; tint: string; title: string }> = {
  revisar: { seal: "⚑ revisar", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", tint: "border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-900/15 hover:border-rose-400", title: "Precisa de revisão" },
  pendente: { seal: "⏳ pendente", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", tint: "border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-900/15 hover:border-amber-400", title: "Sem ingredientes — monte a receita" },
  faltam: { seal: "💲 faltam preços", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", tint: "border-blue-300 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-900/15 hover:border-blue-400", title: "Receita montada, falta preço de algum insumo" },
  completa: { seal: "✅ completa", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", tint: "border-emerald-300 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-900/15 hover:border-emerald-400", title: "Receita montada e com todos os custos" },
};

export function FichasPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const { can } = useCanAcao(rid || "");
  const [tab, setTab] = useState<Tab>("pratos");
  const [insumos, setInsumos] = useState<FtInsumo[]>([]);
  const [fichas, setFichas] = useState<FtFicha[]>([]);
  const [categorias, setCategorias] = useState<FtCategoria[]>([]);
  const [recebimentos, setRecebimentos] = useState<RecebimentoNota[]>([]);
  const [vinculos, setVinculos] = useState<FtVinculoRecebimento[]>([]);
  const [editando, setEditando] = useState<FtFicha | null>(null);
  const [importando, setImportando] = useState(false);
  const [criandoInsumo, setCriandoInsumo] = useState(false);
  const [catModal, setCatModal] = useState<FtCategoriaTipo | null>(null);
  const [, setUnidadesTick] = useState(0); // força re-render quando chegam unidades custom
  // Filtros da lista de fichas — no topo pra PERSISTIR ao entrar/sair do editor.
  const [subFiltro, setSubFiltro] = useState<"todas" | EstadoFicha>("todas");
  const [catFiltro, setCatFiltro] = useState("");
  const [busca, setBusca] = useState("");
  const [precoModo, setPrecoModo] = useState<"ultimo" | "media">("ultimo");
  function irPara(t: Tab) {
    if ((t === "pratos" || t === "bases") && t !== tab) { setSubFiltro("todas"); setCatFiltro(""); setBusca(""); }
    setTab(t);
  }
  const [rascunho, setRascunho] = useState<{ nReceitas: number; criadoEm: string; comEdicoes: boolean } | null>(null);

  const rascunhoId = pessoa?.id ? `${rid}_${pessoa.id}` : rid;
  useEffect(() => {
    if (!rid || !rascunhoId) return;
    const u = onSnapshot(doc(db, "ftImportRascunhos", rascunhoId), snap => {
      if (!snap.exists()) { setRascunho(null); return; }
      const d = snap.data() as { nReceitas?: number; criadoEm?: string; revisao?: unknown; receitasRaw?: unknown[] };
      const n = d.nReceitas || (Array.isArray(d.receitasRaw) ? d.receitasRaw.length : 0);
      if (!n && !d.revisao) { setRascunho(null); return; }
      setRascunho({ nReceitas: n, criadoEm: d.criadoEm || "", comEdicoes: !!d.revisao });
    }, () => setRascunho(null));
    return () => u();
  }, [rid, rascunhoId]);

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
    const u6 = onSnapshot(query(collection(db, "ftUnidades"), where("restaurantId", "==", rid)),
      s => { registrarUnidadesCustom(s.docs.map(d => d.data() as { unidade: string; label?: string })); setUnidadesTick(t => t + 1); });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
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
        {(tab === "pratos" || tab === "bases") && podeEditar && (
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            {rascunho && (
              <button type="button" onClick={() => setImportando(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/25 text-amber-800 dark:text-amber-200 hover:border-amber-400 shrink-0"
                title={`${rascunho.comEdicoes ? "Rascunho com suas edições" : "Leitura da IA salva"}${rascunho.criadoEm ? " em " + fmtBRDateTime(rascunho.criadoEm) : ""}. Clique pra retomar.`}>
                📌 Rascunho em andamento · {rascunho.nReceitas} receita{rascunho.nReceitas === 1 ? "" : "s"}
              </button>
            )}
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setCatModal(tab === "bases" ? "subficha" : "ficha")}>🏷️ Categorias</Button>
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setImportando(true)}>✨ Importar receita</Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setEditando(novaFicha(rid, tab === "bases", pessoa?.id, pessoa?.nome))}>{tab === "bases" ? "+ Nova base" : "+ Nova ficha"}</Button>
          </div>
        )}
        {tab === "insumos" && podeInsumo && (
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setCatModal("insumo")}>🏷️ Categorias</Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setCriandoInsumo(true)}>+ Criar insumo</Button>
          </div>
        )}
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        <TabBtn ativo={tab === "pratos"} onClick={() => irPara("pratos")}>🍽️ Pratos finais ({fichas.filter(f => f.ativo !== false && !f.ehSubficha).length})</TabBtn>
        <TabBtn ativo={tab === "bases"} onClick={() => irPara("bases")}>🧩 Bases ({fichas.filter(f => f.ativo !== false && f.ehSubficha).length})</TabBtn>
        {podeInsumo && <TabBtn ativo={tab === "insumos"} onClick={() => irPara("insumos")}>Insumos ({insumos.filter(i => i.ativo !== false && !i.ehSubproduto).length})</TabBtn>}
      </nav>

      {(tab === "pratos" || tab === "bases") && <ListaFichas grupo={tab === "bases" ? "subfichas" : "finais"} fichas={fichas} insumos={insumos} categorias={categorias} onEditar={setEditando} podeEditar={podeEditar}
        subFiltro={subFiltro} setSubFiltro={setSubFiltro} catFiltro={catFiltro} setCatFiltro={setCatFiltro} busca={busca} setBusca={setBusca} precoModo={precoModo} setPrecoModo={setPrecoModo} />}
      {tab === "bases" && podeInsumo && <SubprodutosPanel insumos={insumos} fichas={fichas} categorias={categorias} recebimentos={recebimentos} vinculos={vinculos} meId={pessoa?.id} />}
      {tab === "insumos" && podeInsumo && <CadastroInsumos rid={rid} insumos={insumos} fichas={fichas} categorias={categorias} recebimentos={recebimentos} vinculos={vinculos} meId={pessoa?.id} />}

      {importando && (
        <ImportarFichasModal rid={rid} insumos={insumos} categorias={categorias} fichasExistentes={fichas} meId={pessoa?.id} meNome={pessoa?.nome} onClose={() => setImportando(false)} />
      )}
      {criandoInsumo && (
        <CriarInsumoModal rid={rid} nomeInicial="" insumos={insumos} categorias={categorias} meId={pessoa?.id} onCriado={() => setCriandoInsumo(false)} onClose={() => setCriandoInsumo(false)} />
      )}
      {catModal && podeEditar && (
        <CategoriasModal rid={rid} categorias={categorias} tipo={catModal} onClose={() => setCatModal(null)} />
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
function ListaFichas({ grupo, fichas, insumos, categorias, onEditar, podeEditar, subFiltro, setSubFiltro, catFiltro, setCatFiltro, busca, setBusca, precoModo, setPrecoModo }: {
  grupo: "finais" | "subfichas"; fichas: FtFicha[]; insumos: FtInsumo[]; categorias: FtCategoria[]; onEditar: (f: FtFicha) => void; podeEditar: boolean;
  subFiltro: "todas" | EstadoFicha; setSubFiltro: (v: "todas" | EstadoFicha) => void;
  catFiltro: string; setCatFiltro: (v: string) => void;
  busca: string; setBusca: (v: string) => void;
  precoModo: "ultimo" | "media"; setPrecoModo: (v: "ultimo" | "media") => void;
}) {
  const buscaNorm = normalizarNome(busca);
  const hoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const insumosCalc = useMemo(() => precoModo === "media" ? insumosComMedia(insumos, hoje) : insumos, [precoModo, insumos, hoje]);
  const doGrupo = useMemo(() => fichas.filter(f => f.ativo !== false && (grupo === "subfichas" ? f.ehSubficha : !f.ehSubficha)), [fichas, grupo]);
  // Estado de cada ficha do grupo, calculado 1x (dirige filtros, contadores e selo).
  const estados = useMemo(() => {
    const m = new Map<string, EstadoFicha>();
    for (const f of doGrupo) m.set(f.id, estadoDaFicha(f, insumosCalc, fichas));
    return m;
  }, [doGrupo, insumosCalc, fichas]);
  const cont = useMemo(() => {
    const c = { revisar: 0, pendente: 0, faltam: 0, completa: 0 };
    for (const e of estados.values()) c[e]++;
    return c;
  }, [estados]);
  const catsGrupo = ordenarCats(categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === (grupo === "subfichas" ? "subficha" : "ficha")));
  const lista = useMemo(() => doGrupo
    .filter(f => subFiltro === "todas" ? true : estados.get(f.id) === subFiltro)
    .filter(f => !catFiltro ? true : catFiltro === "__sem__" ? (!f.categoriaId || !catsGrupo.some(c => c.id === f.categoriaId)) : f.categoriaId === catFiltro)
    .filter(f => !buscaNorm || normalizarNome(f.nome).includes(buscaNorm))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [doGrupo, subFiltro, catFiltro, estados, buscaNorm]);

  if (fichas.filter(f => f.ativo !== false).length === 0) return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
      Nenhuma ficha ainda. Crie uma ficha de prato final, uma ficha de base, ou importe uma receita.
    </div>
  );

  const filtros: [("todas" | EstadoFicha), string, string][] = [
    ["todas", "Todas", "text-gray-500"],
    ["pendente", `⏳ Pendentes${cont.pendente ? ` (${cont.pendente})` : ""}`, "text-amber-700 dark:text-amber-400"],
    ["revisar", `⚑ Revisar${cont.revisar ? ` (${cont.revisar})` : ""}`, "text-rose-600 dark:text-rose-400"],
    ["faltam", `💲 Faltam preços${cont.faltam ? ` (${cont.faltam})` : ""}`, "text-blue-600 dark:text-blue-400"],
    ["completa", `✅ Prontas${cont.completa ? ` (${cont.completa})` : ""}`, "text-emerald-600 dark:text-emerald-400"],
  ];
  return (
    <div className="space-y-3">
      {/* Busca + modo de preço */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔎</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={grupo === "subfichas" ? "Buscar base…" : "Buscar prato…"} className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
          {busca && <button type="button" onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm">✕</button>}
        </div>
        <span className="text-[11px] text-gray-400 hidden sm:inline">Custo por:</span>
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {([["ultimo", "Último preço"], ["media", "Média 3 meses"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setPrecoModo(m)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${precoModo === m ? "bg-white dark:bg-gray-900 text-emerald-700 dark:text-emerald-300 shadow-sm" : "text-gray-500"}`}>{label}</button>
          ))}
        </div>
      </div>
      {/* Filtros por estado (cor) */}
      <div className="flex items-center gap-2 flex-wrap">
        {filtros.map(([t, label, hint]) => (
          <button key={t} type="button" onClick={() => setSubFiltro(t)}
            className={`px-3 py-1 text-xs font-medium rounded-full border ${subFiltro === t ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : `border-gray-200 dark:border-gray-800 ${t !== "todas" && cont[t as EstadoFicha] > 0 ? hint : "text-gray-500"}`}`}>{label}</button>
        ))}
        <div className="flex-1" />
        {catsGrupo.length > 0 && (
          <select value={catFiltro} onChange={e => setCatFiltro(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
            <option value="">Todas categorias</option>
            <option value="__sem__">Sem categoria</option>
            {catsGrupo.map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
          </select>
        )}
      </div>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nada nesse filtro.</div>
      ) : (
        (() => {
          const renderCard = (f: FtFicha) => {
            const c = calcularCusto(f, insumosCalc, fichas);
            const estado = ESTADO_UI[estados.get(f.id) || "completa"];
            return (
              <button key={f.id} type="button" onClick={() => podeEditar && onEditar(f)}
                className={`text-left rounded-2xl border shadow-sm p-4 transition-colors ${estado.tint}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{f.nome || "(sem nome)"}</div>
                    <div className="text-xs text-gray-500">rende {fmtQtd(f.rendimento.qtd)} {labelUnidade(f.rendimento.unidade)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {f.ehSubficha
                      ? <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">🧩 base</span>
                      : <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title="Prato final — vai pro cardápio">🍽️ cardápio</span>}
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${estado.cls}`} title={f.revisar ? (f.revisarMotivo || estado.title) : estado.title}>{estado.seal}</span>
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
          };
          const catIds = new Set(catsGrupo.map(c => c.id));
          const grupos: { nome: string; itens: FtFicha[] }[] = [
            ...catsGrupo.map(cat => ({ nome: cat.nome, itens: lista.filter(f => f.categoriaId === cat.id) })),
            { nome: "Sem categoria", itens: lista.filter(f => !f.categoriaId || !catIds.has(f.categoriaId)) },
          ].filter(g => g.itens.length > 0);
          return (
            <div className="space-y-5">
              {grupos.map(g => (
                <div key={g.nome}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{g.nome} <span className="text-gray-400 font-normal normal-case">· {g.itens.length}</span></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{g.itens.map(renderCard)}</div>
                </div>
              ))}
            </div>
          );
        })()
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
  const [converter, setConverter] = useState<{ nome: string; fc: number } | null>(null);
  const custo = useMemo(() => calcularCusto(f, insumos, fichas), [f, insumos, fichas]);
  const insumoById = useMemo(() => new Map(insumos.map(i => [i.id, i])), [insumos]);
  // Ficha com 1 único ingrediente-insumo → candidata a virar variação desse insumo.
  const ingUnico = f.ingredientes.length === 1 && f.ingredientes[0].tipo === "insumo" ? f.ingredientes[0] : null;
  const insumoUnico = ingUnico ? insumoById.get(ingUnico.refId) || null : null;
  const fichasQueUsam = useMemo(() => fichas.filter(x => x.ativo !== false && x.id !== f.id && (x.ingredientes || []).some(i => i.tipo === "ficha" && i.refId === f.id)), [fichas, f.id]);
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
  function removeSub(id: string) {
    // Devolve pra "pendentes" qualquer insumo-subproduto que estava vinculado a
    // esta saída — senão fica órfão (subprodutoDe aponta pra um subId que sumiu).
    for (const i of insumos.filter(i => i.subprodutoDe && i.subprodutoDe.fichaId === f.id && i.subprodutoDe.subId === id && i.ativo !== false)) {
      updateDoc(doc(db, "ftInsumos", i.id), { subprodutoDe: null }).catch(() => {});
    }
    setF(p => ({ ...p, subprodutos: (p.subprodutos || []).filter(sp => sp.id !== id) }));
  }

  async function salvar() {
    if (!f.nome.trim()) { alert("Dê um nome pra receita."); return; }
    if (somaPctSub > 100) { alert("A soma dos % dos subprodutos passou de 100%."); return; }
    setSalvando(true);
    try {
      // Subproduto vinculado a um insumo herda o nome do insumo (não some no save).
      const subprodutos = (f.subprodutos || [])
        .map(sp => { const vinc = insumos.find(i => i.subprodutoDe && i.subprodutoDe.fichaId === f.id && i.subprodutoDe.subId === sp.id && i.ativo !== false); return { ...sp, nome: sp.nome.trim() || (vinc ? vinc.nome : "") }; })
        .filter(sp => sp.nome.trim())
        .map(sp => ({ ...sp, nome: UP(sp.nome), nomeNormalizado: normalizarNome(sp.nome) }));
      await setDoc(doc(db, "ftFichas", f.id), sanitizeForFirestore({ ...f, nome: UP(f.nome), nomeNormalizado: normalizarNome(f.nome), subprodutos }));
      onClose();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  async function excluir() {
    if (!confirm(`Excluir "${f.nome}"?`)) return;
    // Solta os insumos-subproduto vinculados a esta ficha → voltam pra pendentes.
    for (const i of insumos.filter(i => i.subprodutoDe && i.subprodutoDe.fichaId === f.id && i.ativo !== false)) {
      updateDoc(doc(db, "ftInsumos", i.id), { subprodutoDe: null }).catch(() => {});
    }
    await updateDoc(doc(db, "ftFichas", f.id), { ativo: false });
    onClose();
  }
  // Cria categoria nova (do grupo atual) e já seleciona na ficha.
  async function novaCategoria() {
    const nome = window.prompt(`Nova categoria de ${f.ehSubficha ? "base" : "prato final"}:`);
    if (!nome || !nome.trim()) return;
    const id = uid("cat");
    const tipo: FtCategoriaTipo = f.ehSubficha ? "subficha" : "ficha";
    const ordem = Math.max(0, ...catsAtivas.filter(c => (c.tipo || "ficha") === tipo).map(c => c.ordem ?? 0)) + 1;
    try {
      await setDoc(doc(db, "ftCategorias", id), sanitizeForFirestore({ id, restaurantId: rid, nome: UP(nome), tipo, ordem, ativo: true } as FtCategoria));
      setF(p => ({ ...p, categoriaId: id }));
    } catch (e) { alert("Erro ao criar categoria: " + (e instanceof Error ? e.message : String(e))); }
  }
  // Usuário dispensou converter esta ficha em variação → não perguntar de novo.
  async function dispensarConverter() {
    setF(p => ({ ...p, semConverter: true }));
    try { await updateDoc(doc(db, "ftFichas", f.id), { semConverter: true }); } catch { /* ficha ainda não salva; fica no state */ }
  }
  // Abre o painel "converter esta ficha em variação do ingrediente único".
  function abrirConverter() {
    if (!ingUnico || !insumoUnico) return;
    const nome = UP(f.nome).replace(UP(insumoUnico.nome), "").replace(/\s+/g, " ").trim() || "LIMPO";
    const rb = paraBase(f.rendimento.qtd, f.rendimento.unidade);
    const ib = paraBase(ingUnico.qtd, ingUnico.unidade);
    const fc = rb && ib && ib > 0 ? Math.round((rb / ib) * 100) : 100; // fc inteiro
    setConverter({ nome, fc });
  }
  async function confirmarConverter() {
    if (!ingUnico || !insumoUnico || !converter) return;
    const nomeVar = UP(converter.nome).trim();
    if (!nomeVar) { alert("Dê um nome pra variação (ex: LIMPO)."); return; }
    const fc = Math.round(converter.fc > 0 ? converter.fc : 100); // fc sempre inteiro
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      // 1. adiciona a variação ao insumo (sem duplicar por nome)
      const jaTem = (insumoUnico.variacoes || []).find(v => normalizarNome(v.nome) === normalizarNome(nomeVar));
      const variacoes = jaTem
        ? (insumoUnico.variacoes || []).map(v => v === jaTem ? { ...v, fc } : v)
        : [...(insumoUnico.variacoes || []), { id: uid("var"), nome: nomeVar, fc }];
      batch.update(doc(db, "ftInsumos", insumoUnico.id), sanitizeForFirestore({ variacoes }));
      // 2. religa quem usava esta ficha → passa a usar o insumo com a variação
      for (const x of fichasQueUsam) {
        const ingredientes = x.ingredientes.map(i => (i.tipo === "ficha" && i.refId === f.id)
          ? ({ ...i, tipo: "insumo", refId: insumoUnico!.id, nomeSnapshot: insumoUnico!.nome, variacaoNome: nomeVar, fc } as FtIngrediente)
          : i);
        batch.update(doc(db, "ftFichas", x.id), sanitizeForFirestore({ ingredientes }));
      }
      // 3. desativa esta ficha (virou variação)
      batch.update(doc(db, "ftFichas", f.id), { ativo: false });
      await batch.commit();
      onClose();
    } catch (e) { alert("Erro ao converter: " + (e instanceof Error ? e.message : String(e))); setSalvando(false); }
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">← Voltar</button>
        <div className="ml-auto">
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
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{f.ehSubficha ? "Categoria (base)" : "Categoria (cardápio)"}</span>
                  <button type="button" onClick={() => void novaCategoria()} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline shrink-0">+ nova</button>
                </div>
                <select value={f.categoriaId || ""} onChange={e => setF({ ...f, categoriaId: e.target.value || null })} className="w-full px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100 h-9">
                  <option value="">— sem categoria —</option>
                  {catsAtivas.filter(c => (c.tipo || "ficha") === (f.ehSubficha ? "subficha" : "ficha")).map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo</span>
                <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 h-9">
                  <button type="button" onClick={() => setF({ ...f, ehSubficha: false })} className={`px-3 text-xs font-medium rounded-md whitespace-nowrap ${!f.ehSubficha ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>🍽️ Prato final</button>
                  <button type="button" onClick={() => setF({ ...f, ehSubficha: true })} className={`px-3 text-xs font-medium rounded-md whitespace-nowrap ${f.ehSubficha ? "bg-white dark:bg-gray-900 text-purple-700 dark:text-purple-300 shadow-sm" : "text-gray-500"}`}>🧩 Base</button>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{f.ehSubficha ? "🧩 Ficha de base — reutilizável como ingrediente de outras fichas; não vai pro cardápio." : "🍽️ Ficha de prato final — vai pro cardápio (entra no CMV)."}</div>
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
            {insumoUnico && !f.semConverter && !converter && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3 flex items-center gap-3 flex-wrap">
                <div className="text-xs text-indigo-800 dark:text-indigo-200 flex-1 min-w-[200px]">
                  💡 Esta ficha tem <strong>1 ingrediente só</strong> ({insumoUnico.nome}). Talvez faça mais sentido como <strong>variação</strong> desse insumo (com fator de correção), em vez de uma ficha.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" onClick={abrirConverter}>Converter</Button>
                  <Button variant="ghost" size="sm" onClick={() => void dispensarConverter()}>Não, manter ficha</Button>
                </div>
              </div>
            )}
            {f.ingredientes.length > 0 && (
              <div className="space-y-1">
                {f.ingredientes.map(ing => (
                  <IngredienteRow key={ing.id} ing={ing} insumoById={insumoById} subfichas={subfichasDisp} subprodutos={subprodutosDisp}
                    onPatch={p => patchIng(ing.id, p)} onRemove={() => removeIng(ing.id)} />
                ))}
              </div>
            )}
            <IngredientePicker insumos={insumos} subfichas={subfichasDisp} subprodutos={subprodutosDisp} categorias={categorias} rid={rid} meId={meId} podeInsumo={podeInsumo} onAdd={addIngrediente} />
          </div>

          {/* Subprodutos (coprodutos) */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{(f.subprodutos || []).length > 0 ? "Saídas do preparo" : "Subprodutos"}</div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${somaPctSub > 100 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>Principal fica com {Math.max(0, 100 - somaPctSub)}%</span>
            </div>
            <p className="text-[11px] text-gray-400">Coprodutos que este preparo também rende (ex.: carcaça, caldo do cozimento). O custo do preparo é <strong>dividido</strong> entre a saída principal e os subprodutos por %; cada saída tem o seu próprio rendimento (não é o mesmo do topo). Depois entram como ingrediente em outras fichas.</p>
            {/* Saída PRINCIPAL — mesmo rendimento do topo (vinculado, não duplicado). */}
            {(f.subprodutos || []).length > 0 && (
              <div className="flex items-center gap-2 flex-wrap py-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-900/15 px-2">
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">principal</span>
                <span className="flex-1 min-w-[100px] text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{f.nome || "(principal)"}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">rende</span>
                  <QtyStepper qtd={f.rendimento.qtd} unidade={f.rendimento.unidade} unidades={unidadesRendimento().map(u => u.unidade)} unidadeTravada={false}
                    onQtd={n => setF({ ...f, rendimento: { ...f.rendimento, qtd: n } })} onUnidade={u => setF({ ...f, rendimento: { ...f.rendimento, unidade: u } })} />
                </div>
                <span className="inline-flex items-center justify-center h-9 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 text-sm text-gray-600 dark:text-gray-300 shrink-0 tabular-nums">{Math.max(0, 100 - somaPctSub)}<span className="text-[11px] text-gray-400 ml-1">% custo</span></span>
                <span className="text-xs text-gray-700 dark:text-gray-200 font-medium w-20 text-right tabular-nums shrink-0">{fmtMoeda(custo.total)}</span>
                <span className="w-5 shrink-0" />
              </div>
            )}
            {(f.subprodutos || []).map(sp => {
              const r = custo.subprodutos.find(x => x.id === sp.id);
              const vinc = insumos.find(i => i.subprodutoDe && i.subprodutoDe.fichaId === f.id && i.subprodutoDe.subId === sp.id && i.ativo !== false);
              const pendentes = insumos.filter(i => i.ehSubproduto && !i.subprodutoDe && i.ativo !== false);
              return (
                <div key={sp.id} className="py-2 border-t border-gray-100 dark:border-gray-800 first:border-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input value={sp.nome || (vinc ? vinc.nome : "")} onChange={e => patchSub(sp.id, { nome: e.target.value.toUpperCase() })} placeholder="ex: CARCAÇA" className="flex-1 min-w-[120px] h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">rende</span>
                      <QtyStepper qtd={sp.rendimentoQtd} unidade={sp.unidade} unidades={unidadesRendimento().map(u => u.unidade)} unidadeTravada={false}
                        onQtd={n => patchSub(sp.id, { rendimentoQtd: n })} onUnidade={u => patchSub(sp.id, { unidade: u })} />
                    </div>
                    <div className="inline-flex items-center h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm px-2 gap-1 shrink-0">
                      <input type="text" inputMode="decimal" value={sp.percentualCusto} onChange={e => patchSub(sp.id, { percentualCusto: Math.max(0, Math.min(100, Number(String(e.target.value).replace(",", ".")) || 0)) })} className="w-10 text-right bg-transparent text-sm outline-none dark:text-gray-100" />
                      <span className="text-[11px] text-gray-400">% custo</span>
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right tabular-nums shrink-0">{r ? fmtMoeda(r.custo) : "—"}</span>
                    <button type="button" onClick={() => removeSub(sp.id)} title="remover" className="text-gray-400 hover:text-red-600 text-base px-1 shrink-0">✕</button>
                  </div>
                  {(vinc || pendentes.length > 0) && (
                    <div className="flex items-center gap-2 flex-wrap text-[11px] pl-0.5">
                      {vinc
                        ? <span className="text-orange-600 dark:text-orange-400">🔗 vinculado ao insumo “{vinc.nome}” <button type="button" onClick={() => updateDoc(doc(db, "ftInsumos", vinc.id), { subprodutoDe: null })} className="text-gray-400 hover:text-red-600 underline ml-1">desvincular</button></span>
                        : <>
                            <span className="text-gray-500">Vincular insumo-subproduto pendente:</span>
                            <select value="" onChange={e => { const id = e.target.value; if (!id) return; const ins = pendentes.find(i => i.id === id); updateDoc(doc(db, "ftInsumos", id), { subprodutoDe: { fichaId: f.id, subId: sp.id } }); if (ins && !sp.nome.trim()) patchSub(sp.id, { nome: ins.nome, unidade: ins.unidadeBase }); }} className="h-8 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100"><option value="">escolher…</option>{pendentes.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}</select>
                            <span className="text-gray-400">(salve a ficha depois)</span>
                          </>}
                    </div>
                  )}
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
          {custo.insumosSemCusto.length > 0 && (() => {
            const nomes = new Set(custo.insumosSemCusto);
            const semPreco = insumos.filter(i => i.ativo !== false && !i.ehSubproduto && nomes.has(i.nome));
            const outros = custo.insumosSemCusto.filter(n => !semPreco.some(i => i.nome === n));
            return (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2.5 space-y-2">
                <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">💲 Faltam preços ({custo.insumosSemCusto.length}) — cadastro rápido</div>
                {semPreco.map(i => <PrecoRapido key={i.id} insumo={i} meId={meId} />)}
                {outros.length > 0 && <div className="text-[10px] text-amber-700 dark:text-amber-300">Também sem custo: {outros.join(", ")}.</div>}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={excluir}>🗑️ Excluir ficha</Button>
          {insumoUnico && (
            <Button variant="ghost" size="sm" onClick={abrirConverter} title="Esta ficha tem 1 ingrediente só — transforme em variação (fator de correção) desse insumo">🔀 Converter em variação de ingrediente</Button>
          )}
        </div>
        <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </div>

      {converter && insumoUnico && ingUnico && (
        <Modal title="🔀 Converter em variação de ingrediente" onClose={() => setConverter(null)} maxWidth="max-w-md">
          <div className="space-y-3 text-sm">
            <p className="text-gray-600 dark:text-gray-300">
              Esta ficha vira uma <strong>variação</strong> do insumo <strong>{insumoUnico.nome}</strong> com um fator de correção.
              A ficha “{UP(f.nome)}” é desativada e quem a usa passa a usar <strong>{insumoUnico.nome}</strong> na variação.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Nome da variação</span>
              <input value={converter.nome} onChange={e => setConverter(c => c && { ...c, nome: e.target.value.toUpperCase() })} placeholder="ex: LIMPO" className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Aproveitamento (fc)</span>
                <div className="flex items-center gap-1"><input type="number" step={1} value={converter.fc} onChange={e => setConverter(c => c && { ...c, fc: Math.round(Number(e.target.value) || 0) })} className="w-20 px-2 py-2 text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" /><span className="text-xs text-gray-400">%</span></div>
              </div>
              <p className="text-[11px] text-gray-400 flex-1">Calculado do rendimento ({fmtQtd(f.rendimento.qtd)} {labelUnidade(f.rendimento.unidade)}) ÷ quantidade usada ({fmtQtd(ingUnico.qtd)} {labelUnidade(ingUnico.unidade)}). Ajuste se precisar.</p>
            </div>
            {fichasQueUsam.length > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                Usada em <strong>{fichasQueUsam.length}</strong> ficha(s) — serão religadas automaticamente ao insumo com esta variação.
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setConverter(null)}>Cancelar</Button>
              <Button onClick={confirmarConverter} disabled={salvando || !converter.nome.trim()}>{salvando ? "Convertendo…" : "Confirmar conversão"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Stepper pílula ─────────────────────────────────────────────────────────
const round3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const fmtQtd = (n: number) => (n || 0).toFixed(3).replace(".", ","); // sempre 3 casas c/ vírgula
const parseQtd = (s: string) => Number(String(s).replace(",", ".")) || 0;
function QtyStepper({ qtd, unidade, unidades, unidadeTravada, onQtd, onUnidade }: {
  qtd: number; unidade: string; unidades: string[]; unidadeTravada: boolean;
  onQtd: (n: number) => void; onUnidade: (u: string) => void;
}) {
  const [txt, setTxt] = useState(fmtQtd(qtd));
  useEffect(() => { if (parseQtd(txt) !== qtd) setTxt(fmtQtd(qtd)); }, [qtd]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="inline-flex items-center h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_2px_8px_-3px_rgba(99,102,241,0.4)] dark:shadow-[0_2px_10px_-3px_rgba(99,102,241,0.55)] shrink-0 px-1">
      <button type="button" onClick={() => onQtd(Math.max(0, round3(qtd - passoDe(qtd))))} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-lg leading-none" aria-label="diminuir">−</button>
      <input type="text" inputMode="decimal" value={txt} onChange={e => { const raw = e.target.value.replace(/[^0-9.,]/g, ""); setTxt(raw); onQtd(parseQtd(raw)); }} onBlur={() => setTxt(fmtQtd(qtd))} className="w-14 text-center bg-transparent text-sm outline-none dark:text-gray-100" />
      {unidadeTravada
        ? <span className="text-xs text-gray-400 min-w-[24px] text-center">{labelUnidade(unidade)}</span>
        : <select value={unidade} onChange={e => onUnidade(e.target.value)} className="bg-transparent text-xs font-medium text-gray-500 dark:text-gray-400 outline-none appearance-none text-center cursor-pointer pr-0.5">
            {unidades.map(u => <option key={u} value={u}>{labelUnidade(u)}</option>)}
          </select>}
      <button type="button" onClick={() => onQtd(round3(qtd + passoDe(qtd)))} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-lg leading-none" aria-label="aumentar">+</button>
    </div>
  );
}

// Cadastro rápido de preço de um insumo, direto do painel de custo da ficha.
// Salva no insumo (custo + histórico) → recalcula a ficha e some da lista.
function PrecoRapido({ insumo, meId }: { insumo: FtInsumo; meId?: string }) {
  const [v, setV] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    const c = parseMoeda(v); if (!(c > 0)) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const hist = [...(insumo.historicoCusto || []), { custo: c, data: now, por: meId || null }].slice(-20);
      await updateDoc(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ custo: c, custoAtualizadoEm: now, historicoCusto: hist }));
      // some da lista assim que o snapshot atualizar; limpa por garantia
      setV("");
    } catch (e) { alert("Erro ao salvar preço: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSalvando(false); }
  }
  return (
    <div className="space-y-1 border-t border-amber-200/60 dark:border-amber-800/40 pt-1.5 first:border-0 first:pt-0">
      <div className="text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate" title={insumo.nome}>{insumo.nome}</div>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 h-8 px-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 flex-1 min-w-0">
          <span className="text-[10px] text-gray-400">R$</span>
          <input value={v} onChange={e => setV(maskMoeda(e.target.value))} onKeyDown={e => { if (e.key === "Enter") void salvar(); }} inputMode="numeric" placeholder="0,00" className="flex-1 min-w-0 bg-transparent text-right text-xs outline-none dark:text-gray-100" />
          <span className="text-[10px] text-gray-400 shrink-0">/{labelUnidade(insumo.unidadeBase)}</span>
        </div>
        <button type="button" onClick={() => void salvar()} disabled={salvando || !(parseMoeda(v) > 0)} className="h-8 px-3 rounded-lg bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-40 shrink-0">{salvando ? "…" : "Salvar"}</button>
      </div>
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

function IngredientePicker({ insumos, subfichas, subprodutos, categorias, rid, meId, podeInsumo, onAdd }: {
  insumos: FtInsumo[]; subfichas: FtFicha[]; subprodutos: { ficha: FtFicha; sp: FtSubproduto }[]; categorias?: FtCategoria[]; rid: string; meId?: string; podeInsumo: boolean; onAdd: (ing: FtIngrediente) => void;
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
      qtd: 1, unidade: unidadeSugerida(ins.dimensao),
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
        <CriarInsumoModal rid={rid} nomeInicial={busca.trim()} insumos={insumos} categorias={categorias} meId={meId}
          onCriado={(ins) => { setCriando(false); setBusca(""); pickInsumo(ins); }} onClose={() => setCriando(false)} />
      )}
    </div>
  );
}

// Subprodutos (coprodutos que saem de preparos) — vivem na aba Bases, não em
// Insumos, porque são PRODUZIDOS (não comprados). Referenciáveis como ingrediente.
function SubprodutosPanel({ insumos, fichas, categorias, recebimentos, vinculos, meId }: { insumos: FtInsumo[]; fichas: FtFicha[]; categorias: FtCategoria[]; recebimentos: RecebimentoNota[]; vinculos: FtVinculoRecebimento[]; meId?: string }) {
  const [editar, setEditar] = useState<FtInsumo | null>(null);
  const subs = insumos.filter(i => i.ativo !== false && i.ehSubproduto).sort((a, b) => a.nome.localeCompare(b.nome));
  const usoMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fichas) { if (f.ativo === false) continue; for (const ing of f.ingredientes || []) if (ing.tipo === "insumo") m.set(ing.refId, (m.get(ing.refId) || 0) + 1); }
    return m;
  }, [fichas]);
  const paiDe = (i: FtInsumo) => i.subprodutoDe ? (fichas.find(f => f.id === i.subprodutoDe!.fichaId)?.nome || "(preparo removido)") : null;
  if (subs.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">🔄 Subprodutos <span className="text-gray-400 font-normal normal-case">· saem de preparos (não são comprados) · {subs.length}</span></div>
      <ListaCard vazio={false} vazioTexto="">
        {subs.map(ins => {
          const pai = paiDe(ins); const uso = usoMap.get(ins.id) || 0;
          return (
            <div key={ins.id} onClick={() => setEditar(ins)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 group cursor-pointer" title="Editar subproduto">
              <div className="w-9 h-9 rounded-full bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center text-base shrink-0">🔄</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ins.nome}
                  <span className={`ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ins.subprodutoDe ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{ins.subprodutoDe ? "🔗 vinculado" : "⏳ sem vínculo"}</span>
                </div>
                <div className="text-xs text-gray-500">{pai ? `de ${pai}` : "vincule ao preparo que o gera"} · {uso > 0 ? `usado em ${uso} ficha${uso === 1 ? "" : "s"}` : "não usado"}</div>
              </div>
              <span className="text-[11px] text-gray-400 shrink-0">custo do preparo</span>
              <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Editar</span>
            </div>
          );
        })}
      </ListaCard>
      {editar && <EditarCustoModal insumo={editar} fichas={fichas} categorias={categorias} recebimentos={recebimentos} vinculos={vinculos} meId={meId} onClose={() => setEditar(null)} />}
    </div>
  );
}

function CriarInsumoModal({ rid, nomeInicial, insumos, categorias, meId, onCriado, onClose }: {
  rid: string; nomeInicial: string; insumos: FtInsumo[]; categorias?: FtCategoria[]; meId?: string; onCriado: (ins: FtInsumo) => void; onClose: () => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [unidadeBase, setUnidadeBase] = useState("kg");
  const [custo, setCusto] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const catsIns = (categorias || []).filter(c => c.ativo !== false && (c.tipo || "ficha") === "insumo").sort((a, b) => a.nome.localeCompare(b.nome));
  const similares = useMemo(() => sugerirInsumos(nome, insumos), [nome, insumos]);
  async function salvar() {
    if (!nome.trim()) return;
    const dim = dimensaoDeUnidade(unidadeBase) as FtDimensao;
    const id = uid("ins"); const now = new Date().toISOString(); const c = parseMoeda(custo);
    const ins: FtInsumo = {
      id, restaurantId: rid, nome: UP(nome), nomeNormalizado: normalizarNome(nome), dimensao: dim, unidadeBase, custo: c,
      custoAtualizadoEm: c > 0 ? now : null, historicoCusto: c > 0 ? [{ custo: c, data: now, por: meId || null }] : [],
      fornecedorPadrao: fornecedor.trim() || null, reutilizavel: false, categoriaId: categoriaId || null, aliases: [], ativo: true,
    };
    await setDoc(doc(db, "ftInsumos", id), sanitizeForFirestore(ins));
    onCriado(ins);
  }
  return (
    <Modal title="Novo insumo" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={e => setNome(e.target.value.toUpperCase())} placeholder="ex: SAL REFINADO" />
        {similares.length > 0 && <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-200">Já existe parecido: {similares.slice(0, 3).map(s => s.insumo.nome).join(", ")}. Confira pra não duplicar.</div>}
        <div className="grid grid-cols-2 gap-2">
          <Select label="Unidade base" value={unidadeBase} onChange={async e => { if (e.target.value === "__nova__") { const nu = await criarUnidadeMedida(rid); if (nu) setUnidadeBase(nu); } else setUnidadeBase(e.target.value); }}>
            {unidadesBase().map(u => <option key={u.unidade} value={u.unidade}>{u.label}{DIMENSAO_LABEL[u.dimensao] ? ` (${DIMENSAO_LABEL[u.dimensao]})` : ""}</option>)}
            <option value="__nova__">+ criar unidade…</option>
          </Select>
          <CampoMoeda label={`Custo por ${unidadeBase}`} value={custo} onChange={e => setCusto(maskMoeda(e.target.value))} />
        </div>
        {catsIns.length > 0 && (
          <Select label="Categoria" value={categoriaId} onChange={e => setCategoriaId(e.target.value)}>
            <option value="">— sem categoria —</option>
            {catsIns.map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
          </Select>
        )}
        <Input label="Fornecedor (opcional)" value={fornecedor} onChange={e => setFornecedor(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Criar e usar</Button></div>
      </div>
    </Modal>
  );
}

// ─── Aba Insumos ──────────────────────────────────────────────────────────
function CadastroInsumos({ rid, insumos, fichas, categorias, recebimentos, vinculos, meId }: { rid: string; insumos: FtInsumo[]; fichas: FtFicha[]; categorias: FtCategoria[]; recebimentos: RecebimentoNota[]; vinculos: FtVinculoRecebimento[]; meId?: string }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "semcusto">("todas");
  const [catFiltro, setCatFiltro] = useState("");
  const [editar, setEditar] = useState<FtInsumo | null>(null); const [mesclar, setMesclar] = useState<FtInsumo | null>(null);
  const [sincronizar, setSincronizar] = useState(false);
  const hoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const reconc = useMemo(() => reconciliar(agruparProdutos(coletarPrecos(recebimentos)), insumos, vinculos), [recebimentos, insumos, vinculos]);
  const nPrecoNovo = reconc.vinculados.filter(l => l.precoNovo).length;
  const nSugeridos = reconc.sugeridos.length;
  const catsIns = ordenarCats(categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === "insumo"));
  const catIds = new Set(catsIns.map(c => c.id));
  // Onde cada insumo é usado (nome das fichas que o têm como ingrediente).
  const usoMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of fichas) {
      if (f.ativo === false) continue;
      for (const ing of f.ingredientes || []) {
        if (ing.tipo !== "insumo") continue;
        const arr = m.get(ing.refId) || []; if (!arr.includes(f.nome)) arr.push(f.nome); m.set(ing.refId, arr);
      }
    }
    return m;
  }, [fichas]);
  const buscaNorm = normalizarNome(busca);
  const semCusto = (i: FtInsumo) => !i.ehSubproduto && !(i.custo > 0);
  const nSemCusto = insumos.filter(i => i.ativo !== false && !i.ehSubproduto && semCusto(i)).length;
  // Subprodutos (saem de preparos) NÃO são insumos comprados — vivem na aba Bases.
  const ativos = insumos.filter(i => i.ativo !== false && !i.ehSubproduto)
    .filter(i => filtro === "todas" ? true : semCusto(i))
    .filter(i => !catFiltro ? true : catFiltro === "__sem__" ? (!i.categoriaId || !catIds.has(i.categoriaId)) : (i.categoriaId || "") === catFiltro)
    .filter(i => !buscaNorm || normalizarNome(i.nome).includes(buscaNorm))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  // Cria categoria de insumo na hora (via prompt) e já vincula ao insumo.
  async function novaCatInsumo(insId: string) {
    const nome = window.prompt("Nova categoria de insumo:");
    if (!nome || !nome.trim()) return;
    const id = uid("cat");
    try {
      await setDoc(doc(db, "ftCategorias", id), sanitizeForFirestore({ id, restaurantId: rid, nome: UP(nome), tipo: "insumo", ordem: catsIns.length, ativo: true } as FtCategoria));
      await updateDoc(doc(db, "ftInsumos", insId), { categoriaId: id });
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); }
  }
  const renderRow = (ins: FtInsumo) => (
    <div key={ins.id} onClick={() => setEditar(ins)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 group cursor-pointer" title="Editar insumo">
      <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-base shrink-0">🧂</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ins.nome}
          {ins.ehSubproduto && <span className={`ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ins.subprodutoDe ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{ins.subprodutoDe ? "subproduto 🔗" : "subproduto ⏳ sem vínculo"}</span>}
        </div>
        <div className="text-xs text-gray-500">{DIMENSAO_LABEL[ins.dimensao]} · base {labelUnidade(ins.unidadeBase)}{ins.fornecedorPadrao ? ` · ${ins.fornecedorPadrao}` : ""}
          {(() => { const uso = usoMap.get(ins.id) || []; return uso.length > 0
            ? <span className="ml-1 text-indigo-500/80 dark:text-indigo-400/80 cursor-help underline decoration-dotted underline-offset-2" title={`Usado em: ${uso.slice(0, 40).join(", ")}${uso.length > 40 ? "…" : ""}`}>· usado em {uso.length} ficha{uso.length === 1 ? "" : "s"}</span>
            : <span className="ml-1 text-gray-300 dark:text-gray-600">· não usado</span>; })()}
        </div>
      </div>
      <select value={ins.categoriaId || ""} onClick={e => e.stopPropagation()}
        onChange={e => { e.stopPropagation(); const v = e.target.value; if (v === "__nova__") void novaCatInsumo(ins.id); else void updateDoc(doc(db, "ftInsumos", ins.id), { categoriaId: v || null }); }}
        title="Categoria do insumo" className={`h-8 w-[150px] shrink-0 text-xs px-2 rounded-lg border bg-white dark:bg-gray-900 cursor-pointer ${ins.categoriaId ? "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200" : "border-dashed border-gray-300 dark:border-gray-600 text-gray-400"}`}>
        <option value="">— sem categoria —</option>
        {catsIns.map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
        <option value="__nova__">+ nova categoria…</option>
      </select>
      <div className="flex items-center gap-4 shrink-0 tabular-nums">
        <div className="text-right w-20 hidden sm:block" title="Média dos últimos 3 meses">
          <div className="text-[9px] uppercase text-gray-400 leading-none">média 3m</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{!ins.ehSubproduto && ins.custo > 0 ? fmtMoeda(precoMedio3m(ins, hoje)) : "—"}</div>
        </div>
        <div className="text-right w-24">
          <div className="text-[9px] uppercase text-gray-400 leading-none">último</div>
          <div className="text-sm">
            {ins.ehSubproduto
              ? <span className="text-[11px] text-gray-400 font-normal">do preparo</span>
              : ins.custo > 0
              ? <span className="font-semibold text-gray-800 dark:text-gray-100">{fmtMoeda(ins.custo)}<span className="text-[10px] text-gray-400">/{labelUnidade(ins.unidadeBase)}</span></span>
              : <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">sem custo</span>}
          </div>
        </div>
      </div>
      <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Editar</span>
    </div>
  );
  const grupos = [
    ...catsIns.map(cat => ({ nome: UP(cat.nome), itens: ativos.filter(i => i.categoriaId === cat.id) })),
    { nome: "Sem categoria", itens: ativos.filter(i => !i.categoriaId || !catIds.has(i.categoriaId)) },
  ].filter(g => g.itens.length > 0);
  const chips: [("todas" | "semcusto"), string, string][] = [
    ["todas", "Todos", "text-gray-500"],
    ["semcusto", `💲 Sem custo${nSemCusto ? ` (${nSemCusto})` : ""}`, "text-amber-700 dark:text-amber-400"],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔎</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar insumo…" className="w-full h-9 pl-9 pr-8 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
          {busca && <button type="button" onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm">✕</button>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map(([t, label, hint]) => (
          <button key={t} type="button" onClick={() => setFiltro(t)}
            className={`px-3 py-1 text-xs font-medium rounded-full border ${filtro === t ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : `border-gray-200 dark:border-gray-800 ${t !== "todas" ? hint : "text-gray-500"}`}`}>{label}</button>
        ))}
        <div className="flex-1" />
        {catsIns.length > 0 && (
          <select value={catFiltro} onChange={e => setCatFiltro(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
            <option value="">Todas categorias</option>
            <option value="__sem__">Sem categoria</option>
            {catsIns.map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
          </select>
        )}
      </div>
      {(nPrecoNovo > 0 || nSugeridos > 0) && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
          <span className="text-sm text-emerald-800 dark:text-emerald-200">🧾 {nPrecoNovo > 0 ? `${nPrecoNovo} preço(s) novo(s) recebido(s)` : "Recebimento"}{nSugeridos > 0 ? ` · ${nSugeridos} produto(s) pra vincular` : ""}.</span>
          <button type="button" onClick={() => setSincronizar(true)} className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Revisar preços</button>
        </div>
      )}
      {ativos.length === 0 ? (
        <ListaCard vazio vazioTexto={busca ? "Nenhum insumo com esse nome." : filtro === "semcusto" ? "Nenhum insumo sem custo." : "Nenhum insumo cadastrado."}>{null}</ListaCard>
      ) : (
        <div className="space-y-4">
          {grupos.map(g => (
            <div key={g.nome}>
              {(catsIns.length > 0) && <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{g.nome} <span className="text-gray-400 font-normal normal-case">· {g.itens.length}</span></div>}
              <ListaCard vazio={false} vazioTexto="">{g.itens.map(renderRow)}</ListaCard>
            </div>
          ))}
        </div>
      )}
      {editar && <EditarCustoModal insumo={editar} fichas={fichas} categorias={categorias} recebimentos={recebimentos} vinculos={vinculos} meId={meId} onMesclar={() => { const i = editar; setEditar(null); setMesclar(i); }} onClose={() => setEditar(null)} />}
      {mesclar && <MesclarInsumoModal insumo={mesclar} insumos={insumos} fichas={fichas} onClose={() => setMesclar(null)} />}
      {sincronizar && <SincronizarPrecosModal rid={rid} reconc={reconc} insumos={insumos} fichas={fichas} recebimentos={recebimentos} meId={meId} onClose={() => setSincronizar(false)} />}
    </div>
  );
}

function EditarCustoModal({ insumo, fichas, categorias, recebimentos, vinculos, meId, onMesclar, onClose }: { insumo: FtInsumo; fichas: FtFicha[]; categorias: FtCategoria[]; recebimentos: RecebimentoNota[]; vinculos: FtVinculoRecebimento[]; meId?: string; onMesclar?: () => void; onClose: () => void }) {
  const [nome, setNome] = useState(insumo.nome);
  const [custo, setCusto] = useState(insumo.custo ? maskMoeda(String(Math.round(insumo.custo * 100))) : "");
  const [forn, setForn] = useState(insumo.fornecedorPadrao || "");
  const [reutil, setReutil] = useState(!!insumo.reutilizavel);
  const [categoriaId, setCategoriaId] = useState(insumo.categoriaId || "");
  const catsIns = categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === "insumo").sort((a, b) => a.nome.localeCompare(b.nome));
  const [variacoes, setVariacoes] = useState<FtInsumoVariacao[]>(insumo.variacoes || []);
  const [unidadeBase, setUnidadeBase] = useState(insumo.unidadeBase);
  const [vincFichaId, setVincFichaId] = useState(insumo.subprodutoDe?.fichaId || "");
  const [vincSubId, setVincSubId] = useState(insumo.subprodutoDe?.subId || "");
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
  async function vincularSubproduto() {
    const f = fichas.find(x => x.id === vincFichaId); if (!f) return;
    let subId = vincSubId;
    const batch = writeBatch(db);
    if (!subId) {
      subId = uid("sp");
      const novo: FtSubproduto = { id: subId, nome: UP(insumo.nome), nomeNormalizado: normalizarNome(insumo.nome), unidade: insumo.unidadeBase, rendimentoQtd: 1, percentualCusto: 0 };
      batch.update(doc(db, "ftFichas", f.id), sanitizeForFirestore({ subprodutos: [...(f.subprodutos || []), novo] }));
    }
    batch.update(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ subprodutoDe: { fichaId: f.id, subId } }));
    await batch.commit();
    onClose();
  }
  async function desvincularSubproduto() { await updateDoc(doc(db, "ftInsumos", insumo.id), { subprodutoDe: null }); onClose(); }
  // Reclassificar: isto não é (ou não deveria ser) um insumo.
  const [reclSub, setReclSub] = useState("");       // subficha alvo: "__nova__" | id existente
  const [reclSubprod, setReclSubprod] = useState(""); // subproduto alvo: "__pendente__" | "exist:fid:sid"
  const [reclBusy, setReclBusy] = useState(false);
  const subfichasSist = useMemo(() => fichas.filter(f => f.ehSubficha && f.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)), [fichas]);
  const subprodutosSist = useMemo(() => fichas.filter(f => f.ativo !== false).flatMap(f => (f.subprodutos || []).map(sp => ({ ficha: f, sp }))).sort((a, b) => a.sp.nome.localeCompare(b.sp.nome)), [fichas]);
  // Vira insumo normal — só tira a marca de subproduto.
  async function virarIngrediente() {
    setReclBusy(true);
    try { await updateDoc(doc(db, "ftInsumos", insumo.id), { ehSubproduto: false, subprodutoDe: null }); onClose(); }
    catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); setReclBusy(false); }
  }
  // Vira subproduto: marca ehSubproduto e (se escolhido) vincula a um preparo.
  async function virarSubproduto(alvo: string) {
    setReclBusy(true);
    try {
      if (alvo.startsWith("exist:")) {
        const [, fid, sid] = alvo.split(":");
        await updateDoc(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ ehSubproduto: true, subprodutoDe: { fichaId: fid, subId: sid } }));
      } else {
        await updateDoc(doc(db, "ftInsumos", insumo.id), { ehSubproduto: true, subprodutoDe: null });
      }
      onClose();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : String(e))); setReclBusy(false); }
  }
  // Vira subficha: cria nova (ou usa existente), religa quem usava o insumo e o desativa.
  async function virarSubficha() {
    if (!reclSub) return;
    setReclBusy(true);
    try {
      const batch = writeBatch(db);
      let sfId = reclSub, sfNome = "";
      if (reclSub === "__nova__") {
        sfId = uid("fic"); sfNome = UP(insumo.nome);
        batch.set(doc(db, "ftFichas", sfId), sanitizeForFirestore({
          id: sfId, restaurantId: insumo.restaurantId, nome: sfNome, nomeNormalizado: normalizarNome(insumo.nome),
          ehSubficha: true, categoriaId: null, rendimento: { qtd: 1, unidade: insumo.unidadeBase },
          ingredientes: [], ativo: true, criadoEm: new Date().toISOString(), criadoPor: meId,
        } as FtFicha));
      } else {
        sfNome = fichas.find(f => f.id === reclSub)?.nome || "";
      }
      // Religa quem usava o insumo como ingrediente → passa a usar a subficha.
      for (const f of fichas.filter(f => f.ativo !== false && (f.ingredientes || []).some(ing => ing.tipo === "insumo" && ing.refId === insumo.id))) {
        const ingredientes = f.ingredientes.map(ing => (ing.tipo === "insumo" && ing.refId === insumo.id)
          ? ({ ...ing, tipo: "ficha", refId: sfId, nomeSnapshot: sfNome, variacaoNome: null, fc: undefined } as FtIngrediente)
          : ing);
        batch.update(doc(db, "ftFichas", f.id), sanitizeForFirestore({ ingredientes, revisar: true, revisarMotivo: f.revisarMotivo || `"${insumo.nome}" virou subficha — confira quantidade/unidade` }));
      }
      batch.update(doc(db, "ftInsumos", insumo.id), { ativo: false, ehSubproduto: false, subprodutoDe: null });
      await batch.commit();
      onClose();
    } catch (e) { alert("Erro ao converter: " + (e instanceof Error ? e.message : String(e))); setReclBusy(false); }
  }
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
    batch.update(doc(db, "ftInsumos", insumo.id), sanitizeForFirestore({ nome: UP(nome), nomeNormalizado: normalizarNome(nome), custo: c, custoAtualizadoEm: c > 0 ? now : insumo.custoAtualizadoEm || null, historicoCusto: hist, fornecedorPadrao: forn.trim() || null, reutilizavel: reutil, categoriaId: categoriaId || null, variacoes: vars, unidadeBase, dimensao: novaDim }));
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
          <Select label="Unidade base" value={unidadeBase} onChange={async e => { if (e.target.value === "__nova__") { const nu = await criarUnidadeMedida(insumo.restaurantId); if (nu) trocarUnidade(nu); } else trocarUnidade(e.target.value); }}>
            {unidadesBase().map(u => <option key={u.unidade} value={u.unidade}>{u.label}{DIMENSAO_LABEL[u.dimensao] ? ` (${DIMENSAO_LABEL[u.dimensao]})` : ""}</option>)}
            <option value="__nova__">+ criar unidade…</option>
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

        {catsIns.length > 0 && (
          <Select label="Categoria" value={categoriaId} onChange={e => setCategoriaId(e.target.value)}>
            <option value="">— sem categoria —</option>
            {catsIns.map(c => <option key={c.id} value={c.id}>{UP(c.nome)}</option>)}
          </Select>
        )}

        {insumo.ehSubproduto && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Subproduto de qual preparo?</div>
            {insumo.subprodutoDe ? (
              <div className="text-[11px] text-orange-600 dark:text-orange-400 flex items-center gap-2">
                🔗 {fichas.find(f => f.id === insumo.subprodutoDe!.fichaId)?.nome || "(preparo removido)"}
                <button type="button" onClick={() => void desvincularSubproduto()} className="text-gray-400 hover:text-red-600 underline">desvincular</button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400">Este insumo sai de um preparo (ex.: carcaça do frango assado). Vincule ao preparo pra o custo derivar do rateio.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={vincFichaId} onChange={e => { setVincFichaId(e.target.value); setVincSubId(""); }} className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 flex-1 min-w-[150px] shadow-sm">
                    <option value="">— escolher preparo —</option>
                    {fichas.filter(f => f.ativo !== false && f.id !== insumo.id).sort((a, b) => a.nome.localeCompare(b.nome)).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                  {vincFichaId && (
                    <select value={vincSubId} onChange={e => setVincSubId(e.target.value)} className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 shadow-sm">
                      <option value="">+ criar “{insumo.nome}” neste preparo</option>
                      {(fichas.find(f => f.id === vincFichaId)?.subprodutos || []).map(sp => <option key={sp.id} value={sp.id}>{sp.nome}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => void vincularSubproduto()} disabled={!vincFichaId} className="h-8 text-xs font-medium px-3 rounded-lg bg-orange-600 text-white hover:bg-orange-700 shadow-sm disabled:opacity-40">Vincular</button>
                </div>
                <p className="text-[11px] text-gray-400">Depois ajuste o % de rateio no bloco Subprodutos da ficha.</p>
              </div>
            )}
          </div>
        )}

        {/* Reclassificar — isto não é um insumo */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">O que isto é de verdade?</div>
          <div className="flex items-center gap-2 flex-wrap">
            {insumo.ehSubproduto
              ? <button type="button" onClick={() => void virarIngrediente()} disabled={reclBusy} className="h-8 text-xs font-medium px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-indigo-400 disabled:opacity-40">🧂 É um insumo normal</button>
              : (
                <select value={reclSubprod} onChange={e => { const v = e.target.value; setReclSubprod(""); if (v) void virarSubproduto(v); }} disabled={reclBusy} className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 shrink-0 max-w-[190px] shadow-sm">
                  <option value="">↦ é subproduto…</option>
                  <option value="__pendente__">⏳ marcar como subproduto (vincular depois)</option>
                  {subprodutosSist.length > 0 && <optgroup label="vincular a existente">{subprodutosSist.map(({ ficha, sp }) => <option key={ficha.id + sp.id} value={`exist:${ficha.id}:${sp.id}`}>{UP(sp.nome)} · de {ficha.nome}</option>)}</optgroup>}
                </select>
              )}
            <select value={reclSub} onChange={e => setReclSub(e.target.value)} className="h-8 text-xs px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 flex-1 min-w-[140px] shadow-sm">
              <option value="">🧩 é subficha…</option>
              <option value="__nova__">＋ criar “{UP(insumo.nome)}” como subficha</option>
              {subfichasSist.length > 0 && <optgroup label="já cadastradas">{subfichasSist.map(f => <option key={f.id} value={f.id}>{UP(f.nome)}</option>)}</optgroup>}
            </select>
            <button type="button" onClick={() => void virarSubficha()} disabled={reclBusy || !reclSub} className="h-8 text-xs font-medium px-3 rounded-lg bg-purple-600 text-white hover:bg-purple-700 shadow-sm disabled:opacity-40">Converter</button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Virar subficha desativa este insumo e religa quem o usava (fichas afetadas → revisão). Virar subproduto mantém o insumo, mas o custo passa a derivar do preparo.</p>
        </div>

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

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {onMesclar && <Button variant="ghost" size="sm" onClick={onMesclar}>🔀 Mesclar com outro</Button>}
            <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Excluir "${insumo.nome}"?`)) { void updateDoc(doc(db, "ftInsumos", insumo.id), { ativo: false }); onClose(); } }}>🗑️ Excluir</Button>
          </div>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Salvar</Button></div>
        </div>
      </div>
    </Modal>
  );
}

function MesclarInsumoModal({ insumo, insumos, fichas, onClose }: { insumo: FtInsumo; insumos: FtInsumo[]; fichas: FtFicha[]; onClose: () => void }) {
  const [alvoId, setAlvoId] = useState(""); const [salvando, setSalvando] = useState(false);
  const [comoVar, setComoVar] = useState(false);
  const [varSel, setVarSel] = useState("__nova__");
  const [varNome, setVarNome] = useState("");
  const [varFc, setVarFc] = useState(100);
  const candidatos = insumos.filter(i => i.ativo !== false && i.id !== insumo.id && i.dimensao === insumo.dimensao).sort((a, b) => a.nome.localeCompare(b.nome));
  const alvo = insumos.find(i => i.id === alvoId) || null;
  // Sugere o nome da variação a partir da diferença dos nomes (ex.: "SALSINHA PICADA" − "SALSINHA" → "PICADA").
  function ligarVariacao(a: FtInsumo | null, on: boolean) {
    setComoVar(on);
    if (on && a) { setVarSel("__nova__"); setVarNome(UP(insumo.nome).replace(UP(a.nome), "").replace(/\s+/g, " ").trim() || "VARIAÇÃO"); }
  }
  async function mesclar() {
    if (!alvo) { alert("Escolha o insumo destino."); return; }
    let variacao: { nome: string; fc: number; novo?: boolean } | null = null;
    if (comoVar) {
      if (varSel !== "__nova__") { const v = (alvo.variacoes || []).find(x => x.id === varSel); if (v) variacao = { nome: v.nome, fc: v.fc }; }
      else { const nm = UP(varNome).trim(); if (!nm) { alert("Dê um nome à variação."); return; } variacao = { nome: nm, fc: Math.round(varFc > 0 ? varFc : 100), novo: true }; }
    }
    if (!confirm(`Mesclar "${insumo.nome}" em "${alvo.nome}"${variacao ? ` como variação “${variacao.nome}”` : ""}?`)) return;
    setSalvando(true);
    try {
      if (variacao?.novo && !(alvo.variacoes || []).some(v => normalizarNome(v.nome) === normalizarNome(variacao!.nome))) {
        await updateDoc(doc(db, "ftInsumos", alvo.id), sanitizeForFirestore({ variacoes: [...(alvo.variacoes || []), { id: uid("var"), nome: variacao.nome, fc: variacao.fc }] }));
      }
      for (const f of fichas) {
        let mudou = false;
        const ingredientes = f.ingredientes.map(ing => {
          if (ing.tipo === "insumo" && ing.refId === insumo.id) {
            mudou = true;
            return variacao ? { ...ing, refId: alvo.id, nomeSnapshot: alvo.nome, variacaoNome: variacao.nome, fc: variacao.fc } : { ...ing, refId: alvo.id, nomeSnapshot: alvo.nome, variacaoNome: null, fc: undefined } as FtIngrediente;
          }
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
        <Select label="Insumo destino" value={alvoId} onChange={e => { setAlvoId(e.target.value); ligarVariacao(insumos.find(i => i.id === e.target.value) || null, comoVar); }}>
          <option value="">Selecione…</option>
          {candidatos.map(i => <option key={i.id} value={i.id}>{i.nome} ({labelUnidade(i.unidadeBase)})</option>)}
        </Select>
        {alvo && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={comoVar} onChange={e => ligarVariacao(alvo, e.target.checked)} className="w-4 h-4 accent-indigo-600" />
            <span>“{insumo.nome}” é uma <strong>variação</strong> de “{alvo.nome}”</span>
          </label>
        )}
        {alvo && comoVar && (
          <div className="space-y-2 pl-6">
            <Select label="Variação" value={varSel} onChange={e => setVarSel(e.target.value)}>
              <option value="__nova__">＋ criar nova variação</option>
              {(alvo.variacoes || []).map(v => <option key={v.id} value={v.id}>{v.nome} ({v.fc}%)</option>)}
            </Select>
            {varSel === "__nova__" && (
              <div className="flex items-end gap-2">
                <div className="flex-1"><Input label="Nome da variação" value={varNome} onChange={e => setVarNome(e.target.value.toUpperCase())} placeholder="ex: PICADA" /></div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Aprov. %</span>
                  <input type="number" step={1} value={varFc} onChange={e => setVarFc(Math.round(Number(e.target.value) || 0))} className="w-20 px-2 py-2 text-right rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
                </div>
              </div>
            )}
          </div>
        )}
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
                    <select value="" onChange={ev => { const v = ev.target.value; if (v === "outro") setEdit(l, { insumoId: "", fator: "" }); else if (v === "novo") void naoEEste(l); else if (v === "ignorar") void ignorar(l); }} title="Não é este insumo" className="h-8 text-xs px-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 shrink-0">
                      <option value="">não é este…</option>
                      <option value="outro">↺ escolher outro insumo</option>
                      <option value="novo">⏳ ainda não cadastrado</option>
                      <option value="ignorar">🚫 não é insumo (ignorar)</option>
                    </select>
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

// ─── Categorias (modal por aba) ────────────────────────────────────────────
const CAT_META: Record<FtCategoriaTipo, { titulo: string; icone: string; bg: string; ph: string }> = {
  ficha: { titulo: "🍽️ Categorias de pratos finais", icone: "🍽️", bg: "bg-indigo-100 dark:bg-indigo-900/40", ph: "ex: PRATOS PRINCIPAIS, DRINKS" },
  subficha: { titulo: "🧩 Categorias de bases", icone: "🧩", bg: "bg-purple-100 dark:bg-purple-900/40", ph: "ex: MOLHOS, CALDOS" },
  insumo: { titulo: "🧂 Categorias de insumos", icone: "🧂", bg: "bg-gray-100 dark:bg-gray-800", ph: "ex: HORTIFRÚTI, CARNES, SECOS" },
};
function CategoriasModal({ rid, categorias, tipo, onClose }: { rid: string; categorias: FtCategoria[]; tipo: FtCategoriaTipo; onClose: () => void }) {
  return (
    <Modal title={CAT_META[tipo].titulo} onClose={onClose} maxWidth="max-w-lg">
      <CadastroCategorias rid={rid} categorias={categorias} tipo={tipo} />
    </Modal>
  );
}
function CadastroCategorias({ rid, categorias, tipo }: { rid: string; categorias: FtCategoria[]; tipo: FtCategoriaTipo }) {
  const [nome, setNome] = useState("");
  const [editar, setEditar] = useState<FtCategoria | null>(null);
  const manual = tipo === "ficha";
  const meta = CAT_META[tipo];
  const lista = ordenarCats(categorias.filter(c => c.ativo !== false && (c.tipo || "ficha") === tipo));
  // Reordena a categoria (só pratos finais — bases/insumos são alfabéticos).
  async function mover(id: string, dir: -1 | 1) {
    const idx = lista.findIndex(c => c.id === id); const j = idx + dir;
    if (idx < 0 || j < 0 || j >= lista.length) return;
    const nova = [...lista]; [nova[idx], nova[j]] = [nova[j], nova[idx]];
    await Promise.all(nova.map((c, i) => updateDoc(doc(db, "ftCategorias", c.id), { ordem: i })));
  }
  async function add() {
    if (!nome.trim()) return;
    const id = uid("cat");
    await setDoc(doc(db, "ftCategorias", id), sanitizeForFirestore({ id, restaurantId: rid, nome: UP(nome), tipo, ordem: lista.length, ativo: true } as FtCategoria));
    setNome("");
  }
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1"><Input label="Nova categoria" value={nome} onChange={e => setNome(e.target.value.toUpperCase())} placeholder={meta.ph} /></div>
        <Button onClick={add}>+ Adicionar</Button>
      </div>
      {!manual && <div className="text-[11px] text-gray-400">Ordem alfabética automática.</div>}
      <ListaCard vazio={lista.length === 0} vazioTexto="Nenhuma categoria ainda.">
        {lista.map((c, i, arr) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40">
            {manual && (
              <div className="flex flex-col shrink-0 -my-1">
                <button type="button" onClick={() => void mover(c.id, -1)} disabled={i === 0} className="text-gray-300 hover:text-indigo-600 disabled:opacity-20 leading-none text-xs" aria-label="subir">▲</button>
                <button type="button" onClick={() => void mover(c.id, 1)} disabled={i === arr.length - 1} className="text-gray-300 hover:text-indigo-600 disabled:opacity-20 leading-none text-xs" aria-label="descer">▼</button>
              </div>
            )}
            <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${meta.bg}`}>{meta.icone}</span>
            <span onClick={() => setEditar(c)} className="flex-1 text-gray-900 dark:text-gray-100 cursor-pointer" title="Editar categoria">{UP(c.nome)}</span>
            {tipo === "ficha" && c.cmvAlvo != null && <span className="text-[11px] text-gray-400">CMV alvo {c.cmvAlvo}%</span>}
            <button type="button" onClick={() => setEditar(c)} className="text-xs text-indigo-600 dark:text-indigo-400">Editar</button>
          </div>
        ))}
      </ListaCard>
      {editar && <CategoriaModal categoria={editar} onClose={() => setEditar(null)} />}
    </div>
  );
}

function CategoriaModal({ categoria, onClose }: { categoria: FtCategoria; onClose: () => void }) {
  const tipo = (categoria.tipo || "ficha") as FtCategoriaTipo;
  const [nome, setNome] = useState(categoria.nome);
  const [ordem, setOrdem] = useState(String(categoria.ordem ?? 0));
  const [cmv, setCmv] = useState(categoria.cmvAlvo != null ? String(categoria.cmvAlvo) : "");
  async function salvar() {
    if (!nome.trim()) { alert("Dê um nome à categoria."); return; }
    await updateDoc(doc(db, "ftCategorias", categoria.id), sanitizeForFirestore({
      nome: UP(nome), ordem: Number(ordem) || 0, cmvAlvo: tipo === "ficha" && cmv.trim() ? Number(cmv.replace(",", ".")) : null,
    }));
    onClose();
  }
  async function excluir() { if (confirm(`Excluir "${categoria.nome}"?`)) { await updateDoc(doc(db, "ftCategorias", categoria.id), { ativo: false }); onClose(); } }
  return (
    <Modal title="Editar categoria" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome" value={nome} onChange={e => setNome(e.target.value.toUpperCase())} />
        {tipo === "ficha" ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Ordem no cardápio</span>
              <input type="number" value={ordem} onChange={e => setOrdem(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">CMV alvo (%)</span>
              <input type="number" value={cmv} onChange={e => setCmv(e.target.value)} placeholder="ex: 30" className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100" />
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-gray-400">Listada em ordem alfabética automática — sem ordem manual.</div>
        )}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={excluir}>🗑️ Excluir</Button>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={salvar}>Salvar</Button></div>
        </div>
      </div>
    </Modal>
  );
}

// ─── UI atoms ───────────────────────────────────────────────────────────────
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
