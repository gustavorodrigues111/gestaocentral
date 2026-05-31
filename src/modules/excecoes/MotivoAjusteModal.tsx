// ════════════════════════════════════════════════════════════════════════════
//  MotivoAjusteModal — pede motivo + observação pra ajustar a escala
//  praticada a partir de um apontamento de ponto.
//
//  Fluxo:
//   1. Líder clica "📋 Resolver na escala" num apontamento (faltaSemAjuste
//      ou marcacaoForaDaEscala)
//   2. Modal abre com lista de motivos e mostra o que está previsto pro dia
//   3. Se previsto é especial (ferias/folga/comp), pré-seleciona o motivo
//   4. Líder confirma → aplica ajuste na escala.real + grava metadata em
//      escala.realAjustes + marca apontamento como ciência + cria nota
//      interna "Resolvido via ajuste de escala (motivo: X)"
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { fmtAnoMes } from "../../core/utils/date";
import {
  AJUSTE_MOTIVO_LABEL,
  AJUSTE_MOTIVO_PARA_STATUS,
  type AjusteEscalaMotivo,
  type AjusteEscalaMeta,
  type Pessoa,
  type ScheduleStatus,
} from "../../core/types";

type Props = {
  // Contexto
  rid: string;
  empregadoId: string;
  empregadoNome: string;
  data: string;                       // YYYY-MM-DD
  apontamentoId?: string;
  apontamentoRuleId?: string;
  // "ausencia" (escalado mas não veio): faltaSemAjuste
  // "presenca" (não escalado mas veio): marcacaoForaDaEscala
  contexto: "ausencia" | "presenca";
  me: Pessoa;
  onClose: () => void;
  onSalvo: () => Promise<void>;      // callback pós-salvar (pra marcar apontamento ciência etc)
};

// Motivos disponíveis por contexto
const MOTIVOS_AUSENCIA: AjusteEscalaMotivo[] = [
  "falta_i", "falta_j", "atestado", "ferias", "folga", "comp",
];
const MOTIVOS_PRESENCA: AjusteEscalaMotivo[] = [
  "trabalho", "comp_trab", "freela",
];

// Mapeia ScheduleStatus → AjusteEscalaMotivo pra pré-selecionar baseado
// no previsto da escala
function motivoDoStatus(s: ScheduleStatus | undefined): AjusteEscalaMotivo | null {
  if (!s) return null;
  if (s === "falta_i") return "falta_i";
  if (s === "falta_j") return "falta_j";
  if (s === "ferias") return "ferias";
  if (s === "folga") return "folga";
  if (s === "comp") return "comp";
  if (s === "comp_trab") return "comp_trab";
  if (s === "freela") return "freela";
  if (s === "trabalho") return "trabalho";
  return null;
}

