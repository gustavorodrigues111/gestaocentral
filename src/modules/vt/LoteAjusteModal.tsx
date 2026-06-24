// Modal "Criar lote de ajuste" — compara o VT ESPERADO agora (recalculado do
// cadastro/vínculo + escala atual, já com admissões) contra o que JÁ foi
// lançado no mês (soma dos lotes não-cancelados) e monta um lote só com as
// DIFERENÇAS. O usuário escolhe quais incluir.
import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Area, Cargo, Empregado, EscalaMes, VTLote } from "../../core/types";
import { montarLinhasLote, round2 } from "./calc";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type LinhaAjuste = { empregadoId: string; nome: string; cargoNome: string; area: Area; valor: number; justificativa: string };

export function LoteAjusteModal({
  empregadosProjetados, cargos, escalaLote, escalaRef, ano, mes, mesLabel, lotesDoMes, salvando, onClose, onCriar,
}: {
  empregadosProjetados: Empregado[];
  cargos: Cargo[];
  escalaLote: EscalaMes | null;
  escalaRef: EscalaMes | null;
  ano: number; mes: number; mesLabel: string;
  lotesDoMes: VTLote[];
  salvando: boolean;
  onClose: () => void;
  onCriar: (linhas: LinhaAjuste[]) => void;
}) {
  // Esperado agora (recalculado) por empregado.
  const esperadoPorEmp = useMemo(() => {
    const linhas = montarLinhasLote(empregadosProjetados, cargos, escalaLote, escalaRef, ano, mes);
    const m: Record<string, (typeof linhas)[number]> = {};
    for (const l of linhas) m[l.empregadoId] = l;
    return m;
  }, [empregadosProjetados, cargos, escalaLote, escalaRef, ano, mes]);

  // Já lançado por empregado (soma de todos os lotes não-cancelados do mês).
  const jaLancadoPorEmp = useMemo(() => {
    const m: Record<string, number> = {};
    for (const lote of lotesDoMes) {
      if (lote.status === "cancelado") continue;
      for (const l of lote.linhas) m[l.empregadoId] = round2((m[l.empregadoId] || 0) + (l.total || 0));
    }
    return m;
  }, [lotesDoMes]);

  const diffs = useMemo(() => {
    const ids = new Set([...Object.keys(esperadoPorEmp), ...Object.keys(jaLancadoPorEmp)]);
    const out: Array<{ empregadoId: string; nome: string; cargoNome: string; area: Area; esperado: number; jaLancado: number; diff: number; motivo: string }> = [];
    for (const id of ids) {
      const esp = esperadoPorEmp[id];
      const esperado = round2(esp?.total ?? 0);
      const jaLancado = round2(jaLancadoPorEmp[id] ?? 0);
      const diff = round2(esperado - jaLancado);
      if (Math.abs(diff) < 0.01) continue;
      const motivo = jaLancado === 0 ? "Sem lançamento (novo/admissão)" : diff > 0 ? "Faltou lançar" : "Lançado a mais";
      out.push({ empregadoId: id, nome: esp?.nome ?? "(fora da folha atual)", cargoNome: esp?.cargoNome ?? "—", area: (esp?.area ?? "Salão") as Area, esperado, jaLancado, diff, motivo });
    }
    return out.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [esperadoPorEmp, jaLancadoPorEmp]);

  const [sel, setSel] = useState<Set<string>>(() => new Set(diffs.map((d) => d.empregadoId)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalSel = round2(diffs.filter((d) => sel.has(d.empregadoId)).reduce((s, d) => s + d.diff, 0));
  const nSel = diffs.filter((d) => sel.has(d.empregadoId)).length;

  function criar() {
    const linhas: LinhaAjuste[] = diffs.filter((d) => sel.has(d.empregadoId)).map((d) => ({
      empregadoId: d.empregadoId, nome: d.nome, cargoNome: d.cargoNome, area: d.area, valor: d.diff,
      justificativa: `Ajuste ${mesLabel}: esperado ${fmtBR(d.esperado)} − já lançado ${fmtBR(d.jaLancado)}`,
    }));
    onCriar(linhas);
  }

  return (
    <Modal title="🧮 Criar lote de ajuste" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <p className="text-[12px] text-gray-500">Comparação do VT <strong>esperado agora</strong> (recalculado do cadastro + escala, já com admissões) contra o que <strong>já foi lançado</strong> em {mesLabel}. Marque as diferenças que quer incluir no lote.</p>

        {diffs.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">Nenhuma diferença — o que está lançado bate com o esperado. 🎉</div>
        ) : (
          <>
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 max-h-[50vh] overflow-auto">
              {diffs.map((d) => (
                <label key={d.empregadoId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <input type="checkbox" checked={sel.has(d.empregadoId)} onChange={() => toggle(d.empregadoId)} className="w-4 h-4 accent-indigo-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{d.nome} <span className="text-[11px] font-normal text-gray-400">· {d.cargoNome}</span></div>
                    <div className="text-[11px] text-gray-400">{d.motivo} · já lançado {fmtBR(d.jaLancado)} → esperado {fmtBR(d.esperado)}</div>
                  </div>
                  <div className={`shrink-0 tabular-nums font-semibold ${d.diff >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{d.diff >= 0 ? "+" : ""}{fmtBR(d.diff)}</div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-300">{nSel} selecionado(s) · ajuste total <strong className={totalSel >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{totalSel >= 0 ? "+" : ""}{fmtBR(totalSel)}</strong></div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={salvando} onClick={onClose}>Cancelar</Button>
                <Button size="sm" disabled={salvando || nSel === 0} onClick={criar}>{salvando ? "Criando…" : `Criar lote de ajuste (${nSel})`}</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
