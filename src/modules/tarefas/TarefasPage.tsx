import { useEffect, useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { ReuniaoEditorModal } from "../reunioes/ReuniaoEditorModal";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { canAcao } from "../../core/auth/permissions";
import { aplicarPerfisNaPessoa } from "../../core/auth/profileToLegacy";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { ouvirProjetos, ouvirSubprojetos, ouvirTarefasDeUsuario, ouvirTarefasDeProjeto, ouvirLixeira, ouvirTodasTarefas, migrarGruposParaPrivadoLegado, aposentarCaixaPessoal, limparSubprojetosPrazos, reorganizarGestorTarefas } from "./repository";
import { type Tarefa, type TarefaProjeto, type TarefaSubprojeto, type AccessProfile, type Pessoa } from "../../core/types";
import { podeVerTarefa, podeVerProjeto } from "./visibilidade";
import { type Tab, type ViewMode, ViewSwitcher, ehAreaPrazos, semOrfasPrazo } from "./helpers";
import { CalendarioView, KanbanView, LixeiraView, MinhasTarefasView, ProjetoView, ProjetosTopBar } from "./views";
import { AdminView } from "./admin";
import { DetalheModal, NovaTarefaModal, SemPermissaoModal } from "./modais";
import { CaixaDeIdeias, CaixaIdeiasFaixa } from "./CaixaDeIdeias";

export function TarefasPage() {
  const { pessoa: pessoaReal } = useAuth();
  const { restaurants, activeId: ridAtivo, setActiveId } = useRestaurant();
  const { perfis: perfisAcesso, loading: perfisLoading } = useAccessProfiles();
  // Gate de acesso: pessoa sem permissão "tarefas.verProprias" cai pra
  // HomePage (que pode redirecionar pro Portal do Empregado se aplicável).
  // Master sempre passa. Hook precisa rodar — usamos no JSX, não early-return.
  const { can: canAcaoRid } = useCanAcao(ridAtivo || "");

  // ── "Ver como…" (master only) ────────────────────────────────────────
  // Master pode visualizar o Gestor de Tarefas com a permissão de outra
  // pessoa pra entender o que ela vê. State guarda o id; carrega o doc
  // completo do Firestore. `pessoa` efetiva é a impersonada (com isMaster
  // forçado a false pra realmente simular permissões reais).
  const [viewingAsId, setViewingAsId] = useState<string | null>(null);
  const [viewingAsData, setViewingAsData] = useState<Pessoa | null>(null);
  useEffect(() => {
    if (!viewingAsId) { setViewingAsData(null); return; }
    let cancel = false;
    (async () => {
      try {
        const [pessoaSnap, perfisSnap] = await Promise.all([
          getDoc(doc(db, "pessoas", viewingAsId)),
          getDocs(collection(db, "accessProfiles")),
        ]);
        if (cancel || !pessoaSnap.exists()) return;
        const raw = { id: pessoaSnap.id, ...pessoaSnap.data() } as Pessoa;
        const perfis = perfisSnap.docs.map(d => ({ id: d.id, ...d.data() }) as AccessProfile);
        // Hidrata permissions a partir de profileIds + perfis (mesmo bridge
        // do AuthContext). Força isMaster = false pra simular permissões reais.
        const enriquecida = aplicarPerfisNaPessoa(raw, perfis);
        setViewingAsData({ ...enriquecida, isMaster: false });
      } catch (e) {
        console.warn("[ver-como] falha ao carregar pessoa:", e);
      }
    })();
    return () => { cancel = true; };
  }, [viewingAsId]);
  // Pessoa "efetiva" usada em toda a página — substitui o user logado
  // quando o master está visualizando como outro.
  const pessoa = viewingAsData || pessoaReal;
  const isViewingAs = !!viewingAsData;
  // Entry point fixo: ao abrir o módulo, sempre cai em Minhas tarefas +
  // Calendário. Preferência do user dentro da sessão funciona normal,
  // mas ao sair e voltar, reseta — é o "home" do gestor. View de projeto
  // continua em "lista" como default (que abre rara — só ao clicar num
  // projeto da sidebar, e aí faz sentido lista).
  const [tab, setTab] = useState<Tab>("minhas");
  const [viewMinhas, setViewMinhas] = useState<ViewMode>("calendario");
  const [viewProjeto, setViewProjeto] = useState<ViewMode>("calendario");

  const [projetos, setProjetos] = useState<TarefaProjeto[]>([]);
  const [subprojetos, setSubprojetos] = useState<TarefaSubprojeto[]>([]);
  const [minhas, setMinhas] = useState<Tarefa[]>([]);
  const [projetoFiltro, setProjetoFiltro] = useState<string>("");
  // subFiltro vive aqui (não no ProjetoView) pra a sidebar conseguir mostrar
  // os subprojetos como accordion dentro do próprio projeto selecionado.
  const [subFiltro, setSubFiltro] = useState<string>("");
  const [tarefasProjeto, setTarefasProjeto] = useState<Tarefa[]>([]);
  const [lixeira, setLixeira] = useState<Tarefa[]>([]);
  const [todasTarefas, setTodasTarefas] = useState<Tarefa[]>([]);
  const [gerenciarMenuAberto, setGerenciarMenuAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const filtrar = (ts: Tarefa[]) => { const q = busca.trim().toLowerCase(); return q ? ts.filter(t => (t.titulo || "").toLowerCase().includes(q) || (t.descricao || "").toLowerCase().includes(q)) : ts; };
  const buscaInput = (
    <div className="flex items-center gap-1.5 flex-1 min-w-[160px] max-w-[380px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5">
      <span className="text-gray-400 text-sm">🔍</span>
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar tarefa…" className="flex-1 bg-transparent text-sm outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-400" />
      {busca && <button type="button" onClick={() => setBusca("")} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>}
    </div>
  );
  // Modal de nova tarefa. Aceita pré-preenchimento de prazo, projeto e
  // subprojeto pra fluxos diferentes (botão por dia, "+ Nova tarefa" dentro
  // de um projeto, etc.).
  const [novaAberta, setNovaAberta] = useState<{ prazo?: string; projetoId?: string; subprojetoId?: string; titulo?: string; descricao?: string; puxando?: { tipo: "ideia" | "ocorrencia"; id: string; titulo: string } } | null>(null);
  const [novaReuniao, setNovaReuniao] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  // Ouvir projetos + subprojetos.
  // Filtra a área legada "Prazos" na fonte — ninguém no gestor deve mais vê-la
  // (criar/editar/mover), já que prazos agora vivem no módulo Prazos dedicado.
  useEffect(() => {
    const u1 = ouvirProjetos((lista) => setProjetos(lista.filter(p => !ehAreaPrazos(p))));
    const u2 = ouvirSubprojetos(setSubprojetos);
    return () => { u1(); u2(); };
  }, []);

  // Migração 1x: converte docs legados em "grupo_*" para "privado".
  // Master-only e idempotente — flag no localStorage evita rodar de novo.
  useEffect(() => {
    if (!pessoaReal?.isMaster) return;
    const FLAG = "tarefas_migrou_grupos_v2";
    try { if (localStorage.getItem(FLAG) === "1") return; } catch {}
    migrarGruposParaPrivadoLegado()
      .then(r => {
        console.log("[tarefas] migração de grupos legados:", r);
        try { localStorage.setItem(FLAG, "1"); } catch {}
        if (r.projetos > 0 || r.tarefas > 0) {
          alert(`Permissões migradas: ${r.projetos} área(s) e ${r.tarefas} tarefa(s) viraram "Privado". Adicione as pessoas autorizadas em cada uma conforme necessário.`);
        }
      })
      .catch(e => console.warn("[tarefas] migração falhou:", e));
  }, [pessoaReal?.isMaster]);

  // Cleanup 1x: desativa os subprojetos que viraram prazos derivados
  // (experiência, prazos do empregado, contas fixas mensais). Não apaga tarefas.
  useEffect(() => {
    if (!pessoaReal?.isMaster) return;
    const FLAG = "tarefas_limpou_subprazos_v2";
    try { if (localStorage.getItem(FLAG) === "1") return; } catch { /* ignore */ }
    limparSubprojetosPrazos()
      .then(r => {
        try { localStorage.setItem(FLAG, "1"); } catch { /* ignore */ }
        if (r.length) {
          const comTarefas = r.filter(x => x.tarefas > 0);
          console.log("[tarefas] subprojetos de prazos apagados:", r);
          const base = `✅ Limpeza: ${r.length} subprojeto(s) de prazos apagados (viraram cards derivados no grupo Prazos).`;
          const aviso = comTarefas.length
            ? `\n\n⚠️ ${comTarefas.map(x => `"${x.nome}" ainda tinha ${x.tarefas} tarefa(s)`).join("; ")} — elas continuam na área (em "todos os projetos"), só perderam a referência ao projeto. Nenhuma tarefa foi apagada.`
            : " Nenhuma tarefa foi afetada.";
          alert(base + aviso);
        }
      })
      .catch(e => console.warn("[tarefas] limpeza de subprazos falhou:", e));
  }, [pessoaReal?.isMaster]);

  // Reorganização 1x: destrava rotinas recorrentes, apaga event-driven sem
  // sentido no Gestor, e mescla Eventos → Operação.
  useEffect(() => {
    if (!pessoaReal?.isMaster) return;
    const FLAG = "tarefas_reorganizou_v1";
    try { if (localStorage.getItem(FLAG) === "1") return; } catch { /* ignore */ }
    reorganizarGestorTarefas(pessoaReal?.id || "")
      .then(r => {
        try { localStorage.setItem(FLAG, "1"); } catch { /* ignore */ }
        console.log("[tarefas] reorganização:", r);
        const partes: string[] = [];
        if (r.destravados) partes.push(`${r.destravados} rotina(s) destravada(s) (agora editáveis)`);
        if (r.apagados.length) {
          const comT = r.apagados.filter(x => x.tarefas > 0);
          partes.push(`${r.apagados.length} projeto(s) event-driven removido(s)${comT.length ? ` (${comT.map(x => `"${x.nome}" tinha ${x.tarefas} tarefa(s), continuam na área`).join("; ")})` : ""}`);
        }
        if (r.eventos) partes.push(`Eventos mesclado em ${r.eventos.operacao}: ${r.eventos.subs} projeto(s) + ${r.eventos.tarefas} tarefa(s) movidas`);
        if (partes.length) alert("✅ Reorganização do Gestor:\n\n• " + partes.join("\n• ") + "\n\nNenhuma tarefa foi apagada.");
      })
      .catch(e => console.warn("[tarefas] reorganização falhou:", e));
  }, [pessoaReal?.isMaster, pessoaReal?.id]);

  // Migração 1x: remove projeto "Caixa Pessoal" (substituído por Banco de Ideias).
  useEffect(() => {
    if (!pessoaReal?.isMaster) return;
    const FLAG = "tarefas_aposentou_caixa_pessoal";
    try { if (localStorage.getItem(FLAG) === "1") return; } catch {}
    aposentarCaixaPessoal()
      .then(r => {
        try { localStorage.setItem(FLAG, "1"); } catch {}
        if (r.removido) {
          if (r.tarefasMexidas > 0) {
            alert(`Caixa Pessoal aposentado. ${r.tarefasMexidas} tarefa(s) ficaram órfãs na área removida. Você pode editá-las e movê-las pra outra área, ou usar o Banco de Ideias dali pra frente.`);
          } else {
            console.log("[tarefas] Caixa Pessoal removido (estava vazio)");
          }
        }
      })
      .catch(e => console.warn("[tarefas] aposentar caixa pessoal falhou:", e));
  }, [pessoaReal?.isMaster]);

  // Minhas tarefas
  useEffect(() => {
    if (!pessoa?.id) return;
    const u = ouvirTarefasDeUsuario(pessoa.id, (ts) => setMinhas(semOrfasPrazo(ts)));
    return () => u();
  }, [pessoa?.id]);

  // Tarefas do projeto filtrado
  useEffect(() => {
    if (tab !== "projeto" || !projetoFiltro) { setTarefasProjeto([]); return; }
    const u = ouvirTarefasDeProjeto(projetoFiltro, (ts) => setTarefasProjeto(semOrfasPrazo(ts)));
    return () => u();
  }, [tab, projetoFiltro]);

  // Lixeira
  useEffect(() => {
    if (tab !== "lixeira") return;
    const u = ouvirLixeira(setLixeira);
    return () => u();
  }, [tab]);

  // Todas as tarefas (master) — só ouve quando a aba está aberta.
  useEffect(() => {
    if (tab !== "todas" || !pessoaReal?.isMaster) return;
    const u = ouvirTodasTarefas((ts) => setTodasTarefas(semOrfasPrazo(ts)));
    return () => u();
  }, [tab, pessoaReal?.isMaster]);

  // Tarefas do projeto filtrado, restritas ao que a pessoa pode ver.
  const tarefasProjetoVisiveis = useMemo(
    () => tarefasProjeto.filter((t) => podeVerTarefa(t, projetos.find((p) => p.id === t.projetoId), pessoa)),
    [tarefasProjeto, projetos, pessoa],
  );

  // `isMaster` reflete o USER REAL (não a pessoa impersonada). Permissão de
  // master pra usar AdminView/Lixeira/Ver-como vem da identidade autêntica.
  // Mas `pessoa` usada nos filtros de visibilidade É a impersonada — pra
  // simular o que ela vê.
  const isMaster = !!pessoaReal?.isMaster;
  const tarefaSelecionada = useMemo(
    () => [...minhas, ...tarefasProjeto, ...todasTarefas].find(t => t.id === detalheId) || null,
    [detalheId, minhas, tarefasProjeto, todasTarefas],
  );

  // Projetos que esta pessoa pode ver na sidebar. Master vê todos;
  // demais veem só os com visibilidade "publico"/"escritorio", os de que
  // são donos, e aqueles em que estão na lista de usuariosAutorizados.
  // Subprojetos herdam: se o projeto pai não está visível, o sub também não.
  const projetosVisiveis = useMemo(
    () => projetos.filter(p => podeVerProjeto(p, pessoa)),
    [projetos, pessoa],
  );
  const idsProjetosVisiveis = useMemo(
    () => new Set(projetosVisiveis.map(p => p.id)),
    [projetosVisiveis],
  );
  const subprojetosVisiveis = useMemo(
    () => subprojetos.filter(s => idsProjetosVisiveis.has(s.projetoId)),
    [subprojetos, idsProjetosVisiveis],
  );

  // Gate de acesso: sem permissão "tarefas.verProprias" cai pra HomePage.
  // A permissão é POR RESTAURANTE — se o restaurante ativo não tem, mas OUTRO
  // dos restaurantes da pessoa tem, troca pra ele em vez de redirecionar (senão
  // a pessoa via o módulo no menu mas ele "piscava" e voltava pra Central).
  const ridsComTarefas = useMemo(
    () => (pessoaReal?.restaurantIds || []).filter(rid => canAcao(pessoaReal, rid, "tarefas", "verProprias", perfisAcesso)),
    [pessoaReal, perfisAcesso],
  );
  useEffect(() => {
    if (isMaster || !ridAtivo) return;
    if (!canAcaoRid("tarefas", "verProprias") && ridsComTarefas.length > 0 && !ridsComTarefas.includes(ridAtivo)) {
      setActiveId(ridsComTarefas[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridAtivo, ridsComTarefas, isMaster]);
  // NÃO avalia o gate enquanto os perfis de acesso ainda estão carregando — senão
  // canAcao retorna false por um instante e o <Navigate> redireciona à toa (o
  // "pisca e volta pra Central"). Espera carregar pra decidir com dado real.
  if (perfisLoading || !pessoaReal) return null;
  const temAcessoTarefas = isMaster || (ridAtivo && canAcaoRid("tarefas", "verProprias"));
  if (!temAcessoTarefas && ridAtivo) {
    // Tem acesso em outro restaurante → aguarda a troca (não redireciona).
    if (ridsComTarefas.length > 0) return null;
    return <Navigate to="/" replace />;
  }

  // Ações fixas (na linha do seletor de visão): Nova tarefa + Gerenciar (master).
  const acoesHeader = (
    <div className="flex items-center gap-1.5 shrink-0">
      {ridAtivo && (isMaster || canAcaoRid("reunioes", "criar")) && <button type="button" onClick={() => setNovaReuniao(true)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">🗣️ Nova reunião</button>}
      <Button size="sm" onClick={() => setNovaAberta({})}>+ Nova tarefa</Button>
      {isMaster && (
        <div className="relative">
          <button type="button" onClick={() => setGerenciarMenuAberto((v) => !v)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">⚙ Gerenciar ▾</button>
          {gerenciarMenuAberto && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setGerenciarMenuAberto(false)} />
              <div className="absolute right-0 mt-1 z-20 w-60 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1 text-sm">
                <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Tarefas</div>
                <button type="button" onClick={() => { setGerenciarMenuAberto(false); setTab("admin"); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">🗂️ Áreas e projetos</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-[1760px] mx-auto p-3 sm:p-4 xl:px-6">

      {/* Banner "Visualizando como…" — só renderiza quando master ativou
          a impersonação. Indica claramente que o conteúdo abaixo é o que
          a outra pessoa veria, e dá saída rápida. */}
      {isViewingAs && viewingAsData && (
        <div className="mb-3 flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
          <span>👁</span>
          <span>
            Visualizando como <strong>{viewingAsData.nome}</strong> (sem o bypass de master).
            O que ela enxerga no Gestor de Tarefas é o que aparece aqui.
          </span>
          <button
            type="button"
            onClick={() => setViewingAsId(null)}
            className="ml-auto text-amber-900 dark:text-amber-200 hover:underline font-medium"
          >
            ← voltar pro meu perfil
          </button>
        </div>
      )}

      {/* "Ver como…" saiu daqui — acessível pelo cadastro da Pessoa. */}

      {/* Layout 2 colunas no desktop: sidebar lateral leve (estilo Asana —
          Minhas tarefas no topo + lista de projetos como favoritos clicáveis)
          + área principal com tabs e views. Mobile colapsa: sidebar some,
          tabs ficam por cima. */}
      <div>
        <ProjetosTopBar
          tabAtual={tab}
          projetoFiltroAtual={tab === "projeto" ? projetoFiltro : ""}
          subFiltroAtual={subFiltro}
          minhasPendentes={minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length}
          projetos={projetosVisiveis}
          subprojetos={subprojetosVisiveis}
          tarefasProjeto={tarefasProjeto}
          onAbrirMinhas={() => setTab("minhas")}
          onAbrirTudo={() => setTab("tudo")}
          onAbrirProjeto={(pid) => {
            if (tab === "projeto" && projetoFiltro === pid) { setTab("minhas"); setSubFiltro(""); }
            else { setTab("projeto"); setProjetoFiltro(pid); setSubFiltro(""); }
          }}
          onAbrirSubprojeto={(pid, sid) => { setTab("projeto"); setProjetoFiltro(pid); setSubFiltro(sid); }}
        />

        <div className="min-w-0">

      {tab === "minhas" && (
        <div>
          {/* Título igual ao do ProjetoView, pra padronizar — "Minhas tarefas"
              é tratado conceitualmente como um pseudo-projeto: a caixa pessoal. */}
          {/* Linha 1: título + Todas/Lixeira … visões (Calendário/Lista/Kanban) à direita */}
          <div className="mb-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
            <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">📥 Minhas tarefas</h2>
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{minhas.length} tarefa(s) · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} ativas</span>
            {isMaster && (
              <>
                <button type="button" onClick={() => setTab("todas")} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">🌐 Todas</button>
                <button type="button" onClick={() => setTab("lixeira")} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">🗑️ Lixeira</button>
              </>
            )}
            <div className="flex-1" />
            <div className="[&>div]:!mb-0"><ViewSwitcher value={viewMinhas} onChange={setViewMinhas} /></div>
          </div>
          {/* Linha 2: busca à esquerda … Nova reunião/Nova tarefa/Gerenciar à direita */}
          <div className="mb-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
            {buscaInput}
            <div className="flex-1" />
            {acoesHeader}
          </div>
          {viewMinhas === "calendario" && (
            <>
              <CalendarioView
                tarefas={filtrar(minhas)}
                projetos={projetos}
                subprojetos={subprojetos}
                onAbrir={setDetalheId}
                autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
                onNovaTarefaNoDia={(prazo) => setNovaAberta({ prazo })}
                onIdeiaNoDia={(i, prazo) => setNovaAberta({ titulo: i.titulo, descricao: i.descricao || "", prazo, puxando: { tipo: "ideia", id: i.id, titulo: i.titulo } })}
              />
              <CaixaIdeiasFaixa
                rids={pessoa?.restaurantIds || []}
                ridAtivo={ridAtivo || ""}
                meId={pessoa?.id || ""}
                isMaster={!!pessoa?.isMaster}
                restaurants={restaurants}
                podePrivadas={!!pessoa?.isMaster || canAcaoRid("ideias", "privadas")}
                onVerTodas={() => setTab("ideias")}
                onVirarTarefa={(i) => setNovaAberta({ titulo: i.titulo, descricao: i.descricao || "", puxando: { tipo: "ideia", id: i.id, titulo: i.titulo } })}
              />
            </>
          )}
          {viewMinhas === "lista" && (
            <MinhasTarefasView
              tarefas={filtrar(minhas)}
              projetos={projetos}
              subprojetos={subprojetos}
              onAbrir={setDetalheId}
              pessoaId={pessoa?.id || ""}
              pessoaNome={pessoa?.nome || ""}
            />
          )}
          {viewMinhas === "kanban" && (
            <KanbanView
              tarefas={filtrar(minhas)}
              projetos={projetos}
              autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
              onAbrir={setDetalheId}
            />
          )}
        </div>
      )}

      {tab === "tudo" && (
        <div>
          <div className="mb-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
            <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">🗂️ Tudo</h2>
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">minhas tarefas · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} ativas</span>
            <div className="flex-1" />
            <div className="[&>div]:!mb-0"><ViewSwitcher value={viewMinhas} onChange={setViewMinhas} /></div>
          </div>
          <div className="mb-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
            {buscaInput}
            <div className="flex-1" />
            {acoesHeader}
          </div>
          {viewMinhas === "calendario" && <CalendarioView tarefas={filtrar(minhas)} projetos={projetos} subprojetos={subprojetos} onAbrir={setDetalheId} autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }} onNovaTarefaNoDia={(prazo) => setNovaAberta({ prazo })} onIdeiaNoDia={(i, prazo) => setNovaAberta({ titulo: i.titulo, descricao: i.descricao || "", prazo, puxando: { tipo: "ideia", id: i.id, titulo: i.titulo } })} />}
          {viewMinhas === "lista" && <MinhasTarefasView tarefas={filtrar(minhas)} projetos={projetos} subprojetos={subprojetos} onAbrir={setDetalheId} pessoaId={pessoa?.id || ""} pessoaNome={pessoa?.nome || ""} />}
          {viewMinhas === "kanban" && <KanbanView tarefas={filtrar(minhas)} projetos={projetos} autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }} onAbrir={setDetalheId} />}
        </div>
      )}

      {tab === "ideias" && (
        <CaixaDeIdeias
          rids={pessoa?.restaurantIds || []}
          ridAtivo={ridAtivo || ""}
          meId={pessoa?.id || ""}
          isMaster={!!pessoa?.isMaster}
          restaurants={restaurants}
          podePrivadas={!!pessoa?.isMaster || canAcaoRid("ideias", "privadas")}
          onVoltar={() => setTab("minhas")}
          onVirarTarefa={(i) => setNovaAberta({ titulo: i.titulo, descricao: i.descricao || "", puxando: { tipo: "ideia", id: i.id, titulo: i.titulo } })}
        />
      )}

      {tab === "todas" && isMaster && (
        <div>
          <div className="mb-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
            <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">🌐 Todas as tarefas</h2>
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{todasTarefas.length} tarefa(s) · {todasTarefas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} ativas</span>
            <button type="button" onClick={() => setTab("minhas")} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">← Minhas</button>
            <div className="flex-1" />
            <div className="[&>div]:!mb-0"><ViewSwitcher value={viewMinhas} onChange={setViewMinhas} /></div>
          </div>
          <div className="mb-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
            {buscaInput}
            <div className="flex-1" />
            {acoesHeader}
          </div>
          {viewMinhas === "calendario" && (
            <CalendarioView tarefas={filtrar(todasTarefas)} projetos={projetos} subprojetos={subprojetos} onAbrir={setDetalheId} autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }} onNovaTarefaNoDia={(prazo) => setNovaAberta({ prazo })} />
          )}
          {viewMinhas === "lista" && (
            <MinhasTarefasView tarefas={filtrar(todasTarefas)} projetos={projetos} subprojetos={subprojetos} onAbrir={setDetalheId} pessoaId={pessoa?.id || ""} pessoaNome={pessoa?.nome || ""} />
          )}
          {viewMinhas === "kanban" && (
            <KanbanView tarefas={filtrar(todasTarefas)} projetos={projetos} autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }} onAbrir={setDetalheId} />
          )}
        </div>
      )}

      {tab === "projeto" && (
        <>
          {/* Picker de projeto/sub no mobile — no desktop a sidebar lateral
              cuida disso, mas no mobile ela some (hidden md:block). */}
          <div className="md:hidden mb-3 grid grid-cols-1 gap-2">
            <select
              value={projetoFiltro}
              onChange={(e) => { setProjetoFiltro(e.target.value); setSubFiltro(""); }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">— Escolha uma área —</option>
              {projetosVisiveis.map(p => (
                <option key={p.id} value={p.id}>{p.emoji || "📁"} {p.nome}</option>
              ))}
            </select>
            {projetoFiltro && (
              <select
                value={subFiltro}
                onChange={(e) => setSubFiltro(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">— Todos os projetos —</option>
                {subprojetosVisiveis
                  .filter(s => s.projetoId === projetoFiltro)
                  .map(s => (
                    <option key={s.id} value={s.id}>
                      {s.bloqueadoCriacaoManual ? "🔒 " : ""}{s.nome}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <ProjetoView
            projetos={projetos}
            subprojetos={subprojetos}
            projetoFiltro={projetoFiltro}
            subFiltro={subFiltro}
            tarefas={filtrar(tarefasProjetoVisiveis)}
            onAbrir={setDetalheId}
            view={viewProjeto}
            onChangeView={setViewProjeto}
            autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
            onNovaTarefa={(opts) => setNovaAberta(opts)}
            acoes={acoesHeader}
            busca={buscaInput}
          />
        </>
      )}

      {tab === "admin" && isMaster && (
        <AdminView
          projetos={projetos}
          subprojetos={subprojetos}
          pessoaId={pessoa?.id || ""}
        />
      )}

      {tab === "lixeira" && isMaster && (
        <LixeiraView
          tarefas={lixeira.filter(t => podeVerTarefa(t, projetos.find(p => p.id === t.projetoId), pessoa))}
          projetos={projetos}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
        />
      )}

      {novaAberta && (
        <NovaTarefaModal
          onClose={() => setNovaAberta(null)}
          projetos={projetos}
          subprojetos={subprojetos}
          restaurantes={restaurants}
          pessoaId={pessoa?.id || ""}
          pessoaNome={pessoa?.nome || ""}
          prazoInicial={novaAberta.prazo}
          projetoIdInicial={novaAberta.projetoId}
          subprojetoIdInicial={novaAberta.subprojetoId}
          tituloInicial={novaAberta.titulo}
          descricaoInicial={novaAberta.descricao}
          puxandoInicial={novaAberta.puxando || null}
        />
      )}

      {novaReuniao && ridAtivo && (
        <ReuniaoEditorModal reuniao={null} restaurantId={ridAtivo} onClose={() => setNovaReuniao(false)} />
      )}

        </div> {/* fecha .min-w-0 (área de conteúdo principal) */}
      </div> {/* fecha grid sidebar+content */}

      {tarefaSelecionada && (
        podeVerTarefa(tarefaSelecionada, projetos.find(p => p.id === tarefaSelecionada.projetoId), pessoa) ? (
          <DetalheModal
            tarefa={tarefaSelecionada}
            projetos={projetos}
            subprojetos={subprojetos}
            autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
            onClose={() => setDetalheId(null)}
          />
        ) : (
          <SemPermissaoModal onClose={() => setDetalheId(null)} />
        )
      )}

    </div>
  );
}

