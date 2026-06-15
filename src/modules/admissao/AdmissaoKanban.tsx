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
  aprovarAdmissao,
  cancelarAdmissao,
  etapasAnterioresEmAtraso,
  excluirAdmissaoDefinitivamente,
  getKanbanColunas,
  getPrazoDias,
  getDocumentosAdmissao,
  getSchemaAdmissao,
  estenderPrazoAdmissao,
  desfazerUltimaExtensaoPrazo,
  iniciarAdmissao,
  linkWhatsAppCandidato,
  marcarLinkEnviado,
  montarMensagemEnvioLink,
  moverStatusKanban,
  normalizarAdmissao,
  progressoSubtarefasColuna,
  proximoStatus,
  reabrirAdmissao,
  reenviarAdmissao,
  statusAnterior,
  statusEfetivo,
  subtarefasPendentesObrigatorias,
  urlPublicaAdmissao,
  type IniciarAdmissaoInput,
} from "../../core/admissao/admissaoHelpers";
import { CancelarAdmissaoModal } from "./CancelarAdmissaoModal";
import { ADMISSAO_STATUS_LABEL as STATUS_LABEL } from "../../core/types";
import { SubtarefasDrawer } from "./SubtarefasDrawer";
import { PreencherFormManualModal } from "./PreencherFormManualModal";
import { VerPreenchimentoModal } from "./VerPreenchimentoModal";
import { IniciarAdmissaoModal } from "./IniciarAdmissaoModal";

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// Rótulo do prazo do candidato a partir de expiraEm ("vence em 1d 3h" /
// "vencido há 2h"). Usado pra mostrar urgência no card + decidir o lembrete.
function prazoLabel(expiraEm?: string): { txt: string; vencido: boolean; urgente: boolean } | null {
  if (!expiraEm) return null;
  const ms = new Date(expiraEm).getTime() - Date.now();
  const vencido = ms <= 0;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const dur = d > 0 ? `${d}d ${h}h` : `${h}h`;
  return { txt: vencido ? `prazo vencido há ${dur}` : `vence em ${dur}`, vencido, urgente: !vencido && ms < 24 * 3600000 };
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
  const [verAdm, setVerAdm] = useState<Admissao | null>(null);
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
      // Esconde admissões finalizadas (botão "Finalizar admissão" depois
      // do onboarding) — elas vivem na aba "Finalizadas" agora.
      if (a.finalizadoEm) continue;
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
      // Rede de segurança: ao chegar em "admitido" com empregado já criado,
      // garante a cascata (idempotente — não duplica se já rodou).
      if (novoStatus === "admitido" && adm.empregadoIdCriado && adm.dataAdmissao && me?.id) {
        await rodarCascata(adm, adm.empregadoIdCriado);
      }
    } catch (e) {
      alert("Erro ao mover: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Cascata pós-admissão: tarefas trabalhistas (Experiência 1ª/2ª) + exames
  // (Fase 7). Idempotente. Usada pela "Concluir → criar empregado" (com
  // confirmação) e como rede de segurança ao mover pra "admitido".
  async function rodarCascata(adm: Admissao, empregadoId: string) {
    if (!me?.id || !adm.dataAdmissao) return;
    try {
      const cargo = adm.cargoId ? await carregarCargo(adm.cargoId) : null;
      await gerarCascataAdmissao({
        pessoaNome: adm.candidato.nome,
        empregadoId,
        restaurantId: adm.restaurantId,
        admissaoData: adm.dataAdmissao,
        manipulaAlimentos: cargo?.area === "Cozinha" || cargo?.area === "Bar",
        responsavelPadraoId: me.id,
        responsavelPadraoNome: me.nome,
        autorId: me.id,
        autorNome: me.nome,
      });
      await gerarExamesParaAdmissao({
        empregadoId,
        empregadoNome: adm.candidato.nome,
        cargoId: adm.cargoId,
        cargoNome: cargo?.nome,
        cargoArea: cargo?.area,
        restaurantId: adm.restaurantId,
        dataAdmissao: adm.dataAdmissao,
        autor: { id: me.id, nome: me.nome },
        subtarefasAdmissao: adm.subtarefas,
      });
    } catch (err) {
      console.warn("[admissao] falha ao gerar cascata de tarefas/exames:", err);
    }
  }

  // Concluir → cria Pessoa + Empregado no sistema. Disponível A QUALQUER MOMENTO
  // (não exige o checklist todo) — só os dados mínimos da vaga. Pergunta antes
  // de rodar a cascata (auto + confirmar). aprovarAdmissao é idempotente.
  async function concluirCriarEmpregado(adm: Admissao) {
    if (!me) return;
    if (adm.empregadoIdCriado) { alert("Empregado já criado no sistema."); return; }
    if (!adm.cargoId || !adm.dataAdmissao || typeof adm.salario !== "number") {
      alert("Pra criar o empregado preciso de: cargo, data de admissão e salário.\n\nPreencha os dados da vaga primeiro (no checklist do card).");
      return;
    }
    if (!confirm(`Criar Pessoa + Empregado de ${adm.candidato.nome} no sistema?\n\nCria o registro do empregado já. Você pode continuar o checklist da admissão depois.`)) return;
    try {
      const { empregadoId } = await aprovarAdmissao(adm, me);
      if (confirm("✅ Empregado criado!\n\nCriar também os exames admissionais e as tarefas de experiência no sistema agora?")) {
        await rodarCascata(adm, empregadoId);
      }
      alert("Pronto — empregado criado no sistema.");
    } catch (e) {
      alert("Erro ao criar empregado: " + (e instanceof Error ? e.message : "?"));
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

  // Enviar (ou reenviar) o link do formulário pelo WhatsApp. Avança o status
  // pra "Aguardando" quando ainda está em "A admitir" (libera o candidato).
  async function enviarLink(adm: Admissao) {
    if (!me) return;
    try {
      const prazoDias = getPrazoDias(activeRestaurant);
      await marcarLinkEnviado(adm, prazoDias, me);
      const url = urlPublicaAdmissao(adm.token, activeRestaurant.subdomain);
      const msg = montarMensagemEnvioLink(adm.candidato.nome, activeRestaurant.nome, url, prazoDias, activeRestaurant);
      const link = linkWhatsAppCandidato(adm.candidato.whatsapp, msg);
      if (!link) { alert("WhatsApp do candidato inválido — confira o cadastro."); return; }
      window.open(link, "_blank");
    } catch (e) {
      alert("Erro ao enviar link: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Lembrete ao candidato (WhatsApp) — mensagem preparada, você confirma ao
  // abrir. Diferente do "reenviar": não renova prazo, só cutuca.
  function lembrar(adm: Admissao) {
    const url = urlPublicaAdmissao(adm.token, activeRestaurant.subdomain);
    const nome1 = (adm.candidato.nome || "").split(" ")[0];
    const msg = `Oi, ${nome1}! Passando pra lembrar da sua ficha de admissão do ${activeRestaurant.nome} 🙂\n\nO link ainda está te esperando:\n${url}\n\nSe precisar de ajuda ou de mais tempo, é só me chamar por aqui!`;
    const link = linkWhatsAppCandidato(adm.candidato.whatsapp, msg);
    if (link) window.open(link, "_blank");
    else alert("WhatsApp do candidato inválido — confira o cadastro.");
  }

  async function copiarLink(adm: Admissao) {
    const url = urlPublicaAdmissao(adm.token, activeRestaurant.subdomain);
    try { await navigator.clipboard.writeText(url); alert("Link copiado:\n\n" + url); }
    catch { window.prompt("Copie o link do formulário:", url); }
  }
  async function estender(adm: Admissao, horas: number) {
    if (!me) return;
    try {
      const novo = await estenderPrazoAdmissao(adm, horas, me);
      alert(`Prazo estendido em ${horas}h.\n\nNovo limite: ${fmtDataHora(novo)}`);
    } catch (e) {
      alert("Erro ao estender prazo: " + (e instanceof Error ? e.message : "?"));
    }
  }
  async function desfazerExtensao(adm: Admissao) {
    const ultima = (adm.extensoesPrazo || []).slice(-1)[0];
    if (!ultima) return;
    if (!window.confirm(`Desfazer a última extensão (+${ultima.horas}h)?`)) return;
    try {
      const novo = await desfazerUltimaExtensaoPrazo(adm);
      alert(`Extensão de +${ultima.horas}h desfeita.\n\nNovo limite: ${fmtDataHora(novo)}`);
    } catch (e) {
      alert("Erro ao desfazer extensão: " + (e instanceof Error ? e.message : "?"));
    }
  }
  // Gera um link NOVO (token novo — invalida o anterior) e reabre o WhatsApp.
  async function novoToken(adm: Admissao) {
    if (!me) return;
    if (!confirm(`Gerar um link NOVO pra ${adm.candidato.nome}?\n\nO link anterior deixa de funcionar. Use quando o link expirou ou vazou.`)) return;
    try {
      const prazoDias = getPrazoDias(activeRestaurant);
      const { token } = await reenviarAdmissao(adm, prazoDias, me);
      const url = urlPublicaAdmissao(token, activeRestaurant.subdomain);
      const msg = montarMensagemEnvioLink(adm.candidato.nome, activeRestaurant.nome, url, prazoDias, activeRestaurant);
      const link = linkWhatsAppCandidato(adm.candidato.whatsapp, msg);
      if (link) window.open(link, "_blank");
    } catch (e) {
      alert("Erro ao gerar novo link: " + (e instanceof Error ? e.message : "?"));
    }
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
            documentosAdmissao: getDocumentosAdmissao(activeRestaurant),
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

      {/* Ver preenchimento (só-leitura) — com handoff pra editar */}
      {verAdm && (
        <VerPreenchimentoModal
          admissao={verAdm}
          onClose={() => setVerAdm(null)}
          onEditar={() => { const a = verAdm; setVerAdm(null); setFormAdm(a); }}
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
                    onAbrirFormulario={() => setVerAdm(a)}
                    onEnviarLink={() => enviarLink(a)}
                    onConcluir={() => concluirCriarEmpregado(a)}
                    onCopiarLink={() => copiarLink(a)}
                    onEstender={(h) => estender(a, h)}
                    onDesfazerExtensao={() => desfazerExtensao(a)}
                    onNovoToken={() => novoToken(a)}
                    onLembrar={() => lembrar(a)}
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
  onClickCard, onDragStart, onDragEnd, onMoverPara, onExcluir, onCancelar, onReabrir, onAbrirFormulario, onEnviarLink, onConcluir, onCopiarLink, onEstender, onDesfazerExtensao, onNovoToken, onLembrar,
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
  onEnviarLink: () => void;
  onConcluir: () => void;
  onCopiarLink: () => void;
  onEstender: (horas: number) => void;
  onDesfazerExtensao: () => void;
  onNovoToken: () => void;
  onLembrar: () => void;
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

      {/* Próxima ação em destaque: enviar/reenviar o formulário ao candidato */}
      {adm.status === "a_admitir" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEnviarLink(); }}
          className="w-full mt-2 px-2 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
          title="Gera o link e abre o WhatsApp pro candidato preencher. Move o card pra 'Aguardando' e inicia o prazo."
        >
          📨 Enviar formulário (WhatsApp)
        </button>
      )}
      {adm.status === "formulario_enviado" && (() => {
        const pz = prazoLabel(adm.expiraEm);
        return (
          <>
            {pz && (
              <div className={`mt-2 text-[10px] font-semibold ${pz.vencido ? "text-rose-600 dark:text-rose-400" : pz.urgente ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                ⏰ {pz.txt}
              </div>
            )}
            <div className="flex gap-1.5 mt-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEnviarLink(); }}
                className="flex-1 px-2 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-[11px] font-semibold"
                title="Reabre o WhatsApp com o mesmo link e renova o prazo"
              >
                🔄 Reenviar
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onLembrar(); }}
                className="flex-1 px-2 py-1.5 rounded-md border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-[11px] font-semibold"
                title="Cutuca o candidato no WhatsApp (não renova o prazo)"
              >
                🔔 Lembrar
              </button>
            </div>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
              <button type="button" onClick={(e) => { e.stopPropagation(); onCopiarLink(); }} className="hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">📋 copiar link</button>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); onEstender(12); }} className="hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">⏱ +12h</button>
              {(adm.extensoesPrazo?.length ?? 0) > 0 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onDesfazerExtensao(); }} className="hover:text-amber-600 dark:hover:text-amber-400 hover:underline" title={`Desfaz a última extensão (+${adm.extensoesPrazo!.slice(-1)[0].horas}h)`}>↩ desfazer</button>
              )}
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); onNovoToken(); }} className="hover:text-rose-600 dark:hover:text-rose-400 hover:underline" title="Gera um link novo (invalida o anterior) — pra link expirado">🔑 novo link</button>
            </div>
          </>
        );
      })()}

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
            title="Ver o que o candidato preencheu (só leitura). Dá pra editar de lá."
          >
            👁 Ver preenchimento
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

      {/* Concluir → criar empregado (disponível a qualquer momento). Destaque
          quando já está em 'Pronto'/'Admitido'; discreto antes disso. */}
      {!ehTerminal && !adm.empregadoIdCriado && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onConcluir(); }}
          className={`w-full mt-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold ${
            adm.status === "pronto_admissao" || adm.status === "admitido"
              ? "bg-indigo-600 hover:bg-indigo-700 text-white"
              : "border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
          }`}
          title="Cria Pessoa + Empregado no sistema. Exige cargo, data e salário. Pode fazer a qualquer momento."
        >
          ✅ Concluir → criar empregado
        </button>
      )}
      {!ehTerminal && adm.empregadoIdCriado && (
        <div className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
          ✓ empregado criado no sistema
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
