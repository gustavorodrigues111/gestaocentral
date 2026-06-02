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
import { RULES_META, formatarBatidas, runAllRules } from "./rules";

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
  // Batidas formatadas (ex: "E1 09:26 → S1 11:20 · E2 12:19 → S2 16:41") por
  // CPF (só dígitos) → data. Inclui TODOS os dias com punches, mesmo os sem
  // inconformidade — permite a UI mostrar as horas nos dias "Trabalhou normal".
  batidasPorCpfData: Record<string, Record<string, string>>;
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
  const batidasPorCpfData: Record<string, Record<string, string>> = {};
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
    // Detecta se o empregado tem escala alternada (semana A/B). A Sólides
    // não suporta nativamente — vai sempre cadastrar uma das semanas.
    // Pra esses empregados, geramos um apontamento extra "Sólides ≠ Planejamento"
    // em cada dia onde a expectativa diverge.
    const empIsAlternating = !!emp.workSchedules?.some((w) => w.type === "alternating");

    // Período de vínculo do empregado. Datas FORA desse range não geram
    // inconformidade — empregado ainda não tinha sido admitido (ou já foi
    // demitido). Evita "falta sem ajuste" pros dias anteriores à admissão.
    // demitidoEm é o PRIMEIRO dia FORA — então comparar com >= (não >).
    const admissao = emp.admissaoAtual || null;
    const demissao = emp.demitidoEm || null;
    function dentroDoVinculo(date: string): boolean {
      if (admissao && date < admissao) return false;
      if (demissao && date >= demissao) return false;
      return true;
    }

    // Snapshot da escala efetiva pra esse empregado, restrita ao range do
    // relatório. Mesmo que ele não tenha datas pra analisar abaixo (sem
    // marcação e sem dia de trabalho previsto no range), o snapshot ainda
    // permite renderizar folgas/férias/etc na UI.
    if (cpf) {
      const perDateFiltrado: Record<string, ScheduleStatus> = {};
      for (const [d, st] of Object.entries(escalaEmp)) {
        if (d >= startDate && d <= endDate && dentroDoVinculo(d)) perDateFiltrado[d] = st;
      }
      if (Object.keys(perDateFiltrado).length > 0) {
        escalaEfetivaPorCpf[cpf] = perDateFiltrado;
      }
    }

    const solidesId = cpf ? solidesIdPorCpf.get(cpf) : undefined;
    const metricsByDate = solidesId != null ? metricsPorSolidesId.get(solidesId) : undefined;
    if (solidesId != null) matchedSolidesIds.add(solidesId);

    // Datas a analisar: união de dias COM marcação + dias escalados como "trabalho"
    // FILTRADAS pelo período de vínculo (admissão..demissão).
    const datas = new Set<string>();
    if (metricsByDate) {
      for (const d of metricsByDate.keys()) {
        if (d >= startDate && d <= endDate && dentroDoVinculo(d)) datas.add(d);
      }
    }
    for (const [d, st] of Object.entries(escalaEmp)) {
      if (d >= startDate && d <= endDate && st === "trabalho" && dentroDoVinculo(d)) datas.add(d);
    }
    // Pra empregados alternating: também analisar dias onde a Sólides
    // espera trabalho (mesmo que plan = folga). Senão o dia de "folga
    // semana B" que a Sólides cobra como falta nunca seria visitado.
    if (empIsAlternating && cpf) {
      const horariosEmp = horariosPrevistos?.[emp.id] || {};
      for (const d of Object.keys(horariosEmp)) {
        if (d >= startDate && d <= endDate && dentroDoVinculo(d)) datas.add(d);
      }
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
      const excecoesDoDia = runAllRules(ctx);
      // ── Pós-processamento por (cpf, date): unifica entradaProvavelFaltante
      // + pontoAberto em batidasImpares quando o nº de batidas é ímpar.
      // São sintomas da mesma causa raiz (faltou bater 1) — não devem virar 2
      // cards/mensagens separadas pro líder.
      const excecoesFinais = unificarBatidasImpares(excecoesDoDia, ctx);

      // ── Divergência Sólides x Planejamento (escala alternada) ──
      // Pra empregado alternating, se a expectativa Sólides ≠ Planejamento
      // naquele dia, emite um apontamento extra. Os outros apontamentos
      // (atraso, batida faltando) continuam normalmente — esse é um apontamento
      // PARALELO, pra alertar que a Sólides vai cobrar errado naquele dia.
      if (empIsAlternating && cpf) {
        const planTrabalho = (escalaEmp[date] || "") === "trabalho";
        const solTrabalho = !!horariosPrevistos?.[emp.id]?.[date];
        if (planTrabalho !== solTrabalho) {
          const [, , dia] = date.split("-");
          void dia;
          const dow = new Date(date + "T12:00:00").getDay();
          const diaSemana = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"][dow];
          const dataBr = (() => {
            const [y, m, d] = date.split("-");
            return `${d}/${m}/${y}`;
          })();
          const description = planTrabalho
            ? `Trabalho previsto pelo Planejamento (escala alternada), mas Sólides cadastrada como folga em ${diaSemana}. → Lançar como dia útil regular na Sólides.`
            : `Folga pelo Planejamento (escala alternada), mas Sólides cadastrada como dia útil em ${diaSemana}. → Lançar folga programada na Sólides.`;
          const detail = planTrabalho
            ? `Plan=trabalho · Sólides=folga · ${dataBr}`
            : `Plan=folga · Sólides=trabalho · ${dataBr}`;
          const batidasFmt =
            ctx.metrics.blocks && ctx.metrics.blocks.length > 0
              ? formatarBatidas(ctx.metrics.blocks)
              : undefined;
          excecoesFinais.push({
            ruleId: "divergenciaSolidesEscala",
            severity: "aviso",
            date,
            employeeId: ctx.metrics.employeeId,
            cpf,
            employeeName: emp.nome,
            description,
            detail,
            ...(batidasFmt ? { batidas: batidasFmt } : {}),
          });
        }
      }

      exceptions.push(...excecoesFinais);
      diasAnalisados += 1;
      if (cpf) {
        const arr = diasAnalisadosPorCpf[cpf] || [];
        arr.push(date);
        diasAnalisadosPorCpf[cpf] = arr;
        if (metrics.blocks.length > 0) {
          const batidasFmt = formatarBatidas(metrics.blocks);
          if (batidasFmt) {
            if (!batidasPorCpfData[cpf]) batidasPorCpfData[cpf] = {};
            batidasPorCpfData[cpf][date] = batidasFmt;
          }
        }
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

  return { exceptions, unmatched, diasAnalisados, diasAnalisadosPorCpf, escalaEfetivaPorCpf, batidasPorCpfData };
}

// ────────────────────────────────────────────────────────────────────────────
//  Pós-processamento: unificação de batidas ímpares
// ────────────────────────────────────────────────────────────────────────────
//
// Quando o dia tem nº ímpar de batidas (Sólides interpreta como E1→S1→E2 sem
// saída, ou E1 sozinho, etc), o motor de regras dispara DUAS regras como
// problemas separados: entradaProvavelFaltante (1ª batida tarde demais) e/ou
// pontoAberto (último bloco sem saída). Mas são sintomas da mesma causa raiz
// — falta UMA batida. Aqui substituímos as duas pela regra unificada
// `batidasImpares`, com uma única descrição contendo todas as batidas e a
// hipótese mais provável de qual ponta faltou.

// epoch ms (UTC) → "HH:MM" em BRT (UTC-3, sem horário de verão).
function fmtHoraBrt(ms: number | undefined | null): string {
  if (typeof ms !== "number" || ms <= 0) return "—";
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const brtMin = (utcMin - 180 + 1440) % 1440;
  const h = Math.floor(brtMin / 60);
  const m = brtMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// minutos → "8h30" (com sinal pra negativos)
function fmtHm(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

// "HH:MM" → minutos desde 00:00. null se inválido.
function parseHHMM(s: string | undefined | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Extrai todas as batidas individuais (entrada e saída) dos blocos do dia,
// em ordem cronológica. Bloco aberto contribui só com 1 batida (a entrada).
function batidasIndividuais(blocks: SolidesPunch[]): number[] {
  const out: number[] = [];
  for (const b of blocks) {
    if (typeof b.dateIn === "number" && b.dateIn > 0) out.push(b.dateIn);
    if (typeof b.dateOut === "number" && b.dateOut > b.dateIn) out.push(b.dateOut);
  }
  return out.sort((a, b) => a - b);
}

function unificarBatidasImpares(
  excecoesDoDia: ExceptionRecord[],
  ctx: DayContext,
): ExceptionRecord[] {
  // Sem batidas → nada pra unificar (regra trata só dias com marcação ímpar)
  const batidas = batidasIndividuais(ctx.metrics.blocks);
  if (batidas.length === 0) return excecoesDoDia;
  if (batidas.length % 2 === 0) return excecoesDoDia;

  // Só substitui se as regras "componentes" tiverem disparado. Se o nº é
  // ímpar mas nenhuma das duas regras disparou, mantém comportamento atual
  // (improvável, mas defensivo).
  const temPontoAberto = excecoesDoDia.some((e) => e.ruleId === "pontoAberto");
  const temEntradaProvFalt = excecoesDoDia.some(
    (e) => e.ruleId === "entradaProvavelFaltante",
  );
  if (!temPontoAberto && !temEntradaProvFalt) return excecoesDoDia;

  // Remove os apontamentos que viraram sintomas da regra unificada
  const restantes = excecoesDoDia.filter(
    (e) => e.ruleId !== "pontoAberto" && e.ruleId !== "entradaProvavelFaltante",
  );

  // Monta descrição e hipóteses
  const listaHoras = batidas.map((ms) => fmtHoraBrt(ms)).join(" · ");
  const esperado = batidas.length + 1; // próximo par
  const partes: string[] = [];
  partes.push(
    `${batidas.length} batidas registradas (esperado ${esperado}): ${listaHoras}.`,
  );

  const previsto = ctx.horarioPrevisto;
  const previstoInMin = parseHHMM(previsto?.in);
  const primeiraMs = batidas[0];
  const primeiraBrtMin = (() => {
    if (typeof primeiraMs !== "number") return null;
    const d = new Date(primeiraMs);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    return (utcMin - 180 + 1440) % 1440;
  })();

  // Hipótese A: 1ª batida MUITO depois do previsto (>60min) → faltou entrada
  // inicial. Hipótese B: último bloco aberto (hasOpenPunch) → faltou saída
  // final. Em muitos casos, ambas se aplicam — o líder confirma com o
  // empregado qual ponta faltou.
  const hipoteseA =
    previstoInMin != null &&
    primeiraBrtMin != null &&
    primeiraBrtMin - previstoInMin > 60;
  const hipoteseB = ctx.metrics.hasOpenPunch;

  if (previsto && hipoteseA && hipoteseB) {
    const diff = (primeiraBrtMin as number) - previstoInMin;
    partes.push(
      `Provavelmente faltou a entrada inicial (1ª batida ${fmtHm(diff)} depois do previsto ${previsto.in}) ou a saída final (último bloco não fechou).`,
    );
  } else if (previsto && hipoteseA) {
    const diff = (primeiraBrtMin as number) - previstoInMin;
    partes.push(
      `Provavelmente faltou a entrada inicial (1ª batida ${fmtHm(diff)} depois do previsto ${previsto.in}).`,
    );
  } else if (hipoteseB) {
    partes.push("Provavelmente faltou a saída final (último bloco não fechou).");
  } else if (!previsto) {
    // Sem horário previsto: sem heurística — só lista as batidas
    partes.push("Confirme com o empregado qual batida faltou.");
  } else {
    // Tem previsto mas nem A nem B → genérico
    partes.push("Confirme com o empregado qual batida faltou.");
  }

  const meta = RULES_META.batidasImpares;
  const batidasFmt =
    ctx.metrics.blocks && ctx.metrics.blocks.length > 0
      ? formatarBatidas(ctx.metrics.blocks)
      : undefined;
  const novoApontamento: ExceptionRecord = {
    ruleId: "batidasImpares",
    severity: meta.severity,
    date: ctx.metrics.date,
    employeeId: ctx.metrics.employeeId,
    cpf: ctx.metrics.cpf,
    employeeName: ctx.metrics.employeeName,
    description: partes.join(" "),
    detail: `🕐 ${listaHoras}`,
    ...(batidasFmt ? { batidas: batidasFmt } : {}),
  };
  restantes.push(novoApontamento);
  return restantes;
}
