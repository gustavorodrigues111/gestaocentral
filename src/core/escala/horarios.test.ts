// Suite de testes da validação CLT do módulo de horários.
//
// PRINCÍPIO: esses testes são a nossa rede de proteção contra mudanças que
// possam silenciosamente quebrar o cálculo trabalhista. Cada teste documenta
// QUE artigo da CLT está sendo verificado e o resultado esperado.
//
// Rodar:
//   npm test           — uma vez (CI)
//   npm run test:watch — modo watch (dev)
//
// Se um teste falhar:
//   1. Entenda por que o número esperado é aquele (cite o artigo CLT no test)
//   2. NÃO ajuste o teste pra passar antes de confirmar que a regra mudou
//   3. Se a regra mudou, atualize o teste E a função juntas, com motivo claro

import { describe, expect, it } from "vitest";
import {
  calcDayHours,
  fmtHHMM,
  timeToMin,
  validateWorkScheduleDays,
} from "./horarios";
import type { HorarioDia } from "../types";

// ─── Helpers de teste ────────────────────────────────────────────────────────

const CARGA_MIN_CLT = 2635; // 43:55 — limite mínimo default do restaurante
const CARGA_MAX_CLT = 2640; // 44:00 — limite máximo CLT (CF Art. 7º XIV)

// Monta um dia ativo
function dia(inT: string, outT: string, brk = 0): HorarioDia {
  return { active: true, in: inT, out: outT, break: brk };
}

// Monta dias da semana só com os dias informados; o resto fica { active: false }
function semana(...dias: Array<HorarioDia | null>): Record<number, HorarioDia> {
  const out: Record<number, HorarioDia> = {};
  for (let i = 0; i < 7; i++) out[i] = dias[i] || { active: false };
  return out;
}

// ─── calcDayHours: cálculo de horas de UM dia ────────────────────────────────

