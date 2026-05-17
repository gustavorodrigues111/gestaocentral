import type { Empregado, EscalaMes, ScheduleStatus, Cargo, Area, VTLoteLinha } from "../../core/types";
import { nomeMes, shiftMonth } from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";

// Status que conta como dia de trabalho pra cálculo de VT (base do mês corrente)
const STATUS_TRABALHADO: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  comp_trab: true,
  freela:    true,
  folga:     false,
  comp:      false,
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

// Status que GERAM DESCONTO no VT do mês seguinte (X+1) com base no refMes (X-2 do lote).
// Regra do user: "todos descontam exceto trabalho".
const STATUS_DESCONTA: Record<ScheduleStatus, boolean> = {
  trabalho:  false,
  comp_trab: true,
  freela:    true,
  folga:     true,
  comp:      true,
  ferias:    true,
  falta_j:   true,
  falta_i:   true,
};

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  trabalho:  "trabalho",
  folga:     "folga",
  freela:    "freela",
  comp:      "comp",
  comp_trab: "comp_trab",
  ferias:    "férias",
  falta_j:   "falta_j",
  falta_i:   "falta_i",
};

// Conta dias de trabalho na escala — versão "prevista" pra VT antecipado,
// "real" pra divergências/ajustes posteriores.
export function contarDiasTrabalhados(
  empregadoId: string,
  escala: EscalaMes | null,
  versao: "prevista" | "real" = "prevista",
): number {
  if (!escala) return 0;
  const dias = escala[versao]?.[empregadoId];
  if (!dias) return 0;
  let n = 0;
  for (const k of Object.keys(dias)) {
    if (STATUS_TRABALHADO[dias[k]]) n++;
  }
  return n;
}

// Conta dias de trabalho com FALLBACK pra escala derivada do workSchedule.
// Quando a escala prevista do mês não foi preenchida (doc não existe ou
// empregado não tem entradas), assume os dias úteis do horário cadastrado
// (active + sundayCycle). Marca em `fonte` qual fonte foi usada.
//
// Regra de combinação quando a escala existe parcialmente pro empregado:
// - Pega o cadastro como base (todos os dias do mês)
// - Aplica override da escala dia-a-dia (status real lá manda)
export type DiasContados = {
  dias: number;
  fonte: "escala" | "horario" | "vazio";
};

export function contarDiasTrabalhadosSmart(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  versao: "prevista" | "real" = "prevista",
): DiasContados {
  const escalaEmp = escala?.[versao]?.[empregado.id] || {};
  const temEscala = Object.keys(escalaEmp).length > 0;

  // Cadastro derivado (horário cadastrado)
  const derivado = derivedScheduleForEmpregado(empregado, ano, mes);
  const temHorario = Object.keys(derivado).length > 0;

  if (!temEscala && !temHorario) {
    return { dias: 0, fonte: "vazio" };
  }

  // Se a escala não foi tocada, usa só o derivado
  if (!temEscala) {
    let n = 0;
    for (const k of Object.keys(derivado)) {
      if (derivado[k].status === "trabalho") n++;
    }
    return { dias: n, fonte: "horario" };
  }

  // Escala existe — combina: cadastro como base, escala como override.
  // Pra cada dia do mês ativo no derivado OU presente na escala:
  const todasDatas = new Set<string>([...Object.keys(derivado), ...Object.keys(escalaEmp)]);
  let n = 0;
  for (const date of todasDatas) {
    const stEscala = escalaEmp[date];
    if (stEscala !== undefined) {
      if (STATUS_TRABALHADO[stEscala]) n++;
    } else {
      const d = derivado[date];
      if (d && d.status === "trabalho") n++;
    }
  }
  return { dias: n, fonte: "escala" };
}

export type VTLinhaCalc = {
  empregadoId: string;
  nome: string;
  diasTrabalhados: number;
  passagensPorDia: number;
  valorPassagem: number;
  total: number;
  paidAt?: string | null;
};

export function calcularVTLinha(
  e: Empregado,
  escala: EscalaMes | null,
  versao: "prevista" | "real" = "prevista",
): VTLinhaCalc | null {
  if (!e.vtAtivo) return null;
  const passagensPorDia = e.vtPassagensPorDia ?? 0;
  const valorPassagem   = e.vtValorPassagem   ?? 0;
  const diasTrabalhados = contarDiasTrabalhados(e.id, escala, versao);
  const total = Math.round(diasTrabalhados * passagensPorDia * valorPassagem * 100) / 100;
  return {
    empregadoId: e.id,
    nome: e.nome,
    diasTrabalhados,
    passagensPorDia,
    valorPassagem,
    total,
  };
}

