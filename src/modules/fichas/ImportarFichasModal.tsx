// Tela de revisão do import de receitas por IA (planilha/PDF/print/foto).
// Fluxo: upload → reconhecimento + processamento em partes (progresso) →
// revisão: (1) ingredientes ÚNICOS (dedup, casado/novo, editável) + (2) receitas
// (incluir/excluir, categoria em lote) → grava.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { FtCategoria, FtDimensao, FtFicha, FtIngrediente, FtInsumo } from "../../core/types";
import { labelUnidade } from "./unidades";
import { normalizarNome } from "./dedup";
import { dividirEmBlocos, fileParaAnexo, importarFichasIA, nomeDoBloco, planilhaParaTexto, resolverIngrediente, type Anexo } from "./importar";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const UP = (s: string) => (s || "").trim().toUpperCase();

type IngRev = { id: string; nome: string; qtd: number; unidade: string; qb: boolean; chave: string };
type FichaRev = { id: string; nome: string; ehSubficha: boolean; categoriaId: string | null; incluir: boolean; rendimento: { qtd: number; unidade: string }; ingredientes: IngRev[] };
type Resol = { chave: string; nome: string; matchInsumoId: string | null; status: "casado" | "conferir" | "novo"; sugestoes: FtInsumo[]; novoDimensao: FtDimensao; novoUnidadeBase: string };

