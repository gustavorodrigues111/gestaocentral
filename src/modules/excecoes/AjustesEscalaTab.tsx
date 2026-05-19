// ════════════════════════════════════════════════════════════════════════════
//  Aba "Ajustes de Escala" — lista as semanas que já foram conferidas pelo
//  gerente (status `conferido_gerente`) com as observações coletadas durante
//  o workflow (líder → gerente). Serve como check-list pro pessoal aplicar
//  manualmente as correções na escala praticada da semana correspondente.
//
//  Por enquanto: leitura. Iteração futura: marcar cada ajuste como aplicado.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { listarStatusDoRestaurante } from "../../core/excecoes/statusSemana";
import {
  EXCECAO_STATUS_LABEL,
  type ExcecaoHistoricoEntry,
  type ExcecaoStatusSemana,
} from "../../core/types";

type Props = {
  rid: string;
};

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// Filtra do histórico só os eventos que têm observação (esses são os
// "apontamentos" feitos pelo líder/gerente durante o tratamento).
function apontamentosDe(s: ExcecaoStatusSemana): ExcecaoHistoricoEntry[] {
  return (s.historico || []).filter((h) => !!h.observacao);
}

export function AjustesEscalaTab({ rid }: Props) {
  const [semanas, setSemanas] = useState<ExcecaoStatusSemana[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarOutras, setMostrarOutras] = useState(false);

  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    setLoading(true);
    setErro("");
    listarStatusDoRestaurante(rid)
      .then((rows) => {
        if (cancelled) return;
        setSemanas(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setErro(e instanceof Error ? e.message : "Erro ao carregar.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rid]);

  // Conferidas primeiro, ordenadas por semana decrescente. "Outras" (em
  // tratamento ou tratado pelo líder) ficam atrás de um toggle.
  const conferidas = useMemo(
    () => semanas
      .filter((s) => s.status === "conferido_gerente")
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [semanas],
  );
  const outras = useMemo(
    () => semanas
      .filter((s) => s.status === "em_tratamento" || s.status === "tratado_lider")
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [semanas],
  );

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Carregando…</div>;
  }
  if (erro) {
    return (
      <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
        ❌ {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300">
        💡 Lista das semanas <strong>conferidas pelo gerente</strong> com as observações registradas
        durante o tratamento. Use como roteiro pra aplicar manualmente as correções na escala
        praticada da semana correspondente.
      </div>

      {conferidas.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Nenhuma semana conferida ainda
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Quando o gerente conferir uma semana na aba "Inconformidades", os apontamentos
            aparecem aqui pra orientar o ajuste manual.
          </p>
        </div>
      )}

      {conferidas.map((s) => (
        <SemanaCard key={s.id} semana={s} />
      ))}

      {outras.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setMostrarOutras((v) => !v)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {mostrarOutras
              ? `Ocultar ${outras.length} semana(s) em andamento`
              : `Mostrar ${outras.length} semana(s) em andamento (ainda não conferidas)`}
          </button>
          {mostrarOutras && (
            <div className="mt-2 space-y-3">
              {outras.map((s) => (
                <SemanaCard key={s.id} semana={s} dim />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SemanaCard({ semana, dim }: { semana: ExcecaoStatusSemana; dim?: boolean }) {
  const apontamentos = apontamentosDe(semana);
  return (
    <section
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden ${
        dim ? "opacity-70" : ""
      }`}
    >
      <header className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <div className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            Semana {fmtDataBr(semana.weekStart)} a {fmtDataBr(semana.weekEnd)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Status: <strong>{EXCECAO_STATUS_LABEL[semana.status]}</strong>
          </div>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold">
          {apontamentos.length} apontamento(s)
        </span>
      </header>

      {apontamentos.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 italic">
          Sem observações registradas. (O líder/gerente não anotou ajustes no histórico desta
          semana.)
        </div>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-gray-800">
          {apontamentos.map((h, i) => {
            const reverter = (h.observacao || "").startsWith("[reverter]");
            return (
              <li key={i} className="px-4 py-2.5 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums select-none mt-0.5">
                    {i + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`${reverter ? "italic text-gray-500" : "text-gray-800 dark:text-gray-200"}`}>
                      {(h.observacao || "").replace(/^\[reverter\]\s*/, "")}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {fmtDataHora(h.em)} · {h.porNome} ·{" "}
                      <span className="italic">{EXCECAO_STATUS_LABEL[h.status]}</span>
                      {reverter && <span className="ml-1 text-amber-700">(reversão)</span>}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