// ─── DESCONTO SUGERIDO (refMes = lote.mes − 2) ──────────────────────────────
// Cada status ≠ "trabalho" no refMes vira desconto de (passagens/dia × valor).
// Retorna {valor, justificativa} pra mostrar tooltip na linha.

export type DescontoSugeridoCalc = {
  valor: number;                     // R$ sempre ≥ 0
  justificativa: string;             // ex: "2 ausências em mar/26: 12 (falta_j), 25 (falta_i)"
  refMesYm: string;                  // "YYYY-MM"
  ocorrencias: { dia: number; status: ScheduleStatus }[];
};

export function calcularDescontoSugerido(
  empregadoId: string,
  passagensPorDia: number,
  valorPassagem: number,
  escalaRef: EscalaMes | null,
  refAno: number,
  refMes: number,
): DescontoSugeridoCalc {
  const refMesYm = `${refAno}-${String(refMes).padStart(2, "0")}`;
  const mesNomeRef = nomeMes(refMes).slice(0, 3).toLowerCase();
  const anoCurto = String(refAno).slice(2);
  if (!escalaRef) {
    return { valor: 0, justificativa: `Sem escala em ${mesNomeRef}/${anoCurto} — desconto = 0`, refMesYm, ocorrencias: [] };
  }
  // Usa a versão REAL do refMes (o mês "passou", então o real é a fonte certa).
  const dias = escalaRef.real?.[empregadoId] || {};
  if (Object.keys(dias).length === 0) {
    return { valor: 0, justificativa: `Sem lançamentos em ${mesNomeRef}/${anoCurto} pra esse empregado — desconto = 0`, refMesYm, ocorrencias: [] };
  }
  const ocorrencias: { dia: number; status: ScheduleStatus }[] = [];
  for (const dateStr of Object.keys(dias)) {
    const st = dias[dateStr];
    if (STATUS_DESCONTA[st]) {
      const dia = parseInt(dateStr.slice(-2), 10);
      ocorrencias.push({ dia, status: st });
    }
  }
  ocorrencias.sort((a, b) => a.dia - b.dia);
  const qtd = ocorrencias.length;
  const valor = Math.round(qtd * passagensPorDia * valorPassagem * 100) / 100;
  let justificativa = "";
  if (qtd === 0) {
    justificativa = `Sem ocorrências em ${mesNomeRef}/${anoCurto}`;
  } else {
    const listaResumida = ocorrencias.slice(0, 6).map(o => `${o.dia} (${STATUS_LABEL[o.status]})`).join(", ");
    const sufixo = qtd > 6 ? `, +${qtd - 6}` : "";
    justificativa = `${qtd} ${qtd === 1 ? "ocorrência" : "ocorrências"} em ${mesNomeRef}/${anoCurto}: ${listaResumida}${sufixo}`;
  }
  return { valor, justificativa, refMesYm, ocorrencias };
}

// ─── DIVERGÊNCIAS ENTRE PREVISTA E REAL ──────────────────────────────────────
// Pra cada empregado VT-ativo, compara dias trabalhados na Prevista (que foi
// usada pra pagar VT) vs Real (o que de fato aconteceu).
// - Real > Prevista: empregado tem a RECEBER (trabalhou mais dias do que esperado)
// - Real < Prevista: empregado tem a DEVOLVER (faltou ou folgou compensatório)

export type VTDivergencia = {
  empregadoId: string;
  nome: string;
  diasPrevista: number;
  diasReal: number;
  delta: number;          // positivo = a receber; negativo = a devolver
  passagensPorDia: number;
  valorPassagem: number;
  diferencaValor: number; // delta * passagens * valor
};

export function calcularDivergenciasVT(
  empregados: Empregado[],
  escala: EscalaMes | null,
): VTDivergencia[] {
  if (!escala) return [];
  const divergencias: VTDivergencia[] = [];
  for (const e of empregados) {
    if (!e.vtAtivo) continue;
    const passagensPorDia = e.vtPassagensPorDia ?? 0;
    const valorPassagem   = e.vtValorPassagem   ?? 0;
    if (passagensPorDia <= 0 || valorPassagem <= 0) continue;
    const prev = contarDiasTrabalhados(e.id, escala, "prevista");
    const real = contarDiasTrabalhados(e.id, escala, "real");
    const delta = real - prev;
    if (delta === 0) continue;
    const diferencaValor = Math.round(delta * passagensPorDia * valorPassagem * 100) / 100;
    divergencias.push({
      empregadoId: e.id,
      nome: e.nome,
      diasPrevista: prev,
      diasReal: real,
      delta,
      passagensPorDia,
      valorPassagem,
      diferencaValor,
    });
  }
  return divergencias.sort((a, b) => Math.abs(b.diferencaValor) - Math.abs(a.diferencaValor));
}

