// ════════════════════════════════════════════════════════════════════════════
//  Meus Horários — jornada de trabalho cadastrada da pessoa.
//
//  Lê empregado.workSchedules (array de WorkSchedule versionadas) e mostra:
//   - Vigência atual (default) ou versão escolhida no dropdown
//   - Tipo single: 1 grid com 7 dias da semana
//   - Tipo alternating: 2 grids (semana A e semana B)
//   - SundayCycle: info "trabalha N domingos seguidos, folga M"
//   - Total contratual em horas/mês
//
//  Sem workSchedule cadastrado → mensagem amigável "peça pro DP".
//  Edição mora em Pessoas → empregado → Horários (admin) — esta tab é READ-ONLY.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { getActiveWorkSchedule } from "../../core/escala/horarios";
import { fmtBR, todayYmd } from "../../core/utils/date";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import type { Cargo, Empregado, HorarioDia, SundayCycle, WorkSchedule } from "../../core/types";

const DIA_NOMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Props = {
  empregado: Empregado;
  cargo: Cargo | null;
  restaurantId: string;
};

export function MeusHorariosTab({ empregado, cargo, restaurantId }: Props) {
  const { pessoa } = useAuth();
  const { can } = useCanAcao(restaurantId);
  const podeSolicitar = !!pessoa?.isMaster || can("portalEmpregado", "solicitarAjuste");
  const [modalHorario, setModalHorario] = useState(false);
  // workSchedules ordenado da mais RECENTE pra mais antiga (validFrom desc)
  const wsOrdenados = useMemo(() => {
    const arr = empregado.workSchedules || [];
    return [...arr].sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || ""));
  }, [empregado.workSchedules]);

  // Versão mostrada (default = vigente hoje)
  const [validFromEscolhido, setValidFromEscolhido] = useState<string | null>(null);
  const wsAtual = useMemo<WorkSchedule | null>(() => {
    if (validFromEscolhido) {
      return wsOrdenados.find(w => w.validFrom === validFromEscolhido) || null;
    }
    return getActiveWorkSchedule(empregado.workSchedules, todayYmd());
  }, [empregado.workSchedules, wsOrdenados, validFromEscolhido]);

  // Sem horário cadastrado
  if (wsOrdenados.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-5xl mb-3">🕐</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Sua jornada de trabalho ainda não foi cadastrada
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Peça pro DP cadastrar seu horário em Pessoas → seu cargo → Horários.
        </p>
      </div>
    );
  }

  // Caso edge: tem schedules mas nenhum vigente hoje (todos com validFrom futuro)
  if (!wsAtual) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-5xl mb-3">📅</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Nenhuma jornada vigente hoje
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          A próxima vigência começa em {fmtBR(wsOrdenados[wsOrdenados.length - 1].validFrom)}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com vigência + dropdown de versões */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Jornada vigente
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              {cargo && <>{cargo.nome} ({cargo.area}) · </>}
              a partir de <strong>{fmtBR(wsAtual.validFrom)}</strong>
            </p>
          </div>
          {wsOrdenados.length > 1 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 block mb-1">
                Vigência
              </label>
              <select
                value={validFromEscolhido || wsAtual.validFrom}
                onChange={(e) => setValidFromEscolhido(e.target.value === wsAtual.validFrom ? null : e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                {wsOrdenados.map((w) => (
                  <option key={w.validFrom} value={w.validFrom}>
                    {fmtBR(w.validFrom)}{w.validFrom === getActiveWorkSchedule(empregado.workSchedules, todayYmd())?.validFrom ? " · atual" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {wsAtual.motivo && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
            Motivo do cadastro: {wsAtual.motivo}
          </p>
        )}
      </div>

      {/* Conteúdo: single ou alternating */}
      {wsAtual.type === "single" ? (
        <BlocoSemana
          days={wsAtual.days || {}}
          totalContract={wsAtual.totalContract}
          sundayCycle={wsAtual.sundayCycle}
          titulo="Sua jornada semanal"
        />
      ) : (
        <>
          <BlocoSemana
            days={wsAtual.weeks?.A.days || {}}
            totalContract={wsAtual.weeks?.A.totalContract || 0}
            sundayCycle={wsAtual.weeks?.A.sundayCycle ?? wsAtual.sundayCycle}
            titulo="🅰️ Semana A"
          />
          <BlocoSemana
            days={wsAtual.weeks?.B.days || {}}
            totalContract={wsAtual.weeks?.B.totalContract || 0}
            sundayCycle={wsAtual.weeks?.B.sundayCycle ?? wsAtual.sundayCycle}
            titulo="🅱️ Semana B"
          />
          {wsAtual.anchor && (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Alternância ancorada em {fmtBR(wsAtual.anchor.date)} (era semana {wsAtual.anchor.week}).
            </p>
          )}
        </>
      )}

      {/* Solicitar ajuste de horário (jornada não bate com a praticada) */}
      {podeSolicitar && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-gray-600 dark:text-gray-300">Esse horário não bate com o que você pratica?</span>
          <Button variant="secondary" size="sm" onClick={() => setModalHorario(true)}>Solicitar ajuste de horário</Button>
        </div>
      )}
      {modalHorario && pessoa && (
        <SolicitarHorarioModal rid={restaurantId} empregado={empregado} criadoPor={pessoa.id} onClose={() => setModalHorario(false)} />
      )}
    </div>
  );
}

// ─── Modal: pedir ajuste da jornada contratual (texto livre) ──────────────
function SolicitarHorarioModal({ rid, empregado, criadoPor, onClose }: { rid: string; empregado: Empregado; criadoPor: string; onClose: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function enviar() {
    if (!motivo.trim()) { setErro("Descreva o que está diferente no seu horário."); return; }
    setSalvando(true); setErro("");
    try {
      await addDoc(collection(db, "escalaSolicitacoes"), sanitizeForFirestore({
        restaurantId: rid, empregadoId: empregado.id, empregadoNome: empregado.nome,
        tipo: "horario", motivo: motivo.trim(), status: "pendente",
        criadoEm: new Date().toISOString(), criadoPor,
      }));
      onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao enviar."); }
    finally { setSalvando(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 dark:text-gray-100">Solicitar ajuste de horário</h3>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">Descreva como sua jornada real difere da cadastrada (dias, horários, intervalo, folga…). A gestão revisa e corrige no cadastro.</p>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4} placeholder="ex: minha folga mudou de segunda pra quarta · entro 10h e não 12h · não faço mais 2h de intervalo…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        {erro && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">⚠ {erro}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={salvando} onClick={() => void enviar()}>{salvando ? "Enviando…" : "Enviar pedido"}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Bloco de semana (7 dias) ─────────────────────────────────────────────

function BlocoSemana({
  days, totalContract, sundayCycle, titulo,
}: {
  days: { [k: number]: HorarioDia };
  totalContract: number;
  sundayCycle?: SundayCycle | null;
  titulo: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{titulo}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Total contratual: <strong>{fmtMinutosComoHoras(totalContract)}/semana</strong>
        </p>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <LinhaDia key={d} diaIdx={d} dia={days[d]} />
        ))}
      </div>
      {sundayCycle && (
        <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-900/20 border-t border-indigo-200 dark:border-indigo-800/40">
          <p className="text-xs text-indigo-900 dark:text-indigo-200">
            <strong>Ciclo de domingo:</strong> trabalha {sundayCycle.workCount} domingo(s) seguidos, folga {sundayCycle.offCount}.
            {sundayCycle.refDate && <> Próxima folga ancorada em {fmtBR(sundayCycle.refDate)}.</>}
          </p>
        </div>
      )}
    </div>
  );
}

function LinhaDia({ diaIdx, dia }: { diaIdx: number; dia: HorarioDia | undefined }) {
  const nome = DIA_NOMES[diaIdx];
  const ativo = dia?.active === true;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-24 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {nome}
      </span>
      {ativo ? (
        <div className="flex-1 flex items-center gap-2 flex-wrap text-sm">
          <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {dia?.in || "?"} <span className="text-gray-400">→</span> {dia?.out || "?"}
          </span>
          {dia?.break && dia.break > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              · intervalo {fmtMinutosComoHoras(dia.break)}
            </span>
          )}
        </div>
      ) : (
        <span className="flex-1 text-sm text-gray-400 italic">folga</span>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtMinutosComoHoras(min: number): string {
  if (!min || min < 0) return "0min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
