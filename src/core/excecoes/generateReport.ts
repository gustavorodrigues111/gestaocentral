// ════════════════════════════════════════════════════════════════════════════
//  generateReport — orquestrador. Junta marcações da Sólides + empregados do
//  Planejamento + escala prevista, roda o motor de regras e devolve a lista de
//  exceções pronta. Função PURA (sem I/O).
//
//  Casamento Sólides ↔ Planejamento: chave = CPF (só dígitos).
// ════════════════════════════════════════════════════════════════════════════

import type { Cargo, Empregado, ScheduleStatus } from "../types";
import { empregadoBatePonto } from "../types";
import type { DayContext, DayMetrics, ExceptionRecord, SolidesPunch } from "./types";
import { computeDayMetrics, emptyDayMetrics, groupByEmployeeDay, onlyDigits } from "./dayMetrics";
import { runAllRules } from "./rules";

export type GenerateReportInput = {
  punches: SolidesPunch[];
  empregados: Empregado[]; // empregados do restaurante
  cargos?: Cargo[];        // cargos do restaurante — usado pra filtrar quem não bate ponto
  // empregadoId → (date → status planejado). Vem da escala prevista do Planejamento.
  escalaPorEmpregado: Record<string, Record<string, ScheduleStatus>>;
  // empregadoId → (date → horário previsto NA SÓLIDES — opcional). Quando
  // presente, alimenta a regra de atraso (firstIn real vs in previsto).
  horariosPrevistos?: Record<string, Record<string, { in: string; out: string }>>;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

export type UnmatchedEntry = {
  cpf: string;
  nome: string;
  dias: number; // qtd de dias com marcação que não casaram com nenhum empregado
};

export type GenerateReportResult = {
  exceptions: ExceptionRecord[];
  unmatched: UnmatchedEntry[]; // marcações da Sólides sem empregado correspondente
  diasAnalisados: number;
  // Mapa cpf (só dígitos) → lista de YYYY-MM-DD analisados pra esse empregado.
  // Permite a UI mostrar "dia sem inconformidade" em vez de esconder dias
  // analisados mas sem exception.
  diasAnalisadosPorCpf: Record<string, string[]>;
  // Escala EFETIVA (depois de aplicar ajustes Sólides) por CPF (só dígitos) →
  // data → status. Inclui só empregados que batem ponto. Usado pela UI de
  // Inconformidades pra listar todos os dias do mês com estado visual correto.
  escalaEfetivaPorCpf: Record<string, Record<string, ScheduleStatus>>;
};

// "2026-05-10" + n → "2026-05-1X" (lida com virada de mês/ano via Date local)
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function generateExceptionsReport(input: GenerateReportInput): GenerateReportResult {
  const { punches, empregados, cargos, escalaPorEmpregado, horariosPrevistos, startDate, endDate } = input;
  // Mapa pra resolver cargo do empregado em O(1) — usado na filtragem
  // "bate ponto" abaixo.
  const cargoById = new Map<string, Cargo>();
  for (const c of (cargos || [])) cargoById.set(c.id, c);

  // ── Agrupa marcações por (employeeId da Sólides, date) e consolida métricas ──
  const grouped = groupByEmployeeDay(punches);
  const metricsPorSolidesId = new Map<number, Map<string, DayMetrics>>(); // sid → date → metrics
  const infoPorSolidesId = new Map<number, { cpf: string; nome: string }>();

  for (const blocks of grouped.values()) {
    const metrics = computeDayMetrics(blocks);
    if (!metrics.date) continue;
    let byDate = metricsPorSolidesId.get(metrics.employeeId);
    if (!byDate) {
      byDate = new Map();
      metricsPorSolidesId.set(metrics.employeeId, byDate);
    }
    byDate.set(metrics.date, metrics);
    if (!infoPorSolidesId.has(metrics.employeeId)) {
      infoPorSolidesId.set(metrics.employeeId, { cpf: metrics.cpf, nome: metrics.employeeName });
    }
  }

  // CPF (só dígitos) → solidesId. Em caso de CPF repetido, fica o primeiro.
  const solidesIdPorCpf = new Map<string, number>();
  for (const [sid, info] of infoPorSolidesId) {
    if (info.cpf && !solidesIdPorCpf.has(info.cpf)) solidesIdPorCpf.set(info.cpf, sid);
  }

  const exceptions: ExceptionRecord[] = [];
  const matchedSolidesIds = new Set<number>();
  let diasAnalisados = 0;
  const diasAnalisadosPorCpf: Record<string, string[]> = {};
  // Escala efetiva por CPF — preenchida só pra empregados que batem ponto.
  // Cada mapa por data é a escala JÁ COM os ajustes Sólides aplicados (folga/
  // férias/atestado/abono colapsam em "folga" — perda de informação aceitável
  // pra v1 dessa visão; refinar depois preservando razão original).
  const escalaEfetivaPorCpf: Record<string, Record<string, ScheduleStatus>> = {};

  // ── 1) Processa cada empregado do Planejamento ──
  for (const emp of empregados) {
    // Filtro "bate ponto": empregados que não batem (cargo de confiança,
    // freela, terceirizado, ou override individual) são puramente ignorados
    // pelo motor de regras — nem geram inconformidade, nem matched.
    const cargo = cargoById.get(emp.cargoId);
    if (cargos && cargo && !empregadoBatePonto(emp, cargo)) continue;

    const cpf = onlyDigits(emp.cpf);
    const escalaEmp = escalaPorEmpregado[emp.id] || {};

    // Snapshot da escala efetiva pra esse empregado, restrita ao range do
    // relatório. Mesmo que ele não tenha datas pra analisar abaixo (sem
    // marcação e sem dia de trabalho previsto no range), o snapshot ainda
    // permite renderizar folgas/férias/etc na UI.
    if (cpf) {
      const perDateFiltrado: Record<string, ScheduleStatus> = {};
      for (const [d, st] of Object.entries(escalaEmp)) {
        if (d >= startDate && d <= endDate) perDateFiltrado[d] = st;
      }
      if (Object.keys(perDateFiltrado).length > 0) {
        escalaEfetivaPorCpf[cpf] = perDateFiltrado;
      }
    }

    const solidesId = cpf ? solidesIdPorCpf.get(cpf) : undefined;
    const metricsByDate = solidesId != null ? metricsPorSolidesId.get(solidesId) : undefined;
    if (solidesId != null) matchedSolidesIds.add(solidesId);

    // Datas a analisar: união de dias COM marcação + dias escalados como "trabalho"
    const datas = new Set<string>();
    if (metricsByDate) {
      for (const d of metricsByDate.keys()) {
        if (d >= startDate && d <= endDate) datas.add(d);
      }
    }
    for (const [d, st] of Object.entries(escalaEmp)) {
      if (d >= startDate && d <= endDate && st === "trabalho") datas.add(d);
    }
    if (datas.size === 0) continue;

    const datasOrdenadas = [...datas].sort();
    let consecutiveWorkDays = 0;
    let lastDate = "";

    for (const date of datasOrdenadas) {
      // Buraco no calendário → zera a contagem de dias consecutivos
      if (lastDate && addDays(lastDate, 1) !== date) consecutiveWorkDays = 0;
      lastDate = date;

      const metrics =
        metricsByDate?.get(date) ?? emptyDayMetrics(solidesId ?? 0, cpf, emp.nome, date);
      // Nome do Planejamento é mais confiável que o da Sólides
      metrics.employeeName = emp.nome;

      const temPunch = metrics.blocks.length > 0;
      consecutiveWorkDays = temPunch ? consecutiveWorkDays + 1 : 0;

      // Interjornada: saída do dia anterior — só conta se o dia anterior teve punch
      const prevMetrics = metricsByDate?.get(addDays(date, -1));
      const prevDayLastOut = prevMetrics?.lastOut ?? null;

      const horarioPrevisto = horariosPrevistos?.[emp.id]?.[date];
      const ctx: DayContext = {
        metrics,
        escalaStatus: escalaEmp[date] ?? null,
        prevDayLastOut,
        consecutiveWorkDays,
        ...(horarioPrevisto ? { horarioPrevisto } : {}),
      };
      exceptions.push(...runAllRules(ctx));
      diasAnalisados += 1;
      if (cpf) {
        const arr = diasAnalisadosPorCpf[cpf] || [];
        arr.push(date);
        diasAnalisadosPorCpf[cpf] = arr;
      }
    }
  }

  // ── 2) Marcações da Sólides sem empregado correspondente no Planejamento ──
  const unmatched: UnmatchedEntry[] = [];
  for (const [sid, info] of infoPorSolidesId) {
    if (matchedSolidesIds.has(sid)) continue;
    const byDate = metricsPorSolidesId.get(sid);
    let dias = 0;
    if (byDate) {
      for (const d of byDate.keys()) {
        if (d >= startDate && d <= endDate) dias += 1;
      }
    }
    if (dias > 0) unmatched.push({ cpf: info.cpf, nome: info.nome, dias });
  }
  unmatched.sort((a, b) => a.nome.localeCompare(b.nome));

  // ── Ordena exceções por colaborador → data → regra ──
  exceptions.sort(
    (a, b) =>
      a.employeeName.localeCompare(b.employeeName) ||
      a.date.localeCompare(b.date) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  return { exceptions, unmatched, diasAnalisados, diasAnalisadosPorCpf, escalaEfetivaPorCpf };
}
