// ════════════════════════════════════════════════════════════════════════════
//  Gestão de Estoques e Validades
//
//  Loop de estoque por LOTE com giro PVPS/PEPS:
//   • Cadastro → Locais (geladeiras/câmaras/…) + Produtos (matriz de conservação)
//   • Entrada → cria lote (qtd + validade + local) e diz onde arrumar (PVPS/PEPS)
//   • Baixa   → escolhe produto, o sistema aponta o lote certo (giro) e baixa a qtd
//   • Painel  → saldo + o que vence (FEFO)
//  Fluxos manuais primeiro; QR (baixa por scan) e OCR da NF entram como evolução.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { type LocalEstoque, type LocalEstoqueTipo, LOCAL_ESTOQUE_TIPO_LABEL } from "../../core/types";
import { type EntradaPendente } from "./entradasPendentes";

// ── Tipos locais do módulo (promover pra types/index.ts quando estabilizar) ──
type MetodoKey = "refrigerado" | "congelado" | "ambiente" | "seco" | "quente";
type Conservacao = Partial<Record<MetodoKey, number>>;    // método → dias
export type ProdutoEtiqueta = {
  id: string; restaurantId: string; nome: string; categoria?: string;
  conservacao: Conservacao; unidade: string;
  estoqueMinimo?: number | null; marcaFornecedor?: string | null; sif?: string | null;
  precoCusto?: number | null; qrTokenEstoque: string; ativo: boolean; criadoEm: string;
};
export type LoteEstoque = {
  id: string; restaurantId: string; produtoId: string; produtoNome: string;
  localId?: string | null; qtdInicial: number; qtdRestante: number; unidade: string;
  entradaData: string; validade: string; fornecedor?: string | null; precoUnit?: number | null;
  status: "ativo" | "esgotado" | "descartado"; criadoEm: string; criadoPor?: string | null;
};

const METODOS: Array<{ k: MetodoKey; label: string; icon: string }> = [
  { k: "refrigerado", label: "Refrigerado", icon: "🧊" },
  { k: "congelado", label: "Congelado", icon: "❄️" },
  { k: "ambiente", label: "Ambiente", icon: "🌡️" },
  { k: "seco", label: "Seco", icon: "📦" },
  { k: "quente", label: "Quente", icon: "🔥" },
];
const TIPOS = Object.keys(LOCAL_ESTOQUE_TIPO_LABEL) as LocalEstoqueTipo[];
const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

// ── Datas (Brasília) ──
const hojeYmd = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDias = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtBR = (ymd?: string) => (ymd ? ymd.split("-").reverse().join("/") : "—");
const brToYmd = (br: string) => { const [d, m, a] = (br || "").split("/"); return d && m && a ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""; };
const diasAte = (ymd: string) => Math.round((new Date(ymd + "T12:00:00Z").getTime() - new Date(hojeYmd() + "T12:00:00Z").getTime()) / 86400000);
const novoToken = () => "qr_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// Giro FIXO (PVPS+PEPS complementares): prioridade quem VENCE antes; se empatar a
// validade, desempata por quem ENTROU antes. Não é configurável.
const giroCmp = (a: LoteEstoque, b: LoteEstoque) =>
  a.validade.localeCompare(b.validade) || a.entradaData.localeCompare(b.entradaData);

// Campo de busca padrão do módulo — alto, com lupa e botão de limpar.
function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative w-full">
      <svg viewBox="0 0 24 24" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400 pointer-events-none">
        <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="w-full h-11 pl-11 pr-9 text-[15px] rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 outline-none focus:bg-white dark:focus:bg-gray-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/40 transition-colors" />
      {value && <button type="button" onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700 flex items-center justify-center text-sm">✕</button>}
    </div>
  );
}

