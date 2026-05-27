// Modal — Editar / Acionar slot
//
// Aberto ao clicar num slot da Agenda. Mostra detalhes do slot e ações
// contextuais por status:
//
//   normal        → [🚫 Bloquear horário] [🎨 Personalizar]
//   bloqueado     → [↶ Desbloquear]
//   personalizado → [✏️ Editar personalização] [↶ Restaurar padrão]
//   extra         → [✏️ Editar janela] [🗑️ Remover janela]
//
// Form inline de personalização (salões + paxMaxOverride + motivo).
// Pra janela_extra, permite editar também o horário.

import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import type {
  ExcecaoReserva, Salao, SlotResolvido,
} from "../../core/types";
import { COR_STATUS_SLOT } from "../../core/reservas/disponibilidade";

type Props = {
  data: string;                        // YYYY-MM-DD
  slot: SlotResolvido;
  restaurantId: string;
  pessoaId: string;
  pessoaNome: string;
  saloes: Salao[];
  /** Exceções já existentes nessa data — usado pra editar/remover. */
  excecoesNaData: ExcecaoReserva[];
  onClose: () => void;
};

const NOMES_DIA_LONG = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const NOMES_MES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function fmtData(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  return `${String(d.getDate()).padStart(2, "0")} ${NOMES_MES[d.getMonth()]} · ${NOMES_DIA_LONG[d.getDay()]}`;
}

