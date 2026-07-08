// Página principal do Gestor de Tarefas.
// Tabs: Minhas Tarefas (default) · Por Projeto · Admin (master) · Lixeira (master).
//
// Caixa POR USUÁRIO: Minhas Tarefas = onde sou responsável OU co-responsável,
// independente do restaurante selecionado no topo.

import { useEffect, useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { aplicarPerfisNaPessoa } from "../../core/auth/profileToLegacy";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import {
  ouvirProjetos, ouvirSubprojetos, ouvirTarefasDeUsuario, ouvirTarefasDeProjeto,
  ouvirLixeira, criarTarefa, mudarStatus, softDeleteTarefa, restaurarTarefa,
  marcarSubtarefa, adicionarComentario, atualizarTarefa,
  salvarProjeto, salvarSubprojeto, CamposObrigatoriosFaltantesError,
  migrarGruposParaPrivadoLegado, aposentarCaixaPessoal,
  contarTarefasDoSubprojeto, moverSubprojetoParaProjeto,
  ouvirAutomacoes, salvarAutomacao, propagarAutomacaoEmAbertas,
} from "./repository";

async function mudarStatusComErro(id: string, status: TarefaStatus, autor: { id: string; nome: string }) {
  try {
    await mudarStatus(id, status, autor);
  } catch (e) {
    if (e instanceof CamposObrigatoriosFaltantesError) {
      alert(`Não dá pra concluir — campos obrigatórios faltando:\n\n• ${e.faltantes.join("\n• ")}`);
      return;
    }
    throw e;
  }
}
import { MODULES } from "../../config/modules";
import type {
  Tarefa, TarefaProjeto, TarefaSubprojeto, TarefaStatus, TarefaPrioridade,
  TarefaVisibilidade, TarefaTemplate, TarefaCustomField, TarefaCustomFieldTipo,
  TarefaAutomacao, ModuloOrigemTarefa,
} from "../../core/types";
import {
  TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL, TAREFA_ORIGEM_LABEL,
  TAREFA_VISIBILIDADE_LABEL, RECORRENCIA_TIPO_LABEL,
  TAREFA_CUSTOM_FIELD_TIPO_LABEL, MODULOS_ORIGEM_TAREFA,
} from "../../core/types";
import type { TarefaAnexo, Subtarefa } from "../../core/types";
import { fmtBR, fmtBRDateTime } from "../../core/utils/date";
import { resolverPrazoOffset, extrairMencoes } from "./prazoOffset";
import { podeVerTarefa, podeVerProjeto, isConfidencial } from "./visibilidade";
import { parseCSV, mapearLinhas, executarImport, detectarOrfas } from "./importador";
import type { LinhaImportada } from "./importador";
import type { AccessProfile, Pessoa, Restaurant } from "../../core/types";
import { pickDriveFolder, pickDriveFile } from "../../core/google/drivePicker";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";

type Tab = "minhas" | "projeto" | "admin" | "lixeira";
type ViewMode = "calendario" | "lista" | "kanban";

export function TarefasPage() {
  const { pessoa: pessoaReal } = useAuth();
  const { restaurants, activeId: ridAtivo } = useRestaurant();
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
  const [viewProjeto, setViewProjeto] = useState<ViewMode>("lista");

  const [projetos, setProjetos] = useState<TarefaProjeto[]>([]);
  const [subprojetos, setSubprojetos] = useState<TarefaSubprojeto[]>([]);
  const [minhas, setMinhas] = useState<Tarefa[]>([]);
  const [projetoFiltro, setProjetoFiltro] = useState<string>("");
  // subFiltro vive aqui (não no ProjetoView) pra a sidebar conseguir mostrar
  // os subprojetos como accordion dentro do próprio projeto selecionado.
  const [subFiltro, setSubFiltro] = useState<string>("");
  const [tarefasProjeto, setTarefasProjeto] = useState<Tarefa[]>([]);
  const [lixeira, setLixeira] = useState<Tarefa[]>([]);
  // Modal de nova tarefa. Aceita pré-preenchimento de prazo, projeto e
  // subprojeto pra fluxos diferentes (botão por dia, "+ Nova tarefa" dentro
  // de um projeto, etc.).
  const [novaAberta, setNovaAberta] = useState<{ prazo?: string; projetoId?: string; subprojetoId?: string } | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  // Ouvir projetos + subprojetos
  useEffect(() => {
    const u1 = ouvirProjetos(setProjetos);
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
          alert(`Permissões migradas: ${r.projetos} projeto(s) e ${r.tarefas} tarefa(s) viraram "Privado". Adicione as pessoas autorizadas em cada um conforme necessário.`);
        }
      })
      .catch(e => console.warn("[tarefas] migração falhou:", e));
  }, [pessoaReal?.isMaster]);

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
            alert(`Caixa Pessoal aposentado. ${r.tarefasMexidas} tarefa(s) ficaram órfãs no projeto removido. Você pode editá-las e movê-las pra outro projeto, ou usar o Banco de Ideias dali pra frente.`);
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
    const u = ouvirTarefasDeUsuario(pessoa.id, setMinhas);
    return () => u();
  }, [pessoa?.id]);

  // Tarefas do projeto filtrado
  useEffect(() => {
    if (tab !== "projeto" || !projetoFiltro) { setTarefasProjeto([]); return; }
    const u = ouvirTarefasDeProjeto(projetoFiltro, setTarefasProjeto);
    return () => u();
  }, [tab, projetoFiltro]);

  // Lixeira
  useEffect(() => {
    if (tab !== "lixeira") return;
    const u = ouvirLixeira(setLixeira);
    return () => u();
  }, [tab]);

  // `isMaster` reflete o USER REAL (não a pessoa impersonada). Permissão de
  // master pra usar AdminView/Lixeira/Ver-como vem da identidade autêntica.
  // Mas `pessoa` usada nos filtros de visibilidade É a impersonada — pra
  // simular o que ela vê.
  const isMaster = !!pessoaReal?.isMaster;
  const tarefaSelecionada = useMemo(
    () => [...minhas, ...tarefasProjeto].find(t => t.id === detalheId) || null,
    [detalheId, minhas, tarefasProjeto],
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

  // Gate de acesso: sem permissão "tarefas.verProprias" cai pra HomePage,
  // que vai redirecionar pro Portal do Empregado se aplicável. Master sempre
  // passa (bypass do isMaster real, antes da impersonação).
  const temAcessoTarefas = isMaster || (ridAtivo && canAcaoRid("tarefas", "verProprias"));
  if (!temAcessoTarefas && ridAtivo) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4">
      <header className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        <div className="flex-1" />
        <Button
          onClick={() => setNovaAberta({})}
          className="whitespace-nowrap text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2"
        >
          + Nova<span className="hidden sm:inline"> Tarefa</span>
        </Button>
      </header>

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
          <div className="mb-3 flex items-baseline gap-2 flex-wrap">
            <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">
              📥 Minhas tarefas
            </h2>
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              {minhas.length} tarefa(s) · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} ativas
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {isMaster && (
              <>
                <button type="button" onClick={() => setTab("admin")} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">⚙️ Configurações</button>
                <button type="button" onClick={() => setTab("lixeira")} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">🗑️ Lixeira</button>
                <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
              </>
            )}
            <div className="[&>div]:!mb-0"><ViewSwitcher value={viewMinhas} onChange={setViewMinhas} /></div>
          </div>
          {viewMinhas === "calendario" && (
            <CalendarioView
              tarefas={minhas}
              projetos={projetos}
              subprojetos={subprojetos}
              onAbrir={setDetalheId}
              autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
              onNovaTarefaNoDia={(prazo) => setNovaAberta({ prazo })}
            />
          )}
          {viewMinhas === "lista" && (
            <MinhasTarefasView
              tarefas={minhas}
              projetos={projetos}
              subprojetos={subprojetos}
              onAbrir={setDetalheId}
              pessoaId={pessoa?.id || ""}
              pessoaNome={pessoa?.nome || ""}
            />
          )}
          {viewMinhas === "kanban" && (
            <KanbanView
              tarefas={minhas}
              projetos={projetos}
              autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
              onAbrir={setDetalheId}
            />
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
              <option value="">— Escolha um projeto —</option>
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
                <option value="">— Todos os subprojetos —</option>
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
            tarefas={tarefasProjeto.filter(t => podeVerTarefa(t, projetos.find(p => p.id === t.projetoId), pessoa))}
            onAbrir={setDetalheId}
            view={viewProjeto}
            onChangeView={setViewProjeto}
            autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
            onNovaTarefa={(opts) => setNovaAberta(opts)}
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
        />
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

// Sidebar lateral (estilo Asana) — atalho "Minhas tarefas" no topo + lista
// de projetos como accordion (click expande mostrando subprojetos inline,
// sem abrir uma 2ª coluna duplicada).
// Barra horizontal no topo (substitui a antiga sidebar lateral) — libera a
// largura pro calendário/kanban. "Minhas tarefas" + projetos como chips; os
// subprojetos do projeto ativo aparecem numa 2ª linha.
function ProjetosTopBar({
  tabAtual, projetoFiltroAtual, subFiltroAtual, minhasPendentes,
  projetos, subprojetos, tarefasProjeto,
  onAbrirMinhas, onAbrirProjeto, onAbrirSubprojeto,
}: {
  tabAtual: string;
  projetoFiltroAtual: string;
  subFiltroAtual: string;
  minhasPendentes: number;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  tarefasProjeto: Tarefa[];
  onAbrirMinhas: () => void;
  onAbrirProjeto: (id: string) => void;
  onAbrirSubprojeto: (projetoId: string, subId: string) => void;
}) {
  const ativas = (ts: Tarefa[]) => ts.filter(t => t.status !== "concluida" && t.status !== "cancelada").length;
  const subs = tabAtual === "projeto" && projetoFiltroAtual ? subprojetos.filter(s => s.projetoId === projetoFiltroAtual) : [];
  const chip = (active: boolean) => `shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`;
  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button onClick={onAbrirMinhas} className={chip(tabAtual === "minhas")}>
          📥 Minhas tarefas
          {minhasPendentes > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold">{minhasPendentes}</span>}
        </button>
        {projetos.map(p => (
          <button key={p.id} onClick={() => onAbrirProjeto(p.id)} className={chip(tabAtual === "projeto" && projetoFiltroAtual === p.id)} title={p.nome}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.cor || "#6b7280" }} />
            <span>{p.emoji || "📁"}</span>
            <span className="whitespace-nowrap">{p.nome}</span>
          </button>
        ))}
      </div>
      {tabAtual === "projeto" && subs.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pl-1">
          {subs.map(s => {
            const ativ = ativas(tarefasProjeto.filter(t => t.subprojetoId === s.id));
            const sel = subFiltroAtual === s.id;
            const auto = !!s.bloqueadoCriacaoManual;
            return (
              <button key={s.id} onClick={() => onAbrirSubprojeto(projetoFiltroAtual, s.id)} title={s.nome}
                className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs transition-colors ${sel ? (auto ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300" : "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300") : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                {auto ? "🔒" : "✏️"}<span className="whitespace-nowrap">{s.nome}</span>{ativ > 0 && <span className="text-[10px] opacity-70">{ativ}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { id: ViewMode; icon: string; label: string }[] = [
    { id: "calendario", icon: "📅", label: "Calendário" },
    { id: "lista", icon: "📋", label: "Lista" },
    { id: "kanban", icon: "📊", label: "Kanban" },
  ];
  return (
    <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-4">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value === o.id
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          }`}
        >
          <span className="mr-1.5">{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

// ─── VIEW: Minhas Tarefas ─────────────────────────────────────────────────

function MinhasTarefasView({ tarefas, projetos, subprojetos, onAbrir, pessoaId, pessoaNome }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  onAbrir: (id: string) => void;
  pessoaId: string;
  pessoaNome: string;
}) {
  const { restaurants } = useRestaurant();
  const [filtroStatus, setFiltroStatus] = useState<TarefaStatus | "todos" | "ativas" | "atrasadas" | "hoje" | "semana">("ativas");
  const [busca, setBusca] = useState("");
  const [filtroProjeto, setFiltroProjeto] = useState<string>("");
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("");
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  const hoje = new Date().toISOString().slice(0, 10);
  const daquiSeteDias = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

  const filtradas = useMemo(() => {
    let l = tarefas;
    // Filtro principal por status / prazo (chip)
    if (filtroStatus === "ativas") {
      l = l.filter(t => t.status === "a_fazer" || t.status === "em_andamento");
    } else if (filtroStatus === "atrasadas") {
      l = l.filter(t => t.prazo && t.prazo < hoje && t.status !== "concluida" && t.status !== "cancelada");
    } else if (filtroStatus === "hoje") {
      l = l.filter(t => t.prazo === hoje && t.status !== "concluida" && t.status !== "cancelada");
    } else if (filtroStatus === "semana") {
      l = l.filter(t => t.prazo && t.prazo >= hoje && t.prazo <= daquiSeteDias && t.status !== "concluida" && t.status !== "cancelada");
    } else if (filtroStatus !== "todos") {
      l = l.filter(t => t.status === filtroStatus);
    }
    // Busca textual no título + descrição + valores dos custom fields
    if (busca.trim()) {
      const b = busca.toLowerCase();
      l = l.filter(t => {
        if (t.titulo.toLowerCase().includes(b)) return true;
        if ((t.descricao || "").toLowerCase().includes(b)) return true;
        // Custom fields: stringifica valores e procura
        const cf = t.customFields || {};
        return Object.values(cf).some(v => String(v ?? "").toLowerCase().includes(b));
      });
    }
    // Filtro projeto
    if (filtroProjeto) l = l.filter(t => t.projetoId === filtroProjeto);
    // Filtro empresa
    if (filtroEmpresa) l = l.filter(t => (t.restaurantIds || []).includes(filtroEmpresa));
    // Ordena por prazo asc, sem prazo no fim
    return l.sort((a, b) => {
      if (!a.prazo && !b.prazo) return 0;
      if (!a.prazo) return 1;
      if (!b.prazo) return -1;
      return a.prazo.localeCompare(b.prazo);
    });
  }, [tarefas, filtroStatus, busca, filtroProjeto, filtroEmpresa, hoje, daquiSeteDias]);

  const atrasadasCount = useMemo(
    () => tarefas.filter(t => t.prazo && t.prazo < hoje && t.status !== "concluida" && t.status !== "cancelada").length,
    [tarefas, hoje]
  );

  function limparFiltros() {
    setBusca("");
    setFiltroProjeto("");
    setFiltroEmpresa("");
    setFiltroStatus("ativas");
  }
  const algumFiltroAtivo = busca || filtroProjeto || filtroEmpresa || filtroStatus !== "ativas";

  if (tarefas.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <div className="text-4xl mb-2">📭</div>
        <p>Nenhuma tarefa atribuída a você ainda.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Linha 1: busca + toggle de filtros avançados */}
      <div className="flex gap-2 mb-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔍 Buscar título, descrição ou campos custom…"
          className="flex-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <Button size="sm" variant="ghost" onClick={() => setMostrarFiltros(s => !s)}>
          {mostrarFiltros ? "Ocultar filtros" : "Filtros"}
        </Button>
        {algumFiltroAtivo && (
          <Button size="sm" variant="ghost" onClick={limparFiltros}>Limpar</Button>
        )}
      </div>

      {/* Linha 2: chips de status/prazo */}
      <div className="flex gap-2 mb-2 text-sm overflow-x-auto pb-1">
        <FiltroChip ativo={filtroStatus === "ativas"} onClick={() => setFiltroStatus("ativas")}>Ativas</FiltroChip>
        <FiltroChip ativo={filtroStatus === "atrasadas"} onClick={() => setFiltroStatus("atrasadas")}>
          🔥 Atrasadas{atrasadasCount > 0 && ` (${atrasadasCount})`}
        </FiltroChip>
        <FiltroChip ativo={filtroStatus === "hoje"} onClick={() => setFiltroStatus("hoje")}>Hoje</FiltroChip>
        <FiltroChip ativo={filtroStatus === "semana"} onClick={() => setFiltroStatus("semana")}>Próx. 7 dias</FiltroChip>
        <FiltroChip ativo={filtroStatus === "a_fazer"} onClick={() => setFiltroStatus("a_fazer")}>A fazer</FiltroChip>
        <FiltroChip ativo={filtroStatus === "em_andamento"} onClick={() => setFiltroStatus("em_andamento")}>Em andamento</FiltroChip>
        <FiltroChip ativo={filtroStatus === "concluida"} onClick={() => setFiltroStatus("concluida")}>Concluídas</FiltroChip>
        <FiltroChip ativo={filtroStatus === "todos"} onClick={() => setFiltroStatus("todos")}>Todas</FiltroChip>
      </div>

      {/* Linha 3: filtros avançados (toggle) */}
      {mostrarFiltros && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
          <label className="text-xs">
            <div className="text-gray-500 dark:text-gray-400 mb-1">Projeto</div>
            <select value={filtroProjeto} onChange={(e) => setFiltroProjeto(e.target.value)} className="w-full px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">— todos —</option>
              {projetos.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <div className="text-gray-500 dark:text-gray-400 mb-1">Empresa</div>
            <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="w-full px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">— todas —</option>
              {restaurants.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
        <span>{filtradas.length} de {tarefas.length} tarefa(s)</span>
        <button
          onClick={() => { setModoSelecao(!modoSelecao); setSelecionadas(new Set()); }}
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {modoSelecao ? "Cancelar seleção" : "Selecionar várias"}
        </button>
      </div>

      {filtradas.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          Nenhuma tarefa com esses filtros.
        </div>
      ) : (
        <div className="space-y-2 pb-20">
          {filtradas.map(t => (
            <div key={t.id} className="flex items-start gap-2">
              {modoSelecao && (
                <input
                  type="checkbox"
                  checked={selecionadas.has(t.id)}
                  onChange={(e) => {
                    const novo = new Set(selecionadas);
                    if (e.target.checked) novo.add(t.id); else novo.delete(t.id);
                    setSelecionadas(novo);
                  }}
                  className="mt-3"
                />
              )}
              <div className="flex-1 min-w-0">
                <TarefaCard
                  tarefa={t}
                  projetos={projetos}
                  subprojetos={subprojetos}
                  onAbrir={() => {
                    if (modoSelecao) {
                      const novo = new Set(selecionadas);
                      if (novo.has(t.id)) novo.delete(t.id); else novo.add(t.id);
                      setSelecionadas(novo);
                    } else onAbrir(t.id);
                  }}
                  autor={{ id: pessoaId, nome: pessoaNome }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {modoSelecao && selecionadas.size > 0 && (
        <BulkActionsBar
          ids={Array.from(selecionadas)}
          autor={{ id: pessoaId, nome: pessoaNome }}
          onDone={() => { setModoSelecao(false); setSelecionadas(new Set()); }}
        />
      )}
    </div>
  );
}

function BulkActionsBar({ ids, autor, onDone }: {
  ids: string[];
  autor: { id: string; nome: string };
  onDone: () => void;
}) {
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
  const [trocandoResp, setTrocandoResp] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  useEffect(() => {
    if (!trocandoResp && !autorizando) return;
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoas(list);
    });
    return () => u();
  }, [trocandoResp, autorizando]);

  async function mudarStatusBulk(status: TarefaStatus) {
    if (!confirm(`Mudar status de ${ids.length} tarefa(s) pra "${TAREFA_STATUS_LABEL[status]}"?`)) return;
    for (const id of ids) await mudarStatusComErro(id, status, autor);
    onDone();
  }
  async function excluirBulk() {
    if (!confirm(`Excluir ${ids.length} tarefa(s)? Vão pra lixeira (master pode restaurar).`)) return;
    for (const id of ids) await softDeleteTarefa(id, autor, "Bulk delete");
    onDone();
  }
  async function trocarResponsavel(pessoaId: string, pessoaNome: string) {
    if (!confirm(`Atribuir ${ids.length} tarefa(s) pra ${pessoaNome}?`)) return;
    for (const id of ids) {
      await atualizarTarefa(id, {
        responsavelId: pessoaId,
        responsavelNome: pessoaNome,
      }, autor, {
        acao: "responsavel_mudou",
        campo: "responsável (bulk)",
        valorDepois: pessoaNome,
      });
    }
    onDone();
  }
  async function autorizarPessoa(pessoaId: string, pessoaNome: string) {
    if (!confirm(`Adicionar ${pessoaNome} como autorizada em ${ids.length} tarefa(s)?`)) return;
    // Faz por tarefa pra preservar lista existente
    const { getTarefa } = await import("./repository");
    for (const id of ids) {
      const t = await getTarefa(id);
      if (!t) continue;
      const cur = t.usuariosAutorizados || [];
      if (cur.includes(pessoaId)) continue;
      await atualizarTarefa(id, {
        usuariosAutorizados: [...cur, pessoaId],
      }, autor, {
        acao: "editada",
        campo: "autorizados (bulk)",
        valorDepois: pessoaNome,
      });
    }
    onDone();
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-60 z-30 p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-lg">
      <div className="flex items-center gap-2 max-w-7xl mx-auto flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{ids.length} selecionada(s)</span>
        {trocandoResp ? (
          <select
            autoFocus
            onChange={(e) => {
              const p = pessoas.find(x => x.id === e.target.value);
              if (p) trocarResponsavel(p.id, p.nome);
              setTrocandoResp(false);
            }}
            onBlur={() => setTrocandoResp(false)}
            className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
            defaultValue=""
          >
            <option value="" disabled>— escolha pessoa —</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        ) : autorizando ? (
          <select
            autoFocus
            onChange={(e) => {
              const p = pessoas.find(x => x.id === e.target.value);
              if (p) autorizarPessoa(p.id, p.nome);
              setAutorizando(false);
            }}
            onBlur={() => setAutorizando(false)}
            className="px-2 py-1 text-sm rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30"
            defaultValue=""
          >
            <option value="" disabled>— autorizar pessoa —</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setTrocandoResp(true)}>Atribuir a…</Button>
            <Button size="sm" variant="ghost" onClick={() => setAutorizando(true)}>🔒 Autorizar…</Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => mudarStatusBulk("em_andamento")}>Em andamento</Button>
        <Button size="sm" variant="ghost" onClick={() => mudarStatusBulk("concluida")}>✓ Concluir</Button>
        <Button size="sm" variant="ghost" onClick={() => mudarStatusBulk("cancelada")}>Cancelar</Button>
        <Button size="sm" variant="ghost" onClick={excluirBulk}>🗑️ Excluir</Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onDone}>Fechar</Button>
      </div>
    </div>
  );
}

function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        ativo
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
    >{children}</button>
  );
}

// ─── COMPONENTE: Card de Tarefa ───────────────────────────────────────────

function TarefaCard({ tarefa, projetos, subprojetos, onAbrir, autor }: {
  tarefa: Tarefa;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  onAbrir: () => void;
  autor: { id: string; nome: string };
}) {
  const projeto = projetos.find(p => p.id === tarefa.projetoId);
  const sub = subprojetos.find(s => s.id === tarefa.subprojetoId);
  const cor = tarefa.corHerdada || projeto?.cor || "#6b7280";
  const concluida = tarefa.status === "concluida";
  const atrasada = tarefa.prazo && tarefa.prazo < new Date().toISOString().slice(0, 10) && !concluida;
  const subtarefasFeitas = (tarefa.subtarefas || []).filter(s => s.feito).length;
  const subtarefasTotal = (tarefa.subtarefas || []).length;
  const confidencial = isConfidencial(tarefa, projeto);

  return (
    <div
      onClick={onAbrir}
      className={`
        p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md
        ${concluida ? "opacity-60" : ""}
        bg-white dark:bg-gray-900
        border-gray-200 dark:border-gray-800
      `}
      style={{ borderLeftWidth: 4, borderLeftColor: cor }}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); mudarStatusComErro(tarefa.id, concluida ? "a_fazer" : "concluida", autor); }}
          className={`mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
            concluida
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "border-gray-300 dark:border-gray-600 hover:border-indigo-500"
          }`}
          title={concluida ? "Reabrir" : "Marcar como concluída"}
        >
          {concluida && "✓"}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`font-medium text-gray-900 dark:text-gray-100 ${concluida ? "line-through" : ""} flex items-center gap-1.5`}>
            {confidencial && <span title="Confidencial — só pessoas autorizadas" className="text-amber-600 dark:text-amber-400 text-xs">🔒</span>}
            <span className="truncate">{tarefa.titulo}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
            {projeto && <span style={{ color: cor }}>{projeto.emoji} {projeto.nome}</span>}
            {sub && <span>· {sub.nome}</span>}
            {tarefa.prazo && (
              <span className={atrasada ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                · 📅 {fmtBR(tarefa.prazo)}
              </span>
            )}
            {subtarefasTotal > 0 && (
              <span>· ☑️ {subtarefasFeitas}/{subtarefasTotal}</span>
            )}
            {(tarefa.comentarios?.length ?? 0) > 0 && (
              <span>· 💬 {tarefa.comentarios?.length}</span>
            )}
            {tarefa.origem !== "manual" && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px]">
                {TAREFA_ORIGEM_LABEL[tarefa.origem]}
              </span>
            )}
            {tarefa.prioridade !== "normal" && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                tarefa.prioridade === "urgente" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
                tarefa.prioridade === "alta" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" :
                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}>
                {TAREFA_PRIORIDADE_LABEL[tarefa.prioridade]}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VIEW: Por Projeto ────────────────────────────────────────────────────

function ProjetoView({ projetos, subprojetos, projetoFiltro, subFiltro, tarefas, onAbrir, view, onChangeView, autor, onNovaTarefa }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  projetoFiltro: string;
  // Vem de cima — a sidebar lateral controla a seleção de subprojeto.
  subFiltro: string;
  tarefas: Tarefa[];
  onAbrir: (id: string) => void;
  view: ViewMode;
  onChangeView: (v: ViewMode) => void;
  autor: { id: string; nome: string };
  // Abre modal de nova tarefa já com prazo/projeto/subprojeto pré-preenchidos
  // — usado pelos botões "+ Nova tarefa" nas colunas do calendário.
  onNovaTarefa: (opts: { prazo?: string; projetoId?: string; subprojetoId?: string }) => void;
}) {
  const proj = projetos.find(p => p.id === projetoFiltro);
  const subsDoProj = subprojetos.filter(s => s.projetoId === projetoFiltro);
  const tarefasFiltradas = subFiltro
    ? tarefas.filter(t => t.subprojetoId === subFiltro)
    : tarefas;
  const ativas = (ts: Tarefa[]) => ts.filter(t => t.status !== "concluida" && t.status !== "cancelada").length;

  const subAtual = subFiltro ? subsDoProj.find(s => s.id === subFiltro) : null;

  return (
    <div>
      <main className="flex-1 min-w-0">
        {!proj ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            <span className="hidden md:inline">Escolha um projeto na lateral pra ver suas tarefas.</span>
            <span className="md:hidden">Escolha um projeto acima pra ver suas tarefas.</span>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-baseline gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {proj.emoji} {proj.nome}{subAtual && <span className="text-gray-400 dark:text-gray-500 font-normal"> · {subAtual.nome}</span>}
              </h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {tarefasFiltradas.length} tarefa(s) · {ativas(tarefasFiltradas)} ativas
              </span>
            </div>

            {/* Banner pra subprojeto automático/bloqueado — explica como
                ele recebe tarefas e dá CTA pro módulo origem. CTA respeita
                o moduloOrigemRestaurantId travado (se houver) ou usa o rest
                atual como fallback. */}
            {subAtual?.bloqueadoCriacaoManual && (
              <BannerSubAuto
                sub={subAtual}
                restTravadoId={subAtual.moduloOrigemRestaurantId}
              />
            )}

            <ViewSwitcher value={view} onChange={onChangeView} />
            {view === "lista" && (
              <ProjetoListaView
                projeto={proj}
                subprojetos={subprojetos}
                subFiltro={subFiltro}
                tarefas={tarefasFiltradas}
                projetos={projetos}
                onAbrir={onAbrir}
                autor={autor}
              />
            )}
            {view === "calendario" && (() => {
              // Se o sub filtrado está bloqueado pra criação manual, não
              // passa o callback — CalendarioView esconde os "+ Nova tarefa"
              // tracejados das colunas naturalmente.
              const subBloqueado = !!(subAtual && subAtual.bloqueadoCriacaoManual);
              return (
                <CalendarioView
                  tarefas={tarefasFiltradas}
                  projetos={projetos}
                  subprojetos={subprojetos}
                  onAbrir={onAbrir}
                  autor={autor}
                  /* Pré-preenche projeto (sempre) e subprojeto (se um sub está
                     filtrado). Sem subFiltro, o user escolhe no modal. */
                  onNovaTarefaNoDia={subBloqueado ? undefined : (prazo) => onNovaTarefa({
                    prazo,
                    projetoId: projetoFiltro,
                    subprojetoId: subFiltro || undefined,
                  })}
                />
              );
            })()}
            {view === "kanban" && (
              <KanbanView tarefas={tarefasFiltradas} projetos={projetos} autor={autor} onAbrir={onAbrir} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Banner explicativo pra subprojeto bloqueado. Mostra origem + CTA pro
// módulo. Comportamento do CTA:
// - Sub travado num restaurante (moduloOrigemRestaurantId): link direto
//   pra /r/{travado}/{rota}. Mostra chip "🔒 Nome".
// - Sub sem trava: clica abre modal perguntando QUAL restaurante (em
//   vez de assumir o rest atual e arriscar confusão).
function BannerSubAuto({ sub, restTravadoId }: {
  sub: TarefaSubprojeto;
  restTravadoId?: string;
}) {
  const { restaurants } = useRestaurant();
  const restTravado = restTravadoId
    ? restaurants.find(r => r.id === restTravadoId)
    : null;
  const [escolhendoRest, setEscolhendoRest] = useState(false);

  const label = sub.moduloOrigemLabel || "Ir pra origem";
  const rota = sub.moduloOrigemRota || "";

  // Estilo unificado do CTA — mesmo tamanho/padding pra ambos os
  // caminhos (link direto vs botão que abre modal).
  const ctaClass =
    "shrink-0 inline-flex items-center gap-1 px-4 py-2 h-9 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium transition-colors";

  return (
    <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-center gap-4">
      <span className="text-3xl shrink-0 leading-none" aria-hidden>🤖</span>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2 flex-wrap leading-tight">
          Subprojeto automático
          {restTravado && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
              🔒 {restTravado.nome}
            </span>
          )}
        </div>
        <p className="text-[13px] text-amber-800 dark:text-amber-300 leading-snug">
          As tarefas aqui são criadas automaticamente pelo sistema — você não cria manualmente.
        </p>
        {sub.gatilho && (
          <p className="text-[12px] text-amber-700 dark:text-amber-400 leading-snug">
            <strong>Gatilho:</strong> {sub.gatilho}
          </p>
        )}
      </div>
      {rota && (
        restTravado ? (
          <a href={`/r/${restTravado.id}${rota}`} className={ctaClass}>
            {label} →
          </a>
        ) : (
          <button type="button" onClick={() => setEscolhendoRest(true)} className={ctaClass}>
            {label} →
          </button>
        )
      )}
      {escolhendoRest && (
        <EscolhaRestauranteModal
          restaurants={restaurants}
          rota={rota}
          tituloModulo={label.replace(/^Ir pra /i, "")}
          onClose={() => setEscolhendoRest(false)}
        />
      )}
    </div>
  );
}

// Modal: lista os restaurantes do user e ao escolher, navega pra
// /r/{escolhido}/{rota}. Usado pelo banner quando o sub não tem rest
// travado e o user precisa decidir qual unidade abrir.
function EscolhaRestauranteModal({ restaurants, rota, tituloModulo, onClose }: {
  restaurants: Array<{ id: string; nome: string }>;
  rota: string;
  tituloModulo: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
          Qual restaurante?
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Você vai pra <span className="font-medium">{tituloModulo}</span>. Escolha em qual restaurante quer abrir.
        </p>
        <div className="space-y-1.5">
          {restaurants.map(r => (
            <a
              key={r.id}
              href={`/r/${r.id}${rota}`}
              className="block w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors"
            >
              🏠 {r.nome} →
            </a>
          ))}
          {restaurants.length === 0 && (
            <div className="text-sm text-gray-400 italic text-center py-4">
              Nenhum restaurante disponível.
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

function ProjetoListaView({ projeto, subprojetos, subFiltro, tarefas, projetos, onAbrir, autor }: {
  projeto: TarefaProjeto;
  subprojetos: TarefaSubprojeto[];
  subFiltro: string;
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  onAbrir: (id: string) => void;
  autor: { id: string; nome: string };
}) {
  const subs = subFiltro
    ? subprojetos.filter(s => s.id === subFiltro)
    : subprojetos.filter(s => s.projetoId === projeto.id);

  return (
    <div>
      {subs.map(sub => {
        const tarefasSub = tarefas.filter(t => t.subprojetoId === sub.id);
        return (
          <div key={sub.id} className="mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {sub.nome}
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">
                {tarefasSub.length} tarefa(s) {sub.auto && "· auto"}
              </span>
            </h3>
            {sub.gatilho && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 italic">{sub.gatilho}</p>
            )}
            <div className="space-y-2">
              {tarefasSub.length === 0 ? (
                <div className="text-xs text-gray-400 dark:text-gray-600 pl-2">Nenhuma tarefa.</div>
              ) : (
                tarefasSub.map(t => (
                  <TarefaCard
                    key={t.id}
                    tarefa={t}
                    projetos={projetos}
                    subprojetos={subprojetos}
                    onAbrir={() => onAbrir(t.id)}
                    autor={autor}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VIEW: Admin de Projetos (master) — CRUD inline ───────────────────────

function AdminView({ projetos, subprojetos, pessoaId }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  pessoaId: string;
}) {
  const [criandoProjeto, setCriandoProjeto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoSubId, setEditandoSubId] = useState<string | null>(null);
  const [criandoSubIn, setCriandoSubIn] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [pessoasMap, setPessoasMap] = useState<Record<string, string>>({});
  // Sub-tab interna do AdminView: "Projetos" (CRUD atual) vs "Automações"
  // (config de responsáveis padrão por módulo origem das tarefas auto).
  const [adminTab, setAdminTab] = useState<"projetos" | "automacoes">("projetos");
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const m: Record<string, string> = {};
      snap.docs.forEach(d => {
        const data = d.data() as { nome?: string };
        if (data.nome) m[d.id] = data.nome;
      });
      setPessoasMap(m);
    });
    return () => u();
  }, []);

  async function deletarProjeto(p: TarefaProjeto) {
    if (!confirm(`Excluir "${p.nome}"? Todos os subprojetos vão junto. Tarefas existentes não são afetadas (só perdem referência).`)) return;
    await salvarProjeto({
      ...p,
      deletadoEm: new Date().toISOString(),
      deletadoPor: pessoaId,
      atualizadoEm: new Date().toISOString(),
    });
  }
  async function deletarSub(s: TarefaSubprojeto) {
    // Subs bloqueados pra criação manual são "automáticos" — não dá pra
    // excluir, senão hooks de outros módulos quebram ao tentar criar tarefa
    // num sub que não existe.
    if (s.bloqueadoCriacaoManual) {
      alert(
        `Subprojeto "${s.nome}" não pode ser excluído porque está marcado como ` +
        `bloqueado pra criação manual (recebe tarefas de hooks automáticos). ` +
        `Pra excluir, primeiro desmarque o bloqueio no editor.`,
      );
      return;
    }
    if (!confirm(`Excluir subprojeto "${s.nome}"?`)) return;
    await salvarSubprojeto({
      ...s,
      deletadoEm: new Date().toISOString(),
      deletadoPor: pessoaId,
      atualizadoEm: new Date().toISOString(),
    });
  }

  return (
    <div>
      {/* Sub-tabs: separa CRUD de projetos da config de automações */}
      <div className="flex gap-1 mb-3 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setAdminTab("projetos")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            adminTab === "projetos"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          📁 Projetos
        </button>
        <button
          onClick={() => setAdminTab("automacoes")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            adminTab === "automacoes"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          🤖 Automações
        </button>
      </div>

      {adminTab === "automacoes" && (
        <AutomacoesTab pessoaId={pessoaId} />
      )}

      {adminTab === "projetos" && (
      <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 sm:flex-1 sm:pr-3">
          Configuração de projetos e subprojetos do gestor. Mexa com cuidado — afeta todas as tarefas.
        </p>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setImportando(true)}>📥 Importar CSV</Button>
          <Button size="sm" onClick={() => setCriandoProjeto(true)}>+ Novo Projeto</Button>
        </div>
      </div>
      {importando && (
        <ImportadorModal
          projetos={projetos}
          subprojetos={subprojetos}
          pessoaId={pessoaId}
          onClose={() => setImportando(false)}
        />
      )}

      {projetos.map(p => {
        const subs = subprojetos.filter(s => s.projetoId === p.id);
        // "Quem vê" — texto resumido
        const v = (p.visibilidade || "privado") as string;
        const isPrivado = v === "privado" || v.startsWith("grupo_"); // grupo_* legado = privado
        const isAberto = v === "escritorio" || v === "publico";
        const autorizados = (p.usuariosAutorizados || []);
        const nomesAutorizados = autorizados.map(id => pessoasMap[id]).filter(Boolean);

        return (
          <div key={p.id} className="mb-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: p.cor }}>
            <div className="p-3 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  {p.emoji} {p.nome}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {p.tipo} · {subs.length} subprojeto(s)
                </div>
                {/* Quem vê — destaque visual */}
                <div className="mt-1.5 flex items-start gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isPrivado
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      : isAberto
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  }`}>
                    {isPrivado ? "🔒 Privado" : isAberto ? "👥 Todo escritório" : v}
                  </span>
                  {isPrivado && (
                    nomesAutorizados.length === 0 ? (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                        só master vê — clique em Editar pra autorizar pessoas
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Vêem:</span> {nomesAutorizados.join(", ")} <span className="text-gray-400">+ master</span>
                      </span>
                    )
                  )}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditandoId(editandoId === p.id ? null : p.id)}>
                {editandoId === p.id ? "Fechar" : "Editar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => deletarProjeto(p)}>🗑️</Button>
            </div>

            {editandoId === p.id && (
              <ProjetoForm
                projeto={p}
                pessoaId={pessoaId}
                onClose={() => setEditandoId(null)}
              />
            )}

            <div className="px-3 pb-3 space-y-1">
              {subs.map(s => (
                <div key={s.id} className="text-sm border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-800 dark:text-gray-200">
                        ▸ {s.nome}
                        {s.auto && <span className="ml-2 text-[10px] text-green-700 dark:text-green-300 px-1 py-0.5 rounded bg-green-50 dark:bg-green-900/30">auto</span>}
                      </div>
                      {s.gatilho && <div className="text-[11px] italic text-gray-500 dark:text-gray-500 mt-0.5 ml-3">{s.gatilho}</div>}
                    </div>
                    <button onClick={() => setEditandoSubId(editandoSubId === s.id ? null : s.id)} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                      {editandoSubId === s.id ? "fechar" : "editar"}
                    </button>
                    {!s.bloqueadoCriacaoManual && (
                      <button onClick={() => deletarSub(s)} className="text-[11px] text-red-500 hover:underline">excluir</button>
                    )}
                  </div>
                  {editandoSubId === s.id && (
                    <SubprojetoForm
                      sub={s}
                      pessoaId={pessoaId}
                      projetos={projetos}
                      onClose={() => setEditandoSubId(null)}
                    />
                  )}
                </div>
              ))}

              {criandoSubIn === p.id ? (
                <SubprojetoForm
                  sub={null}
                  projetoId={p.id}
                  pessoaId={pessoaId}
                  projetos={projetos}
                  onClose={() => setCriandoSubIn(null)}
                />
              ) : (
                <button onClick={() => setCriandoSubIn(p.id)} className="mt-2 text-xs text-emerald-700 dark:text-emerald-300 hover:underline">
                  + adicionar subprojeto
                </button>
              )}
            </div>
          </div>
        );
      })}

      {criandoProjeto && (
        <ProjetoForm
          projeto={null}
          pessoaId={pessoaId}
          onClose={() => setCriandoProjeto(false)}
          isModal
        />
      )}
      </>
      )}
    </div>
  );
}

