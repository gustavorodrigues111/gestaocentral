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
import type { Comanda, ComandaItem, ComandaProduto, ComandaPagamento, ComandaPrintJob, ComandaCategoria, ComandaEstacao } from "../../core/types";
import {
  uid, ouvirProdutos, salvarProduto, excluirProduto,
  ouvirComandas, salvarComanda, criarPrintJob,
  ouvirCategorias, salvarCategoria, excluirCategoria,
  ouvirEstacoes, salvarEstacao, excluirEstacao, lerLogoSite,
} from "./comandasRepo";
import { EstacaoImpressao } from "./EstacaoImpressao";

const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (n: number, dec = 0) => (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: 3 });
const nowIso = () => new Date().toISOString();
const FORMAS = ["Pix", "Dinheiro", "Débito", "Crédito", "Outro"];
// Tempo decorrido desde a abertura (ex.: "agora", "23min", "1h05") — p/ os cards.
const tempoDecorrido = (iso?: string | null): string => {
  if (!iso) return "";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h${m ? String(m).padStart(2, "0") : ""}`;
};
const minutosDecorridos = (iso?: string | null): number => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 60000) : 0;

export function ComandasPage() {
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const { pessoa: me } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const { can } = useCanAcao(rid);

  const [produtos, setProdutos] = useState<ComandaProduto[]>([]);
  const [categorias, setCategorias] = useState<ComandaCategoria[]>([]);
  const [estacoes, setEstacoes] = useState<ComandaEstacao[]>([]);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<null | "conta" | "togo">(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);   // comandaId aberta no detalhe
  const [verFechadas, setVerFechadas] = useState(false);
  // Estação de impressão: abre por ?estacao=1 (ou ?estacao=<id>) na URL.
  const estacaoParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("estacao") : null;
  const estacao = !!estacaoParam;

  useEffect(() => { if (!rid) return; return ouvirProdutos(rid, setProdutos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirEstacoes(rid, setEstacoes); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirComandas(rid, setComandas); }, [rid]);
  useEffect(() => { if (!rid) return; void lerLogoSite(rid).then(setLogoUrl); }, [rid]);

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
  const [, setTick] = useState(0);   // re-render a cada 1min p/ atualizar o "tempo aberta" dos cards
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  const hojeYmd = new Date().toLocaleDateString("en-CA");
  const fechadasHoje = useMemo(() => comandas.filter((c) => c.status === "fechada" && (c.fechadoEm || c.criadoEm || "").slice(0, 10) === hojeYmd), [comandas, hojeYmd]);
  const comandaDet = useMemo(() => comandas.find((c) => c.id === detalhe) || null, [comandas, detalhe]);

  if (estacao) return <EstacaoImpressao rid={rid} nomeRest={activeRestaurant?.nome || ""} estacaoId={estacaoParam === "1" ? null : estacaoParam} estacoes={estacoes} logoUrl={logoUrl} />;
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
                {lista.map((c) => {
                  const aberta = c.status !== "fechada";
                  const parcial = aberta && (c.valorPago || 0) > 0.001;
                  const mins = minutosDecorridos(c.criadoEm);
                  const velha = aberta && mins >= 60;                   // muito tempo aberta → sinaliza
                  const dot = !aberta ? "bg-gray-300 dark:bg-gray-600" : (parcial || velha) ? "bg-amber-500" : "bg-emerald-500";
                  return (
                  <button key={c.id} onClick={() => setDetalhe(c.id)} className={`text-left rounded-2xl border p-3 shadow-sm ${c.status === "fechada" ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-300 dark:hover:border-indigo-700"}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"><span className={`w-2 h-2 rounded-full ${dot}`} />#{c.numero}</span>
                      {c.status === "fechada" ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">paga</span>
                        : parcial ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">parcial</span>
                        : c.modo === "togo" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">to-go</span>}
                    </div>
                    <div className="font-bold text-gray-900 dark:text-gray-100 truncate mt-1.5">{c.clienteNome || "—"}</div>
                    <div className="text-[12px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span>{c.itens.length} item(ns){c.pessoas && c.pessoas > 1 ? ` · ${c.pessoas}p` : ""}</span>
                      {aberta && c.criadoEm && <span className={`inline-flex items-center gap-0.5 ${velha ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-400"}`}><Clock size={10} /> {tempoDecorrido(c.criadoEm)}</span>}
                    </div>
                    <div className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums mt-0.5">{fmtR(c.total)}{parcial && <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 ml-1">falta {fmtR(c.total - (c.valorPago || 0))}</span>}</div>
                  </button>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {tabEfetiva === "relatorios" && podeRelatorios && (
        <RelatorioComandas comandas={comandas} />
      )}

      {tabEfetiva === "config" && podeConfigTab && (
        <ConfigComandas rid={rid} produtos={produtos} categorias={categorias} estacoes={estacoes} podeProdutos={podeProdutos} podeEstacoes={podeEstacoes} />
      )}

      {abrindo && <AbrirComandaModal modo={abrindo} onClose={() => setAbrindo(null)} onAbrir={abrirComanda} />}
      {comandaDet && (
        <ComandaDetalhe
          comanda={comandaDet} produtos={produtos.filter((p) => p.ativo)} categorias={categorias} estacoes={estacoes} logoUrl={logoUrl}
          podeOperar={podeOperar}
          meNome={meNome} nomeRest={activeRestaurant?.nome || ""} rid={rid}
          onClose={() => setDetalhe(null)}
        />
      )}
    </PageContainer>
  );
}

