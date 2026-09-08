// ════════════════════════════════════════════════════════════════════════════
//  PTRP — modelo de dados do módulo novo de tratamento de ponto (Portaria 671).
//  ISOLADO do legado (excecoes/analise-ponto/escala). Coleções prefixo `ptrp`.
//
//  Terminologia: TURNO = template de horário sem data. ESCALA = alocação mensal
//  colaborador×dia (turnoId ou folga). A apuração compara batidas × Escala do dia.
// ════════════════════════════════════════════════════════════════════════════

// ─── Colaborador (cadastro replicado; fonte da verdade = planejamento.app) ───
export type PtrpColaborador = {
  id: string;                     // id do app (= externalId no Sólides)
  empresaKey: string;             // shortcode da empresa (chave em SOLIDES_TOKENS)
  nome: string;
  cpf: string;                    // só dígitos — casa com a batida do Sólides
  solidesId?: string | null;      // employeeId no Sólides
  pin?: string | null;            // PIN de batida (retorno do register)
  cargo?: string | null;
  turnoVigenteId?: string | null; // turno padrão atual (histórico em vigencias)
  vigencias?: { turnoId: string; de: string; ate?: string | null }[];
  status?: "ativo" | "afastado" | "demitido";
  admissao?: string | null;       // YYYY-MM-DD
  demissao?: string | null;
};

// ─── Turno (template de horário) ─────────────────────────────────────────────
// Suporta 1 ou 2 janelas no dia (ex.: 11:00–15:00 / 17:00–23:00). Sem datas.
export type PtrpTurno = {
  id: string;
  empresaKey: string;
  nome: string;                   // "Salão 11–15/17–23", "12x36 diurno"…
  janelas: { in: string; out: string }[];   // "HH:MM"; 1 ou 2 por dia
  intervaloMin?: number;          // minutos de intervalo previsto (intrajornada)
  // Pré-assinalação do intervalo (CCT SP cadastrada): o sistema gera a marcação
  // do intervalo automaticamente, sem batida do empregado.
  preAssinalarIntervalo?: boolean;
  cargaDiariaMin?: number;        // carga prevista do dia (min) — default: soma janelas − intervalo
  toleranciaEntradaMin?: number;  // default vem da CCT (CLT: 5/batida, 10/dia)
  // Repetição pra padrões 12x36 / 5x1 / 6x1 (quando o turno JÁ carrega o ciclo).
  repeticao?: { tipo: "12x36" | "5x1" | "6x1" | "semanal"; ancora?: string };
  adicionalNoturno?: boolean;     // este turno cruza a faixa noturna
  ativo?: boolean;
};

// ─── Escala mensal (colaborador × dia → turnoId | folga) ─────────────────────
export type PtrpCelulaEscala = { turnoId: string } | { folga: true } | { off: true };
export type PtrpEscalaMes = {
  id: string;                     // {empresaKey}_{YYYY-MM}
  empresaKey: string;
  competencia: string;            // YYYY-MM
  // grade[colaboradorId][dia "01".."31"] = célula
  grade: Record<string, Record<string, PtrpCelulaEscala>>;
  status?: "aberta" | "fechada";
  atualizadoEm?: string;
  atualizadoPor?: { id: string; nome: string };
};

// ─── Ajuste (tratamento) — Portaria 671: a batida original é IMUTÁVEL; todo
// tratamento é um LANÇAMENTO adicional com tipo/motivo/autor/timestamp. ────────
export type PtrpAjusteTipo = "inclusao" | "desconsideracao" | "abono" | "atestado" | "folga" | "ferias" | "afastamento";
export type PtrpAjuste = {
  id: string;
  empresaKey: string;
  colaboradorId: string;          // id do empregado no app
  cpf: string;
  data: string;                   // YYYY-MM-DD
  tipo: PtrpAjusteTipo;
  in?: string | null;             // "HH:MM" (inclusao — marcação incluída)
  out?: string | null;            // "HH:MM" (inclusao)
  punchId?: string | null;        // batida desprezada (desconsideracao)
  minutos?: number | null;        // abono parcial (default: dia inteiro)
  motivo: string;
  autor?: { id: string; nome: string };
  criadoEm?: string;
  cancelado?: boolean;            // soft-delete: preserva a trilha (nunca apaga)
  canceladoPor?: { id: string; nome: string } | null;
  canceladoEm?: string | null;
};

