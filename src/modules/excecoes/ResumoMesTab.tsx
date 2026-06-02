// ════════════════════════════════════════════════════════════════════════════
//  Aba "Resumo do mês" — agregação por empregado dos apontamentos do mês
//  ativo. Lê os caches já gerados em /excecoesStatusSemana (mesmo
//  relatorioCache.exceptions consumido pela aba Inconformidades) e conta,
//  por empregado:
//    • Intervalo irregular     → ruleId "intervaloMenorQueLegal"
//    • Carga > cadastrada      → ruleId "jornadaAcimaDe10h"
//    • Atrasos > 10 min        → ruleId "atrasoEntrada" (a regra já exige
//                                diff > 10min p/ disparar — todo registro
//                                aqui é > 10min por definição)
//    • Falta justificada       → indisponível neste cache (ajustes não geram
//                                exception; ficam só na escala efetiva)
//    • Falta injustificada     → ruleId "faltaSemAjuste"
//
//  Cada métrica conta DIAS DISTINTOS (não eventos) — múltiplos blocos
//  irregulares no mesmo dia somam 1.
//
//  Não dispara reprocessamento da Sólides — só lê o que já tá cacheado.
//  Pra atualizar, o usuário precisa rodar "Atualizar" na aba Inconformidades.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { pad2 } from "../../core/utils/date";
import { listarStatusDoRestaurante } from "../../core/excecoes/statusSemana";
import type { Cargo, Empregado, ExcecaoStatusSemana } from "../../core/types";
import { empregadoBatePonto } from "../../core/types";
import type {
  ExceptionRecord,
  ExceptionRuleId,
} from "../../core/excecoes/types";

type Props = { rid: string };

// ─── Linha agregada por empregado ───────────────────────────────────────────
type LinhaResumo = {
  empregadoId: string;        // "" quando não casou no Planejamento (CPF sem match)
  empregadoNome: string;
  cpf: string;
  intervaloIrreg: number;     // dias distintos
  cargaAcima: number;         // dias distintos
  atrasos: number;            // dias distintos
  faltaJustificada: number;   // indisponível neste cache — sempre 0 c/ tooltip
  faltaInjustificada: number; // dias distintos
  total: number;
};

// Limiares pro semáforo do total. >10 vermelho, ≤3 verde, resto cinza.
const TOTAL_VERMELHO_MIN = 11;
const TOTAL_VERDE_MAX = 3;

// Map ruleId → "bucket" da tabela. ruleIds não mapeados aqui são ignorados
// (não contam pra nenhuma métrica e somem do total).
type MetricaKey =
  | "intervaloIrreg"
  | "cargaAcima"
  | "atrasos"
  | "faltaInjustificada";

const RULE_TO_METRICA: Partial<Record<ExceptionRuleId, MetricaKey>> = {
  intervaloMenorQueLegal: "intervaloIrreg",
  jornadaAcimaDe10h:      "cargaAcima",
  atrasoEntrada:          "atrasos",
  faltaSemAjuste:         "faltaInjustificada",
};

