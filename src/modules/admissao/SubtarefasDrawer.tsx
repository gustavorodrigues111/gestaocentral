// ════════════════════════════════════════════════════════════════════════════
//  Drawer lateral — checklist completo da admissão agrupado por coluna do
//  Kanban e, dentro de cada coluna, sub-agrupado por checklist temático.
//
//  Aberto ao clicar num card do Kanban ou pelo botão "📋 Checklist da etapa"
//  na lista. Em modo "avancar" mostra rodapé com botão de confirmar avanço.
// ════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Admissao, Cargo, KanbanColuna, Pessoa, Restaurant, SubtarefaAdmissao } from "../../core/types";
import {
  atualizarSubtarefa,
  atualizarDadosBancariosItau,
  limparPendenciaEtapa,
  marcarDocumentosRecebidos,
  getClinicaInfo,
  getContatoClinica,
  getContatoContabilidade,
  getContatoFinanceiro,
  getKanbanColunas,
  getSubtarefasTemplate,
  getPrazoDias,
  linkWhatsAppCandidato,
  montarCorpoEmailClinica,
  montarMensagemInstrucoesCandidato,
  montarMensagemBancoFinanceiro,
  progressoSubtarefasColuna,
  proximoStatus,
  sincronizarSubtarefasComTemplate,
  statusEfetivo,
  subtarefasPendentesObrigatorias,
} from "../../core/admissao/admissaoHelpers";
import { ADMISSAO_STATUS_LABEL, type ContatoExterno } from "../../core/types";
import {
  baixarFichaAdmissao,
  montarCorpoEmailContabilidade,
  montarGmailComposeUrl,
} from "../../core/admissao/exportFicha";
import { ConfirmarDocumentosModal } from "./ConfirmarDocumentosModal";
import { ModalLigarContato } from "./ModalLigarContato";
import { EditarCandidatoModal } from "./EditarCandidatoModal";
import { PreencherDadosBasicosModal } from "./PreencherDadosBasicosModal";
import { ChecklistTermosModal } from "./ChecklistTermosModal";
import { NovaEntregaModal } from "../uniformes/NovaEntregaModal";
import {
  marcarLinkEnviado, urlPublicaAdmissao, montarMensagemEnvioLink,
  montarMensagemKitAssinatura, finalizarAdmissao, registrarExecucao,
  montarHistoricoAdmissao, aprovarAdmissao, temDadosFinaisCompletos,
  salvarDriveFolderMeta, expurgarDocumentosNoStorage,
} from "../../core/admissao/admissaoHelpers";
import { gerarCascataAdmissao } from "../tarefas/generator";
import { carregarCargo } from "../exames/gerador";
import { isDriveConfigured } from "../../core/google/driveConfig";
import { ensureEmployeeDriveTree, vincularPastaExistente } from "../../core/google/driveAdmissao";
import { uploadFileToFolder } from "../../core/google/driveClient";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../../core/firebase/config";
import type { DocumentoAdmissaoArquivo, DocumentoAdmissaoEnvio } from "../../core/types";

function colunaCapturaStatus(col: KanbanColuna, st: string): boolean {
  if (!col.statusAuto) return false;
  if (Array.isArray(col.statusAuto)) return col.statusAuto.includes(st as never);
  return col.statusAuto === st;
}

// Gera o label do botão de atalho de contato baseado no canal preferido.
// Ex: "📧 Abrir Gmail pra Senador Contábil" ou "📞 Ligar pra Triagem".
function labelContato(rest: Restaurant, tipo: "clinica" | "contabilidade" | "financeiro"): string {
  const contato = tipo === "clinica"
    ? rest?.contatosAdmissao?.clinicaExames
    : tipo === "contabilidade"
    ? rest?.contatosAdmissao?.contabilidade
    : rest?.contatosAdmissao?.financeiroBanco;
  // Resolve canal preferido (fallback pros defaults dependendo do tipo)
  const canal = contato?.canalPreferido
    ?? (tipo === "clinica" ? "telefone" : tipo === "contabilidade" ? "email" : "whatsapp");
  const nomeContato = contato?.nome
    ?? (tipo === "clinica" ? "clínica" : tipo === "contabilidade" ? "contabilidade" : "financeiro");
  if (canal === "email") return `📧 Abrir Gmail pra ${nomeContato}`;
  if (canal === "whatsapp") return `📱 Abrir WhatsApp ${nomeContato}`;
  return `📞 Ligar pra ${nomeContato}`;
}

type Props = {
  admissao: Admissao;
  cargos: Cargo[];
  activeRestaurant: Restaurant;
  pessoa: Pessoa;
  onClose: () => void;
  intencao?: "ver" | "avancar";
  onConfirmarAvanco?: () => void;
};

