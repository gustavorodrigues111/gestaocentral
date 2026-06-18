// ════════════════════════════════════════════════════════════════════════════
//  Análise de Ponto — motor determinístico (port de inconsistencias.py).
//
//  Foco em jornada FLEXÍVEL: usa carga diária prevista × trabalhada e SALDO DO
//  PERÍODO (banco de horas), NÃO horário fixo de entrada/saída. Função pura,
//  sem I/O — recebe marcações + colaboradores + escalas e devolve ocorrências
//  classificadas em duas categorias de AÇÃO: CORRIGIR (erro de batida pra
//  fechar a folha) e AVALIAR (gestão/comportamento).
//
//  Referência: ESPEC_modulo_ponto_planejamento.md §5 + solides/inconsistencias.py
// ════════════════════════════════════════════════════════════════════════════

const TZ = "America/Sao_Paulo";

// ─── Tipos de entrada (formato cru da API Sólides, §3 da spec) ──────────────
export type PontoMarcacao = {
  id?: number;
  date?: string;                  // YYYY-MM-DD (data local já pronta)
  dateIn?: number | null;         // epoch ms — entrada
  dateOut?: number | null;        // epoch ms — saída (null = em aberto)
  employeeId?: number;
  employee?: { id?: number; name?: string };
  employeeName?: string;
  workScheduleId?: number;
  excluded?: boolean;             // ignorar
  allowance?: boolean;            // é ajuste (férias/abono), não trabalho
  adjustmentReason?: unknown;
  adjustmentReasonRecord?: unknown;
  status?: string;
};

export type PontoColaborador = {
  id?: number;
  name?: string;
  cpf?: string;                   // pra cruzar com o empregado do app (área)
  // Escala atual do cadastro (campo real da Sólides). `workSchedule` fica como
  // fallback legado.
  currentWorkSchedule?: { id?: number; startDate?: number; inactive?: boolean };
  workSchedule?: number;
  doubleBindEmployee?: boolean;   // indicador de ciclo/vínculo duplo (escala cíclica)
  admissionDate?: number;
  effectiveDate?: number;
  fired?: boolean;
  resignationDate?: number;       // data de desligamento (campo real)
  firedDate?: number;             // fallback legado
};

// Id da escala atual do empregado (cadastro), com fallbacks.
function empSchedId(emp: PontoColaborador): number | undefined {
  return emp.currentWorkSchedule?.id ?? emp.workSchedule;
}

export type PontoEscalaTurno = {
  day?: number;                   // 1=Domingo … 7=Sábado
  startShift1?: number; endShift1?: number;   // ms desde a meia-noite
  startShift2?: number; endShift2?: number;
};
export type PontoEscala = {
  id?: number;
  name?: string;
  standard?: boolean;
  workScheduleTimetableList?: PontoEscalaTurno[];
};

// ─── Tipos de saída ─────────────────────────────────────────────────────────
export type TipoOcorrencia =
  | "PONTO_EM_ABERTO" | "SOBREPOSICAO" | "BATIDA_DUPLA" | "TURNO_LONGO"
  | "SEM_INTERVALO" | "DIA_FOLGA_TRABALHADO" | "CONFLITO_AJUSTE"
  | "FALTA" | "DEFICIT_PERIODO" | "EXCESSO_PERIODO";
export type Categoria = "CORRIGIR" | "AVALIAR";
export type Severidade = "alta" | "media" | "baixa";

export type Ocorrencia = {
  employeeId: number;
  colaborador: string;
  data: string;                   // YYYY-MM-DD (ou "início a fim" no saldo de período)
  diaSemana: string;
  tipo: TipoOcorrencia;
  severidade: Severidade;
  categoria: Categoria;
  detalhe: string;
  marcacoes: string[];
};
export type ResultadoAnalise = {
  periodo: [string, string];
  total: number;
  porCategoria: Record<Categoria, number>;
  porTipo: Record<string, number>;
  porColaborador: Record<string, number>;
  ocorrencias: Ocorrencia[];
};