function fmtMesAno(ano: number, mes: number): string {
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

// "—" pra zero (zero é "sem nada nessa coluna"); número pra >0
function fmtCell(n: number): string {
  return n === 0 ? "—" : String(n);
}

// Classe Tailwind do total conforme limiar
function classTotal(total: number): string {
  if (total >= TOTAL_VERMELHO_MIN) {
    return "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 font-bold";
  }
  if (total <= TOTAL_VERDE_MAX) {
    return "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold";
  }
  return "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold";
}

// Dispara download de CSV (UTF-8 com BOM + separador ; pra Excel BR).
function baixarCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ResumoMesTab({ rid }: Props) {
  // ─── Mês ativo (default = mês atual). Não sincroniza com outras abas. ──
  const hojeRef = new Date();
  const [anoMes, setAnoMes] = useState<{ ano: number; mes: number }>({
    ano: hojeRef.getFullYear(),
    mes: hojeRef.getMonth() + 1,
  });

  function navegaMes(delta: number) {
    setAnoMes((cur) => {
      const d = new Date(cur.ano, cur.mes - 1 + delta, 1);
      return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
    });
  }

  // ─── Empregados (filtrados depois por bate-ponto + restaurante) ───────
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (snap) => setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)),
    );
    return () => u();
  }, [rid]);

  // ─── Cargos globais (pra resolver bate-ponto) ─────────────────────────
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    const u = onSnapshot(collection(db, "cargos"), (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => u();
  }, []);

  // ─── Caches de relatório do restaurante (todas as semanas) ────────────
  const [caches, setCaches] = useState<ExcecaoStatusSemana[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    setLoading(true);
    setErro("");
    listarStatusDoRestaurante(rid)
      .then((rows) => { if (!cancelled) setCaches(rows); })
      .catch((e) => {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Erro ao carregar caches");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rid, anoMes.ano, anoMes.mes]);

  // ─── Set de empregadoIds que batem ponto (filtro principal) ──────────
  const empregadosBatePonto = useMemo(() => {
    const cargoPorId = new Map<string, Cargo>();
    for (const c of cargos) cargoPorId.set(c.id, c);
    return empregados.filter((emp) => {
      const c = cargoPorId.get(emp.cargoId) || null;
      return empregadoBatePonto(emp, c);
    });
  }, [empregados, cargos]);

  // Map CPF (só dígitos) → empregadoId, pra resolver empregado a partir do
  // ExceptionRecord (que só tem CPF da Sólides).
  const empIdByCpf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empregadosBatePonto) {
      const cpf = (e.cpf || "").replace(/\D/g, "");
      if (cpf) m.set(cpf, e.id);
    }
    return m;
  }, [empregadosBatePonto]);

  // ─── Agregação ────────────────────────────────────────────────────────
  // Pra cada empregado, conta dias DISTINTOS por categoria. Usa Set<date>
  // por bucket pra evitar contar 2× o mesmo dia (ex: 2 atrasos no mesmo dia
  // são impossíveis, mas 2 ruleIds distintos podem mapear pra mesmo bucket
  // no futuro).
  const { linhas, totaisRestaurante } = useMemo(() => {
    const mesPrefix = `${anoMes.ano}-${pad2(anoMes.mes)}-`;
    // Coleta exceptions de todos os caches cujo weekStart OU weekEnd cai no mês
    const exceptionsDoMes: ExceptionRecord[] = [];
    for (const c of caches) {
      const cache = c.relatorioCache;
      if (!cache) continue;
      const inMes =
        (c.weekStart || "").startsWith(mesPrefix) ||
        (c.weekEnd || "").startsWith(mesPrefix);
      if (!inMes) continue;
      const excs = (cache.exceptions || []) as ExceptionRecord[];
      for (const e of excs) {
        // Filtra estritamente pelo mês (semanas truncadas trazem dias
        // anterior/seguinte). Garante alinhamento c/ a aba Inconformidades.
        if ((e.date || "").startsWith(mesPrefix)) exceptionsDoMes.push(e);
      }
    }

    // empregadoId → { metricaKey → Set<date> }
    const agg = new Map<string, {
      nome: string;
      cpf: string;
      buckets: Record<MetricaKey, Set<string>>;
    }>();

    function bucketEmpty(): Record<MetricaKey, Set<string>> {
      return {
        intervaloIrreg: new Set(),
        cargaAcima: new Set(),
        atrasos: new Set(),
        faltaInjustificada: new Set(),
      };
    }

    for (const exc of exceptionsDoMes) {
      const metricaKey = RULE_TO_METRICA[exc.ruleId];
      if (!metricaKey) continue; // ruleId fora do escopo desta aba

      const cpfD = (exc.cpf || "").replace(/\D/g, "");
      const empId = empIdByCpf.get(cpfD) || "";
      // Se não casou no Planejamento, ignora — empregado não bate ponto ou
      // não tá cadastrado. Mesma postura da aba Inconformidades.
      if (!empId) continue;

      const cur = agg.get(empId);
      if (cur) {
        cur.buckets[metricaKey].add(exc.date);
      } else {
        const buckets = bucketEmpty();
        buckets[metricaKey].add(exc.date);
        agg.set(empId, { nome: exc.employeeName, cpf: cpfD, buckets });
      }
    }

    // Materializa como LinhaResumo + computa total + ordena
    const linhas: LinhaResumo[] = [];
    for (const [empId, info] of agg) {
      const intervaloIrreg = info.buckets.intervaloIrreg.size;
      const cargaAcima = info.buckets.cargaAcima.size;
      const atrasos = info.buckets.atrasos.size;
      const faltaInjustificada = info.buckets.faltaInjustificada.size;
      const total = intervaloIrreg + cargaAcima + atrasos + faltaInjustificada;
      // Pega o nome MAIS RECENTE do empregado no cadastro (caso tenha trocado);
      // fallback pro nome da Sólides.
      const empCad = empregadosBatePonto.find((e) => e.id === empId);
      linhas.push({
        empregadoId: empId,
        empregadoNome: empCad?.nome || info.nome,
        cpf: info.cpf,
        intervaloIrreg,
        cargaAcima,
        atrasos,
        faltaJustificada: 0,
        faltaInjustificada,
        total,
      });
    }
    // Ordena por total DESC, depois nome ASC
    linhas.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.empregadoNome.localeCompare(b.empregadoNome);
    });

    // Totais do restaurante (soma simples — cada linha é empregado distinto)
    const totaisRestaurante = linhas.reduce(
      (acc, l) => ({
        intervaloIrreg: acc.intervaloIrreg + l.intervaloIrreg,
        cargaAcima: acc.cargaAcima + l.cargaAcima,
        atrasos: acc.atrasos + l.atrasos,
        faltaJustificada: 0,
        faltaInjustificada: acc.faltaInjustificada + l.faltaInjustificada,
        total: acc.total + l.total,
      }),
      { intervaloIrreg: 0, cargaAcima: 0, atrasos: 0, faltaJustificada: 0, faltaInjustificada: 0, total: 0 },
    );

    return { linhas, totaisRestaurante };
  }, [caches, anoMes.ano, anoMes.mes, empIdByCpf, empregadosBatePonto]);

  // ─── Export CSV ───────────────────────────────────────────────────────
  function exportarCsv() {
    const sep = ";";
    const cabecalho = [
      "Empregado",
      "CPF",
      "Intervalo irregular",
      "Carga > cadastrada",
      "Atrasos > 10 min",
      "Falta justificada",
      "Falta injustificada",
      "Total",
    ].join(sep);
    const linhasCsv = linhas.map((l) => [
      escapeCsv(l.empregadoNome),
      l.cpf,
      l.intervaloIrreg,
      l.cargaAcima,
      l.atrasos,
      "", // falta justificada indisponível
      l.faltaInjustificada,
      l.total,
    ].join(sep));
    const totalLinha = [
      "TOTAL DO RESTAURANTE",
      "",
      totaisRestaurante.intervaloIrreg,
      totaisRestaurante.cargaAcima,
      totaisRestaurante.atrasos,
      "",
      totaisRestaurante.faltaInjustificada,
      totaisRestaurante.total,
    ].join(sep);
    // BOM + CRLF — Excel BR abre direito
    const csv = "﻿" + [cabecalho, ...linhasCsv, totalLinha].join("\r\n") + "\r\n";
    const nomeArq = `resumo-ponto-${anoMes.ano}-${pad2(anoMes.mes)}.csv`;
    baixarCsv(nomeArq, csv);
  }

  // Escape simples pra CSV ; — wrap em "" se contém ; , " ou \n; duplica aspas
  function escapeCsv(s: string): string {
    if (s == null) return "";
    const needsQuote = /[;"\n\r]/.test(s);
    const esc = s.replace(/"/g, '""');
    return needsQuote ? `"${esc}"` : esc;
  }

  return (
    <div>
      {/* ── Header c/ navegação de mês + botão exportar ── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navegaMes(-1)}
              aria-label="Mês anterior"
              className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            >←</button>
            <div className="font-semibold text-sm text-gray-800 dark:text-gray-100 capitalize min-w-[160px] text-center">
              Resumo de {fmtMesAno(anoMes.ano, anoMes.mes)}
            </div>
            <button
              type="button"
              onClick={() => navegaMes(1)}
              aria-label="Próximo mês"
              className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            >→</button>
            <button
              type="button"
              onClick={() => {
                const h = new Date();
                setAnoMes({ ano: h.getFullYear(), mes: h.getMonth() + 1 });
              }}
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
            >hoje</button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportarCsv}
            disabled={linhas.length === 0}
            title="Baixa um CSV com as métricas agregadas (UTF-8 c/ BOM, separador ;)"
          >
            ⬇ Exportar CSV
          </Button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          Agregado por empregado dos apontamentos já cacheados. Pra refrescar dados,
          rode "Atualizar" na aba Inconformidades.
        </p>
      </div>

      {/* ── Estados de loading / erro / vazio ── */}
      {loading && (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
          Carregando caches do mês…
        </div>
      )}
      {!loading && erro && (
        <div className="text-sm text-rose-600 dark:text-rose-400 py-4 px-3 bg-rose-50 dark:bg-rose-900/20 rounded">
          {erro}
        </div>
      )}
      {!loading && !erro && linhas.length === 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
          Nenhum apontamento neste mês. Atualize na aba Inconformidades pra gerar.
        </div>
      )}

      {/* ── Tabela ── */}
      {!loading && !erro && linhas.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Empregado</th>
                <th className="text-center px-2 py-2 font-semibold" title="Dias com intervalo intra-jornada abaixo do mínimo legal (55 min)">
                  Int. irreg
                </th>
                <th className="text-center px-2 py-2 font-semibold" title="Dias com jornada acima de 10h (CLT Art. 59)">
                  Carga &gt;
                </th>
                <th className="text-center px-2 py-2 font-semibold" title="Dias com atraso na entrada superior a 10 min (a regra só dispara acima desse limiar)">
                  Atraso &gt;10
                </th>
                <th className="text-center px-2 py-2 font-semibold text-gray-400" title="Indisponível neste cache — ajustes aprovados (FOLGA/ATESTADO/ABONO/FÉRIAS) não geram exception, só sobrescrevem a escala efetiva">
                  Falta-j
                </th>
                <th className="text-center px-2 py-2 font-semibold" title="Dias com falta sem ajuste (escalado, sem batida, sem motivo)">
                  Falta-i
                </th>
                <th className="text-center px-2 py-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {linhas.map((l) => (
                <tr key={l.empregadoId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100">
                    {l.empregadoNome}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-700 dark:text-gray-300">
                    {fmtCell(l.intervaloIrreg)}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-700 dark:text-gray-300">
                    {fmtCell(l.cargaAcima)}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-700 dark:text-gray-300">
                    {fmtCell(l.atrasos)}
                  </td>
                  <td className="px-2 py-2 text-center text-gray-400 dark:text-gray-600">
                    —
                  </td>
                  <td className="px-2 py-2 text-center text-gray-700 dark:text-gray-300">
                    {fmtCell(l.faltaInjustificada)}
                  </td>
                  <td className={`px-2 py-2 text-center ${classTotal(l.total)}`}>
                    {l.total}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-t-2 border-gray-200 dark:border-gray-700">
              <tr>
                <td className="px-3 py-2 font-bold">TOTAL DO RESTAURANTE</td>
                <td className="px-2 py-2 text-center font-semibold">{fmtCell(totaisRestaurante.intervaloIrreg)}</td>
                <td className="px-2 py-2 text-center font-semibold">{fmtCell(totaisRestaurante.cargaAcima)}</td>
                <td className="px-2 py-2 text-center font-semibold">{fmtCell(totaisRestaurante.atrasos)}</td>
                <td className="px-2 py-2 text-center text-gray-400">—</td>
                <td className="px-2 py-2 text-center font-semibold">{fmtCell(totaisRestaurante.faltaInjustificada)}</td>
                <td className={`px-2 py-2 text-center ${classTotal(totaisRestaurante.total)}`}>
                  {totaisRestaurante.total}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
