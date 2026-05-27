// Modal — Adicionar janela extra
//
// Cria uma exceção tipo "janela_extra" pra uma data + horário específico
// com salões + (opcional) limite de pax. Útil pra abrir o restaurante
// num dia que normalmente é fechado, OU pra adicionar horário fora do
// padrão semanal (ex: jantar especial).
//
// Atalho: "Copiar do padrão semanal" — pré-preenche os campos a partir
// da janela de um dia da semana similar (poupa cliques).

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import type { ConfiguracaoReservas, ExcecaoReserva, Salao } from "../../core/types";

type Props = {
  restaurantId: string;
  pessoaId: string;
  pessoaNome: string;
  saloes: Salao[];
  /** Se vier, pré-preenche o campo data (útil ao clicar "+ Janela extra" de uma data específica na agenda). */
  dataPrefill?: string;
  onClose: () => void;
};

const NOMES_DIA_LONG = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

export function JanelaExtraModal({
  restaurantId, pessoaId, pessoaNome, saloes, dataPrefill, onClose,
}: Props) {
  const hoje = todayYmd();
  const [data, setData] = useState(dataPrefill || hoje);
  const [horario, setHorario] = useState("19:00");
  const [salaoIds, setSalaoIds] = useState<string[]>([]);
  const [paxMaxOverride, setPaxMaxOverride] = useState("");  // string vazia = sem limite
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Config — pra atalho "copiar do padrão semanal"
  const [config, setConfig] = useState<ConfiguracaoReservas | null>(null);
  useEffect(() => {
    let cancel = false;
    getDoc(doc(db, "configReservas", restaurantId)).then(snap => {
      if (cancel) return;
      setConfig(snap.exists() ? ({ id: snap.id, ...snap.data() } as ConfiguracaoReservas) : null);
    }).catch(() => undefined);
    return () => { cancel = true; };
  }, [restaurantId]);

  // Por padrão habilita todos os salões ativos quando o modal abre
  useEffect(() => {
    if (salaoIds.length === 0 && saloes.length > 0) {
      setSalaoIds(saloes.map(s => s.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saloes.length]);

  // Mostra dias da semana com janelas configuradas (pro atalho de copiar)
  const diasComJanelas = useMemo(() => {
    if (!config) return [];
    return (config.janelas || [])
      .filter(j => j.slots && j.slots.length > 0)
      .map(j => ({ dia: j.dia, slots: j.slots, nome: NOMES_DIA_LONG[j.dia] || "" }));
  }, [config]);

  function toggleSalao(id: string) {
    setSalaoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function copiarDoDia(diaSemana: number, slot: { horario: string; salaoIds: string[] }) {
    setHorario(slot.horario);
    setSalaoIds(slot.salaoIds.filter(id => saloes.some(s => s.id === id && s.ativo)));
    // Limpa motivo/pax (não fazem parte da janela padrão)
    setPaxMaxOverride("");
    void diaSemana;
  }

  async function submit() {
    setErro("");
    if (!data) return setErro("Preencha a data.");
    if (data < hoje) return setErro("Não dá pra criar janela em data passada.");
    if (!horario) return setErro("Preencha o horário.");
    if (!/^([0-1]\d|2[0-3]):[0-5]\d$/.test(horario)) return setErro("Horário inválido (use HH:MM).");
    if (salaoIds.length === 0) return setErro("Selecione pelo menos 1 salão.");
    const paxN = paxMaxOverride ? parseInt(paxMaxOverride, 10) : 0;
    if (paxMaxOverride && (!paxN || paxN < 1)) return setErro("Limite de pax inválido.");

    setSalvando(true);
    try {
      const now = new Date().toISOString();
      const exc: Omit<ExcecaoReserva, "id"> = {
        restaurantId,
        data,
        escopo: "slot",
        horario,
        tipo: "janela_extra",
        salaoIds,
        paxMaxOverride: paxN > 0 ? paxN : undefined,
        motivo: motivo.trim() || undefined,
        criadoEm: now,
        criadoPor: pessoaId,
        criadoPorNome: pessoaNome,
      };
      await addDoc(collection(db, "excecoesReserva"), sanitizeForFirestore(exc));
      onClose();
    } catch (e) {
      setErro("Erro ao salvar: " + (e instanceof Error ? e.message : "?"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            + Janela extra
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Cria um horário de reserva fora do padrão semanal pra uma data
            específica. Útil pra abrir num dia normalmente fechado ou pra
            jantares especiais.
          </p>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Data + horário */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Data</label>
              <input
                type="date"
                value={data}
                min={hoje}
                onChange={(e) => setData(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">Horário</label>
              <input
                type="time"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>

          {/* Atalho: copiar do padrão semanal */}
          {diasComJanelas.length > 0 && (
            <details className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                📋 Copiar de um dia padrão (atalho)
              </summary>
              <div className="mt-2 space-y-2">
                {diasComJanelas.map(d => (
                  <div key={d.dia} className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      {d.nome}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.slots.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => copiarDoDia(d.dia, s)}
                          className="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 dark:hover:bg-indigo-900/30 transition-colors tabular-nums"
                        >
                          {s.horario}
                          <span className="ml-1 text-gray-400 dark:text-gray-500">
                            ({s.salaoIds.length} salão{s.salaoIds.length !== 1 ? "ões" : ""})
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Salões */}
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Salões disponíveis nesse horário
            </label>
            <div className="mt-1.5 space-y-1.5">
              {saloes.filter(s => s.ativo).map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
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

          {/* Pax override (opcional) */}
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Limite de pax (opcional)
            </label>
            <input
              type="number"
              min="1"
              value={paxMaxOverride}
              onChange={(e) => setPaxMaxOverride(e.target.value)}
              placeholder="sem limite extra (usa capacidade dos salões)"
              className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              Se preenchido, reduz o teto desse slot específico (não muda a capacidade real dos salões).
            </p>
          </div>

          {/* Motivo */}
          <div>
            <label className="text-[11px] uppercase font-bold text-gray-500 tracking-wider">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ex: feriado especial, jantar harmonizado"
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
            {salvando ? "Salvando…" : "Criar janela"}
          </Button>
        </div>
      </div>
    </div>
  );
}