// ─── Banco de horas: 1 movimento por competência/colaborador. Saldo do mês
// (+ crédito / − débito) com prazo de compensação (vencimento) da CCT. ─────────
export type PtrpBancoMov = {
  id: string;
  empresaKey: string;
  colaboradorId: string;
  cpf: string;
  competencia: string;          // YYYY-MM
  saldoMinutos: number;         // + crédito (extra a compensar) / − débito
  vencimento?: string | null;   // YYYY-MM-DD — prazo de compensação do crédito
  regime?: string;              // banco | compensacao_prazo (da CCT vigente)
  registradoEm?: string;
  registradoPor?: { id: string; nome: string };
};

// ─── Fechamento mensal: SNAPSHOT congelado da apuração (Portaria 671) ─────────
// Ao "Encerrar mês", a apuração de cada colaborador é materializada (imutável de
// fato via UI travada) — vira a base do espelho de ponto (PDF) e do AEJ.
export type PtrpMarcacaoSnap = { in: string | null; out: string | null; status?: string | null; pendente?: boolean; punchId?: string | null };
export type PtrpAjusteSnap = { tipo: string; in?: string | null; out?: string | null; motivo?: string | null };
export type PtrpApuracaoDia = {
  data: string;                 // YYYY-MM-DD
  previstoMin: number;
  trabalhadoMin: number;
  extraMin: number;
  noturnoMin: number;
  atrasoMin?: number;
  faltaMin?: number;
  abonadoMin?: number;
  intervaloMin?: number;
  excecoes: string[];
  marcacoes: PtrpMarcacaoSnap[]; // batidas efetivas (in/out HH:MM)
  ajustes: PtrpAjusteSnap[];
  previstoTxt: string;
  statusEscala?: string | null;
  feriado?: boolean;
};
export type PtrpApuracaoColab = {
  id: string;                   // {empresaKey}_{YYYY-MM}_{colaboradorId}
  empresaKey: string;
  competencia: string;          // YYYY-MM
  colaboradorId: string;
  cpf: string;
  nome: string;
  cargo?: string | null;
  area?: string | null;
  admissao?: string | null;
  dias: PtrpApuracaoDia[];
  totalPrevistoMin: number;
  totalTrabalhadoMin: number;
  totalExtraMin: number;
  totalNoturnoMin: number;
  totalAtrasoMin: number;
  saldoMin: number;
  geradoEm: string;
};
export type PtrpFechamento = {
  id: string;                   // {empresaKey}_{YYYY-MM}
  empresaKey: string;
  competencia: string;          // YYYY-MM
  status: "fechado" | "reaberto";
  colaboradores: number;
  cctNome?: string | null;
  fechadoEm: string;
  fechadoPor?: { id: string; nome: string };
  reabertoEm?: string | null;
  reabertoPor?: { id: string; nome: string } | null;
};

// ════════════════════════════════════════════════════════════════════════════
//  Parâmetros de CCT por empresa (com VIGÊNCIA — renovam na data-base anual).
//  A apuração resolve os parâmetros pela empresa do colaborador E pela data da
//  ocorrência. Nada de regra fixa no motor.
// ════════════════════════════════════════════════════════════════════════════

// Percentuais de hora extra por condição. Alguns dependem de faixa horária
// diária (ex.: 60% nas 2 primeiras horas, 80% acima); outros do dia (domingo,
// feriado, dia já compensado). Piso SP muda os percentuais base.
export type FaixasExtras = {
  faixa1Perc: number;             // adicional das 1ªs horas extra do dia
  faixa1AteHoras?: number | null; // limite da faixa1 (ex.: 2h/dia); null = sem faixa2
  faixa2Perc?: number | null;     // adicional acima da faixa1
  domingoPerc?: number | null;
  feriadoPerc?: number | null;
  diaCompensadoPerc?: number | null;
};

export type AdicionalNoturno = {
  perc: number;                   // 30 (Quibebe) / 50-35-20 (SP piso) / 25 (Belém)
  inicio: string;                 // "22:00"
  fim: string;                    // "05:00"
  horaReduzidaMin?: number | null;// duração da "hora" noturna em min (52.5 → 52; null = legal 52m30s)
};

