// Módulo independente "Cardápio" (Configurações → Cardápio). Vários cardápios
// por restaurante (Comidas, Bebidas, Vinhos) em abas; cada um editado por dentro
// com o mesmo editor/designer. O site puxa daqui. Doc: cardapioEstruturado/{rid}
// = { cardapios: [...], layout (visual compartilhado) }.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { CardapioEditor } from "../sites/CardapioEditor";
import { CardapioPdfPanel } from "../sites/CardapioTab";
import { useSiteConfig } from "../sites/useSiteConfig";
import { CardapioConfig } from "./CardapioConfig";
import { CardapioArquivados } from "./CardapioArquivados";
import { carregarFontesCardapio } from "../sites/shared/FontePicker";
import { normalizarNome } from "../fichas/dedup";
import { authHeader } from "../../core/firebase/idToken";
import { fmtBRDateTime } from "../../core/utils/date";
import type { CardapioEstruturado, CardapioLayout, CardapioMenu } from "../../core/types";

const CONFIG = "__config__";
const ARQUIVADOS = "__arquivados__";

type PdfItem = { id: string; titulo: string; preco: string; secao?: string };
const SEM_SECAO = "Sem seção";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function CardapioPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find((r) => r.id === rid) || null;
  const podeVer = canUse(me, rid, "cardapio");
  const { can } = useCanAcao(rid);
  const podeEditar = !!me?.isMaster || can("cardapio", "editar");

  const [cardapios, setCardapios] = useState<CardapioMenu[] | null>(null);
  const [sel, setSel] = useState<string>("");
  const [sharedLayout, setSharedLayout] = useState<CardapioLayout | null>(null);
  const [pdfItens, setPdfItens] = useState<PdfItem[]>([]);
  const [pdfItensEm, setPdfItensEm] = useState<string>("");
  const [extraindo, setExtraindo] = useState(false);
  const [extraErr, setExtraErr] = useState("");
  const [buscaItem, setBuscaItem] = useState("");
  const itensRef = useRef(pdfItens);
  itensRef.current = pdfItens;
  const { config: siteCfg, save: saveSite } = useSiteConfig(rid, restaurant?.nome || "");
  const modoCard: "editor" | "pdf" = siteCfg?.cardapioModo === "pdf" ? "pdf" : siteCfg?.cardapioModo === "editor" ? "editor" : (siteCfg?.cardapioPdfPtUrl || siteCfg?.cardapioPdfEnUrl) ? "pdf" : "editor";
  const setModoCard = (m: "editor" | "pdf") => { if (me) void saveSite({ cardapioModo: m }, me.id); };

  async function carregar() {
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() as CardapioEstruturado) : null;
    let cards = d?.cardapios || [];
    // Migração: cardápio legado (campo `secoes`) → cardápio "Comidas".
    if (!cards.length && d?.secoes?.length) {
      cards = [{ id: uid(), nome: "Comidas", tituloCapa: d.layout?.tituloCapa || "COMIDAS", secoes: d.secoes, ...(d.traduzidoEm ? { traduzidoEm: d.traduzidoEm } : {}) }];
      if (podeEditar) await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios: cards, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
    }
    setCardapios(cards);
    setSharedLayout(d?.layout || {});
    setPdfItens(d?.cardapioPdfItens || []);
    setPdfItensEm(d?.cardapioPdfItensEm || "");
    setSel((s) => (s && (s === CONFIG || cards.some((c) => c.id === s)) ? s : cards[0]?.id || ""));
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rid]);

  // Pré-carrega as 2 fontes do restaurante assim que o módulo abre — deixa em cache
  // pra que o preview do PDF já abra na fonte certa, sem os ~5s de antes.
  useEffect(() => {
    if (!sharedLayout) return;
    return carregarFontesCardapio(sharedLayout.fonteTitulos, sharedLayout.fonteCorpo, sharedLayout.fontesCustom || []);
  }, [sharedLayout]);

  // Salva só a LISTA (nome/add/remove/capa) — preserva as seções de cada cardápio.
  async function salvarLista(next: CardapioMenu[]) {
    setCardapios(next);
    const ref = doc(db, "cardapioEstruturado", rid);
    const snap = await getDoc(ref);
    const atual = (snap.exists() ? (snap.data() as CardapioEstruturado).cardapios : []) || [];
    const merged = next.map((n) => { const cur = atual.find((c) => c.id === n.id); return cur ? { ...cur, nome: n.nome, tituloCapa: n.tituloCapa, temCapa: n.temCapa } : n; });
    await setDoc(ref, sanitizeForFirestore({ id: rid, restaurantId: rid, cardapios: merged, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }).catch(() => {});
  }
  function addMenu() {
    const nome = window.prompt("Nome do novo cardápio (ex: Bebidas, Vinhos):")?.trim();
    if (!nome) return;
    const m: CardapioMenu = { id: uid(), nome, tituloCapa: nome.toUpperCase(), temCapa: false, secoes: [] };
    void salvarLista([...(cardapios || []), m]); setSel(m.id);
  }
  function renomear(id: string) {
    const m = cardapios?.find((c) => c.id === id);
    const nome = window.prompt("Renomear cardápio:", m?.nome)?.trim();
    if (!nome) return;
    void salvarLista((cardapios || []).map((c) => c.id === id ? { ...c, nome } : c));
  }
  function excluir(id: string) {
    const m = cardapios?.find((c) => c.id === id);
    if (!window.confirm(`Excluir o cardápio "${m?.nome}"? Os itens dele serão apagados.`)) return;
    const next = (cardapios || []).filter((c) => c.id !== id);
    void salvarLista(next); if (sel === id) setSel(next[0]?.id || "");
  }

  // Extrai itens+preços do PDF via IA → lista "sombra" pras fichas técnicas.
  async function extrairPrecos() {
    const url = siteCfg?.cardapioPdfPtUrl;
    if (!url) { setExtraErr("Suba o PDF em português primeiro."); return; }
    setExtraindo(true); setExtraErr("");
    try {
      const resp = await fetch("/api/extrair-cardapio", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ pdfUrl: url }) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((data as { error?: string })?.error || `Erro ${resp.status}`);
      // Preserva o id de itens que já existiam (mesmo nome) pra NÃO quebrar os
      // vínculos de preço das fichas ao reler o PDF. Só itens novos ganham id novo.
      const prev = itensRef.current;
      const usados = new Set<string>();
      const acharId = (titulo: string) => {
        const n = normalizarNome(titulo);
        const hit = prev.find(p => !usados.has(p.id) && normalizarNome(p.titulo) === n);
        if (hit) { usados.add(hit.id); return hit.id; }
        return uid();
      };
      const itens: PdfItem[] = (Array.isArray((data as { itens?: unknown }).itens) ? (data as { itens: { titulo: string; preco?: string; secao?: string }[] }).itens : []).map(i => ({ id: acharId(i.titulo), titulo: i.titulo, preco: i.preco || "", secao: (i.secao || "").trim() }));
      const now = new Date().toISOString();
      await setDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore({ id: rid, restaurantId: rid, cardapioPdfItens: itens, cardapioPdfItensEm: now, atualizadoEm: now, atualizadoPor: me?.id }), { merge: true });
      setPdfItens(itens); setPdfItensEm(now);
    } catch (e) { setExtraErr(e instanceof Error ? e.message : String(e)); }
    finally { setExtraindo(false); }
  }

  // Edição da lista sombra (título/preço), com salvamento automático.
  async function salvarPdfItens(next: PdfItem[]) {
    setPdfItens(next);
    try { await setDoc(doc(db, "cardapioEstruturado", rid), sanitizeForFirestore({ id: rid, restaurantId: rid, cardapioPdfItens: next, atualizadoEm: new Date().toISOString(), atualizadoPor: me?.id }), { merge: true }); }
    catch (e) { setExtraErr(e instanceof Error ? e.message : String(e)); }
  }
  const patchPdfItem = (id: string, patch: Partial<PdfItem>) => setPdfItens(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  const addPdfItem = (secao?: string) => void salvarPdfItens([...itensRef.current, { id: uid(), titulo: "", preco: "", secao: secao || "" }]);
  const renomearSecao = (de: string, para: string) => { const p = para.trim(); void salvarPdfItens(itensRef.current.map(i => (i.secao || "").trim() === de.trim() ? { ...i, secao: p } : i)); };
  const removePdfItem = (id: string) => void salvarPdfItens(itensRef.current.filter(i => i.id !== id));

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) return <div className="max-w-2xl mx-auto py-12 text-center"><div className="text-4xl mb-3">🔒</div><p className="text-gray-600 dark:text-gray-400">Você não tem acesso ao Cardápio.</p></div>;
  if (cardapios === null) return <div className="text-gray-400 py-12 text-center text-sm">Carregando…</div>;

  const atual = cardapios.find((c) => c.id === sel);

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📋 Cardápios — {restaurant.nome}</h2>
      <p className="text-[13px] text-gray-500 dark:text-gray-400">Monte aqui os cardápios do restaurante. O site puxa estas informações — atualizou aqui, atualiza lá.</p>

      {/* Modo: item a item (estruturado) × subir PDF pronto. Grava no SiteConfig. */}
      {siteCfg && (
        <div className="flex gap-2">
          <button type="button" onClick={() => setModoCard("editor")} disabled={!podeEditar}
            className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${modoCard === "editor" ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"} disabled:opacity-60`}>📝 Montar aqui (item a item)</button>
          <button type="button" onClick={() => setModoCard("pdf")} disabled={!podeEditar}
            className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border ${modoCard === "pdf" ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"} disabled:opacity-60`}>📄 Subir cardápio em PDF</button>
        </div>
      )}

      {modoCard === "pdf" ? (
        siteCfg ? <div className="space-y-4">
          <CardapioPdfPanel rid={rid} config={siteCfg} podeEditar={podeEditar} meId={me?.id || ""} onSave={async (parcial) => { if (me) await saveSite(parcial, me.id); }} />
          {podeEditar && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">🤖 Preços pras fichas técnicas</h3>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-lg">A IA lê o PDF e extrai os itens + preços — usados <strong>só internamente</strong> pra vincular o preço de venda nas fichas técnicas (CMV). Não aparece no site.</p>
                </div>
                <button type="button" onClick={() => void extrairPrecos()} disabled={extraindo || !siteCfg.cardapioPdfPtUrl} className="text-sm font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0">{extraindo ? "Lendo o PDF…" : pdfItens.length ? "🔄 Reler PDF (IA)" : "✨ Extrair itens e preços (IA)"}</button>
              </div>
              {extraErr && <p className="text-xs text-rose-600">⚠ {extraErr}</p>}
              {!siteCfg.cardapioPdfPtUrl ? (
                <p className="text-[12px] text-amber-600 dark:text-amber-400">Suba o PDF (português) acima pra habilitar a extração.</p>
              ) : pdfItens.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic">Nenhum item ainda. Clique em "Extrair" pra a IA ler o PDF — depois você revisa aqui.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">{pdfItens.length} {pdfItens.length === 1 ? "item" : "itens"}{(() => { const n = new Set(pdfItens.map(i => (i.secao || "").trim() || SEM_SECAO)).size; return n > 1 ? ` · ${n} seções` : ""; })()}{pdfItens.filter(i => !i.preco.trim()).length > 0 ? ` · ${pdfItens.filter(i => !i.preco.trim()).length} sem preço` : ""}{pdfItensEm ? ` · lido ${fmtBRDateTime(pdfItensEm)}` : ""}</span>
                    <div className="flex-1" />
                    {pdfItens.length > 8 && (
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔎</span>
                        <input value={buscaItem} onChange={e => setBuscaItem(e.target.value)} placeholder="filtrar…" className="h-8 w-40 pl-7 pr-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100" />
                      </div>
                    )}
                  </div>
                  {(() => {
                    const q = buscaItem.trim().toLowerCase();
                    const vis = pdfItens.filter(i => !q || i.titulo.toLowerCase().includes(q) || (i.secao || "").toLowerCase().includes(q));
                    const ordem: string[] = [];
                    const mapa = new Map<string, PdfItem[]>();
                    for (const i of vis) { const s = (i.secao || "").trim() || SEM_SECAO; if (!mapa.has(s)) { mapa.set(s, []); ordem.push(s); } mapa.get(s)!.push(i); }
                    if (ordem.length === 0) return <div className="text-[12px] text-gray-400 italic px-1 py-3">Nenhum item bate com o filtro.</div>;
                    return (
                      <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <div className="max-h-[28rem] overflow-y-auto">
                          {ordem.map(secao => (
                            <div key={secao}>
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800/60 sticky top-0 z-[1] border-b border-gray-200 dark:border-gray-800">
                                <input defaultValue={secao === SEM_SECAO ? "" : secao} placeholder={SEM_SECAO} onBlur={e => { const de = secao === SEM_SECAO ? "" : secao; const para = e.target.value.trim(); if (para !== de) renomearSecao(de, para); }} title="renomear seção" className="flex-1 min-w-0 bg-transparent text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 outline-none border-b border-transparent focus:border-indigo-400" />
                                <span className="text-[10px] text-gray-400 shrink-0">{mapa.get(secao)!.length}</span>
                                <button type="button" onClick={() => addPdfItem(secao === SEM_SECAO ? "" : secao)} title="adicionar item nesta seção" className="text-[11px] text-indigo-500 hover:text-indigo-700 shrink-0">+ item</button>
                              </div>
                              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {mapa.get(secao)!.map(i => (
                                  <div key={i.id} className="flex items-center gap-2 px-3 py-1.5 group hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                    <input value={i.titulo} onChange={e => patchPdfItem(i.id, { titulo: e.target.value })} onBlur={() => void salvarPdfItens(itensRef.current)} placeholder="nome do item" className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 dark:text-gray-100 outline-none border-b border-transparent focus:border-indigo-400 px-0.5" />
                                    <input value={i.preco} onChange={e => patchPdfItem(i.id, { preco: e.target.value })} onBlur={() => void salvarPdfItens(itensRef.current)} placeholder="—" className={`w-28 text-right bg-transparent text-sm outline-none border-b border-transparent focus:border-indigo-400 px-0.5 tabular-nums ${i.preco.trim() ? "text-gray-700 dark:text-gray-200" : "text-amber-500"}`} />
                                    <button type="button" onClick={() => removePdfItem(i.id)} title="remover" className="w-6 text-gray-300 hover:text-red-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => addPdfItem()} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ adicionar item</button>
                    <span className="text-[11px] text-gray-400">Revise os preços e vincule aos pratos em Fichas Técnicas → Custo & CMV.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
          : <div className="text-gray-400 py-8 text-center text-sm">Carregando…</div>
      ) : (<>
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto whitespace-nowrap">
        {cardapios.map((c) => (
          <button key={c.id} type="button" onClick={() => setSel(c.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sel === c.id ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
            {c.nome}
          </button>
        ))}
        {podeEditar && <button type="button" onClick={addMenu} className="px-3 py-2 text-sm font-medium text-indigo-600">+ Novo cardápio</button>}
        <span className="flex-1" />
        <button type="button" onClick={() => setSel(ARQUIVADOS)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sel === ARQUIVADOS ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
          🗑️ Arquivados
        </button>
        <button type="button" onClick={() => setSel(CONFIG)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sel === CONFIG ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-gray-500"}`}>
          ⚙️ Configurações
        </button>
      </div>

      {sel === ARQUIVADOS ? (
        <CardapioArquivados rid={rid} podeEditar={podeEditar} meId={me?.id} cardapios={cardapios} />
      ) : sel === CONFIG ? (
        <CardapioConfig rid={rid} podeEditar={podeEditar} atualizadoPor={me?.id} />
      ) : cardapios.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl space-y-2">
          <p className="text-sm text-gray-400">Nenhum cardápio ainda.</p>
          {podeEditar && <button type="button" onClick={addMenu} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white">+ Criar primeiro cardápio</button>}
        </div>
      ) : atual ? (
        <div className="space-y-3">
          {podeEditar && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-400">Cardápio selecionado: <strong className="text-gray-600 dark:text-gray-300">{atual.nome}</strong></span>
              <button type="button" onClick={() => renomear(atual.id)} className="text-[12px] text-indigo-600 hover:underline">renomear</button>
              <button type="button" onClick={() => excluir(atual.id)} className="text-[12px] text-rose-600 hover:underline">excluir</button>
            </div>
          )}
          <CardapioEditor key={atual.id} rid={rid} menuId={atual.id} nomeMenu={atual.nome} podeEditar={podeEditar} nomeRestaurante={restaurant.nome}
            sharedLayout={sharedLayout || undefined} menuLayoutProprio={!!atual.layoutProprio} menuLayout={atual.layout} />
        </div>
      ) : null}
      </>)}
    </div>
  );
}
