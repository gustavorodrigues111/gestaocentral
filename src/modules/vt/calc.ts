import type { Empregado, EscalaMes, ScheduleStatus, Cargo, Area, VTLote, VTLoteLinha, VTLoteStatus } from "../../core/types";
import { daysInMonth, nomeMes, pad2, shiftMonth } from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";

// Empregado estava ativo em ALGUM dia do mês? (mesma regra usada em /escala)
// Demitido antes/no 1º dia → demissao <= inicio → fora. Admitido depois do
// último dia → admissao > fim → fora.
function ativoEmAlgumDiaDoMes(emp: Empregado, ano: number, mes: number): boolean {
  const inicio = `${ano}-${pad2(mes)}-01`;
  const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  for (const p of emp.periodos || []) {
    if (p.admissao > fim) continue;
    if (p.demissao && p.demissao <= inicio) continue;
    return true;
  }
  return false;
}

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

// Conta dias de trabalho usando o snapshot da escala prevista FECHADA.
// Quando a prevista NÃO está fechada (em planejamento), preview pode mostrar
// uma estimativa derivada do horário cadastrado — mas o LOTE de pagamento só
// pode ser criado depois que a prevista for fechada (snapshot oficial).
//
// Estados retornados em `fonte`:
//   - "snapshot": escala prevista fechada — número definitivo
//   - "preview":  escala em planejamento — estimativa (escala+derivado)
//   - "vazio":    nem escala nem horário cadastrado — 0
export type DiasContados = {
  dias: number;
  fonte: "snapshot" | "preview" | "vazio";
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
  const previstaFechada = !!escala?.previstaFechadaEm;

  // Se a prevista do empregado já tem dados E a prevista está fechada,
  // é snapshot oficial — usa só ela.
  if (versao === "prevista" && previstaFechada && temEscala) {
    let n = 0;
    for (const k of Object.keys(escalaEmp)) {
      if (STATUS_TRABALHADO[escalaEmp[k]]) n++;
    }
    return { dias: n, fonte: "snapshot" };
  }

  // Caso contrário: preview combinando escala (overrides) + derivado (base)
  const derivado = derivedScheduleForEmpregado(empregado, ano, mes);
  const temHorario = Object.keys(derivado).length > 0;

  if (!temEscala && !temHorario) {
    return { dias: 0, fonte: "vazio" };
  }

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
  return { dias: n, fonte: "preview" };
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

// Conta dias de trabalho num RANGE específico do mês (pra pagamento parcial).
// Usa a mesma lógica do `contarDiasTrabalhadosSmart` — snapshot quando prevista
// fechada+populada, preview combinando escala+derivado caso contrário — mas
// limita aos dias entre `inicio` e `fim` (inclusivos, YYYY-MM-DD).
export function contarDiasTrabalhadosNoRange(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  inicio: string,
  fim: string,
  versao: "prevista" | "real" = "prevista",
): DiasContados {
  const escalaEmp = escala?.[versao]?.[empregado.id] || {};
  const temEscala = Object.keys(escalaEmp).length > 0;
  const previstaFechada = !!escala?.previstaFechadaEm;

  // Helper: filtra um mapa de cells pelo range
  const noRange = (date: string) => date >= inicio && date <= fim;

  if (versao === "prevista" && previstaFechada && temEscala) {
    let n = 0;
    for (const k of Object.keys(escalaEmp)) {
      if (noRange(k) && STATUS_TRABALHADO[escalaEmp[k]]) n++;
    }
    return { dias: n, fonte: "snapshot" };
  }

  const derivado = derivedScheduleForEmpregado(empregado, ano, mes);
  if (!temEscala && Object.keys(derivado).length === 0) {
    return { dias: 0, fonte: "vazio" };
  }
  const todasDatas = new Set<string>([...Object.keys(derivado), ...Object.keys(escalaEmp)]);
  let n = 0;
  for (const date of todasDatas) {
    if (!noRange(date)) continue;
    const stEscala = escalaEmp[date];
    if (stEscala !== undefined) {
      if (STATUS_TRABALHADO[stEscala]) n++;
    } else {
      const d = derivado[date];
      if (d && d.status === "trabalho") n++;
    }
  }
  return { dias: n, fonte: "preview" };
}

// ─── OVERLAP DE LOTES — evita pagar duas vezes o mesmo período ──────────────
// Pra um (empregadoId, ano, mes), retorna os ranges de datas já cobertos por
// LOTES REGULAR (rascunho + pago; cancelado libera). Ranges em modo "integral"
// cobrem o mês inteiro. Ranges em modo "parcial" cobrem [inicio..fim].
// Lotes de tipo "ajuste" NÃO ocupam ranges (são correções, podem se sobrepor).

export type RangeCoberto = {
  loteId: string;
  loteStatus: VTLoteStatus;
  inicio: string;            // YYYY-MM-DD
  fim: string;               // YYYY-MM-DD
};

export function rangesJaCobertos(
  empregadoId: string,
  ano: number,
  mes: number,
  lotes: VTLote[],
): RangeCoberto[] {
  const inicioMes = `${ano}-${pad2(mes)}-01`;
  const fimMes    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  const out: RangeCoberto[] = [];
  for (const lote of lotes) {
    if (lote.ano !== ano || lote.mes !== mes) continue;
    if (lote.status === "cancelado") continue;
    if (lote.tipo === "ajuste") continue;
    const linha = lote.linhas.find(l => l.empregadoId === empregadoId);
    if (!linha) continue;
    if (linha.modo === "parcial" && linha.periodoInicio && linha.periodoFim) {
      out.push({ loteId: lote.id, loteStatus: lote.status, inicio: linha.periodoInicio, fim: linha.periodoFim });
    } else {
      // Integral (ou modo undefined → retrocompat) = mês inteiro
      out.push({ loteId: lote.id, loteStatus: lote.status, inicio: inicioMes, fim: fimMes });
    }
  }
  return out;
}

// Checa se [novoInicio, novoFim] intersecta algum range já coberto.
// Retorna lista de overlaps (vazia = sem conflito).
export function detectarOverlap(
  novoInicio: string,
  novoFim: string,
  cobertos: RangeCoberto[],
): RangeCoberto[] {
  return cobertos.filter(c => !(novoFim < c.inicio || novoInicio > c.fim));
}

// Dado os ranges cobertos, devolve a "lista de gaps" — sub-ranges DENTRO do
// mês que ainda NÃO foram pagos. Usado pra sugerir auto-complete pro user.
export function gapsDoMes(
  ano: number,
  mes: number,
  cobertos: RangeCoberto[],
): { inicio: string; fim: string }[] {
  const inicioMes = `${ano}-${pad2(mes)}-01`;
  const fimMes    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  if (cobertos.length === 0) return [{ inicio: inicioMes, fim: fimMes }];
  // Ordena ranges + une sobrepostos pra computar union
  const sorted = [...cobertos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const merged: { inicio: string; fim: string }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.inicio <= addDay(last.fim, 1)) {
      if (r.fim > last.fim) last.fim = r.fim;
    } else {
      merged.push({ inicio: r.inicio, fim: r.fim });
    }
  }
  const gaps: { inicio: string; fim: string }[] = [];
  let cursor = inicioMes;
  for (const r of merged) {
    if (r.inicio > cursor) gaps.push({ inicio: cursor, fim: addDay(r.inicio, -1) });
    cursor = addDay(r.fim, 1);
  }
  if (cursor <= fimMes) gaps.push({ inicio: cursor, fim: fimMes });
  return gaps;
}