export function MotivoAjusteModal({
  rid, empregadoId, empregadoNome, data, apontamentoId, apontamentoRuleId,
  contexto, me, onClose, onSalvo,
}: Props) {
  const motivosDisponiveis = contexto === "ausencia" ? MOTIVOS_AUSENCIA : MOTIVOS_PRESENCA;

  const [previsto, setPrevisto] = useState<ScheduleStatus | undefined>(undefined);
  const [statusAnterior, setStatusAnterior] = useState<ScheduleStatus | undefined>(undefined);
  const [motivo, setMotivo] = useState<AjusteEscalaMotivo | null>(null);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const [carregando, setCarregando] = useState(true);

  // Carrega previsto + statusAtual do dia na escala
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ano = parseInt(data.slice(0, 4), 10);
        const mes = parseInt(data.slice(5, 7), 10);
        const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
        const snap = await getDoc(doc(db, "escalas", escalaId));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data() as {
            prevista?: Record<string, Record<string, ScheduleStatus>>;
            real?: Record<string, Record<string, ScheduleStatus>>;
          };
          const prev = d.prevista?.[empregadoId]?.[data];
          const real = d.real?.[empregadoId]?.[data];
          setPrevisto(prev);
          setStatusAnterior(real);
          // Pré-seleção: se previsto é especial (ferias/folga/comp/falta_j),
          // já sugere — exceto trabalho (default vazio pra forçar escolha)
          const sugerido = motivoDoStatus(prev);
          if (sugerido && sugerido !== "trabalho" && motivosDisponiveis.includes(sugerido)) {
            setMotivo(sugerido);
          }
        }
      } finally {
        if (!cancelled) setCarregando(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvar() {
    if (!motivo) { setErr("Escolha um motivo"); return; }
    setSalvando(true);
    setErr("");
    try {
      const ano = parseInt(data.slice(0, 4), 10);
      const mes = parseInt(data.slice(5, 7), 10);
      const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
      const ref = doc(db, "escalas", escalaId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // Cria doc vazio se não existir (raro — escala já é criada via cell-click)
        await setDoc(ref, sanitizeForFirestore({
          id: escalaId,
          restaurantId: rid,
          ano, mes,
          prevista: {},
          real: {},
          updatedAt: new Date().toISOString(),
        }));
      }
      const novoStatus = AJUSTE_MOTIVO_PARA_STATUS[motivo];
      const now = new Date().toISOString();
      const meta: AjusteEscalaMeta = {
        origem: "ponto_auto",
        motivo,
        observacao: observacao.trim() || undefined,
        apontamentoId,
        apontamentoRuleId,
        ajustadoEm: now,
        ajustadoPor: me.id,
        ajustadoPorNome: me.nome,
        statusAnterior,
      };
      await updateDoc(ref, sanitizeForFirestore({
        [`real.${empregadoId}.${data}`]: novoStatus,
        [`realAjustes.${empregadoId}.${data}`]: meta,
        updatedAt: now,
      }));
      await onSalvo();
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-1 text-gray-900 dark:text-gray-100">
          📋 Resolver na escala
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {empregadoNome} · {new Date(data + "T12:00:00").toLocaleDateString("pt-BR")} ({contexto === "ausencia" ? "ausência" : "presença divergente"})
        </p>

        {carregando ? (
          <div className="text-sm text-gray-500 text-center py-4">Carregando escala...</div>
        ) : (
          <>
            {/* Contexto do previsto */}
            {previsto && previsto !== "trabalho" && previsto !== "folga" && (
              <div className="text-xs px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 mb-3">
                💡 <strong>Previsto pro dia:</strong> {previsto}
                <br />
                <span className="text-[11px]">O motivo correspondente foi pré-selecionado. Você pode trocar se necessário.</span>
              </div>
            )}

            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Motivo do ajuste *
            </div>
            <div className="grid grid-cols-1 gap-1.5 mb-3">
              {motivosDisponiveis.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(m)}
                  className={`text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                    motivo === m
                      ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 dark:border-indigo-600 text-indigo-900 dark:text-indigo-100 font-medium"
                      : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
                  }`}
                >
                  {AJUSTE_MOTIVO_LABEL[m]}
                </button>
              ))}
            </div>

            {(motivo === "falta_j" || motivo === "atestado") && (
              <div className="mb-3">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Observação {motivo === "atestado" ? "(nº/dias do atestado)" : "(justificativa)"}
                </label>
                <textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
                  placeholder={motivo === "atestado" ? "ex: atestado dr. José, CID J45, 1 dia" : "ex: comparecimento em audiência judicial"}
                />
              </div>
            )}

            {statusAnterior && statusAnterior !== "trabalho" && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 italic mb-3">
                Status atual da praticada: <strong>{statusAnterior}</strong> — será sobrescrito
              </div>
            )}

            {err && <div className="text-sm text-rose-600 mb-2">{err}</div>}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || carregando || !motivo}>
            {salvando ? "Salvando..." : "✓ Aplicar na escala"}
          </Button>
        </div>
      </div>
    </div>
  );
}