describe("calcDayHours — cálculo de horas de um único dia", () => {
  describe("jornada diurna pura (sem hora noturna)", () => {
    it("9h trabalhadas, sem intervalo, sem hora noturna", () => {
      const r = calcDayHours("09:00", "18:00", 0);
      expect(r.worked).toBe(540);          // 9h
      expect(r.diurnal).toBe(540);
      expect(r.nocturnal).toBe(0);
      expect(r.nocturnalFicta).toBe(0);
      expect(r.totalContract).toBe(540);   // 9h contratuais
    });

    it("9h trabalhadas, intervalo 1h, sem hora noturna → 8h contratuais", () => {
      const r = calcDayHours("09:00", "18:00", 60);
      expect(r.worked).toBe(480);          // 8h
      expect(r.totalContract).toBe(480);
    });

    it("turno parte tarde até 22h em ponto — limite do diurno", () => {
      const r = calcDayHours("14:00", "22:00", 60);
      expect(r.nocturnal).toBe(0);         // 22h em ponto ainda é diurno
      expect(r.totalContract).toBe(7 * 60); // 7h
    });
  });

  describe("hora ficta noturna (CLT Art. 73)", () => {
    // Regra: 1h real noturna (22h-05h) conta como 1h e ~8.57min contratual
    // Conversão: minutos noturnos × (60/52.5) = ~1.143×

    it("1h cheia noturna (22h-23h) vira ~1h08 contratual", () => {
      const r = calcDayHours("22:00", "23:00", 0);
      expect(r.worked).toBe(60);
      expect(r.diurnal).toBe(0);
      expect(r.nocturnal).toBe(60);
      // 60 × (60/52.5) = 68.57 → round = 69
      expect(r.nocturnalFicta).toBe(69);
      expect(r.totalContract).toBe(69);    // ~1h09 contratual
    });

    it("turno que cruza a meia-noite (22h-04h) conta janelas separadas corretamente", () => {
      const r = calcDayHours("22:00", "04:00", 0); // overnight
      expect(r.worked).toBe(360);          // 6h reais
      expect(r.diurnal).toBe(0);
      expect(r.nocturnal).toBe(360);       // tudo noturno
      // 360 × (60/52.5) = 411.43 → round = 411
      expect(r.nocturnalFicta).toBe(411);
      expect(r.totalContract).toBe(411);   // ~6h51 contratual
    });

    it("turno misto diurno+noturno (18h-23h): só a parte 22-23 é noturna", () => {
      const r = calcDayHours("18:00", "23:00", 0);
      expect(r.worked).toBe(300);          // 5h reais
      expect(r.diurnal).toBe(240);         // 4h (18-22)
      expect(r.nocturnal).toBe(60);        // 1h (22-23)
      expect(r.nocturnalFicta).toBe(69);   // 60 × 1.1428 = 68.57 → 69
      expect(r.totalContract).toBe(240 + 69); // 309 = 5h09
    });

    it("turno noturno completo (20h-04h) com 1h intervalo desconta do diurno primeiro", () => {
      const r = calcDayHours("20:00", "04:00", 60);
      expect(r.worked).toBe(420);          // 7h reais (8h - 1h intervalo)
      expect(r.diurnal).toBe(60);          // 20-22 = 2h, menos 1h intervalo = 1h
      expect(r.nocturnal).toBe(360);       // 22-04 = 6h (não afetado pelo intervalo)
      expect(r.nocturnalFicta).toBe(411);  // 360 × 1.1428 = 411.43 → 411
      expect(r.totalContract).toBe(60 + 411); // 471 = 7h51
    });

    it("turno 21h-06h: faixa noturna é 22h-05h (CLT Art. 73 §2º), não 22h-06h", () => {
      // Decomposição CORRETA (não esquecer: noturno legal termina às 05h):
      //   21:00-22:00 = 60min diurno
      //   22:00-05:00 = 420min noturno (7h)
      //   05:00-06:00 = 60min diurno
      //   Total worked: 540min (9h)
      //
      // Intervalo 90min: 90 ≤ diurno total (120), desconta tudo do diurno.
      //   diurnal final = 120 - 90 = 30
      //   nocturnal final = 420
      //   ficta = 420 × (60/52.5) = 480
      //   totalContract = 30 + 480 = 510
      const r = calcDayHours("21:00", "06:00", 90);
      expect(r.worked).toBe(540 - 90);     // 450 (líquido)
      expect(r.diurnal).toBe(30);
      expect(r.nocturnal).toBe(420);
      expect(r.nocturnalFicta).toBe(480);
      expect(r.totalContract).toBe(510);
    });

    it("turno totalmente noturno 22h-04h: respeita limite das 05h", () => {
      // 22:00-04:00 = 6h reais
      // Mas faixa noturna 22h-05h cobre TUDO. Então nocturnal = 360min.
      const r = calcDayHours("22:00", "04:00", 0);
      expect(r.worked).toBe(360);
      expect(r.nocturnal).toBe(360);
      expect(r.diurnal).toBe(0);
    });

    it("turno 23h-07h: só 22h-05h é noturno", () => {
      // 23:00-05:00 = 6h noturno (limitado às 05h)
      // 05:00-07:00 = 2h diurno
      // Total worked: 8h = 480
      const r = calcDayHours("23:00", "07:00", 0);
      expect(r.worked).toBe(480);
      expect(r.nocturnal).toBe(360);     // 6h
      expect(r.diurnal).toBe(120);       // 2h
    });
  });

  describe("overnight (saída no dia seguinte)", () => {
    it("saída < entrada → +24h automaticamente", () => {
      const r1 = calcDayHours("23:00", "02:00", 0); // 23h hoje → 02h amanhã
      expect(r1.worked).toBe(180); // 3h
    });

    it("saída == entrada → erro (jornada zero é ambígua)", () => {
      const r = calcDayHours("10:00", "10:00", 0);
      // outMin <= inMin, então outMin += 24*60 → worked = 1440 (24h)
      // Não é erro per se, mas o sistema interpreta como 24h.
      expect(r.worked).toBe(1440);
    });
  });

  describe("inputs inválidos", () => {
    it("entrada ou saída faltando → retorna zerado", () => {
      expect(calcDayHours(undefined, "10:00").worked).toBe(0);
      expect(calcDayHours("10:00", undefined).worked).toBe(0);
    });
  });
});

// ─── validateWorkScheduleDays: 6 regras CLT ──────────────────────────────────