// ─── Aba "Automações" — config de tarefas auto por módulo origem ─────────

function AutomacoesTab({ pessoaId }: { pessoaId: string }) {
  const { activeId } = useRestaurant();
  const rid = activeId || "";
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
  const [automacoes, setAutomacoes] = useState<TarefaAutomacao[]>([]);
  const [salvandoMod, setSalvandoMod] = useState<string | null>(null);

  // Pessoas (pra picker)
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoas(list);
    });
    return () => u();
  }, []);

  // Automações do restaurante atual
  useEffect(() => {
    if (!rid) return;
    const u = ouvirAutomacoes(rid, setAutomacoes);
    return () => u();
  }, [rid]);

  async function salvar(moduloId: ModuloOrigemTarefa, patch: Partial<TarefaAutomacao>) {
    if (!rid) return;
    setSalvandoMod(moduloId);
    try {
      const atual = automacoes.find(a => a.moduloId === moduloId);
      const novo: TarefaAutomacao = {
        id: `${rid}_${moduloId}`,
        restaurantId: rid,
        moduloId,
        ...atual,
        ...patch,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: pessoaId,
      };
      await salvarAutomacao(novo);
      // Pergunta sobre propagação SÓ se há campos significativos preenchidos.
      const temConfig = !!novo.responsavelId || (novo.coResponsaveisIds?.length || 0) > 0 || (novo.observadoresIds?.length || 0) > 0;
      if (temConfig) {
        const ok = confirm(
          `Config salva. Deseja aplicar nas tarefas EM ABERTO (a fazer + em andamento) do módulo "${moduloId}" também?\n\n` +
          `Tarefas concluídas/canceladas não são afetadas.`,
        );
        if (ok) {
          const r = await propagarAutomacaoEmAbertas(novo, { id: pessoaId, nome: "Admin" });
          alert(`${r.afetadas} tarefa(s) atualizada(s).`);
        }
      }
    } catch (e) {
      alert("Erro ao salvar: " + String(e));
    } finally {
      setSalvandoMod(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Defina quem é o responsável padrão, co-responsáveis e observadores das tarefas
        que cada módulo gera automaticamente. Ao salvar, o sistema oferece propagar a
        mudança pras tarefas em aberto desse módulo (responsável: ex. trocar Ellen → outro
        quando ela sai).
      </p>
      <div className="space-y-2">
        {MODULOS_ORIGEM_TAREFA.map(modId => {
          const a = automacoes.find(x => x.moduloId === modId);
          return (
            <AutomacaoLinha
              key={modId}
              moduloId={modId}
              automacao={a}
              pessoas={pessoas}
              salvando={salvandoMod === modId}
              onSave={(patch) => salvar(modId, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AutomacaoLinha({ moduloId, automacao, pessoas, salvando, onSave }: {
  moduloId: ModuloOrigemTarefa;
  automacao?: TarefaAutomacao;
  pessoas: Array<{ id: string; nome: string }>;
  salvando: boolean;
  onSave: (patch: Partial<TarefaAutomacao>) => void;
}) {
  // Buffer local — pra salvar só quando o user clica "Salvar"
  const [respId, setRespId] = useState(automacao?.responsavelId || "");
  const [coIds, setCoIds] = useState<string[]>(automacao?.coResponsaveisIds || []);
  const [obsIds, setObsIds] = useState<string[]>(automacao?.observadoresIds || []);
  // Sincroniza buffer com server quando snapshot chega
  useEffect(() => {
    setRespId(automacao?.responsavelId || "");
    setCoIds(automacao?.coResponsaveisIds || []);
    setObsIds(automacao?.observadoresIds || []);
  }, [automacao?.responsavelId, automacao?.coResponsaveisIds, automacao?.observadoresIds]);

  const moduloLabel = TAREFA_ORIGEM_LABEL[moduloId];
  const respNome = pessoas.find(p => p.id === respId)?.nome;
  const coNomes = coIds.map(id => pessoas.find(p => p.id === id)?.nome).filter((n): n is string => !!n);
  const obsNomes = obsIds.map(id => pessoas.find(p => p.id === id)?.nome).filter((n): n is string => !!n);

  function salvar() {
    onSave({
      responsavelId: respId || undefined,
      responsavelNome: respNome,
      coResponsaveisIds: coIds.length ? coIds : undefined,
      coResponsaveisNomes: coIds.length ? coNomes : undefined,
      observadoresIds: obsIds.length ? obsIds : undefined,
      observadoresNomes: obsIds.length ? obsNomes : undefined,
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{moduloLabel}</h3>
        <Button size="sm" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1">
            Responsável
          </label>
          <select
            value={respId}
            onChange={(e) => setRespId(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">— nenhum (usa fallback do hook) —</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1">
            Co-responsáveis (podem editar)
          </label>
          <PessoasMultiPicker
            value={coIds}
            onChange={setCoIds}
            pessoas={pessoas}
            excluir={respId ? [respId] : []}
            placeholder="+ adicionar"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-1">
            Observadores (só acompanham)
          </label>
          <PessoasMultiPicker
            value={obsIds}
            onChange={setObsIds}
            pessoas={pessoas}
            excluir={[...(respId ? [respId] : []), ...coIds]}
            placeholder="+ adicionar"
          />
        </div>
      </div>
    </div>
  );
}

// Multi-picker simples: chips + select com opções restantes. Reusado em
// co-responsáveis e observadores.
function PessoasMultiPicker({ value, onChange, pessoas, excluir, placeholder }: {
  value: string[];
  onChange: (ids: string[]) => void;
  pessoas: Array<{ id: string; nome: string }>;
  excluir?: string[];
  placeholder?: string;
}) {
  const excluirSet = new Set([...(excluir || []), ...value]);
  const disponiveis = pessoas.filter(p => !excluirSet.has(p.id));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {value.map(id => {
          const p = pessoas.find(x => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[11px]">
              {p?.nome || id}
              <button onClick={() => onChange(value.filter(v => v !== id))} className="hover:text-rose-600">×</button>
            </span>
          );
        })}
      </div>
      {disponiveis.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
          /* h-[38px] alinha com inputs/selects do mesmo form (NovaTarefaModal,
             Automações). Box-sizing border-box vem do Tailwind reset. */
          className="w-full h-[38px] px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        >
          <option value="">{placeholder || "+ adicionar"}</option>
          {disponiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

function ProjetoForm({ projeto, pessoaId, onClose, isModal }: {
  projeto: TarefaProjeto | null;
  pessoaId: string;
  onClose: () => void;
  isModal?: boolean;
}) {
  const [f, setF] = useState<Partial<TarefaProjeto>>(projeto ? { ...projeto } : {
    nome: "",
    emoji: "📁",
    cor: "#6366f1",
    dono: pessoaId,
    visibilidade: "privado",
    tipo: "demanda",
    ordem: 99,
    ativo: true,
  });
  const [pessoasLista, setPessoasLista] = useState<Array<{ id: string; nome: string }>>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoasLista(list);
    });
    return () => u();
  }, []);

  async function salvar() {
    if (!f.nome) { alert("Nome obrigatório"); return; }
    const now = new Date().toISOString();
    const id = projeto?.id || `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data: TarefaProjeto = {
      id,
      nome: f.nome,
      emoji: f.emoji,
      cor: f.cor || "#6366f1",
      dono: f.dono || pessoaId,
      donoNome: f.donoNome,
      visibilidade: f.visibilidade || "escritorio",
      usuariosAutorizados: f.usuariosAutorizados,
      tipo: f.tipo || "demanda",
      ordem: f.ordem ?? 99,
      ativo: f.ativo ?? true,
      deletadoEm: f.deletadoEm,
      deletadoPor: f.deletadoPor,
      criadoEm: projeto?.criadoEm || now,
      criadoPor: projeto?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await salvarProjeto(data);
    onClose();
  }

  const body = (
    <div className={`${isModal ? "p-5" : "p-3 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800"} space-y-2`}>
      {isModal && <h3 className="font-bold mb-2 text-gray-900 dark:text-gray-100">Novo Projeto</h3>}
      <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
        <input value={f.emoji || ""} onChange={(e) => setF({ ...f, emoji: e.target.value })} placeholder="📁" className="adm-input text-center" maxLength={3} />
        <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome do projeto" className="adm-input" />
      </div>
      <div className="grid grid-cols-[100px_1fr_1fr_1fr] gap-2 text-xs">
        <input type="color" value={f.cor || "#6366f1"} onChange={(e) => setF({ ...f, cor: e.target.value })} className="adm-input p-0.5 h-7" />
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "rotina" | "demanda" | "misto" })} className="adm-input">
          <option value="rotina">Rotina</option><option value="demanda">Demanda</option><option value="misto">Misto</option>
        </select>
        <select value={f.visibilidade} onChange={(e) => setF({ ...f, visibilidade: e.target.value as TarefaVisibilidade })} className="adm-input">
          {(Object.keys(TAREFA_VISIBILIDADE_LABEL) as TarefaVisibilidade[]).map(v => (
            <option key={v} value={v}>{TAREFA_VISIBILIDADE_LABEL[v]}</option>
          ))}
        </select>
        <input type="number" value={f.ordem ?? 99} onChange={(e) => setF({ ...f, ordem: parseInt(e.target.value) || 99 })} placeholder="ordem" className="adm-input" />
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Pessoas autorizadas no projeto inteiro (acesso explícito):</div>
      <UsuariosAutorizadosPicker
        ids={f.usuariosAutorizados || []}
        pessoas={pessoasLista}
        onChange={(ids) => setF({ ...f, usuariosAutorizados: ids.length ? ids : undefined })}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={salvar}>{projeto ? "Salvar" : "Criar"}</Button>
      </div>
      <style>{`.adm-input { width: 100%; padding: 4px 8px; border: 1px solid rgb(209 213 219); border-radius: 6px; background: white; font-size: 12px; } .dark .adm-input { background: rgb(31 41 55); border-color: rgb(55 65 81); color: white; }`}</style>
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>{body}</div>
      </div>
    );
  }
  return body;
}

function SubprojetoForm({ sub, projetoId, pessoaId, projetos, onClose }: {
  sub: TarefaSubprojeto | null;
  projetoId?: string;
  pessoaId: string;
  // Lista de projetos pro select "Mover pra outro projeto" (só relevante
  // quando estamos editando um sub existente).
  projetos: TarefaProjeto[];
  onClose: () => void;
}) {
  // Lista de restaurantes pra select de "Restaurante origem fixo".
  const { restaurants } = useRestaurant();
  const [f, setF] = useState<Partial<TarefaSubprojeto>>(sub ? { ...sub } : {
    projetoId: projetoId || "",
    nome: "",
    auto: false,
    ordem: 99,
    ativo: true,
    recorrenciaTipo: "nenhuma",
  });
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string; isMaster?: boolean }>>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean; isMaster?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string, isMaster: !!p.isMaster }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoas(list);
    });
    return () => u();
  }, []);

  // Filtra pessoas elegíveis pra responsável padrão deste subprojeto baseado
  // na visibilidade do PROJETO pai. Não faz sentido oferecer pessoas que
  // nem veem o projeto. Master sempre passa (vê tudo).
  const projetoPai = projetos.find(p => p.id === f.projetoId);
  const pessoasElegiveis = useMemo(() => {
    if (!projetoPai) return pessoas;
    const vis = projetoPai.visibilidade || "privado";
    if (vis === "publico" || vis === "escritorio") return pessoas;
    // Privado: só master + dono + usuariosAutorizados
    const autorizados = new Set<string>([
      projetoPai.dono,
      ...(projetoPai.usuariosAutorizados || []),
    ]);
    return pessoas.filter(p => p.isMaster || autorizados.has(p.id));
  }, [pessoas, projetoPai]);

  function addTemplate() {
    setF({ ...f, tarefasTemplate: [...(f.tarefasTemplate || []), { titulo: "", prazoOffset: "D+0" }] });
  }
  function addCustomField() {
    const novo: TarefaCustomField = {
      id: Math.random().toString(36).slice(2, 11),
      nome: "",
      tipo: "texto",
      ordem: (f.customFieldsDef?.length || 0) + 1,
    };
    setF({ ...f, customFieldsDef: [...(f.customFieldsDef || []), novo] });
  }
  function editCustomField(i: number, patch: Partial<TarefaCustomField>) {
    const arr = [...(f.customFieldsDef || [])];
    arr[i] = { ...arr[i], ...patch };
    setF({ ...f, customFieldsDef: arr });
  }
  function removeCustomField(i: number) {
    const arr = [...(f.customFieldsDef || [])];
    arr.splice(i, 1);
    setF({ ...f, customFieldsDef: arr });
  }
  function editTemplate(i: number, patch: Partial<TarefaTemplate>) {
    const arr = [...(f.tarefasTemplate || [])];
    arr[i] = { ...arr[i], ...patch };
    setF({ ...f, tarefasTemplate: arr });
  }
  function removeTemplate(i: number) {
    const arr = [...(f.tarefasTemplate || [])];
    arr.splice(i, 1);
    setF({ ...f, tarefasTemplate: arr });
  }
  function moveTemplate(i: number, delta: -1 | 1) {
    const arr = [...(f.tarefasTemplate || [])];
    const j = i + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setF({ ...f, tarefasTemplate: arr });
  }

  async function salvar() {
    if (!f.nome) { alert("Nome obrigatório"); return; }
    const now = new Date().toISOString();
    const id = sub?.id || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const respNome = f.responsavelPadraoId
      ? pessoas.find(p => p.id === f.responsavelPadraoId)?.nome
      : undefined;
    const projetoIdFinal = f.projetoId || projetoId || "";

    // Caso especial: editou um subprojeto existente e mudou o projeto pai.
    // Precisamos cascatear pras tarefas que apontam pra ele (projetoId +
    // corHerdada). Mostra contagem antes de confirmar.
    if (sub && sub.projetoId && projetoIdFinal !== sub.projetoId) {
      const n = await contarTarefasDoSubprojeto(sub.id);
      const projDe = projetos.find(p => p.id === sub.projetoId)?.nome || sub.projetoId;
      const projPra = projetos.find(p => p.id === projetoIdFinal)?.nome || projetoIdFinal;
      const aviso = n > 0
        ? `Mover subprojeto "${sub.nome}" de "${projDe}" pra "${projPra}"?\n\n${n} tarefa(s) existente(s) vão acompanhar (projeto pai e cor do card atualizam).`
        : `Mover subprojeto "${sub.nome}" de "${projDe}" pra "${projPra}"?\n\nNão há tarefas existentes — só o subprojeto muda.`;
      if (!confirm(aviso)) return;
      const novoProj = projetos.find(p => p.id === projetoIdFinal);
      // Move o subprojeto + cascateia nas tarefas, depois grava os outros
      // campos editados do form via salvarSubprojeto normal.
      await moverSubprojetoParaProjeto(sub, projetoIdFinal, novoProj?.cor, pessoaId);
    }

    const data: TarefaSubprojeto = {
      id,
      projetoId: projetoIdFinal,
      nome: f.nome,
      descricao: f.descricao,
      auto: f.auto ?? false,
      bloqueadoCriacaoManual: f.bloqueadoCriacaoManual ?? false,
      gatilho: f.gatilho,
      moduloOrigemRota: f.moduloOrigemRota,
      moduloOrigemLabel: f.moduloOrigemLabel,
      moduloOrigemRestaurantId: f.moduloOrigemRestaurantId,
      campos: f.campos,
      pastaDriveTemplate: f.pastaDriveTemplate,
      tarefasTemplate: (f.tarefasTemplate || []).filter(t => t.titulo.trim()),
      customFieldsDef: (f.customFieldsDef || []).filter(c => c.nome.trim()),
      responsavelPadraoId: f.responsavelPadraoId,
      responsavelPadraoNome: respNome || f.responsavelPadraoNome,
      recorrenciaTipo: f.recorrenciaTipo,
      recorrenciaDia: f.recorrenciaDia,
      recorrenciaMes: f.recorrenciaMes,
      ordem: f.ordem ?? 99,
      ativo: f.ativo ?? true,
      deletadoEm: f.deletadoEm,
      deletadoPor: f.deletadoPor,
      criadoEm: sub?.criadoEm || now,
      criadoPor: sub?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await salvarSubprojeto(data);
    onClose();
  }

  const rec = f.recorrenciaTipo || "nenhuma";

  return (
    <div className="p-2 mt-1 bg-gray-50 dark:bg-gray-800/40 rounded-md space-y-1.5">
      <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome do subprojeto" className="adm-input" />

      {/* Select de "Projeto pai" — só faz sentido ao editar subprojeto
          existente, pra permitir movê-lo entre projetos. */}
      {sub && (
        <div className="text-xs">
          <label className="block text-gray-600 dark:text-gray-400 mb-0.5">
            Projeto pai
            {f.projetoId !== sub.projetoId && (
              <span className="ml-1 text-amber-700 dark:text-amber-400 font-medium">
                · alteração pendente — tarefas serão movidas junto ao salvar
              </span>
            )}
          </label>
          <select
            value={f.projetoId || ""}
            onChange={(e) => setF({ ...f, projetoId: e.target.value })}
            className="adm-input"
          >
            {projetos.map(p => (
              <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={f.auto || false} onChange={(e) => setF({ ...f, auto: e.target.checked })} />
          Automático (sistema gera)
        </label>
        <input type="number" value={f.ordem ?? 99} onChange={(e) => setF({ ...f, ordem: parseInt(e.target.value) || 99 })} placeholder="ordem" className="adm-input text-xs" />
      </div>
      {f.auto && (
        <input value={f.gatilho || ""} onChange={(e) => setF({ ...f, gatilho: e.target.value })} placeholder="Gatilho (ex: 'Nova admissão concluída')" className="adm-input text-xs" />
      )}
      <div className="px-2 py-1.5 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={f.bloqueadoCriacaoManual || false}
            onChange={(e) => setF({ ...f, bloqueadoCriacaoManual: e.target.checked })}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="font-medium text-amber-900 dark:text-amber-200">🔒 Bloquear criação manual</div>
            <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
              Quando ativo, esse sub não aceita "+ Nova tarefa" no app — só recebe
              tarefas geradas por hooks de outros módulos (Admissão, Exames, etc).
              Bloqueado também não pode ser excluído.
            </div>
          </div>
        </label>
        {/* Quando bloqueado, o admin escolhe o módulo de origem das tarefas.
            Rota e label do CTA do banner são derivados automaticamente do
            MODULES registry. Pra rota custom, edita direto no Firestore. */}
        {f.bloqueadoCriacaoManual && (() => {
          // Match: o sub aponta pra esse módulo se a rota guardada bate com
          // "/{moduleId}". Funciona pra dados antigos digitados à mão também.
          const moduloAtualId = (f.moduloOrigemRota || "").replace(/^\//, "");
          const opcoesModulos = MODULES
            .filter(m => !m.oculto && m.status === "ativo")
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            <div className="pl-6">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-amber-800 dark:text-amber-300 mb-0.5">
                Módulo origem das tarefas
              </label>
              <select
                value={moduloAtualId}
                onChange={(e) => {
                  const id = e.target.value;
                  const mod = MODULES.find(m => m.id === id);
                  setF({
                    ...f,
                    moduloOrigemRota: id ? `/${id}` : undefined,
                    moduloOrigemLabel: mod ? `Ir pra ${mod.label}` : undefined,
                  });
                }}
                className="adm-input text-xs"
              >
                <option value="">— selecione —</option>
                {opcoesModulos.map(m => (
                  <option key={m.id} value={m.id}>{m.icon} {m.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-1">
                O banner do sub vai mostrar um botão "Ir pra {MODULES.find(m => m.id === moduloAtualId)?.label || "Módulo"}".
              </p>

              <label className="block text-[10px] uppercase tracking-wider font-bold text-amber-800 dark:text-amber-300 mt-2 mb-0.5">
                Restaurante origem (opcional)
              </label>
              <select
                value={f.moduloOrigemRestaurantId || ""}
                onChange={(e) => setF({ ...f, moduloOrigemRestaurantId: e.target.value || undefined })}
                className="adm-input text-xs"
              >
                <option value="">— Restaurante selecionado no modal —</option>
                {restaurants.map(r => (
                  <option key={r.id} value={r.id}>{r.nome}</option>
                ))}
              </select>
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-1">
                {f.moduloOrigemRestaurantId
                  ? `🔒 Link trava em "${restaurants.find(r => r.id === f.moduloOrigemRestaurantId)?.nome}". Use pra sub específico de uma unidade.`
                  : "Sem trava: ao clicar no botão do banner, abre um modal perguntando qual restaurante. Use pra sub compartilhado entre unidades."}
              </p>
            </div>
          );
        })()}
      </div>
      <input value={f.campos || ""} onChange={(e) => setF({ ...f, campos: e.target.value })} placeholder="Campos custom (legado, descritivo)" className="adm-input text-xs" />

      {/* Custom fields tipados */}
      <div className="text-xs">
        <div className="text-gray-600 dark:text-gray-400 mb-1 flex items-center justify-between">
          <span>Campos custom tipados (preenchidos por tarefa)</span>
          <button onClick={addCustomField} className="text-emerald-700 dark:text-emerald-300 hover:underline">+ adicionar</button>
        </div>
        {(f.customFieldsDef || []).map((c, i) => (
          <div key={c.id} className="flex items-center gap-1 mb-1 group">
            <input
              value={c.nome}
              onChange={(e) => editCustomField(i, { nome: e.target.value })}
              placeholder="Nome do campo"
              className="adm-input flex-1"
            />
            <select
              value={c.tipo}
              onChange={(e) => editCustomField(i, { tipo: e.target.value as TarefaCustomFieldTipo })}
              className="adm-input w-24"
            >
              {(Object.keys(TAREFA_CUSTOM_FIELD_TIPO_LABEL) as TarefaCustomFieldTipo[]).map(t =>
                <option key={t} value={t}>{TAREFA_CUSTOM_FIELD_TIPO_LABEL[t]}</option>
              )}
            </select>
            {c.tipo === "select" && (
              <input
                value={(c.opcoes || []).join("|")}
                onChange={(e) => editCustomField(i, { opcoes: e.target.value.split("|").map(x => x.trim()).filter(Boolean) })}
                placeholder="opções separadas por |"
                className="adm-input w-32"
              />
            )}
            <label className="flex items-center gap-1 text-[10px]" title="Obrigatório">
              <input type="checkbox" checked={c.obrigatorio || false} onChange={(e) => editCustomField(i, { obrigatorio: e.target.checked })} />
              obr
            </label>
            <button onClick={() => removeCustomField(i)} className="px-1 text-xs text-red-500 hover:text-red-700">×</button>
          </div>
        ))}
      </div>

      {/* Responsável padrão */}
      <label className="block text-xs">
        <div className="text-gray-600 dark:text-gray-400 mb-1">Responsável padrão (pra novas tarefas deste subprojeto)</div>
        <select
          value={f.responsavelPadraoId || ""}
          onChange={(e) => setF({ ...f, responsavelPadraoId: e.target.value || undefined })}
          className="adm-input"
        >
          <option value="">— criador da tarefa (default) —</option>
          {pessoasElegiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>

      {/* Observadores padrão — adicionam-se sempre que uma tarefa nasce
          neste subprojeto. Filtrado pela visibilidade do projeto pai. */}
      <div className="block text-xs">
        <div className="text-gray-600 dark:text-gray-400 mb-1">
          Observadores padrão (recebem notificações de toda tarefa nova deste subprojeto)
        </div>
        <PessoasMultiPicker
          value={f.observadoresPadraoIds || []}
          onChange={(ids) => setF({ ...f, observadoresPadraoIds: ids.length > 0 ? ids : undefined })}
          pessoas={pessoasElegiveis}
          excluir={f.responsavelPadraoId ? [f.responsavelPadraoId] : []}
          placeholder="adicionar observador padrão"
        />
      </div>

      {/* Recorrência */}
      <label className="block text-xs">
        <div className="text-gray-600 dark:text-gray-400 mb-1">Recorrência (rotinas — ao concluir, gera próxima)</div>
        <select
          value={rec}
          onChange={(e) => setF({ ...f, recorrenciaTipo: e.target.value as TarefaSubprojeto["recorrenciaTipo"] })}
          className="adm-input"
        >
          {(Object.keys(RECORRENCIA_TIPO_LABEL) as Array<NonNullable<TarefaSubprojeto["recorrenciaTipo"]>>).map(t =>
            <option key={t} value={t}>{RECORRENCIA_TIPO_LABEL[t]}</option>
          )}
        </select>
      </label>
      {(rec === "mensal" || rec === "anual" || rec === "trimestral" || rec === "semestral") && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            <div className="text-gray-600 dark:text-gray-400 mb-1">Dia do mês</div>
            <input type="number" min="1" max="31" value={f.recorrenciaDia ?? ""} onChange={(e) => setF({ ...f, recorrenciaDia: parseInt(e.target.value) || undefined })} className="adm-input" />
          </label>
          {rec !== "mensal" && (
            <label>
              <div className="text-gray-600 dark:text-gray-400 mb-1">Mês (1-12)</div>
              <input type="number" min="1" max="12" value={f.recorrenciaMes ?? ""} onChange={(e) => setF({ ...f, recorrenciaMes: parseInt(e.target.value) || undefined })} className="adm-input" />
            </label>
          )}
        </div>
      )}
      {rec === "semanal" && (
        <label className="block text-xs">
          <div className="text-gray-600 dark:text-gray-400 mb-1">Dia da semana</div>
          <select value={f.recorrenciaDia ?? 1} onChange={(e) => setF({ ...f, recorrenciaDia: parseInt(e.target.value) })} className="adm-input">
            <option value="0">Domingo</option><option value="1">Segunda</option><option value="2">Terça</option>
            <option value="3">Quarta</option><option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option>
          </select>
        </label>
      )}

      {/* Templates de tarefas-filha (checklist) */}
      <div className="text-xs">
        <div className="text-gray-600 dark:text-gray-400 mb-1 flex items-center justify-between">
          <span>Templates de subtarefas (checklist da tarefa-pai)</span>
          <button onClick={addTemplate} className="text-emerald-700 dark:text-emerald-300 hover:underline">+ adicionar</button>
        </div>
        {(f.tarefasTemplate || []).map((t, i) => (
          <div key={i} className="flex items-center gap-1 mb-1 group">
            <input
              value={t.titulo}
              onChange={(e) => editTemplate(i, { titulo: e.target.value })}
              placeholder="Título da subtarefa"
              className="adm-input flex-1"
            />
            <input
              value={t.prazoOffset || ""}
              onChange={(e) => editTemplate(i, { prazoOffset: e.target.value })}
              placeholder="D+5 / dia 20"
              className="adm-input w-20"
              title="Offset de prazo relativo (texto livre)"
            />
            <button onClick={() => moveTemplate(i, -1)} disabled={i === 0} className="px-1 text-xs disabled:opacity-30 hover:text-indigo-600">▲</button>
            <button onClick={() => moveTemplate(i, 1)} disabled={i === (f.tarefasTemplate?.length ?? 0) - 1} className="px-1 text-xs disabled:opacity-30 hover:text-indigo-600">▼</button>
            <button onClick={() => removeTemplate(i)} className="px-1 text-xs text-red-500 hover:text-red-700">×</button>
          </div>
        ))}
        {(!f.tarefasTemplate || f.tarefasTemplate.length === 0) && (
          <div className="text-[11px] text-gray-400 italic">Sem templates. Adicione pra criar tarefas-pai com checklist pré-definido.</div>
        )}
      </div>

      <div className="flex justify-end gap-1 pt-1">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={salvar}>{sub ? "Salvar" : "Criar"}</Button>
      </div>
    </div>
  );
}

// ─── VIEW: Kanban ──────────────────────────────────────────────────────────

function KanbanView({ tarefas, projetos, autor, onAbrir }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  autor: { id: string; nome: string };
  onAbrir: (id: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const cols: TarefaStatus[] = ["a_fazer", "em_andamento", "concluida", "cancelada"];

  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  async function onDrop(e: React.DragEvent, col: TarefaStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (!id) return;
    await mudarStatusComErro(id, col, autor);
  }

  if (tarefas.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Nenhuma tarefa pra você ainda.</div>;
  }

  return (
    <div className="md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-3 flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
      {cols.map(col => {
        const items = tarefas.filter(t => t.status === col);
        return (
          <div
            key={col}
            className="rounded-xl bg-gray-50 dark:bg-gray-800/40 p-2 min-h-[200px] flex-shrink-0 w-72 md:w-auto"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, col)}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                {TAREFA_STATUS_LABEL[col]}
              </h3>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map(t => {
                const proj = projetos.find(p => p.id === t.projetoId);
                const cor = t.corHerdada || proj?.cor || "#6b7280";
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.id)}
                    onClick={() => onAbrir(t.id)}
                    className="p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-md transition-shadow"
                    style={{ borderLeftWidth: 3, borderLeftColor: cor }}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">{t.titulo}</div>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                      {proj && <span style={{ color: cor }}>{proj.emoji}</span>}
                      {t.prazo && <span>📅 {fmtBR(t.prazo)}</span>}
                      {(t.subtarefas?.length ?? 0) > 0 && <span>☑️ {t.subtarefas?.filter(s => s.feito).length}/{t.subtarefas?.length}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VIEW: Calendário (semana) ─────────────────────────────────────────────

function inicioSemanaSeg(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T12:00:00");
  const dow = d.getDay(); // 0=Dom..6=Sab
  const offset = dow === 0 ? -6 : 1 - dow; // shift pra segunda
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Badge objetivo por TIPO de tarefa (origem) — label curto + cor + ícone.
// Manual/sem origem cai no projeto (nome + cor + emoji).
const TAREFA_CAT_META: Record<string, { label: string; cor: string; icon: string }> = {
  conta_fixa:       { label: "Conta",       cor: "#10b981", icon: "💵" },
  manutencao:       { label: "Técnico",     cor: "#f59e0b", icon: "🛠️" },
  admissao:         { label: "Trabalhista", cor: "#8b5cf6", icon: "🧑‍⚖️" },
  demissao:         { label: "Demissão",    cor: "#ef4444", icon: "👋" },
  ferias:           { label: "Férias",      cor: "#0ea5e9", icon: "🏖️" },
  reuniao:          { label: "Reunião",     cor: "#6366f1", icon: "🗣️" },
  evento:           { label: "Evento",      cor: "#ec4899", icon: "🎉" },
  recorrencia:      { label: "Rotina",      cor: "#14b8a6", icon: "🔁" },
  lote_financeiro:  { label: "Financeiro",  cor: "#22c55e", icon: "📦" },
  portal_empregado: { label: "Portal",      cor: "#64748b", icon: "📲" },
};
function catDaTarefa(origem: string, proj?: { nome?: string; cor?: string; emoji?: string }): { label: string; cor: string; icon: string } {
  return TAREFA_CAT_META[origem] || { label: proj?.nome || "Tarefa", cor: proj?.cor || "#6b7280", icon: proj?.emoji || "📁" };
}

function CalendarioView({ tarefas, projetos, onAbrir, autor, onNovaTarefaNoDia }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  subprojetos?: TarefaSubprojeto[];
  onAbrir: (id: string) => void;
  autor?: { id: string; nome: string };
  // Quando chamado com `prazo`, vai pra aquele dia; sem args, cria sem data.
  onNovaTarefaNoDia?: (prazo?: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [semanaInicio, setSemanaInicio] = useState<string>(() => inicioSemanaSeg(hoje));
  const [expandirFds, setExpandirFds] = useState<boolean>(() => {
    try { return localStorage.getItem("tarefas_calendario_fds") === "1"; } catch { return false; }
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropAntes, setDropAntes] = useState<string | null>(null); // reordenar: soltar ANTES deste card
  const [feriados, setFeriados] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { buscarFeriadosProximos } = await import("../sites/feriadosHelper");
        const listas = await Promise.all([buscarFeriadosProximos("SP", 14).catch(() => []), buscarFeriadosProximos("PA", 14).catch(() => [])]);
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const f of listas.flat()) map[f.date] = f.name;
        setFeriados(map);
      } catch { /* sem feriados */ }
    })();
    return () => { alive = false; };
  }, []);

  const podeArrastar = !!autor?.id;

  async function moverParaData(id: string, novaData: string) {
    if (!autor) return;
    // Otimista: snapshot atualiza. Não mostro spinner — só falha avisa.
    try {
      await atualizarTarefa(id, { prazo: novaData }, autor, {
        acao: "editada",
        campo: "prazo",
        valorDepois: novaData,
      });
    } catch (e) {
      console.error("[tarefas] falha ao mover:", e);
      alert("Falha ao mover tarefa: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  // Reordena dentro de um dia (arrasto vertical): insere a tarefa arrastada
  // antes de `antesDeId` (ou no fim se null) e regrava ordemDia de todo o dia.
  async function reordenarNoDia(id: string, dia: string, antesDeId: string | null) {
    if (!autor) return;
    const dragged = tarefas.find(t => t.id === id);
    if (!dragged) return;
    const atual = (tarefasPorDia.get(dia) || []).filter(t => t.id !== id);
    const idx = antesDeId ? atual.findIndex(t => t.id === antesDeId) : atual.length;
    const nova = idx < 0 ? [...atual, dragged] : [...atual.slice(0, idx), dragged, ...atual.slice(idx)];
    try {
      const batch = writeBatch(db);
      nova.forEach((t, i) => {
        const patch: Partial<Tarefa> = { ordemDia: i };
        if (t.id === id && t.prazo !== dia) patch.prazo = dia; // mudou de dia + posição
        batch.update(doc(db, "tarefas", t.id), patch);
      });
      await batch.commit();
    } catch (e) {
      console.error("[tarefas] falha ao reordenar:", e);
      alert("Falha ao reordenar: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  useEffect(() => {
    try { localStorage.setItem("tarefas_calendario_fds", expandirFds ? "1" : "0"); } catch {}
  }, [expandirFds]);

  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanaInicio + "T12:00:00");
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const labelsDoW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  const tarefasPorDia = new Map<string, Tarefa[]>();
  tarefas.forEach(t => {
    if (!t.prazo || !dias.includes(t.prazo)) return;
    const arr = tarefasPorDia.get(t.prazo) || [];
    arr.push(t);
    tarefasPorDia.set(t.prazo, arr);
  });
  // Ordena cada dia pela ordem manual (arrasto vertical); sem ordem = por título.
  tarefasPorDia.forEach(arr => arr.sort((a, b) =>
    (a.ordemDia ?? 1e9) - (b.ordemDia ?? 1e9) || (a.titulo || "").localeCompare(b.titulo || "")
  ));

  const semProprio = tarefas.filter(t => !t.prazo);
  const atrasadas = tarefas.filter(t =>
    t.prazo && t.prazo < hoje && t.status !== "concluida" && t.status !== "cancelada"
  );
  const totalSemana = dias.reduce((acc, d) => acc + (tarefasPorDia.get(d)?.length || 0), 0);

  function navegarSemanas(delta: number) {
    const d = new Date(semanaInicio + "T12:00:00");
    d.setDate(d.getDate() + delta * 7);
    setSemanaInicio(d.toISOString().slice(0, 10));
  }

  function fmtDia(yyyymmdd: string, comAno = false): string {
    const d = new Date(yyyymmdd + "T12:00:00");
    return d.toLocaleDateString("pt-BR", comAno
      ? { day: "2-digit", month: "short", year: "numeric" }
      : { day: "2-digit", month: "short" });
  }

  const titulo = `${fmtDia(dias[0])} — ${fmtDia(dias[6], true)}`;

  // Conta tarefas ATIVAS do fim de semana, pra decidir se colapsado vale a pena
  const fdsAtivos = ["sab", "dom"]; void fdsAtivos;
  const tarefasFds = [...(tarefasPorDia.get(dias[5]) || []), ...(tarefasPorDia.get(dias[6]) || [])];
  const tarefasFdsAtivas = tarefasFds.filter(t => t.status !== "concluida" && t.status !== "cancelada");

  function renderDia(data: string, label: string, dia: number) {
    const ehHoje = data === hoje;
    const ehFds = dia >= 5;
    const feriadoNome = feriados[data];
    const naoUtil = ehFds || !!feriadoNome;
    const lista = tarefasPorDia.get(data) || [];
    const ehAlvo = dropTarget === data;
    return (
      <div
        key={data}
        onDragOver={podeArrastar ? (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTarget !== data) setDropTarget(data);
        } : undefined}
        onDragLeave={podeArrastar ? () => {
          if (dropTarget === data) setDropTarget(null);
        } : undefined}
        onDrop={podeArrastar ? (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          setDropTarget(null);
          setDraggingId(null);
          if (id) reordenarNoDia(id, data, null);
        } : undefined}
        title={feriadoNome ? `Feriado: ${feriadoNome}` : undefined}
        className={`flex flex-col min-h-[200px] rounded-lg border p-2 transition-colors ${ehHoje ? "ring-1 ring-indigo-400" : ""} ${
          ehAlvo
            ? "border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700 bg-indigo-50 dark:bg-indigo-900/30"
            : naoUtil
              ? "border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/15"
              : "border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/15"
        }`}
      >
        <div className={`flex items-baseline justify-between mb-1.5 pb-1.5 border-b ${ehHoje ? "border-indigo-300 dark:border-indigo-800" : naoUtil ? "border-amber-200 dark:border-amber-900/40" : "border-blue-200 dark:border-blue-900/40"}`}>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${ehHoje ? "text-indigo-600 dark:text-indigo-400" : naoUtil ? "text-amber-700 dark:text-amber-400" : "text-blue-700 dark:text-blue-400"}`}>{label}</div>
            <div className={`text-base font-bold ${ehHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100"}`}>
              {Number(data.slice(8, 10))}
              <span className="ml-1 text-[10px] font-normal text-gray-500 dark:text-gray-400">{data.slice(5, 7)}</span>
            </div>
            {feriadoNome && <div className="text-[9px] text-amber-600 dark:text-amber-400 truncate max-w-[90px]" title={feriadoNome}>🎉 {feriadoNome}</div>}
          </div>
          {lista.length > 0 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{lista.length}</span>
          )}
        </div>
        <div className="space-y-1 flex-1 overflow-y-auto">
          {lista.map(t => {
            const proj = projetos.find(p => p.id === t.projetoId);
            const meta = catDaTarefa(t.origem, proj);
            const concluida = t.status === "concluida";
            const arrastando = draggingId === t.id;
            return (
              <button
                key={t.id}
                draggable={podeArrastar}
                onDragStart={podeArrastar ? (e) => {
                  e.dataTransfer.setData("text/plain", t.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(t.id);
                } : undefined}
                onDragEnd={podeArrastar ? () => {
                  setDraggingId(null);
                  setDropTarget(null);
                  setDropAntes(null);
                } : undefined}
                onDragOver={podeArrastar ? (e) => {
                  e.preventDefault(); e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (draggingId !== t.id && dropAntes !== t.id) setDropAntes(t.id);
                } : undefined}
                onDragLeave={podeArrastar ? () => { if (dropAntes === t.id) setDropAntes(null); } : undefined}
                onDrop={podeArrastar ? (e) => {
                  e.preventDefault(); e.stopPropagation();
                  const id = e.dataTransfer.getData("text/plain");
                  setDropAntes(null); setDropTarget(null); setDraggingId(null);
                  if (id && id !== t.id) reordenarNoDia(id, data, t.id);
                } : undefined}
                onClick={() => onAbrir(t.id)}
                className={`w-full text-left text-[11px] px-2 py-1.5 rounded-md text-gray-800 dark:text-gray-100 hover:shadow-sm transition-shadow ${concluida ? "line-through opacity-60" : ""} ${arrastando ? "opacity-40" : ""} ${dropAntes === t.id ? "ring-2 ring-indigo-400 ring-offset-1" : ""} ${podeArrastar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ background: meta.cor + "14", borderLeft: `3px solid ${meta.cor}` }}
                title={podeArrastar ? `${t.titulo} (arrastar pra mover)` : t.titulo}
              >
                <div className="font-medium leading-snug line-clamp-2 mb-1">{t.titulo}</div>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[8px] font-bold uppercase tracking-wide text-white" style={{ background: meta.cor }}>
                  {meta.icon} {meta.label}
                </span>
              </button>
            );
          })}
          {onNovaTarefaNoDia && (
            <button
              onClick={() => onNovaTarefaNoDia(data)}
              className="w-full text-left text-[11px] px-1.5 py-1 rounded border border-dashed border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:border-rose-500 transition-colors"
              title={`+ nova tarefa em ${label} ${Number(data.slice(8, 10))}`}
            >
              + Nova tarefa
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar do calendário: nav semana + chip "Sem data (X)".
          Criação avulsa fica no botão "+ Nova Tarefa" do header global;
          criação por dia fica no botão tracejado dentro de cada coluna. */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => navegarSemanas(-1)}>‹</Button>
          <Button size="sm" variant="ghost" onClick={() => setSemanaInicio(inicioSemanaSeg(hoje))}>Hoje</Button>
          <Button size="sm" variant="ghost" onClick={() => navegarSemanas(1)}>›</Button>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 ml-2">
            {titulo}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {semProprio.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
              📭 Sem data ({semProprio.length})
            </span>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={expandirFds}
              onChange={(e) => setExpandirFds(e.target.checked)}
              className="accent-indigo-600"
            />
            Expandir fim de semana
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400">{totalSemana} tarefa(s)</span>
        </div>
      </div>

      {/* Grid de dias — 5 (úteis) + 2 ou +1 (fds colapsado) */}
      <div className={`grid gap-2 ${expandirFds ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-7" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-6"}`}>
        {dias.slice(0, 5).map((d, i) => renderDia(d, labelsDoW[i], i))}
        {expandirFds ? (
          dias.slice(5, 7).map((d, i) => renderDia(d, labelsDoW[5 + i], 5 + i))
        ) : (
          <button
            onClick={() => setExpandirFds(true)}
            onDragOver={podeArrastar ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== "fds") setDropTarget("fds");
            } : undefined}
            onDragLeave={podeArrastar ? () => {
              if (dropTarget === "fds") setDropTarget(null);
            } : undefined}
            onDrop={podeArrastar ? (e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              setDropTarget(null);
              setDraggingId(null);
              if (id) {
                moverParaData(id, dias[5]); // sábado
                setExpandirFds(true);
              }
            } : undefined}
            className={`flex flex-col min-h-[200px] rounded-lg border border-dashed p-2 text-left transition-colors ${
              dropTarget === "fds"
                ? "border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700 bg-indigo-50 dark:bg-indigo-900/30"
                : "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 hover:border-gray-400 dark:hover:border-gray-600"
            }`}
            title="Clique pra expandir sábado e domingo"
          >
            <div className="flex items-baseline justify-between mb-1.5 pb-1.5 border-b border-gray-200 dark:border-gray-800">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Sáb · Dom</div>
                <div className="text-base font-bold text-gray-700 dark:text-gray-300">
                  {Number(dias[5].slice(8, 10))}–{Number(dias[6].slice(8, 10))}
                </div>
              </div>
              {tarefasFds.length > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">{tarefasFds.length}</span>
              )}
            </div>
            <div className="space-y-1 flex-1 overflow-y-auto">
              {tarefasFdsAtivas.slice(0, 3).map(t => {
                const proj = projetos.find(p => p.id === t.projetoId);
                const cor = t.corHerdada || proj?.cor || "#6b7280";
                return (
                  <div
                    key={t.id}
                    className="text-[11px] px-1.5 py-1 rounded truncate"
                    style={{ background: cor + "26", color: cor, borderLeft: `2px solid ${cor}` }}
                    title={t.titulo}
                  >
                    {t.titulo}
                  </div>
                );
              })}
              {tarefasFdsAtivas.length > 3 && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400">+{tarefasFdsAtivas.length - 3}</div>
              )}
              {onNovaTarefaNoDia && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onNovaTarefaNoDia(dias[5]); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onNovaTarefaNoDia(dias[5]); } }}
                  className="block text-[11px] px-1.5 py-1 rounded border border-dashed border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:border-rose-500 transition-colors mt-1"
                >
                  + Nova tarefa
                </span>
              )}
              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 underline mt-1">Expandir →</div>
            </div>
          </button>
        )}
      </div>

      {/* Atrasadas */}
      {atrasadas.length > 0 && (
        <details className="mt-4" open>
          <summary className="text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">
            🔥 {atrasadas.length} atrasada(s)
          </summary>
          <div className="mt-2 space-y-1 text-sm">
            {atrasadas.slice(0, 20).map(t => {
              const proj = projetos.find(p => p.id === t.projetoId);
              const cor = t.corHerdada || proj?.cor || "#6b7280";
              return (
                <div key={t.id} onClick={() => onAbrir(t.id)} className="p-2 rounded-md bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-900/40 cursor-pointer hover:shadow-sm flex items-center gap-2" style={{ borderLeftWidth: 3, borderLeftColor: cor }}>
                  <span style={{ color: cor }}>{proj?.emoji}</span>
                  <span className="flex-1">{t.titulo}</span>
                  <span className="text-[10px] text-rose-600 dark:text-rose-400">{fmtBR(t.prazo)}</span>
                </div>
              );
            })}
            {atrasadas.length > 20 && (
              <div className="text-[10px] text-gray-500">+{atrasadas.length - 20} mais (use a lista)</div>
            )}
          </div>
        </details>
      )}

      {semProprio.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            {semProprio.length} tarefa(s) sem prazo
          </summary>
          <div className="mt-2 space-y-1 text-sm">
            {semProprio.map(t => {
              const proj = projetos.find(p => p.id === t.projetoId);
              const cor = t.corHerdada || proj?.cor || "#6b7280";
              return (
                <div key={t.id} onClick={() => onAbrir(t.id)} className="p-2 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 cursor-pointer hover:shadow-sm" style={{ borderLeftWidth: 3, borderLeftColor: cor }}>
                  <span style={{ color: cor }}>{proj?.emoji}</span> {t.titulo}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}


// ─── VIEW: Lixeira (master) ───────────────────────────────────────────────

function LixeiraView({ tarefas, projetos, autor }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  autor: { id: string; nome: string };
}) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const todasMarcadas = selecionadas.size > 0 && selecionadas.size === tarefas.length;

  function toggleTodas() {
    if (todasMarcadas) setSelecionadas(new Set());
    else setSelecionadas(new Set(tarefas.map(t => t.id)));
  }
  async function restaurarSelecionadas() {
    if (!confirm(`Restaurar ${selecionadas.size} tarefa(s)?`)) return;
    for (const id of selecionadas) await restaurarTarefa(id, autor);
    setSelecionadas(new Set());
  }
  async function excluirDefinitivo() {
    if (!confirm(`Excluir DEFINITIVAMENTE ${selecionadas.size} tarefa(s)? Não dá pra desfazer.`)) return;
    const { hardDeleteTarefa } = await import("./repository");
    for (const id of selecionadas) await hardDeleteTarefa(id);
    setSelecionadas(new Set());
  }

  if (tarefas.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">🗑️ Lixeira vazia.</div>;
  }
  return (
    <div className="space-y-2 pb-20">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={todasMarcadas} onChange={toggleTodas} />
          {selecionadas.size > 0 ? `${selecionadas.size} de ${tarefas.length} selecionada(s)` : `${tarefas.length} na lixeira`}
        </label>
      </div>
      {tarefas.map(t => {
        const proj = projetos.find(p => p.id === t.projetoId);
        const marcada = selecionadas.has(t.id);
        return (
          <div key={t.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 flex items-start gap-2">
            <input
              type="checkbox"
              checked={marcada}
              onChange={(e) => {
                const novo = new Set(selecionadas);
                if (e.target.checked) novo.add(t.id); else novo.delete(t.id);
                setSelecionadas(novo);
              }}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 line-through">{t.titulo}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {proj?.emoji} {proj?.nome} · deletada em {fmtBR(t.deletadoEm)}
                {t.motivoDelete && ` · motivo: ${t.motivoDelete}`}
              </div>
              <div className="mt-2">
                <Button size="sm" onClick={() => restaurarTarefa(t.id, autor)}>Restaurar</Button>
              </div>
            </div>
          </div>
        );
      })}
      {selecionadas.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-60 z-30 p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-lg">
          <div className="flex items-center gap-2 max-w-7xl mx-auto flex-wrap">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{selecionadas.size} selecionada(s)</span>
            <Button size="sm" onClick={restaurarSelecionadas}>↶ Restaurar todas</Button>
            <Button size="sm" variant="danger" onClick={excluirDefinitivo}>🗑️ Excluir definitivo</Button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setSelecionadas(new Set())}>Limpar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MODAL: Nova Tarefa ───────────────────────────────────────────────────

function NovaTarefaModal({ onClose, projetos, subprojetos, restaurantes, pessoaId, pessoaNome, prazoInicial, projetoIdInicial, subprojetoIdInicial }: {
  onClose: () => void;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  restaurantes: { id: string; nome: string }[];
  pessoaId: string;
  pessoaNome: string;
  prazoInicial?: string;
  projetoIdInicial?: string;
  subprojetoIdInicial?: string;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  // Sem default — vazio força o usuário a escolher conscientemente.
  // Pré-preenche só quando vem do contexto (calendário, click num dia).
  const [projetoId, setProjetoId] = useState(projetoIdInicial || "");
  const [subprojetoId, setSubprojetoId] = useState(subprojetoIdInicial || "");
  const [prazo, setPrazo] = useState(prazoInicial || "");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("normal");
  const [restaurantIds, setRestaurantIds] = useState<string[]>([]);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [puxando, setPuxando] = useState<{ tipo: "ideia" | "ocorrencia"; id: string; titulo: string } | null>(null);
  const [puxarAberto, setPuxarAberto] = useState(false);
  // Responsável: começa em quem criou; user pode trocar pra outra pessoa
  // autorizada no projeto.
  const [responsavelId, setResponsavelId] = useState<string>(pessoaId);
  // Co-responsáveis (podem editar) e observadores (só acompanham) — opcionais.
  const [coResponsaveisIds, setCoResponsaveisIds] = useState<string[]>([]);
  const [observadoresIds, setObservadoresIds] = useState<string[]>([]);

  // Lista de pessoas — pra select de responsável. Snapshot direto da coleção.
  const [pessoasLista, setPessoasLista] = useState<Array<{ id: string; nome: string }>>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoasLista(list);
    });
    return () => u();
  }, []);

  // Sub bloqueado pra criação manual não aparece na lista de seleção —
  // ele só recebe tarefas via hooks automáticos.
  const subsDoProjeto = subprojetos.filter(s => s.projetoId === projetoId && !s.bloqueadoCriacaoManual);
  // Quando user troca de projeto, reseta o subprojeto pra forçar nova
  // escolha (em vez de ficar com um sub residual de outro projeto).
  useEffect(() => {
    if (subprojetoId && !subsDoProjeto.find(s => s.id === subprojetoId)) {
      setSubprojetoId("");
    }
  }, [projetoId, subprojetoId, subsDoProjeto]);

  const subAtual = subprojetos.find(s => s.id === subprojetoId);
  const projetoAtual = projetos.find(p => p.id === projetoId);
  const temTemplate = (subAtual?.tarefasTemplate?.length ?? 0) > 0;
  const cor = projetoAtual?.cor;

  // Quando muda o subprojeto, se ele tem responsável padrão + observadores
  // padrão, aplica-os no form (merge com o que o user já marcou).
  useEffect(() => {
    if (subAtual?.responsavelPadraoId) {
      setResponsavelId(subAtual.responsavelPadraoId);
    }
    const obsPadrao = subAtual?.observadoresPadraoIds || [];
    if (obsPadrao.length > 0) {
      setObservadoresIds(prev => {
        const merged = new Set([...prev, ...obsPadrao]);
        return Array.from(merged);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subprojetoId]);

  // Filtra pessoas elegíveis pra ser responsável, com base na visibilidade
  // do projeto. Pra projetos privados, só quem está em usuariosAutorizados
  // (+ o próprio criador) pode ser responsável — atribuir pra alguém sem
  // acesso resultaria em tarefa que o responsável não consegue ver.
  const responsaveisElegiveis = (() => {
    if (!projetoAtual) return pessoasLista;
    const vis = (projetoAtual.visibilidade || "privado") as string;
    const aberto = vis === "escritorio" || vis === "publico";
    if (aberto) return pessoasLista;
    // Privado: só autorizados + criador
    const ids = new Set([
      ...((projetoAtual.usuariosAutorizados || []) as string[]),
      pessoaId,
    ]);
    return pessoasLista.filter(p => ids.has(p.id));
  })();
  const responsavelEhElegivel = responsaveisElegiveis.some(p => p.id === responsavelId);
  const responsavelNome = pessoasLista.find(p => p.id === responsavelId)?.nome
    || (responsavelId === pessoaId ? pessoaNome : "");

  // Validação: título, projeto, subprojeto, prazo e responsável elegível.
  const formValido = !!titulo.trim() && !!projetoId && !!subprojetoId && !!prazo && !!responsavelId && responsavelEhElegivel;

  function salvar() {
    if (!formValido) return;
    // Se tem template e usuário escolheu usar, popula subtarefas com
    // prazo resolvido a partir do offset (D+5 / dia 20 / fim do mês).
    const prazoBase = prazo || null;
    const subtarefasFromTemplate = (usarTemplate && temTemplate && subAtual)
      ? (subAtual.tarefasTemplate || []).map((t, i) => ({
          id: Math.random().toString(36).slice(2, 11),
          texto: t.titulo,
          feito: false,
          prazo: resolverPrazoOffset(t.prazoOffset, prazoBase),
          ordem: i + 1,
        }))
      : undefined;
    const payload = {
      projetoId, subprojetoId, titulo,
      descricao: descricao || undefined,
      responsavelId, responsavelNome,
      coResponsaveis: coResponsaveisIds.length ? coResponsaveisIds : undefined,
      coResponsaveisNomes: coResponsaveisIds.length
        ? coResponsaveisIds.map(id => pessoasLista.find(p => p.id === id)?.nome || "").filter(Boolean)
        : undefined,
      observadoresIds: observadoresIds.length ? observadoresIds : undefined,
      observadoresNomes: observadoresIds.length
        ? observadoresIds.map(id => pessoasLista.find(p => p.id === id)?.nome || "").filter(Boolean)
        : undefined,
      restaurantIds: restaurantIds.length ? restaurantIds : undefined,
      prazo: prazo || null,
      status: "a_fazer" as const,
      prioridade,
      origem: puxando ? ("manual" as const) : ("manual" as const),
      corHerdada: cor,
      subtarefas: subtarefasFromTemplate,
      criadoPor: pessoaId,
      criadoPorNome: pessoaNome,
    };
    const puxandoSnap = puxando;
    // Fecha o modal imediatamente (otimista). A tarefa aparece via snapshot
    // quando o Firestore confirma; se der erro, avisamos por toast/alert.
    onClose();
    criarTarefa(payload)
      .then(async (tarefaId) => {
        // Se essa tarefa foi puxada de uma ideia/ocorrência, marca a origem
        if (puxandoSnap) {
          const now = new Date().toISOString();
          const col = puxandoSnap.tipo === "ideia" ? "ideias" : "ocorrencias";
          try {
            const { doc, updateDoc } = await import("firebase/firestore");
            await updateDoc(doc(db, col, puxandoSnap.id), {
              status: "puxada_tarefa",
              tarefaIdGerada: tarefaId,
              puxadaEm: now,
              puxadaPor: pessoaId,
              puxadaPorNome: pessoaNome,
              atualizadoEm: now,
              atualizadaEm: now,
            });
          } catch (e) {
            console.warn("[tarefas] não consegui marcar puxada:", e);
          }
        }
      })
      .catch(e => {
        console.error("[tarefas] falha ao criar:", e);
        alert(`Falha ao criar tarefa "${titulo}": ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4 gap-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Nova Tarefa</h2>
          {!puxando && (
            <button
              type="button"
              onClick={() => setPuxarAberto(true)}
              className="text-xs px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
            >
              📋 Puxar de Ideia/Ocorrência
            </button>
          )}
        </div>
        {puxando && (
          <div className="mb-3 flex items-center gap-2 px-2 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
            <span className="text-xs">
              {puxando.tipo === "ideia" ? "💡" : "🚨"} Puxado de: <strong>{puxando.titulo}</strong>
            </span>
            <button
              type="button"
              onClick={() => setPuxando(null)}
              className="ml-auto text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline"
            >
              desfazer
            </button>
          </div>
        )}
        <div className="space-y-3">
          <Field label="Título *">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" autoFocus />
          </Field>
          <Field label="Descrição">
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              className="input resize-y"
              placeholder="Detalhes, contexto, links..."
            />
          </Field>
          <Field label="Projeto *">
            <select value={projetoId} onChange={(e) => setProjetoId(e.target.value)} className="input">
              <option value="" disabled>Selecione…</option>
              {projetos.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>)}
            </select>
          </Field>
          <Field label="Subprojeto *">
            <select
              value={subprojetoId}
              onChange={(e) => setSubprojetoId(e.target.value)}
              className="input"
              disabled={!projetoId}
            >
              <option value="" disabled>{projetoId ? "Selecione…" : "Escolha um projeto primeiro"}</option>
              {subsDoProjeto.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
          <Field label="Responsável *">
            <select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              className="input"
              disabled={!projetoId}
            >
              {!projetoId && <option value="">Escolha um projeto primeiro</option>}
              {projetoId && !responsaveisElegiveis.find(p => p.id === responsavelId) && (
                <option value="" disabled>Selecione…</option>
              )}
              {responsaveisElegiveis.map(p => (
                <option key={p.id} value={p.id}>
                  {p.id === pessoaId ? `${p.nome} (você)` : p.nome}
                </option>
              ))}
            </select>
            {projetoAtual && projetoAtual.visibilidade === "privado" && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                🔒 Projeto privado — só pessoas autorizadas no projeto podem ser responsáveis.
                {responsaveisElegiveis.length === 1 && " Adicione pessoas autorizadas em Configurações de Tarefas pra atribuir a outros."}
              </p>
            )}
          </Field>
          <Field label="Co-responsáveis (podem editar)">
            <PessoasMultiPicker
              value={coResponsaveisIds}
              onChange={setCoResponsaveisIds}
              pessoas={responsaveisElegiveis}
              excluir={[responsavelId, ...observadoresIds]}
              placeholder={!projetoId ? "Escolha um projeto primeiro" : "+ adicionar"}
            />
          </Field>
          <Field label="Observadores (só acompanham)">
            <PessoasMultiPicker
              value={observadoresIds}
              onChange={setObservadoresIds}
              pessoas={responsaveisElegiveis}
              excluir={[responsavelId, ...coResponsaveisIds]}
              placeholder={!projetoId ? "Escolha um projeto primeiro" : "+ adicionar"}
            />
          </Field>
          {temTemplate && (
            <label className="flex items-center gap-2 text-sm bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-2">
              <input type="checkbox" checked={usarTemplate} onChange={(e) => setUsarTemplate(e.target.checked)} />
              <span className="flex-1">
                Usar checklist do template
                <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-300">
                  ({subAtual?.tarefasTemplate?.length} subtarefa{(subAtual?.tarefasTemplate?.length ?? 0) > 1 ? "s" : ""})
                </span>
              </span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prazo *">
              <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className="input" />
            </Field>
            <Field label="Prioridade">
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as TarefaPrioridade)} className="input">
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </Field>
          </div>
          {restaurantes.length > 0 && (
            <Field label="Empresa(s) — opcional">
              <div className="flex flex-wrap gap-2">
                {restaurantes.map(r => (
                  <label key={r.id} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={restaurantIds.includes(r.id)}
                      onChange={(e) => {
                        if (e.target.checked) setRestaurantIds([...restaurantIds, r.id]);
                        else setRestaurantIds(restaurantIds.filter(id => id !== r.id));
                      }}
                    />
                    {r.nome}
                  </label>
                ))}
              </div>
            </Field>
          )}
        </div>
        {/* Altura fixa em todos os campos (input/select/textarea pequeno)
            pra evitar selects mais altos que inputs nativos. textarea com
            min-height próprio sobrescreve. */}
        <style>{`
          .input {
            width: 100%;
            height: 38px;
            padding: 6px 10px;
            border: 1px solid rgb(209 213 219);
            border-radius: 8px;
            background: white;
            font-size: 14px;
            box-sizing: border-box;
            line-height: 1.4;
          }
          .input:disabled { opacity: 0.6; cursor: not-allowed; }
          textarea.input { height: auto; min-height: 60px; padding-top: 8px; padding-bottom: 8px; }
          .dark .input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }
        `}</style>
        <div className="flex gap-2 justify-end mt-5">
          <Button onClick={onClose} variant="ghost">Cancelar</Button>
          <Button
            onClick={salvar}
            disabled={!formValido}
            title={!formValido ? "Preencha título, projeto, subprojeto, prazo e responsável" : undefined}
          >
            Criar Tarefa
          </Button>
        </div>
        {puxarAberto && (
          <PuxarIdeiaOcorrenciaModal
            pessoaIdAtual={pessoaId}
            onClose={() => setPuxarAberto(false)}
            onEscolher={(item) => {
              setPuxando({ tipo: item.tipo, id: item.id, titulo: item.titulo });
              setTitulo(item.titulo);
              if (item.descricao) setDescricao(item.descricao);
              setPuxarAberto(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}

// ─── MODAL: Detalhe da Tarefa ─────────────────────────────────────────────

function DetalheModal({ tarefa, projetos, subprojetos, autor, onClose }: {
  tarefa: Tarefa;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  autor: { id: string; nome: string };
  onClose: () => void;
}) {
  const projeto = projetos.find(p => p.id === tarefa.projetoId);
  const cor = tarefa.corHerdada || projeto?.cor || "#6b7280";

  const { restaurants } = useRestaurant();
  const [pessoasLista, setPessoasLista] = useState<Array<{ id: string; nome: string }>>([]);
  // State pro modal de prorrogação. Setado pelo botão "Prorrogar contrato"
  // do banner de Decisão de Experiência 1ª etapa, com o empregadoId.
  const [prorrogarParaEmpregadoId, setProrrogarParaEmpregadoId] = useState<string | null>(null);

  // Carrega lista de pessoas pra usar nos pickers de responsável/co-resp.
  // Onsnapshot pra ficar sempre atualizada (raramente muda mas barato).
  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const lista = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as { id: string; nome?: string; ativa?: boolean })
        .filter(p => p.ativa !== false && p.nome)
        .map(p => ({ id: p.id, nome: p.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setPessoasLista(lista);
    });
    return () => u();
  }, []);

  const [novaSubtarefa, setNovaSubtarefa] = useState("");
  const [novoComentario, setNovoComentario] = useState("");
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [tituloDraft, setTituloDraft] = useState(tarefa.titulo);
  const [editandoDescricao, setEditandoDescricao] = useState(false);
  const [descricaoDraft, setDescricaoDraft] = useState(tarefa.descricao || "");
  // Sincroniza drafts se a tarefa mudar de fora (outro usuário editou)
  useEffect(() => { setTituloDraft(tarefa.titulo); }, [tarefa.titulo]);
  useEffect(() => { setDescricaoDraft(tarefa.descricao || ""); }, [tarefa.descricao]);

  async function salvarCampo<K extends keyof Tarefa>(
    campo: K,
    valor: Tarefa[K],
    labelHumano?: string,
  ) {
    const atual = tarefa[campo];
    if (JSON.stringify(atual) === JSON.stringify(valor)) return;
    await atualizarTarefa(tarefa.id, { [campo]: valor } as Partial<Tarefa>, autor, {
      acao: "editada",
      campo: labelHumano || String(campo),
      valorAntes: String(atual ?? "—"),
      valorDepois: String(valor ?? "—"),
    });
  }

  async function trocarProjeto(novoProjetoId: string) {
    // Ao trocar projeto, escolhe o 1º subprojeto disponível como default
    const novoSub = subprojetos.find(s => s.projetoId === novoProjetoId);
    if (!novoSub) {
      alert("Esse projeto não tem subprojetos. Crie um antes ou escolha outro.");
      return;
    }
    const novoProj = projetos.find(p => p.id === novoProjetoId);
    await atualizarTarefa(tarefa.id, {
      projetoId: novoProjetoId,
      subprojetoId: novoSub.id,
      corHerdada: novoProj?.cor || tarefa.corHerdada,
    }, autor, {
      acao: "editada",
      campo: "projeto",
      valorAntes: projeto?.nome || "—",
      valorDepois: novoProj?.nome || "—",
    });
  }

  async function addSubtarefa() {
    if (!novaSubtarefa.trim()) return;
    const subs = [...(tarefa.subtarefas || []), {
      id: Math.random().toString(36).slice(2, 11),
      texto: novaSubtarefa.trim(),
      feito: false,
      ordem: (tarefa.subtarefas?.length || 0) + 1,
    }];
    await atualizarTarefa(tarefa.id, { subtarefas: subs }, autor, {
      acao: "subtarefa_adicionada", detalhe: novaSubtarefa.trim(),
    });
    setNovaSubtarefa("");
  }

  async function addComentario() {
    if (!novoComentario.trim()) return;
    const mencionados = extrairMencoes(novoComentario, pessoasLista);
    await adicionarComentario(tarefa.id, novoComentario.trim(), autor, mencionados);
    setNovoComentario("");
  }

  async function addAnexoManual() {
    const url = prompt("Cole o link (Drive, Docs, ou qualquer URL):");
    if (!url) return;
    const nome = prompt("Nome / label do anexo:", url.split("/").pop() || "Anexo") || "Anexo";
    const anexo: TarefaAnexo = {
      id: Math.random().toString(36).slice(2, 11),
      nome, url,
      adicionadoEm: new Date().toISOString(),
      adicionadoPor: autor.id,
    };
    await atualizarTarefa(tarefa.id, {
      anexos: [...(tarefa.anexos || []), anexo],
    }, autor, { acao: "anexo_adicionado", detalhe: nome });
  }

  async function addAnexoDrive() {
    try {
      const folder = await pickDriveFolder("Selecione a pasta do Drive");
      if (!folder) return;
      const anexo: TarefaAnexo = {
        id: Math.random().toString(36).slice(2, 11),
        nome: folder.name,
        url: `https://drive.google.com/drive/folders/${folder.id}`,
        tipo: "drive-folder",
        adicionadoEm: new Date().toISOString(),
        adicionadoPor: autor.id,
      };
      await atualizarTarefa(tarefa.id, {
        anexos: [...(tarefa.anexos || []), anexo],
      }, autor, { acao: "anexo_adicionado", detalhe: folder.name });
    } catch (e) {
      alert("Não foi possível abrir o Drive Picker: " + String(e));
    }
  }

  async function addAnexoDriveFile() {
    try {
      const file = await pickDriveFile("Selecione o arquivo do Drive");
      if (!file) return;
      const anexo: TarefaAnexo = {
        id: Math.random().toString(36).slice(2, 11),
        nome: file.name,
        url: `https://drive.google.com/open?id=${file.id}`,
        tipo: "drive-file",
        adicionadoEm: new Date().toISOString(),
        adicionadoPor: autor.id,
      };
      await atualizarTarefa(tarefa.id, {
        anexos: [...(tarefa.anexos || []), anexo],
      }, autor, { acao: "anexo_adicionado", detalhe: file.name });
    } catch (e) {
      alert("Não foi possível abrir o Drive Picker: " + String(e));
    }
  }

  async function removerAnexo(anexoId: string) {
    if (!confirm("Remover este anexo?")) return;
    await atualizarTarefa(tarefa.id, {
      anexos: (tarefa.anexos || []).filter(a => a.id !== anexoId),
    }, autor, { acao: "editada", campo: "anexos", detalhe: "Anexo removido" });
  }

  const isConcluida = tarefa.status === "concluida";
  // Toggle do botão "Marcar como concluída". Volta pra "a_fazer" se já concluída.
  async function toggleConcluida() {
    const novo: TarefaStatus = isConcluida ? "a_fazer" : "concluida";
    await mudarStatusComErro(tarefa.id, novo, autor);
  }

  // Tab de atividade no fim do drawer — comentários ou log (atividade)
  const [activityTab, setActivityTab] = useState<"comentarios" | "atividade">("comentarios");

  const subprojeto = subprojetos.find(s => s.id === tarefa.subprojetoId);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 w-full md:max-w-[760px] h-full overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ borderLeftWidth: 4, borderLeftColor: cor }}
      >
        {/* ─── Top bar: Concluir + ações ─────────────────────────────── */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={toggleConcluida}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              isConcluida
                ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/20"
            }`}
            title={isConcluida ? "Reabrir tarefa" : "Marcar como concluída"}
          >
            <span className="text-base leading-none">{isConcluida ? "✓" : "○"}</span>
            {isConcluida ? "Concluída" : "Marcar como concluída"}
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const motivo = prompt("Excluir tarefa. Motivo (opcional):");
                if (motivo !== null) {
                  softDeleteTarefa(tarefa.id, autor, motivo || undefined);
                  onClose();
                }
              }}
              className="text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Excluir"
            >
              🗑️
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none px-2"
              title="Fechar"
            >
              ×
            </button>
          </div>
        </div>

        {/* ─── Banner confidencial ─────────────────────────────────────── */}
        {isConfidencial(tarefa, projeto) && (
          <div className="px-5 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 shrink-0">
            🔒 Esta tarefa é confidencial — só pessoas autorizadas podem ver.
          </div>
        )}

        {/* ─── Corpo scrollável ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* Breadcrumb + Título */}
          <div className="px-5 pt-4 pb-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 flex-wrap">
              <select
                value={tarefa.projetoId}
                onChange={(e) => trocarProjeto(e.target.value)}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-1 text-xs cursor-pointer"
                title="Trocar projeto"
              >
                {projetos.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>
                ))}
              </select>
              <span className="text-gray-400">›</span>
              <select
                value={tarefa.subprojetoId}
                onChange={(e) => salvarCampo("subprojetoId", e.target.value, "subprojeto")}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-1 text-xs cursor-pointer"
                title="Trocar subprojeto"
              >
                {subprojetos.filter(s => s.projetoId === tarefa.projetoId).map(s => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
            <div className="mt-2">
              {editandoTitulo ? (
                <input
                  value={tituloDraft}
                  onChange={(e) => setTituloDraft(e.target.value)}
                  onBlur={async () => {
                    setEditandoTitulo(false);
                    if (tituloDraft.trim() && tituloDraft !== tarefa.titulo) {
                      await salvarCampo("titulo", tituloDraft.trim(), "título");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") { setTituloDraft(tarefa.titulo); setEditandoTitulo(false); }
                  }}
                  autoFocus
                  className="w-full text-2xl font-bold bg-transparent border-b-2 border-indigo-500 text-gray-900 dark:text-gray-100 outline-none"
                />
              ) : (
                <h2
                  onClick={() => setEditandoTitulo(true)}
                  className={`text-2xl font-bold text-gray-900 dark:text-gray-100 cursor-text hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded px-1 -mx-1 ${isConcluida ? "line-through opacity-70" : ""}`}
                  title="Clique pra editar"
                >
                  {tarefa.titulo}
                </h2>
              )}
            </div>
          </div>

          {/* ─── Bloco de campos (linhas horizontais label/valor) ─── */}
          <div className="px-5 pb-4 space-y-2">
            <FieldRow label="Responsável">
              <select
                value={tarefa.responsavelId}
                onChange={(e) => {
                  const novo = pessoasLista.find(p => p.id === e.target.value);
                  if (!novo) return;
                  atualizarTarefa(tarefa.id, {
                    responsavelId: novo.id,
                    responsavelNome: novo.nome,
                  }, autor, {
                    acao: "responsavel_mudou",
                    campo: "responsável",
                    valorAntes: tarefa.responsavelNome || "—",
                    valorDepois: novo.nome,
                  });
                }}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-2 py-1 text-sm cursor-pointer w-full"
              >
                {!pessoasLista.find(p => p.id === tarefa.responsavelId) && tarefa.responsavelNome && (
                  <option value={tarefa.responsavelId}>{tarefa.responsavelNome} (atual)</option>
                )}
                {pessoasLista.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Data de conclusão">
              <input
                type="date"
                value={tarefa.prazo || ""}
                onChange={(e) => salvarCampo("prazo", e.target.value || null, "prazo")}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-2 py-1 text-sm cursor-pointer w-full"
              />
            </FieldRow>
            <FieldRow label="Status">
              <select
                value={tarefa.status}
                onChange={(e) => mudarStatusComErro(tarefa.id, e.target.value as TarefaStatus, autor)}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-2 py-1 text-sm cursor-pointer w-full"
              >
                {(Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[]).map(s =>
                  <option key={s} value={s}>{TAREFA_STATUS_LABEL[s]}</option>
                )}
              </select>
            </FieldRow>
            <FieldRow label="Prioridade">
              <select
                value={tarefa.prioridade}
                onChange={(e) => salvarCampo("prioridade", e.target.value as TarefaPrioridade, "prioridade")}
                className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-2 py-1 text-sm cursor-pointer w-full"
              >
                {(Object.keys(TAREFA_PRIORIDADE_LABEL) as TarefaPrioridade[]).map(p =>
                  <option key={p} value={p}>{TAREFA_PRIORIDADE_LABEL[p]}</option>
                )}
              </select>
            </FieldRow>
            <FieldRow label="Co-responsáveis">
              <CoRespPicker tarefa={tarefa} pessoas={pessoasLista} autor={autor} />
            </FieldRow>
            <FieldRow label="Observadores">
              <PessoasMultiPicker
                value={tarefa.observadoresIds || []}
                onChange={(ids) => {
                  const nomes = ids.map(id => pessoasLista.find(p => p.id === id)?.nome || "").filter(Boolean);
                  salvarCampo("observadoresIds", ids.length ? ids : undefined, "observadores");
                  salvarCampo("observadoresNomes", ids.length ? nomes : undefined);
                }}
                pessoas={pessoasLista}
                excluir={[tarefa.responsavelId, ...(tarefa.coResponsaveis || [])]}
                placeholder="+ adicionar"
              />
            </FieldRow>
            <FieldRow label="Empresa(s)">
              <div className="flex flex-wrap gap-2 py-1">
                {restaurants.map(r => {
                  const sel = (tarefa.restaurantIds || []).includes(r.id);
                  return (
                    <label key={r.id} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => {
                          const cur = tarefa.restaurantIds || [];
                          const novo = e.target.checked ? [...cur, r.id] : cur.filter(x => x !== r.id);
                          salvarCampo("restaurantIds", novo, "empresa(s)");
                        }}
                      />
                      {r.nome}
                    </label>
                  );
                })}
                {restaurants.length === 0 && <span className="text-xs text-gray-400">—</span>}
              </div>
            </FieldRow>
            <FieldRow label="Visibilidade">
              <div className="space-y-1.5">
                <select
                  value={tarefa.visibilidadeOverride || ""}
                  onChange={(e) => {
                    const v = e.target.value as TarefaVisibilidade | "";
                    salvarCampo("visibilidadeOverride", (v || undefined) as Tarefa["visibilidadeOverride"], "visibilidade");
                  }}
                  className="bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded px-2 py-1 text-sm cursor-pointer w-full"
                >
                  <option value="">— A mesma do projeto ({projeto && TAREFA_VISIBILIDADE_LABEL[projeto.visibilidade]}) —</option>
                  {(Object.keys(TAREFA_VISIBILIDADE_LABEL) as TarefaVisibilidade[]).map(v =>
                    <option key={v} value={v}>{TAREFA_VISIBILIDADE_LABEL[v]}</option>
                  )}
                </select>
                <UsuariosAutorizadosPicker
                  ids={tarefa.usuariosAutorizados || []}
                  pessoas={pessoasLista}
                  excluir={[tarefa.responsavelId, ...(tarefa.coResponsaveis || [])]}
                  onChange={(ids) => salvarCampo("usuariosAutorizados", ids.length ? ids : undefined, "autorizados")}
                />
              </div>
            </FieldRow>
            <FieldRow label="Origem">
              <div className="text-sm text-gray-600 dark:text-gray-400 py-1">
                {TAREFA_ORIGEM_LABEL[tarefa.origem]}
                {tarefa.origemRefLabel && <span className="text-gray-400"> · {tarefa.origemRefLabel}</span>}
              </div>
            </FieldRow>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 mx-5" />

          {/* Custom fields tipados do subprojeto */}
          {(subprojeto?.customFieldsDef?.length || 0) > 0 && (
            <div className="px-5 py-4">
              <CustomFieldsSection tarefa={tarefa} subprojetos={subprojetos} autor={autor} />
            </div>
          )}

          {/* ─── Descrição ─────────────────────────────────────────────── */}
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Descrição
            </div>
            {editandoDescricao ? (
              <textarea
                value={descricaoDraft}
                onChange={(e) => setDescricaoDraft(e.target.value)}
                onBlur={async () => {
                  setEditandoDescricao(false);
                  if (descricaoDraft !== (tarefa.descricao || "")) {
                    await salvarCampo("descricao", descricaoDraft || undefined, "descrição");
                  }
                }}
                rows={5}
                autoFocus
                className="w-full text-sm px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                placeholder="Descrição (opcional)…"
              />
            ) : (
              <div
                onClick={() => setEditandoDescricao(true)}
                className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap cursor-text hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded p-1 -m-1 min-h-[1.5rem]"
                title="Clique pra editar"
              >
                {tarefa.descricao || <span className="text-gray-400 italic">+ Adicionar descrição</span>}
              </div>
            )}
          </div>

          {/* ─── Subtarefas ────────────────────────────────────────────── */}
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            <SubtarefasSection
              tarefa={tarefa}
              autor={autor}
              pessoas={pessoasLista}
              novaSubtarefa={novaSubtarefa}
              setNovaSubtarefa={setNovaSubtarefa}
              addSubtarefa={addSubtarefa}
            />
          </div>

          {/* ─── Anexos ────────────────────────────────────────────────── */}
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Anexos {tarefa.anexos && tarefa.anexos.length > 0 && `(${tarefa.anexos.length})`}
            </div>
            <div className="space-y-1">
              {(tarefa.anexos || []).map(a => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <span>{a.tipo === "drive-folder" ? "📁" : a.tipo === "drive-file" ? "📎" : "🔗"}</span>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-indigo-600 dark:text-indigo-400 hover:underline truncate">{a.nome}</a>
                  <button onClick={() => removerAnexo(a.id)} className="text-[11px] text-red-500 hover:underline">×</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Button size="sm" variant="ghost" onClick={addAnexoManual}>🔗 Link</Button>
              <Button size="sm" variant="ghost" onClick={addAnexoDriveFile}>📎 Arquivo Drive</Button>
              <Button size="sm" variant="ghost" onClick={addAnexoDrive}>📁 Pasta Drive</Button>
            </div>
          </div>

          {/* ─── Ação especial: decisão Experiência ─── */}
          {tarefa.ehDecisaoExperiencia && tarefa.origemRefId && (
            <div className="mx-5 my-4 px-3 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
              <div className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                Decisão de Experiência ({tarefa.ehDecisaoExperiencia === "1a" ? "1ª etapa" : "2ª etapa"})
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
                {tarefa.ehDecisaoExperiencia === "1a" ? (
                  <>
                    Decida agora: <b>prorrogar pro 2º período</b> (envia Termo
                    de Prorrogação pro Clicksign) ou <b>não renovar</b>
                    {" "}(abre demissão pré-preenchida).
                  </>
                ) : (
                  <>Caso a decisão seja <b>não renovar o contrato</b>, use o botão abaixo pra abrir o processo de demissão pré-preenchido.</>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {tarefa.ehDecisaoExperiencia === "1a" && (
                  <Button
                    size="sm"
                    onClick={() => setProrrogarParaEmpregadoId(tarefa.origemRefId!)}
                  >
                    ✓ Prorrogar contrato
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    const aviso = `Iniciar processo de demissão por NÃO RENOVAÇÃO do contrato de experiência (${tarefa.ehDecisaoExperiencia === "1a" ? "1ª" : "2ª"} etapa)?\n\nIsso vai abrir o módulo Pessoas pra você concluir o desligamento.`;
                    if (!confirm(aviso)) return;
                    const motivoStr = `Não renovação do contrato de experiência (${tarefa.ehDecisaoExperiencia === "1a" ? "1ª" : "2ª"} etapa)`;
                    if (tarefa.restaurantIds && tarefa.restaurantIds[0]) {
                      window.location.href = `/r/${tarefa.restaurantIds[0]}/demissao?empregadoId=${tarefa.origemRefId}&motivo=${encodeURIComponent(motivoStr)}`;
                    } else {
                      alert(`Vá em Demissão → '+ Iniciar Demissão' → escolha o empregado → iniciativa: Empresa → motivo: "${motivoStr}".`);
                    }
                  }}
                >
                  ✗ Não renovar — iniciar demissão
                </Button>
              </div>
            </div>
          )}

          {/* ─── Tabs Comentários / Atividade ─────────────────────────── */}
          <div className="border-t border-gray-100 dark:border-gray-800">
            <div className="px-5 pt-3 flex items-center gap-4 text-sm border-b border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setActivityTab("comentarios")}
                className={`py-2 -mb-px border-b-2 transition-colors ${
                  activityTab === "comentarios"
                    ? "border-indigo-500 text-gray-900 dark:text-gray-100 font-semibold"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Comentários {(tarefa.comentarios?.length || 0) > 0 && <span className="text-xs text-gray-400">({tarefa.comentarios!.length})</span>}
              </button>
              <button
                onClick={() => setActivityTab("atividade")}
                className={`py-2 -mb-px border-b-2 transition-colors ${
                  activityTab === "atividade"
                    ? "border-indigo-500 text-gray-900 dark:text-gray-100 font-semibold"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Todas as atividades {(tarefa.log?.length || 0) > 0 && <span className="text-xs text-gray-400">({tarefa.log!.length})</span>}
              </button>
            </div>
            <div className="px-5 py-3">
              {activityTab === "comentarios" ? (
                <div>
                  <div className="space-y-2">
                    {(tarefa.comentarios || []).map(c => (
                      <div key={c.id} className="text-sm bg-gray-50 dark:bg-gray-800/50 p-2 rounded-md">
                        <div className="font-medium text-gray-900 dark:text-gray-100 text-xs flex items-center gap-2">
                          {c.autorNome}
                          {(c.mencionados?.length ?? 0) > 0 && (
                            <span className="text-[10px] text-indigo-600 dark:text-indigo-400">
                              → {(c.mencionados || []).map(id => pessoasLista.find(p => p.id === id)?.nome || "?").join(", ")}
                            </span>
                          )}
                        </div>
                        <div className="text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{c.texto}</div>
                        <div className="text-[10px] text-gray-400 mt-1">{fmtBRDateTime(c.criadoEm)}</div>
                      </div>
                    ))}
                    {(tarefa.comentarios?.length || 0) === 0 && (
                      <div className="text-xs text-gray-400 italic">Nenhum comentário ainda.</div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      value={novoComentario}
                      onChange={(e) => setNovoComentario(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addComentario()}
                      placeholder="Adicionar comentário… use @nome pra mencionar"
                      className="flex-1 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                    />
                    <Button size="sm" onClick={addComentario}>Enviar</Button>
                  </div>
                  {extrairMencoes(novoComentario, pessoasLista).length > 0 && (
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-1">
                      ✓ Vai mencionar: {extrairMencoes(novoComentario, pessoasLista)
                        .map(id => pessoasLista.find(p => p.id === id)?.nome)
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                  {(tarefa.log || []).slice().reverse().map(l => (
                    <div key={l.id} className="py-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{l.autorNome}</span> {l.acao.replace(/_/g, " ")}
                      {l.detalhe && `: ${l.detalhe}`}
                      <span className="ml-2 text-gray-400">{fmtBRDateTime(l.em)}</span>
                    </div>
                  ))}
                  {(tarefa.log?.length || 0) === 0 && (
                    <div className="text-xs text-gray-400 italic">Sem atividade registrada.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {prorrogarParaEmpregadoId && (
        <ProrrogarContratoModal
          empregadoId={prorrogarParaEmpregadoId}
          autor={autor}
          onClose={() => setProrrogarParaEmpregadoId(null)}
        />
      )}
    </div>
  );
}

// Helper de linha label/valor. Asana usa label fixo à esquerda, valor à direita
// com hover-edit. Aqui mantemos selects/inputs inline pra simplificar — mas
// removendo a moldura visual quando não está em hover.
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-40 shrink-0 text-xs text-gray-500 dark:text-gray-400 pt-1.5">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Custom fields tipados (preenchidos por tarefa) ──────────────────────

function CustomFieldsSection({ tarefa, subprojetos, autor }: {
  tarefa: Tarefa;
  subprojetos: TarefaSubprojeto[];
  autor: { id: string; nome: string };
}) {
  const sub = subprojetos.find(s => s.id === tarefa.subprojetoId);
  const defs = sub?.customFieldsDef || [];
  if (defs.length === 0) return null;

  async function salvarValor(fieldId: string, valor: string | number | boolean | null) {
    const novo = { ...(tarefa.customFields || {}), [fieldId]: valor };
    await atualizarTarefa(tarefa.id, { customFields: novo }, autor, {
      acao: "editada",
      campo: `custom:${defs.find(d => d.id === fieldId)?.nome || fieldId}`,
      valorDepois: String(valor ?? "—"),
    });
  }

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
        Campos do subprojeto
      </h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {defs.sort((a, b) => a.ordem - b.ordem).map(field => {
          const valor = tarefa.customFields?.[field.id];
          return (
            <label key={field.id} className="block">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {field.nome}{field.obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
              </div>
              {field.tipo === "texto" && (
                <input
                  value={typeof valor === "string" ? valor : ""}
                  onChange={(e) => salvarValor(field.id, e.target.value || null)}
                  className="w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              )}
              {field.tipo === "numero" && (
                <input
                  type="number"
                  value={typeof valor === "number" ? valor : ""}
                  onChange={(e) => salvarValor(field.id, e.target.value ? parseFloat(e.target.value) : null)}
                  className="w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              )}
              {field.tipo === "data" && (
                <input
                  type="date"
                  value={typeof valor === "string" ? valor : ""}
                  onChange={(e) => salvarValor(field.id, e.target.value || null)}
                  className="w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              )}
              {field.tipo === "select" && (
                <select
                  value={typeof valor === "string" ? valor : ""}
                  onChange={(e) => salvarValor(field.id, e.target.value || null)}
                  className="w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                >
                  <option value="">— escolher —</option>
                  {(field.opcoes || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {field.tipo === "checkbox" && (
                <input
                  type="checkbox"
                  checked={valor === true}
                  onChange={(e) => salvarValor(field.id, e.target.checked)}
                  className="mt-1"
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal de importação CSV (Asana → Tarefas) ────────────────────────

function ImportadorModal({ projetos, subprojetos, pessoaId, onClose }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  pessoaId: string;
  onClose: () => void;
}) {
  const { restaurants } = useRestaurant();
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<LinhaImportada[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [projetoDestino, setProjetoDestino] = useState(projetos[0]?.id || "");
  const [subprojetoDestino, setSubprojetoDestino] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<{ criadas: number; vinculadas: number; erros: string[] } | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  // Filtros pra escolher quais linhas importar
  const [excluirConcluidas, setExcluirConcluidas] = useState(true);
  const [excluirPassadas, setExcluirPassadas] = useState(false);
  const [excluirSemPrazo, setExcluirSemPrazo] = useState(false);

  useEffect(() => {
    const u = onSnapshot(collection(db, "pessoas"), snap => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() } as Pessoa)).filter(p => p.ativa !== false);
      setPessoas(lista);
    });
    return () => u();
  }, []);

  const subsDoProjeto = subprojetos.filter(s => s.projetoId === projetoDestino);
  useEffect(() => {
    if (subsDoProjeto.length > 0 && !subsDoProjeto.find(s => s.id === subprojetoDestino)) {
      setSubprojetoDestino(subsDoProjeto[0].id);
    }
  }, [projetoDestino, subprojetoDestino, subsDoProjeto]);

  function parsear() {
    const rows = parseCSV(texto);
    const { linhas: ls, warnings: ws } = mapearLinhas(rows, pessoas, restaurants as Restaurant[]);
    setLinhas(ls);
    setWarnings(ws);
  }

  function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const conteudo = String(reader.result || "");
      setTexto(conteudo);
      const rows = parseCSV(conteudo);
      const { linhas: ls, warnings: ws } = mapearLinhas(rows, pessoas, restaurants as Restaurant[]);
      setLinhas(ls);
      setWarnings(ws);
    };
    reader.readAsText(f, "UTF-8");
  }

  async function importar() {
    if (linhasFinal.length === 0 || !projetoDestino || !subprojetoDestino) {
      alert("Carregue um CSV e escolha projeto/subprojeto");
      return;
    }
    setImportando(true);
    setProgresso({ atual: 0, total: linhasFinal.filter(l => !l.parentTaskId).length });
    try {
      const proj = projetos.find(p => p.id === projetoDestino);
      const r = await executarImport(
        linhasFinal,
        { projetoId: projetoDestino, subprojetoId: subprojetoDestino, corProjeto: proj?.cor },
        { id: pessoaId, nome: "Importador" },
        (atual, total) => setProgresso({ atual: atual + 1, total }),
      );
      setResultado(r);
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setImportando(false);
    }
  }

  const hoje = new Date().toISOString().slice(0, 10);

  // Aplica filtros (memoizado pra evitar recálculo a cada render)
  const linhasFiltradas = useMemo(() => {
    return linhas.filter(l => {
      // Pais e filhas mantidas em sincronia: se filtrar um pai, suas filhas
      // também são filtradas (vão como órfãs depois). Pra simplificar, aplico
      // o filtro só em pais e mantenho filhas associadas.
      if (l.parentTaskId) return true; // filhas seguem o destino dos pais
      if (excluirConcluidas && l.status === "concluida") return false;
      if (excluirPassadas && l.prazo && l.prazo < hoje) return false;
      if (excluirSemPrazo && !l.prazo) return false;
      return true;
    });
  }, [linhas, excluirConcluidas, excluirPassadas, excluirSemPrazo, hoje]);

  // Quais filhas vão pra dentro? Só as cujo pai sobreviveu
  const paisIdsFiltrados = new Set(linhasFiltradas.filter(l => !l.parentTaskId).map(l => l.taskId));
  const linhasFinal = linhasFiltradas.filter(l => !l.parentTaskId || paisIdsFiltrados.has(l.parentTaskId));

  const pais = linhasFinal.filter(l => !l.parentTaskId);
  const filhas = linhasFinal.filter(l => l.parentTaskId);
  const orfas = detectarOrfas(linhasFinal);
  const totalOriginal = linhas.filter(l => !l.parentTaskId).length;
  const filtradosCount = totalOriginal - pais.length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📥 Importar CSV (Asana)</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Suporta export padrão do Asana: Name, Notes, Due Date, Assignee, Empresas(s), Parent task, etc.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {resultado ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Importação concluída</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                <b>{resultado.criadas}</b> tarefa(s) criada(s), <b>{resultado.vinculadas}</b> subtarefa(s) vinculada(s).
              </p>
              {resultado.erros.length > 0 && (
                <div className="mt-3 text-xs text-red-600 dark:text-red-400 text-left">
                  <div className="font-bold mb-1">Erros ({resultado.erros.length}):</div>
                  {resultado.erros.slice(0, 10).map((e, i) => <div key={i}>· {e}</div>)}
                </div>
              )}
              <Button onClick={onClose} className="mt-4">Fechar</Button>
            </div>
          ) : (
            <>
              {/* Step 1: upload */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  1. Carregue o CSV
                </div>
                <input type="file" accept=".csv,text/csv" onChange={handleArquivo} className="text-sm" />
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Ou cole o conteúdo CSV diretamente:
                </div>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  placeholder="Task ID,Created At,...,Name,..."
                  className="w-full mt-1 px-2 py-1 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
                {!linhas.length && texto && <Button size="sm" onClick={parsear}>Processar</Button>}
              </div>

              {/* Step 2: preview + filtros */}
              {linhas.length > 0 && (
                <>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      2. Filtrar (opcional)
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={excluirConcluidas} onChange={(e) => setExcluirConcluidas(e.target.checked)} />
                        Excluir já concluídas
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={excluirPassadas} onChange={(e) => setExcluirPassadas(e.target.checked)} />
                        Excluir com prazo no passado
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={excluirSemPrazo} onChange={(e) => setExcluirSemPrazo(e.target.checked)} />
                        Excluir sem prazo
                      </label>
                      {filtradosCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-300 ml-auto">
                          {filtradosCount} pulada(s) · {pais.length} pra importar
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      3. Preview ({pais.length} tarefa(s) pai · {filhas.length - orfas.length} subtarefa(s) · {orfas.length} órfã(s) viram pai)
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-md p-2 bg-gray-50 dark:bg-gray-800/30 space-y-0.5 text-xs">
                      {pais.slice(0, 50).map((p, i) => {
                        const fs = linhas.filter(l => l.parentTaskId === p.taskId);
                        return (
                          <div key={i}>
                            <div className="font-medium text-gray-800 dark:text-gray-200">
                              {p.status === "concluida" && "✓ "}{p.titulo}
                              {p.prazo && <span className="ml-2 text-gray-500">📅 {fmtBR(p.prazo)}</span>}
                              {p.responsavelNome && <span className="ml-2 text-indigo-600 dark:text-indigo-400">{p.responsavelNome}</span>}
                              {(p.restaurantIds?.length ?? 0) > 0 && <span className="ml-2 text-emerald-600">🏢 {p.restaurantIds?.length}</span>}
                              {!p.responsavelId && p.assigneeNome && <span className="ml-2 text-amber-500" title="Não bateu com nenhuma pessoa">⚠ {p.assigneeNome}</span>}
                            </div>
                            {fs.slice(0, 3).map((f, j) => (
                              <div key={j} className="pl-4 text-gray-600 dark:text-gray-400">↳ {f.titulo}</div>
                            ))}
                            {fs.length > 3 && <div className="pl-4 text-gray-500">+{fs.length - 3} subtarefa(s)</div>}
                          </div>
                        );
                      })}
                      {pais.length > 50 && <div className="text-gray-500">+{pais.length - 50} tarefas pai (não mostradas no preview)</div>}
                    </div>
                  </div>

                  {warnings.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-amber-700 dark:text-amber-300">
                        ⚠ {warnings.length} aviso(s) — clique pra ver
                      </summary>
                      <div className="mt-1 pl-2 max-h-32 overflow-y-auto text-gray-600 dark:text-gray-400">
                        {warnings.slice(0, 30).map((w, i) => <div key={i}>· {w}</div>)}
                        {warnings.length > 30 && <div>+{warnings.length - 30} avisos</div>}
                      </div>
                    </details>
                  )}

                  {/* Step 4: destino */}
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      4. Destino
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs">
                        <div className="text-gray-500 mb-1">Projeto</div>
                        <select value={projetoDestino} onChange={(e) => setProjetoDestino(e.target.value)} className="w-full px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800">
                          {projetos.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>)}
                        </select>
                      </label>
                      <label className="text-xs">
                        <div className="text-gray-500 mb-1">Subprojeto</div>
                        <select value={subprojetoDestino} onChange={(e) => setSubprojetoDestino(e.target.value)} className="w-full px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800">
                          {subsDoProjeto.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {!resultado && (
          <footer className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
            {progresso ? (
              <div className="flex-1 text-xs text-gray-600 dark:text-gray-400">
                Importando {progresso.atual}/{progresso.total}…
                <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(progresso.atual / progresso.total) * 100}%` }} />
                </div>
              </div>
            ) : <div className="flex-1" />}
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
            <Button onClick={importar} disabled={importando || pais.length === 0}>
              {importando ? "Importando…" : `Importar ${pais.length} tarefa(s)`}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Modal "sem permissão" ─────────────────────────────────────────────

function SemPermissaoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-4xl mb-2">🔒</div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Tarefa confidencial</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Você não tem permissão pra ver essa tarefa. Peça pro responsável te adicionar como autorizado.
        </p>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}

// ─── Picker de pessoas autorizadas (confidencialidade) ──────────────────

function UsuariosAutorizadosPicker({ ids, pessoas, excluir, onChange }: {
  ids: string[];
  pessoas: Array<{ id: string; nome: string }>;
  excluir?: string[];          // pessoas que já têm acesso por outras vias
  onChange: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const excluirSet = new Set([...(excluir || []), ...ids]);
  const disponiveis = pessoas.filter(p => !excluirSet.has(p.id));

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {ids.map(id => {
        const nome = pessoas.find(p => p.id === id)?.nome || "—";
        return (
          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs">
            🔒 {nome}
            <button onClick={() => onChange(ids.filter(x => x !== id))} className="text-amber-400 hover:text-red-500 ml-1">×</button>
          </span>
        );
      })}
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
        >
          + autorizar pessoa
        </button>
      ) : (
        <select
          autoFocus
          onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]); setAberto(false); }}
          onBlur={() => setAberto(false)}
          className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
        >
          <option value="" disabled>— escolha —</option>
          {disponiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Picker de co-responsáveis ─────────────────────────────────────────────

function CoRespPicker({ tarefa, pessoas, autor }: {
  tarefa: Tarefa;
  pessoas: Array<{ id: string; nome: string }>;
  autor: { id: string; nome: string };
}) {
  const [aberto, setAberto] = useState(false);
  const atuais = tarefa.coResponsaveis || [];
  const atuaisNomes = tarefa.coResponsaveisNomes || [];

  async function remover(id: string) {
    const novoIds = atuais.filter(x => x !== id);
    const novoNomes = atuaisNomes.filter((_, i) => atuais[i] !== id);
    const removidoNome = pessoas.find(p => p.id === id)?.nome
      || atuaisNomes[atuais.indexOf(id)] || "—";
    await atualizarTarefa(tarefa.id, {
      coResponsaveis: novoIds,
      coResponsaveisNomes: novoNomes,
    }, autor, {
      acao: "co_resp_removido",
      detalhe: removidoNome,
    });
  }
  async function adicionar(id: string) {
    if (atuais.includes(id) || id === tarefa.responsavelId) return;
    const pessoa = pessoas.find(p => p.id === id);
    if (!pessoa) return;
    await atualizarTarefa(tarefa.id, {
      coResponsaveis: [...atuais, id],
      coResponsaveisNomes: [...atuaisNomes, pessoa.nome],
    }, autor, {
      acao: "co_resp_adicionado",
      detalhe: pessoa.nome,
    });
    setAberto(false);
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {atuais.map((id, i) => {
        const nome = pessoas.find(p => p.id === id)?.nome || atuaisNomes[i] || "—";
        return (
          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs">
            {nome}
            <button onClick={() => remover(id)} className="text-indigo-400 hover:text-red-500 ml-1">×</button>
          </span>
        );
      })}
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + co-responsável
        </button>
      ) : (
        <select
          autoFocus
          onChange={(e) => adicionar(e.target.value)}
          onBlur={() => setAberto(false)}
          className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
        >
          <option value="" disabled>— escolha —</option>
          {pessoas
            .filter(p => !atuais.includes(p.id) && p.id !== tarefa.responsavelId)
            .map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Seção de subtarefas com CRUD completo ────────────────────────────────

function SubtarefasSection({ tarefa, autor, pessoas, novaSubtarefa, setNovaSubtarefa, addSubtarefa }: {
  tarefa: Tarefa;
  autor: { id: string; nome: string };
  pessoas: Array<{ id: string; nome: string }>;
  novaSubtarefa: string;
  setNovaSubtarefa: (v: string) => void;
  addSubtarefa: () => Promise<void>;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [draftTexto, setDraftTexto] = useState("");
  // Subtarefa cujo painel "expandido" (responsável + prazo) está aberto.
  // Pra não poluir a tela quando há muitas subtarefas, o painel é
  // exibido sob demanda — clique no ⚙ ou no chip do responsável.
  const [expandirId, setExpandirId] = useState<string | null>(null);

  async function setResponsavel(id: string, pessoaId: string | null) {
    const p = pessoas.find(x => x.id === pessoaId);
    const novas = subs.map(s => s.id === id ? {
      ...s,
      responsavelId: pessoaId,
      responsavelNome: p?.nome ?? null,
    } : s);
    const denorm = Array.from(new Set(
      novas.map(s => s.responsavelId).filter((x): x is string => !!x)
    ));
    await atualizarTarefa(tarefa.id, {
      subtarefas: novas,
      subtarefaResponsaveisIds: denorm,
    }, autor, {
      acao: "editada",
      campo: "responsável da subtarefa",
      valorDepois: p?.nome ?? "—",
    });
  }

  async function setPrazo(id: string, prazo: string | null) {
    const novas = subs.map(s => s.id === id ? { ...s, prazo: prazo || null } : s);
    await atualizarTarefa(tarefa.id, { subtarefas: novas }, autor, {
      acao: "editada",
      campo: "prazo da subtarefa",
      valorDepois: prazo ? fmtBR(prazo) : "—",
    });
  }

  const subs = tarefa.subtarefas || [];
  const totalFeitos = subs.filter(s => s.feito).length;

  async function salvarEdicao(id: string) {
    const novo = draftTexto.trim();
    setEditandoId(null);
    if (!novo) return;
    const novas = subs.map(s => s.id === id ? { ...s, texto: novo } : s);
    await atualizarTarefa(tarefa.id, { subtarefas: novas }, autor, {
      acao: "editada",
      campo: "subtarefa",
      detalhe: novo,
    });
  }
  async function removerSub(id: string) {
    const removida = subs.find(s => s.id === id);
    const novas = subs.filter(s => s.id !== id);
    const denorm = Array.from(new Set(
      novas.map(s => s.responsavelId).filter((x): x is string => !!x)
    ));
    await atualizarTarefa(tarefa.id, {
      subtarefas: novas,
      subtarefaResponsaveisIds: denorm,
    }, autor, {
      acao: "subtarefa_removida",
      detalhe: removida?.texto,
    });
  }
  async function mover(id: string, delta: -1 | 1) {
    const i = subs.findIndex(s => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= subs.length) return;
    const novas = [...subs];
    [novas[i], novas[j]] = [novas[j], novas[i]];
    // Re-numera ordem
    const reordenadas = novas.map((s, k) => ({ ...s, ordem: k + 1 }));
    await atualizarTarefa(tarefa.id, { subtarefas: reordenadas }, autor, {
      acao: "editada",
      campo: "ordem subtarefas",
    });
  }

  // Handler especial pra subtarefas com flag ehAnexoResultado/ehBaixa.
  // Quando o usuário marca, abrimos UI específica em vez de só toggle.
  async function handleMarcar(st: Subtarefa, marcar: boolean) {
    // Desmarcar é sempre simples
    if (!marcar) {
      await marcarSubtarefa(tarefa.id, st.id, false, autor);
      return;
    }
    // ehAnexoResultado: abre Drive Picker e adiciona anexo
    if (st.ehAnexoResultado) {
      try {
        const { pickDriveFile } = await import("../../core/google/drivePicker");
        const f = await pickDriveFile("Selecione o resultado do exame");
        if (!f) return; // cancelou, não marca
        const anexo: TarefaAnexo = {
          id: Math.random().toString(36).slice(2, 11),
          nome: f.name,
          url: `https://drive.google.com/open?id=${f.id}`,
          tipo: "drive-file",
          adicionadoEm: new Date().toISOString(),
          adicionadoPor: autor.id,
        };
        await atualizarTarefa(tarefa.id, {
          anexos: [...(tarefa.anexos || []), anexo],
        }, autor, { acao: "anexo_adicionado", detalhe: f.name });
        await marcarSubtarefa(tarefa.id, st.id, true, autor);
      } catch (e) {
        alert("Erro ao anexar: " + String(e));
      }
      return;
    }
    // ehBaixa: dispara baixa no ExameEmpregado
    if (st.ehBaixa && tarefa.origemRefId) {
      try {
        const { darBaixa, getExame } = await import("../exames/repository");
        const exame = await getExame(tarefa.origemRefId);
        if (!exame) {
          alert("Não consegui localizar o exame de origem. Marcando subtarefa sem baixa.");
          await marcarSubtarefa(tarefa.id, st.id, true, autor);
          return;
        }
        const realizadoEm = prompt(`Data em que o exame foi REALIZADO (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10));
        if (!realizadoEm) return;
        const fornecedor = prompt("Fornecedor / clínica (opcional):", exame.fornecedor || "");
        // Tenta achar o anexo mais recente do tipo drive-file como resultado
        const ultimoAnexo = (tarefa.anexos || []).slice().reverse().find(a => a.tipo === "drive-file");
        const proximo = await darBaixa({
          exameId: exame.id,
          realizadoEm,
          fornecedor: fornecedor || undefined,
          anexoUrl: ultimoAnexo?.url,
          anexoNome: ultimoAnexo?.nome,
          autor,
        });
        await marcarSubtarefa(tarefa.id, st.id, true, autor);
        alert(`✓ Baixa registrada. Próximo vencimento: ${proximo}`);
      } catch (e) {
        alert("Erro ao dar baixa: " + String(e));
      }
      return;
    }
    // Subtarefa comum
    await marcarSubtarefa(tarefa.id, st.id, true, autor);
  }

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
        Subtarefas {subs.length > 0 && `(${totalFeitos}/${subs.length})`}
      </h3>
      <div className="space-y-1">
        {subs.map((st, idx) => {
          const expandido = expandirId === st.id;
          const temResp = !!st.responsavelId;
          const temPrazo = !!st.prazo;
          return (
            <div key={st.id} className="text-sm">
              <div className="flex items-center gap-2 group">
                <input
                  type="checkbox"
                  checked={st.feito}
                  onChange={(e) => handleMarcar(st, e.target.checked)}
                />
                {editandoId === st.id ? (
                  <input
                    value={draftTexto}
                    onChange={(e) => setDraftTexto(e.target.value)}
                    onBlur={() => salvarEdicao(st.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") { setEditandoId(null); }
                    }}
                    autoFocus
                    className="flex-1 px-1 py-0.5 text-sm rounded border border-indigo-400 bg-white dark:bg-gray-800"
                  />
                ) : (
                  <span
                    onClick={() => { setEditandoId(st.id); setDraftTexto(st.texto); }}
                    className={`flex-1 cursor-text ${st.feito ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-300"}`}
                    title="Clique pra editar"
                  >
                    {st.texto}
                  </span>
                )}
                {/* Chips inline (sempre visíveis quando setados) */}
                <div className="flex items-center gap-1 text-[10px]">
                  {temResp && (
                    <button
                      onClick={() => setExpandirId(expandido ? null : st.id)}
                      className="px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                      title="Responsável da subtarefa"
                    >
                      👤 {st.responsavelNome}
                    </button>
                  )}
                  {temPrazo && (
                    <button
                      onClick={() => setExpandirId(expandido ? null : st.id)}
                      className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      title="Prazo da subtarefa"
                    >
                      📅 {fmtBR(st.prazo)}
                    </button>
                  )}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-xs">
                  <button
                    onClick={() => setExpandirId(expandido ? null : st.id)}
                    className={`px-1 hover:text-indigo-600 ${expandido ? "text-indigo-600" : ""}`}
                    title="Responsável e prazo"
                  >⚙</button>
                  <button onClick={() => mover(st.id, -1)} disabled={idx === 0} className="px-1 disabled:opacity-30 hover:text-indigo-600" title="Subir">▲</button>
                  <button onClick={() => mover(st.id, 1)} disabled={idx === subs.length - 1} className="px-1 disabled:opacity-30 hover:text-indigo-600" title="Descer">▼</button>
                  <button onClick={() => removerSub(st.id)} className="px-1 text-red-500 hover:text-red-700" title="Remover">×</button>
                </div>
              </div>
              {expandido && (
                <div className="ml-6 mt-1 mb-2 p-2 rounded-md bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <span className="text-gray-500 dark:text-gray-400">Responsável:</span>
                    <select
                      value={st.responsavelId || ""}
                      onChange={(e) => setResponsavel(st.id, e.target.value || null)}
                      className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
                    >
                      <option value="">— ninguém —</option>
                      {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-gray-500 dark:text-gray-400">Prazo:</span>
                    <input
                      type="date"
                      value={st.prazo || ""}
                      onChange={(e) => setPrazo(st.id, e.target.value || null)}
                      className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
                    />
                    {st.prazo && (
                      <button
                        onClick={() => setPrazo(st.id, null)}
                        className="text-gray-400 hover:text-red-500"
                        title="Limpar"
                      >×</button>
                    )}
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          value={novaSubtarefa}
          onChange={(e) => setNovaSubtarefa(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSubtarefa()}
          placeholder="+ Nova subtarefa…"
          className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
        />
        <Button size="sm" onClick={addSubtarefa}>+</Button>
      </div>
    </div>
  );
}

// ─── "Ver como…" — master only ────────────────────────────────────────────

// ─── ProrrogarContratoModal ─────────────────────────────────────────────
// Aberto pelo botão "✓ Prorrogar contrato" na Decisão de Experiência 1ª
// etapa. Localiza admissão pelo empregadoId, encontra o termo de
// prorrogação subido na admissão e envia pro Clicksign (cria envelope
// novo só com esse doc). Idempotente — botão fica desabilitado se já tem
// envelope contendo o termo.
function ProrrogarContratoModal({ empregadoId, autor, onClose }: {
  empregadoId: string;
  autor: { id: string; nome: string };
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [mensagem, setMensagem] = useState("");
  const [admissao, setAdmissao] = useState<Record<string, unknown> | null>(null);
  const [restaurantInfo, setRestaurantInfo] = useState<Record<string, unknown> | null>(null);
  const [termoProrrogacao, setTermoProrrogacao] = useState<{
    nome: string;
    link?: string;
    linkFileId?: string;
  } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const q = query(
          collection(db, "admissoes"),
          where("empregadoIdCriado", "==", empregadoId),
        );
        const snap = await getDocs(q);
        if (cancel) return;
        if (snap.empty) {
          setEstado("erro");
          setMensagem("Não encontrei a admissão deste empregado. O Termo de Prorrogação vive na admissão original.");
          return;
        }
        const admDoc = snap.docs[0];
        const adm = { id: admDoc.id, ...admDoc.data() } as Record<string, unknown>;
        setAdmissao(adm);
        // Encontra o termo de prorrogação
        const termos = (adm.termosAssinados as Array<{
          id: string; nome: string; tipoEspecial?: string; link?: string; linkFileId?: string;
        }> | undefined) || [];
        const termo = termos.find(t => t.tipoEspecial === "prorrogacao" || t.id === "tm_prorrogacao_experiencia");
        if (!termo) {
          setEstado("erro");
          setMensagem("Esta admissão não tem o termo 'Termo de Prorrogação' configurado. Abra o checklist da admissão e adicione o termo.");
          return;
        }
        setTermoProrrogacao({ nome: termo.nome, link: termo.link, linkFileId: termo.linkFileId });
        // Restaurante
        const rid = adm.restaurantId as string;
        const restSnap = await getDoc(doc(db, "restaurants", rid));
        if (cancel) return;
        if (!restSnap.exists()) {
          setEstado("erro");
          setMensagem("Restaurante da admissão não encontrado.");
          return;
        }
        setRestaurantInfo({ id: restSnap.id, ...restSnap.data() });
        setEstado("ok");
      } catch (e) {
        if (cancel) return;
        setEstado("erro");
        setMensagem(e instanceof Error ? e.message : "Falha ao carregar admissão.");
      }
    })();
    return () => { cancel = true; };
  }, [empregadoId]);

  async function enviarProrrogacaoPraClicksign() {
    if (!admissao || !restaurantInfo || !termoProrrogacao?.linkFileId) return;
    const cand = (admissao as { candidato?: { nome?: string; email?: string; cpf?: string; whatsapp?: string } }).candidato || {};
    const empresaNome = (restaurantInfo as { clicksignEmpresaNome?: string }).clicksignEmpresaNome?.trim();
    const empresaEmail = (restaurantInfo as { clicksignEmpresaEmail?: string }).clicksignEmpresaEmail?.trim();
    if (!cand.email) { setMensagem("Candidato sem e-mail."); return; }
    if (!empresaNome || !empresaEmail) {
      setMensagem("Configure o signatário da empresa em Admissão → Configurações.");
      return;
    }
    setEnviando(true);
    setMensagem("");
    try {
      // Imports dinâmicos pra não engordar o bundle do TarefasPage
      const [{ downloadDriveFileBase64 }, { criarEnvelopeClicksign, CLICKSIGN_SANDBOX }] = await Promise.all([
        import("../../core/google/driveClient"),
        import("../../core/clicksign/clicksignClient"),
      ]);
      const base64 = await downloadDriveFileBase64(termoProrrogacao.linkFileId!);
      const cpfDigits = (cand.cpf || "").replace(/\D/g, "");
      const cpfFmt = cpfDigits.length === 11
        ? `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`
        : undefined;
      const dn = (admissao as { dadosPreenchidos?: { data_nascimento?: string } }).dadosPreenchidos?.data_nascimento;
      const restAuto = (restaurantInfo as { clicksignEmpresaAssinaturaAuto?: boolean }).clicksignEmpresaAssinaturaAuto;
      const restCpf = (restaurantInfo as { clicksignEmpresaCpf?: string }).clicksignEmpresaCpf;
      const restNasc = (restaurantInfo as { clicksignEmpresaNascimento?: string }).clicksignEmpresaNascimento;
      const { envelopeId, status } = await criarEnvelopeClicksign({
        envelopeName: `Prorrogação de Experiência - ${cand.nome || empregadoId}`,
        signers: [
          {
            name: empresaNome,
            email: empresaEmail,
            autoSignature: restAuto || undefined,
            documentation: restAuto && restCpf ? (
              restCpf.replace(/\D/g, "").length === 11
                ? `${restCpf.replace(/\D/g, "").slice(0,3)}.${restCpf.replace(/\D/g, "").slice(3,6)}.${restCpf.replace(/\D/g, "").slice(6,9)}-${restCpf.replace(/\D/g, "").slice(9)}`
                : undefined
            ) : undefined,
            birthday: restAuto ? restNasc || undefined : undefined,
          },
          {
            name: cand.nome || "Empregado",
            email: cand.email,
            phone: cand.whatsapp || undefined,
            documentation: cpfFmt,
            birthday: typeof dn === "string" ? dn : undefined,
          },
        ],
        docs: [{
          filename: `Termo de Prorrogacao - ${cand.nome || empregadoId}.pdf`,
          base64,
        }],
        externalId: admissao.id as string,
      });
      // Persiste no histórico da admissão
      const historicoAtual = ((admissao as { clicksignHistorico?: Array<unknown> }).clicksignHistorico || []) as Array<{
        envelopeId: string; enviadoEm: string; arquivos: Array<{ fileId?: string; filename: string }>;
      }>;
      const novoEnvio = {
        envelopeId,
        enviadoEm: new Date().toISOString(),
        enviadoPor: { id: autor.id, nome: autor.nome },
        sandbox: CLICKSIGN_SANDBOX,
        statusInicial: status,
        arquivos: [{
          fileId: termoProrrogacao.linkFileId!,
          filename: `Termo de Prorrogacao - ${cand.nome || empregadoId}.pdf`,
        }],
      };
      await updateDoc(doc(db, "admissoes", admissao.id as string), {
        clicksignEnvelopeId: envelopeId,
        clicksignStatus: status,
        clicksignEnviadoEm: new Date().toISOString(),
        clicksignHistorico: [...historicoAtual, novoEnvio],
        updatedAt: new Date().toISOString(),
      });
      setMensagem(`✓ Termo enviado pro Clicksign. O empregado recebe por e-mail. (Envelope ${envelopeId.slice(0, 8)}…)`);
    } catch (e) {
      setMensagem("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  }

  const candNome = (admissao as { candidato?: { nome?: string } } | null)?.candidato?.nome || "—";
  const temPdf = !!termoProrrogacao?.linkFileId;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
            ✓ Prorrogar contrato de experiência
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-xl leading-none p-1"
          >
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {estado === "carregando" && (
            <div className="text-gray-500 italic">Carregando admissão…</div>
          )}
          {estado === "erro" && (
            <div className="text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded p-3">
              {mensagem}
            </div>
          )}
          {estado === "ok" && (
            <>
              <div className="text-gray-700 dark:text-gray-300">
                Empregado: <strong>{candNome}</strong>
              </div>
              <div className="text-gray-700 dark:text-gray-300">
                Termo:{" "}
                {termoProrrogacao?.link ? (
                  <a
                    href={termoProrrogacao.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    ↗ {termoProrrogacao.nome}
                  </a>
                ) : (
                  <span className="text-amber-700">— sem PDF subido —</span>
                )}
              </div>
              {!temPdf && (
                <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
                  ⚠ O Termo de Prorrogação ainda não foi subido pra pasta
                  "docs a assinar" desta admissão. Abra o checklist de termos
                  da admissão, encontre "Termo de Prorrogação" e clique em
                  "⬆️ Subir pra assinatura". Depois volte aqui.
                </div>
              )}
              {temPdf && (
                <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 rounded p-3">
                  Ao confirmar, vou criar um novo envelope no Clicksign só
                  com o Termo de Prorrogação. O empregado recebe por e-mail e
                  pode assinar. Sem ação aqui, o termo continua guardado e
                  nada é enviado.
                </div>
              )}
              {mensagem && (
                <div className={`text-xs ${mensagem.startsWith("✓")
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-rose-700 dark:text-rose-300"}`}>
                  {mensagem}
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>
              Fechar
            </Button>
            {estado === "ok" && temPdf && !mensagem.startsWith("✓") && (
              <Button onClick={enviarProrrogacaoPraClicksign} disabled={enviando}>
                {enviando ? "Enviando…" : "✍️ Enviar pro Clicksign"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
