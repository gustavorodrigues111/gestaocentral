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
} from "../../core/types";
import {
  TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL, TAREFA_ORIGEM_LABEL,
  TAREFA_VISIBILIDADE_LABEL, RECORRENCIA_TIPO_LABEL,
  TAREFA_CUSTOM_FIELD_TIPO_LABEL,
} from "../../core/types";
import type { TarefaAnexo } from "../../core/types";
import { resolverPrazoOffset, extrairMencoes } from "./prazoOffset";
import { podeVerTarefa, isConfidencial } from "./visibilidade";
import { parseCSV, mapearLinhas, executarImport, detectarOrfas } from "./importador";
import type { LinhaImportada } from "./importador";
import type { Pessoa, Restaurant } from "../../core/types";
import { pickDriveFolder, pickDriveFile } from "../../core/google/drivePicker";

type Tab = "minhas" | "projeto" | "kanban" | "calendario" | "admin" | "lixeira";

export function TarefasPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const [tab, setTab] = useState<Tab>("minhas");
  const [projetos, setProjetos] = useState<TarefaProjeto[]>([]);
  const [subprojetos, setSubprojetos] = useState<TarefaSubprojeto[]>([]);
  const [minhas, setMinhas] = useState<Tarefa[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [projetoFiltro, setProjetoFiltro] = useState<string>("");
  const [tarefasProjeto, setTarefasProjeto] = useState<Tarefa[]>([]);
  const [lixeira, setLixeira] = useState<Tarefa[]>([]);
  const [novaAberta, setNovaAberta] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  // Ouvir projetos + subprojetos
  useEffect(() => {
    const u1 = ouvirProjetos(setProjetos);
    const u2 = ouvirSubprojetos(setSubprojetos);
    return () => { u1(); u2(); };
  }, []);

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📋 Tarefas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 flex-1">
          Caixa por usuário · {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length} pendentes
        </p>
        {isMaster && !semEstrutura && (
          <Button variant="ghost" size="sm" onClick={rodarGerador} disabled={gerando} title="Gera tarefas-lembrete pendentes a partir de Contas Fixas e Manutenções cadastradas">
            {gerando ? "Gerando…" : "🔁 Gerar pendentes"}
          </Button>
        )}
        <Button onClick={() => setNovaAberta(true)} disabled={semEstrutura}>+ Nova Tarefa</Button>
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

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        <TabButton ativo={tab === "minhas"} onClick={() => setTab("minhas")}>
          Minhas Tarefas
          {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
              {minhas.filter(t => t.status !== "concluida" && t.status !== "cancelada").length}
            </span>
          )}
        </TabButton>
        <TabButton ativo={tab === "projeto"} onClick={() => setTab("projeto")}>Por Projeto</TabButton>
        <TabButton ativo={tab === "kanban"} onClick={() => setTab("kanban")}>Kanban</TabButton>
        <TabButton ativo={tab === "calendario"} onClick={() => setTab("calendario")}>Calendário</TabButton>
        {isMaster && <TabButton ativo={tab === "admin"} onClick={() => setTab("admin")}>Admin Projetos</TabButton>}
        {isMaster && <TabButton ativo={tab === "lixeira"} onClick={() => setTab("lixeira")}>Lixeira</TabButton>}
      </nav>

      {tab === "minhas" && (
        <MinhasTarefasView
          tarefas={minhas}
          projetos={projetos}
          subprojetos={subprojetos}
          onAbrir={setDetalheId}
          pessoaId={pessoa?.id || ""}
          pessoaNome={pessoa?.nome || ""}
        />
      )}

      {tab === "projeto" && (
        <ProjetoView
          projetos={projetos}
          subprojetos={subprojetos}
          projetoFiltro={projetoFiltro}
          setProjetoFiltro={setProjetoFiltro}
          tarefas={tarefasProjeto.filter(t => podeVerTarefa(t, projetos.find(p => p.id === t.projetoId), pessoa))}
          onAbrir={setDetalheId}
        />
      )}

      {tab === "kanban" && (
        <KanbanView
          tarefas={minhas}
          projetos={projetos}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          onAbrir={setDetalheId}
        />
      )}

      {tab === "calendario" && (
        <CalendarioView
          tarefas={minhas}
          projetos={projetos}
          onAbrir={setDetalheId}
        />
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
          onClose={() => setNovaAberta(false)}
          projetos={projetos}
          subprojetos={subprojetos}
          restaurantes={restaurants}
          pessoaId={pessoa?.id || ""}
          pessoaNome={pessoa?.nome || ""}
        />
      )}

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

