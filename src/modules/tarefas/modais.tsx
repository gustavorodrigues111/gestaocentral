import { useEffect, useState, useMemo } from "react";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { criarTarefa, softDeleteTarefa, marcarSubtarefa, adicionarComentario, atualizarTarefa } from "./repository";
import { type Tarefa, type TarefaProjeto, type TarefaSubprojeto, type TarefaStatus, type TarefaPrioridade, type TarefaVisibilidade, type TarefaAnexo, type Subtarefa, type Pessoa, type Restaurant, TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL, TAREFA_ORIGEM_LABEL, TAREFA_VISIBILIDADE_LABEL } from "../../core/types";
import { fmtBR, fmtBRDateTime } from "../../core/utils/date";
import { resolverPrazoOffset, extrairMencoes } from "./prazoOffset";
import { ProrrogarContratoModal } from "../admissao/ProrrogarContratoModal";
import { isConfidencial } from "./visibilidade";
import { parseCSV, mapearLinhas, executarImport, detectarOrfas, type LinhaImportada } from "./importador";
import { pickDriveFolder, pickDriveFile } from "../../core/google/drivePicker";
import { PuxarIdeiaOcorrenciaModal } from "../_shared/PuxarIdeiaOcorrenciaModal";
import { DatePickerBR } from "../prazos/campos";
import { CoRespPicker, Field, FieldRow, PessoasMultiPicker, UsuariosAutorizadosPicker, brParaYmd, mudarStatusComErro, ymdParaBr } from "./helpers";

