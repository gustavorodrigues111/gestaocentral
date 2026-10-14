// Módulo COMANDAS — PDV simplificado (peixaria Sororoca). Comanda eletrônica
// no celular/PC; ticket de produção impresso numa Epson TM-T20 pela ESTAÇÃO DE
// IMPRESSÃO (aba separada num PC logado). Sem fiscal: só comanda + conta.
//
// Dois fluxos: CONTA ABERTA (fica consumindo) × TO-GO (lança e fecha na hora).
// Produto pode ser por PESO (preço/kg, lança-se o peso) — balança Prix 4 depois.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Printer, Trash2, X, Scale, Package, Search, Check, Receipt, Minus, User, Tag, Eye, Clock, ChevronLeft } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import type { Comanda, ComandaItem, ComandaProduto, ComandaPagamento, ComandaPrintJob, ComandaCategoria } from "../../core/types";
import {
  uid, ouvirProdutos, salvarProduto, excluirProduto,
  ouvirComandas, salvarComanda, criarPrintJob,
  ouvirCategorias, salvarCategoria, excluirCategoria,
} from "./comandasRepo";
import { EstacaoImpressao } from "./EstacaoImpressao";

const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (n: number, dec = 0) => (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: 3 });
const nowIso = () => new Date().toISOString();
const FORMAS = ["Pix", "Dinheiro", "Débito", "Crédito", "Outro"];

