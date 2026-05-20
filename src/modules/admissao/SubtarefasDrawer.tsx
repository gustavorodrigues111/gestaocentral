// ════════════════════════════════════════════════════════════════════════════
//  Drawer lateral — checklist completo da admissão agrupado pela coluna do
//  Kanban. Cada coluna mostra suas subtarefas com checkbox, observação e
//  link externo (se aplicável). Atalhos (Gmail clínica) também ficam aqui.
//
//  Aberto ao clicar num card do Kanban (ou via botão "Checklist" na lista).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Admissao, Cargo, KanbanColuna, Pessoa, Restaurant, SubtarefaAdmissao } from "../../core/types";
import {
  atualizarSubtarefa,
  getClinicaInfo,
  getEmailClinicaExames,
  getKanbanColunas,
  getSubtarefasTemplate,
  linkWhatsAppCandidato,
  montarCorpoEmailClinica,
  montarMensagemExameCandidato,
  progressoSubtarefasColuna,
  proximoStatus,
  sincronizarSubtarefasComTemplate,
  statusEfetivo,
  subtarefasPendentesObrigatorias,
} from "../../core/admissao/admissaoHelpers";
import { ADMISSAO_STATUS_LABEL } from "../../core/types";
import { montarGmailComposeUrl } from "../../core/admissao/exportFicha";

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
  // Quando intencao="avancar", o drawer mostra rodapé com botão de confirmar
  // avanço pra próxima coluna. Botão fica desabilitado enquanto há obrigatórias
  // pendentes na coluna atual. Click chama onConfirmarAvanco (parent fecha
  // drawer + roda fluxo de avanço — XLSX da contabilidade, modal manual, etc).
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
    (admissao.kanbanColunaId ? colunas.find((c) => c.id === admissao.kanbanColunaId) : undefined)
    || colunas.find((c) => colunaCapturaStatus(c, st))
    || colunas[0];
  const subtarefas = admissao.subtarefas || [];
  const [salvando, setSalvando] = useState<string | null>(null);

  // Sincroniza com o template atual ao abrir o drawer: se novas subtarefas
  // foram adicionadas ao template do restaurante depois da criação dessa
  // admissão, insere elas como pendentes. Idempotente — só persiste se houver
  // adição. Roda só uma vez por mount.
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

  function abrirGmailClinica(s: SubtarefaAdmissao) {
    const to = getEmailClinicaExames(activeRestaurant);
    const subject = `Agendamento exame admissional — ${admissao.candidato.nome}`;
    const body = montarCorpoEmailClinica(admissao, cargo?.nome, activeRestaurant.nome);
    const url = montarGmailComposeUrl({ to, subject, body });
    window.open(url, "_blank");
    // Pré-marca a subtarefa como feita já que o RH disparou a ação. Se quiser
    // reverter, é só desmarcar no checkbox.
    if (!s.feita) void toggle(s);
  }

  function abrirWhatsappExameCandidato(s: SubtarefaAdmissao) {
    if (!s.dataAgendada) {
      alert("Defina a data e hora do exame primeiro — usa o campo acima do botão.");
      return;
    }
    const clinica = getClinicaInfo(activeRestaurant);
    const msg = montarMensagemExameCandidato(
      admissao,
      activeRestaurant.nome,
      s.dataAgendada,
      clinica,
    );
    const link = linkWhatsAppCandidato(admissao.candidato.whatsapp, msg);
    if (!link) {
      alert("WhatsApp do candidato inválido — confira o cadastro.");
      return;
    }
    window.open(link, "_blank");
    if (!s.feita) void toggle(s);
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
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-black/40"
        aria-label="Fechar"
      />
      {/* Drawer */}
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
                  <div className="px-3 pb-3 space-y-2">
                    {subs.map((s) => (
                      <SubtarefaRow
                        key={s.id}
                        sub={s}
                        salvando={salvando === s.id}
                        onToggle={() => toggle(s)}
                        onLink={(link) => salvarLink(s, link)}
                        onObs={(obs) => salvarObs(s, obs)}
                        onDataAgendada={(d) => salvarDataAgendada(s, d)}
                        onAtalhoGmail={() => abrirGmailClinica(s)}
                        onAtalhoWhatsappExame={() => abrirWhatsappExameCandidato(s)}
                      />
                    ))}
                  </div>
                </details>
              );
            })}
        </div>

        {/* Rodapé com botão de avançar — só em modo "intencao=avancar" */}
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
  );
}

function SubtarefaRow({
  sub,
  salvando,
  onToggle,
  onLink,
  onObs,
  onDataAgendada,
  onAtalhoGmail,
  onAtalhoWhatsappExame,
}: {
  sub: SubtarefaAdmissao;
  salvando: boolean;
  onToggle: () => void;
  onLink: (link: string) => void;
  onObs: (obs: string) => void;
  onDataAgendada: (d: string) => void;
  onAtalhoGmail: () => void;
  onAtalhoWhatsappExame: () => void;
}) {
  const [linkLocal, setLinkLocal] = useState(sub.link || "");
  const [obsLocal, setObsLocal] = useState(sub.observacao || "");
  const [dataLocal, setDataLocal] = useState(sub.dataAgendada || "");
  const [showDetails, setShowDetails] = useState(false);
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

      {/* Data/hora agendada (ex: data do exame médico) — sempre visível porque
          é input principal pra disparar o atalho de WhatsApp */}
      {sub.pedeDataHora && (
        <div className="mt-2 flex flex-col gap-1 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 rounded p-2">
          <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">
            📅 Data e horário agendados
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
        {sub.atalho?.tipo === "whatsapp_exame_candidato" && (
          <button
            type="button"
            onClick={onAtalhoWhatsappExame}
            disabled={!sub.dataAgendada}
            title={sub.dataAgendada ? "" : "Preencha a data e hora antes"}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            📱 Enviar instruções por WhatsApp
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
        {!sub.pedeLink && !sub.observacao && !sub.link && (
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