function addDay(ymd: string, delta: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export type VTLoteLinhaPreview = VTLoteLinha & {
  semConfig?: boolean;             // empregado tem vtAtivo mas falta passagens/valor
  semBeneficioCadastrado?: boolean; // empregado SEM nada: nem VT nem aux fixo
  fonteDias?: "snapshot" | "preview" | "vazio"; // de onde veio o `diasTrabalhados`
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
    // Filtra demitidos: só inclui empregados que estavam ativos em algum dia
    // do mês visualizado (admitido <= último dia, e não demitido antes do 1º)
    if (!ativoEmAlgumDiaDoMes(e, loteAno, loteMes)) continue;

    const auxFixo = e.vtAuxilioFixoMensal ?? 0;
    const temVt = !!e.vtAtivo;
    // Empregado sem VT diário E sem aux fixo → linha "ZERADA" mas APARECE,
    // pra que o user possa ver e eventualmente lançar aux.pontual ou desconto
    // pontual mesmo pra quem não tem benefício cadastrado.
    const semBeneficioCadastrado = !temVt && auxFixo <= 0;

    const passagensPorDia = e.vtPassagensPorDia ?? 0;
    const valorPassagem   = e.vtValorPassagem   ?? 0;
    let diasTrabalhados = 0;
    let fonteDias: "snapshot" | "preview" | "vazio" = "vazio";
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

    // "Sem config" = tem vtAtivo mas falta passagens/valor (config incompleta)
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
      modo: "integral",
      totalMesCompleto: total,
      diasMesCompleto: diasTrabalhados,
      semConfig,
      semBeneficioCadastrado,
      fonteDias,
    });
  }

  return linhas;
}

