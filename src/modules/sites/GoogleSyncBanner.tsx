// Banner sticky que aparece quando admin alterou horários/exceções e ainda
// não confirmou sincronização manual no Google Business. NÃO some sozinho —
// admin tem que clicar "Já atualizei" pra limpar a flag.
//
// Por que manual em vez de API oficial: Google Business API é gated por
// aprovação (semanas/meses) e exige OAuth + 8 APIs habilitadas + quota
// review. Para Lobozó (1-3 restaurantes) o custo:benefício compensa o
// fluxo manual. Se um dia escalar, dá pra trocar pelo API real sem
// quebrar essa UX (a flag ainda existe, só que limpa automaticamente).

import { useState } from "react";

type Props = {
  pendente: { desde: string; motivo: string } | null | undefined;
  googleBusinessUrl?: string;
  podeEditar: boolean;
  onConfirmarAtualizacao: () => Promise<void>;
};

export function GoogleSyncBanner({
  pendente,
  googleBusinessUrl,
  podeEditar,
  onConfirmarAtualizacao,
}: Props) {
  const [confirmando, setConfirmando] = useState(false);
  if (!pendente?.desde) return null;

  // Fallback pro painel geral do Google Business — se admin não setou
  // o link específico do location, abre a listagem onde ele escolhe.
  const url = googleBusinessUrl?.trim() || "https://business.google.com/";
  const tempoAtras = formatarTempoAtras(pendente.desde);

  async function confirmar() {
    if (!podeEditar) return;
    setConfirmando(true);
    try {
      await onConfirmarAtualizacao();
    } finally {
      setConfirmando(false);
    }
  }

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
            {pendente.motivo} — pendente {tempoAtras}.
            Cliente pesquisando no Google ainda vê o horário antigo até você sincronizar manualmente.
          </div>
          <div className="flex gap-2 flex-wrap mt-3">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              🔗 Abrir Google Business
            </a>
            {podeEditar && (
              <button
                type="button"
                onClick={confirmar}
                disabled={confirmando}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
              >
                {confirmando ? "Salvando..." : "✓ Já atualizei no Google"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// "há 5 minutos", "há 2 horas", "ontem", "há 3 dias"
function formatarTempoAtras(iso: string): string {
  try {
    const desde = new Date(iso).getTime();
    if (Number.isNaN(desde)) return "";
    const agora = Date.now();
    const min = Math.floor((agora - desde) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;
    const dias = Math.floor(horas / 24);
    if (dias === 1) return "desde ontem";
    if (dias < 30) return `há ${dias} dias`;
    return `desde ${new Date(iso).toLocaleDateString("pt-BR")}`;
  } catch {
    return "";
  }
}
