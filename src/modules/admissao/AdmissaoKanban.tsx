// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Kanban" — visualização INTERATIVA do fluxo das admissões.
//
//  Movimentação manual:
//   - Drag-drop de card entre colunas
//   - Botões ◀ ▶ no card (próximo / anterior status)
//   - Botão "+ Nova admissão" no header da coluna "Pessoas a admitir"
//
//  Validação: ao tentar AVANÇAR (não voltar) com subtarefas obrigatórias
//  pendentes na coluna atual, abre confirm modal. Se usuário confirmar,
//  marca `etapasComPendencias[colunaAtualId] = true` — card ganha
//  sinalizador "⚠️ etapa em atraso" até completar as obrigatórias.
//
//  Click no card abre o SubtarefasDrawer (checklist completo).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { gerarCascataAdmissao } from "../tarefas/generator";
import { gerarExamesParaAdmissao, carregarCargo } from "../exames/gerador";
import {
  ADMISSAO_STATUS_LABEL,
  MOTIVO_CANCELAMENTO_LABEL,
  type Admissao,
  type AdmissaoStatus,
  type Cargo,
  type KanbanColuna,
  type Restaurant,
} from "../../core/types";
import {
  cancelarAdmissao,
  etapasAnterioresEmAtraso,
  excluirAdmissaoDefinitivamente,
  getKanbanColunas,
  getPrazoDias,
  getSchemaAdmissao,
  iniciarAdmissao,
  moverStatusKanban,
  normalizarAdmissao,
  progressoSubtarefasColuna,
  proximoStatus,
  reabrirAdmissao,
  statusAnterior,
  statusEfetivo,
  subtarefasPendentesObrigatorias,
  type IniciarAdmissaoInput,
} from "../../core/admissao/admissaoHelpers";
import { CancelarAdmissaoModal } from "./CancelarAdmissaoModal";
import { ADMISSAO_STATUS_LABEL as STATUS_LABEL } from "../../core/types";
import { SubtarefasDrawer } from "./SubtarefasDrawer";
import { PreencherFormManualModal } from "./PreencherFormManualModal";
import { IniciarAdmissaoModal } from "./IniciarAdmissaoModal";

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

// Acha a coluna que cobre um status (mesma lógica do view-only antigo).
function colunaCapturaStatus(col: KanbanColuna, st: string): boolean {
  if (!col.statusAuto) return false;
  if (Array.isArray(col.statusAuto)) return col.statusAuto.includes(st as never);
  return col.statusAuto === st;
}

function colunaDaAdmissao(adm: Admissao, colunas: KanbanColuna[]): string | null {
  if (adm.kanbanColunaId) {
    const c = colunas.find((c) => c.id === adm.kanbanColunaId);
    if (c) return c.id;
  }
  const st = statusEfetivo(adm);
  const c = colunas.find((c) => colunaCapturaStatus(c, st));
  return c?.id || null;
}

// Acha o status correspondente a uma coluna (1º elemento de statusAuto).
function statusDaColuna(col: KanbanColuna): AdmissaoStatus | null {
  if (!col.statusAuto) return null;
  if (Array.isArray(col.statusAuto)) return col.statusAuto[0] || null;
  return col.statusAuto;
}