export type ParamsAnalise = {
  blocoCurtoMin?: number;         // bloco fechado < isso = batida dupla (default 15)
  turnoLongoH?: number;           // bloco fechado > isso = esqueceu saída (default 12)
  jornadaIntervaloH?: number;     // acima disso exige pausa (default 6)
  saldoPeriodoMin?: number;       // saldo do período (min) p/ déficit/excesso (default 60)
};
const DEFAULTS: Required<ParamsAnalise> = {
  blocoCurtoMin: 15, turnoLongoH: 12, jornadaIntervaloH: 6, saldoPeriodoMin: 60,
};

export const SEVERIDADE: Record<TipoOcorrencia, Severidade> = {
  FALTA: "alta", PONTO_EM_ABERTO: "alta", SOBREPOSICAO: "alta",
  SEM_INTERVALO: "media", TURNO_LONGO: "media", CONFLITO_AJUSTE: "media",
  DEFICIT_PERIODO: "media", EXCESSO_PERIODO: "baixa",
  BATIDA_DUPLA: "baixa", DIA_FOLGA_TRABALHADO: "baixa",
};
export const CATEGORIA: Record<TipoOcorrencia, Categoria> = {
  PONTO_EM_ABERTO: "CORRIGIR", BATIDA_DUPLA: "CORRIGIR", SOBREPOSICAO: "CORRIGIR",
  TURNO_LONGO: "CORRIGIR", CONFLITO_AJUSTE: "CORRIGIR",
  FALTA: "AVALIAR", SEM_INTERVALO: "AVALIAR", DIA_FOLGA_TRABALHADO: "AVALIAR",
  DEFICIT_PERIODO: "AVALIAR", EXCESSO_PERIODO: "AVALIAR",
};
export const CAT_LABEL: Record<Categoria, string> = {
  CORRIGIR: "Inconsistências a Corrigir",
  AVALIAR: "Apontamentos a Avaliar",
};
export const ROTULOS: Record<TipoOcorrencia, string> = {
  FALTA: "Falta (dia previsto sem batida)",
  PONTO_EM_ABERTO: "Ponto em aberto (sem saída)",
  BATIDA_DUPLA: "Batida dupla (bloco curto)",
  SEM_INTERVALO: "Sem intervalo (jornada longa)",
  TURNO_LONGO: "Turno longo (provável esqueceu saída)",
  SOBREPOSICAO: "Marcações sobrepostas",
  DIA_FOLGA_TRABALHADO: "Trabalho em dia de folga",
  CONFLITO_AJUSTE: "Conflito de ajuste (ajuste + batida)",
  DEFICIT_PERIODO: "Déficit de horas no período",
  EXCESSO_PERIODO: "Excesso de horas no período",
};
const DIAS_PT: Record<number, string> = {
  1: "domingo", 2: "segunda", 3: "terça", 4: "quarta",
  5: "quinta", 6: "sexta", 7: "sábado",
};
// Causa-raiz no dia → suprime apontamentos derivados (relatório mais limpo).
const SUPPRESS: Partial<Record<TipoOcorrencia, TipoOcorrencia[]>> = {
  PONTO_EM_ABERTO: ["SEM_INTERVALO"],
  TURNO_LONGO: ["SEM_INTERVALO"],
};

