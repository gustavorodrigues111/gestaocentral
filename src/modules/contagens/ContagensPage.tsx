import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, BarChart3, Settings, Lock, TriangleAlert, Package, Phone, Plus, Sparkles, Truck, Link2, Loader2, Layers, EyeOff, RotateCcw } from "lucide-react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db, auth } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Fornecedor, Insumo, InsumoFornecedor, RecebimentoNota, UnidadeMedida } from "../../core/types";
import { InsumoModal } from "./InsumoModal";
import { LancarContagensTab } from "./LancarContagensTab";
import { agruparSugestoes, normalizar, tituloCaso, type SugestaoInsumo, type GrupoSugerido } from "./sugestoesRecebimento";
import { MesclarInsumosModal } from "./MesclarInsumosModal";
import { SugeridosTabela, type EdicaoGrupo } from "./SugeridosTabela";
import { PageContainer } from "../../core/ui/PageContainer";

type IaInfo = { nomeLimpo?: string; qtdPorPacote?: number; categoria?: string; unidade?: UnidadeMedida; grupo?: string; matchInsumoId?: string | null };

type Tab = "lancar" | "visao" | "config";

export function ContagensPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "contagens");
  const podeConfig = canConfigurar(me, rid, "contagens");

  const [tab, setTab] = useState<Tab>("lancar");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Insumo | "new" | null>(null);
  const [preset, setPreset] = useState<Partial<Insumo> | null>(null);
  const [searchConfig, setSearchConfig] = useState("");
  const [recebimentos, setRecebimentos] = useState<RecebimentoNota[]>([]);
  const [soRecorrentes, setSoRecorrentes] = useState(true);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const [sugeridosView, setSugeridosView] = useState<"lista" | "tabela">("tabela");
  const [iaMapa, setIaMapa] = useState<Record<string, IaInfo>>({});
  const iaEmAndamento = useRef(false);
  const [mesclando, setMesclando] = useState(false);
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo);
      list.sort((a, b) =>
        (a.categoria || "ZZ").localeCompare(b.categoria || "ZZ") ||
        a.nome.localeCompare(b.nome)
      );
      setInsumos(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "contagens"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contagem);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.registradoEm || "").localeCompare(a.registradoEm || ""));
      setContagens(list);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fornecedores"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor));
    });
    return () => unsub();
  }, [rid]);

  // Notas de recebimento — só quem configura (pra sugerir insumos). Leitura
  // pontual só quando pode configurar, pra não pesar em quem só lança contagem.
  useEffect(() => {
    if (!rid || !podeConfig) { setRecebimentos([]); return; }
    const q = query(collection(db, "recebimentos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setRecebimentos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as RecebimentoNota).filter(n => !n.excluidoEm));
    }, () => setRecebimentos([]));
    return () => unsub();
  }, [rid, podeConfig]);

  // Cache PERSISTIDO da leitura da IA (insumosIaCache/{rid}) — roda uma vez por
  // produto e fica salvo; nas próximas aberturas já vem "analisado". Carrega 1x.
  useEffect(() => {
    if (!rid || !podeConfig) return;
    getDoc(doc(db, "insumosIaCache", rid)).then((snap) => {
      const arr = (snap.data() as { itens?: Array<{ chave: string } & IaInfo> } | undefined)?.itens;
      if (Array.isArray(arr)) setIaMapa((prev) => { const n = { ...prev }; for (const it of arr) { const { chave, ...info } = it; if (chave) n[chave] = info; } return n; });
    }).catch(() => {});
  }, [rid, podeConfig]);

  // Salva o cache da IA (debounce) sempre que muda — persiste as leituras.
  useEffect(() => {
    if (!rid || !podeConfig || Object.keys(iaMapa).length === 0) return;
    const t = setTimeout(() => {
      const itens = Object.entries(iaMapa).map(([chave, info]) => ({ chave, ...info }));
      void setDoc(doc(db, "insumosIaCache", rid), sanitizeForFirestore({ restaurantId: rid, itens, atualizadoEm: new Date().toISOString() }), { merge: true }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [iaMapa, rid, podeConfig]);

  // Produtos IGNORADOS (o user escolheu não cadastrar) — persistido por restaurante.
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

  // Sugestões agrupadas do recebimento (não cadastradas + não ignoradas + filtro).
  // agruparSugestoes já ignora o que casa por NOME ou por ALIAS de insumo.
  const sugestoes = useMemo(() => agruparSugestoes(recebimentos, insumos, fornecedores), [recebimentos, insumos, fornecedores]);
  const sugestoesNovas = useMemo(() => sugestoes.filter(s => !s.jaCadastrado && !ignorados.has(s.chave) && (!soRecorrentes || s.ocorrencias >= 2)), [sugestoes, soRecorrentes, ignorados]);

  // IA: ao abrir os Sugeridos, enriquece (categoria, unidade, agrupa repetidos de
  // nomes diferentes, casa com insumo já existente). Incremental: só o que falta.
  useEffect(() => {
    if (!sugestoesAbertas || !podeConfig) return;
    const faltando = sugestoesNovas.filter(s => !iaMapa[s.chave]);
    if (faltando.length === 0 || iaEmAndamento.current) return;
    // Fatia em LOTES de 40 — evita estourar o limite de tokens da IA (que cortava
    // o JSON e travava). Cada lote marca TODAS as suas chaves como analisadas
    // (mesmo as que a IA não devolver), então o efeito encadeia lote a lote e para.
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
        setIaMapa(prev => {
          const n = { ...prev };
          for (const s of lote) n[s.chave] = n[s.chave] || {};   // marca o lote como analisado (mata o loop)
          if (Array.isArray(j.itens)) for (const it of j.itens) if (it?.chave) n[it.chave] = { nomeLimpo: it.nomeLimpo, qtdPorPacote: it.qtdPorPacote, categoria: it.categoria, unidade: it.unidade as UnidadeMedida, grupo: it.grupo, matchInsumoId: it.matchInsumoId ?? null };
          return n;
        });
      } catch {
        setIaMapa(prev => { const n = { ...prev }; for (const s of lote) n[s.chave] = n[s.chave] || {}; return n; });   // erro: não re-tenta o mesmo lote em loop
      } finally { iaEmAndamento.current = false; }
    })();
  }, [sugestoesAbertas, sugestoesNovas, podeConfig, insumos, iaMapa]);

  // Agrupa as sugestões por "grupo" da IA (nomes diferentes = mesmo produto) e
  // consolida fornecedores + aliases de cada grupo.
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

  // Casa um fornecedor pelo nome (normalizado) ou cria um novo; devolve o id.
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

  // Cadastra um GRUPO: cria 1 insumo com todos os aliases + fornecedores, ou
  // vincula a um insumo existente ("pode ser aquele" da IA).
  async function cadastrarGrupo(g: GrupoSugerido) {
    const { lista, primeiroId } = await montarFornecedores(g.fornecedores);
    if (g.matchInsumoId) {
      const alvo = insumos.find(i => i.id === g.matchInsumoId);
      if (alvo && confirm(`A IA acha que é o mesmo insumo já cadastrado "${alvo.nome}". Vincular a ele? (os fornecedores e nomes deste grupo passam a apontar pra ele)`)) {
        const aliases = Array.from(new Set([...(alvo.aliases || []), ...g.aliases, normalizar(alvo.nome)]));
        const fornMap = new Map<string, InsumoFornecedor>();
        for (const f of [...(alvo.fornecedores || []), ...lista]) fornMap.set(normalizar(f.nome), f);
        await updateDoc(doc(db, "insumos", alvo.id), sanitizeForFirestore({ aliases, fornecedores: [...fornMap.values()], atualizadoEm: new Date().toISOString() }));
        return;
      }
    }
    const fator = g.fator && g.fator > 1 ? g.fator : undefined;
    const precoUnit = g.precoEstimado != null && fator ? g.precoEstimado / fator : g.precoEstimado;
    setPreset({
      nome: g.nome, categoria: g.categoria, unidade: g.unidade, unidadeOutroLabel: g.unidadeOutroLabel,
      precoEstimado: precoUnit, fatorCompra: fator, fornecedorPreferredId: primeiroId || null,
      aliases: g.aliases, fornecedores: lista,
    });
    setEditing("new");
  }

  // Ignora um grupo (não quero cadastrar) — some das sugestões (dá pra restaurar).
  function ignorarGrupo(g: GrupoSugerido) {
    const n = new Set(ignorados); for (const a of g.aliases) n.add(a); salvarIgnorados(n);
  }
  function restaurarIgnorados() { salvarIgnorados(new Set()); }

  // Abre o InsumoModal a partir de um grupo (botão "abrir" da tabela) — sem
  // criar fornecedores ainda; só pré-preenche pra ver/editar tudo.
  function abrirGrupoNoModal(g: GrupoSugerido) {
    const fornList: InsumoFornecedor[] = g.fornecedores.map((f, i) => ({ nome: tituloCaso(f.nome), fornecedorId: fornecedores.find(x => normalizar(x.nome) === normalizar(f.nome))?.id || null, primario: i === 0 }));
    const fator = g.fator && g.fator > 1 ? g.fator : undefined;
    const precoUnit = g.precoEstimado != null && fator ? g.precoEstimado / fator : g.precoEstimado;
    setPreset({ nome: g.nome, categoria: g.categoria, unidade: g.unidade, unidadeOutroLabel: g.unidadeOutroLabel, precoEstimado: precoUnit, fatorCompra: fator, aliases: g.aliases, fornecedores: fornList, fornecedorPreferredId: fornList[0]?.fornecedorId || null });
    setEditing("new");
  }

  // Cadastro em LOTE (tabela): cria os insumos selecionados de uma vez, com os
  // valores editados. Fornecedor primário = o escolhido na linha.
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
        restaurantId: rid,
        nome: e.nome.trim() || g.nome,
        categoria: e.categoria.trim() || undefined,
        unidade: e.unidade,
        precoEstimado: e.preco,
        fatorCompra: e.fator && e.fator > 1 ? e.fator : undefined,
        aliases: g.aliases,
        fornecedores: lista,
        fornecedorPreferredId: primeiroId || null,
        ativo: true,
        criadoEm: now, criadoPor: me.id, atualizadoEm: now,
      }));
    }
  }

  // Última contagem por insumo (mais recente)
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) {
      if (!m[c.insumoId]) m[c.insumoId] = c;  // contagens já vem ordenado desc
    }
    return m;
  }, [contagens]);

  // Insumos com alerta de estoque mínimo
  const alertasMinStock = useMemo(() => {
    return insumos.filter(i => {
      if (!i.ativo || !i.minStock) return false;
      const c = ultimaContagem[i.id];
      const qtd = c?.qty ?? 0;
      return qtd < i.minStock;
    });
  }, [insumos, ultimaContagem]);

  const insumosFiltradosConfig = useMemo(() => {
    if (!searchConfig.trim()) return insumos;
    const s = searchConfig.toLowerCase();
    return insumos.filter(i =>
      i.nome.toLowerCase().includes(s) ||
      (i.categoria || "").toLowerCase().includes(s)
    );
  }, [insumos, searchConfig]);

  // Agrupado por categoria
  const insumosConfigPorCat = useMemo(() => {
    const m: Record<string, Insumo[]> = {};
    for (const i of insumosFiltradosConfig) {
      const c = i.categoria || "(sem categoria)";
      if (!m[c]) m[c] = [];
      m[c].push(i);
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [insumosFiltradosConfig]);

  async function excluirInsumo(i: Insumo) {
    if (!confirm(`Excluir "${i.nome}"? Contagens passadas preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "insumos", i.id));
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const fornecedorMap = Object.fromEntries(fornecedores.map(f => [f.id, f]));

  return (
    <PageContainer>
      {alertasMinStock.length > 0 && tab !== "config" && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
          <span className="inline-flex items-center gap-1"><TriangleAlert size={14} className="shrink-0" /> <strong>{alertasMinStock.length}</strong> insumo(s) abaixo do estoque mínimo. Veja na aba "Visão atual".</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["lancar", "Lançar contagem", Pencil],
          ["visao",  <span className="inline-flex items-center gap-1">Visão atual{alertasMinStock.length > 0 ? <> ({alertasMinStock.length}<TriangleAlert size={11} />)</> : null}</span>, BarChart3],
          ["config", `Config (${insumos.filter(i => i.ativo).length})`, Settings],
        ] as const).map(([id, label, Ico]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            <Ico size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Explicação curta da aba ativa — desfaz a confusão entre elas. */}
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-4">
        {tab === "lancar" && "Conte o estoque: percorra os insumos e digite a quantidade que tem hoje."}
        {tab === "visao" && "Resultado da última contagem de cada insumo, com alerta de quem está abaixo do mínimo."}
        {tab === "config" && "Cadastro dos insumos (nome, categoria, unidade, estoque mínimo, fornecedor). É a base pra contar."}
      </p>

      {/* TAB LANÇAR */}
      {tab === "lancar" && (
        <LancarContagensTab
          insumos={insumos.filter(i => i.ativo)}
          ultimaContagem={ultimaContagem}
          restaurantId={rid}
          podeConfig={podeConfig}
        />
      )}

      {/* TAB VISÃO ATUAL */}
      {tab === "visao" && (
        <div className="space-y-2">
          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : insumos.filter(i => i.ativo).length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem insumos cadastrados</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Cadastre na aba "Config" pra começar.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Insumo</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Qtd atual</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Mín</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Falta</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Última</th>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {insumos.filter(i => i.ativo).map(i => {
                    const c = ultimaContagem[i.id];
                    const qtd = c?.qty;
                    const min = i.minStock || 0;
                    const falta = min > 0 && (qtd ?? 0) < min ? min - (qtd ?? 0) : 0;
                    const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
                    return (
                      <tr key={i.id} className={`border-b border-gray-100 dark:border-gray-800/50 ${
                        falta > 0 ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
                      }`}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</div>
                          <div className="text-[10px] text-gray-500">{i.categoria || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {qtd != null ? (
                            <span className={`font-semibold ${falta > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-900 dark:text-gray-100"}`}>
                              {qtd} {UNIDADES_LABEL[i.unidade].slice(0, 3).toLowerCase()}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">sem contagem</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">
                          {i.minStock || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {falta > 0 ? (
                            <span className="text-amber-700 dark:text-amber-400 font-bold">{falta}</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                          {c ? new Date(c.data + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                          {c?.registradoNome && <div className="text-[10px] text-gray-500">{c.registradoNome}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                          {forn?.nome || <span className="italic text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB CONFIG */}
      {tab === "config" && (
        <div className="space-y-3">
          <Input
            placeholder="🔍 Buscar por nome ou categoria..."
            value={searchConfig}
            onChange={(e) => setSearchConfig(e.target.value)}
          />

          {/* Novo insumo — agora é o 1º item da lista (saiu do topo da página). */}
          {podeConfig && (
            <button
              type="button"
              onClick={() => { setPreset(null); setEditing("new"); }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 py-2.5 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Plus size={16} /> Novo insumo
            </button>
          )}

          {/* Sugeridos do recebimento — produtos das notas ainda não cadastrados. */}
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
                    <div className="ml-auto inline-flex rounded-lg bg-white/70 dark:bg-gray-800/70 border border-amber-200 dark:border-amber-800 p-0.5">
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
                  {sugeridosView === "tabela" && <SugeridosTabela grupos={gruposSugeridos} fornecedoresNomes={fornecedores.map(f => f.nome)} onCadastrar={cadastrarLote} onAbrir={abrirGrupoNoModal} onIgnorar={ignorarGrupo} />}
                  {sugeridosView === "lista" && gruposSugeridos.map(g => {
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
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant={alvo ? "secondary" : undefined} onClick={() => void cadastrarGrupo(g)}>
                            {alvo ? <span className="inline-flex items-center gap-1"><Link2 size={13} /> Vincular</span> : <span className="inline-flex items-center gap-1"><Plus size={13} /> Cadastrar</span>}
                          </Button>
                          <button type="button" onClick={() => ignorarGrupo(g)} title="Ignorar (não cadastrar)" className="text-gray-300 hover:text-rose-500 p-1"><EyeOff size={15} /></button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60">A IA sugere categoria e unidade, junta nomes diferentes do mesmo produto e avisa quando pode ser um insumo já cadastrado (vincula fornecedores de fontes diferentes num só). Estoque mínimo você completa.</p>
                </div>
              )}
            </div>
          )}

          {podeConfig && insumos.length >= 2 && (
            <div className="flex justify-end">
              <button type="button" onClick={() => setMesclando(true)} className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1"><Layers size={13} /> Mesclar duplicados</button>
            </div>
          )}

          {insumos.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="flex justify-center mb-3 text-gray-400"><Package size={40} /></div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum insumo cadastrado</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Use o botão <strong>+ Novo insumo</strong> acima{sugestoesNovas.length > 0 ? " — ou puxe dos sugeridos do recebimento" : ""}.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {insumosConfigPorCat.map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {cat} <span className="text-gray-400 font-normal">({list.length})</span>
                  </h3>
                  <div className="space-y-1">
                    {list.map(i => {
                      const forn = i.fornecedorPreferredId ? fornecedorMap[i.fornecedorPreferredId] : null;
                      return (
                        <div
                          key={i.id}
                          className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 ${!i.ativo ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</h4>
                                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                  {i.unidade === "outro" ? (i.unidadeOutroLabel || "outro") : UNIDADES_LABEL[i.unidade]}
                                </span>
                                {!i.ativo && <span className="text-[10px] uppercase text-gray-500">Inativo</span>}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 flex gap-3 flex-wrap">
                                {i.minStock != null && <span>Mín: <strong>{i.minStock}</strong></span>}
                                {i.fatorCompra && i.fatorCompra > 1 && <span>Fator compra: <strong>{i.fatorCompra}</strong></span>}
                                {i.precoEstimado != null && <span>R$ {i.precoEstimado.toFixed(2)}/un</span>}
                                {forn && <span className="inline-flex items-center gap-1"><Phone size={12} /> {forn.nome}</span>}
                              </div>
                            </div>
                            {podeConfig && (
                              <div className="flex gap-1">
                                <Button variant="secondary" size="sm" onClick={() => setEditing(i)}>Editar</Button>
                                <Button variant="danger" size="sm" onClick={() => excluirInsumo(i)}>×</Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <InsumoModal
          insumo={editing === "new" ? null : editing}
          preset={editing === "new" ? preset : null}
          fornecedores={fornecedores.filter(f => f.ativo)}
          restaurantId={rid}
          onClose={() => { setEditing(null); setPreset(null); }}
        />
      )}

      {mesclando && <MesclarInsumosModal insumos={insumos} onClose={() => setMesclando(false)} />}
    </PageContainer>
  );
}
