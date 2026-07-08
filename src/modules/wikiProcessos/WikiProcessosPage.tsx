// Wiki de Processos — Fase 1: documentação viva dos processos internos por área.
// 3 formatos (texto / checklist / passo-a-passo) + fotos. Busca + consulta pela
// equipe. Escopo por empresa (restaurantIds[]). Fotos no Firebase Storage.
// Fase 2 (pendente): "Pergunte à IA". Fase 3: trilha de onboarding + confirmar leitura.

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, where, setDoc, doc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useDitado } from "../../core/hooks/useDitado";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { wikiCategoriasAcessiveis, resolverPerfil } from "../../core/auth/permissions";
import { SETORES, setorMeta } from "../../core/wiki/setores";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { WikiProcesso, WikiFormato, WikiFoto, WikiPasso, WikiChecklistItem } from "../../core/types";

const FORMATO_LABEL: Record<WikiFormato, string> = { texto: "📄 Texto", checklist: "✅ Checklist", passos: "👣 Passo a passo" };
const FORMATO_META: Record<WikiFormato, { icon: string; cls: string }> = {
  texto: { icon: "📄", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  checklist: { icon: "✅", cls: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" },
  passos: { icon: "👣", cls: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" },
};
const nEtapas = (p: WikiProcesso) => p.formato === "passos" ? (p.passos?.length ?? 0) : p.formato === "checklist" ? (p.itens?.length ?? 0) : 0;

// Sugestões de processos pra semear como rascunhos (por área). O usuário depois
// preenche o conteúdo (por voz ou texto).
const PROCESSOS_SUGERIDOS: { area: string; titulos: string[] }[] = [
  { area: "Departamento de Pessoas", titulos: ["Admissão de novo colaborador", "Fim de experiência (45/90)", "Registro e correção de ponto", "Fechamento de ponto do mês", "Solicitação de ajuste de escala", "Afastamento e atestado", "Desligamento", "Entrega de uniforme e EPI", "Exames ocupacionais"] },
  { area: "Financeiro", titulos: ["Fechamento de caixa do turno", "Pagamento de conta fixa", "Conferência de fatura de cartão", "Recebimento de nota fiscal", "Sangria e suprimento de caixa"] },
  { area: "Salão", titulos: ["Abertura da casa", "Fechamento da casa", "Fluxo de reserva", "Atendimento de evento", "Divisão de gorjeta do dia", "Registro de ocorrência/incidente"] },
  { area: "Cozinha", titulos: ["Recebimento e armazenagem de insumos", "Contagem de estoque / inventário", "Produção do dia (mise en place)", "Controle de temperatura e validade", "Limpeza e higienização por área"] },
  { area: "Gestão", titulos: ["Como usar a Central de Avisos", "Rotinas: criar e atribuir lembretes", "Reunião → Plano de Ação", "Como usar a Wiki (documentar, voz, Pergunte à IA)"] },
];
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Setores responsáveis de uma etapa (novo `responsaveis[]` ou legado `responsavel`).
const respsDe = (x: { responsaveis?: string[]; responsavel?: string }): string[] =>
  x.responsaveis && x.responsaveis.length ? x.responsaveis : (x.responsavel ? [x.responsavel] : []);
function SetorBadge({ id, nomes }: { id?: string; nomes?: string[] }) {
  const m = setorMeta(id);
  if (!m) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      {m.icon} {m.label}
      {nomes && nomes.length > 0 && <span className="font-normal opacity-90"> · {nomes.join(", ")}</span>}
    </span>
  );
}
// Editor de múltiplos setores responsáveis: chips selecionados (removíveis) + select pra adicionar.
function ResponsaveisPicker({ value, onChange, selCls }: { value?: string[]; onChange: (v: string[] | undefined) => void; selCls: string }) {
  const sel = value || [];
  const disp = SETORES.filter(s => !sel.includes(s.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sel.map(id => { const m = setorMeta(id); return m ? (
        <span key={id} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
          {m.icon} {m.label}
          <button type="button" onClick={() => { const next = sel.filter(x => x !== id); onChange(next.length ? next : undefined); }} className="opacity-60 hover:opacity-100">✕</button>
        </span>
      ) : null; })}
      {disp.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) onChange([...sel, e.target.value]); }} className={selCls}>
          <option value="">{sel.length ? "➕ responsável" : "👤 Responsável…"}</option>
          {disp.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
        </select>
      )}
    </div>
  );
}

// Achata um processo em texto puro pra mandar de contexto pra IA.
function procToTexto(p: WikiProcesso): string {
  const linhas: string[] = [];
  if (p.resumo) linhas.push(`Resumo: ${p.resumo}`);
  if (p.formato === "texto") linhas.push(p.conteudo || "");
  else if (p.formato === "checklist") linhas.push(...(p.itens || []).map(i => `☐ ${i.texto}`));
  else if (p.formato === "passos") linhas.push(...(p.passos || []).map((s, i) => `Passo ${i + 1}${s.titulo ? ` — ${s.titulo}` : ""}: ${s.descricao}`));
  return linhas.join("\n").trim();
}