const CHIP: Record<string, string> = {
  casado: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  novo: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  conferir: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export function ImportarFichasModal({ rid, insumos, categorias, meId, meNome, onClose }: {
  rid: string; insumos: FtInsumo[]; categorias: FtCategoria[]; meId?: string; meNome?: string; onClose: () => void;
}) {
  const [fase, setFase] = useState<"upload" | "processando" | "revisao" | "gravando">("upload");
  const [erro, setErro] = useState("");
  const [fichas, setFichas] = useState<FichaRev[]>([]);
  const [resol, setResol] = useState<Record<string, Resol>>({});
  const [itens, setItens] = useState<{ id: string; nome: string; status: "pendente" | "lendo" | "ok" | "erro" }[]>([]);
  const [feito, setFeito] = useState(0);
  const [planilhaTexto, setPlanilhaTexto] = useState("");
  const [planilhaNome, setPlanilhaNome] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const temFonte = !!planilhaTexto || anexos.length > 0;
  const catsAtivas = categorias.filter(c => c.ativo !== false);

  useEffect(() => {
    if (fase !== "processando") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [fase]);

  function matchCategoria(nome?: string): string | null {
    if (!nome) return null;
    const n = normalizarNome(nome);
    return catsAtivas.find(c => normalizarNome(c.nome) === n)?.id || null;
  }

  async function addArquivos(files: FileList | File[]) {
    setErro("");
    for (const file of Array.from(files)) {
      const nome = file.name.toLowerCase();
      const ehPlanilha = /\.(xlsx|xls|csv)$/.test(nome) || file.type.includes("sheet") || file.type === "text/csv";
      try {
        if (ehPlanilha) { const texto = await planilhaParaTexto(file); if (!texto.trim()) { setErro("Não consegui ler a planilha."); continue; } setPlanilhaTexto(texto); setPlanilhaNome(file.name); }
        else { const ax = await fileParaAnexo(file); setAnexos(prev => [...prev, ax]); }
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    }
  }
  async function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items; if (!items) return;
    for (const it of Array.from(items)) if (it.type.startsWith("image/")) { const blob = it.getAsFile(); if (blob) { const ax = await fileParaAnexo(blob); setAnexos(prev => [...prev, ax]); } }
  }

  async function analisar() {
    if (!temFonte) return;
    setErro("");
    const LOTE = 3;
    const blocos = planilhaTexto ? dividirEmBlocos(planilhaTexto) : [];
    type Unidade = { itemIds: string[]; payload: { planilha?: string; anexos?: Anexo[] } };
    const unidades: Unidade[] = [];
    const itensIniciais: { id: string; nome: string; status: "pendente" }[] = [];
    if (blocos.length > 1) {
      const comId = blocos.map(b => ({ id: uid("it"), nome: nomeDoBloco(b), bloco: b }));
      comId.forEach(x => itensIniciais.push({ id: x.id, nome: x.nome, status: "pendente" }));
      for (let i = 0; i < comId.length; i += LOTE) { const g = comId.slice(i, i + LOTE); unidades.push({ itemIds: g.map(x => x.id), payload: { planilha: g.map(x => x.bloco).join("\n\n") } }); }
    } else if (planilhaTexto.trim()) {
      const id = uid("it"); itensIniciais.push({ id, nome: planilhaNome || "planilha", status: "pendente" });
      unidades.push({ itemIds: [id], payload: { planilha: planilhaTexto } });
    }
    for (const a of anexos) { const id = uid("it"); itensIniciais.push({ id, nome: a.nome, status: "pendente" }); unidades.push({ itemIds: [id], payload: { anexos: [a] } }); }

    setItens(itensIniciais); setFeito(0); setFase("processando");
    const marcar = (ids: string[], status: "lendo" | "ok" | "erro") => setItens(prev => prev.map(it => ids.includes(it.id) ? { ...it, status } : it));

    const coletadas: FichaRev[] = [];
    const errosLote: string[] = [];
    for (const u of unidades) {
      marcar(u.itemIds, "lendo");
      try {
        const ia = await importarFichasIA(u.payload);
        for (const f of ia) {
          coletadas.push({
            id: uid("fic"), nome: UP(f.nome) || "(SEM NOME)", ehSubficha: f.ehSubficha ?? true, categoriaId: matchCategoria(f.categoria), incluir: true,
            rendimento: f.rendimento || { qtd: 1, unidade: "kg" },
            ingredientes: (f.ingredientes || []).map(ing => { const nome = UP(ing.nome); return { id: uid("ing"), nome, qtd: ing.qtd || 0, unidade: ing.unidade, qb: !!ing.qb, chave: normalizarNome(nome) }; }),
          });
        }
        marcar(u.itemIds, "ok");
      } catch (e) { marcar(u.itemIds, "erro"); errosLote.push(e instanceof Error ? e.message : String(e)); }
      setFeito(f => f + u.itemIds.length);
    }
    if (coletadas.length === 0) { setErro(errosLote[0] || "A IA não encontrou nenhuma receita."); setFase("upload"); return; }

    // Resolve ingredientes ÚNICOS (dedup por nome normalizado).
    const mapa: Record<string, Resol> = {};
    for (const f of coletadas) for (const ing of f.ingredientes) {
      if (mapa[ing.chave]) continue;
      const r = resolverIngrediente({ nome: ing.nome, qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb }, insumos, 0);
      mapa[ing.chave] = { chave: ing.chave, nome: ing.nome, matchInsumoId: r.matchInsumoId, status: r.status, sugestoes: r.sugestoes, novoDimensao: r.novoDimensao, novoUnidadeBase: r.novoUnidadeBase };
    }
    setFichas(coletadas); setResol(mapa);
    if (errosLote.length) setErro(`${errosLote.length} parte(s) falharam e ficaram de fora.`);
    setFase("revisao");
  }

  // ── edições ──
  const setResolNome = (chave: string, nome: string) => setResol(p => ({ ...p, [chave]: { ...p[chave], nome } }));
  const setResolMatch = (chave: string, valor: string) => setResol(p => ({ ...p, [chave]: { ...p[chave], matchInsumoId: valor === "__novo__" ? null : valor, status: valor === "__novo__" ? "novo" : "casado" } }));
  const setFicha = (id: string, patch: Partial<FichaRev>) => setFichas(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  const catTodas = (id: string) => setFichas(prev => prev.map(f => ({ ...f, categoriaId: id || null })));

  const unicos = useMemo(() => Object.values(resol).sort((a, b) => a.nome.localeCompare(b.nome)), [resol]);
  const ocorrencias = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of fichas) if (f.incluir) for (const ing of f.ingredientes) c[ing.chave] = (c[ing.chave] || 0) + 1;
    return c;
  }, [fichas]);
  const cont = useMemo(() => {
    let casado = 0, novo = 0, conferir = 0;
    for (const u of unicos) { if ((ocorrencias[u.chave] || 0) === 0) continue; if (u.status === "casado") casado++; else if (u.status === "novo") novo++; else conferir++; }
    return { casado, novo, conferir };
  }, [unicos, ocorrencias]);
  const nSel = fichas.filter(f => f.incluir).length;

  async function gravar() {
    if (nSel === 0) { setErro("Selecione ao menos uma receita."); return; }
    setFase("gravando");
    try {
      const batch = writeBatch(db); const now = new Date().toISOString();
      const incluidas = fichas.filter(f => f.incluir);
      // chaves usadas pelas receitas incluídas
      const chavesUsadas = new Set<string>();
      for (const f of incluidas) for (const ing of f.ingredientes) chavesUsadas.add(ing.chave);
      // cria insumos novos (1 por chave sem match)
      const novoIdPorChave = new Map<string, string>();
      for (const chave of chavesUsadas) {
        const r = resol[chave]; if (!r || r.matchInsumoId) continue;
        const id = uid("ins"); novoIdPorChave.set(chave, id);
        batch.set(doc(db, "ftInsumos", id), sanitizeForFirestore({
          id, restaurantId: rid, nome: UP(r.nome), nomeNormalizado: chave, dimensao: r.novoDimensao, unidadeBase: r.novoUnidadeBase,
          custo: 0, custoAtualizadoEm: null, historicoCusto: [], fornecedorPadrao: null, reutilizavel: false, variacoes: [], aliases: [], ativo: true,
        } as FtInsumo));
      }
      for (const f of incluidas) {
        const ingredientes: FtIngrediente[] = f.ingredientes.map(ing => {
          const r = resol[ing.chave];
          const refId = r?.matchInsumoId || novoIdPorChave.get(ing.chave) || "";
          const nomeSnap = r?.matchInsumoId ? (insumos.find(i => i.id === r.matchInsumoId)?.nome || UP(r.nome)) : UP(r?.nome || ing.nome);
          return { id: uid("ing"), tipo: "insumo", refId, nomeSnapshot: nomeSnap, qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb } as FtIngrediente;
        });
        const ficha: FtFicha = {
          id: f.id, restaurantId: rid, nome: UP(f.nome), nomeNormalizado: normalizarNome(f.nome),
          ehSubficha: f.ehSubficha, categoriaId: f.categoriaId, rendimento: f.rendimento, ingredientes,
          ativo: true, criadoEm: now, criadoPor: meId, criadoPorNome: meNome,
        };
        batch.set(doc(db, "ftFichas", f.id), sanitizeForFirestore(ficha));
      }
      await batch.commit();
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setFase("revisao"); }
  }

  return (
    <Modal title="Importar receita (IA)" onClose={onClose} maxWidth="max-w-3xl">
      {fase === "upload" && (
        <div className="py-1" onPaste={onPaste}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,application/pdf,image/*" multiple className="hidden" onChange={e => { if (e.target.files) void addArquivos(e.target.files); e.currentTarget.value = ""; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files) void addArquivos(e.target.files); e.currentTarget.value = ""; }} />
          <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
            <div className="text-4xl mb-2">🧾</div>
            <p className="text-sm text-gray-600 dark:text-gray-300">Importe uma receita de <strong>planilha, PDF, print ou foto</strong> (inclusive manuscrito).</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">A IA estrutura e você revisa antes de gravar. Nada é salvo automaticamente.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>📎 Anexar arquivo</Button>
              <Button variant="secondary" onClick={() => camRef.current?.click()}>📷 Tirar foto</Button>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Ou cole um print aqui (Ctrl/Cmd + V)</p>
          </div>
          {temFonte && (
            <div className="mt-3 space-y-1.5">
              {planilhaTexto && <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800"><span>📄</span><span className="flex-1 truncate">{planilhaNome || "planilha"}</span><button type="button" onClick={() => { setPlanilhaTexto(""); setPlanilhaNome(""); }} className="text-gray-400 hover:text-red-600 text-xs">remover</button></div>}
              {anexos.map((a, i) => <div key={i} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800"><span>{a.mediaType === "application/pdf" ? "📕" : "🖼️"}</span><span className="flex-1 truncate">{a.nome}</span><button type="button" onClick={() => setAnexos(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600 text-xs">remover</button></div>)}
            </div>
          )}
          {erro && <div className="text-sm text-red-600 mt-3">{erro}</div>}
          <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={analisar} disabled={!temFonte}>✨ Analisar</Button></div>
        </div>
      )}

      {fase === "processando" && (
        <div className="py-2">
          <div className="flex items-center justify-between text-sm mb-2"><span className="font-medium text-gray-700 dark:text-gray-200">Lendo {itens.length} receita(s)…</span><span className="text-xs text-gray-400">{feito}/{itens.length}</span></div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${itens.length ? Math.round((feito / itens.length) * 100) : 0}%` }} /></div>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {itens.map(it => (
              <div key={it.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg">
                <span className="w-5 text-center shrink-0">{it.status === "ok" ? <span className="text-emerald-600">✓</span> : it.status === "erro" ? <span className="text-red-500">✕</span> : it.status === "lendo" ? <span className="inline-block animate-spin">◌</span> : <span className="text-gray-300">•</span>}</span>
                <span className={`flex-1 min-w-0 truncate ${it.status === "ok" ? "text-gray-800 dark:text-gray-200" : it.status === "lendo" ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}>{it.nome}</span>
                {it.status === "lendo" && <span className="text-[10px] text-indigo-400 shrink-0">lendo…</span>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Roda no navegador: pode <strong>alternar de janela/app</strong> à vontade, mas <strong>não feche esta aba</strong> nem saia da tela até terminar.</p>
        </div>
      )}

      {(fase === "revisao" || fase === "gravando") && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
            <span className="text-gray-600 dark:text-gray-300 font-medium">{fichas.length} receita(s) · {unicos.length} ingrediente(s):</span>
            <span className={`px-2 py-0.5 rounded-full ${CHIP.casado}`}>{cont.casado} casados</span>
            <span className={`px-2 py-0.5 rounded-full ${CHIP.novo}`}>{cont.novo} novos</span>
            {cont.conferir > 0 && <span className={`px-2 py-0.5 rounded-full ${CHIP.conferir}`}>{cont.conferir} a conferir</span>}
            <div className="flex-1" />
            <span className="text-gray-400">Categoria de todas:</span>
            <select onChange={e => catTodas(e.target.value)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">— escolher —</option>
              {catsAtivas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-4">
            {/* 1) Ingredientes únicos */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200">Ingredientes ({unicos.length}) — confira antes de gravar</div>
              <div className="p-2 space-y-1">
                {unicos.filter(u => (ocorrencias[u.chave] || 0) > 0).map(u => (
                  <div key={u.chave} className="flex items-center gap-2 text-sm">
                    <input value={u.nome} onChange={e => setResolNome(u.chave, e.target.value.toUpperCase())} className="w-32 sm:w-52 shrink-0 bg-transparent text-gray-800 dark:text-gray-200 outline-none border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-indigo-500 px-0.5" title="nome do ingrediente (editável)" />
                    <span className="text-[11px] text-gray-400 shrink-0 w-20">{ocorrencias[u.chave]} receita(s)</span>
                    <select value={u.matchInsumoId ?? "__novo__"} onChange={e => setResolMatch(u.chave, e.target.value)} className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                      {u.sugestoes.map(s => <option key={s.id} value={s.id}>{s.nome} · {labelUnidade(s.unidadeBase)}</option>)}
                      <option value="__novo__">+ criar novo insumo</option>
                    </select>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${CHIP[u.status]}`}>{u.status === "casado" ? "reconhecido" : u.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2) Receitas */}
            <div className="space-y-3">
              {fichas.map(f => (
                <div key={f.id} className={`rounded-xl border overflow-hidden ${f.incluir ? "border-gray-200 dark:border-gray-800" : "border-gray-200 dark:border-gray-800 opacity-50"}`}>
                  <div className="flex items-center gap-2 p-2.5 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex-wrap">
                    <input type="checkbox" checked={f.incluir} onChange={e => setFicha(f.id, { incluir: e.target.checked })} className="w-4 h-4 accent-indigo-600 shrink-0" title="incluir esta receita" />
                    <input value={f.nome} onChange={e => setFicha(f.id, { nome: e.target.value.toUpperCase() })} className="flex-1 min-w-[120px] bg-transparent text-sm font-semibold outline-none border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-indigo-500 px-0.5 dark:text-gray-100" />
                    <label className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={f.ehSubficha} onChange={e => setFicha(f.id, { ehSubficha: e.target.checked })} className="w-3.5 h-3.5 accent-indigo-600" />subficha</label>
                    <select value={f.categoriaId || ""} onChange={e => setFicha(f.id, { categoriaId: e.target.value || null })} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"><option value="">sem categoria</option>{catsAtivas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
                    <span className="text-[11px] text-gray-500 shrink-0">rende {f.rendimento.qtd} {labelUnidade(f.rendimento.unidade)}</span>
                  </div>
                  <div className="p-2.5 space-y-1">
                    {f.ingredientes.map(ing => {
                      const r = resol[ing.chave];
                      return (
                        <div key={ing.id} className="flex items-center gap-2 text-sm">
                          <span className="w-28 sm:w-52 shrink-0 truncate text-gray-700 dark:text-gray-200">{r?.nome || ing.nome}</span>
                          <span className="text-xs text-gray-500 tabular-nums shrink-0 w-16 text-right">{ing.qb ? "q.b." : `${ing.qtd} ${labelUnidade(ing.unidade)}`}</span>
                          <div className="flex-1" />
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${CHIP[r?.status || "novo"]}`}>{(r?.status || "novo") === "casado" ? "reconhecido" : (r?.status || "novo")}</span>
                        </div>
                      );
                    })}
                    {f.ingredientes.length === 0 && <div className="text-xs text-gray-400 italic">Sem ingredientes.</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {erro && <div className="text-sm text-red-600 mt-3">{erro}</div>}
          <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
            <span className="text-[11px] text-gray-400">Insumos "novos" entram sem custo — depois você lança na aba Insumos.</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={fase === "gravando"}>Cancelar</Button>
              <Button onClick={gravar} disabled={fase === "gravando" || nSel === 0}>{fase === "gravando" ? "Gravando…" : `Aprovar e gravar ${nSel}`}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
