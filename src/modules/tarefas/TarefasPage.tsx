// Página principal do Gestor de Tarefas.
// Tabs: Minhas Tarefas (default) · Por Projeto · Admin (master) · Lixeira (master).
//
// Caixa POR USUÁRIO: Minhas Tarefas = onde sou responsável OU co-responsável,
// independente do restaurante selecionado no topo.

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import {
  ouvirProjetos, ouvirSubprojetos, ouvirTarefasDeUsuario, ouvirTarefasDeProjeto,
  ouvirLixeira, criarTarefa, mudarStatus, softDeleteTarefa, restaurarTarefa,
  marcarSubtarefa, adicionarComentario, atualizarTarefa,
} from "./repository";
import { seedProjetosIniciais } from "./seed";
import { gerarTarefasDoDia } from "./generator";
import type {
  Tarefa, TarefaProjeto, TarefaSubprojeto, TarefaStatus, TarefaPrioridade,
} from "../../core/types";
import {
  TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL, TAREFA_ORIGEM_LABEL,
} from "../../core/types";

type Tab = "minhas" | "projeto" | "admin" | "lixeira";

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

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
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
          tarefas={tarefasProjeto}
          onAbrir={setDetalheId}
        />
      )}

      {tab === "admin" && isMaster && (
        <AdminView
          projetos={projetos}
          subprojetos={subprojetos}
        />
      )}

      {tab === "lixeira" && isMaster && (
        <LixeiraView
          tarefas={lixeira}
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
        <DetalheModal
          tarefa={tarefaSelecionada}
          projetos={projetos}
          subprojetos={subprojetos}
          autor={{ id: pessoa?.id || "", nome: pessoa?.nome || "" }}
          onClose={() => setDetalheId(null)}
        />
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
  const [filtroStatus, setFiltroStatus] = useState<TarefaStatus | "todos" | "ativas">("ativas");

  const filtradas = useMemo(() => {
    let l = tarefas;
    if (filtroStatus === "ativas") {
      l = l.filter(t => t.status === "a_fazer" || t.status === "em_andamento");
    } else if (filtroStatus !== "todos") {
      l = l.filter(t => t.status === filtroStatus);
    }
    return l.sort((a, b) => {
      // Prazo asc; sem prazo no final
      if (!a.prazo && !b.prazo) return 0;
      if (!a.prazo) return 1;
      if (!b.prazo) return -1;
      return a.prazo.localeCompare(b.prazo);
    });
  }, [tarefas, filtroStatus]);

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
      <div className="flex gap-2 mb-3 text-sm">
        <FiltroChip ativo={filtroStatus === "ativas"} onClick={() => setFiltroStatus("ativas")}>Ativas</FiltroChip>
        <FiltroChip ativo={filtroStatus === "a_fazer"} onClick={() => setFiltroStatus("a_fazer")}>A fazer</FiltroChip>
        <FiltroChip ativo={filtroStatus === "em_andamento"} onClick={() => setFiltroStatus("em_andamento")}>Em andamento</FiltroChip>
        <FiltroChip ativo={filtroStatus === "concluida"} onClick={() => setFiltroStatus("concluida")}>Concluídas</FiltroChip>
        <FiltroChip ativo={filtroStatus === "todos"} onClick={() => setFiltroStatus("todos")}>Todas</FiltroChip>
      </div>
      <div className="space-y-2">
        {filtradas.map(t => (
          <TarefaCard
            key={t.id}
            tarefa={t}
            projetos={projetos}
            subprojetos={subprojetos}
            onAbrir={() => onAbrir(t.id)}
            autor={{ id: pessoaId, nome: pessoaNome }}
          />
        ))}
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
          onClick={(e) => { e.stopPropagation(); mudarStatus(tarefa.id, concluida ? "a_fazer" : "concluida", autor); }}
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
          <div className={`font-medium text-gray-900 dark:text-gray-100 ${concluida ? "line-through" : ""}`}>
            {tarefa.titulo}
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

// ─── VIEW: Admin de Projetos (master) ─────────────────────────────────────

function AdminView({ projetos, subprojetos }: { projetos: TarefaProjeto[]; subprojetos: TarefaSubprojeto[] }) {
  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Configuração de projetos e subprojetos. Edição inline em breve — por ora, esta view é só leitura.
      </p>
      {projetos.map(p => {
        const subs = subprojetos.filter(s => s.projetoId === p.id);
        return (
          <details key={p.id} className="mb-2 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" style={{ borderLeftWidth: 4, borderLeftColor: p.cor }}>
            <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-100">
              {p.emoji} {p.nome}
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">
                {p.tipo} · {p.visibilidade} · {subs.length} subprojeto(s)
              </span>
            </summary>
            <ul className="mt-2 pl-4 space-y-1 text-sm">
              {subs.map(s => (
                <li key={s.id} className="text-gray-700 dark:text-gray-300">
                  ▸ {s.nome}
                  {s.auto && <span className="ml-2 text-[10px] text-green-700 dark:text-green-300 px-1 py-0.5 rounded bg-green-50 dark:bg-green-900/30">auto</span>}
                  {s.gatilho && <span className="block ml-3 text-[11px] italic text-gray-500 dark:text-gray-500">{s.gatilho}</span>}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

// ─── VIEW: Lixeira (master) ───────────────────────────────────────────────

function LixeiraView({ tarefas, projetos, autor }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  autor: { id: string; nome: string };
}) {
  if (tarefas.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">🗑️ Lixeira vazia.</div>;
  }
  return (
    <div className="space-y-2">
      {tarefas.map(t => {
        const proj = projetos.find(p => p.id === t.projetoId);
        return (
          <div key={t.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
            <div className="font-medium text-gray-900 dark:text-gray-100 line-through">{t.titulo}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {proj?.emoji} {proj?.nome} · deletada em {t.deletadoEm?.slice(0, 10)}
              {t.motivoDelete && ` · motivo: ${t.motivoDelete}`}
            </div>
            <div className="mt-2">
              <Button size="sm" onClick={() => restaurarTarefa(t.id, autor)}>Restaurar</Button>
            </div>
          </div>
        );
      })}
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
  // MVP: responsável fixo no criador. Trocar responsável é via Detalhe da Tarefa.
  const responsavelId = pessoaId;
  const responsavelNome = pessoaNome;
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("normal");
  const [restaurantIds, setRestaurantIds] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const subsDoProjeto = subprojetos.filter(s => s.projetoId === projetoId);
  useEffect(() => {
    if (subsDoProjeto.length > 0 && !subsDoProjeto.find(s => s.id === subprojetoId)) {
      setSubprojetoId(subsDoProjeto[0].id);
    }
  }, [projetoId, subprojetoId, subsDoProjeto]);

  const cor = projetos.find(p => p.id === projetoId)?.cor;

  async function salvar() {
    if (!titulo || !projetoId || !subprojetoId) { alert("Preencha título, projeto e subprojeto."); return; }
    setSalvando(true);
    try {
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
  const sub = subprojetos.find(s => s.id === tarefa.subprojetoId);
  const cor = tarefa.corHerdada || projeto?.cor || "#6b7280";

  const [novaSubtarefa, setNovaSubtarefa] = useState("");
  const [novoComentario, setNovoComentario] = useState("");

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
    await adicionarComentario(tarefa.id, novoComentario.trim(), autor);
    setNovoComentario("");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} style={{ borderTopWidth: 6, borderTopColor: cor }}>
        <header className="p-5 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{tarefa.titulo}</h2>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {projeto?.emoji} {projeto?.nome} › {sub?.nome}
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
                onChange={(e) => mudarStatus(tarefa.id, e.target.value as TarefaStatus, autor)}
                className="mt-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
              >
                {(Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[]).map(s =>
                  <option key={s} value={s}>{TAREFA_STATUS_LABEL[s]}</option>
                )}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Responsável</div>
              <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">{tarefa.responsavelNome || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Prazo</div>
              <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">{tarefa.prazo || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Prioridade</div>
              <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">{TAREFA_PRIORIDADE_LABEL[tarefa.prioridade]}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Origem</div>
              <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">{TAREFA_ORIGEM_LABEL[tarefa.origem]}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Empresa(s)</div>
              <div className="font-medium text-gray-900 dark:text-gray-100 mt-1">{(tarefa.restaurantIds || []).join(", ") || "—"}</div>
            </div>
          </div>

          {tarefa.descricao && (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Descrição</div>
              <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{tarefa.descricao}</div>
            </div>
          )}

          {/* Subtarefas */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Subtarefas {tarefa.subtarefas && tarefa.subtarefas.length > 0 && `(${tarefa.subtarefas.filter(s => s.feito).length}/${tarefa.subtarefas.length})`}
            </h3>
            <div className="space-y-1">
              {(tarefa.subtarefas || []).map(st => (
                <label key={st.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={st.feito}
                    onChange={(e) => marcarSubtarefa(tarefa.id, st.id, e.target.checked, autor)}
                  />
                  <span className={st.feito ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-300"}>
                    {st.texto}
                  </span>
                </label>
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

          {/* Comentários */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Comentários
            </h3>
            <div className="space-y-2">
              {(tarefa.comentarios || []).map(c => (
                <div key={c.id} className="text-sm bg-gray-50 dark:bg-gray-800/50 p-2 rounded-md">
                  <div className="font-medium text-gray-900 dark:text-gray-100 text-xs">{c.autorNome}</div>
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
                placeholder="Comentar…"
                className="flex-1 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
              />
              <Button size="sm" onClick={addComentario}>Enviar</Button>
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