export type TipoAbono = {
  tipo: string;                   // "casamento" | "falecimento" | "nascimento" | "acompanhamento_medico" | "prova_escolar"…
  quantidade: number;
  unidade: "dias_uteis" | "dias_corridos" | "horas";
  periodo?: "evento" | "semestre" | "ano" | null;   // recorrência do limite
  exigeComprovacao?: boolean;
  prazoComprovacaoHoras?: number | null;            // ex.: atestado em 48h (Belém)
  obs?: string | null;
};

export type FeriadoMunicipal = { data: string; nome: string };   // "MM-DD"

export type ParametrosCCT = {
  id: string;                     // {empresaKey}_{vigenciaDe}
  empresaKey: string;
  cctNome: string;                // "EAA/Sescon-SP 2025/2026", "SINTHORESP/SINDRESBAR-SP 2025/2027", "SINTHRBS/PA 2024/2025"
  sindicato?: string | null;
  vigenciaDe: string;             // YYYY-MM-DD (data-base)
  vigenciaAte: string;            // YYYY-MM-DD
  vigente?: boolean;              // CCT ainda válida? (Belém 24/25 vencida → false até renovar)

  extras: FaixasExtras;
  adicionalNoturno: AdicionalNoturno;

  // Enquadramento sindical (SP): normal | diferenciado | especial — muda extras/noturno.
  enquadramentoPiso?: "normal" | "diferenciado" | "especial" | null;

  // Compensação: "banco" (banco de horas com prazo) OU "compensacao_prazo"
  // (Quibebe: acréscimo compensado em 60 dias da quinzena, senão paga extra).
  regimeCompensacao: "banco" | "compensacao_prazo";
  prazoCompensacaoDias: number;         // 60 (QUI) / 365 cadastrada · 90 demais (SP) / 90 (Belém)
  limiteSaldoNegativoHoras?: number | null;  // SP especial: 30
  contaPrazoDaQuinzena?: boolean;       // Quibebe: prazo conta da quinzena (dia 15/30) da ocorrência

  jornadaDiariaMaxHoras?: number | null;// 10 (SP); Belém 12x36 = 11+1
  interjornadaMinHoras?: number;        // 11
  intervalo?: { minMin?: number | null; maxMin?: number | null }; // 30–120/300…
  permite12x36?: boolean;
  folgaDominicalCadaSemanas?: number | null;  // Belém: folga dominical ao menos a cada 6 semanas

  regrasFeriado?: {
    trabalhadoComoExtra?: boolean;      // Belém: trabalho em feriado = hora extra
    folgaAdicionalPerc?: number | null; // Belém: 100% se estava de folga
    compensavelDias?: number | null;    // 90
  } | null;

  // Calendário de feriados por município (além dos nacionais).
  calendarioFeriados?: { municipio: string; uf: string; feriados?: FeriadoMunicipal[] } | null;

  tiposAbono: TipoAbono[];

  // Comprovante: substituição do comprovante por batida pelo relatório mensal
  // assinado (Quibebe cl.43) — reforça o espelho mensal como documento central.
  comprovanteMensalSubstitui?: boolean;
  marcacaoPeloProprioEmpregado?: boolean;   // Belém cl.29/34
  viaImpressaSobDemanda?: boolean;          // Belém: via impressa da marcação sob demanda

  pendencias?: string[];          // ex.: "confirmar enquadramento do piso", "renovar CCT Belém 24/25"
  atualizadoEm?: string;
  atualizadoPor?: { id: string; nome: string };
};

// Resolve os parâmetros de CCT vigentes p/ uma empresa numa data (YYYY-MM-DD).
export function cctVigenteEm(lista: ParametrosCCT[], empresaKey: string, data: string): ParametrosCCT | null {
  const cands = lista
    .filter(p => p.empresaKey === empresaKey && p.vigenciaDe <= data && data <= p.vigenciaAte)
    .sort((a, b) => b.vigenciaDe.localeCompare(a.vigenciaDe));
  if (cands.length) return cands[0];
  // Sem vigência exata (ex.: CCT vencida não renovada) → cai na mais recente da empresa.
  return lista.filter(p => p.empresaKey === empresaKey).sort((a, b) => b.vigenciaDe.localeCompare(a.vigenciaDe))[0] || null;
}