function ProjetoView({ projetos, subprojetos, projetoFiltro, setProjetoFiltro, tarefas, onAbrir }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  projetoFiltro: string;
  setProjetoFiltro: (id: string) => void;
  tarefas: Tarefa[];
  onAbrir: (id: string) => void;
}) {
  const proj = projetos.find(p => p.id === projetoFiltro);
  return (
    <div>
      <div className="mb-4">
        <select
          value={projetoFiltro}
          onChange={(e) => setProjetoFiltro(e.target.value)}
          className="w-full max-w-md px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        >
          <option value="">— escolha um projeto —</option>
          {projetos.map(p => (
            <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>
          ))}
        </select>
      </div>
      {!proj ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Escolha um projeto pra ver suas tarefas.
        </div>
      ) : (
        <div>
          <div className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            {tarefas.length} tarefa(s) em {proj.nome}
          </div>
          {subprojetos.filter(s => s.projetoId === proj.id).map(sub => {
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
                        autor={{ id: "", nome: "" }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VIEW: Admin de Projetos (master) — CRUD inline ───────────────────────

function AdminView({ projetos, subprojetos, pessoaId }: { projetos: TarefaProjeto[]; subprojetos: TarefaSubprojeto[]; pessoaId: string }) {
  const [criandoProjeto, setCriandoProjeto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoSubId, setEditandoSubId] = useState<string | null>(null);
  const [criandoSubIn, setCriandoSubIn] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

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
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configuração de projetos e subprojetos do gestor. Mexa com cuidado — afeta todas as tarefas.
        </p>
        <div className="flex gap-2">
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
        return (
          <div key={p.id} className="mb-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden" style={{ borderLeftWidth: 4, borderLeftColor: p.cor }}>
            <div className="p-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  {p.emoji} {p.nome}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {p.tipo} · {TAREFA_VISIBILIDADE_LABEL[p.visibilidade]} · {subs.length} subprojeto(s)
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
                    <button onClick={() => deletarSub(s)} className="text-[11px] text-red-500 hover:underline">excluir</button>
                  </div>
                  {editandoSubId === s.id && (
                    <SubprojetoForm
                      sub={s}
                      pessoaId={pessoaId}
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
    visibilidade: "escritorio",
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

function SubprojetoForm({ sub, projetoId, pessoaId, onClose }: {
  sub: TarefaSubprojeto | null;
  projetoId?: string;
  pessoaId: string;
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
    const data: TarefaSubprojeto = {
      id,
      projetoId: f.projetoId || projetoId || "",
      nome: f.nome,
      descricao: f.descricao,
      auto: f.auto ?? false,
      gatilho: f.gatilho,
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

// ─── VIEW: Calendário (mês) ────────────────────────────────────────────────

function CalendarioView({ tarefas, projetos, onAbrir }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  onAbrir: (id: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [mes, setMes] = useState(hoje.slice(0, 7)); // YYYY-MM

  const [ano, m] = mes.split("-").map(Number);
  const primeiroDia = new Date(ano, m - 1, 1);
  const ultimoDia = new Date(ano, m, 0);
  const diasNoMes = ultimoDia.getDate();
  const offset = primeiroDia.getDay(); // 0=Dom

  const tarefasPorDia = new Map<string, Tarefa[]>();
  tarefas.forEach(t => {
    if (!t.prazo) return;
    if (!t.prazo.startsWith(mes)) return;
    const arr = tarefasPorDia.get(t.prazo) || [];
    arr.push(t);
    tarefasPorDia.set(t.prazo, arr);
  });

  const semProprio = tarefas.filter(t => !t.prazo);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => {
            const d = new Date(ano, m - 2, 1);
            setMes(d.toISOString().slice(0, 7));
          }}>‹</Button>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          <Button size="sm" variant="ghost" onClick={() => {
            const d = new Date(ano, m, 1);
            setMes(d.toISOString().slice(0, 7));
          }}>›</Button>
          <Button size="sm" variant="ghost" onClick={() => setMes(hoje.slice(0, 7))}>Hoje</Button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {tarefas.filter(t => t.prazo && t.prazo.startsWith(mes)).length} tarefa(s) no mês
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">
        <div>D</div><div>S</div><div>T</div><div>Q</div><div>Q</div><div>S</div><div>S</div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }).map((_, i) => <div key={"v" + i} />)}
        {Array.from({ length: diasNoMes }).map((_, i) => {
          const dia = i + 1;
          const data = `${mes}-${String(dia).padStart(2, "0")}`;
          const ehHoje = data === hoje;
          const lista = tarefasPorDia.get(data) || [];
          return (
            <div
              key={dia}
              className={`min-h-[40px] md:min-h-[80px] p-1 rounded-md border ${ehHoje ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"} ${lista.length > 0 ? "cursor-pointer md:cursor-default" : ""}`}
              onClick={() => {
                // Mobile: tap no dia abre 1ª tarefa do dia (com aria pra leitor de tela)
                if (window.matchMedia("(max-width: 767px)").matches && lista[0]) {
                  onAbrir(lista[0].id);
                }
              }}
            >
              <div className={`flex items-center justify-between gap-1 text-[10px] font-bold ${ehHoje ? "text-indigo-700 dark:text-indigo-300" : "text-gray-600 dark:text-gray-400"} mb-1`}>
                <span>{dia}</span>
                {lista.length > 0 && (
                  <span className="md:hidden inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-indigo-500 text-white text-[9px]">
                    {lista.length}
                  </span>
                )}
              </div>
              <div className="hidden md:block space-y-0.5">
                {lista.slice(0, 3).map(t => {
                  const proj = projetos.find(p => p.id === t.projetoId);
                  const cor = t.corHerdada || proj?.cor || "#6b7280";
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); onAbrir(t.id); }}
                      className="text-[10px] px-1 py-0.5 rounded cursor-pointer truncate hover:opacity-80"
                      style={{ background: cor + "30", color: cor }}
                      title={t.titulo}
                    >
                      {t.titulo}
                    </div>
                  );
                })}
                {lista.length > 3 && <div className="text-[9px] text-gray-500">+{lista.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {semProprio.length > 0 && (
        <details className="mt-4">
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

function NovaTarefaModal({ onClose, projetos, subprojetos, restaurantes, pessoaId, pessoaNome }: {
  onClose: () => void;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  restaurantes: { id: string; nome: string }[];
  pessoaId: string;
  pessoaNome: string;
}) {
  const [titulo, setTitulo] = useState("");
  const [projetoId, setProjetoId] = useState(projetos[0]?.id || "");
  const [subprojetoId, setSubprojetoId] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("normal");
  const [restaurantIds, setRestaurantIds] = useState<string[]>([]);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const subsDoProjeto = subprojetos.filter(s => s.projetoId === projetoId);
  useEffect(() => {
    if (subsDoProjeto.length > 0 && !subsDoProjeto.find(s => s.id === subprojetoId)) {
      setSubprojetoId(subsDoProjeto[0].id);
    }
  }, [projetoId, subprojetoId, subsDoProjeto]);

  const subAtual = subprojetos.find(s => s.id === subprojetoId);
  const temTemplate = (subAtual?.tarefasTemplate?.length ?? 0) > 0;
  const cor = projetos.find(p => p.id === projetoId)?.cor;

  // Responsável: usa do subprojeto se definido, senão criador
  const responsavelId = subAtual?.responsavelPadraoId || pessoaId;
  const responsavelNome = subAtual?.responsavelPadraoNome || pessoaNome;

  async function salvar() {
    if (!titulo || !projetoId || !subprojetoId) { alert("Preencha título, projeto e subprojeto."); return; }
    setSalvando(true);
    try {
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
      await criarTarefa({
        projetoId, subprojetoId, titulo,
        responsavelId, responsavelNome,
        coResponsaveis: [],
        restaurantIds: restaurantIds.length ? restaurantIds : undefined,
        prazo: prazo || null,
        status: "a_fazer",
        prioridade,
        origem: "manual",
        corHerdada: cor,
        subtarefas: subtarefasFromTemplate,
        criadoPor: pessoaId,
        criadoPorNome: pessoaNome,
      });
      onClose();
    } catch (e) {
      alert("Erro: " + String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">Nova Tarefa</h2>
        <div className="space-y-3">
          <Field label="Título *">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" autoFocus />
          </Field>
          <Field label="Projeto *">
            <select value={projetoId} onChange={(e) => setProjetoId(e.target.value)} className="input">
              {projetos.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>)}
            </select>
          </Field>
          <Field label="Subprojeto *">
            <select value={subprojetoId} onChange={(e) => setSubprojetoId(e.target.value)} className="input">
              {subsDoProjeto.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Field>
          {subAtual?.responsavelPadraoNome && (
            <div className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              Responsável: <span className="font-medium text-gray-700 dark:text-gray-300">{subAtual.responsavelPadraoNome}</span> (padrão do subprojeto)
            </div>
          )}
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
            <Field label="Prazo">
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
        <style>{`.input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-end mt-5">
          <Button onClick={onClose} variant="ghost">Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Criar Tarefa"}</Button>
        </div>
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

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} style={{ borderTopWidth: 6, borderTopColor: cor }}>
        <header className="p-5 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
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
                  className="w-full text-lg font-bold bg-transparent border-b-2 border-indigo-500 text-gray-900 dark:text-gray-100 outline-none"
                />
              ) : (
                <h2
                  onClick={() => setEditandoTitulo(true)}
                  className="text-lg font-bold text-gray-900 dark:text-gray-100 cursor-text hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded px-1 -mx-1"
                  title="Clique pra editar"
                >
                  {tarefa.titulo}
                </h2>
              )}
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
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
                <span>›</span>
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
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
              <select
                value={tarefa.status}
                onChange={(e) => mudarStatusComErro(tarefa.id, e.target.value as TarefaStatus, autor)}
                className="mt-1 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              >
                {(Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[]).map(s =>
                  <option key={s} value={s}>{TAREFA_STATUS_LABEL[s]}</option>
                )}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Prioridade</div>
              <select
                value={tarefa.prioridade}
                onChange={(e) => salvarCampo("prioridade", e.target.value as TarefaPrioridade, "prioridade")}
                className="mt-1 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              >
                {(Object.keys(TAREFA_PRIORIDADE_LABEL) as TarefaPrioridade[]).map(p =>
                  <option key={p} value={p}>{TAREFA_PRIORIDADE_LABEL[p]}</option>
                )}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Prazo</div>
              <input
                type="date"
                value={tarefa.prazo || ""}
                onChange={(e) => salvarCampo("prazo", e.target.value || null, "prazo")}
                className="mt-1 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Responsável</div>
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
                className="mt-1 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              >
                {!pessoasLista.find(p => p.id === tarefa.responsavelId) && tarefa.responsavelNome && (
                  <option value={tarefa.responsavelId}>{tarefa.responsavelNome} (atual)</option>
                )}
                {pessoasLista.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Co-responsáveis</div>
              <CoRespPicker
                tarefa={tarefa}
                pessoas={pessoasLista}
                autor={autor}
              />
            </div>
            <div className="col-span-2">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Empresa(s)</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {restaurants.map(r => {
                  const sel = (tarefa.restaurantIds || []).includes(r.id);
                  return (
                    <label key={r.id} className="flex items-center gap-1 text-xs">
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
            </div>
            <div className="col-span-2">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-2">
                Visibilidade
                {isConfidencial(tarefa, projeto) && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                    🔒 confidencial
                  </span>
                )}
              </div>
              <select
                value={tarefa.visibilidadeOverride || ""}
                onChange={(e) => {
                  const v = e.target.value as TarefaVisibilidade | "";
                  salvarCampo("visibilidadeOverride", (v || undefined) as Tarefa["visibilidadeOverride"], "visibilidade");
                }}
                className="mt-1 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              >
                <option value="">— herda do projeto ({projeto && TAREFA_VISIBILIDADE_LABEL[projeto.visibilidade]}) —</option>
                {(Object.keys(TAREFA_VISIBILIDADE_LABEL) as TarefaVisibilidade[]).map(v =>
                  <option key={v} value={v}>{TAREFA_VISIBILIDADE_LABEL[v]}</option>
                )}
              </select>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 mb-1">
                Pessoas autorizadas (acesso explícito além da visibilidade):
              </div>
              <UsuariosAutorizadosPicker
                ids={tarefa.usuariosAutorizados || []}
                pessoas={pessoasLista}
                excluir={[tarefa.responsavelId, ...(tarefa.coResponsaveis || [])]}
                onChange={(ids) => salvarCampo("usuariosAutorizados", ids.length ? ids : undefined, "autorizados")}
              />
            </div>
            <div className="col-span-2 flex gap-3 text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
              <div>Origem: <span className="text-gray-700 dark:text-gray-300">{TAREFA_ORIGEM_LABEL[tarefa.origem]}</span></div>
              {tarefa.origemRefLabel && <div>· {tarefa.origemRefLabel}</div>}
            </div>
          </div>

          {/* Custom fields tipados do subprojeto */}
          <CustomFieldsSection tarefa={tarefa} subprojetos={subprojetos} autor={autor} />

          {/* Descrição editável */}
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Descrição</div>
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
                rows={4}
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

          {/* Subtarefas */}
          <SubtarefasSection
            tarefa={tarefa}
            autor={autor}
            novaSubtarefa={novaSubtarefa}
            setNovaSubtarefa={setNovaSubtarefa}
            addSubtarefa={addSubtarefa}
          />

          {/* Comentários */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Comentários
            </h3>
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
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={novoComentario}
                onChange={(e) => setNovoComentario(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addComentario()}
                placeholder="Comentar… use @nome pra mencionar"
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
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

          {/* Anexos */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Anexos {tarefa.anexos && tarefa.anexos.length > 0 && `(${tarefa.anexos.length})`}
            </h3>
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

          {/* Log */}
          <details>
            <summary className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer">
              Log de atividade ({tarefa.log?.length || 0})
            </summary>
            <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
              {(tarefa.log || []).slice().reverse().map(l => (
                <div key={l.id}>
                  <span className="font-medium">{l.autorNome}</span> {l.acao.replace(/_/g, " ")}
                  {l.detalhe && `: ${l.detalhe}`}
                  <span className="ml-2 text-gray-400">{l.em.slice(0, 16).replace("T", " ")}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
        <footer className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              const motivo = prompt("Motivo (opcional):");
              if (motivo !== null) {
                softDeleteTarefa(tarefa.id, autor, motivo || undefined);
                onClose();
              }
            }}
          >🗑️ Excluir</Button>
          <Button onClick={onClose}>Fechar</Button>
        </footer>
      </div>
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
              onChange={(e) => marcarSubtarefa(tarefa.id, st.id, e.target.checked, autor)}
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
