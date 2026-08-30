// Módulo PRAZOS — agenda unificada (contas, técnicos, trabalhistas, avulsos).
// Fonte única: você acompanha (Agendar / Realizado / laudo) e edita a definição
// pelo ✎. Recorrente = 1 registro que anda + histórico. Ver
// [[project_gestor_redesign_2modulos]].
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useTodasPessoas } from "../../core/pessoas/PessoasContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { canAcao } from "../../core/auth/permissions";
import { requestAccessToken } from "../../core/google/driveClient";
import { uploadFileToFolder } from "../../core/google/driveShared";
import { centralConfigured } from "../../core/google/driveCentral";
import { ensureModuloFolder } from "../../core/google/driveModulo";
import type { Prazo, PrazoTipo, Empregado, Pessoa, Imovel } from "../../core/types";
import { PRAZO_TIPO_LABEL, PRAZO_SUBTIPO_TRAB_LABEL } from "../../core/types";
import { resumoRecorrencia } from "./recorrencia";
import { resolverPrazo, podeResolver, grupoAgenda, diasAte, hojeYmd, ymdExibicao, ehFimDeSemana, diaSemanaCurto } from "./logic";
import { DatePickerBR } from "./campos";
import { PrazoModal } from "./PrazoModal";
import { ImoveisModal } from "./ImoveisModal";

const brl = (n?: number | null) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ymdToBr = (ymd?: string) => { if (!ymd) return ""; const [a, m, d] = ymd.split("-"); return `${d}/${m}/${a}`; };

