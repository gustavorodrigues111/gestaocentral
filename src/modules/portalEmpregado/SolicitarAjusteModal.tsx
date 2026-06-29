// Modal do EMPREGADO pra pedir correção do status de um dia da sua escala.
// Grava em `escalaSolicitacoes` (status: pendente) — vai pra aba "Ajustes
// solicitados" no módulo Escala, onde líder/DP aprova ou recusa.
import { useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import type { Empregado, ScheduleStatus } from "../../core/types";

const STATUS_OPCOES: { id: ScheduleStatus; label: string }[] = [
  { id: "trabalho", label: "Trabalho" },
  { id: "folga", label: "Folga" },
  { id: "comp", label: "Folga por compensação" },
  { id: "comp_trab", label: "Trabalho por compensação" },
  { id: "ferias", label: "Férias" },
  { id: "falta_j", label: "Falta justificada" },
  { id: "falta_i", label: "Falta injustificada" },
  { id: "freela", label: "Freela" },
];
const LABEL: Record<ScheduleStatus, string> = Object.fromEntries(STATUS_OPCOES.map((o) => [o.id, o.label])) as Record<ScheduleStatus, string>;
const fmtDia = (d: string) => { const [a, m, dd] = d.split("-"); return `${dd}/${m}/${a}`; };

export function SolicitarAjusteModal({ rid, empregado, criadoPor, data, statusAtual, fonteAtual, gorjetaPaga, jaPendente, onClose, onCriado }: {
  rid: string; empregado: Empregado; criadoPor: string;
  data: string; statusAtual: ScheduleStatus | null; fonteAtual: "real" | "prevista" | "derivado" | null;
  gorjetaPaga: boolean; jaPendente: boolean;
  onClose: () => void; onCriado: () => void;
}) {
  // gorjetaPaga BLOQUEIA o pedido (não dá pra alterar dia com gorjeta já paga).
  const [status, setStatus] = useState<ScheduleStatus | "">(statusAtual && statusAtual !== "folga" ? "folga" : "trabalho");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar() {
    setErro("");
    if (!status) { setErro("Escolha qual status você acha que é o correto."); return; }
    if (!motivo.trim()) { setErro("Explique rapidamente o motivo da correção."); return; }
    setSalvando(true);
    try {
      await addDoc(collection(db, "escalaSolicitacoes"), sanitizeForFirestore({
        restaurantId: rid,
        empregadoId: empregado.id,
        empregadoNome: empregado.nome,
        tipo: "dia",
        data,
        anoMes: data.slice(0, 7),
        statusAtual: statusAtual,
        fonteAtual,
        statusSolicitado: status,
        motivo: motivo.trim(),
        gorjetaPaga,
        status: "pendente",
        criadoEm: new Date().toISOString(),
        criadoPor,
      }));
      onCriado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o pedido.");
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Solicitar ajuste — {fmtDia(data)}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        {gorjetaPaga ? (
          <div className="rounded-lg border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 p-3 text-[13px] text-rose-900 dark:text-rose-200">
            🔒 A <strong>gorjeta deste dia já foi paga</strong>, então ele não pode mais ser alterado. Se houver um erro, fale direto com a gestão.
          </div>
        ) : jaPendente ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 p-3 text-[13px] text-amber-900 dark:text-amber-200">
            Você já tem um pedido <strong>pendente</strong> pra esse dia. Aguarde a gestão responder.
          </div>
        ) : (
          <>
            <p className="text-[13px] text-gray-600 dark:text-gray-300">
              Hoje consta: <strong>{statusAtual ? LABEL[statusAtual] : "sem dado"}</strong>
              {fonteAtual ? <span className="text-gray-400"> ({fonteAtual === "real" ? "praticada" : fonteAtual === "prevista" ? "prevista" : "previsão"})</span> : null}.
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Você acha que deveria ser:</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPCOES.map((o) => (
                  <button key={o.id} type="button" onClick={() => setStatus(o.id)}
                    className={`text-[12px] px-2.5 py-1.5 rounded-lg border ${status === o.id ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Explique o motivo</label>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="ex: trabalhei esse dia mas consta folga · troquei domingo com o Pedro · atestado entregue ao DP…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
            </div>

            {erro &&<div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">⚠ {erro}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
              <Button size="sm" disabled={salvando} onClick={() => void enviar()}>{salvando ? "Enviando…" : "Enviar pedido"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