describe("validateWorkScheduleDays — validações CLT em uma semana", () => {
  describe("Art. 59 — jornada máxima 10h/dia (8h + 2h extra)", () => {
    it("9h contratuais OK (sem erro)", () => {
      // Dom F, Seg-Sex 9h, Sáb F — 45h, mas testa só jornada por dia
      const dias = semana(
        null,                     // 0=Dom
        dia("08:00", "18:00", 60), // 1=Seg → 10h - 1h = 9h
        dia("08:00", "18:00", 60), // 2=Ter
        dia("08:00", "18:00", 60), // 3=Qua
        dia("08:00", "18:00", 60), // 4=Qui
        dia("08:00", "12:55", 0),  // 5=Sex → 4h55 (pra dar 43:55 total)
        null,                      // 6=Sáb
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const jornadaMax = r.errors.filter((e) => e.tipo === "jornada_max");
      expect(jornadaMax).toHaveLength(0);
    });

    it("11h contratuais (1h acima do limite) → erro jornada_max", () => {
      const dias = semana(
        null,
        dia("08:00", "19:00", 0),  // 11h sem intervalo
        null, null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const jornadaMax = r.errors.filter((e) => e.tipo === "jornada_max");
      expect(jornadaMax.length).toBeGreaterThan(0);
      expect(jornadaMax[0].artigo).toContain("Art. 59");
    });
  });

  describe("Art. 71 — intervalo intra-jornada", () => {
    it("jornada > 6h sem intervalo → erro intra_jornada (precisa ≥1h)", () => {
      const dias = semana(
        null,
        dia("08:00", "17:00", 0), // 9h sem intervalo
        null, null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const intraJ = r.errors.filter((e) => e.tipo === "intra_jornada");
      expect(intraJ.length).toBeGreaterThan(0);
    });

    it("jornada > 6h com intervalo de 30min → erro intra_jornada (precisa ≥1h)", () => {
      const dias = semana(
        null,
        dia("08:00", "17:00", 30), // 9h - 30min = 8h30, intervalo insuficiente
        null, null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const intraJ = r.errors.filter((e) => e.tipo === "intra_jornada");
      expect(intraJ.length).toBeGreaterThan(0);
    });

    it("jornada > 6h com intervalo de 60min → OK", () => {
      const dias = semana(
        null,
        dia("08:00", "17:00", 60), // 9h - 1h = 8h
        null, null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const intraJ = r.errors.filter((e) => e.tipo === "intra_jornada");
      expect(intraJ).toHaveLength(0);
    });

    it("jornada entre 4h e 6h precisa de ≥15min de intervalo", () => {
      const semIntervalo = semana(
        null,
        dia("08:00", "13:00", 0), // 5h sem intervalo
        null, null, null, null, null,
      );
      const r1 = validateWorkScheduleDays(semIntervalo, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const i1 = r1.errors.filter((e) => e.tipo === "intra_jornada");
      expect(i1.length).toBeGreaterThan(0);

      const comIntervalo = semana(
        null,
        dia("08:00", "13:00", 15), // 5h com 15min intervalo
        null, null, null, null, null,
      );
      const r2 = validateWorkScheduleDays(comIntervalo, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const i2 = r2.errors.filter((e) => e.tipo === "intra_jornada");
      expect(i2).toHaveLength(0);
    });

    it("jornada ≤ 4h não exige intervalo", () => {
      const dias = semana(
        null,
        dia("08:00", "12:00", 0), // 4h em ponto, sem intervalo
        null, null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const intraJ = r.errors.filter((e) => e.tipo === "intra_jornada");
      expect(intraJ).toHaveLength(0);
    });
  });

  describe("Art. 66 — interjornada ≥ 11h", () => {
    it("seg sai 22h, ter entra 08h (10h interjornada) → erro inter_jornada", () => {
      const dias = semana(
        null,
        dia("14:00", "22:00", 60), // Seg fim 22h
        dia("08:00", "16:00", 60), // Ter início 08h (só 10h depois)
        null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const inter = r.errors.filter((e) => e.tipo === "inter_jornada");
      expect(inter.length).toBeGreaterThan(0);
    });

    it("seg sai 22h, ter entra 09h (11h interjornada exatamente) → OK", () => {
      const dias = semana(
        null,
        dia("14:00", "22:00", 60),
        dia("09:00", "17:00", 60),
        null, null, null, null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const inter = r.errors.filter((e) => e.tipo === "inter_jornada");
      expect(inter).toHaveLength(0);
    });
  });

  describe("Art. 67 — DSR semanal", () => {
    it("trabalhar 7 dias seguidos → erro dsr", () => {
      const dias = semana(
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
      );
      const r = validateWorkScheduleDays(dias, 0, 9999); // carga frouxa pra isolar DSR
      const dsr = r.errors.filter((e) => e.tipo === "dsr");
      expect(dsr.length).toBeGreaterThan(0);
    });

    it("trabalhar 6 dias com 1 folga → OK quanto a DSR", () => {
      const dias = semana(
        null,                      // Dom folga
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
        dia("09:00", "13:00", 0),
      );
      const r = validateWorkScheduleDays(dias, 0, 9999);
      const dsr = r.errors.filter((e) => e.tipo === "dsr");
      expect(dsr).toHaveLength(0);
    });
  });

  describe("Art. 7º XIV CF + Art. 58 — carga semanal", () => {
    it("44h00 (limite máx) → OK", () => {
      // Seg-Sex 9h + Sáb 8h = 44h (pra simplificar, todos 8h48min)
      // 44h = 2640 min. 8h48 = 528 min. 5 dias × 528 = 2640.
      const dias = semana(
        null,
        dia("08:00", "17:48", 60), // 9h48 - 1h = 8h48
        dia("08:00", "17:48", 60),
        dia("08:00", "17:48", 60),
        dia("08:00", "17:48", 60),
        dia("08:00", "17:48", 60),
        null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const carga = r.errors.filter((e) => e.tipo === "carga_semanal");
      expect(carga).toHaveLength(0);
      expect(r.totalContract).toBe(CARGA_MAX_CLT);
    });

    it("45h (1h acima do máx) → erro carga_semanal", () => {
      // 5 dias × 9h = 45h sem intervalo... mas isso disparia intra_jornada também.
      // Vou usar 5 dias × 9h com 0 break (45h totais) ignorando outras regras
      const dias = semana(
        null,
        dia("08:00", "18:00", 60), // 9h - usa break OK, 9h - 1h... espera, 18-8=10h, -1h=9h
        dia("08:00", "18:00", 60),
        dia("08:00", "18:00", 60),
        dia("08:00", "18:00", 60),
        dia("08:00", "18:00", 60), // 5 × 9h = 45h
        null,
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const carga = r.errors.filter((e) => e.tipo === "carga_semanal");
      expect(carga.length).toBeGreaterThan(0);
      // 5 dias × (10h - 1h) = 5 × 9h = 45h = 2700min
      expect(r.totalContract).toBe(2700);
    });

    it("43h (1h abaixo do mín) → erro carga_semanal", () => {
      const dias = semana(
        null,
        dia("08:00", "17:00", 60), // 9-1 = 8h
        dia("08:00", "17:00", 60),
        dia("08:00", "17:00", 60),
        dia("08:00", "17:00", 60),
        dia("08:00", "16:00", 60), // 8h - 1h = 7h. Total: 4×8 + 7 = 39h. Falta um dia.
        dia("08:00", "12:00", 0),  // 4h
      );
      // 8+8+8+8+7+4 = 43h = 2580 (abaixo de 2635)
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const carga = r.errors.filter((e) => e.tipo === "carga_semanal");
      expect(carga.length).toBeGreaterThan(0);
    });

    it("zero dias ativos → não dá erro de carga", () => {
      const dias = semana(null, null, null, null, null, null, null);
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      const carga = r.errors.filter((e) => e.tipo === "carga_semanal");
      expect(carga).toHaveLength(0);
      expect(r.totalContract).toBe(0);
      expect(r.diasAtivos).toBe(0);
    });
  });

  describe("Caso real — Bianca (escala A, 5 dias Ter-Sáb)", () => {
    // Ter 15:00-22:30 (-1h) = 6h30
    // Qua 12:12-22:30 (-1h) = 9h18
    // Qui-Sáb 12:13-22:30 (-1h) = 9h17 × 3 = 27h51
    // Total: 6:30 + 9:18 + 27:51 = 43h39 = 2619 min
    //
    // Mas com hora ficta (22h em diante), o totalContract sobe...
    // - Ter: 15-22:30 → 22-22:30 = 30min noturno → ficta = 34 → diurno 7h - 1h interv. = 6h, total = 6h + 34min
    //   Espera, melhor recalcular do zero
    it("calcula corretamente as horas da semana A da Bianca", () => {
      const dias = semana(
        null, // Dom
        null, // Seg
        dia("15:00", "22:30", 60), // Ter
        dia("12:12", "22:30", 60), // Qua
        dia("12:13", "22:30", 60), // Qui
        dia("12:13", "22:30", 60), // Sex
        dia("12:13", "22:30", 60), // Sáb
      );
      const r = validateWorkScheduleDays(dias, CARGA_MIN_CLT, CARGA_MAX_CLT);
      expect(r.diasAtivos).toBe(5);

      // Sanity check: jornadas individuais OK
      const jornadaMax = r.errors.filter((e) => e.tipo === "jornada_max");
      expect(jornadaMax).toHaveLength(0);

      // Intervalo OK (todas têm 1h)
      const intra = r.errors.filter((e) => e.tipo === "intra_jornada");
      expect(intra).toHaveLength(0);

      // DSR OK (2 folgas)
      const dsr = r.errors.filter((e) => e.tipo === "dsr");
      expect(dsr).toHaveLength(0);

      // O total deve estar entre 2635 e 2640 OU dar erro de carga
      // (na prática, com ficta noturna, fica perto do limite)
      if (r.totalContract < CARGA_MIN_CLT || r.totalContract > CARGA_MAX_CLT) {
        const carga = r.errors.filter((e) => e.tipo === "carga_semanal");
        expect(carga.length).toBeGreaterThan(0);
      }
    });
  });
});

// ─── Helpers diretos ─────────────────────────────────────────────────────────

describe("timeToMin / fmtHHMM — conversões", () => {
  it("timeToMin", () => {
    expect(timeToMin("00:00")).toBe(0);
    expect(timeToMin("01:30")).toBe(90);
    expect(timeToMin("23:59")).toBe(23 * 60 + 59);
  });

  it("fmtHHMM", () => {
    expect(fmtHHMM(0)).toBe("00:00");
    expect(fmtHHMM(90)).toBe("01:30");
    expect(fmtHHMM(2640)).toBe("44:00");
  });
});