export function EstoqueValidadePage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurante = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("estoqueValidade", "ver");
  const podeOperar = can("estoqueValidade", "operar") || can("estoqueValidade", "editar");
  const podeEditar = can("estoqueValidade", "editar");

  const [aba, setAba] = useState<"painel" | "baixa" | "entrada" | "cadastro">("painel");
  const [subCad, setSubCad] = useState<"locais" | "produtos">("locais");
  const [locais, setLocais] = useState<LocalEstoque[]>([]);
  const [produtos, setProdutos] = useState<ProdutoEtiqueta[]>([]);
  const [lotes, setLotes] = useState<LoteEstoque[]>([]);
  const [pendentes, setPendentes] = useState<EntradaPendente[]>([]);
  const [localModal, setLocalModal] = useState<{ local: LocalEstoque | null } | null>(null);
  const [prodModal, setProdModal] = useState<{ produto: ProdutoEtiqueta | null } | null>(null);
  const [etiqModal, setEtiqModal] = useState<ProdutoEtiqueta | null>(null);

  useEffect(() => {
    if (!rid) return;
    const subs = [
      onSnapshot(query(collection(db, "locaisEstoque"), where("restaurantId", "==", rid)), (s) => setLocais(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LocalEstoque)), () => setLocais([])),
      onSnapshot(query(collection(db, "produtosEtiqueta"), where("restaurantId", "==", rid)), (s) => setProdutos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ProdutoEtiqueta)), () => setProdutos([])),
      onSnapshot(query(collection(db, "lotesEstoque"), where("restaurantId", "==", rid)), (s) => setLotes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LoteEstoque)), () => setLotes([])),
      onSnapshot(query(collection(db, "entradasPendentes"), where("restaurantId", "==", rid)), (s) => setPendentes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EntradaPendente).filter((p) => p.status === "pendente")), () => setPendentes([])),
    ];
    return () => subs.forEach((u) => u());
  }, [rid]);

  const localNome = (id?: string | null) => locais.find((l) => l.id === id)?.nome || "";
  const lotesAtivosDoProduto = (produtoId: string) => lotes.filter((l) => l.produtoId === produtoId && l.status === "ativo" && l.qtdRestante > 0);

  // ── Locais ──
  async function salvarLocal(l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) {
    if (l.id) await updateDoc(doc(db, "locaisEstoque", l.id), { nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, ativo: l.ativo });
    else await addDoc(collection(db, "locaisEstoque"), { restaurantId: rid, nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, ativo: l.ativo, ordem: locais.length, criadoEm: new Date().toISOString(), criadoPor: me?.id || null });
    setLocalModal(null);
  }
  async function excluirLocal(l: LocalEstoque) { if (confirm(`Excluir o local "${l.nome}"?`)) await deleteDoc(doc(db, "locaisEstoque", l.id)); }

  // ── Produtos ──
  async function salvarProduto(p: Partial<ProdutoEtiqueta> & { id?: string }) {
    const dados = {
      nome: p.nome, categoria: p.categoria || null, conservacao: p.conservacao || {}, unidade: p.unidade || "unid",
      estoqueMinimo: p.estoqueMinimo ?? null, marcaFornecedor: p.marcaFornecedor || null,
      sif: p.sif || null, precoCusto: p.precoCusto ?? null, ativo: p.ativo ?? true,
    };
    if (p.id) await updateDoc(doc(db, "produtosEtiqueta", p.id), dados);
    else await addDoc(collection(db, "produtosEtiqueta"), { restaurantId: rid, ...dados, qrTokenEstoque: novoToken(), criadoEm: new Date().toISOString() });
    setProdModal(null);
  }
  async function excluirProduto(p: ProdutoEtiqueta) { if (confirm(`Excluir o produto "${p.nome}"?`)) await deleteDoc(doc(db, "produtosEtiqueta", p.id)); }

  // ── Entrada (cria lote) ──
  async function darEntrada(v: { produto: ProdutoEtiqueta; qtd: number; validade: string; localId: string; fornecedor?: string }) {
    const nowIso = new Date().toISOString();
    const ref = await addDoc(collection(db, "lotesEstoque"), {
      restaurantId: rid, produtoId: v.produto.id, produtoNome: v.produto.nome, localId: v.localId || null,
      qtdInicial: v.qtd, qtdRestante: v.qtd, unidade: v.produto.unidade, entradaData: hojeYmd(), validade: v.validade,
      fornecedor: v.fornecedor || null, precoUnit: v.produto.precoCusto ?? null, status: "ativo", criadoEm: nowIso, criadoPor: me?.id || null,
    });
    await addDoc(collection(db, "movimentosEstoque"), { restaurantId: rid, loteId: ref.id, produtoId: v.produto.id, tipo: "entrada", qtd: v.qtd, saldoDepois: v.qtd, usuarioUid: me?.id || null, usuarioNome: me?.nome || null, ts: nowIso });
    return ref.id;
  }
  async function resolverPendente(id: string, loteId: string | null, status: "confirmada" | "descartada") {
    await updateDoc(doc(db, "entradasPendentes", id), { status, loteId: loteId ?? null, resolvidoEm: new Date().toISOString(), resolvidoPor: me?.id || null });
  }

  // ── Baixa (consome dos lotes na ordem do giro) ──
  async function darBaixa(produto: ProdutoEtiqueta, qtd: number): Promise<number> {
    const ordered = lotesAtivosDoProduto(produto.id).sort(giroCmp);
    let rest = qtd; const nowIso = new Date().toISOString();
    for (const lote of ordered) {
      if (rest <= 0) break;
      const tira = Math.min(rest, lote.qtdRestante);
      const novoSaldo = Math.round((lote.qtdRestante - tira) * 1000) / 1000;
      await updateDoc(doc(db, "lotesEstoque", lote.id), { qtdRestante: novoSaldo, status: novoSaldo <= 0 ? "esgotado" : "ativo" });
      await addDoc(collection(db, "movimentosEstoque"), { restaurantId: rid, loteId: lote.id, produtoId: produto.id, tipo: "baixa", qtd: tira, saldoDepois: novoSaldo, usuarioUid: me?.id || null, usuarioNome: me?.nome || null, ts: nowIso });
      rest = Math.round((rest - tira) * 1000) / 1000;
    }
    return rest; // > 0 = faltou estoque
  }

  if (permLoading) return null;
  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso à Gestão de Estoques e Validades.</div>;

  const ABAS: Array<[typeof aba, string]> = [["painel", "📊 Painel"], ["baixa", "📤 Baixa"], ["entrada", "📥 Entrada"], ["cadastro", "🗂️ Cadastro"]];

  return (
    <div className="max-w-6xl">
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {ABAS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAba(k)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${aba === k ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
            {l}
          </button>
        ))}
      </div>

      {aba === "painel" && <PainelTab produtos={produtos} lotes={lotes} localNome={localNome} />}
      {aba === "baixa" && <BaixaTab produtos={produtos} lotesAtivos={lotesAtivosDoProduto} localNome={localNome} podeOperar={podeOperar} onBaixa={darBaixa} />}
      {aba === "entrada" && <EntradaTab produtos={produtos} locais={locais} lotesAtivos={lotesAtivosDoProduto} podeOperar={podeOperar} onEntrada={darEntrada} pendentes={pendentes} onResolver={resolverPendente} />}
      {aba === "cadastro" && (
        <div>
          <div className="flex gap-1.5 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">
            {([["locais", "📍 Locais"], ["produtos", "🏷️ Produtos"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSubCad(k)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg ${subCad === k ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{l}</button>
            ))}
          </div>
          {subCad === "locais"
            ? <LocaisTab locais={locais} restauranteNome={restaurante?.nome} podeEditar={podeEditar} onNovo={() => setLocalModal({ local: null })} onEditar={(l) => setLocalModal({ local: l })} onExcluir={excluirLocal} />
            : <ProdutosTab produtos={produtos} podeEditar={podeEditar} onNovo={() => setProdModal({ produto: null })} onEditar={(p) => setProdModal({ produto: p })} onExcluir={excluirProduto} onEtiqueta={(p) => setEtiqModal(p)} />}
        </div>
      )}

      {localModal && <LocalModal local={localModal.local} locais={locais} onClose={() => setLocalModal(null)} onSalvar={salvarLocal} />}
      {prodModal && <ProdutoModal produto={prodModal.produto} onClose={() => setProdModal(null)} onSalvar={salvarProduto} />}
      {etiqModal && <EtiquetaFixaModal produto={etiqModal} onClose={() => setEtiqModal(null)} />}
    </div>
  );
}

