// ════════════════════════════════════════════════════════════════════════════
//  Gestão de Insumos — tela ÚNICA usada tanto em Contagens quanto em Compras.
//  Cadastro dos insumos (nome, categoria, unidade, estoque mínimo, fornecedor,
//  pacote, pedido mínimo) + Sugeridos do recebimento (IA) + Mesclar duplicados.
//  É a base da contagem e da sugestão de pedido. Autocontido: carrega os próprios
//  dados (insumos/fornecedores/recebimentos) — os dois módulos só montam o componente.
// ════════════════════════════════════════════════════════════════════════════
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Package, Plus, Sparkles, Truck, Link2, Loader2, Layers, EyeOff, RotateCcw, GitMerge, Ruler, Save } from "lucide-react";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db, auth } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { UNIDADES_LABEL } from "../../core/types";
import type { Fornecedor, Insumo, InsumoFornecedor, RecebimentoNota, UnidadeMedida } from "../../core/types";
import { InsumoModal, type OpcaoPreco } from "./InsumoModal";
import { agruparSugestoes, normalizar, tituloCaso, levenshtein, criarIndiceInsumos, type SugestaoInsumo, type GrupoSugerido } from "./sugestoesRecebimento";
import { MesclarInsumosModal } from "./MesclarInsumosModal";
import { NotaViewModal } from "./NotaViewModal";
import { SugeridosTabela, type EdicaoGrupo } from "./SugeridosTabela";

type IaInfo = { nomeLimpo?: string; qtdPorPacote?: number; categoria?: string; unidade?: UnidadeMedida; grupo?: string; matchInsumoId?: string | null };

