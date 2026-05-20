// ════════════════════════════════════════════════════════════════════════════
//  Drawer lateral — checklist completo da admissão agrupado por coluna do
//  Kanban e, dentro de cada coluna, sub-agrupado por checklist temático.
//
//  Aberto ao clicar num card do Kanban ou pelo botão "📋 Checklist da etapa"
//  na lista. Em modo "avancar" mostra rodapé com botão de confirmar avanço.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Admissao, Cargo, KanbanColuna, Pessoa, Restaurant, SubtarefaAdmissao } from "../../core/types";
import {
  atualizarSubtarefa,
  atualizarDadosBancariosItau,
  marcarDocumentosRecebidos,
  getClinicaInfo,
  getEmailClinicaExames,
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
  WHATSAPP_FINANCEIRO_DEFAULT,
} from "../../core/admissao/admissaoHelpers";
import { ADMISSAO_STATUS_LABEL } from "../../core/types";
import { montarGmailComposeUrl } from "../../core/admissao/exportFicha";
import { ConfirmarDocumentosModal } from "./ConfirmarDocumentosModal";

function colunaCapturaStatus(col: KanbanColuna, st: string): boolean {
  if (!col.statusAuto) return false;
  if (Array.isArray(col.statusAuto)) return col.statusAuto.includes(st as never);
  return col.statusAuto === st;
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

  // Sincroniza com o template atual ao abrir o drawer: subtarefas adicionadas
  // ou alteradas no template global ganham efeito retroativo nas admissões
  // existentes. Idempotente — só persiste se houver diferença.
  useEffect(() => {
    const template = getSubtarefasTemplate(activeRestaurant);
    const { sincronizadas, adicionou } = sincronizarSubtarefasComTemplate(subtarefas, template);
    if (!adicionou) return;
    void updateDoc(doc(db, "admissoes", admissao.id), {
      subtarefas: sincronizadas,
      updatedAt: new Date().toISOString(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissao.id]);

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

  function abrirGmailClinica(s: SubtarefaAdmissao) {
    const to = getEmailClinicaExames(activeRestaurant);
    const subject = `Agendamento exame admissional — ${admissao.candidato.nome}`;
    const body = montarCorpoEmailClinica(admissao, cargo?.nome, activeRestaurant.nome);
    const url = montarGmailComposeUrl({ to, subject, body });
    window.open(url, "_blank");
    if (!s.feita) void toggle(s);
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
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert("WhatsApp do candidato inválido — confira o cadastro.");
      return;
    }
    window.open(link, "_blank");
    if (!s.feita) void toggle(s);
  }

  function abrirWhatsappBanco(s: SubtarefaAdmissao) {
    const dados = admissao.dadosBancariosItau;
    if (!dados?.tipo || !dados?.agencia?.trim() || !dados?.conta?.trim()) {
      alert("Preencha os dados bancários Itaú (tipo, agência e conta) antes de solicitar o cadastro.");
      return;
    }
    const msg = montarMensagemBancoFinanceiro(admissao);
    const url = `https://wa.me/${WHATSAPP_FINANCEIRO_DEFAULT}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    if (!s.feita) void toggle(s);
  }

  function abrirChecklistDocs(_s: SubtarefaAdmissao) {
    setDocsModalOpen(true);
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

  return (
    <>
      <div className="fixed inset-0 z-50 flex">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 bg-black/40"
          aria-label="Fechar"
        />
        <aside className="w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden">
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
                                  onAtalhoGmail={() => abrirGmailClinica(s)}
                                  onAtalhoWhatsappInstrucoes={() => abrirWhatsappInstrucoes(s)}
                                  onAtalhoWhatsappBanco={() => abrirWhatsappBanco(s)}
                                  onAtalhoChecklistDocs={() => abrirChecklistDocs(s)}
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
    </>
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
  onAtalhoGmail,
  onAtalhoWhatsappInstrucoes,
  onAtalhoWhatsappBanco,
  onAtalhoChecklistDocs,
}: {
  sub: SubtarefaAdmissao;
  admissao: Admissao;
  salvando: boolean;
  onToggle: () => void;
  onLink: (link: string) => void;
  onObs: (obs: string) => void;
  onDataAgendada: (d: string) => void;
  onDadosBancarios: (p: Partial<{ tipo: "salario" | "corrente"; agencia: string; conta: string }>) => void;
  onAtalhoGmail: () => void;
  onAtalhoWhatsappInstrucoes: () => void;
  onAtalhoWhatsappBanco: () => void;
  onAtalhoChecklistDocs: () => void;
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
        {sub.atalho?.tipo === "gmail_clinica" && (
          <button
            type="button"
            onClick={onAtalhoGmail}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            📧 Abrir Gmail pra clínica
          </button>
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
        {sub.atalho?.tipo === "whatsapp_banco_financeiro" && (
          <button
            type="button"
            onClick={onAtalhoWhatsappBanco}
            disabled={!dadosBancariosCompletos}
            title={dadosBancariosCompletos ? "" : "Preencha os dados bancários da conta Itaú antes"}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            📱 Solicitar cadastro ao financeiro
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
