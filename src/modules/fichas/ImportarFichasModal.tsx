// Revisão do import de receitas por IA. A IA lê (planilha/PDF/print/foto),
// separa insumo principal × variação e a gente reconhece subfichas (ingrediente
// com nome de uma das receitas do lote). Revisão: (1) ingredientes agrupados por
// insumo (principal + variações c/ % de aproveitamento) + subfichas; (2) receitas
// (incluir/excluir, categoria em lote) → grava deduplicado.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, setDoc as setDocFs, deleteDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { FtCategoria, FtDimensao, FtFicha, FtIngrediente, FtInsumo, FtInsumoVariacao } from "../../core/types";
import { labelUnidade } from "./unidades";
import { normalizarNome as norm } from "./dedup";
import { fmtBRDateTime } from "../../core/utils/date";
import { dividirEmBlocos, fileParaAnexo, importarFichasIA, nomeDoBloco, planilhaParaTexto, resolverIngrediente, type Anexo, type FichaIA } from "./importar";

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const UP = (s: string) => (s || "").trim().toUpperCase();
// Rótulos que a IA às vezes lê como "ingrediente" mas não são.
const RUIDO = new Set(["peso bruto", "peso liquido", "peso liquido kg", "rendimento", "fator de correcao", "fc", "custo", "total", "modo de preparo", "preparo", "ingrediente", "ingredientes", "quantidade", "unidade"]);

type IngRev = { id: string; qtd: number; unidade: string; qb: boolean; principalKey: string; variacaoNorm: string; subfichaFichaId: string | null };
type FichaRev = { id: string; nome: string; ehSubficha: boolean; categoriaId: string | null; incluir: boolean; rendimento: { qtd: number; unidade: string }; ingredientes: IngRev[] };
type VarInfo = { norm: string; nome: string; fc: number };
type Principal = { key: string; nome: string; unidade: string; matchInsumoId: string | null; status: "casado" | "conferir" | "novo"; sugestoes: FtInsumo[]; novoDimensao: FtDimensao; novoUnidadeBase: string; temBase: boolean; variacoes: VarInfo[] };

