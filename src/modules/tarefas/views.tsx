import { useEffect, useState, useMemo, type ReactNode } from "react";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { usePessoasAtivasLista } from "../../core/pessoas/PessoasContext";
import { softDeleteTarefa, restaurarTarefa, atualizarTarefa, marcarSubtarefa } from "./repository";
import { type Tarefa, type TarefaProjeto, type TarefaSubprojeto, type Subtarefa, type TarefaStatus, TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL, TAREFA_ORIGEM_LABEL } from "../../core/types";
import { fmtBR } from "../../core/utils/date";
import { isConfidencial } from "./visibilidade";
import { AvatarIniciais, EmpresaBadge, FiltroChip, type ViewMode, ViewSwitcher, catDaTarefa, ehAreaPrazos, inicioSemanaSeg, mudarStatusComErro } from "./helpers";
import { EscolhaRestauranteModal } from "./modais";

// Sidebar lateral (estilo Asana) — atalho "Minhas tarefas" no topo + lista
// de projetos como accordion (click expande mostrando subprojetos inline,
// sem abrir uma 2ª coluna duplicada).
// Barra horizontal no topo (substitui a antiga sidebar lateral) — libera a
// largura pro calendário/kanban. "Minhas tarefas" + projetos como chips; os
// subprojetos do projeto ativo aparecem numa 2ª linha.
export function ProjetosTopBar({
  tabAtual, projetoFiltroAtual, subFiltroAtual, minhasPendentes,
  projetos, subprojetos, tarefasProjeto,
  onAbrirMinhas, onAbrirTudo, onAbrirProjeto, onAbrirSubprojeto,
}: {
  tabAtual: string;
  projetoFiltroAtual: string;
  subFiltroAtual: string;
  minhasPendentes: number;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  tarefasProjeto: Tarefa[];
  onAbrirMinhas: () => void;
  onAbrirTudo: () => void;
  onAbrirProjeto: (id: string) => void;
  onAbrirSubprojeto: (projetoId: string, subId: string) => void;
}) {
  const ativas = (ts: Tarefa[]) => ts.filter(t => t.status !== "concluida" && t.status !== "cancelada").length;
  // A área "Prazos" já sai filtrada na fonte (módulo Prazos dedicado); mantém
  // defesa-em-profundidade caso projetos venha de outra origem.
  const projTarefas = projetos.filter(p => !ehAreaPrazos(p));
  const subs = tabAtual === "projeto" && projetoFiltroAtual ? subprojetos.filter(s => s.projetoId === projetoFiltroAtual) : [];
  const chip = (active: boolean) => `shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`;
  const rotulo = "shrink-0 w-[70px] text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500";
  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className={rotulo}>Tarefas</span>
        <button onClick={onAbrirMinhas} className={chip(tabAtual === "minhas")}>
          📥 Minhas
          {minhasPendentes > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold">{minhasPendentes}</span>}
        </button>
        <button onClick={onAbrirTudo} className={chip(tabAtual === "tudo")}>🗂️ Tudo</button>
        {projTarefas.map(p => (
          <button key={p.id} onClick={() => onAbrirProjeto(p.id)} className={chip(tabAtual === "projeto" && projetoFiltroAtual === p.id)} title={p.nome}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.cor || "#6b7280" }} />
            <span>{p.emoji || "📁"}</span>
            <span className="whitespace-nowrap">{p.nome}</span>
          </button>
        ))}
      </div>

      {subs.length > 0 && (
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

export function MinhasTarefasView({ tarefas, projetos, subprojetos, onAbrir, pessoaId, pessoaNome }: {
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

  // Subtarefas datadas do RESPONSÁVEL (viewer) — aparecem como itens do dia a dia
  // na lista, interleaved por data com as tarefas. Abrem a tarefa-mãe.
  const subLista = useMemo(() => {
    if (!pessoaId) return [] as Array<{ t: Tarefa; sub: Subtarefa }>;
    const b = busca.trim().toLowerCase();
    const out: Array<{ t: Tarefa; sub: Subtarefa }> = [];
    for (const t of tarefas) {
      if (filtroProjeto && t.projetoId !== filtroProjeto) continue;
      if (filtroEmpresa && !(t.restaurantIds || []).includes(filtroEmpresa)) continue;
      for (const sub of (t.subtarefas || [])) {
        if (sub.responsavelId !== pessoaId || !sub.prazo) continue;
        if (filtroStatus === "ativas" && sub.feito) continue;
        else if (filtroStatus === "atrasadas" && !(sub.prazo < hoje && !sub.feito)) continue;
        else if (filtroStatus === "hoje" && !(sub.prazo === hoje && !sub.feito)) continue;
        else if (filtroStatus === "semana" && !(sub.prazo >= hoje && sub.prazo <= daquiSeteDias && !sub.feito)) continue;
        else if (filtroStatus === "a_fazer" && sub.feito) continue;
        else if (filtroStatus === "concluida" && !sub.feito) continue;
        else if (filtroStatus === "em_andamento" || filtroStatus === "cancelada") continue;
        if (b && !sub.texto.toLowerCase().includes(b) && !t.titulo.toLowerCase().includes(b)) continue;
        out.push({ t, sub });
      }
    }
    return out;
  }, [tarefas, pessoaId, filtroStatus, busca, filtroProjeto, filtroEmpresa, hoje, daquiSeteDias]);

  const itensLista = useMemo(() => {
    const arr: Array<{ kind: "tarefa"; t: Tarefa; d: string } | { kind: "sub"; t: Tarefa; sub: Subtarefa; d: string }> = [
      ...filtradas.map(t => ({ kind: "tarefa" as const, t, d: t.prazo || "9999-99-99" })),
      ...subLista.map(({ t, sub }) => ({ kind: "sub" as const, t, sub, d: sub.prazo || "9999-99-99" })),
    ];
    return arr.sort((a, b) => a.d.localeCompare(b.d));
  }, [filtradas, subLista]);

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
            <div className="text-gray-500 dark:text-gray-400 mb-1">Área</div>
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

      {itensLista.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          Nenhuma tarefa com esses filtros.
        </div>
      ) : (
        <div className="space-y-2 pb-20">
          {itensLista.map(item => {
            if (item.kind === "sub") {
              const { t, sub } = item;
              return (
                <div key={`${t.id}::${sub.id}`} onClick={() => onAbrir(t.id)} className="flex items-center gap-2 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2 cursor-pointer hover:shadow-sm">
                  <input type="checkbox" checked={!!sub.feito} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); void marcarSubtarefa(t.id, sub.id, e.target.checked, { id: pessoaId, nome: pessoaNome }); }} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium text-gray-900 dark:text-gray-100 truncate ${sub.feito ? "line-through opacity-60" : ""}`}>{sub.texto}</div>
                    <div className="text-[11px] text-indigo-500 dark:text-indigo-300 truncate">↳ {t.titulo}{sub.prazo ? ` · ${fmtBR(sub.prazo)}` : ""}</div>
                  </div>
                </div>
              );
            }
            const t = item.t;
            return (
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
            );
          })}
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
  const pessoas = usePessoasAtivasLista();
  const [trocandoResp, setTrocandoResp] = useState(false);
  const [autorizando, setAutorizando] = useState(false);

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
        p-3 rounded-xl border transition-all
        ${concluida ? "opacity-60" : ""}
        bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 cursor-pointer hover:shadow-md
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
            <EmpresaBadge ids={tarefa.restaurantIds} />
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
        {tarefa.responsavelNome && <AvatarIniciais nome={tarefa.responsavelNome} id={tarefa.responsavelId} className="mt-0.5" />}
      </div>
    </div>
  );
}

// ─── VIEW: Por Projeto ────────────────────────────────────────────────────

export function ProjetoView({ projetos, subprojetos, projetoFiltro, subFiltro, tarefas, onAbrir, view, onChangeView, autor, onNovaTarefa, acoes, busca }: {
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
  acoes?: ReactNode;
  busca?: ReactNode;
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
            <span className="hidden md:inline">Escolha uma área na lateral pra ver suas tarefas.</span>
            <span className="md:hidden">Escolha uma área acima pra ver suas tarefas.</span>
          </div>
        ) : (
          <>
            <div className="mb-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
              <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                {proj.emoji} {proj.nome}{subAtual && <span className="text-gray-400 dark:text-gray-500 font-normal"> · {subAtual.nome}</span>}
              </h2>
              <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {tarefasFiltradas.length} tarefa(s) · {ativas(tarefasFiltradas)} ativas
              </span>
              <div className="flex-1" />
              <div className="[&>div]:!mb-0"><ViewSwitcher value={view} onChange={onChangeView} /></div>
            </div>
            {(busca || acoes) && (
              <div className="mb-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
                {busca}
                <div className="flex-1" />
                {acoes}
              </div>
            )}

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
          Projeto automático
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

export function KanbanView({ tarefas, projetos, autor, onAbrir }: {
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
                    className="p-2 rounded-lg border transition-shadow bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-md"
                    style={{ borderLeftWidth: 3, borderLeftColor: cor }}
                  >
                    <div className="flex items-start gap-1.5">
                      <div className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">{t.titulo}</div>
                      {t.responsavelNome && <AvatarIniciais nome={t.responsavelNome} id={t.responsavelId} size={18} />}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap text-[10px] text-gray-500 dark:text-gray-400">
                      {proj && <span style={{ color: cor }}>{proj.emoji}</span>}
                      {t.prazo && <span>📅 {fmtBR(t.prazo)}</span>}
                      <EmpresaBadge ids={t.restaurantIds} />
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

export function CalendarioView({ tarefas, projetos, onAbrir, autor, onNovaTarefaNoDia, onIdeiaNoDia }: {
  tarefas: Tarefa[];
  projetos: TarefaProjeto[];
  subprojetos?: TarefaSubprojeto[];
  onAbrir: (id: string) => void;
  autor?: { id: string; nome: string };
  // Quando chamado com `prazo`, vai pra aquele dia; sem args, cria sem data.
  onNovaTarefaNoDia?: (prazo?: string) => void;
  // Arrastou uma ideia (da Caixa de ideias) pra um dia → abre o modal de nova
  // tarefa naquele dia, já com título/descrição da ideia.
  onIdeiaNoDia?: (ideia: { id: string; titulo: string; descricao: string }, prazo: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [semanaInicio, setSemanaInicio] = useState<string>(() => inicioSemanaSeg(hoje));
  // Fim de semana opt-in por dia (Sáb / Dom separados). Lembra a escolha por usuário.
  const [mostrarSab, setMostrarSab] = useState<boolean>(() => { try { return localStorage.getItem("tarefas_cal_sab") === "1"; } catch { return false; } });
  const [mostrarDom, setMostrarDom] = useState<boolean>(() => { try { return localStorage.getItem("tarefas_cal_dom") === "1"; } catch { return false; } });
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
  // Reordena dentro de um dia (arrasto vertical): insere a tarefa arrastada
  // antes de `antesDeId` (ou no fim se null) e regrava ordemDia de todo o dia.
  async function reordenarNoDia(id: string, dia: string, antesDeId: string | null) {
    if (!autor || id.includes("::")) return;   // derivado não reordena/persiste
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
  useEffect(() => { try { localStorage.setItem("tarefas_cal_sab", mostrarSab ? "1" : "0"); localStorage.setItem("tarefas_cal_dom", mostrarDom ? "1" : "0"); } catch {} }, [mostrarSab, mostrarDom]);

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

  // Subtarefas datadas do RESPONSÁVEL (o viewer) viram itens no dia delas — cada
  // uma abre a tarefa-mãe. Só as do próprio usuário (as dos outros ficam na mãe).
  const subsPorDia = new Map<string, Array<{ tarefa: Tarefa; sub: Subtarefa }>>();
  if (autor?.id) {
    tarefas.forEach(t => {
      (t.subtarefas || []).forEach(sub => {
        if (!sub.prazo || !dias.includes(sub.prazo) || sub.responsavelId !== autor.id) return;
        const arr = subsPorDia.get(sub.prazo) || [];
        arr.push({ tarefa: t, sub });
        subsPorDia.set(sub.prazo, arr);
      });
    });
    subsPorDia.forEach(arr => arr.sort((a, b) => Number(a.sub.feito) - Number(b.sub.feito) || (a.tarefa.titulo || "").localeCompare(b.tarefa.titulo || "")));
  }

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

  const sabQtd = (tarefasPorDia.get(dias[5]) || []).length;
  const domQtd = (tarefasPorDia.get(dias[6]) || []).length;

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
        onDragOver={(podeArrastar || onIdeiaNoDia) ? (e) => {
          e.preventDefault();
          const ehIdeia = e.dataTransfer.types.includes("application/x-ideia");
          e.dataTransfer.dropEffect = ehIdeia ? "copy" : "move";
          if (dropTarget !== data) setDropTarget(data);
        } : undefined}
        onDragLeave={(podeArrastar || onIdeiaNoDia) ? () => {
          if (dropTarget === data) setDropTarget(null);
        } : undefined}
        onDrop={(podeArrastar || onIdeiaNoDia) ? (e) => {
          e.preventDefault();
          setDropTarget(null);
          setDraggingId(null);
          // Ideia arrastada da Caixa de ideias → vira tarefa neste dia.
          const rawIdeia = e.dataTransfer.getData("application/x-ideia");
          if (rawIdeia && onIdeiaNoDia) {
            try { const i = JSON.parse(rawIdeia); if (i?.id) onIdeiaNoDia(i, data); } catch { /* payload inválido */ }
            return;
          }
          const id = e.dataTransfer.getData("text/plain");
          if (id) reordenarNoDia(id, data, null);
        } : undefined}
        title={feriadoNome ? `Feriado: ${feriadoNome}` : undefined}
        className={`flex flex-col min-h-[220px] rounded-lg border p-2 transition-colors ${
          ehAlvo
            ? "border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700 bg-indigo-50 dark:bg-indigo-900/30"
            : ehHoje
              ? "border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20"
              : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/30"
        }`}
      >
        <div className={`flex items-baseline justify-between mb-1.5 pb-1.5 border-b ${ehHoje ? "border-indigo-200 dark:border-indigo-900/50" : "border-gray-100 dark:border-gray-800"}`}>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${ehHoje ? "text-indigo-600 dark:text-indigo-400" : naoUtil ? "text-rose-500/70 dark:text-rose-400/70" : "text-gray-400 dark:text-gray-500"}`}>{label}</div>
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
            // Faixa esquerda = PRIORIDADE (sempre visível; área fica no badge).
            const prioC = t.prioridade === "urgente" ? "#e11d48" : t.prioridade === "alta" ? "#f59e0b" : t.prioridade === "baixa" ? "#94a3b8" : "#cbd5e1";
            const temPrio = !!t.prioridade && t.prioridade !== "normal";
            const concluida = t.status === "concluida";
            const arrastando = draggingId === t.id;
            const arrastavel = podeArrastar;
            return (
              <button
                key={t.id}
                draggable={arrastavel}
                onDragStart={arrastavel ? (e) => {
                  e.dataTransfer.setData("text/plain", t.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(t.id);
                } : undefined}
                onDragEnd={podeArrastar ? () => {
                  setDraggingId(null);
                  setDropTarget(null);
                  setDropAntes(null);
                } : undefined}
                onDragOver={(podeArrastar || onIdeiaNoDia) ? (e) => {
                  e.preventDefault(); e.stopPropagation();
                  const ehIdeia = e.dataTransfer.types.includes("application/x-ideia");
                  e.dataTransfer.dropEffect = ehIdeia ? "copy" : "move";
                  if (!ehIdeia && draggingId !== t.id && dropAntes !== t.id) setDropAntes(t.id);
                } : undefined}
                onDragLeave={(podeArrastar || onIdeiaNoDia) ? () => { if (dropAntes === t.id) setDropAntes(null); } : undefined}
                onDrop={(podeArrastar || onIdeiaNoDia) ? (e) => {
                  e.preventDefault(); e.stopPropagation();
                  setDropAntes(null); setDropTarget(null); setDraggingId(null);
                  const rawIdeia = e.dataTransfer.getData("application/x-ideia");
                  if (rawIdeia && onIdeiaNoDia) {
                    try { const i = JSON.parse(rawIdeia); if (i?.id) onIdeiaNoDia(i, data); } catch { /* payload inválido */ }
                    return;
                  }
                  const id = e.dataTransfer.getData("text/plain");
                  if (id && id !== t.id) reordenarNoDia(id, data, t.id);
                } : undefined}
                onClick={() => onAbrir(t.id)}
                className={`relative w-full text-left text-[11px] px-2 py-1.5 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-100 hover:shadow-sm transition-shadow ${concluida ? "line-through opacity-60" : ""} ${arrastando ? "opacity-40" : ""} ${dropAntes === t.id ? "ring-2 ring-indigo-400 ring-offset-1" : ""} ${podeArrastar ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ borderLeftWidth: 4, borderLeftColor: prioC }}
                title={podeArrastar ? `${t.titulo} (arrastar pra mover)` : t.titulo}
              >
                {t.responsavelNome && <AvatarIniciais nome={t.responsavelNome} id={t.responsavelId} size={16} className="absolute top-1 right-1" />}
                <div className="font-medium leading-snug line-clamp-2 mb-1 pr-4">{t.titulo}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {temPrio && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[8px] font-bold uppercase tracking-wide" style={{ color: prioC, background: prioC + "22" }}>
                      ● {TAREFA_PRIORIDADE_LABEL[t.prioridade]}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[8px] font-bold uppercase tracking-wide text-white" style={{ background: meta.cor }}>
                    {meta.icon} {meta.label}
                  </span>
                  <EmpresaBadge ids={t.restaurantIds} />
                </div>
              </button>
            );
          })}
          {(subsPorDia.get(data) || []).map(({ tarefa, sub }) => (
            <div
              key={`${tarefa.id}::${sub.id}`}
              onClick={() => onAbrir(tarefa.id)}
              className={`relative w-full text-left text-[11px] px-2 py-1.5 rounded-md bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-gray-800 dark:text-gray-100 hover:shadow-sm transition-shadow cursor-pointer ${sub.feito ? "line-through opacity-60" : ""}`}
              style={{ borderLeftWidth: 4, borderLeftColor: "#6366f1" }}
              title={`${sub.texto} — de: ${tarefa.titulo}`}
            >
              <div className="flex items-start gap-1.5">
                {autor && (
                  <input type="checkbox" checked={!!sub.feito} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); void marcarSubtarefa(tarefa.id, sub.id, e.target.checked, autor); }} className="mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-medium leading-snug line-clamp-2">{sub.texto}</div>
                  <div className="text-[8px] uppercase tracking-wide text-indigo-500 dark:text-indigo-300 truncate">↳ {tarefa.titulo}</div>
                </div>
              </div>
            </div>
          ))}
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => navegarSemanas(-1)} title="Semana anterior" className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">‹</button>
          <input type="date" value={dias[0]} onChange={e => e.target.value && setSemanaInicio(inicioSemanaSeg(e.target.value))} title="Ir para uma data" className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5" />
          <button type="button" onClick={() => navegarSemanas(1)} title="Próxima semana" className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">›</button>
          {dias[0] !== inicioSemanaSeg(hoje) && <button type="button" onClick={() => setSemanaInicio(inicioSemanaSeg(hoje))} className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 px-2 py-1.5 hover:underline">Hoje</button>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {semProprio.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">📭 Sem data ({semProprio.length})</span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Fim de semana</span>
          {([["Sáb", mostrarSab, setMostrarSab, sabQtd], ["Dom", mostrarDom, setMostrarDom, domQtd]] as const).map(([lbl, on, set, qtd]) => (
            <button key={lbl} type="button" onClick={() => set(v => !v)} title={!on && qtd > 0 ? `${qtd} tarefa(s) no ${lbl.toLowerCase()} escondida(s)` : `Mostrar ${lbl.toLowerCase()}`}
              className={`relative inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              {lbl}{!on && qtd > 0 && <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-rose-500 border-2 border-white dark:border-gray-900" />}
            </button>
          ))}
          <span className="text-xs text-gray-500 dark:text-gray-400">{totalSemana} tarefa(s)</span>
        </div>
      </div>

      {/* Grid de dias — Seg–Sex + Sáb/Dom conforme os toggles (opt-in) */}
      <div className={`grid gap-2 grid-cols-2 sm:grid-cols-3 ${(5 + (mostrarSab ? 1 : 0) + (mostrarDom ? 1 : 0)) === 7 ? "md:grid-cols-7" : (5 + (mostrarSab ? 1 : 0) + (mostrarDom ? 1 : 0)) === 6 ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
        {dias.slice(0, 5).map((d, i) => renderDia(d, labelsDoW[i], i))}
        {mostrarSab && renderDia(dias[5], labelsDoW[5], 5)}
        {mostrarDom && renderDia(dias[6], labelsDoW[6], 6)}
      </div>

      {/* Atrasadas */}
      {atrasadas.length > 0 && (
        <details className="mt-4" open>
          <summary className="text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">
            🔥 {atrasadas.length} atrasada(s)
          </summary>
          <div className="mt-2 space-y-1 text-sm">
            {podeArrastar && <div className="text-[10px] text-gray-400 mb-1">Arraste uma atrasada pra um dia da semana pra reagendar.</div>}
            {atrasadas.slice(0, 20).map(t => {
              const proj = projetos.find(p => p.id === t.projetoId);
              const cor = t.corHerdada || proj?.cor || "#6b7280";
              const arrastavel = podeArrastar && !t.id.includes("::");
              return (
                <div key={t.id}
                  draggable={arrastavel}
                  onDragStart={arrastavel ? (e) => {
                    e.dataTransfer.setData("text/plain", t.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingId(t.id);
                  } : undefined}
                  onDragEnd={arrastavel ? () => { setDraggingId(null); setDropTarget(null); setDropAntes(null); } : undefined}
                  onClick={() => onAbrir(t.id)}
                  className={`p-2 rounded-md border hover:shadow-sm flex items-center gap-2 bg-white dark:bg-gray-900 border-rose-200 dark:border-rose-900/40 ${arrastavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${draggingId === t.id ? "opacity-50" : ""}`}
                  style={{ borderLeftWidth: 3, borderLeftColor: cor }}>
                  {arrastavel && <span className="text-gray-300 dark:text-gray-600 select-none" title="Arraste pra um dia">⠿</span>}
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

export function LixeiraView({ tarefas, projetos, autor }: {
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

