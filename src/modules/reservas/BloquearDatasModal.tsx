// Modal — Bloquear data(s)
//
// Opções:
//  - Dia inteiro (uma data OU range "de até")
//  - Slot específico (uma data + uma hora)
//
// Cria um doc em /excecoesReserva por data (ou um só se for slot
// específico). O resolver depois combina com o padrão semanal.

import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import type { ExcecaoReserva } from "../../core/types";

type Props = {
  restaurantId: string;
  pessoaId: string;
  pessoaNome: string;
  onClose: () => void;
};

type Escopo = "dia_inteiro" | "slot";

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffDias(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000,
  );
}

export function BloquearDatasModal({ restaurantId, pessoaId, pessoaNome, onClose }: Props) {
  const hoje = todayYmd();
  const [escopo, setEscopo] = useState<Escopo>("dia_inteiro");
  const [dataInicio, setDataInicio] = useState(hoje);
  const [dataFim, setDataFim] = useState(hoje);
  const [horario, setHorario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function submit() {
    setErro("");
    // Validações
    if (escopo === "dia_inteiro") {
      if (!dataInicio || !dataFim) return setErro("Preencha as duas datas.");
      if (dataFim < dataInicio) return setErro("Data final precisa ser ≥ data inicial.");
      const dias = diffDias(dataInicio, dataFim) + 1;
      if (dias > 90) return setErro("Range muito grande (máx 90 dias). Quebra em partes menores.");
    } else {
      if (!dataInicio) return setErro("Preencha a data.");
      if (!horario) return setErro("Preencha o horário do slot a bloquear.");
      if (!/^([0-1]\d|2[0-3]):[0-5]\d$/.test(horario)) return setErro("Horário inválido (use HH:MM).");
    }

    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const datas = escopo === "dia_inteiro"
        ? Array.from({ length: diffDias(dataInicio, dataFim) + 1 }, (_, i) => addDays(dataInicio, i))
        : [dataInicio];

      // Cria 1 doc por data (escopo dia_inteiro) ou 1 doc só (escopo slot)
      for (const data of datas) {
        const exc: Omit<ExcecaoReserva, "id"> = {
          restaurantId,
          data,
          escopo,
          tipo: "bloqueio",
          motivo: motivo.trim() || undefined,
          criadoEm: now,
          criadoPor: pessoaId,
          criadoPorNome: pessoaNome,
        };
        if (escopo === "slot") exc.horario = horario;
        await addDoc(collection(db, "excecoesReserva"), sanitizeForFirestore(exc));
      }
      onClose();
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            🚫 Bloquear data(s)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Impede novas reservas pelo público. Reservas existentes nesse
            slot continuam ativas — cancele/avise manualmente se precisar.
          </p>
        </div>

        <div className="p-4 space-y-4">
          {/* Escopo */}
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Escopo do bloqueio
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEscopo("dia_inteiro")}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  escopo === "dia_inteiro"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                📆 Dia inteiro
              </button>
              <button
                type="button"
                onClick={() => setEscopo("slot")}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  escopo === "slot"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                ⏰ Só um horário
              </button>
            </div>
          </div>

          {/* Datas */}
          {escopo === "dia_inteiro" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">De</label>
                <input
                  type="date"
                  value={dataInicio}
                  min={hoje}
                  onChange={(e) => {
                    setDataInicio(e.target.value);
                    if (e.target.value > dataFim) setDataFim(e.target.value);
                  }}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Até</label>
                <input
                  type="date"
                  value={dataFim}
                  min={dataInicio}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              {dataInicio && dataFim && dataFim >= dataInicio && (
                <div className="col-span-2 text-xs text-gray-500 dark:text-gray-400">
                  {diffDias(dataInicio, dataFim) + 1} dia(s) serão bloqueados
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Data</label>
                <input
                  type="date"
                  value={dataInicio}
                  min={hoje}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Horário (HH:MM)</label>
                <input
                  type="time"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                />
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  Deve bater com um slot existente do padrão semanal.
                </p>
              </div>
            </div>
          )}

          {/* Motivo */}
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ex: evento privado, feriado, manutenção"
              className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          {erro && (
            <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2 bg-gray-50 dark:bg-gray-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancelar
          </button>
          <Button onClick={submit} disabled={salvando}>
            {salvando ? "Bloqueando…" : "Bloquear"}
          </Button>
        </div>
      </div>
    </div>
  );
}