const CHIP: Record<string, string> = {
  casado: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  novo: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  conferir: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  subficha: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

export function ImportarFichasModal({ rid, insumos, categorias, meId, meNome, onClose }: {
  rid: string; insumos: FtInsumo[]; categorias: FtCategoria[]; meId?: string; meNome?: string; onClose: () => void;
}) {
  const [fase, setFase] = useState<"upload" | "processando" | "revisao" | "gravando">("upload");
  const [erro, setErro] = useState("");
  const [fichas, setFichas] = useState<FichaRev[]>([]);
  const [principais, setPrincipais] = useState<Record<string, Principal>>({});
  const [subNomes, setSubNomes] = useState<Record<string, string>>({}); // fichaId(subficha) -> nome
  const [itens, setItens] = useState<{ id: string; nome: string; status: "pendente" | "lendo" | "ok" | "erro" }[]>([]);
  const [feito, setFeito] = useState(0);
  const [planilhaTexto, setPlanilhaTexto] = useState("");
  const [planilhaNome, setPlanilhaNome] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const temFonte = !!planilhaTexto || anexos.length > 0;
  const catsAtivas = categorias.filter(c => c.ativo !== false);
  const rascunhoId = meId ? `${rid}_${meId}` : rid;
  type RevSnap = { fichas: FichaRev[]; principais: Record<string, Principal>; subNomes: Record<string, string> };
  const [rascunho, setRascunho] = useState<{ receitasRaw: FichaIA[]; criadoEm: string; nReceitas: number; revisao?: RevSnap } | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Carrega rascunho salvo (leitura crua da IA + revisão editada, se houver) pra
  // retomar sem gastar IA de novo.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "ftImportRascunhos", rascunhoId));
        if (snap.exists()) {
          const d = snap.data() as { receitasRaw?: FichaIA[]; criadoEm?: string; nReceitas?: number; revisao?: RevSnap };
          const raw = Array.isArray(d.receitasRaw) ? d.receitasRaw : [];
          const rev = d.revisao && Array.isArray(d.revisao.fichas) ? d.revisao : undefined;
          if (raw.length || rev) setRascunho({ receitasRaw: raw, criadoEm: d.criadoEm || "", nReceitas: d.nReceitas || rev?.fichas.length || raw.length, revisao: rev });
        }
      } catch { /* sem rascunho */ }
    })();
  }, [rascunhoId]);

  useEffect(() => {
    if (fase !== "processando") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [fase]);

  function matchCategoria(nome?: string): string | null {
    if (!nome) return null;
    const n = norm(nome);
    return catsAtivas.find(c => norm(c.nome) === n)?.id || null;
  }
  async function addArquivos(files: FileList | File[]) {
    setErro("");
    for (const file of Array.from(files)) {
      const nome = file.name.toLowerCase();
      const ehPlanilha = /\.(xlsx|xls|csv)$/.test(nome) || file.type.includes("sheet") || file.type === "text/csv";
      try { if (ehPlanilha) { const t = await planilhaParaTexto(file); if (!t.trim()) { setErro("Não consegui ler a planilha."); continue; } setPlanilhaTexto(t); setPlanilhaNome(file.name); } else { const ax = await fileParaAnexo(file); setAnexos(p => [...p, ax]); } }
      catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    }
  }
  async function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items; if (!items) return;
    for (const it of Array.from(items)) if (it.type.startsWith("image/")) { const b = it.getAsFile(); if (b) { const ax = await fileParaAnexo(b); setAnexos(p => [...p, ax]); } }
  }

  async function analisar() {
    if (!temFonte) return;
    setErro("");
    const LOTE = 3;
    const blocos = planilhaTexto ? dividirEmBlocos(planilhaTexto) : [];
    type Un = { itemIds: string[]; payload: { planilha?: string; anexos?: Anexo[] } };
    const unidades: Un[] = [];
    const itensIni: { id: string; nome: string; status: "pendente" }[] = [];
    if (blocos.length > 1) {
      const comId = blocos.map(b => ({ id: uid("it"), nome: nomeDoBloco(b), bloco: b }));
      comId.forEach(x => itensIni.push({ id: x.id, nome: x.nome, status: "pendente" }));
      for (let i = 0; i < comId.length; i += LOTE) { const g = comId.slice(i, i + LOTE); unidades.push({ itemIds: g.map(x => x.id), payload: { planilha: g.map(x => x.bloco).join("\n\n") } }); }
    } else if (planilhaTexto.trim()) { const id = uid("it"); itensIni.push({ id, nome: planilhaNome || "planilha", status: "pendente" }); unidades.push({ itemIds: [id], payload: { planilha: planilhaTexto } }); }
    for (const a of anexos) { const id = uid("it"); itensIni.push({ id, nome: a.nome, status: "pendente" }); unidades.push({ itemIds: [id], payload: { anexos: [a] } }); }

    setItens(itensIni); setFeito(0); setFase("processando");
    const marcar = (ids: string[], status: "lendo" | "ok" | "erro") => setItens(prev => prev.map(it => ids.includes(it.id) ? { ...it, status } : it));

    // 1ª passada (CARA — gasta IA): lê cada unidade e acumula o cru da IA.
    const todasIA: FichaIA[] = [];
    const errosLote: string[] = [];
    for (const u of unidades) {
      marcar(u.itemIds, "lendo");
      try {
        const ia = await importarFichasIA(u.payload);
        for (const f of ia) todasIA.push(f);
        marcar(u.itemIds, "ok");
      } catch (e) { marcar(u.itemIds, "erro"); errosLote.push(e instanceof Error ? e.message : String(e)); }
      setFeito(f => f + u.itemIds.length);
    }
    if (todasIA.length === 0) { setErro(errosLote[0] || "A IA não encontrou nenhuma receita."); setFase("upload"); return; }

    // Salva o cru como rascunho: reprocessar depois (mudanças de código no
    // cliente) NÃO gasta IA de novo — só "Reler com IA" refaz a leitura.
    try {
      await setDocFs(doc(db, "ftImportRascunhos", rascunhoId), sanitizeForFirestore({
        id: rascunhoId, restaurantId: rid, criadoPor: meId || null, criadoPorNome: meNome || null,
        criadoEm: new Date().toISOString(), nReceitas: todasIA.length, receitasRaw: todasIA,
      }));
      setRascunho({ receitasRaw: todasIA, criadoEm: new Date().toISOString(), nReceitas: todasIA.length });
    } catch { /* rascunho é best-effort; não bloqueia a revisão */ }

    const { fichasRev, princ, subN } = processarIA(todasIA);
    setFichas(fichasRev); setPrincipais(princ); setSubNomes(subN);
    if (errosLote.length) setErro(`${errosLote.length} parte(s) falharam e ficaram de fora.`);
    setFase("revisao");
  }

  // Transforma o cru da IA em dados de revisão (filtro de ruído, agrupamento por
  // insumo principal + variações, detecção de subficha). SEM IA — roda offline,
  // então mudar essa lógica e "Retomar" o rascunho não gasta nada.
  function processarIA(iaList: FichaIA[]): { fichasRev: FichaRev[]; princ: Record<string, Principal>; subN: Record<string, string> } {
    const cruas = iaList.map(f => ({
      id: uid("fic"), nome: UP(f.nome) || "(SEM NOME)", ehSubficha: f.ehSubficha ?? true, categoriaId: matchCategoria(f.categoria),
      rendimento: f.rendimento || { qtd: 1, unidade: "kg" },
      ings: (f.ingredientes || []).filter(ing => ing.nome && !RUIDO.has(norm(ing.nome))).map(ing => ({ nome: UP(ing.nome), qtd: ing.qtd || 0, unidade: ing.unidade, qb: !!ing.qb, principal: UP(ing.insumoPrincipal || ing.nome), variacao: UP(ing.variacao || "") })),
    }));
    const fichaPorNome = new Map<string, string>();
    for (const c of cruas) fichaPorNome.set(norm(c.nome), c.id);
    const subN: Record<string, string> = {};
    const princ: Record<string, Principal> = {};
    const fichasRev: FichaRev[] = cruas.map(c => ({
      id: c.id, nome: c.nome, ehSubficha: c.ehSubficha, categoriaId: c.categoriaId, incluir: true, rendimento: c.rendimento,
      ingredientes: c.ings.map(ing => {
        const chave = norm(ing.nome);
        const subId = fichaPorNome.get(chave);
        if (subId && subId !== c.id) { subN[subId] = ing.nome; return { id: uid("ing"), qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb, principalKey: "", variacaoNorm: "", subfichaFichaId: subId }; }
        const pk = norm(ing.principal) || chave;
        const vNorm = norm(ing.variacao);
        if (!princ[pk]) {
          const r = resolverIngrediente({ nome: ing.principal || ing.nome, qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb }, insumos, 0);
          princ[pk] = { key: pk, nome: UP(ing.principal || ing.nome), unidade: ing.unidade, matchInsumoId: r.matchInsumoId, status: r.status, sugestoes: r.sugestoes, novoDimensao: r.novoDimensao, novoUnidadeBase: r.novoUnidadeBase, temBase: false, variacoes: [] };
        }
        if (vNorm) { if (!princ[pk].variacoes.some(v => v.norm === vNorm)) princ[pk].variacoes.push({ norm: vNorm, nome: UP(ing.variacao), fc: 100 }); }
        else princ[pk].temBase = true;
        return { id: uid("ing"), qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb, principalKey: pk, variacaoNorm: vNorm, subfichaFichaId: null };
      }),
    }));
    return { fichasRev, princ, subN };
  }

  // Retoma o rascunho salvo. Se há revisão editada salva, restaura ela (mantém
  // suas associações/edições); senão reprocessa o cru da IA (grátis).
  function retomarRascunho() {
    if (!rascunho) return;
    setErro("");
    if (rascunho.revisao) {
      setFichas(rascunho.revisao.fichas); setPrincipais(rascunho.revisao.principais); setSubNomes(rascunho.revisao.subNomes);
    } else {
      const { fichasRev, princ, subN } = processarIA(rascunho.receitasRaw);
      setFichas(fichasRev); setPrincipais(princ); setSubNomes(subN);
    }
    setFase("revisao");
  }

  async function descartarRascunho() {
    try { await deleteDoc(doc(db, "ftImportRascunhos", rascunhoId)); } catch { /* ignore */ }
    setRascunho(null);
  }

  // Salva a revisão atual (com edições/associações) como rascunho e fecha, sem
  // gravar as fichas. Reabrir → banner "Retomar" restaura exatamente daqui.
  async function salvarRascunhoRevisao() {
    setSalvando(true); setErro("");
    const criadoEm = new Date().toISOString();
    const revisao: RevSnap = { fichas, principais, subNomes };
    try {
      await setDocFs(doc(db, "ftImportRascunhos", rascunhoId), sanitizeForFirestore({
        id: rascunhoId, restaurantId: rid, criadoPor: meId || null, criadoPorNome: meNome || null,
        criadoEm, nReceitas: fichas.length, receitasRaw: rascunho?.receitasRaw || [], revisao,
      }));
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setSalvando(false); }
  }

  // Associa este insumo a OUTRO da mesma importação (ex.: "AÇÚCAR" → "AÇÚCAR
  // REFINADO"): remapeia os usos e funde as variações no destino.
  function mesclarPrincipais(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setPrincipais(prev => {
      const from = prev[fromKey], to = prev[toKey];
      if (!from || !to) return prev;
      const next = { ...prev };
      const jaTem = new Set(to.variacoes.map(v => v.norm));
      next[toKey] = { ...to, temBase: to.temBase || from.temBase, variacoes: [...to.variacoes, ...from.variacoes.filter(v => !jaTem.has(v.norm))] };
      delete next[fromKey];
      return next;
    });
    setFichas(prev => prev.map(f => ({ ...f, ingredientes: f.ingredientes.map(ing => ing.principalKey === fromKey ? { ...ing, principalKey: toKey } : ing) })));
  }

  // edições
  const setPrinc = (k: string, patch: Partial<Principal>) => setPrincipais(p => ({ ...p, [k]: { ...p[k], ...patch } }));
  const setVar = (k: string, vNorm: string, patch: Partial<VarInfo>) => setPrincipais(p => ({ ...p, [k]: { ...p[k], variacoes: p[k].variacoes.map(v => v.norm === vNorm ? { ...v, ...patch } : v) } }));
  const setFicha = (id: string, patch: Partial<FichaRev>) => setFichas(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  const catTodas = (id: string) => setFichas(prev => prev.map(f => ({ ...f, categoriaId: id || null })));

  // "Não é variação, é um insumo próprio": tira a variação do principal e cria
  // um insumo standalone; remapeia os ingredientes que a usavam.
  function promoverVariacao(pk: string, vNorm: string) {
    const p = principais[pk]; const v = p?.variacoes.find(x => x.norm === vNorm);
    if (!p || !v) return;
    const newKey = norm(v.nome) || uid("p");
    setPrincipais(prev => {
      const next = { ...prev };
      next[pk] = { ...p, variacoes: p.variacoes.filter(x => x.norm !== vNorm) };
      if (!next[newKey]) {
        const r = resolverIngrediente({ nome: v.nome, qtd: 1, unidade: p.unidade, qb: false }, insumos, 0);
        next[newKey] = { key: newKey, nome: UP(v.nome), unidade: p.unidade, matchInsumoId: r.matchInsumoId, status: r.status, sugestoes: r.sugestoes, novoDimensao: r.novoDimensao, novoUnidadeBase: r.novoUnidadeBase, temBase: true, variacoes: [] };
      } else { next[newKey] = { ...next[newKey], temBase: true }; }
      return next;
    });
    setFichas(prev => prev.map(f => ({ ...f, ingredientes: f.ingredientes.map(ing => ing.principalKey === pk && ing.variacaoNorm === vNorm ? { ...ing, principalKey: newKey, variacaoNorm: "" } : ing) })));
  }

  // "Isto é um preparo (ex.: ALHO NO ÓLEO = alho + óleo), não um insumo": cria
  // uma NOVA subficha vazia e aponta os usos pra ela. Os ingredientes internos
  // (e rendimento) você monta na tela de Fichas depois. Se vNorm, promove só a
  // variação; senão, o uso-base do principal.
  function promoverParaSubficha(pk: string, vNorm?: string) {
    const p = principais[pk]; if (!p) return;
    const v = vNorm ? p.variacoes.find(x => x.norm === vNorm) : undefined;
    if (vNorm && !v) return;
    const nome = UP(v ? v.nome : p.nome);
    const newId = uid("fic");
    const nova: FichaRev = { id: newId, nome, ehSubficha: true, categoriaId: null, incluir: true, rendimento: { qtd: 1, unidade: "kg" }, ingredientes: [] };
    setFichas(prev => [
      ...prev.map(f => ({ ...f, ingredientes: f.ingredientes.map(ing =>
        ing.principalKey === pk && (vNorm ? ing.variacaoNorm === vNorm : ing.variacaoNorm === "")
          ? { ...ing, subfichaFichaId: newId, principalKey: "", variacaoNorm: "" } : ing) })),
      nova,
    ]);
    setSubNomes(prev => ({ ...prev, [newId]: nome }));
    setPrincipais(prev => {
      const cur = prev[pk]; if (!cur) return prev;
      return { ...prev, [pk]: vNorm ? { ...cur, variacoes: cur.variacoes.filter(x => x.norm !== vNorm) } : { ...cur, temBase: false } };
    });
  }

  const usoPrincipal = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of fichas) if (f.incluir) for (const ing of f.ingredientes) if (!ing.subfichaFichaId) c[ing.principalKey] = (c[ing.principalKey] || 0) + 1;
    return c;
  }, [fichas]);
  const usoSub = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of fichas) if (f.incluir) for (const ing of f.ingredientes) if (ing.subfichaFichaId) c[ing.subfichaFichaId] = (c[ing.subfichaFichaId] || 0) + 1;
    return c;
  }, [fichas]);

  const principaisLista = useMemo(() => Object.values(principais).filter(p => (usoPrincipal[p.key] || 0) > 0).sort((a, b) => a.nome.localeCompare(b.nome)), [principais, usoPrincipal]);
  const subLista = useMemo(() => Object.entries(subNomes).filter(([id]) => (usoSub[id] || 0) > 0).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)), [subNomes, usoSub]);
  const cont = useMemo(() => {
    let casado = 0, novo = 0, conferir = 0;
    for (const p of principaisLista) { if (p.status === "casado") casado++; else if (p.status === "novo") novo++; else conferir++; }
    return { casado, novo, conferir, subs: subLista.length, insumos: principaisLista.length };
  }, [principaisLista, subLista]);
  const nSel = fichas.filter(f => f.incluir).length;

  async function gravar() {
    if (nSel === 0) { setErro("Selecione ao menos uma receita."); return; }
    setFase("gravando");
    try {
      const batch = writeBatch(db); const now = new Date().toISOString();
      const incluidas = fichas.filter(f => f.incluir);
      // principais usados
      const usadosKeys = new Set<string>();
      for (const f of incluidas) for (const ing of f.ingredientes) if (!ing.subfichaFichaId) usadosKeys.add(ing.principalKey);
      // cria/atualiza insumos (1 por principal), com variações
      const insumoIdPorPrincipal = new Map<string, string>();
      for (const key of usadosKeys) {
        const p = principais[key]; if (!p) continue;
        const varsImport: FtInsumoVariacao[] = p.variacoes.map(v => ({ id: uid("var"), nome: UP(v.nome), fc: v.fc > 0 ? v.fc : 100 }));
        if (p.matchInsumoId) {
          insumoIdPorPrincipal.set(key, p.matchInsumoId);
          if (varsImport.length) {
            const exist = insumos.find(i => i.id === p.matchInsumoId);
            const jaTem = new Set((exist?.variacoes || []).map(v => norm(v.nome)));
            const merge = [...(exist?.variacoes || []), ...varsImport.filter(v => !jaTem.has(norm(v.nome)))];
            batch.update(doc(db, "ftInsumos", p.matchInsumoId), sanitizeForFirestore({ variacoes: merge }));
          }
        } else {
          const id = uid("ins"); insumoIdPorPrincipal.set(key, id);
          batch.set(doc(db, "ftInsumos", id), sanitizeForFirestore({
            id, restaurantId: rid, nome: UP(p.nome), nomeNormalizado: key, dimensao: p.novoDimensao, unidadeBase: p.novoUnidadeBase,
            custo: 0, custoAtualizadoEm: null, historicoCusto: [], fornecedorPadrao: null, reutilizavel: false, variacoes: varsImport, aliases: [], ativo: true,
          } as FtInsumo));
        }
      }
      for (const f of incluidas) {
        const ingredientes: FtIngrediente[] = f.ingredientes.map(ing => {
          if (ing.subfichaFichaId) return { id: uid("ing"), tipo: "ficha", refId: ing.subfichaFichaId, nomeSnapshot: subNomes[ing.subfichaFichaId] || "", qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb } as FtIngrediente;
          const p = principais[ing.principalKey];
          const insumoId = insumoIdPorPrincipal.get(ing.principalKey) || "";
          const v = ing.variacaoNorm ? p?.variacoes.find(x => x.norm === ing.variacaoNorm) : undefined;
          return { id: uid("ing"), tipo: "insumo", refId: insumoId, nomeSnapshot: UP(p?.nome || ""), qtd: ing.qtd, unidade: ing.unidade, qb: ing.qb, ...(v ? { variacaoNome: UP(v.nome), fc: v.fc } : {}) } as FtIngrediente;
        });
        batch.set(doc(db, "ftFichas", f.id), sanitizeForFirestore({
          id: f.id, restaurantId: rid, nome: UP(f.nome), nomeNormalizado: norm(f.nome), ehSubficha: f.ehSubficha, categoriaId: f.categoriaId,
          rendimento: f.rendimento, ingredientes, ativo: true, criadoEm: now, criadoPor: meId, criadoPorNome: meNome,
        } as FtFicha));
      }
      await batch.commit();
      try { await deleteDoc(doc(db, "ftImportRascunhos", rascunhoId)); } catch { /* rascunho já foi consumido */ }
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setFase("revisao"); }
  }

  return (
    <Modal title="Importar receita (IA)" onClose={onClose} maxWidth="max-w-3xl">
      {fase === "upload" && (
        <div className="py-1" onPaste={onPaste}>
          {rascunho && (
            <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-900/20 p-3">
              <div className="text-sm font-medium text-indigo-800 dark:text-indigo-200">📌 {rascunho.revisao ? "Rascunho salvo" : "Leitura salva"}: {rascunho.nReceitas} receita{rascunho.nReceitas === 1 ? "" : "s"}</div>
              <div className="text-xs text-indigo-600 dark:text-indigo-300 mt-0.5">{rascunho.revisao ? "Com suas edições" : "Lida"} em {rascunho.criadoEm ? fmtBRDateTime(rascunho.criadoEm) : "—"}. Retome sem gastar IA de novo.</div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button onClick={retomarRascunho}>↩️ Retomar revisão</Button>
                <Button variant="secondary" onClick={() => void descartarRascunho()}>🗑️ Descartar</Button>
              </div>
            </div>
          )}
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
              {anexos.map((a, i) => <div key={i} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800"><span>{a.mediaType === "application/pdf" ? "📕" : "🖼️"}</span><span className="flex-1 truncate">{a.nome}</span><button type="button" onClick={() => setAnexos(p => p.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600 text-xs">remover</button></div>)}
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
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Roda no navegador: pode <strong>alternar de janela/app</strong>, mas <strong>não feche esta aba</strong> até terminar.</p>
        </div>
      )}

      {(fase === "revisao" || fase === "gravando") && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
            <span className="text-gray-600 dark:text-gray-300 font-medium">{fichas.length} receita(s) · {cont.insumos} insumo(s){cont.subs ? ` · ${cont.subs} subficha(s)` : ""}:</span>
            <span className={`px-2 py-0.5 rounded-full ${CHIP.casado}`}>{cont.casado} casados</span>
            <span className={`px-2 py-0.5 rounded-full ${CHIP.novo}`}>{cont.novo} novos</span>
            {cont.conferir > 0 && <span className={`px-2 py-0.5 rounded-full ${CHIP.conferir}`}>{cont.conferir} a conferir</span>}
            <div className="flex-1" />
            <span className="text-gray-400">Categoria de todas:</span>
            <select onChange={e => catTodas(e.target.value)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"><option value="">— escolher —</option>{catsAtivas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-4">
            {/* Ingredientes (insumos + variações) */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200">Insumos ({cont.insumos}) — principal + variações</div>
              <div className="p-2 space-y-2">
                {principaisLista.map(p => (
                  <div key={p.key}>
                    <div className="flex items-center gap-2 text-sm">
                      <input value={p.nome} onChange={e => setPrinc(p.key, { nome: e.target.value.toUpperCase() })} className="w-32 sm:w-52 shrink-0 bg-transparent font-medium text-gray-800 dark:text-gray-200 outline-none border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-solid focus:border-indigo-500 px-0.5" />
                      <span className="text-[11px] text-gray-400 shrink-0 w-16">{usoPrincipal[p.key]} uso(s)</span>
                      <select value={p.matchInsumoId ?? "__novo__"} onChange={e => { const val = e.target.value; if (val.startsWith("merge:")) { mesclarPrincipais(p.key, val.slice(6)); return; } setPrinc(p.key, val === "__novo__" ? { matchInsumoId: null, status: "novo" } : { matchInsumoId: val, status: "casado" }); }} className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                        {p.sugestoes.map(s => <option key={s.id} value={s.id}>{s.nome} · {labelUnidade(s.unidadeBase)}</option>)}
                        <option value="__novo__">+ criar novo insumo</option>
                        {principaisLista.some(o => o.key !== p.key) && (
                          <optgroup label="↔ Juntar com outro desta importação">
                            {principaisLista.filter(o => o.key !== p.key).map(o => <option key={o.key} value={`merge:${o.key}`}>é o mesmo que {o.nome}</option>)}
                          </optgroup>
                        )}
                      </select>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${CHIP[p.status]}`}>{p.status === "casado" ? "reconhecido" : p.status}</span>
                      <button type="button" onClick={() => promoverParaSubficha(p.key)} title="Isto é um preparo (ex.: alho no óleo) — virar subficha" className="text-[10px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-purple-600 hover:border-purple-400 shrink-0">é subficha ↧</button>
                    </div>
                    {p.variacoes.map(v => (
                      <div key={v.norm} className="flex items-center gap-2 text-sm pl-6 mt-1">
                        <span className="text-indigo-500 text-xs shrink-0">↳</span>
                        <input value={v.nome} onChange={e => setVar(p.key, v.norm, { nome: e.target.value.toUpperCase() })} className="w-28 sm:w-40 shrink-0 bg-transparent text-indigo-700 dark:text-indigo-300 outline-none border-b border-dashed border-indigo-300 dark:border-indigo-700 focus:border-solid px-0.5" />
                        <span className="text-[11px] text-gray-400">aprov.</span>
                        <div className="flex items-center rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5"><input type="number" value={v.fc} onChange={e => setVar(p.key, v.norm, { fc: Number(e.target.value) || 0 })} className="w-12 py-1 bg-transparent text-right text-xs outline-none dark:text-gray-100" /><span className="text-[10px] text-gray-400">%</span></div>
                        <button type="button" onClick={() => promoverVariacao(p.key, v.norm)} title="Não é variação — virar insumo próprio" className="text-[10px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-indigo-600 hover:border-indigo-400">é insumo ↑</button>
                        <button type="button" onClick={() => promoverParaSubficha(p.key, v.norm)} title="É um preparo — virar subficha" className="text-[10px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-purple-600 hover:border-purple-400">é subficha ↧</button>
                        <button type="button" onClick={() => setPrinc(p.key, { variacoes: p.variacoes.filter(x => x.norm !== v.norm) })} title="Não é variação separada — tratar como o insumo base (o ingrediente continua na receita)" className="text-gray-400 hover:text-red-600 text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                ))}
                {subLista.length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-2 mt-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Reconhecidas como subficha</div>
                    {subLista.map(s => (
                      <div key={s.id} className="flex items-center gap-2 text-sm py-0.5">
                        <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0"></span>
                        <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{s.nome}</span>
                        <span className="text-[11px] text-gray-400">{usoSub[s.id]} uso(s)</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CHIP.subficha}`}>subficha</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Receitas */}
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
                      const sub = ing.subfichaFichaId ? subNomes[ing.subfichaFichaId] : null;
                      const p = ing.principalKey ? principais[ing.principalKey] : undefined;
                      const v = p && ing.variacaoNorm ? p.variacoes.find(x => x.norm === ing.variacaoNorm) : undefined;
                      const nome = sub || (p ? p.nome : "?");
                      return (
                        <div key={ing.id} className="flex items-center gap-2 text-sm">
                          <span className="w-28 sm:w-56 shrink-0 truncate text-gray-700 dark:text-gray-200">{nome}{v && <span className="text-indigo-600 dark:text-indigo-400"> ↳ {v.nome}</span>}</span>
                          <span className="text-xs text-gray-500 tabular-nums shrink-0 w-16 text-right">{ing.qb ? "q.b." : `${ing.qtd} ${labelUnidade(ing.unidade)}`}</span>
                          <div className="flex-1" />
                          {sub ? <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CHIP.subficha}`}>subficha</span>
                            : <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CHIP[p?.status || "novo"]}`}>{(p?.status || "novo") === "casado" ? "reconhecido" : (p?.status || "novo")}</span>}
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
              <Button variant="secondary" onClick={onClose} disabled={fase === "gravando" || salvando}>Cancelar</Button>
              <Button variant="secondary" onClick={() => void salvarRascunhoRevisao()} disabled={fase === "gravando" || salvando} title="Salva suas edições pra continuar depois, sem gravar as fichas">{salvando ? "Salvando…" : "💾 Salvar rascunho"}</Button>
              <Button onClick={gravar} disabled={fase === "gravando" || salvando || nSel === 0}>{fase === "gravando" ? "Gravando…" : `Aprovar e gravar ${nSel}`}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