export function AdmissaoKanban({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [admAbertaId, setAdmAbertaId] = useState<string | null>(null);
  const [showNovaModal, setShowNovaModal] = useState(false);
  // Modal de cancelar — guarda admissão sendo cancelada
  const [admCancelando, setAdmCancelando] = useState<Admissao | null>(null);
  const [formAdm, setFormAdm] = useState<Admissao | null>(null);
  // Drag state (id do card sendo arrastado + coluna origem)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetColId, setDropTargetColId] = useState<string | null>(null);

  const admAberta = useMemo(
    () => (admAbertaId ? admissoes.find((a) => a.id === admAbertaId) || null : null),
    [admAbertaId, admissoes],
  );

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "admissoes"), where("restaurantId", "==", rid)),
      (snap) => setAdmissoes(snap.docs.map((d) => normalizarAdmissao({ id: d.id, ...d.data() } as Admissao))),
    );
    const u2 = onSnapshot(
      query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      (snap) => setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cargo))),
    );
    return () => { u1(); u2(); };
  }, [rid]);

  const colunas = useMemo(
    () => [...getKanbanColunas(activeRestaurant)].sort((a, b) => a.ordem - b.ordem),
    [activeRestaurant],
  );

  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);

  const porColuna = useMemo(() => {
    const m = new Map<string, Admissao[]>();
    for (const c of colunas) m.set(c.id, []);
    for (const a of admissoes) {
      const colId = colunaDaAdmissao(a, colunas);
      if (!colId) continue;
      const arr = m.get(colId) || [];
      arr.push(a);
      m.set(colId, arr);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
    }
    return m;
  }, [admissoes, colunas]);

  // ─── Movimentação ────────────────────────────────────────────────
  async function tentarMover(adm: Admissao, destinoColunaId: string) {
    const destinoCol = colunas.find((c) => c.id === destinoColunaId);
    if (!destinoCol) return;
    const novoStatus = statusDaColuna(destinoCol);
    if (!novoStatus) return;
    if (novoStatus === adm.status) return; // mesmo status, ignora

    // Detecta coluna atual (pode ser undefined se status legacy)
    const colAtualId = colunaDaAdmissao(adm, colunas);
    const colAtual = colunas.find((c) => c.id === colAtualId);

    // Se for AVANÇAR (status na frente de adm.status no fluxo) e tiver
    // obrigatórias pendentes na coluna atual, pede confirmação.
    const pendentes = colAtual ? subtarefasPendentesObrigatorias(adm, colAtual.id).length : 0;
    const ehAvanco = isAvanco(adm.status, novoStatus);

    if (ehAvanco && pendentes > 0) {
      const ok = confirm(
        `Tem ${pendentes} item(ns) obrigatório(s) pendente(s) em "${colAtual?.nome}".\n\n` +
        `Avançar mesmo assim?\n\n` +
        `O card vai pra "${destinoCol.nome}" com sinalizador "⚠️ etapa em atraso" ` +
        `até você completar essas pendências.`,
      );
      if (!ok) return;
    }

    try {
      await moverStatusKanban(adm, novoStatus, pendentes, colAtualId, destinoColunaId);
      // Cascata: ao alcançar "admitido" (final do fluxo), gera as 4-5 tarefas
      // trabalhistas (Experiência 1ª/2ª, Exame Clínico, Exame Complementar,
      // Coprocultura). Idempotente — se já rodou, não duplica.
      if (
        novoStatus === "admitido"
        && adm.empregadoIdCriado
        && adm.dataAdmissao
        && me?.id
      ) {
        // Cascata 1: tarefas trabalhistas legadas (Experiência 1ª/2ª).
        // Exames eram criados aqui, mas agora vão via Fase 7 (módulo Exames).
        try {
          // Carrega cargo pra derivar "manipulador" + passar dados ao Exames
          const cargo = adm.cargoId ? await carregarCargo(adm.cargoId) : null;
          await gerarCascataAdmissao({
            pessoaNome: adm.candidato.nome,
            empregadoId: adm.empregadoIdCriado,
            restaurantId: adm.restaurantId,
            admissaoData: adm.dataAdmissao,
            manipulaAlimentos: cargo?.area === "Cozinha" || cargo?.area === "Bar",
            responsavelPadraoId: me.id,
            responsavelPadraoNome: me.nome,
            autorId: me.id,
            autorNome: me.nome,
          });

          // Cascata 2 (Fase 7): cria ExameEmpregado pra cada tipo aplicável.
          // Estes não viram tarefas imediatamente — vão pelo generator diário
          // quando chegar a janela de antecedência.
          await gerarExamesParaAdmissao({
            empregadoId: adm.empregadoIdCriado,
            empregadoNome: adm.candidato.nome,
            cargoId: adm.cargoId,
            cargoNome: cargo?.nome,
            cargoArea: cargo?.area,
            restaurantId: adm.restaurantId,
            dataAdmissao: adm.dataAdmissao,
            autor: { id: me.id, nome: me.nome },
            // Passa subtarefas pra cascata herdar resultado dos exames
            // admissionais (ASO + Parasitológico) como historico[0] no
            // ExameEmpregado correspondente.
            subtarefasAdmissao: adm.subtarefas,
          });
        } catch (err) {
          console.warn("[admissao] falha ao gerar cascata de tarefas/exames:", err);
        }
      }
    } catch (e) {
      alert("Erro ao mover: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // ─── Drag handlers ────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, admId: string) {
    setDraggingId(admId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", admId);
  }
  function handleDragEnd() {
    setDraggingId(null);
    setDropTargetColId(null);
  }
  function handleDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetColId !== colId) setDropTargetColId(colId);
  }
  function handleDragLeave(colId: string) {
    if (dropTargetColId === colId) setDropTargetColId(null);
  }
  function handleDrop(e: React.DragEvent, colId: string) {
    e.preventDefault();
    setDropTargetColId(null);
    const admId = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (!admId) return;
    const adm = admissoes.find((a) => a.id === admId);
    if (!adm) return;
    void tentarMover(adm, colId);
  }

  async function reabrirCard(adm: Admissao) {
    if (!me?.isMaster) return;
    const destinoStatus = adm.statusAntesCancelamento || "pronto_admissao";
    const destinoLabel = STATUS_LABEL[destinoStatus];
    const ok = confirm(
      `Reabrir admissão de ${adm.candidato.nome}?\n\n` +
      `O card volta pra "${destinoLabel}"` +
      (adm.statusAntesCancelamento
        ? " (ponto onde estava quando cancelou)."
        : " (ponto padrão — não havia snapshot do status anterior).")
    );
    if (!ok) return;
    try {
      await reabrirAdmissao(adm, me);
    } catch (e) {
      alert("Erro ao reabrir: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function excluirCard(adm: Admissao) {
    if (!me?.isMaster) return;
    const ok = confirm(
      `EXCLUSÃO DEFINITIVA\n\n` +
      `Você vai apagar pra sempre o card da admissão de ${adm.candidato.nome} ` +
      `(CPF ${adm.candidato.cpf}). Essa ação não pode ser desfeita.\n\n` +
      `Confirma?`,
    );
    if (!ok) return;
    try {
      await excluirAdmissaoDefinitivamente(adm.id);
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Criar nova admissão a partir do modal
  const schemaUsado = useMemo(() => getSchemaAdmissao(activeRestaurant), [activeRestaurant]);
  async function handleConfirmNova(input: Omit<IniciarAdmissaoInput, "restaurantSnapshot">) {
    if (!me) return undefined;
    try {
      const adm = await iniciarAdmissao(
        {
          ...input,
          restaurantSnapshot: {
            nome: activeRestaurant.nome,
            whatsappDP: activeRestaurant.whatsappDP,
            prazoDias: getPrazoDias(activeRestaurant),
          },
        },
        me,
      );
      setShowNovaModal(false);
      return adm;
    } catch (e) {
      alert("Erro ao criar admissão: " + (e instanceof Error ? e.message : "?"));
      return undefined;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Arrasta os cards entre colunas ou usa ◀ ▶ no card pra mover.
          Clica num card pra abrir o checklist completo.
        </p>
      </div>

      {admAberta && me && (
        <SubtarefasDrawer
          admissao={admAberta}
          cargos={cargos}
          activeRestaurant={activeRestaurant}
          pessoa={me}
          onClose={() => setAdmAbertaId(null)}
        />
      )}

      {/* Formulário do candidato — visualizar/editar (botão 👁 Formulário do card).
          Se já preencheu → modo "revisão" (corrigir); senão → "manual" (RH preenche). */}
      {formAdm && (
        <PreencherFormManualModal
          admissao={formAdm}
          modo={formAdm.dadosPreenchidos && Object.keys(formAdm.dadosPreenchidos).length > 0 ? "revisao" : "manual"}
          onClose={() => setFormAdm(null)}
          onSaved={() => setFormAdm(null)}
        />
      )}

      {showNovaModal && (
        <IniciarAdmissaoModal
          rid={rid}
          cargos={cargos}
          schemaUsado={schemaUsado}
          onClose={() => setShowNovaModal(false)}
          onConfirm={handleConfirmNova}
        />
      )}

      {admCancelando && me && (
        <CancelarAdmissaoModal
          candidatoNome={admCancelando.candidato.nome}
          onClose={() => setAdmCancelando(null)}
          onConfirm={async (motivos, texto) => {
            try {
              await cancelarAdmissao(admCancelando, motivos, texto, me);
              setAdmCancelando(null);
            } catch (e) {
              alert("Erro ao cancelar: " + (e instanceof Error ? e.message : "?"));
            }
          }}
        />
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {colunas.map((col) => {
          const cards = porColuna.get(col.id) || [];
          const isDropTarget = dropTargetColId === col.id;
          const isPrimeira = col.id === "col_a_admitir" || col.ordem === 1;
          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={() => handleDragLeave(col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
              className={`flex-shrink-0 w-72 rounded-xl border-2 p-2 transition-colors ${
                isDropTarget
                  ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 dark:border-indigo-600"
                  : "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 px-1">
                {col.cor && (
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: `#${col.cor}` }}
                  />
                )}
                <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 truncate">
                  {col.nome}
                </div>
                <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-400">
                  {cards.length}
                </span>
              </div>

              {/* Botão "+ Nova admissão" no header da coluna "Pessoas a admitir" */}
              {isPrimeira && (
                <button
                  type="button"
                  onClick={() => setShowNovaModal(true)}
                  className="w-full mb-2 px-3 py-2 rounded-md border border-dashed border-indigo-400 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-900/10 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-xs font-medium transition-colors"
                >
                  + Nova admissão
                </button>
              )}

              <div className="space-y-1.5 min-h-[80px]">
                {cards.map((a) => (
                  <KanbanCard
                    key={a.id}
                    adm={a}
                    cargo={cargoPorId.get(a.cargoId)}
                    colunas={colunas}
                    colunaAtualId={colunaDaAdmissao(a, colunas)}
                    isMaster={!!me?.isMaster}
                    isDragging={draggingId === a.id}
                    onClickCard={() => setAdmAbertaId(a.id)}
                    onDragStart={(e) => handleDragStart(e, a.id)}
                    onDragEnd={handleDragEnd}
                    onMoverPara={(destinoColId) => tentarMover(a, destinoColId)}
                    onExcluir={() => excluirCard(a)}
                    onCancelar={() => setAdmCancelando(a)}
                    onReabrir={() => reabrirCard(a)}
                    onAbrirFormulario={() => setFormAdm(a)}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="text-[10px] text-gray-400 italic text-center py-3">
                    — vazio —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── KanbanCard ─────────────────────────────────────────────────────

function KanbanCard({
  adm, cargo, colunas, colunaAtualId, isMaster, isDragging,
  onClickCard, onDragStart, onDragEnd, onMoverPara, onExcluir, onCancelar, onReabrir, onAbrirFormulario,
}: {
  adm: Admissao;
  cargo: Cargo | undefined;
  colunas: KanbanColuna[];
  colunaAtualId: string | null;
  isMaster: boolean;
  isDragging: boolean;
  onClickCard: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoverPara: (destinoColId: string) => void;
  onExcluir: () => void;
  onCancelar: () => void;
  onReabrir: () => void;
  onAbrirFormulario: () => void;
}) {
  const st = statusEfetivo(adm);
  const colAtual = colunas.find((c) => c.id === colunaAtualId);
  const prog = colAtual ? progressoSubtarefasColuna(adm, colAtual.id) : null;
  const atrasos = etapasAnterioresEmAtraso(adm);

  // Próximo / anterior status no fluxo
  const prox = proximoStatus(adm.status);
  const ante = statusAnterior(adm.status);
  const proxColId = prox ? colunas.find((c) => colunaCapturaStatus(c, prox))?.id : null;
  const anteColId = ante ? colunas.find((c) => colunaCapturaStatus(c, ante))?.id : null;
  const ehTerminal = adm.status === "cancelada" || adm.status === "expirada";

  return (
    <div
      draggable={!ehTerminal}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClickCard}
      className={`bg-white dark:bg-gray-900 border rounded-lg px-3 py-2 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-all ${
        isDragging ? "opacity-40" : ""
      } ${
        atrasos > 0
          ? "border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-900/10"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
            {adm.candidato.nome}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            {cargo?.nome || "—"} · {ADMISSAO_STATUS_LABEL[st]}
          </div>
        </div>
        {atrasos > 0 && (
          <span
            title={`${atrasos} etapa(s) anterior(es) com pendências`}
            className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-semibold whitespace-nowrap"
          >
            ⚠️ {atrasos}
          </span>
        )}
      </div>

      {prog && prog.total > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${prog.obrigatoriasPendentes > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${(prog.feitas / prog.total) * 100}%` }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-gray-500 dark:text-gray-400">
            {prog.feitas}/{prog.total}
          </span>
          {prog.obrigatoriasPendentes > 0 && (
            <span className="text-[9px] px-1 py-0 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
              {prog.obrigatoriasPendentes}!
            </span>
          )}
        </div>
      )}

      {/* Botões ◀ ▶ — só pra cards não-terminais e com etapa próxima/anterior */}
      {!ehTerminal && (anteColId || proxColId) && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          {anteColId ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoverPara(anteColId); }}
              className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
              title="Voltar pra etapa anterior"
            >
              ◀ voltar
            </button>
          ) : <span className="flex-1" />}
          {proxColId && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoverPara(proxColId); }}
              className="ml-auto text-[10px] px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              title="Avançar pra próxima etapa"
            >
              avançar ▶
            </button>
          )}
        </div>
      )}

      {/* Formulário (visualizar/editar) + Cancelar admissão — status não-terminal */}
      {!ehTerminal && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAbrirFormulario(); }}
            className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
            title="Abrir o formulário do candidato pra visualizar e editar"
          >
            👁 Formulário
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancelar(); }}
            className="text-[10px] text-gray-500 hover:text-rose-600 dark:hover:text-rose-400 hover:underline"
            title="Cancelar admissão (precisa motivo) — pode reabrir depois se master"
          >
            ❌ cancelar admissão
          </button>
        </div>
      )}

      {/* Cancelada/Expirada: badges cumulativas dos motivos + data + autor */}
      {ehTerminal && (
        <div className="mt-1.5 pt-1.5 border-t border-rose-100 dark:border-rose-900/40 space-y-1">
          <div className="flex flex-wrap gap-1">
            {(adm.motivosCancelamento || []).map((m) => (
              <span
                key={m}
                className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold"
              >
                {MOTIVO_CANCELAMENTO_LABEL[m]}
              </span>
            ))}
            {adm.status === "cancelada" && !adm.motivosCancelamento?.length && (
              <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold">
                Cancelado pela empresa
              </span>
            )}
            {adm.status === "expirada" && !adm.motivosCancelamento?.length && (
              <span className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold">
                Expirado sem resposta
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            {adm.canceladoEm
              ? <>em {fmtDataHora(adm.canceladoEm)} {adm.canceladoPor?.nome ? `· ${adm.canceladoPor.nome}` : ""}</>
              : adm.expiraEm
              ? <>expirou em {fmtDataHora(adm.expiraEm)}</>
              : null}
          </div>
          {adm.motivoCancelamento && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 italic">
              "{adm.motivoCancelamento}"
            </div>
          )}
          {isMaster && (
            <div className="flex flex-col gap-1 mt-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onReabrir(); }}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline text-left"
                title={adm.statusAntesCancelamento
                  ? `Reabrir admissão — volta pro status ${STATUS_LABEL[adm.statusAntesCancelamento]}`
                  : "Reabrir admissão (master) — volta pro status anterior"}
              >
                ↶ reabrir admissão
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onExcluir(); }}
                className="text-[10px] text-rose-600 dark:text-rose-400 hover:underline text-left"
                title="Apaga o card pra sempre (irreversível, só master)"
              >
                🗑️ excluir definitivamente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helpers extras
function isAvanco(atual: AdmissaoStatus, novo: AdmissaoStatus): boolean {
  // Ordem do fluxo principal (não terminal). Voltar dos terminais (cancelada,
  // expirada) é tratado em outro fluxo (reabrir).
  const ORDEM: AdmissaoStatus[] = [
    "a_admitir", "formulario_enviado", "formulario_preenchido",
    "solicitacao_contabilidade", "pronto_admissao", "admitido",
  ];
  const ia = ORDEM.indexOf(atual);
  const in_ = ORDEM.indexOf(novo);
  if (ia < 0 || in_ < 0) return false;
  return in_ > ia;
}
