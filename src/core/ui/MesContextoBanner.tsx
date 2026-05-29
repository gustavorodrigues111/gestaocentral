// ════════════════════════════════════════════════════════════════════════════
//  Faixa de contexto de mês — padronizada em Escala / Benefícios / Gorjetas.
//
//  Resolve a confusão de "achei que estava num mês e estava em outro": mostra o
//  mês GRANDE, colorido pela relação com hoje (atual / passado / futuro), com
//  aviso forte quando NÃO é o mês corrente. Opcionalmente mostra a versão
//  (Prevista azul / Praticada verde) pra Escala. As setas ← → são embutidas
//  pra a navegação ficar igual nas três telas.
// ════════════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { nomeMes } from "../utils/date";

type Versao = "prevista" | "real";

const REL = {
  atual:   { label: "Mês atual",                bar: "border-emerald-300 dark:border-emerald-800 bg-white dark:bg-gray-900",         chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  passado: { label: "⚠ Mês passado",            bar: "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/15",      chip: "bg-amber-200 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100" },
  futuro:  { label: "Mês futuro · planejamento", bar: "border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/10",            chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
} as const;

const VER = {
  prevista: { label: "📝 Prevista",  chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  real:     { label: "✅ Praticada", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
} as const;

// Tinta de fundo bem suave pra grade, por versão (usada na Escala).
export function tintaVersao(versao: Versao | undefined): string {
  if (versao === "prevista") return "bg-blue-50/40 dark:bg-blue-900/5";
  if (versao === "real") return "bg-emerald-50/40 dark:bg-emerald-900/5";
  return "";
}

export function relacaoMes(ano: number, mes: number): "atual" | "passado" | "futuro" {
  const hoje = new Date();
  const alvo = ano * 12 + mes;
  const atual = hoje.getFullYear() * 12 + (hoje.getMonth() + 1);
  return alvo === atual ? "atual" : alvo < atual ? "passado" : "futuro";
}

export function MesContextoBanner({
  ano, mes, onPrev, onNext, versao, extra,
}: {
  ano: number;
  mes: number;
  onPrev?: () => void;
  onNext?: () => void;
  versao?: Versao;
  extra?: ReactNode;   // ex: status do lote, filtro de unidade
}) {
  const rel = REL[relacaoMes(ano, mes)];
  const ver = versao ? VER[versao] : null;

  const seta = "w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 font-bold leading-none";

  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap mb-4 rounded-xl border-2 px-3 py-2 ${rel.bar}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {onPrev && <button type="button" onClick={onPrev} className={seta} title="Mês anterior">←</button>}
        <div className="flex items-baseline gap-1.5 px-1">
          <span className="text-xl font-extrabold uppercase tracking-tight text-gray-900 dark:text-gray-100">{nomeMes(mes)}</span>
          <span className="text-xl font-bold text-gray-400">{ano}</span>
        </div>
        {onNext && <button type="button" onClick={onNext} className={seta} title="Próximo mês">→</button>}
        <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${rel.chip}`}>{rel.label}</span>
        {ver && <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${ver.chip}`}>{ver.label}</span>}
      </div>
      {extra && <div className="flex items-center gap-2 flex-wrap">{extra}</div>}
    </div>
  );
}
