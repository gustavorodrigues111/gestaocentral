// Página principal do Gestor de Tarefas.
// Tabs: Minhas Tarefas (default) · Por Projeto · Admin (master) · Lixeira (master).
//
// Caixa POR USUÁRIO: Minhas Tarefas = onde sou responsável OU co-responsável,
// independente do restaurante selecionado no topo.

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { collection, onSnapshot } from "firebase/firestore";
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
import { seedProjetosIniciais } from "./seed";
import { gerarTarefasDoDia } from "./generator";
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
import { resolverPrazoOffset, extrairMencoes } from "./prazoOffset";
import { podeVerTarefa, isConfidencial } from "./visibilidade";
import { parseCSV, mapearLinhas, executarImport, detectarOrfas } from "./importador";
import type { LinhaImportada } from "./importador";
import type { Pessoa, Restaurant } from "../../core/types";
import { pickDriveFolder, pickDriveFile } from "../../core/google/drivePicker";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";

type Tab = "minhas" | "projeto" | "admin" | "lixeira";
type ViewMode = "calendario" | "lista" | "kanban";

function readLS<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {}
  return fallback;
}

export function TarefasPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [tab, setTab] = useState<Tab>(() => readLS<Tab>("tarefas_tab", "minhas", ["minhas", "projeto", "admin", "lixeira"]));
  const [viewMinhas, setViewMinhas] = useState<ViewMode>(() => readLS<ViewMode>("tarefas_view_minhas", "calendario", ["calendario", "lista", "kanban"]));
  const [viewProjeto, setViewProjeto] = useState<ViewMode>(() => readLS<ViewMode>("tarefas_view_projeto", "lista", ["calendario", "lista", "kanban"]));

  useEffect(() => { try { localStorage.setItem("tarefas_tab", tab); } catch {} }, [tab]);
  useEffect(() => { try { localStorage.setItem("tarefas_view_minhas", viewMinhas); } catch {} }, [viewMinhas]);
  useEffect(() => { try { localStorage.setItem("tarefas_view_projeto", viewProjeto); } catch {} }, [viewProjeto]);

  const [projetos, setProjetos] = useState<TarefaProjeto[]>([]);
  const [subprojetos, setSubprojetos] = useState<TarefaSubprojeto[]>([]);
  const [minhas, setMinhas] = useState<Tarefa[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [gerando, setGerando] = useState(false);
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
    if (!pessoa?.isMaster) return;
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
  }, [pessoa?.isMaster]);

  // Migração 1x: remove projeto "Caixa Pessoal" (substituído por Banco de Ideias).
  useEffect(() => {
    if (!pessoa?.isMaster) return;
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
  }, [pessoa?.isMaster]);

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

  const isMaster = !!pessoa?.isMaster;
  const tarefaSelecionada = useMemo(
    () => [...minhas, ...tarefasProjeto].find(t => t.id === detalheId) || null,
    [detalheId, minhas, tarefasProjeto],
  );

  async function rodarSeed() {
    if (!pessoa?.id) return;
    setSeeding(true);
    try {
      const r = await seedProjetosIniciais(pessoa.id);
      alert(`Estrutura inicial: ${r.criados} criados, ${r.existentes} já existiam.`);
    } catch (e) {
      alert("Erro no seed: " + String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function rodarGerador() {
    if (!pessoa) return;
    setGerando(true);
    try {
      const r = await gerarTarefasDoDia({ id: pessoa.id, nome: pessoa.nome });
      alert(`Geração:\n${r.contasGeradas} conta(s) fixa(s)\n${r.manutencoesGeradas} manutenção(ões)\n${r.jaExistiam} já existiam`);
    } catch (e) {
      alert("Erro no gerador: " + String(e));
    } finally {
      setGerando(false);
    }
  }

  // Estado de empty na 1ª vez (sem projetos no Firestore)
  const semEstrutura = projetos.length === 0;

  return (
    <div className="max-w-7xl mx-auto p-4">
      <header className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🗂️ Gestor de Tarefas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 flex-1">
          Caixa por usuário · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} pendentes
        </p>
        <Button onClick={() => setNovaAberta({})} disabled={semEstrutura}>+ Nova Tarefa</Button>
      </header>

      {semEstrutura && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
          <h2 className="font-bold text-amber-900 dark:text-amber-100">Estrutura inicial não criada ainda</h2>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
            Crie os 12 projetos padrão (Pessoas, Financeiro, Diretoria, Eventos, Operação, etc) com seus subprojetos.
          </p>
          <Button onClick={rodarSeed} disabled={seeding} className="mt-3">
            {seeding ? "Criando…" : "🌱 Criar estrutura inicial"}
          </Button>
        </div>
      )}

      {/* Layout 2 colunas no desktop: sidebar lateral leve (estilo Asana —
          Minhas tarefas no topo + lista de projetos como favoritos clicáveis)
          + área principal com tabs e views. Mobile colapsa: sidebar some,
          tabs ficam por cima. */}
      <div className="md:grid md:grid-cols-[220px_1fr] md:gap-5">
        <aside className="hidden md:block">
          <ProjetosSidebar
            tabAtual={tab}
            projetoFiltroAtual={tab === "projeto" ? projetoFiltro : ""}
            subFiltroAtual={subFiltro}
            minhasPendentes={minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length}
            projetos={projetos}
            subprojetos={subprojetos}
            tarefasProjeto={tarefasProjeto}
            onAbrirMinhas={() => setTab("minhas")}
            onAbrirProjeto={(pid) => {
              // Toggle: click no projeto já ativo colapsa (volta pra Minhas).
              // Click em projeto diferente abre aquele.
              if (tab === "projeto" && projetoFiltro === pid) {
                setTab("minhas");
                setSubFiltro("");
              } else {
                setTab("projeto");
                setProjetoFiltro(pid);
                setSubFiltro("");
              }
            }}
            onAbrirSubprojeto={(pid, sid) => { setTab("projeto"); setProjetoFiltro(pid); setSubFiltro(sid); }}
            onAbrirAdmin={isMaster ? () => setTab("admin") : undefined}
            onAbrirLixeira={isMaster ? () => setTab("lixeira") : undefined}
          />
        </aside>

        <div className="min-w-0">
          {/* Tabs ainda visíveis (mobile + atalho rápido no desktop) */}
          <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto md:hidden">
            <TabButton ativo={tab === "minhas"} onClick={() => setTab("minhas")}>
              Minhas Tarefas
              {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                  {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length}
                </span>
              )}
            </TabButton>
            <TabButton ativo={tab === "projeto"} onClick={() => setTab("projeto")}>Por Projeto</TabButton>
            {isMaster && <TabButton ativo={tab === "admin"} onClick={() => setTab("admin")}>Admin Projetos</TabButton>}
            {isMaster && <TabButton ativo={tab === "lixeira"} onClick={() => setTab("lixeira")}>Lixeira</TabButton>}
          </nav>

      {tab === "minhas" && (
        <div>
          {/* Título igual ao do ProjetoView, pra padronizar — "Minhas tarefas"
              é tratado conceitualmente como um pseudo-projeto: a caixa pessoal. */}
          <div className="mb-3 flex items-baseline gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              📥 Minhas tarefas
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {minhas.length} tarefa(s) · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} ativas
            </span>
          </div>
          <ViewSwitcher value={viewMinhas} onChange={setViewMinhas} />
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
      )}

      {tab === "admin" && isMaster && (
        <AdminView
          onGerarPendentes={rodarGerador}
          gerandoPendentes={gerando}
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
function ProjetosSidebar({
  tabAtual, projetoFiltroAtual, subFiltroAtual, minhasPendentes,
  projetos, subprojetos, tarefasProjeto,
  onAbrirMinhas, onAbrirProjeto, onAbrirSubprojeto,
  onAbrirAdmin, onAbrirLixeira,
}: {
  tabAtual: string;
  projetoFiltroAtual: string;
  subFiltroAtual: string;
  minhasPendentes: number;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  // Pra contadores de ativas no projeto expandido (tarefas só carregam quando
  // o projeto está aberto; vazio fora disso é esperado).
  tarefasProjeto: Tarefa[];
  onAbrirMinhas: () => void;
  onAbrirProjeto: (id: string) => void;
  onAbrirSubprojeto: (projetoId: string, subId: string) => void;
  onAbrirAdmin?: () => void;
  onAbrirLixeira?: () => void;
}) {
  const ativas = (ts: Tarefa[]) => ts.filter(t => t.status !== "concluida" && t.status !== "cancelada").length;
  return (
    <div className="sticky top-4 space-y-4">
      {/* Bloco superior — caixa pessoal. Mesma estrutura visual dos itens
          de projeto (chevron placeholder + dot + emoji) pra tamanho consistente. */}
      <div className="space-y-0.5">
        <button
          onClick={onAbrirMinhas}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
            tabAtual === "minhas"
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
          }`}
        >
          {/* Placeholder do chevron pra alinhar com os projetos */}
          <span className="w-3" aria-hidden />
          {/* Dot indigo pra dar identidade visual igual aos projetos */}
          <span className="w-2 h-2 rounded-full shrink-0 bg-indigo-500" />
          <span className="text-sm leading-none">📥</span>
          <span className="truncate flex-1">Minhas tarefas</span>
          {minhasPendentes > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
              {minhasPendentes}
            </span>
          )}
        </button>
      </div>

      {/* Bloco Projetos com accordion inline */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-2 mb-1">
          Projetos
        </div>
        <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
          {projetos.length === 0 && (
            <div className="px-2 py-1 text-xs text-gray-400 italic">Sem projetos ainda.</div>
          )}
          {projetos.map(p => {
            const projetoAtivo = tabAtual === "projeto" && projetoFiltroAtual === p.id;
            const subs = subprojetos.filter(s => s.projetoId === p.id);
            return (
              <div key={p.id}>
                <button
                  onClick={() => onAbrirProjeto(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                    projetoAtivo
                      ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  }`}
                  title={p.nome}
                >
                  <span className="text-[9px] text-gray-400 w-3 text-center" aria-hidden>
                    {projetoAtivo ? "▾" : "▸"}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: p.cor || "#6b7280" }}
                  />
                  <span className="text-sm leading-none">{p.emoji || "📁"}</span>
                  <span className="truncate flex-1">{p.nome}</span>
                </button>
                {/* Accordion de subprojetos — só do projeto ativo. Separa
                    em "Manuais" (criação livre, caixa verde) e "Automáticos"
                    (bloqueados, caixa vermelha) — destaque visual ajuda a
                    diferenciar os 2 modos de origem das tarefas. */}
                {projetoAtivo && subs.length > 0 && (() => {
                  const manuais = subs.filter(s => !s.bloqueadoCriacaoManual);
                  const automaticos = subs.filter(s => !!s.bloqueadoCriacaoManual);
                  const renderBtn = (s: TarefaSubprojeto) => {
                    const ts = tarefasProjeto.filter(t => t.subprojetoId === s.id);
                    const ativ = ativas(ts);
                    const sel = subFiltroAtual === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => onAbrirSubprojeto(p.id, s.id)}
                        className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-[12px] transition-colors ${
                          sel
                            ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-medium shadow-sm"
                            : "text-gray-700 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-900/40"
                        }`}
                        title={s.nome}
                      >
                        <span className="truncate flex-1">{s.nome}</span>
                        {ativ > 0 && <span className="text-[10px] text-gray-500">{ativ}</span>}
                      </button>
                    );
                  };
                  return (
                    <div className="pl-5 mt-0.5 space-y-1.5">
                      <button
                        onClick={() => onAbrirSubprojeto(p.id, "")}
                        className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-[12px] transition-colors ${
                          subFiltroAtual === ""
                            ? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60"
                        }`}
                      >
                        <span className="flex-1">Todos</span>
                        <span className="text-[10px] text-gray-500">{ativas(tarefasProjeto)}</span>
                      </button>

                      {/* Caixa verde — subprojetos manuais (criação livre) */}
                      {manuais.length > 0 && (
                        <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 p-1.5">
                          <div className="px-1 pb-1 text-[9px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                            ✏️ Manuais
                            <span className="text-[9px] text-emerald-600/70 dark:text-emerald-400/70 font-normal normal-case tracking-normal">(editáveis)</span>
                          </div>
                          <div className="space-y-0.5">
                            {manuais.map(renderBtn)}
                          </div>
                        </div>
                      )}

                      {/* Caixa vermelha — subprojetos automáticos (só hooks) */}
                      {automaticos.length > 0 && (
                        <div className="rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-900/15 p-1.5">
                          <div className="px-1 pb-1 text-[9px] uppercase tracking-wider font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1">
                            🔒 Automáticos
                            <span className="text-[9px] text-rose-600/70 dark:text-rose-400/70 font-normal normal-case tracking-normal">(só hooks)</span>
                          </div>
                          <div className="space-y-0.5">
                            {automaticos.map(renderBtn)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bloco Admin/Lixeira — só master */}
      {(onAbrirAdmin || onAbrirLixeira) && (
        <div className="space-y-0.5 pt-3 border-t border-gray-200 dark:border-gray-800">
          {onAbrirAdmin && (
            <SidebarItem
              ativo={tabAtual === "admin"}
              onClick={onAbrirAdmin}
              icone="⚙️"
              label="Admin Projetos"
            />
          )}
          {onAbrirLixeira && (
            <SidebarItem
              ativo={tabAtual === "lixeira"}
              onClick={onAbrirLixeira}
              icone="🗑️"
              label="Lixeira"
            />
          )}
        </div>
      )}
    </div>
  );
}

function SidebarItem({ ativo, onClick, icone, label, badge }: {
  ativo: boolean;
  onClick: () => void;
  icone: string;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
        ativo
          ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
      }`}
    >
      <span className="text-base leading-none">{icone}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
          {badge}
        </span>
      )}
    </button>
  );
}

function TabButton({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        ativo
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
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
                · 📅 {tarefa.prazo}
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

// Hook só pra ler activeId — ProjetoView precisa só disso pra construir
// o link do CTA do banner de sub automático.
function useActiveRid(): string {
  const { activeId } = useRestaurant();
  return activeId || "";
}

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
  const rid = useActiveRid();
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
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            Escolha um projeto na lateral pra ver suas tarefas.
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
                ele recebe tarefas e dá CTA pro módulo origem. */}
            {subAtual?.bloqueadoCriacaoManual && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-3">
                <span className="text-2xl shrink-0" aria-hidden>🤖</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                    Subprojeto automático
                  </div>
                  <p className="text-[13px] text-amber-800 dark:text-amber-300 mt-0.5">
                    As tarefas aqui são criadas automaticamente pelo sistema —
                    você não cria manualmente.
                    {subAtual.gatilho && (
                      <> <strong>Gatilho:</strong> {subAtual.gatilho}.</>
                    )}
                  </p>
                </div>
                {subAtual.moduloOrigemRota && rid && (
                  <a
                    href={`/r/${rid}${subAtual.moduloOrigemRota}`}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
                  >
                    {subAtual.moduloOrigemLabel || "Ir pra origem"} →
                  </a>
                )}
              </div>
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

function AdminView({ projetos, subprojetos, pessoaId, onGerarPendentes, gerandoPendentes }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  pessoaId: string;
  onGerarPendentes: () => void;
  gerandoPendentes: boolean;
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
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configuração de projetos e subprojetos do gestor. Mexa com cuidado — afeta todas as tarefas.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onGerarPendentes}
            disabled={gerandoPendentes}
            title="Roda manualmente o gerador de tarefas-lembrete a partir de Contas Fixas e Manutenções cadastradas. Normalmente roda automático via cron diário — só use se o cron falhou."
          >
            {gerandoPendentes ? "Gerando…" : "🔁 Gerar pendentes"}
          </Button>
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
          className="w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
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
  const [f, setF] = useState<Partial<TarefaSubprojeto>>(sub ? { ...sub } : {
    projetoId: projetoId || "",
    nome: "",
    auto: false,
    ordem: 99,
    ativo: true,
    recorrenciaTipo: "nenhuma",
  });
  const [pessoas, setPessoas] = useState<Array<{ id: string; nome: string }>>([]);
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
        {/* Quando bloqueado, perguntamos rota/label do módulo origem pra
            o banner explicativo que aparece pro usuário ao ver as tarefas
            do sub poder linkar de volta pro lugar onde criar. */}
        {f.bloqueadoCriacaoManual && (
          <div className="grid grid-cols-2 gap-2 pl-6">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-amber-800 dark:text-amber-300 mb-0.5">
                Rota do módulo origem
              </label>
              <input
                value={f.moduloOrigemRota || ""}
                onChange={(e) => setF({ ...f, moduloOrigemRota: e.target.value })}
                placeholder="/admissao"
                className="adm-input text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-amber-800 dark:text-amber-300 mb-0.5">
                Label do CTA
              </label>
              <input
                value={f.moduloOrigemLabel || ""}
                onChange={(e) => setF({ ...f, moduloOrigemLabel: e.target.value })}
                placeholder="Ir pra Admissão"
                className="adm-input text-xs"
              />
            </div>
          </div>
        )}
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
          {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>

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
                      {t.prazo && <span>📅 {t.prazo}</span>}
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

function CalendarioView({ tarefas, projetos, subprojetos, onAbrir, autor, onNovaTarefaNoDia }: {
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
          if (id) moverParaData(id, data);
        } : undefined}
        className={`flex flex-col min-h-[200px] rounded-lg border p-2 transition-colors ${
          ehAlvo
            ? "border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700 bg-indigo-50 dark:bg-indigo-900/30"
            : ehHoje
              ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/10"
              : ehFds
                ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
                : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
        }`}
      >
        <div className={`flex items-baseline justify-between mb-1.5 pb-1.5 border-b ${ehHoje ? "border-indigo-300 dark:border-indigo-800" : "border-gray-200 dark:border-gray-800"}`}>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${ehHoje ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}`}>{label}</div>
            <div className={`text-base font-bold ${ehHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100"}`}>
              {Number(data.slice(8, 10))}
              <span className="ml-1 text-[10px] font-normal text-gray-500 dark:text-gray-400">{data.slice(5, 7)}</span>
            </div>
          </div>
          {lista.length > 0 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{lista.length}</span>
          )}
        </div>
        <div className="space-y-1 flex-1 overflow-y-auto">
          {lista.map(t => {
            const proj = projetos.find(p => p.id === t.projetoId);
            const cor = t.corHerdada || proj?.cor || "#6b7280";
            const concluida = t.status === "concluida";
            const arrastando = draggingId === t.id;
            // Asana-style: "‹ Subprojeto" em cinza menor abaixo do título.
            // Fonte do prefixo é o subprojeto (não tem tarefa-pai no schema).
            const sub = subprojetos?.find(s => s.id === t.subprojetoId);
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
                } : undefined}
                onClick={() => onAbrir(t.id)}
                className={`w-full text-left text-[11px] px-1.5 py-1 rounded hover:opacity-80 transition-opacity ${concluida ? "line-through opacity-60" : ""} ${arrastando ? "opacity-40" : ""} ${podeArrastar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ background: cor + "26", color: cor, borderLeft: `2px solid ${cor}` }}
                title={podeArrastar ? `${t.titulo} (arrastar pra mover)` : t.titulo}
              >
                <div className="truncate font-medium">{t.titulo}</div>
                {sub && (
                  <div className="truncate text-[10px] opacity-70 leading-tight">
                    ‹ {sub.nome}
                  </div>
                )}
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
                  <span className="text-[10px] text-rose-600 dark:text-rose-400">{t.prazo}</span>
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
                {proj?.emoji} {proj?.nome} · deletada em {t.deletadoEm?.slice(0, 10)}
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

  // Quando muda o subprojeto, se ele tem responsável padrão, usa-o.
  useEffect(() => {
    if (subAtual?.responsavelPadraoId) {
      setResponsavelId(subAtual.responsavelPadraoId);
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
      coResponsaveis: [],
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
                {responsaveisElegiveis.length === 1 && " Adicione pessoas autorizadas no Admin Projetos pra atribuir a outros."}
              </p>
            )}
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
                  <option value="">— herda do projeto ({projeto && TAREFA_VISIBILIDADE_LABEL[projeto.visibilidade]}) —</option>
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
                Caso a decisão seja <b>não renovar o contrato</b>, use o botão abaixo pra abrir o processo de demissão pré-preenchido.
              </p>
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
                        <div className="text-[10px] text-gray-400 mt-1">{c.criadoEm.slice(0, 16).replace("T", " ")}</div>
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
                      <span className="ml-2 text-gray-400">{l.em.slice(0, 16).replace("T", " ")}</span>
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
                              {p.prazo && <span className="ml-2 text-gray-500">📅 {p.prazo}</span>}
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

function SubtarefasSection({ tarefa, autor, novaSubtarefa, setNovaSubtarefa, addSubtarefa }: {
  tarefa: Tarefa;
  autor: { id: string; nome: string };
  novaSubtarefa: string;
  setNovaSubtarefa: (v: string) => void;
  addSubtarefa: () => Promise<void>;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [draftTexto, setDraftTexto] = useState("");

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
    await atualizarTarefa(tarefa.id, { subtarefas: novas }, autor, {
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
        {subs.map((st, idx) => (
          <div key={st.id} className="flex items-center gap-2 text-sm group">
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
                {st.prazo && (
                  <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400">
                    📅 {st.prazo}
                  </span>
                )}
              </span>
            )}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-xs">
              <button onClick={() => mover(st.id, -1)} disabled={idx === 0} className="px-1 disabled:opacity-30 hover:text-indigo-600" title="Subir">▲</button>
              <button onClick={() => mover(st.id, 1)} disabled={idx === subs.length - 1} className="px-1 disabled:opacity-30 hover:text-indigo-600" title="Descer">▼</button>
              <button onClick={() => removerSub(st.id)} className="px-1 text-red-500 hover:text-red-700" title="Remover">×</button>
            </div>
          </div>
        ))}
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