// ─── Helpers de data/hora ────────────────────────────────────────────────────
const hhmmFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});
function millisToHHMM(ms: number): string {
  return hhmmFmt.format(new Date(ms));
}
function secondsToHHMM(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "+";
  const total = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const semSinal = (s: string) => s.replace(/^\+/, "");
// Solides: 1=Domingo … 7=Sábado. JS getDay(): 0=Dom … 6=Sáb → +1.
function weekdaySolides(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() + 1;
}
// Domingo da semana de um YYYY-MM-DD (a rotação de escala cíclica da Sólides
// troca sempre aos domingos). Usado pra inferir a escala da semana.
function domingoDaSemana(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay()); // volta pro domingo (getDay 0=Dom)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
// Meia-noite (SP, UTC-3 fixo desde 2019) de um YYYY-MM-DD em epoch ms.
function midnightMsSP(day: string): number {
  return new Date(`${day}T00:00:00-03:00`).getTime();
}
const isoCA = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
function hojeSP(): string {
  return isoCA.format(new Date()); // YYYY-MM-DD
}
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cur = new Date(ys, ms - 1, ds);
  const fim = new Date(ye, me - 1, de);
  while (cur <= fim) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ─── Helpers de leitura das marcações ────────────────────────────────────────
function empId(p: PontoMarcacao): number | undefined {
  return p.employeeId ?? p.employee?.id;
}
function empName(p: PontoMarcacao, empById: Map<number, PontoColaborador>): string {
  const n = p.employeeName ?? p.employee?.name;
  if (n) return n;
  const id = empId(p);
  return (id != null ? empById.get(id)?.name : undefined) ?? `ID ${id}`;
}
function schedId(p: PontoMarcacao, empById: Map<number, PontoColaborador>): number | undefined {
  if (p.workScheduleId) return p.workScheduleId;
  const id = empId(p);
  const emp = id != null ? empById.get(id) : undefined;
  return emp ? empSchedId(emp) : undefined;
}
function isAdjustment(p: PontoMarcacao): boolean {
  return !!(p.adjustmentReason || p.adjustmentReasonRecord || p.allowance);
}
function adjDesc(p: PontoMarcacao): string {
  const ar = (p.adjustmentReason || p.adjustmentReasonRecord) as
    | { description?: string; adjustmentReasonDTO?: { description?: string } }
    | string | undefined;
  if (ar && typeof ar === "object") {
    return ar.description || ar.adjustmentReasonDTO?.description || "ajuste";
  }
  return typeof ar === "string" && ar ? ar : "ajuste";
}
function expectedSeconds(sched: PontoEscala | undefined, wd: number): number {
  let total = 0;
  for (const tt of sched?.workScheduleTimetableList || []) {
    if (tt.day !== wd) continue;
    for (const [a, b] of [["startShift1", "endShift1"], ["startShift2", "endShift2"]] as const) {
      const s = tt[a]; const e = tt[b];
      if (typeof s === "number" && typeof e === "number") total += (e - s) / 1000;
    }
  }
  return total;
}
function empAdmission(emp: PontoColaborador): number | null {
  for (const v of [emp.admissionDate, emp.effectiveDate]) {
    if (typeof v === "number") return v;
  }
  return null;
}
function empTermination(emp: PontoColaborador): number | null {
  if (!emp.fired) return null;
  if (typeof emp.resignationDate === "number") return emp.resignationDate;
  if (typeof emp.firedDate === "number") return emp.firedDate;
  return null;
}

// ─── Núcleo ──────────────────────────────────────────────────────────────────
export function analisarPonto(
  punches: PontoMarcacao[],
  employees: PontoColaborador[],
  schedules: PontoEscala[],
  startDate: string,
  endDate: string,
  params?: ParamsAnalise,
  today?: string,
): ResultadoAnalise {
  const p = { ...DEFAULTS, ...(params || {}) };
  const empById = new Map<number, PontoColaborador>();
  for (const e of employees || []) if (e.id != null) empById.set(e.id, e);
  const schedById = new Map<number, PontoEscala>();
  for (const s of schedules || []) if (s.id != null) schedById.set(s.id, s);
  const hoje = today || hojeSP();

  // Agrupa por (emp, dia). Ignora só `excluded` (ajustes ficam no grupo).
  const grouped = new Map<string, PontoMarcacao[]>();
  for (const rec of punches) {
    if (rec.excluded) continue;
    const emp = empId(rec);
    const day = rec.date;
    if (emp == null || !day) continue;
    const key = `${emp}|${day}`;
    const arr = grouped.get(key) || [];
    arr.push(rec);
    grouped.set(key, arr);
  }

  const occ: Ocorrencia[] = [];
  const saldo = new Map<number, { bal: number; dias: number; w: number; e: number; name: string }>();
  // Escala usada por (emp, semana-domingo), inferida das batidas — pra FALTA
  // respeitar escala cíclica (empregado que alterna escala por semana).
  const weekSched = new Map<string, number>();

  const add = (emp: number, name: string, day: string, tipo: TipoOcorrencia, detalhe: string, marcacoes?: string[]) => {
    let diaSem = "período";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) diaSem = DIAS_PT[weekdaySolides(day)] || "período";
    occ.push({
      employeeId: emp, colaborador: name, data: day, diaSemana: diaSem,
      tipo, severidade: SEVERIDADE[tipo], categoria: CATEGORIA[tipo],
      detalhe, marcacoes: marcacoes || [],
    });
  };

  // 1) dias COM registros
  for (const [key, recsRaw] of grouped) {
    const emp = Number(key.split("|")[0]);
    const day = key.slice(key.indexOf("|") + 1);
    const recs = [...recsRaw].sort((a, b) => (a.dateIn || 0) - (b.dateIn || 0));
    const name = empName(recs[0], empById);
    const wd = weekdaySolides(day);
    const wsId = schedId(recs[0], empById);
    if (wsId) weekSched.set(`${emp}|${domingoDaSemana(day)}`, wsId); // p/ inferir escala cíclica na FALTA
    const sched = schedById.get(wsId ?? -1);
    const expected = sched ? expectedSeconds(sched, wd) : 0;
    const passado = day < hoje;

    const blocks: Array<[number, number | null]> = [];
    const marks: string[] = [];
    const adjDescs: string[] = [];
    for (const r of recs) {
      if (isAdjustment(r)) adjDescs.push(adjDesc(r));
      const di = r.dateIn; const doo = r.dateOut ?? null;
      if (!di) continue;
      blocks.push([di, doo]);
      marks.push(doo ? `${millisToHHMM(di)}-${millisToHHMM(doo)}` : `${millisToHHMM(di)}-?`);
    }

    const hasPunch = blocks.length > 0;
    let worked = 0;
    for (const [i, o] of blocks) if (o) worked += (o - i) / 1000;

    // estrutura
    for (const [, o] of blocks) {
      if (o === null && passado) { add(emp, name, day, "PONTO_EM_ABERTO", "Entrada sem saída registrada.", marks); break; }
    }
    let sobrep = false;
    for (const [i, o] of blocks) if (o && o < i) { add(emp, name, day, "SOBREPOSICAO", "Saída antes da entrada.", marks); sobrep = true; break; }
    if (!sobrep) {
      for (let k = 1; k < blocks.length; k++) {
        const prevOut = blocks[k - 1][1];
        const curIn = blocks[k][0];
        if (prevOut && curIn < prevOut) { add(emp, name, day, "SOBREPOSICAO", "Blocos de trabalho sobrepostos.", marks); break; }
      }
    }
    for (const [i, o] of blocks) {
      if (!o) continue;
      const durMin = (o - i) / 60000;
      if (durMin < p.blocoCurtoMin) add(emp, name, day, "BATIDA_DUPLA", `Bloco de apenas ${Math.floor(durMin)} min (possível batida repetida).`, marks);
      if (durMin > p.turnoLongoH * 60) add(emp, name, day, "TURNO_LONGO", `Bloco de ${semSinal(secondsToHHMM((o - i) / 1000))} (acima de ${p.turnoLongoH}h, provável esquecimento de saída).`, marks);
    }

    // sem intervalo (jornada longa sem nenhuma pausa)
    const closed = blocks.filter(([, o]) => o) as Array<[number, number]>;
    const hasTurnoLongo = closed.some(([i, o]) => o - i > p.turnoLongoH * 3600000);
    if (worked > p.jornadaIntervaloH * 3600 && closed.length) {
      let gap = 0;
      for (let k = 1; k < closed.length; k++) gap += (closed[k][0] - closed[k - 1][1]) / 1000;
      if (closed.length === 1 || gap <= 0) add(emp, name, day, "SEM_INTERVALO", `Jornada de ${semSinal(secondsToHHMM(worked))} sem intervalo registrado.`, marks);
    }

    // trabalho em dia de folga
    if (expected === 0 && hasPunch) add(emp, name, day, "DIA_FOLGA_TRABALHADO", `Bateu ponto (${semSinal(secondsToHHMM(worked))}) em dia sem previsão na escala.`, marks);

    // conflito de ajuste
    const hasOpen = blocks.some(([, o]) => o === null) && passado;
    if (adjDescs.length && hasPunch) add(emp, name, day, "CONFLITO_AJUSTE", `Dia com ${[...new Set(adjDescs)].join(", ")} lançado, mas tem batida de ponto.`, marks);

    // saldo do período (só dias confiáveis)
    if (hasPunch && expected > 0 && !hasOpen && !adjDescs.length && !hasTurnoLongo) {
      const s = saldo.get(emp) || { bal: 0, dias: 0, w: 0, e: 0, name };
      s.bal += worked - expected; s.dias += 1; s.w += worked; s.e += expected;
      saldo.set(emp, s);
    }
  }

  // 2) dias SEM registros → falta em dia previsto
  for (const [empIdNum, emp] of empById) {
    if (emp.fired && !empTermination(emp)) continue;
    // Escala padrão do empregado (fallback). Em cíclicos, a escala real da
    // semana é inferida das batidas (weekSched); se a semana não tem batida,
    // cai no padrão.
    const padraoId = empSchedId(emp);
    const schedPadrao = padraoId != null ? schedById.get(padraoId) : undefined;
    const name = emp.name || `ID ${empIdNum}`;
    const adm = empAdmission(emp);
    const term = empTermination(emp);
    for (const day of dateRange(startDate, endDate)) {
      if (day >= hoje) continue;
      const ms0 = midnightMsSP(day);
      if (adm && ms0 < adm) continue;
      if (term && ms0 > term) continue;
      if (grouped.has(`${empIdNum}|${day}`)) continue; // tem batida ou ajuste
      const schedSemana = weekSched.get(`${empIdNum}|${domingoDaSemana(day)}`);
      const sched = (schedSemana != null ? schedById.get(schedSemana) : undefined) || schedPadrao;
      if (!sched) continue;
      if (expectedSeconds(sched, weekdaySolides(day)) > 0) {
        add(empIdNum, name, day, "FALTA", "Dia previsto de trabalho sem nenhuma batida nem ajuste.");
      }
    }
  }

  // 3) saldo do período por colaborador (déficit/excesso)
  const limite = p.saldoPeriodoMin * 60;
  const periodoTxt = `${startDate} a ${endDate}`;
  for (const [empIdNum, s] of saldo) {
    if (s.bal <= -limite || s.bal >= limite) {
      const tipo: TipoOcorrencia = s.bal < 0 ? "DEFICIT_PERIODO" : "EXCESSO_PERIODO";
      const sinal = s.bal < 0 ? "negativo" : "positivo";
      add(empIdNum, s.name, periodoTxt, tipo,
        `Saldo ${sinal} de ${secondsToHHMM(s.bal)} no período: trabalhou ${semSinal(secondsToHHMM(s.w))} de ${semSinal(secondsToHHMM(s.e))} previstos em ${s.dias} dia(s).`);
    }
  }

  // supressão de derivados (1 causa-raiz por dia)
  const byDay = new Map<string, Ocorrencia[]>();
  for (const o of occ) {
    const k = `${o.employeeId}|${o.data}`;
    const arr = byDay.get(k) || [];
    arr.push(o);
    byDay.set(k, arr);
  }
  let final: Ocorrencia[] = [];
  for (const items of byDay.values()) {
    const tipos = new Set(items.map((i) => i.tipo));
    const suprimir = new Set<TipoOcorrencia>();
    for (const raiz of Object.keys(SUPPRESS) as TipoOcorrencia[]) {
      if (tipos.has(raiz)) for (const der of SUPPRESS[raiz]!) suprimir.add(der);
    }
    final.push(...items.filter((i) => !suprimir.has(i.tipo)));
  }
  final.sort((a, b) => a.colaborador.localeCompare(b.colaborador) || a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo));

  // resumo
  const porTipo: Record<string, number> = {};
  const porColab: Record<string, number> = {};
  const porCategoria: Record<Categoria, number> = { CORRIGIR: 0, AVALIAR: 0 };
  for (const o of final) {
    porTipo[o.tipo] = (porTipo[o.tipo] || 0) + 1;
    porColab[o.colaborador] = (porColab[o.colaborador] || 0) + 1;
    porCategoria[o.categoria] += 1;
  }
  return {
    periodo: [startDate, endDate],
    total: final.length,
    porCategoria, porTipo, porColaborador: porColab,
    ocorrencias: final,
  };
}