// Modal: lista os restaurantes do user e ao escolher, navega pra
// /r/{escolhido}/{rota}. Usado pelo banner quando o sub não tem rest
// travado e o user precisa decidir qual unidade abrir.
export function EscolhaRestauranteModal({ restaurants, rota, tituloModulo, onClose }: {
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

export function NovaTarefaModal({ onClose, projetos, subprojetos, restaurantes, pessoaId, pessoaNome, prazoInicial, projetoIdInicial, subprojetoIdInicial, tituloInicial, descricaoInicial, puxandoInicial }: {
  onClose: () => void;
  projetos: TarefaProjeto[];
  subprojetos: TarefaSubprojeto[];
  restaurantes: { id: string; nome: string }[];
  pessoaId: string;
  pessoaNome: string;
  prazoInicial?: string;
  projetoIdInicial?: string;
  subprojetoIdInicial?: string;
  tituloInicial?: string;
  descricaoInicial?: string;
  puxandoInicial?: { tipo: "ideia" | "ocorrencia"; id: string; titulo: string } | null;
}) {
  const [titulo, setTitulo] = useState(tituloInicial || "");
  const [descricao, setDescricao] = useState(descricaoInicial || "");
  // Sem default — vazio força o usuário a escolher conscientemente.
  // Pré-preenche só quando vem do contexto (calendário, click num dia).
  const [projetoId, setProjetoId] = useState(projetoIdInicial || "");
  const [subprojetoId, setSubprojetoId] = useState(subprojetoIdInicial || "");
  const [prazo, setPrazo] = useState(prazoInicial || "");
  const [prioridade, setPrioridade] = useState<TarefaPrioridade>("normal");
  const [restaurantIds, setRestaurantIds] = useState<string[]>([]);
  const [usarTemplate, setUsarTemplate] = useState(true);
  const [puxando, setPuxando] = useState<{ tipo: "ideia" | "ocorrencia"; id: string; titulo: string } | null>(puxandoInicial || null);
  const [puxarAberto, setPuxarAberto] = useState(false);
  // Responsável: começa em quem criou; user pode trocar pra outra pessoa
  // autorizada no projeto.
  const [responsavelId, setResponsavelId] = useState<string>(pessoaId);
  // Co-responsáveis (podem editar) e observadores (só acompanham) — opcionais.
  const [coResponsaveisIds, setCoResponsaveisIds] = useState<string[]>([]);
  const [observadoresIds, setObservadoresIds] = useState<string[]>([]);
  const [maisOpcoes, setMaisOpcoes] = useState(false);

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
  // Subprojeto só é obrigatório quando o projeto tem algum manual-criável
  // (ex: projeto Prazos pode não ter → cria na raiz).
  const formValido = !!titulo.trim() && !!projetoId && (subsDoProjeto.length === 0 || !!subprojetoId) && !!prazo && !!responsavelId && responsavelEhElegivel;

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
          {/* ── Área (chips no topo) ── */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Área *</label>
            <div className="flex flex-wrap gap-1.5">
              {projetos.map(p => {
                const on = projetoId === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setProjetoId(p.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                    {p.emoji} {p.nome}
                  </button>
                );
              })}
            </div>
          </div>
          {/* ── Essenciais ── */}
          <Field label="O que precisa ser feito *">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input" placeholder="Conferir estoque do bar" autoFocus />
          </Field>
          {subsDoProjeto.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Projeto *</label>
              <div className="flex flex-wrap gap-1.5">
                {subsDoProjeto.map(s => {
                  const on = subprojetoId === s.id;
                  return (
                    <button key={s.id} type="button" onClick={() => setSubprojetoId(s.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                      {s.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Responsável *</label>
            {!projetoId ? (
              <p className="text-xs text-gray-400 italic py-1">Escolha uma área primeiro</p>
            ) : responsaveisElegiveis.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-1">Ninguém elegível nesta área.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {responsaveisElegiveis.map(p => {
                  const on = responsavelId === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => setResponsavelId(p.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                      {p.id === pessoaId ? `${p.nome} (você)` : p.nome}
                    </button>
                  );
                })}
              </div>
            )}
            {projetoAtual && projetoAtual.visibilidade === "privado" && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                🔒 Área privada — só pessoas autorizadas podem ser responsáveis.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prazo *">
              <DatePickerBR value={ymdParaBr(prazo)} onChange={(br) => setPrazo(brParaYmd(br))} />
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

          {/* ── Mais opções (recolhido) ── */}
          <button type="button" onClick={() => setMaisOpcoes(v => !v)} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <span className={`transition-transform ${maisOpcoes ? "rotate-90" : ""}`}>▸</span> Mais opções <span className="text-xs text-gray-400">— descrição, co-responsáveis, observadores{restaurantes.length > 0 ? ", empresas" : ""}</span>
          </button>
          {maisOpcoes && (
            <div className="space-y-3 pl-1 border-l-2 border-gray-100 dark:border-gray-800 ml-1">
              <div className="pl-3 space-y-3">
                <Field label="Descrição">
                  <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} className="input resize-y" placeholder="Detalhes, contexto, links..." />
                </Field>
                <Field label="Co-responsáveis (podem editar)">
                  <PessoasMultiPicker value={coResponsaveisIds} onChange={setCoResponsaveisIds} pessoas={responsaveisElegiveis} excluir={[responsavelId, ...observadoresIds]} placeholder={!projetoId ? "Escolha uma área primeiro" : "+ adicionar"} />
                </Field>
                <Field label="Observadores (só acompanham)">
                  <PessoasMultiPicker value={observadoresIds} onChange={setObservadoresIds} pessoas={responsaveisElegiveis} excluir={[responsavelId, ...coResponsaveisIds]} placeholder={!projetoId ? "Escolha uma área primeiro" : "+ adicionar"} />
                </Field>
                {restaurantes.length > 0 && (
                  <Field label="Empresa(s)">
                    <div className="flex flex-wrap gap-2">
                      {restaurantes.map(r => (
                        <label key={r.id} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={restaurantIds.includes(r.id)} onChange={(e) => { if (e.target.checked) setRestaurantIds([...restaurantIds, r.id]); else setRestaurantIds(restaurantIds.filter(id => id !== r.id)); }} />
                          {r.nome}
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </div>
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
            title={!formValido ? "Preencha área, título, projeto, prazo e responsável" : undefined}
          >
            Criar Tarefa
          </Button>
        </div>
        {puxarAberto && (
          <PuxarIdeiaOcorrenciaModal
            pessoaIdAtual={pessoaId}
            restaurantes={restaurantes}
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

export function DetalheModal({ tarefa, projetos, subprojetos, autor, onClose }: {
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
  const [detMais, setDetMais] = useState(false);
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
      alert("Essa área não tem projetos. Crie um antes ou escolha outro.");
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

  // Responsáveis elegíveis (mesma regra da criação): área aberta → todos;
  // privada → só autorizados. O responsável atual entra sempre como chip.
  const respElegiveis = (() => {
    const vis = (projeto?.visibilidade || "privado");
    const aberto = vis === "escritorio" || vis === "publico";
    const base = (!projeto || aberto)
      ? pessoasLista
      : pessoasLista.filter(p => new Set([
          ...((projeto.usuariosAutorizados || []) as string[]),
          ...((tarefa.usuariosAutorizados || []) as string[]),
        ]).has(p.id));
    // Garante que o responsável atual apareça mesmo se não estiver na lista.
    if (tarefa.responsavelId && !base.some(p => p.id === tarefa.responsavelId)) {
      return [{ id: tarefa.responsavelId, nome: `${tarefa.responsavelNome || "?"} (atual)` }, ...base];
    }
    return base;
  })();

  function mudarResponsavel(novoId: string, novoNome: string) {
    if (novoId === tarefa.responsavelId) return;
    atualizarTarefa(tarefa.id, { responsavelId: novoId, responsavelNome: novoNome }, autor, {
      acao: "responsavel_mudou",
      campo: "responsável",
      valorAntes: tarefa.responsavelNome || "—",
      valorDepois: novoNome,
    });
  }

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
          {/* Título + Área/Projeto (chips) */}
          <div className="px-5 pt-4 pb-3">
            <div>
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
            {/* Área (chips) */}
            <div className="mt-3">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Área</label>
              <div className="flex flex-wrap gap-1.5">
                {projetos.map(p => {
                  const on = tarefa.projetoId === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => { if (!on) trocarProjeto(p.id); }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                      {p.emoji} {p.nome}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Projeto (chips) */}
            {subprojetos.filter(s => s.projetoId === tarefa.projetoId).length > 0 && (
              <div className="mt-3">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Projeto</label>
                <div className="flex flex-wrap gap-1.5">
                  {subprojetos.filter(s => s.projetoId === tarefa.projetoId).map(s => {
                    const on = tarefa.subprojetoId === s.id;
                    return (
                      <button key={s.id} type="button" onClick={() => { if (!on) salvarCampo("subprojetoId", s.id, "subprojeto"); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                        {s.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ─── Bloco de campos (linhas horizontais label/valor) ─── */}
          <div className="px-5 pb-4 space-y-2">
            <FieldRow label="Responsável">
              {respElegiveis.length === 0 ? (
                <span className="text-xs text-gray-400 italic py-1">Ninguém elegível nesta área.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5 py-0.5">
                  {respElegiveis.map(p => {
                    const on = tarefa.responsavelId === p.id;
                    return (
                      <button key={p.id} type="button" onClick={() => mudarResponsavel(p.id, p.nome)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                        {p.nome}
                      </button>
                    );
                  })}
                </div>
              )}
            </FieldRow>
            <FieldRow label="Data de conclusão">
              <DatePickerBR
                value={ymdParaBr(tarefa.prazo || "")}
                onChange={(br) => salvarCampo("prazo", brParaYmd(br) || null, "prazo")}
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
            <button
              type="button"
              onClick={() => setDetMais(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 pt-1"
            >
              <span className={`transition-transform ${detMais ? "rotate-90" : ""}`}>▸</span> Mais opções
              <span className="text-gray-400">— co-responsáveis, observadores, empresas, visibilidade</span>
            </button>
            {detMais && (<>
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
                  <option value="">— A mesma da área ({projeto && TAREFA_VISIBILIDADE_LABEL[projeto.visibilidade]}) —</option>
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
            </>)}
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

export function ImportadorModal({ projetos, subprojetos, pessoaId, onClose }: {
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
      alert("Carregue um CSV e escolha área/projeto");
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
                        <div className="text-gray-500 mb-1">Área</div>
                        <select value={projetoDestino} onChange={(e) => setProjetoDestino(e.target.value)} className="w-full px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800">
                          {projetos.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.nome}</option>)}
                        </select>
                      </label>
                      <label className="text-xs">
                        <div className="text-gray-500 mb-1">Projeto</div>
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

export function SemPermissaoModal({ onClose }: { onClose: () => void }) {
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


