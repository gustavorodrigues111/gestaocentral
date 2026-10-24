// Módulo COMANDAS — PDV simplificado (peixaria Sororoca). Comanda eletrônica
// no celular/PC; ticket de produção impresso numa Epson TM-T20 pela ESTAÇÃO DE
// IMPRESSÃO (aba separada num PC logado). Sem fiscal: só comanda + conta.
//
// Dois fluxos: CONTA ABERTA (fica consumindo) × TO-GO (lança e fecha na hora).
// Produto pode ser por PESO (preço/kg, lança-se o peso) — balança Prix 4 depois.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Printer, Trash2, X, Scale, Package, Search, Check, Receipt, Minus, User, Tag, Eye, Clock, ChevronLeft, LogOut, Menu, BarChart3, Store, CreditCard, Banknote, Copy, Pencil } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { APP_VERSION_LABEL } from "../../core/version";
import type { Comanda, ComandaItem, ComandaProduto, ComandaPagamento, ComandaPrintJob, ComandaCategoria, ComandaEstacao, ComandaFiscalConfig, ComandaCaixa, ComandaCaixaMov, Cliente } from "../../core/types";
import {
  uid, ouvirProdutos, salvarProduto, excluirProduto,
  ouvirComandas, salvarComanda, excluirComanda, criarPrintJob, superseedContaJobs,
  ouvirCategorias, salvarCategoria, excluirCategoria,
  ouvirEstacoes, salvarEstacao, excluirEstacao, lerLogoSite,
  ouvirFiscalConfig, salvarFiscalConfig,
  ouvirCaixaAberto, salvarCaixa, lerClientes, criarCliente,
} from "./comandasRepo";
import { EstacaoImpressao, AppCaixaConfig } from "./EstacaoImpressao";
import { TefCobranca } from "./TefCobranca";
import { montarNfce, nfceEmitir, nfceCancelar, lerNfce } from "./nfceClient";
import QRCode from "qrcode";

const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (n: number, dec = 0) => (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: 3 });
// Sombreamento do botão de produto por categoria (por palavra-chave no nome):
// pescados = azul claro, comidas/cozinha = vermelho claro, bebidas = amarelo claro.
function corCategoria(nome?: string | null): string {
  const n = (nome || "").toLowerCase();
  if (/pescado|peixe|fruto do mar|camar|lula|polvo|ostra|marisco|moqueca/.test(n)) return "bg-sky-50 border-sky-200 dark:bg-sky-950/25 dark:border-sky-900/50";
  if (/sem [aá]lcool|sem alcool|n[ãa]o alco[óo]lic|suco|[aá]gua|refri|mate|caju/.test(n)) return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/25 dark:border-emerald-900/50";
  if (/bebida|bar|drink|cerveja|vinho|dose|caipir|chopp/.test(n)) return "bg-amber-50 border-amber-200 dark:bg-amber-950/25 dark:border-amber-900/50";
  if (/comida|cozinha|prato|por[çc][aã]o|petisco|entrada|sobremesa|brasa|quente/.test(n)) return "bg-rose-50 border-rose-200 dark:bg-rose-950/25 dark:border-rose-900/50";
  return "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700";
}

// Normaliza a forma de pagamento p/ agrupar (tira o "· NSU ..." do cartão).
const baseForma = (f: string): string => (f || "").split(" · ")[0].trim();
// Formas padrão sempre exibidas na conferência do caixa (p/ conciliar).
const FORMAS_PADRAO = ["Dinheiro", "Cartão (Crédito)", "Cartão (Débito)", "Pix (TEF)"];

// ── Gorjeta / taxa de serviço ──────────────────────────────────────────────
// Sugestão = % (do fiscalCfg) sobre o total dos itens elegíveis (categoria inteira
// marcada OU produto avulso marcado). `gorjeta` (paga) é decidida no fechamento;
// até lá vale a sugestão. A pagar = produtos + gorjeta efetiva.
function gorjetaSugeridaDe(itens: ComandaItem[], cfg: ComandaFiscalConfig | null | undefined): number {
  if (!cfg?.gorjetaAtiva) return 0;
  const pct = cfg.gorjetaPercentual || 0;
  if (pct <= 0) return 0;
  const cats = new Set(cfg.gorjetaCategoriaIds || []);
  const prods = new Set(cfg.gorjetaProdutoIds || []);
  if (!cats.size && !prods.size) return 0;
  const base = itens.reduce((s, i) => (cats.has(i.categoriaId || "") || prods.has(i.produtoId || "")) ? s + (i.total || 0) : s, 0);
  return +(base * pct / 100).toFixed(2);
}
const gorjetaEfetiva = (c: Comanda): number => (c.gorjeta != null ? c.gorjeta : (c.gorjetaSugerida || 0));
const totalAPagarComanda = (c: Comanda): number => +(((c.total || 0) + gorjetaEfetiva(c))).toFixed(2);

// Input de dinheiro estilo maquininha: digita e preenche dos centavos p/ a
// esquerda (1 → 0,01 → 0,12 → 1,23…). Guarda o valor em CENTAVOS (number).
function MoneyInput({ cents, onChange, autoFocus, className }: { cents: number; onChange: (c: number) => void; autoFocus?: boolean; className?: string }) {
  const display = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
      <input
        value={display} inputMode="numeric" autoFocus={autoFocus}
        onChange={(e) => onChange(Math.min(99999999, parseInt(e.target.value.replace(/\D/g, "") || "0", 10)))}
        className={className || "w-full h-11 pl-8 pr-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums"}
      />
    </div>
  );
}
const nowIso = () => new Date().toISOString();
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
// Agrupa itens iguais (mesmo produto/preço) pra impressão: 2x Produto em vez de 2 linhas.
function agruparItens(itens: ComandaItem[]): { nome: string; porPeso: boolean; qtd: number; total: number }[] {
  const m = new Map<string, { nome: string; porPeso: boolean; qtd: number; total: number }>();
  for (const i of itens) {
    const key = (i.produtoId || i.nome) + "|" + (i.porPeso ? "p" : "u") + "|" + i.precoUnit;
    const g = m.get(key) || { nome: i.nome, porPeso: !!i.porPeso, qtd: 0, total: 0 };
    g.qtd += i.qtd; g.total += i.total || 0;
    m.set(key, g);
  }
  return [...m.values()];
}

