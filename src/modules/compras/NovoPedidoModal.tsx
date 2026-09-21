// ════════════════════════════════════════════════════════════════════════════
//  Novo pedido — assistente único pra gerar pedido de compra.
//  Origem: A PARTIR DE UMA CONTAGEM (lista as sessões que ainda não viraram pedido;
//  some quando vira) OU AVULSO (sem contagem: por fornecedor ou por categoria,
//  todos ou selecionar). Depois abre o builder por fornecedor (3 colunas contagem/
//  mínimo/sugestão editável + Montar com IA), e gera 1 pedido por fornecedor.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { Building2, Smartphone, ClipboardList, TriangleAlert, ChevronDown, ChevronRight, Sparkles, RotateCcw, Loader2, ClipboardCheck, PencilLine, ArrowLeft, Tag, Check, CalendarDays } from "lucide-react";
import { addDoc, collection } from "firebase/firestore";
import { db, auth } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo, Pedido, PedidoItem } from "../../core/types";
import { montarSugestao, type LinhaSugestao, type GrupoFornecedor } from "./sugestao";

type Props = {
  rid: string;
  insumos: Insumo[];
  fornecedores: Fornecedor[];
  contagens: Contagem[];
  pedidos: Pedido[];
  onClose: () => void;
  onCreated?: () => void;
};

