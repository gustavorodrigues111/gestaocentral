// ════════════════════════════════════════════════════════════════════════════
//  Drawer lateral — checklist completo da admissão agrupado por coluna do
//  Kanban e, dentro de cada coluna, sub-agrupado por checklist temático.
//
//  Aberto ao clicar num card do Kanban ou pelo botão "📋 Checklist da etapa"
//  na lista. Em modo "avancar" mostra rodapé com botão de confirmar avanço.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
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
  montarMensagemKitAssinatura, finalizarAdmissao,
} from "../../core/admissao/admissaoHelpers";
import { gerarCascataAdmissao } from "../tarefas/generator";
import { carregarCargo } from "../exames/gerador";
import { isDriveConfigured } from "../../core/google/driveConfig";
import { ensureEmployeeDriveTree, vincularPastaExistente } from "../../core/google/driveAdmissao";
import { pickDriveFolder } from "../../core/google/drivePicker";

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
  const [salvando, setSalvando] = useState<string | null>(null);
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
      } else {
        const ok = confirm(
          `Nenhuma pasta selecionada.\n\nCriar uma NOVA pasta "${admissao.candidato.nome}" em "Empregados Ativos"?`,
        );
        if (!ok) { setSalvando(null); return; }
        const tree = await ensureEmployeeDriveTree(admissao, activeRestaurant);
        folderUrl = tree.folderUrl;
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
                                <SubtarefaRow
                                  key={s.id}
                                  sub={s}
                                  admissao={admissao}
                                  salvando={salvando === s.id}
                                  onToggle={() => toggle(s)}
                                  onLink={(link) => salvarLink(s, link)}
                                  onObs={(obs) => salvarObs(s, obs)}
                                  onDataAgendada={(d) => salvarDataAgendada(s, d)}
                                  onDadosBancarios={(p) => salvarDadosBancarios(s, p)}
                                  onAtalhoContato={(tipo) => abrirContato(s, tipo)}
                                  onAtalhoWhatsappInstrucoes={() => abrirWhatsappInstrucoes(s)}
                                  onAtalhoChecklistDocs={() => abrirChecklistDocs(s)}
                                  onAtalhoBaixarPlanilha={() => abrirBaixarPlanilha(s)}
                                  onAtalhoEditarCandidato={() => setShowEditarCandidato(true)}
                                  onAtalhoEditarDadosFinais={() => setShowEditarDadosFinais(true)}
                                  onAtalhoEnviarLinkForm={() => abrirEnviarLinkForm(s)}
                                  onAtalhoChecklistTermos={() => setShowChecklistTermos(true)}
                                  onAtalhoClicksign={abrirClicksign}
                                  onAtalhoWhatsappKit={abrirAvisarKitAssinatura}
                                  onAtalhoGerarTermoUniformes={() => setGerarTermoTipo("uniforme")}
                                  onAtalhoGerarTermoEpis={() => setGerarTermoTipo("epi")}
                                  onAtalhoCriarPastaDrive={() => criarPastaDrive(s)}
                                  contatoLabel={(tipo) => labelContato(activeRestaurant, tipo)}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
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
