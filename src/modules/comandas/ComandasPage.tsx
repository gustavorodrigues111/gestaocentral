// Módulo COMANDAS — PDV simplificado (peixaria Sororoca). Comanda eletrônica
// no celular/PC; ticket de produção impresso numa Epson TM-T20 pela ESTAÇÃO DE
// IMPRESSÃO (aba separada num PC logado). Sem fiscal: só comanda + conta.
//
// Dois fluxos: CONTA ABERTA (fica consumindo) × TO-GO (lança e fecha na hora).
// Produto pode ser por PESO (preço/kg, lança-se o peso) — balança Prix 4 depois.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Printer, Trash2, X, Scale, Package, Search, Check, Receipt, Minus, User } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import type { Comanda, ComandaItem, ComandaProduto, ComandaPagamento, ComandaPrintJob } from "../../core/types";
import {
  uid, ouvirProdutos, salvarProduto, excluirProduto,
  ouvirComandas, salvarComanda, criarPrintJob,
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
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [abrindo, setAbrindo] = useState<null | "conta" | "togo">(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);   // comandaId aberta no detalhe
  const [produtosOpen, setProdutosOpen] = useState(false);
  // Estação de impressão: abre por ?estacao=1 na URL (num PC com a Epson).
  const estacao = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("estacao") === "1";

  useEffect(() => { if (!rid) return; return ouvirProdutos(rid, setProdutos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirComandas(rid, setComandas); }, [rid]);

  const meNome = me?.nome || "—";
  const podeVer = can("comandas", "ver");
  const podeOperar = can("comandas", "operar");
  const podeConfig = can("comandas", "config");

  const abertas = useMemo(() => comandas.filter((c) => c.status === "aberta"), [comandas]);
  const comandaDet = useMemo(() => comandas.find((c) => c.id === detalhe) || null, [comandas, detalhe]);

  if (estacao) return <EstacaoImpressao rid={rid} nomeRest={activeRestaurant?.nome || ""} />;
  if (!podeVer) return <div className="text-center py-12 text-gray-500">Você não tem acesso a Comandas.</div>;

  async function abrirComanda(dados: { numero: string; clienteNome: string; cpf?: string; telefone?: string; modo: "conta" | "togo" }) {
    const c: Comanda = {
      id: uid(), restaurantId: rid, numero: dados.numero.trim(), clienteNome: dados.clienteNome.trim(),
      cpf: dados.cpf?.trim() || null, telefone: dados.telefone?.trim() || null,
      status: "aberta", modo: dados.modo, itens: [], total: 0, pagamentos: [], valorPago: 0,
      criadoEm: nowIso(), criadoPor: me?.id, criadoPorNome: meNome,
    };
    await salvarComanda(c);
    setAbrindo(null);
    setDetalhe(c.id);
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div>
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Receipt size={20} className="text-indigo-500" /> Comandas</h1>
          <p className="text-[12px] text-gray-500">Comanda eletrônica · peixaria {activeRestaurant?.nome || ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {podeConfig && <button onClick={() => setProdutosOpen(true)} className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5"><Package size={15} /> Produtos</button>}
          <a href={`?estacao=1`} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5" title="Abrir a estação de impressão (num PC com a Epson)"><Printer size={15} /> Estação</a>
        </div>
      </div>

      {podeOperar && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setAbrindo("conta")} className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 py-3 font-semibold inline-flex items-center justify-center gap-1.5"><Plus size={18} /> Abrir comanda (conta)</button>
          <button onClick={() => setAbrindo("togo")} className="rounded-2xl border-2 border-dashed border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 py-3 font-semibold inline-flex items-center justify-center gap-1.5"><Package size={18} /> Venda rápida (to-go)</button>
        </div>
      )}

      {abertas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-400">
          <Receipt size={38} className="mx-auto mb-2 text-gray-300" />
          <div className="font-semibold text-gray-600 dark:text-gray-300">Nenhuma comanda aberta</div>
          <div className="text-sm mt-1">Abra uma comanda pra começar a lançar.</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {abertas.map((c) => (
            <button key={c.id} onClick={() => setDetalhe(c.id)} className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">#{c.numero}</span>
                {c.modo === "togo" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">to-go</span>}
              </div>
              <div className="font-bold text-gray-900 dark:text-gray-100 truncate mt-1.5">{c.clienteNome || "—"}</div>
              <div className="text-[12px] text-gray-500">{c.itens.length} item(ns)</div>
              <div className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums mt-0.5">{fmtR(c.total)}</div>
            </button>
          ))}
        </div>
      )}

      {abrindo && <AbrirComandaModal modo={abrindo} onClose={() => setAbrindo(null)} onAbrir={abrirComanda} />}
      {comandaDet && (
        <ComandaDetalhe
          comanda={comandaDet} produtos={produtos.filter((p) => p.ativo)} podeOperar={podeOperar}
          meNome={meNome} nomeRest={activeRestaurant?.nome || ""} rid={rid}
          onClose={() => setDetalhe(null)}
        />
      )}
      {produtosOpen && <ProdutosModal rid={rid} produtos={produtos} onClose={() => setProdutosOpen(false)} />}
    </PageContainer>
  );
}

// ── Abrir comanda ────────────────────────────────────────────────────────
function AbrirComandaModal({ modo, onClose, onAbrir }: {
  modo: "conta" | "togo";
  onClose: () => void;
  onAbrir: (d: { numero: string; clienteNome: string; cpf?: string; telefone?: string; modo: "conta" | "togo" }) => Promise<void>;
}) {
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [tel, setTel] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function salvar() {
    if (!nome.trim()) { setErr("Nome do cliente é obrigatório."); return; }
    if (modo === "conta" && !numero.trim()) { setErr("Nº da pulseira é obrigatório na conta aberta."); return; }
    setErr(""); setSaving(true);
    try { await onAbrir({ numero: numero.trim() || "—", clienteNome: nome, cpf, telefone: tel, modo }); }
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">CPF</label>
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="opcional" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Telefone</label>
              <input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="opcional" className="w-full h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
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
function ComandaDetalhe({ comanda, produtos, podeOperar, meNome, nomeRest, rid, onClose }: {
  comanda: Comanda; produtos: ComandaProduto[]; podeOperar: boolean; meNome: string; nomeRest: string; rid: string;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [pesoDe, setPesoDe] = useState<ComandaProduto | null>(null);   // produto por peso aguardando o peso
  const [fechar, setFechar] = useState(false);
  const [salvandoImpr, setSalvandoImpr] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter((p) => !q || p.nome.toLowerCase().includes(q));
  }, [produtos, busca]);

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
        <div ref={scrollRef} className="sm:w-[44%] sm:border-r border-gray-100 dark:border-gray-800 overflow-y-auto p-3 space-y-1.5 order-2 sm:order-1 max-h-[38vh] sm:max-h-none">
          {comanda.itens.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">Toque num produto pra lançar.</div>
          ) : comanda.itens.map((i) => (
            <div key={i.id} className="flex items-center gap-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{i.nome}{i.producao && <span className="text-[10px] text-amber-600 ml-1">{i.impressoEm ? "✓ cozinha" : "· cozinha"}</span>}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{i.porPeso ? `${fmtNum(i.qtd, 3)} kg × ${fmtR(i.precoUnit)}/kg` : `${i.qtd} × ${fmtR(i.precoUnit)}`}</div>
              </div>
              {!i.porPeso && podeOperar && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => void mudarQtd(i.id, -1)} className="w-6 h-6 rounded grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Minus size={13} /></button>
                  <button onClick={() => void mudarQtd(i.id, +1)} className="w-6 h-6 rounded grid place-items-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Plus size={13} /></button>
                </div>
              )}
              <div className="text-[13px] font-semibold tabular-nums shrink-0 w-[70px] text-right">{fmtR(i.total)}</div>
              {podeOperar && <button onClick={() => void removerItem(i.id)} className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>

        {/* Grade de produtos */}
        <div className="flex-1 min-h-0 flex flex-col order-1 sm:order-2">
          <div className="p-2 border-b border-gray-100 dark:border-gray-800">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" className="w-full h-9 pl-8 pr-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filtrados.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">Nenhum produto. Cadastre em “Produtos”.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {filtrados.map((p) => (
                  <button key={p.id} disabled={!podeOperar} onClick={() => tapProduto(p)}
                    className="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 disabled:opacity-50">
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">{p.nome}</div>
                    <div className="text-[12px] text-indigo-700 dark:text-indigo-300 font-bold tabular-nums mt-1">{fmtR(p.preco)}{p.porPeso ? "/kg" : ""}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {p.porPeso && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><Scale size={10} /> peso</span>}
                      {p.producao && <span className="text-[10px] text-amber-500">cozinha</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ações */}
      {podeOperar && (
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 p-2.5 flex items-center gap-2">
          <button onClick={() => void imprimirProducao()} disabled={!pendentesProducao.length || salvandoImpr}
            className="flex-1 h-11 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Printer size={17} /> Produção{pendentesProducao.length ? ` (${pendentesProducao.length})` : ""}
          </button>
          <button onClick={() => setFechar(true)} className="flex-1 h-11 rounded-xl bg-indigo-600 text-white font-bold inline-flex items-center justify-center gap-1.5">
            <Check size={18} /> Fechar · {fmtR(comanda.total)}
          </button>
        </div>
      )}

      {pesoDe && <PesoModal produto={pesoDe} onClose={() => setPesoDe(null)} onConfirmar={(kg) => { void addItem(pesoDe, kg); setPesoDe(null); }} />}
      {fechar && <FecharModal comanda={comanda} meNome={meNome} nomeRest={nomeRest} rid={rid} onClose={() => setFechar(false)} onFechado={() => { setFechar(false); onClose(); }} />}
    </div>
  );
}

// ── Peso (produto por kg) ─────────────────────────────────────────────────
function PesoModal({ produto, onClose, onConfirmar }: { produto: ComandaProduto; onClose: () => void; onConfirmar: (kg: number) => void }) {
  const [txt, setTxt] = useState("");
  const kg = parseFloat((txt || "").replace(",", ".")) || 0;
  const total = +(kg * (produto.preco || 0)).toFixed(2);
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xs p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Scale size={16} className="text-indigo-500" /> Peso</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">{produto.nome} · {fmtR(produto.preco)}/kg</div>
        <div className="relative mt-2">
          <input value={txt} onChange={(e) => setTxt(e.target.value)} autoFocus inputMode="decimal" placeholder="0,000" className="w-full h-12 pr-10 pl-3 text-right text-lg rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">kg</span>
        </div>
        <div className="text-right text-sm font-semibold mt-1.5 tabular-nums">Total: {fmtR(total)}</div>
        <button onClick={() => kg > 0 && onConfirmar(kg)} disabled={kg <= 0} className="w-full h-11 mt-3 rounded-xl bg-indigo-600 text-white font-bold disabled:opacity-40">Lançar</button>
      </div>
    </div>
  );
}

// ── Fechar / pagar ─────────────────────────────────────────────────────────
function FecharModal({ comanda, meNome, nomeRest, rid, onClose, onFechado }: {
  comanda: Comanda; meNome: string; nomeRest: string; rid: string; onClose: () => void; onFechado: () => void;
}) {
  const saldo = +(comanda.total - comanda.valorPago).toFixed(2);
  const [forma, setForma] = useState(FORMAS[0]);
  const [valorTxt, setValorTxt] = useState(saldo > 0 ? saldo.toFixed(2).replace(".", ",") : "");
  const [imprimirConta, setImprimirConta] = useState(true);
  const [saving, setSaving] = useState(false);
  const valor = parseFloat((valorTxt || "").replace(/\./g, "").replace(",", ".")) || 0;

  async function confirmar() {
    setSaving(true);
    try {
      const pags: ComandaPagamento[] = valor > 0
        ? [...comanda.pagamentos, { forma, valor, em: new Date().toISOString(), porNome: meNome }]
        : comanda.pagamentos;
      const valorPago = +pags.reduce((s, p) => s + p.valor, 0).toFixed(2);
      const quitou = valorPago >= comanda.total - 0.001;
      const atualizada: Comanda = {
        ...comanda, pagamentos: pags, valorPago,
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
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 p-3 mb-3 flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-300">Total</span>
          <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR(comanda.total)}</span>
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
        <div className="flex justify-end gap-2 pt-3 mt-1 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
          <button onClick={() => void confirmar()} disabled={saving} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold">{saving ? "..." : (valor >= saldo ? "Pagar e fechar" : "Registrar pagamento")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Cadastro de produtos ───────────────────────────────────────────────────
function ProdutosModal({ rid, produtos, onClose }: { rid: string; produtos: ComandaProduto[]; onClose: () => void }) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const [porPeso, setPorPeso] = useState(false);
  const [producao, setProducao] = useState(false);
  const precoNum = parseFloat((preco || "").replace(/\./g, "").replace(",", ".")) || 0;
  async function add() {
    if (!nome.trim() || precoNum <= 0) return;
    await salvarProduto({ id: uid(), restaurantId: rid, nome: nome.trim(), preco: precoNum, porPeso, producao, unidade: porPeso ? "kg" : "un", ativo: true, ordem: produtos.length });
    setNome(""); setPreco(""); setPorPeso(false); setProducao(false);
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-4 shadow-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Package size={16} className="text-indigo-500" /> Produtos</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-2 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do produto" className="h-10 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
              <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={porPeso ? "preço/kg" : "preço"} className="w-full h-10 pl-7 pr-1 text-right text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 tabular-nums" />
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={porPeso} onChange={(e) => setPorPeso(e.target.checked)} className="accent-indigo-600" /> <Scale size={13} /> por peso (kg)</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={producao} onChange={(e) => setProducao(e.target.checked)} className="accent-amber-600" /> vai pra cozinha</label>
            <button onClick={() => void add()} disabled={!nome.trim() || precoNum <= 0} className="ml-auto h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">+ Add</button>
          </div>
        </div>
        <div className="overflow-y-auto mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {produtos.length === 0 ? <div className="text-sm text-gray-400 text-center py-6">Nenhum produto ainda.</div> : produtos.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome} {!p.ativo && <span className="text-[10px] text-gray-400">(inativo)</span>}</div>
                <div className="text-[11px] text-gray-500">{fmtR(p.preco)}{p.porPeso ? "/kg · peso" : ""}{p.producao ? " · cozinha" : ""}</div>
              </div>
              <button onClick={() => void salvarProduto({ ...p, ativo: !p.ativo })} className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700">{p.ativo ? "Inativar" : "Ativar"}</button>
              <button onClick={() => { if (confirm(`Excluir "${p.nome}"?`)) void excluirProduto(p.id); }} className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
