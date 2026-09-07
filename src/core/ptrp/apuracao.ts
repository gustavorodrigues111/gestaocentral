// ════════════════════════════════════════════════════════════════════════════
//  PTRP — MOTOR DE APURAÇÃO (função pura, determinística).
//
//  batidas(dia) + ajustes(dia) + Escala(turno|folga) + ParametrosCCT(empresa,data)
//    → jornada apurada do dia: normais, extras por faixa (%), noturno, atraso,
//      falta, folga, fora-de-escala, intervalo, e (no nível do mês) interjornada.
//
//  Regra central: sem batida + escala=folga → FOLGA; sem batida + escala=turno →
//  FALTA (exceção); trabalho em dia previsto como folga → FORA DE ESCALA (exceção).
//
//  NADA de regra fixa: todo percentual/limite vem do ParametrosCCT resolvido por
//  empresa + data. Recalculável: mesmas entradas → mesmo resultado.
//  v1 — a validar em paralelo ao Sólides (Fase 1) antes de virar oficial.
// ════════════════════════════════════════════════════════════════════════════
import type { PtrpTurno, ParametrosCCT } from "./tipos";

const DIA_MS = 86_400_000;
const BRT_OFFSET_MS = 3 * 3_600_000;   // America/Sao_Paulo = UTC-3 (sem DST)