export function ComandasPage({ onLogout, onSwitchRestaurant }: { onLogout?: () => void; onSwitchRestaurant?: () => void } = {}) {
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
  const [fiscalCfg, setFiscalCfg] = useState<ComandaFiscalConfig | null>(null);
  const [caixa, setCaixa] = useState<ComandaCaixa | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [abrindo, setAbrindo] = useState<null | "conta" | "togo">(null);
  const [caixaModal, setCaixaModal] = useState<null | "abrir" | "sangria" | "reforco" | "fechar">(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);   // comandaId aberta no detalhe
  const [novaComanda, setNovaComanda] = useState<Comanda | null>(null);   // recém-criada (otimista, até o snapshot chegar)
  const [menuAberto, setMenuAberto] = useState(false);   // menu hambúrguer (Relatórios/Config/Estação/Sair)
  const [cfgApp, setCfgApp] = useState(false);           // modal de ajustes da impressora (só no app de caixa)
  // Estação EMBUTIDA: este dispositivo também imprime (pro PC único do balcão
  // com a Epson — dispensa a aba separada). Lembrado por dispositivo.
  // Rodando DENTRO do app de caixa (Electron): a ponte de impressão existe →
  // a estação embutida liga sozinha e imprime direto na Epson por IP (ESC/POS),
  // sem o diálogo do Windows/Chrome.
  const temBridge = typeof window !== "undefined" && !!(window as unknown as { pdvBridge?: unknown }).pdvBridge;
  const [imprimirAqui, setImprimirAqui] = useState<boolean>(() => { try { if (temBridge) return true; return localStorage.getItem("comandas_estacao_embutida") === "1"; } catch { return temBridge; } });
  const toggleImprimirAqui = () => setImprimirAqui((v) => { const n = !v; try { localStorage.setItem("comandas_estacao_embutida", n ? "1" : "0"); } catch { /* ignore */ } return n; });
  // Estação de impressão: abre por ?estacao=1 (ou ?estacao=<id>) na URL.
  const estacaoParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("estacao") : null;
  const estacao = !!estacaoParam;

  useEffect(() => { if (!rid) return; return ouvirProdutos(rid, setProdutos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirEstacoes(rid, setEstacoes); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirComandas(rid, setComandas); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirFiscalConfig(rid, setFiscalCfg); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCaixaAberto(rid, setCaixa); }, [rid]);
  // Clientes (CRM) — carga única p/ o typeahead de abertura de comanda.
  useEffect(() => { if (!rid) return; let vivo = true; void lerClientes(rid).then((l) => { if (vivo) setClientes(l); }); return () => { vivo = false; }; }, [rid]);
  useEffect(() => { if (!rid) return; void lerLogoSite(rid).then(setLogoUrl); }, [rid]);

  const meNome = me?.nome || "—";
  const podeVer = can("comandas", "ver");
  const podeOperar = can("comandas", "operar");
  const podeProdutos = can("comandas", "produtos");
  const podeRelatorios = can("comandas", "relatorios");
  const podeEstacoes = can("comandas", "estacoes");

  // Telas do módulo (vivem no menu hambúrguer). Só as permitidas. Config foi
  // achatado: Produtos / Categorias / Impressoras entram direto como telas.
  const abasDisp = useMemo(() => {
    const a: { id: string; label: string }[] = [{ id: "comandas", label: "Comandas" }];
    if (podeOperar) a.push({ id: "caixa", label: "Caixa" });
    if (podeRelatorios) a.push({ id: "relatorios", label: "Relatórios" });
    if (podeProdutos || podeEstacoes) a.push({ id: "cadastros", label: "Cadastros" });
    return a;
  }, [podeOperar, podeRelatorios, podeProdutos, podeEstacoes]);
  const [tab, setTab] = useTabPersistida<string>("comandas", "comandas", abasDisp.map((a) => a.id));

  const abertas = useMemo(() => comandas.filter((c) => c.status === "aberta"), [comandas]);
  const [, setTick] = useState(0);   // re-render a cada 1min p/ atualizar o "tempo aberta" dos cards
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  const comandaDet = useMemo(() => comandas.find((c) => c.id === detalhe) || (novaComanda && novaComanda.id === detalhe ? novaComanda : null), [comandas, detalhe, novaComanda]);
  const fecharDetalhe = () => { setDetalhe(null); setNovaComanda(null); };

  if (estacao) return <EstacaoImpressao rid={rid} nomeRest={activeRestaurant?.nome || ""} estacaoId={estacaoParam === "1" ? null : estacaoParam} estacoes={estacoes} logoUrl={logoUrl} />;
  if (!podeVer) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Comandas.</div>;

  // Próximo nº de comanda (sequencial a partir dos números já usados).
  function proximoNumero(): string {
    const max = comandas.reduce((m, c) => { const n = parseInt((c.numero || "").replace(/\D/g, ""), 10); return Number.isFinite(n) && n > m ? n : m; }, 0);
    return String(max + 1);
  }
  async function abrirComanda(dados: { numero: string; clienteNome: string; cpf?: string; telefone?: string; pessoas: number; modo: "conta" | "togo"; clienteId?: string | null }) {
    if (!caixa) { alert("Abra o caixa antes de iniciar uma venda."); return; }
    // Cliente: usa o selecionado; se tem telefone + nome e não é cadastrado, cria no CRM.
    let clienteId = dados.clienteId || null;
    const tel = dados.telefone?.trim() || "";
    if (!clienteId && tel && dados.clienteNome.trim() && dados.modo === "conta") {
      try { const novo = await criarCliente(rid, dados.clienteNome, tel, me?.id || ""); clienteId = novo.id; setClientes((p) => [...p, novo]); } catch { /* ignore */ }
    }
    const c: Comanda = {
      id: uid(), restaurantId: rid, numero: dados.numero.trim() || proximoNumero(), clienteNome: dados.clienteNome.trim(),
      cpf: dados.cpf?.trim() || null, telefone: tel || null, clienteId, pessoas: dados.pessoas || 1,
      status: "aberta", caixaId: caixa.id, modo: dados.modo, itens: [], total: 0, pagamentos: [], valorPago: 0,
      criadoEm: nowIso(), criadoPor: me?.id, criadoPorNome: meNome,
    };
    setNovaComanda(c); setAbrindo(null); setDetalhe(c.id);   // abre o detalhe NA HORA (otimista)
    await salvarComanda(c);
  }
  // Venda rápida (to-go): cria a comanda na hora, sem modal, e abre direto a venda.
  async function vendaRapida() {
    if (!caixa) { alert("Abra o caixa antes de iniciar uma venda."); return; }
    const c: Comanda = {
      id: uid(), restaurantId: rid, numero: proximoNumero(), clienteNome: "Venda rápida",
      cpf: null, telefone: null, pessoas: 1,
      status: "aberta", caixaId: caixa.id, modo: "togo", itens: [], total: 0, pagamentos: [], valorPago: 0,
      criadoEm: nowIso(), criadoPor: me?.id, criadoPorNome: meNome,
    };
    setNovaComanda(c); setDetalhe(c.id);   // abre direto na seleção de produtos (otimista)
    await salvarComanda(c);
  }
  async function abrirCaixa(fundoTroco: number) {
    const c: ComandaCaixa = { id: uid(), restaurantId: rid, status: "aberto", abertoPor: me?.id, abertoPorNome: meNome, abertoEm: nowIso(), fundoTroco, movimentos: [] };
    await salvarCaixa(c); setCaixaModal(null);
  }
  async function addMovimentoCaixa(mov: ComandaCaixaMov) {
    if (!caixa) return;
    await salvarCaixa({ ...caixa, movimentos: [...(caixa.movimentos || []), mov] }); setCaixaModal(null);
  }
  async function fecharCaixa(contadoDinheiro: number, obs: string, resumo: ComandaCaixa["resumo"]) {
    if (!caixa) return;
    await salvarCaixa({ ...caixa, status: "fechado", fechadoPor: me?.id, fechadoPorNome: meNome, fechadoEm: nowIso(), contadoDinheiro, obs: obs.trim() || null, resumo }); setCaixaModal(null);
  }
  const tabEfetiva = abasDisp.some((a) => a.id === tab) ? tab : "comandas";

  return (
    <PageContainer>
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Receipt size={20} className="text-indigo-500" /> Comandas</h1>
          <p className="text-[12px] text-gray-500">{activeRestaurant?.nome || ""}</p>
          <p className="text-[10px] text-gray-400">planejamento.app · {APP_VERSION_LABEL}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleImprimirAqui} title="Este dispositivo imprime direto, sem o diálogo do Chrome (só faz sentido no PC do caixa com a impressora)"
            className={`h-9 px-2.5 rounded-lg border text-sm font-semibold hidden sm:inline-flex items-center gap-1.5 ${imprimirAqui ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
            <Printer size={15} /> Imprimir aqui <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${imprimirAqui ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700"}`}>{imprimirAqui ? "ON" : "OFF"}</span>
          </button>
          <div className="relative">
          <button onClick={() => setMenuAberto((v) => !v)} className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50" title="Menu">
            <Menu size={17} /> Menu
          </button>
          {menuAberto && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuAberto(false)} />
              <div className="absolute right-0 mt-1.5 w-56 z-50 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5">
                {/* Navegação entre as telas do módulo (Config achatado em Produtos/Categorias/Impressoras) */}
                {abasDisp.map((a) => {
                  const ic = a.id === "comandas" ? <Receipt size={16} /> : a.id === "caixa" ? <Banknote size={16} /> : a.id === "relatorios" ? <BarChart3 size={16} /> : <Package size={16} />;
                  const divisor = a.id === "cadastros";   // separa "operação" (Comandas/Caixa/Relatórios) da "config"
                  return (
                    <Fragment key={a.id}>
                      {divisor && <div className="my-1 border-t border-gray-100 dark:border-gray-800" />}
                      <button onClick={() => { setTab(a.id); setMenuAberto(false); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left ${tabEfetiva === a.id ? "text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50/60 dark:bg-indigo-950/20" : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                        {ic} {a.label}
                      </button>
                    </Fragment>
                  );
                })}
                <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                {temBridge && <button onClick={() => { setMenuAberto(false); setCfgApp(true); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"><Printer size={16} /> Impressora do caixa (IP)</button>}
                <a href={`?estacao=1`} target="_blank" rel="noreferrer" onClick={() => setMenuAberto(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"><Printer size={16} /> Estação (outra tela/PC)</a>
                {imprimirAqui && <div className="px-3 py-1 text-[10px] text-gray-400">"Imprimir aqui" está ON — este PC imprime direto. Não abra a Estação em outra aba junto, pra não duplicar.</div>}
                {(onSwitchRestaurant || onLogout) && <div className="my-1 border-t border-gray-100 dark:border-gray-800" />}
                {onSwitchRestaurant && <button onClick={() => { setMenuAberto(false); onSwitchRestaurant(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"><Store size={16} /> Trocar restaurante</button>}
                {onLogout && <button onClick={() => { setMenuAberto(false); onLogout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50/60 dark:hover:bg-rose-950/20"><LogOut size={16} /> Sair do PDV</button>}
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      {comandaDet ? (
        <ComandaDetalhe
          comanda={comandaDet} produtos={produtos.filter((p) => p.ativo)} categorias={categorias} estacoes={estacoes} logoUrl={logoUrl}
          fiscalCfg={fiscalCfg} podeOperar={podeOperar}
          meNome={meNome} nomeRest={activeRestaurant?.nome || ""} rid={rid}
          onClose={fecharDetalhe}
        />
      ) : (<>
      {tabEfetiva === "comandas" && (
        <>
          {/* Sem caixa aberto: gate central. O controle do caixa (reforço/sangria/
              fechar) fica no Menu → Caixa, não aqui na tela de vendas. */}
          {podeOperar && !caixa && <AbrirCaixaTile onAbrir={() => setCaixaModal("abrir")} />}
          {podeOperar && caixa && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => setAbrindo("conta")} className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 h-14 font-bold inline-flex items-center justify-center gap-1.5"><Plus size={18} /> Abrir comanda</button>
              <button onClick={() => void vendaRapida()} className="rounded-2xl border-2 border-dashed border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 h-14 font-bold inline-flex items-center justify-center gap-1.5"><Package size={18} /> Venda rápida</button>
            </div>
          )}

          {(caixa || abertas.length > 0) && (() => {
            const lista = abertas;   // tela principal = só abertas; as vendas (fechadas) ficam em Relatórios
            if (lista.length === 0) return (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-400">
                <Receipt size={38} className="mx-auto mb-2 text-gray-300" />
                <div className="font-semibold text-gray-600 dark:text-gray-300">Nenhuma comanda aberta</div>
                {podeOperar && <div className="text-sm mt-1">Abra uma comanda pra começar a lançar.</div>}
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
                    <div className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums mt-0.5">{fmtR(totalAPagarComanda(c))}{parcial && <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 ml-1">falta {fmtR(totalAPagarComanda(c) - (c.valorPago || 0))}</span>}</div>
                  </button>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {tabEfetiva === "caixa" && podeOperar && (
        <div className="max-w-lg mx-auto"><CaixaPanel caixa={caixa} comandas={comandas} onAbrir={() => setCaixaModal("abrir")} onSangria={() => setCaixaModal("sangria")} onReforco={() => setCaixaModal("reforco")} onFechar={() => setCaixaModal("fechar")} /></div>
      )}

      {tabEfetiva === "relatorios" && podeRelatorios && (
        <RelatorioComandas comandas={comandas} categorias={categorias} onAbrir={(id) => setDetalhe(id)} />
      )}

      {tabEfetiva === "cadastros" && (podeProdutos || podeEstacoes) && (
        <CadastrosPanel rid={rid} produtos={produtos} categorias={categorias} estacoes={estacoes} fiscalCfg={fiscalCfg} podeProdutos={podeProdutos} podeEstacoes={podeEstacoes} />
      )}
      </>)}

      {/* Estação embutida: imprime os jobs neste próprio dispositivo (opt-in) */}
      {(imprimirAqui || temBridge) && rid && <EstacaoImpressao embedded rid={rid} nomeRest={activeRestaurant?.nome || ""} estacaoId={null} estacoes={estacoes} logoUrl={logoUrl} />}

      {cfgApp && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={() => setCfgApp(false)}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="font-bold text-white inline-flex items-center gap-1.5"><Printer size={16} /> Impressora do caixa</div>
              <button onClick={() => setCfgApp(false)} className="text-white/80 hover:text-white"><X size={20} /></button>
            </div>
            <AppCaixaConfig semEsconder />
          </div>
        </div>
      )}
      {abrindo && <AbrirComandaModal modo={abrindo} clientes={clientes} onClose={() => setAbrindo(null)} onAbrir={abrirComanda} />}
      {caixaModal === "abrir" && <AbrirCaixaModal onClose={() => setCaixaModal(null)} onAbrir={abrirCaixa} />}
      {(caixaModal === "sangria" || caixaModal === "reforco") && caixa && (
        <MovimentoCaixaModal tipo={caixaModal} meNome={meNome} onClose={() => setCaixaModal(null)} onConfirmar={addMovimentoCaixa} />
      )}
      {caixaModal === "fechar" && caixa && (
        <FecharCaixaModal caixa={caixa} comandas={comandas} onClose={() => setCaixaModal(null)} onFechar={fecharCaixa} />
      )}
    </PageContainer>
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

// ── Caixa (sessão de PDV) ──────────────────────────────────────────────────
// Ladrilho central de "Abrir caixa" (gate na tela de vendas quando não há caixa).
function AbrirCaixaTile({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-6 min-h-[62vh] px-4">
      <button onClick={onAbrir} className="w-full max-w-[260px] aspect-square rounded-[32px] bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-[0_18px_40px_-16px_rgba(79,70,229,0.7)] flex flex-col items-center justify-center gap-5 transition-all active:scale-[0.98]">
        <div className="w-20 h-20 rounded-3xl bg-white/15 grid place-items-center"><Banknote size={40} strokeWidth={1.75} /></div>
        <span className="text-xl font-extrabold tracking-tight">Abrir caixa</span>
      </button>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[260px]">Abra o caixa para começar a vender.</p>
    </div>
  );
}

// Tela do Caixa (Menu → Caixa): status + resumo ao vivo + reforço/sangria/fechar.
function CaixaPanel({ caixa, comandas, onAbrir, onSangria, onReforco, onFechar }: {
  caixa: ComandaCaixa | null; comandas: Comanda[]; onAbrir: () => void; onSangria: () => void; onReforco: () => void; onFechar: () => void;
}) {
  if (!caixa) return <AbrirCaixaTile onAbrir={onAbrir} />;
  const dt = new Date(caixa.abertoEm);
  const quando = `${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  // Resumo ao vivo (desde a abertura).
  const inicio = caixa.abertoEm;
  const map = new Map<string, number>();
  for (const c of comandas) for (const p of c.pagamentos || []) if (p.em && p.em >= inicio) { const fn = baseForma(p.forma); map.set(fn, (map.get(fn) || 0) + p.valor); }
  const porForma = [...map.entries()].map(([forma, valor]) => ({ forma, valor })).sort((a, b) => b.valor - a.valor);
  const vendasTotal = porForma.reduce((s, f) => s + f.valor, 0);
  const dinheiroVendas = porForma.filter((f) => /dinheiro/i.test(f.forma)).reduce((s, f) => s + f.valor, 0);
  const sangrias = (caixa.movimentos || []).filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
  const reforcos = (caixa.movimentos || []).filter((m) => m.tipo === "reforco").reduce((s, m) => s + m.valor, 0);
  const dinheiroEsperado = caixa.fundoTroco + dinheiroVendas + reforcos - sangrias;
  const Linha = ({ l, v, forte }: { l: string; v: string; forte?: boolean }) => (
    <div className={`flex justify-between ${forte ? "font-bold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}><span>{l}</span><span className="tabular-nums">{v}</span></div>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/15 p-3">
        <div className="text-[14px] font-bold text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Caixa aberto</div>
        <div className="text-[12px] text-gray-500 dark:text-gray-400">desde {quando} · fundo {fmtR(caixa.fundoTroco)}{caixa.abertoPorNome ? ` · ${caixa.abertoPorNome}` : ""}</div>
      </div>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-[13px] space-y-1">
        <Linha l="Vendas" v={fmtR(vendasTotal)} forte />
        {porForma.map((f) => <Linha key={f.forma} l={`· ${f.forma}`} v={fmtR(f.valor)} />)}
        <div className="border-t border-dashed border-gray-200 dark:border-gray-700 my-1.5" />
        <Linha l="Fundo de troco" v={fmtR(caixa.fundoTroco)} />
        <Linha l="Dinheiro de vendas" v={fmtR(dinheiroVendas)} />
        {reforcos > 0 && <Linha l="Reforços" v={`+ ${fmtR(reforcos)}`} />}
        {sangrias > 0 && <Linha l="Sangrias" v={`− ${fmtR(sangrias)}`} />}
        <div className="border-t border-dashed border-gray-200 dark:border-gray-700 my-1.5" />
        <Linha l="Dinheiro esperado na gaveta" v={fmtR(dinheiroEsperado)} forte />
      </div>
      {(caixa.movimentos || []).length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">Movimentos</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {[...(caixa.movimentos || [])].reverse().map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${m.tipo === "sangria" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>{m.tipo === "sangria" ? "Sangria" : "Reforço"}</span>
                <span className="flex-1 text-gray-500 truncate">{m.motivo || ""}{m.porNome ? ` · ${m.porNome}` : ""}</span>
                <span className="tabular-nums font-semibold">{m.tipo === "sangria" ? "−" : "+"} {fmtR(m.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onReforco} className="h-11 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold">+ Reforço</button>
        <button onClick={onSangria} className="h-11 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold">− Sangria</button>
      </div>
      <button onClick={onFechar} className="w-full h-12 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-bold">Fechar caixa</button>
    </div>
  );
}

function AbrirCaixaModal({ onClose, onAbrir }: { onClose: () => void; onAbrir: (fundo: number) => Promise<void> }) {
  const [fundoC, setFundoC] = useState(0);
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Banknote size={16} className="text-emerald-500" /> Abrir caixa</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3">Informe o dinheiro que já tem na gaveta (fundo de troco). O caixa fica identificado pela data e hora da abertura e fica aberto até você fechar.</p>
        <div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Fundo de troco</label>
            <MoneyInput cents={fundoC} onChange={setFundoC} autoFocus />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Voltar</button>
          <button onClick={async () => { setSaving(true); try { await onAbrir(fundoC / 100); } finally { setSaving(false); } }} disabled={saving} className="h-10 px-4 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">{saving ? "Abrindo…" : "Abrir caixa"}</button>
        </div>
      </div>
    </div>
  );
}

function MovimentoCaixaModal({ tipo, meNome, onClose, onConfirmar }: {
  tipo: "sangria" | "reforco"; meNome: string; onClose: () => void; onConfirmar: (m: ComandaCaixaMov) => Promise<void>;
}) {
  const [valorC, setValorC] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const sangria = tipo === "sangria";
  const v = valorC / 100;
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100">{sangria ? "Sangria (retirada)" : "Reforço (entrada)"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3">{sangria ? "Retirada de dinheiro da gaveta (ex.: sangria pro cofre)." : "Entrada de dinheiro na gaveta (ex.: reforço de troco)."}</p>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Valor</label>
        <div className="mb-3"><MoneyInput cents={valorC} onChange={setValorC} autoFocus /></div>
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Motivo (opcional)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={sangria ? "ex.: sangria pro cofre" : "ex.: troco do banco"} className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Voltar</button>
          <button onClick={async () => { setSaving(true); try { await onConfirmar({ tipo, valor: v, motivo: motivo.trim() || null, em: new Date().toISOString(), porNome: meNome }); } finally { setSaving(false); } }} disabled={saving || v <= 0} className={`h-10 px-4 rounded-lg text-white text-sm font-bold disabled:opacity-40 ${sangria ? "bg-amber-600" : "bg-emerald-600"}`}>{saving ? "…" : "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

function FecharCaixaModal({ caixa, comandas, onClose, onFechar }: {
  caixa: ComandaCaixa; comandas: Comanda[]; onClose: () => void; onFechar: (contadoDinheiro: number, obs: string, resumo: ComandaCaixa["resumo"]) => Promise<void>;
}) {
  const [conf, setConf] = useState<Record<string, number>>({});   // conferido por forma, em CENTAVOS
  const [touched, setTouched] = useState(false);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  // Resumo do período (desde a abertura): pagamentos por forma.
  const resumo = useMemo(() => {
    const inicio = caixa.abertoEm, fim = new Date().toISOString();
    const noPer = (em?: string | null) => !!em && em >= inicio && em <= fim;
    const map = new Map<string, number>();
    const comandasNoPer = new Set<string>();
    for (const c of comandas) for (const p of c.pagamentos || []) if (noPer(p.em)) { const fn = baseForma(p.forma); map.set(fn, (map.get(fn) || 0) + p.valor); comandasNoPer.add(c.id); }
    const porForma = [...map.entries()].map(([forma, valor]) => ({ forma, valor })).sort((a, b) => b.valor - a.valor);
    const vendasTotal = porForma.reduce((s, f) => s + f.valor, 0);
    const dinheiroVendas = porForma.filter((f) => /dinheiro/i.test(f.forma)).reduce((s, f) => s + f.valor, 0);
    const sangrias = (caixa.movimentos || []).filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
    const reforcos = (caixa.movimentos || []).filter((m) => m.tipo === "reforco").reduce((s, m) => s + m.valor, 0);
    const dinheiroEsperado = +(caixa.fundoTroco + dinheiroVendas + reforcos - sangrias).toFixed(2);
    return { vendasTotal: +vendasTotal.toFixed(2), nComandas: comandasNoPer.size, porForma, dinheiroVendas: +dinheiroVendas.toFixed(2), sangrias: +sangrias.toFixed(2), reforcos: +reforcos.toFixed(2), dinheiroEsperado, diferenca: 0 };
  }, [caixa, comandas]);
  // Formas a conferir: as padrão (Dinheiro/Crédito/Débito/Pix) SEMPRE + extras com venda.
  const formasConf = useMemo(() => {
    const val = (forma: string) => resumo.porForma.find((f) => f.forma === forma)?.valor || 0;
    const todas = [...new Set([...FORMAS_PADRAO, ...resumo.porForma.map((f) => f.forma)])];
    return todas.map((forma) => ({ forma, esperado: /dinheiro/i.test(forma) ? resumo.dinheiroEsperado : +val(forma).toFixed(2) }));
  }, [resumo]);
  // Pré-carrega a conferência com o valor ESPERADO de cada forma — o operador
  // só confere/ajusta onde diferir (cartão/Pix do TEF já batem). Agiliza e evita
  // digitar na maioria dos casos. Roda 1x quando as formas ficam prontas; não
  // sobrescreve ajustes já feitos nem se chegar venda nova com o modal aberto.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || formasConf.length === 0) return;
    setConf(Object.fromEntries(formasConf.map((f) => [f.forma, Math.round(f.esperado * 100)])));
    setTouched(true);
    prefilled.current = true;
  }, [formasConf]);
  const setForma = (forma: string, cents: number) => { setConf((p) => ({ ...p, [forma]: cents })); setTouched(true); };
  const conferencia = formasConf.map((f) => { const conferido = (conf[f.forma] || 0) / 100; return { forma: f.forma, esperado: f.esperado, conferido, diferenca: +(conferido - f.esperado).toFixed(2) }; });
  const diferencaTotal = +conferencia.reduce((s, c) => s + c.diferenca, 0).toFixed(2);
  const contadoDinheiro = (conf["Dinheiro"] || 0) / 100;
  const Linha = ({ l, v, forte }: { l: string; v: string; forte?: boolean }) => (
    <div className={`flex justify-between ${forte ? "font-bold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}><span>{l}</span><span className="tabular-nums">{v}</span></div>
  );
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Banknote size={16} className="text-indigo-500" /> Fechar caixa</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-[13px] space-y-1 mb-3">
          <Linha l={`Vendas (${resumo.nComandas})`} v={fmtR(resumo.vendasTotal)} forte />
          {resumo.porForma.map((f) => <Linha key={f.forma} l={`· ${f.forma}`} v={fmtR(f.valor)} />)}
          <div className="border-t border-dashed border-gray-200 dark:border-gray-700 my-1.5" />
          <Linha l="Fundo de troco" v={fmtR(caixa.fundoTroco)} />
          {resumo.reforcos > 0 && <Linha l="Reforços" v={`+ ${fmtR(resumo.reforcos)}`} />}
          {resumo.sangrias > 0 && <Linha l="Sangrias" v={`− ${fmtR(resumo.sangrias)}`} />}
        </div>
        {/* Conferência por forma de pagamento (pra conciliar) */}
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-0.5">Conferência por forma</div>
        <div className="text-[11px] text-gray-400 mb-1.5">Já vem com o valor esperado — ajuste só o que divergir (confira o dinheiro).</div>
        <div className="space-y-2.5">
          {formasConf.map((f) => {
            const c = conferencia.find((x) => x.forma === f.forma)!;
            const temValor = (conf[f.forma] || 0) > 0;
            return (
              <div key={f.forma} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{f.forma}</span>
                  <span className="text-[11px] text-gray-400">esperado <b className="tabular-nums text-gray-600 dark:text-gray-300">{fmtR(f.esperado)}</b></span>
                </div>
                <MoneyInput cents={conf[f.forma] || 0} onChange={(cents) => setForma(f.forma, cents)} />
                {temValor && Math.abs(c.diferenca) >= 0.005 && (
                  <div className={`mt-1 text-[11px] font-semibold ${c.diferenca > 0 ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"}`}>{c.diferenca > 0 ? `Sobra ${fmtR(c.diferenca)}` : `Quebra ${fmtR(Math.abs(c.diferenca))}`}</div>
                )}
              </div>
            );
          })}
        </div>
        {touched && (
          <div className={`mt-3 text-center text-[13px] font-bold rounded-lg py-2 ${Math.abs(diferencaTotal) < 0.005 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : diferencaTotal > 0 ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"}`}>
            {Math.abs(diferencaTotal) < 0.005 ? "Caixa bateu certinho ✓" : diferencaTotal > 0 ? `Sobra total de ${fmtR(diferencaTotal)}` : `Quebra total de ${fmtR(Math.abs(diferencaTotal))}`}
          </div>
        )}
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1 mt-3">Observação (opcional)</label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: quebra por troco errado" className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Voltar</button>
          <button onClick={async () => { setSaving(true); try { await onFechar(contadoDinheiro, obs, { ...resumo, diferenca: diferencaTotal, conferencia }); } finally { setSaving(false); } }} disabled={saving || !touched} className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">{saving ? "Fechando…" : "Fechar caixa"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Abrir comanda ────────────────────────────────────────────────────────
function AbrirComandaModal({ modo, clientes, onClose, onAbrir }: {
  modo: "conta" | "togo";
  clientes: Cliente[];
  onClose: () => void;
  onAbrir: (d: { numero: string; clienteNome: string; cpf?: string; telefone?: string; pessoas: number; modo: "conta" | "togo"; clienteId?: string | null }) => Promise<void>;
}) {
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [pessoas, setPessoas] = useState(1);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const togo = modo === "togo";
  // Typeahead no CRM: casa por nome OU telefone enquanto digita (até escolher um).
  const matches = useMemo(() => {
    if (clienteId) return [];
    const qn = nome.trim().toLowerCase();
    const qt = tel.replace(/\D/g, "");
    if (qn.length < 2 && qt.length < 3) return [];
    return clientes.filter((c) => {
      const byNome = qn.length >= 2 && (c.nome || "").toLowerCase().includes(qn);
      const byTel = qt.length >= 3 && (c.telefone || "").replace(/\D/g, "").includes(qt);
      return byNome || byTel;
    }).slice(0, 6);
  }, [clientes, nome, tel, clienteId]);
  function selecionar(c: Cliente) { setClienteId(c.id); setNome(c.nome); setTel(c.telefone || ""); }
  async function salvar() {
    if (!togo && !nome.trim()) { setErr("Informe o nome do cliente."); return; }
    const clienteNome = nome.trim() || (togo ? "Venda rápida" : "");
    setErr(""); setSaving(true);
    try { await onAbrir({ numero: numero.trim(), clienteNome, telefone: tel, pessoas: Math.max(1, pessoas), modo, clienteId }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Erro"); setSaving(false); }
  }
  const campo = "w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  const rotulo = "text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5";
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><User size={16} className="text-indigo-500" /> {togo ? "Venda rápida (to-go)" : "Abrir comanda"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3.5">
          <div>
            <label className={rotulo}>Nome do cliente {togo ? "(opcional)" : "*"}</label>
            <input value={nome} onChange={(e) => { setNome(e.target.value); if (clienteId) setClienteId(null); }} autoFocus placeholder="nome do cliente" className={campo} />
            {clienteId && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">✓ cliente do CRM <button onClick={() => setClienteId(null)} className="text-gray-400 hover:text-rose-500"><X size={12} /></button></div>}
          </div>
          <div>
            <label className={rotulo}>Nº da comanda (opcional)</label>
            <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="ex.: 12 · deixe vazio p/ automático" className={`${campo} tabular-nums`} />
          </div>
          <div>
            <label className={rotulo}>Quantidade de pessoas</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setPessoas((p) => Math.max(1, p - 1))} disabled={pessoas <= 1} className="w-12 h-12 rounded-xl border border-gray-300 dark:border-gray-700 grid place-items-center text-gray-600 dark:text-gray-300 disabled:opacity-30 active:bg-gray-100 dark:active:bg-gray-800"><Minus size={20} /></button>
              <div className="flex-1 h-12 rounded-xl bg-gray-50 dark:bg-gray-800/60 grid place-items-center text-2xl font-extrabold text-gray-900 dark:text-gray-100 tabular-nums">{pessoas}</div>
              <button type="button" onClick={() => setPessoas((p) => Math.min(99, p + 1))} className="w-12 h-12 rounded-xl border border-gray-300 dark:border-gray-700 grid place-items-center text-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800"><Plus size={20} /></button>
            </div>
          </div>
          <div>
            <label className={rotulo}>Telefone (opcional)</label>
            <input value={tel} onChange={(e) => { setTel(e.target.value); if (clienteId) setClienteId(null); }} inputMode="tel" placeholder="(11) 90000-0000" className={campo} />
          </div>
          {/* Sugestões do CRM (por nome ou telefone) */}
          {matches.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden -mt-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 dark:bg-gray-800/40">Clientes cadastrados</div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-44 overflow-y-auto">
                {matches.map((c) => (
                  <button key={c.id} type="button" onClick={() => selecionar(c)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50/60 dark:hover:bg-indigo-950/20">
                    <User size={14} className="text-gray-400 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{c.nome}</span>
                    {c.telefone && <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{c.telefone}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!togo && !clienteId && tel.trim() && nome.trim() && matches.length === 0 && (
            <p className="text-[11px] text-gray-400 -mt-1">Cliente novo — será cadastrado no CRM ao abrir a comanda.</p>
          )}
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
            <button onClick={onClose} className="flex-1 h-11 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
            <button onClick={salvar} disabled={saving} className="flex-1 h-11 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">{saving ? "..." : "Abrir e lançar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detalhe da comanda (lançar itens, imprimir, fechar) ───────────────────
function ComandaDetalhe({ comanda, produtos, categorias, estacoes, logoUrl, fiscalCfg, podeOperar, meNome, nomeRest, rid, onClose }: {
  comanda: Comanda; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; estacoes: ComandaEstacao[]; logoUrl: string | null; fiscalCfg: ComandaFiscalConfig | null; podeOperar: boolean; meNome: string; nomeRest: string; rid: string;
  onClose: () => void;
}) {
  const fechada = comanda.status === "fechada";
  const editavel = podeOperar && !fechada;
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string>("todas");   // "todas" | categoriaId | "sem"
  const [abaMob, setAbaMob] = useState<"produtos" | "itens">("produtos");   // mobile: alterna grade de produtos × itens lançados (desktop mostra os dois)
  const [editNome, setEditNome] = useState(false);          // edição inline do nome do cliente
  const [nomeDraft, setNomeDraft] = useState("");
  const [pesoDe, setPesoDe] = useState<ComandaProduto | null>(null);   // produto por peso aguardando o peso
  const [fechar, setFechar] = useState(false);
  const [verConta, setVerConta] = useState(false);          // tela pra mostrar ao cliente
  const [salvandoImpr, setSalvandoImpr] = useState(false);
  const [nfceLoading, setNfceLoading] = useState(false);
  const [cpfModal, setCpfModal] = useState(false);      // pedir CPF antes de emitir
  const [cancelModal, setCancelModal] = useState(false); // pedir motivo do cancelamento
  const [perguntaNota, setPerguntaNota] = useState(false); // "Emitir nota agora?" após fechar a venda
  const voltarAposRef = useRef(false);                   // após emitir/cancelar CPF → volta pra lista
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Só categorias que têm produtos ativos.
  const catsComProd = useMemo(() => {
    const ids = new Set(produtos.map((p) => p.categoriaId || "sem"));
    const out = categorias.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, nome: c.nome }));
    if (ids.has("sem")) out.push({ id: "sem", nome: "Outros" });
    // "Cozinha" (aberta) sempre primeiro.
    out.sort((a, b) => {
      const ca = a.nome.trim().toLowerCase().includes("cozinha") ? 0 : 1;
      const cb = b.nome.trim().toLowerCase().includes("cozinha") ? 0 : 1;
      return ca - cb;
    });
    return out;
  }, [produtos, categorias]);
  // Seleciona "Cozinha" por padrão ao abrir a comanda (se existir).
  const catInitRef = useRef(false);
  useEffect(() => {
    if (catInitRef.current || catsComProd.length === 0) return;
    catInitRef.current = true;
    const ca = catsComProd.find((c) => c.nome.trim().toLowerCase().includes("cozinha"));
    setCatSel(ca ? ca.id : "todas");
  }, [catsComProd]);

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
    return { itens, total, gorjetaSugerida: gorjetaSugeridaDe(itens, fiscalCfg) };
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
    // Mínimo 1 — diminuir NÃO exclui (pra remover, use a lixeira, que confirma).
    const it = comanda.itens.find((i) => i.id === itemId);
    const reduziu = it && !it.porPeso && delta < 0 && it.qtd > 1;
    const itens = comanda.itens.map((i) => {
      if (i.id !== itemId || i.porPeso) return i;
      const q = Math.max(1, i.qtd + delta);
      return { ...i, qtd: q, total: +(q * i.precoUnit).toFixed(2) };
    });
    await patch(recompor(itens));
    // Item de produção JÁ enviado à cozinha e reduzido → avisa a cozinha.
    if (reduziu && it!.producao && it!.impressoEm) {
      await imprimirCancelamentoCozinha([{ nome: it!.nome, qtd: Math.min(-delta, it!.qtd), categoriaId: it!.categoriaId, porPeso: it!.porPeso }]);
    }
  }
  async function removerItem(itemId: string) {
    const it = comanda.itens.find((i) => i.id === itemId);
    if (it && !confirm(`Remover "${it.nome}" da comanda?`)) return;
    await patch(recompor(comanda.itens.filter((i) => i.id !== itemId)));
    // Item de produção JÁ enviado à cozinha e removido → imprime cancelamento.
    if (it && it.producao && it.impressoEm) {
      await imprimirCancelamentoCozinha([{ nome: it.nome, qtd: it.qtd, categoriaId: it.categoriaId, porPeso: it.porPeso }]);
    }
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
          linhas: agruparItens(itens).map((g) => ({ nome: g.nome, qtd: g.porPeso ? `${fmtNum(g.qtd, 3)} kg` : `${g.qtd}x`, valor: null })),
          total: null, rodape: `${comanda.clienteNome} · ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${meNome}`,
          status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
        };
        await criarPrintJob(job);
      }
      const marcadoEm = nowIso();
      const itensAtu = comanda.itens.map((i) => (i.producao && !i.impressoEm ? { ...i, impressoEm: marcadoEm } : i));
      await patch(recompor(itensAtu));
      onClose();   // enviou a produção → volta pra tela principal (lista de comandas)
    } finally { setSalvandoImpr(false); }
  }

  function pedirFechar() {
    if (pendentesProducao.length && !confirm(`Há ${pendentesProducao.length} item(ns) de cozinha ainda NÃO enviados pra produção. Fechar mesmo assim?`)) return;
    setFechar(true);
  }
  const vazia = comanda.status !== "fechada" && comanda.itens.length === 0 && (comanda.pagamentos || []).length === 0;
  // Sair do detalhe: se há itens de cozinha não enviados, confirma antes.
  async function sair() {
    if (editavel && pendentesProducao.length && !confirm(`Há ${pendentesProducao.length} item(ns) de cozinha ainda NÃO enviados pra produção. Sair sem imprimir? (Cancele pra imprimir a cozinha)`)) return;
    // Comanda vazia (sem item e sem pagamento) não fica na lista — apaga ao sair.
    if (vazia) { try { await excluirComanda(comanda.id); } catch { /* ignore */ } }
    onClose();
  }
  async function excluirComandaAtual() {
    try { await excluirComanda(comanda.id); } catch { /* ignore */ }
    onClose();
  }
  async function reabrir() {
    if (!confirm("Reabrir esta comanda? Ela volta pra lista de abertas.")) return;
    await salvarComanda({ ...comanda, status: "aberta", fechadoEm: null, fechadoPorNome: null });
  }
  // Dá pra emitir NFC-e agora? (fiscal configurado, sem nota ainda, NCM ok).
  const podeEmitirAgora = useMemo(() => {
    if (!fiscalCfg?.cfop || !fiscalCfg?.cstIcms) return false;
    if (comanda.nfce?.chave && !comanda.nfce?.canceladoEm) return false;
    if (comanda.itens.length === 0) return false;
    return montarNfce(comanda, produtos, fiscalCfg).faltando.length === 0;
  }, [comanda, produtos, fiscalCfg]);
  // Após fechar a venda: pergunta se emite a nota; senão volta pra lista.
  function aposFecharVenda() {
    setFechar(false);
    if (podeEmitirAgora) setPerguntaNota(true); else onClose();
  }
  // Abre o fluxo de emissão: valida e, se faltar CPF, abre o modal; senão emite.
  function emitirNfce() {
    if (comanda.nfce?.chave && !comanda.nfce?.canceladoEm && !confirm("Esta comanda já tem NFC-e autorizada. Emitir outra?")) return;
    if (!fiscalCfg?.cfop || !fiscalCfg?.cstIcms) { alert("Configure o Fiscal padrão (NFC-e) primeiro: Config → Produtos → Fiscal padrão (CFOP, CST, alíquotas)."); return; }
    const { faltando } = montarNfce(comanda, produtos, fiscalCfg);
    if (faltando.length) { alert("Faltam dados fiscais (NCM/CFOP/CST) nestes produtos: " + [...new Set(faltando)].join(", ") + ".\nPreencha o NCM em Produtos → Fiscal (NFC-e)."); return; }
    const cpfNota = (comanda.cpf || "").replace(/\D/g, "");
    if (cpfNota) { void doEmitir(cpfNota); } else { setCpfModal(true); }
  }
  async function doEmitir(cpfNota: string) {
    const { items, formas } = montarNfce(comanda, produtos, fiscalCfg);
    setNfceLoading(true);
    try {
      const ref = `c${comanda.id}_${Date.now().toString(36)}`;
      const l = lerNfce(await nfceEmitir(ref, items, formas, cpfNota || undefined, comanda.clienteNome));
      const nfce = { ref, status: l.status, chave: l.chave, numero: l.numero, serie: l.serie, protocolo: l.protocolo, qrcodeUrl: l.qrcodeUrl, urlConsulta: l.urlConsulta, danfeUrl: l.danfeUrl, emitidaEm: new Date().toISOString(), erro: l.autorizado ? undefined : l.mensagem };
      await salvarComanda({ ...comanda, nfce });
      if (l.autorizado) {
        await imprimirDanfce({ ...comanda, nfce });   // cupom fiscal com QR na estação
        alert(`✅ NFC-e autorizada! Nº ${l.numero} · série ${l.serie}\nImprimindo o cupom fiscal (DANFCe).`);
      } else {
        alert(`❌ Não autorizada: ${l.mensagem || l.status}`);
      }
    } catch (e) { alert("Erro ao emitir NFC-e: " + (e instanceof Error ? e.message : "?")); }
    finally { setNfceLoading(false); if (voltarAposRef.current) { voltarAposRef.current = false; onClose(); } }
  }
  function cancelarNfce() {
    if (!comanda.nfce?.ref || !comanda.nfce?.chave) { alert("Esta venda não tem NFC-e autorizada pra cancelar."); return; }
    if (comanda.nfce?.canceladoEm) { alert("Esta NFC-e já foi cancelada."); return; }
    setCancelModal(true);
  }
  async function doCancelar(motivo: string) {
    const ref = comanda.nfce?.ref; if (!ref) return;
    setNfceLoading(true);
    try {
      const l = lerNfce(await nfceCancelar(ref, motivo.trim()));
      if (l.cancelado || l.status === "cancelado") {
        const cancelada = { ...comanda, nfce: { ...comanda.nfce!, status: "cancelado", canceladoEm: new Date().toISOString() } };
        await salvarComanda(cancelada);
        await imprimirCancelamentoNfce(cancelada);   // comprovante de cancelamento
        alert("✅ NFC-e cancelada com sucesso.");
      } else {
        alert(`❌ Não foi possível cancelar: ${l.mensagem || l.status}\n(A janela de cancelamento da NFC-e é curta — ~30 min.)`);
      }
    } catch (e) { alert("Erro ao cancelar NFC-e: " + (e instanceof Error ? e.message : "?")); }
    finally { setNfceLoading(false); }
  }
  // Imprime o DANFCe (cupom fiscal 80mm com QR) na estação.
  async function imprimirDanfce(c: Comanda) {
    const n = c.nfce; if (!n?.chave) return;
    // Gera o QR (data URL) aqui, pra impressão não depender de render assíncrono.
    let qrDataUrl: string | null = null;
    if (n.qrcodeUrl) { try { qrDataUrl = await QRCode.toDataURL(n.qrcodeUrl, { margin: 1, width: 240 }); } catch { qrDataUrl = null; } }
    const job: ComandaPrintJob = {
      id: uid(), restaurantId: rid, tipo: "danfce", rotulo: "DANFE NFC-e", comandaId: c.id,
      comandaNumero: c.numero, clienteNome: c.clienteNome, estacaoId: null, logoUrl,
      titulo: fiscalCfg?.emitRazao || nomeRest || "NFC-e",
      linhas: [
        ...agruparItens(c.itens).map((g) => ({ nome: g.nome, qtd: g.porPeso ? `${fmtNum(g.qtd, 3)}kg` : `${g.qtd}x`, valor: fmtR(g.total) })),
        ...(gorjetaEfetiva(c) > 0 ? [{ nome: "Gorjeta", qtd: "", valor: fmtR(gorjetaEfetiva(c)) }] : []),
      ],
      total: fmtR(totalAPagarComanda(c)),
      rodape: (c.pagamentos || []).map((p) => `${p.forma}: ${fmtR(p.valor)}`).join("\n"),
      nfce: {
        chave: n.chave, numero: n.numero, serie: n.serie, protocolo: n.protocolo, qrcodeUrl: n.qrcodeUrl, qrDataUrl, urlConsulta: n.urlConsulta,
        dataEmissao: n.emitidaEm || nowIso(), cpfConsumidor: c.cpf || null,
        emitRazao: fiscalCfg?.emitRazao || nomeRest || null, emitCnpj: fiscalCfg?.emitCnpj || null, emitIe: fiscalCfg?.emitIe || null, emitEndereco: fiscalCfg?.emitEndereco || null,
      },
      status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
    };
    await criarPrintJob(job);
  }
  // Imprime um comprovante de CANCELAMENTO da NFC-e (grande).
  async function imprimirCancelamentoNfce(c: Comanda) {
    const n = c.nfce; if (!n) return;
    await criarPrintJob({
      id: uid(), restaurantId: rid, tipo: "cancelamento", rotulo: "NOTA FISCAL (NFC-e)", comandaId: c.id,
      comandaNumero: c.numero, clienteNome: c.clienteNome, estacaoId: null, logoUrl,
      titulo: nomeRest || "",
      linhas: [{ nome: `NFC-e no ${n.numero || "-"} serie ${n.serie || "-"}`, qtd: null, valor: null }],
      total: null,
      rodape: `${n.chave ? "Chave: " + n.chave + "\n" : ""}Cancelada em ${new Date().toLocaleString("pt-BR")} · ${meNome}`,
      status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
    });
  }
  // Imprime CANCELAMENTO na cozinha (itens de produção que JÁ tinham sido enviados).
  async function imprimirCancelamentoCozinha(cancelados: { nome: string; qtd: number; categoriaId?: string | null; porPeso?: boolean }[]) {
    if (!cancelados.length) return;
    const porEstacao = new Map<string, typeof cancelados>();
    for (const it of cancelados) {
      const eid = estacaoDaCategoria(it.categoriaId) || "_null_";
      (porEstacao.get(eid) || porEstacao.set(eid, []).get(eid)!).push(it);
    }
    for (const [eid, itens] of porEstacao) {
      const estacaoId = eid === "_null_" ? null : eid;
      await criarPrintJob({
        id: uid(), restaurantId: rid, tipo: "cancelamento", rotulo: "COZINHA", comandaId: comanda.id,
        comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId, logoUrl: null,
        titulo: "",
        linhas: itens.map((g) => ({ nome: g.nome, qtd: g.porPeso ? `${fmtNum(g.qtd, 3)} kg` : `${g.qtd}x`, valor: null })),
        total: null, rodape: `${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${meNome}`,
        status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
      });
    }
  }
  async function reimprimirConta() {
    await superseedContaJobs(rid, comanda.id);   // descarta contas pendentes antigas desta comanda
    const job: ComandaPrintJob = {
      id: uid(), restaurantId: rid, tipo: "conta", rotulo: "CONTA", comandaId: comanda.id,
      comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId: null, logoUrl,
      titulo: nomeRest || "CONTA",
      linhas: [
        ...agruparItens(comanda.itens).map((g) => ({ nome: `${g.porPeso ? `${fmtNum(g.qtd, 3)}kg ` : `${g.qtd}x `}${g.nome}`, qtd: null, valor: fmtR(g.total) })),
        ...(gorjetaEfetiva(comanda) > 0 ? [{ nome: comanda.gorjeta == null ? "Gorjeta sugerida" : "Gorjeta", qtd: null, valor: fmtR(gorjetaEfetiva(comanda)) }] : []),
      ],
      total: fmtR(totalAPagarComanda(comanda)),
      rodape: (comanda.pagamentos || []).map((p) => `${p.forma}: ${fmtR(p.valor)}`).join("\n"),
      status: "pendente", criadoEm: nowIso(), criadoPorNome: meNome, impressoEm: null,
    };
    await criarPrintJob(job);
  }

  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden h-[80vh] sm:h-[74vh]">
      {/* Cabeçalho do detalhe (abre abaixo do header do PDV) */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button onClick={() => void sair()} className="w-9 h-9 rounded-full text-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 grid place-items-center" title="Voltar à lista">←</button>
        <div className="min-w-0 flex-1">
          {editNome ? (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-gray-900 dark:text-gray-100 shrink-0">#{comanda.numero} ·</span>
              <input
                value={nomeDraft}
                onChange={(e) => setNomeDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { void patch({ clienteNome: nomeDraft.trim() || comanda.clienteNome }); setEditNome(false); } if (e.key === "Escape") setEditNome(false); }}
                placeholder="nome do cliente"
                className="min-w-0 flex-1 h-8 px-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
              />
              <button onClick={() => { void patch({ clienteNome: nomeDraft.trim() || comanda.clienteNome }); setEditNome(false); }} className="w-8 h-8 shrink-0 grid place-items-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white" title="Salvar nome"><Check size={16} /></button>
              <button onClick={() => setEditNome(false)} className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Cancelar"><X size={16} /></button>
            </div>
          ) : (
            <div className="font-bold text-gray-900 dark:text-gray-100 truncate leading-tight inline-flex items-center gap-1.5 max-w-full">
              <span className="truncate">#{comanda.numero} · {comanda.clienteNome}{comanda.modo === "togo" && <span className="text-[11px] text-emerald-600 ml-1">to-go</span>}</span>
              {editavel && <button onClick={() => { setNomeDraft(comanda.clienteNome); setEditNome(true); }} className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800" title="Editar nome do cliente"><Pencil size={14} /></button>}
            </div>
          )}
          <div className="text-[11px] text-gray-500">{comanda.itens.length} item(ns)</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-gray-400 font-bold">Total</div>
          <div className="text-lg font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums leading-none">{fmtR(totalAPagarComanda(comanda))}</div>
          {gorjetaEfetiva(comanda) > 0 && <div className="text-[10px] text-gray-400 tabular-nums">+{fmtR(gorjetaEfetiva(comanda))} serviço</div>}
        </div>
      </div>

      {/* Alternador mobile: Produtos × Itens (desktop mostra os dois lado a lado) */}
      {editavel && (
        <div className="sm:hidden flex gap-1.5 p-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <button onClick={() => setAbaMob("produtos")} className={`flex-1 h-9 rounded-lg text-[13px] font-bold border ${abaMob === "produtos" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>+ Produtos</button>
          <button onClick={() => setAbaMob("itens")} className={`flex-1 h-9 rounded-lg text-[13px] font-bold border ${abaMob === "itens" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>Itens ({comanda.itens.length})</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
        {/* Itens lançados */}
        <div ref={scrollRef} className={`${fechada ? "w-full overflow-y-auto" : `${abaMob === "itens" ? "flex-1 min-h-0" : "hidden"} sm:block sm:flex-none sm:w-[44%] sm:border-r overflow-y-auto p-3 space-y-1.5`} order-2 sm:order-1 border-gray-100 dark:border-gray-800`}>
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
          <div className={`${abaMob === "produtos" ? "flex" : "hidden"} sm:flex flex-1 min-h-0 flex-col order-1 sm:order-2`}>
            {/* Abas de categoria */}
            {catsComProd.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto px-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-800 no-scrollbar">
                {[...catsComProd, { id: "todas", nome: "Todas" }].map((c) => (
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
                      className={`text-left rounded-xl border p-2.5 hover:brightness-95 active:scale-[0.98] transition ${corCategoria(p.categoria)}`}>
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
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 p-2.5 flex flex-wrap items-center gap-2">
        {fechada ? (
          <>
            {/* Com NFC-e autorizada: o cupom fiscal já aparece na tela acima.
                Aqui só Imprimir (DANFCe) + Cancelar. Sem nota: Emitir + conta + reabrir. */}
            {comanda.nfce?.chave && !comanda.nfce?.canceladoEm ? (
              <>
                <button onClick={() => void imprimirDanfce(comanda)} className="flex-1 h-11 px-3 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-1.5"><Printer size={17} /> Imprimir cupom</button>
                {podeOperar && <button onClick={() => void cancelarNfce()} disabled={nfceLoading} className="flex-1 h-11 px-3 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold disabled:opacity-50 inline-flex items-center justify-center">{nfceLoading ? "…" : "Cancelar NFC-e"}</button>}
              </>
            ) : comanda.nfce?.canceladoEm ? (
              <button onClick={() => void reimprimirConta()} className="flex-1 h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Printer size={17} /> Imprimir conta</button>
            ) : (
              <>
                {podeOperar && <button onClick={() => void emitirNfce()} disabled={nfceLoading} className="basis-full h-11 rounded-xl font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"><Receipt size={17} /> {nfceLoading ? "Emitindo…" : "Emitir NFC-e"}</button>}
                <button onClick={() => void reimprimirConta()} className="flex-1 h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Printer size={17} /> Imprimir conta</button>
                {podeOperar && <button onClick={() => void reabrir()} className="flex-1 h-11 px-3 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold">Reabrir</button>}
              </>
            )}
          </>
        ) : editavel ? (
          comanda.itens.length === 0 ? (
            <>
              <span className="flex-1 text-[12px] text-gray-400 self-center pl-1">Nenhum item lançado ainda.</span>
              <button onClick={() => void excluirComandaAtual()} className="h-11 px-4 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold inline-flex items-center justify-center gap-1.5"><Trash2 size={17} /> Excluir comanda</button>
            </>
          ) : (
          <>
            <button onClick={() => setVerConta(true)} className="flex-1 sm:flex-none h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Eye size={17} /> Pré-conta</button>
            <button onClick={() => void imprimirProducao()} disabled={!pendentesProducao.length || salvandoImpr}
              className="flex-1 sm:flex-none h-11 px-3 rounded-xl border-2 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
              <Printer size={17} /> Imprimir cozinha{pendentesProducao.length ? ` (${pendentesProducao.length})` : ""}
            </button>
            <button onClick={pedirFechar} className="basis-full sm:basis-0 sm:flex-1 h-11 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-1.5">
              <Check size={18} /> Fechar · {fmtR(totalAPagarComanda(comanda))}
            </button>
          </>
          )
        ) : (
          <button onClick={() => setVerConta(true)} className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 font-semibold inline-flex items-center justify-center gap-1.5"><Eye size={17} /> Mostrar conta</button>
        )}
      </div>

      {pesoDe && <PesoModal produto={pesoDe} onClose={() => setPesoDe(null)} onConfirmar={(kg) => { void addItem(pesoDe, kg); setPesoDe(null); }} />}
      {fechar && <FecharModal comanda={comanda} meNome={meNome} nomeRest={nomeRest} rid={rid} logoUrl={logoUrl} fiscalCfg={fiscalCfg} onClose={() => setFechar(false)} onFechado={aposFecharVenda} />}
      {verConta && <ContaClienteView comanda={comanda} nomeRest={nomeRest} logoUrl={logoUrl} onClose={() => setVerConta(false)} onImprimir={() => void reimprimirConta()} />}
      {cpfModal && (
        <NfceInputModal
          icone="cpf" titulo="Emitir NFC-e" label="CPF na nota (opcional)"
          descricao="Informe o CPF do cliente pra sair na nota, ou deixe em branco pra consumidor não identificado."
          placeholder="000.000.000-00" inputMode="numeric" mascara="cpf" podeVazio
          confirmarLabel="Emitir NFC-e"
          onConfirmar={(v) => { setCpfModal(false); void doEmitir(v.replace(/\D/g, "")); }}
          onClose={() => { setCpfModal(false); if (voltarAposRef.current) { voltarAposRef.current = false; onClose(); } }}
        />
      )}
      {perguntaNota && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={() => { setPerguntaNota(false); onClose(); }}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-5 shadow-xl text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 grid place-items-center mb-2"><Check size={30} className="text-emerald-600 dark:text-emerald-300" /></div>
            <div className="font-bold text-gray-900 dark:text-gray-100 text-lg">Venda fechada!</div>
            <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">Quer emitir a nota fiscal (NFC-e) agora?</div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setPerguntaNota(false); onClose(); }} className="flex-1 h-12 rounded-xl border border-gray-300 dark:border-gray-700 font-semibold">Agora não</button>
              <button onClick={() => { setPerguntaNota(false); voltarAposRef.current = true; emitirNfce(); }} className="flex-1 h-12 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-1.5"><Receipt size={18} /> Emitir nota</button>
            </div>
          </div>
        </div>
      )}
      {cancelModal && (
        <NfceInputModal
          icone="cancel" titulo="Cancelar NFC-e" label="Motivo do cancelamento"
          descricao="A SEFAZ exige um motivo com no mínimo 15 caracteres. A janela de cancelamento é de ~30 minutos após a emissão."
          placeholder="Ex.: venda cancelada a pedido do cliente" inicial="Cancelamento solicitado pelo cliente no balcão"
          minLen={15} multiline confirmarLabel="Cancelar NFC-e" perigo
          onConfirmar={(v) => { setCancelModal(false); void doCancelar(v); }}
          onClose={() => setCancelModal(false)}
        />
      )}
    </div>
  );
}

// Modal de input no estilo do sistema (substitui os prompt() nativos) — usado
// p/ CPF na nota e motivo do cancelamento da NFC-e.
function NfceInputModal({ icone, titulo, label, descricao, placeholder, inicial = "", minLen = 0, podeVazio = false, multiline = false, mascara, inputMode, confirmarLabel, perigo = false, onConfirmar, onClose }: {
  icone: "cpf" | "cancel"; titulo: string; label: string; descricao?: string; placeholder?: string; inicial?: string;
  minLen?: number; podeVazio?: boolean; multiline?: boolean; mascara?: "cpf"; inputMode?: "numeric" | "text";
  confirmarLabel: string; perigo?: boolean; onConfirmar: (v: string) => void; onClose: () => void;
}) {
  const [v, setV] = useState(inicial);
  const fmtCpf = (s: string) => { const d = s.replace(/\D/g, "").slice(0, 11); return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
  const onChange = (raw: string) => setV(mascara === "cpf" ? fmtCpf(raw) : raw);
  const limpo = v.trim();
  const valido = podeVazio ? (limpo.length === 0 || limpo.replace(/\D/g, "").length === 11) : limpo.length >= minLen;
  const faltam = minLen > 0 ? Math.max(0, minLen - limpo.length) : 0;
  const Icone = icone === "cancel" ? X : Receipt;
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className={`font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5`}><Icone size={16} className={perigo ? "text-rose-500" : "text-indigo-500"} /> {titulo}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {descricao && <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3 leading-snug">{descricao}</p>}
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">{label}</label>
        {multiline ? (
          <textarea value={v} onChange={(e) => onChange(e.target.value)} autoFocus rows={3} placeholder={placeholder} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-none" />
        ) : (
          <input value={v} onChange={(e) => onChange(e.target.value)} autoFocus inputMode={inputMode} placeholder={placeholder} className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
        )}
        {minLen > 0 && faltam > 0 && <div className="text-[11px] text-amber-600 mt-1">Faltam {faltam} caractere(s).</div>}
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Voltar</button>
          <button onClick={() => valido && onConfirmar(v)} disabled={!valido} className={`h-10 px-4 rounded-lg text-white text-sm font-bold disabled:opacity-40 ${perigo ? "bg-rose-600" : "bg-indigo-600"}`}>{confirmarLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── Conta pra mostrar ao cliente (vira o celular) — cupom ──────────────────
function ContaClienteView({ comanda, nomeRest, logoUrl, onClose, onImprimir }: { comanda: Comanda; nomeRest: string; logoUrl: string | null; onClose: () => void; onImprimir?: () => void }) {
  const [enviado, setEnviado] = useState(false);
  const pre = comanda.status !== "fechada";   // comanda aberta → pré-conta
  const rotulo = pre ? "pré-conta" : "conta";
  return (
    <div className="fixed inset-0 z-[82] bg-gray-100 dark:bg-gray-950 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button onClick={onClose} className="w-9 h-9 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 grid place-items-center"><ChevronLeft size={20} /></button>
        <div className="font-bold text-gray-900 dark:text-gray-100 flex-1">{pre ? "Pré-conta" : "Conta"} · #{comanda.numero}</div>
        {onImprimir && <button onClick={() => { onImprimir(); setEnviado(true); setTimeout(() => setEnviado(false), 2500); }} className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5"><Printer size={16} /> Imprimir</button>}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ContaCupom comanda={comanda} nomeRest={nomeRest} logoUrl={logoUrl} />
      </div>
      {onImprimir && (
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 p-2.5 bg-white dark:bg-gray-900">
          <button onClick={() => { onImprimir(); setEnviado(true); setTimeout(() => setEnviado(false), 2500); }} className="w-full h-12 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-2">
            <Printer size={18} /> {enviado ? "Enviado pra impressora ✓" : `Imprimir ${rotulo}`}
          </button>
        </div>
      )}
    </div>
  );
}

// Cupom (comanda/recibo) — visual inspirado em cupom fiscal. Reusado na tela do
// cliente e na comanda fechada. Logo da empresa vem do módulo Sites.
function ContaCupom({ comanda, nomeRest, logoUrl }: { comanda: Comanda; nomeRest: string; logoUrl: string | null }) {
  const gorj = gorjetaEfetiva(comanda);
  const aPagar = totalAPagarComanda(comanda);
  const saldo = +(aPagar - (comanda.valorPago || 0)).toFixed(2);
  const porPessoa = comanda.pessoas && comanda.pessoas > 1 ? +(aPagar / comanda.pessoas).toFixed(2) : null;
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
        {agruparItens(comanda.itens).map((g, idx) => (
          <div key={idx} className="flex items-baseline">
            <span className="flex-1 pr-1">{g.nome}</span>
            <span className="w-20 text-right text-gray-500 tabular-nums">{g.porPeso ? `${fmtNum(g.qtd, 3)}kg` : `${g.qtd}`}</span>
            <span className="w-20 text-right tabular-nums">{fmtR(g.total)}</span>
          </div>
        ))}
        {comanda.itens.length === 0 && <div className="text-gray-400 text-center py-2">Sem itens.</div>}
      </div>
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 my-2" />
      {gorj > 0 && (<>
        <div className="flex items-center justify-between text-[13px]"><span>Produtos</span><span className="tabular-nums">{fmtR(comanda.total)}</span></div>
        <div className="flex items-center justify-between text-[13px]"><span>{comanda.gorjeta == null ? "Gorjeta sugerida" : "Gorjeta"}</span><span className="tabular-nums">{fmtR(gorj)}</span></div>
      </>)}
      <div className="flex items-center justify-between text-lg font-extrabold"><span>TOTAL</span><span className="tabular-nums">{fmtR(aPagar)}</span></div>
      {porPessoa && <div className="flex items-center justify-between text-[12px] text-gray-500 mt-0.5"><span>Sugestão por pessoa ({comanda.pessoas})</span><span className="tabular-nums">{fmtR(porPessoa)}</span></div>}
      {(comanda.pagamentos || []).length > 0 && (
        <div className="mt-2 text-[12px] text-gray-600 dark:text-gray-300">
          {comanda.pagamentos.map((p, idx) => <div key={idx} className="flex justify-between"><span>{p.forma}</span><span className="tabular-nums">{fmtR(p.valor)}</span></div>)}
          {saldo > 0.001 && <div className="flex justify-between font-semibold text-amber-600 dark:text-amber-400"><span>Falta</span><span className="tabular-nums">{fmtR(saldo)}</span></div>}
        </div>
      )}
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 my-2" />
      {comanda.nfce?.chave && !comanda.nfce?.canceladoEm ? (
        <div className="text-center space-y-1">
          <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">NFC-e nº {comanda.nfce.numero} · série {comanda.nfce.serie}</div>
          <div className="text-[9px] text-gray-500 leading-tight">Consulte pela chave de acesso em:<br />{comanda.nfce.urlConsulta || "www.nfce.fazenda.sp.gov.br"}</div>
          <div className="text-[9px] text-gray-500 font-mono break-all leading-tight">{(comanda.nfce.chave || "").replace(/(\d{4})(?=\d)/g, "$1 ")}</div>
          {comanda.nfce.protocolo && <div className="text-[9px] text-gray-400">Protocolo: {comanda.nfce.protocolo}</div>}
          {comanda.nfce.qrcodeUrl && <QrImg texto={comanda.nfce.qrcodeUrl} />}
        </div>
      ) : comanda.nfce?.canceladoEm ? (
        <div className="text-center text-[11px] font-bold text-rose-600 dark:text-rose-400">NFC-e nº {comanda.nfce.numero} CANCELADA</div>
      ) : (
        <div className="text-center text-[10px] text-gray-400">Documento sem valor fiscal</div>
      )}
    </div>
  );
}

// QR Code na tela (gera o data URL assíncrono — ok fora da impressão).
function QrImg({ texto }: { texto: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(texto, { margin: 1, width: 240 }).then(setSrc).catch(() => setSrc("")); }, [texto]);
  return src ? <img src={src} alt="QR NFC-e" className="w-36 h-36 mx-auto mt-1" /> : null;
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
function FecharModal({ comanda, meNome, nomeRest, rid, logoUrl, fiscalCfg, onClose, onFechado }: {
  comanda: Comanda; meNome: string; nomeRest: string; rid: string; logoUrl: string | null; fiscalCfg: ComandaFiscalConfig | null; onClose: () => void; onFechado: () => void;
}) {
  // Gorjeta sugerida (congelada no recompor); o atendente confirma/edita/remove.
  const gorjSugerida = comanda.gorjetaSugerida || 0;
  const gorjPct = fiscalCfg?.gorjetaPercentual || 0;
  const [incluirGorj, setIncluirGorj] = useState(gorjSugerida > 0);
  const [gorjTxt, setGorjTxt] = useState(gorjSugerida > 0 ? gorjSugerida.toFixed(2).replace(".", ",") : "");
  const gorjVal = incluirGorj ? Math.max(0, +(parseFloat((gorjTxt || "").replace(/\./g, "").replace(",", ".")) || 0).toFixed(2)) : 0;
  const totalPagar = +(comanda.total + gorjVal).toFixed(2);
  const saldo = +(totalPagar - comanda.valorPago).toFixed(2);
  const [pessoas, setPessoas] = useState(String(comanda.pessoas || 1));
  const [linhas, setLinhas] = useState<ComandaPagamento[]>([]);   // pagamentos sendo lançados agora
  const [valorTxt, setValorTxt] = useState("");
  const [imprimirConta, setImprimirConta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tefAberto, setTefAberto] = useState(false);   // cobrança no cartão via Smart TEF
  const [modoDinheiro, setModoDinheiro] = useState(false);
  const [modoManual, setModoManual] = useState(false);   // plano B: cartão/Pix cobrado direto na maquininha
  const [formaManual, setFormaManual] = useState("Cartão (Crédito)");
  const [autoFechar, setAutoFechar] = useState(false);  // ao TEF aprovar e quitar, fecha sozinho
  const [modoTef, setModoTef] = useState(false);   // passo de valor antes do TEF (cobrar parte ou tudo)
  const [tefValor, setTefValor] = useState(0);     // valor que vai pra maquininha nesta cobrança
  const nPessoas = Math.max(1, parseInt(pessoas, 10) || 1);
  const porPessoa = +(totalPagar / nPessoas).toFixed(2);
  const [preImpresso, setPreImpresso] = useState(false);
  async function imprimirPreConta() {
    await superseedContaJobs(rid, comanda.id);
    await criarPrintJob({
      id: uid(), restaurantId: rid, tipo: "conta", rotulo: "PRÉ-CONTA", comandaId: comanda.id,
      comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId: null, logoUrl,
      titulo: nomeRest || "CONTA",
      linhas: [
        ...agruparItens(comanda.itens).map((g) => ({ nome: `${g.porPeso ? `${fmtNum(g.qtd, 3)}kg ` : `${g.qtd}x `}${g.nome}`, qtd: null, valor: fmtR(g.total) })),
        ...(gorjVal > 0 ? [{ nome: `Gorjeta sugerida${gorjPct ? ` (${fmtNum(gorjPct, 0)}%)` : ""}`, qtd: null, valor: fmtR(gorjVal) }] : []),
      ],
      total: fmtR(totalPagar),
      rodape: (comanda.pagamentos || []).map((p) => `${p.forma}: ${fmtR(p.valor)}`).join("\n"),
      status: "pendente", criadoEm: new Date().toISOString(), criadoPorNome: meNome, impressoEm: null,
    });
    setPreImpresso(true); setTimeout(() => setPreImpresso(false), 2500);
  }
  const valorIn = parseFloat((valorTxt || "").replace(/\./g, "").replace(",", ".")) || 0;
  const somaLinhas = +linhas.reduce((s, l) => s + l.valor, 0).toFixed(2);
  const restante = +(saldo - somaLinhas).toFixed(2);
  const vaiFechar = somaLinhas >= saldo - 0.001;
  // Visão viva do pagamento — inclui o valor DIGITADO (ainda não "Add"), estilo Goomer.
  const pagoAgora = +(somaLinhas + (valorIn > 0 ? valorIn : 0)).toFixed(2);
  const faltaLive = Math.max(0, +(saldo - pagoAgora).toFixed(2));
  const troco = Math.max(0, +(pagoAgora - saldo).toFixed(2));
  // Divisão: com "Dividir por" > 1, cada pagamento já vem sugerido com a parte
  // (total ÷ pessoas); a última parte absorve o arredondamento. O operador pode
  // cobrar cada parte no TEF (vários pagamentos), em dinheiro, ou editar o valor
  // (divisão diferente / valor solto).
  const parteSugerida = nPessoas > 1 && restante > porPessoa + 0.01 ? porPessoa : restante;

  function lancarDinheiro(v: number) {
    if (v <= 0) return;
    setLinhas((l) => [...l, { forma: "Dinheiro", valor: +v.toFixed(2), em: new Date().toISOString(), porNome: meNome }]);
    setValorTxt(""); setModoDinheiro(false);
  }
  // Plano B: cartão/Pix cobrado DIRETO na maquininha (TEF fora) → registra manual, sem NSU.
  function lancarManual(v: number) {
    if (v <= 0) return;
    setLinhas((l) => [...l, { forma: formaManual, valor: +v.toFixed(2), em: new Date().toISOString(), porNome: meNome }]);
    setValorTxt(""); setModoManual(false);
  }
  // Ao TEF aprovar e quitar o total → fecha a venda sozinho.
  useEffect(() => {
    if (autoFechar && somaLinhas >= saldo - 0.001 && !saving) { setAutoFechar(false); void confirmar(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFechar, somaLinhas]);
  async function confirmar() {
    setSaving(true);
    try {
      // Inclui o valor digitado que ainda não foi adicionado à lista.
      const linhasFinais = valorIn > 0 ? [...linhas, { forma: "Dinheiro", valor: +valorIn.toFixed(2), em: new Date().toISOString(), porNome: meNome }] : linhas;
      const pags: ComandaPagamento[] = [...comanda.pagamentos, ...linhasFinais];
      const valorPago = +pags.reduce((s, p) => s + p.valor, 0).toFixed(2);
      const quitou = valorPago >= totalPagar - 0.001;
      await salvarComanda({
        ...comanda, pessoas: nPessoas, pagamentos: pags, valorPago,
        // Congela a gorjeta ao FECHAR (0 = não paga). Parcial: mantém a atual.
        gorjeta: quitou ? gorjVal : (comanda.gorjeta ?? null),
        status: quitou ? "fechada" : "aberta",
        fechadoEm: quitou ? new Date().toISOString() : null,
        fechadoPorNome: quitou ? meNome : null,
      });
      if (imprimirConta) {
        await superseedContaJobs(rid, comanda.id);
        const job: ComandaPrintJob = {
          id: uid(), restaurantId: rid, tipo: "conta", rotulo: "CONTA", comandaId: comanda.id,
          comandaNumero: comanda.numero, clienteNome: comanda.clienteNome, estacaoId: null, logoUrl,
          titulo: nomeRest || "CONTA",
          linhas: [
            ...agruparItens(comanda.itens).map((g) => ({ nome: `${g.porPeso ? `${fmtNum(g.qtd, 3)}kg ` : `${g.qtd}x `}${g.nome}`, qtd: null, valor: fmtR(g.total) })),
            ...(gorjVal > 0 ? [{ nome: `Gorjeta${gorjPct ? ` (${fmtNum(gorjPct, 0)}%)` : ""}`, qtd: null, valor: fmtR(gorjVal) }] : []),
          ],
          total: fmtR(totalPagar),
          rodape: `${pags.map((p) => `${p.porNome ? p.porNome + " " : ""}${p.forma}: ${fmtR(p.valor)}`).join("\n")}${quitou ? "" : `\nSALDO: ${fmtR(totalPagar - valorPago)}`}`,
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
          {gorjSugerida > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">Produtos</span>
              <span className="tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtR(comanda.total)}</span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Total</span>
              <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(comanda.total)}</span>
            </div>
          )}
          {/* Gorjeta sugerida — opcional, valor editável, pode remover */}
          {gorjSugerida > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={incluirGorj} onChange={(e) => setIncluirGorj(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                  Gorjeta{gorjPct ? ` (${fmtNum(gorjPct, 0)}%)` : ""} <span className="text-[11px] text-gray-400">sugerida</span>
                </span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">R$</span>
                  <input value={gorjTxt} onChange={(e) => setGorjTxt(e.target.value)} inputMode="decimal" disabled={!incluirGorj} className="w-24 h-8 pl-7 pr-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums disabled:opacity-40" />
                </div>
              </label>
              <p className="text-[10px] text-gray-400 mt-1">Opcional — ajuste o valor ou desmarque se o cliente não pagar.</p>
            </div>
          )}
          {gorjSugerida > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total a pagar</span>
              <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(totalPagar)}</span>
            </div>
          )}
          {comanda.valorPago > 0 && <div className="flex items-center justify-between text-[12px] text-gray-500 mt-0.5"><span>Já pago antes</span><span className="tabular-nums">{fmtR(comanda.valorPago)} · falta {fmtR(saldo)}</span></div>}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="inline-flex items-center gap-1.5 text-sm">
              <User size={14} className="text-gray-400" /> <span className="text-gray-600 dark:text-gray-300">Dividir por</span>
              <input value={pessoas} onChange={(e) => setPessoas(e.target.value)} type="number" min={1} className="w-14 h-8 px-2 text-center text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            {nPessoas > 1 && <span className="text-[12px] text-gray-400 tabular-nums">{fmtR(porPessoa)}/pessoa</span>}
          </div>
        </div>

        <button onClick={() => void imprimirPreConta()} className="w-full h-10 mb-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5"><Printer size={15} /> {preImpresso ? "Pré-conta enviada ✓" : "Imprimir pré-conta"}</button>

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

        {/* Forma de pagamento: Cartão/Pix (TEF), Dinheiro, ou manual (plano B) */}
        {restante > 0.001 && !modoDinheiro && !modoManual && !modoTef && (
          <>
            {nPessoas > 1 && <div className="text-[11px] text-gray-400 mb-1.5 text-center">Dividido por {nPessoas} → cada parte <b className="text-indigo-600 dark:text-indigo-300">{fmtR(parteSugerida)}</b> (edite ao cobrar pra dividir diferente)</div>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setModoTef(true); setValorTxt(parteSugerida.toFixed(2).replace(".", ",")); }} className="h-16 rounded-xl border-2 border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-bold flex flex-col items-center justify-center gap-0.5"><CreditCard size={20} /><span className="text-sm">Cartão / Pix</span><span className="text-[10px] font-normal opacity-70">maquininha (TEF)</span></button>
              <button onClick={() => { setModoDinheiro(true); setValorTxt(parteSugerida.toFixed(2).replace(".", ",")); }} className="h-16 rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 font-bold flex flex-col items-center justify-center gap-0.5"><Banknote size={20} /><span className="text-sm">Dinheiro</span></button>
            </div>
            <button onClick={() => { setModoManual(true); setValorTxt(parteSugerida.toFixed(2).replace(".", ",")); }} className="w-full mt-2 text-[12px] text-gray-500 dark:text-gray-400 underline underline-offset-2">TEF fora do ar? Lançar cartão/Pix cobrado direto na maquininha</button>
          </>
        )}
        {restante > 0.001 && modoTef && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 p-3 space-y-2">
            <span className="text-[12px] font-bold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1"><CreditCard size={14} /> Cobrar no cartão/Pix (TEF)</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" placeholder="valor a cobrar" autoFocus className="w-full h-12 pl-8 pr-2 text-right text-xl rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            <p className="text-[11px] text-gray-400">Cobre o total que falta ({fmtR(restante)}) ou só uma parte — pra dividir em vários cartões, cobre uma parte e repita.</p>
            <div className="flex gap-2">
              <button onClick={() => { setModoTef(false); setValorTxt(""); }} className="h-11 px-4 rounded-lg border border-gray-300 dark:border-gray-700 font-semibold text-sm">← Voltar</button>
              <button onClick={() => { const v = Math.min(valorIn > 0 ? valorIn : restante, restante); setTefValor(v); setModoTef(false); setValorTxt(""); setTefAberto(true); }} disabled={valorIn <= 0} className="flex-1 h-11 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-40">Cobrar {fmtR(Math.min(valorIn > 0 ? valorIn : restante, restante))}</button>
            </div>
          </div>
        )}
        {restante > 0.001 && modoManual && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <span className="text-[12px] font-bold text-gray-700 dark:text-gray-200 inline-flex items-center gap-1"><CreditCard size={14} /> Pagamento manual (cobrado na maquininha)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {["Cartão (Crédito)", "Cartão (Débito)", "Pix"].map((f) => (
                <button key={f} onClick={() => setFormaManual(f)} className={`h-9 rounded-lg border text-[12px] font-semibold ${formaManual === f ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{f.replace("Cartão (", "").replace(")", "")}</button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" placeholder="valor" autoFocus className="w-full h-12 pl-8 pr-2 text-right text-xl rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">Confirme que a maquininha aprovou antes de lançar.</p>
            <div className="flex gap-2">
              <button onClick={() => { setModoManual(false); setValorTxt(""); }} className="h-11 px-4 rounded-lg border border-gray-300 dark:border-gray-700 font-semibold text-sm">← Voltar</button>
              <button onClick={() => lancarManual(Math.min(valorIn, restante))} disabled={valorIn <= 0} className="flex-1 h-11 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-40">Lançar {formaManual.replace("Cartão (", "").replace(")", "")}</button>
            </div>
          </div>
        )}
        {restante > 0.001 && modoDinheiro && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 p-3 space-y-2">
            <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"><Banknote size={14} /> Dinheiro recebido</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
              <input value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} inputMode="decimal" placeholder="valor recebido" autoFocus className="w-full h-12 pl-8 pr-2 text-right text-xl rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
            {valorIn > restante + 0.001 && <div className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300 text-right">Troco: {fmtR(valorIn - restante)}</div>}
            <div className="flex gap-2">
              <button onClick={() => { setModoDinheiro(false); setValorTxt(""); }} className="h-11 px-4 rounded-lg border border-gray-300 dark:border-gray-700 font-semibold text-sm">← Voltar</button>
              <button onClick={() => lancarDinheiro(Math.min(valorIn, restante))} disabled={valorIn <= 0} className="flex-1 h-11 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-40">Lançar dinheiro</button>
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
          <input type="checkbox" checked={imprimirConta} onChange={(e) => setImprimirConta(e.target.checked)} className="accent-indigo-600" />
          Imprimir a conta
        </label>
        {linhas.length > 0 && !vaiFechar && <div className="text-[12px] text-amber-600 dark:text-amber-400 mt-2">Parcial — a comanda continua <b>aberta</b> pra seguir consumindo.</div>}
        <div className="flex justify-end gap-2 pt-3 mt-2 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={saving || (linhas.length === 0 && valorIn <= 0)} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{saving ? "..." : ((somaLinhas + valorIn) >= saldo - 0.001 ? "Fechar venda ✓" : "Registrar parcial")}</button>
        </div>
      </div>

      {tefAberto && (
        <TefCobranca
          valor={Math.max(0, Math.min(tefValor > 0 ? tefValor : restante, restante))}
          cpf={comanda.cpf || undefined}
          nome={comanda.clienteNome}
          onAprovado={(info) => { setLinhas((l) => [...l, { forma: info.forma + (info.nsu ? ` · NSU ${info.nsu}` : ""), valor: +info.valor.toFixed(2), em: new Date().toISOString(), porNome: meNome }]); setAutoFechar(true); }}
          onFechar={() => setTefAberto(false)}
        />
      )}
    </div>
  );
}

// ── Dashboard de vendas (dia único OU período) ─────────────────────────────
const ymd = (d: Date) => d.toLocaleDateString("en-CA");
const addDias = (base: string, n: number) => { const d = new Date(base + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const brData = (d: string) => d.split("-").reverse().join("/");
function RelatorioComandas({ comandas, categorias, onAbrir }: { comandas: Comanda[]; categorias: ComandaCategoria[]; onAbrir?: (id: string) => void }) {
  const hoje = ymd(new Date());
  // Intervalo [de, ate] de um preset relativo, sempre a partir de HOJE.
  const rangeFor = (id: string): [string, string] => {
    if (id === "ontem") { const o = addDias(hoje, -1); return [o, o]; }
    if (id === "7d") return [addDias(hoje, -6), hoje];
    if (id === "mes") return [hoje.slice(0, 7) + "-01", hoje];
    return [hoje, hoje];
  };
  // Período fica fixado entre visitas (sobrevive a abrir/fechar o cupom e a reloads).
  // Presets relativos (ontem/7d/mês) são recalculados pra hoje; "custom" restaura as datas salvas.
  const salvoPeriodo = (() => { try { return JSON.parse(localStorage.getItem("comandas_rel_periodo") || "null") as { preset?: string; de?: string; ate?: string } | null; } catch { return null; } })();
  const presetIni = salvoPeriodo?.preset || "hoje";
  const [deIni, ateIni] = presetIni === "custom" ? [salvoPeriodo?.de || hoje, salvoPeriodo?.ate || hoje] : rangeFor(presetIni);
  const [preset, setPreset] = useState(presetIni);
  const [de, setDe] = useState(deIni);
  const [ate, setAte] = useState(ateIni);
  const [ordemVendas, setOrdemVendas] = useState<"recentes" | "maior" | "menor">("recentes");
  const [ordemProd, setOrdemProd] = useState<"valor" | "qtd">("valor");
  const [horaSel, setHoraSel] = useState<number | null>(null);   // barra clicada no gráfico de horário
  const PRESETS = [{ id: "hoje", label: "Hoje" }, { id: "ontem", label: "Ontem" }, { id: "7d", label: "7 dias" }, { id: "mes", label: "Este mês" }, { id: "custom", label: "Período" }];
  function aplicar(id: string) {
    setPreset(id);
    if (id !== "custom") { const [a, b] = rangeFor(id); setDe(a); setAte(b); }
    // custom: mantém o intervalo atual e libera os inputs
  }
  // Persiste o período escolhido pra ele ficar fixado.
  useEffect(() => { try { localStorage.setItem("comandas_rel_periodo", JSON.stringify({ preset, de, ate })); } catch { /* ignore */ } }, [preset, de, ate]);
  // Normaliza (de ≤ ate) pra comparação por string YYYY-MM-DD.
  const [d0, d1] = de <= ate ? [de, ate] : [ate, de];
  // Dia da venda no fuso LOCAL (BRT), não UTC — senão venda da noite de ontem
  // (ex.: 21h BRT = 00h UTC) cai no dia seguinte.
  const diaDe = (c: Comanda) => { const s = c.fechadoEm || c.criadoEm; return s ? ymd(new Date(s)) : ""; };
  const noPeriodo = comandas.filter((c) => { const d = diaDe(c); return d >= d0 && d <= d1; });
  const umDia = d0 === d1;
  const incluiHoje = d1 === hoje;

  const abertas = noPeriodo.filter((c) => c.status === "aberta");
  const fechadas = noPeriodo.filter((c) => c.status === "fechada");
  const emAberto = abertas.reduce((s, c) => s + (totalAPagarComanda(c) - (c.valorPago || 0)), 0);
  const recebido = noPeriodo.reduce((s, c) => s + (c.valorPago || 0), 0);
  const faturamento = noPeriodo.reduce((s, c) => s + totalAPagarComanda(c), 0);   // produtos + gorjeta
  const servico = noPeriodo.reduce((s, c) => s + gorjetaEfetiva(c), 0);           // só a gorjeta (serviço)
  const pessoas = noPeriodo.reduce((s, c) => s + (c.pessoas || 1), 0);
  const itensConsumidos = noPeriodo.reduce((s, c) => s + c.itens.reduce((a, i) => a + (i.porPeso ? 1 : i.qtd), 0), 0);
  const porForma = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of noPeriodo) for (const p of c.pagamentos || []) { const f = baseForma(p.forma); m.set(f, (m.get(f) || 0) + p.valor); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [comandas, d0, d1]); // eslint-disable-line react-hooks/exhaustive-deps
  // Quebra por data DENTRO do período (mais recente primeiro).
  const porData = useMemo(() => {
    const m = new Map<string, { fat: number; rec: number; n: number; pes: number }>();
    for (const c of noPeriodo) {
      const d = diaDe(c); if (!d) continue;
      const o = m.get(d) || { fat: 0, rec: 0, n: 0, pes: 0 };
      o.fat += c.total || 0; o.rec += c.valorPago || 0; o.n += 1; o.pes += c.pessoas || 1;
      m.set(d, o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [comandas, d0, d1]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticketMedio = noPeriodo.length ? faturamento / noPeriodo.length : 0;
  const ticketPessoa = pessoas ? faturamento / pessoas : 0;

  // Produtos mais vendidos no período (ordenável por valor OU quantidade).
  const maisVendidos = useMemo(() => {
    const m = new Map<string, { nome: string; qtd: number; total: number; porPeso: boolean }>();
    for (const c of noPeriodo) for (const it of c.itens) {
      const o = m.get(it.nome) || { nome: it.nome, qtd: 0, total: 0, porPeso: !!it.porPeso };
      o.qtd += it.qtd || 0; o.total += it.total || 0; m.set(it.nome, o);
    }
    return [...m.values()].sort((a, b) => ordemProd === "qtd" ? b.qtd - a.qtd : b.total - a.total);
  }, [comandas, d0, d1, ordemProd]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxProd = (ordemProd === "qtd" ? maisVendidos[0]?.qtd : maisVendidos[0]?.total) || 1;

  // Faturamento por categoria (cruza categoriaId do item com o catálogo).
  const porCategoria = useMemo(() => {
    const nomeCat = (id: string | null | undefined) => id ? (categorias.find((c) => c.id === id)?.nome || "Outros") : "Sem categoria";
    const m = new Map<string, { nome: string; total: number; qtd: number }>();
    for (const c of noPeriodo) for (const it of c.itens) {
      const nome = nomeCat(it.categoriaId);
      const o = m.get(nome) || { nome, total: 0, qtd: 0 };
      o.total += it.total || 0; o.qtd += it.qtd || 0; m.set(nome, o);
    }
    const arr = [...m.values()].sort((a, b) => b.total - a.total);
    const soma = arr.reduce((s, x) => s + x.total, 0) || 1;
    return arr.map((x) => ({ ...x, pct: x.total / soma }));
  }, [comandas, d0, d1, categorias]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxForma = porForma[0]?.[1] || 1;
  const somaForma = porForma.reduce((s, [, v]) => s + v, 0) || 1;

  // Lançamentos de produto por hora do dia (fuso local) — mostra os picos de venda.
  const porHora = useMemo(() => {
    const qtd = new Array(24).fill(0);   // nº de lançamentos (linhas de item)
    const val = new Array(24).fill(0);   // faturamento lançado na hora
    const cmd: Set<string>[] = Array.from({ length: 24 }, () => new Set<string>()); // comandas distintas c/ lançamento na hora
    for (const c of noPeriodo) for (const it of c.itens) {
      const s = it.criadoEm; if (!s) continue;
      const h = new Date(s).getHours();
      if (h < 0 || h > 23) continue;
      qtd[h] += 1; val[h] += it.total || 0; cmd[h].add(c.id);
    }
    const comAlgo = qtd.map((q, h) => ({ h, q, v: val[h], c: cmd[h].size })).filter((x) => x.q > 0);
    const hMin = comAlgo.length ? comAlgo[0].h : 0;
    const hMax = comAlgo.length ? comAlgo[comAlgo.length - 1].h : 0;
    const faixa: { h: number; q: number; v: number; c: number }[] = [];
    for (let h = hMin; h <= hMax; h++) faixa.push({ h, q: qtd[h], v: val[h], c: cmd[h].size });
    const maxQ = Math.max(1, ...faixa.map((x) => x.q));
    const pico = comAlgo.length ? comAlgo.reduce((a, b) => (b.q > a.q ? b : a)) : null;
    return { faixa, maxQ, pico, total: comAlgo.reduce((s, x) => s + x.q, 0) };
  }, [comandas, d0, d1]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lista de vendas ordenável.
  const vendasOrdenadas = useMemo(() => {
    const arr = [...noPeriodo];
    if (ordemVendas === "maior") arr.sort((a, b) => (b.total || 0) - (a.total || 0));
    else if (ordemVendas === "menor") arr.sort((a, b) => (a.total || 0) - (b.total || 0));
    else arr.sort((a, b) => (b.fechadoEm || b.criadoEm || "").localeCompare(a.fechadoEm || a.criadoEm || ""));
    return arr;
  }, [comandas, d0, d1, ordemVendas]); // eslint-disable-line react-hooks/exhaustive-deps

  const Card = ({ label, valor, tone, hint }: { label: string; valor: string; tone?: string; hint?: string }) => (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums leading-tight ${tone || "text-gray-900 dark:text-gray-100"}`}>{valor}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
  return (
    <div className="space-y-3">
      {/* Seletor de período: presets + intervalo */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => aplicar(p.id)} className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border ${preset === p.id ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{p.label}</button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <span className="text-gray-400">até</span>
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className="h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </div>
      )}
      <div className="flex items-center justify-center gap-2 text-[12px] text-gray-500">
        <span>{umDia ? brData(d0) : `${brData(d0)} — ${brData(d1)}`}</span>
        {incluiHoje && <span className="text-emerald-600 dark:text-emerald-400">● tempo real</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card label="Faturamento" valor={fmtR(faturamento)} tone="text-indigo-700 dark:text-indigo-300" hint={servico > 0 ? `inclui ${fmtR(servico)} serviço` : `${noPeriodo.length} comanda(s)`} />
        <Card label="Recebido" valor={fmtR(recebido)} tone="text-emerald-600 dark:text-emerald-300" hint={`${fechadas.length} paga(s)`} />
        <Card label="Em aberto" valor={fmtR(emAberto)} tone={emAberto > 0 ? "text-amber-600 dark:text-amber-300" : undefined} hint={`${abertas.length} aberta(s)`} />
        <Card label="Ticket médio" valor={fmtR(ticketMedio)} hint={`${fmtR(ticketPessoa)}/pessoa`} />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
        <span><b className="text-gray-800 dark:text-gray-100 tabular-nums">{pessoas}</b> pessoas</span>
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <span><b className="text-gray-800 dark:text-gray-100 tabular-nums">{itensConsumidos}</b> itens</span>
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <span><b className="text-gray-800 dark:text-gray-100 tabular-nums">{noPeriodo.length}</b> comandas</span>
      </div>
      {porForma.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Recebido por forma</div>
          <div className="space-y-2">
            {porForma.map(([f, v]) => (
              <div key={f}>
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200">{f}</span>
                  <span className="tabular-nums text-gray-400">{Math.round((v / somaForma) * 100)}%</span>
                  <span className="w-20 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-300">{fmtR(v)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-emerald-400 dark:bg-emerald-600 rounded-full" style={{ width: `${Math.max(3, (v / maxForma) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Mais vendidos no período — ordenável por valor ou quantidade */}
      {maisVendidos.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Mais vendidos</span>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button onClick={() => setOrdemProd("valor")} className={`px-2 h-6 rounded-md text-[11px] font-bold ${ordemProd === "valor" ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Valor</button>
              <button onClick={() => setOrdemProd("qtd")} className={`px-2 h-6 rounded-md text-[11px] font-bold ${ordemProd === "qtd" ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Qtd</button>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[48vh] overflow-y-auto">
            {maisVendidos.slice(0, 30).map((p, i) => {
              const metric = ordemProd === "qtd" ? p.qtd : p.total;
              const qtdTxt = p.porPeso ? `${fmtNum(p.qtd, 2)} kg` : `${p.qtd}x`;
              return (
              <div key={p.nome} className="px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="w-5 text-right tabular-nums text-gray-400 shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-100">{p.nome}</span>
                  {ordemProd === "qtd"
                    ? <><span className="tabular-nums text-[12px] text-gray-400 shrink-0">{fmtR(p.total)}</span><span className="w-16 text-right tabular-nums font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">{qtdTxt}</span></>
                    : <><span className="tabular-nums text-[12px] text-gray-400 shrink-0">{qtdTxt}</span><span className="w-20 text-right tabular-nums font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">{fmtR(p.total)}</span></>}
                </div>
                <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-indigo-400 dark:bg-indigo-600 rounded-full" style={{ width: `${Math.max(3, (metric / maxProd) * 100)}%` }} /></div>
              </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Faturamento por categoria */}
      {porCategoria.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Por categoria</div>
          <div className="space-y-2">
            {porCategoria.map((c) => (
              <div key={c.nome}>
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200">{c.nome}</span>
                  <span className="tabular-nums text-gray-400">{Math.round(c.pct * 100)}%</span>
                  <span className="w-20 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtR(c.total)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-emerald-400 dark:bg-emerald-600 rounded-full" style={{ width: `${Math.max(3, c.pct * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Horário de venda — lançamentos de produto por hora do dia (picos) */}
      {porHora.faixa.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Horário de venda</span>
            {porHora.pico && <span className="text-[11px] text-gray-500">pico <b className="text-indigo-600 dark:text-indigo-300 tabular-nums">{porHora.pico.h}h</b> · {porHora.pico.q} lanç. · {fmtR(porHora.pico.v)}</span>}
          </div>
          <div className="flex items-end gap-0.5 h-24">
            {porHora.faixa.map((x) => {
              const sel = horaSel === x.h;
              return (
                <button key={x.h} onClick={() => setHoraSel(sel ? null : x.h)} title={`${x.h}h — ${x.q} lançamento(s) · ${x.c} comanda(s) · ${fmtR(x.v)}`}
                  className={`flex-1 min-w-0 rounded-t transition-all ${sel ? "bg-indigo-600 ring-2 ring-indigo-400" : "bg-indigo-200 dark:bg-indigo-800 hover:bg-indigo-300 dark:hover:bg-indigo-700"}`}
                  style={{ height: `${Math.max(2, (x.q / porHora.maxQ) * 100)}%` }} />
              );
            })}
          </div>
          <div className="flex gap-0.5 mt-1">
            {porHora.faixa.map((x) => (
              <button key={x.h} onClick={() => setHoraSel(horaSel === x.h ? null : x.h)} className={`flex-1 min-w-0 text-center text-[9px] tabular-nums ${horaSel === x.h ? "text-indigo-600 dark:text-indigo-300 font-bold" : "text-gray-400"}`}>{x.h}</button>
            ))}
          </div>
          {(() => {
            const d = horaSel != null ? porHora.faixa.find((x) => x.h === horaSel) : null;
            if (d) return (
              <div className="mt-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 px-3 py-2 text-[12px] flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
                <b className="text-indigo-700 dark:text-indigo-300 tabular-nums">{d.h}h–{d.h + 1}h</b>
                <span className="text-gray-600 dark:text-gray-300"><b className="tabular-nums">{d.c}</b> comanda(s)</span>
                <span className="text-gray-600 dark:text-gray-300"><b className="tabular-nums">{d.q}</b> lançamento(s)</span>
                <span className="text-emerald-600 dark:text-emerald-300 font-semibold tabular-nums">{fmtR(d.v)}</span>
              </div>
            );
            return <div className="text-[10px] text-gray-400 text-center mt-1">toque numa barra pra ver a hora · {porHora.total} lançamentos no período</div>;
          })()}
        </div>
      )}
      {/* Lista de vendas (individuais) — clique abre o cupom p/ reimprimir/emitir NFC-e/reabrir */}
      {noPeriodo.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 shrink-0">Vendas{umDia ? "" : " no período"} <span className="text-gray-300 dark:text-gray-600">({noPeriodo.length})</span></span>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button onClick={() => setOrdemVendas("recentes")} className={`px-2 h-6 rounded-md text-[11px] font-bold ${ordemVendas === "recentes" ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Recentes</button>
              <button onClick={() => setOrdemVendas("maior")} className={`px-2 h-6 rounded-md text-[11px] font-bold ${ordemVendas === "maior" ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Maior</button>
              <button onClick={() => setOrdemVendas("menor")} className={`px-2 h-6 rounded-md text-[11px] font-bold ${ordemVendas === "menor" ? "bg-indigo-600 text-white" : "text-gray-500"}`}>Menor</button>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[52vh] overflow-y-auto">
            {vendasOrdenadas.map((c) => {
              const es = c.fechadoEm || c.criadoEm; const hora = es ? new Date(es).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
              const formas = [...new Set((c.pagamentos || []).map((p) => baseForma(p.forma)))].join(", ");
              const temNfce = !!c.nfce?.chave;
              const nfceCancelada = !!c.nfce?.canceladoEm;
              return (
                <button key={c.id} onClick={() => onAbrir?.(c.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">#{c.numero} · {c.clienteNome}</div>
                    <div className="text-[11px] text-gray-500 truncate">{hora ? hora + " · " : ""}{c.itens.length} item(ns){formas ? " · " + formas : ""}</div>
                  </div>
                  {c.status === "fechada"
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 shrink-0">paga</span>
                    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 shrink-0">aberta</span>}
                  {temNfce && (nfceCancelada
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 shrink-0">NFC-e cancelada</span>
                    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 shrink-0">NFC-e</span>)}
                  <span className="w-20 text-right tabular-nums text-[13px] font-semibold text-gray-900 dark:text-gray-100 shrink-0">{fmtR(totalAPagarComanda(c))}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Quebra por data (só quando o período tem mais de um dia com venda) */}
      {porData.length > 1 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Vendas por data</span>
            <span className="text-[12px] text-gray-500">{porData.length} dia(s) · <b className="text-gray-800 dark:text-gray-100 tabular-nums">{fmtR(faturamento)}</b></span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[40vh] overflow-y-auto">
            {porData.map(([d, o]) => (
              <button key={d} onClick={() => { setPreset("custom"); setDe(d); setAte(d); }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <span className="w-24 tabular-nums text-gray-600 dark:text-gray-300">{brData(d)}</span>
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

// ── Fiscal padrão (NFC-e) do restaurante ───────────────────────────────────
// Lucro Presumido: PIS/COFINS cumulativo e uniforme + CFOP/CST/alíquota de ICMS
// padrão. Configura 1x; no produto só varia o NCM. Colapsado por padrão.
function FiscalPadraoEditor({ rid, cfg }: { rid: string; cfg: ComandaFiscalConfig | null }) {
  const [aberto, setAberto] = useState(true);
  const [cfop, setCfop] = useState(""); const [origem, setOrigem] = useState("0");
  const [cstIcms, setCstIcms] = useState(""); const [aliqIcms, setAliqIcms] = useState("");
  const [cstPis, setCstPis] = useState("01"); const [aliqPis, setAliqPis] = useState("0,65");
  const [cstCofins, setCstCofins] = useState("01"); const [aliqCofins, setAliqCofins] = useState("3,00");
  const [emitRazao, setEmitRazao] = useState(""); const [emitCnpj, setEmitCnpj] = useState("");
  const [emitIe, setEmitIe] = useState(""); const [emitEndereco, setEmitEndereco] = useState("");
  const [salvando, setSalvando] = useState(false); const [okMsg, setOkMsg] = useState(false);
  const numBR = (s: string): number | null => { const n = parseFloat((s || "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
  // Carrega os valores existentes quando o cfg chega / muda.
  useEffect(() => {
    if (!cfg) return;
    setCfop(cfg.cfop || ""); setOrigem(cfg.origem || "0");
    setCstIcms(cfg.cstIcms || ""); setAliqIcms(cfg.aliqIcms != null ? String(cfg.aliqIcms).replace(".", ",") : "");
    setCstPis(cfg.cstPis || "01"); setAliqPis(cfg.aliqPis != null ? String(cfg.aliqPis).replace(".", ",") : "0,65");
    setCstCofins(cfg.cstCofins || "01"); setAliqCofins(cfg.aliqCofins != null ? String(cfg.aliqCofins).replace(".", ",") : "3,00");
    setEmitRazao(cfg.emitRazao || ""); setEmitCnpj(cfg.emitCnpj || ""); setEmitIe(cfg.emitIe || ""); setEmitEndereco(cfg.emitEndereco || "");
  }, [cfg]);
  async function salvar() {
    setSalvando(true);
    try {
      await salvarFiscalConfig(rid, {
        restaurantId: rid, regime: "normal",
        cfop: cfop.trim() || null, origem: origem.trim() || "0",
        cstIcms: cstIcms.trim() || null, aliqIcms: numBR(aliqIcms),
        cstPis: cstPis.trim() || "01", aliqPis: numBR(aliqPis),
        cstCofins: cstCofins.trim() || "01", aliqCofins: numBR(aliqCofins),
        emitRazao: emitRazao.trim() || null, emitCnpj: emitCnpj.trim() || null, emitIe: emitIe.trim() || null, emitEndereco: emitEndereco.trim() || null,
      });
      setOkMsg(true); setTimeout(() => setOkMsg(false), 2500);
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }
  const configurado = !!(cfg?.cfop && cfg?.cstIcms);
  const inp = "h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums w-full";
  return (
    <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <span className="inline-flex items-center gap-1.5"><Receipt size={15} /> Fiscal padrão (NFC-e){configurado ? <span className="text-emerald-600 text-[11px]">✓ configurado</span> : <span className="text-amber-600 text-[11px]">• pendente</span>}</span>
        <span className={`transition-transform ${aberto ? "rotate-90" : ""}`}>▶</span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Regime <b>Lucro Presumido</b>. Vale pra todos os produtos — no produto você só põe o NCM. Pegue os códigos da sua nota atual (Altec) ou com o contador.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-gray-400">CFOP padrão</label><input value={cfop} onChange={(e) => setCfop(e.target.value)} placeholder="5102" inputMode="numeric" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">Origem</label><input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="0 = nacional" inputMode="numeric" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">CST ICMS</label><input value={cstIcms} onChange={(e) => setCstIcms(e.target.value)} placeholder="00 / 60" inputMode="numeric" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">Alíq. ICMS %</label><input value={aliqIcms} onChange={(e) => setAliqIcms(e.target.value)} placeholder="ex.: 3,2" inputMode="decimal" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">CST PIS</label><input value={cstPis} onChange={(e) => setCstPis(e.target.value)} placeholder="01" inputMode="numeric" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">Alíq. PIS %</label><input value={aliqPis} onChange={(e) => setAliqPis(e.target.value)} placeholder="0,65" inputMode="decimal" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">CST COFINS</label><input value={cstCofins} onChange={(e) => setCstCofins(e.target.value)} placeholder="01" inputMode="numeric" className={inp} /></div>
            <div><label className="text-[10px] text-gray-400">Alíq. COFINS %</label><input value={aliqCofins} onChange={(e) => setAliqCofins(e.target.value)} placeholder="3,00" inputMode="decimal" className={inp} /></div>
          </div>
          <p className="text-[10px] text-gray-400">CST ICMS: <b>00</b> = tributado (precisa da alíquota); <b>60</b> = ICMS já retido por ST (sem alíquota). PIS/COFINS no Lucro Presumido = cumulativo (0,65% e 3%).</p>
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1 mt-1">Dados do emitente (cabeçalho do cupom fiscal)</div>
            <div className="space-y-2">
              <div><label className="text-[10px] text-gray-400">Razão social</label><input value={emitRazao} onChange={(e) => setEmitRazao(e.target.value)} placeholder="SOROROCA RESTAURANTE LTDA" className={inp} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] text-gray-400">CNPJ</label><input value={emitCnpj} onChange={(e) => setEmitCnpj(e.target.value)} placeholder="52.349.568/0001-16" inputMode="numeric" className={inp} /></div>
                <div><label className="text-[10px] text-gray-400">Inscrição Estadual</label><input value={emitIe} onChange={(e) => setEmitIe(e.target.value)} placeholder="IE" inputMode="numeric" className={inp} /></div>
              </div>
              <div><label className="text-[10px] text-gray-400">Endereço</label><input value={emitEndereco} onChange={(e) => setEmitEndereco(e.target.value)} placeholder="Rua, nº, bairro, cidade/UF" className={inp} /></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void salvar()} disabled={salvando} className="flex-1 h-10 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">{salvando ? "Salvando…" : "Salvar Fiscal padrão"}</button>
            {okMsg && <span className="text-[12px] text-emerald-600 font-semibold">salvo ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cadastro de produtos (aba Config › Produtos) ───────────────────────────
function ProdutosPanel({ rid, produtos, categorias, fiscalCfg }: { rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; fiscalCfg: ComandaFiscalConfig | null }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [preco, setPreco] = useState("");
  const [porPeso, setPorPeso] = useState(false);
  const [imprime, setImprime] = useState(false);     // vai pra impressora (cozinha/bar)
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [busca, setBusca] = useState("");
  // Fiscal por produto (o que VARIA): NCM sempre; CFOP/CST/alíquota só se diferir do padrão.
  const [ncm, setNcm] = useState(""); const [cfop, setCfop] = useState(""); const [origem, setOrigem] = useState(""); const [cst, setCst] = useState(""); const [aliqIcms, setAliqIcms] = useState("");
  const [verFiscal, setVerFiscal] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const precoNum = parseFloat((preco || "").replace(/\./g, "").replace(",", ".")) || 0;
  const catById = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  // Código automático: 2 díg da categoria (01, 02…) + 3 díg sequenciais do produto (001…).
  const gerarCodigo = (catId: string): string => {
    const cat = categorias.find((c) => c.id === catId);
    const catNum = cat?.codigo ?? (categorias.findIndex((c) => c.id === catId) + 1);
    if (!catNum || catNum < 1) return "";
    const naCat = produtos.filter((p) => (p.categoriaId || "") === catId);
    const maxSeq = naCat.reduce((m, p) => { const n = parseInt((p.codigo || "").slice(-3), 10); return Number.isFinite(n) && n > m ? n : m; }, 0);
    return String(catNum).padStart(2, "0") + String(maxSeq + 1).padStart(3, "0");
  };
  const escolherCategoria = (catId: string) => {
    setCategoriaId(catId);
    if (!editId && !codigo.trim() && catId) setCodigo(gerarCodigo(catId));   // preenche o código só p/ produto novo sem código
  };
  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter((p) => p.nome.toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q) || (p.categoria || "").toLowerCase().includes(q));
  }, [produtos, busca]);
  // Agrupa a lista por categoria, na ordem das categorias (sem categoria por último).
  const gruposPorCategoria = useMemo(() => {
    const porCat = new Map<string, ComandaProduto[]>();
    for (const p of listaFiltrada) { const k = p.categoriaId || ""; (porCat.get(k) || porCat.set(k, []).get(k)!).push(p); }
    const ord = [...categorias].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const grupos: { key: string; nome: string; itens: ComandaProduto[] }[] = [];
    for (const c of ord) { const itens = porCat.get(c.id); if (itens && itens.length) grupos.push({ key: c.id, nome: c.nome, itens }); }
    const semCat = porCat.get("");
    if (semCat && semCat.length) grupos.push({ key: "__sem__", nome: "Sem categoria", itens: semCat });
    return grupos;
  }, [listaFiltrada, categorias]);

  function limpar() { setEditId(null); setNome(""); setCodigo(""); setPreco(""); setPorPeso(false); setImprime(false); setCategoriaId(""); setNcm(""); setCfop(""); setOrigem(""); setCst(""); setAliqIcms(""); setVerFiscal(false); setAtivo(true); setModalAberto(false); }
  function novo() { limpar(); setModalAberto(true); }
  // Preenche o form a partir de um produto. editar = mesmo id; duplicar = novo id, código em branco.
  function preencher(p: ComandaProduto, comoEdicao: boolean) {
    setEditId(comoEdicao ? p.id : null);
    setNome(comoEdicao ? p.nome : `${p.nome} (cópia)`);
    setCodigo(comoEdicao ? (p.codigo || "") : "");   // duplicar: código gera sozinho
    setPreco(String(p.preco).replace(".", ","));
    setPorPeso(!!p.porPeso); setImprime(!!p.producao); setCategoriaId(p.categoriaId || "");
    setNcm(p.ncm || ""); setCfop(p.cfop || ""); setOrigem(p.origem || ""); setCst(p.cst || p.csosn || ""); setAliqIcms(p.aliqIcms != null ? String(p.aliqIcms).replace(".", ",") : "");
    setAtivo(comoEdicao ? (p.ativo !== false) : true);
    setVerFiscal(false); setModalAberto(true);
  }
  const editar = (p: ComandaProduto) => preencher(p, true);
  const duplicar = (p: ComandaProduto) => preencher(p, false);
  async function salvar() {
    if (!nome.trim() || precoNum <= 0) return;
    const cat = categoriaId ? catById.get(categoriaId) : undefined;
    const base = produtos.find((p) => p.id === editId);
    const codigoFinal = codigo.trim() || (!editId && categoriaId ? gerarCodigo(categoriaId) : "");
    await salvarProduto({
      id: editId || uid(), restaurantId: rid, nome: nome.trim(), codigo: codigoFinal || null,
      preco: precoNum, porPeso, producao: imprime,
      categoriaId: categoriaId || null, categoria: cat?.nome || null,
      unidade: porPeso ? "kg" : "un", ativo, ordem: base?.ordem ?? produtos.length,
      ncm: ncm.trim() || null, cfop: cfop.trim() || null, origem: origem.trim() || null,
      cst: cst.trim() || null, csosn: null,
      aliqIcms: aliqIcms.trim() ? (parseFloat(aliqIcms.replace(",", ".")) || null) : null,
    });
    limpar();
  }

  return (
    <div>
      {/* Busca + botão Novo */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" className="w-full h-11 pl-8 pr-8 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          {busca && <button onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
        </div>
        <button onClick={novo} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0"><Plus size={16} /> Novo</button>
      </div>

      {/* Lista agrupada por categoria */}
      {listaFiltrada.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">{produtos.length === 0 ? "Nenhum produto ainda. Toque em “Novo”." : "Nada encontrado."}</div>
      ) : gruposPorCategoria.map((g) => (
        <div key={g.key} className="mb-3">
          <div className="flex items-center gap-2 px-1 py-1.5 border-b-2 border-gray-200 dark:border-gray-700">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{g.nome}</span>
            <span className="text-[10px] text-gray-400">({g.itens.length})</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {g.itens.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-2.5">
                <button onClick={() => editar(p)} className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{p.codigo ? <span className="font-mono text-gray-400">#{p.codigo} </span> : ""}{p.nome} {!p.ativo && <span className="text-[10px] text-gray-400">(inativo)</span>}</div>
                  <div className="text-[11px] text-gray-500">{fmtR(p.preco)}{p.porPeso ? "/kg · peso" : ""}{p.producao ? " · imprime" : ""}</div>
                </button>
                <button onClick={() => void salvarProduto({ ...p, ativo: !p.ativo })} className="text-[11px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shrink-0">{p.ativo ? "Inativar" : "Ativar"}</button>
                <button onClick={() => duplicar(p)} title="Duplicar para novo" className="text-gray-300 hover:text-indigo-500 shrink-0"><Copy size={16} /></button>
                <button onClick={() => { if (confirm(`Excluir "${p.nome}"?`)) void excluirProduto(p.id); }} className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Modal de cadastro/edição */}
      {modalAberto && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={limpar}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Package size={16} className="text-indigo-500" /> {editId ? "Editar produto" : "Novo produto"}</div>
              <button onClick={limpar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Nome do produto" className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
              <div className="grid grid-cols-2 gap-2">
                <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="código (automático)" className="h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
                  <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={porPeso ? "preço/kg" : "preço"} className="w-full h-11 pl-8 pr-2 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                </div>
              </div>
              <select value={categoriaId} onChange={(e) => escolherCategoria(e.target.value)} className="w-full h-11 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">— sem categoria —</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{(c.codigo ? String(c.codigo).padStart(2, "0") + " · " : "") + c.nome}</option>)}
              </select>
              {!editId && <p className="text-[11px] text-gray-400">O código é gerado sozinho ao escolher a categoria (ex.: <b>01001</b>). Dá pra editar se quiser.</p>}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex items-center justify-center gap-1.5 h-10 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"><input type="checkbox" checked={porPeso} onChange={(e) => setPorPeso(e.target.checked)} className="accent-indigo-600" /> <Scale size={13} /> por peso (kg)</label>
                <label className="flex items-center justify-center gap-1.5 h-10 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"><input type="checkbox" checked={imprime} onChange={(e) => setImprime(e.target.checked)} className="accent-amber-600" /> <Printer size={13} /> imprime</label>
              </div>
              <label className={`flex items-center justify-between gap-1.5 h-10 px-3 rounded-lg border cursor-pointer text-sm ${ativo ? "border-gray-200 dark:border-gray-700" : "border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800"}`}>
                <span className="inline-flex items-center gap-1.5">{ativo ? <Check size={14} className="text-emerald-600" /> : <X size={14} className="text-rose-500" />} {ativo ? "Produto ativo" : "Produto inativo (não aparece no lançamento)"}</span>
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="accent-emerald-600" />
              </label>

              {/* Fiscal (NFC-e) por produto — só o NCM é obrigatório; o resto vem do Fiscal padrão */}
              <button type="button" onClick={() => setVerFiscal((v) => !v)} className="w-full flex items-center justify-between text-[12px] text-gray-500 dark:text-gray-400 px-1 py-1">
                <span>Fiscal (NFC-e){ncm ? " ✓" : ""}</span>
                <span className={`transition-transform ${verFiscal ? "rotate-90" : ""}`}>▶</span>
              </button>
              {verFiscal && (
                <div className="space-y-2 rounded-lg border border-gray-100 dark:border-gray-800 p-2">
                  <div>
                    <label className="text-[10px] text-gray-400">NCM do produto (obrigatório · copie da Altec)</label>
                    <input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="NCM (8 díg) — ex.: 21069090" inputMode="numeric" className="w-full h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                  </div>
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-gray-400 py-1">Override fiscal (só se este produto difere do padrão)</summary>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <input value={cfop} onChange={(e) => setCfop(e.target.value)} placeholder={`CFOP (padrão ${fiscalCfg?.cfop || "—"})`} inputMode="numeric" className="h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                      <input value={cst} onChange={(e) => setCst(e.target.value)} placeholder={`CST ICMS (padrão ${fiscalCfg?.cstIcms || "—"})`} inputMode="numeric" className="h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                      <input value={aliqIcms} onChange={(e) => setAliqIcms(e.target.value)} placeholder={`Alíq. ICMS % (padrão ${fiscalCfg?.aliqIcms ?? "—"})`} inputMode="decimal" className="h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                      <input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder={`Origem (padrão ${fiscalCfg?.origem || "0"})`} inputMode="numeric" className="h-10 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
                    </div>
                  </details>
                  {!fiscalCfg?.cstIcms && <p className="text-[10px] text-amber-600 dark:text-amber-400">⚠ Configure o <b>Fiscal padrão</b> (aba Fiscal) antes de emitir.</p>}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
              <button onClick={limpar} className="flex-1 h-11 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
              <button onClick={() => void salvar()} disabled={!nome.trim() || precoNum <= 0} className="flex-1 h-11 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">{editId ? "Salvar" : "Adicionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Categorias (aba Config › Categorias) ───────────────────────────────────
function CategoriasPanel({ rid, produtos, categorias }: { rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[] }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);
  function novo() { setEditId(null); setNome(""); setModalAberto(true); }
  function editar(c: ComandaCategoria) { setEditId(c.id); setNome(c.nome); setModalAberto(true); }
  function fechar() { setModalAberto(false); setEditId(null); setNome(""); }
  async function salvar() {
    const n = nome.trim(); if (!n) return;
    const dup = categorias.find((c) => c.nome.trim().toLowerCase() === n.toLowerCase() && c.id !== editId);
    if (dup) { alert("Já existe uma categoria com esse nome."); return; }
    setSaving(true);
    try {
      if (editId) {
        const base = categorias.find((c) => c.id === editId);
        await salvarCategoria({ ...(base as ComandaCategoria), nome: n });
      } else {
        const proxCodigo = Math.max(0, ...categorias.map((c) => c.codigo || 0), categorias.length) + 1;
        await salvarCategoria({ id: uid(), restaurantId: rid, nome: n, ordem: categorias.length, codigo: proxCodigo });
      }
      fechar();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSaving(false); }
  }
  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <button onClick={novo} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus size={16} /> Nova categoria</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {categorias.length === 0 ? <div className="text-sm text-gray-400 text-center py-8">Nenhuma categoria.<br />Toque em “Nova categoria” pra organizar os produtos.</div> : categorias.map((c) => (
          <div key={c.id} className="flex items-center gap-2 py-2.5">
            {c.codigo ? <span className="shrink-0 text-[11px] font-mono font-bold text-gray-400 w-6 text-center">{String(c.codigo).padStart(2, "0")}</span> : <Tag size={15} className="text-gray-400 shrink-0" />}
            <button onClick={() => editar(c)} className="flex-1 text-left text-[14px] text-gray-900 dark:text-gray-100 truncate">{c.nome}</button>
            <span className="text-[11px] text-gray-400 shrink-0">{produtos.filter((p) => p.categoriaId === c.id).length} prod.</span>
            <button onClick={() => { if (confirm(`Excluir categoria "${c.nome}"? Os produtos ficam sem categoria.`)) void excluirCategoria(c.id); }} className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      {modalAberto && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={fechar}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Tag size={16} className="text-indigo-500" /> {editId ? "Editar categoria" : "Nova categoria"}</div>
              <button onClick={fechar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }} autoFocus placeholder="ex.: Peixe fresco, Bar" className="w-full h-11 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <div className="flex gap-2 pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
              <button onClick={fechar} className="flex-1 h-11 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
              <button onClick={() => void salvar()} disabled={saving || !nome.trim()} className="flex-1 h-11 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">{editId ? "Salvar" : "Adicionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cadastros (menu único: Categorias · Produtos · Fiscal · Impressoras) ────
// ── Gorjeta (aba Cadastros › Gorjeta) ───────────────────────────────────────
// % + onde aplica (categoria inteira e/ou produtos avulsos). Salva no fiscalCfg.
function GorjetaEditor({ rid, cfg, categorias, produtos }: { rid: string; cfg: ComandaFiscalConfig | null; categorias: ComandaCategoria[]; produtos: ComandaProduto[] }) {
  const [ativa, setAtiva] = useState(false);
  const [pct, setPct] = useState("10");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [prods, setProds] = useState<Set<string>>(new Set());
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [salvo, setSalvo] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    setAtiva(!!cfg.gorjetaAtiva);
    setPct(cfg.gorjetaPercentual != null ? String(cfg.gorjetaPercentual).replace(".", ",") : "10");
    setCats(new Set(cfg.gorjetaCategoriaIds || []));
    setProds(new Set(cfg.gorjetaProdutoIds || []));
  }, [cfg]);
  const catsOrd = useMemo(() => [...categorias].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)), [categorias]);
  const prodsDaCat = (cid: string) => produtos.filter((p) => (p.categoriaId || "") === cid && p.ativo !== false);
  function toggleCat(cid: string) {
    const n = new Set(cats);
    if (n.has(cid)) n.delete(cid);
    else { n.add(cid); const np = new Set(prods); prodsDaCat(cid).forEach((p) => np.delete(p.id)); setProds(np); }
    setCats(n);
  }
  function toggleProd(pid: string) { const n = new Set(prods); if (n.has(pid)) n.delete(pid); else n.add(pid); setProds(n); }
  function toggleExp(cid: string) { const n = new Set(exp); if (n.has(cid)) n.delete(cid); else n.add(cid); setExp(n); }
  async function salvar() {
    setSaving(true);
    try {
      const p = parseFloat((pct || "").replace(",", ".")) || 0;
      await salvarFiscalConfig(rid, { ...(cfg || {}), restaurantId: rid, gorjetaAtiva: ativa, gorjetaPercentual: p, gorjetaCategoriaIds: [...cats], gorjetaProdutoIds: [...prods] });
      setSalvo(true); setTimeout(() => setSalvo(false), 2500);
    } finally { setSaving(false); }
  }
  const inp = "h-10 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900";
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 cursor-pointer">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Cobrar gorjeta (taxa de serviço)</span>
        <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} className="accent-indigo-600 w-5 h-5" />
      </label>
      {ativa && (<>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-gray-600 dark:text-gray-300">Percentual</label>
          <div className="relative">
            <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={`${inp} w-24 text-right pr-7 tabular-nums`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
          </div>
          <span className="text-[12px] text-gray-400">sugerido na conta</span>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">Aplica em</div>
          <p className="text-[12px] text-gray-400 mb-2">Marque a <b>categoria inteira</b> ou abra (▸) e escolha <b>produtos específicos</b>.</p>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {catsOrd.map((c) => {
              const ps = prodsDaCat(c.id);
              const catOn = cats.has(c.id);
              const nSel = ps.filter((p) => prods.has(p.id)).length;
              return (
                <div key={c.id}>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input type="checkbox" checked={catOn} onChange={() => toggleCat(c.id)} className="accent-indigo-600 w-4 h-4 shrink-0" />
                      <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">{c.nome}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">({ps.length})</span>
                      {catOn && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-300 shrink-0">categoria inteira</span>}
                      {!catOn && nSel > 0 && <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 shrink-0">{nSel} produto(s)</span>}
                    </label>
                    {!catOn && ps.length > 0 && <button onClick={() => toggleExp(c.id)} className="text-[13px] text-gray-400 px-1 shrink-0">{exp.has(c.id) ? "▾" : "▸"}</button>}
                  </div>
                  {!catOn && exp.has(c.id) && (
                    <div className="pl-9 pr-3 pb-2 space-y-0.5">
                      {ps.length === 0 ? <div className="text-[12px] text-gray-400 py-1">Nenhum produto.</div> : ps.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <input type="checkbox" checked={prods.has(p.id)} onChange={() => toggleProd(p.id)} className="accent-indigo-600 w-4 h-4 shrink-0" />
                          <span className="text-[12px] text-gray-700 dark:text-gray-200 truncate">{p.nome}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </>)}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={() => void salvar()} disabled={saving} className="h-10 px-5 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">Salvar</button>
        {salvo && <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">salvo ✓</span>}
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">A gorjeta é <b>sugerida</b> na conta; no fechamento o atendente confirma, pode <b>ajustar o valor ou remover</b>. Se paga, entra no total — e (quando a NFC-e estiver ligada) sai como item de <b>imposto zero</b>.</p>
    </div>
  );
}

function CadastrosPanel({ rid, produtos, categorias, estacoes, fiscalCfg, podeProdutos, podeEstacoes }: {
  rid: string; produtos: ComandaProduto[]; categorias: ComandaCategoria[]; estacoes: ComandaEstacao[]; fiscalCfg: ComandaFiscalConfig | null; podeProdutos: boolean; podeEstacoes: boolean;
}) {
  const subs = useMemo(() => {
    const a: { id: string; label: string }[] = [];
    if (podeProdutos) a.push({ id: "categorias", label: "Categorias" }, { id: "produtos", label: "Produtos" }, { id: "gorjeta", label: "Gorjeta" }, { id: "fiscal", label: "Fiscal" });
    if (podeEstacoes) a.push({ id: "impressoras", label: "Impressoras" });
    return a;
  }, [podeProdutos, podeEstacoes]);
  const [sub, setSub] = useState(subs[0]?.id || "produtos");
  const atual = subs.some((s) => s.id === sub) ? sub : (subs[0]?.id || "produtos");
  return (
    <div className="max-w-lg mx-auto">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
        {subs.map((s) => (
          <button key={s.id} onClick={() => setSub(s.id)} className={`shrink-0 px-3.5 h-9 rounded-full text-[13px] font-semibold border ${atual === s.id ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>{s.label}</button>
        ))}
      </div>
      {atual === "categorias" && <CategoriasPanel rid={rid} produtos={produtos} categorias={categorias} />}
      {atual === "produtos" && <ProdutosPanel rid={rid} produtos={produtos} categorias={categorias} fiscalCfg={fiscalCfg} />}
      {atual === "gorjeta" && <GorjetaEditor rid={rid} cfg={fiscalCfg} categorias={categorias} produtos={produtos} />}
      {atual === "fiscal" && <FiscalPadraoEditor rid={rid} cfg={fiscalCfg} />}
      {atual === "impressoras" && <EstacoesPanel rid={rid} estacoes={estacoes} categorias={categorias} />}
    </div>
  );
}