export function ComandasPage() {
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const { can } = useCanAcao(rid);

  const [produtos, setProdutos] = useState<ComandaProduto[]>([]);
  const [categorias, setCategorias] = useState<ComandaCategoria[]>([]);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [abrindo, setAbrindo] = useState<null | "conta" | "togo">(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);   // comandaId aberta no detalhe
  const [verFechadas, setVerFechadas] = useState(false);
  // Estação de impressão: abre por ?estacao=1 na URL (num PC com a Epson).
  const estacao = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("estacao") === "1";

  useEffect(() => { if (!rid) return; return ouvirProdutos(rid, setProdutos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirComandas(rid, setComandas); }, [rid]);

  const meNome = me?.nome || "—";
  const podeVer = can("comandas", "ver");
  const podeOperar = can("comandas", "operar");
  const podeProdutos = can("comandas", "produtos");
  const podeFechadas = can("comandas", "fechadas");
  const podeRelatorios = can("comandas", "relatorios");
  const podeEstacoes = can("comandas", "estacoes");
  const podeConfigTab = podeProdutos || podeEstacoes;

  // Abas (persistem no reload). Só mostra as permitidas.
  const abasDisp = useMemo(() => {
    const a: { id: string; label: string }[] = [{ id: "comandas", label: "Comandas" }];
    if (podeRelatorios) a.push({ id: "relatorios", label: "Relatórios" });
    if (podeConfigTab) a.push({ id: "config", label: "Config" });
    return a;
  }, [podeRelatorios, podeConfigTab]);
  const [tab, setTab] = useTabPersistida<string>("comandas", "comandas", abasDisp.map((a) => a.id));

  const abertas = useMemo(() => comandas.filter((c) => c.status === "aberta"), [comandas]);
  const hojeYmd = new Date().toLocaleDateString("en-CA");
  const fechadasHoje = useMemo(() => comandas.filter((c) => c.status === "fechada" && (c.fechadoEm || c.criadoEm || "").slice(0, 10) === hojeYmd), [comandas, hojeYmd]);
  const comandaDet = useMemo(() => comandas.find((c) => c.id === detalhe) || null, [comandas, detalhe]);

  if (estacao) return <EstacaoImpressao rid={rid} nomeRest={activeRestaurant?.nome || ""} />;
  if (!podeVer) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Comandas.</div>;

  async function abrirComanda(dados: { numero: string; clienteNome: string; cpf?: string; telefone?: string; pessoas: number; modo: "conta" | "togo" }) {
    const c: Comanda = {
      id: uid(), restaurantId: rid, numero: dados.numero.trim(), clienteNome: dados.clienteNome.trim(),
      cpf: dados.cpf?.trim() || null, telefone: dados.telefone?.trim() || null, pessoas: dados.pessoas || 1,
      status: "aberta", modo: dados.modo, itens: [], total: 0, pagamentos: [], valorPago: 0,
      criadoEm: nowIso(), criadoPor: me?.id, criadoPorNome: meNome,
    };
    await salvarComanda(c);
    setAbrindo(null);
    setDetalhe(c.id);
  }
  const tabEfetiva = abasDisp.some((a) => a.id === tab) ? tab : "comandas";

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div>
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Receipt size={20} className="text-indigo-500" /> Comandas</h1>
          <p className="text-[12px] text-gray-500">{activeRestaurant?.nome || ""}</p>
        </div>
        <a href={`?estacao=1`} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5" title="Abrir a estação de impressão (num PC com a Epson)"><Printer size={15} /> Estação</a>
      </div>

      {/* Abas do módulo (só as permitidas) */}
      {abasDisp.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-3 -mt-1 overflow-x-auto no-scrollbar">
          {abasDisp.map((a) => (
            <button key={a.id} onClick={() => setTab(a.id)} className={`shrink-0 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tabEfetiva === a.id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>{a.label}</button>
          ))}
        </div>
      )}

      {tabEfetiva === "comandas" && (
        <>
          {podeOperar && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => setAbrindo("conta")} className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 h-14 font-bold inline-flex items-center justify-center gap-1.5"><Plus size={18} /> Abrir comanda</button>
              <button onClick={() => setAbrindo("togo")} className="rounded-2xl border-2 border-dashed border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 h-14 font-bold inline-flex items-center justify-center gap-1.5"><Package size={18} /> Venda rápida</button>
            </div>
          )}

          {podeFechadas && (
            <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-800 p-0.5 mb-3 text-sm">
              <button onClick={() => setVerFechadas(false)} className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 ${!verFechadas ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}><Receipt size={14} /> Abertas ({abertas.length})</button>
              <button onClick={() => setVerFechadas(true)} className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 ${verFechadas ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}><Clock size={14} /> Fechadas hoje ({fechadasHoje.length})</button>
            </div>
          )}

          {(() => {
            const lista = (podeFechadas && verFechadas) ? fechadasHoje : abertas;
            if (lista.length === 0) return (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-400">
                <Receipt size={38} className="mx-auto mb-2 text-gray-300" />
                <div className="font-semibold text-gray-600 dark:text-gray-300">{verFechadas ? "Nenhuma comanda fechada hoje" : "Nenhuma comanda aberta"}</div>
                {!verFechadas && podeOperar && <div className="text-sm mt-1">Abra uma comanda pra começar a lançar.</div>}
              </div>
            );
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {lista.map((c) => (
                  <button key={c.id} onClick={() => setDetalhe(c.id)} className={`text-left rounded-2xl border p-3 shadow-sm ${c.status === "fechada" ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-300 dark:hover:border-indigo-700"}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">#{c.numero}</span>
                      {c.status === "fechada" ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">paga</span> : c.modo === "togo" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">to-go</span>}
                    </div>
                    <div className="font-bold text-gray-900 dark:text-gray-100 truncate mt-1.5">{c.clienteNome || "—"}</div>
                    <div className="text-[12px] text-gray-500">{c.itens.length} item(ns){c.pessoas && c.pessoas > 1 ? ` · ${c.pessoas}p` : ""}</div>
                    <div className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums mt-0.5">{fmtR(c.total)}</div>
                  </button>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {tabEfetiva === "relatorios" && podeRelatorios && (
        <RelatorioComandas comandas={comandas} />
      )}

      {tabEfetiva === "config" && podeConfigTab && (
        <ConfigComandas rid={rid} produtos={produtos} categorias={categorias} podeProdutos={podeProdutos} podeEstacoes={podeEstacoes} />
      )}

      {abrindo && <AbrirComandaModal modo={abrindo} onClose={() => setAbrindo(null)} onAbrir={abrirComanda} />}
      {comandaDet && (
        <ComandaDetalhe
          comanda={comandaDet} produtos={produtos.filter((p) => p.ativo)} categorias={categorias}
          podeOperar={podeOperar}
          meNome={meNome} nomeRest={activeRestaurant?.nome || ""} rid={rid}
          onClose={() => setDetalhe(null)}
        />
      )}
    </PageContainer>
  );
}

// ── Config do módulo (abas internas: Produtos · Estação) ───────────────────
function ConfigComandas({ rid, produtos, categorias, podeProdutos, podeEstacoes }: {
  rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; podeProdutos: boolean; podeEstacoes: boolean;
}) {
  const subs = [
    ...(podeProdutos ? [{ id: "produtos", label: "Produtos" }] : []),
    ...(podeEstacoes ? [{ id: "estacao", label: "Estação de impressão" }] : []),
  ];
  const [sub, setSub] = useState(subs[0]?.id || "produtos");
  return (
    <div>
      {subs.length > 1 && (
        <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-800 p-0.5 mb-3 text-sm">
          {subs.map((s) => <button key={s.id} onClick={() => setSub(s.id)} className={`px-3 py-1.5 rounded-lg font-semibold ${sub === s.id ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}>{s.label}</button>)}
        </div>
      )}
      {sub === "produtos" && podeProdutos && <ProdutosPanel rid={rid} produtos={produtos} categorias={categorias} />}
      {sub === "estacao" && podeEstacoes && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 max-w-lg text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Printer size={16} className="text-indigo-500" /> Estação de impressão</div>
          <p>Num PC com a Epson instalada como impressora <b>padrão</b>, abra o Chrome em impressão silenciosa e deixe a estação aberta:</p>
          <ol className="list-decimal ml-5 space-y-0.5 text-[13px]">
            <li>Mac: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">open -a "Google Chrome" --args --kiosk-printing</code></li>
            <li>Windows: atalho do Chrome com <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">--kiosk-printing</code> no final.</li>
            <li>Abra o módulo Comandas nessa janela e clique em <b>Estação</b> (botão no topo).</li>
          </ol>
          <a href={`?estacao=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold mt-1"><Printer size={15} /> Abrir estação agora</a>
        </div>
      )}
    </div>
  );
}

// ── Abrir comanda ────────────────────────────────────────────────────────
function AbrirComandaModal({ modo, onClose, onAbrir }: {
  modo: "conta" | "togo";
  onClose: () => void;
  onAbrir: (d: { numero: string; clienteNome: string; cpf?: string; telefone?: string; pessoas: number; modo: "conta" | "togo" }) => Promise<void>;
}) {
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [tel, setTel] = useState("");
  const [pessoas, setPessoas] = useState("1");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function salvar() {
    if (!nome.trim()) { setErr("Nome do cliente é obrigatório."); return; }
    if (modo === "conta" && !numero.trim()) { setErr("Nº da pulseira é obrigatório na conta aberta."); return; }
    setErr(""); setSaving(true);
    try { await onAbrir({ numero: numero.trim() || "—", clienteNome: nome, cpf, telefone: tel, pessoas: Math.max(1, parseInt(pessoas, 10) || 1), modo }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Erro"); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><User size={16} className="text-indigo-500" /> {modo === "togo" ? "Venda rápida (to-go)" : "Abrir comanda"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nº pulseira {modo === "togo" ? "(opcional)" : "*"}</label>
              <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="ex.: 12" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nome *</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="nome do cliente" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Pessoas</label>
              <input value={pessoas} onChange={(e) => setPessoas(e.target.value)} type="number" min={1} className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">CPF</label>
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="opc." className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Telefone</label>
              <input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="opc." className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
            <button onClick={salvar} disabled={saving} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{saving ? "..." : "Abrir e lançar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detalhe da comanda (lançar itens, imprimir, fechar) ───────────────────
function ComandaDetalhe({ comanda, produtos, categorias, podeOperar, meNome, nomeRest, rid, onClose }: {
  comanda: Comanda; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; podeOperar: boolean; meNome: string; nomeRest: string; rid: string;
  onClose: () => void;
}) {
  const fechada = comanda.status === "fechada";
  const editavel = podeOperar && !fechada;
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string>("todas");   // "todas" | categoriaId | "sem"
  const [pesoDe, setPesoDe] = useState<ComandaProduto | null>(null);   // produto por peso aguardando o peso
  const [fechar, setFechar] = useState(false);
  const [verConta, setVerConta] = useState(false);          // tela pra mostrar ao cliente
  const [salvandoImpr, setSalvandoImpr] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Só categorias que têm produtos ativos.
  const catsComProd = useMemo(() => {
    const ids = new Set(produtos.map((p) => p.categoriaId || "sem"));
    const out = categorias.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, nome: c.nome }));
    if (ids.has("sem")) out.push({ id: "sem", nome: "Outros" });
    return out;
  }, [produtos, categorias]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (catSel !== "todas") { const k = p.categoriaId || "sem"; if (k !== catSel) return false; }
      if (!q) return true;
      return p.nome.toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q);
    });
  }, [produtos, busca, catSel]);

  function recompor(itens: ComandaItem[]): Partial<Comanda> {
    const total = itens.reduce((s, i) => s + (i.total || 0), 0);
    return { itens, total };
  }
  async function patch(campos: Partial<Comanda>) {
    await salvarComanda({ ...comanda, ...campos } as Comanda);
  }

  async function addItem(p: ComandaProduto, qtd: number) {
    if (qtd <= 0) return;
    const item: ComandaItem = {
      id: uid(), produtoId: p.id, nome: p.nome, qtd, porPeso: !!p.porPeso,
      precoUnit: p.preco || 0, total: +(qtd * (p.preco || 0)).toFixed(2),
      producao: !!p.producao, impressoEm: null, criadoEm: nowIso(), criadoPorNome: meNome,
    };
    const itens = [...comanda.itens, item];
    await patch(recompor(itens));
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 60);
  }
  function tapProduto(p: ComandaProduto) {
    if (p.porPeso) { setPesoDe(p); return; }
    void addItem(p, 1);
  }
  async function mudarQtd(itemId: string, delta: number) {
    const itens = comanda.itens.map((i) => {
      if (i.id !== itemId || i.porPeso) return i;   // peso não usa +/- (editar removendo)
      const q = Math.max(0, i.qtd + delta);
      return { ...i, qtd: q, total: +(q * i.precoUnit).toFixed(2) };
    }).filter((i) => i.qtd > 0);
    await patch(recompor(itens));
  }
  async function removerItem(itemId: string) {
    await patch(recompor(comanda.itens.filter((i) => i.id !== itemId)));
  }

  // Ticket de PRODUÇÃO: só os itens de produção ainda NÃO impressos.
  const pendentesProducao = comanda.itens.filter((i) => i.producao && !i.impressoEm);
  async function imprimirProducao() {
    if (!pendentesProducao.length) return;
    setSalvandoImpr(true);
    try {
      const job: ComandaPrintJob = {
        id: uid(), restaurantId: rid, tipo: "producao", comandaId: comanda.id,
        comandaNumero: comanda.numero, clienteNome: comanda.clienteNome,
        titulo: `PRODUÇÃO · #${comanda.numero}`,
        linhas: pendentesProducao.map((i) => ({ nome: i.nome, qtd: i.porPeso ? `${fmtNum(i.qtd, 3)} kg` : `${i.qtd}x`, valor: null })),
        total: null, rodape: `${comanda.clienteNome} · ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${meNome}`,
        status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
      };
      await criarPrintJob(job);
      const marcadoEm = nowIso();
      const itens = comanda.itens.map((i) => (i.producao && !i.impressoEm ? { ...i, impressoEm: marcadoEm } : i));
      await patch(recompor(itens));
    } finally { setSalvandoImpr(false); }
  }

  function pedirFechar() {
    if (pendentesProducao.length && !confirm(`Há ${pendentesProducao.length} item(ns) de cozinha ainda NÃO enviados pra produção. Fechar mesmo assim?`)) return;
    setFechar(true);
  }
  async function reabrir() {
    if (!confirm("Reabrir esta comanda? Ela volta pra lista de abertas.")) return;
    await salvarComanda({ ...comanda, status: "aberta", fechadoEm: null, fechadoPorNome: null });
  }
  async function reimprimirConta() {
    const job: ComandaPrintJob = {
      id: uid(), restaurantId: rid, tipo: "conta", comandaId: comanda.id,
      comandaNumero: comanda.numero, clienteNome: comanda.clienteNome,
      titulo: `${nomeRest || "CONTA"} · #${comanda.numero}`,
      linhas: comanda.itens.map((i) => ({ nome: `${i.porPeso ? `${fmtNum(i.qtd, 3)}kg ` : `${i.qtd}x `}${i.nome}`, qtd: null, valor: fmtR(i.total) })),
      total: fmtR(comanda.total),
      rodape: `${comanda.clienteNome}${comanda.cpf ? ` · CPF ${comanda.cpf}` : ""}\n${(comanda.pagamentos || []).map((p) => `${p.forma}: ${fmtR(p.valor)}`).join("  ")}\n2ª via · ${new Date().toLocaleString("pt-BR")}`,
      status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
    };
    await criarPrintJob(job);
  }

  return (
    <div className="fixed inset-0 z-[65] bg-white dark:bg-gray-950 flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button onClick={onClose} className="w-9 h-9 rounded-full text-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 grid place-items-center">←</button>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-900 dark:text-gray-100 truncate leading-tight">#{comanda.numero} · {comanda.clienteNome}{comanda.modo === "togo" && <span className="text-[11px] text-emerald-600 ml-1">to-go</span>}</div>
          <div className="text-[11px] text-gray-500">{comanda.itens.length} item(ns)</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-gray-400 font-bold">Total</div>
          <div className="text-lg font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums leading-none">{fmtR(comanda.total)}</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
        {/* Itens lançados */}
        <div ref={scrollRef} className={`${fechada ? "w-full" : "sm:w-[44%] sm:border-r"} border-gray-100 dark:border-gray-800 overflow-y-auto ${fechada ? "" : "p-3 space-y-1.5"} order-2 sm:order-1 ${fechada ? "" : "max-h-[38vh] sm:max-h-none"}`}>
          {fechada ? <ContaCupom comanda={comanda} nomeRest={nomeRest} /> : comanda.itens.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">{fechada ? "Sem itens." : "Toque num produto pra lançar."}</div>
          ) : comanda.itens.map((i) => (
            <div key={i.id} className="flex items-center gap-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{i.nome}{i.producao && <span className="text-[10px] text-amber-600 ml-1">{i.impressoEm ? "✓ cozinha" : "· não enviado"}</span>}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{i.porPeso ? `${fmtNum(i.qtd, 3)} kg × ${fmtR(i.precoUnit)}/kg` : `${i.qtd} × ${fmtR(i.precoUnit)}`}</div>
              </div>
              {!i.porPeso && editavel && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => void mudarQtd(i.id, -1)} className="w-6 h-6 rounded grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Minus size={13} /></button>
                  <button onClick={() => void mudarQtd(i.id, +1)} className="w-6 h-6 rounded grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Plus size={13} /></button>
                </div>
              )}
              <div className="text-[13px] font-semibold tabular-nums shrink-0 w-[70px] text-right">{fmtR(i.total)}</div>
              {editavel && <button onClick={() => void removerItem(i.id)} className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>

        {/* Grade de produtos (só quando a comanda está aberta) */}
        {editavel && (
          <div className="flex-1 min-h-0 flex flex-col order-1 sm:order-2">
            {/* Abas de categoria */}
            {catsComProd.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto px-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-800 no-scrollbar">
                {[{ id: "todas", nome: "Todas" }, ...catsComProd].map((c) => (
                  <button key={c.id} onClick={() => setCatSel(c.id)} className={`shrink-0 px-3 h-8 rounded-full text-[13px] font-semibold border ${catSel === c.id ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{c.nome}</button>
                ))}
              </div>
            )}
            <div className="p-2 border-b border-gray-100 dark:border-gray-800">
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou código…" className="w-full h-9 pl-8 pr-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filtrados.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">Nenhum produto. Cadastre em “Produtos”.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filtrados.map((p) => (
                    <button key={p.id} onClick={() => tapProduto(p)}
                      className="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-[0.98] transition-transform">
                      {p.codigo && <div className="text-[10px] font-mono text-gray-400">#{p.codigo}</div>}
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">{p.nome}</div>
                      <div className="text-[12px] text-indigo-700 dark:text-indigo-300 font-bold tabular-nums mt-1">{fmtR(p.preco)}{p.porPeso ? "/kg" : ""}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {p.porPeso && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><Scale size={10} /> peso</span>}
                        {p.producao && <span className="text-[10px] text-amber-500">cozinha</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 p-2.5 flex items-center gap-2">
        {fechada ? (
          <>
            <button onClick={() => void reimprimirConta()} className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Printer size={17} /> Reimprimir</button>
            {podeOperar && <button onClick={() => void reabrir()} className="flex-1 h-11 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold">Reabrir</button>}
          </>
        ) : editavel ? (
          <>
            <button onClick={() => void imprimirProducao()} disabled={!pendentesProducao.length || salvandoImpr}
              className="h-11 px-3 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
              <Printer size={17} /> Cozinha{pendentesProducao.length ? ` (${pendentesProducao.length})` : ""}
            </button>
            <button onClick={() => setVerConta(true)} className="h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Eye size={17} /> Conta</button>
            <button onClick={pedirFechar} className="flex-1 h-11 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-1.5">
              <Check size={18} /> Fechar · {fmtR(comanda.total)}
            </button>
          </>
        ) : (
          <button onClick={() => setVerConta(true)} className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Eye size={17} /> Mostrar conta</button>
        )}
      </div>

      {pesoDe && <PesoModal produto={pesoDe} onClose={() => setPesoDe(null)} onConfirmar={(kg) => { void addItem(pesoDe, kg); setPesoDe(null); }} />}
      {fechar && <FecharModal comanda={comanda} meNome={meNome} nomeRest={nomeRest} rid={rid} onClose={() => setFechar(false)} onFechado={() => { setFechar(false); onClose(); }} />}
      {verConta && <ContaClienteView comanda={comanda} nomeRest={nomeRest} onClose={() => setVerConta(false)} />}
    </div>
  );
}

// ── Conta pra mostrar ao cliente (vira o celular) — cupom ──────────────────
function ContaClienteView({ comanda, nomeRest, onClose }: { comanda: Comanda; nomeRest: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[82] bg-gray-100 dark:bg-gray-950 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button onClick={onClose} className="w-9 h-9 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 grid place-items-center"><ChevronLeft size={20} /></button>
        <div className="font-bold text-gray-900 dark:text-gray-100">Conta · #{comanda.numero}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ContaCupom comanda={comanda} nomeRest={nomeRest} />
      </div>
    </div>
  );
}

// Cupom (comanda/recibo) — visual inspirado em cupom fiscal. Reusado na tela do
// cliente e na comanda fechada. Logo da empresa (do módulo Sites) vem na Onda 2.
function ContaCupom({ comanda, nomeRest }: { comanda: Comanda; nomeRest: string }) {
  const saldo = +(comanda.total - (comanda.valorPago || 0)).toFixed(2);
  const porPessoa = comanda.pessoas && comanda.pessoas > 1 ? +(comanda.total / comanda.pessoas).toFixed(2) : null;
  return (
    <div className="mx-auto w-full max-w-[380px] bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 font-mono text-[13px] text-gray-900 dark:text-gray-100">
      <div className="text-center">
        <div className="text-base font-extrabold tracking-wide uppercase">{nomeRest || "Comanda"}</div>
        <div className="text-[11px] text-gray-500">Comanda #{comanda.numero} · {comanda.clienteNome}</div>
        {comanda.cpf && <div className="text-[11px] text-gray-500">CPF {comanda.cpf}</div>}
        <div className="text-[11px] text-gray-400">{new Date(comanda.criadoEm).toLocaleString("pt-BR")}{comanda.pessoas && comanda.pessoas > 1 ? ` · ${comanda.pessoas} pessoas` : ""}</div>
      </div>
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 my-2" />
      <div className="flex text-[10px] text-gray-400 uppercase"><span className="flex-1">Item</span><span className="w-20 text-right">Qtd</span><span className="w-20 text-right">Valor</span></div>
      <div className="mt-1 space-y-1">
        {comanda.itens.map((i) => (
          <div key={i.id} className="flex items-baseline">
            <span className="flex-1 pr-1">{i.nome}</span>
            <span className="w-20 text-right text-gray-500 tabular-nums">{i.porPeso ? `${fmtNum(i.qtd, 3)}kg` : `${i.qtd}`}</span>
            <span className="w-20 text-right tabular-nums">{fmtR(i.total)}</span>
          </div>
        ))}
        {comanda.itens.length === 0 && <div className="text-gray-400 text-center py-2">Sem itens.</div>}
      </div>
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 my-2" />
      <div className="flex items-center justify-between text-lg font-extrabold"><span>TOTAL</span><span className="tabular-nums">{fmtR(comanda.total)}</span></div>
      {porPessoa && <div className="flex items-center justify-between text-[12px] text-gray-500 mt-0.5"><span>Sugestão por pessoa ({comanda.pessoas})</span><span className="tabular-nums">{fmtR(porPessoa)}</span></div>}
      {(comanda.pagamentos || []).length > 0 && (
        <div className="mt-2 text-[12px] text-gray-600 dark:text-gray-300">
          {comanda.pagamentos.map((p, idx) => <div key={idx} className="flex justify-between"><span>{p.forma}</span><span className="tabular-nums">{fmtR(p.valor)}</span></div>)}
          {saldo > 0.001 && <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400"><span>Falta</span><span className="tabular-nums">{fmtR(saldo)}</span></div>}
        </div>
      )}
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 my-2" />
      <div className="text-center text-[10px] text-gray-400">Documento sem valor fiscal</div>
    </div>
  );
}

// ── Peso (produto por kg) ─────────────────────────────────────────────────
function PesoModal({ produto, onClose, onConfirmar }: { produto: ComandaProduto; onClose: () => void; onConfirmar: (kg: number) => void }) {
  const [txt, setTxt] = useState("");
  const kg = parseFloat((txt || "").replace(",", ".")) || 0;
  const total = +(kg * (produto.preco || 0)).toFixed(2);
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="font-extrabold text-xl text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Scale size={22} className="text-indigo-500" /> Digite o peso</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={22} /></button>
        </div>
        <div className="text-[15px] text-gray-600 dark:text-gray-300">{produto.nome} · <b>{fmtR(produto.preco)}/kg</b></div>
        <div className="relative mt-4">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} autoFocus inputMode="decimal" placeholder="0,000"
            className="w-full h-20 pr-14 pl-4 text-right text-5xl font-bold rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 tabular-nums focus:border-indigo-500 outline-none" />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">kg</span>
        </div>
        <div className="text-center text-2xl font-extrabold mt-4 tabular-nums text-indigo-700 dark:text-indigo-300">{fmtR(total)}</div>
        <button onClick={() => kg > 0 && onConfirmar(kg)} disabled={kg <= 0} className="w-full h-14 mt-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg disabled:opacity-40">Lançar</button>
      </div>
    </div>
  );
}

// ── Fechar / pagar ─────────────────────────────────────────────────────────
function FecharModal({ comanda, meNome, nomeRest, rid, onClose, onFechado }: {
  comanda: Comanda; meNome: string; nomeRest: string; rid: string; onClose: () => void; onFechado: () => void;
}) {
  const saldo = +(comanda.total - comanda.valorPago).toFixed(2);
  const [pessoas, setPessoas] = useState(String(comanda.pessoas || 1));
  const [forma, setForma] = useState(FORMAS[0]);
  const [valorTxt, setValorTxt] = useState(saldo > 0 ? saldo.toFixed(2).replace(".", ",") : "");
  const [imprimirConta, setImprimirConta] = useState(true);
  const [saving, setSaving] = useState(false);
  const valor = parseFloat((valorTxt || "").replace(/\./g, "").replace(",", ".")) || 0;
  const nPessoas = Math.max(1, parseInt(pessoas, 10) || 1);
  const porPessoa = +(comanda.total / nPessoas).toFixed(2);
  const vaiFechar = valor >= saldo - 0.001;

  async function confirmar() {
    setSaving(true);
    try {
      const pags: ComandaPagamento[] = valor > 0
        ? [...comanda.pagamentos, { forma, valor, em: new Date().toISOString(), porNome: meNome }]
        : comanda.pagamentos;
      const valorPago = +pags.reduce((s, p) => s + p.valor, 0).toFixed(2);
      const quitou = valorPago >= comanda.total - 0.001;
      const atualizada: Comanda = {
        ...comanda, pessoas: nPessoas, pagamentos: pags, valorPago,
        status: quitou ? "fechada" : "aberta",
        fechadoEm: quitou ? new Date().toISOString() : null,
        fechadoPorNome: quitou ? meNome : null,
      };
      await salvarComanda(atualizada);
      if (imprimirConta) {
        const job: ComandaPrintJob = {
          id: uid(), restaurantId: rid, tipo: "conta", comandaId: comanda.id,
          comandaNumero: comanda.numero, clienteNome: comanda.clienteNome,
          titulo: `${nomeRest || "CONTA"} · #${comanda.numero}`,
          linhas: comanda.itens.map((i) => ({ nome: `${i.porPeso ? `${fmtNum(i.qtd, 3)}kg ` : `${i.qtd}x `}${i.nome}`, qtd: null, valor: fmtR(i.total) })),
          total: fmtR(comanda.total),
          rodape: `${comanda.clienteNome}${comanda.cpf ? ` · CPF ${comanda.cpf}` : ""}\n${forma}: ${fmtR(valor)}${quitou ? "" : ` · saldo ${fmtR(comanda.total - valorPago)}`}\n${new Date().toLocaleString("pt-BR")} · ${meNome}`,
          status: "pendente", criadoEm: new Date().toISOString(), criadoPorNome: meNome, impressoEm: null,
        };
        await criarPrintJob(job);
      }
      onFechado();
    } catch (e) { console.error("[comandas] fechar", e); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Check size={16} className="text-indigo-500" /> Fechar comanda</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 p-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">Total</span>
            <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(comanda.total)}</span>
          </div>
          {comanda.valorPago > 0 && <div className="flex items-center justify-between text-[12px] text-gray-500 mt-0.5"><span>Já pago</span><span className="tabular-nums">{fmtR(comanda.valorPago)} · falta {fmtR(saldo)}</span></div>}
          {/* Dividir por pessoas */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="inline-flex items-center gap-1.5 text-sm">
              <User size={14} className="text-gray-400" /> <span className="text-gray-600 dark:text-gray-300">Dividir por</span>
              <input value={pessoas} onChange={(e) => setPessoas(e.target.value)} type="number" min={1} className="w-14 h-8 px-2 text-center text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            {nPessoas > 1 && <button onClick={() => setValorTxt(porPessoa.toFixed(2).replace(".", ","))} className="text-[12px] px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 font-semibold tabular-nums">{fmtR(porPessoa)}/pessoa</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Forma</label>
            <select value={forma} onChange={(e) => setForma(e.target.value)} className="w-full h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Valor pago</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" className="w-full h-10 pl-8 pr-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
          <input type="checkbox" checked={imprimirConta} onChange={(e) => setImprimirConta(e.target.checked)} className="accent-indigo-600" />
          Imprimir a conta
        </label>
        {!vaiFechar && valor > 0 && <div className="text-[12px] text-amber-600 dark:text-amber-400 mt-2">Pagamento parcial — a comanda continua <b>aberta</b> pra seguir consumindo.</div>}
        <div className="flex justify-end gap-2 pt-3 mt-2 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={saving} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{saving ? "..." : (vaiFechar ? "Pagar e fechar" : "Registrar pagamento")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard de vendas (tempo real) ──────────────────────────────────────
function RelatorioComandas({ comandas }: { comandas: Comanda[] }) {
  const hoje = new Date().toLocaleDateString("en-CA");
  const doDia = comandas.filter((c) => (c.criadoEm || "").slice(0, 10) === hoje || ((c.fechadoEm || "").slice(0, 10) === hoje));
  const abertas = doDia.filter((c) => c.status === "aberta");
  const fechadas = doDia.filter((c) => c.status === "fechada");
  const emAberto = abertas.reduce((s, c) => s + (c.total - (c.valorPago || 0)), 0);   // consumo sem pagamento
  const recebido = doDia.reduce((s, c) => s + (c.valorPago || 0), 0);
  const faturamento = doDia.reduce((s, c) => s + (c.total || 0), 0);
  const pessoas = doDia.reduce((s, c) => s + (c.pessoas || 1), 0);
  const itensConsumidos = doDia.reduce((s, c) => s + c.itens.reduce((a, i) => a + (i.porPeso ? 1 : i.qtd), 0), 0);
  const porForma = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of doDia) for (const p of c.pagamentos || []) m.set(p.forma, (m.get(p.forma) || 0) + p.valor);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [comandas]); // eslint-disable-line react-hooks/exhaustive-deps

  const Card = ({ label, valor, tone, hint }: { label: string; valor: string; tone?: string; hint?: string }) => (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums leading-tight ${tone || "text-gray-900 dark:text-gray-100"}`}>{valor}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="text-[12px] text-gray-500">Hoje · {new Date().toLocaleDateString("pt-BR")} · atualiza em tempo real</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card label="Faturamento" valor={fmtR(faturamento)} tone="text-indigo-700 dark:text-indigo-300" hint={`${doDia.length} comanda(s)`} />
        <Card label="Recebido" valor={fmtR(recebido)} tone="text-emerald-600 dark:text-emerald-300" hint={`${fechadas.length} paga(s)`} />
        <Card label="Em aberto" valor={fmtR(emAberto)} tone={emAberto > 0 ? "text-amber-600 dark:text-amber-300" : undefined} hint={`${abertas.length} aberta(s)`} />
        <Card label="Pessoas" valor={String(pessoas)} hint={`${itensConsumidos} itens`} />
      </div>
      {porForma.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Recebido por forma</div>
          <div className="flex flex-wrap gap-2">
            {porForma.map(([f, v]) => <span key={f} className="text-[12px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{f} <b className="tabular-nums">{fmtR(v)}</b></span>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cadastro de produtos + categorias (painel embutido na aba Config) ──────
function ProdutosPanel({ rid, produtos, categorias }: { rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[] }) {
  const [aba, setAba] = useState<"produtos" | "categorias">("produtos");
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [preco, setPreco] = useState("");
  const [porPeso, setPorPeso] = useState(false);
  const [imprime, setImprime] = useState(false);     // vai pra impressora (cozinha/bar)
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [novaCat, setNovaCat] = useState("");
  const precoNum = parseFloat((preco || "").replace(/\./g, "").replace(",", ".")) || 0;
  const catById = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  function limpar() { setEditId(null); setNome(""); setCodigo(""); setPreco(""); setPorPeso(false); setImprime(false); setCategoriaId(""); }
  function editar(p: ComandaProduto) {
    setEditId(p.id); setNome(p.nome); setCodigo(p.codigo || ""); setPreco(String(p.preco).replace(".", ","));
    setPorPeso(!!p.porPeso); setImprime(!!p.producao); setCategoriaId(p.categoriaId || "");
  }
  async function salvar() {
    if (!nome.trim() || precoNum <= 0) return;
    const cat = categoriaId ? catById.get(categoriaId) : undefined;
    const base = produtos.find((p) => p.id === editId);
    await salvarProduto({
      id: editId || uid(), restaurantId: rid, nome: nome.trim(), codigo: codigo.trim() || null,
      preco: precoNum, porPeso, producao: imprime,
      categoriaId: categoriaId || null, categoria: cat?.nome || null,
      unidade: porPeso ? "kg" : "un", ativo: base?.ativo ?? true, ordem: base?.ordem ?? produtos.length,
    });
    limpar();
  }
  async function addCat() {
    if (!novaCat.trim()) return;
    await salvarCategoria({ id: uid(), restaurantId: rid, nome: novaCat.trim(), ordem: categorias.length });
    setNovaCat("");
  }

  return (
    <div>
      <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-800 p-0.5 text-sm mb-3">
        <button onClick={() => setAba("produtos")} className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 ${aba === "produtos" ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}><Package size={14} /> Produtos</button>
        <button onClick={() => setAba("categorias")} className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 ${aba === "categorias" ? "bg-indigo-600 text-white" : "text-gray-600 dark:text-gray-300"}`}><Tag size={14} /> Categorias</button>
      </div>

      {aba === "categorias" ? (
        <div className="max-w-lg">
          <div className="flex gap-2 pb-3 border-b border-gray-200 dark:border-gray-800">
            <input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="Nova categoria (ex.: Cozinha, Bar, Peixe fresco)" className="flex-1 h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <button onClick={() => void addCat()} disabled={!novaCat.trim()} className="h-10 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">+ Add</button>
          </div>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {categorias.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">Nenhuma categoria. Crie uma pra organizar os produtos.</div> : categorias.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2">
                <Tag size={14} className="text-gray-400" />
                <span className="flex-1 text-[14px] text-gray-900 dark:text-gray-100">{c.nome}</span>
                <span className="text-[11px] text-gray-400">{produtos.filter((p) => p.categoriaId === c.id).length} prod.</span>
                <button onClick={() => { if (confirm(`Excluir categoria "${c.nome}"? Os produtos ficam sem categoria.`)) void excluirCategoria(c.id); }} className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-w-lg">
          <div className={`space-y-2 pb-3 border-b border-gray-200 dark:border-gray-800 ${editId ? "rounded-xl border border-indigo-200 dark:border-indigo-800 p-3 bg-indigo-50/30 dark:bg-indigo-950/10" : ""}`}>
            {editId && <div className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-300">Editando produto</div>}
            <div className="grid grid-cols-[70px_1fr_110px] gap-2">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="código" className="h-10 px-2 text-sm text-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do produto" className="h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={porPeso ? "/kg" : "preço"} className="w-full h-10 pl-7 pr-1 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
              </div>
            </div>
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="w-full h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">— categoria —</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={porPeso} onChange={(e) => setPorPeso(e.target.checked)} className="accent-indigo-600" /> <Scale size={13} /> por peso (kg)</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={imprime} onChange={(e) => setImprime(e.target.checked)} className="accent-amber-600" /> <Printer size={13} /> imprime (cozinha/bar)</label>
              <div className="ml-auto flex gap-2">
                {editId && <button onClick={limpar} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>}
                <button onClick={() => void salvar()} disabled={!nome.trim() || precoNum <= 0} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">{editId ? "Salvar" : "+ Add produto"}</button>
              </div>
            </div>
          </div>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {produtos.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">Nenhum produto ainda.</div> : produtos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-2">
                <button onClick={() => editar(p)} className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{p.codigo ? <span className="font-mono text-gray-400">#{p.codigo} </span> : ""}{p.nome} {!p.ativo && <span className="text-[10px] text-gray-400">(inativo)</span>}</div>
                  <div className="text-[11px] text-gray-500">{fmtR(p.preco)}{p.porPeso ? "/kg · peso" : ""}{p.producao ? " · imprime" : ""}{p.categoria ? ` · ${p.categoria}` : ""}</div>
                </button>
                <button onClick={() => editar(p)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700">Editar</button>
                <button onClick={() => void salvarProduto({ ...p, ativo: !p.ativo })} className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700">{p.ativo ? "Inativar" : "Ativar"}</button>
                <button onClick={() => { if (confirm(`Excluir "${p.nome}"?`)) void excluirProduto(p.id); }} className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
