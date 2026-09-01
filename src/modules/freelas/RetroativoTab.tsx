// Aba EXCLUSIVA (permissão freelas.lancarRetroativo): lançar turno de freela em
// data PASSADA já completo. Reusa o NovoTurnoModal no modo "retroativo" — o turno
// cai direto no Fechamento (aguardando precificação), como qualquer outro.
import { useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { NovoTurnoModal } from "./NovoTurnoModal";
import { calcHoras, fmtHoras, intervaloTotalDoShift, nomeDoShift } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
};

function fmtDia(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  return `${d}/${m}/${a}`;
}

export function RetroativoTab({ restaurantId, shifts, empregados, pessoas }: Props) {
  const [showModal, setShowModal] = useState(false);
  const hoje = todayYmd();

  // Turnos já lançados em data passada (feedback), mais recentes primeiro.
  const recentes = useMemo(
    () => shifts
      .filter((s) => (s.date || "") < hoje && s.status !== "agendado")
      .sort((a, b) => (b.lancadoEm || "").localeCompare(a.lancadoEm || ""))
      .slice(0, 12),
    [shifts, hoje],
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 p-3 text-sm text-gray-700 dark:text-gray-200">
        ⏪ <strong>Turnos passados</strong> — lance um turno de freela numa data anterior já com
        entrada, saída e intervalos. Cai direto no Fechamento pra precificação. Acesso exclusivo
        (permissão concedida à parte).
      </div>

      <Button onClick={() => setShowModal(true)}>⏪ Lançar turno passado</Button>

      {recentes.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Retroativos recentes
          </div>
          <div className="space-y-1.5">
            {recentes.map((s) => {
              const horas = s.horas ?? calcHoras(s.entrada, s.saida, intervaloTotalDoShift(s));
              return (
                <div key={s.id} className="flex items-center gap-3 flex-wrap rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{nomeDoShift(s)}</span>
                  <span className="text-gray-500 dark:text-gray-400">📅 {fmtDia(s.date)}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {s.entrada || "—"}{s.saida ? `→${s.saida}` : ""}
                  </span>
                  {horas > 0 && <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">{fmtHoras(horas)}</span>}
                  {s.area && <span className="text-gray-500 dark:text-gray-400">📍 {s.area}</span>}
                  <span className="ml-auto text-[11px] text-gray-400 italic">{s.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showModal && (
        <NovoTurnoModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          modo="retroativo"
          onClose={() => setShowModal(false)}
          onSaved={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