// ═══ PAINEL (saldo + FEFO) ═══════════════════════════════════════════════════
function PainelTab({ produtos, lotes, localNome }: { produtos: ProdutoEtiqueta[]; lotes: LoteEstoque[]; localNome: (id?: string | null) => string }) {
  const ativos = lotes.filter((l) => l.status === "ativo" && l.qtdRestante > 0);
  const grupos = useMemo(() => {
    const g = { vencido: [] as LoteEstoque[], hoje: [] as LoteEstoque[], amanha: [] as LoteEstoque[], semana: [] as LoteEstoque[] };
    for (const l of ativos) {
      const d = diasAte(l.validade);
      if (d < 0) g.vencido.push(l); else if (d === 0) g.hoje.push(l); else if (d === 1) g.amanha.push(l); else if (d <= 7) g.semana.push(l);
    }
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort((a, b) => a.validade.localeCompare(b.validade));
    return g;
  }, [ativos]);
  const nomeProd = (id: string) => produtos.find((p) => p.id === id)?.nome || "—";

  const cards: Array<[string, LoteEstoque[], string]> = [
    ["Vencidos", grupos.vencido, "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"],
    ["Vence hoje", grupos.hoje, "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"],
    ["Amanhã", grupos.amanha, "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-300"],
    ["Nesta semana", grupos.semana, "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map(([label, arr, cls]) => (
          <div key={label} className={`rounded-xl border p-3 ${cls}`}>
            <div className="text-2xl font-bold">{arr.length}</div>
            <div className="text-xs font-medium">{label}</div>
          </div>
        ))}
      </div>

      {[["🔴 Vencidos", grupos.vencido], ["🟡 Vence hoje / amanhã", [...grupos.hoje, ...grupos.amanha]], ["🟢 Nesta semana", grupos.semana]].map(([titulo, arr]) => (arr as LoteEstoque[]).length > 0 && (
        <div key={titulo as string}>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{titulo as string}</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {(arr as LoteEstoque[]).map((l) => {
              const d = diasAte(l.validade);
              return (
                <div key={l.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{nomeProd(l.produtoId)}</span>
                    <span className="text-gray-400"> · {l.qtdRestante} {l.unidade}</span>
                    {l.localId && <span className="text-gray-400"> · {localNome(l.localId)}</span>}
                  </div>
                  <span className={`text-xs whitespace-nowrap ${d < 0 ? "text-rose-600" : d <= 1 ? "text-amber-600" : "text-gray-500"}`}>{d < 0 ? `venceu ${fmtBR(l.validade)}` : `vence ${fmtBR(l.validade)}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {ativos.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Sem estoque ativo. Dê entrada em produtos na aba <b>Entrada</b>.</div>}

      {/* Saldo por produto */}
      {produtos.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 mt-4">📦 Saldo por produto</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {produtos.filter((p) => p.ativo).map((p) => {
              const saldo = ativos.filter((l) => l.produtoId === p.id).reduce((a, l) => a + l.qtdRestante, 0);
              const baixo = p.estoqueMinimo != null && saldo <= (p.estoqueMinimo || 0);
              return (
                <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
                  <span className={`tabular-nums whitespace-nowrap ${baixo ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{saldo} {p.unidade}{baixo ? " ⚠" : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ BAIXA ═══════════════════════════════════════════════════════════════════
function BaixaTab({ produtos, lotesAtivos, localNome, podeOperar, onBaixa }: {
  produtos: ProdutoEtiqueta[]; lotesAtivos: (id: string) => LoteEstoque[]; localNome: (id?: string | null) => string;
  podeOperar: boolean; onBaixa: (p: ProdutoEtiqueta, qtd: number) => Promise<number>;
}) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<ProdutoEtiqueta | null>(null);
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [scan, setScan] = useState(false);

  function aoLerQr(code: string) {
    setScan(false);
    const p = produtos.find((x) => x.qrTokenEstoque === code && x.ativo);
    if (p) { setSel(p); setMsg(""); } else { setMsg("QR não reconhecido neste restaurante."); }
  }

  const achados = busca.trim() ? produtos.filter((p) => p.ativo && p.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 8) : [];
  const fila = sel ? lotesAtivos(sel.id).slice().sort(giroCmp) : [];
  const proximo = fila[0] || null;
  const saldo = fila.reduce((a, l) => a + l.qtdRestante, 0);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão pra dar baixa.</div>;

  async function confirmar() {
    if (!sel) return;
    const n = parseFloat((qtd || "").replace(",", "."));
    if (!n || n <= 0) { setMsg("Informe a quantidade."); return; }
    if (n > saldo) { setMsg(`Só há ${saldo} ${sel.unidade} em estoque.`); return; }
    setSalvando(true);
    try { await onBaixa(sel, n); setMsg(`✓ Baixa de ${n} ${sel.unidade} de ${sel.nome}.`); setSel(null); setQtd(""); setBusca(""); }
    finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Leia o QR do produto (ou busque). O sistema aponta de qual lote pegar pela regra de giro.</p>
      {!sel ? (
        <div>
          <div className="flex gap-2 max-w-2xl">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto pra dar baixa…" autoFocus />
            <button type="button" onClick={() => setScan(true)} className="shrink-0 h-11 px-4 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-400 flex items-center gap-1.5">📷 <span className="hidden sm:inline">Ler QR</span></button>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(busca.trim() ? achados : produtos.filter((p) => p.ativo).slice().sort((a, b) => a.nome.localeCompare(b.nome))).map((p) => {
              const s = lotesAtivos(p.id).reduce((a, l) => a + l.qtdRestante, 0);
              return (
                <button key={p.id} type="button" onClick={() => { setSel(p); setMsg(""); }} className="text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
                  <span className={`text-xs whitespace-nowrap ${s > 0 ? "text-gray-400" : "text-rose-400"}`}>{s} {p.unidade}</span>
                </button>
              );
            })}
          </div>
          {produtos.length === 0 && <p className="text-xs text-gray-400 mt-3">Nenhum produto ativo. Cadastre em <b>Cadastro › Produtos</b>.</p>}
        </div>
      ) : (
        <div className="max-w-xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{sel.nome}</span>
            <button type="button" onClick={() => { setSel(null); setMsg(""); }} className="text-xs text-gray-400 hover:underline">trocar</button>
          </div>
          {!proximo ? (
            <div className="text-sm text-rose-600">Sem estoque ativo deste produto.</div>
          ) : (
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-900 p-3 text-sm">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1">👉 Pegue deste lote (vence antes):</div>
              <div className="text-gray-800 dark:text-gray-100">Validade <b>{fmtBR(proximo.validade)}</b> · {proximo.qtdRestante} {sel.unidade}{proximo.localId ? <> · em <b>{localNome(proximo.localId)}</b></> : null}</div>
              {fila.length > 1 && <div className="text-[11px] text-gray-500 mt-1">+{fila.length - 1} lote(s) depois deste. Saldo total: {saldo} {sel.unidade}.</div>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Quantas unidades saíram?</label>
              <input value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder={`0 (${sel.unidade})`} inputMode="decimal" className={inp} autoFocus />
            </div>
            <Button onClick={() => void confirmar()} disabled={salvando || !proximo}>{salvando ? "…" : "Confirmar baixa"}</Button>
          </div>
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"}`}>{msg}</div>}
      {scan && <ScannerModal onDetect={aoLerQr} onClose={() => setScan(false)} />}
    </div>
  );
}

// ═══ ENTRADA ═════════════════════════════════════════════════════════════════
function EntradaTab({ produtos, locais, lotesAtivos, podeOperar, onEntrada, pendentes, onResolver }: {
  produtos: ProdutoEtiqueta[]; locais: LocalEstoque[]; lotesAtivos: (id: string) => LoteEstoque[];
  podeOperar: boolean; onEntrada: (v: { produto: ProdutoEtiqueta; qtd: number; validade: string; localId: string; fornecedor?: string }) => Promise<string>;
  pendentes: EntradaPendente[]; onResolver: (id: string, loteId: string | null, status: "confirmada" | "descartada") => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<ProdutoEtiqueta | null>(null);
  const [metodo, setMetodo] = useState<MetodoKey | "">("");
  const [qtd, setQtd] = useState("");
  const [validadeBr, setValidadeBr] = useState("");
  const [localId, setLocalId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pendenteAtivo, setPendenteAtivo] = useState<EntradaPendente | null>(null);

  const achados = busca.trim() ? produtos.filter((p) => p.ativo && p.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 8) : [];
  const metodosDoProduto = sel ? METODOS.filter((m) => sel.conservacao[m.k] != null) : [];

  // "Lançar" um pendente do recebimento → pré-preenche pra o usuário casar o produto.
  function lancarPendente(p: EntradaPendente) {
    setPendenteAtivo(p); setBusca(p.descricaoNota); setMsg("");
    if (p.quantidade != null) setQtd(String(p.quantidade));
    if (p.fornecedor) setFornecedor(p.fornecedor);
  }

  function escolher(p: ProdutoEtiqueta) {
    setSel(p); setMsg("");
    const mets = METODOS.filter((m) => p.conservacao[m.k] != null);
    const m0 = mets[0]?.k || "";
    setMetodo(m0);
    if (m0 && p.conservacao[m0] != null) setValidadeBr(fmtBR(addDias(hojeYmd(), p.conservacao[m0] as number)));
  }
  function trocarMetodo(k: MetodoKey) { setMetodo(k); if (sel && sel.conservacao[k] != null) setValidadeBr(fmtBR(addDias(hojeYmd(), sel.conservacao[k] as number))); }

  // Instrução PVPS/PEPS: onde colocar o lote novo em relação aos existentes.
  function instrucaoArrumacao(p: ProdutoEtiqueta, validadeYmd: string): string {
    const existentes = lotesAtivos(p.id);
    if (existentes.length === 0) return "Primeiro lote — pode guardar à frente.";
    // Regra fixa: sai antes quem vence antes; empate de validade → quem entrou antes.
    // Os lotes existentes entraram antes deste, então mesma validade conta como "antes".
    const antes = existentes.filter((l) => l.validade <= validadeYmd).length;
    const depois = existentes.filter((l) => l.validade > validadeYmd).length;
    if (depois === 0) return `Coloque ATRÁS dos ${antes} lote(s) que já estão aí (saem antes).`;
    if (antes === 0) return `Este vence primeiro — coloque À FRENTE de tudo.`;
    return `Coloque ATRÁS dos ${antes} que saem antes e À FRENTE dos ${depois} que saem depois.`;
  }

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão pra dar entrada.</div>;

  async function salvar() {
    if (!sel) return;
    const n = parseFloat((qtd || "").replace(",", "."));
    const validade = brToYmd(validadeBr);
    if (!n || n <= 0) { setMsg("Informe a quantidade."); return; }
    if (!validade) { setMsg("Informe a validade (dd/mm/aaaa)."); return; }
    setSalvando(true);
    try {
      const instr = instrucaoArrumacao(sel, validade);
      const loteId = await onEntrada({ produto: sel, qtd: n, validade, localId, fornecedor: fornecedor || undefined });
      if (pendenteAtivo) { await onResolver(pendenteAtivo.id, loteId, "confirmada"); setPendenteAtivo(null); }
      setMsg(`✓ Entrada de ${n} ${sel.unidade} de ${sel.nome} (vence ${fmtBR(validade)}). ${instr}`);
      setSel(null); setQtd(""); setValidadeBr(""); setLocalId(""); setFornecedor(""); setBusca(""); setMetodo("");
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Confirme os <b>pendentes do recebimento</b> (a NF vira rascunho aqui) ou dê entrada manual. Informe a validade — o sistema diz onde arrumar (PVPS/PEPS).</p>
      {!sel ? (
        <div>
          {pendentes.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1.5">📥 Pendentes do recebimento ({pendentes.length})</div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                {pendentes.map((p) => (
                  <div key={p.id} className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.descricaoNota}</div>
                      <div className="text-[11px] text-gray-500">{p.quantidade != null ? `${p.quantidade} ${p.unidade || ""}` : "qtd —"}{p.fornecedor ? ` · ${p.fornecedor}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" onClick={() => lancarPendente(p)}>Lançar</Button>
                      <button type="button" onClick={() => void onResolver(p.id, null, "descartada")} className="text-xs px-2 py-1 text-gray-400 hover:text-rose-600" title="Descartar">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="max-w-2xl"><SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto pra dar entrada…" /></div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(busca.trim() ? achados : produtos.filter((p) => p.ativo).slice().sort((a, b) => a.nome.localeCompare(b.nome))).map((p) => (
              <button key={p.id} type="button" onClick={() => escolher(p)} className="text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</button>
            ))}
          </div>
          {produtos.length === 0 && <p className="text-xs text-gray-400 mt-2">Nenhum produto. Cadastre em <b>Cadastro › Produtos</b>.</p>}
        </div>
      ) : (
        <div className="max-w-2xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{sel.nome}</span>
            <button type="button" onClick={() => { setSel(null); setMsg(""); }} className="text-xs text-gray-400 hover:underline">trocar</button>
          </div>
          {metodosDoProduto.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Conservação (sugere a validade)</label>
              <div className="flex flex-wrap gap-1.5">
                {metodosDoProduto.map((m) => (
                  <button key={m.k} type="button" onClick={() => trocarMetodo(m.k)} className={`px-3 py-1.5 text-xs font-medium rounded-full border ${metodo === m.k ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{m.icon} {m.label} · {sel.conservacao[m.k]}d</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500 block mb-1">Quantidade ({sel.unidade})</label><input value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" inputMode="decimal" className={inp} /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Validade</label><input value={validadeBr} onChange={(e) => setValidadeBr(e.target.value)} placeholder="dd/mm/aaaa" className={inp} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500 block mb-1">Local <span className="text-gray-400">(opcional)</span></label>
              <select value={localId} onChange={(e) => setLocalId(e.target.value)} className={inp}><option value="">—</option>{locais.filter((l) => l.ativo).map((l) => <option key={l.id} value={l.id}>{LOCAL_ESTOQUE_TIPO_LABEL[l.tipo].icon} {l.nome}</option>)}</select>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Fornecedor <span className="text-gray-400">(opcional)</span></label><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className={inp} /></div>
          </div>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "…" : "Dar entrada"}</Button>
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"}`}>{msg}</div>}
    </div>
  );
}

// ═══ CADASTRO › LOCAIS ═══════════════════════════════════════════════════════
function LocaisTab({ locais, restauranteNome, podeEditar, onNovo, onEditar, onExcluir }: {
  locais: LocalEstoque[]; restauranteNome?: string; podeEditar: boolean; onNovo: () => void; onEditar: (l: LocalEstoque) => void; onExcluir: (l: LocalEstoque) => void;
}) {
  const porTipo = useMemo(() => {
    const m = new Map<LocalEstoqueTipo, LocalEstoque[]>();
    for (const l of locais.slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome))) { const arr = m.get(l.tipo) || []; arr.push(l); m.set(l.tipo, arr); }
    return m;
  }, [locais]);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-gray-500 max-w-lg">Onde os produtos ficam estocados{restauranteNome ? ` no ${restauranteNome}` : ""} — geladeiras, câmaras, prateleiras, seco…</p>
        {podeEditar && <Button size="sm" onClick={onNovo}>+ Novo local</Button>}
      </div>
      {locais.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum local ainda. {podeEditar ? "Cadastre geladeiras, câmaras e prateleiras." : ""}</div>
      ) : (
        <div className="space-y-4">
          {TIPOS.filter((t) => (porTipo.get(t) || []).length > 0).map((t) => (
            <div key={t}>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1.5"><span>{LOCAL_ESTOQUE_TIPO_LABEL[t].icon}</span> {LOCAL_ESTOQUE_TIPO_LABEL[t].label}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(porTipo.get(t) || []).map((l) => (
                  <div key={l.id} className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${l.ativo ? "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" : "border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/20 opacity-70"}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.nome}</div>
                      {l.paiId && <div className="text-[11px] text-gray-400 truncate">dentro de {locais.find((x) => x.id === l.paiId)?.nome || "—"}</div>}
                      {!l.ativo && <div className="text-[11px] text-gray-400">inativo</div>}
                    </div>
                    {podeEditar && <div className="flex items-center gap-1 shrink-0"><button type="button" onClick={() => onEditar(l)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Editar">✎</button><button type="button" onClick={() => onExcluir(l)} className="text-xs px-2 py-1 rounded text-gray-300 hover:text-rose-600" title="Excluir">🗑</button></div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ CADASTRO › PRODUTOS ═════════════════════════════════════════════════════
function ProdutosTab({ produtos, podeEditar, onNovo, onEditar, onExcluir, onEtiqueta }: {
  produtos: ProdutoEtiqueta[]; podeEditar: boolean; onNovo: () => void; onEditar: (p: ProdutoEtiqueta) => void; onExcluir: (p: ProdutoEtiqueta) => void; onEtiqueta: (p: ProdutoEtiqueta) => void;
}) {
  const [busca, setBusca] = useState("");
  const lista = produtos.filter((p) => !busca.trim() || p.nome.toLowerCase().includes(busca.toLowerCase())).sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-gray-500 max-w-lg">Um produto com <b>matriz de conservação</b> (método → dias). Cada um tem sua etiqueta fixa de estoque (QR). Nada de duplicar por método.</p>
        {podeEditar && <Button size="sm" onClick={onNovo}>+ Novo produto</Button>}
      </div>
      <div className="max-w-2xl mb-3"><SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto…" /></div>
      {lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum produto. {podeEditar ? "Cadastre o primeiro." : ""}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          {lista.map((p) => (
            <div key={p.id} className={`rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-2 ${p.ativo ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome} <span className="text-xs font-normal text-gray-400">· {p.unidade}</span></div>
                <div className="text-[11px] text-gray-400 flex flex-wrap gap-1.5 mt-0.5">
                  {METODOS.filter((m) => p.conservacao[m.k] != null).map((m) => <span key={m.k}>{m.icon} {p.conservacao[m.k]}d</span>)}
                  {p.categoria && <span>· {p.categoria}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => onEtiqueta(p)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-indigo-600" title="Etiqueta fixa (QR)">🏷️</button>
                {podeEditar && <><button type="button" onClick={() => onEditar(p)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Editar">✎</button><button type="button" onClick={() => onExcluir(p)} className="text-xs px-2 py-1 rounded text-gray-300 hover:text-rose-600" title="Excluir">🗑</button></>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ MODAIS ══════════════════════════════════════════════════════════════════
function LocalModal({ local, locais, onClose, onSalvar }: {
  local: LocalEstoque | null; locais: LocalEstoque[]; onClose: () => void; onSalvar: (l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(local?.nome || "");
  const [tipo, setTipo] = useState<LocalEstoqueTipo>(local?.tipo || "geladeira");
  const [paiId, setPaiId] = useState<string>(local?.paiId || "");
  const [ativo, setAtivo] = useState<boolean>(local?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const pais = locais.filter((l) => l.id !== local?.id);
  async function salvar() { if (!nome.trim()) return; setSalvando(true); try { await onSalvar({ id: local?.id, restaurantId: local?.restaurantId || "", nome: nome.trim(), tipo, paiId: paiId || null, ativo }); } finally { setSalvando(false); } }
  return (
    <Modal title={local ? "Editar local" : "Novo local de estoque"} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div><label className="text-xs text-gray-500 block mb-1">Nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Geladeira 1, Câmara de congelados…" className={inp} autoFocus /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Tipo</label><select value={tipo} onChange={(e) => setTipo(e.target.value as LocalEstoqueTipo)} className={inp}>{TIPOS.map((t) => <option key={t} value={t}>{LOCAL_ESTOQUE_TIPO_LABEL[t].icon} {LOCAL_ESTOQUE_TIPO_LABEL[t].label}</option>)}</select></div>
          <div><label className="text-xs text-gray-500 block mb-1">Dentro de <span className="text-gray-400">(opcional)</span></label><select value={paiId} onChange={(e) => setPaiId(e.target.value)} className={inp}><option value="">— nenhum —</option>{pais.map((l) => <option key={l.id} value={l.id}>{LOCAL_ESTOQUE_TIPO_LABEL[l.tipo].icon} {l.nome}</option>)}</select></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo</label>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando || !nome.trim()}>{salvando ? "Salvando…" : local ? "Salvar" : "Criar"}</Button></div>
      </div>
    </Modal>
  );
}

function ProdutoModal({ produto, onClose, onSalvar }: {
  produto: ProdutoEtiqueta | null; onClose: () => void; onSalvar: (p: Partial<ProdutoEtiqueta> & { id?: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(produto?.nome || "");
  const [categoria, setCategoria] = useState(produto?.categoria || "");
  const [unidade, setUnidade] = useState(produto?.unidade || "unid");
  const [cons, setCons] = useState<Conservacao>(produto?.conservacao || {});
  const [estoqueMinimo, setEstoqueMinimo] = useState(produto?.estoqueMinimo != null ? String(produto.estoqueMinimo) : "");
  const [marca, setMarca] = useState(produto?.marcaFornecedor || "");
  const [sif, setSif] = useState(produto?.sif || "");
  const [precoCusto, setPrecoCusto] = useState(produto?.precoCusto != null ? String(produto.precoCusto) : "");
  const [ativo, setAtivo] = useState<boolean>(produto?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  const temMetodo = METODOS.some((m) => cons[m.k] != null);
  function setDias(k: MetodoKey, v: string) {
    const n = parseInt(v.replace(/\D/g, ""), 10);
    setCons((prev) => { const c = { ...prev }; if (v === "" || isNaN(n)) delete c[k]; else c[k] = n; return c; });
  }
  async function salvar() {
    if (!nome.trim() || !temMetodo) return;
    setSalvando(true);
    try {
      await onSalvar({ id: produto?.id, nome: nome.trim(), categoria: categoria.trim() || undefined, unidade: unidade.trim() || "unid", conservacao: cons, estoqueMinimo: estoqueMinimo ? parseFloat(estoqueMinimo.replace(",", ".")) : null, marcaFornecedor: marca.trim() || null, sif: sif.trim() || null, precoCusto: precoCusto ? parseFloat(precoCusto.replace(",", ".")) : null, ativo });
    } finally { setSalvando(false); }
  }
  return (
    <Modal title={produto ? "Editar produto" : "Novo produto"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div><label className="text-xs text-gray-500 block mb-1">Nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Farinha de trigo" className={inp} autoFocus /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Unidade</label><input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="kg, unid, L…" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Categoria <span className="text-gray-400">(opc.)</span></label><input value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inp} /></div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Conservação — validade por método (dias) <span className="text-rose-500">*</span></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {METODOS.map((m) => (
              <div key={m.k} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-2.5 py-1.5">
                <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{m.icon} {m.label}</span>
                <input value={cons[m.k] != null ? String(cons[m.k]) : ""} onChange={(e) => setDias(m.k, e.target.value)} placeholder="—" inputMode="numeric" className="w-16 h-8 px-2 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                <span className="text-xs text-gray-400">dias</span>
              </div>
            ))}
          </div>
          {!temMetodo && <p className="text-[11px] text-gray-400 mt-1">Preencha ao menos um método.</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Estoque mínimo</label><input value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder="—" inputMode="decimal" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Preço custo (R$/{unidade})</label><input value={precoCusto} onChange={(e) => setPrecoCusto(e.target.value)} placeholder="—" inputMode="decimal" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">SIF/Registro</label><input value={sif} onChange={(e) => setSif(e.target.value)} className={inp} /></div>
        </div>
        <div><label className="text-xs text-gray-500 block mb-1">Marca / Fornecedor <span className="text-gray-400">(opc.)</span></label><input value={marca} onChange={(e) => setMarca(e.target.value)} className={inp} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo</label>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando || !nome.trim() || !temMetodo}>{salvando ? "Salvando…" : produto ? "Salvar" : "Criar"}</Button></div>
      </div>
    </Modal>
  );
}

// Etiqueta FIXA de estoque (1 por produto) com QR — imprime e cola no local.
function EtiquetaFixaModal({ produto, onClose }: { produto: ProdutoEtiqueta; onClose: () => void }) {
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(produto.qrTokenEstoque, { width: 320, margin: 1 }).then(setQr).catch(() => setQr("")); }, [produto.qrTokenEstoque]);
  function imprimir() {
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    const nomeSafe = produto.nome.replace(/[<>&]/g, "");
    w.document.write(`<!doctype html><html><head><title>Etiqueta ${nomeSafe}</title><style>*{font-family:system-ui,Arial,sans-serif}body{margin:0;padding:16px;text-align:center}.box{border:2px solid #111;border-radius:10px;padding:16px;display:inline-block;width:280px}.nome{font-size:20px;font-weight:800;margin:4px 0 2px}.tag{font-size:11px;letter-spacing:2px;color:#555}img{width:200px;height:200px}.hint{font-size:11px;color:#555;margin-top:6px}</style></head><body onload="window.print()"><div class="box"><div class="tag">ESTOQUE</div><div class="nome">${nomeSafe}</div><img src="${qr}"/><div class="hint">Leia este QR no app pra dar baixa</div></div></body></html>`);
    w.document.close();
  }
  return (
    <Modal title="Etiqueta fixa de estoque" onClose={onClose} maxWidth="max-w-sm">
      <div className="text-center space-y-3">
        <div className="inline-block border-2 border-gray-900 dark:border-gray-100 rounded-xl p-4">
          <div className="text-[10px] tracking-widest text-gray-500">ESTOQUE</div>
          <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{produto.nome}</div>
          {qr ? <img src={qr} alt="QR" className="w-40 h-40 mx-auto" /> : <div className="w-40 h-40 mx-auto flex items-center justify-center text-xs text-gray-400">gerando…</div>}
          <div className="text-[11px] text-gray-500">Leia este QR no app pra dar baixa</div>
        </div>
        <p className="text-xs text-gray-500">Cole no local do estoque. Uma etiqueta fixa por produto — os lotes ficam no sistema.</p>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={imprimir} disabled={!qr}>🖨️ Imprimir</Button></div>
      </div>
    </Modal>
  );
}

// Leitor de QR (câmera via BarcodeDetector nativo) — fallback: digitar o código.
type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
function ScannerModal({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [erro, setErro] = useState("");
  const [manual, setManual] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let parar = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    (async () => {
      if (!Ctor) { setErro("Leitura por câmera não suportada aqui — digite o código do QR."); return; }
      try {
        const det = new Ctor({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const tick = async () => {
          if (parar || !videoRef.current) return;
          try { const codes = await det.detect(videoRef.current); const v = codes[0]?.rawValue; if (v) { onDetect(v); return; } } catch { /* frame ruim */ }
          raf = requestAnimationFrame(tick);
        };
        void tick();
      } catch { setErro("Não consegui abrir a câmera — digite o código do QR."); }
    })();
    return () => { parar = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onDetect]);
  return (
    <Modal title="Ler QR do produto" onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        {!erro ? (
          <div className="rounded-xl overflow-hidden bg-black aspect-square"><video ref={videoRef} className="w-full h-full object-cover" muted playsInline /></div>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">{erro}</p>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1"><label className="text-xs text-gray-500 block mb-1">Ou digite o código</label><input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="qr_…" className={inp} /></div>
          <Button onClick={() => manual.trim() && onDetect(manual.trim())} disabled={!manual.trim()}>OK</Button>
        </div>
      </div>
    </Modal>
  );
}