// Minuto do dia (0..1439) em horário BRT de um epoch-ms.
export function minutoDoDiaBRT(ms: number): number {
  return Math.floor((((ms - BRT_OFFSET_MS) % DIA_MS) + DIA_MS) % DIA_MS / 60_000);
}
// "HH:MM" → minutos do dia.
export function hhmmToMin(s: string): number {
  const [h, m] = (s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export type BatidaBloco = { dateIn: number; dateOut: number | null; excluded?: boolean; incluidaTratamento?: boolean };
export type AjusteDia =
  | { tipo: "inclusao"; in: number; out: number }                    // par incluído (esquecimento)
  | { tipo: "desconsideracao"; blocoIndex: number }                  // despreza uma batida
  | { tipo: "abono" | "atestado" | "folga" | "ferias" | "afastamento"; minutos?: number };  // dia inteiro/parcial

export type ApuracaoDia = {
  data: string;
  minutosTrabalhados: number;
  minutosPrevistos: number;
  minutosExtras: number;
  extrasPorFaixa: { perc: number; minutos: number }[];   // extras separados por percentual da CCT
  noturnoMin: number;
  noturnoEquivalenteMin: number;                          // com hora reduzida aplicada
  atrasoMin: number;
  intervaloMin: number;
  intervaloOk: boolean;
  falta: boolean;
  folga: boolean;
  foraDeEscala: boolean;
  abonadoMin: number;
  excecoes: string[];      // códigos p/ o painel (sem_batida, falta, fora_escala, batida_impar, intervalo_curto, jornada_longa…)
};

// Sobreposição (min) de um intervalo [ini,fim] de minutos-do-dia com a faixa
// noturna da CCT (pode cruzar meia-noite, ex.: 22:00→05:00).
function minNoturnos(iniMin: number, fimMin: number, cct: ParametrosCCT): number {
  const ni = hhmmToMin(cct.adicionalNoturno.inicio);
  const nf = hhmmToMin(cct.adicionalNoturno.fim);
  // Normaliza a faixa noturna em [ni, nf(+1440 se cruza meia-noite)].
  const faixas = nf > ni ? [[ni, nf]] : [[ni, 1440], [0, nf]];
  let total = 0;
  for (const [a, b] of faixas) total += Math.max(0, Math.min(fimMin, b) - Math.max(iniMin, a));
  return total;
}

// Apura UM dia de um colaborador.
export function apurarDia(params: {
  data: string;                        // YYYY-MM-DD
  blocos: BatidaBloco[];               // batidas do dia (raw, ordenadas)
  turno: PtrpTurno | null;             // turno previsto (null = escala prevê folga)
  cct: ParametrosCCT;
  ajustes?: AjusteDia[];
  ehDomingo?: boolean;
  ehFeriado?: boolean;
}): ApuracaoDia {
  const { data, cct } = params;
  const ajustes = params.ajustes || [];
  const excecoes: string[] = [];

  // ── Monta os pares [in,out] efetivos: batidas não-desconsideradas + inclusões.
  const desconsiderados = new Set(ajustes.filter(a => a.tipo === "desconsideracao").map(a => (a as { blocoIndex: number }).blocoIndex));
  const pares: { in: number; out: number }[] = [];
  params.blocos.forEach((b, i) => {
    if (b.excluded || desconsiderados.has(i)) return;
    if (typeof b.dateIn === "number" && typeof b.dateOut === "number") {
      pares.push({ in: minutoDoDiaBRT(b.dateIn), out: minutoDoDiaBRT(b.dateOut) });
    } else if (typeof b.dateIn === "number") {
      excecoes.push("batida_impar");   // entrada sem saída (ponto aberto)
    }
  });
  for (const a of ajustes) if (a.tipo === "inclusao") pares.push({ in: a.in, out: a.out });
  pares.sort((x, y) => x.in - y.in);

  // Abonos de dia inteiro/parcial.
  const abonoDia = ajustes.find(a => ["abono", "atestado", "folga", "ferias", "afastamento"].includes(a.tipo)) as { tipo: string; minutos?: number } | undefined;

  const folgaPrevista = !params.turno;
  const trabalhou = pares.length > 0;

  // ── Regra central folga/falta ─────────────────────────────────────────────
  if (!trabalhou && !abonoDia) {
    if (folgaPrevista) return base(data, { folga: true });
    excecoes.push("sem_batida", "falta");
    return base(data, { falta: true, minutosPrevistos: previstoDoTurno(params.turno), excecoes });
  }
  if (trabalhou && folgaPrevista) excecoes.push("fora_escala");

  // ── Minutos trabalhados + intervalo (maior gap entre pares) ───────────────
  let trabalhados = 0;
  for (const p of pares) trabalhados += Math.max(0, p.out - p.in);
  let intervaloMin = 0;
  for (let i = 1; i < pares.length; i++) intervaloMin = Math.max(intervaloMin, pares[i].in - pares[i - 1].out);
  // Pré-assinalação (CCT SP cadastrada): se o turno pré-assinala e não houve
  // batida de intervalo (1 par só), assume o intervalo previsto do turno.
  if (params.turno?.preAssinalarIntervalo && pares.length === 1 && params.turno.intervaloMin) {
    intervaloMin = params.turno.intervaloMin;
    trabalhados -= params.turno.intervaloMin;
  }
  const previstos = previstoDoTurno(params.turno);

  // ── Adicional noturno (com hora reduzida) ─────────────────────────────────
  let noturnoMin = 0;
  for (const p of pares) noturnoMin += minNoturnos(p.in, p.out < p.in ? p.out + 1440 : p.out, cct);
  const fator = cct.adicionalNoturno.horaReduzidaMin ? 60 / cct.adicionalNoturno.horaReduzidaMin : 1;
  const noturnoEquivalenteMin = Math.round(noturnoMin * fator);

  // ── Atraso (entrada depois do previsto, com tolerância) ───────────────────
  let atrasoMin = 0;
  if (params.turno && pares.length) {
    const prevIn = hhmmToMin(params.turno.janelas[0]?.in || "0:0");
    const tol = params.turno.toleranciaEntradaMin ?? 5;
    atrasoMin = Math.max(0, pares[0].in - prevIn - tol);
    if (atrasoMin > 0) excecoes.push("atraso");
  }

  // ── Extras: saldo positivo sobre o previsto, separado por faixa da CCT ─────
  const abonadoMin = abonoDia?.minutos || 0;
  const saldo = Math.max(0, (trabalhados + abonadoMin) - previstos);
  const extrasPorFaixa = repartirExtras(saldo, cct, { ehDomingo: !!params.ehDomingo, ehFeriado: !!params.ehFeriado, foraEscala: trabalhou && folgaPrevista });

  // ── Validações de compliance viram exceções ──────────────────────────────
  const jornadaMax = (cct.jornadaDiariaMaxHoras || 10) * 60;
  if (trabalhados > jornadaMax) excecoes.push("jornada_longa");
  const intMin = cct.intervalo?.minMin ?? 60;
  const intervaloOk = pares.length <= 1 || intervaloMin >= (params.turno?.preAssinalarIntervalo ? 0 : intMin) || trabalhados <= 6 * 60;
  if (!intervaloOk) excecoes.push("intervalo_curto");

  return {
    data,
    minutosTrabalhados: Math.max(0, Math.round(trabalhados)),
    minutosPrevistos: previstos,
    minutosExtras: saldo,
    extrasPorFaixa,
    noturnoMin, noturnoEquivalenteMin,
    atrasoMin,
    intervaloMin, intervaloOk,
    falta: false, folga: false,
    foraDeEscala: trabalhou && folgaPrevista,
    abonadoMin,
    excecoes,
  };
}

function previstoDoTurno(t: PtrpTurno | null): number {
  if (!t) return 0;
  if (t.cargaDiariaMin) return t.cargaDiariaMin;
  let m = 0;
  for (const j of t.janelas) m += Math.max(0, hhmmToMin(j.out) - hhmmToMin(j.in));
  return Math.max(0, m - (t.intervaloMin || 0));
}

// Reparte o saldo de extras entre as faixas de percentual da CCT.
function repartirExtras(saldoMin: number, cct: ParametrosCCT, ctx: { ehDomingo: boolean; ehFeriado: boolean; foraEscala: boolean }): { perc: number; minutos: number }[] {
  if (saldoMin <= 0) return [];
  const e = cct.extras;
  // Domingo/feriado/fora-de-escala: tudo num percentual único quando a CCT define.
  if (ctx.ehFeriado && e.feriadoPerc != null) return [{ perc: e.feriadoPerc, minutos: saldoMin }];
  if (ctx.ehDomingo && e.domingoPerc != null) return [{ perc: e.domingoPerc, minutos: saldoMin }];
  // Faixas horárias (ex.: 60% até 2h/dia, 80% acima).
  if (e.faixa1AteHoras && e.faixa2Perc != null) {
    const lim = e.faixa1AteHoras * 60;
    const f1 = Math.min(saldoMin, lim);
    const f2 = Math.max(0, saldoMin - lim);
    const out = [{ perc: e.faixa1Perc, minutos: f1 }];
    if (f2 > 0) out.push({ perc: e.faixa2Perc, minutos: f2 });
    return out;
  }
  return [{ perc: e.faixa1Perc, minutos: saldoMin }];
}

function base(data: string, over: Partial<ApuracaoDia>): ApuracaoDia {
  return {
    data, minutosTrabalhados: 0, minutosPrevistos: 0, minutosExtras: 0, extrasPorFaixa: [],
    noturnoMin: 0, noturnoEquivalenteMin: 0, atrasoMin: 0, intervaloMin: 0, intervaloOk: true,
    falta: false, folga: false, foraDeEscala: false, abonadoMin: 0, excecoes: [], ...over,
  };
}

// Interjornada: percorre os dias em ordem e marca quando o descanso entre a
// última saída de um dia e a primeira entrada do dia seguinte < mínimo da CCT.
export function marcarInterjornada(dias: { data: string; primeiraEntradaMs?: number; ultimaSaidaMs?: number; apuracao: ApuracaoDia }[], cct: ParametrosCCT): void {
  const min = (cct.interjornadaMinHoras || 11) * 3_600_000;
  for (let i = 1; i < dias.length; i++) {
    const ant = dias[i - 1].ultimaSaidaMs, atu = dias[i].primeiraEntradaMs;
    if (ant && atu && atu - ant < min) dias[i].apuracao.excecoes.push("interjornada");
  }
}