export function SlotEditarModal({
  data, slot, restaurantId, pessoaId, pessoaNome, saloes, excecoesNaData, onClose,
}: Props) {
  const cor = COR_STATUS_SLOT[slot.status];

  // Estado do form (personalizar/editar)
  const [editando, setEditando] = useState<"personalizar" | "editar_extra" | null>(null);
  const [salaoIds, setSalaoIds] = useState<string[]>(slot.salaoIds);
  const [horario, setHorario] = useState(slot.horario);
  const [paxMaxOverride, setPaxMaxOverride] = useState(
    slot.paxMaxOverride != null ? String(slot.paxMaxOverride) : "",
  );
  const [motivo, setMotivo] = useState(slot.motivos[0] || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function toggleSalao(id: string) {
    setSalaoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // ─── Lista de salões com pax individual + total ───
  const saloesInfo = slot.salaoIds
    .map(id => {
      const sal = saloes.find(s => s.id === id);
      if (!sal) return null;
      const pax = sal.modeloCapacidade === "por_capacidade"
        ? (sal.capacidadeMaxPax || 0)
        : (sal.numMesas || 0) * (sal.paxMaxPorMesa || 0);
      return { nome: sal.nome, pax };
    })
    .filter((x): x is { nome: string; pax: number } => !!x);
  const capacidadeTotal = saloesInfo.reduce((acc, s) => acc + s.pax, 0);

  // ─── Acha exceção atual (se houver) ───
  // Pra status bloqueado/personalizado/extra, há uma excecao na lista.
  // O resolver guarda excecoesIds no slot — usamos pra encontrar e editar/deletar.
  const excecaoAtual = slot.excecoesIds.length > 0
    ? excecoesNaData.find(e => e.id === slot.excecoesIds[0])
    : null;

  // ─── Bloquear horário (status normal) ───
  async function bloquear() {
    setErro("");
    if (!confirm(`Bloquear ${slot.horario} de ${fmtData(data)}?`)) return;
    setSalvando(true);
    try {
      const exc: Omit<ExcecaoReserva, "id"> = {
        restaurantId,
        data,
        escopo: "slot",
        horario: slot.horario,
        tipo: "bloqueio",
        motivo: motivo.trim() || undefined,
        criadoEm: new Date().toISOString(),
        criadoPor: pessoaId,
        criadoPorNome: pessoaNome,
      };
      await addDoc(collection(db, "excecoesReserva"), sanitizeForFirestore(exc));
      onClose();
    } catch (e) {
      setErro("Erro ao bloquear: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  // ─── Salvar personalização (cria OU edita uma existente) ───
  async function salvarPersonalizacao() {
    setErro("");
    if (salaoIds.length === 0) return setErro("Selecione pelo menos 1 salão.");
    const paxN = paxMaxOverride ? parseInt(paxMaxOverride, 10) : 0;
    if (paxMaxOverride && (!paxN || paxN < 1)) return setErro("Limite de pax inválido.");

    setSalvando(true);
    try {
      // Já existe exceção (personalização ou outra que vamos substituir)?
      const existente = excecoesNaData.find(e =>
        e.escopo === "slot" && e.horario === slot.horario && e.tipo === "personalizacao",
      );
      const now = new Date().toISOString();
      const payload: Partial<ExcecaoReserva> = {
        restaurantId,
        data,
        escopo: "slot",
        horario: slot.horario,
        tipo: "personalizacao",
        salaoIds,
        paxMaxOverride: paxN > 0 ? paxN : undefined,
        motivo: motivo.trim() || undefined,
      };
      if (existente) {
        await updateDoc(doc(db, "excecoesReserva", existente.id), sanitizeForFirestore(payload));
      } else {
        const fullPayload = {
          ...payload,
          criadoEm: now,
          criadoPor: pessoaId,
          criadoPorNome: pessoaNome,
        };
        await addDoc(collection(db, "excecoesReserva"), sanitizeForFirestore(fullPayload));
      }
      onClose();
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  // ─── Salvar edição de janela_extra ───
  async function salvarEditarExtra() {
    setErro("");
    if (!excecaoAtual) return;
    if (!/^([0-1]\d|2[0-3]):[0-5]\d$/.test(horario)) return setErro("Horário inválido.");
    if (salaoIds.length === 0) return setErro("Selecione pelo menos 1 salão.");
    const paxN = paxMaxOverride ? parseInt(paxMaxOverride, 10) : 0;
    if (paxMaxOverride && (!paxN || paxN < 1)) return setErro("Limite de pax inválido.");

    setSalvando(true);
    try {
      const patch: Partial<ExcecaoReserva> = {
        horario,
        salaoIds,
        paxMaxOverride: paxN > 0 ? paxN : undefined,
        motivo: motivo.trim() || undefined,
      };
      await updateDoc(doc(db, "excecoesReserva", excecaoAtual.id), sanitizeForFirestore(patch));
      onClose();
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  // ─── Remover exceção (desbloquear / restaurar padrão / remover janela) ───
  async function removerExcecao(textoConfirm: string) {
    if (!excecaoAtual) return;
    if (!confirm(textoConfirm)) return;
    setSalvando(true);
    try {
      await deleteDoc(doc(db, "excecoesReserva", excecaoAtual.id));
      onClose();
    } catch (e) {
      setErro("Erro ao remover: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className={`p-4 border-b ${cor.border} ${cor.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={`text-2xl font-bold tabular-nums ${cor.text}`}>{slot.horario}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{fmtData(data)}</div>
            </div>
            <span className={`text-[10px] uppercase tracking-wider font-bold ${cor.text} px-2 py-0.5 rounded-full border ${cor.border}`}>
              {cor.label}
            </span>
          </div>
        </div>

        {/* Resumo + motivo */}
        <div className="p-4 space-y-3 border-b border-gray-200 dark:border-gray-800">
          {saloesInfo.length === 0 ? (
            <div className="text-sm text-gray-500 italic">Sem salões atribuídos</div>
          ) : (
            <div>
              <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider mb-1.5">
                Salões e capacidade
              </div>
              <div className="space-y-1">
                {saloesInfo.map(s => (
                  <div key={s.nome} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-gray-900 dark:text-gray-100">{s.nome}</span>
                    <span className="text-gray-700 dark:text-gray-300 tabular-nums">
                      {s.pax} pax
                    </span>
                  </div>
                ))}
                {saloesInfo.length > 1 && (
                  <div className="flex items-baseline justify-between gap-2 text-sm pt-1.5 mt-1.5 border-t border-gray-200 dark:border-gray-800">
                    <span className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Total</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                      {capacidadeTotal} pax
                    </span>
                  </div>
                )}
                {slot.paxMaxOverride != null && (
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className={`text-[11px] uppercase font-bold tracking-wider ${cor.text}`}>
                      Limite custom desse slot
                    </span>
                    <span className={`font-semibold tabular-nums ${cor.text}`}>
                      até {Math.min(capacidadeTotal, slot.paxMaxOverride)} pax
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {slot.motivos.length > 0 && (
            <div className={`text-xs italic ${cor.text}`}>
              💬 {slot.motivos[0]}
            </div>
          )}
        </div>

        {/* Form de edição (quando ativo) */}
        {(editando === "personalizar" || editando === "editar_extra") && (
          <div className="p-4 space-y-3 overflow-y-auto bg-gray-50 dark:bg-gray-900/40">
            {editando === "editar_extra" && (
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Horário</label>
                <input
                  type="time"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
            )}
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
                Salões habilitados nesse horário
              </label>
              <div className="mt-1.5 space-y-1.5">
                {saloes.filter(s => s.ativo).map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 bg-white dark:bg-gray-900"
                  >
                    <input
                      type="checkbox"
                      checked={salaoIds.includes(s.id)}
                      onChange={() => toggleSalao(s.id)}
                      className="accent-indigo-600 w-4 h-4"
                    />
                    <span className="text-sm">{s.nome}</span>
                    <span className="ml-auto text-[10px] text-gray-500">
                      {s.modeloCapacidade === "por_capacidade"
                        ? `${s.capacidadeMaxPax || 0} pax`
                        : `${s.numMesas || 0} mesas · ${(s.numMesas || 0) * (s.paxMaxPorMesa || 0)} pax`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
                Limite de pax (opcional)
              </label>
              <input
                type="number"
                min="1"
                value={paxMaxOverride}
                onChange={(e) => setPaxMaxOverride(e.target.value)}
                placeholder="sem limite extra"
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Motivo (opcional)</label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="ex: noite de estreia, evento especial"
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditando(null)}
                disabled={salvando}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <Button
                onClick={editando === "editar_extra" ? salvarEditarExtra : salvarPersonalizacao}
                disabled={salvando}
              >
                {salvando ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        )}

        {/* Ações contextuais (quando não editando) */}
        {editando === null && (
          <>
            {erro && (
              <div className="px-4 pt-3 text-xs text-rose-600 dark:text-rose-400">{erro}</div>
            )}
            <div className="p-4 space-y-2">
              {slot.status === "normal" && (
                <>
                  <ActionButton
                    icon="🎨"
                    label="Personalizar"
                    desc="Restringir salões ou limitar pax pra esse horário"
                    onClick={() => {
                      // Pré-preenche com os salões atuais
                      setSalaoIds(slot.salaoIds);
                      setPaxMaxOverride("");
                      setMotivo("");
                      setEditando("personalizar");
                    }}
                  />
                  <ActionButton
                    icon="🚫"
                    label="Bloquear este horário"
                    desc="Não aceita reservas nesse slot. Pode desfazer depois."
                    variant="danger"
                    onClick={bloquear}
                    disabled={salvando}
                  />
                </>
              )}

              {slot.status === "bloqueado" && excecaoAtual && (
                <ActionButton
                  icon="↶"
                  label="Desbloquear horário"
                  desc="Volta a aceitar reservas no padrão semanal"
                  onClick={() => removerExcecao("Desbloquear esse horário e voltar pro padrão?")}
                  disabled={salvando}
                />
              )}

              {slot.status === "personalizado" && excecaoAtual && (
                <>
                  <ActionButton
                    icon="✏️"
                    label="Editar personalização"
                    desc="Mudar salões, limite de pax ou motivo"
                    onClick={() => {
                      setSalaoIds(slot.salaoIds);
                      setPaxMaxOverride(slot.paxMaxOverride != null ? String(slot.paxMaxOverride) : "");
                      setMotivo(slot.motivos[0] || "");
                      setEditando("personalizar");
                    }}
                  />
                  <ActionButton
                    icon="↶"
                    label="Restaurar padrão"
                    desc="Remove a personalização — slot volta ao padrão semanal"
                    onClick={() => removerExcecao("Remover a personalização e voltar pro padrão?")}
                    disabled={salvando}
                  />
                </>
              )}

              {slot.status === "extra" && excecaoAtual && (
                <>
                  <ActionButton
                    icon="✏️"
                    label="Editar janela extra"
                    desc="Mudar horário, salões, limite de pax ou motivo"
                    onClick={() => {
                      setHorario(slot.horario);
                      setSalaoIds(slot.salaoIds);
                      setPaxMaxOverride(slot.paxMaxOverride != null ? String(slot.paxMaxOverride) : "");
                      setMotivo(slot.motivos[0] || "");
                      setEditando("editar_extra");
                    }}
                  />
                  <ActionButton
                    icon="🗑️"
                    label="Remover janela extra"
                    desc="Apaga essa janela. Não afeta o padrão semanal."
                    variant="danger"
                    onClick={() => removerExcecao("Remover essa janela extra?")}
                    disabled={salvando}
                  />
                </>
              )}

              {/* Slot personalizado vindo de SiteConfig (slotsReservaCustom, sem id próprio) */}
              {slot.status === "personalizado" && !excecaoAtual && (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic px-2 py-3">
                  Esse slot vem de uma data especial configurada em Horários → Funcionamento.
                  Edite por lá pra ajustar.
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer (sempre tem fechar) */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2 bg-gray-50 dark:bg-gray-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Botão de ação reutilizável ───

function ActionButton({
  icon, label, desc, onClick, disabled, variant,
}: {
  icon: string;
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  const baseCls =
    "w-full text-left px-3 py-3 rounded-lg border transition-colors flex items-start gap-3 disabled:opacity-50 disabled:cursor-not-allowed";
  const variantCls = variant === "danger"
    ? "border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-800 dark:text-rose-300"
    : "border-gray-200 dark:border-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${baseCls} ${variantCls}`}>
      <span className="text-lg flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</span>
      </span>
    </button>
  );
}