// ── Config do módulo (abas internas: Produtos · Estação) ───────────────────
function ConfigComandas({ rid, produtos, categorias, estacoes, podeProdutos, podeEstacoes }: {
  rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; estacoes: ComandaEstacao[]; podeProdutos: boolean; podeEstacoes: boolean;
}) {
  const subs = [
    ...(podeProdutos ? [{ id: "produtos", label: "Produtos" }] : []),
    ...(podeEstacoes ? [{ id: "estacao", label: "Impressoras" }] : []),
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
      {sub === "estacao" && podeEstacoes && <EstacoesPanel rid={rid} estacoes={estacoes} categorias={categorias} />}
    </div>
  );
}

// ── Impressoras / estações (multi-impressora por categoria) ────────────────
function EstacoesPanel({ rid, estacoes, categorias }: { rid: string; estacoes: ComandaEstacao[]; categorias: ComandaCategoria[] }) {
  const [nome, setNome] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  function toggleCat(id: string) { setCats((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]); }
  async function add() {
    if (!nome.trim()) return;
    await salvarEstacao({ id: uid(), restaurantId: rid, nome: nome.trim(), categorias: cats, ativo: true });
    setNome(""); setCats([]);
  }
  async function toggleCatDaEstacao(e: ComandaEstacao, catId: string) {
    const atual = e.categorias || [];
    await salvarEstacao({ ...e, categorias: atual.includes(catId) ? atual.filter((x) => x !== catId) : [...atual, catId] });
  }
  return (
    <div className="max-w-lg space-y-4">
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-[12px] text-amber-800 dark:text-amber-200">
        <div className="font-bold mb-1">Como ligar uma impressora</div>
        <p>Num PC com a impressora instalada como <b>padrão</b>, abra o Chrome em impressão silenciosa (<code className="bg-white/60 dark:bg-black/30 px-1 rounded">--kiosk-printing</code>) e abra o link <b>Abrir</b> da estação. Deixe a aba aberta. Cada estação só imprime as categorias marcadas (vazio = todas de produção + contas).</p>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3">
        <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-2">Nova impressora / estação</div>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Cozinha, Bar, Caixa)" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        {categorias.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] text-gray-400 mb-1">Imprime quais categorias? (nenhuma = todas)</div>
            <div className="flex flex-wrap gap-1.5">
              {categorias.map((c) => <button key={c.id} type="button" onClick={() => toggleCat(c.id)} className={`text-[12px] px-2 py-1 rounded-lg border ${cats.includes(c.id) ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{c.nome}</button>)}
            </div>
          </div>
        )}
        <button onClick={() => void add()} disabled={!nome.trim()} className="h-9 px-3 mt-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">+ Criar estação</button>
      </div>

      <div className="space-y-2">
        {estacoes.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">Nenhuma estação criada. Com 1 impressora só, não precisa — use o botão “Estação” no topo. Crie estações só se tiver cozinha e bar separados.</div>
        ) : estacoes.map((e) => (
          <div key={e.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3">
            <div className="flex items-center gap-2">
              <Printer size={15} className="text-indigo-500" />
              <span className="font-bold text-gray-900 dark:text-gray-100 flex-1">{e.nome}</span>
              <a href={`?estacao=${e.id}`} target="_blank" rel="noreferrer" className="text-[12px] px-2 py-1 rounded-lg bg-indigo-600 text-white font-semibold inline-flex items-center gap-1"><Printer size={12} /> Abrir</a>
              <button onClick={() => { if (confirm(`Excluir estação "${e.nome}"?`)) void excluirEstacao(e.id); }} className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
            </div>
            {categorias.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {categorias.map((c) => <button key={c.id} onClick={() => void toggleCatDaEstacao(e, c.id)} className={`text-[11px] px-2 py-0.5 rounded-lg border ${(e.categorias || []).includes(c.id) ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-200" : "border-gray-200 dark:border-gray-700 text-gray-400"}`}>{c.nome}</button>)}
                {(e.categorias || []).length === 0 && <span className="text-[11px] text-gray-400">imprime tudo</span>}
              </div>
            )}
          </div>
        ))}
      </div>
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
function ComandaDetalhe({ comanda, produtos, categorias, estacoes, logoUrl, podeOperar, meNome, nomeRest, rid, onClose }: {
  comanda: Comanda; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; estacoes: ComandaEstacao[]; logoUrl: string | null; podeOperar: boolean; meNome: string; nomeRest: string; rid: string;
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
      // Com texto, a busca é GLOBAL (ignora a aba de categoria) — acha o produto
      // em qualquer categoria pelo nome ou pelo código. Sem texto, respeita a aba.
      if (q) return p.nome.toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q);
      if (catSel !== "todas") { const k = p.categoriaId || "sem"; if (k !== catSel) return false; }
      return true;
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
      producao: !!p.producao, categoriaId: p.categoriaId || null, impressoEm: null, criadoEm: nowIso(), criadoPorNome: meNome,
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
  // Qual estação imprime uma categoria (1ª estação ativa que cobre a categoria;
  // estação sem categorias = cobre todas). Sem estações → null (qualquer uma).
  function estacaoDaCategoria(catId: string | null | undefined): string | null {
    const ativas = estacoes.filter((e) => e.ativo);
    if (!ativas.length) return null;
    const esp = ativas.find((e) => (e.categorias || []).length && (e.categorias || []).includes(catId || ""));
    if (esp) return esp.id;
    const geral = ativas.find((e) => !(e.categorias || []).length);
    return geral ? geral.id : null;
  }
  async function imprimirProducao() {
    if (!pendentesProducao.length) return;
    setSalvandoImpr(true);
    try {
      // Agrupa os itens pendentes por estação de destino → 1 ticket por impressora.
      const porEstacao = new Map<string, ComandaItem[]>();
      for (const i of pendentesProducao) {
        const eid = estacaoDaCategoria(i.categoriaId) || "_null_";
        (porEstacao.get(eid) || porEstacao.set(eid, []).get(eid)!).push(i);
      }
      for (const [eid, itens] of porEstacao) {
        const estacaoId = eid === "_null_" ? null : eid;
        const nomeEst = estacoes.find((e) => e.id === estacaoId)?.nome;
        const job: ComandaPrintJob = {
          id: uid(), restaurantId: rid, tipo: "producao", comandaId: comanda.id,
          comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId, logoUrl,
          titulo: `PRODUÇÃO${nomeEst ? ` · ${nomeEst}` : ""} · #${comanda.numero}`,
          linhas: itens.map((i) => ({ nome: i.nome, qtd: i.porPeso ? `${fmtNum(i.qtd, 3)} kg` : `${i.qtd}x`, valor: null })),
          total: null, rodape: `${comanda.clienteNome} · ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${meNome}`,
          status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
        };
        await criarPrintJob(job);
      }
      const marcadoEm = nowIso();
      const itensAtu = comanda.itens.map((i) => (i.producao && !i.impressoEm ? { ...i, impressoEm: marcadoEm } : i));
      await patch(recompor(itensAtu));
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
      comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId: null, logoUrl,
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
          {fechada ? <ContaCupom comanda={comanda} nomeRest={nomeRest} logoUrl={logoUrl} /> : comanda.itens.length === 0 ? (
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
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar em todas as categorias (nome ou código)…" className="w-full h-9 pl-8 pr-8 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                {busca && <button onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
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
      {fechar && <FecharModal comanda={comanda} meNome={meNome} nomeRest={nomeRest} rid={rid} logoUrl={logoUrl} onClose={() => setFechar(false)} onFechado={() => { setFechar(false); onClose(); }} />}
      {verConta && <ContaClienteView comanda={comanda} nomeRest={nomeRest} logoUrl={logoUrl} onClose={() => setVerConta(false)} />}
    </div>
  );
}

// ── Conta pra mostrar ao cliente (vira o celular) — cupom ──────────────────
function ContaClienteView({ comanda, nomeRest, logoUrl, onClose }: { comanda: Comanda; nomeRest: string; logoUrl: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[82] bg-gray-100 dark:bg-gray-950 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button onClick={onClose} className="w-9 h-9 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 grid place-items-center"><ChevronLeft size={20} /></button>
        <div className="font-bold text-gray-900 dark:text-gray-100">Conta · #{comanda.numero}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ContaCupom comanda={comanda} nomeRest={nomeRest} logoUrl={logoUrl} />
      </div>
    </div>
  );
}

// Cupom (comanda/recibo) — visual inspirado em cupom fiscal. Reusado na tela do
// cliente e na comanda fechada. Logo da empresa vem do módulo Sites.
function ContaCupom({ comanda, nomeRest, logoUrl }: { comanda: Comanda; nomeRest: string; logoUrl: string | null }) {
  const saldo = +(comanda.total - (comanda.valorPago || 0)).toFixed(2);
  const porPessoa = comanda.pessoas && comanda.pessoas > 1 ? +(comanda.total / comanda.pessoas).toFixed(2) : null;
  return (
    <div className="mx-auto w-full max-w-[380px] bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 font-mono text-[13px] text-gray-900 dark:text-gray-100">
      <div className="text-center">
        {logoUrl && <img src={logoUrl} alt="" className="h-12 mx-auto mb-1 object-contain" />}
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

// ── Fechar / pagar (com split: vários pagamentos nomeados) ──────────────────
function FecharModal({ comanda, meNome, nomeRest, rid, logoUrl, onClose, onFechado }: {
  comanda: Comanda; meNome: string; nomeRest: string; rid: string; logoUrl: string | null; onClose: () => void; onFechado: () => void;
}) {
  const saldo = +(comanda.total - comanda.valorPago).toFixed(2);
  const [pessoas, setPessoas] = useState(String(comanda.pessoas || 1));
  const [linhas, setLinhas] = useState<ComandaPagamento[]>([]);   // pagamentos sendo lançados agora
  const [forma, setForma] = useState(FORMAS[0]);
  const [valorTxt, setValorTxt] = useState("");
  const [nomeIn, setNomeIn] = useState("");
  const [imprimirConta, setImprimirConta] = useState(true);
  const [saving, setSaving] = useState(false);
  const nPessoas = Math.max(1, parseInt(pessoas, 10) || 1);
  const porPessoa = +(comanda.total / nPessoas).toFixed(2);
  const valorIn = parseFloat((valorTxt || "").replace(/\./g, "").replace(",", ".")) || 0;
  const somaLinhas = +linhas.reduce((s, l) => s + l.valor, 0).toFixed(2);
  const restante = +(saldo - somaLinhas).toFixed(2);
  const vaiFechar = somaLinhas >= saldo - 0.001;
  // Visão viva do pagamento — inclui o valor DIGITADO (ainda não "Add"), estilo Goomer.
  const pagoAgora = +(somaLinhas + (valorIn > 0 ? valorIn : 0)).toFixed(2);
  const faltaLive = Math.max(0, +(saldo - pagoAgora).toFixed(2));
  const troco = Math.max(0, +(pagoAgora - saldo).toFixed(2));

  function addLinha(v?: number) {
    const valor = v ?? valorIn;
    if (valor <= 0) return;
    setLinhas((l) => [...l, { forma, valor: +valor.toFixed(2), em: new Date().toISOString(), porNome: nomeIn.trim() || meNome }]);
    setValorTxt(""); setNomeIn("");
  }
  async function confirmar() {
    setSaving(true);
    try {
      // Inclui o valor digitado que ainda não foi adicionado à lista.
      const linhasFinais = valorIn > 0 ? [...linhas, { forma, valor: +valorIn.toFixed(2), em: new Date().toISOString(), porNome: nomeIn.trim() || meNome }] : linhas;
      const pags: ComandaPagamento[] = [...comanda.pagamentos, ...linhasFinais];
      const valorPago = +pags.reduce((s, p) => s + p.valor, 0).toFixed(2);
      const quitou = valorPago >= comanda.total - 0.001;
      await salvarComanda({
        ...comanda, pessoas: nPessoas, pagamentos: pags, valorPago,
        status: quitou ? "fechada" : "aberta",
        fechadoEm: quitou ? new Date().toISOString() : null,
        fechadoPorNome: quitou ? meNome : null,
      });
      if (imprimirConta) {
        const job: ComandaPrintJob = {
          id: uid(), restaurantId: rid, tipo: "conta", comandaId: comanda.id,
          comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId: null, logoUrl,
          titulo: `${nomeRest || "CONTA"} · #${comanda.numero}`,
          linhas: comanda.itens.map((i) => ({ nome: `${i.porPeso ? `${fmtNum(i.qtd, 3)}kg ` : `${i.qtd}x `}${i.nome}`, qtd: null, valor: fmtR(i.total) })),
          total: fmtR(comanda.total),
          rodape: `${comanda.clienteNome}${comanda.cpf ? ` · CPF ${comanda.cpf}` : ""}\n${pags.map((p) => `${p.porNome ? p.porNome + " " : ""}${p.forma}: ${fmtR(p.valor)}`).join("\n")}${quitou ? "" : `\nSALDO: ${fmtR(comanda.total - valorPago)}`}\n${new Date().toLocaleString("pt-BR")} · ${meNome}`,
          status: "pendente", criadoEm: new Date().toISOString(), criadoPorNome: meNome, impressoEm: null,
        };
        await criarPrintJob(job);
      }
      onFechado();
    } catch (e) { console.error("[comandas] fechar", e); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Check size={16} className="text-indigo-500" /> Fechar comanda</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 p-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">Total</span>
            <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(comanda.total)}</span>
          </div>
          {comanda.valorPago > 0 && <div className="flex items-center justify-between text-[12px] text-gray-500 mt-0.5"><span>Já pago antes</span><span className="tabular-nums">{fmtR(comanda.valorPago)} · falta {fmtR(saldo)}</span></div>}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="inline-flex items-center gap-1.5 text-sm">
              <User size={14} className="text-gray-400" /> <span className="text-gray-600 dark:text-gray-300">Dividir por</span>
              <input value={pessoas} onChange={(e) => setPessoas(e.target.value)} type="number" min={1} className="w-14 h-8 px-2 text-center text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            {nPessoas > 1 && <button onClick={() => addLinha(Math.min(porPessoa, restante > 0 ? restante : porPessoa))} className="text-[12px] px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 font-semibold tabular-nums">+ {fmtR(porPessoa)}/pessoa</button>}
          </div>
        </div>

        {/* Falta pagar — grande e vivo (conta o valor digitado) */}
        <div className={`rounded-xl p-3 mb-3 flex items-center justify-between ${faltaLive > 0.001 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-emerald-50 dark:bg-emerald-950/20"}`}>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{faltaLive > 0.001 ? "Falta pagar" : troco > 0.001 ? "Troco" : "Pagamento"}</div>
            <div className={`text-2xl font-extrabold tabular-nums leading-none ${faltaLive > 0.001 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmtR(faltaLive > 0.001 ? faltaLive : troco)}</div>
          </div>
          <div className="text-right text-[12px] text-gray-500">
            <div>Pago agora <b className="tabular-nums text-gray-700 dark:text-gray-200">{fmtR(pagoAgora)}</b></div>
            {faltaLive <= 0.001 ? <div className="text-emerald-600 dark:text-emerald-400 font-semibold">quita e fecha ✓</div> : <div>de {fmtR(saldo)}</div>}
          </div>
        </div>

        {/* Pagamentos lançados agora (split) */}
        {linhas.length > 0 && (
          <div className="mb-2 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {linhas.map((l, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
                <span className="flex-1 truncate">{l.porNome && l.porNome !== meNome ? <b>{l.porNome} · </b> : ""}{l.forma}</span>
                <span className="tabular-nums font-semibold">{fmtR(l.valor)}</span>
                <button onClick={() => setLinhas((ls) => ls.filter((_, i) => i !== idx))} className="text-gray-300 hover:text-rose-500"><X size={14} /></button>
              </div>
            ))}
            <div className="flex items-center justify-between px-2 py-1.5 text-[12px] bg-gray-50 dark:bg-gray-800/40">
              <span className="text-gray-500">Lançado: <b className="tabular-nums text-gray-700 dark:text-gray-200">{fmtR(somaLinhas)}</b></span>
              <span className={restante > 0.001 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>{restante > 0.001 ? `falta ${fmtR(restante)}` : "cobre o total ✓"}</span>
            </div>
          </div>
        )}

        {/* Linha de pagamento */}
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div className="grid grid-cols-2 gap-2">
            <select value={forma} onChange={(e) => setForma(e.target.value)} className="h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" placeholder={restante > 0 ? restante.toFixed(2).replace(".", ",") : ""} className="w-full h-10 pl-8 pr-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
          </div>
          <button onClick={() => addLinha()} disabled={valorIn <= 0} className="h-10 px-3 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 text-sm font-semibold disabled:opacity-40">+ Add</button>
        </div>
        <input value={nomeIn} onChange={(e) => setNomeIn(e.target.value)} placeholder="nome de quem pagou (opcional)" className="w-full h-9 px-3 mt-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />

        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
          <input type="checkbox" checked={imprimirConta} onChange={(e) => setImprimirConta(e.target.checked)} className="accent-indigo-600" />
          Imprimir a conta
        </label>
        {linhas.length > 0 && !vaiFechar && <div className="text-[12px] text-amber-600 dark:text-amber-400 mt-2">Parcial — a comanda continua <b>aberta</b> pra seguir consumindo.</div>}
        <div className="flex justify-end gap-2 pt-3 mt-2 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={saving || (linhas.length === 0 && valorIn <= 0)} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{saving ? "..." : ((somaLinhas + valorIn) >= saldo - 0.001 ? "Pagar e fechar" : "Registrar")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard de vendas (tempo real) ──────────────────────────────────────
function RelatorioComandas({ comandas }: { comandas: Comanda[] }) {
  const hoje = new Date().toLocaleDateString("en-CA");
  const [dataSel, setDataSel] = useState(hoje);
  const diaDe = (c: Comanda) => (c.fechadoEm || c.criadoEm || "").slice(0, 10);
  const doDia = comandas.filter((c) => diaDe(c) === dataSel);
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
  }, [comandas, dataSel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Resumo gerencial POR DATA (todas as datas, mais recente primeiro).
  const porData = useMemo(() => {
    const m = new Map<string, { fat: number; rec: number; n: number; pes: number }>();
    for (const c of comandas) {
      const d = diaDe(c); if (!d) continue;
      const o = m.get(d) || { fat: 0, rec: 0, n: 0, pes: 0 };
      o.fat += c.total || 0; o.rec += c.valorPago || 0; o.n += 1; o.pes += c.pessoas || 1;
      m.set(d, o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [comandas]);
  const totalGeral = porData.reduce((s, [, o]) => s + o.fat, 0);

  const Card = ({ label, valor, tone, hint }: { label: string; valor: string; tone?: string; hint?: string }) => (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums leading-tight ${tone || "text-gray-900 dark:text-gray-100"}`}>{valor}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 text-sm">
          <span className="text-gray-500">Dia</span>
          <input type="date" value={dataSel} onChange={(e) => setDataSel(e.target.value)} className="h-9 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          {dataSel !== hoje && <button onClick={() => setDataSel(hoje)} className="text-[12px] text-indigo-600 dark:text-indigo-400 font-semibold">hoje</button>}
        </div>
        {dataSel === hoje && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">● tempo real</span>}
      </div>
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
      {/* Relatório gerencial por data */}
      {porData.length > 1 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Vendas por data</span>
            <span className="text-[12px] text-gray-500">Total geral <b className="text-gray-800 dark:text-gray-100 tabular-nums">{fmtR(totalGeral)}</b></span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[40vh] overflow-y-auto">
            {porData.map(([d, o]) => (
              <button key={d} onClick={() => setDataSel(d)} className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 ${d === dataSel ? "bg-indigo-50/40 dark:bg-indigo-950/20" : ""}`}>
                <span className="w-24 tabular-nums text-gray-600 dark:text-gray-300">{d.split("-").reverse().join("/")}</span>
                <span className="flex-1 text-gray-400 text-[12px]">{o.n} comanda(s) · {o.pes}p</span>
                <span className="tabular-nums text-gray-500 text-[12px]">rec {fmtR(o.rec)}</span>
                <span className="w-24 text-right tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">{fmtR(o.fat)}</span>
              </button>
            ))}
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
