import { useEffect, useState, useMemo } from "react";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { useTodasPessoas, usePessoasAtivasLista } from "../../core/pessoas/PessoasContext";
import { salvarProjeto, salvarSubprojeto, contarTarefasDoSubprojeto, moverSubprojetoParaProjeto, ouvirAutomacoes, salvarAutomacao, propagarAutomacaoEmAbertas } from "./repository";
import { MODULES } from "../../config/modules";
import { type TarefaProjeto, type TarefaSubprojeto, type TarefaVisibilidade, type TarefaTemplate, type TarefaCustomField, type TarefaCustomFieldTipo, type TarefaAutomacao, type ModuloOrigemTarefa, TAREFA_ORIGEM_LABEL, TAREFA_VISIBILIDADE_LABEL, RECORRENCIA_TIPO_LABEL, TAREFA_CUSTOM_FIELD_TIPO_LABEL, MODULOS_ORIGEM_TAREFA } from "../../core/types";
import { PessoasMultiPicker, UsuariosAutorizadosPicker, ehAreaPrazos } from "./helpers";
import { ImportadorModal } from "./modais";

export function AdminView({ projetos, subprojetos, pessoaId }: {
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  pessoaId: string;
}) {
  const [criandoProjeto, setCriandoProjeto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoSubId, setEditandoSubId] = useState<string | null>(null);
  const [criandoSubIn, setCriandoSubIn] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const _todasPessoas = useTodasPessoas();
  const pessoasMap = useMemo(() => Object.fromEntries(_todasPessoas.filter(p => p.nome).map(p => [p.id, p.nome as string])), [_todasPessoas]);
  // Sub-tab interna do AdminView: "Projetos" (CRUD atual) vs "Automações"
  // (config de responsáveis padrão por módulo origem das tarefas auto).
  const [adminTab, setAdminTab] = useState<"projetos" | "automacoes">("projetos");

  async function deletarProjeto(p: TarefaProjeto) {
    if (!confirm(`Excluir "${p.nome}"? Todos os projetos vão junto. Tarefas existentes não são afetadas (só perdem referência).`)) return;
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
        `Projeto "${s.nome}" não pode ser excluído porque está marcado como ` +
        `bloqueado pra criação manual (recebe tarefas de hooks automáticos). ` +
        `Pra excluir, primeiro desmarque o bloqueio no editor.`,
      );
      return;
    }
    if (!confirm(`Excluir projeto "${s.nome}"?`)) return;
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
          Configuração de áreas e projetos do gestor. Mexa com cuidado — afeta todas as tarefas.
        </p>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setImportando(true)}>📥 Importar CSV</Button>
          <Button size="sm" onClick={() => setCriandoProjeto(true)}>+ Nova Área</Button>
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

      {/* A área "Prazos" já sai filtrada na fonte — não aparece aqui no admin. */}
      {projetos.filter(p => !ehAreaPrazos(p)).map(p => {
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
                  {p.tipo} · {subs.length} projeto(s)
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
                  + adicionar projeto
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
  const pessoas = usePessoasAtivasLista();
  const [automacoes, setAutomacoes] = useState<TarefaAutomacao[]>([]);
  const [salvandoMod, setSalvandoMod] = useState<string | null>(null);

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
  const pessoasLista = usePessoasAtivasLista();

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
      {isModal && <h3 className="font-bold mb-2 text-gray-900 dark:text-gray-100">Nova Área</h3>}
      <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
        <input value={f.emoji || ""} onChange={(e) => setF({ ...f, emoji: e.target.value })} placeholder="📁" className="adm-input text-center" maxLength={3} />
        <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome da área" className="adm-input" />
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
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Pessoas autorizadas na área inteira (acesso explícito):</div>
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
  const _todasPessoas2 = useTodasPessoas();
  const pessoas = useMemo(() => _todasPessoas2
    .filter(p => p.ativa !== false && p.nome)
    .map(p => ({ id: p.id, nome: p.nome as string, isMaster: !!p.isMaster }))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [_todasPessoas2]);

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
        ? `Mover projeto "${sub.nome}" de "${projDe}" pra "${projPra}"?\n\n${n} tarefa(s) existente(s) vão acompanhar (área pai e cor do card atualizam).`
        : `Mover projeto "${sub.nome}" de "${projDe}" pra "${projPra}"?\n\nNão há tarefas existentes — só o projeto muda.`;
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
      <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome do projeto" className="adm-input" />

      {/* Select de "Projeto pai" — só faz sentido ao editar subprojeto
          existente, pra permitir movê-lo entre projetos. */}
      {sub && (
        <div className="text-xs">
          <label className="block text-gray-600 dark:text-gray-400 mb-0.5">
            Área pai
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
              Quando ativo, esse projeto não aceita "+ Nova tarefa" no app — só recebe
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
                O banner do projeto vai mostrar um botão "Ir pra {MODULES.find(m => m.id === moduloAtualId)?.label || "Módulo"}".
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
        <div className="text-gray-600 dark:text-gray-400 mb-1">Responsável padrão (pra novas tarefas deste projeto)</div>
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
          Observadores padrão (recebem notificações de toda tarefa nova deste projeto)
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