const undLabel = (i: Insumo) => i.unidade === "outro" ? (i.unidadeOutroLabel || "?") : (UNIDADES_LABEL[i.unidade]?.slice(0, 3) ?? String(i.unidade || "?").slice(0, 3));
const fmtR$ = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function NovoPedidoModal({ rid, insumos, fornecedores, contagens, pedidos, onClose, onCreated }: Props) {
  const { pessoa: me } = useAuth();
  const [step, setStep] = useState<"origem" | "contagem" | "avulso" | "builder">("origem");
  const [origem, setOrigem] = useState<"contagem" | "avulso" | null>(null);
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [modo, setModo] = useState<"fornecedor" | "categoria">("fornecedor");
  const [escopoTodos, setEscopoTodos] = useState(true);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // builder
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [incluir, setIncluir] = useState<Record<string, boolean>>({});
  const [okAberto, setOkAberto] = useState<Record<string, boolean>>({});
  const [savingFornId, setSavingFornId] = useState<string | null>(null);
  const [criados, setCriados] = useState<string[]>([]);   // fornecedorIds já gerados nesta sessão
  // IA (só na origem contagem)
  const [iaMap, setIaMap] = useState<Record<string, number> | null>(null);
  const [iaResumo, setIaResumo] = useState<Record<string, string>>({});
  const [montando, setMontando] = useState(false);
  const [iaErr, setIaErr] = useState("");

  // ── Sessões de contagem que ainda NÃO viraram pedido ─────────────────────────
  const sessoesConsumidas = useMemo(() => new Set(pedidos.map(p => p.origemContagemSessaoId).filter(Boolean) as string[]), [pedidos]);
  const sessoes = useMemo(() => {
    const m = new Map<string, { sessaoId: string; data: string; turno?: string; nome?: string; registradoEm: string; itens: number }>();
    for (const c of contagens) {
      if (!c.sessaoId || sessoesConsumidas.has(c.sessaoId)) continue;
      const cur = m.get(c.sessaoId);
      if (cur) { cur.itens++; if (c.registradoEm > cur.registradoEm) cur.registradoEm = c.registradoEm; }
      else m.set(c.sessaoId, { sessaoId: c.sessaoId, data: c.data, turno: c.turno, nome: c.registradoNome, registradoEm: c.registradoEm, itens: 1 });
    }
    return [...m.values()].sort((a, b) => b.registradoEm.localeCompare(a.registradoEm));
  }, [contagens, sessoesConsumidas]);

  const categoriasExistentes = useMemo(() => [...new Set(insumos.filter(i => i.ativo).map(i => i.categoria || "(sem categoria)"))].sort((a, b) => a.localeCompare(b, "pt-BR")), [insumos]);

  // Mapa de contagem da sessão escolhida (ou vazio no avulso).
  const contagemMap = useMemo(() => {
    if (origem !== "contagem" || !sessaoId) return {} as Record<string, Contagem>;
    const m: Record<string, Contagem> = {};
    for (const c of contagens) if (c.sessaoId === sessaoId && !m[c.insumoId]) m[c.insumoId] = c;
    return m;
  }, [origem, sessaoId, contagens]);

  // Grupos por fornecedor, filtrados pelo escopo.
  const grupos = useMemo(() => {
    let base = insumos;
    if (origem === "avulso" && modo === "categoria" && !escopoTodos) base = insumos.filter(i => selecionados.has(i.categoria || "(sem categoria)"));
    let gs = montarSugestao(base, contagemMap, fornecedores).filter(g => g.fornecedorId !== null);
    if (origem === "avulso" && modo === "fornecedor" && !escopoTodos) gs = gs.filter(g => g.fornecedorId && selecionados.has(g.fornecedorId));
    return gs.filter(g => !criados.includes(g.fornecedorId!));
  }, [insumos, origem, modo, escopoTodos, selecionados, contagemMap, fornecedores, criados]);

  // ── Builder helpers ──────────────────────────────────────────────────────────
  const baseQtd = (l: LinhaSugestao): number => (iaMap && iaMap[l.insumo.id] != null ? iaMap[l.insumo.id] : l.qtdSugerida);
  const baseIncluido = (l: LinhaSugestao): boolean => (iaMap && iaMap[l.insumo.id] != null ? iaMap[l.insumo.id] > 0 : l.precisaPedido);
  const qtd = (l: LinhaSugestao): number => { const v = ajustes[l.insumo.id]; if (v == null || v === "") return baseQtd(l); const n = parseFloat(v.replace(",", ".")); return isNaN(n) ? baseQtd(l) : n; };
  const isIncluido = (l: LinhaSugestao): boolean => incluir[l.insumo.id] ?? baseIncluido(l);
  const totalLinha = (l: LinhaSugestao): number => (l.precoUnit || 0) * qtd(l);
  const totalGrupo = (g: GrupoFornecedor): number => [...g.precisam, ...g.ok].filter(isIncluido).reduce((s, l) => s + totalLinha(l), 0);
  const itensIncluidos = (g: GrupoFornecedor): LinhaSugestao[] => [...g.precisam, ...g.ok].filter(l => isIncluido(l) && qtd(l) > 0);
  const qtdInicialOk = (l: LinhaSugestao): number => l.fator > 1 ? l.fator : (l.minPedido > 0 ? l.minPedido : 1);
  function restaurar(g: GrupoFornecedor) {
    const ids = [...g.precisam, ...g.ok].map(l => l.insumo.id);
    setAjustes(s => { const n = { ...s }; for (const id of ids) delete n[id]; return n; });
    setIncluir(s => { const n = { ...s }; for (const id of ids) delete n[id]; return n; });
  }

  async function montarComIA() {
    if (!me) return;
    setMontando(true); setIaErr("");
    try {
      const payload = grupos.map(g => ({
        fornecedorId: g.fornecedorId, fornecedorNome: g.fornecedor?.nome || "", pedidoMinimoValor: g.pedidoMinimoValor,
        itens: [...g.precisam, ...g.ok].map(l => ({ insumoId: l.insumo.id, nome: l.insumo.nome, unidade: l.insumo.unidade, contagem: l.contagem, minStock: l.minStock, fator: l.fator, minPedido: l.minPedido, precoUnit: l.precoUnit, precisaPedido: l.precisaPedido, sugestaoRegra: l.qtdSugerida })),
      }));
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/compras-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, grupos: payload }) });
      const j = await r.json().catch(() => ({})) as { grupos?: { fornecedorId: string; resumo?: string; itens?: { insumoId: string; qtd: number }[] }[]; error?: string };
      if (!r.ok) { setIaErr(j.error || "Falha na IA."); return; }
      const qmap: Record<string, number> = {}; const rmap: Record<string, string> = {};
      for (const g of j.grupos || []) { if (g.resumo) rmap[g.fornecedorId] = g.resumo; for (const it of g.itens || []) if (it?.insumoId != null) qmap[it.insumoId] = it.qtd; }
      setIaMap(qmap); setIaResumo(rmap); setAjustes({}); setIncluir({});
    } catch (e) { setIaErr(e instanceof Error ? e.message : "Erro na IA"); }
    finally { setMontando(false); }
  }

  async function gerarPedido(g: GrupoFornecedor) {
    if (!me || !g.fornecedor) return;
    const inclui = itensIncluidos(g);
    if (!inclui.length) { alert("Nenhum item selecionado."); return; }
    setSavingFornId(g.fornecedorId!);
    try {
      const itens: PedidoItem[] = inclui.map(l => ({
        insumoId: l.insumo.id, insumoNomeSnapshot: l.insumo.nome, unidadeSnapshot: l.insumo.unidade,
        qtdPedida: qtd(l), qtdRecebida: null, precoUnit: l.precoUnit,
        qtdSugeridaIA: baseQtd(l), contagemSnapshot: l.temContagem ? l.contagem : null,
        minStockSnapshot: l.minStock || null, fatorCompraSnapshot: l.fator > 1 ? l.fator : null,
        precisaPedido: l.precisaPedido, incluido: true,
      }));
      const totalEstimado = itens.reduce((s, it) => s + ((it.precoUnit || 0) * it.qtdPedida), 0);
      const now = new Date().toISOString();
      const pedido: Omit<Pedido, "id"> = {
        restaurantId: rid, fornecedorId: g.fornecedor.id, fornecedorNomeSnapshot: g.fornecedor.nome,
        fornecedorWhatsappSnapshot: g.fornecedor.whatsapp, itens,
        totalEstimado: totalEstimado > 0 ? totalEstimado : undefined, status: "rascunho",
        iaEspelho: itens.map(it => ({ ...it })), geradoPorIA: !!iaMap,
        origemContagemSessaoId: origem === "contagem" && sessaoId ? sessaoId : undefined,
        iaResumo: iaResumo[g.fornecedorId!] || undefined,
        criadoEm: now, criadoPor: me.id, atualizadoEm: now,
      };
      await addDoc(collection(db, "pedidos"), sanitizeForFirestore(pedido));
      setCriados(c => [...c, g.fornecedorId!]);
      onCreated?.();
    } catch (e) { alert(e instanceof Error ? e.message : "Erro ao criar pedido"); }
    finally { setSavingFornId(null); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const toggleSel = (id: string) => setSelecionados(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const podeAvancarAvulso = escopoTodos || selecionados.size > 0;

  const largo = step === "builder";
  return (
    <Modal title={<span className="inline-flex items-center gap-2"><ClipboardList size={18} /> Novo pedido</span>} onClose={onClose} maxWidth={largo ? "max-w-3xl" : "max-w-xl"}>
      {/* STEP ORIGEM */}
      {step === "origem" && (
        <div className="min-h-[320px] flex flex-col justify-center space-y-4 py-2">
          <div className="text-center">
            <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">De onde vem esse pedido?</p>
            <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">Escolha o ponto de partida</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => { setOrigem("contagem"); setStep("contagem"); }}
              className="group relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-sm p-4 text-left transition-all">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 inline-flex items-center justify-center mb-2.5"><ClipboardCheck size={20} /></div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">A partir de uma contagem</div>
              <p className="text-[12px] text-gray-500 mt-1 leading-snug">Sugere quanto pedir a partir de uma contagem feita (contagem × estoque mínimo).</p>
              <div className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${sessoes.length > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-100 text-gray-400 dark:bg-gray-800"}`}>
                {sessoes.length > 0 ? `${sessoes.length} contagem${sessoes.length > 1 ? "s" : ""} pendente${sessoes.length > 1 ? "s" : ""}` : "nenhuma pendente"}
              </div>
              <ChevronRight size={16} className="absolute top-4 right-4 text-gray-300 group-hover:text-indigo-400" />
            </button>
            <button type="button" onClick={() => { setOrigem("avulso"); setStep("avulso"); }}
              className="group relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-sm p-4 text-left transition-all">
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 inline-flex items-center justify-center mb-2.5"><PencilLine size={20} /></div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">Avulso (sem contagem)</div>
              <p className="text-[12px] text-gray-500 mt-1 leading-snug">Monta o pedido do zero, escolhendo por fornecedor ou por categoria.</p>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">{fornecedores.filter(f => f.ativo).length} fornecedores</div>
              <ChevronRight size={16} className="absolute top-4 right-4 text-gray-300 group-hover:text-indigo-400" />
            </button>
          </div>
        </div>
      )}

      {/* STEP CONTAGEM — escolher a sessão */}
      {step === "contagem" && (
        <div className="space-y-3">
          <button type="button" onClick={() => setStep("origem")} className="text-[12px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><ArrowLeft size={13} /> voltar</button>
          <p className="text-sm text-gray-600 dark:text-gray-400">Escolha a contagem. As que já viraram pedido não aparecem.</p>
          {sessoes.length === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center">Nenhuma contagem pendente. Lance uma contagem no módulo Contagens, ou faça um pedido avulso.</div>
          ) : (
            <div className="space-y-1.5">
              {sessoes.map(s => (
                <button key={s.sessaoId} type="button" onClick={() => { setSessaoId(s.sessaoId); setIaMap(null); setIaResumo({}); setAjustes({}); setIncluir({}); setStep("builder"); }}
                  className="group w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2.5 hover:border-indigo-400 hover:shadow-sm transition-all flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 inline-flex items-center justify-center shrink-0"><CalendarDays size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <strong className="text-gray-900 dark:text-gray-100">{new Date(s.data + "T12:00:00").toLocaleDateString("pt-BR")}</strong>
                      {s.turno && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded px-1.5 py-0.5">{s.turno}</span>}
                    </div>
                    {s.nome && <div className="text-[11px] text-gray-500 truncate">por {s.nome}</div>}
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">{s.itens} {s.itens === 1 ? "item" : "itens"}</span>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-indigo-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP AVULSO — modo + escopo */}
      {step === "avulso" && (() => {
        const opcoes = modo === "fornecedor" ? fornecedores.filter(f => f.ativo).map(f => ({ id: f.id, nome: f.nome })) : categoriasExistentes.map(c => ({ id: c, nome: c }));
        return (
        <div className="space-y-4">
          <button type="button" onClick={() => setStep("origem")} className="text-[12px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><ArrowLeft size={13} /> voltar</button>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1.5">Organizar por</div>
            <div className="flex w-full rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-1">
              {(["fornecedor", "categoria"] as const).map(mo => (
                <button key={mo} type="button" onClick={() => { setModo(mo); setSelecionados(new Set()); }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors ${modo === mo ? "bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-300 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
                  {mo === "fornecedor" ? <Building2 size={14} /> : <Tag size={14} />} {mo === "fornecedor" ? "Fornecedor" : "Categoria"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1.5">Quais {modo === "fornecedor" ? "fornecedores" : "categorias"}?</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEscopoTodos(true)}
                className={`rounded-xl border p-3 text-left transition-all ${escopoTodos ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20 ring-1 ring-indigo-400" : "border-gray-200 dark:border-gray-800 hover:border-indigo-300"}`}>
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">Todos</div>
                <div className="text-[11px] text-gray-500">{opcoes.length} {modo === "fornecedor" ? "fornecedores" : "categorias"}</div>
              </button>
              <button type="button" onClick={() => setEscopoTodos(false)}
                className={`rounded-xl border p-3 text-left transition-all ${!escopoTodos ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20 ring-1 ring-indigo-400" : "border-gray-200 dark:border-gray-800 hover:border-indigo-300"}`}>
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">Selecionar</div>
                <div className="text-[11px] text-gray-500">{selecionados.size > 0 ? `${selecionados.size} escolhido(s)` : "escolher quais"}</div>
              </button>
            </div>

            {!escopoTodos && (
              <div className="mt-2.5 rounded-xl border border-gray-200 dark:border-gray-800 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-gray-400">{selecionados.size} de {opcoes.length}</span>
                  <div className="flex gap-2 text-[11px] font-medium">
                    <button type="button" onClick={() => setSelecionados(new Set(opcoes.map(o => o.id)))} className="text-indigo-600 dark:text-indigo-400 hover:underline">todos</button>
                    <button type="button" onClick={() => setSelecionados(new Set())} className="text-gray-400 hover:text-gray-600">limpar</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
                  {opcoes.map(o => {
                    const on = selecionados.has(o.id);
                    return (
                      <button key={o.id} type="button" onClick={() => toggleSel(o.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] border transition-colors ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                        {on && <Check size={11} />} {o.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button onClick={() => { setIaMap(null); setIaResumo({}); setAjustes({}); setIncluir({}); setStep("builder"); }} disabled={!podeAvancarAvulso}>Continuar →</Button>
          </div>
        </div>
        );
      })()}

      {/* STEP BUILDER */}
      {step === "builder" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button" onClick={() => setStep(origem === "contagem" ? "contagem" : "avulso")} className="text-[12px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><ArrowLeft size={13} /> voltar</button>
            {origem === "contagem" && (
              <button type="button" onClick={() => void montarComIA()} disabled={montando} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                {montando ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {montando ? "Montando…" : iaMap ? "Refazer com IA" : "Montar com IA"}
              </button>
            )}
          </div>
          {iaErr && <div className="text-[12px] text-rose-600 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-1.5">{iaErr}</div>}

          {grupos.length === 0 && (
            <div className="text-sm text-gray-400 py-6 text-center">
              {criados.length ? "Todos os pedidos foram gerados. ✓" : "Nenhum produto pra esse escopo. Verifique fornecedor/estoque mínimo dos produtos."}
            </div>
          )}

          {grupos.map(g => {
            const forn = g.fornecedor!;
            const inclui = itensIncluidos(g);
            const total = totalGrupo(g);
            const faltaMin = g.pedidoMinimoValor != null && total > 0 && total < g.pedidoMinimoValor ? g.pedidoMinimoValor - total : 0;
            const okOpen = okAberto[forn.id] ?? (origem === "avulso");
            return (
              <div key={forn.id} className="border border-gray-200 dark:border-gray-800 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Building2 size={16} /> {forn.nome}</h3>
                    {forn.whatsapp && <div className="text-xs text-gray-500 inline-flex items-center gap-1"><Smartphone size={12} /> {forn.whatsapp}</div>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-xs text-gray-600 dark:text-gray-400"><strong>{inclui.length}</strong> item(ns){total > 0 && <> · <strong>{fmtR$(total)}</strong></>}</div>
                    {iaMap && <button type="button" onClick={() => restaurar(g)} className="text-[11px] font-medium text-violet-600 dark:text-violet-300 hover:underline inline-flex items-center gap-1"><RotateCcw size={12} /> restaurar IA</button>}
                    <Button onClick={() => void gerarPedido(g)} disabled={savingFornId === forn.id || inclui.length === 0}>{savingFornId === forn.id ? "..." : <span className="inline-flex items-center gap-1.5"><ClipboardList size={14} /> Gerar pedido ({inclui.length})</span>}</Button>
                  </div>
                </div>
                {iaResumo[forn.id] && <div className="mb-2 text-[12px] inline-flex items-start gap-1.5 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/15 border border-violet-200 dark:border-violet-800 rounded-lg px-2 py-1"><Sparkles size={13} className="mt-0.5 shrink-0" /> <span>{iaResumo[forn.id]}</span></div>}
                {faltaMin > 0 && <div className="mb-2 text-[12px] inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1"><TriangleAlert size={13} /> Faltam <strong>{fmtR$(faltaMin)}</strong> pro pedido mínimo ({fmtR$(g.pedidoMinimoValor!)}).</div>}

                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 font-semibold border-b border-gray-100 dark:border-gray-800">
                  <span>Item</span><span className="w-16 text-right">Contagem</span><span className="w-16 text-right">Mínimo</span><span className="w-24 text-right">Sugestão</span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {g.precisam.map(l => <Linha key={l.insumo.id} l={l} incluido={isIncluido(l)} valor={ajustes[l.insumo.id] ?? String(baseQtd(l))} onQtd={v => setAjustes(s => ({ ...s, [l.insumo.id]: v }))} onToggle={v => setIncluir(s => ({ ...s, [l.insumo.id]: v }))} />)}
                </div>
                {g.ok.length > 0 && (
                  <div className="mt-1.5 border-t border-dashed border-gray-200 dark:border-gray-800 pt-1.5">
                    <button type="button" onClick={() => setOkAberto(s => ({ ...s, [forn.id]: !okOpen }))} className="text-[11px] font-medium text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">{okOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {origem === "avulso" ? "Demais produtos" : "Itens em dia"} ({g.ok.length})</button>
                    {okOpen && (
                      <div className="divide-y divide-gray-50 dark:divide-gray-800/50 mt-1">
                        {g.ok.map(l => <Linha key={l.insumo.id} l={l} incluido={isIncluido(l)} opaco valor={ajustes[l.insumo.id] ?? String(baseQtd(l) > 0 ? baseQtd(l) : qtdInicialOk(l))} onQtd={v => setAjustes(s => ({ ...s, [l.insumo.id]: v }))} onToggle={v => setIncluir(s => ({ ...s, [l.insumo.id]: v }))} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Linha({ l, incluido, opaco, valor, onQtd, onToggle }: { l: LinhaSugestao; incluido: boolean; opaco?: boolean; valor: string; onQtd: (v: string) => void; onToggle: (v: boolean) => void }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-2 py-1.5 ${opaco && !incluido ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <input type="checkbox" checked={incluido} onChange={e => onToggle(e.target.checked)} className="shrink-0 w-4 h-4 accent-indigo-600" />
        <div className="min-w-0">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{l.insumo.nome}</div>
          <div className="text-[10px] text-gray-500">{l.fator > 1 && <>pacote {l.fator}× </>}{l.minPedido > 0 && <>· mín/item {l.minPedido} </>}{l.precoUnit != null && <>· {fmtR$(l.precoUnit)}/{undLabel(l.insumo)}</>}</div>
        </div>
      </div>
      <span className={`w-16 text-right tabular-nums text-sm ${l.temContagem ? "text-gray-700 dark:text-gray-200" : "text-gray-300 dark:text-gray-600"}`}>{l.temContagem ? l.contagem : "—"}</span>
      <span className="w-16 text-right tabular-nums text-sm text-gray-500">{l.minStock || "—"}</span>
      <div className="w-24 flex items-center justify-end gap-1">
        <input type="number" min={0} step={l.fator || "any"} value={valor} onChange={e => onQtd(e.target.value)} disabled={!incluido} className="w-16 px-2 py-1 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-50 tabular-nums" />
        <span className="text-[10px] text-gray-400 w-6">{undLabel(l.insumo)}</span>
      </div>
    </div>
  );
}
