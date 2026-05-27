// Modal — Ações sobre um dia inteiro
//
// Aberto ao clicar no header de uma coluna na Agenda. Permite:
//   - Bloquear dia inteiro (cria exceção dia_inteiro/bloqueio)
//   - Desbloquear (se já tinha bloqueio dia inteiro)
//
// Bloqueios de slot individual continuam sendo feitos via SlotEditarModal
// (click no slot).

import { useState } from "react";
import { addDoc, collection, deleteDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import type { ExcecaoReserva } from "../../core/types";

type Props = {
  data: string;                        // YYYY-MM-DD
  restaurantId: string;
  pessoaId: string;
  pessoaNome: string;
  /** Excecoes existentes nessa data (pra detectar bloqueio dia_inteiro). */
  excecoesNaData: ExcecaoReserva[];
  /** Atalho pra abrir "+ Janela extra" prefilled com essa data. */
  onAdicionarJanelaExtra: () => void;
  onClose: () => void;
};

const NOMES_DIA_LONG = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const NOMES_MES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function fmtData(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  return `${String(d.getDate()).padStart(2, "0")} ${NOMES_MES[d.getMonth()]} · ${NOMES_DIA_LONG[d.getDay()]}`;
}

export function DiaAcoesModal({
  data, restaurantId, pessoaId, pessoaNome, excecoesNaData, onAdicionarJanelaExtra, onClose,
}: Props) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mostrandoFormBloqueio, setMostrandoFormBloqueio] = useState(false);

  const bloqueioDiaInteiro = excecoesNaData.find(
    e => e.escopo === "dia_inteiro" && e.tipo === "bloqueio",
  );

  async function bloquearDiaInteiro() {
    setErro("");
    setSalvando(true);
    try {
      const exc: Omit<ExcecaoReserva, "id"> = {
        restaurantId,
        data,
        escopo: "dia_inteiro",
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

  async function desbloquearDiaInteiro() {
    if (!bloqueioDiaInteiro) return;
    if (!confirm("Desbloquear esse dia? Volta a aceitar reservas no padrão semanal.")) return;
    setSalvando(true);
    try {
      await deleteDoc(doc(db, "excecoesReserva", bloqueioDiaInteiro.id));
      onClose();
    } catch (e) {
      setErro("Erro ao remover: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
            🗓️ Ações do dia
          </h2>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {fmtData(data)}
          </div>
        </div>

        <div className="p-4 space-y-2">
          {bloqueioDiaInteiro ? (
            <>
              <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900 p-3 text-xs text-rose-800 dark:text-rose-300">
                <div className="font-semibold mb-1">🚫 Dia bloqueado</div>
                {bloqueioDiaInteiro.motivo && (
                  <div className="italic">💬 {bloqueioDiaInteiro.motivo}</div>
                )}
              </div>
              <button
                type="button"
                onClick={desbloquearDiaInteiro}
                disabled={salvando}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 transition-colors disabled:opacity-50"
              >
                ↶ Desbloquear dia
              </button>
              <button
                type="button"
                onClick={() => { onAdicionarJanelaExtra(); onClose(); }}
                className="w-full px-3 py-2.5 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60 text-sm transition-colors"
              >
                + Janela extra nesse dia
              </button>
            </>
          ) : mostrandoFormBloqueio ? (
            <>
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
                  Motivo (opcional)
                </label>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="ex: feriado, evento privado"
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-400 italic">
                Atenção: bloqueia novas reservas pelo público. Reservas
                existentes continuam ativas — cancele manualmente se precisar.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setMostrandoFormBloqueio(false); setMotivo(""); }}
                  disabled={salvando}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Voltar
                </button>
                <Button onClick={bloquearDiaInteiro} disabled={salvando}>
                  {salvando ? "Bloqueando…" : "Confirmar bloqueio"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMostrandoFormBloqueio(true)}
                className="w-full px-3 py-2.5 rounded-lg border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-sm text-rose-800 dark:text-rose-300 transition-colors flex items-start gap-2"
              >
                <span className="text-lg leading-none flex-shrink-0">🚫</span>
                <span className="text-left">
                  <span className="block font-semibold">Bloquear dia inteiro</span>
                  <span className="block text-[11px] opacity-80 mt-0.5">
                    Não aceita reservas nesse dia
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => { onAdicionarJanelaExtra(); onClose(); }}
                className="w-full px-3 py-2.5 rounded-lg border border-sky-200 dark:border-sky-900 hover:bg-sky-50 dark:hover:bg-sky-900/20 text-sm text-sky-800 dark:text-sky-300 transition-colors flex items-start gap-2"
              >
                <span className="text-lg leading-none flex-shrink-0">✦</span>
                <span className="text-left">
                  <span className="block font-semibold">Adicionar janela extra</span>
                  <span className="block text-[11px] opacity-80 mt-0.5">
                    Cria um horário fora do padrão semanal
                  </span>
                </span>
              </button>
            </>
          )}

          {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end bg-gray-50 dark:bg-gray-900/60">
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