export function InsumosManager({ rid, podeConfig }: { rid: string; podeConfig: boolean }) {
  const { pessoa: me } = useAuth();

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [recebimentos, setRecebimentos] = useState<RecebimentoNota[]>([]);

  const [editing, setEditing] = useState<Insumo | "new" | null>(null);
  const [preset, setPreset] = useState<Partial<Insumo> | null>(null);
  const [autoReav, setAutoReav] = useState(false);
  const [presetNomesOrig, setPresetNomesOrig] = useState<string[] | undefined>(undefined);
  const [presetOpcoes, setPresetOpcoes] = useState<OpcaoPreco[] | undefined>(undefined);
  const [notaView, setNotaView] = useState<{ nota: RecebimentoNota; grafia: string } | null>(null);
  const [searchConfig, setSearchConfig] = useState("");
  const [soRecorrentes, setSoRecorrentes] = useState(true);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const [sugeridosView, setSugeridosView] = useState<"lista" | "tabela">("tabela");
  // Mobile usa sempre a LISTA (a tabela larga fica apertada). Toggle só no desktop.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const h = () => setIsMobile(mq.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h);
  }, []);
  const viewEfetiva = isMobile ? "lista" : sugeridosView;
  const [iaMapa, setIaMapa] = useState<Record<string, IaInfo>>({});
  const iaEmAndamento = useRef(false);
  const [reavaliando, setReavaliando] = useState(false);
  const [mesclando, setMesclando] = useState(false);
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());
  const [naoDuplicatas, setNaoDuplicatas] = useState<Set<string>>(new Set());
  const [verMatchIA, setVerMatchIA] = useState(false);   // revelar as que a IA casou com insumo existente
  const [vinculando, setVinculando] = useState<GrupoSugerido | null>(null);   // "já cadastrado" → escolher qual insumo
  // Organização da lista: por produto (categoria) ou por fornecedor.
  const [agrupamento, setAgrupamento] = useState<"produto" | "fornecedor">("produto");
  // Definir estoque mínimo em LOTE (abre um campo por produto; salva tudo de uma vez).
  const [editandoMin, setEditandoMin] = useState(false);
  const [minEdits, setMinEdits] = useState<Record<string, string>>({});
  const [salvandoMin, setSalvandoMin] = useState(false);

  // ── Dados ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo);
      list.sort((a, b) => (a.categoria || "ZZ").localeCompare(b.categoria || "ZZ") || (a.nome || "").localeCompare(b.nome || ""));
      setInsumos(list);
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fornecedores"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor)));
  }, [rid]);

  useEffect(() => {
    if (!rid || !podeConfig) { setRecebimentos([]); return; }
    const q = query(collection(db, "recebimentos"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => setRecebimentos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RecebimentoNota).filter(n => !n.excluidoEm)), () => setRecebimentos([]));
  }, [rid, podeConfig]);

  // Cache da leitura da IA (insumosIaCache/{rid}).
  useEffect(() => {
    if (!rid || !podeConfig) { setIaMapa({}); return; }
    return onSnapshot(doc(db, "insumosIaCache", rid), (snap) => {
      const arr = (snap.data() as { itens?: Array<{ chave: string } & IaInfo> } | undefined)?.itens;
      const m: Record<string, IaInfo> = {};
      if (Array.isArray(arr)) for (const it of arr) { const { chave, ...info } = it; if (chave) m[chave] = info; }
      setIaMapa(m);
    }, () => {});
  }, [rid, podeConfig]);
  async function gravarIaCache(novo: Record<string, IaInfo>) {
    if (!rid) return;
    const itens = Object.entries(novo).map(([chave, info]) => ({ chave, ...info }));
    await setDoc(doc(db, "insumosIaCache", rid), sanitizeForFirestore({ restaurantId: rid, itens, atualizadoEm: new Date().toISOString() }), { merge: true });
  }

  useEffect(() => {
    if (!rid || !podeConfig) return;
    getDoc(doc(db, "insumosIgnorados", rid)).then((snap) => {
      const arr = (snap.data() as { chaves?: string[] } | undefined)?.chaves;
      if (Array.isArray(arr)) setIgnorados(new Set(arr));
    }).catch(() => {});
  }, [rid, podeConfig]);
  function salvarIgnorados(set: Set<string>) {
    setIgnorados(set);
    if (rid) void setDoc(doc(db, "insumosIgnorados", rid), sanitizeForFirestore({ restaurantId: rid, chaves: [...set], atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
  }

  useEffect(() => {
    if (!rid || !podeConfig) return;
    getDoc(doc(db, "insumosNaoDuplicatas", rid)).then((snap) => {
      const arr = (snap.data() as { pares?: string[] } | undefined)?.pares;
      if (Array.isArray(arr)) setNaoDuplicatas(new Set(arr));
    }).catch(() => {});
  }, [rid, podeConfig]);
  function salvarNaoDuplicatas(set: Set<string>) {
    setNaoDuplicatas(set);
    if (rid) void setDoc(doc(db, "insumosNaoDuplicatas", rid), sanitizeForFirestore({ restaurantId: rid, pares: [...set], atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
  }
  const parKey = (a: string, b: string) => [normalizar(a), normalizar(b)].sort().join("||");
  function marcarDiferentes(cluster: GrupoSugerido[]) {
    const n = new Set(naoDuplicatas);
    for (let i = 0; i < cluster.length; i++) for (let j = i + 1; j < cluster.length; j++) n.add(parKey(cluster[i].nome, cluster[j].nome));
    salvarNaoDuplicatas(n);
  }

  function abrirNotaDaGrafia(grafia: string) {
    const alvo = normalizar(grafia);
    const cand = recebimentos
      .filter(n => (n.itens || []).some(it => normalizar(it.descricao || "") === alvo))
      .sort((a, b) => (b.recebidoEm || "").localeCompare(a.recebidoEm || ""));
    if (cand[0]) setNotaView({ nota: cand[0], grafia });
  }
  const grafiasDe = (gs: GrupoSugerido[]): string[] => {
    const seen = new Set<string>(); const out: { nome: string; oc: number }[] = [];
    for (const g of gs) for (const m of g.membros) { const k = m.nome.trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push({ nome: m.nome, oc: m.ocorrencias }); }
    return out.sort((a, b) => b.oc - a.oc).map(x => x.nome);
  };

  // ── Sugeridos + IA ─────────────────────────────────────────────────────────
  const sugestoes = useMemo(() => agruparSugestoes(recebimentos, insumos, fornecedores), [recebimentos, insumos, fornecedores]);
  // Casa a sugestão com um insumo já cadastrado: pelo matchInsumoId da IA, OU pelo
  // NOME LIMPO da IA / nome da sugestão (não só a grafia crua da nota). Devolve o id.
  const insumoIds = useMemo(() => new Set(insumos.map(i => i.id)), [insumos]);
  const idxInsumos = useMemo(() => criarIndiceInsumos(insumos), [insumos]);
  const resolverMatch = (s: SugestaoInsumo): string | null => {
    const mid = iaMapa[s.chave]?.matchInsumoId;
    if (mid && insumoIds.has(mid)) return mid;
    return idxInsumos.achar(iaMapa[s.chave]?.nomeLimpo) || idxInsumos.achar(s.nome) || null;
  };
  const baseNovas = useMemo(() => sugestoes.filter(s => !s.jaCadastrado && !ignorados.has(s.chave) && (!soRecorrentes || s.ocorrencias >= 2)), [sugestoes, soRecorrentes, ignorados]);
  // Esconde as que já existem (IA ou nome limpo), salvo quando o usuário pede pra ver.
  const ocultasIA = useMemo(() => baseNovas.filter(s => resolverMatch(s)).length, [baseNovas, iaMapa, idxInsumos, insumoIds]);
  const sugestoesNovas = useMemo(() => verMatchIA ? baseNovas : baseNovas.filter(s => !resolverMatch(s)), [baseNovas, verMatchIA, iaMapa, idxInsumos, insumoIds]);

  // MEMÓRIA: quando a IA reconhece que uma grafia de nota é um insumo que já existe
  // (matchInsumoId), grava essa grafia como ALIAS permanente daquele insumo. Assim o
  // produto passa a ser reconhecido pra sempre por match EXATO — não depende mais do
  // cache da IA nem de re-avaliar, mesmo depois de renomeado. Guardado por ref pra
  // não reescrever em loop.
  const aliasFeitos = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!rid || !podeConfig) return;
    const porInsumo = new Map<string, string[]>();
    for (const s of sugestoes) {
      if (s.jaCadastrado || aliasFeitos.current.has(s.chave)) continue;
      const mid = resolverMatch(s);
      if (!mid) continue;
      const alvo = insumos.find(i => i.id === mid); if (!alvo) continue;
      if ((alvo.aliases || []).map(normalizar).includes(s.chave)) { aliasFeitos.current.add(s.chave); continue; }
      aliasFeitos.current.add(s.chave);   // marca ANTES de escrever (evita re-fila no re-render)
      const arr = porInsumo.get(mid) || []; arr.push(s.chave); porInsumo.set(mid, arr);
    }
    if (!porInsumo.size) return;
    (async () => {
      for (const [mid, novos] of porInsumo) {
        const alvo = insumos.find(i => i.id === mid); if (!alvo) continue;
        const aliases = Array.from(new Set([...(alvo.aliases || []).map(normalizar), ...novos]));
        try { await updateDoc(doc(db, "insumos", mid), sanitizeForFirestore({ aliases, atualizadoEm: new Date().toISOString() })); }
        catch { for (const c of novos) aliasFeitos.current.delete(c); }   // falhou: permite tentar de novo depois
      }
    })();
  }, [sugestoes, iaMapa, insumos, insumoIds, rid, podeConfig]);

  useEffect(() => {
    if (!sugestoesAbertas || !podeConfig) return;
    const faltando = sugestoesNovas.filter(s => !iaMapa[s.chave]);
    if (faltando.length === 0 || iaEmAndamento.current) return;
    const lote = faltando.slice(0, 40);
    iaEmAndamento.current = true;
    (async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const r = await fetch("/api/contagens-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          idToken,
          produtos: lote.map(s => ({ chave: s.chave, nome: s.nome, unidadeAtual: s.unidade })),
          jaCadastrados: insumos.map(i => ({ id: i.id, nome: i.nome, aliases: i.aliases || [] })),
        }) });
        const j = await r.json() as { itens?: Array<{ chave: string; nomeLimpo?: string; qtdPorPacote?: number; categoria?: string; unidade?: string; grupo?: string; matchInsumoId?: string | null }> };
        const n = { ...iaMapa };
        for (const s of lote) n[s.chave] = n[s.chave] || {};
        if (Array.isArray(j.itens)) for (const it of j.itens) if (it?.chave) n[it.chave] = { nomeLimpo: it.nomeLimpo, qtdPorPacote: it.qtdPorPacote, categoria: it.categoria, unidade: it.unidade as UnidadeMedida, grupo: it.grupo, matchInsumoId: it.matchInsumoId ?? null };
        await gravarIaCache(n);
      } catch {
        const n = { ...iaMapa }; for (const s of lote) n[s.chave] = n[s.chave] || {}; await gravarIaCache(n).catch(() => {});
      } finally { iaEmAndamento.current = false; }
    })();
  }, [sugestoesAbertas, sugestoesNovas, podeConfig, insumos, iaMapa]);

  const gruposSugeridos = useMemo(() => {
    const map = new Map<string, SugestaoInsumo[]>();
    for (const s of sugestoesNovas) { const g = iaMapa[s.chave]?.grupo || s.chave; const arr = map.get(g); if (arr) arr.push(s); else map.set(g, [s]); }
    const grupos = [...map.entries()].map(([grupo, membros]) => {
      const principal = membros.slice().sort((a, b) => b.ocorrencias - a.ocorrencias)[0];
      const ia = iaMapa[principal.chave] || {};
      const fm = new Map<string, { nome: string; count: number }>();
      for (const m of membros) for (const f of m.fornecedores) { const k = normalizar(f.nome); const e = fm.get(k) || { nome: f.nome, count: 0 }; e.count += f.count; fm.set(k, e); }
      const fornecedores = [...fm.values()].sort((a, b) => b.count - a.count);
      const matchInsumoId = membros.map(m => iaMapa[m.chave]?.matchInsumoId).find(Boolean) || null;
      const fator = ia.qtdPorPacote && ia.qtdPorPacote > 1 ? Math.round(ia.qtdPorPacote) : 1;
      return {
        grupo, membros, nome: ia.nomeLimpo?.trim() || principal.nome,
        categoria: ia.categoria, unidade: (ia.unidade as UnidadeMedida) || principal.unidade, unidadeOutroLabel: principal.unidadeOutroLabel,
        precoEstimado: principal.precoEstimado, fator, matchInsumoId, fornecedores,
        aliases: membros.map(m => m.chave), ocorrencias: Math.max(...membros.map(m => m.ocorrencias)),
      } as GrupoSugerido;
    });
    return grupos.sort((a, b) => b.ocorrencias - a.ocorrencias || a.nome.localeCompare(b.nome));
  }, [sugestoesNovas, iaMapa]);
  const iaPendentes = useMemo(() => sugestoesNovas.filter(s => !iaMapa[s.chave]).length, [sugestoesNovas, iaMapa]);
  const unidadesCustom = useMemo(() => [...new Set(insumos.filter(i => i.unidade === "outro" && i.unidadeOutroLabel).map(i => (i.unidadeOutroLabel as string).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [insumos]);

  const duplicatasProvaveis = useMemo(() => {
    const gs = gruposSugeridos;
    if (gs.length < 2) return [] as GrupoSugerido[][];
    const norm = gs.map(g => normalizar(g.nome));
    const parent = gs.map((_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const a = norm[i], b = norm[j];
        const lim = Math.max(a.length, b.length);
        if (lim < 5) continue;
        if (naoDuplicatas.has([a, b].sort().join("||"))) continue;
        const d = levenshtein(a, b);
        if (d >= 1 && d <= 2 && d / lim <= 0.25) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, GrupoSugerido[]>();
    gs.forEach((g, i) => { const r = find(i); const arr = clusters.get(r); if (arr) arr.push(g); else clusters.set(r, [g]); });
    return [...clusters.values()].filter(c => c.length >= 2)
      .sort((a, b) => b.reduce((s, g) => s + g.ocorrencias, 0) - a.reduce((s, g) => s + g.ocorrencias, 0));
  }, [gruposSugeridos, naoDuplicatas]);

  // ── Cadastro / fornecedores ─────────────────────────────────────────────────
  async function garantirFornecedor(nome: string): Promise<string | undefined> {
    const alvo = normalizar(nome);
    if (!alvo) return undefined;
    const existente = fornecedores.find(f => normalizar(f.nome) === alvo);
    if (existente) return existente.id;
    if (!me) return undefined;
    const ref = await addDoc(collection(db, "fornecedores"), sanitizeForFirestore({
      restaurantId: rid, nome: tituloCaso(nome), ativo: true, criadoEm: new Date().toISOString(), criadoPor: me.id,
    }));
    return ref.id;
  }
  async function montarFornecedores(fs: { nome: string; count: number; preco?: number }[]): Promise<{ lista: InsumoFornecedor[]; primeiroId?: string }> {
    const lista: InsumoFornecedor[] = []; let primeiroId: string | undefined;
    for (let i = 0; i < fs.length; i++) { const id = await garantirFornecedor(fs[i].nome); if (i === 0) primeiroId = id; lista.push({ nome: tituloCaso(fs[i].nome), fornecedorId: id || null, primario: i === 0 }); }
    return { lista, primeiroId };
  }

  async function reavaliarTodos() {
    if (sugestoesNovas.length === 0) return;
    if (!window.confirm(`Reavaliar ${sugestoesNovas.length} sugestões pela IA em segundo plano?\n\nPode sair da tela — o resultado aparece sozinho.`)) return;
    setReavaliando(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/contagens-ia-lote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        idToken, rid,
        produtos: sugestoesNovas.map(s => ({ chave: s.chave, nome: s.nome, unidadeAtual: s.unidade })),
        jaCadastrados: insumos.map(i => ({ id: i.id, nome: i.nome, aliases: i.aliases || [] })),
      }) });
      const j = await r.json().catch(() => ({})) as { restantes?: number };
      if ((j.restantes ?? 0) > 0) window.alert(`Reavaliou parte. Faltaram ${j.restantes} (limite de tempo) — clique de novo pra continuar.`);
    } catch { /* roda no servidor mesmo assim */ } finally { setReavaliando(false); }
  }

  async function reavaliarSelecionados(grupos: GrupoSugerido[]) {
    const produtos = grupos.flatMap(g => g.membros.map(m => ({ chave: m.chave, nome: m.nome, unidadeAtual: m.unidade })));
    if (produtos.length === 0) return;
    setReavaliando(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch("/api/contagens-ia-lote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        idToken, rid, produtos,
        jaCadastrados: insumos.map(i => ({ id: i.id, nome: i.nome, aliases: i.aliases || [] })),
      }) });
    } catch { /* roda no servidor mesmo assim */ } finally { setReavaliando(false); }
  }

  function ignorarGrupo(g: GrupoSugerido) { const n = new Set(ignorados); for (const a of g.aliases) n.add(a); salvarIgnorados(n); }
  function restaurarIgnorados() { salvarIgnorados(new Set()); }

  function abrirGrupoNoModal(g: GrupoSugerido) {
    const fornList: InsumoFornecedor[] = g.fornecedores.map((f, i) => ({ nome: tituloCaso(f.nome), fornecedorId: fornecedores.find(x => normalizar(x.nome) === normalizar(f.nome))?.id || null, primario: i === 0 }));
    const fator = g.fator && g.fator > 1 ? g.fator : undefined;
    const precoUnit = g.precoEstimado != null && fator ? g.precoEstimado / fator : g.precoEstimado;
    setPreset({ nome: g.nome, categoria: g.categoria, unidade: g.unidade, unidadeOutroLabel: g.unidadeOutroLabel, precoEstimado: precoUnit, fatorCompra: fator, aliases: g.aliases, fornecedores: fornList, fornecedorPreferredId: fornList[0]?.fornecedorId || null });
    setPresetNomesOrig(grafiasDe([g])); setPresetOpcoes(undefined); setAutoReav(false); setEditing("new");
  }

  function juntarGrupos(grupos: GrupoSugerido[]) {
    if (grupos.length < 2) return;
    const dom = [...grupos].sort((a, b) => b.ocorrencias - a.ocorrencias)[0];
    const fornMap = new Map<string, { nome: string; count: number }>();
    for (const g of grupos) for (const f of g.fornecedores) {
      const k = normalizar(f.nome); const cur = fornMap.get(k);
      if (cur) cur.count += f.count; else fornMap.set(k, { nome: f.nome, count: f.count });
    }
    const fornOrd = [...fornMap.values()].sort((a, b) => b.count - a.count);
    const fornList: InsumoFornecedor[] = fornOrd.map((f, i) => ({ nome: tituloCaso(f.nome), fornecedorId: fornecedores.find(x => normalizar(x.nome) === normalizar(f.nome))?.id || null, primario: i === 0 }));
    const aliases = Array.from(new Set(grupos.flatMap(g => g.aliases)));
    const fator = dom.fator && dom.fator > 1 ? dom.fator : undefined;
    const precoUnit = dom.precoEstimado != null && fator ? dom.precoEstimado / fator : dom.precoEstimado;
    setPreset({ nome: dom.nome, categoria: dom.categoria, unidade: dom.unidade, unidadeOutroLabel: dom.unidadeOutroLabel, precoEstimado: precoUnit, fatorCompra: fator, aliases, fornecedores: fornList, fornecedorPreferredId: fornList[0]?.fornecedorId || null });
    setPresetNomesOrig(grafiasDe(grupos));
    setPresetOpcoes([...grupos].sort((a, b) => b.ocorrencias - a.ocorrencias).map(g => ({ fornecedor: tituloCaso(g.fornecedores[0]?.nome || ""), precoPacote: g.precoEstimado, fator: g.fator && g.fator > 1 ? g.fator : 1, unidade: g.unidade })));
    setAutoReav(true); setEditing("new");
  }

  async function cadastrarLote(items: { g: GrupoSugerido; e: EdicaoGrupo }[]) {
    if (!me) return;
    for (const { g, e } of items) {
      const primeiro = e.fornecedorNome || g.fornecedores[0]?.nome || "";
      const ordenados = [
        ...(primeiro ? [{ nome: primeiro, count: 999 }] : []),
        ...g.fornecedores.filter(f => normalizar(f.nome) !== normalizar(primeiro)),
      ];
      const { lista, primeiroId } = await montarFornecedores(ordenados);
      const now = new Date().toISOString();
      await addDoc(collection(db, "insumos"), sanitizeForFirestore({
        restaurantId: rid, nome: e.nome.trim() || g.nome, categoria: e.categoria.trim() || undefined,
        unidade: e.unidade, unidadeOutroLabel: e.unidade === "outro" ? (e.unidadeOutroLabel || undefined) : undefined,
        precoEstimado: e.preco, fatorCompra: e.fator && e.fator > 1 ? e.fator : undefined,
        aliases: g.aliases, fornecedores: lista, fornecedorPreferredId: primeiroId || null,
        ativo: true, criadoEm: now, criadoPor: me.id, atualizadoEm: now,
      }));
    }
  }

  async function excluirInsumo(i: Insumo) {
    if (!confirm(`Excluir "${i.nome}"? Contagens passadas preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "insumos", i.id));
  }

  // "Já está cadastrado" → vincula o grupo a um insumo existente escolhido pelo
  // usuário: junta as grafias (aliases) e os fornecedores no insumo. A partir daí
  // essa nota é reconhecida por match exato e não volta a ser sugerida.
  async function vincularGrupoAoInsumo(g: GrupoSugerido, insumoId: string, escolhas: { nome?: string; preco?: number | null; fornecedorPrefNome?: string | null }) {
    const alvo = insumos.find(i => i.id === insumoId); if (!alvo) return;
    const { lista } = await montarFornecedores(g.fornecedores);
    const aliases = Array.from(new Set([...(alvo.aliases || []).map(normalizar), ...g.aliases.map(normalizar), normalizar(alvo.nome)]));
    // Une fornecedores; marca como primário o escolhido pelo usuário.
    const fornMap = new Map<string, InsumoFornecedor>();
    for (const f of [...(alvo.fornecedores || []), ...lista]) fornMap.set(normalizar(f.nome), { ...f, primario: false });
    const prefKey = escolhas.fornecedorPrefNome ? normalizar(escolhas.fornecedorPrefNome) : null;
    let fornPrefId = alvo.fornecedorPreferredId ?? null;
    if (prefKey && fornMap.has(prefKey)) { const f = fornMap.get(prefKey)!; f.primario = true; fornMap.set(prefKey, f); fornPrefId = f.fornecedorId ?? fornPrefId; }
    const patch: Record<string, unknown> = { aliases, fornecedores: [...fornMap.values()], fornecedorPreferredId: fornPrefId, atualizadoEm: new Date().toISOString() };
    if (escolhas.nome && escolhas.nome !== alvo.nome) patch.nome = escolhas.nome;
    if (escolhas.preco !== undefined) patch.precoEstimado = escolhas.preco == null ? deleteField() : escolhas.preco;
    await updateDoc(doc(db, "insumos", alvo.id), sanitizeForFirestore(patch));
    setVinculando(null);
  }

  // ── Filtro + agrupamento por categoria ───────────────────────────────────────
  const fornecedorMap = useMemo(() => Object.fromEntries(fornecedores.map(f => [f.id, f])), [fornecedores]);
  const insumosFiltrados = useMemo(() => {
    if (!searchConfig.trim()) return insumos;
    const s = searchConfig.toLowerCase();
    return insumos.filter(i => (i.nome || "").toLowerCase().includes(s) || (i.categoria || "").toLowerCase().includes(s));
  }, [insumos, searchConfig]);
  // Rótulo do grupo do insumo conforme a organização escolhida.
  const grupoFornLabel = (i: Insumo) => {
    const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
    const nome = forn?.nome || (i.fornecedores?.find(f => f.primario)?.nome) || (i.fornecedores?.[0]?.nome);
    return nome || "(sem fornecedor)";
  };
  // Grupos exibidos: por categoria (produto) OU por fornecedor. Grupos em ordem
  // alfabética ("(sem …)" por último) e produtos em ordem alfabética dentro deles.
  const gruposExibidos = useMemo(() => {
    const m = new Map<string, Insumo[]>();
    for (const i of insumosFiltrados) {
      const chave = agrupamento === "fornecedor" ? grupoFornLabel(i) : (i.categoria || "(sem categoria)");
      const arr = m.get(chave); if (arr) arr.push(i); else m.set(chave, [i]);
    }
    const entradas = [...m.entries()].map(([k, list]) => [k, list.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"))] as [string, Insumo[]]);
    entradas.sort((a, b) => { const aSem = a[0].startsWith("("), bSem = b[0].startsWith("("); if (aSem !== bSem) return aSem ? 1 : -1; return a[0].localeCompare(b[0], "pt-BR"); });
    return entradas;
  }, [insumosFiltrados, agrupamento, fornecedorMap]);

  // ── Definir estoque mínimo em lote ───────────────────────────────────────────
  function abrirDefinirMin() {
    const m: Record<string, string> = {};
    for (const i of insumos) m[i.id] = i.minStock != null ? String(i.minStock) : "";
    setMinEdits(m);
    setEditandoMin(true);
  }
  async function salvarMin() {
    setSalvandoMin(true);
    try {
      const now = new Date().toISOString();
      const alterados = insumos.filter(i => {
        if (!(i.id in minEdits)) return false;   // só os que estavam na tela ao abrir a edição
        const v = (minEdits[i.id] ?? "").trim();
        const novo = v === "" ? undefined : parseFloat(v.replace(",", "."));
        const novoNorm = novo == null || isNaN(novo) ? undefined : novo;
        return novoNorm !== (i.minStock ?? undefined);
      });
      // Firestore aceita até 500 escritas por batch — fatia em pedaços.
      for (let k = 0; k < alterados.length; k += 400) {
        const batch = writeBatch(db);
        for (const i of alterados.slice(k, k + 400)) {
          const v = (minEdits[i.id] ?? "").trim();
          const novo = v === "" ? undefined : parseFloat(v.replace(",", "."));
          const novoNorm = novo == null || isNaN(novo) ? undefined : novo;
          batch.update(doc(db, "insumos", i.id), { minStock: novoNorm ?? deleteField(), atualizadoEm: now });
        }
        await batch.commit();
      }
      setEditandoMin(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar estoque mínimo");
    } finally { setSalvandoMin(false); }
  }
  const minAlterados = useMemo(() => {
    if (!editandoMin) return 0;
    return insumos.reduce((n, i) => {
      if (!(i.id in minEdits)) return n;
      const v = (minEdits[i.id] ?? "").trim();
      const novo = v === "" ? undefined : parseFloat(v.replace(",", "."));
      const novoNorm = novo == null || isNaN(novo) ? undefined : novo;
      return n + (novoNorm !== (i.minStock ?? undefined) ? 1 : 0);
    }, 0);
  }, [editandoMin, minEdits, insumos]);

  return (
    <div className="space-y-3">
      <Input placeholder="🔍 Buscar por nome ou categoria..." value={searchConfig} onChange={(e) => setSearchConfig(e.target.value)} />

      {podeConfig && (
        <button type="button" onClick={() => { setPreset(null); setAutoReav(false); setPresetNomesOrig(undefined); setPresetOpcoes(undefined); setEditing("new"); }}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 py-2.5 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
          <Plus size={16} /> Novo insumo
        </button>
      )}

      {/* Sugeridos do recebimento */}
      {podeConfig && sugestoesNovas.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 overflow-hidden">
          <button type="button" onClick={() => setSugestoesAbertas(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
            <Sparkles size={15} className="text-amber-500 shrink-0" />
            <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">Sugeridos do recebimento ({gruposSugeridos.length})</span>
            {iaPendentes > 0 && <Loader2 size={13} className="animate-spin text-amber-500" />}
            <span className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400">{sugestoesAbertas ? "ocultar" : "ver"}</span>
          </button>
          {sugestoesAbertas && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300 cursor-pointer">
                  <input type="checkbox" checked={soRecorrentes} onChange={e => setSoRecorrentes(e.target.checked)} /> só recorrentes (2+ notas)
                </label>
                {iaPendentes > 0
                  ? <span className="text-[11px] text-amber-700/80 inline-flex items-center gap-1"><Sparkles size={11} /> IA analisando categoria, unidade e repetidos… (faltam {iaPendentes})</span>
                  : <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 inline-flex items-center gap-1"><Sparkles size={11} /> analisado pela IA</span>}
                <button type="button" disabled={reavaliando} onClick={() => void reavaliarTodos()} className="ml-auto text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:underline inline-flex items-center gap-1 disabled:opacity-60"><RotateCcw size={11} /> {reavaliando ? "Reavaliando (pode sair)…" : "Reavaliar todos"}</button>
                <div className="hidden lg:inline-flex rounded-lg bg-white/70 dark:bg-gray-800/70 border border-amber-200 dark:border-amber-800 p-0.5">
                  <button type="button" onClick={() => setSugeridosView("tabela")} className={`px-2 py-0.5 text-[11px] font-medium rounded-md ${sugeridosView === "tabela" ? "bg-amber-500 text-white" : "text-amber-700 dark:text-amber-300"}`}>Tabela</button>
                  <button type="button" onClick={() => setSugeridosView("lista")} className={`px-2 py-0.5 text-[11px] font-medium rounded-md ${sugeridosView === "lista" ? "bg-amber-500 text-white" : "text-amber-700 dark:text-amber-300"}`}>Lista</button>
                </div>
              </div>
              {ignorados.size > 0 && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                  <EyeOff size={11} /> {ignorados.size} ignorado(s)
                  <button type="button" onClick={restaurarIgnorados} className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5"><RotateCcw size={10} /> restaurar</button>
                </div>
              )}
              {naoDuplicatas.size > 0 && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                  <GitMerge size={11} /> {naoDuplicatas.size} par(es) marcado(s) como diferentes
                  <button type="button" onClick={() => salvarNaoDuplicatas(new Set())} className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-0.5"><RotateCcw size={10} /> restaurar</button>
                </div>
              )}
              {(ocultasIA > 0 || verMatchIA) && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                  <Sparkles size={11} /> {verMatchIA ? "mostrando os que a IA achou que já existem" : `${ocultasIA} escondido(s) — a IA achou que já existem`}
                  <button type="button" onClick={() => setVerMatchIA(v => !v)} className="text-indigo-600 dark:text-indigo-400 hover:underline">{verMatchIA ? "esconder de novo" : "ver / vincular"}</button>
                </div>
              )}
              {duplicatasProvaveis.length > 0 && (
                <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-900/10 p-2.5 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"><GitMerge size={12} /> Possíveis duplicatas ({duplicatasProvaveis.length})</div>
                  {duplicatasProvaveis.map((cluster, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 flex-wrap text-[13px] bg-white dark:bg-gray-900 rounded-md border border-rose-100 dark:border-rose-900/40 px-2.5 py-1.5">
                      <span className="text-gray-800 dark:text-gray-100">{cluster.map(g => g.nome).join("  ≈  ")}</span>
                      <div className="inline-flex items-center gap-1.5">
                        <button type="button" onClick={() => marcarDiferentes(cluster)} className="text-[11px] font-medium px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">São diferentes</button>
                        <button type="button" onClick={() => juntarGrupos(cluster)} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 inline-flex items-center gap-1"><GitMerge size={11} /> Juntar</button>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70">Nomes muito parecidos que talvez sejam o mesmo produto. Ao juntar, a IA escolhe o nome certo e as grafias viram apelidos.</p>
                </div>
              )}
              {viewEfetiva === "tabela" && <SugeridosTabela grupos={gruposSugeridos} fornecedoresNomes={fornecedores.map(f => f.nome)} unidadesCustom={unidadesCustom} onCadastrar={cadastrarLote} onAbrir={abrirGrupoNoModal} onIgnorar={ignorarGrupo} onJuntar={juntarGrupos} onReavaliar={reavaliarSelecionados} reavaliando={reavaliando} onJaCadastrado={setVinculando} />}
              {viewEfetiva === "lista" && gruposSugeridos.map(g => {
                const alvo = g.matchInsumoId ? insumos.find(i => i.id === g.matchInsumoId) : null;
                return (
                  <div key={g.grupo} className="rounded-lg border border-amber-200/70 dark:border-amber-900/40 bg-white dark:bg-gray-900 p-2.5 flex items-center gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{g.nome}</span>
                        {g.categoria && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{g.categoria}</span>}
                        {g.membros.length > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300 inline-flex items-center gap-1" title={g.membros.map(m => m.nome).join(" · ")}><Layers size={10} /> {g.membros.length} nomes</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 flex gap-2 flex-wrap mt-0.5">
                        <span className="uppercase">{g.unidade === "outro" ? (g.unidadeOutroLabel || "outro") : UNIDADES_LABEL[g.unidade]}</span>
                        <span>{g.ocorrencias} nota(s)</span>
                        {g.precoEstimado != null && <span>R$ {g.precoEstimado.toFixed(2)}/un</span>}
                        {g.fornecedores[0] && <span className="inline-flex items-center gap-1"><Truck size={11} /> {tituloCaso(g.fornecedores[0].nome)}{g.fornecedores.length > 1 ? ` +${g.fornecedores.length - 1}` : ""}</span>}
                      </div>
                      {alvo && <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 inline-flex items-center gap-1"><Link2 size={11} /> pode ser: <strong>{alvo.nome}</strong></div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => abrirGrupoNoModal(g)} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"><Plus size={14} /> Cadastrar</button>
                      <button type="button" onClick={() => setVinculando(g)} title="Já está cadastrado — vincular a um insumo existente" className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Link2 size={14} /> Vincular</button>
                      <button type="button" onClick={() => ignorarGrupo(g)} title="Ignorar (não cadastrar)" className="text-gray-300 hover:text-rose-500 p-1"><EyeOff size={16} /></button>
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60">A IA sugere categoria e unidade, junta nomes diferentes do mesmo produto e avisa quando pode ser um insumo já cadastrado. Estoque mínimo você completa.</p>
            </div>
          )}
        </div>
      )}

      {podeConfig && insumos.length > 0 && (
        editandoMin ? (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 flex-wrap rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-900/20 px-3 py-2 backdrop-blur">
            <span className="text-[12px] font-medium text-indigo-800 dark:text-indigo-200 inline-flex items-center gap-1.5"><Ruler size={14} /> Preencha o estoque mínimo de cada produto {minAlterados > 0 && <span className="text-indigo-500">· {minAlterados} alterado(s)</span>}</span>
            <div className="inline-flex items-center gap-2">
              <button type="button" onClick={() => setEditandoMin(false)} disabled={salvandoMin} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void salvarMin()} disabled={salvandoMin} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1"><Save size={13} /> {salvandoMin ? "Salvando…" : `Salvar estoque mínimo${minAlterados > 0 ? ` (${minAlterados})` : ""}`}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-4 items-center">
            <button type="button" onClick={abrirDefinirMin} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 inline-flex items-center gap-1"><Ruler size={13} /> Definir estoque mínimo</button>
            {insumos.length >= 2 && <button type="button" onClick={() => setMesclando(true)} className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><Layers size={13} /> Mesclar duplicados</button>}
          </div>
        )
      )}

      {insumos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum insumo cadastrado</p>
          {podeConfig && <p className="text-sm text-gray-500 mt-2">Use o botão <strong>+ Novo insumo</strong> acima{sugestoesNovas.length > 0 ? " — ou puxe dos sugeridos do recebimento" : ""}.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-3 py-1.5 font-semibold">Produto</th>
                <th className="px-2 py-1.5 font-semibold w-24">Unidade</th>
                <th className="px-2 py-1.5 font-semibold w-24 text-right">Estoque mín.</th>
                <th className="px-2 py-1.5 font-semibold w-24 text-right">R$/un</th>
                <th className="px-2 py-1.5 font-semibold w-52">
                  <div className="inline-flex items-center gap-1.5">
                    <span>Fornecedor</span>
                    <select value={agrupamento} onChange={e => setAgrupamento(e.target.value as "produto" | "fornecedor")} onClick={e => e.stopPropagation()}
                      title="Organizar a lista" className="text-[10px] normal-case font-normal rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 px-1 py-0.5">
                      <option value="produto">agrupar: produto</option>
                      <option value="fornecedor">agrupar: fornecedor</option>
                    </select>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {gruposExibidos.map(([grupo, list]) => (
                <Fragment key={grupo}>
                  <tr className="bg-gray-50 dark:bg-gray-800/40">
                    <td colSpan={5} className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{grupo} <span className="font-normal text-gray-400">({list.length})</span></td>
                  </tr>
                  {list.map(i => {
                    const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
                    const fornNome = (i.fornecedores && i.fornecedores.length) ? (i.fornecedores.find(f => f.primario)?.nome || i.fornecedores[0].nome) : forn?.nome;
                    const semMin = !i.minStock || i.minStock <= 0;
                    return (
                      <tr key={i.id} onClick={() => { if (!editandoMin) setEditing(i); }} className={`border-b border-gray-50 dark:border-gray-800/40 ${editandoMin ? "" : "cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10"} ${!i.ativo ? "opacity-50" : ""}`}>
                        <td className="px-3 py-1.5">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</span>
                          {i.fatorCompra && i.fatorCompra > 1 && <span className="ml-1.5 text-[10px] text-gray-400">pct {i.fatorCompra}</span>}
                          {!i.ativo && <span className="ml-1.5 text-[10px] uppercase text-gray-400">inativo</span>}
                          {agrupamento === "fornecedor" && i.categoria && <span className="ml-1.5 text-[10px] text-gray-400">· {i.categoria}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-gray-500 uppercase">{i.unidade === "outro" ? (i.unidadeOutroLabel || "outro") : (UNIDADES_LABEL[i.unidade] || i.unidade)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {editandoMin ? (
                            <input inputMode="decimal" value={minEdits[i.id] ?? ""} onClick={e => e.stopPropagation()}
                              onChange={e => { const v = e.target.value.replace(/[^\d.,]/g, ""); setMinEdits(s => ({ ...s, [i.id]: v })); }}
                              placeholder="—" className="w-16 px-2 py-1 text-sm text-right rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                          ) : (
                            <span className={semMin ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-gray-200 font-medium"}>{semMin ? "definir" : i.minStock}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{i.precoEstimado != null ? i.precoEstimado.toFixed(2) : "—"}</td>
                        <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300 truncate max-w-[220px]">{fornNome || <span className="text-amber-600 dark:text-amber-400">sem fornecedor</span>}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <InsumoModal
          insumo={editing === "new" ? null : editing}
          preset={editing === "new" ? preset : null}
          fornecedores={fornecedores.filter(f => f.ativo)}
          restaurantId={rid}
          categoriasExistentes={[...new Set(insumos.map(i => (i.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"))}
          autoReavaliar={autoReav}
          nomesOriginais={presetNomesOrig}
          onVerNota={abrirNotaDaGrafia}
          opcoesPreco={presetOpcoes}
          unidadesCustom={unidadesCustom}
          onExcluir={podeConfig ? excluirInsumo : undefined}
          onClose={() => { setEditing(null); setPreset(null); setAutoReav(false); setPresetNomesOrig(undefined); setPresetOpcoes(undefined); }}
        />
      )}
      {mesclando && <MesclarInsumosModal insumos={insumos} onClose={() => setMesclando(false)} />}
      {notaView && <NotaViewModal nota={notaView.nota} grafia={notaView.grafia} onClose={() => setNotaView(null)} />}
      {vinculando && <VincularExistenteModal grupo={vinculando} insumos={insumos} onPick={(id, esc) => void vincularGrupoAoInsumo(vinculando, id, esc)} onClose={() => setVinculando(null)} />}
    </div>
  );
}

// Escolher a qual insumo JÁ cadastrado vincular uma sugestão ("já está cadastrado").
type EscolhasVinc = { nome?: string; preco?: number | null; fornecedorPrefNome?: string | null };
function VincularExistenteModal({ grupo, insumos, onPick, onClose }: { grupo: GrupoSugerido; insumos: Insumo[]; onPick: (insumoId: string, escolhas: EscolhasVinc) => void; onClose: () => void }) {
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<Insumo | null>(null);   // insumo escolhido → passo de resolução
  const [salvando, setSalvando] = useState(false);
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return insumos.filter(i => i.ativo).filter(i => !b || (i.nome || "").toLowerCase().includes(b) || (i.categoria || "").toLowerCase().includes(b))
      .sort((a, c) => (a.nome || "").localeCompare(c.nome || "", "pt-BR")).slice(0, 200);
  }, [insumos, busca]);

  // Preço sugerido convertido pra unitário (se a sugestão veio em pacote).
  const grupoPrecoUn = grupo.precoEstimado != null && grupo.fator && grupo.fator > 1 ? grupo.precoEstimado / grupo.fator : (grupo.precoEstimado ?? null);
  const alvoPrefNome = alvo ? (alvo.fornecedores?.find(f => f.primario)?.nome || (alvo.fornecedorPreferredId ? alvo.fornecedores?.find(f => f.fornecedorId === alvo.fornecedorPreferredId)?.nome : undefined) || alvo.fornecedores?.[0]?.nome) : undefined;
  const fornOpcoes = useMemo(() => {
    if (!alvo) return [] as string[];
    const set = new Set<string>();
    if (alvoPrefNome) set.add(alvoPrefNome);
    for (const f of alvo.fornecedores || []) if (f.nome) set.add(f.nome);
    for (const f of grupo.fornecedores || []) if (f.nome) set.add(f.nome);
    return [...set];
  }, [alvo, grupo, alvoPrefNome]);

  // Escolhas (default = manter o do insumo existente).
  const [nomeSel, setNomeSel] = useState<string>("");
  const [precoSel, setPrecoSel] = useState<number | null>(null);
  const [fornSel, setFornSel] = useState<string>("");
  function escolher(i: Insumo) {
    setAlvo(i);
    setNomeSel(i.nome);
    setPrecoSel(i.precoEstimado ?? null);
    setFornSel((i.fornecedores?.find(f => f.primario)?.nome || (i.fornecedorPreferredId ? i.fornecedores?.find(f => f.fornecedorId === i.fornecedorPreferredId)?.nome : undefined) || i.fornecedores?.[0]?.nome) || "");
  }

  if (alvo) {
    const nomeDifere = grupo.nome && grupo.nome !== alvo.nome;
    const precoDifere = grupoPrecoUn != null && grupoPrecoUn !== (alvo.precoEstimado ?? null);
    const Opcao = ({ on, onClick, titulo, sub }: { on: boolean; onClick: () => void; titulo: string; sub?: string }) => (
      <button type="button" onClick={onClick} className={`flex-1 min-w-0 text-left rounded-lg border p-2 ${on ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/20 ring-1 ring-emerald-400" : "border-gray-200 dark:border-gray-700 hover:border-emerald-300"}`}>
        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{titulo}</div>
        {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
      </button>
    );
    return (
      <Modal title="Vincular — o que manter?" onClose={onClose} maxWidth="max-w-lg">
        <div className="space-y-3">
          <p className="text-[13px] text-gray-600 dark:text-gray-400">Unindo a sugestão <strong>"{grupo.nome}"</strong> ao insumo <strong>"{alvo.nome}"</strong>. Escolha o que fica (as grafias e fornecedores são somados de qualquer jeito).</p>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Nome</div>
            {nomeDifere ? (
              <div className="flex gap-2">
                <Opcao on={nomeSel === alvo.nome} onClick={() => setNomeSel(alvo.nome)} titulo={alvo.nome} sub="já cadastrado" />
                <Opcao on={nomeSel === grupo.nome} onClick={() => setNomeSel(grupo.nome)} titulo={grupo.nome} sub="da nota / IA" />
              </div>
            ) : <div className="text-sm text-gray-700 dark:text-gray-200">{alvo.nome}</div>}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Preço /un</div>
            {precoDifere ? (
              <div className="flex gap-2">
                <Opcao on={precoSel === (alvo.precoEstimado ?? null)} onClick={() => setPrecoSel(alvo.precoEstimado ?? null)} titulo={alvo.precoEstimado != null ? `R$ ${alvo.precoEstimado.toFixed(2)}` : "sem preço"} sub="já cadastrado" />
                <Opcao on={precoSel === grupoPrecoUn} onClick={() => setPrecoSel(grupoPrecoUn)} titulo={grupoPrecoUn != null ? `R$ ${grupoPrecoUn.toFixed(2)}` : "sem preço"} sub="da nota" />
              </div>
            ) : <div className="text-sm text-gray-700 dark:text-gray-200">{alvo.precoEstimado != null ? `R$ ${alvo.precoEstimado.toFixed(2)}` : "—"}</div>}
          </div>

          {fornOpcoes.length > 1 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Fornecedor preferencial</div>
              <div className="flex flex-wrap gap-1.5">
                {fornOpcoes.map(n => (
                  <button key={n} type="button" onClick={() => setFornSel(n)} className={`px-2.5 py-1 rounded-full text-[12px] border ${fornSel === n ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>{n}</button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
            <button type="button" onClick={() => setAlvo(null)} className="text-[12px] text-gray-500 hover:text-gray-800">← escolher outro</button>
            <button type="button" disabled={salvando} onClick={() => { setSalvando(true); onPick(alvo.id, { nome: nomeSel, preco: precoSel, fornecedorPrefNome: fornSel || null }); }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"><Link2 size={15} /> {salvando ? "Vinculando…" : "Vincular"}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Vincular a um insumo cadastrado" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-[13px] text-gray-600 dark:text-gray-400">Vincular <strong className="text-gray-900 dark:text-gray-100">"{grupo.nome}"</strong> a um produto que já existe. No próximo passo você escolhe qual nome/preço/fornecedor manter.</p>
        <Input placeholder="🔍 Buscar insumo…" value={busca} onChange={e => setBusca(e.target.value)} />
        <div className="max-h-80 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {lista.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">Nenhum insumo encontrado.</div>}
          {lista.map(i => (
            <button key={i.id} type="button" onClick={() => escolher(i)}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 flex items-center justify-between gap-2">
              <span className="min-w-0"><span className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</span>{i.categoria && <span className="ml-1.5 text-[11px] text-gray-400">{i.categoria}</span>}</span>
              <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Link2 size={12} /> escolher</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