export function WikiProcessosPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const { can, loading: loadingPerfis } = useCanAcao(rid || "");
  const { perfis } = useAccessProfiles();
  const podeVer = can("wikiProcessos", "ver") || can("wikiProcessos", "criar") || can("wikiProcessos", "editar");
  const podeCriar = can("wikiProcessos", "criar");
  const podeEditar = can("wikiProcessos", "editar");
  const podeDeletar = can("wikiProcessos", "deletar");
  const podeCadastrar = podeCriar || podeEditar || podeDeletar;

  const [procs, setProcs] = useState<WikiProcesso[]>([]);
  const [aba, setAba] = useState<"visualizacao" | "minhas" | "cadastro">("visualizacao");
  const [busca, setBusca] = useState("");
  const [filtroArea, setFiltroArea] = useState<string>("todas");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<WikiProcesso | null>(null);
  const [lendo, setLendo] = useState<WikiProcesso | null>(null);
  const [perguntando, setPerguntando] = useState(false);
  const [ditando, setDitando] = useState(false);
  const [semeando, setSemeando] = useState(false);
  const [editVoz, setEditVoz] = useState<WikiProcesso | null>(null);
  const [rascunhoIA, setRascunhoIA] = useState<Partial<WikiProcesso> | null>(null);
  const [configSetores, setConfigSetores] = useState(false);
  const [setoresMap, setSetoresMap] = useState<Record<string, string[]>>({});
  const [pessoasRid, setPessoasRid] = useState<{ id: string; nome: string; profileId?: string }[]>([]);
  const [diretrizesIA, setDiretrizesIA] = useState("");

  useEffect(() => {
    const u = onSnapshot(query(collection(db, "wikiProcessos"), orderBy("titulo")),
      snap => setProcs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as WikiProcesso).filter(p => !p.deletadoEm && p.ativo !== false)));
    return () => u();
  }, []);

  useEffect(() => {
    if (!rid) return;
    const uc = onSnapshot(doc(db, "wikiConfig", rid), snap => setSetoresMap((snap.data() as { setoresResponsaveis?: Record<string, string[]> } | undefined)?.setoresResponsaveis || {}));
    const ui = onSnapshot(doc(db, "iaConfig", rid), snap => setDiretrizesIA((snap.data() as { diretrizes?: string } | undefined)?.diretrizes || ""));
    const up = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      snap => setPessoasRid(snap.docs.map(d => { const dt = d.data() as { nome?: string; profileIds?: Record<string, string> }; return { id: d.id, nome: dt.nome || "—", profileId: dt.profileIds?.[rid] }; }).sort((a, b) => a.nome.localeCompare(b.nome))));
    return () => { uc(); ui(); up(); };
  }, [rid]);

  if (!pessoa) return null;
  if (loadingPerfis) return <div className="max-w-5xl mx-auto p-6 text-sm text-gray-400">Carregando…</div>;
  if (!podeVer) return <div className="max-w-5xl mx-auto p-8 text-center text-gray-500">Você não tem permissão para acessar a Wiki de Processos.</div>;

  const abaAtual = aba === "cadastro" && !podeCadastrar ? "visualizacao" : aba;
  // Escopo por categoria: null = todas; [...] = só essas áreas (perfil restrito).
  const catsPermitidas = wikiCategoriasAcessiveis(pessoa, rid || "", perfis);
  const daEmpresaTodas = procs.filter(p => (p.restaurantIds || []).includes(rid || ""));
  const daEmpresa = catsPermitidas ? daEmpresaTodas.filter(p => catsPermitidas.includes(p.area)) : daEmpresaTodas;
  const areas = [...new Set(daEmpresa.map(p => p.area).filter(Boolean))].sort();
  // Nomes reais por setor, somando DUAS fontes:
  //  (a) mapa manual wikiConfig/{rid}.setoresResponsaveis;
  //  (b) pessoas cujo PERFIL DE ACESSO neste rid está marcado com o setor
  //      (AccessProfile.wikiSetores) — a correlação vive no perfil, não na etapa.
  const nomePessoa = (id: string) => pessoasRid.find(p => p.id === id)?.nome;
  const setorNomes: Record<string, string[]> = {};
  for (const s of SETORES) {
    const manual = (setoresMap[s.id] || []).map(nomePessoa).filter(Boolean) as string[];
    const porPerfil = pessoasRid.filter(p => resolverPerfil(p.profileId, perfis)?.wikiSetores?.includes(s.id)).map(p => p.nome);
    setorNomes[s.id] = [...new Set([...manual, ...porPerfil])];
  }
  // Meus setores neste rid = mapa manual (eu na lista) + meu perfil de acesso.
  const meuPerfil = resolverPerfil((pessoa.profileIds as Record<string, string> | undefined)?.[rid || ""], perfis);
  const meusSetores = new Set<string>([
    ...SETORES.filter(s => (setoresMap[s.id] || []).includes(pessoa.id)).map(s => s.id),
    ...(meuPerfil?.wikiSetores || []),
  ]);
  // Minhas etapas: etapas (passo/checklist) de qualquer processo cujo responsável
  // inclua um setor meu. Respeita o filtro de área.
  const baseMinhas = daEmpresa.filter(p => filtroArea === "todas" || p.area === filtroArea);
  const minhasPorProc = baseMinhas.map(p => {
    const etapas: { tipo: "passo" | "item"; idx: number; titulo?: string; texto: string; setores: string[] }[] = [];
    (p.passos || []).forEach((s, i) => { const rs = respsDe(s).filter(r => meusSetores.has(r)); if (rs.length) etapas.push({ tipo: "passo", idx: i, titulo: s.titulo, texto: s.descricao, setores: rs }); });
    (p.itens || []).forEach((it, i) => { const rs = respsDe(it).filter(r => meusSetores.has(r)); if (rs.length) etapas.push({ tipo: "item", idx: i, titulo: undefined, texto: it.texto, setores: rs }); });
    return { proc: p, etapas };
  }).filter(g => g.etapas.length > 0);
  const totalMinhas = minhasPorProc.reduce((n, g) => n + g.etapas.length, 0);
  const q = busca.trim().toLowerCase();
  const visiveis = daEmpresa.filter(p =>
    (filtroArea === "todas" || p.area === filtroArea) &&
    (!q || `${p.titulo} ${p.resumo || ""} ${(p.tags || []).join(" ")} ${p.area}`.toLowerCase().includes(q))
  );
  // Agrupa por área
  const porArea = new Map<string, WikiProcesso[]>();
  for (const p of visiveis) { const a = p.area || "Sem área"; const arr = porArea.get(a) || []; arr.push(p); porArea.set(a, arr); }

  const chip = (active: boolean, label: string, onClick: () => void, key?: string) => (
    <button key={key} type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
  );
  const tabBtn = (val: "visualizacao" | "minhas" | "cadastro", label: string, badge?: number) => (
    <button type="button" onClick={() => setAba(val)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${abaAtual === val ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
      {label}{badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{badge}</span> : null}
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* Abas Visualização / Cadastro */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {tabBtn("visualizacao", "👁️ Visualização")}
        {meusSetores.size > 0 && tabBtn("minhas", "🙋 Minhas etapas", totalMinhas)}
        {podeCadastrar && tabBtn("cadastro", "📝 Cadastro")}
      </div>

      {/* Busca + filtros de área (nas duas abas) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔎 Buscar processo…"
          className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100 flex-1 min-w-[180px]" />
        {areas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chip(filtroArea === "todas", "Todas as áreas", () => setFiltroArea("todas"))}
            {areas.map(a => chip(filtroArea === a, a, () => setFiltroArea(a), a))}
          </div>
        )}
      </div>

      {abaAtual === "visualizacao" ? (
        <>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-sm text-gray-500">{daEmpresa.length} processo{daEmpresa.length === 1 ? "" : "s"} documentado{daEmpresa.length === 1 ? "" : "s"}</div>
            {daEmpresa.length > 0 && <Button variant="secondary" onClick={() => setPerguntando(true)}>🤖 Pergunte à IA</Button>}
          </div>

          {daEmpresa.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <div className="text-4xl mb-2">📚</div>
              <p>Nenhum processo documentado nesta empresa ainda.</p>
              {podeCadastrar && <p className="text-sm mt-1">Vá na aba <b>Cadastro</b> pra documentar o primeiro: abertura da casa, fechamento de caixa, limpeza, recebimento…</p>}
            </div>
          ) : visiveis.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nada encontrado pra essa busca/filtro.</div>
          ) : (
            <div className="space-y-5">
              {[...porArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, lista]) => (
                <div key={area}>
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{area}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {lista.map(p => (
                      <button key={p.id} type="button" onClick={() => setLendo(p)}
                        className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all flex gap-3 items-start">
                        <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg ${FORMATO_META[p.formato].cls}`}>{FORMATO_META[p.formato].icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{p.titulo}</span>
                            {p.publicado === false && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>}
                          </div>
                          {p.resumo && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{p.resumo}</div>}
                          <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                            <span>{FORMATO_LABEL[p.formato]}</span>
                            {nEtapas(p) > 0 && <span>· {nEtapas(p)} {p.formato === "passos" ? "passos" : "itens"}</span>}
                            {(p.fotos?.length ?? 0) > 0 && <span>· 📎 {p.fotos!.length}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : abaAtual === "minhas" ? (
        // ── Aba Minhas etapas ──────────────────────────────────────────────
        <>
          <div className="text-sm text-gray-500 mb-3">
            Etapas onde você é responsável{meuPerfil?.nome ? ` (perfil ${meuPerfil.nome})` : ""} — {[...meusSetores].map(id => setorMeta(id)?.label).filter(Boolean).join(", ")}.
          </div>
          {totalMinhas === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <div className="text-4xl mb-2">🙋</div>
              <p>Nenhuma etapa atribuída a você{filtroArea !== "todas" ? " nesta área" : ""}.</p>
              <p className="text-sm mt-1">Quando um processo marcar um setor seu como responsável de uma etapa, ela aparece aqui.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {minhasPorProc.map(({ proc, etapas }) => (
                <div key={proc.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                  <button type="button" onClick={() => setLendo(proc)} className="text-left w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{proc.titulo}</span>
                      <span className="text-[11px] text-gray-400">{proc.area} · {FORMATO_LABEL[proc.formato]} · abrir →</span>
                    </div>
                  </button>
                  <div className="mt-2 space-y-1.5">
                    {etapas.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50/70 dark:bg-gray-800/40">
                        <span className="shrink-0 text-[11px] font-bold text-indigo-600 dark:text-indigo-300 mt-0.5">{e.tipo === "passo" ? `${e.idx + 1}.` : "☐"}</span>
                        <div className="flex-1 min-w-0">
                          {e.titulo && <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{e.titulo}</div>}
                          <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">{e.texto}</div>
                          <div className="flex flex-wrap gap-1 mt-1">{e.setores.map(sid => <SetorBadge key={sid} id={sid} />)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        // ── Aba Cadastro ───────────────────────────────────────────────────
        <>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-sm text-gray-500">Gerencie os processos: crie, edite (inclusive por voz) e exclua.</div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" onClick={() => setConfigSetores(true)}>👥 Responsáveis por setor</Button>
              {podeCriar && <>
                <Button variant="secondary" onClick={() => setSemeando(true)}>🌱 Sugestões</Button>
                <Button variant="secondary" onClick={() => setDitando(true)}>🎙️ Gravar por voz</Button>
                <Button onClick={() => setCriando(true)}>+ Novo processo</Button>
              </>}
            </div>
          </div>

          {visiveis.length === 0 ? (
            <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
              {daEmpresa.length === 0 ? "Nenhum processo ainda. Crie o primeiro acima." : "Nada encontrado pra essa busca/filtro."}
            </div>
          ) : (
            <div className="space-y-5">
              {[...porArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, lista]) => (
                <div key={area}>
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{area}</div>
                  <div className="space-y-2">
                    {lista.map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                        <button type="button" onClick={() => setLendo(p)} className="flex-1 min-w-0 text-left">
                          <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 truncate">
                            {p.titulo}
                            {p.publicado === false && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">rascunho</span>}
                            {(p.restaurantIds?.length ?? 0) > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">🏢 {p.restaurantIds!.length}</span>}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{FORMATO_LABEL[p.formato]}{p.resumo ? ` · ${p.resumo}` : ""}</div>
                        </button>
                        {podeEditar && <button type="button" onClick={() => setEditVoz(p)} title="Editar por voz com IA" className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">🎙️ IA</button>}
                        {podeEditar && <button type="button" onClick={() => setEditando(p)} title="Editar" className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">✏️</button>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {perguntando && <PerguntarIAModal processos={daEmpresa} diretrizes={diretrizesIA} rid={rid || ""} pessoaId={pessoa.id} pessoaNome={pessoa.nome} onClose={() => setPerguntando(false)} onAbrirProc={p => { setPerguntando(false); setLendo(p); }} />}
      {ditando && podeCriar && <DitarModal areasExistentes={areas} onClose={() => setDitando(false)}
        onRascunho={r => { setRascunhoIA(r); setDitando(false); setCriando(true); }} />}
      {semeando && podeCriar && <SemearModal existentes={daEmpresa.map(p => p.titulo.toLowerCase())} ridAtual={rid || ""} pessoaId={pessoa.id} onClose={() => setSemeando(false)} />}
      {editVoz && podeEditar && <EditarVozModal proc={editVoz} onClose={() => setEditVoz(null)}
        onAplicar={p => { setEditVoz(null); setEditando(p); }} />}
      {configSetores && <ResponsaveisSetorModal rid={rid || ""} pessoas={pessoasRid} mapaInicial={setoresMap} podeEditar={podeCadastrar}
        onClose={() => setConfigSetores(false)} />}
      {lendo && <LerModal proc={lendo} processos={daEmpresa} setorNomes={setorNomes} onClose={() => setLendo(null)} onAbrirProc={p => setLendo(p)} />}
      {(criando || editando) && (
        <WikiForm proc={editando} rascunhoInicial={editando ? null : rascunhoIA} podeDeletar={podeDeletar}
          onClose={() => { setCriando(false); setEditando(null); setRascunhoIA(null); }}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))} ridAtual={rid || ""}
          areasExistentes={areas} categoriasPermitidas={catsPermitidas}
          processosDaEmpresa={daEmpresa.filter(p => p.id !== editando?.id).map(p => ({ id: p.id, titulo: p.titulo, area: p.area }))}
          pessoaId={pessoa.id} />
      )}
    </div>
  );
}

// ─── Pergunte à IA (Fase 2) ──────────────────────────────────────────────────
type ChatMsg = { role: "user"; texto: string } | { role: "ia"; texto: string; fontes: WikiProcesso[] };
function PerguntarIAModal({ processos, diretrizes, rid, pessoaId, pessoaNome, onClose, onAbrirProc }: {
  processos: WikiProcesso[]; diretrizes: string; rid: string; pessoaId: string; pessoaNome: string; onClose: () => void; onAbrirProc: (p: WikiProcesso) => void;
}) {
  const [pergunta, setPergunta] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const dit = useDitado();
  // Só processos publicados vão de contexto (rascunho não conta).
  const base = processos.filter(p => p.publicado !== false);
  const valorInput = dit.gravando ? (dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : "")) : pergunta;
  function micToggle() {
    if (dit.gravando) { dit.parar(); setPergunta((dit.transcricao + " " + dit.parcial).replace(/\s+/g, " ").trim()); }
    else { setErro(""); dit.setTranscricao(pergunta); dit.setParcial(""); dit.iniciar(); }
  }

  async function enviar() {
    const q = (dit.gravando ? (dit.transcricao + " " + dit.parcial) : pergunta).replace(/\s+/g, " ").trim();
    if (!q || carregando) return;
    if (dit.gravando) dit.parar();
    setErro("");
    setMsgs(m => [...m, { role: "user", texto: q }]);
    setPergunta(""); dit.setTranscricao(""); dit.setParcial("");
    setCarregando(true);
    try {
      const r = await fetch("/api/wiki-perguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ pergunta: q, diretrizes, processos: base.map(p => ({ id: p.id, titulo: p.titulo, area: p.area, texto: procToTexto(p) })) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      const fontes = (data.fontesIds as string[] || []).map(id => base.find(p => p.id === id)).filter(Boolean) as WikiProcesso[];
      setMsgs(m => [...m, { role: "ia", texto: String(data.resposta || ""), fontes }]);
      // Registro jurídico da interação (LGPD/auditoria). Best-effort — não quebra a UX.
      if (rid) {
        const iid = `ia-${uid()}`;
        setDoc(doc(db, "iaInteracoes", iid), sanitizeForFirestore({
          id: iid, restaurantId: rid, moduleId: "wikiProcessos", moduleLabel: "Wiki de Processos", canal: "pergunte-ia",
          pessoaId, pessoaNome, pergunta: q, resposta: String(data.resposta || ""),
          foraDeEscopo: data.foraDeEscopo === true, motivo: String(data.motivo || ""), createdAt: new Date().toISOString(),
        })).catch(() => {});
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar a IA.");
    } finally { setCarregando(false); }
  }

  const sugestoes = base.slice(0, 3).map(p => `Como funciona: ${p.titulo}?`);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🤖 Pergunte à IA</h2>
            <div className="text-xs text-gray-500">Respostas a partir dos {base.length} processo{base.length === 1 ? "" : "s"} publicado{base.length === 1 ? "" : "s"} da wiki.</div>
            <div className="text-[10px] text-gray-400 mt-0.5">🔒 Para sua segurança e conformidade (LGPD), as interações com a IA são registradas.</div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px]">
          {msgs.length === 0 && (
            <div className="text-center text-gray-500 dark:text-gray-400 py-6">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm">Pergunte qualquer coisa sobre os processos documentados.</p>
              {sugestoes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {sugestoes.map((s, i) => (
                    <button key={i} type="button" onClick={() => setPergunta(s)}
                      className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap">{m.texto}</div></div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%]">
                <div className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed">{m.texto}</div>
                {m.fontes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-gray-400 self-center">Fontes:</span>
                    {m.fontes.map(p => (
                      <button key={p.id} type="button" onClick={() => onAbrirProc(p)}
                        className="text-[11px] px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">📄 {p.titulo}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {carregando && <div className="flex justify-start"><div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-gray-500">Consultando a wiki…</div></div>}
          {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        </div>

        <div className="px-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          {dit.gravando && <div className="text-[11px] text-rose-600 mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" /> Ouvindo… fale sua pergunta</div>}
          {dit.erroMic && <div className="text-[11px] text-rose-600 mb-1">{dit.erroMic}</div>}
        </div>
        <div className="p-3 pt-1 flex gap-2 items-center">
          <button type="button" onClick={micToggle} disabled={carregando} title={dit.gravando ? "Parar" : "Perguntar por voz"}
            className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-lg ${dit.gravando ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20 text-rose-600" : "border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{dit.gravando ? "⏹️" : "🎙️"}</button>
          <input value={valorInput} onChange={e => { setPergunta(e.target.value); if (dit.gravando) dit.parar(); }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            placeholder="Digite ou fale sua pergunta…" autoFocus disabled={carregando}
            className="flex-1 h-10 px-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100" />
          <Button onClick={enviar} disabled={carregando || !valorInput.trim()}>Enviar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Gravar por voz → IA modela o rascunho (Fase 2) ──────────────────────────
function DitarModal({ areasExistentes, onClose, onRascunho }: {
  areasExistentes: string[]; onClose: () => void; onRascunho: (r: Partial<WikiProcesso>) => void;
}) {
  const [gravando, setGravando] = useState(false);
  const [transcricao, setTranscricao] = useState("");
  const [parcial, setParcial] = useState("");
  const [modelando, setModelando] = useState(false);
  const [erro, setErro] = useState("");
  const recRef = useRef<any>(null);
  const querGravarRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

  useEffect(() => () => { querGravarRef.current = false; try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  function iniciar() {
    setErro("");
    if (!SR) { setErro("Seu navegador não suporta ditado por voz. Use o Chrome/Edge no computador — ou digite/cole o texto abaixo e clique em montar."); return; }
    const rec = new SR();
    rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let fim = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fim += t; else interim += t;
      }
      if (fim) setTranscricao(prev => (prev + " " + fim).replace(/\s+/g, " ").trimStart());
      setParcial(interim);
    };
    rec.onerror = (ev: any) => { if (ev.error !== "no-speech" && ev.error !== "aborted") setErro("Erro no microfone: " + ev.error); };
    rec.onend = () => { if (querGravarRef.current) { try { rec.start(); } catch { /* já rodando */ } } else { setGravando(false); setParcial(""); } };
    recRef.current = rec;
    querGravarRef.current = true;
    try { rec.start(); setGravando(true); } catch { setErro("Não consegui acessar o microfone."); }
  }
  function parar() { querGravarRef.current = false; try { recRef.current?.stop(); } catch { /* noop */ } setGravando(false); setParcial(""); }

  async function modelar() {
    const txt = (transcricao + " " + parcial).trim();
    if (txt.length < 3) { setErro("Fale ou digite o processo primeiro."); return; }
    if (gravando) parar();
    setModelando(true); setErro("");
    try {
      const r = await fetch("/api/wiki-modelar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ transcricao: txt, areas: areasExistentes, setores: SETORES.map(s => ({ id: s.id, label: s.label })) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      const rascunho: Partial<WikiProcesso> = {
        titulo: d.titulo || "", area: d.area || "", resumo: d.resumo || "",
        formato: (d.formato as WikiFormato) || "texto",
        conteudo: d.formato === "texto" ? (d.conteudo || "") : "",
        itens: d.formato === "checklist" ? ((d.itens as { texto?: string; responsaveis?: string[] }[]) || []).map(it => ({ id: uid(), texto: it.texto || "", responsaveis: Array.isArray(it.responsaveis) && it.responsaveis.length ? it.responsaveis : undefined })) : [],
        passos: d.formato === "passos" ? ((d.passos as { titulo?: string; descricao?: string; responsaveis?: string[] }[]) || []).map(p => ({ id: uid(), titulo: p.titulo || "", descricao: p.descricao || "", foto: null, responsaveis: Array.isArray(p.responsaveis) && p.responsaveis.length ? p.responsaveis : undefined })) : [],
      };
      onRascunho(rascunho);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao modelar.");
    } finally { setModelando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🎙️ Gravar processo por voz</h2>
        <p className="text-xs text-gray-500 mt-1 mb-4">Fale explicando o processo do seu jeito — a IA organiza em título, área e passos pra você revisar antes de salvar.</p>

        <div className="flex items-center gap-3 mb-3">
          {!gravando ? (
            <Button onClick={iniciar} disabled={modelando}>🎙️ {transcricao ? "Continuar gravando" : "Começar a falar"}</Button>
          ) : (
            <button type="button" onClick={parar} className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-rose-600 text-white text-sm font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" /> Parar
            </button>
          )}
          {gravando && <span className="text-xs text-rose-600">Ouvindo…</span>}
        </div>

        <textarea
          value={transcricao + (parcial ? (transcricao ? " " : "") + parcial : "")}
          onChange={e => { setTranscricao(e.target.value); setParcial(""); }}
          rows={7} disabled={gravando}
          placeholder="A transcrição aparece aqui enquanto você fala. Você pode editar antes de montar."
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />

        {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2 mt-2">{erro}</div>}

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={modelar} disabled={modelando || (transcricao + parcial).trim().length < 3}>{modelando ? "Montando…" : "✨ Montar processo com IA"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Semear processos sugeridos como rascunhos ───────────────────────────────
function SemearModal({ existentes, ridAtual, pessoaId, onClose }: {
  existentes: string[]; ridAtual: string; pessoaId: string; onClose: () => void;
}) {
  const jaTem = new Set(existentes);
  const inicial = new Set<string>();
  PROCESSOS_SUGERIDOS.forEach(g => g.titulos.forEach(t => { if (!jaTem.has(t.toLowerCase())) inicial.add(`${g.area}|${t}`); }));
  const [sel, setSel] = useState<Set<string>>(inicial);
  const [salvando, setSalvando] = useState(false);
  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function criar() {
    if (sel.size === 0) return;
    setSalvando(true);
    try {
      const now = new Date().toISOString();
      await Promise.all([...sel].map(k => {
        const [area, ...rest] = k.split("|"); const titulo = rest.join("|");
        const id = `wk-${uid()}`;
        return setDoc(doc(db, "wikiProcessos", id), sanitizeForFirestore({
          id, restaurantIds: ridAtual ? [ridAtual] : [], area, titulo, formato: "passos",
          passos: [], itens: [], fotos: [], publicado: false, ativo: true,
          criadoEm: now, criadoPor: pessoaId, atualizadoEm: now, atualizadoPor: pessoaId,
        } as WikiProcesso));
      }));
      alert(`${sel.size} rascunho(s) criado(s). Preencha o conteúdo pela aba Cadastro (por voz ou texto).`);
      onClose();
    } catch (e) { alert("Erro ao semear: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🌱 Processos sugeridos</h2>
        <p className="text-xs text-gray-500 mt-1 mb-3">Cria rascunhos (título + área) pra você preencher depois. Os que já existem aparecem desmarcados.</p>
        <div className="space-y-3">
          {PROCESSOS_SUGERIDOS.map(g => (
            <div key={g.area}>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{g.area}</div>
              <div className="space-y-1">
                {g.titulos.map(t => { const k = `${g.area}|${t}`; const existe = jaTem.has(t.toLowerCase()); return (
                  <label key={k} className={`flex items-center gap-2 text-sm p-1.5 rounded-lg ${existe ? "opacity-40" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    <input type="checkbox" disabled={existe} checked={sel.has(k)} onChange={() => toggle(k)} />
                    <span className="text-gray-700 dark:text-gray-300">{t}</span>{existe && <span className="text-[10px] text-gray-400">já existe</span>}
                  </label>
                ); })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={criar} disabled={salvando || sel.size === 0}>{salvando ? "Criando…" : `Criar ${sel.size || ""} rascunho(s)`}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Editar processo existente por voz + IA ──────────────────────────────────
function EditarVozModal({ proc, onClose, onAplicar }: {
  proc: WikiProcesso; onClose: () => void; onAplicar: (p: WikiProcesso) => void;
}) {
  const dit = useDitado();
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<WikiProcesso | null>(null);
  const [mudancas, setMudancas] = useState<string[]>([]);

  async function aplicar() {
    const txt = (dit.transcricao + " " + dit.parcial).trim();
    if (txt.length < 3) { setErro("Fale ou digite a instrução primeiro."); return; }
    if (dit.gravando) dit.parar();
    setAplicando(true); setErro("");
    try {
      const r = await fetch("/api/wiki-editar-voz", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ instrucao: txt, processo: {
          titulo: proc.titulo, area: proc.area, resumo: proc.resumo || "", formato: proc.formato,
          conteudo: proc.conteudo || "", itens: proc.itens || [], passos: (proc.passos || []).map(p => ({ id: p.id, titulo: p.titulo, descricao: p.descricao })),
        } }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      const fmt = (d.formato as WikiFormato) || proc.formato;
      const atualizado: WikiProcesso = {
        ...proc,
        titulo: d.titulo || proc.titulo, area: d.area || proc.area,
        resumo: (d.resumo && String(d.resumo).trim()) ? String(d.resumo).trim() : proc.resumo,
        formato: fmt,
        conteudo: fmt === "texto" ? (d.conteudo || "") : undefined,
        itens: fmt === "checklist" ? ((d.itens as { id?: string; texto?: string }[]) || []).map(i => { const orig = (proc.itens || []).find(x => x.id === i.id); return { id: i.id || uid(), texto: i.texto || "", responsaveis: orig ? respsDe(orig) : undefined }; }) : undefined,
        passos: fmt === "passos" ? ((d.passos as { id?: string; titulo?: string; descricao?: string }[]) || []).map(p => { const orig = (proc.passos || []).find(x => x.id === p.id); return { id: p.id || uid(), titulo: p.titulo || "", descricao: p.descricao || "", foto: orig?.foto || null, responsaveis: orig ? respsDe(orig) : undefined, processoVinculadoId: orig?.processoVinculadoId }; }) : undefined,
      };
      setResultado(atualizado);
      setMudancas(Array.isArray(d.resumoMudancas) ? d.resumoMudancas : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar a edição.");
    } finally { setAplicando(false); }
  }

  const textoAtual = (dit.transcricao + (dit.parcial ? (dit.transcricao ? " " : "") + dit.parcial : ""));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🎙️ Editar por voz — <span className="text-indigo-600 dark:text-indigo-400">{proc.titulo}</span></h2>
        <p className="text-xs text-gray-500 mt-1 mb-4">Fale o que mudar: <i>"adiciona um passo no fim: fechar o gás"</i>, <i>"tira o item sobre X"</i>, <i>"corrige o horário no passo 2 pra 22h"</i>. A IA aplica e você revisa antes de salvar.</p>

        {!resultado ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              {!dit.gravando ? (
                <Button onClick={dit.iniciar} disabled={aplicando}>🎙️ {dit.transcricao ? "Continuar" : "Falar a instrução"}</Button>
              ) : (
                <button type="button" onClick={dit.parar} className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-rose-600 text-white text-sm font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" /> Parar
                </button>
              )}
              {dit.gravando && <span className="text-xs text-rose-600">Ouvindo…</span>}
            </div>
            <textarea value={textoAtual} onChange={e => { dit.setTranscricao(e.target.value); dit.setParcial(""); }} rows={4} disabled={dit.gravando}
              placeholder="A instrução aparece aqui. Pode editar antes de aplicar."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            {(erro || dit.erroMic) && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2 mt-2">{erro || dit.erroMic}</div>}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button onClick={aplicar} disabled={aplicando || textoAtual.trim().length < 3}>{aplicando ? "Aplicando…" : "✨ Aplicar com IA"}</Button>
            </div>
          </>
        ) : (
          <>
            {mudancas.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 mb-3">
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">O que a IA mudou:</div>
                <ul className="text-sm text-emerald-800 dark:text-emerald-200 space-y-0.5">{mudancas.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            ) : <div className="text-sm text-gray-500 mb-3">A IA não indicou mudanças. Revise abaixo.</div>}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 mb-3">
              <div className="text-xs font-semibold text-gray-500 mb-1">{FORMATO_LABEL[resultado.formato]} · prévia</div>
              <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap max-h-52 overflow-y-auto">{procToTexto(resultado) || "(sem conteúdo)"}</div>
            </div>
            <div className="flex gap-2 justify-between mt-4">
              <Button variant="ghost" onClick={() => { setResultado(null); setMudancas([]); }}>↩︎ Refazer</Button>
              <Button onClick={() => onAplicar(resultado)}>Revisar no editor e salvar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Responsáveis por setor (setor → pessoas reais da empresa) ────────────────
function ResponsaveisSetorModal({ rid, pessoas, mapaInicial, podeEditar, onClose }: {
  rid: string; pessoas: { id: string; nome: string }[]; mapaInicial: Record<string, string[]>; podeEditar?: boolean; onClose: () => void;
}) {
  const [mapa, setMapa] = useState<Record<string, string[]>>(() => structuredClone(mapaInicial || {}));
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const toggle = (setorId: string, pessoaId: string) => setMapa(m => {
    const cur = m[setorId] || [];
    return { ...m, [setorId]: cur.includes(pessoaId) ? cur.filter(x => x !== pessoaId) : [...cur, pessoaId] };
  });
  const nomesDe = (setorId: string) => (mapa[setorId] || []).map(id => pessoas.find(p => p.id === id)?.nome).filter(Boolean) as string[];

  async function salvar() {
    setSalvando(true);
    try {
      await setDoc(doc(db, "wikiConfig", rid), sanitizeForFirestore({ restaurantId: rid, setoresResponsaveis: mapa, atualizadoEm: new Date().toISOString() }), { merge: true });
      onClose();
    } catch (e) { alert("Erro ao salvar: " + (e instanceof Error ? e.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">👥 Responsáveis por setor</h2>
        <p className="text-xs text-gray-500 mt-1 mb-4">Defina quem é cada setor nesta empresa. O nome aparece nas etapas dos processos que marcam esse setor como responsável.</p>

        {pessoas.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">Nenhuma pessoa cadastrada nesta empresa ainda.</div>
        ) : (
          <div className="space-y-2">
            {SETORES.map(s => {
              const nomes = nomesDe(s.id);
              const open = aberto === s.id;
              return (
                <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                  <button type="button" onClick={() => setAberto(open ? null : s.id)} className="w-full flex items-center justify-between gap-2 p-3 text-left">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.cls}`}>{s.icon} {s.label}</span>
                    <span className="text-xs text-gray-500 truncate">{nomes.length ? nomes.join(", ") : "ninguém"} {open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-gray-100 dark:border-gray-800 pt-2">
                      {pessoas.map(p => (
                        <label key={p.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                          <input type="checkbox" disabled={!podeEditar} checked={(mapa[s.id] || []).includes(p.id)} onChange={() => toggle(s.id, p.id)} />{p.nome}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <Button variant="ghost" onClick={onClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
          {podeEditar && <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>}
        </div>
      </div>
    </div>
  );
}

// ─── Leitura (consulta) ──────────────────────────────────────────────────────
function LerModal({ proc, processos, setorNomes, onClose, onAbrirProc }: { proc: WikiProcesso; processos: WikiProcesso[]; setorNomes: Record<string, string[]>; onClose: () => void; onAbrirProc: (p: WikiProcesso) => void }) {
  const nPassos = proc.passos?.length ?? 0;
  const nItens = proc.itens?.length ?? 0;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Cabeçalho colorido */}
        <div className="relative px-6 pt-5 pb-4 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/25 dark:to-gray-900 border-b border-gray-100 dark:border-gray-800">
          <button type="button" onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-200/60 dark:hover:bg-gray-700/60">✕</button>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{proc.area}</span>
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{FORMATO_LABEL[proc.formato]}</span>
            {nPassos > 0 && <span className="text-[11px] text-gray-400">{nPassos} passo{nPassos === 1 ? "" : "s"}</span>}
            {nItens > 0 && <span className="text-[11px] text-gray-400">{nItens} ite{nItens === 1 ? "m" : "ns"}</span>}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight pr-8">{proc.titulo}</h2>
          {proc.resumo && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{proc.resumo}</p>}
          <div className="mt-3">
            <span className="text-[11px] text-gray-400">atualizado {fmtBR((proc.atualizadoEm || "").slice(0, 10))}</span>
          </div>
        </div>

        {/* Corpo */}
        <div className="px-6 py-5 overflow-y-auto">
          {proc.formato === "texto" && (
            <div className="text-[15px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-7">{proc.conteudo || <span className="text-gray-400">Sem conteúdo.</span>}</div>
          )}

          {proc.formato === "checklist" && (
            <ul className="space-y-2">
              {(proc.itens || []).map(it => (
                <li key={it.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/30">
                  <span className="shrink-0 w-6 h-6 rounded-md border-2 border-emerald-400 dark:border-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[15px] text-gray-800 dark:text-gray-200 leading-snug">{it.texto}</span>
                    {(() => { const vinc = it.processoVinculadoId ? processos.find(x => x.id === it.processoVinculadoId) : undefined; return vinc ? (
                      <button type="button" onClick={() => onAbrirProc(vinc)} className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 align-middle">🔗 {vinc.titulo} →</button>
                    ) : null; })()}
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {respsDe(it).map(rid => <SetorBadge key={rid} id={rid} nomes={setorNomes[rid]} />)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {proc.formato === "passos" && (
            <div className="relative">
              {nPassos > 1 && <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-indigo-300 to-indigo-100 dark:from-indigo-700 dark:to-indigo-900/40" />}
              <ol className="space-y-4">
                {(proc.passos || []).map((s, i) => (
                  <li key={s.id} className="relative pl-12">
                    <span className="absolute left-0 top-0 w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center ring-4 ring-white dark:ring-gray-900 shadow-sm">{i + 1}</span>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/30 p-3.5">
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                        {s.titulo ? <div className="font-semibold text-gray-900 dark:text-gray-100">{s.titulo}</div> : <span />}
                        <div className="flex flex-wrap gap-1 justify-end">
                          {respsDe(s).map(rid => <SetorBadge key={rid} id={rid} nomes={setorNomes[rid]} />)}
                        </div>
                      </div>
                      <div className="text-[15px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{s.descricao}</div>
                      {(() => { const vinc = s.processoVinculadoId ? processos.find(x => x.id === s.processoVinculadoId) : undefined; return vinc ? (
                        <button type="button" onClick={() => onAbrirProc(vinc)}
                          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40">
                          🔗 Ver processo: {vinc.titulo} →
                        </button>
                      ) : null; })()}
                      {s.foto && <a href={s.foto.url} target="_blank" rel="noreferrer"><img src={s.foto.url} alt="" className="mt-2.5 rounded-lg max-h-60 border border-gray-200 dark:border-gray-700" /></a>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {(proc.fotos?.length ?? 0) > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs font-medium text-gray-500 mb-2">📎 Fotos</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {proc.fotos!.map(f => (
                  <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.legenda || ""} className="rounded-lg border border-gray-200 dark:border-gray-700 w-full h-28 object-cover hover:opacity-90 transition-opacity" /></a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Cadastro/edição ─────────────────────────────────────────────────────────
function WikiForm({ proc, rascunhoInicial, podeDeletar, categoriasPermitidas, processosDaEmpresa, onClose, restaurantes, ridAtual, areasExistentes, pessoaId }: {
  proc: WikiProcesso | null; rascunhoInicial?: Partial<WikiProcesso> | null; podeDeletar?: boolean;
  categoriasPermitidas?: string[] | null; processosDaEmpresa?: { id: string; titulo: string; area: string }[];
  onClose: () => void; restaurantes: { id: string; nome: string }[];
  ridAtual: string; areasExistentes: string[]; pessoaId: string;
}) {
  // Perfil restrito a certas categorias? Então o campo Área vira seleção fechada.
  const catsRestritas = categoriasPermitidas && categoriasPermitidas.length > 0 ? categoriasPermitidas : null;
  const [f, setF] = useState<Partial<WikiProcesso>>(proc ? { ...proc } : {
    titulo: "", area: catsRestritas && catsRestritas.length === 1 ? catsRestritas[0] : "", resumo: "", formato: "texto", restaurantIds: ridAtual ? [ridAtual] : [],
    conteudo: "", itens: [], passos: [], fotos: [], publicado: true, ativo: true,
    ...(rascunhoInicial || {}),
  });
  const [subindo, setSubindo] = useState(false);
  const nomeAtual = restaurantes.find(r => r.id === ridAtual)?.nome || "esta empresa";
  const [modoEmp, setModoEmp] = useState<"uma" | "varias">(() => {
    const ids = (proc ? proc.restaurantIds : f.restaurantIds) || [];
    return ids.length > 1 || (ids.length === 1 && ids[0] !== ridAtual) ? "varias" : "uma";
  });

  async function subirFoto(file: File): Promise<WikiFoto | null> {
    setSubindo(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `wiki/${ridAtual}/${uid()}.${ext}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(snap.ref);
      return { id: uid(), url, storagePath: path };
    } catch (e) { alert("Erro ao subir foto: " + (e instanceof Error ? e.message : "?")); return null; }
    finally { setSubindo(false); }
  }

  async function salvar() {
    if (!f.titulo?.trim()) { alert("Título é obrigatório"); return; }
    if (!f.area?.trim()) { alert("Escolha/defina a área"); return; }
    if (catsRestritas && !catsRestritas.includes(f.area.trim())) { alert("Seu perfil só pode cadastrar nas categorias: " + catsRestritas.join(", ")); return; }
    const now = new Date().toISOString();
    const id = proc?.id || `wk-${uid()}`;
    const data: WikiProcesso = {
      id, restaurantIds: f.restaurantIds?.length ? f.restaurantIds : (ridAtual ? [ridAtual] : []),
      area: f.area.trim(), titulo: f.titulo.trim(), resumo: f.resumo?.trim() || undefined,
      formato: f.formato || "texto",
      conteudo: f.formato === "texto" ? (f.conteudo || "") : undefined,
      itens: f.formato === "checklist" ? (f.itens || []).filter(i => i.texto.trim()) : undefined,
      passos: f.formato === "passos" ? (f.passos || []).filter(s => s.descricao.trim()) : undefined,
      fotos: f.fotos || [], tags: f.tags,
      publicado: f.publicado ?? true, ativo: true,
      criadoEm: proc?.criadoEm || now, criadoPor: proc?.criadoPor || pessoaId, atualizadoEm: now, atualizadoPor: pessoaId,
    };
    await setDoc(doc(db, "wikiProcessos", id), sanitizeForFirestore(data));
    onClose();
  }
  async function excluir() {
    if (!proc) return;
    if (!confirm(`Excluir "${proc.titulo}"? Vai pra lixeira.`)) return;
    await setDoc(doc(db, "wikiProcessos", proc.id), sanitizeForFirestore({ ...proc, deletadoEm: new Date().toISOString(), deletadoPor: pessoaId }));
    onClose();
  }

  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  const selSetor = "text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 shrink-0";
  const toggleRid = (id: string) => setF(p => { const cur = p.restaurantIds || []; return { ...p, restaurantIds: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }; });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{proc ? "Editar processo" : "Novo processo"}</h2>
        <div className="space-y-3">
          <Campo label="Título *"><input value={f.titulo || ""} onChange={e => setF({ ...f, titulo: e.target.value })} className={inp} autoFocus placeholder="Ex: Fechamento de caixa do turno" /></Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Área *">
              {catsRestritas ? (
                <select value={f.area || ""} onChange={e => setF({ ...f, area: e.target.value })} className={inp}>
                  <option value="">Escolha a categoria…</option>
                  {catsRestritas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <>
                  <input list="wiki-areas" value={f.area || ""} onChange={e => setF({ ...f, area: e.target.value })} className={inp} placeholder="Cozinha, Salão, DP, Financeiro…" />
                  <datalist id="wiki-areas">{areasExistentes.map(a => <option key={a} value={a} />)}</datalist>
                </>
              )}
            </Campo>
            <Campo label="Formato *">
              <select value={f.formato} onChange={e => setF({ ...f, formato: e.target.value as WikiFormato })} className={inp}>
                {(Object.keys(FORMATO_LABEL) as WikiFormato[]).map(k => <option key={k} value={k}>{FORMATO_LABEL[k]}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="Resumo (1 linha, opcional)"><input value={f.resumo || ""} onChange={e => setF({ ...f, resumo: e.target.value })} className={inp} placeholder="Do que se trata, em uma frase" /></Campo>

          {/* Conteúdo por formato */}
          {f.formato === "texto" && (
            <Campo label="Conteúdo"><textarea value={f.conteudo || ""} onChange={e => setF({ ...f, conteudo: e.target.value })} className={inp} rows={8} placeholder="Escreva o processo. Quebras de linha são mantidas." /></Campo>
          )}
          {f.formato === "checklist" && (
            <Campo label="Itens do checklist">
              <div className="space-y-1.5">
                {(f.itens || []).map((it, idx) => (
                  <div key={it.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-400">☐</span>
                    <input value={it.texto} onChange={e => setF({ ...f, itens: (f.itens || []).map(x => x.id === it.id ? { ...x, texto: e.target.value } : x) })} className={inp.replace("w-full", "") + " flex-1 min-w-[140px]"} placeholder={`Item ${idx + 1}`} />
                    <ResponsaveisPicker value={respsDe(it)} selCls={selSetor} onChange={rs => setF({ ...f, itens: (f.itens || []).map(x => x.id === it.id ? { ...x, responsaveis: rs, responsavel: undefined } : x) })} />
                    {(processosDaEmpresa?.length ?? 0) > 0 && (
                      <select value={it.processoVinculadoId || ""} onChange={e => setF({ ...f, itens: (f.itens || []).map(x => x.id === it.id ? { ...x, processoVinculadoId: e.target.value || undefined } : x) })} className={selSetor}>
                        <option value="">🔗 Vincular…</option>
                        {processosDaEmpresa!.map(pp => <option key={pp.id} value={pp.id}>{pp.titulo}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => setF({ ...f, itens: (f.itens || []).filter(x => x.id !== it.id) })} className="text-gray-400 hover:text-rose-600 text-sm">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => setF({ ...f, itens: [...(f.itens || []), { id: uid(), texto: "" } as WikiChecklistItem] })} className="text-xs text-indigo-600 hover:underline">+ item</button>
              </div>
            </Campo>
          )}
          {f.formato === "passos" && (
            <Campo label="Passos">
              <div className="space-y-3">
                {(f.passos || []).map((s, idx) => (
                  <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[11px] font-bold flex items-center justify-center">{idx + 1}</span>
                      <input value={s.titulo || ""} onChange={e => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, titulo: e.target.value } : x) })} className={inp} placeholder="Título do passo (opcional)" />
                      <button type="button" onClick={() => setF({ ...f, passos: (f.passos || []).filter(x => x.id !== s.id) })} className="text-gray-400 hover:text-rose-600 text-sm">✕</button>
                    </div>
                    <textarea value={s.descricao} onChange={e => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, descricao: e.target.value } : x) })} className={inp} rows={2} placeholder="O que fazer neste passo" />
                    <div className="flex flex-wrap items-center gap-2">
                      <ResponsaveisPicker value={respsDe(s)} selCls={selSetor} onChange={rs => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, responsaveis: rs, responsavel: undefined } : x) })} />
                      {(processosDaEmpresa?.length ?? 0) > 0 && (
                        <select value={s.processoVinculadoId || ""} onChange={e => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, processoVinculadoId: e.target.value || undefined } : x) })} className={selSetor}>
                          <option value="">🔗 Vincular processo…</option>
                          {processosDaEmpresa!.map(pp => <option key={pp.id} value={pp.id}>{pp.titulo}</option>)}
                        </select>
                      )}
                      {s.foto ? (
                        <div className="flex items-center gap-2"><img src={s.foto.url} alt="" className="h-12 rounded border border-gray-200 dark:border-gray-700" /><button type="button" onClick={() => setF({ ...f, passos: (f.passos || []).map(x => x.id === s.id ? { ...x, foto: null } : x) })} className="text-[11px] text-gray-400 hover:text-rose-600">remover foto</button></div>
                      ) : (
                        <label className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer">
                          {subindo ? "…" : "📷 Foto do passo"}
                          <input type="file" accept="image/*" className="hidden" disabled={subindo} onChange={async e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (!file) return; const foto = await subirFoto(file); if (foto) setF(p => ({ ...p, passos: (p.passos || []).map(x => x.id === s.id ? { ...x, foto } : x) })); }} />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setF({ ...f, passos: [...(f.passos || []), { id: uid(), descricao: "" } as WikiPasso] })} className="text-xs text-indigo-600 hover:underline">+ passo</button>
              </div>
            </Campo>
          )}

          {/* Fotos gerais */}
          <Campo label="Fotos (opcional)">
            <div className="flex flex-wrap gap-2 items-center">
              {(f.fotos || []).map(ft => (
                <div key={ft.id} className="relative"><img src={ft.url} alt="" className="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700" /><button type="button" onClick={() => setF({ ...f, fotos: (f.fotos || []).filter(x => x.id !== ft.id) })} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-rose-600 text-xs">✕</button></div>
              ))}
              <label className="h-16 w-16 flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:text-indigo-600 cursor-pointer text-xl">
                {subindo ? "…" : "＋"}
                <input type="file" accept="image/*" className="hidden" disabled={subindo} onChange={async e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (!file) return; const foto = await subirFoto(file); if (foto) setF(p => ({ ...p, fotos: [...(p.fotos || []), foto] })); }} />
              </label>
            </div>
          </Campo>

          {/* Onde este processo se aplica */}
          <Campo label="Onde este processo se aplica *">
            {restaurantes.length <= 1 ? (
              <div className="text-xs text-gray-500">Só {nomeAtual}.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setModoEmp("uma"); setF(p => ({ ...p, restaurantIds: ridAtual ? [ridAtual] : [] })); }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${modoEmp === "uma" ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>📍 Só {nomeAtual}</button>
                  <button type="button" onClick={() => { setModoEmp("varias"); setF(p => ({ ...p, restaurantIds: (p.restaurantIds && p.restaurantIds.length) ? p.restaurantIds : (ridAtual ? [ridAtual] : []) })); }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${modoEmp === "varias" ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>🏢 Mais de uma empresa</button>
                </div>
                {modoEmp === "varias" && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 p-2.5 rounded-lg border border-gray-200 dark:border-gray-800">
                    {restaurantes.map(r => (
                      <label key={r.id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={(f.restaurantIds || []).includes(r.id)} onChange={() => toggleRid(r.id)} />{r.nome}
                      </label>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-gray-400">{(f.restaurantIds || []).length} empresa{(f.restaurantIds || []).length === 1 ? "" : "s"} selecionada{(f.restaurantIds || []).length === 1 ? "" : "s"}.</div>
              </div>
            )}
          </Campo>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={f.publicado ?? true} onChange={e => setF({ ...f, publicado: e.target.checked })} />Publicado (desmarque pra deixar como rascunho)</label>
        </div>

        <div className="flex gap-2 justify-between mt-5">
          {proc && podeDeletar ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose} variant="ghost">Cancelar</Button><Button onClick={salvar} disabled={subindo}>{proc ? "Salvar" : "Criar"}</Button></div>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>{children}</label>;
}
