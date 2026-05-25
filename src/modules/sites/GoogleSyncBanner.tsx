// Banner sticky de "atualizar no Google Business". Aparece se:
//   • Horário regular foi alterado e admin ainda não marcou
//     googleHorarioRegularOk = true, OU
//   • Qualquer exceção tem googleSyncOk != true
//
// Não tem botão "limpar" no banner — admin confirma cada item via
// checkbox individual (no card da exceção / abaixo do horário regular).
// Banner some sozinho quando TODOS os pendentes virarem confirmados.
//
// Por que manual em vez de API oficial: Google Business API é gated por
// aprovação (semanas/meses) e exige OAuth + 8 APIs + quota review. Para
// 1-3 restaurantes, o checklist manual tem melhor custo:benefício. Se um
// dia escalar, dá pra trocar pelo API real sem quebrar essa UX —
// confirmação automática via PATCH bem-sucedido.

import type { ExcecaoHorarioSite } from "../../core/types";

type Props = {
  horarioRegularOk: boolean | undefined;        // undefined = nunca mexido, assume OK
  excecoes: ExcecaoHorarioSite[];
  googleBusinessUrl?: string;
};

export function GoogleSyncBanner({ horarioRegularOk, excecoes, googleBusinessUrl }: Props) {
  // Horário regular: só é pendência se foi explicitamente marcado como
  // false. undefined trata como OK (sites pré-feature ou sem mudança).
  const regularPendente = horarioRegularOk === false;

  // Exceções: pendentes quando não tem confirmação positiva. Como nova
  // exceção é criada com googleSyncOk = false, esse filter pega novas
  // automaticamente. Exceções antigas (pré-feature) com undefined ficam
  // visíveis aqui — admin marca de uma vez quando atualizar todas.
  const excecoesPendentes = excecoes.filter(e => e.googleSyncOk !== true);

  if (!regularPendente && excecoesPendentes.length === 0) return null;

  const url = googleBusinessUrl?.trim() || "https://business.google.com/";

  const partes: string[] = [];
  if (regularPendente) partes.push("horário regular semanal");
  if (excecoesPendentes.length > 0) {
    partes.push(`${excecoesPendentes.length} ${excecoesPendentes.length === 1 ? "data especial" : "datas especiais"}`);
  }
  const resumoLinha = partes.join(" + ");

  return (
    <div
      className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden>⚠️</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm sm:text-base">
            Atualize também no Google Business
          </div>
          <div className="text-xs sm:text-sm text-amber-800 dark:text-amber-300 mt-0.5">
            Pendente: <strong>{resumoLinha}</strong>. Clientes pesquisando no Google
            ainda veem os dados antigos até você espelhar lá manualmente.
          </div>
          {excecoesPendentes.length > 0 && (
            <div className="text-[11px] sm:text-xs text-amber-700 dark:text-amber-400 mt-2 space-y-0.5">
              {excecoesPendentes.slice(0, 5).map(e => (
                <div key={e.id}>
                  • {formatarData(e.data)} — {e.motivo || (e.fechado ? "fechado" : "horário especial")}
                </div>
              ))}
              {excecoesPendentes.length > 5 && (
                <div className="opacity-70">…e mais {excecoesPendentes.length - 5}</div>
              )}
            </div>
          )}
          <div className="flex gap-2 flex-wrap mt-3">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              🔗 Abrir Google Business
            </a>
            <div className="inline-flex items-center text-[11px] sm:text-xs text-amber-700 dark:text-amber-400 px-2">
              Marque a caixinha em cada item após atualizar →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatarData(iso: string): string {
  try {
    const d = new Date(iso + "T12:00:00");
    const dias = ["dom","seg","ter","qua","qui","sex","sáb"];
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} (${dias[d.getDay()]})`;
  } catch {
    return iso;
  }
}