const TIPO_META: Record<PrazoTipo, { icon: string; cls: string }> = {
  conta: { icon: "💰", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  tecnico: { icon: "🛠️", cls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  trabalhista: { icon: "🧑‍⚖️", cls: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  avulso: { icon: "🚩", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};
const TODAS_CATS: PrazoTipo[] = ["conta", "tecnico", "trabalhista", "avulso"];
// tipo → sufixo da ação de permissão (verConta, gerirTecnico, …).
const SUF_CAT: Record<PrazoTipo, string> = { conta: "Conta", tecnico: "Tecnico", trabalhista: "Trabalhista", avulso: "Avulso" };

export function PrazosPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants, activeRestaurant } = useRestaurant();
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid || "");
  const { perfis } = useAccessProfiles();
  // Permissão granular por categoria (ver × gerir).
  const podeVerCat = (t: PrazoTipo) => isMaster || can("prazos", `ver${SUF_CAT[t]}`);
  const podeGerirCat = (t: PrazoTipo) => isMaster || can("prazos", `gerir${SUF_CAT[t]}`);
  const catsVisiveis = TODAS_CATS.filter(podeVerCat);
  const catsGeriveis = TODAS_CATS.filter(podeGerirCat);
  const podeVer = catsVisiveis.length > 0;
  const podeConfig = isMaster || can("prazos", "configurar");
  // "Todas as empresas": master sempre; usuário normal precisa da permissão —
  // e aí vê só as empresas que ELE tem acesso (não literalmente todas).
  const podeTodasEmpresas = isMaster || can("prazos", "verTodasEmpresas");
  const meRests = useMemo(() => (me?.restaurantIds || []).filter(Boolean).slice(0, 10), [me?.restaurantIds]);

  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const pessoas = useTodasPessoas();
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const [showImoveis, setShowImoveis] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState<PrazoTipo | "todos" | "agendados">("todos");
  const [aba, setAba] = useState<"agenda" | "resolvidos">("agenda");
  const [visao, setVisao] = useState<"calendario" | "lista">("calendario");
  const [diaSel, setDiaSel] = useState<string>(hojeYmd()); // ymd ou "__atrasados__"
  const [todosRest, setTodosRest] = useState(false);
  const [busca, setBusca] = useState("");
  // Confirmar data de realização/pagamento ao concluir um prazo.
  const [resolvendo, setResolvendo] = useState<Prazo | null>(null);
  const [dataResol, setDataResol] = useState("");
  const [modal, setModal] = useState<{ prazo: Prazo | null; modo?: "ver" | "editar" } | null>(null);
  const [agendando, setAgendando] = useState<string | null>(null);
  const [dataAg, setDataAg] = useState("");
  const [erro, setErro] = useState("");
  const laudoRef = useRef<HTMLInputElement | null>(null);
  const laudoAlvo = useRef<Prazo | null>(null);

  useEffect(() => {
    if (!rid) return;
    // Todas as empresas: master → tudo; usuário normal com permissão → só as
    // empresas que ele tem acesso (array-contains-any). Senão, só a ativa.
    const qy = !todosRest
      ? query(collection(db, "prazos"), where("restaurantIds", "array-contains", rid))
      : isMaster
        ? collection(db, "prazos")
        : query(collection(db, "prazos"), where("restaurantIds", "array-contains-any", meRests.length ? meRests : [rid]));
    const u1 = onSnapshot(qy, (s) => setPrazos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Prazo).filter((p) => !p.deletadoEm)), () => setPrazos([]));
    const u2 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)), () => setEmpregados([]));
    const u4 = onSnapshot(query(collection(db, "imoveis"), where("restaurantId", "==", rid)), (s) => setImoveis(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Imovel).filter((im) => !im.deletadoEm)), () => setImoveis([]));
    return () => { u1(); u2(); u4(); };
  }, [rid, todosRest, isMaster, meRests]);
  const imovelNome = (id?: string | null) => imoveis.find((im) => im.id === id)?.apelido || "";
  // Responsáveis possíveis POR CATEGORIA = quem acessa (vê/gere) aquele tipo nesta empresa.
  const responsaveisPorCat = useMemo(() => {
    const base = pessoas.filter((pp) => (pp.restaurantIds || []).includes(rid || ""));
    const m = {} as Record<PrazoTipo, Pessoa[]>;
    for (const t of TODAS_CATS) {
      const suf = SUF_CAT[t];
      m[t] = base.filter((pp) => pp.isMaster || canAcao(pp, rid || "", "prazos", `ver${suf}`, perfis) || canAcao(pp, rid || "", "prazos", `gerir${suf}`, perfis));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, rid, perfis]);

  const hoje = hojeYmd();
  const restNome = (ids: string[]) => restaurants.find((r) => ids.includes(r.id))?.nome || "";

  // Pode ver ESTE prazo? Em modo "todas as empresas" (não-master), checa a
  // permissão da categoria NA EMPRESA do prazo (não vaza trabalhista de uma
  // empresa onde ela não pode ver). Modo normal usa o perfil da empresa ativa.
  const podeVerPrazoCat = (p: Prazo): boolean => {
    if (isMaster) return true;
    if (!todosRest) return catsVisiveis.includes(p.tipo);
    const suf = SUF_CAT[p.tipo];
    return (p.restaurantIds || []).some((r) =>
      (me?.restaurantIds || []).includes(r) &&
      (canAcao(me, r, "prazos", `ver${suf}`, perfis) || canAcao(me, r, "prazos", `gerir${suf}`, perfis)));
  };

  const visiveis = useMemo(() => {
    // Só categorias que a pessoa pode VER; e respeita o chip de filtro.
    let ps = prazos.filter((p) => podeVerPrazoCat(p));
    // Busca por título / responsável.
    const q = busca.trim().toLowerCase();
    if (q) ps = ps.filter((p) => `${p.titulo || ""} ${p.responsavelNome || ""}`.toLowerCase().includes(q));
    // Chip "Agendados": corta transversalmente os tipos e ignora a aba —
    // mostra tudo que já tem data marcada, ordenado pela data agendada.
    if (tipoFiltro === "agendados") {
      return ps.filter((p) => p.status === "agendado")
        .sort((a, b) => (a.agendamento?.data || a.vencimento).localeCompare(b.agendamento?.data || b.vencimento));
    }
    ps = ps.filter((p) => tipoFiltro === "todos" || p.tipo === tipoFiltro);
    if (aba === "resolvidos") return ps.filter((p) => p.status === "resolvido").sort((a, b) => (b.vencimento).localeCompare(a.vencimento));
    return ps.filter((p) => p.status !== "resolvido").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prazos, tipoFiltro, aba, busca, catsVisiveis.join(",")]);

  const grupos = useMemo(() => {
    const g: Record<string, Prazo[]> = { vencido: [], semana: [], proximo: [], futuro: [] };
    for (const p of visiveis) g[grupoAgenda(p, hoje)].push(p);
    return g;
  }, [visiveis, hoje]);

  // Calendário: atrasados (não somem na navegação de mês) e prazos do dia
  // selecionado, colocados pela data de EXIBIÇÃO (fim de semana → sexta).
  const atrasados = useMemo(() => visiveis.filter((p) => diasAte(hoje, p.vencimento) < 0), [visiveis, hoje]);
  const doDia = useMemo(() => {
    if (diaSel === "__atrasados__") return atrasados;
    return visiveis.filter((p) => ymdExibicao(p.vencimento) === diaSel).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }, [visiveis, diaSel, atrasados]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: 0, conta: 0, tecnico: 0, trabalhista: 0, avulso: 0, agendados: 0 };
    for (const p of prazos) {
      if (p.status === "resolvido" || !podeVerPrazoCat(p)) continue;
      c.todos++; c[p.tipo]++;
      if (p.status === "agendado") c.agendados++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prazos, catsVisiveis.join(",")]);

  async function salvarPrazo(p: Prazo) {
    await setDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ ...p, atualizadoEm: new Date().toISOString() }), { merge: true });
    setModal(null);
  }
  // Abre o modal de confirmação da data (checa laudo antes).
  function abrirResolver(p: Prazo) {
    if (!podeResolver(p)) { setErro(`${p.titulo}: anexe o laudo antes de resolver.`); return; }
    setResolvendo(p);
    setDataResol(ymdToBr(hojeYmd()));
  }
  async function realizar(p: Prazo, dataBr: string) {
    const [d, m, a] = (dataBr || "").split("/");
    if (!d || !m || !a) { setErro("Data inválida (dd/mm/aaaa)."); return; }
    const em = new Date(`${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`).toISOString();
    const atualizado = resolverPrazo(p, { em, por: me?.id, porNome: me?.nome });
    await setDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ ...atualizado, atualizadoEm: new Date().toISOString() }), { merge: true });
    setResolvendo(null);
  }
  async function agendar(p: Prazo) {
    const [d, m, a] = dataAg.split("/");
    if (!d || !m || !a) { setErro("Data inválida (dd/mm/aaaa)."); return; }
    const data = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ status: "agendado", agendamento: { data, agendadoEm: new Date().toISOString(), agendadoPor: me?.id || null }, atualizadoEm: new Date().toISOString() }));
    setAgendando(null); setDataAg("");
  }
  async function removerAgendamento(p: Prazo) {
    await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ status: "aberto", agendamento: null, atualizadoEm: new Date().toISOString() }));
  }
  async function excluir(p: Prazo) {
    if (!confirm(`Excluir o prazo "${p.titulo}"?`)) return;
    await updateDoc(doc(db, "prazos", p.id), { deletadoEm: new Date().toISOString(), deletadoPor: me?.id || null });
  }

  // ── Laudo (Google Drive) ──
  // Sobe em {raiz}/planejamento.app/Prazos/ — a raiz é única por restaurante
  // (Configurações › Google Drive) e do Drive pessoal de quem configurou.
  function pedirLaudo(p: Prazo) {
    if (!activeRestaurant?.driveRootFolderId) { setErro("Defina a pasta raiz do restaurante em Configurações › Google Drive."); return; }
    laudoAlvo.current = p; laudoRef.current?.click();
  }
  async function onLaudoFile(file: File) {
    const p = laudoAlvo.current; const rootId = activeRestaurant?.driveRootFolderId;
    if (!p || !rootId) return;
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const nome = `laudo-${p.titulo.toLowerCase().replace(/[^\w]+/g, "-").slice(0, 40)}-${p.vencimento.replace(/-/g, "")}.${ext}`;
      const renomeado = new File([file], nome, { type: file.type });
      // Central-aware: com conta central, a pasta e o upload são pela central (o
      // operador não precisa ter acesso Google à pasta). Sem central, pede token.
      if (!(await centralConfigured())) await requestAccessToken();
      const folderId = await ensureModuloFolder(rootId, "Prazos");
      const up = await uploadFileToFolder(folderId, renomeado);
      await updateDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ laudo: { driveFileId: up.id, driveUrl: (up as { webViewLink?: string }).webViewLink || null, nome, anexadoEm: new Date().toISOString(), anexadoPor: me?.id || null, anexadoPorNome: me?.nome || null }, atualizadoEm: new Date().toISOString() }));
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao subir o laudo."); }
  }

  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso aos Prazos.</div>;

  const GRUPO_LABEL: Record<string, { label: string; danger?: boolean }> = { vencido: { label: "Vencidos", danger: true }, semana: { label: "Esta semana" }, proximo: { label: "Próximos" }, futuro: { label: "Mais pra frente" } };

  const renderCard = (p: Prazo) => (
    <PrazoCard key={p.id} p={p} hoje={hoje} podeGerir={podeGerirCat(p.tipo)} mostrarEmpresa={todosRest} restNome={restNome} imovelNome={imovelNome(p.imovelId)}
      onAbrir={() => setModal({ prazo: p, modo: "ver" })} onEditar={() => setModal({ prazo: p, modo: "editar" })} onRealizar={() => abrirResolver(p)} onExcluir={() => void excluir(p)}
      onLaudo={() => pedirLaudo(p)} onRemoverAg={() => void removerAgendamento(p)}
      agendando={agendando === p.id} dataAg={dataAg} setDataAg={setDataAg}
      onAbrirAg={() => { setAgendando(p.id); setDataAg(ymdToBr(p.vencimento)); }} onCancelarAg={() => setAgendando(null)} onConfirmarAg={() => void agendar(p)} />
  );

  const detalheLabel = diaSel === "__atrasados__" ? "Atrasados" : `${diaSemanaCurto(diaSel)} · ${ymdToBr(diaSel)}`;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <input ref={laudoRef} type="file" accept="application/pdf,image/*,.pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLaudoFile(f); e.target.value = ""; }} />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">📅 Prazos</h1>
          <p className="text-sm text-gray-500">{todosRest ? "Todos os restaurantes" : activeRestaurant?.nome || "—"} · o que vence e quando</p>
        </div>
        <div className="flex items-center gap-2">
          {podeConfig && <button type="button" onClick={() => setShowImoveis(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">🏠 Imóveis</button>}
          {catsGeriveis.length > 0 && <button type="button" onClick={() => setModal({ prazo: null })} className="text-sm font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white">+ Novo prazo</button>}
        </div>
      </header>

      {/* Filtros por tipo (só categorias visíveis) + abas */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["todos", ...catsVisiveis] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTipoFiltro(t)} className={`text-xs px-3 py-1.5 rounded-full border ${tipoFiltro === t ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
            {t === "todos" ? "Todos" : `${TIPO_META[t].icon} ${PRAZO_TIPO_LABEL[t]}`} <span className="opacity-60">{contagem[t]}</span>
          </button>
        ))}
        <span className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />
        <button type="button" onClick={() => { setTipoFiltro("agendados"); setAba("agenda"); }} className={`text-xs px-3 py-1.5 rounded-full border ${tipoFiltro === "agendados" ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 font-medium" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>
          📅 Agendados <span className="opacity-60">{contagem.agendados}</span>
        </button>
        <div className="flex-1" />
        {podeTodasEmpresas && <label className="text-xs text-gray-500 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={todosRest} onChange={(e) => setTodosRest(e.target.checked)} /> todas as empresas</label>}
      </div>
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 items-center">
        {([["agenda", "Agenda"], ["resolvidos", "Resolvidos"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setAba(k); if (tipoFiltro === "agendados") setTipoFiltro("todos"); }} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${aba === k && tipoFiltro !== "agendados" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500"}`}>{l}</button>
        ))}
        <div className="flex-1" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Buscar prazo…"
          className="text-xs px-2.5 py-1.5 mb-1.5 w-40 sm:w-48 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
        {aba === "agenda" && (
          <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 mb-1.5 ml-2">
            {([["calendario", "📅 Calendário"], ["lista", "☰ Lista"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setVisao(k)} className={`px-2.5 py-1 text-xs font-medium rounded-md ${visao === k ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500"}`}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {erro && <div className={`text-sm rounded-lg px-3 py-2 flex justify-between ${erro.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400"}`}><span>{erro}</span><button onClick={() => setErro("")}>✕</button></div>}

      {aba === "agenda" ? (visao === "calendario" ? (
        <div className="space-y-4">
          {atrasados.length > 0 && (
            <button type="button" onClick={() => setDiaSel("__atrasados__")}
              className={`w-full text-left text-sm px-3 py-2 rounded-lg border ${diaSel === "__atrasados__" ? "border-rose-500 bg-rose-50 dark:bg-rose-900/30" : "border-rose-200 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-900/10"} text-rose-700 dark:text-rose-300 font-medium`}>
              ⚠ {atrasados.length} {atrasados.length === 1 ? "prazo atrasado" : "prazos atrasados"} — clique pra ver
            </button>
          )}
          <PrazoCalendario prazos={visiveis} hoje={hoje} diaSel={diaSel} onSelDia={setDiaSel} onAbrirPrazo={(p) => { if (podeGerirCat(p.tipo)) setModal({ prazo: p, modo: "ver" }); }} />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-2 text-gray-500">{detalheLabel} {doDia.length > 0 && <span className="text-gray-400">· {doDia.length}</span>}</div>
            <div className="space-y-2">
              {doDia.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Nada para {diaSel === "__atrasados__" ? "atrasados" : "este dia"}.</p> : doDia.map(renderCard)}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {visiveis.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">{tipoFiltro === "agendados" ? "Nenhum prazo agendado." : "Nenhum prazo em aberto."}</p>}
          {(["vencido", "semana", "proximo", "futuro"] as const).map((g) => grupos[g].length > 0 && (
            <div key={g}>
              <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${GRUPO_LABEL[g].danger ? "text-rose-600" : "text-gray-500"}`}>{GRUPO_LABEL[g].label}</div>
              <div className="space-y-2">
                {grupos[g].map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )) : (
        <div className="space-y-2">
          {visiveis.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">Nada resolvido ainda.</p>}
          {visiveis.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${TIPO_META[p.tipo].cls}`}>{TIPO_META[p.tipo].icon} {PRAZO_TIPO_LABEL[p.tipo]}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.titulo}</span>
                <span className="text-xs text-gray-400 ml-auto">resolvido</span>
              </div>
              {(p.historico || []).length > 0 && (
                <div className="mt-2 text-xs text-gray-500 space-y-1">
                  {(p.historico || []).slice().reverse().map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span>{ymdToBr(h.vencimento)}</span>
                      {h.laudo?.driveUrl ? <a href={h.laudo.driveUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400">📄 {h.laudo.nome}</a> : h.laudo ? <span>📄 {h.laudo.nome}</span> : <span className="text-gray-400">sem laudo</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PrazoModal rid={rid || ""} prazo={modal.prazo} modoInicial={modal.modo} tiposPermitidos={catsGeriveis} empregados={empregados} responsaveisPorCat={responsaveisPorCat} imoveis={imoveis} onGerenciarImoveis={() => setShowImoveis(true)} onClose={() => setModal(null)} onSalvar={salvarPrazo} />
      )}
      {showImoveis && <ImoveisModal rid={rid || ""} restauranteNome={activeRestaurant?.nome || ""} imoveis={imoveis} meId={me?.id || ""} onClose={() => setShowImoveis(false)} />}

      {resolvendo && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setResolvendo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{resolvendo.tipo === "conta" ? "Confirmar pagamento" : "Confirmar realização"}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 mb-4 truncate">{resolvendo.titulo}</p>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Data em que foi {resolvendo.tipo === "conta" ? "pago" : "realizado"}</label>
            <DatePickerBR value={dataResol} onChange={setDataResol} />
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setResolvendo(null)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancelar</button>
              <button type="button" onClick={() => void realizar(resolvendo, dataResol)} className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">✓ Confirmar {resolvendo.tipo === "conta" ? "pagamento" : "realização"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card do prazo na agenda ──
function PrazoCard({ p, hoje, podeGerir, mostrarEmpresa, restNome, imovelNome, onAbrir, onEditar, onRealizar, onExcluir, onLaudo, onRemoverAg, agendando, dataAg, setDataAg, onAbrirAg, onCancelarAg, onConfirmarAg }: {
  p: Prazo; hoje: string; podeGerir: boolean; mostrarEmpresa: boolean; restNome: (ids: string[]) => string; imovelNome: string;
  onAbrir: () => void; onEditar: () => void; onRealizar: () => void; onExcluir: () => void; onLaudo: () => void; onRemoverAg: () => void;
  agendando: boolean; dataAg: string; setDataAg: (v: string) => void; onAbrirAg: () => void; onCancelarAg: () => void; onConfirmarAg: () => void;
}) {
  const dias = diasAte(hoje, p.vencimento);
  const vencido = dias < 0;
  const borda = vencido ? "border-l-rose-500" : p.status === "agendado" ? "border-l-sky-500" : "border-l-amber-500";
  const rotuloRealizar = p.tipo === "conta" ? "Pago" : "Realizado";
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 border-l-[3px] ${borda} bg-white dark:bg-gray-900 p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        {podeGerir ? (
          <button type="button" onClick={onAbrir} title="Ver detalhes"
            className="text-sm font-semibold text-left text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">{p.titulo}</button>
        ) : (
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.titulo}</span>
        )}
        <span className={`text-xs ml-auto whitespace-nowrap ${vencido ? "text-rose-600" : "text-gray-500"}`}>🕐 {vencido ? "venceu" : "vence"} {ymdToBr(p.vencimento)}{ehFimDeSemana(p.vencimento) ? <span className="text-amber-600 dark:text-amber-400"> ({diaSemanaCurto(p.vencimento)})</span> : null}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${TIPO_META[p.tipo].cls}`}>{TIPO_META[p.tipo].icon} {PRAZO_TIPO_LABEL[p.tipo]}</span>
        {mostrarEmpresa && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{restNome(p.restaurantIds)}</span>}
        {imovelNome && <span className="text-gray-500">🏠 {imovelNome}</span>}
        {p.exigeLaudo && !p.laudo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">📄 exige laudo</span>}
        {p.laudo && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">📄 laudo ok</span>}
        {p.recorrencia && <span className="text-gray-400">🔁 {resumoRecorrencia(p.recorrencia)}</span>}
        {p.responsavelNome && <span className="text-gray-500">· {p.responsavelNome}</span>}
        {p.dados?.valor != null && <span className="text-gray-500">· {brl(p.dados.valor)}</span>}
        {p.dados?.subtipoTrab && <span className="text-gray-500">· {PRAZO_SUBTIPO_TRAB_LABEL[p.dados.subtipoTrab]}</span>}
        {p.precisaRevisao && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">⚠ revisar</span>}
      </div>
      {p.status === "agendado" && p.agendamento && (
        <div className="text-xs text-sky-600 dark:text-sky-400">📅 agendado para {ymdToBr(p.agendamento.data)}</div>
      )}
      {podeGerir && (agendando ? (
        <div className="flex items-center gap-2 flex-wrap bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
          <span className="text-xs text-gray-500">Executar em</span>
          <input value={dataAg} onChange={(e) => setDataAg(e.target.value)} placeholder="dd/mm/aaaa" className="w-28 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
          <button type="button" onClick={onConfirmarAg} className="text-xs px-2.5 py-1 rounded bg-indigo-600 text-white">Agendar</button>
          <button type="button" onClick={onCancelarAg} className="text-xs text-gray-400">cancelar</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {/* Default por tipo quando não setado (técnico agenda; resto só conclui) —
              cobre prazos antigos/migrados sem permiteAgendamento explícito. */}
          {(p.permiteAgendamento ?? (p.tipo === "tecnico")) === false
            ? <button type="button" onClick={onRealizar} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white">✓ {rotuloRealizar}</button>
            : p.status === "agendado"
            ? <><button type="button" onClick={onRealizar} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white">✓ {rotuloRealizar}</button><button type="button" onClick={onAbrirAg} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Reagendar</button><button type="button" onClick={onRemoverAg} className="text-xs text-gray-400">desagendar</button></>
            : <><button type="button" onClick={onAbrirAg} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white">📅 Agendar</button><button type="button" onClick={onRealizar} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">✓ {rotuloRealizar}</button></>}
          {p.exigeLaudo && <button type="button" onClick={onLaudo} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">📎 Laudo</button>}
          <button type="button" onClick={onEditar} className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-gray-700" title="Editar definição">✎</button>
          <button type="button" onClick={onExcluir} className="text-xs px-2 py-1 rounded-lg text-gray-300 hover:text-rose-600">🗑</button>
        </div>
      ))}
    </div>
  );
}

// ── Calendário mensal (visão primária) ──
// Coloca cada prazo pela data de EXIBIÇÃO (fim de semana volta pra sexta).
// Clicar num dia seleciona-o; o detalhe com as ações aparece abaixo do calendário.
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const toYmdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function PrazoCalendario({ prazos, hoje, diaSel, onSelDia, onAbrirPrazo }: {
  prazos: Prazo[]; hoje: string; diaSel: string; onSelDia: (ymd: string) => void; onAbrirPrazo: (p: Prazo) => void;
}) {
  const [ym, setYm] = useState(() => { const d = new Date(hoje + "T12:00:00"); return { y: d.getFullYear(), m: d.getMonth() }; });

  const porDia = useMemo(() => {
    const map = new Map<string, Prazo[]>();
    for (const p of prazos) {
      const k = ymdExibicao(p.vencimento);
      const arr = map.get(k);
      if (arr) arr.push(p); else map.set(k, [p]);
    }
    return map;
  }, [prazos]);

  const weeks = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const cur = new Date(ym.y, ym.m, 1 - first.getDay());
    const out: { ymd: string; inMonth: boolean; dow: number }[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: { ymd: string; inMonth: boolean; dow: number }[] = [];
      for (let d = 0; d < 7; d++) { row.push({ ymd: toYmdLocal(cur), inMonth: cur.getMonth() === ym.m, dow: cur.getDay() }); cur.setDate(cur.getDate() + 1); }
      out.push(row);
    }
    // Descarta a última semana se for inteira do mês seguinte (mês de 4-5 linhas).
    return out.filter((row) => row.some((c) => c.inMonth));
  }, [ym]);

  const nomeMes = new Date(ym.y, ym.m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const irMes = (delta: number) => setYm((s) => { const d = new Date(s.y, s.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const irHoje = () => { const d = new Date(hoje + "T12:00:00"); setYm({ y: d.getFullYear(), m: d.getMonth() }); onSelDia(hoje); };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => irMes(-1)} className="w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">‹</button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">{nomeMes}</span>
          <button type="button" onClick={irHoje} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-indigo-600">hoje</button>
        </div>
        <button type="button" onClick={() => irMes(1)} className="w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`text-[10px] text-center font-semibold py-1 ${i === 0 || i === 6 ? "text-gray-300 dark:text-gray-600" : "text-gray-400"}`}>{w}</div>
        ))}
        {weeks.flat().map((c) => {
          const lista = porDia.get(c.ymd) || [];
          const ehHoje = c.ymd === hoje;
          const sel = c.ymd === diaSel;
          const fds = c.dow === 0 || c.dow === 6;
          return (
            <div key={c.ymd} role="button" tabIndex={0} onClick={() => onSelDia(c.ymd)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelDia(c.ymd); } }}
              className={`min-h-[64px] rounded-lg border p-1 text-left flex flex-col gap-0.5 transition-colors cursor-pointer ${sel ? "border-indigo-500 ring-1 ring-indigo-400" : "border-gray-100 dark:border-gray-800"} ${fds ? "bg-gray-50/60 dark:bg-gray-800/20" : "bg-white dark:bg-gray-900"} ${!c.inMonth ? "opacity-40" : ""} hover:border-indigo-300`}>
              <span className={`text-[11px] font-medium self-end leading-none w-5 h-5 flex items-center justify-center rounded-full ${ehHoje ? "bg-indigo-600 text-white" : fds ? "text-gray-400" : "text-gray-600 dark:text-gray-300"}`}>{Number(c.ymd.slice(-2))}</span>
              {lista.slice(0, 3).map((p) => (
                <button key={p.id} type="button" title={p.titulo}
                  onClick={(e) => { e.stopPropagation(); onAbrirPrazo(p); }}
                  className={`block w-full text-left truncate text-[9px] leading-tight px-1 py-0.5 rounded hover:ring-1 hover:ring-indigo-400 ${TIPO_META[p.tipo].cls}`}>
                  {ehFimDeSemana(p.vencimento) ? "↩ " : ""}{p.titulo}
                </button>
              ))}
              {lista.length > 3 && <span className="text-[9px] text-gray-400 px-1">+{lista.length - 3}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-gray-400">↩ prazo que vence no fim de semana, exibido na sexta</div>
    </div>
  );
}

export { TIPO_META, ymdToBr };