// ─── LINHA-VIVA DO LOTE (preview antes de criar) ────────────────────────────
// Calcula a "linha" pra cada empregado considerando:
// - escala prevista do mês do lote → diasTrabalhados
// - escala real do refMes (lote.mes − 2) → desconto sugerido
// - cadastro do empregado → auxFixoMensal, passagensPorDia, valorPassagem
//
// Empregado entra na lista se:
//   - vtAtivo === true (tem VT diário), OU
//   - auxFixoMensal > 0 (só auxílio fixo, sem passagens)

export function refMesDoLote(loteAno: number, loteMes: number): { ano: number; mes: number } {
  return shiftMonth(loteAno, loteMes, -2);
}

export type VTLoteLinhaPreview = VTLoteLinha & {
  semConfig?: boolean;             // empregado tem vtAtivo mas falta passagens/valor
  fonteDias?: "escala" | "horario" | "vazio"; // de onde veio o `diasTrabalhados`
};

export function montarLinhasLote(
  empregados: Empregado[],
  cargos: Cargo[],
  escalaLote: EscalaMes | null,
  escalaRef: EscalaMes | null,
  loteAno: number,
  loteMes: number,
): VTLoteLinhaPreview[] {
  const ref = refMesDoLote(loteAno, loteMes);
  const cargosById = Object.fromEntries(cargos.map(c => [c.id, c]));
  const linhas: VTLoteLinhaPreview[] = [];

  for (const e of empregados) {
    const auxFixo = e.vtAuxilioFixoMensal ?? 0;
    const temVt = !!e.vtAtivo;
    if (!temVt && auxFixo <= 0) continue;

    const passagensPorDia = e.vtPassagensPorDia ?? 0;
    const valorPassagem   = e.vtValorPassagem   ?? 0;
    let diasTrabalhados = 0;
    let fonteDias: "escala" | "horario" | "vazio" = "vazio";
    if (temVt) {
      const calc = contarDiasTrabalhadosSmart(e, escalaLote, loteAno, loteMes, "prevista");
      diasTrabalhados = calc.dias;
      fonteDias = calc.fonte;
    }
    const vtBase = Math.round(diasTrabalhados * passagensPorDia * valorPassagem * 100) / 100;

    // Desconto sugerido — só se tem VT diário
    let descontoSugerido = 0;
    let descontoSugeridoJustificativa = "";
    let descontoSugeridoRefMes = `${ref.ano}-${String(ref.mes).padStart(2, "0")}`;
    if (temVt && passagensPorDia > 0 && valorPassagem > 0) {
      const ds = calcularDescontoSugerido(e.id, passagensPorDia, valorPassagem, escalaRef, ref.ano, ref.mes);
      descontoSugerido = ds.valor;
      descontoSugeridoJustificativa = ds.justificativa;
      descontoSugeridoRefMes = ds.refMesYm;
    }

    const cargo = cargosById[e.cargoId];
    const area: Area = (cargo?.area || "Salão") as Area;

    const descontoSugeridoAtivo = descontoSugerido > 0; // só ativa se tem desconto > 0
    const total = round2(auxFixo + vtBase - (descontoSugeridoAtivo ? descontoSugerido : 0));

    const semConfig = temVt && (passagensPorDia <= 0 || valorPassagem <= 0);

    linhas.push({
      empregadoId: e.id,
      nome: e.nome,
      cargoNome: cargo?.nome || "—",
      area,
      passagensPorDia,
      valorPassagem,
      diasTrabalhados,
      auxFixoMensal: auxFixo,
      vtBase,
      descontoSugeridoAtivo,
      descontoSugerido,
      descontoSugeridoJustificativa,
      descontoSugeridoRefMes,
      descontoManual: 0,
      auxPontual: 0,
      total,
      semConfig,
      fonteDias,
    });
  }

  return linhas;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Recalcula 1 linha (após user editar desc.manual / aux.pontual / toggle do sugerido).
// NÃO altera o vtBase nem o descontoSugerido (snapshot do momento).
export function recalcularTotalLinha(l: Pick<VTLoteLinha, "auxFixoMensal" | "vtBase" | "descontoSugerido" | "descontoSugeridoAtivo" | "descontoManual" | "auxPontual">): number {
  return round2(
    (l.auxFixoMensal || 0)
    + (l.vtBase || 0)
    - (l.descontoSugeridoAtivo ? (l.descontoSugerido || 0) : 0)
    - (l.descontoManual || 0)
    + (l.auxPontual || 0)
  );
}

export function totaisPorAreaELote(linhas: VTLoteLinha[]): { porArea: Record<string, number>; geral: number } {
  const porArea: Record<string, number> = {};
  let geral = 0;
  for (const l of linhas) {
    porArea[l.area] = round2((porArea[l.area] || 0) + l.total);
    geral = round2(geral + l.total);
  }
  return { porArea, geral };
}
