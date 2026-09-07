// ════════════════════════════════════════════════════════════════════════════
//  PTRP — as 3 CCTs do grupo, codificadas como ParametrosCCT (com vigência).
//  Fábricas por empresa; a amarração empresaKey↔CCT e o enquadramento SP são
//  parâmetros a confirmar (ver `pendencias`). Semeadas na coleção parametrosCCT.
// ════════════════════════════════════════════════════════════════════════════
import type { ParametrosCCT } from "./tipos";

// 1) QUIBEBE — escritório administrativo · EAA/Sescon-SP 2025/2026.
export function cctQuibebe(empresaKey: string): ParametrosCCT {
  return {
    id: `${empresaKey}_2025-08-01`,
    empresaKey,
    cctNome: "EAA/Sescon-SP 2025/2026",
    sindicato: "SESCON-SP / EAA",
    vigenciaDe: "2025-08-01", vigenciaAte: "2026-07-31", vigente: true,
    extras: { faixa1Perc: 60, faixa1AteHoras: 2, faixa2Perc: 80, domingoPerc: 100, feriadoPerc: 100, diaCompensadoPerc: 100 },
    adicionalNoturno: { perc: 30, inicio: "22:00", fim: "05:00", horaReduzidaMin: null },
    enquadramentoPiso: null,
    regimeCompensacao: "compensacao_prazo", prazoCompensacaoDias: 60, contaPrazoDaQuinzena: true, limiteSaldoNegativoHoras: null,
    interjornadaMinHoras: 11,
    tiposAbono: [
      { tipo: "acompanhamento_medico", quantidade: 24, unidade: "horas", periodo: "semestre", exigeComprovacao: true, obs: "filho menor ou pais idosos ao médico" },
      { tipo: "casamento", quantidade: 3, unidade: "dias_uteis", periodo: "evento" },
      { tipo: "falecimento", quantidade: 2, unidade: "dias_uteis", periodo: "evento", obs: "cônjuge, ascendente, descendente, sogros, irmão ou dependente econômico" },
    ],
    comprovanteMensalSubstitui: true,
    pendencias: [],
  };
}

// 2) SP (Lobozó, Sororoca, Puba SP) — SINTHORESP/SINDRESBAR-SP 2025/2027.
// Percentuais mudam por PISO: normal | diferenciado | especial (cadastramento
// sindical). Default "normal" — CONFIRMAR o enquadramento de cada casa.
const EXTRA_POR_PISO = { normal: 100, diferenciado: 70, especial: 50 } as const;
const NOTURNO_POR_PISO = { normal: 50, diferenciado: 35, especial: 20 } as const;
export function cctSaoPaulo(empresaKey: string, piso: "normal" | "diferenciado" | "especial" = "normal", cadastrada = false): ParametrosCCT {
  return {
    id: `${empresaKey}_2025-01-01`,
    empresaKey,
    cctNome: "SINTHORESP/SINDRESBAR-SP 2025/2027",
    sindicato: "SINTHORESP",
    vigenciaDe: "2025-01-01", vigenciaAte: "2027-12-31", vigente: true,
    extras: { faixa1Perc: EXTRA_POR_PISO[piso], faixa1AteHoras: null, faixa2Perc: null, domingoPerc: null, feriadoPerc: null, diaCompensadoPerc: null },
    adicionalNoturno: { perc: NOTURNO_POR_PISO[piso], inicio: "22:00", fim: "05:00", horaReduzidaMin: null },
    enquadramentoPiso: piso,
    regimeCompensacao: "banco",
    prazoCompensacaoDias: cadastrada ? 365 : 90,
    limiteSaldoNegativoHoras: piso === "especial" ? 30 : null,
    jornadaDiariaMaxHoras: 10, interjornadaMinHoras: 11,
    intervalo: { minMin: cadastrada ? 30 : 60, maxMin: null },
    permite12x36: true,
    tiposAbono: [],
    pendencias: [
      "Confirmar o ENQUADRAMENTO do piso (normal/diferenciado/especial) e se a casa é cadastrada no sindicato (contrapartidas) — muda extras, noturno, prazo de compensação e intervalo mínimo.",
      "Pré-assinalação do intervalo (cadastrada): configurar por Turno (flag preAssinalarIntervalo).",
    ],
  };
}

// 3) PUBA BELÉM — SINTHRBS/PA. Doc disponível é 2024/2025 (VENCIDA 31/07/2025).
export function cctBelem(empresaKey: string): ParametrosCCT {
  return {
    id: `${empresaKey}_2024-08-01`,
    empresaKey,
    cctNome: "SINTHRBS/PA 2024/2025",
    sindicato: "SINTHRBS-PA",
    vigenciaDe: "2024-08-01", vigenciaAte: "2025-07-31", vigente: false,
    extras: { faixa1Perc: 80, faixa1AteHoras: null, faixa2Perc: null, domingoPerc: null, feriadoPerc: 100, diaCompensadoPerc: null },
    adicionalNoturno: { perc: 25, inicio: "22:00", fim: "05:00", horaReduzidaMin: 52 },  // 52min30s
    enquadramentoPiso: null,
    regimeCompensacao: "banco", prazoCompensacaoDias: 90, limiteSaldoNegativoHoras: null,
    jornadaDiariaMaxHoras: 11, interjornadaMinHoras: 11,
    intervalo: { minMin: 30, maxMin: 300 },
    permite12x36: true, folgaDominicalCadaSemanas: 6,
    regrasFeriado: { trabalhadoComoExtra: true, folgaAdicionalPerc: 100, compensavelDias: 90 },
    calendarioFeriados: { municipio: "Belém", uf: "PA", feriados: [
      { data: "08-15", nome: "Adesão do Pará" },
      { data: "12-08", nome: "N. Sra. da Conceição" },
    ] },
    tiposAbono: [
      { tipo: "nascimento", quantidade: 5, unidade: "dias_corridos", periodo: "evento" },
      { tipo: "casamento", quantidade: 5, unidade: "dias_corridos", periodo: "evento" },
      { tipo: "falecimento", quantidade: 4, unidade: "dias_corridos", periodo: "evento", obs: "dependente direto" },
      { tipo: "atestado_medico", quantidade: 0, unidade: "dias_corridos", periodo: "evento", exigeComprovacao: true, prazoComprovacaoHoras: 48, obs: "entregar em até 48h do retorno, senão falta injustificada" },
      { tipo: "prova_escolar", quantidade: 0, unidade: "dias_corridos", periodo: "evento", exigeComprovacao: true, obs: "aviso prévio de 48h" },
    ],
    marcacaoPeloProprioEmpregado: true, viaImpressaSobDemanda: true,
    comprovanteMensalSubstitui: false,
    pendencias: [
      "RENOVAR CCT SINTHRBS/PA — o documento disponível é 2024/2025 (vencido em 31/07/2025). Buscar a renovação p/ valores atualizados; cláusulas sociais valem 2 anos.",
    ],
  };
}