// Recalcula uma linha existente pra modo PARCIAL com novo range.
// Usado quando o user troca de Integral → Parcial no modal customizado,
// ou ajusta o range de uma linha parcial.
// - Mantém auxFixo do mês (proporcional NÃO — é cheio do mês mesmo na parcial)
// - Recalcula vtBase com dias dentro do range
// - Mantém descontoSugerido (é do refMes, independente do range corrente)
// - Recalcula total
//
// Retorna nova linha (não muta a entrada).
export function aplicarModoParcial(
  linha: VTLoteLinhaPreview,
  empregado: Empregado,
  escalaLote: EscalaMes | null,
  loteAno: number,
  loteMes: number,
  inicio: string,
  fim: string,
): VTLoteLinhaPreview {
  const calc = contarDiasTrabalhadosNoRange(empregado, escalaLote, loteAno, loteMes, inicio, fim, "prevista");
  const vtBase = Math.round(calc.dias * linha.passagensPorDia * linha.valorPassagem * 100) / 100;
  const total = recalcularTotalLinha({
    auxFixoMensal: linha.auxFixoMensal,
    vtBase,
    descontoSugerido: linha.descontoSugerido,
    descontoSugeridoAtivo: linha.descontoSugeridoAtivo,
    descontoManual: linha.descontoManual,
    auxPontual: linha.auxPontual,
  });
  return {
    ...linha,
    modo: "parcial",
    periodoInicio: inicio,
    periodoFim: fim,
    diasTrabalhados: calc.dias,
    vtBase,
    total,
    fonteDias: calc.fonte,
  };
}

// Volta uma linha pro modo INTEGRAL (mês inteiro). Recalcula vtBase/dias/total.
export function aplicarModoIntegral(
  linha: VTLoteLinhaPreview,
  empregado: Empregado,
  escalaLote: EscalaMes | null,
  loteAno: number,
  loteMes: number,
): VTLoteLinhaPreview {
  const calc = contarDiasTrabalhadosSmart(empregado, escalaLote, loteAno, loteMes, "prevista");
  const vtBase = Math.round(calc.dias * linha.passagensPorDia * linha.valorPassagem * 100) / 100;
  const total = recalcularTotalLinha({
    auxFixoMensal: linha.auxFixoMensal,
    vtBase,
    descontoSugerido: linha.descontoSugerido,
    descontoSugeridoAtivo: linha.descontoSugeridoAtivo,
    descontoManual: linha.descontoManual,
    auxPontual: linha.auxPontual,
  });
  return {
    ...linha,
    modo: "integral",
    periodoInicio: undefined,
    periodoFim: undefined,
    diasTrabalhados: calc.dias,
    vtBase,
    total,
    fonteDias: calc.fonte,
  };
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
