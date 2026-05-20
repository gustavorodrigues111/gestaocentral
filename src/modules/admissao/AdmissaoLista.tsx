// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Pessoas em admissão" — lista de admissões em andamento + botão
//  pra iniciar nova admissão. Cards mostram status, candidato, prazo e
//  ações principais (reenviar link, copiar link, cancelar, aprovar).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import {
  ADMISSAO_STATUS_LABEL,
  type Admissao,
  type Cargo,
  type Restaurant,
} from "../../core/types";
import {
  avancarStatus,
  avancarStatusComTrigger,
  cancelarAdmissao,
  estenderPrazoAdmissao,
  excluirAdmissaoDefinitivamente,
  getKanbanColunas,
  getPrazoDias,
  getSchemaAdmissao,
  getSubtarefasTemplate,
  iniciarAdmissao,
  linkWhatsAppCandidato,
  marcarLinkEnviado,
  montarMensagemEnvioLink,
  normalizarAdmissao,
  progressoSubtarefasColuna,
  proximoStatus,
  reabrirAdmissao,
  reenviarAdmissao,
  statusEfetivo,
  temDadosFinaisCompletos,
  urlPublicaAdmissao,
} from "../../core/admissao/admissaoHelpers";
import type { KanbanColuna } from "../../core/types";
import { IniciarAdmissaoModal } from "./IniciarAdmissaoModal";
import { CancelarAdmissaoModal } from "./CancelarAdmissaoModal";
import { PreencherDadosBasicosModal } from "./PreencherDadosBasicosModal";
import { PreencherFormManualModal } from "./PreencherFormManualModal";
import { SubtarefasDrawer } from "./SubtarefasDrawer";
import { VerPreenchimentoModal } from "./VerPreenchimentoModal";
import { getEmailContabilidade } from "../../core/admissao/admissaoHelpers";
import {
  baixarFichaAdmissao,
  montarCorpoEmailContabilidade,
  montarGmailComposeUrl,
} from "../../core/admissao/exportFicha";

type Props = {
  rid: string;
  activeRestaurant: Restaurant;
};

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function fmtTempoRestante(expiraEm: string): string {
  const ms = new Date(expiraEm).getTime() - Date.now();
  if (ms <= 0) return "expirado";
  const horas = Math.floor(ms / 3600_000);
  const minutos = Math.floor((ms % 3600_000) / 60_000);
  if (horas >= 24) {
    const dias = Math.floor(horas / 24);
    const restoH = horas % 24;
    return `${dias}d${restoH > 0 ? ` ${restoH}h` : ""} restantes`;
  }
  if (horas > 0) return `${horas}h ${minutos}min restantes`;
  return `${minutos}min restantes`;
}

