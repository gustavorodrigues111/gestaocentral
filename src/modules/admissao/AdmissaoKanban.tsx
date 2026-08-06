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
  finalizarAdmissao,
  temDadosFinaisCompletos,
  expurgarDocumentosNoStorage,
  vincularPessoaEConcluir,
  type IniciarAdmissaoInput,
} from "../../core/admissao/admissaoHelpers";
import { CancelarAdmissaoModal } from "./CancelarAdmissaoModal";
import { ConcluirAdmissaoModal } from "./ConcluirAdmissaoModal";
import { ADMISSAO_STATUS_LABEL as STATUS_LABEL } from "../../core/types";
import { SubtarefasDrawer } from "./SubtarefasDrawer";
import { PreencherFormManualModal } from "./PreencherFormManualModal";
import { VerPreenchimentoModal } from "./VerPreenchimentoModal";
import { IniciarAdmissaoModal } from "./IniciarAdmissaoModal";
import { enviarWhatsapp } from "../../core/whatsapp/enviar";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";

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
  const abrirWhatsapp = useAbrirWhatsapp();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [admAbertaId, setAdmAbertaId] = useState<string | null>(null);
  const [showNovaModal, setShowNovaModal] = useState(false);
  // Modal de cancelar — guarda admissão sendo cancelada
  const [admCancelando, setAdmCancelando] = useState<Admissao | null>(null);
  const [concluirModalAdm, setConcluirModalAdm] = useState<Admissao | null>(null);
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
        cargoVinculo: cargo?.tipoVinculo,
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
  // CRIAR empregado (Pessoa + Empregado no sistema) — pode ser feito cedo,
  // assim que os dados da vaga estão completos. A escala só mostra a pessoa a
  // partir da data de admissão, então criar antes é seguro. NÃO encerra a
  // admissão (isso é o "Concluir"). aprovarAdmissao é idempotente.
  async function criarEmpregado(adm: Admissao) {
    if (!me) return;
    if (adm.empregadoIdCriado) { alert("Empregado já criado no sistema."); return; }
    if (!temDadosFinaisCompletos(adm)) {
      alert("Pra criar o empregado preciso dos dados da vaga: cargo, data de admissão, salário e horário.\n\nPreencha em 'Ver/editar dados' no checklist do card.");
      return;
    }
    if (!confirm(`Criar Pessoa + Empregado de ${adm.candidato.nome} no sistema?\n\nDá acesso a ele e já deixa o registro pronto. A admissão continua no Kanban — concluir/arquivar é só no final.`)) return;
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

  // CONCLUIR a admissão — encerra/arquiva (sai do Kanban ativo, vai pra
  // Finalizadas). Só no final. Garante que o empregado exista (cria na hora
  // como rede de segurança se ainda não foi criado).
  // Limpeza best-effort ao concluir: apaga do Storage os docs já no Drive.
  async function limpezaPosConclusao(adm: Admissao) {
    try {
      const n = await expurgarDocumentosNoStorage(adm);
      alert(`Admissão concluída e arquivada.${n > 0 ? `\n\n${n} documento(s) já no Drive foram limpos do Storage.` : ""}`);
    } catch {
      alert("Admissão concluída e arquivada.");
    }
  }

  async function concluirAdmissao(adm: Admissao) {
    if (!me) return;
    if (adm.finalizadoEm) { alert("Admissão já concluída."); return; }
    // Empregado já existe → só arquiva.
    if (adm.empregadoIdCriado) {
      if (!confirm(`Concluir e arquivar a admissão de ${adm.candidato.nome}?\n\nEla sai do Kanban ativo e vai pra aba Finalizadas (pode reabrir depois).`)) return;
      try {
        await finalizarAdmissao(adm.id, me);
        await limpezaPosConclusao(adm);
      } catch (e) {
        alert("Erro ao concluir: " + (e instanceof Error ? e.message : "?"));
      }
      return;
    }
    // Empregado ainda NÃO criado → escolher criar novo ou vincular existente.
    setConcluirModalAdm(adm);
  }

  // Conclusão criando Pessoa+Empregado novos (a partir do modal).
  async function concluirCriandoNova(adm: Admissao) {
    if (!me) return;
    if (!temDadosFinaisCompletos(adm)) {
      alert("Pra criar o empregado preciso dos dados da vaga: cargo, data de admissão, salário e horário.\n\nPreencha em 'Ver/editar dados' no checklist do card — ou vincule uma pessoa já existente.");
      return;
    }
    try {
      await aprovarAdmissao(adm, me);
      await finalizarAdmissao(adm.id, me);
      setConcluirModalAdm(null);
      await limpezaPosConclusao(adm);
    } catch (e) {
      alert("Erro ao concluir: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Conclusão vinculando uma pessoa que já existe no sistema (a partir do modal).
  async function concluirVinculando(adm: Admissao, pessoaId: string) {
    if (!me) return;
    try {
      await vincularPessoaEConcluir(adm, pessoaId, me);
      setConcluirModalAdm(null);
      await limpezaPosConclusao(adm);
    } catch (e) {
      alert("Erro ao vincular/concluir: " + (e instanceof Error ? e.message : "?"));
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
      const nome1 = (adm.candidato.nome || "").split(" ")[0] || adm.candidato.nome;
      // 1) Envia pelo NÚMERO DA PLATAFORMA (template aprovado). Automático.
      const r = await enviarWhatsapp({
        to: adm.candidato.whatsapp, template: "admissao_formulario",
        params: [nome1, activeRestaurant.nome, url],
        contexto: "admissao_link", restaurantId: activeRestaurant.id, criadoPor: me.id,
      });
      if (r.ok) { alert(`✅ Link enviado pra ${nome1} pelo WhatsApp da plataforma.`); return; }
      // 2) Fallback: abre o SEU WhatsApp com a mensagem pronta (envio manual).
      const msg = montarMensagemEnvioLink(adm.candidato.nome, activeRestaurant.nome, url, prazoDias, activeRestaurant);
      if (!(adm.candidato.whatsapp || "").replace(/\D/g, "")) { alert(r.erro ? `Falha no envio automático (${r.erro}) e WhatsApp do candidato inválido.` : "WhatsApp do candidato inválido — confira o cadastro."); return; }
      alert((r.naoConfigurado ? "WhatsApp da plataforma não configurado." : `Envio automático falhou (${r.erro || "erro"}).`) + "\n\nAbrindo no WhatsApp interno pra enviar…");
      await abrirWhatsapp(rid, "empregados", adm.candidato.whatsapp, nome1, msg);
    } catch (e) {
      alert("Erro ao enviar link: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Lembrete ao candidato (WhatsApp) — mensagem preparada, você confirma ao
  // abrir. Diferente do "reenviar": não renova prazo, só cutuca.
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
      await abrirWhatsapp(rid, "empregados", adm.candidato.whatsapp, adm.candidato.nome, msg);
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
              // Limpa do Storage os docs já no Drive (admissão cancelada não
              // chega ao "Concluir"). Best-effort — não bloqueia o cancelamento.
              try { await expurgarDocumentosNoStorage(admCancelando); } catch { /* ignora */ }
              setAdmCancelando(null);
            } catch (e) {
              alert("Erro ao cancelar: " + (e instanceof Error ? e.message : "?"));
            }
          }}
        />
      )}

      {concluirModalAdm && me && (
        <ConcluirAdmissaoModal
          candidatoNome={concluirModalAdm.candidato.nome}
          candidatoCpf={concluirModalAdm.candidato.cpf}
          onCriarNova={() => concluirCriandoNova(concluirModalAdm)}
          onVincular={(pid) => concluirVinculando(concluirModalAdm, pid)}
          onClose={() => setConcluirModalAdm(null)}
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
                    onCriarEmpregado={() => criarEmpregado(a)}
                    onConcluir={() => concluirAdmissao(a)}
                    onCopiarLink={() => copiarLink(a)}
                    onEstender={(h) => estender(a, h)}
                    onDesfazerExtensao={() => desfazerExtensao(a)}
                    onNovoToken={() => novoToken(a)}
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
  onClickCard, onDragStart, onDragEnd, onMoverPara, onExcluir, onCancelar, onReabrir, onAbrirFormulario, onEnviarLink, onCriarEmpregado, onConcluir, onCopiarLink, onEstender, onDesfazerExtensao, onNovoToken,
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
  onCriarEmpregado: () => void;
  onConcluir: () => void;
  onCopiarLink: () => void;
  onEstender: (horas: number) => void;
  onDesfazerExtensao: () => void;
  onNovoToken: () => void;
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
  const [menu, setMenu] = useState<null | "kebab" | "link">(null);

  const fechaMenu = (e: React.MouseEvent, fn?: () => void) => { e.stopPropagation(); setMenu(null); fn?.(); };
  const btnPrim = "w-full px-2 py-1.5 rounded-md text-[11px] font-semibold";
  const btnGhost = "w-full mt-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800";
  const itemMenu = "w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200";
  const mostraCriar = !ehTerminal && !adm.empregadoIdCriado && temDadosFinaisCompletos(adm);
  const pz = adm.status === "formulario_enviado" ? prazoLabel(adm.expiraEm) : null;

  return (
    <div
      draggable={!ehTerminal}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClickCard}
      className={`relative bg-white dark:bg-gray-900 border rounded-lg px-3 py-2 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-all ${
        isDragging ? "opacity-40" : ""
      } ${
        atrasos > 0
          ? "border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-900/10"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      {/* Backdrop pra fechar menus ao clicar fora */}
      {menu && <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenu(null); }} />}

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
        {/* ⋯ menu (mover etapa / cancelar) — não-terminal */}
        {!ehTerminal && (
          <div className="relative flex-none">
            <button
              type="button"
              title="Mais ações"
              onClick={(e) => { e.stopPropagation(); setMenu(menu === "kebab" ? null : "kebab"); }}
              className="-mr-1 w-7 h-7 grid place-items-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-lg leading-none"
            >
              ⋯
            </button>
            {menu === "kebab" && (
              <div className="absolute z-50 right-0 mt-1 w-52 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg p-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-2 pt-1 pb-0.5">Mover etapa</div>
                {proxColId && <button type="button" onClick={(e) => fechaMenu(e, () => onMoverPara(proxColId))} className={itemMenu}>▶ Avançar etapa</button>}
                {anteColId && <button type="button" onClick={(e) => fechaMenu(e, () => onMoverPara(anteColId))} className={itemMenu}>◀ Voltar etapa</button>}
                {!proxColId && !anteColId && <div className="text-[11px] text-gray-400 px-2 py-1">Sem etapa pra mover.</div>}
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1.5" />
                <button type="button" onClick={(e) => fechaMenu(e, onCancelar)} className={`${itemMenu} !text-rose-600 dark:!text-rose-400`}>✕ Cancelar admissão</button>
              </div>
            )}
          </div>
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

      {/* Prazo (aguardando preenchimento) */}
      {pz && (
        <div className={`mt-2 text-[10px] font-semibold ${pz.vencido ? "text-rose-600 dark:text-rose-400" : pz.urgente ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
          ⏰ {pz.txt}
        </div>
      )}

      {/* ── Ações por etapa (não-terminal) ── */}
      {!ehTerminal && (
        <div className="mt-2">
          {/* A admitir: enviar o formulário */}
          {adm.status === "a_admitir" && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onEnviarLink(); }}
              className={`${btnPrim} bg-emerald-600 hover:bg-emerald-700 text-white`}
              title="Gera o link e abre o WhatsApp pro candidato preencher. Move o card pra 'Aguardando' e inicia o prazo.">
              📨 Enviar formulário
            </button>
          )}

          {/* Aguardando: split "Enviar no WhatsApp" + menu de link */}
          {adm.status === "formulario_enviado" && (
            <div className="relative flex">
              <button type="button" onClick={(e) => { e.stopPropagation(); onEnviarLink(); }}
                className="flex-1 px-2 py-1.5 rounded-l-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                title="Reabre o WhatsApp com o link e renova o prazo">
                📨 Enviar no WhatsApp
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setMenu(menu === "link" ? null : "link"); }}
                className="px-2 rounded-r-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] border-l border-emerald-500/60"
                title="Mais opções de link">
                ▾
              </button>
              {menu === "link" && (
                <div className="absolute z-50 right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg p-1.5">
                  <button type="button" onClick={(e) => fechaMenu(e, onCopiarLink)} className={itemMenu}>📋 Copiar link</button>
                  <button type="button" onClick={(e) => fechaMenu(e, () => onEstender(12))} className={itemMenu}>⏱ Estender prazo +12h</button>
                  {(adm.extensoesPrazo?.length ?? 0) > 0 && (
                    <button type="button" onClick={(e) => fechaMenu(e, onDesfazerExtensao)} className={itemMenu}>↩ Desfazer extensão</button>
                  )}
                  <button type="button" onClick={(e) => fechaMenu(e, onNovoToken)} className={`${itemMenu} !text-rose-600 dark:!text-rose-400`}>🔑 Gerar link novo</button>
                </div>
              )}
            </div>
          )}

          {/* Criar empregado — dados completos */}
          {mostraCriar && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onCriarEmpregado(); }}
              className={`${btnPrim} ${adm.status === "formulario_enviado" || adm.status === "a_admitir" ? "mt-1.5 " : ""}bg-indigo-600 hover:bg-indigo-700 text-white`}
              title="Cria Pessoa + Empregado no sistema e dá acesso. A admissão continua no Kanban.">
              👤 Criar empregado
            </button>
          )}
          {adm.empregadoIdCriado && (
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1.5">
              👤 empregado criado no sistema ✓
            </div>
          )}

          {/* Concluir — etapa final */}
          {adm.status === "admitido" && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onConcluir(); }}
              className={`${btnPrim} mt-1.5 bg-emerald-600 hover:bg-emerald-700 text-white`}
              title="Encerra e arquiva a admissão (vai pra aba Finalizadas).">
              ✅ Concluir admissão
            </button>
          )}

          {/* Ver / editar formulário — secundário, todas as etapas */}
          <button type="button" onClick={(e) => { e.stopPropagation(); onAbrirFormulario(); }}
            className={btnGhost}
            title="Abre o formulário do candidato. Se você editar e salvar, assume o preenchimento.">
            📝 Ver / editar formulário
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