export function SubtarefasDrawer({
  admissao, cargos, activeRestaurant, pessoa, onClose,
  intencao = "ver", onConfirmarAvanco,
}: Props) {
  const colunas = useMemo(
    () => [...getKanbanColunas(activeRestaurant)].sort((a, b) => a.ordem - b.ordem),
    [activeRestaurant],
  );
  const cargo = cargos.find((c) => c.id === admissao.cargoId);
  const st = statusEfetivo(admissao);
  const colunaAtual: KanbanColuna | undefined =
    colunas.find((c) => colunaCapturaStatus(c, st)) || colunas[0];
  const subtarefas = admissao.subtarefas || [];
  // Se existe a subtarefa de conferir docs, a conferência aparece INLINE logo
  // abaixo dela (mais perto da ação). Senão, cai num bloco no rodapé.
  const temSubtarefaConferirDocs = subtarefas.some((s) => s.id === "st_conferir_docs");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [criandoEmp, setCriandoEmp] = useState(false);

  // Criar Pessoa + Empregado no sistema (dá acesso). Pode ser feito cedo —
  // a escala só mostra a partir da data de admissão. Não encerra a admissão.
  async function criarEmpregadoDrawer() {
    if (admissao.empregadoIdCriado || !temDadosFinaisCompletos(admissao)) return;
    if (!window.confirm(`Criar Pessoa + Empregado de ${admissao.candidato.nome} no sistema?\n\nDá acesso a ele e deixa o registro pronto. A admissão continua normalmente — concluir/arquivar é só no final.`)) return;
    setCriandoEmp(true);
    try {
      await aprovarAdmissao(admissao, pessoa);
      alert("Empregado criado no sistema ✓ — acesso liberado.");
    } catch (e) {
      alert("Erro ao criar empregado: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setCriandoEmp(false);
    }
  }
  // Quando uma subtarefa abre o modal de docs WhatsApp, guardamos a admissão
  // pra o modal usar — fechamos quando o modal fecha.
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  // Modal de "ligar pro contato" (canal=telefone) — aberto sob demanda
  const [ligarContato, setLigarContato] = useState<{
    contato: ContatoExterno;
    script: string;
    onConfirmar: () => void;
  } | null>(null);

  // Sincroniza com o template atual ao abrir o drawer: subtarefas adicionadas
  // ou alteradas no template global ganham efeito retroativo nas admissões
  // existentes. Idempotente — só persiste se houver diferença. Defer pra
  // depois do primeiro paint pra não bloquear a abertura visual do drawer.
  // Sanitiza pra remover undefined (Firestore rejeita) e loga erros — antes
  // o save falhava em silêncio pra subtarefas não-feitas (feitaEm undefined).
  useEffect(() => {
    const t = setTimeout(() => {
      const template = getSubtarefasTemplate(activeRestaurant);
      const { sincronizadas, adicionou } = sincronizarSubtarefasComTemplate(subtarefas, template);
      if (!adicionou) return;
      updateDoc(doc(db, "admissoes", admissao.id), sanitizeForFirestore({
        subtarefas: sincronizadas,
        updatedAt: new Date().toISOString(),
      })).catch((err) => {
        console.error("[SubtarefasDrawer] sync falhou:", err);
      });
    }, 50);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissao.id]);

  // Limpa entradas em etapasComPendencias quando todas as obrigatórias da
  // coluna ficam completas — o sinalizador ⚠️ some do card automaticamente.
  // Roda sempre que subtarefas mudam.
  useEffect(() => {
    const pend = admissao.etapasComPendencias;
    if (!pend) return;
    for (const colId of Object.keys(pend)) {
      if (!pend[colId]) continue;
      const aindaPendentes = subtarefasPendentesObrigatorias(admissao, colId).length;
      if (aindaPendentes === 0) {
        // Fogo-e-esqueça — múltiplas chamadas concorrentes são idempotentes
        void limparPendenciaEtapa(admissao.id, colId, pend);
      }
    }
  }, [admissao]);

  async function toggle(s: SubtarefaAdmissao) {
    setSalvando(s.id);
    try {
      await atualizarSubtarefa(admissao, s.id, { feita: !s.feita }, pessoa);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  // Cria/vincula a pasta do empregado no Drive (subtarefa de DADOS BÁSICOS).
  // Abre o Picker já dentro de "Empregados Ativos": o DP vê as pastas
  // existentes (+ busca) e SELECIONA a da pessoa se já existir (evita
  // duplicata); se cancelar, oferece criar uma nova. Marca a subtarefa como
  // feita e guarda a URL da pasta como link dela.
  async function criarPastaDrive(s: SubtarefaAdmissao) {
    const parentId = activeRestaurant.driveEmpregadosAtivosFolderId;
    if (!parentId) {
      alert("Configure a pasta 'Empregados Ativos' desta empresa em Admissão → Configurações antes.");
      return;
    }
    setSalvando(s.id);
    try {
      const picked = await pickDriveFolder(
        `Pasta de ${admissao.candidato.nome} — selecione a existente (ou feche pra criar nova)`,
        parentId,
      );
      let folderUrl: string;
      if (picked) {
        const tree = await vincularPastaExistente(admissao, picked.id);
        folderUrl = tree.folderUrl;
        await salvarDriveFolderMeta(admissao.id, "vinculada", pessoa);
      } else {
        const ok = confirm(
          `Nenhuma pasta selecionada.\n\nCriar uma NOVA pasta "${admissao.candidato.nome}" em "Empregados Ativos"?`,
        );
        if (!ok) { setSalvando(null); return; }
        const tree = await ensureEmployeeDriveTree(admissao, activeRestaurant);
        folderUrl = tree.folderUrl;
        await salvarDriveFolderMeta(admissao.id, "criada", pessoa);
      }
      await atualizarSubtarefa(admissao, s.id, { feita: true, link: folderUrl }, pessoa);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Falha ao criar/vincular a pasta no Drive.");
    } finally {
      setSalvando(null);
    }
  }

  async function salvarLink(s: SubtarefaAdmissao, link: string) {
    setSalvando(s.id);
    try {
      await atualizarSubtarefa(admissao, s.id, { link }, pessoa);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  async function salvarObs(s: SubtarefaAdmissao, obs: string) {
    setSalvando(s.id);
    try {
      await atualizarSubtarefa(admissao, s.id, { observacao: obs }, pessoa);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  async function salvarDataAgendada(s: SubtarefaAdmissao, dataAgendada: string) {
    setSalvando(s.id);
    try {
      await atualizarSubtarefa(admissao, s.id, { dataAgendada }, pessoa);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  async function salvarDadosBancarios(s: SubtarefaAdmissao, patch: Partial<{ tipo: "salario" | "corrente"; agencia: string; conta: string }>) {
    setSalvando(s.id);
    try {
      await atualizarDadosBancariosItau(admissao.id, patch, admissao.dadosBancariosItau);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(null);
    }
  }

  // Despacha o atalho de contato externo pro canal preferido configurado
  // (email = Gmail compose; whatsapp = api.whatsapp.com; telefone = modal
  // com número + script + botão Ligar). Tipo do contato vem do atalho da
  // subtarefa (clinica/contabilidade/financeiro). Mensagem é montada
  // específica pra cada tipo.
  function abrirContato(
    s: SubtarefaAdmissao,
    tipo: "clinica" | "contabilidade" | "financeiro",
  ) {
    // Resolve contato + mensagem específica
    let contato: ContatoExterno;
    let assunto: string;
    let corpo: string;
    if (tipo === "clinica") {
      contato = getContatoClinica(activeRestaurant);
      assunto = `Agendamento exame admissional — ${admissao.candidato.nome}`;
      corpo = montarCorpoEmailClinica(admissao, cargo?.nome, activeRestaurant.nome, activeRestaurant);
    } else if (tipo === "contabilidade") {
      contato = getContatoContabilidade(activeRestaurant);
      assunto = `Solicitação de admissão — ${admissao.candidato.nome} (${activeRestaurant.nome})`;
      corpo = montarCorpoEmailContabilidade(admissao, cargo, activeRestaurant.nome, activeRestaurant);
    } else {
      contato = getContatoFinanceiro(activeRestaurant);
      // Pré-check pro financeiro: precisa dos dados bancários antes
      const dados = admissao.dadosBancariosItau;
      if (!dados?.tipo || !dados?.agencia?.trim() || !dados?.conta?.trim()) {
        alert("Preencha os dados bancários Itaú (tipo, agência e conta) antes de solicitar o cadastro.");
        return;
      }
      assunto = "Cadastro de empregado no banco interno";
      corpo = montarMensagemBancoFinanceiro(admissao, activeRestaurant);
    }

    // Despacha por canal
    if (contato.canalPreferido === "email") {
      if (!contato.email?.trim()) {
        alert(`O contato "${contato.nome}" está marcado pra email mas não tem email cadastrado. Configure em ⚙️ Configurações.`);
        return;
      }
      const url = montarGmailComposeUrl({ to: contato.email, subject: assunto, body: corpo });
      window.open(url, "_blank");
      if (!s.feita) void toggle(s);
    } else if (contato.canalPreferido === "whatsapp") {
      const num = (contato.whatsapp || "").replace(/\D/g, "");
      if (!num) {
        alert(`O contato "${contato.nome}" está marcado pra WhatsApp mas não tem número cadastrado. Configure em ⚙️ Configurações.`);
        return;
      }
      const numCompleto = num.length === 10 || num.length === 11 ? `55${num}` : num;
      const url = `https://api.whatsapp.com/send?phone=${numCompleto}&text=${encodeURIComponent(corpo)}`;
      window.open(url, "_blank");
      if (!s.feita) void toggle(s);
    } else {
      // telefone — abre modal com número + script
      setLigarContato({
        contato,
        script: corpo,
        onConfirmar: () => { if (!s.feita) void toggle(s); },
      });
    }
  }

  function abrirWhatsappInstrucoes(s: SubtarefaAdmissao) {
    if (!s.dataAgendada) {
      alert("Defina a data e hora do exame antes de enviar a mensagem de instruções.");
      return;
    }
    const clinica = getClinicaInfo(activeRestaurant);
    const prazoDocs = getPrazoDias(activeRestaurant) + 1; // +24h em relação ao form
    const msg = montarMensagemInstrucoesCandidato(
      admissao,
      activeRestaurant.nome,
      s.dataAgendada,
      clinica,
      prazoDocs,
      activeRestaurant,
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert("WhatsApp do candidato inválido — confira o cadastro.");
      return;
    }
    window.open(link, "_blank");
    if (!s.feita) void toggle(s);
  }


  function abrirChecklistDocs(_s: SubtarefaAdmissao) {
    setDocsModalOpen(true);
  }

  // 📨 Enviar link do formulário pro candidato via WhatsApp.
  // Marca enviadoEm/expiraEm + atalho aplicarAutoTrigger("link_enviado")
  // (que não tem efeito no template novo sem autoTrigger — mas é idempotente
  // pra admissões legadas) + abre WhatsApp pré-preenchido. NÃO marca a
  // subtarefa como feita — o usuário marca o checkbox quando o cliente
  // confirmar recebimento.
  // Registra que a ação de uma subtarefa rodou (audit + base do "↻ refazer").
  // Só pras ações que FAZEM algo externo (enviar/contato/gerar) — não pra
  // abrir modal de edição. Erro silencioso pra não atrapalhar a ação em si.
  function registrar(subId: string, tipo: string) {
    void registrarExecucao(admissao, subId, tipo, pessoa).catch(() => { /* noop */ });
  }

  async function abrirEnviarLinkForm(_s: SubtarefaAdmissao) {
    try {
      const prazoDias = getPrazoDias(activeRestaurant);
      await marcarLinkEnviado(admissao, prazoDias, pessoa);
      const url = urlPublicaAdmissao(admissao.token, activeRestaurant.subdomain);
      const msg = montarMensagemEnvioLink(
        admissao.candidato.nome,
        activeRestaurant.nome,
        url,
        prazoDias,
        activeRestaurant,
      );
      const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
      if (!link) {
        alert("WhatsApp do candidato inválido — confira o cadastro.");
        return;
      }
      window.open(link, "_blank");
    } catch (e) {
      alert("Erro ao enviar link: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Modais novos: edição de dados básicos do candidato e dados finais (vaga)
  const [showEditarCandidato, setShowEditarCandidato] = useState(false);
  const [showEditarDadosFinais, setShowEditarDadosFinais] = useState(false);
  // Checklist de termos a assinar (modal aberto pelo atalho da subtarefa
  // st_termos_assinatura)
  const [showChecklistTermos, setShowChecklistTermos] = useState(false);

  // 📋 Abre Clicksign em nova aba (atalho da subtarefa st_envio_kit_clicksign)
  function abrirClicksign() {
    window.open("https://app.clicksign.com/", "_blank", "noopener,noreferrer");
  }

  // Modal de gerar termo de uniformes ou EPIs — tipo decide
  const [gerarTermoTipo, setGerarTermoTipo] = useState<"uniforme" | "epi" | null>(null);

  // 📱 Avisa candidato via WhatsApp que mandamos o kit de assinatura por email
  function abrirAvisarKitAssinatura() {
    const msg = montarMensagemKitAssinatura(
      admissao.candidato.nome,
      activeRestaurant.nome,
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert("WhatsApp do candidato inválido — confira o cadastro.");
      return;
    }
    window.open(link, "_blank");
  }

  // 📥 Baixar planilha — XLSX da ficha de admissão. NÃO marca a subtarefa
  // como feita (é só uma utilidade — o "envio" propriamente dito é o
  // botão de email ao lado). Avisa se faltar dado essencial pra ficha.
  function abrirBaixarPlanilha(_s: SubtarefaAdmissao) {
    try {
      baixarFichaAdmissao(admissao, cargos, activeRestaurant.nome);
    } catch (e) {
      alert("Erro ao gerar planilha: " + (e instanceof Error ? e.message : "?"));
    }
  }

  // Rodapé de avanço: só aparece se intencao === "avancar"
  const proxStatus = proximoStatus(admissao.status);
  const proximaColuna = proxStatus
    ? colunas.find((c) => colunaCapturaStatus(c, proxStatus))
    : null;
  const pendentesObrigAtual = colunaAtual
    ? subtarefasPendentesObrigatorias(admissao, colunaAtual.id)
    : [];
  const podeAvancar = pendentesObrigAtual.length === 0;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] flex">
        <button
          type="button"
          onClick={onClose}
          className="hidden sm:block flex-1 bg-black/40"
          aria-label="Fechar"
        />
        {/* Backdrop fininho em mobile (sem flex-1 do desktop) — sempre dá pra
            clicar fora pra fechar. */}
        <button
          type="button"
          onClick={onClose}
          className="sm:hidden absolute inset-0 bg-black/40 z-0"
          aria-label="Fechar"
        />
        <aside className="relative z-10 w-full sm:max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden ml-auto">
          <header className="border-b border-gray-200 dark:border-gray-800 p-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Checklist de admissão
              </div>
              <h2 className="font-bold text-base text-gray-900 dark:text-gray-100 truncate">
                {admissao.candidato.nome}
              </h2>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {cargo?.nome || "—"} · Etapa atual: <strong>{colunaAtual?.nome || "—"}</strong>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-xl leading-none p-1"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* 👤 Empregado no sistema — criar cedo (dá acesso); não encerra a admissão */}
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
                👤 Empregado no sistema
              </div>
              {admissao.empregadoIdCriado ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ Criado
                  {admissao.aprovadoEm ? ` em ${new Date(admissao.aprovadoEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}` : ""}
                  {admissao.aprovadoPor ? ` por ${admissao.aprovadoPor.nome}` : ""} · acesso liberado
                </div>
              ) : temDadosFinaisCompletos(admissao) ? (
                <>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                    Cria o registro do empregado e libera o acesso dele. Pode fazer agora —
                    ele só aparece na escala a partir da data de admissão.
                  </p>
                  <button
                    type="button"
                    onClick={() => void criarEmpregadoDrawer()}
                    disabled={criandoEmp}
                    className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                  >
                    {criandoEmp ? "Criando…" : "👤 Criar empregado"}
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Preencha cargo, data de admissão, salário e horário (em "Ver/editar dados")
                  pra liberar a criação do empregado.
                </p>
              )}
            </div>

            {colunas
              .filter((c) => c.id !== "col_terminados")
              .map((col) => {
                const subs = subtarefas
                  .filter((s) => s.colunaId === col.id)
                  .sort((a, b) => a.ordem - b.ordem);
                if (subs.length === 0) return null;
                const prog = progressoSubtarefasColuna(admissao, col.id);
                const ehAtual = col.id === colunaAtual?.id;
                const pendObrig = subtarefasPendentesObrigatorias(admissao, col.id);

                // Agrupa por checklistId preservando ordem do primeiro item.
                const checklistsOrdem: string[] = [];
                const porChecklist = new Map<string, SubtarefaAdmissao[]>();
                for (const s of subs) {
                  const arr = porChecklist.get(s.checklistId) || [];
                  if (arr.length === 0) checklistsOrdem.push(s.checklistId);
                  arr.push(s);
                  porChecklist.set(s.checklistId, arr);
                }

                return (
                  <details
                    key={col.id}
                    open={ehAtual}
                    className={`rounded-lg border ${
                      ehAtual
                        ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-900/20"
                        : "border-gray-200 dark:border-gray-800"
                    }`}
                  >
                    <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 select-none">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: col.cor ? `#${col.cor}` : "#cbd5e1" }}
                      />
                      <span className={`font-semibold text-sm ${ehAtual ? "text-indigo-900 dark:text-indigo-200" : "text-gray-800 dark:text-gray-200"}`}>
                        {col.nome}
                      </span>
                      <span className="ml-auto text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                        {prog.feitas}/{prog.total}
                      </span>
                      {ehAtual && pendObrig.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                          {pendObrig.length} pendente{pendObrig.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </summary>
                    <div className="px-3 pb-3 space-y-3">
                      {checklistsOrdem.map((ckId) => {
                        const itens = porChecklist.get(ckId) || [];
                        const nomeCk = itens[0]?.checklistNome || ckId;
                        const feitasCk = itens.filter((s) => s.feita).length;
                        return (
                          <div key={ckId} className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              <span>{nomeCk}</span>
                              <span className="ml-auto tabular-nums">{feitasCk}/{itens.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {itens.map((s) => (
                                <Fragment key={s.id}>
                                <SubtarefaRow
                                  sub={s}
                                  admissao={admissao}
                                  salvando={salvando === s.id}
                                  onToggle={() => toggle(s)}
                                  onLink={(link) => salvarLink(s, link)}
                                  onObs={(obs) => salvarObs(s, obs)}
                                  onDataAgendada={(d) => salvarDataAgendada(s, d)}
                                  onDadosBancarios={(p) => salvarDadosBancarios(s, p)}
                                  onAtalhoContato={(tipo) => { abrirContato(s, tipo); registrar(s.id, "contato_" + tipo); }}
                                  onAtalhoWhatsappInstrucoes={() => { abrirWhatsappInstrucoes(s); registrar(s.id, "whatsapp_instrucoes"); }}
                                  onAtalhoChecklistDocs={() => abrirChecklistDocs(s)}
                                  onAtalhoBaixarPlanilha={() => { abrirBaixarPlanilha(s); registrar(s.id, "baixar_planilha"); }}
                                  onAtalhoEditarCandidato={() => setShowEditarCandidato(true)}
                                  onAtalhoEditarDadosFinais={() => setShowEditarDadosFinais(true)}
                                  onAtalhoEnviarLinkForm={() => { abrirEnviarLinkForm(s); registrar(s.id, "enviar_link_form"); }}
                                  onAtalhoChecklistTermos={() => setShowChecklistTermos(true)}
                                  onAtalhoClicksign={() => { abrirClicksign(); registrar(s.id, "abrir_clicksign"); }}
                                  onAtalhoWhatsappKit={() => { abrirAvisarKitAssinatura(); registrar(s.id, "whatsapp_kit"); }}
                                  onAtalhoGerarTermoUniformes={() => { setGerarTermoTipo("uniforme"); registrar(s.id, "gerar_termo_uniforme"); }}
                                  onAtalhoGerarTermoEpis={() => { setGerarTermoTipo("epi"); registrar(s.id, "gerar_termo_epi"); }}
                                  onAtalhoCriarPastaDrive={() => { criarPastaDrive(s); registrar(s.id, "criar_pasta_drive"); }}
                                  contatoLabel={(tipo) => labelContato(activeRestaurant, tipo)}
                                />
                                {s.id === "st_conferir_docs" && (
                                  <DocumentosConferencia
                                    admissao={admissao}
                                    activeRestaurant={activeRestaurant}
                                    pessoa={pessoa}
                                  />
                                )}
                                {s.id === "st_pasta_drive" && (
                                  <div className="pl-1">
                                    <PastaDriveInfo admissao={admissao} />
                                  </div>
                                )}
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}

          {/* 📎 Documentos do candidato — fallback no rodapé só quando NÃO existe
              a subtarefa de conferir docs (senão aparece inline acima). */}
          {!temSubtarefaConferirDocs && (
            <DocumentosConferencia
              admissao={admissao}
              activeRestaurant={activeRestaurant}
              pessoa={pessoa}
            />
          )}

          {/* 🕘 Histórico — linha do tempo de tudo que rolou na admissão */}
          {(() => {
            const hist = montarHistoricoAdmissao(admissao);
            return (
              <details className="rounded-lg border border-gray-200 dark:border-gray-800">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 select-none">
                  🕘 Histórico ({hist.length})
                </summary>
                <div className="px-3 pb-3 space-y-1.5">
                  {hist.length === 0 && <div className="text-[11px] text-gray-400 italic">Sem eventos ainda.</div>}
                  {hist.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <span className="text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
                        {new Date(e.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-gray-700 dark:text-gray-200">{e.texto}{e.por ? <span className="text-gray-400"> · {e.por}</span> : null}</span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}
          </div>

          {intencao === "avancar" && onConfirmarAvanco && proxStatus && (
            <footer className="border-t border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900/60">
              {podeAvancar ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1">
                  ✓ Tudo pronto pra avançar — todas as obrigatórias de
                  "<strong>{colunaAtual?.nome}</strong>" estão marcadas.
                </div>
              ) : (
                <div className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                  ⚠ Faltam <strong>{pendentesObrigAtual.length} obrigatória(s)</strong> em
                  "<strong>{colunaAtual?.nome}</strong>". Marque acima pra liberar o avanço.
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={onConfirmarAvanco}
                  disabled={!podeAvancar}
                  className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  ▶ Avançar pra "{proximaColuna?.nome || ADMISSAO_STATUS_LABEL[proxStatus]}"
                </button>
              </div>
            </footer>
          )}

          {/* Footer alternativo: status final (admitido) + ainda não
              finalizada. Botão arquiva a admissão pro histórico — Kanban
              ativo deixa de mostrá-la. */}
          {admissao.status === "admitido" && !admissao.finalizadoEm && (
            <footer className="border-t border-gray-200 dark:border-gray-800 p-4 bg-emerald-50/40 dark:bg-emerald-900/10">
              <div className="text-xs text-emerald-800 dark:text-emerald-300 mb-2">
                ✓ Admissão concluída. Quando o onboarding terminar, finalize
                pra tirar do Kanban ativo — fica em "Finalizadas" e pode
                ser reativada se precisar.
              </div>
              <div className="flex justify-end gap-2 flex-wrap">
                {/* Botão de retroação: dispara cascata pra criar Experiência
                    1ª/2ª no Gestor de Tarefas. Idempotente (recorrenciaKey).
                    Só faz sentido quando empregado + data já estão setados. */}
                {admissao.empregadoIdCriado && admissao.dataAdmissao && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(
                        `Sincronizar prazos de experiência de ${admissao.candidato.nome}?\n\n` +
                        `Cria as tarefas Experiência 1ª (45d) e 2ª (90d) no Gestor de Tarefas. ` +
                        `Se já existirem, não duplica.`,
                      )) return;
                      try {
                        const cargo = admissao.cargoId ? await carregarCargo(admissao.cargoId) : null;
                        const n = await gerarCascataAdmissao({
                          pessoaNome: admissao.candidato.nome,
                          empregadoId: admissao.empregadoIdCriado!,
                          restaurantId: admissao.restaurantId,
                          admissaoData: admissao.dataAdmissao!,
                          manipulaAlimentos: cargo?.area === "Cozinha" || cargo?.area === "Bar",
                          responsavelPadraoId: pessoa.id,
                          responsavelPadraoNome: pessoa.nome,
                          autorId: pessoa.id,
                          autorNome: pessoa.nome,
                        });
                        alert(n > 0
                          ? `✓ ${n} tarefa(s) de experiência criada(s) no Gestor de Tarefas.`
                          : "✓ Tarefas de experiência já existiam — nada novo criado.");
                      } catch (e) {
                        alert("Erro: " + (e instanceof Error ? e.message : "?"));
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                  >
                    🔁 Sincronizar prazos de experiência
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Finalizar a admissão de ${admissao.candidato.nome}?\n\nSai do Kanban e vai pra aba "Finalizadas". Pode ser reativada depois.`)) return;
                    try {
                      await finalizarAdmissao(admissao.id, pessoa);
                      onClose();
                    } catch (e) {
                      alert("Erro ao finalizar: " + (e instanceof Error ? e.message : "?"));
                    }
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  ✓ Finalizar admissão
                </button>
              </div>
            </footer>
          )}
        </aside>
      </div>

      {docsModalOpen && (
        <ConfirmarDocumentosModal
          candidatoNome={admissao.candidato.nome}
          itensIniciais={admissao.checklistDocumentos?.itens}
          onClose={() => setDocsModalOpen(false)}
          onConfirm={async (itens) => {
            await marcarDocumentosRecebidos(admissao, pessoa, itens);
            setDocsModalOpen(false);
          }}
        />
      )}

      {ligarContato && (
        <ModalLigarContato
          contato={ligarContato.contato}
          scriptSugerido={ligarContato.script}
          onClose={() => setLigarContato(null)}
          onConfirmar={ligarContato.onConfirmar}
        />
      )}

      {showEditarCandidato && (
        <EditarCandidatoModal
          admissao={admissao}
          onClose={() => setShowEditarCandidato(false)}
        />
      )}

      {showEditarDadosFinais && (
        <PreencherDadosBasicosModal
          admissao={admissao}
          cargos={cargos}
          activeRestaurant={activeRestaurant}
          onClose={() => setShowEditarDadosFinais(false)}
          onSaved={() => setShowEditarDadosFinais(false)}
        />
      )}

      {showChecklistTermos && (
        <ChecklistTermosModal
          admissao={admissao}
          pessoa={pessoa}
          activeRestaurant={activeRestaurant}
          onClose={() => setShowChecklistTermos(false)}
        />
      )}

      {gerarTermoTipo && (
        <NovaEntregaWrapper
          tipo={gerarTermoTipo}
          admissao={admissao}
          restaurantId={admissao.restaurantId}
          activeRestaurant={activeRestaurant}
          pessoa={pessoa}
          onClose={() => setGerarTermoTipo(null)}
        />
      )}
    </>,
    document.body,
  );
}

function SubtarefaRow({
  sub,
  admissao,
  salvando,
  onToggle,
  onLink,
  onObs,
  onDataAgendada,
  onDadosBancarios,
  onAtalhoContato,
  onAtalhoWhatsappInstrucoes,
  onAtalhoChecklistDocs,
  onAtalhoBaixarPlanilha,
  onAtalhoEditarCandidato,
  onAtalhoEditarDadosFinais,
  onAtalhoEnviarLinkForm,
  onAtalhoChecklistTermos,
  onAtalhoClicksign,
  onAtalhoWhatsappKit,
  onAtalhoGerarTermoUniformes,
  onAtalhoGerarTermoEpis,
  onAtalhoCriarPastaDrive,
  contatoLabel,
}: {
  sub: SubtarefaAdmissao;
  admissao: Admissao;
  salvando: boolean;
  onToggle: () => void;
  onLink: (link: string) => void;
  onObs: (obs: string) => void;
  onDataAgendada: (d: string) => void;
  onDadosBancarios: (p: Partial<{ tipo: "salario" | "corrente"; agencia: string; conta: string }>) => void;
  onAtalhoContato: (tipo: "clinica" | "contabilidade" | "financeiro") => void;
  onAtalhoWhatsappInstrucoes: () => void;
  onAtalhoChecklistDocs: () => void;
  onAtalhoBaixarPlanilha: () => void;
  onAtalhoEditarCandidato: () => void;
  onAtalhoEditarDadosFinais: () => void;
  onAtalhoEnviarLinkForm: () => void;
  onAtalhoChecklistTermos: () => void;
  onAtalhoClicksign: () => void;
  onAtalhoWhatsappKit: () => void;
  onAtalhoGerarTermoUniformes: () => void;
  onAtalhoGerarTermoEpis: () => void;
  onAtalhoCriarPastaDrive: () => void;
  contatoLabel: (tipo: "clinica" | "contabilidade" | "financeiro") => string;
}) {
  const [linkLocal, setLinkLocal] = useState(sub.link || "");
  const [obsLocal, setObsLocal] = useState(sub.observacao || "");
  const [dataLocal, setDataLocal] = useState(sub.dataAgendada || "");
  const [agenciaLocal, setAgenciaLocal] = useState(admissao.dadosBancariosItau?.agencia || "");
  const [contaLocal, setContaLocal] = useState(admissao.dadosBancariosItau?.conta || "");
  const tipoConta = admissao.dadosBancariosItau?.tipo || "salario";
  const [showDetails, setShowDetails] = useState(false);

  const dadosBancariosCompletos = !!(
    admissao.dadosBancariosItau?.tipo &&
    admissao.dadosBancariosItau?.agencia?.trim() &&
    admissao.dadosBancariosItau?.conta?.trim()
  );

  return (
    <div className={`rounded-md border px-2.5 py-2 ${sub.feita ? "bg-emerald-50/40 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40" : "bg-white dark:bg-gray-900/40 border-gray-200 dark:border-gray-800"}`}>
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={sub.feita}
          disabled={salvando}
          onChange={onToggle}
          className="mt-0.5 accent-emerald-600 w-4 h-4 flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className={`text-xs ${sub.feita ? "text-gray-600 dark:text-gray-400 line-through" : "text-gray-900 dark:text-gray-100"} ${!sub.obrigatoria ? "italic" : ""}`}>
            {sub.nome}
            {sub.autoTrigger && (
              <span className="ml-1 text-[9px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                auto
              </span>
            )}
            {!sub.obrigatoria && (
              <span className="ml-1 text-[9px] uppercase tracking-wider text-gray-400">
                opcional
              </span>
            )}
          </div>
          {sub.feita && sub.feitaEm && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              ✓ {new Date(sub.feitaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {sub.feitaPor?.nome ? ` por ${sub.feitaPor.nome}` : ""}
            </div>
          )}
        </div>
      </label>

      {sub.pedeDataHora && (
        <div className="mt-2 flex flex-col gap-1 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded p-2">
          <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">
            📅 Data e horário do exame
          </label>
          <input
            type="datetime-local"
            value={dataLocal}
            onChange={(e) => setDataLocal(e.target.value)}
            onBlur={() => dataLocal !== (sub.dataAgendada || "") && onDataAgendada(dataLocal)}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      )}

      {sub.pedeDadosBancarios && (
        <div className="mt-2 flex flex-col gap-2 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded p-2">
          <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">
            🏦 Dados da conta Itaú do candidato
          </label>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="radio"
                name={`tipo-${sub.id}`}
                checked={tipoConta === "salario"}
                onChange={() => onDadosBancarios({ tipo: "salario" })}
                className="accent-indigo-600"
              />
              Salário
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="radio"
                name={`tipo-${sub.id}`}
                checked={tipoConta === "corrente"}
                onChange={() => onDadosBancarios({ tipo: "corrente" })}
                className="accent-indigo-600"
              />
              Corrente
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={agenciaLocal}
              onChange={(e) => setAgenciaLocal(e.target.value)}
              onBlur={() => agenciaLocal !== (admissao.dadosBancariosItau?.agencia || "") && onDadosBancarios({ agencia: agenciaLocal })}
              placeholder="Agência"
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <input
              type="text"
              value={contaLocal}
              onChange={(e) => setContaLocal(e.target.value)}
              onBlur={() => contaLocal !== (admissao.dadosBancariosItau?.conta || "") && onDadosBancarios({ conta: contaLocal })}
              placeholder="Conta"
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {(sub.atalho?.tipo === "contato_clinica" || sub.atalho?.tipo === "gmail_clinica") && (
          <button
            type="button"
            onClick={() => onAtalhoContato("clinica")}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {contatoLabel("clinica")}
          </button>
        )}
        {sub.atalho?.tipo === "contato_contabilidade" && (
          <>
            {/* Dois botões em vez de um único — o user escolhe a ordem:
                baixar planilha XLSX e abrir o Gmail compose. O envio em si
                é manual (anexa XLSX no Gmail antes de mandar). O botão de
                email é o que marca a subtarefa como feita (via abrirContato). */}
            <button
              type="button"
              onClick={onAtalhoBaixarPlanilha}
              className="text-[10px] px-2 py-0.5 rounded border border-indigo-600 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
            >
              📥 Baixar planilha
            </button>
            <button
              type="button"
              onClick={() => onAtalhoContato("contabilidade")}
              className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {contatoLabel("contabilidade")}
            </button>
          </>
        )}
        {sub.atalho?.tipo === "whatsapp_instrucoes_candidato" && (
          <button
            type="button"
            onClick={onAtalhoWhatsappInstrucoes}
            disabled={!sub.dataAgendada}
            title={sub.dataAgendada ? "" : "Preencha a data do exame antes"}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            📱 Enviar mensagem de instruções
          </button>
        )}
        {(sub.atalho?.tipo === "contato_financeiro" || sub.atalho?.tipo === "whatsapp_banco_financeiro") && (
          <button
            type="button"
            onClick={() => onAtalhoContato("financeiro")}
            disabled={!dadosBancariosCompletos}
            title={dadosBancariosCompletos ? "" : "Preencha os dados bancários da conta Itaú antes"}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {contatoLabel("financeiro")}
          </button>
        )}
        {sub.atalho?.tipo === "checklist_docs_whatsapp" && (
          <button
            type="button"
            onClick={onAtalhoChecklistDocs}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            📎 Abrir checklist de docs
          </button>
        )}
        {sub.atalho?.tipo === "editar_dados_basicos" && (
          <button
            type="button"
            onClick={onAtalhoEditarCandidato}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {sub.id === "st_dados_candidato"
              ? "✏️ Preencher dados básicos do candidato"
              : "✏️ Editar dados básicos"}
          </button>
        )}
        {sub.atalho?.tipo === "editar_dados_finais" && (
          <button
            type="button"
            onClick={onAtalhoEditarDadosFinais}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {sub.id === "st_dados_vaga"
              ? "✏️ Preencher dados da vaga"
              : "✏️ Editar dados finais"}
          </button>
        )}
        {sub.atalho?.tipo === "enviar_link_form" && (
          <button
            type="button"
            onClick={onAtalhoEnviarLinkForm}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            📨 Enviar link do formulário (WhatsApp)
          </button>
        )}
        {sub.atalho?.tipo === "checklist_termos_assinar" && (
          <button
            type="button"
            onClick={onAtalhoChecklistTermos}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            📋 Abrir checklist de kit de documentos para assinatura
          </button>
        )}
        {sub.atalho?.tipo === "abrir_clicksign" && (
          <button
            type="button"
            onClick={onAtalhoClicksign}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            🔗 Abrir Clicksign
          </button>
        )}
        {sub.atalho?.tipo === "criar_pasta_drive" && isDriveConfigured() && (
          <button
            type="button"
            onClick={onAtalhoCriarPastaDrive}
            disabled={salvando}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white"
          >
            {salvando ? "Abrindo…" : "📁 Criar/selecionar pasta do empregado"}
          </button>
        )}
        {sub.atalho?.tipo === "whatsapp_kit_assinatura" && (
          <button
            type="button"
            onClick={onAtalhoWhatsappKit}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            📱 Avisar candidato (WhatsApp)
          </button>
        )}
        {sub.atalho?.tipo === "gerar_termo_uniformes" && (
          <button
            type="button"
            onClick={onAtalhoGerarTermoUniformes}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            📦 Gerar termo de uniformes
          </button>
        )}
        {sub.atalho?.tipo === "gerar_termo_epis" && (
          <button
            type="button"
            onClick={onAtalhoGerarTermoEpis}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            🦺 Gerar termo de EPIs
          </button>
        )}
        {(sub.pedeLink || sub.observacao || sub.link) && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-[10px] text-gray-600 dark:text-gray-400 hover:underline"
          >
            {showDetails ? "ocultar" : sub.link || sub.observacao ? "ver detalhes" : "adicionar detalhes"}
          </button>
        )}
        {!sub.pedeLink && !sub.observacao && !sub.link && !sub.pedeDataHora && !sub.pedeDadosBancarios && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-[10px] text-gray-500 dark:text-gray-500 hover:underline"
          >
            {showDetails ? "ocultar obs" : "+ observação"}
          </button>
        )}
      </div>
      {sub.execucoes && sub.execucoes.length > 0 && (() => {
        const u = sub.execucoes[sub.execucoes.length - 1];
        return (
          <div className="mt-1 text-[9.5px] text-gray-400 dark:text-gray-500">
            ↻ ação feita {sub.execucoes.length}× · última {new Date(u.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} por {u.por.nome} · <span className="italic">o botão acima refaz</span>
          </div>
        );
      })()}
      {showDetails && (
        <div className="mt-2 space-y-1.5">
          {sub.pedeLink && (
            <div>
              <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block mb-0.5">
                Link (Drive, Dropbox, etc)
              </label>
              <input
                type="url"
                value={linkLocal}
                onChange={(e) => setLinkLocal(e.target.value)}
                onBlur={() => linkLocal !== (sub.link || "") && onLink(linkLocal)}
                placeholder="https://…"
                className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              {sub.link && (
                <a
                  href={sub.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 inline-block"
                >
                  abrir link salvo ↗
                </a>
              )}
            </div>
          )}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block mb-0.5">
              Observação
            </label>
            <textarea
              value={obsLocal}
              onChange={(e) => setObsLocal(e.target.value)}
              onBlur={() => obsLocal !== (sub.observacao || "") && onObs(obsLocal)}
              rows={2}
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
              placeholder="Nota interna…"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper que carrega itens + kits do módulo Uniformes sob demanda
// quando o usuário aciona "Gerar termo de uniformes/EPIs" no checklist.
function NovaEntregaWrapper({
  tipo, admissao, restaurantId, activeRestaurant, pessoa, onClose,
}: {
  tipo: "uniforme" | "epi";
  admissao: Admissao;
  restaurantId: string;
  activeRestaurant: Restaurant;
  pessoa: Pessoa;
  onClose: () => void;
}) {
  const [itensUniforme, setItensUniforme] = useState<import("../../core/types").ItemUniforme[]>([]);
  const [kitsAreaUniforme, setKitsAreaUniforme] = useState<import("../../core/types").KitAreaUniforme[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { collection, getDocs, query, where } = await import("firebase/firestore");
        const [iSnap, kSnap] = await Promise.all([
          getDocs(query(collection(db, "itensUniforme"), where("restaurantId", "==", restaurantId))),
          getDocs(query(collection(db, "kitsAreaUniforme"), where("restaurantId", "==", restaurantId))),
        ]);
        if (cancel) return;
        setItensUniforme(iSnap.docs.map(d => ({ ...d.data(), id: d.id }) as import("../../core/types").ItemUniforme));
        setKitsAreaUniforme(kSnap.docs.map(d => ({ ...d.data(), id: d.id }) as import("../../core/types").KitAreaUniforme));
      } finally {
        if (!cancel) setCarregando(false);
      }
    })();
    return () => { cancel = true; };
  }, [restaurantId]);

  if (carregando) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-900 rounded-lg p-6 text-sm text-gray-600">
          Carregando catálogo de uniformes…
        </div>
      </div>
    );
  }

  return (
    <NovaEntregaModal
      tipo={tipo}
      itens={itensUniforme}
      kits={kitsAreaUniforme}
      restaurantId={restaurantId}
      activeRestaurant={activeRestaurant}
      pessoa={pessoa}
      admissaoContexto={admissao}
      onClose={onClose}
    />
  );
}

// ─── Conferência de documentos do candidato (DP) ─────────────────────────────
// Lista os documentos que o candidato enviou no form (puxa automático). O DP
// pode anexar manualmente um doc que não veio, remover/substituir, e subir
// tudo pra subpasta "Documentos do Empregado" no Drive. Sobe só o que ainda
// não foi sincronizado (sem duplicar) — então dá pra subir o que faltou depois,
// enquanto a admissão estiver aberta. Sem checkbox de conferência (vem pronto).
const MAX_DOC_DP_BYTES = 10 * 1024 * 1024;
const TIPOS_DOC_DP_OK = ["application/pdf", "image/jpeg", "image/png"];
const driveViewUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

// Nome do arquivo no Drive: "<nome do documento> - <nome do empregado>" (+ ordem
// se houver mais de um arquivo no mesmo documento), preservando a extensão.
function nomeArquivoDrive(docNome: string, empNome: string, originalNome: string, total: number, idx: number): string {
  const ext = originalNome.includes(".") ? originalNome.split(".").pop()!.toLowerCase() : "";
  const ordem = total > 1 ? ` (${idx + 1})` : "";
  const base = `${docNome}${ordem} - ${empNome}`.replace(/[\\/]/g, "-");
  return ext ? `${base}.${ext}` : base;
}

// Linha de status da pasta do empregado no Drive: criada/vinculada por quem,
// quando, e link pra abrir. Ou aviso de que ainda não existe.
function PastaDriveInfo({ admissao }: { admissao: Admissao }) {
  if (admissao.driveFolderId) {
    const modo = admissao.driveFolderModo;
    const quando = admissao.driveFolderEm
      ? new Date(admissao.driveFolderEm).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
      : null;
    const verbo = modo === "vinculada" ? "vinculada" : modo === "criada" ? "criada" : "definida";
    return (
      <div className="text-[11px] text-gray-600 dark:text-gray-300 flex items-center gap-2 flex-wrap mt-1">
        <span>
          📁 Pasta {verbo}
          {admissao.driveFolderPor ? ` por ${admissao.driveFolderPor.nome}` : ""}
          {quando ? ` · ${quando}` : ""}
        </span>
        {admissao.driveFolderUrl && (
          <a href={admissao.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            abrir no Drive ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
      📁 Pasta do empregado ainda não criada — será criada ao subir os documentos
      pro Drive, ou crie/vincule na subtarefa "Criar pasta do empregado".
    </div>
  );
}

function DocumentosConferencia({
  admissao, activeRestaurant, pessoa,
}: {
  admissao: Admissao;
  activeRestaurant: Restaurant;
  pessoa: Pessoa;
}) {
  const itens = admissao.documentos?.itens || [];
  const [busy, setBusy] = useState<string | null>(null); // docId | "__drive__"
  const [erro, setErro] = useState("");

  // Expurgo com colchão de segurança: ao abrir a admissão, apaga do Storage só
  // os arquivos que já estão no Drive há mais de 7 dias (padrão client-side do
  // projeto — sem Admin SDK server-side). Lógica centralizada no helper.
  useEffect(() => {
    void expurgarDocumentosNoStorage(admissao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissao.id]);

  if (itens.length === 0) return null;

  // Admissão encerrada (arquivada/cancelada) → não dá mais pra mexer.
  const encerrada = !!admissao.finalizadoEm || admissao.status === "cancelada";
  const selfiePendente = !!admissao.validacao?.selfieDataUrl && !admissao.documentos?.selfieDriveFileId;
  const arquivosPendentes = itens.reduce(
    (n, it) => n + (it.arquivos || []).filter((a) => !a.driveFileId).length, 0,
  );
  const totalPendente = arquivosPendentes + (selfiePendente ? 1 : 0);
  const jaSubiu = !!admissao.documentos?.subidoDriveEm;

  async function persistir(novo: NonNullable<Admissao["documentos"]>) {
    await updateDoc(doc(db, "admissoes", admissao.id), sanitizeForFirestore({
      documentos: novo,
      updatedAt: new Date().toISOString(),
    }));
  }

  // DP anexa manualmente (doc que não veio, ou complemento). Sobe pro Storage
  // e adiciona ao item — marcado como enviadoPeloDp.
  async function anexarDp(it: DocumentoAdmissaoEnvio, files: FileList | null) {
    if (!files || files.length === 0 || !admissao.documentos) return;
    setErro("");
    setBusy(it.docId);
    try {
      const novos: DocumentoAdmissaoArquivo[] = [];
      for (const file of Array.from(files)) {
        if (!TIPOS_DOC_DP_OK.includes(file.type)) { setErro(`"${file.name}": use PDF, JPG ou PNG.`); continue; }
        if (file.size > MAX_DOC_DP_BYTES) { setErro(`"${file.name}": máximo 10 MB.`); continue; }
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `admissoes/${admissao.restaurantId}/${admissao.id}/${it.docId}/dp_${Date.now()}_${safe}`;
        const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
        const url = await getDownloadURL(snap.ref);
        novos.push({ nome: file.name, url, path, tipo: file.type, tamanho: file.size, enviadoPeloDp: true });
      }
      if (novos.length === 0) return;
      const novosItens = admissao.documentos.itens.map((x) =>
        x.docId === it.docId
          ? { ...x, resolucao: "anexado" as const, arquivos: [...(x.arquivos || []), ...novos] }
          : x,
      );
      await persistir({ ...admissao.documentos, itens: novosItens });
    } catch (e) {
      setErro("Erro ao anexar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setBusy(null);
    }
  }

  // Remove um arquivo do documento (apaga do Storage também).
  async function removerArquivo(it: DocumentoAdmissaoEnvio, arq: DocumentoAdmissaoArquivo) {
    if (!admissao.documentos) return;
    if (!window.confirm(`Remover "${arq.nome}" de ${it.nome}?`)) return;
    setErro("");
    setBusy(it.docId);
    try {
      try { await deleteObject(storageRef(storage, arq.path)); } catch { /* já pode não existir */ }
      const novosItens = admissao.documentos.itens.map((x) =>
        x.docId === it.docId
          ? { ...x, arquivos: (x.arquivos || []).filter((a) => a.path !== arq.path) }
          : x,
      );
      await persistir({ ...admissao.documentos, itens: novosItens });
    } catch (e) {
      setErro("Erro ao remover: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setBusy(null);
    }
  }

  // Sobe pro Drive só o que ainda não foi (driveFileId vazio). Pode rodar
  // de novo depois quando chegarem docs que faltavam.
  async function subirParaDrive() {
    if (!admissao.documentos) return;
    setErro("");
    setBusy("__drive__");
    try {
      const tree = await ensureEmployeeDriveTree(admissao, activeRestaurant);
      const folderId = tree.documentos;
      if (!folderId) throw new Error("Subpasta 'Documentos do Empregado' não encontrada no Drive.");
      // Se a pasta foi criada agora (não havia proveniência), registra.
      if (!admissao.driveFolderModo) {
        await salvarDriveFolderMeta(admissao.id, "criada", pessoa);
      }
      const empNome = admissao.candidato.nome;

      const novosItens: DocumentoAdmissaoEnvio[] = [];
      for (const it of admissao.documentos.itens) {
        const arqs = it.arquivos || [];
        const novosArqs: DocumentoAdmissaoArquivo[] = [];
        for (let i = 0; i < arqs.length; i++) {
          const arq = arqs[i];
          if (arq.driveFileId) { novosArqs.push(arq); continue; } // já no Drive
          const resp = await fetch(arq.url);
          if (!resp.ok) throw new Error(`Não consegui baixar "${arq.nome}".`);
          const blob = await resp.blob();
          const nome = nomeArquivoDrive(it.nome, empNome, arq.nome, arqs.length, i);
          const file = new File([blob], nome, { type: arq.tipo || blob.type });
          const subido = await uploadFileToFolder(folderId, file);
          novosArqs.push({ ...arq, driveFileId: subido.id, driveSubidoEm: new Date().toISOString() });
        }
        novosItens.push({ ...it, arquivos: novosArqs });
      }

      // Selfie da ficha cadastral (serve de foto 3x4) — só se ainda não subiu.
      let selfieDriveFileId = admissao.documentos.selfieDriveFileId;
      const selfie = admissao.validacao?.selfieDataUrl;
      if (selfie && !selfieDriveFileId) {
        const resp = await fetch(selfie);
        const blob = await resp.blob();
        const nome = `Foto cadastral - ${empNome}.jpg`.replace(/[\\/]/g, "-");
        const file = new File([blob], nome, { type: blob.type || "image/jpeg" });
        const subido = await uploadFileToFolder(folderId, file);
        selfieDriveFileId = subido.id;
      }

      await persistir({
        ...admissao.documentos,
        itens: novosItens,
        selfieDriveFileId,
        subidoDriveEm: new Date().toISOString(),
        subidoDrivePor: { id: pessoa.id, nome: pessoa.nome },
      });
      alert("Documentos enviados pra pasta 'Documentos do Empregado' no Drive ✓");
    } catch (e) {
      setErro("Erro ao subir pro Drive: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="rounded-lg border border-indigo-200 dark:border-indigo-900" open>
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 select-none">
        📎 Documentos do candidato ({itens.length})
      </summary>
      <div className="px-3 pb-3 space-y-2">
        <PastaDriveInfo admissao={admissao} />
        {erro && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            {erro}
          </div>
        )}

        {itens.map((it) => {
          const arqs = it.arquivos || [];
          const temArquivo = arqs.length > 0;
          const semResposta = it.resolucao !== "anexado" && !temArquivo;
          return (
            <div key={it.docId} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{it.nome}</div>
              {semResposta && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                  {it.resolucao === "nao_tenho" ? "Candidato: não tem" : "Candidato: não se aplica"}
                  {it.justificativa ? <>: <span className="italic text-gray-600 dark:text-gray-300">{it.justificativa}</span></> : null}
                </div>
              )}
              {temArquivo && (
                <div className="mt-1.5 space-y-1">
                  {arqs.map((a) => (
                    <div key={a.path} className="flex items-center gap-2 text-[11px]">
                      <a
                        href={a.storageExpurgado && a.driveFileId ? driveViewUrl(a.driveFileId) : a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 dark:text-indigo-400 hover:underline truncate flex-1"
                      >
                        📄 {a.nome}
                      </a>
                      {a.enviadoPeloDp && <span className="text-[9px] uppercase text-gray-400 shrink-0">DP</span>}
                      {a.driveFileId && (
                        <span className="text-[9px] text-emerald-600 shrink-0" title={a.storageExpurgado ? "No Drive (original removido do Storage)" : "Já está no Drive"}>
                          {a.storageExpurgado ? "📁 Drive" : "✓ Drive"}
                        </span>
                      )}
                      {!encerrada && (
                        <button
                          type="button"
                          onClick={() => void removerArquivo(it, a)}
                          disabled={busy !== null}
                          className="text-red-500 hover:text-red-700 shrink-0 disabled:opacity-50"
                        >
                          remover
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!encerrada && (
                <label className={`inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${busy === it.docId ? "opacity-50" : ""}`}>
                  {busy === it.docId ? "Enviando…" : temArquivo ? "+ Anexar outro" : "📎 Anexar (DP)"}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    multiple
                    disabled={busy !== null}
                    onChange={(e) => { void anexarDp(it, e.target.files); e.target.value = ""; }}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          );
        })}

        {/* Subir pro Drive — sobe só o que falta; pode rodar de novo depois */}
        {!isDriveConfigured() ? (
          <p className="text-[10px] text-gray-400 italic">
            Conecte o Google Drive (em Configurações) pra subir os documentos.
          </p>
        ) : encerrada ? (
          <p className="text-[10px] text-gray-400 italic">Admissão encerrada — documentos travados.</p>
        ) : (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => void subirParaDrive()}
              disabled={totalPendente === 0 || busy !== null}
              className={`w-full text-xs font-semibold rounded-lg px-3 py-2 ${
                totalPendente === 0
                  ? "bg-emerald-100 text-emerald-700 cursor-default dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              {busy === "__drive__"
                ? "Enviando pro Drive…"
                : totalPendente === 0
                  ? "✓ Tudo no Drive"
                  : `📤 ${jaSubiu ? "Subir " + totalPendente + " novo(s) pro Drive" : "Confirmar e subir " + totalPendente + " pro Drive"}`}
            </button>
            {admissao.documentos?.subidoDriveEm && (
              <p className="text-[10px] text-gray-500 text-center mt-1">
                Última sincronização: {new Date(admissao.documentos.subidoDriveEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {admissao.documentos.subidoDrivePor ? ` · ${admissao.documentos.subidoDrivePor.nome}` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