const STATUS_COR: Record<string, string> = {
  formulario_enviado:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  formulario_preenchido: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  documentos_recebidos:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  admitido:              "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  cancelada:             "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  expirada:              "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

// Resolve a coluna correspondente ao status atual de uma admissão.
function colunaAtualDoStatus(adm: Admissao, colunas: KanbanColuna[]): KanbanColuna | undefined {
  const st = statusEfetivo(adm);
  return colunas.find((c) => {
    const sa = c.statusAuto;
    if (!sa) return false;
    if (Array.isArray(sa)) return (sa as string[]).includes(st);
    return sa === st;
  });
}

// Sombreamento do botão "Checklist da etapa" baseado no progresso da etapa atual:
//   vermelho — nenhuma obrigatória feita ainda
//   amarelo — em andamento (algumas feitas, mas faltam obrigatórias)
//   verde — todas as obrigatórias da etapa feitas (pronto pra avançar)
//   neutro — sem subtarefas ou status terminal
function classeChecklistEtapa(adm: Admissao, colunas: KanbanColuna[]): string {
  const colAtual = colunaAtualDoStatus(adm, colunas);
  if (!colAtual) return "";
  const prog = progressoSubtarefasColuna(adm, colAtual.id);
  if (prog.total === 0) return "";
  if (prog.feitas === 0) {
    return "!bg-rose-50 !text-rose-800 !border-rose-300 hover:!bg-rose-100 dark:!bg-rose-900/20 dark:!text-rose-300 dark:!border-rose-800";
  }
  if (prog.obrigatoriasPendentes === 0) {
    return "!bg-emerald-50 !text-emerald-800 !border-emerald-300 hover:!bg-emerald-100 dark:!bg-emerald-900/20 dark:!text-emerald-300 dark:!border-emerald-800";
  }
  return "!bg-amber-50 !text-amber-800 !border-amber-300 hover:!bg-amber-100 dark:!bg-amber-900/20 dark:!text-amber-300 dark:!border-amber-800";
}

export function AdmissaoLista({ rid, activeRestaurant }: Props) {
  const { pessoa: me } = useAuth();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [showIniciar, setShowIniciar] = useState(false);

  // Mostrar admitidas/canceladas é opcional (default: esconde)
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const q1 = query(collection(db, "admissoes"), where("restaurantId", "==", rid));
    const u1 = onSnapshot(q1, (snap) => {
      setAdmissoes(snap.docs.map((d) => normalizarAdmissao({ id: d.id, ...d.data() } as Admissao)));
    });
    const q2 = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const u2 = onSnapshot(q2, (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cargo)));
    });
    return () => { u1(); u2(); };
  }, [rid]);

  const cargoPorId = useMemo(() => {
    const m = new Map<string, Cargo>();
    for (const c of cargos) m.set(c.id, c);
    return m;
  }, [cargos]);

  // Filtra + ordena (mais recente primeiro)
  const visiveis = useMemo(() => {
    const lista = admissoes.filter((a) => {
      const st = statusEfetivo(a);
      if (mostrarFinalizadas) return true;
      return st !== "admitido" && st !== "cancelada";
    });
    return lista.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm));
  }, [admissoes, mostrarFinalizadas]);

  async function handleIniciar(
    input: Omit<Parameters<typeof iniciarAdmissao>[0], "restaurantSnapshot" | "subtarefasTemplate">,
  ) {
    if (!me) return;
    const adm = await iniciarAdmissao(
      {
        ...input,
        restaurantSnapshot: {
          nome: activeRestaurant.nome,
          whatsappDP: activeRestaurant.whatsappDP || undefined,
          prazoDias: getPrazoDias(activeRestaurant),
        },
        subtarefasTemplate: getSubtarefasTemplate(activeRestaurant),
      },
      me,
    );
    setShowIniciar(false);
    // Auto-marcar enviado já após criar? Não — espera o RH clicar em
    // "Enviar WhatsApp" pra iniciar o timer. Mas se quiser, pode marcar
    // direto e abrir o WhatsApp na sequência. Pra UX mais limpa, deixa
    // o usuário clicar explicitamente.
    return adm;
  }

  async function handleEnviarWhats(adm: Admissao) {
    if (!me) return;
    const prazoDias = getPrazoDias(activeRestaurant);
    let admissao = adm;
    // Se ainda não foi marcado como enviado, marca agora (inicia timer)
    if (!adm.enviadoEm) {
      const { enviadoEm, expiraEm } = await marcarLinkEnviado(adm, prazoDias, me);
      admissao = { ...adm, enviadoEm, expiraEm };
    }
    const url = urlPublicaAdmissao(admissao.token, activeRestaurant.subdomain);
    const msg = montarMensagemEnvioLink(
      admissao.candidato.nome,
      activeRestaurant.nome,
      url,
      prazoDias,
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert(`WhatsApp do candidato inválido. Edite o cadastro pra continuar.`);
      return;
    }
    window.open(link, "_blank");
  }

  async function handleReenviar(adm: Admissao) {
    if (!me) return;
    if (!confirm("Gerar novo link? O link anterior deixa de funcionar (os dados preenchidos ficam preservados).")) return;
    const prazoDias = getPrazoDias(activeRestaurant);
    const { token } = await reenviarAdmissao(adm, prazoDias, me);
    // Abre wa.me com o novo link
    const url = urlPublicaAdmissao(token, activeRestaurant.subdomain);
    const msg = montarMensagemEnvioLink(
      adm.candidato.nome,
      activeRestaurant.nome,
      url,
      prazoDias,
    );
    const link = linkWhatsAppCandidato(adm.candidato.whatsapp, msg);
    if (link) window.open(link, "_blank");
  }

  async function handleCopiarLink(adm: Admissao) {
    const url = urlPublicaAdmissao(adm.token, activeRestaurant.subdomain);
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado pra área de transferência.");
    } catch {
      prompt("Copie o link:", url);
    }
  }

  const [admCancelando, setAdmCancelando] = useState<Admissao | null>(null);
  const [admDadosBasicos, setAdmDadosBasicos] = useState<Admissao | null>(null);

  const [admPreenchimentoManual, setAdmPreenchimentoManual] = useState<Admissao | null>(null);
  const [admVerPreenchimento, setAdmVerPreenchimento] = useState<Admissao | null>(null);

  // Drawer de checklist: guarda só o ID + a intenção. Re-deriva a admissão
  // pela lista live pra refletir mudanças do onSnapshot durante o uso.
  const [drawerAdmId, setDrawerAdmId] = useState<string | null>(null);
  const [drawerIntencao, setDrawerIntencao] = useState<"ver" | "avancar">("ver");
  const drawerAdmissao = drawerAdmId
    ? admissoes.find((a) => a.id === drawerAdmId) || null
    : null;

  const colunasKanban = useMemo(() => getKanbanColunas(activeRestaurant), [activeRestaurant]);

  async function handleAvancar(adm: Admissao) {
    const prox = proximoStatus(adm.status);
    if (!prox) return;
    // formulario_enviado → formulario_preenchido só faz sentido se há dados.
    // Se não houver, abre o modal pro RH preencher pelo candidato.
    if (prox === "formulario_preenchido" && !adm.dadosPreenchidos) {
      const ok = confirm(
        "Esse candidato ainda não preencheu o formulário online.\n\n" +
        'Pra marcar como "Formulário preenchido" você precisa preencher os ' +
        "dados (caso o candidato tenha mandado por outro canal — papel, " +
        "e-mail, WhatsApp). Abrir o formulário agora?",
      );
      if (ok) setAdmPreenchimentoManual(adm);
      return;
    }
    // Pra passar de documentos_recebidos → solicitacao_contabilidade exige
    // que os 4 campos (cargo, data admissão, salário, horários) estejam ok.
    if (prox === "solicitacao_contabilidade" && !temDadosFinaisCompletos(adm)) {
      alert(
        "Pra avançar pra 'Enviado pra contabilidade' é preciso ter: cargo, data " +
        "de admissão, salário e horários cadastrados. Use o botão 'Preencher " +
        "dados básicos' acima.",
      );
      return;
    }
    // documentos_recebidos → solicitacao_contabilidade: baixa ficha XLSX + abre Gmail
    if (prox === "solicitacao_contabilidade") {
      const emailDest = getEmailContabilidade(activeRestaurant);
      const ok = confirm(
        `Vamos avançar pra "Enviado pra contabilidade":\n\n` +
        `1. O sistema baixa a ficha em XLSX agora\n` +
        `2. Abre o Gmail compose ${emailDest ? `pra ${emailDest}` : "(sem destinatário — cadastre em ⚙️ Configurações)"}\n` +
        `3. Você anexa o XLSX baixado e envia\n\n` +
        `Continuar?`,
      );
      if (!ok) return;
      try {
        const cargo = cargos.find((c) => c.id === adm.cargoId);
        baixarFichaAdmissao(adm, cargos, activeRestaurant.nome);
        const url = montarGmailComposeUrl({
          to: emailDest,
          subject: `Solicitação de admissão — ${adm.candidato.nome} (${activeRestaurant.nome})`,
          body: montarCorpoEmailContabilidade(adm, cargo, activeRestaurant.nome),
        });
        window.open(url, "_blank");
        if (me) {
          await avancarStatusComTrigger(adm, prox, "envio_contabilidade", me);
        } else {
          await avancarStatus(adm.id, prox);
        }
      } catch (e) {
        alert("Erro: " + (e instanceof Error ? e.message : "?"));
      }
      return;
    }
    // Sem confirm genérico — o drawer já mostrou as obrigatórias e o usuário
    // explicitamente clicou "Avançar pra X" ali. A confirmação extra do
    // contabilidade (XLSX + Gmail) acima é mantida porque informa ações
    // específicas que vão acontecer.
    if (prox === "admitido" && me) {
      await avancarStatusComTrigger(adm, prox, "admitido", me);
    } else {
      await avancarStatus(adm.id, prox);
    }
  }

  // Checklist de 12 docs WhatsApp agora vive dentro do drawer (atalho da
  // subtarefa "Conferir recebimento dos documentos enviados pelo candidato").
  // Os botões "Confirmar docs recebidos" e "Docs WhatsApp" foram removidos
  // da action bar pra evitar duplicidade.

  async function handleEstenderPrazo(adm: Admissao, horas: number) {
    if (!me) return;
    try {
      await estenderPrazoAdmissao(adm, horas, me);
    } catch (e) {
      alert("Erro ao estender prazo: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function handleReabrir(adm: Admissao) {
    if (!me?.isMaster) return;
    const ok = confirm(
      `REABERTURA DE ADMISSÃO\n\n` +
      `Você vai reverter a admissão de ${adm.candidato.nome} pra "Pronto pra admitir".\n\n` +
      `Use só pra casos extremos (admissão criada por engano, candidato voltou ` +
      `atrás, etc). As marcações de admitido/cancelado serão limpas.\n\n` +
      `Continuar?`,
    );
    if (!ok) return;
    try {
      await reabrirAdmissao(adm.id, me);
    } catch (e) {
      alert("Erro ao reabrir: " + (e instanceof Error ? e.message : "?"));
    }
  }

  async function handleExcluir(adm: Admissao) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowIniciar(true)}>
            ➕ Nova admissão
          </Button>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 ml-2 select-none">
            <input
              type="checkbox"
              checked={mostrarFinalizadas}
              onChange={(e) => setMostrarFinalizadas(e.target.checked)}
              className="accent-indigo-600"
            />
            mostrar admitidas/canceladas
          </label>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {visiveis.length} admissão(ões) em andamento
        </div>
      </div>

      {visiveis.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nenhuma admissão em andamento. Clique em <strong>"Nova admissão"</strong> pra começar.
        </div>
      )}

      <div className="space-y-2">
        {visiveis.map((adm) => {
          const st = statusEfetivo(adm);
          const cargo = cargoPorId.get(adm.cargoId);
          return (
            <section
              key={adm.id}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3"
            >
              {/* Bloco 1: header (nome + status + chips de link) + meta info */}
              <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{adm.candidato.nome}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                        STATUS_COR[st] || "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {ADMISSAO_STATUS_LABEL[st]}
                    </span>
                    {/* Mini-ações de link logo após o badge — mesma área visual,
                        pra não ocupar a barra de ações principais embaixo */}
                    {(st === "formulario_enviado" || (!adm.enviadoEm)) && (
                      <button
                        type="button"
                        onClick={() => handleEnviarWhats(adm)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                      >
                        💬 {adm.enviadoEm ? "Reenviar" : "Enviar link"}
                      </button>
                    )}
                    {st === "expirada" && (
                      <button
                        type="button"
                        onClick={() => handleReenviar(adm)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                      >
                        🔄 Gerar novo link
                      </button>
                    )}
                    {(st === "formulario_enviado" || st === "expirada") && adm.enviadoEm && (
                      <button
                        type="button"
                        onClick={() => handleCopiarLink(adm)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        📋 Copiar link
                      </button>
                    )}
                    {(st === "formulario_enviado" || st === "expirada") && adm.enviadoEm && (
                      <EstenderPrazoMenu adm={adm} onEstender={(h) => handleEstenderPrazo(adm, h)} />
                    )}
                    {/* Ver preenchimento — chip também, só aparece quando
                        candidato começou a digitar */}
                    {adm.dadosPreenchidos && Object.keys(adm.dadosPreenchidos).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAdmVerPreenchimento(adm)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 hover:bg-sky-200 text-sky-800 font-semibold dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60"
                      >
                        👁 Ver preenchimento
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                    <div>📧 {adm.candidato.email} · 📱 {adm.candidato.whatsapp}</div>
                    <div>Cargo: <strong>{cargo?.nome || "—"}</strong> · Iniciada por {adm.iniciadoPor.nome} em {fmtDataHora(adm.iniciadoEm)}</div>
                    {adm.enviadoEm && (
                      <div>
                        Link enviado em {fmtDataHora(adm.enviadoEm)}
                        {adm.expiraEm && st === "formulario_enviado" && (
                          <span className="ml-1 text-amber-700 dark:text-amber-400">
                            · ⏳ {fmtTempoRestante(adm.expiraEm)}
                          </span>
                        )}
                        {(adm.reenvios?.length || 0) > 0 && (
                          <span className="ml-1 text-gray-400">({adm.reenvios?.length} reenvio(s))</span>
                        )}
                      </div>
                    )}
                    {adm.preenchidoEm && (
                      <div className="text-sky-700 dark:text-sky-400">✓ Formulário preenchido em {fmtDataHora(adm.preenchidoEm)}</div>
                    )}
                    {adm.documentosRecebidosEm && (
                      <div className="text-emerald-700 dark:text-emerald-400">
                        ✓ Documentos recebidos em {fmtDataHora(adm.documentosRecebidosEm)} por {adm.documentosRecebidosPor?.nome}
                        {adm.checklistDocumentos && (() => {
                          const total = adm.checklistDocumentos.itens.length;
                          const ok = adm.checklistDocumentos.itens.filter((i) => i.recebido).length;
                          const pend = total - ok;
                          return (
                            <span className={`ml-1 ${pend > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                              · 📄 {ok}/{total} {pend > 0 && `(${pend} pendente${pend > 1 ? "s" : ""})`}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {adm.aprovadoEm && (
                      <div className="text-indigo-700 dark:text-indigo-400">✓ Admitido em {fmtDataHora(adm.aprovadoEm)} por {adm.aprovadoPor?.nome}</div>
                    )}
                    {adm.canceladoEm && (
                      <div className="text-rose-700 dark:text-rose-400">✕ Cancelada em {fmtDataHora(adm.canceladoEm)} por {adm.canceladoPor?.nome} — "{adm.motivoCancelamento}"</div>
                    )}
                  </div>
              </div>

              {/* Bloco 2: barra de ações principais — linha final do card */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100 dark:border-gray-800">
                {st !== "admitido" && st !== "cancelada" && (
                  temDadosFinaisCompletos(adm) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setAdmDadosBasicos(adm)}
                      className="!bg-emerald-50 !text-emerald-800 !border-emerald-300 hover:!bg-emerald-100 dark:!bg-emerald-900/20 dark:!text-emerald-300 dark:!border-emerald-800"
                    >
                      ✏️ Atualizar dados básicos
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => setAdmDadosBasicos(adm)}>
                      📝 Preencher dados básicos
                    </Button>
                  )
                )}
                {st !== "cancelada" && st !== "expirada" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setDrawerAdmId(adm.id); setDrawerIntencao("ver"); }}
                    className={classeChecklistEtapa(adm, colunasKanban)}
                  >
                    📋 Checklist da etapa
                  </Button>
                )}
                {proximoStatus(adm.status) && st !== "cancelada" && st !== "expirada" && (
                  <Button
                    size="sm"
                    onClick={() => { setDrawerAdmId(adm.id); setDrawerIntencao("avancar"); }}
                    className="!bg-emerald-600 hover:!bg-emerald-700 !border-emerald-600 !text-white"
                  >
                    ▶ Avançar
                  </Button>
                )}
                {st !== "admitido" && st !== "cancelada" && (
                  <Button size="sm" variant="danger" onClick={() => setAdmCancelando(adm)}>
                    ✕ Cancelar
                  </Button>
                )}
                {/* Ações de master pra casos extremos — em status terminal */}
                {me?.isMaster && (st === "admitido" || st === "cancelada" || st === "expirada") && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleReabrir(adm)}
                      title="Volta a admissão pra 'Pronto pra admitir'. Use só pra casos extremos."
                    >
                      ↩ Reabrir
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleExcluir(adm)}
                      className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline px-2 py-1"
                      title="Apaga pra sempre. Irreversível."
                    >
                      🗑️ Excluir
                    </button>
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {showIniciar && (
        <IniciarAdmissaoModal
          rid={rid}
          cargos={cargos}
          schemaUsado={getSchemaAdmissao(activeRestaurant)}
          onClose={() => setShowIniciar(false)}
          onConfirm={handleIniciar}
        />
      )}

      {admCancelando && (
        <CancelarAdmissaoModal
          candidatoNome={admCancelando.candidato.nome}
          onClose={() => setAdmCancelando(null)}
          onConfirm={async (motivos, texto) => {
            if (!me) return;
            await cancelarAdmissao(admCancelando.id, motivos, texto, me);
            setAdmCancelando(null);
          }}
        />
      )}

      {admDadosBasicos && (
        <PreencherDadosBasicosModal
          admissao={admDadosBasicos}
          cargos={cargos}
          activeRestaurant={activeRestaurant}
          onClose={() => setAdmDadosBasicos(null)}
          onSaved={() => setAdmDadosBasicos(null)}
        />
      )}

      {admPreenchimentoManual && (
        <PreencherFormManualModal
          admissao={admPreenchimentoManual}
          onClose={() => setAdmPreenchimentoManual(null)}
          onSaved={() => setAdmPreenchimentoManual(null)}
        />
      )}

      {admVerPreenchimento && (
        <VerPreenchimentoModal
          admissao={admVerPreenchimento}
          onClose={() => setAdmVerPreenchimento(null)}
        />
      )}

      {drawerAdmissao && me && (
        <SubtarefasDrawer
          admissao={drawerAdmissao}
          cargos={cargos}
          activeRestaurant={activeRestaurant}
          pessoa={me}
          intencao={drawerIntencao}
          onConfirmarAvanco={async () => {
            const adm = drawerAdmissao;
            setDrawerAdmId(null);
            await handleAvancar(adm);
          }}
          onClose={() => setDrawerAdmId(null)}
        />
      )}
    </div>
  );
}

// Mini-dropdown pra estender o prazo do link em +12h ou +24h. Bota um botão
// secundário "⏰ +prazo"; ao clicar, abre menu absoluto com as duas opções.
function EstenderPrazoMenu({
  adm,
  onEstender,
}: {
  adm: Admissao;
  onEstender: (horas: number) => Promise<void> | void;
}) {
  const [aberto, setAberto] = useState(false);
  const totalExt = (adm.extensoesPrazo || []).reduce((acc, e) => acc + e.horas, 0);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        ⏰ {totalExt > 0 ? `+${totalExt}h` : "+ prazo"}
      </button>
      {aberto && (
        <>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-10 bg-transparent cursor-default"
            aria-label="Fechar"
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden min-w-[180px]">
            <button
              type="button"
              onClick={async () => { setAberto(false); await onEstender(12); }}
              className="w-full text-left text-xs px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-gray-900 dark:text-gray-100"
            >
              + 12 horas
            </button>
            <button
              type="button"
              onClick={async () => { setAberto(false); await onEstender(24); }}
              className="w-full text-left text-xs px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-gray-900 dark:text-gray-100 border-t border-gray-100 dark:border-gray-800"
            >
              + 24 horas
            </button>
          </div>
        </>
      )}
    </div>
  );
}
